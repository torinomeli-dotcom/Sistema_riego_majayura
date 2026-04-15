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
  console.log('[DB] Tabla historial lista');
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

module.exports = { pool, initDB, guardarHistorial, obtenerHistorial };
