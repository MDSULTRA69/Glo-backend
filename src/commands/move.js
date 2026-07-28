const { resolveMoveDamage, checkGatlingLimit } = require("../rules/damage");
const { computeStaminaCost, observationReadSucceeds } = require("../rules/stamina");
const { rankTierFromXp } = require("../rules/progression");
const { computeEffectiveStats } = require("../rules/stats");
const { BASE_MOVE_COST, HAKI_SURCHARGE_BY_TIER, CONQUERORS_COATING_SURCHARGE_ADDL, DEVIL_FRUIT_SURCHARGE_BY_TIER } = require("../rules/constants");
const buffsCmd = require("./buffs");

async function loadCharacterContext(db, waid, { inWater = false } = {}) {
  const char = await db.get("SELECT * FROM characters WHERE waid = ?", [waid]);
  if (!char) throw new Error("No character found for this player.");
  const buffs = await buffsCmd.listBuffs(db, waid);
  const tier = rankTierFromXp(char.rank_xp).tier;
  const stats = computeEffectiveStats(char, buffs, { inWater });
  return { char, tier, stats };
}

/**
 * Compute the per-hit Stamina cost for a Gatling move.
 * Per the rules each hit in a Gatling sequence costs the base class Stamina
 * (+ Haki/DF surcharges) individually. Fatigue is applied once to the whole
 * declared move, not per-hit — pass priorMovesThrown for that surcharge.
 */
function gatlingPerHitStaminaCost({ characterTier, moveClass, coating = "none", isDevilFruitMove = false }) {
  const base = BASE_MOVE_COST[moveClass];
  if (base == null) throw new Error(`Unknown move class: ${moveClass}`);
  let hakiSurcharge = 0;
  let conquerorsAddl = 0;
  if (coating === "armament") {
    hakiSurcharge = HAKI_SURCHARGE_BY_TIER[characterTier] || 0;
  } else if (coating === "conquerors") {
    hakiSurcharge = HAKI_SURCHARGE_BY_TIER[characterTier] || 0;
    conquerorsAddl = CONQUERORS_COATING_SURCHARGE_ADDL[characterTier] || 0;
  }
  const dfSurcharge = isDevilFruitMove ? DEVIL_FRUIT_SURCHARGE_BY_TIER[characterTier] || 0 : 0;
  return base + hakiSurcharge + conquerorsAddl + dfSurcharge;
}

/**
 * Resolve ANY declared move — attack damage + Stamina cost + Gatling cap
 * in one shot. Works three ways:
 *  - waid only: pulls the attacker's Tier + effective STR automatically.
 *  - waid + defenderWaid: also pulls the defender's effective DEF.
 *  - manualTier (+ optional manualAttackerStr/manualDefenderDef): no
 *    registered character needed at all, for quick homebrew checks.
 *
 * For Gatling moves the response now includes:
 *   gatling.perHitDamage, gatling.totalDamage,
 *   gatling.perHitStamina, gatling.totalStamina (hits × perHitStamina + fatigue)
 */
async function resolveDeclaredMove(db, waid, opts) {
  const {
    moveName, moveClass, coating = "none", isClone = false, isGatling = false,
    requestedHits = 1, priorMovesThrown = 0, isDevilFruitMove = false, manualTier = null,
    defenderWaid = null, defenderReaction = "none",
    inWater = false, manualAttackerStr = 0, manualDefenderDef = 0,
  } = opts;

  let tier, attackerStr;
  if (waid) {
    const ctx = await loadCharacterContext(db, waid, { inWater });
    tier = ctx.tier;
    attackerStr = ctx.stats.str;
  } else {
    tier = manualTier;
    attackerStr = manualAttackerStr;
  }
  if (!tier) throw new Error("No Tier available — pass a waid with a character, or a manualTier.");

  let defenderDef = manualDefenderDef;
  let defenderName = null;
  if (defenderWaid) {
    const defCtx = await loadCharacterContext(db, defenderWaid, { inWater });
    defenderDef = defCtx.stats.def;
    defenderName = defCtx.char.name;
  }

  const damage = resolveMoveDamage({ moveClass, characterTier: tier, coating, isClone, attackerStr, defenderDef, defenderReaction });
  const stamina = computeStaminaCost({ characterTier: tier, moveClass, priorMovesThrown, coating, isDevilFruitMove });

  let gatling = null;
  if (isGatling) {
    const gatlingCheck = checkGatlingLimit({ characterTier: tier, requestedHits });
    const perHitStamina = gatlingPerHitStaminaCost({ characterTier: tier, moveClass, coating, isDevilFruitMove });
    // Fatigue applies once (this is one declared move) on top of per-hit costs
    const fatigueSurcharge = priorMovesThrown * 2;
    const totalStamina = gatlingCheck.allowedHits * perHitStamina + fatigueSurcharge;
    // Total damage: per-hit damage × allowed hits (after DEF/reaction applied to each hit)
    const totalDamage = damage.finalDamage * gatlingCheck.allowedHits;
    gatling = {
      ...gatlingCheck,
      perHitDamage: damage.finalDamage,
      totalDamage,
      perHitStamina,
      fatigueSurcharge,
      totalStamina,
    };
  }

  return { moveName, moveClass, characterTier: tier, defenderName, damage, stamina, gatling };
}

/**
 * Resolve a combo (multiple moves declared in sequence in one turn).
 * Each move accumulates fatigue on top of the caller's priorMovesThrown offset.
 * Returns individual move results plus combo totals.
 */
async function resolveCombo(db, waid, comboOpts) {
  const {
    moves = [],          // array of move opts (moveName, moveClass, coating, isClone, isDevilFruitMove, isGatling, requestedHits, defenderReaction)
    priorMovesBeforeCombo = 0,
    defenderWaid = null,
    inWater = false,
    manualTier = null,
    manualAttackerStr = 0,
    manualDefenderDef = 0,
  } = comboOpts;

  if (!moves.length) throw new Error("No moves provided for combo.");

  const results = [];
  let totalDamage = 0;
  let totalStamina = 0;
  let priorMoves = priorMovesBeforeCombo;

  for (const move of moves) {
    const result = await resolveDeclaredMove(db, waid, {
      ...move,
      priorMovesThrown: priorMoves,
      defenderWaid,
      inWater,
      manualTier,
      manualAttackerStr,
      manualDefenderDef,
    });

    const moveDamage = result.gatling ? result.gatling.totalDamage : result.damage.finalDamage;
    const moveStamina = result.gatling ? result.gatling.totalStamina : result.stamina.total;

    results.push({ ...result, effectiveDamage: moveDamage, effectiveStamina: moveStamina });
    totalDamage += moveDamage;
    totalStamina += moveStamina;
    priorMoves += 1; // each move in the combo counts as 1 prior move for the next
  }

  return { results, totalDamage, totalStamina };
}

/**
 * Resolve an Observation Haki read: the Stamina cost to read the incoming
 * move (a % of that move's own Stamina cost) and whether the SPD gate
 * clears, per Part 10's sub-level table.
 */
async function resolveObservationRead(db, opts) {
  const {
    readerWaid = null, attackerWaid = null,
    manualReaderSpd = 0, manualAttackerSpd = 0, manualAttackerTier = null,
    attackerMoveClass, attackerCoating = "none", attackerIsDevilFruitMove = false,
    observationSubLevelIndex, inWater = false,
  } = opts;

  let readerSpd, attackerSpd, attackerTier;
  if (readerWaid) {
    const ctx = await loadCharacterContext(db, readerWaid, { inWater });
    readerSpd = ctx.stats.spd;
  } else {
    readerSpd = manualReaderSpd;
  }
  if (attackerWaid) {
    const ctx = await loadCharacterContext(db, attackerWaid, { inWater });
    attackerSpd = ctx.stats.spd;
    attackerTier = ctx.tier;
  } else {
    attackerSpd = manualAttackerSpd;
    attackerTier = manualAttackerTier;
  }
  if (!attackerTier) throw new Error("No attacker Tier available — pass attackerWaid, or manualAttackerTier.");

  const stamina = computeStaminaCost({
    characterTier: attackerTier,
    moveClass: attackerMoveClass,
    coating: attackerCoating,
    isDevilFruitMove: attackerIsDevilFruitMove,
    isObservationRead: true,
    observationSubLevelIndex,
  });
  const succeeds = observationReadSucceeds({ readerSpd, attackerSpd, observationSubLevelIndex });

  return { readerSpd, attackerSpd, succeeds, stamina };
}

/**
 * Preview a Trap's Stamina cost without submitting it (for the calculator
 * — the real submission still goes through commands/traps.js).
 */
function previewTrapCost({ characterTier, moveClass, coating = "none", isDevilFruitMove = false }) {
  return computeStaminaCost({ characterTier, moveClass, priorMovesThrown: 0, coating, isDevilFruitMove });
}

module.exports = { resolveDeclaredMove, resolveCombo, resolveObservationRead, previewTrapCost, loadCharacterContext };
