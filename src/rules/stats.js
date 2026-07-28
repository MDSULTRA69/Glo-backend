const C = require("./constants");

/**
 * Look up a race's flat bonuses from the Guidebook Section 2 table.
 * Returns a zeroed, "Human"-shaped object for an unset/unknown race so
 * callers never have to null-check.
 */
function raceBonus(raceName, { inWater = false } = {}) {
  const row = C.RACE_TABLE[raceName];
  if (!row) {
    return { hp: 0, str: 0, def: 0, spd: 0, hakiAffinityPct: 0, special: null, known: false };
  }
  const spd = inWater && row.spdWater != null ? row.spdWater : row.spd;
  return { hp: row.hp, str: row.str, def: row.def, spd, hakiAffinityPct: row.hakiAffinityPct, special: row.special, known: true };
}

/**
 * Sum a list of bonus-buff rows (from the bonus_buffs table — "special
 * spins" or any other one-off mod-granted buff) into a single delta.
 */
function sumBuffs(buffs = []) {
  return buffs.reduce(
    (acc, b) => ({
      hp: acc.hp + (b.hp || 0),
      str: acc.str + (b.str || 0),
      def: acc.def + (b.def || 0),
      spd: acc.spd + (b.spd || 0),
      hakiAffinityPct: acc.hakiAffinityPct + (b.haki_affinity_pct || b.hakiAffinityPct || 0),
    }),
    { hp: 0, str: 0, def: 0, spd: 0, hakiAffinityPct: 0 }
  );
}

/**
 * Full effective-stat computation for a character row (from the
 * `characters` table) plus their bonus_buffs rows (from `bonus_buffs`).
 *
 * Per Guidebook Section 2: baseline is HP 100 / Haki Affinity 0%, and
 * STR/DEF/SPD come entirely from the Stat Pool allocation (str_alloc,
 * def_alloc, spd_alloc) — race bonuses stack on top of whatever's
 * allocated from that pool. Bonus buffs (race-spin or special-spin
 * buffs that aren't in the canon race table) stack on top of both.
 */
function computeEffectiveStats(char, buffs = [], { inWater = false } = {}) {
  const race = raceBonus(char.race, { inWater });
  const buffTotal = sumBuffs(buffs);

  return {
    hp: 100 + race.hp + buffTotal.hp,
    str: (char.str_alloc || 0) + race.str + buffTotal.str,
    def: (char.def_alloc || 0) + race.def + buffTotal.def,
    spd: (char.spd_alloc || 0) + race.spd + buffTotal.spd,
    hakiAffinityPct: race.hakiAffinityPct + buffTotal.hakiAffinityPct,
    breakdown: {
      pool: { str: char.str_alloc || 0, def: char.def_alloc || 0, spd: char.spd_alloc || 0 },
      race: { name: char.race || null, ...race },
      buffs,
      buffTotal,
    },
  };
}

module.exports = { raceBonus, sumBuffs, computeEffectiveStats };
