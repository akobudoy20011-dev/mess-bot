const db = require("../db");
const { REGIONS, resolveRegion } = require("./world");
const { normalizeKey, formatNumber } = require("./utils");

const KINGDOMS = {
  ashen_dominion: {
    name: "The Ashen Dominion",
    emoji: "🔥",
    specialization: "military",
    capitalLocationId: "eclipse_castle",
    homeRegion: "greenvale",
    baseTreasury: 8_000,
    baseMilitary: 800,
    baseMagic: 100,
  },
  silver_conclave: {
    name: "The Silver Conclave",
    emoji: "🔮",
    specialization: "magic",
    capitalLocationId: "starfall",
    homeRegion: "celestial_lands",
    baseTreasury: 6_000,
    baseMilitary: 300,
    baseMagic: 900,
  },
  ironspine_hold: {
    name: "Ironspine Hold",
    emoji: "⛰️",
    specialization: "trade",
    capitalLocationId: "stonehold",
    homeRegion: "ironspine",
    baseTreasury: 12_000,
    baseMilitary: 400,
    baseMagic: 150,
  },
  hollow_covenant: {
    name: "The Hollow Covenant",
    emoji: "💀",
    specialization: "necromancy",
    capitalLocationId: "hollow_gate",
    homeRegion: "abyss",
    baseTreasury: 4_000,
    baseMilitary: 500,
    baseMagic: 700,
  },
};

async function ensureKingdoms(threadID) {
  const now = Date.now();
  for (const [id, def] of Object.entries(KINGDOMS)) {
    await db.query(
      `
      INSERT INTO rpg_kingdoms (
        thread_id, kingdom_id, name, specialization, capital_location_id,
        treasury, military, magic, stability, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 70, $9, $9)
      ON CONFLICT (thread_id, kingdom_id) DO NOTHING
      `,
      [
        String(threadID),
        id,
        def.name,
        def.specialization,
        def.capitalLocationId,
        def.baseTreasury,
        def.baseMilitary,
        def.baseMagic,
        now,
      ]
    );

    // Home region locations start owned by their kingdom.
    await db.query(
      `
      UPDATE rpg_location_states
      SET owner_kingdom_id = $3
      WHERE thread_id = $1
        AND location_id IN (
          SELECT location_id FROM rpg_location_states WHERE thread_id = $1
        )
        AND owner_kingdom_id IS NULL
        AND location_id = $2
      `,
      [String(threadID), def.capitalLocationId, id]
    );
  }
}

async function getKingdom(threadID, kingdomId) {
  const result = await db.query(
    `SELECT * FROM rpg_kingdoms WHERE thread_id = $1 AND kingdom_id = $2`,
    [String(threadID), normalizeKey(kingdomId)]
  );
  return result.rows[0] || null;
}

async function listKingdoms(threadID) {
  await ensureKingdoms(threadID);
  const result = await db.query(
    `SELECT * FROM rpg_kingdoms WHERE thread_id = $1 ORDER BY kingdom_id`,
    [String(threadID)]
  );
  return result.rows;
}

async function getKingdomTerritory(threadID, kingdomId) {
  const result = await db.query(
    `
    SELECT location_id, garrison, defense, prosperity
    FROM rpg_location_states
    WHERE thread_id = $1
      AND owner_kingdom_id = $2
    ORDER BY location_id
    `,
    [String(threadID), normalizeKey(kingdomId)]
  );
  return result.rows;
}

async function getLocationOwner(threadID, locationId) {
  const result = await db.query(
    `SELECT owner_kingdom_id FROM rpg_location_states WHERE thread_id = $1 AND location_id = $2`,
    [String(threadID), locationId]
  );
  return result.rows[0]?.owner_kingdom_id || null;
}

async function pledgeToKingdom(threadID, userID, kingdomId) {
  const kingdom = await getKingdom(threadID, kingdomId);
  if (!kingdom) {
    throw new Error(`Choose a kingdom: ${Object.keys(KINGDOMS).join(", ")}.`);
  }

  await db.query(
    `
    UPDATE rpg_players
    SET kingdom_id = $3,
        kingdom_role = 'vassal',
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID), kingdom.kingdom_id, Date.now()]
  );

  return kingdom;
}

function kingdomSummary(kingdom, territory) {
  const def = KINGDOMS[kingdom.kingdom_id];
  return [
    (def?.emoji || "🏰") + " " + kingdom.name,
    "🏷️ Specialization: " + kingdom.specialization,
    "💰 Treasury: " + formatNumber(kingdom.treasury) + " coins",
    "⚔️ Military strength: " + formatNumber(kingdom.military),
    "🔮 Magical strength: " + formatNumber(kingdom.magic),
    "🏛️ Stability: " + kingdom.stability + "%",
    "🗺️ Territory: " + territory.length + " location(s)",
  ];
}

module.exports = {
  KINGDOMS,
  ensureKingdoms,
  getKingdom,
  getKingdomTerritory,
  getLocationOwner,
  kingdomSummary,
  listKingdoms,
  pledgeToKingdom,
};
