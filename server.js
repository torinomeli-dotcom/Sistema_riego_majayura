/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  RIEGO IOT — Servidor Node.js v4.0                      ║
 * ║  ESP32 → HTTP POST  |  Navegador ← SSE (sin WebSocket)  ║
 * ║  Majayura, La Guajira, Colombia                         ║
 * ╚══════════════════════════════════════════════════════════╝
 */

require('dotenv').config();
const express   = require('express');
const http      = require('http');
const path      = require('path');
const jwt       = require('jsonwebtoken');
const morgan    = require('morgan');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const apiRoutes  = require('./routes/api');
const { initDB, guardarHistorial, obtenerHistorial } = require('./database');

let ultimoEstado        = null;
let esp32UltimoContacto = 0;
let comandosPendientes  = [];

// ── SSE: clientes navegador ─────────────────────────────────────
// Mapa { id → res } — cada navegador abierto es una entrada
const sseClientes = new Map();
let sseNextId = 0;

function sseEnviar(res, datos) {
  try { res.write(`data: ${JSON.stringify(datos)}\n\n`); } catch (_) {}
}

function broadcastSSE(datos) {
  sseClientes.forEach(res => sseEnviar(res, datos));
}

// ── App Express ─────────────────────────────────────────────────
const app = express();

app.use(morgan('dev'));
app.use(cors());
app.use(express.json());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera un momento.' }
}));

const cmdLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Límite de comandos alcanzado (20/min).' }
});

// ── POST /api/telemetria — ESP32 envía datos ────────────────────
app.post('/api/telemetria', (req, res) => {
  const key = req.query.key || req.headers['x-esp32-key'];
  if (key !== (process.env.ESP32_SECRET || 'riego_esp32_2024')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const t = req.body;
  if (!t || typeof t !== 'object') {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  t.serverTimestamp   = Date.now();
  ultimoEstado        = t;
  esp32UltimoContacto = Date.now();

  guardarHistorial({
    ts:       Date.now(),
    sensores: t.sensores,
    valvula:  t.actuadores?.valvula,
    alerta:   t.alerta_encharcamiento || false
  }).catch(e => console.error('[DB]', e.message));

  broadcastSSE(t);
  console.log(`[ESP32] Telemetría OK — valvula=${t.actuadores?.valvula?.estado} clientes=${sseClientes.size}`);
  res.json({ ok: true });
});

// ── GET /api/pendiente — ESP32 recoge comando en cola ───────────
app.get('/api/pendiente', (req, res) => {
  const key = req.query.key || req.headers['x-esp32-key'];
  if (key !== (process.env.ESP32_SECRET || 'riego_esp32_2024')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  esp32UltimoContacto = Date.now();
  if (comandosPendientes.length === 0) return res.status(204).end();
  const cmd = comandosPendientes.shift();
  console.log(`[ESP32] Comando entregado: ${JSON.stringify(cmd)}`);
  res.json(cmd);
});

// ── GET /api/eventos — SSE para el navegador ────────────────────
app.get('/api/eventos', (req, res) => {
  // Verificar token (query param o header)
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // Cabeceras SSE
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // Desactiva buffer en nginx/Render
  res.flushHeaders();

  const id = sseNextId++;
  sseClientes.set(id, res);
  console.log(`[SSE] Cliente #${id} conectado (total: ${sseClientes.size})`);

  // Enviar estado actual inmediatamente
  if (ultimoEstado) {
    sseEnviar(res, ultimoEstado);
  } else {
    sseEnviar(res, { tipo: 'info', mensaje: 'Esperando datos del ESP32...' });
  }

  // Comentario de keep-alive cada 20s (evita que Render/nginx corten la conexión)
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 20000);

  // Limpiar cuando el navegador cierra la pestaña
  req.on('close', () => {
    clearInterval(ping);
    sseClientes.delete(id);
    console.log(`[SSE] Cliente #${id} desconectado (total: ${sseClientes.size})`);
  });
});

// ── Rutas autenticadas (JWT) ────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes(getUltimoEstado, getHistorial, enviarComandoESP32, cmdLimit, getESP32Status));

// ── GET /api/salud — público ────────────────────────────────────
app.get('/api/salud', (_req, res) => {
  res.json({
    ok:                 true,
    servidor:           'online',
    esp32:              getESP32Status() ? 'conectado' : 'desconectado',
    ultimoContacto:     esp32UltimoContacto || null,
    clientesSSE:        sseClientes.size,
    comandosPendientes: comandosPendientes.length,
    uptime:             Math.floor(process.uptime()),
    version:            '4.0.0'
  });
});

// ── Archivos estáticos ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api'))
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Getters y helpers ───────────────────────────────────────────
function getUltimoEstado() { return ultimoEstado; }
function getHistorial()    { return obtenerHistorial; }
function getESP32Status()  { return (Date.now() - esp32UltimoContacto) < 120000; }

function enviarComandoESP32(cmd) {
  if (getESP32Status()) {
    comandosPendientes = comandosPendientes.filter(c => c.cmd !== cmd.cmd);
    comandosPendientes.push(cmd);
    if (comandosPendientes.length > 5) comandosPendientes.shift();
    console.log(`[ESP32] Comando encolado: ${JSON.stringify(cmd)}`);
    return true;
  }
  console.warn('[ESP32] Desconectado — comando descartado:', cmd);
  return false;
}

// ── Arrancar servidor ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);

initDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   RIEGO IOT — Servidor v4.0 iniciado     ║');
    console.log(`║   Puerto: ${PORT}                             ║`);
    console.log('╚══════════════════════════════════════════╝\n');
  });
}).catch(e => {
  console.error('[DB] Error iniciando base de datos:', e.message);
  process.exit(1);
});
