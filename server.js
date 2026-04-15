/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  RIEGO IOT — Servidor Node.js v2.0                      ║
 * ║  Puente WebSocket ESP32 ↔ Clientes Web + REST API JWT   ║
 * ║  Majayura, La Guajira, Colombia                         ║
 * ╚══════════════════════════════════════════════════════════╝
 */

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const path       = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const morgan     = require('morgan');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const apiRoutes  = require('./routes/api');
const { initDB, guardarHistorial, obtenerHistorial } = require('./database');

let ultimoEstado = null;
let esp32Conectado = false;
let wsESP32 = null;  // Conexión WebSocket con el ESP32

// ── App Express ─────────────────────────────────────────────────
const app = express();

app.use(morgan('dev'));
app.use(cors());
app.use(express.json());

// Rate limiting global — máx 120 req/min por IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera un momento.' }
}));

// Rate limiting específico para comandos — máx 10 cmd/min por IP
const cmdLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Límite de comandos alcanzado (10/min).' }
});

// ── Rutas ───────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api',      apiRoutes(getUltimoEstado, getHistorial, enviarComandoESP32, cmdLimit, getESP32Status));

// GET /api/salud — público
app.get('/api/salud', (req, res) => {
  res.json({
    ok: true,
    servidor: 'online',
    esp32: esp32Conectado ? 'conectado' : 'desconectado',
    ultimaLectura: ultimoEstado ? ultimoEstado.timestamp : null,
    clientesWeb: wssClientes ? wssClientes.clients.size : 0,
    historialSize: historial.length,
    uptime: Math.floor(process.uptime()),
    version: '2.0.0'
  });
});

// ── Archivos estáticos ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback — cualquier ruta no API devuelve index.html
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ── Servidor HTTP ───────────────────────────────────────────────
const httpServer = http.createServer(app);

// ── WebSocket Server — Clientes Web (Dashboard) ─────────────────
const wssClientes = new WebSocketServer({ server: httpServer, path: '/ws', perMessageDeflate: false });

wssClientes.on('connection', (ws, req) => {
  // Verificar token JWT en query param
  const url    = new URL(req.url, `http://${req.headers.host}`);
  const token  = url.searchParams.get('token');
  const jwt    = require('jsonwebtoken');

  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    console.log('[WS-WEB] Cliente rechazado — token inválido');
    ws.close(1008, 'Token inválido');
    return;
  }

  const ip = req.socket.remoteAddress;
  console.log(`[WS-WEB] Cliente conectado desde ${ip}`);

  // Enviar estado actual inmediatamente
  if (ultimoEstado) {
    ws.send(JSON.stringify(ultimoEstado));
  } else {
    ws.send(JSON.stringify({
      tipo: 'info',
      mensaje: 'Esperando datos del ESP32...',
      esp32Conectado: false
    }));
  }

  // Comandos del dashboard al ESP32
  ws.on('message', (data) => {
    try {
      const cmd = JSON.parse(data.toString());
      console.log(`[WS-WEB] Comando recibido: ${JSON.stringify(cmd)}`);
      const ok = enviarComandoESP32(cmd);
      if (!ok) {
        ws.send(JSON.stringify({ tipo: 'error', mensaje: 'ESP32 no conectado — comando no enviado' }));
      }
    } catch (e) {
      console.error('[WS-WEB] Error parseando comando:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[WS-WEB] Cliente ${ip} desconectado`);
  });

  ws.on('error', (err) => {
    console.error(`[WS-WEB] Error: ${err.message}`);
  });
});

// ── Broadcast a todos los clientes web ─────────────────────────
function broadcastClientes(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  wssClientes.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ── Getters para las rutas ──────────────────────────────────────
function getUltimoEstado() { return ultimoEstado; }
function getHistorial()    { return obtenerHistorial; } // función async, api.js la llama
function getESP32Status()  { return esp32Conectado; }

// ── Enviar comando al ESP32 ─────────────────────────────────────
function enviarComandoESP32(cmd) {
  if (!wsESP32 || wsESP32.readyState !== WebSocket.OPEN) {
    console.warn('[ESP32] No conectado — comando descartado:', cmd);
    return false;
  }
  wsESP32.send(JSON.stringify(cmd));
  console.log(`[ESP32] Comando enviado: ${JSON.stringify(cmd)}`);
  return true;
}

// ══════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER — ESP32 se conecta al servidor (path /esp32)
// El ESP32 inicia la conexión hacia Render — no al revés
// ══════════════════════════════════════════════════════════════════
const wssESP32 = new WebSocketServer({ server: httpServer, path: '/esp32', perMessageDeflate: false });

wssESP32.on('connection', (ws, req) => {
  // Verificar clave secreta del ESP32
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = url.searchParams.get('key');
  if (key !== (process.env.ESP32_SECRET || 'riego_esp32_2024')) {
    console.warn('[ESP32] Conexión rechazada — clave inválida');
    ws.close(1008, 'No autorizado');
    return;
  }

  console.log('[ESP32] ✓ Conectado desde', req.socket.remoteAddress);
  wsESP32        = ws;
  esp32Conectado = true;
  broadcastClientes({ tipo: 'conexion', esp32: true });

  // Ping cada 25 seg para mantener viva la conexión en Render
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ cmd: 'ping' }));
  }, 25000);

  ws.on('message', (data) => {
    try {
      const telemetria = JSON.parse(data.toString());
      if (telemetria.tipo === 'pong') return;

      telemetria.serverTimestamp = Date.now();
      ultimoEstado = telemetria;

      guardarHistorial({
        ts:       Date.now(),
        sensores: telemetria.sensores,
        valvula:  telemetria.actuadores?.valvula,
        alerta:   telemetria.alerta_encharcamiento || false
      }).catch(e => console.error('[DB] Error guardando historial:', e.message));

      broadcastClientes(telemetria);
    } catch (e) {
      console.error('[ESP32] Error parseando mensaje:', e.message);
    }
  });

  ws.on('close', (code) => {
    console.warn(`[ESP32] Desconectado (${code})`);
    esp32Conectado = false;
    wsESP32        = null;
    clearInterval(pingInterval);
    broadcastClientes({ tipo: 'conexion', esp32: false });
  });

  ws.on('error', (err) => console.error('[ESP32] Error WS:', err.message));
});

function conectarESP32() { /* no-op: ESP32 se conecta al servidor */ }

// ── Arrancar servidor ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   RIEGO IOT — Servidor v2.0 iniciado     ║');
    console.log(`║   Puerto: ${PORT}                             ║`);
    console.log('║   Dashboard: http://localhost:' + PORT + '      ║');
    console.log('╚══════════════════════════════════════════╝\n');
    conectarESP32();
  });
}).catch(e => {
  console.error('[DB] Error iniciando base de datos:', e.message);
  process.exit(1);
});
