const C = require("./constants");

const SUB_LEVEL_ORDER = C.HAKI_SUBLEVEL_JUMPS.reduce(
  (acc, jump, i) => {
    if (i === 0) acc.push(jump.from);
    acc.push(jump.to);
    return acc;
  },
  []
);

/**
 * Given Points banked into a Haki track ("armament" | "observation"),
 * return the current sub-level (e.g. "D2") and progress toward the next.
 */
function hakiSubLevelFromPoints(track, bankedPoints) {
  let currentLevel = SUB_LEVEL_ORDER[0];
  let spent = 0;
  let nextJump = null;

  for (const jump of C.HAKI_SUBLEVEL_JUMPS) {
    const cost = jump[track];
    if (bankedPoints - spent >= cost) {
      spent += cost;
      currentLevel = jump.to;
    } else {
      nextJump = { to: jump.to, costRemaining: cost - (bankedPoints - spent), cost };
      break;
    }
  }

  const subLevelIndex = C.OBSERVATION_SUB_LEVELS.findIndex((s) => s.id === currentLevel);

  return {
    currentLevel,
    subLevelIndex, // only meaningful for observation reads, but returned for both tracks
    pointsBanked: bankedPoints,
    pointsSpentOnCurrentLevel: spent,
    nextLevel: nextJump ? nextJump.to : null,
    pointsToNextLevel: nextJump ? nextJump.costRemaining : null,
  };
}

/**
 * Rank Tier from cumulative Rank XP.
 */
function rankTierFromXp(xp) {
  let tier = 1;
  for (let t = 1; t <= 6; t++) {
    if (xp >= C.RANK_XP_REQUIRED[t]) tier = t;
  }
  const nextTier = tier < 6 ? tier + 1 : null;
  return {
    tier,
    xp,
    nextTier,
    xpToNextTier: nextTier ? C.RANK_XP_REQUIRED[nextTier] - xp : null,
    xpRequiredForNextTier: nextTier ? C.RANK_XP_REQUIRED[nextTier] : null,
  };
}

/**
 * Generic "Points to next Class" progression, shared shape for Weapon and
 * Style training (each is a flat 5-jump E->D->C->B->A->S/SS curve, unlike
 * Haki's 18 sub-levels above).
 */
function classFromPoints(jumps, bankedPoints) {
  let currentLevel = "E";
  let spent = 0;
  let nextJump = null;

  for (const jump of jumps) {
    const cost = jump.points;
    if (bankedPoints - spent >= cost) {
      spent += cost;
      currentLevel = jump.to;
    } else {
      nextJump = { to: jump.to, costRemaining: cost - (bankedPoints - spent), cost };
      break;
    }
  }

  return {
    currentLevel,
    pointsBanked: bankedPoints,
    pointsSpentOnCurrentLevel: spent,
    nextLevel: nextJump ? nextJump.to : null,
    pointsToNextLevel: nextJump ? nextJump.costRemaining : null,
  };
}

function weaponClassFromPoints(bankedPoints) {
  return classFromPoints(C.WEAPON_TRAINING_JUMPS, bankedPoints);
}

function styleClassFromPoints(bankedPoints) {
  return classFromPoints(C.STYLE_TRAINING_JUMPS, bankedPoints);
}

/**
 * Conqueror's Coating training level from Points banked specifically into
 * that track, gated on BOTH Points and Rank Tier at each level (Part 6/8) —
 * reaching the Tier is a prerequisite, not a substitute, for the Points.
 */
function conquerorsCoatingLevelFromPoints(bankedPoints, rankTier) {
  const { aClass, ssClass } = C.CONQUERORS_COATING_TRAINING;
  const aUnlocked = bankedPoints >= aClass.pointsRequired && rankTier >= aClass.tierRequired;
  const ssUnlocked = bankedPoints >= ssClass.pointsRequired && rankTier >= ssClass.tierRequired;

  if (ssUnlocked) {
    return { currentLevel: "S/SS-class", pointsBanked: bankedPoints, nextLevel: null, pointsToNextLevel: null, blockedByTier: null };
  }
  if (aUnlocked) {
    return {
      currentLevel: "A-class",
      pointsBanked: bankedPoints,
      nextLevel: "S/SS-class",
      pointsToNextLevel: Math.max(0, ssClass.pointsRequired - bankedPoints),
      blockedByTier: rankTier < ssClass.tierRequired ? ssClass.tierRequired : null,
    };
  }
  return {
    currentLevel: "Locked",
    pointsBanked: bankedPoints,
    nextLevel: "A-class",
    pointsToNextLevel: Math.max(0, aClass.pointsRequired - bankedPoints),
    blockedByTier: rankTier < aClass.tierRequired ? aClass.tierRequired : null,
  };
}

module.exports = {
  hakiSubLevelFromPoints,
  rankTierFromXp,
  SUB_LEVEL_ORDER,
  weaponClassFromPoints,
  styleClassFromPoints,
  conquerorsCoatingLevelFromPoints,
};
