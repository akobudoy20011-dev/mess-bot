const db = require("../db");
const { normalizeKey, totalUnits } = require("./utils");
const UNITS = {
  infantry: {
    name: "Infantry",
    emoji: "⚔️",
    column: "infantry",
    cost: 10,
    attack: 1,
    defense: 1,
  },
  archers: {
    name: "Archers",
    emoji: "🏹",
    column: "archers",
    cost: 16,
    attack: 1.3,
    defense: 0.7,
  },
  spearmen: {
    name: "Spearmen",
    emoji: "🔱",
    column: "spearmen",
    cost: 13,
    attack: 1.1,
    defense: 1.3,
  },
  cavalry: {
    name: "Cavalry",
    emoji: "🐎",
    column: "cavalry",
    cost: 25,
    attack: 1.6,
    defense: 0.9,
  },
  heavy_swordsmen: {
    name: "Heavy Swordsmen",
    emoji: "🛡️",
    column: "heavy_swordsmen",
    cost: 30,
    attack: 1.5,
    defense: 1.7,
  },
  shielders: {
    name: "Shielders",
    emoji: "🛡️",
    column: "shielders",
    cost: 22,
    attack: 0.8,
    defense: 1.9,
  },
  mages: {
    name: "Mages",
    emoji: "🧙",
    column: "mages",
    cost: 40,
    attack: 2,
    defense: 0.5,
  },
  assassins: {
    name: "Assassins",
    emoji: "🗡️",
    column: "assassins",
    cost: 50,
    attack: 2.2,
    defense: 0.4,
  },
};
const FORMATIONS = {
  balanced: {
    name: "Balanced",
    emoji: "⚔️",
    attack: 1,
    defense: 1,
    speed: 1,
  },
  shield_wall: {
    name: "Shield Wall",
    emoji: "🛡️",
    attack: 0.85,
    defense: 1.35,
    speed: 0.85,
  },
  cavalry_charge: {
    name: "Cavalry Charge",
    emoji: "🐎",
    attack: 1.3,
    defense: 0.85,
    speed: 1.25,
  },
  archer_line: {
    name: "Archer Line",
    emoji: "🏹",
    attack: 1.2,
    defense: 0.9,
    speed: 0.95,
  },
  mage_formation: {
    name: "Mage Formation",
    emoji: "🔷",
    attack: 1.35,
    defense: 0.8,
    speed: 0.9,
  },
  assault: {
    name: "Assault",
    emoji: "🔥",
    attack: 1.45,
    defense: 0.7,
    speed: 1,
  },
  defensive: {
    name: "Defensive",
    emoji: "🏰",
    attack: 0.75,
    defense: 1.5,
    speed: 0.8,
  },
  ambush: {
    name: "Ambush",
    emoji: "🌑",
    attack: 1.25,
    defense: 0.75,
    speed: 1.1,
  },
};
async function getArmy(threadID, userID) {
  const result = await db.query(
    `
    SELECT *
    FROM rpg_armies
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID)]
  );
  return result.rows[0] || null;
}
async function train(threadID, userID, unitName, amount) {
  const key = normalizeKey(unitName);
  const unit = UNITS[key];
  const count = Math.floor(Number(amount));
  if (!unit || !Number.isInteger(count) || count <= 0 || count > 10_000) {
    throw new Error(
      `Usage: !rpg train <${Object.keys(UNITS).join("|")}> <amount>`
    );
  }
  const cost = unit.cost * count;
  await db.spendBalance(
    threadID,
    userID,
    cost,
    `RPG training: ${unit.name} x${count}`
  );
  await db.query(
    `
    UPDATE rpg_armies
    SET ${unit.column} = ${unit.column} + $3,
        supplies = LEAST(100, supplies + $4),
        updated_at = $5
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID), count, Math.ceil(count / 10), Date.now()]
  );
  return { unit, count, cost };
}
async function setFormation(threadID, userID, formationName) {
  const key = normalizeKey(formationName);
  const formation = FORMATIONS[key];
  if (!formation) {
    throw new Error(
      `Choose a formation: ${Object.keys(FORMATIONS).join(", ")}.`
    );
  }
  await db.query(
    `
    UPDATE rpg_armies
    SET formation = $3,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID), key, Date.now()]
  );
  return { key, ...formation };
}
async function createRegiment(threadID, userID, name, unitType, amount) {
  const unit = UNITS[normalizeKey(unitType)];
  const count = Math.floor(Number(amount));
  if (!unit || !name || !Number.isInteger(count) || count <= 0) {
    throw new Error("Usage: !rpg regiment create <name> <unit> <amount>");
  }
  const result = await db.query(
    `
    INSERT INTO rpg_regiments (
      thread_id, user_id, name, unit_type, count, experience_tier, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 'recruit', $6)
    RETURNING *
    `,
    [
      String(threadID),
      String(userID),
      String(name).slice(0, 48),
      unit.column,
      count,
      Date.now(),
    ]
  );
  return result.rows[0];
}
async function getRegiments(threadID, userID) {
  const result = await db.query(
    `
    SELECT *
    FROM rpg_regiments
    WHERE thread_id = $1
      AND user_id = $2
    ORDER BY id
    `,
    [String(threadID), String(userID)]
  );
  return result.rows;
}
function armyPower(army, formationName = "balanced") {
  const formation = FORMATIONS[formationName] || FORMATIONS.balanced;
  let attack = 0;
  let defense = 0;
  for (const [key, unit] of Object.entries(UNITS)) {
    const count = Number(army?.[unit.column] || 0);
    attack += count * unit.attack;
    defense += count * unit.defense;
  }
  return {
    attack: Math.round(attack * formation.attack),
    defense: Math.round(defense * formation.defense),
    strength: Math.round((attack + defense) * formation.attack),
    formation,
  };
}
module.exports = {
  FORMATIONS,
  UNITS,
  armyPower,
  createRegiment,
  getArmy,
  getRegiments,
  setFormation,
  totalUnits,
  train,
};
