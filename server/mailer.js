require('dotenv').config();

// Variables en .env:
//   RESEND_API_KEY → clave desde resend.com/api-keys
//   FROM_EMAIL     → remitente verificado (o onboarding@resend.dev para pruebas)
//   ADMIN_EMAIL    → correo donde llegan las alertas y el reset de clave

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL  || 'onboarding@resend.dev';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;

let _resend = null;

function _getClient() {
  if (!RESEND_API_KEY || !ADMIN_EMAIL) return null;
  if (!_resend) {
    try {
      const { Resend } = require('resend');
      _resend = new Resend(RESEND_API_KEY);
    } catch (e) {
      console.warn('[mailer] resend no disponible:', e.message);
      return null;
    }
  }
  return _resend;
}

async function _enviar({ to, asunto, html, texto }) {
  const client = _getClient();
  if (!client) {
    console.log(`[mailer] Resend no configurado — correo no enviado: ${asunto}`);
    return false;
  }
  try {
    const { data, error } = await client.emails.send({
      from:    `Riego Mi Majayura <${FROM_EMAIL}>`,
      to:      [to || ADMIN_EMAIL],
      subject: asunto,
      html:    html || `<p>${texto}</p>`,
      text:    texto,
    });
    if (error) {
      console.error('[mailer] Error Resend:', JSON.stringify(error));
      return false;
    }
    console.log(`[mailer] Enviado OK — id:${data?.id}`);
    return true;
  } catch (err) {
    console.error('[mailer] Error enviando:', err.message);
    return false;
  }
}

// ── RECUPERAR CONTRASEÑA ──────────────────────────────────────────────────────
async function enviarResetClave(token, baseUrl) {
  const enlace = `${baseUrl}/reset.html?token=${token}`;
  return _enviar({
    asunto: '[Riego Mi Majayura] Recuperar contraseña',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0d1117;color:#e6edf3;padding:2rem;border-radius:12px;border:1px solid #21262d">
        <h2 style="color:#3fb950;margin-top:0">💧 Riego Mi Majayura — Recuperar contraseña</h2>
        <p>Se solicitó restablecer la contraseña del sistema de riego.</p>
        <p>Haz clic en el botón para crear una nueva contraseña:<br><small style="color:#8b949e">(enlace válido por 30 minutos)</small></p>
        <a href="${enlace}" style="display:inline-block;margin:1rem 0;padding:0.75rem 1.5rem;background:#3fb950;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Restablecer contraseña
        </a>
        <p style="font-size:0.8rem;color:#8b949e">Si no solicitaste esto, ignora este correo.</p>
      </div>
    `,
    texto: `Riego Mi Majayura — Recuperar contraseña\n\nEnlace (válido 30 min):\n${enlace}\n\nSi no solicitaste esto, ignora este mensaje.`
  });
}

module.exports = { enviarResetClave };
