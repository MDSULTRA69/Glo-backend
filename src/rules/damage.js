const C = require("./constants");

/**
 * Resolve the damage of ANY move — canon (from the PDF) or homebrew —
 * purely from its declared class and how it's coated. This is the
 * "Light Slash, C-rank, Armament + Conqueror's" case: the move doesn't
 * need to exist in any table. Its class alone determines its hit-count
 * damage, and coating adds the same flat bonus any move of that class
 * would get.
 *
 * @param {Object} opts
 * @param {string} opts.moveClass - "E".."SS"
 * @param {number} opts.characterTier - 1-6 (must be able to legally use moveClass)
 * @param {"none"|"armament"|"conquerors"} [opts.coating="none"]
 * @param {boolean} [opts.isClone=false] - Devil Fruit clone/duplicate, halves output
 * @param {number} [opts.attackerStr=0] - Attacker's effective STR (Stat Pool + race + buffs). Section 2: "STR affects damage dealt."
 * @param {number} [opts.defenderDef=0] - Defender's effective DEF (Stat Pool + race + buffs). Section 2: "DEF reduces damage taken."
 * @param {"none"|"guard"|"dodge-failed"|"dodge-success"} [opts.defenderReaction="none"]
 */
function resolveMoveDamage(opts) {
  const {
    moveClass,
    characterTier,
    coating = "none",
    isClone = false,
    attackerStr = 0,
    defenderDef = 0,
    defenderReaction = "none",
  } = opts;

  if (!C.HIT_COUNT_DAMAGE[moveClass]) throw new Error(`Unknown move class: ${moveClass}`);

  const moveClassIndex = C.CLASS_INDEX[moveClass];
  if (moveClassIndex > characterTier) {
    throw new Error(
      `Illegal move: class ${moveClass} is above what Tier ${characterTier} allows (max class index ${characterTier}).`
    );
  }

  const hitCountDamage = C.HIT_COUNT_DAMAGE[moveClass];

  let coatingBonus = 0;
  let coatingNote = null;
  if (coating === "armament") {
    coatingBonus = C.ARMAMENT_FLAT_BONUS[characterTier];
    coatingNote = C.ARMAMENT_FLAT_BONUS_INTERPOLATED_TIERS.includes(characterTier)
      ? `Tier ${characterTier} Armament bonus is interpolated (not in the source table) — confirm with a mod.`
      : null;
  } else if (coating === "conquerors") {
    coatingBonus = C.CONQUERORS_COATING_FLAT_BONUS[characterTier];
    if (coatingBonus == null) {
      throw new Error(`Conqueror's Coating isn't unlocked at Tier ${characterTier} (Tier 5+ only)`);
    }
  }

  // Section 2 states STR adds to damage dealt and DEF reduces damage taken,
  // but no source table gives an exact ratio beyond the class hit-count and
  // coating flat bonus (the Part 4 worked examples never factor Stat Pool
  // points into damage either). This applies both as a direct 1:1 flat
  // adjustment — the simplest reading of the plain-text rule. Flag this to
  // the group and adjust here if a different ratio gets confirmed.
  let subtotal = hitCountDamage + coatingBonus + attackerStr;

  if (isClone) {
    subtotal = Math.floor(subtotal * C.CLONE_DAMAGE_MULTIPLIER);
  }

  const afterDef = Math.max(0, subtotal - defenderDef);

  let final = afterDef;
  let reactionNote = null;
  if (defenderReaction === "guard") {
    final = Math.floor(afterDef / 2);
    reactionNote = "Guarded — half damage";
  } else if (defenderReaction === "dodge-failed") {
    reactionNote = "Dodge attempted and failed — full damage";
  } else if (defenderReaction === "dodge-success") {
    final = 0;
    reactionNote = "Dodge succeeded — no damage";
  }

  return {
    finalDamage: final,
    breakdown: {
      moveClass,
      hitCountDamage,
      coating,
      coatingBonus,
      coatingNote,
      attackerStr,
      isClone,
      cloneMultiplierApplied: isClone ? C.CLONE_DAMAGE_MULTIPLIER : null,
      subtotalBeforeDef: subtotal,
      defenderDef,
      afterDef,
      defenderReaction,
      reactionNote,
    },
  };
}

/**
 * Gatling-type move: same resolveMoveDamage, but validates and reports
 * the requested hit count against the Tier's cap instead of computing a
 * single hit's damage. Caller multiplies perHitDamage x hits themselves
 * if they want a total, since Guard/Dodge might apply per-hit or to
 * the whole burst depending on the mod's ruling — left to the caller.
 */
function checkGatlingLimit({ characterTier, requestedHits }) {
  const cap = C.GATLING_CAP_BY_TIER[characterTier];
  if (cap == null) throw new Error(`characterTier must be 1-6`);
  return {
    cap,
    requestedHits,
    allowedHits: Math.min(requestedHits, cap),
    wasCapped: requestedHits > cap,
  };
}

module.exports = { resolveMoveDamage, checkGatlingLimit };
