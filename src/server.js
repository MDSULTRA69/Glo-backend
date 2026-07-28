require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { db, initSchema } = require("./db");
const training = require("./commands/training");
const deckCmd = require("./commands/deck");
const trapsCmd = require("./commands/traps");
const moveCmd = require("./commands/move");
const buffsCmd = require("./commands/buffs");
const { computeEffectiveStats } = require("./rules/stats");
const { RACE_TABLE } = require("./rules/constants");

const app = express();
app.use(cors());
app.use(express.json());

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

// NPC Moderator PIN — full access to all characters.
const MOD_PIN = process.env.MOD_PIN || "1677";

function isModRequest(req) {
  return req.header("x-mod-pin") === MOD_PIN;
}

function requireMod(req, res, next) {
  if (!isModRequest(req)) {
    return res.status(403).json({ error: "NPC moderator PIN required." });
  }
  next();
}

/**
 * Check whether the request carries a valid character-specific password for
 * the given waid. Returns true if it matches, false otherwise.
 */
async function requestHasCharacterAuth(req, waid) {
  const pw = req.header("x-char-password");
  if (!pw) return false;
  const char = await db.get("SELECT character_password FROM characters WHERE waid = ?", [waid]);
  if (!char || !char.character_password) return false;
  return char.character_password === pw;
}

/**
 * Middleware factory: allow the request if it's a mod OR carries the correct
 * character password for req.params.waid. Use this on any route that should be
 * visible to the character's own trusted battle moderator, but not to strangers.
 */
function requireModOrCharacterOwner(req, res, next) {
  if (isModRequest(req)) return next();
  const waid = req.params.waid;
  requestHasCharacterAuth(req, waid).then((ok) => {
    if (ok) return next();
    res.status(403).json({ error: "Requires NPC mod PIN or the character's personal password." });
  }).catch(() => res.status(500).json({ error: "Auth check failed." }));
}

function requestTouchesCharacter(body) {
  return !!(body.waid || body.defenderWaid || body.readerWaid || body.attackerWaid);
}

function requireModIfCharacterReferenced(req, res, next) {
  if (requestTouchesCharacter(req.body) && !isModRequest(req)) {
    return res.status(403).json({ error: "NPC moderator PIN required to reference a registered character." });
  }
  next();
}

// ---------------------------------------------------------------------------
// Password generation
// ---------------------------------------------------------------------------

function generatePassword() {
  // 8 lowercase alphanumeric characters, easy to share in a DM
  return crypto.randomBytes(5).toString("hex"); // e.g. "a3f9c2e1"
}

// ---------------------------------------------------------------------------

app.get("/health", (req, res) => res.json({ ok: true }));

// ---------- reference data (public) ----------

app.get("/api/races", wrap(async (req, res) => {
  res.json(RACE_TABLE);
}));

// ---------- characters ----------

// List all — mod only
app.get("/api/characters", requireMod, wrap(async (req, res) => {
  const rows = await db.all("SELECT * FROM characters ORDER BY faction NULLS LAST, created_at", []);
  res.json(rows);
}));

// Create — open; we auto-generate a character password on creation
app.post("/api/characters", wrap(async (req, res) => {
  const { waid, name } = req.body;
  if (!waid || !name) return res.status(400).json({ error: "waid and name are required" });
  const char = await training.ensureCharacter(db, waid, name);
  // Assign a password if not already set
  if (!char.character_password) {
    const pw = generatePassword();
    await db.run("UPDATE characters SET character_password = ? WHERE waid = ?", [pw, waid]);
    char.character_password = pw;
  }
  res.json(char);
}));

// Get single character — mod or character's own password
app.get("/api/characters/:waid", requireModOrCharacterOwner, wrap(async (req, res) => {
  const char = await training.getCharacter(db, req.params.waid);
  if (!char) return res.status(404).json({ error: "Not found" });
  const deck = await deckCmd.getDeck(db, req.params.waid);
  const summary = await training.getPointsSummary(db, req.params.waid);
  const buffs = await buffsCmd.listBuffs(db, req.params.waid);
  const effectiveStats = computeEffectiveStats(char, buffs);
  // Expose the password only to the NPC mod so they can share it with the player
  const isMod = isModRequest(req);
  const data = { ...char, deck, summary, buffs, effectiveStats };
  if (!isMod) delete data.character_password; // character-mode sees the sheet but not the raw PW
  res.json(data);
}));

// Patch — mod only
app.patch("/api/characters/:waid", requireMod, wrap(async (req, res) => {
  const allowed = ["name", "race", "faction", "hp_current", "has_devil_fruit", "devil_fruit_name",
    "has_conquerors_haki", "str_alloc", "def_alloc", "spd_alloc"];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (key in req.body) { sets.push(`${key} = ?`); params.push(req.body[key]); }
  }
  if (!sets.length) return res.json(await training.getCharacter(db, req.params.waid));
  params.push(req.params.waid);
  await db.run(`UPDATE characters SET ${sets.join(", ")} WHERE waid = ?`, params);
  res.json(await training.getCharacter(db, req.params.waid));
}));

// Delete — mod only
app.delete("/api/characters/:waid", requireMod, wrap(async (req, res) => {
  await db.run("DELETE FROM characters WHERE waid = ?", [req.params.waid]);
  res.json({ ok: true });
}));

// ---------- Character password management ----------

// Validate a character password (public — anyone can check, but only returns ok/fail)
app.post("/api/characters/:waid/check-password", wrap(async (req, res) => {
  const { password } = req.body;
  if (!password) return res.json({ ok: false });
  const char = await db.get("SELECT character_password FROM characters WHERE waid = ?", [req.params.waid]);
  if (!char || !char.character_password) return res.json({ ok: false });
  res.json({ ok: char.character_password === password });
}));

// Regenerate password — mod only
app.post("/api/characters/:waid/regenerate-password", requireMod, wrap(async (req, res) => {
  const pw = generatePassword();
  await db.run("UPDATE characters SET character_password = ? WHERE waid = ?", [pw, req.params.waid]);
  res.json({ character_password: pw });
}));

// Ensure existing characters get a password if they don't have one yet
app.post("/api/characters/:waid/ensure-password", requireMod, wrap(async (req, res) => {
  const char = await db.get("SELECT waid, character_password FROM characters WHERE waid = ?", [req.params.waid]);
  if (!char) return res.status(404).json({ error: "Not found" });
  if (char.character_password) return res.json({ character_password: char.character_password });
  const pw = generatePassword();
  await db.run("UPDATE characters SET character_password = ? WHERE waid = ?", [pw, char.waid]);
  res.json({ character_password: pw });
}));

// ---------- points / training ----------
// Awarding Points/Rank XP is the NPC moderator's job (that's the thing being
// handed out from outside the game). Allocating already-banked Points into
// Armament/Observation is the character's own choice — "leveling up" — so
// that's open to the character owner (their password) as well as the mod,
// which keeps that day-to-day busywork off the NPC.

app.post("/api/characters/:waid/award", requireMod, wrap(async (req, res) => {
  const { amount, reason } = req.body;
  const summary = await training.awardPoints(db, req.params.waid, amount, reason);
  res.json(summary);
}));

app.post("/api/characters/:waid/allocate", requireModOrCharacterOwner, wrap(async (req, res) => {
  const { amount, track } = req.body;
  const summary = await training.allocatePoints(db, req.params.waid, amount, track);
  res.json(summary);
}));

app.post("/api/characters/:waid/rankxp", requireMod, wrap(async (req, res) => {
  const { amount } = req.body;
  await db.run("UPDATE characters SET rank_xp = rank_xp + ? WHERE waid = ?", [amount, req.params.waid]);
  res.json(await training.getPointsSummary(db, req.params.waid));
}));

// ---------- bonus buffs (mod-gated) ----------

app.get("/api/characters/:waid/buffs", requireModOrCharacterOwner, wrap(async (req, res) => {
  res.json(await buffsCmd.listBuffs(db, req.params.waid));
}));

app.post("/api/characters/:waid/buffs", requireMod, wrap(async (req, res) => {
  res.json(await buffsCmd.addBuff(db, req.params.waid, req.body));
}));

app.delete("/api/characters/:waid/buffs/:buffId", requireMod, wrap(async (req, res) => {
  res.json(await buffsCmd.removeBuff(db, req.params.waid, parseInt(req.params.buffId, 10)));
}));

// ---------- deck (mod-gated for edits; character-pw for reads) ----------

app.post("/api/characters/:waid/deck", requireMod, wrap(async (req, res) => {
  const deck = await deckCmd.addMoveToDeck(db, req.params.waid, req.body);
  res.json(deck);
}));

app.delete("/api/characters/:waid/deck/:slot", requireMod, wrap(async (req, res) => {
  const deck = await deckCmd.removeMoveFromDeck(db, req.params.waid, parseInt(req.params.slot, 10));
  res.json(deck);
}));

app.post("/api/characters/:waid/deck/lock", requireMod, wrap(async (req, res) => {
  await deckCmd.lockDeck(db, req.params.waid, !!req.body.locked);
  res.json({ ok: true });
}));

// ---------- move / observation / trap calculators ----------

app.post("/api/move", requireModIfCharacterReferenced, wrap(async (req, res) => {
  const result = await moveCmd.resolveDeclaredMove(db, req.body.waid || null, req.body);
  res.json(result);
}));

// Combo: resolve multiple moves in sequence
app.post("/api/combo", requireModIfCharacterReferenced, wrap(async (req, res) => {
  const result = await moveCmd.resolveCombo(db, req.body.waid || null, req.body);
  res.json(result);
}));

app.post("/api/observation", requireModIfCharacterReferenced, wrap(async (req, res) => {
  const result = await moveCmd.resolveObservationRead(db, req.body);
  res.json(result);
}));

app.post("/api/trap-cost", wrap(async (req, res) => {
  const { characterTier, moveClass, coating, isDevilFruitMove } = req.body;
  res.json(moveCmd.previewTrapCost({ characterTier, moveClass, coating, isDevilFruitMove }));
}));

// ---------- traps ----------

app.post("/api/traps", wrap(async (req, res) => {
  const { waid, sparId, moveName, moveClass, coating, isDevilFruitMove } = req.body;
  const result = await trapsCmd.submitTrap(db, waid, sparId, { moveName, moveClass, coating, isDevilFruitMove });
  res.json(result);
}));

app.get("/api/traps", requireMod, wrap(async (req, res) => {
  const rows = await db.all("SELECT * FROM traps ORDER BY id", []);
  res.json(rows);
}));

app.post("/api/traps/:id/reveal", wrap(async (req, res) => {
  const result = await trapsCmd.revealTrap(db, parseInt(req.params.id, 10), req.body);
  res.json(result);
}));

app.post("/api/traps/:id/rule", requireMod, wrap(async (req, res) => {
  const { modWaid, ruling } = req.body;
  const trap = await trapsCmd.ruleOnTrap(db, parseInt(req.params.id, 10), modWaid, ruling);
  res.json(trap);
}));

// ---------- mod PIN check ----------

app.post("/api/mods/check", wrap(async (req, res) => {
  res.json({ isMod: req.body.pin === MOD_PIN });
}));

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Grand Line Online API listening on :${PORT}`));
  })
  .catch((e) => {
    console.error("Failed to initialize schema:", e);
    process.exit(1);
  });

module.exports = app;
