const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Fix Neon PostgreSQL 16+ — search_path
pool.on('connect', (client) => {
  client.query('SET search_path TO public');
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS historial (
      id         SERIAL PRIMARY KEY,
      ts         BIGINT NOT NULL,
      sensores   JSONB,
      valvula    JSONB,
      alerta     BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token      TEXT PRIMARY KEY,
      expiry     BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('[DB] Tablas listas');
}

async function guardarResetToken(token, expiry) {
  await pool.query(
    'INSERT INTO reset_tokens (token, expiry) VALUES ($1, $2) ON CONFLICT (token) DO UPDATE SET expiry = $2',
    [token, expiry]
  );
}

async function obtenerResetToken(token) {
  const res = await pool.query('SELECT expiry FROM reset_tokens WHERE token = $1', [token]);
  return res.rows[0] || null;
}

async function eliminarResetToken(token) {
  await pool.query('DELETE FROM reset_tokens WHERE token = $1', [token]);
}

async function limpiarTokensExpirados() {
  await pool.query('DELETE FROM reset_tokens WHERE expiry < $1', [Date.now()]);
}

async function guardarHistorial({ ts, sensores, valvula, alerta }) {
  await pool.query(
    'INSERT INTO historial (ts, sensores, valvula, alerta) VALUES ($1, $2, $3, $4)',
    [ts, JSON.stringify(sensores), JSON.stringify(valvula), alerta || false]
  );
}

async function obtenerHistorial(limit = 100) {
  const res = await pool.query(
    'SELECT ts, sensores, valvula, alerta FROM historial ORDER BY ts DESC LIMIT $1',
    [limit]
  );
  return res.rows.reverse(); // más antiguo primero
}

async function obtenerHistorialDesde(desdeTs, maxRows = 5000) {
  const res = await pool.query(
    'SELECT ts, sensores, valvula, alerta FROM historial WHERE ts >= $1 ORDER BY ts ASC LIMIT $2',
    [desdeTs, maxRows]
  );
  return res.rows;
}

module.exports = { pool, initDB, guardarHistorial, obtenerHistorial, obtenerHistorialDesde, guardarResetToken, obtenerResetToken, eliminarResetToken, limpiarTokensExpirados };
