async function listBuffs(db, waid) {
  return db.all("SELECT * FROM bonus_buffs WHERE waid = ? ORDER BY id", [waid]);
}

async function addBuff(db, waid, { label, hp = 0, str = 0, def = 0, spd = 0, hakiAffinityPct = 0, source = null }) {
  if (!label || !label.trim()) throw new Error("Buff needs a label (e.g. 'Special Spin — New Year Buff').");
  const char = await db.get("SELECT * FROM characters WHERE waid = ?", [waid]);
  if (!char) throw new Error("No character found for this player.");
  await db.run(
    "INSERT INTO bonus_buffs (waid, label, hp, str, def, spd, haki_affinity_pct, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [waid, label.trim(), hp, str, def, spd, hakiAffinityPct, source]
  );
  return listBuffs(db, waid);
}

async function removeBuff(db, waid, buffId) {
  await db.run("DELETE FROM bonus_buffs WHERE waid = ? AND id = ?", [waid, buffId]);
  return listBuffs(db, waid);
}

module.exports = { listBuffs, addBuff, removeBuff };
