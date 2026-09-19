"use strict";

/**
 * ECLIPSE RPG — WEATHER
 * =====================
 *
 * Persistent global weather system.
 *
 * Weather:
 *   clear
 *   rain
 *   storm
 *   snow
 *   fog
 *   heat
 *
 * Weather affects:
 *   - affinity power
 *   - combat
 *   - exploration
 *   - world events
 *   - Nature abilities
 */

const db = require("../db");

const {
  getSeason,
  getSeasonWeatherWeights,
  getWorldSeason,
} = require("./seasons");

// ============================================================
// WEATHER DEFINITIONS
// ============================================================

const WEATHER = {
  clear: {
    id: "clear",
    name: "Clear Skies",
    symbol: "☀️",

    description:
      "The sky is calm and visibility is excellent.",

    affinities: {
      fire: 1.00,
      ice: 1.00,
      lightning: 1.00,
      nature: 1.05,
      light: 1.20,
      divine: 1.15,
      arcane: 1.05,
      shadow: 0.95,
      necromancy: 1.00,
      blood: 1.00,
      water: 1.00,
      wind: 1.10,
      earth: 1.10,
    },
  },

  rain: {
    id: "rain",
    name: "Rain",
    symbol: "🌧️",

    description:
      "Steady rainfall covers the world.",

    affinities: {
      fire: 0.90,
      ice: 1.10,
      lightning: 1.10,
      nature: 1.20,
      light: 0.95,
      divine: 1.00,
      arcane: 1.00,
      shadow: 1.00,
      necromancy: 1.00,
      blood: 1.00,
      water: 1.30,
      wind: 1.00,
      earth: 0.95,
    },
  },

  storm: {
    id: "storm",
    name: "Storm",
    symbol: "⛈️",

    description:
      "Thunder and violent winds tear across the sky.",

    affinities: {
      fire: 0.95,
      ice: 1.00,
      lightning: 1.30,
      nature: 1.00,
      light: 0.90,
      divine: 0.95,
      arcane: 1.05,
      shadow: 1.05,
      necromancy: 1.00,
      blood: 1.05,
      water: 1.15,
      wind: 1.20,
      earth: 0.95,
    },
  },

  snow: {
    id: "snow",
    name: "Snow",
    symbol: "🌨️",

    description:
      "A freezing snowfall blankets the world.",

    affinities: {
      fire: 0.85,
      ice: 1.20,
      lightning: 0.95,
      nature: 0.90,
      light: 0.95,
      divine: 1.00,
      arcane: 1.00,
      shadow: 1.10,
      necromancy: 1.15,
      blood: 1.00,
      water: 1.05,
      wind: 1.00,
      earth: 1.05,
    },
  },

  fog: {
    id: "fog",
    name: "Mystic Fog",
    symbol: "🌫️",

    description:
      "A supernatural mist obscures the battlefield.",

    affinities: {
      fire: 0.95,
      ice: 1.00,
      lightning: 0.90,
      nature: 1.05,
      light: 0.90,
      divine: 0.95,
      arcane: 1.10,
      shadow: 1.15,
      necromancy: 1.20,
      blood: 1.00,
      water: 1.05,
      wind: 0.90,
      earth: 1.00,
    },
  },

  heat: {
    id: "heat",
    name: "Scorching Heat",
    symbol: "🔥",

    description:
      "A wave of unnatural heat grips the world.",

    affinities: {
      fire: 1.15,
      ice: 0.85,
      lightning: 1.00,
      nature: 0.95,
      light: 1.05,
      divine: 1.05,
      arcane: 1.00,
      shadow: 1.00,
      necromancy: 0.95,
      blood: 1.05,
      water: 0.95,
      wind: 1.00,
      earth: 1.00,
    },
  },
};

// ============================================================
// NORMALIZATION
// ============================================================

function normalizeWeather(value) {
  if (!value) return "clear";

  const id = String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  return WEATHER[id] ? id : "clear";
}

// ============================================================
// GETTERS
// ============================================================

function getWeather(weatherID) {
  return WEATHER[
    normalizeWeather(weatherID)
  ];
}

function getAllWeather() {
  return Object.values(WEATHER);
}

function getWeatherAffinityMultiplier(
  weatherID,
  affinityID
) {
  const weather =
    getWeather(weatherID);

  return Number(
    weather.affinities?.[
      String(affinityID || "").toLowerCase()
    ] || 1
  );
}

// ============================================================
// RANDOM WEATHER
// ============================================================

function weightedRandom(weights) {
  const entries =
    Object.entries(weights || {})
      .filter(
        ([weather, weight]) =>
          WEATHER[weather] &&
          Number(weight) > 0
      );

  if (!entries.length) {
    return "clear";
  }

  const total = entries.reduce(
    (sum, [, weight]) =>
      sum + Number(weight),
    0
  );

  let roll =
    Math.random() * total;

  for (const [weather, weight] of entries) {
    roll -= Number(weight);

    if (roll <= 0) {
      return weather;
    }
  }

  return entries[
    entries.length - 1
  ][0];
}

async function rollWeatherForSeason(
  seasonID
) {
  const weights =
    getSeasonWeatherWeights(
      seasonID
    );

  return weightedRandom(weights);
}

async function rollWeather(threadID) {
  const season =
    await getWorldSeason(threadID);

  return rollWeatherForSeason(
    season
  );
}

// ============================================================
// WORLD STATE
// ============================================================

async function getWorldWeather(threadID) {
  const result = await db.query(
    `
      SELECT weather
      FROM rpg_world_state
      WHERE thread_id = $1
      LIMIT 1
    `,
    [String(threadID)]
  );

  return normalizeWeather(
    result.rows[0]?.weather
  );
}

async function setWorldWeather(
  threadID,
  weatherID,
  options = {}
) {
  const weather =
    normalizeWeather(weatherID);

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
        ($1, 'spring', $2, NOW())
      ON CONFLICT (thread_id)
      DO UPDATE SET
        weather = EXCLUDED.weather,
        updated_at = NOW()
      RETURNING *
    `,
    [
      String(threadID),
      weather,
    ]
  );

  return {
    ...result.rows[0],
    weather,
    changedByNature:
      options.changedByNature === true,
    reason: options.reason || null,
  };
}

async function rerollWorldWeather(
  threadID,
  options = {}
) {
  const season =
    await getWorldSeason(threadID);

  const weather =
    await rollWeatherForSeason(
      season
    );

  return setWorldWeather(
    threadID,
    weather,
    {
      ...options,
      reason:
        options.reason ||
        "weather_cycle",
    }
  );
}

// ============================================================
// WEATHER + SEASON COMBINED MULTIPLIER
// ============================================================

async function getWorldAffinityMultiplier(
  threadID,
  affinityID
) {
  const season =
    await getWorldSeason(threadID);

  const weather =
    await getWorldWeather(threadID);

  const seasonMultiplier =
    getSeason(
      season
    )?.affinities?.[
      String(affinityID || "").toLowerCase()
    ] || 1;

  const weatherMultiplier =
    getWeatherAffinityMultiplier(
      weather,
      affinityID
    );

  return Number(
    seasonMultiplier
  ) * Number(
    weatherMultiplier
  );
}

// ============================================================
// NATURE CONTROL
// ============================================================

async function natureChangeWeather(
  threadID,
  weatherID
) {
  return setWorldWeather(
    threadID,
    weatherID,
    {
      changedByNature: true,
      reason: "nature_magic",
    }
  );
}

async function natureChangeSeason(
  threadID,
  seasonID
) {
  const {
    setWorldSeason,
  } = require("./seasons");

  return setWorldSeason(
    threadID,
    seasonID,
    {
      changedByNature: true,
      reason: "nature_magic",
    }
  );
}

// ============================================================
// WORLD SNAPSHOT
// ============================================================

async function getWorldConditions(
  threadID
) {
  const season =
    await getWorldSeason(threadID);

  const weather =
    await getWorldWeather(threadID);

  const seasonData =
    getSeason(season);

  const weatherData =
    getWeather(weather);

  return {
    season,
    seasonData,
    weather,
    weatherData,
  };
}

// ============================================================
// FORMATTING
// ============================================================

async function formatWorldConditions(
  threadID
) {
  const state =
    await getWorldConditions(
      threadID
    );

  return [
    "╔══════════════════════╗",
    "      ECLIPSE WORLD",
    "╚══════════════════════╝",
    "",
    `${state.seasonData.symbol} Season: ${state.seasonData.name}`,
    `${state.weatherData.symbol} Weather: ${state.weatherData.name}`,
    "",
    state.seasonData.description,
    state.weatherData.description,
  ].join("\n");
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  WEATHER,

  normalizeWeather,
  getWeather,
  getAllWeather,

  getWeatherAffinityMultiplier,

  weightedRandom,
  rollWeatherForSeason,
  rollWeather,

  getWorldWeather,
  setWorldWeather,
  rerollWorldWeather,

  getWorldAffinityMultiplier,

  natureChangeWeather,
  natureChangeSeason,

  getWorldConditions,
  formatWorldConditions,
};
