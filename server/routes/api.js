/**
 * REST API endpoints — /api/*
 * Todos requieren JWT válido excepto /api/salud
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const { obtenerHistorialDesde } = require('../database');

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
    const { cmd, estado, auto,
            umbral_seco, umbral_humedo, umbral_encharcado,
            min_riego_ms, max_riego_ms, cultivo } = req.body;

    const comandosValidos = ['valvula', 'bombillo1', 'bombillo2', 'modo_auto', 'ping', 'calibrar', 'ota_update'];
    if (!cmd || !comandosValidos.includes(cmd)) {
      return res.status(400).json({ error: `Comando inválido. Válidos: ${comandosValidos.join(', ')}` });
    }

    const payload = { cmd };
    if (cmd === 'calibrar') {
      if (umbral_seco       !== undefined) payload.umbral_seco       = Number(umbral_seco);
      if (umbral_humedo     !== undefined) payload.umbral_humedo     = Number(umbral_humedo);
      if (umbral_encharcado !== undefined) payload.umbral_encharcado = Number(umbral_encharcado);
      if (min_riego_ms      !== undefined) payload.min_riego_ms      = Number(min_riego_ms);
      if (max_riego_ms      !== undefined) payload.max_riego_ms      = Number(max_riego_ms);
      if (cultivo           !== undefined) payload.cultivo           = String(cultivo).slice(0, 31);
    } else if (cmd === 'ota_update') {
      const url = String(req.body.url || '').trim();
      if (!url.startsWith('https://')) {
        return res.status(400).json({ error: 'La URL debe ser HTTPS.' });
      }
      payload.url = url;
    } else {
      if (estado !== undefined) payload.estado = !!estado;
      if (auto   !== undefined) payload.estado  = !!auto;
    }

    const enviado = enviarComandoESP32(payload);

    // OTA se encola aunque ESP32 no esté conectado en este momento exacto
    if (!enviado && cmd !== 'ota_update') {
      return res.status(503).json({ error: 'ESP32 no conectado.' });
    }

    console.log(`[API] Comando ${enviado ? 'enviado' : 'encolado'} por ${req.user.sub}: ${JSON.stringify(payload)}`);
    res.json({ ok: true, cmd: payload, encolado: !enviado });
  });

  // ── GET /api/historial — últimas 100 lecturas ───────────────────
  router.get('/historial', requireAuth, async (req, res) => {
    try {
      const limit   = Math.min(parseInt(req.query.limit) || 100, 100);
      const obtener = getHistorial();
      const hist    = await obtener(limit);

      const datos = hist.map(h => {
        if (!h.sensores) return null;
        const s = h.sensores;
        return {
          ts:      h.ts,
          izq:     promedio([s.SL1?.pct, s.SL2?.pct, s.SL3?.pct]),
          ctr:     promedio([s.SM1?.pct, s.SM2?.pct]),
          der:     promedio([s.SR1?.pct, s.SR2?.pct, s.SR3?.pct]),
          valvula: h.valvula?.estado || false,
          alerta:  h.alerta || false
        };
      }).filter(Boolean);

      res.json({ total: datos.length, datos });
    } catch (e) {
      console.error('[API] Error historial:', e.message);
      res.status(500).json({ error: 'Error consultando historial.' });
    }
  });

  // ── GET /api/estadisticas — estadísticas rápidas ────────────────
  router.get('/estadisticas', requireAuth, async (req, res) => {
    try {
      const obtener = getHistorial();
      const hist    = await obtener(100);
      if (hist.length === 0) return res.json({ sin_datos: true });

      const ultimaHora = hist.filter(h => Date.now() - h.ts < 3600000);
      let minutosTotalRiego = 0, alertasEncharcamiento = 0;
      ultimaHora.forEach(h => {
        if (h.valvula?.estado) minutosTotalRiego += 0.5;
        if (h.alerta) alertasEncharcamiento++;
      });

      res.json({
        lecturas_ultima_hora:   ultimaHora.length,
        minutos_riego_hora:     minutosTotalRiego.toFixed(1),
        alertas_encharcamiento: alertasEncharcamiento,
        total_lecturas:         hist.length
      });
    } catch (e) {
      res.status(500).json({ error: 'Error consultando estadísticas.' });
    }
  });

  // ── GET /api/analytics — Big Data analytics ────────────────────
  router.get('/analytics', requireAuth, async (req, res) => {
    try {
      const rango = req.query.rango || '24h';
      let desdeMs;
      switch (rango) {
        case '7d':  desdeMs = Date.now() - 7  * 24 * 3600 * 1000; break;
        case '30d': desdeMs = Date.now() - 30 * 24 * 3600 * 1000; break;
        default:    desdeMs = Date.now() -      24 * 3600 * 1000;
      }

      const hist = await obtenerHistorialDesde(desdeMs);
      if (hist.length === 0) return res.json({ sin_datos: true });

      const esPorHora = rango === '24h';

      // ── Resumen ──────────────────────────────────────────────
      let totalMinRiego = 0, activaciones = 0, alertas = 0, prevValvOn = false;
      let sumIzq = 0, sumCtr = 0, sumDer = 0;
      let cntIzq = 0, cntCtr = 0, cntDer = 0;
      let distSeco = 0, distHumedo = 0, distEnchar = 0;

      hist.forEach(h => {
        const valvOn = h.valvula?.estado || false;
        if (valvOn) totalMinRiego += 0.5;
        if (valvOn && !prevValvOn) activaciones++;
        prevValvOn = valvOn;
        if (h.alerta) alertas++;

        const s = h.sensores || {};
        const izqVals = [s.SL1?.pct, s.SL2?.pct, s.SL3?.pct].filter(v => v != null);
        const ctrVals = [s.SM1?.pct, s.SM2?.pct].filter(v => v != null);
        const derVals = [s.SR1?.pct, s.SR2?.pct, s.SR3?.pct].filter(v => v != null);
        if (izqVals.length) { sumIzq += izqVals.reduce((a, b) => a + b, 0) / izqVals.length; cntIzq++; }
        if (ctrVals.length) { sumCtr += ctrVals.reduce((a, b) => a + b, 0) / ctrVals.length; cntCtr++; }
        if (derVals.length) { sumDer += derVals.reduce((a, b) => a + b, 0) / derVals.length; cntDer++; }

        Object.values(s).forEach(sen => {
          if (!sen?.estado) return;
          if      (sen.estado === 'SECO')        distSeco++;
          else if (sen.estado === 'ENCHARCADO')  distEnchar++;
          else                                    distHumedo++;
        });
      });

      // ── Agrupación temporal ──────────────────────────────────
      function claveGrupo(ts) {
        const d = new Date(Number(ts));
        if (esPorHora) {
          const h = String(d.getHours()).padStart(2, '0');
          const m = d.getMinutes() < 30 ? '00' : '30';
          return `${h}:${m}`;
        }
        return `${d.getDate()}/${d.getMonth() + 1}`;
      }

      const grupos = {};
      hist.forEach(h => {
        const k = claveGrupo(h.ts);
        if (!grupos[k]) grupos[k] = { izqSum: 0, ctrSum: 0, derSum: 0, n: 0, riegoMin: 0 };
        const s = h.sensores || {};
        const izqVals = [s.SL1?.pct, s.SL2?.pct, s.SL3?.pct].filter(v => v != null);
        const ctrVals = [s.SM1?.pct, s.SM2?.pct].filter(v => v != null);
        const derVals = [s.SR1?.pct, s.SR2?.pct, s.SR3?.pct].filter(v => v != null);
        if (izqVals.length) grupos[k].izqSum += izqVals.reduce((a, b) => a + b, 0) / izqVals.length;
        if (ctrVals.length) grupos[k].ctrSum += ctrVals.reduce((a, b) => a + b, 0) / ctrVals.length;
        if (derVals.length) grupos[k].derSum += derVals.reduce((a, b) => a + b, 0) / derVals.length;
        grupos[k].n++;
        if (h.valvula?.estado) grupos[k].riegoMin += 0.5;
      });

      const labels    = Object.keys(grupos);
      const izqData   = labels.map(k => Math.round(grupos[k].izqSum / grupos[k].n) || 0);
      const ctrData   = labels.map(k => Math.round(grupos[k].ctrSum / grupos[k].n) || 0);
      const derData   = labels.map(k => Math.round(grupos[k].derSum / grupos[k].n) || 0);
      const riegoData = labels.map(k => parseFloat(grupos[k].riegoMin.toFixed(1)));

      res.json({
        resumen: {
          lecturas:     hist.length,
          minutosRiego: totalMinRiego.toFixed(1),
          activaciones,
          alertas,
          humedadProm: {
            izq: cntIzq ? Math.round(sumIzq / cntIzq) : 0,
            ctr: cntCtr ? Math.round(sumCtr / cntCtr) : 0,
            der: cntDer ? Math.round(sumDer / cntDer) : 0,
          }
        },
        tendencia: { labels, izq: izqData, ctr: ctrData, der: derData },
        riego:     { labels, minutos: riegoData },
        distribucion: { seco: distSeco, humedo: distHumedo, encharcado: distEnchar }
      });

    } catch (e) {
      console.error('[API] Error analytics:', e.message);
      res.status(500).json({ error: 'Error consultando analytics.' });
    }
  });

  return router;
};

// ── Utilidad ─────────────────────────────────────────────────────
function promedio(arr) {
  const vals = arr.filter(v => v !== undefined && v !== null);
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
