const test = require("node:test");
const assert = require("node:assert/strict");

const { computeStaminaCost, tierDiscountFraction, observationReadSucceeds } = require("../src/rules/stamina");
const { resolveMoveDamage, checkGatlingLimit } = require("../src/rules/damage");
const { hakiSubLevelFromPoints, rankTierFromXp } = require("../src/rules/progression");
const { raceBonus, sumBuffs, computeEffectiveStats } = require("../src/rules/stats");
const C = require("../src/rules/constants");

// ---------- rules/stats.js: race table + bonus buffs ----------

test("every race in the Guidebook Section 2 table is present", () => {
  const expected = [
    "Human", "Fishman", "Merfolk", "Giant", "Mink", "Skypiean",
    "Long-Arm / Long-Leg Tribe", "Three-Eye Clan", "Celestial Dragon",
    "Snakeneck Tribe", "Tontatta Dwarf", "Kuja Tribe", "Lunarian",
  ];
  for (const name of expected) assert.ok(C.RACE_TABLE[name], `Missing race: ${name}`);
  assert.equal(Object.keys(C.RACE_TABLE).length, expected.length);
});

test("race bonus spot checks against the source table", () => {
  assert.deepEqual(
    { hp: C.RACE_TABLE.Giant.hp, str: C.RACE_TABLE.Giant.str, def: C.RACE_TABLE.Giant.def, spd: C.RACE_TABLE.Giant.spd },
    { hp: 50, str: 25, def: 15, spd: -15 }
  );
  assert.equal(C.RACE_TABLE["Three-Eye Clan"].hakiAffinityPct, 25);
  assert.equal(C.RACE_TABLE.Mink.hakiAffinityPct, 10);
});

test("fishman/merfolk SPD swaps to the water value when inWater is true", () => {
  const land = raceBonus("Fishman", { inWater: false });
  const water = raceBonus("Fishman", { inWater: true });
  assert.equal(land.spd, -5);
  assert.equal(water.spd, 15);
});

test("unknown/unset race resolves to all-zero bonuses instead of throwing", () => {
  const r = raceBonus(undefined);
  assert.equal(r.known, false);
  assert.equal(r.str, 0);
});

test("bonus buffs (special spins) sum and stack with race + pool", () => {
  const char = { race: "Human", str_alloc: 10, def_alloc: 5, spd_alloc: 0 };
  const buffs = [
    { str: 5, def: 0, spd: 3, hp: 0, haki_affinity_pct: 0 },
    { str: 2, def: 1, spd: 0, hp: 10, haki_affinity_pct: 5 },
  ];
  const stats = computeEffectiveStats(char, buffs);
  assert.equal(stats.str, 10 + 0 + 5 + 2); // pool + race(0) + buffs
  assert.equal(stats.def, 5 + 0 + 0 + 1);
  assert.equal(stats.spd, 0 + 0 + 3 + 0);
  assert.equal(stats.hp, 100 + 0 + 10);
  assert.equal(stats.hakiAffinityPct, 0 + 5);
});

test("effective stats fold in a real race's bonuses", () => {
  const char = { race: "Lunarian", str_alloc: 20, def_alloc: 20, spd_alloc: 20 };
  const stats = computeEffectiveStats(char, []);
  assert.equal(stats.str, 20 + 20);
  assert.equal(stats.def, 20 + 25);
  assert.equal(stats.spd, 20 + 10);
  assert.equal(stats.hp, 100 + 20);
});

test("tier discount: gap 0 = no discount", () => {
  assert.equal(tierDiscountFraction(1, "E"), 0);
  assert.equal(tierDiscountFraction(6, "S"), 0);
  assert.equal(tierDiscountFraction(6, "SS"), 0);
});

test("tier discount: caps at 50% even for a 5-tier gap", () => {
  assert.equal(tierDiscountFraction(6, "E"), 0.5);
});

test("tier discount table matches the worked-out example from the design chat", () => {
  // Tier 6 character using each class, from the table the user confirmed
  const cases = [
    ["E", 2], ["D", 4], ["C", 8], ["B", 12], ["A", 18], ["S", 25], ["SS", 30],
  ];
  for (const [cls, expected] of cases) {
    const { total } = computeStaminaCost({ characterTier: 6, moveClass: cls, priorMovesThrown: 0 });
    assert.equal(total, expected, `Tier 6 using ${cls} should cost ${expected}, got ${total}`);
  }
});

test("tier discount table: Tier 4 spot checks", () => {
  const cases = [["E", 3], ["D", 6], ["C", 10], ["B", 16]];
  for (const [cls, expected] of cases) {
    const { total } = computeStaminaCost({ characterTier: 4, moveClass: cls });
    assert.equal(total, expected);
  }
});

test("fatigue surcharge stacks +2 per prior move", () => {
  const { total: first } = computeStaminaCost({ characterTier: 1, moveClass: "E", priorMovesThrown: 0 });
  const { total: sixth } = computeStaminaCost({ characterTier: 1, moveClass: "E", priorMovesThrown: 5 });
  assert.equal(first, 5);
  assert.equal(sixth, 5 + 5 * 2); // matches the "6 E-moves = exactly 60" Tier 1 pool design
});

test("six E-class moves at Tier 1 exactly drain the Tier 1 Stamina pool", () => {
  let totalSpent = 0;
  for (let i = 0; i < 6; i++) {
    totalSpent += computeStaminaCost({ characterTier: 1, moveClass: "E", priorMovesThrown: i }).total;
  }
  assert.equal(totalSpent, C.STAMINA_POOL_BY_TIER[1]);
});

test("armament coating adds the Haki surcharge on top of base+fatigue", () => {
  const { total, breakdown } = computeStaminaCost({
    characterTier: 6, moveClass: "S", coating: "armament",
  });
  assert.equal(breakdown.hakiSurcharge, 20);
  assert.equal(total, 25 + 20);
});

test("conqueror's coating throws below Tier 5", () => {
  assert.throws(() => computeStaminaCost({ characterTier: 4, moveClass: "B", coating: "conquerors" }));
});

test("conqueror's coating adds both haki + conqueror's surcharge at Tier 6", () => {
  const { total, breakdown } = computeStaminaCost({
    characterTier: 6, moveClass: "S", coating: "conquerors",
  });
  assert.equal(breakdown.hakiSurcharge, 20);
  assert.equal(breakdown.conquerorsAddl, 12);
  assert.equal(total, 25 + 20 + 12);
});

test("devil fruit surcharge applies only when flagged", () => {
  const withDf = computeStaminaCost({ characterTier: 3, moveClass: "C", isDevilFruitMove: true });
  const withoutDf = computeStaminaCost({ characterTier: 3, moveClass: "C", isDevilFruitMove: false });
  assert.equal(withDf.total - withoutDf.total, 10);
});

// ---------- damage.js: the "Light Slash, C-rank, homebrew move" case ----------

test("homebrew move resolves purely from declared class - Light Slash example", () => {
  // Light Slash, C-rank, Tier 6 character, Armament coated. Doesn't exist
  // in any table — should resolve exactly like any other C-class move.
  const { finalDamage, breakdown } = resolveMoveDamage({
    moveClass: "C",
    characterTier: 6,
    coating: "armament",
  });
  assert.equal(breakdown.hitCountDamage, 30);
  assert.equal(breakdown.coatingBonus, 20);
  assert.equal(finalDamage, 50);
});

test("homebrew move with conqueror's coating instead", () => {
  const { finalDamage, breakdown } = resolveMoveDamage({
    moveClass: "C",
    characterTier: 6,
    coating: "conquerors",
  });
  assert.equal(breakdown.coatingBonus, 35);
  assert.equal(finalDamage, 65);
});

test("move above character's tier is illegal", () => {
  assert.throws(() => resolveMoveDamage({ moveClass: "S", characterTier: 3, coating: "none" }));
});

test("guard halves damage, dodge-failed does not reduce it", () => {
  const guarded = resolveMoveDamage({ moveClass: "E", characterTier: 1, defenderReaction: "guard" });
  const dodgeFailed = resolveMoveDamage({ moveClass: "E", characterTier: 1, defenderReaction: "dodge-failed" });
  assert.equal(guarded.finalDamage, 5);
  assert.equal(dodgeFailed.finalDamage, 10);
});

test("attacker STR adds flat to damage, defender DEF subtracts flat, before Guard/Dodge", () => {
  const r = resolveMoveDamage({ moveClass: "E", characterTier: 1, attackerStr: 8, defenderDef: 3 });
  // 10 hit-count + 8 STR - 3 DEF = 15
  assert.equal(r.finalDamage, 15);
  assert.equal(r.breakdown.afterDef, 15);
});

test("defender DEF cannot push damage below zero", () => {
  const r = resolveMoveDamage({ moveClass: "E", characterTier: 1, attackerStr: 0, defenderDef: 999 });
  assert.equal(r.finalDamage, 0);
});

test("dodge-success reaction zeroes damage explicitly", () => {
  const r = resolveMoveDamage({ moveClass: "A", characterTier: 5, defenderReaction: "dodge-success" });
  assert.equal(r.finalDamage, 0);
  assert.equal(r.breakdown.reactionNote, "Dodge succeeded — no damage");
});

test("devil fruit clone deals exactly half damage", () => {
  const normal = resolveMoveDamage({ moveClass: "B", characterTier: 4, coating: "none" });
  const clone = resolveMoveDamage({ moveClass: "B", characterTier: 4, coating: "none", isClone: true });
  assert.equal(clone.finalDamage, Math.floor(normal.finalDamage / 2));
});

test("interpolated tiers 1-2 are flagged in the response", () => {
  const t1 = resolveMoveDamage({ moveClass: "E", characterTier: 1, coating: "armament" });
  const t3 = resolveMoveDamage({ moveClass: "C", characterTier: 3, coating: "armament" });
  assert.ok(t1.breakdown.coatingNote, "Tier 1 should carry an interpolation warning");
  assert.equal(t3.breakdown.coatingNote, null, "Tier 3 is from the real table, no warning expected");
});

test("gatling cap enforces the tier table and reports capping", () => {
  const r1 = checkGatlingLimit({ characterTier: 1, requestedHits: 10 });
  assert.equal(r1.cap, 3);
  assert.equal(r1.allowedHits, 3);
  assert.equal(r1.wasCapped, true);

  const r6 = checkGatlingLimit({ characterTier: 6, requestedHits: 13 });
  assert.equal(r6.wasCapped, false);
  assert.equal(r6.allowedHits, 13);
});

// ---------- progression.js ----------

test("haki sub-level tracks armament points and reports next threshold", () => {
  const result = hakiSubLevelFromPoints("armament", 1700);
  assert.equal(result.currentLevel, "E2");
  assert.equal(result.nextLevel, "E3");
  assert.equal(result.pointsToNextLevel, 1700);
});

test("haki sub-level: observation costs 1.5x armament at the same jump", () => {
  const jump = C.HAKI_SUBLEVEL_JUMPS[0];
  assert.equal(jump.observation, Math.round(jump.armament * 1.5));
});

test("rank tier from XP matches the guidebook thresholds", () => {
  assert.equal(rankTierFromXp(0).tier, 1);
  assert.equal(rankTierFromXp(24999).tier, 1);
  assert.equal(rankTierFromXp(25000).tier, 1); // Tier 1's own threshold, not a jump
  assert.equal(rankTierFromXp(99999).tier, 1);
  assert.equal(rankTierFromXp(100000).tier, 2); // Tier 2 needs 100,000, not 25,000
  assert.equal(rankTierFromXp(4000000).tier, 6);
  assert.equal(rankTierFromXp(4000000).nextTier, null);
});

// ---------- observation read gate ----------

test("observation read succeeds/fails based on SPD threshold", () => {
  // E1 sub-level (index 0): needs reader SPD >= 50% of attacker SPD
  const ok = observationReadSucceeds({ readerSpd: 50, attackerSpd: 100, observationSubLevelIndex: 0 });
  const fail = observationReadSucceeds({ readerSpd: 49, attackerSpd: 100, observationSubLevelIndex: 0 });
  assert.equal(ok, true);
  assert.equal(fail, false);
});

test("observation read cost is a percentage of the attack's own stamina cost", () => {
  // S3 sub-level (index 17): cost = 33% of the attack's cost
  const result = computeStaminaCost({
    characterTier: 6,
    moveClass: "S",
    isObservationRead: true,
    observationSubLevelIndex: 17,
  });
  // S-class at Tier 6 costs 25 normally; 33% of 25 = 8.25 -> floor 8
  assert.equal(result.total, 8);
});
