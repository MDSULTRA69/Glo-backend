const { rankTierFromXp } = require("../rules/progression");
const { CLASS_INDEX } = require("../rules/constants");

const MAX_DECK_SLOTS = 15;

async function getDeck(db, waid) {
  return db.all("SELECT * FROM deck_slots WHERE waid = ? ORDER BY slot_number", [waid]);
}

async function addMoveToDeck(db, waid, { slotNumber, moveName, moveType, moveClass }) {
  if (slotNumber < 1 || slotNumber > MAX_DECK_SLOTS) {
    throw new Error(`Slot number must be 1-${MAX_DECK_SLOTS}.`);
  }
  const char = await db.get("SELECT * FROM characters WHERE waid = ?", [waid]);
  if (!char) throw new Error("No character found for this player.");

  const rank = rankTierFromXp(char.rank_xp);
  const moveIndex = CLASS_INDEX[moveClass];
  if (moveIndex == null) throw new Error(`Unknown move class: ${moveClass}`);
  if (moveIndex > rank.tier) {
    throw new Error(`${moveName} is class ${moveClass}, but ${char.name} is Tier ${rank.tier}. Can't slot it.`);
  }

  const existingSlot = await db.get(
    "SELECT * FROM deck_slots WHERE waid = ? AND slot_number = ?",
    [waid, slotNumber]
  );
  if (existingSlot && existingSlot.locked) {
    throw new Error(`Slot ${slotNumber} is locked — a fight is in progress.`);
  }

  if (existingSlot) {
    await db.run(
      "UPDATE deck_slots SET move_name = ?, move_type = ?, move_class = ? WHERE waid = ? AND slot_number = ?",
      [moveName, moveType, moveClass, waid, slotNumber]
    );
  } else {
    await db.run(
      "INSERT INTO deck_slots (waid, slot_number, move_name, move_type, move_class) VALUES (?, ?, ?, ?, ?)",
      [waid, slotNumber, moveName, moveType, moveClass]
    );
  }

  return getDeck(db, waid);
}

async function removeMoveFromDeck(db, waid, slotNumber) {
  const existingSlot = await db.get(
    "SELECT * FROM deck_slots WHERE waid = ? AND slot_number = ?",
    [waid, slotNumber]
  );
  if (existingSlot && existingSlot.locked) {
    throw new Error(`Slot ${slotNumber} is locked — a fight is in progress.`);
  }
  await db.run("DELETE FROM deck_slots WHERE waid = ? AND slot_number = ?", [waid, slotNumber]);
  return getDeck(db, waid);
}

async function lockDeck(db, waid, locked) {
  await db.run("UPDATE deck_slots SET locked = ? WHERE waid = ?", [locked, waid]);
}

async function checkMoveLegal(db, waid, moveName) {
  const char = await db.get("SELECT * FROM characters WHERE waid = ?", [waid]);
  if (!char) return { legal: false, reason: "No character found." };

  const slot = await db.get("SELECT * FROM deck_slots WHERE waid = ? AND move_name = ?", [waid, moveName]);
  if (!slot) return { legal: false, reason: `"${moveName}" isn't slotted in this Deck.` };

  const rank = rankTierFromXp(char.rank_xp);
  const moveIndex = CLASS_INDEX[slot.move_class];
  if (moveIndex > rank.tier) {
    return { legal: false, reason: `"${moveName}" is class ${slot.move_class}, above Tier ${rank.tier}.` };
  }
  return { legal: true, move: slot };
}

module.exports = { MAX_DECK_SLOTS, getDeck, addMoveToDeck, removeMoveFromDeck, lockDeck, checkMoveLegal };
