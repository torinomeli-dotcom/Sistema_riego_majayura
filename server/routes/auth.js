const express   = require('express');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const fs        = require('fs');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const { enviarResetClave } = require('../mailer');

const router = express.Router();

// Máximo 5 intentos de login por minuto por IP
const loginLimit = rateLimit({ windowMs: 60*1000, max: 5,
  message: { error: 'Demasiados intentos. Espera 1 minuto.' }
});

// Tokens de reset en memoria { token: { expiry } }
const resetTokens = new Map();

// ── Leer contraseña actual (siempre desde process.env vigente) ────────────────
function getAdminPass() { return process.env.ADMIN_PASS || 'riego2024'; }
function getAdminUser() { return process.env.ADMIN_USER || 'admin'; }

// ── Guardar nueva contraseña en .env ─────────────────────────────────────────
function actualizarClaveEnv(nuevaClave) {
  const envPath = path.join(__dirname, '../.env');
  let contenido = fs.readFileSync(envPath, 'utf8');
  contenido = contenido.replace(/^ADMIN_PASS=.*/m, `ADMIN_PASS=${nuevaClave}`);
  fs.writeFileSync(envPath, contenido, 'utf8');
  process.env.ADMIN_PASS = nuevaClave;
  console.log('[AUTH] Contraseña actualizada en .env');
}

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
router.post('/login', loginLimit, async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });

  if (usuario !== getAdminUser()) {
    await new Promise(r => setTimeout(r, 300));
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }

  if (password !== getAdminPass()) {
    await new Promise(r => setTimeout(r, 300));
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }

  const token = jwt.sign(
    { sub: getAdminUser(), rol: 'admin', sistema: 'riego-majayura', iat: Math.floor(Date.now()/1000) },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  console.log(`[AUTH] Login exitoso — usuario: ${getAdminUser()}`);
  res.json({ ok: true, token, usuario: getAdminUser(), expira: '24h', mensaje: 'Bienvenido al Sistema de Riego Majayura' });
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

  if (claveNueva.length < 6)
    return res.status(400).json({ error: 'La nueva clave debe tener mínimo 6 caracteres.' });

  if (claveActual !== getAdminPass())
    return res.status(401).json({ error: 'La clave actual es incorrecta.' });

  actualizarClaveEnv(claveNueva);
  res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente.' });
});

// ── POST /api/auth/recuperar ──────────────────────────────────────────────────
router.post('/recuperar', rateLimit({ windowMs: 60*1000, max: 3,
  message: { error: 'Demasiadas solicitudes. Espera 1 minuto.' }
}), async (req, res) => {
  const { correo } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL || '';

  // Siempre responder igual para no revelar información
  if (!correo || correo.toLowerCase() !== adminEmail.toLowerCase()) {
    return res.json({ ok: true, mensaje: 'Si el correo está registrado, recibirás el enlace de recuperación.' });
  }

  const token  = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + 30 * 60 * 1000; // 30 minutos
  resetTokens.set(token, { expiry });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const enviado = await enviarResetClave(token, baseUrl);

  if (!enviado) {
    return res.status(500).json({ error: 'No se pudo enviar el correo. Verifica RESEND_API_KEY y ADMIN_EMAIL en las variables de entorno.' });
  }

  res.json({ ok: true, mensaje: 'Si el correo está registrado, recibirás el enlace de recuperación.' });
});

// ── POST /api/auth/reset ──────────────────────────────────────────────────────
router.post('/reset', (req, res) => {
  const { token, claveNueva } = req.body;

  if (!token || !claveNueva)
    return res.status(400).json({ error: 'Token y nueva clave requeridos.' });

  if (claveNueva.length < 6)
    return res.status(400).json({ error: 'La clave debe tener mínimo 6 caracteres.' });

  const datos = resetTokens.get(token);
  if (!datos || Date.now() > datos.expiry) {
    resetTokens.delete(token);
    return res.status(400).json({ error: 'Token inválido o expirado. Solicita uno nuevo.' });
  }

  resetTokens.delete(token);
  actualizarClaveEnv(claveNueva);
  res.json({ ok: true, mensaje: 'Contraseña restablecida. Ya puedes iniciar sesión.' });
});

module.exports = router;
