// All numbers here are transcribed directly from:
//   - Devil_Fruits_Fighting_Styles_Weapons (companion guide) Parts 6, 7, 8, 10
//   - Grand Line Online Guidebook, Sections 2, 6, 8
//
// Two values are marked INTERPOLATED below because the source table
// (Part 6) only defines Standard Armament Flat Bonus starting at Tier 3 —
// Tier 1 and Tier 2 were never written down anywhere. They're filled in
// here following the same ~30%-of-hit-count-damage ratio the documented
// tiers already follow (C:10/30=33%, B:12/40=30%, A:15/50=30%, S:20/60=33%).
// Flag this to the group and get a real ruling whenever convenient —
// swap the two numbers in ARMAMENT_FLAT_BONUS below and everything
// downstream updates automatically.

const CLASSES = ["E", "D", "C", "B", "A", "S", "SS"];

// Class -> numeric index, used for tier-gap math (tier-discount, gatling
// caps, etc). S and SS share index 6 because both unlock at Tier 6 and
// neither is "below" the other for discount purposes.
const CLASS_INDEX = { E: 1, D: 2, C: 3, B: 4, A: 5, S: 6, SS: 6 };

// Tier -> top class unlocked at that tier.
const TIER_TOP_CLASS = { 1: "E", 2: "D", 3: "C", 4: "B", 5: "A", 6: "S" }; // SS also unlocks at 6

const BASE_MOVE_COST = { E: 5, D: 8, C: 12, B: 16, A: 20, S: 25, SS: 30 };

const HIT_COUNT_DAMAGE = { E: 10, D: 20, C: 30, B: 40, A: 50, S: 60, SS: 70 };

const STAMINA_POOL_BY_TIER = { 1: 60, 2: 78, 3: 102, 4: 126, 5: 150, 6: 180 };

const STAT_POOL_BY_TIER = { 1: 15, 2: 30, 3: 50, 4: 75, 5: 105, 6: 140 };

// Cumulative Rank XP thresholds (Guidebook Section 6). "XP thresholds are
// shared system-wide" per the source text, read as: at 25,000 XP you're
// Tier 1/E, at 100,000 you're Tier 2/D, etc. The table doesn't explicitly
// say what a brand-new 0-XP character is — progression.js treats Tier 1
// as the default floor for anyone below 25,000 rather than leaving new
// characters rank-less, since otherwise nobody could start playing.
// Worth confirming with the person running the game.
const RANK_XP_REQUIRED = {
  1: 25000,
  2: 100000,
  3: 400000,
  4: 1000000,
  5: 2000000,
  6: 4000000,
};

const FATIGUE_SURCHARGE_PER_PRIOR_MOVE = 2;

const HAKI_SURCHARGE_BY_TIER = { 1: 3, 2: 5, 3: 8, 4: 12, 5: 16, 6: 20 };
const CONQUERORS_COATING_SURCHARGE_ADDL = { 5: 8, 6: 12 }; // only tiers 5-6, additive on top of Haki Surcharge

const DEVIL_FRUIT_SURCHARGE_BY_TIER = { 1: 4, 2: 6, 3: 10, 4: 14, 5: 18, 6: 24 };

// Standard Armament Flat Bonus (damage), by Rank Tier.
// Tiers 3-6 are from the Part 6 table. Tiers 1-2 are INTERPOLATED (see note above).
const ARMAMENT_FLAT_BONUS = {
  1: 3, // INTERPOLATED
  2: 6, // INTERPOLATED
  3: 10,
  4: 12,
  5: 15,
  6: 20,
};
const ARMAMENT_FLAT_BONUS_INTERPOLATED_TIERS = [1, 2];

// Conqueror's Coating Flat Bonus, only available Tier 5+.
const CONQUERORS_COATING_FLAT_BONUS = { 5: 25, 6: 35 };

// Gatling-type move hit caps by Rank Tier.
const GATLING_CAP_BY_TIER = { 1: 3, 2: 5, 3: 7, 4: 9, 5: 11, 6: 13 };

// Tier-discount rule for using a move below your current tier's top class:
// 10% off per class-tier gap, capped at 50%, rounded down.
const TIER_DISCOUNT_PER_GAP = 0.10;
const TIER_DISCOUNT_CAP = 0.50;

// Devil Fruit clone damage rule.
const CLONE_DAMAGE_MULTIPLIER = 0.5;

// Observation Haki: 18 sub-levels, E1 through S3.
// uses/fight = 2 + floor(index/2)
// SPD threshold needed = 50 - 2*index (percent)
// Stamina cost to read = 50 - 1*index (percent of the read move's own cost)
function buildObservationSubLevels() {
  const classes = ["E", "D", "C", "B", "A", "S"];
  const rows = [];
  for (let idx = 0; idx < 18; idx++) {
    const cls = classes[Math.floor(idx / 3)];
    const sub = (idx % 3) + 1;
    rows.push({
      id: `${cls}${sub}`,
      index: idx,
      usesPerFight: 2 + Math.floor(idx / 2),
      spdThresholdPct: 50 - 2 * idx,
      staminaCostPct: 50 - 1 * idx,
    });
  }
  return rows;
}
const OBSERVATION_SUB_LEVELS = buildObservationSubLevels();

// Haki training Points checkpoints (cumulative-from-last-checkpoint cost
// per sub-level jump). Armament values are canon; Observation = 1.5x.
const HAKI_SUBLEVEL_JUMPS = [
  { from: "E1", to: "E2", armament: 1700 },
  { from: "E2", to: "E3", armament: 1700 },
  { from: "E3", to: "D1", armament: 1600 },
  { from: "D1", to: "D2", armament: 2700 },
  { from: "D2", to: "D3", armament: 2700 },
  { from: "D3", to: "C1", armament: 2600 },
  { from: "C1", to: "C2", armament: 4400 },
  { from: "C2", to: "C3", armament: 4400 },
  { from: "C3", to: "B1", armament: 4200 },
  { from: "B1", to: "B2", armament: 6700 },
  { from: "B2", to: "B3", armament: 6700 },
  { from: "B3", to: "A1", armament: 6600 },
  { from: "A1", to: "A2", armament: 10000 },
  { from: "A2", to: "A3", armament: 10000 },
  { from: "A3", to: "S1", armament: 10000 },
].map((row) => ({ ...row, observation: Math.round(row.armament * 1.5) }));

// ---------------------------------------------------------------------------
// Race Table — Guidebook Section 2. Every flat number below is transcribed
// directly from that table. Two races (Fishman, Merfolk) have a SPD value
// that differs on land vs. in water; both are stored (spd / spdWater).
// "special" is a plain-text flag for the race's situational mechanic that
// isn't a flat stat (e.g. Giant's damage-class-up, Snakeneck's guard
// penalty) — these aren't auto-applied by the damage engine since they're
// conditional/narrative, but every API response that returns a character's
// race also surfaces this note so a mod doesn't have to re-check the PDF
// mid-fight.
const RACE_TABLE = {
  "Human": { rarity: "Common", hp: 0, str: 0, def: 0, spd: 0, hakiAffinityPct: 0, special: "+10% XP from all sources (adaptability)." },
  "Fishman": { rarity: "Common", hp: 20, str: 15, def: 5, spd: -5, spdWater: 15, hakiAffinityPct: 0, special: "Bonus STR is doubled for underwater fights." },
  "Merfolk": { rarity: "Uncommon", hp: 10, str: -5, def: -5, spd: 5, spdWater: 20, hakiAffinityPct: 0, special: "Fastest swimmers; land combat is a weak spot." },
  "Giant": { rarity: "Rare", hp: 50, str: 25, def: 15, spd: -15, hakiAffinityPct: 0, special: "Hits count as one class higher for damage purposes." },
  "Mink": { rarity: "Uncommon", hp: 5, str: 10, def: 0, spd: 15, hakiAffinityPct: 10, special: "Electro training grants faster Haki growth." },
  "Skypiean": { rarity: "Uncommon", hp: -10, str: -5, def: -5, spd: 20, hakiAffinityPct: 0, special: "+15% evade vs. ranged/projectile attacks." },
  "Long-Arm / Long-Leg Tribe": { rarity: "Uncommon", hp: 0, str: 10, def: 0, spd: 0, hakiAffinityPct: 0, special: "First strike each fight always lands (reach advantage)." },
  "Three-Eye Clan": { rarity: "Very Rare", hp: -10, str: 0, def: -10, spd: 0, hakiAffinityPct: 25, special: "Observation Haki starts one tier higher than rank allows." },
  "Celestial Dragon": { rarity: "Rarest", hp: 30, str: 10, def: 20, spd: -10, hakiAffinityPct: 0, special: "World Government access & fear-based social leverage; despised by Pirate/Revolutionary NPCs and factions." },
  "Snakeneck Tribe": { rarity: "Common", hp: 0, str: 5, def: 0, spd: 10, hakiAffinityPct: 0, special: "The first Guard or Dodge an opponent attempts each fight rolls at a -5 penalty." },
  "Tontatta Dwarf": { rarity: "Rare", hp: -15, str: 5, def: 5, spd: 25, hakiAffinityPct: 0, special: "Adrenaline Rush: dropping below 30% HP grants a one-time +30 STR for the rest of the fight." },
  "Kuja Tribe": { rarity: "Rare", hp: 0, str: 5, def: 0, spd: 10, hakiAffinityPct: 15, special: "Natural-Born Haki: starts play with Observation Haki already trained to Tier 1 (E-class) for free; may be GM-gated (Amazon Lily)." },
  "Lunarian": { rarity: "Rarest", hp: 20, str: 20, def: 25, spd: 10, hakiAffinityPct: 0, special: "Combustion Awakening: dropping below 50% HP grants a one-time +15 STR and +15 DEF for the rest of the fight; natural flight; near-extinct, GM discretion on consequences." },
};
const RACE_NAMES = Object.keys(RACE_TABLE);

module.exports = {
  CLASSES,
  RACE_TABLE,
  RACE_NAMES,
  CLASS_INDEX,
  TIER_TOP_CLASS,
  BASE_MOVE_COST,
  HIT_COUNT_DAMAGE,
  STAMINA_POOL_BY_TIER,
  STAT_POOL_BY_TIER,
  RANK_XP_REQUIRED,
  FATIGUE_SURCHARGE_PER_PRIOR_MOVE,
  HAKI_SURCHARGE_BY_TIER,
  CONQUERORS_COATING_SURCHARGE_ADDL,
  DEVIL_FRUIT_SURCHARGE_BY_TIER,
  ARMAMENT_FLAT_BONUS,
  ARMAMENT_FLAT_BONUS_INTERPOLATED_TIERS,
  CONQUERORS_COATING_FLAT_BONUS,
  GATLING_CAP_BY_TIER,
  TIER_DISCOUNT_PER_GAP,
  TIER_DISCOUNT_CAP,
  CLONE_DAMAGE_MULTIPLIER,
  OBSERVATION_SUB_LEVELS,
  HAKI_SUBLEVEL_JUMPS,
};
