const { hakiSubLevelFromPoints, rankTierFromXp, weaponClassFromPoints, styleClassFromPoints, conquerorsCoatingLevelFromPoints } = require("../rules/progression");
const { STAT_POOL_BY_TIER } = require("../rules/constants");

const TRACK_TYPES = ["weapon", "style", "conquerors"];

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

// ---------------------------------------------------------------------------
// Weapon / Style / Conqueror's Coating training tracks.
//
// Picking up a brand-new weapon category or Style is a mod/story-beat
// action ("Points can't be spent to start training a brand-new weapon
// category, Haki form, or Style from scratch" — Part 8), so track
// *creation* stays mod-only. Once a track exists, banking Points into it
// is the character's own call — same as Armament/Observation — and it's
// strictly additive: there is no route anywhere that subtracts or deletes
// a training_tracks row, so nothing banked here can ever be taken back.
// ---------------------------------------------------------------------------

async function createTrainingTrack(db, waid, trackType, trackName) {
  if (!TRACK_TYPES.includes(trackType)) {
    throw new Error(`trackType must be one of: ${TRACK_TYPES.join(", ")}`);
  }
  const char = await getCharacter(db, waid);
  if (!char) throw new Error("No character found for this player.");

  if (trackType === "conquerors") {
    if (!char.has_conquerors_haki) {
      throw new Error("This character doesn't have Conqueror's Haki — it's rolled once at creation and can't be trained into later.");
    }
    const existing = await db.get("SELECT * FROM training_tracks WHERE waid = ? AND track_type = 'conquerors'", [waid]);
    if (existing) return listTrainingTracks(db, waid); // already has the singleton track, no-op
    await db.run("INSERT INTO training_tracks (waid, track_type, track_name) VALUES (?, 'conquerors', NULL)", [waid]);
    return listTrainingTracks(db, waid);
  }

  if (!trackName || !trackName.trim()) {
    throw new Error(`Give the ${trackType} track a name (e.g. "Single-Blade", "Karate").`);
  }
  const dupe = await db.get(
    "SELECT * FROM training_tracks WHERE waid = ? AND track_type = ? AND LOWER(track_name) = LOWER(?)",
    [waid, trackType, trackName.trim()]
  );
  if (dupe) throw new Error(`${char.name} already has a ${trackType} track named "${trackName.trim()}".`);

  await db.run(
    "INSERT INTO training_tracks (waid, track_type, track_name) VALUES (?, ?, ?)",
    [waid, trackType, trackName.trim()]
  );
  return listTrainingTracks(db, waid);
}

async function listTrainingTracks(db, waid) {
  const char = await getCharacter(db, waid);
  if (!char) throw new Error("No character found for this player.");
  const rank = rankTierFromXp(char.rank_xp);
  const rows = await db.all("SELECT * FROM training_tracks WHERE waid = ? ORDER BY id", [waid]);

  return rows.map((row) => {
    let progress;
    if (row.track_type === "weapon") progress = weaponClassFromPoints(row.points_banked);
    else if (row.track_type === "style") progress = styleClassFromPoints(row.points_banked);
    else progress = conquerorsCoatingLevelFromPoints(row.points_banked, rank.tier);
    return { ...row, progress };
  });
}

async function allocateToTrainingTrack(db, waid, trackId, amount) {
  if (!amount || amount <= 0) throw new Error("Amount must be a positive number of Points.");
  const track = await db.get("SELECT * FROM training_tracks WHERE id = ? AND waid = ?", [trackId, waid]);
  if (!track) throw new Error("No such training track for this character.");
  const char = await getCharacter(db, waid);
  if (char.points_banked < amount) {
    throw new Error(`Only ${char.points_banked} unspent Points available, tried to allocate ${amount}.`);
  }

  await db.run("UPDATE characters SET points_banked = points_banked - ? WHERE waid = ?", [amount, waid]);
  await db.run(
    "INSERT INTO points_ledger (waid, amount, reason, allocated_to) VALUES (?, ?, 'allocation', ?)",
    [waid, -amount, `track:${trackId}`]
  );
  await db.run("UPDATE training_tracks SET points_banked = points_banked + ? WHERE id = ?", [amount, trackId]);

  return listTrainingTracks(db, waid);
}

// ---------------------------------------------------------------------------
// Stat Pool self-allocation. Same additive-only, permanent shape as above:
// a character (or the mod) can only ever ADD to str_alloc/def_alloc/spd_alloc
// through this route — capped at the Tier's Stat Pool total — never reduce
// or reallocate what's already been placed. The mod's PATCH endpoint still
// exists separately for outright corrections.
// ---------------------------------------------------------------------------

async function allocateStatPool(db, waid, { str = 0, def = 0, spd = 0 }) {
  const add = { str: Math.max(0, parseInt(str, 10) || 0), def: Math.max(0, parseInt(def, 10) || 0), spd: Math.max(0, parseInt(spd, 10) || 0) };
  const total = add.str + add.def + add.spd;
  if (total <= 0) throw new Error("Enter at least one positive STR/DEF/SPD point to add.");

  const char = await getCharacter(db, waid);
  if (!char) throw new Error("No character found for this player.");
  const rank = rankTierFromXp(char.rank_xp);
  const pool = STAT_POOL_BY_TIER[rank.tier];
  const alreadyAllocated = char.str_alloc + char.def_alloc + char.spd_alloc;
  if (alreadyAllocated + total > pool) {
    throw new Error(`Only ${pool - alreadyAllocated} unallocated Stat Pool points left at Tier ${rank.tier} (pool of ${pool}).`);
  }

  await db.run(
    "UPDATE characters SET str_alloc = str_alloc + ?, def_alloc = def_alloc + ?, spd_alloc = spd_alloc + ? WHERE waid = ?",
    [add.str, add.def, add.spd, waid]
  );
  return getCharacter(db, waid);
}

// ---------------------------------------------------------------------------
// Money (Berries). Mod-awarded only, same additive pattern as Points/Rank XP
// — there's no route that reduces or resets it, so it's a running total.
// ---------------------------------------------------------------------------

async function awardMoney(db, waid, amount, reason) {
  if (!amount) throw new Error("Amount is required.");
  await db.run("UPDATE characters SET money_banked = money_banked + ? WHERE waid = ?", [amount, waid]);
  const char = await getCharacter(db, waid);
  if (!char) throw new Error("No character found for this player.");
  return { moneyBanked: char.money_banked };
}

module.exports = {
  getCharacter,
  ensureCharacter,
  awardPoints,
  allocatePoints,
  getPointsSummary,
  createTrainingTrack,
  listTrainingTracks,
  allocateToTrainingTrack,
  allocateStatPool,
  awardMoney,
};
