const test = require("node:test");
const assert = require("node:assert/strict");
const { makeTestDb } = require("./testDb");

const training = require("../src/commands/training");
const deckCmd = require("../src/commands/deck");
const trapsCmd = require("../src/commands/traps");
const moveCmd = require("../src/commands/move");
const buffsCmd = require("../src/commands/buffs");

test("full async lifecycle: create -> award -> allocate -> rank up -> deck -> move -> trap", async () => {
  const db = makeTestDb();
  const waid = "player-1";

  const char = await training.ensureCharacter(db, waid, "Test Kicker");
  assert.equal(char.name, "Test Kicker");

  await training.awardPoints(db, waid, 5000, "spar reward");
  let summary = await training.getPointsSummary(db, waid);
  assert.equal(summary.unspentPoints, 5000);

  await training.allocatePoints(db, waid, 1700, "armament");
  summary = await training.getPointsSummary(db, waid);
  assert.equal(summary.unspentPoints, 3300);
  assert.equal(summary.armament.currentLevel, "E2");

  await assert.rejects(() => training.allocatePoints(db, waid, 999999, "armament"));

  await db.run("UPDATE characters SET rank_xp = ? WHERE waid = ?", [100000, waid]);
  summary = await training.getPointsSummary(db, waid);
  assert.equal(summary.rank.tier, 2);

  await deckCmd.addMoveToDeck(db, waid, { slotNumber: 1, moveName: "Collier", moveType: "style", moveClass: "E" });
  await deckCmd.addMoveToDeck(db, waid, { slotNumber: 2, moveName: "Épaule Shot", moveType: "style", moveClass: "D" });
  await assert.rejects(() =>
    deckCmd.addMoveToDeck(db, waid, { slotNumber: 3, moveName: "Ifrit Jambe", moveType: "style", moveClass: "S" })
  );

  const deck = await deckCmd.getDeck(db, waid);
  assert.equal(deck.length, 2);

  const legal = await deckCmd.checkMoveLegal(db, waid, "Collier");
  assert.equal(legal.legal, true);

  await deckCmd.lockDeck(db, waid, true);
  await assert.rejects(() => deckCmd.removeMoveFromDeck(db, waid, 1));
  await deckCmd.lockDeck(db, waid, false);
  await deckCmd.removeMoveFromDeck(db, waid, 1);
  assert.equal((await deckCmd.getDeck(db, waid)).length, 1);

  await assert.rejects(() =>
    moveCmd.resolveDeclaredMove(db, waid, { moveName: "Light Slash", moveClass: "C", coating: "armament" })
  );

  await db.run("UPDATE characters SET rank_xp = ? WHERE waid = ?", [4000000, waid]);
  const result = await moveCmd.resolveDeclaredMove(db, waid, { moveName: "Light Slash", moveClass: "C", coating: "armament" });
  assert.equal(result.damage.finalDamage, 50);

  await trapsCmd.submitTrap(db, waid, 1, { moveName: "Guard Reversal", moveClass: "D" });
  await trapsCmd.submitTrap(db, waid, 1, { moveName: "Emergency Dodge", moveClass: "C" });
  await trapsCmd.submitTrap(db, waid, 1, { moveName: "Counter Slash", moveClass: "B" });
  await assert.rejects(() => trapsCmd.submitTrap(db, waid, 1, { moveName: "Fourth", moveClass: "E" }));

  const traps = await trapsCmd.listTraps(db, waid, 1);
  assert.equal(traps.length, 3);

  const revealResult = await trapsCmd.revealTrap(db, traps[0].id, { incomingMoveClass: "SS" });
  assert.equal(revealResult.needsModRuling, true);
  assert.equal(revealResult.plausibilityFlag.signal, "worth-a-second-look");

  await assert.rejects(() => trapsCmd.revealTrap(db, traps[0].id, { incomingMoveClass: "SS" }));

  const ruled = await trapsCmd.ruleOnTrap(db, traps[0].id, "mod-waid", "failed");
  assert.equal(ruled.mod_ruling, "failed");
});

test("submitting a trap computes and stores its Stamina cost from the class/coating tables", async () => {
  const db = makeTestDb();
  const waid = "trapper-1";
  await training.ensureCharacter(db, waid, "Trapper");
  await db.run("UPDATE characters SET rank_xp = 4000000 WHERE waid = ?", [waid]); // Tier 6

  const result = await trapsCmd.submitTrap(db, waid, 1, { moveName: "Rokuogan", moveClass: "SS", coating: "armament" });
  // Tier 6 SS base cost 30 (no discount, top class) + Haki surcharge 20 = 50
  assert.equal(result.staminaCost, 50);

  const [stored] = await trapsCmd.listTraps(db, waid, 1);
  assert.equal(stored.stamina_cost, 50);
});

test("bonus buffs (special spins) can be added, listed, and removed on a character", async () => {
  const db = makeTestDb();
  const waid = "spin-winner";
  await training.ensureCharacter(db, waid, "Spin Winner");

  const afterAdd = await buffsCmd.addBuff(db, waid, { label: "Special Spin — New Year Buff", str: 10, spd: 5 });
  assert.equal(afterAdd.length, 1);
  assert.equal(afterAdd[0].str, 10);

  const afterRemove = await buffsCmd.removeBuff(db, waid, afterAdd[0].id);
  assert.equal(afterRemove.length, 0);
});

test("move calculator pulls the defender's effective DEF when a defenderWaid is given", async () => {
  const db = makeTestDb();
  const attackerWaid = "atk-1", defenderWaid = "def-1";
  await training.ensureCharacter(db, attackerWaid, "Attacker");
  await training.ensureCharacter(db, defenderWaid, "Defender");
  await db.run("UPDATE characters SET rank_xp = 25000, str_alloc = 5 WHERE waid = ?", [attackerWaid]);
  await db.run("UPDATE characters SET rank_xp = 25000, def_alloc = 4 WHERE waid = ?", [defenderWaid]);

  const result = await moveCmd.resolveDeclaredMove(db, attackerWaid, {
    moveName: "Jab", moveClass: "E", defenderWaid,
  });
  // 10 hit-count + 5 STR - 4 DEF = 11
  assert.equal(result.damage.finalDamage, 11);
  assert.equal(result.defenderName, "Defender");
});

test("move calculator works with manualTier and no character (public calculator use)", async () => {
  const db = makeTestDb();
  const result = await moveCmd.resolveDeclaredMove(db, null, {
    moveName: "Homebrew Move", moveClass: "S", coating: "conquerors", manualTier: 6,
  });
  assert.equal(result.damage.finalDamage, 60 + 35);
});

test("gatling cap enforced through the async layer", async () => {
  const db = makeTestDb();
  const waid = "gatling-guy";
  await training.ensureCharacter(db, waid, "Gatling Gary");
  await db.run("UPDATE characters SET rank_xp = 25000 WHERE waid = ?", [waid]);
  const result = await moveCmd.resolveDeclaredMove(db, waid, {
    moveName: "Gomu Gomu no Gatling", moveClass: "E", isGatling: true, requestedHits: 20,
  });
  assert.equal(result.gatling.cap, 3);
  assert.equal(result.gatling.allowedHits, 3);
});

// ---------- Weapon / Style / Conqueror's Coating training tracks ----------

test("a mod can create a weapon training track and the character can bank Points into it", async () => {
  const db = makeTestDb();
  const waid = "swordsman-1";
  await training.ensureCharacter(db, waid, "Swordsman");
  await training.awardPoints(db, waid, 10000, "test award");

  const tracks = await training.createTrainingTrack(db, waid, "weapon", "Single-Blade");
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].track_type, "weapon");
  assert.equal(tracks[0].progress.currentLevel, "E");

  const afterAlloc = await training.allocateToTrainingTrack(db, waid, tracks[0].id, 3000);
  assert.equal(afterAlloc[0].points_banked, 3000);
  assert.equal(afterAlloc[0].progress.currentLevel, "D"); // E->D costs exactly 3000

  const char = await training.getCharacter(db, waid);
  assert.equal(char.points_banked, 7000); // 10000 - 3000 spent
});

test("style training uses the cheaper style curve, not the weapon curve", async () => {
  const db = makeTestDb();
  const waid = "stylist-1";
  await training.ensureCharacter(db, waid, "Stylist");
  await training.awardPoints(db, waid, 5000, "test award");
  const tracks = await training.createTrainingTrack(db, waid, "style", "Karate");
  const afterAlloc = await training.allocateToTrainingTrack(db, waid, tracks[0].id, 2500);
  assert.equal(afterAlloc[0].progress.currentLevel, "D"); // Style E->D only costs 2500, cheaper than weapon's 3000
});

test("allocating more Points than are banked into a training track fails", async () => {
  const db = makeTestDb();
  const waid = "poor-1";
  await training.ensureCharacter(db, waid, "Poor Guy");
  await training.awardPoints(db, waid, 100, "test award");
  const tracks = await training.createTrainingTrack(db, waid, "weapon", "Firearms");
  await assert.rejects(() => training.allocateToTrainingTrack(db, waid, tracks[0].id, 5000));
});

test("training tracks are append-only — there is no function that removes Points or deletes a track", () => {
  assert.equal(training.removeTrainingTrack, undefined);
  assert.equal(training.deallocateFromTrainingTrack, undefined);
});

test("conqueror's coating track requires the character to actually have Conqueror's Haki", async () => {
  const db = makeTestDb();
  const waid = "no-conq-1";
  await training.ensureCharacter(db, waid, "No Conqueror");
  await assert.rejects(() => training.createTrainingTrack(db, waid, "conquerors", null));
});

test("conqueror's coating unlocks A-class only once BOTH Points and Rank Tier gates clear", async () => {
  const db = makeTestDb();
  const waid = "conq-1";
  await training.ensureCharacter(db, waid, "Conqueror");
  await db.run("UPDATE characters SET has_conquerors_haki = ? WHERE waid = ?", [true, waid]);
  await training.awardPoints(db, waid, 20000, "test award");
  const tracks = await training.createTrainingTrack(db, waid, "conquerors", null);

  // Enough Points, but still Tier 1 — should NOT unlock (Tier 5 required)
  const stillLocked = await training.allocateToTrainingTrack(db, waid, tracks[0].id, 15000);
  assert.equal(stillLocked[0].progress.currentLevel, "Locked");
  assert.equal(stillLocked[0].progress.blockedByTier, 5);

  // Now bump Rank Tier to 5 and re-check
  await db.run("UPDATE characters SET rank_xp = 2000000 WHERE waid = ?", [waid]);
  const tracksNow = await training.listTrainingTracks(db, waid);
  assert.equal(tracksNow[0].progress.currentLevel, "A-class");
});

// ---------- Stat Pool self-allocation ----------

test("stat pool self-allocation is additive and capped at the Tier's pool", async () => {
  const db = makeTestDb();
  const waid = "stat-1";
  await training.ensureCharacter(db, waid, "Stat Guy"); // Tier 1, pool of 15
  await training.allocateStatPool(db, waid, { str: 10, def: 5, spd: 0 });
  let char = await training.getCharacter(db, waid);
  assert.equal(char.str_alloc, 10);
  assert.equal(char.def_alloc, 5);

  // A second call ADDS on top rather than overwriting
  await training.allocateStatPool(db, waid, { str: 0, def: 0, spd: 0 }).catch(() => {}); // no-op, all zero
  await assert.rejects(() => training.allocateStatPool(db, waid, { str: 1, def: 0, spd: 0 })); // 15/15 already allocated
  char = await training.getCharacter(db, waid);
  assert.equal(char.str_alloc + char.def_alloc + char.spd_alloc, 15);
});

test("stat pool self-allocation has no removal function — additions are permanent", () => {
  assert.equal(training.deallocateStatPool, undefined);
});

// ---------- Money (Berries) ----------

test("mod can award Berries and the balance only ever goes up", async () => {
  const db = makeTestDb();
  const waid = "rich-1";
  await training.ensureCharacter(db, waid, "Rich Guy");
  await training.awardMoney(db, waid, 8000, "real battle, Tier 1");
  await training.awardMoney(db, waid, 5000, "bounty payout");
  const char = await training.getCharacter(db, waid);
  assert.equal(char.money_banked, 13000);
});
