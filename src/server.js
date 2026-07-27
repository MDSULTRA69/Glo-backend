require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { db, initSchema } = require("./db");
const training = require("./commands/training");
const deckCmd = require("./commands/deck");
const trapsCmd = require("./commands/traps");
const moveCmd = require("./commands/move");

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

app.get("/health", (req, res) => res.json({ ok: true }));

// ---------- characters ----------

app.get("/api/characters", wrap(async (req, res) => {
  const rows = await db.all("SELECT * FROM characters ORDER BY created_at", []);
  res.json(rows);
}));

app.post("/api/characters", wrap(async (req, res) => {
  const { waid, name } = req.body;
  if (!waid || !name) return res.status(400).json({ error: "waid and name are required" });
  const char = await training.ensureCharacter(db, waid, name);
  res.json(char);
}));

app.get("/api/characters/:waid", wrap(async (req, res) => {
  const char = await training.getCharacter(db, req.params.waid);
  if (!char) return res.status(404).json({ error: "Not found" });
  const deck = await deckCmd.getDeck(db, req.params.waid);
  const summary = await training.getPointsSummary(db, req.params.waid);
  res.json({ ...char, deck, summary });
}));

app.patch("/api/characters/:waid", wrap(async (req, res) => {
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

app.delete("/api/characters/:waid", wrap(async (req, res) => {
  await db.run("DELETE FROM characters WHERE waid = ?", [req.params.waid]);
  res.json({ ok: true });
}));

// ---------- points / training (mod-gated at the frontend layer) ----------

app.post("/api/characters/:waid/award", wrap(async (req, res) => {
  const { amount, reason } = req.body;
  const summary = await training.awardPoints(db, req.params.waid, amount, reason);
  res.json(summary);
}));

app.post("/api/characters/:waid/allocate", wrap(async (req, res) => {
  const { amount, track } = req.body;
  const summary = await training.allocatePoints(db, req.params.waid, amount, track);
  res.json(summary);
}));

app.post("/api/characters/:waid/rankxp", wrap(async (req, res) => {
  const { amount } = req.body;
  await db.run("UPDATE characters SET rank_xp = rank_xp + ? WHERE waid = ?", [amount, req.params.waid]);
  res.json(await training.getPointsSummary(db, req.params.waid));
}));

// ---------- deck ----------

app.post("/api/characters/:waid/deck", wrap(async (req, res) => {
  const deck = await deckCmd.addMoveToDeck(db, req.params.waid, req.body);
  res.json(deck);
}));

app.delete("/api/characters/:waid/deck/:slot", wrap(async (req, res) => {
  const deck = await deckCmd.removeMoveFromDeck(db, req.params.waid, parseInt(req.params.slot, 10));
  res.json(deck);
}));

app.post("/api/characters/:waid/deck/lock", wrap(async (req, res) => {
  await deckCmd.lockDeck(db, req.params.waid, !!req.body.locked);
  res.json({ ok: true });
}));

// ---------- move calculator ----------

app.post("/api/move", wrap(async (req, res) => {
  const result = await moveCmd.resolveDeclaredMove(db, req.body.waid || null, req.body);
  res.json(result);
}));

// ---------- traps ----------

app.post("/api/traps", wrap(async (req, res) => {
  const { waid, sparId, moveName, moveClass } = req.body;
  const count = await trapsCmd.submitTrap(db, waid, sparId, { moveName, moveClass });
  res.json({ count });
}));

app.get("/api/traps", wrap(async (req, res) => {
  const rows = await db.all("SELECT * FROM traps ORDER BY id", []);
  res.json(rows);
}));

app.post("/api/traps/:id/reveal", wrap(async (req, res) => {
  const result = await trapsCmd.revealTrap(db, parseInt(req.params.id, 10), req.body);
  res.json(result);
}));

app.post("/api/traps/:id/rule", wrap(async (req, res) => {
  const { modWaid, ruling } = req.body;
  const trap = await trapsCmd.ruleOnTrap(db, parseInt(req.params.id, 10), modWaid, ruling);
  res.json(trap);
}));

// ---------- mods ----------
// Reuses the `mods` table as a simple shared-PIN store: whatever string
// the first person sets is stored as the "waid" value, and anyone who
// later submits the same string is treated as a mod. This is NOT real
// per-person auth — it's one shared PIN for the whole group, same as
// the artifact version. Good enough for a trusted friend group, not a
// substitute for real accounts if that ever matters.

app.post("/api/mods/check", wrap(async (req, res) => {
  const row = await db.get("SELECT 1 as x FROM mods WHERE waid = ?", [req.body.pin]);
  res.json({ isMod: !!row });
}));

app.post("/api/mods/set-pin", wrap(async (req, res) => {
  const existing = await db.get("SELECT 1 as x FROM mods LIMIT 1", []);
  if (existing) return res.status(400).json({ error: "PIN already set" });
  await db.run("INSERT INTO mods (waid) VALUES (?)", [req.body.pin]);
  res.json({ ok: true });
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
