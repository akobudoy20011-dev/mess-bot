"use strict";

/**
 * ECLIPSE RPG — SEASONS
 * =====================
 *
 * Persistent global season system.
 *
 * Seasons:
 *   Spring
 *   Summer
 *   Autumn
 *   Winter
 *
 * Nature affinity can manipulate the global season through
 * weather/world commands later.
 */

const db = require("../db");

// ============================================================
// CONFIG
// ============================================================

const SEASONS = {
  spring: {
    id: "spring",
    name: "Spring",
    symbol: "🌱",

    description:
      "Life returns to the world. Nature and Water flourish.",

    affinities: {
      nature: 1.30,
      water: 1.10,
      wind: 1.15,
      earth: 1.00,
      fire: 1.00,
      ice: 0.95,
      lightning: 1.00,
      light: 1.05,
      divine: 1.05,
      arcane: 1.00,
      shadow: 1.00,
      necromancy: 0.95,
      blood: 1.00,
    },

    weatherWeights: {
      clear: 25,
      rain: 40,
      fog: 15,
      storm: 10,
      heat: 0,
      snow: 10,
    },
  },

  summer: {
    id: "summer",
    name: "Summer",
    symbol: "☀️",

    description:
      "The world burns beneath a powerful sun. Fire thrives.",

    affinities: {
      fire: 1.20,
      light: 1.10,
      divine: 1.10,
      nature: 1.10,
      water: 1.05,
      wind: 1.00,
      lightning: 1.05,
      arcane: 1.00,
      earth: 0.95,
      blood: 1.00,
      shadow: 0.90,
      necromancy: 0.90,
      ice: 0.90,
    },

    weatherWeights: {
      clear: 45,
      rain: 15,
      fog: 5,
      storm: 15,
      heat: 20,
      snow: 0,
    },
  },

  autumn: {
    id: "autumn",
    name: "Autumn",
    symbol: "🍂",

    description:
      "The world enters its fading season. Earth and Blood grow stronger.",

    affinities: {
      earth: 1.15,
      blood: 1.05,
      wind: 1.10,
      nature: 1.05,
      fire: 1.00,
      water: 1.00,
      lightning: 1.00,
      light: 1.00,
      divine: 1.00,
      arcane: 1.00,
      shadow: 1.00,
      necromancy: 1.05,
      ice: 1.00,
    },

    weatherWeights: {
      clear: 25,
      rain: 25,
      fog: 15,
      storm: 15,
      heat: 5,
      snow: 15,
    },
  },

  winter: {
    id: "winter",
    name: "Winter",
    symbol: "❄️",

    description:
      "The world freezes. Ice and dark affinities awaken.",

    affinities: {
      ice: 1.25,
      shadow: 1.10,
      necromancy: 1.15,
      earth: 1.05,
      fire: 0.90,
      nature: 0.90,
      water: 1.00,
      wind: 1.00,
      lightning: 1.00,
      light: 0.95,
      divine: 1.00,
      arcane: 1.00,
      blood: 1.00,
    },

    weatherWeights: {
      clear: 15,
      rain: 10,
      fog: 20,
      storm: 10,
      heat: 0,
      snow: 45,
    },
  },
};

// ============================================================
// DEFAULT
// ============================================================

const DEFAULT_SEASON = "spring";

// ============================================================
// NORMALIZATION
// ============================================================

function normalizeSeason(value) {
  if (!value) return DEFAULT_SEASON;

  const id = String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  return SEASONS[id] ? id : DEFAULT_SEASON;
}

// ============================================================
// GETTERS
// ============================================================

function getSeason(seasonID) {
  return SEASONS[normalizeSeason(seasonID)];
}

function getAllSeasons() {
  return Object.values(SEASONS);
}

function getSeasonAffinityMultiplier(
  seasonID,
  affinityID
) {
  const season = getSeason(seasonID);

  if (!season) return 1;

  return Number(
    season.affinities?.[
      String(affinityID || "").toLowerCase()
    ] || 1
  );
}

// ============================================================
// RANDOM WEATHER WEIGHTS
// ============================================================

function getSeasonWeatherWeights(seasonID) {
  const season = getSeason(seasonID);

  return {
    ...(season?.weatherWeights || {}),
  };
}

// ============================================================
// NEXT SEASON
// ============================================================

function getNextSeason(seasonID) {
  const order = [
    "spring",
    "summer",
    "autumn",
    "winter",
  ];

  const current = normalizeSeason(seasonID);
  const index = order.indexOf(current);

  return order[
    (index + 1) % order.length
  ];
}

// ============================================================
// PERSISTENT WORLD STATE
// ============================================================

async function ensureWorldState(threadID) {
  const result = await db.query(
    `
      INSERT INTO rpg_world_state
        (
          thread_id,
          season,
          weather,
          updated_at
        )
      VALUES
        ($1, $2, 'clear', NOW())
      ON CONFLICT (thread_id)
      DO NOTHING
      RETURNING *
    `,
    [
      String(threadID),
      DEFAULT_SEASON,
    ]
  );

  if (result.rows.length) {
    return result.rows[0];
  }

  const existing = await db.query(
    `
      SELECT *
      FROM rpg_world_state
      WHERE thread_id = $1
      LIMIT 1
    `,
    [String(threadID)]
  );

  return existing.rows[0] || null;
}

async function getWorldSeason(threadID) {
  await ensureWorldState(threadID);

  const result = await db.query(
    `
      SELECT season
      FROM rpg_world_state
      WHERE thread_id = $1
      LIMIT 1
    `,
    [String(threadID)]
  );

  return normalizeSeason(
    result.rows[0]?.season
  );
}

async function setWorldSeason(
  threadID,
  seasonID,
  options = {}
) {
  const season = normalizeSeason(seasonID);

  await ensureWorldState(threadID);

  const result = await db.query(
    `
      UPDATE rpg_world_state
      SET
        season = $2,
        updated_at = NOW()
      WHERE thread_id = $1
      RETURNING *
    `,
    [
      String(threadID),
      season,
    ]
  );

  return {
    ...result.rows[0],
    season,
    changedByNature:
      options.changedByNature === true,
    reason: options.reason || null,
  };
}

// ============================================================
// SEASON PROGRESSION
// ============================================================

async function advanceSeason(threadID) {
  const current =
    await getWorldSeason(threadID);

  const next =
    getNextSeason(current);

  return setWorldSeason(
    threadID,
    next,
    {
      reason: "season_cycle",
    }
  );
}

// ============================================================
// FORMATTING
// ============================================================

function formatSeason(seasonID) {
  const season = getSeason(seasonID);

  if (!season) {
    return "Unknown season.";
  }

  return [
    `${season.symbol} ${season.name}`,
    season.description,
  ].join("\n");
}

module.exports = {
  SEASONS,
  DEFAULT_SEASON,

  normalizeSeason,
  getSeason,
  getAllSeasons,
  getSeasonAffinityMultiplier,
  getSeasonWeatherWeights,

  getNextSeason,

  ensureWorldState,
  getWorldSeason,
  setWorldSeason,
  advanceSeason,

  formatSeason,
};
