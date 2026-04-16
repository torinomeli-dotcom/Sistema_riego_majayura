/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  RIEGO IOT — Servidor Node.js v5.0                      ║
 * ║  ESP32 ↔ WebSocket  |  Navegador ↔ WebSocket            ║
 * ║  Majayura, La Guajira, Colombia                         ║
 * ╚══════════════════════════════════════════════════════════╝
 */

require('dotenv').config();
const express             = require('express');
const http                = require('http');
const path                = require('path');
const jwt                 = require('jsonwebtoken');
const morgan              = require('morgan');
const cors                = require('cors');
const rateLimit           = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const urlModule           = require('url');

const authRoutes = require('./routes/auth');
const apiRoutes  = require('./routes/api');
const { initDB, guardarHistorial, obtenerHistorial } = require('./database');

// ── Estado global ────────────────────────────────────────────────
let ultimoEstado        = null;
let esp32WS             = null;   // WebSocket del ESP32
let esp32UltimoContacto = 0;
let comandosPendientes  = [];     // Cola cuando ESP32 se reconecta

const dashboardClients = new Set();  // WebSocket de navegadores

// ── App Express ──────────────────────────────────────────────────
const app = express();

app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);  // Railway usa proxy inverso — necesario para rate-limit

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
    clientesDashboard:  dashboardClients.size,
    comandosPendientes: comandosPendientes.length,
    uptime:             Math.floor(process.uptime()),
    version:            '5.0.0'
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
function getESP32Status()  {
  return !!(esp32WS &&
            esp32WS.readyState === 1 /* OPEN */ &&
            (Date.now() - esp32UltimoContacto) < 120000);
}

function broadcastDashboard(datos) {
  const msg = JSON.stringify(datos);
  dashboardClients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch (_) {}
    }
  });
}

function enviarComandoESP32(cmd) {
  // Deduplicar: si ya hay un comando del mismo tipo pendiente, lo reemplaza
  comandosPendientes = comandosPendientes.filter(c => c.cmd !== cmd.cmd);
  comandosPendientes.push(cmd);
  if (comandosPendientes.length > 10) comandosPendientes.shift();

  if (esp32WS && esp32WS.readyState === 1) {
    // Vaciar la cola completa de una vez
    while (comandosPendientes.length > 0) {
      const c = comandosPendientes.shift();
      try {
        esp32WS.send(JSON.stringify(c));
        console.log(`[ESP32] Comando enviado: ${JSON.stringify(c)}`);
      } catch (e) {
        console.error('[ESP32] Error enviando comando:', e.message);
      }
    }
    return true;
  }

  console.warn('[ESP32] Desconectado — comando encolado:', cmd);
  return false;
}

// ── Manejo de conexión ESP32 ────────────────────────────────────
function manejarESP32(ws) {
  // Si ya había una conexión, cerrarla
  if (esp32WS) {
    try { esp32WS.terminate(); } catch (_) {}
  }
  esp32WS = ws;
  esp32UltimoContacto = Date.now();
  console.log('[ESP32] WebSocket conectado');

  // Vaciar cola de comandos pendientes
  if (comandosPendientes.length > 0) {
    console.log(`[ESP32] Enviando ${comandosPendientes.length} comandos pendientes`);
    while (comandosPendientes.length > 0) {
      try { ws.send(JSON.stringify(comandosPendientes.shift())); } catch (_) {}
    }
  }

  ws.on('message', (data) => {
    try {
      const t = JSON.parse(data.toString());
      t.serverTimestamp   = Date.now();
      ultimoEstado        = t;
      esp32UltimoContacto = Date.now();

      guardarHistorial({
        ts:       Date.now(),
        sensores: t.sensores,
        valvula:  t.actuadores?.valvula,
        alerta:   t.alerta_encharcamiento || false
      }).catch(e => console.error('[DB]', e.message));

      broadcastDashboard(t);
      console.log(`[ESP32] Telemetría OK — valvula=${t.actuadores?.valvula?.estado} dashboards=${dashboardClients.size}`);
    } catch (e) {
      console.error('[ESP32] Error parseando mensaje:', e.message);
    }
  });

  ws.on('close', () => {
    if (esp32WS === ws) esp32WS = null;
    console.log('[ESP32] WebSocket desconectado');
  });

  ws.on('error', (e) => console.error('[ESP32] WS error:', e.message));
}

// ── Manejo de conexión Dashboard ────────────────────────────────
function manejarDashboard(ws) {
  dashboardClients.add(ws);
  console.log(`[Dashboard] WS conectado (total: ${dashboardClients.size})`);

  // Enviar estado actual inmediatamente al conectar
  if (ultimoEstado) {
    try { ws.send(JSON.stringify(ultimoEstado)); } catch (_) {}
  } else {
    try { ws.send(JSON.stringify({ tipo: 'info', mensaje: 'Esperando datos del ESP32...' })); } catch (_) {}
  }

  ws.on('close', () => {
    dashboardClients.delete(ws);
    console.log(`[Dashboard] WS desconectado (total: ${dashboardClients.size})`);
  });

  ws.on('error', () => dashboardClients.delete(ws));
}

// ── HTTP upgrade → WebSocket ────────────────────────────────────
const wss      = new WebSocketServer({ noServer: true });
const PORT     = process.env.PORT || 3000;
const httpServer = http.createServer(app);

httpServer.on('upgrade', (req, socket, head) => {
  const parsed   = urlModule.parse(req.url);
  const pathname = parsed.pathname;
  const params   = new URLSearchParams(parsed.query || '');

  if (pathname === '/ws/esp32') {
    const key = params.get('key');
    if (key !== (process.env.ESP32_SECRET || 'riego_esp32_2024')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => manejarESP32(ws));

  } else if (pathname === '/ws/dashboard') {
    const token = params.get('token');
    try {
      jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => manejarDashboard(ws));

  } else {
    socket.destroy();
  }
});

// ── Arrancar servidor ───────────────────────────────────────────
initDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   RIEGO IOT — Servidor v5.0 iniciado     ║');
    console.log(`║   Puerto: ${PORT}                             ║`);
    console.log('║   ESP32  WS: /ws/esp32                   ║');
    console.log('║   Naveg. WS: /ws/dashboard               ║');
    console.log('╚══════════════════════════════════════════╝\n');
  });
}).catch(e => {
  console.error('[DB] Error iniciando base de datos:', e.message);
  process.exit(1);
});
