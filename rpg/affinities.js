"use strict";

/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║                    ECLIPSE RPG                          ║
 * ║                  AFFINITY ENGINE                        ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Handles:
 * • Primary / secondary affinities
 * • Affinity tiers
 * • Mastery progression
 * • Affinity unlocking
 * • Affinity upgrades
 * • Environmental bonuses
 * • Seasonal / weather bonuses
 * • Kingdom affinity relationships
 *
 * This module intentionally does NOT handle spells or combat.
 * Those systems consume this module.
 */

const db = require("../db");

// ============================================================
// AFFINITY TIERS
// ============================================================

const AFFINITY_TIERS = {
  NONE: {
    id: 0,
    key: "none",
    name: "None",
    masteryRequired: 0,
    powerMultiplier: 0,
  },

  WEAK: {
    id: 1,
    key: "weak",
    name: "Weak",
    masteryRequired: 100,
    powerMultiplier: 0.75,
  },

  NORMAL: {
    id: 2,
    key: "normal",
    name: "Normal",
    masteryRequired: 300,
    powerMultiplier: 1.0,
  },

  STRONG: {
    id: 3,
    key: "strong",
    name: "Strong",
    masteryRequired: 700,
    powerMultiplier: 1.2,
  },

  EXCEPTIONAL: {
    id: 4,
    key: "exceptional",
    name: "Exceptional",
    masteryRequired: 1500,
    powerMultiplier: 1.45,
  },

  MASTERED: {
    id: 5,
    key: "mastered",
    name: "Mastered",
    masteryRequired: 3000,
    powerMultiplier: 1.8,
  },

  ASCENDED: {
    id: 6,
    key: "ascended",
    name: "Ascended",
    masteryRequired: 6000,
    powerMultiplier: 2.25,
  },
};

const TIER_ORDER = [
  AFFINITY_TIERS.NONE,
  AFFINITY_TIERS.WEAK,
  AFFINITY_TIERS.NORMAL,
  AFFINITY_TIERS.STRONG,
  AFFINITY_TIERS.EXCEPTIONAL,
  AFFINITY_TIERS.MASTERED,
  AFFINITY_TIERS.ASCENDED,
];

// ============================================================
// AFFINITIES
// ============================================================

const AFFINITIES = {
  fire: {
    id: "fire",
    name: "Fire",
    emoji: "🔥",

    description:
      "Destruction, combustion and overwhelming offensive force.",

    kingdom: "ashen_dominion",

    environments: {
      infernal_rift: 1.25,
      scorched_wastes: 1.20,
    },

    seasons: {
      summer: 1.20,
      winter: 0.90,
    },

    weather: {
      heat: 1.15,
      storm: 0.95,
      snow: 0.85,
    },

    opposite: "ice",

    tags: ["elemental", "offensive", "burn"],
  },

  ice: {
    id: "ice",
    name: "Ice",
    emoji: "❄️",

    description:
      "Control, defense, freezing and battlefield suppression.",

    kingdom: "frostgrave",

    environments: {
      frostgrave: 1.25,
    },

    seasons: {
      winter: 1.25,
      summer: 0.90,
    },

    weather: {
      snow: 1.20,
      rain: 1.10,
      heat: 0.85,
    },

    opposite: "fire",

    tags: ["elemental", "defensive", "control"],
  },

  lightning: {
    id: "lightning",
    name: "Lightning",
    emoji: "⚡",

    description:
      "Speed, electrical destruction and explosive strikes.",

    kingdom: "silver_conclave",

    environments: {
      ironspine: 1.10,
      celestial_lands: 1.15,
    },

    seasons: {
      summer: 1.05,
    },

    weather: {
      storm: 1.30,
      rain: 1.10,
    },

    tags: ["elemental", "speed", "burst"],
  },

  nature: {
    id: "nature",
    name: "Nature",
    emoji: "🌿",

    description:
      "Growth, regeneration, seasons, weather and living magic.",

    kingdom: "whispering_forest",

    environments: {
      whispering_forest: 1.25,
      lowlands: 1.15,
    },

    seasons: {
      spring: 1.30,
      summer: 1.10,
      autumn: 1.05,
      winter: 0.90,
    },

    weather: {
      rain: 1.20,
      clear: 1.05,
      snow: 0.90,
    },

    tags: ["elemental", "healing", "control", "growth"],
  },

  light: {
    id: "light",
    name: "Light",
    emoji: "☀️",

    description:
      "Radiant power, purification and offensive holy energy.",

    kingdom: "celestial_lands",

    environments: {
      celestial_lands: 1.25,
    },

    seasons: {
      summer: 1.10,
      winter: 0.95,
    },

    weather: {
      clear: 1.20,
      fog: 0.90,
      storm: 0.90,
    },

    tags: ["holy", "radiant", "healing"],
  },

  divine: {
    id: "divine",
    name: "Divine",
    emoji: "✦",

    description:
      "Protection, blessings, sacred defense and divine judgment.",

    kingdom: "silver_conclave",

    environments: {
      celestial_lands: 1.25,
      eclipse_castle: 1.10,
    },

    seasons: {
      spring: 1.05,
      summer: 1.10,
    },

    weather: {
      clear: 1.15,
      storm: 0.95,
    },

    tags: ["holy", "protection", "support"],
  },

  arcane: {
    id: "arcane",
    name: "Arcane",
    emoji: "🔮",

    description:
      "Pure magical manipulation, spell amplification and mana control.",

    kingdom: "silver_conclave",

    environments: {
      celestial_lands: 1.25,
      moonlit_ruins: 1.15,
    },

    seasons: {
      spring: 1.00,
      summer: 1.00,
      autumn: 1.00,
      winter: 1.00,
    },

    weather: {
      clear: 1.05,
      fog: 1.10,
    },

    tags: ["magic", "mana", "versatile"],
  },

  shadow: {
    id: "shadow",
    name: "Shadow",
    emoji: "🌑",

    description:
      "Stealth, darkness, evasion, corruption and shadow manifestation.",

    kingdom: "hollow_covenant",

    environments: {
      abyss: 1.25,
      moonlit_ruins: 1.20,
    },

    seasons: {
      winter: 1.10,
    },

    weather: {
      night: 1.30,
      fog: 1.15,
      clear: 0.95,
    },

    tags: ["dark", "stealth", "control"],
  },

  necromancy: {
    id: "necromancy",
    name: "Necromancy",
    emoji: "💀",

    description:
      "Death magic, undead manipulation and life-force corruption.",

    kingdom: "hollow_covenant",

    environments: {
      abyss: 1.30,
      moonlit_ruins: 1.20,
    },

    seasons: {
      winter: 1.15,
    },

    weather: {
      fog: 1.20,
      night: 1.15,
    },

    tags: ["dark", "death", "summoning"],
  },

  blood: {
    id: "blood",
    name: "Blood",
    emoji: "🩸",

    description:
      "Sacrifice, lifesteal, rage and converting vitality into power.",

    kingdom: "ashen_dominion",

    environments: {
      scorched_wastes: 1.15,
      abyss: 1.10,
    },

    seasons: {
      autumn: 1.05,
    },

    weather: {
      storm: 1.05,
    },

    tags: ["dark", "lifesteal", "sacrifice"],
  },

  water: {
    id: "water",
    name: "Water",
    emoji: "🌊",

    description:
      "Flow, healing, adaptation and overwhelming aquatic force.",

    kingdom: "azure_coast",

    environments: {
      azure_coast: 1.30,
      lowlands: 1.15,
    },

    seasons: {
      spring: 1.10,
      summer: 1.05,
    },

    weather: {
      rain: 1.30,
      storm: 1.15,
      heat: 0.95,
    },

    tags: ["elemental", "healing", "adaptation"],
  },

  wind: {
    id: "wind",
    name: "Wind",
    emoji: "🌪️",

    description:
      "Speed, movement, evasion and cutting pressure.",

    kingdom: "azure_coast",

    environments: {
      azure_coast: 1.20,
      celestial_lands: 1.10,
    },

    seasons: {
      spring: 1.15,
      autumn: 1.10,
    },

    weather: {
      storm: 1.20,
      clear: 1.10,
    },

    tags: ["elemental", "speed", "evasion"],
  },

  earth: {
    id: "earth",
    name: "Earth",
    emoji: "🪨",

    description:
      "Defense, endurance, physical power and battlefield stability.",

    kingdom: "ironspine_hold",

    environments: {
      ironspine: 1.30,
      lowlands: 1.10,
    },

    seasons: {
      autumn: 1.15,
      winter: 1.05,
    },

    weather: {
      clear: 1.10,
      rain: 0.95,
    },

    tags: ["elemental", "defense", "endurance"],
  },
};

// ============================================================
// CLASS PRIMARY AFFINITIES
// ============================================================

const CLASS_PRIMARY_AFFINITIES = {
  knight: {
    affinity: "light",
    tier: AFFINITY_TIERS.WEAK.id,
  },

  bloodreaver: {
    affinity: "blood",
    tier: AFFINITY_TIERS.NORMAL.id,
  },

  arcanist: {
    affinity: "arcane",
    tier: AFFINITY_TIERS.EXCEPTIONAL.id,
  },

  wraith: {
    affinity: "shadow",
    tier: AFFINITY_TIERS.STRONG.id,
  },

  paladin: {
    affinity: "divine",
    tier: AFFINITY_TIERS.STRONG.id,
  },

  ranger: {
    affinity: "nature",
    tier: AFFINITY_TIERS.NORMAL.id,
  },

  assassin: {
    affinity: "shadow",
    tier: AFFINITY_TIERS.NORMAL.id,
  },
};

// ============================================================
// HELPERS
// ============================================================

function normalizeAffinityId(value) {
  if (!value) {
    return null;
  }

  const raw = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (AFFINITIES[raw]) {
    return raw;
  }

  const aliases = {
    fire_magic: "fire",
    flame: "fire",

    frost: "ice",
    ice_magic: "ice",

    lightning_magic: "lightning",
    thunder: "lightning",

    holy: "light",
    radiant: "light",

    shadow_magic: "shadow",
    darkness: "shadow",

    death: "necromancy",

    blood_magic: "blood",

    water_magic: "water",

    wind_magic: "wind",
    air: "wind",

    earth_magic: "earth",
  };

  return aliases[raw] || null;
}

function getAffinity(affinityId) {
  const id = normalizeAffinityId(affinityId);

  return id ? AFFINITIES[id] : null;
}

function getAllAffinities() {
  return Object.values(AFFINITIES);
}

function getTier(tier) {
  const numeric = Math.max(
    0,
    Math.min(6, Number(tier) || 0)
  );

  return (
    TIER_ORDER[numeric] ||
    AFFINITY_TIERS.NONE
  );
}

function getTierByKey(key) {
  if (!key) {
    return AFFINITY_TIERS.NONE;
  }

  const normalized = String(key)
    .trim()
    .toLowerCase();

  return (
    TIER_ORDER.find(
      (tier) => tier.key === normalized
    ) || AFFINITY_TIERS.NONE
  );
}

function getNextTier(tier) {
  const current = getTier(tier);

  return (
    TIER_ORDER[current.id + 1] ||
    null
  );
}

function getMasteryRequiredForTier(tier) {
  return getTier(tier).masteryRequired;
}

// ============================================================
// PLAYER AFFINITY QUERIES
// ============================================================

async function getPlayerAffinity(
  threadId,
  userId,
  affinityId
) {
  const id = normalizeAffinityId(affinityId);

  if (!id) {
    throw new Error("Unknown affinity.");
  }

  const { rows } = await db.query(
    `
    SELECT *
    FROM rpg_player_affinities
    WHERE thread_id = $1
      AND user_id = $2
      AND affinity_id = $3
    `,
    [
      String(threadId),
      String(userId),
      id,
    ]
  );

  if (!rows.length) {
    return null;
  }

  return {
    ...rows[0],
    tier: Number(rows[0].tier) || 0,
    mastery: Number(rows[0].mastery) || 0,
    primaryAffinity:
      rows[0].primary_affinity === true,
  };
}

async function getPlayerAffinities(
  threadId,
  userId,
  options = {}
) {
  const onlyUnlocked =
    options.onlyUnlocked !== false;

  const { rows } = await db.query(
    `
    SELECT *
    FROM rpg_player_affinities
    WHERE thread_id = $1
      AND user_id = $2
      ${onlyUnlocked ? "AND unlocked = TRUE" : ""}
    ORDER BY
      primary_affinity DESC,
      tier DESC,
      mastery DESC,
      affinity_id ASC
    `,
    [
      String(threadId),
      String(userId),
    ]
  );

  return rows.map((row) => ({
    ...row,
    tier: Number(row.tier) || 0,
    mastery: Number(row.mastery) || 0,
    primaryAffinity:
      row.primary_affinity === true,
  }));
}

async function getPrimaryAffinity(
  threadId,
  userId
) {
  const { rows } = await db.query(
    `
    SELECT *
    FROM rpg_player_affinities
    WHERE thread_id = $1
      AND user_id = $2
      AND primary_affinity = TRUE
      AND unlocked = TRUE
    ORDER BY tier DESC
    LIMIT 1
    `,
    [
      String(threadId),
      String(userId),
    ]
  );

  if (!rows.length) {
    return null;
  }

  return {
    ...rows[0],
    tier: Number(rows[0].tier) || 0,
    mastery: Number(rows[0].mastery) || 0,
  };
}

// ============================================================
// UNLOCK AFFINITY
// ============================================================

async function unlockAffinity(
  threadId,
  userId,
  affinityId,
  options = {}
) {
  const id = normalizeAffinityId(affinityId);

  if (!id) {
    throw new Error("Unknown affinity.");
  }

  const existing =
    await getPlayerAffinity(
      threadId,
      userId,
      id
    );

  if (existing) {
    return {
      created: false,
      affinity: existing,
    };
  }

  const now = Date.now();

  const tier = Math.max(
    0,
    Math.min(
      6,
      Number(options.tier) || 1
    )
  );

  const mastery = Math.max(
    0,
    Number(options.mastery) || 0
  );

  const primary =
    options.primary === true;

  const source =
    options.source ||
    "unknown";

  await db.query(
    `
    INSERT INTO rpg_player_affinities(
      thread_id,
      user_id,
      affinity_id,
      tier,
      mastery,
      primary_affinity,
      unlocked,
      source,
      unlocked_at,
      updated_at
    )
    VALUES(
      $1, $2, $3, $4, $5,
      $6, TRUE, $7, $8, $8
    )
    ON CONFLICT(
      thread_id,
      user_id,
      affinity_id
    )
    DO NOTHING
    `,
    [
      String(threadId),
      String(userId),
      id,
      tier,
      mastery,
      primary,
      String(source),
      now,
    ]
  );

  return {
    created: true,
    affinity:
      await getPlayerAffinity(
        threadId,
        userId,
        id
      ),
  };
}

// ============================================================
// INITIALIZE CLASS AFFINITY
// ============================================================

async function initializeClassAffinity(
  threadId,
  userId,
  classId
) {
  const config =
    CLASS_PRIMARY_AFFINITIES[
      String(classId || "").toLowerCase()
    ];

  if (!config) {
    throw new Error(
      `No affinity configuration exists for class "${classId}".`
    );
  }

  return unlockAffinity(
    threadId,
    userId,
    config.affinity,
    {
      tier: config.tier,
      mastery: 0,
      primary: true,
      source: `class:${String(classId).toLowerCase()}`,
    }
  );
}

// ============================================================
// MASTERED AFFINITY LIMITS
// ============================================================

/**
 * Arcanist gets special access to one external affinity spell.
 *
 * Affinity ownership itself is still governed normally.
 *
 * This helper is intentionally separate so the spell system
 * can enforce the one-external-spell restriction.
 */

async function getAffinityCount(
  threadId,
  userId
) {
  const { rows } = await db.query(
    `
    SELECT COUNT(*)::INTEGER AS count
    FROM rpg_player_affinities
    WHERE thread_id = $1
      AND user_id = $2
      AND unlocked = TRUE
    `,
    [
      String(threadId),
      String(userId),
    ]
  );

  return Number(rows[0]?.count) || 0;
}

// ============================================================
// MASTERY
// ============================================================

async function addAffinityMastery(
  threadId,
  userId,
  affinityId,
  amount,
  options = {}
) {
  const id = normalizeAffinityId(affinityId);

  if (!id) {
    throw new Error("Unknown affinity.");
  }

  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      "Affinity mastery must be greater than zero."
    );
  }

  let current =
    await getPlayerAffinity(
      threadId,
      userId,
      id
    );

  if (!current) {
    if (options.autoUnlock === false) {
      throw new Error(
        `You have not unlocked ${AFFINITIES[id].name} affinity.`
      );
    }

    const unlocked =
      await unlockAffinity(
        threadId,
        userId,
        id,
        {
          tier:
            options.startingTier || 1,
          source:
            options.source ||
            "mastery",
        }
      );

    current = unlocked.affinity;
  }

  const oldMastery =
    Number(current.mastery) || 0;

  const newMastery =
    oldMastery + amount;

  const oldTier =
    Number(current.tier) || 0;

  let newTier = oldTier;

  while (
    newTier < 6 &&
    newMastery >=
      getTier(newTier + 1)
        .masteryRequired
  ) {
    newTier += 1;
  }

  const now = Date.now();

  await db.query(
    `
    UPDATE rpg_player_affinities
    SET
      mastery = $4,
      tier = $5,
      updated_at = $6
    WHERE thread_id = $1
      AND user_id = $2
      AND affinity_id = $3
    `,
    [
      String(threadId),
      String(userId),
      id,
      newMastery,
      newTier,
      now,
    ]
  );

  return {
    affinity: id,
    oldMastery,
    mastery: newMastery,

    oldTier,
    tier: newTier,

    tierChanged:
      newTier !== oldTier,

    previousTier:
      getTier(oldTier),

    currentTier:
      getTier(newTier),

    nextTier:
      getNextTier(newTier),

    masteryToNext:
      getNextTier(newTier)
        ? Math.max(
            0,
            getNextTier(newTier)
              .masteryRequired -
              newMastery
          )
        : 0,
  };
}

// ============================================================
// DIRECT TIER UPGRADE
// ============================================================

async function upgradeAffinity(
  threadId,
  userId,
  affinityId,
  options = {}
) {
  const id = normalizeAffinityId(affinityId);

  if (!id) {
    throw new Error("Unknown affinity.");
  }

  const current =
    await getPlayerAffinity(
      threadId,
      userId,
      id
    );

  if (!current) {
    throw new Error(
      `You have not unlocked ${AFFINITIES[id].name} affinity.`
    );
  }

  const currentTier =
    Number(current.tier) || 0;

  if (currentTier >= 6) {
    return {
      upgraded: false,
      reason: "already_ascended",
      affinity: current,
    };
  }

  const nextTier =
    getTier(currentTier + 1);

  const mastery =
    Number(current.mastery) || 0;

  if (
    mastery <
    nextTier.masteryRequired
  ) {
    return {
      upgraded: false,
      reason: "insufficient_mastery",

      required:
        nextTier.masteryRequired,

      mastery,

      remaining:
        nextTier.masteryRequired -
        mastery,

      affinity: current,
    };
  }

  const now = Date.now();

  await db.query(
    `
    UPDATE rpg_player_affinities
    SET
      tier = $4,
      updated_at = $5
    WHERE thread_id = $1
      AND user_id = $2
      AND affinity_id = $3
    `,
    [
      String(threadId),
      String(userId),
      id,
      currentTier + 1,
      now,
    ]
  );

  return {
    upgraded: true,

    affinity: id,

    previousTier:
      getTier(currentTier),

    currentTier:
      getTier(currentTier + 1),

    affinityState:
      await getPlayerAffinity(
        threadId,
        userId,
        id
      ),
  };
}

// ============================================================
// ENVIRONMENT
// ============================================================

function getEnvironmentMultiplier(
  affinityId,
  regionId,
  season,
  weather,
  extra = {}
) {
  const affinity =
    getAffinity(affinityId);

  if (!affinity) {
    return {
      multiplier: 1,
      reasons: [],
    };
  }

  let multiplier = 1;
  const reasons = [];

  const region =
    String(regionId || "")
      .toLowerCase();

  const currentSeason =
    String(season || "")
      .toLowerCase();

  const currentWeather =
    String(weather || "")
      .toLowerCase();

  if (
    affinity.environments &&
    affinity.environments[region]
  ) {
    const value =
      Number(
        affinity.environments[region]
      ) || 1;

    multiplier *= value;

    reasons.push({
      type: "environment",
      key: region,
      multiplier: value,
    });
  }

  if (
    affinity.seasons &&
    affinity.seasons[currentSeason]
  ) {
    const value =
      Number(
        affinity.seasons[currentSeason]
      ) || 1;

    multiplier *= value;

    reasons.push({
      type: "season",
      key: currentSeason,
      multiplier: value,
    });
  }

  if (
    affinity.weather &&
    affinity.weather[currentWeather]
  ) {
    const value =
      Number(
        affinity.weather[currentWeather]
      ) || 1;

    multiplier *= value;

    reasons.push({
      type: "weather",
      key: currentWeather,
      multiplier: value,
    });
  }

  /*
   * Extra environmental flags can be supplied by the
   * combat/world engine without changing this module.
   *
   * Example:
   *
   * { night: true }
   */

  if (
    extra.night === true &&
    affinity.weather &&
    affinity.weather.night
  ) {
    const value =
      Number(affinity.weather.night);

    multiplier *= value;

    reasons.push({
      type: "time",
      key: "night",
      multiplier: value,
    });
  }

  if (
    extra.morning === true &&
    affinity.weather &&
    affinity.weather.morning
  ) {
    const value =
      Number(affinity.weather.morning);

    multiplier *= value;

    reasons.push({
      type: "time",
      key: "morning",
      multiplier: value,
    });
  }

  return {
    multiplier:
      Number(multiplier.toFixed(4)),
    reasons,
  };
}

// ============================================================
// PLAYER POWER MULTIPLIER
// ============================================================

function getAffinityPowerMultiplier(
  tier
) {
  return getTier(tier).powerMultiplier;
}

async function getPlayerAffinityPower(
  threadId,
  userId,
  affinityId,
  environment = {}
) {
  const state =
    await getPlayerAffinity(
      threadId,
      userId,
      affinityId
    );

  if (!state || !state.unlocked) {
    return {
      unlocked: false,
      tier: AFFINITY_TIERS.NONE,
      multiplier: 0,
      environmentalMultiplier: 1,
      finalMultiplier: 0,
    };
  }

  const tier =
    getTier(state.tier);

  const environmental =
    getEnvironmentMultiplier(
      affinityId,
      environment.regionId,
      environment.season,
      environment.weather,
      environment
    );

  return {
    unlocked: true,

    affinity:
      normalizeAffinityId(
        affinityId
      ),

    tier,

    mastery:
      Number(state.mastery) || 0,

    baseMultiplier:
      tier.powerMultiplier,

    environmentalMultiplier:
      environmental.multiplier,

    finalMultiplier:
      Number(
        (
          tier.powerMultiplier *
          environmental.multiplier
        ).toFixed(4)
      ),

    environmentalReasons:
      environmental.reasons,
  };
}

// ============================================================
// SPELL / CONTENT ACCESS
// ============================================================

function canUseAffinity(
  affinityState,
  requiredTier = 1
) {
  if (!affinityState) {
    return false;
  }

  return (
    affinityState.unlocked === true &&
    Number(affinityState.tier) >=
      Number(requiredTier)
  );
}

function canLearnAffinitySpell(
  affinityState,
  requiredTier = 1,
  requiredMastery = 0
) {
  if (
    !canUseAffinity(
      affinityState,
      requiredTier
    )
  ) {
    return false;
  }

  return (
    Number(affinityState.mastery) >=
    Number(requiredMastery)
  );
}

// ============================================================
// FORMATTING
// ============================================================

function formatAffinity(
  affinityId,
  state = null
) {
  const affinity =
    getAffinity(affinityId);

  if (!affinity) {
    return "Unknown Affinity";
  }

  if (!state) {
    return `${affinity.emoji} ${affinity.name}`;
  }

  const tier =
    getTier(state.tier);

  const mastery =
    Number(state.mastery) || 0;

  const next =
    getNextTier(state.tier);

  const progress =
    next
      ? `${mastery}/${next.masteryRequired}`
      : `${mastery} MAX`;

  const primary =
    state.primaryAffinity
      ? " • PRIMARY"
      : "";

  return [
    `${affinity.emoji} ${affinity.name}`,
    `${tier.name}`,
    `Mastery ${progress}${primary}`,
  ].join(" • ");
}

function formatAffinityList(
  affinities
) {
  if (!Array.isArray(affinities) ||
      !affinities.length) {
    return "No affinities unlocked.";
  }

  return affinities
    .map((state) =>
      formatAffinity(
        state.affinity_id,
        state
      )
    )
    .join("\n");
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Data
  AFFINITIES,
  AFFINITY_TIERS,
  TIER_ORDER,
  CLASS_PRIMARY_AFFINITIES,

  // Normalization
  normalizeAffinityId,

  // Affinity data
  getAffinity,
  getAllAffinities,

  // Tiers
  getTier,
  getTierByKey,
  getNextTier,
  getMasteryRequiredForTier,

  // Player state
  getPlayerAffinity,
  getPlayerAffinities,
  getPrimaryAffinity,
  getAffinityCount,

  // Unlocking
  unlockAffinity,
  initializeClassAffinity,

  // Mastery
  addAffinityMastery,
  upgradeAffinity,

  // Environment
  getEnvironmentMultiplier,
  getAffinityPowerMultiplier,
  getPlayerAffinityPower,

  // Access
  canUseAffinity,
  canLearnAffinitySpell,

  // Display
  formatAffinity,
  formatAffinityList,
};
