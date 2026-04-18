const express   = require('express');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const { enviarResetClave } = require('../mailer');
const {
  guardarResetToken, obtenerResetToken, eliminarResetToken, limpiarTokensExpirados,
  getConfig, setConfig
} = require('../database');

const router = express.Router();

// ── Bloqueo por IP (5 fallos → 5 min) ────────────────────────────────────────
const loginFallos = new Map(); // ip → { count, bloqueadoHasta }
const BLOQUEO_MS  = 5 * 60 * 1000;
const MAX_FALLOS  = 5;

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function verificarBloqueo(req, res) {
  const ip   = getIP(req);
  const dato = loginFallos.get(ip);
  if (!dato) return false;
  if (dato.bloqueadoHasta && Date.now() < dato.bloqueadoHasta) {
    const restaSeg = Math.ceil((dato.bloqueadoHasta - Date.now()) / 1000);
    res.status(429).json({ error: `IP bloqueada por demasiados intentos. Intenta en ${restaSeg}s.`, bloqueado: true, restaSeg });
    return true;
  }
  if (dato.bloqueadoHasta && Date.now() >= dato.bloqueadoHasta) loginFallos.delete(ip);
  return false;
}

function registrarFallo(req) {
  const ip   = getIP(req);
  const dato = loginFallos.get(ip) || { count: 0 };
  dato.count++;
  if (dato.count >= MAX_FALLOS) dato.bloqueadoHasta = Date.now() + BLOQUEO_MS;
  loginFallos.set(ip, dato);
  return MAX_FALLOS - dato.count;
}

function limpiarFallos(req) {
  loginFallos.delete(getIP(req));
}

// ── CAPTCHA matemático server-side ────────────────────────────────────────────
const captchaStore = new Map(); // token → { respuesta, expira }
const CAPTCHA_TTL  = 5 * 60 * 1000;

router.get('/captcha', (req, res) => {
  const a   = Math.floor(Math.random() * 9) + 1;
  const b   = Math.floor(Math.random() * 9) + 1;
  const token = crypto.randomBytes(16).toString('hex');
  captchaStore.set(token, { respuesta: a + b, expira: Date.now() + CAPTCHA_TTL });
  // Limpiar captchas viejos
  for (const [k, v] of captchaStore) if (Date.now() > v.expira) captchaStore.delete(k);
  res.json({ token, pregunta: `¿Cuánto es ${a} + ${b}?` });
});

// ── Middleware verificar JWT ──────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  if (verificarBloqueo(req, res)) return;

  const { usuario, password, captchaToken, captchaRespuesta } = req.body;
  if (!usuario || !password)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });

  // Verificar CAPTCHA
  const cap = captchaStore.get(captchaToken);
  if (!cap || Date.now() > cap.expira) {
    captchaStore.delete(captchaToken);
    return res.status(400).json({ error: 'CAPTCHA inválido o expirado. Recárgalo.', captchaError: true });
  }
  captchaStore.delete(captchaToken); // consumir — no reutilizable
  if (parseInt(captchaRespuesta) !== cap.respuesta)
    return res.status(400).json({ error: 'Respuesta del CAPTCHA incorrecta.', captchaError: true });

  const [adminUser, adminPass] = await Promise.all([
    getConfig('admin_user'),
    getConfig('admin_pass')
  ]);

  await new Promise(r => setTimeout(r, 300));

  if (usuario !== adminUser || password !== adminPass) {
    const restantes = registrarFallo(req);
    const msg = restantes > 0
      ? `Credenciales incorrectas. Te quedan ${restantes} intento(s).`
      : `Demasiados intentos fallidos. IP bloqueada por ${BLOQUEO_MS/60000} minutos.`;
    return res.status(401).json({ error: msg });
  }

  limpiarFallos(req);
  const token = jwt.sign(
    { sub: adminUser, rol: 'admin', sistema: 'riego-majayura', iat: Math.floor(Date.now()/1000) },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  console.log(`[AUTH] Login exitoso — usuario: ${adminUser} IP: ${getIP(req)}`);
  res.json({ ok: true, token, usuario: adminUser, expira: '24h', mensaje: 'Bienvenido al Sistema de Riego Majayura' });
});

// ── POST /api/auth/verificar ──────────────────────────────────────────────────
router.post('/verificar', (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ valido: false });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    res.json({ valido: true, usuario: decoded.sub, expira: decoded.exp });
  } catch {
    res.status(401).json({ valido: false, error: 'Token inválido o expirado' });
  }
});

// ── POST /api/auth/cambiar-clave ──────────────────────────────────────────────
router.post('/cambiar-clave', requireAuth, async (req, res) => {
  const { claveActual, claveNueva } = req.body;

  if (!claveActual || !claveNueva)
    return res.status(400).json({ error: 'Campos requeridos.' });

  if (!/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/.test(claveNueva))
    return res.status(400).json({ error: 'La clave debe tener mínimo 8 caracteres, una mayúscula, un número y un carácter especial.' });

  const adminPass = await getConfig('admin_pass');
  if (claveActual !== adminPass)
    return res.status(401).json({ error: 'La clave actual es incorrecta.' });

  await setConfig('admin_pass', claveNueva);
  console.log('[AUTH] Contraseña actualizada en DB');
  res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente.' });
});

// ── POST /api/auth/recuperar ──────────────────────────────────────────────────
router.post('/recuperar', rateLimit({ windowMs: 60*1000, max: 3,
  message: { error: 'Demasiadas solicitudes. Espera 1 minuto.' }
}), async (req, res) => {
  const { correo } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL || '';

  if (!correo || correo.toLowerCase() !== adminEmail.toLowerCase())
    return res.json({ ok: true, mensaje: 'Si el correo está registrado, recibirás el enlace de recuperación.' });

  await limpiarTokensExpirados();
  const token  = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + 30 * 60 * 1000;
  await guardarResetToken(token, expiry);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const enviado = await enviarResetClave(token, baseUrl);

  if (!enviado)
    return res.status(500).json({ error: 'No se pudo enviar el correo. Verifica RESEND_API_KEY y ADMIN_EMAIL.' });

  res.json({ ok: true, mensaje: 'Si el correo está registrado, recibirás el enlace de recuperación.' });
});

// ── POST /api/auth/reset ──────────────────────────────────────────────────────
router.post('/reset', async (req, res) => {
  const { token, claveNueva } = req.body;

  if (!token || !claveNueva)
    return res.status(400).json({ error: 'Token y nueva clave requeridos.' });

  if (!/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/.test(claveNueva))
    return res.status(400).json({ error: 'La clave debe tener mínimo 8 caracteres, una mayúscula, un número y un carácter especial.' });

  const datos = await obtenerResetToken(token);
  if (!datos || Date.now() > datos.expiry) {
    await eliminarResetToken(token);
    return res.status(400).json({ error: 'Token inválido o expirado. Solicita uno nuevo.' });
  }

  await eliminarResetToken(token);
  await setConfig('admin_pass', claveNueva);
  console.log('[AUTH] Contraseña restablecida via reset token');
  res.json({ ok: true, mensaje: 'Contraseña restablecida. Ya puedes iniciar sesión.' });
});

module.exports = router;
