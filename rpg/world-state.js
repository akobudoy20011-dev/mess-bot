"use strict";

/**
 * ECLIPSE RPG — WORLD STATE
 * =========================
 *
 * Single source of truth for:
 * - Season
 * - Weather
 * - Active world events
 * - Region modifiers
 * - Affinity modifiers
 * - Monster modifiers
 * - XP / gold / loot modifiers
 *
 * This prevents duplicate multiplier calculations across:
 * combat.js
 * exploration.js
 * adventure.js
 * affinities.js
 * events.js
 */

const db = require("../db");

const {
  ensureWorldState,
  getWorldSeason,
} = require("./seasons");

const {
  getWorldWeather,
} = require("./weather");

const {
  getActiveWorldEvents,
  getEvent,
  getAffinityEventMultiplier,
  getRegionEventModifiers,
  getMonsterEventMultiplierForWorld,
  getWorldEventRewardModifiers,
  hasWorldEventRule,
} = require("./events");

const {
  getAffinity,
} = require("./affinities");


// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_WORLD_STATE = {
  season: "spring",
  weather: "clear",
  region: "greenvale",
};


// ============================================================
// WORLD STATE
// ============================================================

async function getWorldState(threadID, regionID = null) {
  await ensureWorldState(threadID);

  const season = await getWorldSeason(threadID);
  const weather = await getWorldWeather(threadID);

  const events = await getActiveWorldEvents(threadID);

  return {
    threadID: String(threadID),

    season:
      typeof season === "string"
        ? season
        : season?.id || "spring",

    weather:
      typeof weather === "string"
        ? weather
        : weather?.id || "clear",

    region: regionID || null,

    events: events.map(row => ({
      id: row.event_id,
      type: row.event_type,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      definition: getEvent(row.event_id),
    })),
  };
}


// ============================================================
// ACTIVE EVENT DEFINITIONS
// ============================================================

async function getActiveEventDefinitions(threadID) {
  const rows = await getActiveWorldEvents(threadID);

  return rows
    .map(row => getEvent(row.event_id))
    .filter(Boolean);
}


// ============================================================
// AFFINITY MULTIPLIER
// ============================================================

async function getWorldAffinityMultiplier(
  threadID,
  affinityID,
  regionID = null
) {
  const state = await getWorldState(
    threadID,
    regionID
  );

  let multiplier = 1;

  /*
   * Event modifiers are handled here.
   *
   * Season/weather/region base modifiers should be
   * provided by affinities.js.
   */
  multiplier *= await getAffinityEventMultiplier(
    threadID,
    affinityID
  );

  /*
   * Region-specific world event bonuses.
   *
   * These are intentionally NOT the same as the
   * base region affinity modifiers.
   */
  if (regionID) {
    const regionModifier =
      await getRegionEventModifiers(
        threadID,
        regionID
      );

    /*
     * Enemy/reward modifiers should not directly
     * alter affinity damage.
     */
    void regionModifier;
  }

  return {
    multiplier,
    season: state.season,
    weather: state.weather,
  };
}


// ============================================================
// REGION MODIFIERS
// ============================================================

async function getWorldRegionModifiers(
  threadID,
  regionID
) {
  const state = await getWorldState(
    threadID,
    regionID
  );

  const eventModifiers =
    await getRegionEventModifiers(
      threadID,
      regionID
    );

  return {
    regionID,

    season: state.season,

    weather: state.weather,

    enemyMultiplier:
      eventModifiers.enemyMultiplier,

    rewardMultiplier:
      eventModifiers.rewardMultiplier,
  };
}


// ============================================================
// MONSTER MODIFIERS
// ============================================================

async function getWorldMonsterMultiplier(
  threadID,
  monsterID
) {
  return getMonsterEventMultiplierForWorld(
    threadID,
    monsterID
  );
}


// ============================================================
// REWARD MODIFIERS
// ============================================================

async function getWorldRewards(
  threadID,
  regionID = null
) {
  return getWorldEventRewardModifiers(
    threadID,
    regionID
  );
}


// ============================================================
// COMBINED ENCOUNTER MODIFIERS
// ============================================================

async function getEncounterModifiers(
  threadID,
  {
    regionID = null,
    monsterID = null,
  } = {}
) {
  const region =
    regionID
      ? await getWorldRegionModifiers(
          threadID,
          regionID
        )
      : {
          enemyMultiplier: 1,
          rewardMultiplier: 1,
        };

  const monster =
    monsterID
      ? await getWorldMonsterMultiplier(
          threadID,
          monsterID
        )
      : 1;

  const rewards =
    await getWorldRewards(
      threadID,
      regionID
    );

  return {
    enemyMultiplier:
      region.enemyMultiplier *
      monster,

    rewardMultiplier:
      region.rewardMultiplier *
      rewards.goldMultiplier,

    xpMultiplier:
      rewards.xpMultiplier,

    rareLootChance:
      rewards.rareLootChance,
  };
}


// ============================================================
// WORLD RULES
// ============================================================

async function worldHasRule(
  threadID,
  ruleID
) {
  return hasWorldEventRule(
    threadID,
    ruleID
  );
}


// ============================================================
// EVENT CHECKS
// ============================================================

async function isEclipseActive(threadID) {
  return !!(
    await getEventState(
      threadID,
      "eclipse"
    )
  );
}

async function isMeteorShowerActive(threadID) {
  return !!(
    await getEventState(
      threadID,
      "meteor_shower"
    )
  );
}

async function isVolcanicEruptionActive(threadID) {
  return !!(
    await getEventState(
      threadID,
      "volcanic_eruption"
    )
  );
}

async function isEternalWinterActive(threadID) {
  return !!(
    await getEventState(
      threadID,
      "eternal_winter"
    )
  );
}

async function isWorldBloomActive(threadID) {
  return !!(
    await getEventState(
      threadID,
      "world_bloom"
    )
  );
}

async function isSolarBlessingActive(threadID) {
  return !!(
    await getEventState(
      threadID,
      "solar_blessing"
    )
  );
}

async function isAbyssalRiftActive(threadID) {
  return !!(
    await getEventState(
      threadID,
      "abyssal_rift"
    )
  );
}

async function getEventState(
  threadID,
  eventID
) {
  const events =
    await getActiveWorldEvents(threadID);

  return events.find(
    event =>
      event.event_id === eventID
  ) || null;
}


// ============================================================
// REGION SAFETY
// ============================================================

async function getWorldDanger(
  threadID,
  regionID,
  monsterID = null
) {
  const modifiers =
    await getEncounterModifiers(
      threadID,
      {
        regionID,
        monsterID,
      }
    );

  let danger = 1;

  danger *= modifiers.enemyMultiplier;

  if (danger < 0.75) {
    danger = 0.75;
  }

  if (danger > 3) {
    danger = 3;
  }

  return danger;
}


// ============================================================
// DISPLAY
// ============================================================

function formatWorldState(state) {
  const lines = [
    "🌍 ECLIPSE WORLD",
    "",
    `Season: ${state.season}`,
    `Weather: ${state.weather}`,
  ];

  if (state.region) {
    lines.push(
      `Region: ${state.region}`
    );
  }

  lines.push("");

  if (!state.events?.length) {
    lines.push(
      "World Event: None"
    );
  } else {
    lines.push(
      "Active Events:"
    );

    for (const event of state.events) {
      const definition =
        event.definition;

      lines.push(
        `${definition?.symbol || "✦"} ` +
        `${definition?.name || event.id}`
      );
    }
  }

  return lines.join("\n");
}


// ============================================================
// DATABASE SYNC
// ============================================================

async function syncWorldState(threadID) {
  await ensureWorldState(threadID);

  const state =
    await getWorldState(threadID);

  /*
   * Keep the world-state table timestamp fresh.
   */
  await db.query(
    `
      UPDATE rpg_world_state
      SET updated_at = NOW()
      WHERE thread_id = $1
    `,
    [String(threadID)]
  );

  return state;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  DEFAULT_WORLD_STATE,

  getWorldState,
  syncWorldState,

  getActiveEventDefinitions,

  getWorldAffinityMultiplier,
  getWorldRegionModifiers,
  getWorldMonsterMultiplier,

  getWorldRewards,

  getEncounterModifiers,

  worldHasRule,

  isEclipseActive,
  isMeteorShowerActive,
  isVolcanicEruptionActive,
  isEternalWinterActive,
  isWorldBloomActive,
  isSolarBlessingActive,
  isAbyssalRiftActive,

  getEventState,

  getWorldDanger,

  formatWorldState,
};
