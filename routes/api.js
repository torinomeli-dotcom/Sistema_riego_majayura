/**
 * REST API endpoints — /api/*
 * Todos requieren JWT válido excepto /api/salud
 */

const express = require('express');
const jwt     = require('jsonwebtoken');

// Middleware de autenticación JWT
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const tokenQuery = req.query.token;

  const token = tokenQuery || (authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null);

  if (!token) {
    return res.status(401).json({ error: 'Token requerido.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

/**
 * Factory que recibe getters y funciones del server.js
 */
module.exports = function(getUltimoEstado, getHistorial, enviarComandoESP32, cmdLimit, getESP32Status) {
  const router = express.Router();

  // ── GET /api/estado ─────────────────────────────────────────────
  router.get('/estado', requireAuth, (req, res) => {
    const estado = getUltimoEstado();
    if (!estado) {
      return res.status(503).json({
        error: 'Sin datos del ESP32 todavía.',
        esp32Conectado: getESP32Status()
      });
    }
    res.json(estado);
  });

  // ── POST /api/comando — enviar comando al ESP32 ─────────────────
  router.post('/comando', requireAuth, cmdLimit, (req, res) => {
    const { cmd, estado, auto } = req.body;

    const comandosValidos = ['valvula', 'bombillo1', 'bombillo2', 'modo_auto', 'ping'];
    if (!cmd || !comandosValidos.includes(cmd)) {
      return res.status(400).json({ error: `Comando inválido. Válidos: ${comandosValidos.join(', ')}` });
    }

    const payload = { cmd };
    if (estado !== undefined) payload.estado = !!estado;
    if (auto   !== undefined) payload.estado  = !!auto;

    const enviado = enviarComandoESP32(payload);

    if (!enviado) {
      return res.status(503).json({ error: 'ESP32 no conectado.' });
    }

    console.log(`[API] Comando enviado por ${req.user.sub}: ${JSON.stringify(payload)}`);
    res.json({ ok: true, cmd: payload });
  });

  // ── GET /api/historial — últimas 100 lecturas ───────────────────
  router.get('/historial', requireAuth, (req, res) => {
    const hist = getHistorial();
    const limit = Math.min(parseInt(req.query.limit) || 100, 100);

    // Calcular promedios por zona para gráficas
    const datos = hist.slice(-limit).map(h => {
      if (!h.sensores) return null;
      const s = h.sensores;
      const promIzq = promedio([s.SL1?.pct, s.SL2?.pct, s.SL3?.pct]);
      const promCtr = promedio([s.SM1?.pct, s.SM2?.pct]);
      const promDer = promedio([s.SR1?.pct, s.SR2?.pct, s.SR3?.pct]);
      return {
        ts:      h.ts,
        izq:     promIzq,
        ctr:     promCtr,
        der:     promDer,
        valvula: h.valvula?.estado || false,
        alerta:  h.alerta || false
      };
    }).filter(Boolean);

    res.json({
      total:  datos.length,
      datos
    });
  });

  // ── GET /api/estadisticas — estadísticas rápidas ────────────────
  router.get('/estadisticas', requireAuth, (req, res) => {
    const hist = getHistorial();
    if (hist.length === 0) return res.json({ sin_datos: true });

    const ultimaHora = hist.filter(h => Date.now() - h.ts < 3600000);

    let minutosTotalRiego = 0;
    let alertasEncharcamiento = 0;

    ultimaHora.forEach(h => {
      if (h.valvula?.estado) minutosTotalRiego += 0.5; // aprox 30 seg por lectura
      if (h.alerta) alertasEncharcamiento++;
    });

    res.json({
      lecturas_ultima_hora:   ultimaHora.length,
      minutos_riego_hora:     minutosTotalRiego.toFixed(1),
      alertas_encharcamiento: alertasEncharcamiento,
      total_lecturas:         hist.length
    });
  });

  return router;
};

// ── Utilidad ─────────────────────────────────────────────────────
function promedio(arr) {
  const vals = arr.filter(v => v !== undefined && v !== null);
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
