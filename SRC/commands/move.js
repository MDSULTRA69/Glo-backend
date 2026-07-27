const { resolveMoveDamage, checkGatlingLimit } = require("../rules/damage");
const { computeStaminaCost } = require("../rules/stamina");
const { rankTierFromXp } = require("../rules/progression");

async function resolveDeclaredMove(db, waid, opts) {
  const {
    moveName, moveClass, coating = "none", isClone = false, isGatling = false,
    requestedHits = 1, priorMovesThrown = 0, isDevilFruitMove = false, manualTier = null,
  } = opts;

  let tier;
  if (waid) {
    const char = await db.get("SELECT * FROM characters WHERE waid = ?", [waid]);
    if (!char) throw new Error("No character found for this player.");
    tier = rankTierFromXp(char.rank_xp).tier;
  } else {
    tier = manualTier;
  }
  if (!tier) throw new Error("No Tier available — pass a waid with a character, or a manualTier.");

  const damage = resolveMoveDamage({ moveClass, characterTier: tier, coating, isClone });
  const stamina = computeStaminaCost({ characterTier: tier, moveClass, priorMovesThrown, coating, isDevilFruitMove });
  const gatling = isGatling ? checkGatlingLimit({ characterTier: tier, requestedHits }) : null;

  return { moveName, moveClass, characterTier: tier, damage, stamina, gatling };
}

module.exports = { resolveDeclaredMove };
