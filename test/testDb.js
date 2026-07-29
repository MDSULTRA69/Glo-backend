// Test-only. Production (src/db.js) talks to real Postgres via `pg`,
// which needs network access to install here. This uses Node's built-in
// node:sqlite to validate the actual query logic and business rules in
// src/commands/*, wrapped to match db.js's async get/all/run interface
// exactly so the command files under test are byte-identical to production.
const { DatabaseSync } = require("node:sqlite");

function makeTestDb() {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE characters (
      waid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      race TEXT, faction TEXT,
      rank_xp INTEGER NOT NULL DEFAULT 0,
      points_banked INTEGER NOT NULL DEFAULT 0,
      points_armament INTEGER NOT NULL DEFAULT 0,
      points_observation INTEGER NOT NULL DEFAULT 0,
      str_alloc INTEGER NOT NULL DEFAULT 0, def_alloc INTEGER NOT NULL DEFAULT 0, spd_alloc INTEGER NOT NULL DEFAULT 0,
      hp_current INTEGER NOT NULL DEFAULT 100,
      has_devil_fruit INTEGER NOT NULL DEFAULT 0, devil_fruit_name TEXT,
      has_conquerors_haki INTEGER NOT NULL DEFAULT 0,
      unique_stat TEXT, unique_bonus INTEGER NOT NULL DEFAULT 0,
      character_password TEXT,
      money_banked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE training_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waid TEXT NOT NULL, track_type TEXT NOT NULL, track_name TEXT,
      points_banked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deck_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waid TEXT NOT NULL, slot_number INTEGER NOT NULL,
      move_name TEXT NOT NULL, move_type TEXT NOT NULL, move_class TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(waid, slot_number)
    );
    CREATE TABLE points_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waid TEXT NOT NULL, amount INTEGER NOT NULL, reason TEXT, allocated_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE traps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waid TEXT NOT NULL, spar_id INTEGER, move_name TEXT NOT NULL, move_class TEXT NOT NULL,
      coating TEXT NOT NULL DEFAULT 'none', is_devil_fruit_move INTEGER NOT NULL DEFAULT 0,
      stamina_cost INTEGER,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      revealed INTEGER NOT NULL DEFAULT 0, incoming_class TEXT,
      mod_ruling TEXT, mod_waid TEXT, ruled_at TEXT
    );
    CREATE TABLE bonus_buffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waid TEXT NOT NULL, label TEXT NOT NULL,
      hp INTEGER NOT NULL DEFAULT 0, str INTEGER NOT NULL DEFAULT 0,
      def INTEGER NOT NULL DEFAULT 0, spd INTEGER NOT NULL DEFAULT 0,
      haki_affinity_pct INTEGER NOT NULL DEFAULT 0, source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return {
    async get(sql, params = []) {
      const coercedParams = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
      return raw.prepare(sql).get(...coercedParams) || null;
    },
    async all(sql, params = []) {
      const coercedParams = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
      return raw.prepare(sql).all(...coercedParams);
    },
    async run(sql, params = []) {
      // node:sqlite doesn't understand NOW() (Postgres) — swap for datetime('now').
      // It also has no native boolean type, unlike Postgres — coerce bound
      // JS booleans to 0/1 (production db.js talks to real Postgres, which
      // accepts real booleans directly, so this coercion is test-only).
      const adapted = sql.replace(/NOW\(\)/g, "datetime('now')").replace(/TRUE/g, "1").replace(/FALSE/g, "0");
      const coercedParams = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
      const info = raw.prepare(adapted).run(...coercedParams);
      return { rowCount: info.changes, rows: [] };
    },
  };
}

module.exports = { makeTestDb };
