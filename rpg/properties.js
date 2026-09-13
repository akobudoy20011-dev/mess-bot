const db = require("../db");
const { formatNumber } = require("./utils");
const PROPERTY_TIERS = [
  { key: "settlement", name: "Settlement", cost: 0, upkeep: 0 },
  { key: "cottage", name: "Cottage", cost: 500, upkeep: 2 },
  { key: "estate", name: "Estate", cost: 2_500, upkeep: 8 },
  { key: "manor", name: "Manor", cost: 7_500, upkeep: 20 },
  { key: "castle", name: "Castle", cost: 20_000, upkeep: 50 },
  { key: "fortress", name: "Fortress", cost: 50_000, upkeep: 120 },
  { key: "city", name: "City", cost: 150_000, upkeep: 300 },
  { key: "kingdom", name: "Kingdom", cost: 500_000, upkeep: 800 },
  { key: "empire", name: "Empire", cost: 1_500_000, upkeep: 2_000 },
];
const BUILDINGS = {
  farm: {
    name: "Farm",
    emoji: "🌾",
    baseCost: 300,
    description: "Produces food and supports population.",
  },
  mine: {
    name: "Mine",
    emoji: "⛏️",
    baseCost: 500,
    description: "Produces ore and building materials.",
  },
  lumber: {
    name: "Lumber Camp",
    emoji: "🪵",
    baseCost: 400,
    description: "Produces timber for construction.",
  },
  market: {
    name: "Market",
    emoji: "🏪",
    baseCost: 750,
    description: "Improves trade and tax income.",
  },
  watchtower: {
    name: "Watchtower",
    emoji: "🗼",
    baseCost: 850,
    description: "Improves scouting and early warnings.",
  },
  guardpost: {
    name: "Guard Post",
    emoji: "🛡️",
    baseCost: 600,
    description: "Improves local defense and militia.",
  },
};
const DEFENSE_PARTS = {
  walls: { emoji: "🧱", name: "Walls", max: 100 },
  towers: { emoji: "🗼", name: "Towers", max: 100 },
  gates: { emoji: "🚪", name: "Gates", max: 100 },
  moats: { emoji: "🕳️", name: "Moats", max: 100 },
  guards: { emoji: "🛡️", name: "Guards", max: 100 },
  traps: { emoji: "🪤", name: "Traps", max: 100 },
  barrier: { emoji: "🔮", name: "Barrier", max: 100 },
};
async function ensureProperty(threadID, userID) {
  await db.query(
    `
    INSERT INTO rpg_properties (
      thread_id, user_id, tier, name, maintenance,
      walls, towers, gates, moats, guards, traps, barrier, updated_at
    )
    VALUES ($1, $2, 0, NULL, 0, 0, 0, 0, 0, 0, 0, 0, $3)
    ON CONFLICT (thread_id, user_id) DO NOTHING
    `,
    [String(threadID), String(userID), Date.now()]
  );
}
async function getProperty(threadID, userID) {
  await ensureProperty(threadID, userID);
  const result = await db.query(
    `
    SELECT *
    FROM rpg_properties
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID)]
  );
  return result.rows[0];
}
async function getBuildings(threadID, userID) {
  const result = await db.query(
    `
    SELECT building_key, level
    FROM rpg_buildings
    WHERE thread_id = $1
      AND user_id = $2
    ORDER BY building_key
    `,
    [String(threadID), String(userID)]
  );
  return result.rows;
}
async function buyProperty(threadID, userID, requestedKey) {
  const property = await getProperty(threadID, userID);
  const currentTier = Number(property.tier);
  const targetIndex = PROPERTY_TIERS.findIndex(
    (tier) => tier.key === String(requestedKey || "").toLowerCase()
  );
  if (targetIndex <= 0 || targetIndex !== currentTier + 1) {
    const next = PROPERTY_TIERS[currentTier + 1];
    throw new Error(
      next
        ? `Your next property upgrade is ${next.name}.`
        : "Your domain has reached the current progression limit."
    );
  }
  const target = PROPERTY_TIERS[targetIndex];
  await db.spendBalance(
    threadID,
    userID,
    target.cost,
    `RPG property: ${target.name}`
  );
  await db.query(
    `
    UPDATE rpg_properties
    SET tier = $3,
        name = $4,
        maintenance = $5,
        updated_at = $6
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      targetIndex,
      target.name,
      target.upkeep,
      Date.now(),
    ]
  );
  await db.query(
    `
    UPDATE rpg_players
    SET property_tier = $3,
        property_name = $4,
        updated_at = $5
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      targetIndex,
      target.name,
      Date.now(),
    ]
  );
  return target;
}
async function build(threadID, userID, buildingKey) {
  const property = await getProperty(threadID, userID);
  const key = String(buildingKey || "").toLowerCase();
  const definition = BUILDINGS[key];
  if (!definition) {
    throw new Error(`Choose a building: ${Object.keys(BUILDINGS).join(", ")}.`);
  }
  if (Number(property.tier) < 1) {
    throw new Error("Buy a cottage before building inside your domain.");
  }
  const result = await db.query(
    `
    SELECT level
    FROM rpg_buildings
    WHERE thread_id = $1
      AND user_id = $2
      AND building_key = $3
    `,
    [String(threadID), String(userID), key]
  );
  const currentLevel = Number(result.rows[0]?.level || 0);
  const nextLevel = currentLevel + 1;
  const cost = definition.baseCost * nextLevel;
  await db.spendBalance(
    threadID,
    userID,
    cost,
    `RPG building: ${buildingKey} level ${nextLevel}`
  );
  await db.query(
    `
    INSERT INTO rpg_buildings (
      thread_id, user_id, building_key, level, updated_at
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (thread_id, user_id, building_key)
    DO UPDATE SET level = EXCLUDED.level,
                  updated_at = EXCLUDED.updated_at
    `,
    [
      String(threadID),
      String(userID),
      key,
      nextLevel,
      Date.now(),
    ]
  );
  return { definition, level: nextLevel, cost };
}
async function improveDefense(threadID, userID, part) {
  const key = String(part || "").toLowerCase();
  const definition = DEFENSE_PARTS[key];
  if (!definition) {
    throw new Error(`Choose a defense: ${Object.keys(DEFENSE_PARTS).join(", ")}.`);
  }
  const property = await getProperty(threadID, userID);
  const current = Number(property[key] || 0);
  const next = Math.min(100, current + 10);
  if (current >= 100) {
    throw new Error(`${definition.name} are already fully upgraded.`);
  }
  const cost = 750 + current * 25;
  await db.spendBalance(
    threadID,
    userID,
    cost,
    `RPG defense: ${definition.name}`
  );
  await db.query(
    `
    UPDATE rpg_properties
    SET ${key} = $3,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID), next, Date.now()]
  );
  return { definition, level: next, cost };
}
function propertyTier(tier) {
  return PROPERTY_TIERS[Number(tier)] || PROPERTY_TIERS[0];
}
function propertySummary(property) {
  const tier = propertyTier(property.tier);
  return {
    tier,
    maintenance: Number(property.maintenance || tier.upkeep),
    defense: Object.fromEntries(
      Object.keys(DEFENSE_PARTS).map((key) => [key, Number(property[key] || 0)])
    ),
    maintenanceText: `${formatNumber(
      Number(property.maintenance || tier.upkeep)
    )} coins/day`,
  };
}
module.exports = {
  BUILDINGS,
  DEFENSE_PARTS,
  PROPERTY_TIERS,
  build,
  buyProperty,
  getBuildings,
  getProperty,
  improveDefense,
  propertySummary,
  propertyTier,
};
