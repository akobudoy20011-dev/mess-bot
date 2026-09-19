"use strict";

const db = require("../db");
const { REGIONS, resolveRegion } = require("./world");
const { normalizeKey, formatNumber } = require("./utils");

// ============================================================
// KINGDOM DEFINITIONS
// ============================================================

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

// ============================================================
// INTERNAL HELPERS
// ============================================================

function normalizeKingdomId(kingdomId) {
  if (!kingdomId) return null;

  const normalized = normalizeKey(
    String(kingdomId)
  );

  return Object.prototype.hasOwnProperty.call(
    KINGDOMS,
    normalized
  )
    ? normalized
    : null;
}

function getKingdomDefinition(kingdomId) {
  const normalized = normalizeKingdomId(
    kingdomId
  );

  return normalized
    ? KINGDOMS[normalized]
    : null;
}

// ============================================================
// KINGDOM INITIALIZATION
// ============================================================

async function ensureKingdoms(threadID) {
  const threadKey = String(threadID);
  const now = Date.now();

  for (const [id, def] of Object.entries(KINGDOMS)) {
    // --------------------------------------------------------
    // Ensure kingdom row exists.
    // --------------------------------------------------------

    await db.query(
      `
      INSERT INTO rpg_kingdoms (
        thread_id,
        kingdom_id,
        name,
        specialization,
        capital_location_id,
        treasury,
        military,
        magic,
        stability,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        70,
        $9,
        $9
      )
      ON CONFLICT (
        thread_id,
        kingdom_id
      )
      DO NOTHING
      `,
      [
        threadKey,
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

    // --------------------------------------------------------
    // Ensure the kingdom's capital is initially owned by it.
    //
    // Do not overwrite an existing owner. Once territory has
    // changed hands, this initializer must never take it back.
    // --------------------------------------------------------

    await db.query(
      `
      UPDATE rpg_location_states
      SET
        owner_kingdom_id = $3
      WHERE thread_id = $1
        AND location_id = $2
        AND owner_kingdom_id IS NULL
      `,
      [
        threadKey,
        def.capitalLocationId,
        id,
      ]
    );
  }

  return true;
}

// ============================================================
// KINGDOM LOOKUP
// ============================================================

async function getKingdom(
  threadID,
  kingdomId
) {
  const normalized =
    normalizeKingdomId(kingdomId);

  if (!normalized) {
    return null;
  }

  /*
   * Self-seed the kingdom table for this thread.
   *
   * This is important because a new thread may call
   * !kingdom / pledge / territory before another command
   * has initialized the kingdom rows.
   */
  await ensureKingdoms(threadID);

  const result = await db.query(
    `
    SELECT *
    FROM rpg_kingdoms
    WHERE thread_id = $1
      AND kingdom_id = $2
    LIMIT 1
    `,
    [
      String(threadID),
      normalized,
    ]
  );

  return result.rows[0] || null;
}

// ============================================================
// LIST KINGDOMS
// ============================================================

async function listKingdoms(threadID) {
  await ensureKingdoms(threadID);

  const result = await db.query(
    `
    SELECT *
    FROM rpg_kingdoms
    WHERE thread_id = $1
    ORDER BY kingdom_id
    `,
    [String(threadID)]
  );

  return result.rows;
}

// ============================================================
// KINGDOM TERRITORY
// ============================================================

async function getKingdomTerritory(
  threadID,
  kingdomId
) {
  const normalized =
    normalizeKingdomId(kingdomId);

  if (!normalized) {
    return [];
  }

  const result = await db.query(
    `
    SELECT
      location_id,
      garrison,
      defense,
      prosperity
    FROM rpg_location_states
    WHERE thread_id = $1
      AND owner_kingdom_id = $2
    ORDER BY location_id
    `,
    [
      String(threadID),
      normalized,
    ]
  );

  return result.rows;
}

// ============================================================
// LOCATION OWNER
// ============================================================

async function getLocationOwner(
  threadID,
  locationId
) {
  if (!locationId) {
    return null;
  }

  const result = await db.query(
    `
    SELECT owner_kingdom_id
    FROM rpg_location_states
    WHERE thread_id = $1
      AND location_id = $2
    LIMIT 1
    `,
    [
      String(threadID),
      String(locationId),
    ]
  );

  return (
    result.rows[0]?.owner_kingdom_id ||
    null
  );
}

// ============================================================
// PLEDGE TO KINGDOM
// ============================================================

async function pledgeToKingdom(
  threadID,
  userID,
  kingdomId
) {
  const normalized =
    normalizeKingdomId(kingdomId);

  if (!normalized) {
    throw new Error(
      `Choose a kingdom: ${Object.keys(KINGDOMS).join(", ")}.`
    );
  }

  const kingdom = await getKingdom(
    threadID,
    normalized
  );

  if (!kingdom) {
    throw new Error(
      `Choose a kingdom: ${Object.keys(KINGDOMS).join(", ")}.`
    );
  }

  const playerResult =
    await db.query(
      `
      SELECT
        kingdom_id,
        traitor,
        traitor_kingdom_id
      FROM rpg_players
      WHERE thread_id = $1
        AND user_id = $2
      LIMIT 1
      `,
      [
        String(threadID),
        String(userID),
      ]
    );

  if (!playerResult.rows.length) {
    throw new Error(
      "RPG player profile not found."
    );
  }

  const player =
    playerResult.rows[0];

  /*
   * Prevent silently switching allegiance through this
   * low-level function. Kingdom allegiance should be changed
   * deliberately by the RPG's pledge flow.
   */
  if (
    player.kingdom_id &&
    player.kingdom_id !== normalized
  ) {
    throw new Error(
      `You are already pledged to ${getKingdomDefinition(player.kingdom_id)?.name || player.kingdom_id}.`
    );
  }

  /*
   * A player marked as a traitor remains blocked from simply
   * pledging to a different kingdom.
   */
  if (
    player.traitor &&
    player.traitor_kingdom_id &&
    player.traitor_kingdom_id !== normalized
  ) {
    throw new Error(
      "Your traitor status prevents you from pledging to this kingdom."
    );
  }

  const now = Date.now();

  const result = await db.query(
    `
    UPDATE rpg_players
    SET
      kingdom_id = $3,
      kingdom_role = 'vassal',
      updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    RETURNING
      kingdom_id,
      kingdom_role,
      traitor,
      traitor_kingdom_id
    `,
    [
      String(threadID),
      String(userID),
      kingdom.kingdom_id,
      now,
    ]
  );

  if (!result.rows.length) {
    throw new Error(
      "Failed to update RPG kingdom allegiance."
    );
  }

  return kingdom;
}

// ============================================================
// KINGDOM SUMMARY
// ============================================================

function kingdomSummary(
  kingdom,
  territory
) {
  if (!kingdom) {
    return [
      "🏰 Unknown Kingdom",
    ];
  }

  const def =
    KINGDOMS[
      kingdom.kingdom_id
    ];

  const territoryCount =
    Array.isArray(territory)
      ? territory.length
      : 0;

  return [
    (def?.emoji || "🏰") +
      " " +
      kingdom.name,

    "🏷️ Specialization: " +
      (kingdom.specialization || "unknown"),

    "💰 Treasury: " +
      formatNumber(
        Number(kingdom.treasury || 0)
      ) +
      " coins",

    "⚔️ Military strength: " +
      formatNumber(
        Number(kingdom.military || 0)
      ),

    "🔮 Magical strength: " +
      formatNumber(
        Number(kingdom.magic || 0)
      ),

    "🏛️ Stability: " +
      Number(
        kingdom.stability ?? 0
      ) +
      "%",

    "🗺️ Territory: " +
      territoryCount +
      " location(s)",
  ];
}

// ============================================================
// EXPORTS
// ============================================================

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
