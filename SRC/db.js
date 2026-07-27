const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

/**
 * Converts a SQLite-style "?" placeholder query into Postgres "$1,$2,..."
 * so the command layer can be written once and stay readable, rather than
 * hand-numbering placeholders everywhere.
 */
function toPgQuery(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  async get(sql, params = []) {
    const res = await pool.query(toPgQuery(sql), params);
    return res.rows[0] || null;
  },
  async all(sql, params = []) {
    const res = await pool.query(toPgQuery(sql), params);
    return res.rows;
  },
  async run(sql, params = []) {
    const res = await pool.query(toPgQuery(sql), params);
    return { rowCount: res.rowCount, rows: res.rows };
  },
  async exec(sql) {
    await pool.query(sql);
  },
  pool,
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS characters (
  waid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  race TEXT,
  faction TEXT,
  rank_xp INTEGER NOT NULL DEFAULT 0,
  points_banked INTEGER NOT NULL DEFAULT 0,
  points_armament INTEGER NOT NULL DEFAULT 0,
  points_observation INTEGER NOT NULL DEFAULT 0,
  str_alloc INTEGER NOT NULL DEFAULT 0,
  def_alloc INTEGER NOT NULL DEFAULT 0,
  spd_alloc INTEGER NOT NULL DEFAULT 0,
  hp_current INTEGER NOT NULL DEFAULT 100,
  has_devil_fruit BOOLEAN NOT NULL DEFAULT FALSE,
  devil_fruit_name TEXT,
  has_conquerors_haki BOOLEAN NOT NULL DEFAULT FALSE,
  unique_stat TEXT,
  unique_bonus INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deck_slots (
  id SERIAL PRIMARY KEY,
  waid TEXT NOT NULL REFERENCES characters(waid) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL,
  move_name TEXT NOT NULL,
  move_type TEXT NOT NULL,
  move_class TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(waid, slot_number)
);

CREATE TABLE IF NOT EXISTS points_ledger (
  id SERIAL PRIMARY KEY,
  waid TEXT NOT NULL REFERENCES characters(waid) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT,
  allocated_to TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS traps (
  id SERIAL PRIMARY KEY,
  waid TEXT NOT NULL REFERENCES characters(waid) ON DELETE CASCADE,
  spar_id INTEGER,
  move_name TEXT NOT NULL,
  move_class TEXT NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revealed BOOLEAN NOT NULL DEFAULT FALSE,
  incoming_class TEXT,
  mod_ruling TEXT,
  mod_waid TEXT,
  ruled_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mods (
  waid TEXT PRIMARY KEY,
  added_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

async function initSchema() {
  await db.exec(SCHEMA);
}

module.exports = { db, initSchema, pool };
