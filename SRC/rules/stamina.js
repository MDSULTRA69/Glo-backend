const C = require("./constants");

/**
 * Compute the tier-discount multiplier for using `moveClass` when the
 * character's current Rank Tier tops out at `characterTier`.
 * 10% off per class-tier gap, capped at 50%. Using a move at or above
 * your own top class = no discount (gap clamped to 0).
 */
function tierDiscountFraction(characterTier, moveClass) {
  const topClassIndex = characterTier; // tiers 1-6 map 1:1 to class index 1-6 (S/SS both = 6)
  const moveIndex = C.CLASS_INDEX[moveClass];
  if (moveIndex == null) throw new Error(`Unknown move class: ${moveClass}`);
  const gap = Math.max(0, topClassIndex - moveIndex);
  return Math.min(gap * C.TIER_DISCOUNT_PER_GAP, C.TIER_DISCOUNT_CAP);
}

/**
 * Full Stamina cost of a single declared move.
 *
 * @param {Object} opts
 * @param {number} opts.characterTier - 1-6
 * @param {string} opts.moveClass - "E".."SS"
 * @param {number} [opts.priorMovesThrown=0] - moves already thrown this fight by this character (for Fatigue)
 * @param {"none"|"armament"|"conquerors"} [opts.coating="none"]
 * @param {boolean} [opts.isDevilFruitMove=false]
 * @param {boolean} [opts.isObservationRead=false] - true if this cost is "reading" a move via Observation Haki instead of throwing it
 * @param {number} [opts.observationSubLevelIndex] - 0-17, required if isObservationRead
 * @returns {{ total:number, breakdown:Object }}
 */
function computeStaminaCost(opts) {
  const {
    characterTier,
    moveClass,
    priorMovesThrown = 0,
    coating = "none",
    isDevilFruitMove = false,
    isObservationRead = false,
    observationSubLevelIndex = null,
  } = opts;

  if (!C.BASE_MOVE_COST[moveClass]) throw new Error(`Unknown move class: ${moveClass}`);
  if (characterTier < 1 || characterTier > 6) throw new Error("characterTier must be 1-6");

  const baseCost = C.BASE_MOVE_COST[moveClass];
  const discountFraction = tierDiscountFraction(characterTier, moveClass);
  const discountedBase = Math.floor(baseCost * (1 - discountFraction));

  const fatigue = priorMovesThrown * C.FATIGUE_SURCHARGE_PER_PRIOR_MOVE;

  let hakiSurcharge = 0;
  let conquerorsAddl = 0;
  if (coating === "armament") {
    hakiSurcharge = C.HAKI_SURCHARGE_BY_TIER[characterTier] || 0;
  } else if (coating === "conquerors") {
    hakiSurcharge = C.HAKI_SURCHARGE_BY_TIER[characterTier] || 0;
    conquerorsAddl = C.CONQUERORS_COATING_SURCHARGE_ADDL[characterTier] || 0;
    if (!conquerorsAddl) {
      throw new Error(`Conqueror's Coating isn't unlocked at Tier ${characterTier} (Tier 5+ only)`);
    }
  }

  const dfSurcharge = isDevilFruitMove ? C.DEVIL_FRUIT_SURCHARGE_BY_TIER[characterTier] || 0 : 0;

  let total = discountedBase + fatigue + hakiSurcharge + conquerorsAddl + dfSurcharge;

  // Observation Haki read cost overrides everything above: it's a % of
  // the cost of the move being read, not a move the reader is throwing.
  if (isObservationRead) {
    if (observationSubLevelIndex == null) {
      throw new Error("observationSubLevelIndex required when isObservationRead is true");
    }
    const subLevel = C.OBSERVATION_SUB_LEVELS[observationSubLevelIndex];
    if (!subLevel) throw new Error(`Invalid observation sub-level index: ${observationSubLevelIndex}`);
    // "that attack's own Stamina cost" — reuse the full non-observation cost just computed
    total = Math.floor(total * (subLevel.staminaCostPct / 100));
    return {
      total,
      breakdown: {
        fullAttackCost: discountedBase + fatigue + hakiSurcharge + conquerorsAddl + dfSurcharge,
        readingSubLevel: subLevel.id,
        readCostPct: subLevel.staminaCostPct,
        spdThresholdPct: subLevel.spdThresholdPct,
        usesPerFight: subLevel.usesPerFight,
      },
    };
  }

  return {
    total,
    breakdown: {
      baseCost,
      discountFraction,
      discountedBase,
      fatigue,
      hakiSurcharge,
      conquerorsAddl,
      dfSurcharge,
    },
  };
}

/**
 * Check whether an Observation Haki read succeeds against a given attacker SPD.
 */
function observationReadSucceeds({ readerSpd, attackerSpd, observationSubLevelIndex }) {
  const subLevel = C.OBSERVATION_SUB_LEVELS[observationSubLevelIndex];
  if (!subLevel) throw new Error(`Invalid observation sub-level index: ${observationSubLevelIndex}`);
  const requiredSpd = attackerSpd * (subLevel.spdThresholdPct / 100);
  return readerSpd >= requiredSpd;
}

module.exports = { tierDiscountFraction, computeStaminaCost, observationReadSucceeds };
