"use strict";

/**
 * ECLIPSE RPG — WORLD EVENTS
 * ===========================
 *
 * Persistent world events that alter:
 * - Season
 * - Weather
 * - Affinity power
 * - Region conditions
 * - Monster encounters
 * - Bosses
 * - Rewards
 * - Exploration
 *
 * Events are stored in rpg_world_events and linked to rpg_world_state.
 *
 * Designed to work with:
 *   ./../db
 *   ./seasons
 *   ./weather
 *   ./affinities
 *   ./world
 */

const db = require("../db");

const {
  getSeason,
  setWorldSeason,
} = require("./seasons");

const {
  getWorldWeather,
  setWorldWeather,
} = require("./weather");

const {
  getAffinity,
  getAllAffinities,
} = require("./affinities");


// ============================================================
// CONFIG
// ============================================================

const EVENT_CHECK_INTERVAL_MS = 15 * 60 * 1000;

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

const EVENT_TYPES = {
  WORLD: "world",
  SEASONAL: "seasonal",
  CELESTIAL: "celestial",
  ELEMENTAL: "elemental",
  DIVINE: "divine",
  SHADOW: "shadow",
  NATURE: "nature",
  DISASTER: "disaster",
};


// ============================================================
// WORLD EVENTS
// ============================================================

const EVENTS = {

  eclipse: {
    id: "eclipse",
    name: "The Eclipse",
    type: EVENT_TYPES.CELESTIAL,

    description:
      "The sun disappears behind an unnatural darkness. Shadow and Necromancy surge while Light weakens.",

    symbol: "🌑",

    durationMs: 2 * 60 * 60 * 1000,

    seasonOverride: null,
    weatherOverride: "fog",

    affinityModifiers: {
      shadow: 1.50,
      necromancy: 1.50,
      light: 0.75,
      divine: 0.85,
      arcane: 1.15,
    },

    regionModifiers: {
      abyss: {
        enemyMultiplier: 1.50,
        rewardMultiplier: 1.50,
      },

      moonlit_ruins: {
        enemyMultiplier: 1.35,
        rewardMultiplier: 1.35,
      },

      celestial_lands: {
        enemyMultiplier: 1.25,
        rewardMultiplier: 1.25,
      },
    },

    monsterModifiers: {
      shadow_beast: 1.75,
      hollow_knight: 1.50,
      necromancer: 1.50,
    },

    bossPool: [
      "eclipse_wraith",
      "lord_of_the_hollow",
    ],

    rewards: {
      xpMultiplier: 1.35,
      goldMultiplier: 1.40,
      rareLootChance: 0.15,
    },

    specialRules: {
      night: true,
      shadowSpawns: true,
      lightSpellsReduced: true,
    },
  },


  meteor_shower: {
    id: "meteor_shower",
    name: "Meteor Shower",
    type: EVENT_TYPES.CELESTIAL,

    description:
      "The heavens rain burning fragments across the world. Arcane and Fire energies become unstable.",

    symbol: "☄️",

    durationMs: 90 * 60 * 1000,

    weatherOverride: "heat",

    affinityModifiers: {
      fire: 1.35,
      arcane: 1.40,
      lightning: 1.25,
      ice: 0.90,
      nature: 0.90,
    },

    regionModifiers: {
      scorched_wastes: {
        enemyMultiplier: 1.30,
        rewardMultiplier: 1.60,
      },

      infernal_rift: {
        enemyMultiplier: 1.45,
        rewardMultiplier: 1.75,
      },

      celestial_lands: {
        enemyMultiplier: 1.25,
        rewardMultiplier: 1.50,
      },
    },

    monsterModifiers: {
      ash_drake: 1.80,
      fire_elemental: 1.60,
    },

    bossPool: [
      "meteor_titan",
      "starforged_drake",
    ],

    rewards: {
      xpMultiplier: 1.40,
      goldMultiplier: 1.50,
      rareLootChance: 0.20,
    },

    specialRules: {
      meteorCrystals: true,
      fireDamageBoost: true,
    },
  },


  volcanic_eruption: {
    id: "volcanic_eruption",
    name: "Volcanic Eruption",
    type: EVENT_TYPES.DISASTER,

    description:
      "The earth splits open. Infernal creatures emerge while Fire power surges through the land.",

    symbol: "🌋",

    durationMs: 2 * 60 * 60 * 1000,

    weatherOverride: "heat",

    affinityModifiers: {
      fire: 1.50,
      earth: 1.25,
      water: 0.85,
      ice: 0.75,
      nature: 0.85,
    },

    regionModifiers: {
      infernal_rift: {
        enemyMultiplier: 1.75,
        rewardMultiplier: 1.75,
      },

      scorched_wastes: {
        enemyMultiplier: 1.55,
        rewardMultiplier: 1.60,
      },

      ironspine: {
        enemyMultiplier: 1.20,
        rewardMultiplier: 1.25,
      },
    },

    monsterModifiers: {
      ash_drake: 2.00,
      fire_elemental: 1.75,
      magma_beast: 1.80,
    },

    bossPool: [
      "infernal_colossus",
      "elder_ash_drake",
    ],

    rewards: {
      xpMultiplier: 1.50,
      goldMultiplier: 1.60,
      rareLootChance: 0.18,
    },

    specialRules: {
      fireDamageBoost: true,
      lavaSpawns: true,
    },
  },


  eternal_winter: {
    id: "eternal_winter",
    name: "Eternal Winter",
    type: EVENT_TYPES.SEASONAL,

    description:
      "Winter refuses to end. Frost consumes the land and Ice power reaches unnatural levels.",

    symbol: "❄️",

    durationMs: 3 * 60 * 60 * 1000,

    seasonOverride: "winter",
    weatherOverride: "snow",

    affinityModifiers: {
      ice: 1.60,
      water: 1.25,
      wind: 1.15,
      fire: 0.80,
      nature: 0.75,
    },

    regionModifiers: {
      frostgrave: {
        enemyMultiplier: 1.65,
        rewardMultiplier: 1.70,
      },

      whispering_forest: {
        enemyMultiplier: 1.25,
        rewardMultiplier: 1.30,
      },

      lowlands: {
        enemyMultiplier: 1.20,
        rewardMultiplier: 1.25,
      },
    },

    monsterModifiers: {
      frost_wolf: 1.80,
      ice_elemental: 1.70,
    },

    bossPool: [
      "frost_queen",
      "eternal_wyrm",
    ],

    rewards: {
      xpMultiplier: 1.45,
      goldMultiplier: 1.45,
      rareLootChance: 0.20,
    },

    specialRules: {
      freezingEncounters: true,
      iceDamageBoost: true,
    },
  },


  world_bloom: {
    id: "world_bloom",
    name: "World Bloom",
    type: EVENT_TYPES.NATURE,

    description:
      "Ancient life awakens. The world enters a supernatural Spring and Nature magic flourishes.",

    symbol: "🌸",

    durationMs: 2 * 60 * 60 * 1000,

    seasonOverride: "spring",
    weatherOverride: "rain",

    affinityModifiers: {
      nature: 1.60,
      water: 1.30,
      wind: 1.20,
      earth: 1.15,
      fire: 0.90,
      shadow: 0.85,
      necromancy: 0.75,
    },

    regionModifiers: {
      whispering_forest: {
        enemyMultiplier: 1.40,
        rewardMultiplier: 1.75,
      },

      lowlands: {
        enemyMultiplier: 1.30,
        rewardMultiplier: 1.50,
      },

      azure_coast: {
        enemyMultiplier: 1.20,
        rewardMultiplier: 1.35,
      },
    },

    monsterModifiers: {
      ancient_treant: 1.80,
      bloom_beast: 1.70,
    },

    bossPool: [
      "worldroot_guardian",
      "elder_treant",
    ],

    rewards: {
      xpMultiplier: 1.50,
      goldMultiplier: 1.55,
      rareLootChance: 0.25,
    },

    specialRules: {
      natureHealing: true,
      natureControlsWeather: true,
      rareHerbs: true,
    },
  },


  solar_blessing: {
    id: "solar_blessing",
    name: "Solar Blessing",
    type: EVENT_TYPES.DIVINE,

    description:
      "A radiant blessing descends upon the world. Light and Divine power surge beneath the sun.",

    symbol: "☀️",

    durationMs: 90 * 60 * 1000,

    seasonOverride: "summer",
    weatherOverride: "clear",

    affinityModifiers: {
      light: 1.60,
      divine: 1.55,
      fire: 1.20,
      arcane: 1.15,
      shadow: 0.75,
      necromancy: 0.70,
    },

    regionModifiers: {
      celestial_lands: {
        enemyMultiplier: 1.30,
        rewardMultiplier: 1.80,
      },

      eclipse_castle: {
        enemyMultiplier: 1.20,
        rewardMultiplier: 1.50,
      },

      abyss: {
        enemyMultiplier: 1.40,
        rewardMultiplier: 1.50,
      },
    },

    monsterModifiers: {
      undead: 0.65,
      shadow_beast: 0.70,
    },

    bossPool: [
      "solar_seraph",
      "fallen_sunlord",
    ],

    rewards: {
      xpMultiplier: 1.45,
      goldMultiplier: 1.50,
      rareLootChance: 0.20,
    },

    specialRules: {
      morningBlessing: true,
      divineHealing: true,
      lightDamageBoost: true,
    },
  },


  abyssal_rift: {
    id: "abyssal_rift",
    name: "Abyssal Rift",
    type: EVENT_TYPES.SHADOW,

    description:
      "A tear opens into the Abyss. Shadow and Necromancy creatures spill into the world.",

    symbol: "🕳️",

    durationMs: 2 * 60 * 60 * 1000,

    weatherOverride: "fog",

    affinityModifiers: {
      shadow: 1.55,
      necromancy: 1.60,
      blood: 1.25,
      divine: 0.80,
      light: 0.75,
    },

    regionModifiers: {
      abyss: {
        enemyMultiplier: 1.90,
        rewardMultiplier: 1.90,
      },

      infernal_rift: {
        enemyMultiplier: 1.30,
        rewardMultiplier: 1.40,
      },

      moonlit_ruins: {
        enemyMultiplier: 1.45,
        rewardMultiplier: 1.55,
      },
    },

    monsterModifiers: {
      shadow_beast: 1.80,
      hollow_knight: 1.70,
      undead: 1.80,
    },

    bossPool: [
      "abyssal_lord",
      "void_reaper",
    ],

    rewards: {
      xpMultiplier: 1.55,
      goldMultiplier: 1.65,
      rareLootChance: 0.25,
    },

    specialRules: {
      shadowSpawns: true,
      necromancySpawns: true,
      abyssalLoot: true,
    },
  },
};


// ============================================================
// LOOKUPS
// ============================================================

function normalizeEventId(id) {
  if (!id) return null;

  return String(id)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function getEvent(eventID) {
  return EVENTS[normalizeEventId(eventID)] || null;
}

function getAllEvents() {
  return Object.values(EVENTS);
}

function getEventsByType(type) {
  return getAllEvents().filter(
    event => event.type === String(type).toLowerCase()
  );
}


// ============================================================
// EVENT STATE
// ============================================================

async function getActiveWorldEvents(threadID) {
  const result = await db.query(
    `
      SELECT *
      FROM rpg_world_events
      WHERE thread_id = $1
        AND active = TRUE
        AND (
          expires_at IS NULL
          OR expires_at > NOW()
        )
      ORDER BY started_at DESC
    `,
    [String(threadID)]
  );

  return result.rows || [];
}

async function getActiveWorldEvent(threadID, eventID) {
  const id = normalizeEventId(eventID);

  const result = await db.query(
    `
      SELECT *
      FROM rpg_world_events
      WHERE thread_id = $1
        AND event_id = $2
        AND active = TRUE
        AND (
          expires_at IS NULL
          OR expires_at > NOW()
        )
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [String(threadID), id]
  );

  return result.rows[0] || null;
}


// ============================================================
// START EVENT
// ============================================================

async function startWorldEvent(threadID, eventID, options = {}) {
  const id = normalizeEventId(eventID);
  const event = getEvent(id);

  if (!event) {
    throw new Error(`Unknown world event: ${eventID}`);
  }

  const existing = await getActiveWorldEvent(threadID, id);

  if (existing) {
    return {
      alreadyActive: true,
      event,
      state: existing,
    };
  }

  const duration =
    Number(options.durationMs) > 0
      ? Number(options.durationMs)
      : event.durationMs || DEFAULT_EVENT_DURATION_MS;

  const startedAt = new Date();

  const expiresAt = new Date(
    startedAt.getTime() + duration
  );

  /*
   * Apply global season override.
   */
  if (event.seasonOverride) {
    await setWorldSeason(
      threadID,
      event.seasonOverride,
      {
        reason: `world_event:${event.id}`,
      }
    );
  }

  /*
   * Apply global weather override.
   */
  if (event.weatherOverride) {
    await setWorldWeather(
      threadID,
      event.weatherOverride,
      {
        reason: `world_event:${event.id}`,
      }
    );
  }

  const metadata = {
    affinityModifiers: event.affinityModifiers || {},
    regionModifiers: event.regionModifiers || {},
    monsterModifiers: event.monsterModifiers || {},
    rewards: event.rewards || {},
    specialRules: event.specialRules || {},
    bossPool: event.bossPool || [],
  };

  const result = await db.query(
    `
      INSERT INTO rpg_world_events (
        thread_id,
        event_id,
        event_type,
        started_at,
        expires_at,
        active,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        TRUE,
        $6::jsonb
      )
      RETURNING *
    `,
    [
      String(threadID),
      event.id,
      event.type,
      startedAt,
      expiresAt,
      JSON.stringify(metadata),
    ]
  );

  return {
    alreadyActive: false,
    event,
    state: result.rows[0],
  };
}


// ============================================================
// END EVENT
// ============================================================

async function endWorldEvent(threadID, eventID) {
  const id = normalizeEventId(eventID);

  const result = await db.query(
    `
      UPDATE rpg_world_events
      SET
        active = FALSE,
        ended_at = NOW()
      WHERE thread_id = $1
        AND event_id = $2
        AND active = TRUE
      RETURNING *
    `,
    [String(threadID), id]
  );

  return result.rows[0] || null;
}


// ============================================================
// EXPIRE EVENTS
// ============================================================

async function expireWorldEvents(threadID) {
  const result = await db.query(
    `
      UPDATE rpg_world_events
      SET
        active = FALSE,
        ended_at = NOW()
      WHERE thread_id = $1
        AND active = TRUE
        AND expires_at IS NOT NULL
        AND expires_at <= NOW()
      RETURNING *
    `,
    [String(threadID)]
  );

  return result.rows || [];
}


// ============================================================
// EVENT MODIFIERS
// ============================================================

function getEventAffinityMultiplier(event, affinityID) {
  if (!event) return 1;

  const id = String(affinityID || "").toLowerCase();

  return Number(event.affinityModifiers?.[id]) || 1;
}

function getRegionEventModifier(event, regionID) {
  if (!event) {
    return {
      enemyMultiplier: 1,
      rewardMultiplier: 1,
    };
  }

  const modifier =
    event.regionModifiers?.[
      String(regionID || "").toLowerCase()
    ];

  if (!modifier) {
    return {
      enemyMultiplier: 1,
      rewardMultiplier: 1,
    };
  }

  return {
    enemyMultiplier:
      Number(modifier.enemyMultiplier) || 1,

    rewardMultiplier:
      Number(modifier.rewardMultiplier) || 1,
  };
}

function getMonsterEventMultiplier(event, monsterID) {
  if (!event) return 1;

  return (
    Number(event.monsterModifiers?.[
      String(monsterID || "").toLowerCase()
    ]) || 1
  );
}

function getEventRewardMultiplier(event) {
  return Number(event?.rewards?.goldMultiplier) || 1;
}

function getEventXpMultiplier(event) {
  return Number(event?.rewards?.xpMultiplier) || 1;
}

function getEventRareLootChance(event) {
  return Number(event?.rewards?.rareLootChance) || 0;
}


// ============================================================
// COMBINED MODIFIER HELPERS
// ============================================================

async function getAffinityEventMultiplier(threadID, affinityID) {
  const events = await getActiveWorldEvents(threadID);

  let multiplier = 1;

  for (const row of events) {
    const event = getEvent(row.event_id);

    if (!event) continue;

    multiplier *= getEventAffinityMultiplier(
      event,
      affinityID
    );
  }

  return multiplier;
}

async function getRegionEventModifiers(threadID, regionID) {
  const events = await getActiveWorldEvents(threadID);

  let enemyMultiplier = 1;
  let rewardMultiplier = 1;

  for (const row of events) {
    const event = getEvent(row.event_id);

    if (!event) continue;

    const modifier = getRegionEventModifier(
      event,
      regionID
    );

    enemyMultiplier *= modifier.enemyMultiplier;
    rewardMultiplier *= modifier.rewardMultiplier;
  }

  return {
    enemyMultiplier,
    rewardMultiplier,
  };
}

async function getMonsterEventMultiplierForWorld(
  threadID,
  monsterID
) {
  const events = await getActiveWorldEvents(threadID);

  let multiplier = 1;

  for (const row of events) {
    const event = getEvent(row.event_id);

    if (!event) continue;

    multiplier *= getMonsterEventMultiplier(
      event,
      monsterID
    );
  }

  return multiplier;
}


// ============================================================
// REWARDS
// ============================================================

async function getWorldEventRewardModifiers(
  threadID,
  regionID
) {
  const events = await getActiveWorldEvents(threadID);

  let xpMultiplier = 1;
  let goldMultiplier = 1;
  let rareLootChance = 0;

  for (const row of events) {
    const event = getEvent(row.event_id);

    if (!event) continue;

    const regionModifier = getRegionEventModifier(
      event,
      regionID
    );

    xpMultiplier *= getEventXpMultiplier(event);

    goldMultiplier *=
      getEventRewardMultiplier(event);

    goldMultiplier *=
      regionModifier.rewardMultiplier;

    rareLootChance = Math.max(
      rareLootChance,
      getEventRareLootChance(event)
    );
  }

  return {
    xpMultiplier,
    goldMultiplier,
    rareLootChance,
  };
}


// ============================================================
// BOSS POOL
// ============================================================

async function getWorldEventBosses(threadID) {
  const events = await getActiveWorldEvents(threadID);

  const bosses = [];

  for (const row of events) {
    const event = getEvent(row.event_id);

    if (!event) continue;

    for (const bossID of event.bossPool || []) {
      if (!bosses.includes(bossID)) {
        bosses.push(bossID);
      }
    }
  }

  return bosses;
}


// ============================================================
// SPECIAL RULES
// ============================================================

async function hasWorldEventRule(
  threadID,
  ruleID
) {
  const events = await getActiveWorldEvents(threadID);

  for (const row of events) {
    const event = getEvent(row.event_id);

    if (!event) continue;

    if (event.specialRules?.[ruleID]) {
      return true;
    }
  }

  return false;
}


// ============================================================
// RANDOM EVENT
// ============================================================

function chooseRandomEvent(options = {}) {
  let pool = getAllEvents();

  if (options.type) {
    pool = pool.filter(
      event => event.type === options.type
    );
  }

  if (options.exclude) {
    const excluded = new Set(
      options.exclude.map(normalizeEventId)
    );

    pool = pool.filter(
      event => !excluded.has(event.id)
    );
  }

  if (!pool.length) return null;

  return pool[
    Math.floor(Math.random() * pool.length)
  ];
}

async function triggerRandomWorldEvent(
  threadID,
  options = {}
) {
  const active = await getActiveWorldEvents(threadID);

  const excluded = active.map(
    row => row.event_id
  );

  const event = chooseRandomEvent({
    ...options,
    exclude: [
      ...(options.exclude || []),
      ...excluded,
    ],
  });

  if (!event) {
    return null;
  }

  return startWorldEvent(
    threadID,
    event.id,
    options
  );
}


// ============================================================
// EVENT STATUS
// ============================================================

async function getWorldEventState(threadID) {
  const active = await getActiveWorldEvents(threadID);

  return active.map(row => {
    const event = getEvent(row.event_id);

    return {
      id: row.event_id,
      name: event?.name || row.event_id,
      type: event?.type || row.event_type,
      symbol: event?.symbol || "✦",
      description:
        event?.description || "",
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      remainingMs: row.expires_at
        ? Math.max(
            0,
            new Date(row.expires_at).getTime() -
            Date.now()
          )
        : null,
    };
  });
}


// ============================================================
// FORMATTERS
// ============================================================

function formatDuration(ms) {
  if (ms == null) return "Permanent";

  const totalSeconds = Math.floor(ms / 1000);

  const hours = Math.floor(
    totalSeconds / 3600
  );

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60
  );

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatWorldEvent(eventState) {
  if (!eventState) {
    return "✦ No active world event.";
  }

  return [
    `${eventState.symbol} ${eventState.name}`,
    "",
    eventState.description || "",
    "",
    `Type: ${eventState.type}`,
    `Remaining: ${formatDuration(eventState.remainingMs)}`,
  ].join("\n");
}

function formatWorldEventList(events) {
  if (!events?.length) {
    return "✦ No world events are currently active.";
  }

  return events
    .map(event => formatWorldEvent(event))
    .join("\n\n");
}


// ============================================================
// AUTOMATIC EVENT TICK
// ============================================================

async function processWorldEvents(threadID) {
  const expired = await expireWorldEvents(threadID);

  return {
    expired,
    active: await getWorldEventState(threadID),
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  EVENT_TYPES,
  EVENTS,

  normalizeEventId,

  getEvent,
  getAllEvents,
  getEventsByType,

  getActiveWorldEvents,
  getActiveWorldEvent,

  startWorldEvent,
  endWorldEvent,
  expireWorldEvents,

  getEventAffinityMultiplier,
  getRegionEventModifier,
  getMonsterEventMultiplier,

  getAffinityEventMultiplier,
  getRegionEventModifiers,
  getMonsterEventMultiplierForWorld,

  getWorldEventRewardModifiers,

  getWorldEventBosses,

  hasWorldEventRule,

  chooseRandomEvent,
  triggerRandomWorldEvent,

  getWorldEventState,

  processWorldEvents,

  formatWorldEvent,
  formatWorldEventList,
};
