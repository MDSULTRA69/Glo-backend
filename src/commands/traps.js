const MAX_TRAPS_PER_SPAR = 3;
const CLASSES = ["E", "D", "C", "B", "A", "S", "SS"];

async function submitTrap(db, waid, sparId, { moveName, moveClass }) {
  const countRow = await db.get(
    "SELECT COUNT(*) as n FROM traps WHERE waid = ? AND spar_id = ?",
    [waid, sparId]
  );
  const count = parseInt(countRow.n, 10);
  if (count >= MAX_TRAPS_PER_SPAR) {
    throw new Error(`Already submitted ${MAX_TRAPS_PER_SPAR} Traps for this fight — that's the max.`);
  }
  await db.run(
    "INSERT INTO traps (waid, spar_id, move_name, move_class) VALUES (?, ?, ?, ?)",
    [waid, sparId, moveName, moveClass]
  );
  return count + 1;
}

async function listTraps(db, waid, sparId) {
  return db.all("SELECT * FROM traps WHERE waid = ? AND spar_id = ? ORDER BY id", [waid, sparId]);
}

function assistPlausibility(trapClass, incomingMoveClass) {
  const trapIdx = CLASSES.indexOf(trapClass);
  const incomingIdx = CLASSES.indexOf(incomingMoveClass);
  if (trapIdx === -1 || incomingIdx === -1) {
    return { signal: "unknown", note: "Couldn't compare classes — rule on it directly." };
  }
  if (trapIdx < incomingIdx - 2) {
    return {
      signal: "worth-a-second-look",
      note: `Trap is class ${trapClass} vs. an incoming ${incomingMoveClass} move — a big class gap. Worth checking whether it's actually enough before ruling yes.`,
    };
  }
  return { signal: "no-flag", note: "No structural red flag — still your call on whether this specific move's fiction actually escapes/counters this specific attack." };
}

async function revealTrap(db, trapId, { incomingMoveClass }) {
  const trap = await db.get("SELECT * FROM traps WHERE id = ?", [trapId]);
  if (!trap) throw new Error("Trap not found.");
  if (trap.revealed) throw new Error("This Trap was already revealed.");

  const flag = assistPlausibility(trap.move_class, incomingMoveClass);
  await db.run("UPDATE traps SET revealed = TRUE, incoming_class = ? WHERE id = ?", [incomingMoveClass, trapId]);

  return { trap, plausibilityFlag: flag, needsModRuling: true };
}

async function ruleOnTrap(db, trapId, modWaid, ruling) {
  if (!["worked", "failed"].includes(ruling)) throw new Error('Ruling must be "worked" or "failed".');
  await db.run(
    "UPDATE traps SET mod_ruling = ?, mod_waid = ?, ruled_at = NOW() WHERE id = ?",
    [ruling, modWaid, trapId]
  );
  return db.get("SELECT * FROM traps WHERE id = ?", [trapId]);
}

module.exports = { MAX_TRAPS_PER_SPAR, submitTrap, listTraps, revealTrap, ruleOnTrap, assistPlausibility };
