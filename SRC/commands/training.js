const { hakiSubLevelFromPoints, rankTierFromXp } = require("../rules/progression");

async function getCharacter(db, waid) {
  return db.get("SELECT * FROM characters WHERE waid = ?", [waid]);
}

async function ensureCharacter(db, waid, name) {
  const existing = await getCharacter(db, waid);
  if (existing) return existing;
  await db.run("INSERT INTO characters (waid, name) VALUES (?, ?)", [waid, name]);
  return getCharacter(db, waid);
}

async function awardPoints(db, waid, amount, reason) {
  await db.run(
    "INSERT INTO points_ledger (waid, amount, reason, allocated_to) VALUES (?, ?, ?, 'unspent')",
    [waid, amount, reason || null]
  );
  await db.run("UPDATE characters SET points_banked = points_banked + ? WHERE waid = ?", [amount, waid]);
  return getPointsSummary(db, waid);
}

async function allocatePoints(db, waid, amount, track) {
  const char = await getCharacter(db, waid);
  if (!char) throw new Error("No character found for this player.");
  if (char.points_banked < amount) {
    throw new Error(`Only ${char.points_banked} unspent Points available, tried to allocate ${amount}.`);
  }

  await db.run("UPDATE characters SET points_banked = points_banked - ? WHERE waid = ?", [amount, waid]);
  await db.run(
    "INSERT INTO points_ledger (waid, amount, reason, allocated_to) VALUES (?, ?, 'allocation', ?)",
    [waid, -amount, track]
  );

  if (track === "armament") {
    await db.run("UPDATE characters SET points_armament = points_armament + ? WHERE waid = ?", [amount, waid]);
  } else if (track === "observation") {
    await db.run("UPDATE characters SET points_observation = points_observation + ? WHERE waid = ?", [amount, waid]);
  }

  return getPointsSummary(db, waid);
}

async function getPointsSummary(db, waid) {
  const char = await getCharacter(db, waid);
  if (!char) throw new Error("No character found for this player.");

  const rank = rankTierFromXp(char.rank_xp);
  const armament = hakiSubLevelFromPoints("armament", char.points_armament);
  const observation = hakiSubLevelFromPoints("observation", char.points_observation);

  return { name: char.name, unspentPoints: char.points_banked, rank, armament, observation };
}

module.exports = { getCharacter, ensureCharacter, awardPoints, allocatePoints, getPointsSummary };
