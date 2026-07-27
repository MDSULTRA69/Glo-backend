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

module.exports = { hakiSubLevelFromPoints, rankTierFromXp, SUB_LEVEL_ORDER };
