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
