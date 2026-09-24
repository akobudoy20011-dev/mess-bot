"use strict";

/**
 * ECLIPSE RPG — COMBAT ENGINE
 * ===========================
 *
 * Canonical single-file combat engine.
 *
 * Responsibilities:
 *   - combat sessions
 *   - hunts / enemies
 *   - player actions
 *   - skills
 *   - spells
 *   - specials
 *   - items
 *   - enemy turns
 *   - persistent effects
 *   - affinity/environment scaling
 *   - victory / defeat / escape
 *   - combat rendering
 *
 * This file intentionally contains the complete combat engine.
 * It does NOT require combat-core.js or combat-actions.js.
 */

const db = require("../db");

const {
  getUserState,
  updateVitals,
} = require("./player");

const {
  getSkillsForClass,
  getClass,
} = require("./classes");

const {
  getItem,
} = require("./items");

const affinities = require("./affinities");
const spells = require("./spells");
const specials = require("./specials");
const effects = require("./effects");

let seasons = null;
let weather = null;

try {
  seasons = require("./seasons");
} catch (_) {
  seasons = null;
}

try {
  weather = require("./weather");
} catch (_) {
  weather = null;
}

// ============================================================
// CONFIG
// ============================================================

const COMBAT_TIMEOUT_MS =
  30 * 60 * 1000;

const CRIT_CHANCE = 0.08;
const CRIT_MULTIPLIER = 1.75;

const DEFEND_DAMAGE_MULTIPLIER = 0.55;
const DEFEND_MP_RESTORE = 5;
const DEFEND_STAMINA_RESTORE = 8;

const ESCAPE_CHANCE = 0.35;

const MAX_LOG_ENTRIES = 30;

const INSTANT_DEATH_THRESHOLD = 0.08;

// ============================================================
// ENEMIES
// ============================================================

const ENEMIES = {
  shadow_beast: {
    id: "shadow_beast",
    name: "Shadow Beast",
    emoji: "🐺",

    maxHp: 180,
    attack: 18,
    defense: 8,
    agility: 14,
    intelligence: 10,
    luck: 8,

    affinity: "shadow",

    reward: 160,
    xp: 120,

    loot: [
      "moonleaf",
    ],
  },

  ironfang_wolf: {
    id: "ironfang_wolf",
    name: "Ironfang Wolf",
    emoji: "🐺",

    maxHp: 135,
    attack: 22,
    defense: 5,
    agility: 20,
    intelligence: 4,
    luck: 10,

    affinity: "nature",

    reward: 120,
    xp: 95,

    loot: [
      "iron",
    ],
  },

  hollow_knight: {
    id: "hollow_knight",
    name: "Hollow Knight",
    emoji: "⚔️",

    maxHp: 260,
    attack: 28,
    defense: 18,
    agility: 7,
    intelligence: 8,
    luck: 6,

    affinity: "shadow",

    reward: 260,
    xp: 220,

    loot: [
      "void_crystal",
    ],
  },

  ash_drake: {
    id: "ash_drake",
    name: "Ash Drake",
    emoji: "🐉",

    maxHp: 420,
    attack: 42,
    defense: 25,
    agility: 11,
    intelligence: 18,
    luck: 10,

    affinity: "fire",

    reward: 550,
    xp: 480,

    loot: [
      "ember_core",
    ],
  },
};

const ELITE_ENEMIES = {
  elite_shadow_beast: {
    ...ENEMIES.shadow_beast,

    id: "elite_shadow_beast",
    name: "Elite Shadow Beast",

    maxHp: 300,
    attack: 31,
    defense: 14,
    agility: 20,
    intelligence: 15,
    luck: 12,

    reward: 360,
    xp: 300,
  },

  alpha_ironfang_wolf: {
    ...ENEMIES.ironfang_wolf,

    id: "alpha_ironfang_wolf",
    name: "Alpha Ironfang Wolf",

    maxHp: 230,
    attack: 35,
    defense: 10,
    agility: 27,
    intelligence: 7,
    luck: 14,

    reward: 300,
    xp: 250,
  },

  corrupted_hollow_knight: {
    ...ENEMIES.hollow_knight,

    id: "corrupted_hollow_knight",
    name: "Corrupted Hollow Knight",

    maxHp: 450,
    attack: 44,
    defense: 27,
    agility: 11,
    intelligence: 14,
    luck: 10,

    reward: 520,
    xp: 450,
  },

  elder_ash_drake: {
    ...ENEMIES.ash_drake,

    id: "elder_ash_drake",
    name: "Elder Ash Drake",

    maxHp: 720,
    attack: 65,
    defense: 38,
    agility: 15,
    intelligence: 25,
    luck: 15,

    reward: 1000,
    xp: 850,
  },
};

const ALL_ENEMIES = {
  ...ENEMIES,
  ...ELITE_ENEMIES,
};

// ============================================================
// BASIC HELPERS
// ============================================================

function now() {
  return Date.now();
}

function randomInt(min, max) {
  const low = Math.ceil(min);
  const high = Math.floor(max);

  return Math.floor(
    Math.random() * (high - low + 1)
  ) + low;
}

function chance(probability) {
  return Math.random() < probability;
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeID(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeAction(value) {
  return normalizeID(value);
}

function normalizeTarget(value) {
  return normalizeID(value);
}

function formatNumber(value) {
  return safeNumber(value)
    .toLocaleString();
}

function clockTime() {
  const hour =
    new Date().getHours();

  return {
    morning:
      hour >= 5 &&
      hour < 12,

    night:
      hour >= 20 ||
      hour < 5,
  };
}

function labelOf(value) {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return (
    value.id ||
    value.key ||
    value.name ||
    undefined
  );
}

async function getWorldEnvironment(threadID) {
  const out = {};

  try {
    if (
      seasons &&
      typeof seasons.getWorldSeason ===
        "function"
    ) {
      out.season =
        labelOf(
          await seasons.getWorldSeason(
            threadID
          )
        );
    }
  } catch (_) {}

  try {
    if (
      weather &&
      typeof weather.getWorldWeather ===
        "function"
    ) {
      out.weather =
        labelOf(
          await weather.getWorldWeather(
            threadID
          )
        );
    }
  } catch (_) {}

  return out;
}

// ============================================================
// LOGGING
// ============================================================

function pushLog(metadata, message) {
  if (!metadata) {
    return;
  }

  if (!Array.isArray(metadata.log)) {
    metadata.log = [];
  }

  metadata.log.push(
    String(message)
  );

  if (
    metadata.log.length >
    MAX_LOG_ENTRIES
  ) {
    metadata.log =
      metadata.log.slice(
        -MAX_LOG_ENTRIES
      );
  }
}

// ============================================================
// JSON / METADATA
// ============================================================

function safeJsonParse(value, fallback = {}) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  if (
    typeof value === "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseMetadata(value) {
  return safeJsonParse(
    value,
    {}
  );
}

function serializeMetadata(metadata) {
  return JSON.stringify(
    metadata || {}
  );
}

// ============================================================
// ENVIRONMENT
// ============================================================

function normalizeEnvironment(
  environment = {},
  player = {}
) {
  const source =
    environment &&
    typeof environment === "object"
      ? environment
      : {};

  const clock =
    clockTime();

  const hasNight =
    source.night !== undefined &&
    source.night !== null;

  const hasMorning =
    source.morning !== undefined &&
    source.morning !== null;

  const night =
    hasNight
      ? source.night === true
      : clock.night;

  const morning =
    hasMorning
      ? source.morning === true
      : (
          source.isMorning !==
            undefined &&
          source.isMorning !== null
            ? source.isMorning === true
            : clock.morning
        );

  return {
    regionId:
      source.regionId ||
      source.regionID ||
      player.regionID ||
      player.regionId ||
      "greenvale",

    locationId:
      source.locationId ||
      source.locationID ||
      player.locationID ||
      player.locationId ||
      null,

    season:
      String(
        source.season ||
        "spring"
      ).toLowerCase(),

    weather:
      String(
        source.weather ||
        "clear"
      ).toLowerCase(),

    night,

    morning,

    isMorning:
      morning,
  };
}

// ============================================================
// ENEMY HELPERS
// ============================================================

function getEnemy(enemyID) {
  const id =
    normalizeID(enemyID);

  if (!id) {
    return null;
  }

  return (
    ALL_ENEMIES[id] ||
    null
  );
}

function getEnemyPool(elite = false) {
  return elite
    ? Object.values(
        ELITE_ENEMIES
      )
    : Object.values(
        ENEMIES
      );
}

function chooseEnemy(elite = false) {
  const pool =
    getEnemyPool(elite);

  if (!pool.length) {
    return null;
  }

  return pool[
    randomInt(
      0,
      pool.length - 1
    )
  ];
}

// ============================================================
// SESSION QUERIES
// ============================================================

async function getActiveCombatRow(
  threadID,
  userID
) {
  const result = await db.query(
    `
      SELECT *
      FROM rpg_combat_sessions
      WHERE thread_id = $1
        AND user_id = $2
        AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `,
    [
      String(threadID),
      String(userID),
    ]
  );

  return result.rows[0] || null;
}

async function getCombat(
  threadID,
  userID
) {
  const session =
    await getActiveCombatRow(
      threadID,
      userID
    );

  if (!session) {
    return null;
  }

  const createdAt =
    Number(session.created_at) ||
    now();

  if (
    now() - createdAt >
    COMBAT_TIMEOUT_MS
  ) {
    await db.query(
      `
        UPDATE rpg_combat_sessions
        SET
          status = 'timeout',
          updated_at = $1
        WHERE id = $2
      `,
      [
        now(),
        session.id,
      ]
    );

    await cleanupEffects(
      threadID,
      session.id,
      userID
    );

    return null;
  }

  return session;
}

async function saveCombat(
  sessionID,
  values
) {
  const fields = [];
  const params = [];
  let index = 1;

  for (
    const [
      key,
      value,
    ] of Object.entries(values)
  ) {
    fields.push(
      `${key} = $${index}`
    );

    params.push(value);
    index += 1;
  }

  if (!fields.length) {
    return;
  }

  params.push(now());
  fields.push(
    `updated_at = $${index}`
  );

  index += 1;

  params.push(sessionID);

  await db.query(
    `
      UPDATE rpg_combat_sessions
      SET
        ${fields.join(", ")}
      WHERE id = $${index}
    `,
    params
  );
}

// ============================================================
// PLAYER SNAPSHOT
// ============================================================

async function buildPlayerSnapshot(
  threadID,
  userID
) {
  const state =
    await getUserState(
      threadID,
      userID
    );

  const player =
    state?.player ||
    state ||
    {};

  const classID =
    player.characterClass ||
    player.character_class ||
    player.class ||
    state?.characterClass ||
    state?.class ||
    "knight";

  const classData =
    getClass(classID) ||
    {};

  const baseStats =
    classData.stats ||
    classData.baseStats ||
    {};

  const maxHp =
    safeNumber(
      player.maxHp ??
      player.max_hp ??
      state?.maxHp ??
      state?.max_hp ??
      baseStats.maxHp ??
      baseStats.hp,
      100
    );

  const maxMp =
    safeNumber(
      player.maxMp ??
      player.max_mp ??
      state?.maxMp ??
      state?.max_mp ??
      baseStats.maxMp ??
      baseStats.mp,
      50
    );

  const maxStamina =
    safeNumber(
      player.maxStamina ??
      player.max_stamina ??
      state?.maxStamina ??
      state?.max_stamina ??
      baseStats.maxStamina ??
      baseStats.stamina,
      100
    );

  return {
    ...player,

    state,

    userID:
      String(userID),

    characterClass:
      classID,

    maxHp:
      Math.max(1, maxHp),

    maxMp:
      Math.max(0, maxMp),

    maxStamina:
      Math.max(0, maxStamina),

    hp:
      safeNumber(
        player.hp ??
        player.currentHp ??
        player.current_hp ??
        state?.player?.hp ??
        state?.hp,
        maxHp
      ),

    mp:
      safeNumber(
        player.mp ??
        player.currentMp ??
        player.current_mp ??
        state?.player?.mp ??
        state?.mp,
        maxMp
      ),

    stamina:
      safeNumber(
        player.stamina ??
        player.currentStamina ??
        player.current_stamina ??
        state?.player?.stamina ??
        state?.stamina,
        maxStamina
      ),

    strength:
      safeNumber(
        player.strength ??
        state?.strength ??
        baseStats.strength,
        10
      ),

    defense:
      safeNumber(
        player.defense ??
        state?.defense ??
        baseStats.defense,
        10
      ),

    agility:
      safeNumber(
        player.agility ??
        state?.agility ??
        baseStats.agility,
        10
      ),

    intelligence:
      safeNumber(
        player.intelligence ??
        state?.intelligence ??
        baseStats.intelligence,
        10
      ),

    vitality:
      safeNumber(
        player.vitality ??
        state?.vitality ??
        baseStats.vitality,
        10
      ),

    luck:
      safeNumber(
        player.luck ??
        state?.luck ??
        baseStats.luck,
        10
      ),

    regionID:
      player.regionID ||
      player.region_id ||
      state?.regionID ||
      state?.region_id ||
      "greenvale",

    locationID:
      player.locationID ||
      player.location_id ||
      state?.locationID ||
      state?.location_id ||
      null,
  };
}

// ============================================================
// COMBAT PLAYER PARSING
// ============================================================

function parseCombatPlayer(
  session,
  metadata,
  player
) {
  const snapshot =
    metadata?.player ||
    {};

  return {
    userID:
      String(
        player?.userID ||
        session.user_id
      ),

    characterClass:
      player?.characterClass ||
      snapshot.characterClass ||
      "knight",

    maxHp:
      safeNumber(
        player?.maxHp ??
        snapshot.maxHp ??
        session.player_hp,
        1
      ),

    maxMp:
      safeNumber(
        player?.maxMp ??
        snapshot.maxMp ??
        session.player_mp,
        0
      ),

    maxStamina:
      safeNumber(
        player?.maxStamina ??
        snapshot.maxStamina ??
        session.player_stamina,
        0
      ),

    strength:
      safeNumber(
        player?.strength ??
        snapshot.strength,
        10
      ),

    defense:
      safeNumber(
        player?.defense ??
        snapshot.defense,
        10
      ),

    agility:
      safeNumber(
        player?.agility ??
        snapshot.agility,
        10
      ),

    intelligence:
      safeNumber(
        player?.intelligence ??
        snapshot.intelligence,
        10
      ),

    vitality:
      safeNumber(
        player?.vitality ??
        snapshot.vitality,
        10
      ),

    luck:
      safeNumber(
        player?.luck ??
        snapshot.luck,
        10
      ),

    regionID:
      player?.regionID ||
      snapshot.regionID ||
      "greenvale",

    locationID:
      player?.locationID ||
      snapshot.locationID ||
      null,
  };
}

// ============================================================
// EFFECT TARGET IDS
// ============================================================

function playerTargetID(userID) {
  return String(userID);
}

function enemyTargetID() {
  return "enemy";
}

function effectsTargetForEffect(
  effectID,
  playerID
) {
  const E =
    effects.EFFECT_IDS;

  switch (effectID) {
    case E.STUN:
    case E.ROOT:
    case E.SLOW:
    case E.BLIND:
    case E.WEAKNESS:
    case E.DEFENSE_BREAK:
    case E.BURN:
    case E.POISON:
    case E.BLEED:
    case E.NECROTIC:
      return enemyTargetID();

    case E.DEFENSE_UP:
    case E.DAMAGE_UP:
    case E.DODGE_UP:
    case E.AGILITY_UP:
    case E.DAMAGE_REDUCTION:
    case E.DIVINE_SHIELD:
    case E.MANA_REGEN_UP:
    case E.LIFESTEAL:
    case E.BARK_SKIN:
      return playerID;

    default:
      return null;
  }
}

// ============================================================
// RESOURCE HELPERS
// ============================================================

function getSessionHP(session) {
  return Math.max(
    0,
    safeNumber(
      session.player_hp
    )
  );
}

function getSessionMP(session) {
  return Math.max(
    0,
    safeNumber(
      session.player_mp
    )
  );
}

function getSessionStamina(session) {
  return Math.max(
    0,
    safeNumber(
      session.player_stamina
    )
  );
}

function getEnemyHP(session) {
  return Math.max(
    0,
    safeNumber(
      session.enemy_hp
    )
  );
}

function setPlayerResources(
  session,
  hp,
  mp,
  stamina,
  player
) {
  session.player_hp =
    clamp(
      Math.round(
        safeNumber(hp)
      ),
      0,
      player.maxHp
    );

  session.player_mp =
    clamp(
      Math.round(
        safeNumber(mp)
      ),
      0,
      player.maxMp
    );

  session.player_stamina =
    clamp(
      Math.round(
        safeNumber(stamina)
      ),
      0,
      player.maxStamina
    );
}

function setEnemyHP(
  session,
  hp
) {
  const enemy =
    getEnemy(
      session.enemy_id
    );

  const maxHp =
    enemy?.maxHp ||
    Number.MAX_SAFE_INTEGER;

  session.enemy_hp =
    clamp(
      Math.round(
        safeNumber(hp)
      ),
      0,
      maxHp
    );
}

// ============================================================
// PLAYER VITAL SYNC
// ============================================================

async function syncPlayerVitals(
  threadID,
  userID,
  session,
  overrides = {}
) {
  if (
    typeof updateVitals !==
    "function"
  ) {
    return;
  }

  try {
    await updateVitals(
      threadID,
      userID,
      {
        hp:
          safeNumber(
            session.player_hp
          ),

        mp:
          safeNumber(
            session.player_mp
          ),

        stamina:
          safeNumber(
            session.player_stamina
          ),

        ...overrides,
      }
    );
  } catch (_) {
    /*
     * The combat session remains authoritative.
     */
  }
}

async function cleanupEffects(
  threadID,
  combatID,
  userID
) {
  try {
    await effects.clearEffects(
      threadID,
      combatID,
      playerTargetID(userID)
    );
  } catch (_) {}

  try {
    await effects.clearEffects(
      threadID,
      combatID,
      enemyTargetID()
    );
  } catch (_) {}
}

// ============================================================
// COOLDOWNS
// ============================================================

function getCooldowns(metadata) {
  if (
    !metadata.cooldowns ||
    typeof metadata.cooldowns !==
      "object"
  ) {
    metadata.cooldowns = {};
  }

  return metadata.cooldowns;
}

function getCooldown(
  metadata,
  id
) {
  const cooldowns =
    getCooldowns(metadata);

  return Math.max(
    0,
    safeNumber(
      cooldowns[id]
    )
  );
}

function setCooldown(
  metadata,
  id,
  turns
) {
  const cooldowns =
    getCooldowns(metadata);

  cooldowns[id] =
    Math.max(
      0,
      Math.round(
        safeNumber(turns)
      )
    );
}

function decrementCooldowns(
  metadata
) {
  const cooldowns =
    getCooldowns(metadata);

  for (
    const id of Object.keys(
      cooldowns
    )
  ) {
    cooldowns[id] =
      Math.max(
        0,
        safeNumber(
          cooldowns[id]
        ) - 1
      );
  }
}

// ============================================================
// AFFINITY
// ============================================================

async function getCombatAffinityMultiplier(
  threadID,
  userID,
  affinityID,
  environment
) {
  const id =
    affinities.normalizeAffinityId(
      affinityID
    );

  if (!id) {
    return {
      affinity: null,
      unlocked: true,
      multiplier: 1,
      baseMultiplier: 1,
      environmentalMultiplier: 1,
      tier: null,
      mastery: 0,
      environmentalReasons: [],
    };
  }

  const power =
    await affinities.getPlayerAffinityPower(
      threadID,
      userID,
      id,
      environment
    );

  if (
    !power ||
    power.unlocked !== true
  ) {
    return {
      affinity: id,
      unlocked: false,
      multiplier: 0,
      baseMultiplier:
        safeNumber(
          power?.baseMultiplier,
          1
        ),
      environmentalMultiplier:
        safeNumber(
          power?.environmentalMultiplier,
          1
        ),
      tier:
        power?.tier || null,
      mastery:
        safeNumber(
          power?.mastery
        ),
      environmentalReasons:
        power?.environmentalReasons ||
        [],
    };
  }

  const baseMultiplier =
    safeNumber(
      power.baseMultiplier,
      1
    );

  const environmentalMultiplier =
    safeNumber(
      power.environmentalMultiplier,
      1
    );

  return {
    affinity: id,
    unlocked: true,

    multiplier:
      safeNumber(
        power.finalMultiplier,
        baseMultiplier *
          environmentalMultiplier
      ),

    baseMultiplier,

    environmentalMultiplier,

    tier:
      power.tier,

    mastery:
      safeNumber(
        power.mastery
      ),

    environmentalReasons:
      power.environmentalReasons ||
      [],
  };
}

// ============================================================
// DAMAGE CALCULATION
// ============================================================

function calculateBaseDamage({
  attack,
  power = 0,
  multiplier = 1,
  defense = 0,
  intelligence = 0,
  magical = false,
  crit = false,
}) {
  const offensive =
    magical
      ? Math.max(
          1,
          safeNumber(
            intelligence
          )
        )
      : Math.max(
          1,
          safeNumber(
            attack
          )
        );

  const rawPower =
    safeNumber(power);

  let base;

  if (rawPower > 0) {
    const statFactor =
      magical
        ? 1 +
          Math.max(
            0,
            offensive - 10
          ) *
            0.025
        : 1;

    base =
      rawPower *
      statFactor *
      safeNumber(
        multiplier,
        1
      );
  } else {
    base =
      offensive *
      randomInt(85, 115) /
      100;
  }

  const mitigation =
    100 /
    (
      100 +
      Math.max(
        0,
        safeNumber(
          defense
        )
      )
    );

  let damage =
    base *
    mitigation;

  if (crit) {
    damage *=
      CRIT_MULTIPLIER;
  }

  return Math.max(
    1,
    Math.round(damage)
  );
}

async function getEffectiveEnemyDefense(
  threadID,
  combatID,
  baseDefense
) {
  const defenseBreak =
    await effects.getEffect(
      threadID,
      combatID,
      enemyTargetID(),
      effects.EFFECT_IDS
        .DEFENSE_BREAK
    );

  if (!defenseBreak) {
    return Math.max(
      0,
      safeNumber(
        baseDefense
      )
    );
  }

  const reduction =
    clamp(
      safeNumber(
        defenseBreak.magnitude
      ),
      0,
      1
    );

  return Math.max(
    0,
    safeNumber(
      baseDefense
    ) *
      (1 - reduction)
  );
}

// ============================================================
// APPLY PLAYER DAMAGE
// ============================================================

async function applyDamageToPlayer({
  threadID,
  combatID,
  userID,
  session,
  player,
  damage,
  context = {},
}) {
  let incoming =
    Math.max(
      0,
      Math.round(
        safeNumber(damage)
      )
    );

  const incomingResult =
    await effects.calculateIncomingDamage(
      threadID,
      combatID,
      playerTargetID(userID),
      incoming,
      context
    );

  incoming =
    incomingResult.damage;

  const shield =
    await effects.absorbDefenseHealth(
      threadID,
      combatID,
      playerTargetID(userID),
      incoming
    );

  incoming =
    shield.remainingDamage;

  const oldHp =
    getSessionHP(session);

  const newHp =
    clamp(
      oldHp - incoming,
      0,
      player.maxHp
    );

  session.player_hp =
    newHp;

  return {
    damage:
      incoming,

    blocked:
      incomingResult
        .modifiers?.blocked ===
      true,

    absorbed:
      shield.absorbed,

    oldHp,
    newHp,

    modifiers:
      incomingResult.modifiers,
  };
}

// ============================================================
// APPLY ENEMY DAMAGE
// ============================================================

async function applyDamageToEnemy({
  threadID,
  combatID,
  userID,
  session,
  damage,
  context = {},
}) {
  let outgoing =
    Math.max(
      0,
      Math.round(
        safeNumber(damage)
      )
    );

  const outgoingResult =
    await effects.calculateOutgoingDamage(
      threadID,
      combatID,
      playerTargetID(userID),
      enemyTargetID(),
      outgoing,
      context
    );

  outgoing =
    outgoingResult.damage;

  const incomingResult =
    await effects.calculateIncomingDamage(
      threadID,
      combatID,
      enemyTargetID(),
      outgoing,
      context
    );

  const finalDamage =
    incomingResult.damage;

  const oldHp =
    getEnemyHP(session);

  const newHp =
    Math.max(
      0,
      oldHp - finalDamage
    );

  setEnemyHP(
    session,
    newHp
  );

  return {
    damage:
      finalDamage,

    lifesteal:
      outgoingResult.lifesteal,

    oldHp,
    newHp,

    outgoingModifiers:
      outgoingResult.modifiers,

    incomingModifiers:
      incomingResult.modifiers,
  };
}

// ============================================================
// HEALING
// ============================================================

async function healPlayer({
  threadID,
  combatID,
  session,
  player,
  amount,
}) {
  const healing =
    Math.max(
      0,
      Math.round(
        safeNumber(amount)
      )
    );

  if (!healing) {
    return {
      actualHealing: 0,
      overheal: 0,
      defenseHealth: 0,
    };
  }

  const currentHp =
    getSessionHP(session);

  const result =
    await effects.convertOverheal(
      threadID,
      combatID,
      playerTargetID(
        session.user_id
      ),
      healing,
      currentHp,
      player.maxHp
    );

  session.player_hp =
    clamp(
      currentHp +
        result.actualHealing,
      0,
      player.maxHp
    );

  return result;
}

// ============================================================
// START / END TURN EFFECTS
// ============================================================

async function processPlayerStartTurn({
  threadID,
  combatID,
  session,
  player,
  metadata,
}) {
  const result =
    await effects.processStartOfTurn(
      threadID,
      combatID,
      playerTargetID(
        session.user_id
      ),
      {
        maxMp:
          player.maxMp,

        maxStamina:
          player.maxStamina,

        season:
          metadata.environment
            ?.season,

        weather:
          metadata.environment
            ?.weather,
      }
    );

  const messages = [];

  if (result.damage > 0) {
    const damage =
      await applyDamageToPlayer({
        threadID,
        combatID,
        userID:
          session.user_id,
        session,
        player,
        damage:
          result.damage,
      });

    messages.push(
      `You suffer ${formatNumber(
        damage.damage
      )} damage from ongoing effects.`
    );
  }

  if (result.healing > 0) {
    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          result.healing,
      });

    if (
      healed.actualHealing >
      0
    ) {
      messages.push(
        `You recover ${formatNumber(
          healed.actualHealing
        )} HP.`
      );
    }

    if (
      healed.defenseHealth >
      0
    ) {
      messages.push(
        `Bark Skin converts ${formatNumber(
          healed.defenseHealth
        )} overheal into Defense Health.`
      );
    }
  }

  if (result.mana > 0) {
    const oldMp =
      getSessionMP(session);

    session.player_mp =
      clamp(
        oldMp + result.mana,
        0,
        player.maxMp
      );

    messages.push(
      `You recover ${formatNumber(
        result.mana
      )} MP.`
    );
  }

  if (result.stamina > 0) {
    const oldStamina =
      getSessionStamina(
        session
      );

    session.player_stamina =
      clamp(
        oldStamina +
          result.stamina,
        0,
        player.maxStamina
      );
  }

  if (result.stunned) {
    messages.push(
      "You are stunned and cannot act."
    );
  }

  if (result.rooted) {
    messages.push(
      "You are rooted."
    );
  }

  return {
    ...result,
    messages,
  };
}

async function processEnemyStartTurn({
  threadID,
  combatID,
  session,
  player,
  metadata,
}) {
  const result =
    await effects.processStartOfTurn(
      threadID,
      combatID,
      enemyTargetID(),
      {
        maxMp: 0,

        season:
          metadata.environment
            ?.season,

        weather:
          metadata.environment
            ?.weather,
      }
    );

  const messages = [];

  if (result.damage > 0) {
    const damage =
      await applyDamageToEnemyDirect(
        session,
        result.damage
      );

    messages.push(
      `${getEnemy(
        session.enemy_id
      )?.name || "Enemy"} suffers ${formatNumber(
        damage
      )} damage from ongoing effects.`
    );
  }

  if (result.stunned) {
    messages.push(
      `${getEnemy(
        session.enemy_id
      )?.name || "Enemy"} is stunned.`
    );
  }

  return {
    ...result,
    messages,
  };
}

async function applyDamageToEnemyDirect(
  session,
  damage
) {
  const incoming =
    Math.max(
      0,
      Math.round(
        safeNumber(damage)
      )
    );

  const oldHp =
    getEnemyHP(session);

  const newHp =
    Math.max(
      0,
      oldHp - incoming
    );

  setEnemyHP(
    session,
    newHp
  );

  return incoming;
}

// ============================================================
// ENEMY TURN
// ============================================================

async function enemyTurn({
  threadID,
  combatID,
  session,
  player,
  metadata,
}) {
  const enemy =
    getEnemy(
      session.enemy_id
    );

  if (!enemy) {
    return {
      ok: false,
      damage: 0,
      messages: [
        "The enemy data is missing.",
      ],
    };
  }

  if (
    getEnemyHP(session) <= 0
  ) {
    return {
      ok: true,
      damage: 0,
      skipped: true,
      messages: [],
    };
  }

  const enemyStart =
    await processEnemyStartTurn({
      threadID,
      combatID,
      session,
      player,
      metadata,
    });

  if (
    getEnemyHP(session) <= 0
  ) {
    return {
      ok: true,
      damage: 0,
      killedByEffect: true,
      skipped: true,
      messages:
        enemyStart.messages,
    };
  }

  /*
   * Infinite Darkness is a true multi-turn battlefield
   * control effect. The restored special freezes the enemy
   * for its full duration (five turns), rather than merely
   * applying a one-turn stun.
   */
  const infiniteDarkness =
    await effects.getEffect(
      threadID,
      combatID,
      enemyTargetID(),
      effects.EFFECT_IDS.INFINITE_DARKNESS
    );

  if (
    enemyStart.stunned ||
    infiniteDarkness ||
    await effects.isStunned(
      threadID,
      combatID,
      enemyTargetID()
    )
  ) {
    const frozen =
      Boolean(infiniteDarkness);

    return {
      ok: true,
      damage: 0,
      skipped: true,
      messages: [
        ...enemyStart.messages,
        frozen
          ? `${getEnemy(
              session.enemy_id
            )?.name || "Enemy"} is frozen in Infinite Darkness and loses its turn.`
          : `${getEnemy(
              session.enemy_id
            )?.name || "Enemy"} loses its turn.`,
      ],
    };
  }

  const playerTarget =
    playerTargetID(
      session.user_id
    );

  const dodgeEffect =
    await effects.getEffect(
      threadID,
      combatID,
      playerTarget,
      effects.EFFECT_IDS
        .DODGE_UP
    );

  let dodgeChance = 0;

  if (dodgeEffect) {
    dodgeChance =
      clamp(
        safeNumber(
          dodgeEffect.magnitude
        ),
        0,
        0.75
      );
  }

  dodgeChance +=
    clamp(
      (player.agility - enemy.agility) *
        0.005,
      0,
      0.20
    );

  if (
    chance(
      clamp(
        dodgeChance,
        0,
        0.80
      )
    )
  ) {
    return {
      ok: true,
      damage: 0,
      dodged: true,
      messages: [
        ...enemyStart.messages,
        `${enemy.name}'s attack misses you.`,
      ],
    };
  }

  const defending =
    metadata.defending === true;

  let rawDamage =
    enemy.attack *
    randomInt(85, 115) /
    100;

  const defenseUp =
    await effects.getEffect(
      threadID,
      combatID,
      playerTarget,
      effects.EFFECT_IDS
        .DEFENSE_UP
    );

  let effectiveDefense =
    player.defense;

  if (defenseUp) {
    effectiveDefense *=
      1 +
      Math.max(
        0,
        safeNumber(
          defenseUp.magnitude
        )
      );
  }

  rawDamage *=
    100 /
    (
      100 +
      Math.max(
        0,
        effectiveDefense
      )
    );

  /*
   * Weakness reduces damage received by the
   * affected target. It does NOT increase damage.
   */
  const weakness =
    await effects.getEffect(
      threadID,
      combatID,
      playerTarget,
      effects.EFFECT_IDS
        .WEAKNESS
    );

  if (weakness) {
    rawDamage *=
      1 -
      clamp(
        safeNumber(
          weakness.magnitude
        ),
        0,
        0.9
      );
  }

  if (defending) {
    rawDamage *=
      DEFEND_DAMAGE_MULTIPLIER;
  }

  const damage =
    await applyDamageToPlayer({
      threadID,
      combatID,
      userID:
        session.user_id,
      session,
      player,
      damage:
        Math.max(
          1,
          Math.round(
            rawDamage
          )
        ),
    });

  const messages = [
    ...enemyStart.messages,
  ];

  if (
    damage.blocked
  ) {
    messages.push(
      `${enemy.name}'s attack is blocked.`
    );
  } else {
    messages.push(
      `${enemy.name} deals ${formatNumber(
        damage.damage
      )} damage.`
    );
  }

  if (
    damage.absorbed > 0
  ) {
    messages.push(
      `Defense Health absorbs ${formatNumber(
        damage.absorbed
      )} damage.`
    );
  }

  if (defending) {
    messages.push(
      "Your guard reduces the damage."
    );
  }

  return {
    ok: true,
    damage:
      damage.damage,
    messages,
  };
}

// ============================================================
// BASIC ATTACK
// ============================================================

async function executeAttack({
  threadID,
  combatID,
  userID,
  session,
  player,
}) {
  const enemy =
    getEnemy(
      session.enemy_id
    );

  if (!enemy) {
    return {
      ok: false,
      reason:
        "Enemy data is unavailable.",
    };
  }

  const enemyDefense =
    await getEffectiveEnemyDefense(
      threadID,
      combatID,
      enemy.defense
    );

  const critical =
    chance(
      CRIT_CHANCE
    );

  const damage =
    calculateBaseDamage({
      attack:
        player.strength,

      defense:
        enemyDefense,

      crit:
        critical,
    });

  const dealt =
    await applyDamageToEnemy({
      threadID,
      combatID,
      userID,
      session,
      damage,
    });

  const messages = [
    critical
      ? `Critical hit! You deal ${formatNumber(
          dealt.damage
        )} damage.`
      : `You deal ${formatNumber(
          dealt.damage
        )} damage.`,
  ];

  if (
    dealt.lifesteal > 0
  ) {
    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          effects.calculateLifesteal(
            dealt.damage,
            dealt.lifesteal
          ),
      });

    if (
      healed.actualHealing >
      0
    ) {
      messages.push(
        `Lifesteal restores ${formatNumber(
          healed.actualHealing
        )} HP.`
      );
    }
  }

  return {
    ok: true,
    damage:
      dealt.damage,
    critical,
    messages,
  };
}

// ============================================================
// SKILLS
// ============================================================

async function executeSkill({
  threadID,
  combatID,
  userID,
  session,
  player,
  metadata,
  skillID,
}) {
  const id =
    normalizeID(skillID);

  const skills =
    getSkillsForClass(
      player.characterClass
    ) || [];

  const skill =
    skills.find(
      (entry) =>
        normalizeID(
          entry?.id
        ) === id ||
        normalizeID(
          entry?.name
        ) === id
    );

  if (!skill) {
    return {
      ok: false,
      reason:
        `Unknown skill: ${skillID}`,
    };
  }

  const cooldown =
    getCooldown(
      metadata,
      `skill:${id}`
    );

  if (cooldown > 0) {
    return {
      ok: false,
      reason:
        `${skill.name} is on cooldown for ${cooldown} more turn${
          cooldown === 1
            ? ""
            : "s"
        }.`,
    };
  }

  const mpCost =
    safeNumber(
      skill.manaCost ??
      skill.mpCost ??
      (
        typeof skill.cost ===
        "number"
          ? skill.cost
          : skill.cost?.mp
      )
    );

  const staminaCost =
    safeNumber(
      skill.staminaCost ??
      skill.stamina ??
      skill.cost?.stamina
    );

  if (
    getSessionMP(session) <
    mpCost
  ) {
    return {
      ok: false,
      reason:
        `Not enough MP. ${skill.name} requires ${mpCost} MP.`,
    };
  }

  if (
    getSessionStamina(session) <
    staminaCost
  ) {
    return {
      ok: false,
      reason:
        `Not enough stamina. ${skill.name} requires ${staminaCost} stamina.`,
    };
  }

  const cooldownTurns =
    Math.max(
      0,
      safeNumber(
        skill.cooldown,
        1
      )
    );

  /*
   * Because cooldowns decrement at the end of
   * the same round, a 1-turn cooldown must be
   * stored as 2 to actually block the next turn.
   */
  const storedCooldown =
    cooldownTurns > 0
      ? cooldownTurns + 1
      : 0;

  /*
   * ----------------------------------------------------------
   * GUARD
   * ----------------------------------------------------------
   */
  if (
    skill.effect === "guard" ||
    skill.type === "guard"
  ) {
    metadata.defending = true;

    session.player_mp =
      clamp(
        getSessionMP(session) -
          mpCost +
          DEFEND_MP_RESTORE,
        0,
        player.maxMp
      );

    session.player_stamina =
      clamp(
        getSessionStamina(session) -
          staminaCost +
          DEFEND_STAMINA_RESTORE,
        0,
        player.maxStamina
      );

    setCooldown(
      metadata,
      `skill:${id}`,
      storedCooldown
    );

    return {
      ok: true,
      damage: 0,
      messages: [
        `You use ${skill.name} and brace for impact.`,
      ],
    };
  }

  /*
   * ----------------------------------------------------------
   * DODGE
   * ----------------------------------------------------------
   */
  if (
    skill.effect === "dodge"
  ) {
    const duration =
      safeNumber(
        skill.duration,
        1
      );

    await effects.applyEffect(
      threadID,
      combatID,
      playerTargetID(userID),
      {
        id:
          effects.EFFECT_IDS
            .DODGE_UP,

        source:
          userID,

        sourceType:
          "skill",

        duration,

        magnitude:
          clamp(
            safeNumber(
              skill.amount ??
              skill.dodgeBonus ??
              0.25
            ),
            0,
            0.90
          ),
      }
    );

    session.player_mp =
      clamp(
        getSessionMP(session) -
          mpCost,
        0,
        player.maxMp
      );

    session.player_stamina =
      clamp(
        getSessionStamina(session) -
          staminaCost,
        0,
        player.maxStamina
      );

    setCooldown(
      metadata,
      `skill:${id}`,
      storedCooldown
    );

    return {
      ok: true,
      damage: 0,
      messages: [
        `${skill.name} surrounds you with evasive energy.`,
      ],
    };
  }

  /*
   * ----------------------------------------------------------
   * GUARD HEAL / HEAL
   * ----------------------------------------------------------
   */
  if (
    skill.effect ===
      "guard_heal" ||
    skill.type ===
      "heal"
  ) {
    const percent =
      clamp(
        safeNumber(
          skill.healPercent ??
          skill.amount ??
          0.15
        ),
        0,
        1
      );

    session.player_mp =
      clamp(
        getSessionMP(session) -
          mpCost,
        0,
        player.maxMp
      );

    session.player_stamina =
      clamp(
        getSessionStamina(session) -
          staminaCost,
        0,
        player.maxStamina
      );

    if (
      skill.effect ===
      "guard_heal"
    ) {
      metadata.defending =
        true;
    }

    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          player.maxHp *
          percent,
      });

    setCooldown(
      metadata,
      `skill:${id}`,
      storedCooldown
    );

    return {
      ok: true,
      damage: 0,
      messages: [
        `${skill.name} restores ${formatNumber(
          healed.actualHealing
        )} HP.`,
      ],
    };
  }

  /*
   * ----------------------------------------------------------
   * OFFENSIVE SKILL
   * ----------------------------------------------------------
   */
  const enemy =
    getEnemy(
      session.enemy_id
    );

  const enemyDefense =
    await getEffectiveEnemyDefense(
      threadID,
      combatID,
      enemy?.defense || 0
    );

  const magical =
    skill.effect === "magic" ||
    skill.type === "magic" ||
    skill.magical === true;

  const affinityID =
    skill.affinity ||
    null;

  let affinityMultiplier =
    1;

  if (affinityID) {
    const affinity =
      await getCombatAffinityMultiplier(
        threadID,
        userID,
        affinityID,
        metadata.environment
      );

    if (
      !affinity.unlocked
    ) {
      return {
        ok: false,
        reason:
          `Your ${affinityID} affinity is not unlocked.`,
      };
    }

    affinityMultiplier =
      affinity.multiplier;
  }

  const basePower =
    safeNumber(
      skill.power ??
      skill.damage
    );

  let multiplier =
    affinityMultiplier;

  /*
   * Some class data uses multiplier as
   * an actual multiplier. Only apply it when
   * a real power value exists.
   */
  if (
    basePower > 0 &&
    skill.multiplier != null
  ) {
    multiplier *=
      Math.max(
        0,
        safeNumber(
          skill.multiplier,
          1
        )
      );
  }

  /*
   * Execute skills gain +50% damage when the
   * enemy is below 30% HP.
   */
  if (
    skill.effect ===
      "execute" &&
    enemy &&
    getEnemyHP(session) <
      enemy.maxHp * 0.30
  ) {
    multiplier *= 1.5;
  }

  const critical =
    chance(
      skill.criticalChance != null
        ? clamp(
            safeNumber(
              skill.criticalChance
            ),
            0,
            1
          )
        : (
            skill.effect ===
            "critical"
              ? Math.max(
                  CRIT_CHANCE,
                  0.15
                )
              : CRIT_CHANCE
          )
    );

  const baseDamage =
    calculateBaseDamage({
      attack:
        player.strength,

      intelligence:
        player.intelligence,

      power:
        basePower,

      multiplier,

      defense:
        enemyDefense,

      magical,

      crit:
        critical,
    });

  const dealt =
    await applyDamageToEnemy({
      threadID,
      combatID,
      userID,
      session,
      damage:
        baseDamage,
    });

  session.player_mp =
    clamp(
      getSessionMP(session) -
        mpCost,
      0,
      player.maxMp
    );

  session.player_stamina =
    clamp(
      getSessionStamina(session) -
        staminaCost,
      0,
      player.maxStamina
    );

  /*
   * ----------------------------------------------------------
   * SKILL EFFECTS
   * ----------------------------------------------------------
   */

  if (
    skill.effect === "poison"
  ) {
    await effects.applyEffect(
      threadID,
      combatID,
      enemyTargetID(),
      {
        id:
          effects.EFFECT_IDS
            .POISON,

        source:
          userID,

        sourceType:
          "skill",

        duration:
          safeNumber(
            skill.duration,
            3
          ),

        magnitude:
          safeNumber(
            skill.damageOverTime ??
            skill.dot ??
            3
          ),
      }
    );
  }

  if (
    skill.effect === "stun"
  ) {
    await effects.applyEffect(
      threadID,
      combatID,
      enemyTargetID(),
      {
        id:
          effects.EFFECT_IDS
            .STUN,

        source:
          userID,

        sourceType:
          "skill",

        duration:
          safeNumber(
            skill.duration,
            1
          ),

        magnitude: 1,
      }
    );
  }

  /*
   * Holy Strike / heal-damage style skills
   * heal 10% max HP after dealing damage.
   */
  if (
    skill.effect ===
    "heal_damage"
  ) {
    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          player.maxHp * 0.10,
      });

    if (
      healed.actualHealing >
      0
    ) {
      messagesPush(
        null,
        null
      );
    }
  }

  setCooldown(
    metadata,
    `skill:${id}`,
    storedCooldown
  );

  const messages = [];

  messages.push(
    critical
      ? `Critical! ${skill.name} deals ${formatNumber(
          dealt.damage
        )} damage.`
      : `${skill.name} deals ${formatNumber(
          dealt.damage
        )} damage.`
  );

  if (
    skill.effect ===
    "heal_damage"
  ) {
    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          player.maxHp * 0.10,
      });

    if (
      healed.actualHealing >
      0
    ) {
      messages.push(
        `${skill.name} restores ${formatNumber(
          healed.actualHealing
        )} HP.`
      );
    }
  }

  if (
    dealt.lifesteal > 0
  ) {
    const lifesteal =
      effects.calculateLifesteal(
        dealt.damage,
        dealt.lifesteal
      );

    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          lifesteal,
      });

    if (
      healed.actualHealing >
      0
    ) {
      messages.push(
        `Lifesteal restores ${formatNumber(
          healed.actualHealing
        )} HP.`
      );
    }
  }

  return {
    ok: true,
    damage:
      dealt.damage,
    critical,
    messages,
  };
}

/*
 * Small compatibility helper. Kept intentionally harmless.
 */
function messagesPush() {
  return;
}

// ============================================================
// SPELL EFFECT APPLICATION
// ============================================================

async function applySpellEffects({
  threadID,
  combatID,
  userID,
  spell,
}) {
  const effectsList =
    Array.isArray(
      spell.effects
    )
      ? spell.effects
      : [];

  const messages = [];

  for (
    const definition of effectsList
  ) {
    if (
      !definition ||
      !definition.id
    ) {
      continue;
    }

    const effectID =
      effects.normalizeEffectId(
        definition.id
      );

    if (
      !effectID ||
      !effects.DEFAULTS?.[effectID]
    ) {
      continue;
    }

    let target =
      spell.target === "self"
        ? playerTargetID(userID)
        : enemyTargetID();

    if (
      spell.target === "all"
    ) {
      target =
        effectsTargetForEffect(
          effectID,
          playerTargetID(userID)
        );
    }

    if (
      !target
    ) {
      continue;
    }

    const magnitude =
      safeNumber(
        definition.amount ??
        definition.magnitude ??
        definition.damage
      );

    const applied =
      await effects.applyEffect(
        threadID,
        combatID,
        target,
        {
          id:
            effectID,

          source:
            userID,

          sourceType:
            "spell",

          duration:
            safeNumber(
              definition.duration,
              1
            ),

          magnitude,

          data: {
            spellID:
              spell.id,

            ...definition,
          },
        }
      );

    if (
      applied?.effect
    ) {
      messages.push(
        `${spell.name} applies ${effects.describeEffect(
          applied.effect
        )}.`
      );
    }
  }

  return messages;
}

// ============================================================
// SPELL EXECUTION
// ============================================================

async function executeSpell({
  threadID,
  combatID,
  userID,
  session,
  player,
  metadata,
  spellID,
}) {
  const id =
    spells.normalizeSpellId(
      spellID
    );

  const spell =
    spells.getSpell(id);

  if (!spell) {
    return {
      ok: false,
      reason:
        `Unknown spell: ${spellID}`,
    };
  }

  if (
    await effects.isShadowDisabled(
      threadID,
      combatID,
      playerTargetID(userID)
    ) &&
    spell.affinity ===
      "shadow"
  ) {
    return {
      ok: false,
      reason:
        "Your Shadow spells are disabled.",
    };
  }

  const cooldown =
    getCooldown(
      metadata,
      `spell:${id}`
    );

  if (cooldown > 0) {
    return {
      ok: false,
      reason:
        `${spell.name} is on cooldown for ${cooldown} more turn${
          cooldown === 1
            ? ""
            : "s"
        }.`,
    };
  }

  const validation =
    await spells.validateSpellCast(
      threadID,
      userID,
      id,
      {
        currentMP:
          getSessionMP(session),

        inCombat: true,

        combatID,

        environment:
          metadata.environment,
      }
    );

  if (
    !validation.ok
  ) {
    return {
      ok: false,
      reason:
        validation.reason ||
        `You cannot cast ${spell.name}.`,
    };
  }

  const effectData =
    spells.getSpellEffectData(
      id
    ) || spell;

  const messages = [];

  /*
   * Utility spells.
   */
  if (
    effectData.type ===
    "utility"
  ) {
    session.player_mp =
      clamp(
        getSessionMP(session) -
          safeNumber(
            effectData.manaCost
          ),
        0,
        player.maxMp
      );

    setCooldown(
      metadata,
      `spell:${id}`,
      2
    );

    if (
      effectData.utility ===
      "detect"
    ) {
      return {
        ok: true,
        damage: 0,
        messages: [
          `${spell.name} reveals magical activity around you.`,
        ],
      };
    }

    if (
      effectData.utility ===
      "teleport"
    ) {
      return {
        ok: true,
        damage: 0,
        messages: [
          `${spell.name} prepares a sanctuary teleport.`,
        ],
      };
    }

    return {
      ok: true,
      damage: 0,
      messages: [
        `${spell.name} is cast.`,
      ],
    };
  }

  const manaCost =
    safeNumber(
      effectData.manaCost
    );

  const healPercent =
    clamp(
      safeNumber(
        effectData.healPercent
      ),
      0,
      1
    );

  const manaRestorePercent =
    clamp(
      safeNumber(
        effectData.manaRestorePercent
      ),
      0,
      1
    );

  const NON_DAMAGE_TYPES = [
    "heal",
    "buff",
    "mana",
    "buff_heal",
    "debuff",
    "summon",
  ];

  /*
   * ----------------------------------------------------------
   * NON-DAMAGE SPELLS
   * ----------------------------------------------------------
   */
  if (
    NON_DAMAGE_TYPES.includes(
      effectData.type
    )
  ) {
    session.player_mp =
      clamp(
        getSessionMP(session) -
          manaCost,
        0,
        player.maxMp
      );

    if (
      effectData.type ===
      "summon"
    ) {
      await effects.applyEffect(
        threadID,
        combatID,
        playerTargetID(userID),
        {
          id:
            effects.EFFECT_IDS
              .DAMAGE_UP,

          source:
            userID,

          sourceType:
            "spell",

          duration: 4,

          magnitude: 1.3,

          data: {
            spellOnly: true,
            summon: true,
          },
        }
      );

      messages.push(
        `${spell.name} raises undead allies to fight beside you.`
      );
    }

    if (
      healPercent > 0
    ) {
      const healed =
        await healPlayer({
          threadID,
          combatID,
          session,
          player,
          amount:
            player.maxHp *
            healPercent,
        });

      if (
        healed.actualHealing >
        0
      ) {
        messages.push(
          `${spell.name} restores ${formatNumber(
            healed.actualHealing
          )} HP.`
        );
      }

      if (
        healed.defenseHealth >
        0
      ) {
        messages.push(
          `${formatNumber(
            healed.defenseHealth
          )} overheal becomes Defense Health.`
        );
      }
    }

    if (
      manaRestorePercent >
      0
    ) {
      const restored =
        Math.max(
          1,
          Math.round(
            player.maxMp *
              manaRestorePercent
          )
        );

      session.player_mp =
        clamp(
          getSessionMP(session) +
            restored,
          0,
          player.maxMp
        );

      messages.push(
        `${spell.name} restores ${formatNumber(
          restored
        )} MP.`
      );
    }

    messages.push(
      ...await applySpellEffects({
        threadID,
        combatID,
        userID,
        spell:
          effectData,
      })
    );

    setCooldown(
      metadata,
      `spell:${id}`,
      2
    );

    return {
      ok: true,
      damage: 0,
      messages,
    };
  }

  /*
   * ----------------------------------------------------------
   * OFFENSIVE SPELL
   * ----------------------------------------------------------
   */

  const enemy =
    getEnemy(
      session.enemy_id
    );

  const enemyDefense =
    await getEffectiveEnemyDefense(
      threadID,
      combatID,
      enemy?.defense || 0
    );

  const affinity =
    await getCombatAffinityMultiplier(
      threadID,
      userID,
      effectData.affinity,
      metadata.environment
    );

  /*
   * External affinity spells:
   *
   * Arcanist gets a reduced fallback if the
   * affinity is not unlocked. Other classes
   * cannot use it.
   */
  let powerMultiplier =
    affinity.multiplier;

  if (
    !affinity.unlocked
  ) {
    if (
      player.characterClass ===
      "arcanist"
    ) {
      powerMultiplier = 0.75;
    } else {
      return {
        ok: false,
        reason:
          `Your ${effectData.affinity} affinity is not unlocked.`,
      };
    }
  }

  const spellPower =
    Math.round(
      safeNumber(
        effectData.power ??
        effectData.damage
      ) *
        powerMultiplier
    );

  const critical =
    chance(
      CRIT_CHANCE
    );

  const baseDamage =
    calculateBaseDamage({
      attack:
        player.strength,

      intelligence:
        player.intelligence,

      power:
        spellPower,

      multiplier: 1,

      defense:
        enemyDefense,

      magical: true,

      crit:
        critical,
    });

  const dealt =
    await applyDamageToEnemy({
      threadID,
      combatID,
      userID,
      session,
      damage:
        baseDamage,

      context: {
        spell: true,
      },
    });

  session.player_mp =
    clamp(
      getSessionMP(session) -
        manaCost,
      0,
      player.maxMp
    );

  if (
    safeNumber(
      effectData.lifestealPercent
    ) > 0
  ) {
    const lifesteal =
      effects.calculateLifesteal(
        dealt.damage,
        effectData.lifestealPercent
      );

    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          lifesteal,
      });

    if (
      healed.actualHealing >
      0
    ) {
      messages.push(
        `Lifesteal restores ${formatNumber(
          healed.actualHealing
        )} HP.`
      );
    }
  }

  if (
    healPercent > 0
  ) {
    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          player.maxHp *
          healPercent,
      });

    if (
      healed.actualHealing >
      0
    ) {
      messages.push(
        `${spell.name} restores ${formatNumber(
          healed.actualHealing
        )} HP.`
      );
    }

    if (
      healed.defenseHealth >
      0
    ) {
      messages.push(
        `${formatNumber(
          healed.defenseHealth
        )} overheal becomes Defense Health.`
      );
    }
  }

  messages.unshift(
    critical
      ? `Critical! ${spell.name} deals ${formatNumber(
          dealt.damage
        )} damage.`
      : `${spell.name} deals ${formatNumber(
          dealt.damage
        )} damage.`
  );

  messages.push(
    ...await applySpellEffects({
      threadID,
      combatID,
      userID,
      spell:
        effectData,
    })
  );

  setCooldown(
    metadata,
    `spell:${id}`,
    2
  );

  return {
    ok: true,
    damage:
      dealt.damage,
    critical,
    messages,
  };
}

// ============================================================
// SPECIAL INPUT
// ============================================================

function splitSpecialInput(raw) {
  const tokens =
    String(
      raw || ""
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  for (
    let n = tokens.length;
    n >= 1;
    n--
  ) {
    const candidate =
      tokens
        .slice(0, n)
        .join(" ");

    const id =
      specials.normalizeSpecialId(
        candidate
      );

    if (
      id &&
      specials.getSpecial(id)
    ) {
      return {
        specialID: id,
        argument:
          tokens
            .slice(n)
            .join(" "),
      };
    }
  }

  return {
    specialID: raw,
    argument: "",
  };
}

// ============================================================
// SPECIAL EXECUTION
// ============================================================

async function executeSpecial({
  threadID,
  combatID,
  userID,
  session,
  player,
  metadata,
  specialID,
  argument = "",
}) {
  const id =
    specials.normalizeSpecialId(
      specialID
    );

  const special =
    specials.getSpecial(id);

  if (!special) {
    return {
      ok: false,
      reason:
        `Unknown special: ${specialID}`,
    };
  }

  const cooldown =
    getCooldown(
      metadata,
      `special:${id}`
    );

  if (cooldown > 0) {
    return {
      ok: false,
      reason:
        `${special.name} is on cooldown for ${cooldown} more turn${
          cooldown === 1
            ? ""
            : "s"
        }.`,
    };
  }

  const environment =
    metadata.environment ||
    {};

  const validation =
    await specials.canUseSpecial(
      threadID,
      userID,
      id,
      {
        inCombat: true,

        combatID,

        environment,

        playerHP:
          getSessionHP(session),

        playerMP:
          getSessionMP(session),

        playerStamina:
          getSessionStamina(
            session
          ),

        isMorning:
          environment.isMorning ===
            true ||
          environment.morning ===
            true,
      }
    );

  if (
    !validation.ok
  ) {
    return {
      ok: false,
      reason:
        validation.reason ||
        `You cannot use ${special.name}.`,
    };
  }

  const definition =
    validation.special ||
    special;

  const cost =
    definition.cost ||
    {};

  const mpCost =
    safeNumber(
      cost.mp
    );

  const staminaCost =
    safeNumber(
      cost.stamina
    );

  const hpPercent =
    clamp(
      safeNumber(
        cost.hpPercent
      ),
      0,
      1
    );

  /*
   * Check affinity BEFORE spending resources.
   */
  let affinityMultiplier =
    1;

  let affinityData = null;

  if (
    definition.affinity
  ) {
    affinityData =
      await getCombatAffinityMultiplier(
        threadID,
        userID,
        definition.affinity,
        metadata.environment
      );

    if (
      !affinityData.unlocked
    ) {
      return {
        ok: false,
        reason:
          `Your ${definition.affinity} affinity is not unlocked.`,
      };
    }

    affinityMultiplier =
      definition.flags
        ?.ignoresSeasonPenalty
        ? affinityData.baseMultiplier *
          Math.max(
            1,
            affinityData.environmentalMultiplier
          )
        : affinityData.multiplier;
  }

  if (
    getSessionMP(session) <
    mpCost
  ) {
    return {
      ok: false,
      reason:
        `Not enough MP. ${special.name} requires ${mpCost} MP.`,
    };
  }

  if (
    getSessionStamina(session) <
    staminaCost
  ) {
    return {
      ok: false,
      reason:
        `Not enough stamina. ${special.name} requires ${staminaCost} stamina.`,
    };
  }

  const hpCost =
    Math.round(
      player.maxHp *
        hpPercent
    );

  if (
    hpCost > 0 &&
    getSessionHP(session) <=
      hpCost
  ) {
    return {
      ok: false,
      reason:
        `You need more than ${formatNumber(
          hpCost
        )} HP to sacrifice that much health.`,
    };
  }

  /*
   * Pay resources.
   */
  session.player_mp =
    clamp(
      getSessionMP(session) -
        mpCost,
      0,
      player.maxMp
    );

  session.player_stamina =
    clamp(
      getSessionStamina(session) -
        staminaCost,
      0,
      player.maxStamina
    );

  if (hpCost > 0) {
    session.player_hp =
      Math.max(
        1,
        getSessionHP(session) -
          hpCost
      );
  }

  const effectData =
    definition.effects ||
    {};

  const messages = [];

  let totalDamage = 0;

  /*
   * ----------------------------------------------------------
   * HEAVEN PIERCING ICE WALL
   * ----------------------------------------------------------
   */
  if (
    id ===
    "heaven_piercing_ice_wall"
  ) {
    await effects.createIceWall(
      threadID,
      combatID,
      playerTargetID(userID),
      userID
    );

    messages.push(
      `${special.name} surrounds you with an ice wall.`
    );
  }

  /*
   * ----------------------------------------------------------
   * INFINITE DARKNESS
   * ----------------------------------------------------------
   */
  else if (
    id ===
    "infinite_darkness"
  ) {
    await effects.createInfiniteDarkness(
      threadID,
      combatID,
      playerTargetID(userID),
      {
        duration:
          safeNumber(
            effectData.duration,
            5
          ),
      }
    );

    await effects.createShadowBody(
      threadID,
      combatID,
      playerTargetID(userID),
      userID
    );

    messages.push(
      `${special.name} envelops the battlefield in darkness.`
    );
  }

  /*
   * ----------------------------------------------------------
   * WORLD BLOOM
   * ----------------------------------------------------------
   */
  else if (
    id === "worldbloom"
  ) {
    const heal =
      safeNumber(
        effectData
          .healAlliesLostHpPercent
      );

    if (heal > 0) {
      const healed =
        await healPlayer({
          threadID,
          combatID,
          session,
          player,
          amount:
            player.maxHp *
            heal,
        });

      if (
        healed.actualHealing >
        0
      ) {
        messages.push(
          `${special.name} restores ${formatNumber(
            healed.actualHealing
          )} HP.`
        );
      }

      if (
        healed.defenseHealth >
        0
      ) {
        messages.push(
          `Bark Skin converts ${formatNumber(
            healed.defenseHealth
          )} overheal into Defense Health.`
        );
      }
    }

    const mpRestore =
      clamp(
        safeNumber(
          effectData
            .regenerateMpPercent
        ),
        0,
        1
      );

    const staminaRestore =
      clamp(
        safeNumber(
          effectData
            .regenerateStaminaPercent
        ),
        0,
        1
      );

    if (mpRestore > 0) {
      const restored =
        Math.round(
          player.maxMp *
            mpRestore
        );

      session.player_mp =
        clamp(
          getSessionMP(session) +
            restored,
          0,
          player.maxMp
        );
    }

    if (
      staminaRestore > 0
    ) {
      const restored =
        Math.round(
          player.maxStamina *
            staminaRestore
        );

      session.player_stamina =
        clamp(
          getSessionStamina(session) +
            restored,
          0,
          player.maxStamina
        );
    }

    await effects.applyEffect(
      threadID,
      combatID,
      playerTargetID(userID),
      {
        id:
          effects.EFFECT_IDS
            .BARK_SKIN,

        source:
          userID,

        sourceType:
          "special",

        duration:
          safeNumber(
            effectData
              .barkSkinTurns,
            5
          ),

        magnitude: 1,
      }
    );

    metadata.environment = {
      ...metadata.environment,

      weather:
        effectData.weatherChange ||
        metadata.environment
          ?.weather ||
        "rain",

      season:
        metadata.environment
          ?.season ||
        "spring",
    };

    messages.push(
      `${special.name} changes the battlefield weather.`
    );
  }

  /*
   * ----------------------------------------------------------
   * ARCANE OVERDRIVE
   * ----------------------------------------------------------
   */
  else if (
    id === "arcane_overdrive"
  ) {
    await effects.applyEffect(
      threadID,
      combatID,
      playerTargetID(userID),
      {
        id:
          effects.EFFECT_IDS
            .DAMAGE_UP,

        source:
          userID,

        sourceType:
          "special",

        duration:
          safeNumber(
            effectData.duration,
            5
          ),

        magnitude:
          safeNumber(
            effectData
              .spellDamageMultiplier,
            1.5
          ),

        data: {
          spellOnly: true,
        },
      }
    );

    await effects.applyEffect(
      threadID,
      combatID,
      playerTargetID(userID),
      {
        id:
          effects.EFFECT_IDS
            .MANA_REGEN_UP,

        source:
          userID,

        sourceType:
          "special",

        duration:
          safeNumber(
            effectData.duration,
            5
          ),

        /*
         * Convert multiplier to actual regen
         * magnitude.
         */
        magnitude:
          0.05 *
          safeNumber(
            effectData
              .manaRegenMultiplier,
            2
          ),
      }
    );

    messages.push(
      `${special.name} amplifies your magical power.`
    );
  }

  /*
   * ----------------------------------------------------------
   * AMATERASU'S BLESSING
   * ----------------------------------------------------------
   */
  else if (
    id ===
    "amaterasus_blessing"
  ) {
    const requestedMode =
      normalizeID(
        argument
      );

    const modes =
      effectData.modes ||
      {};

    let mode =
      modes[
        requestedMode
      ];

    if (!mode) {
      mode =
        modes.solar_lance ||
        Object.values(
          modes
        )[0];
    }

    if (mode) {
      const modeDamage =
        safeNumber(
          mode.damageMultiplier
        );

      if (
        modeDamage > 0
      ) {
        const enemy =
          getEnemy(
            session.enemy_id
          );

        const defense =
          await getEffectiveEnemyDefense(
            threadID,
            combatID,
            enemy?.defense || 0
          );

        const damage =
          calculateBaseDamage({
            attack:
              player.strength,

            intelligence:
              player.intelligence,

            power:
              safeNumber(
                special.effects
                  ?.damageMultiplier
              ) ||
              100,

            multiplier:
              modeDamage *
              affinityMultiplier,

            defense,

            magical: true,

            crit: false,
          });

        const dealt =
          await applyDamageToEnemy({
            threadID,
            combatID,
            userID,
            session,
            damage,
          });

        totalDamage +=
          dealt.damage;

        messages.push(
          `${special.name} (${mode.name || requestedMode || "solar lance"}) deals ${formatNumber(
            dealt.damage
          )} damage.`
        );
      }
    }
  }

  /*
   * ----------------------------------------------------------
   * ARMY OF THE FALLEN
   * ----------------------------------------------------------
   */
  else if (
    id ===
    "army_of_the_fallen"
  ) {
    await effects.applyEffect(
      threadID,
      combatID,
      playerTargetID(userID),
      {
        id:
          effects.EFFECT_IDS
            .DAMAGE_UP,

        source:
          userID,

        sourceType:
          "special",

        duration:
          safeNumber(
            effectData
              .summonDuration,
            5
          ),

        magnitude:
          1 +
          safeNumber(
            effectData
              .summonCount,
            3
          ) *
          safeNumber(
            effectData
              .summonStatMultiplier,
            0.45
          ),
      }
    );

    messages.push(
      `${special.name} summons fallen warriors to your side.`
    );
  }

  /*
   * ----------------------------------------------------------
   * GENERIC OFFENSIVE SPECIAL
   * ----------------------------------------------------------
   */
  const damageMultiplier =
    safeNumber(
      effectData.damageMultiplier
    );

  if (
    damageMultiplier > 0 &&
    ![
      "amaterasus_blessing",
    ].includes(id)
  ) {
    const enemy =
      getEnemy(
        session.enemy_id
      );

    const defense =
      await getEffectiveEnemyDefense(
        threadID,
        combatID,
        enemy?.defense || 0
      );

    const power =
      Math.max(
        1,
        safeNumber(
          enemy?.maxHp,
          100
        ) *
          0.15
      );

    const hits =
      Math.max(
        1,
        Math.round(
          safeNumber(
            effectData.hits,
            1
          )
        )
      );

    for (
      let hit = 0;
      hit < hits;
      hit++
    ) {
      let multiplier =
        damageMultiplier;

      /*
       * Celestial Tempest and other multi-hit
       * definitions may use either field.
       */
      if (
        effectData
          .damageMultiplierPerHit !=
        null
      ) {
        multiplier =
          safeNumber(
            effectData
              .damageMultiplierPerHit
          );
      }

      if (
        effectData
          .damageMultiplier !=
          null &&
        effectData
          .damageMultiplierPerHit ==
          null
      ) {
        multiplier =
          safeNumber(
            effectData
              .damageMultiplier
          );
      }

      const damage =
        calculateBaseDamage({
          attack:
            player.strength,

          intelligence:
            player.intelligence,

          power,

          multiplier:
            multiplier *
            affinityMultiplier,

          defense,

          magical: true,

          crit: false,
        });

      const dealt =
        await applyDamageToEnemy({
          threadID,
          combatID,
          userID,
          session,
          damage,
        });

      totalDamage +=
        dealt.damage;

      messages.push(
        hit > 0
          ? `${special.name} hits again for ${formatNumber(
              dealt.damage
            )}.`
          : `${special.name} deals ${formatNumber(
              dealt.damage
            )} damage.`
      );

      if (
        getEnemyHP(session) <=
        0
      ) {
        break;
      }
    }
  }

  /*
   * ----------------------------------------------------------
   * SPECIAL EFFECTS
   * ----------------------------------------------------------
   */

  if (
    id ===
    "scorching_garden"
  ) {
    await effects.applyEffect(
      threadID,
      combatID,
      enemyTargetID(),
      {
        id:
          effects.EFFECT_IDS
            .BURN,

        source:
          userID,

        sourceType:
          "special",

        duration:
          safeNumber(
            effectData
              .burn?.duration,
            3
          ),

        magnitude:
          safeNumber(
            effectData
              .burn?.damagePercent,
            0.08
          ) *
          Math.max(
            1,
            getEnemy(
              session.enemy_id
            )?.maxHp || 100
          ),
      }
    );

    messages.push(
      "The enemy is engulfed in burning flames."
    );
  }

  if (
    id === "heavens_thunder"
  ) {
    if (
      chance(
        clamp(
          safeNumber(
            effectData.stunChance
          ),
          0,
          1
        )
      )
    ) {
      await effects.applyEffect(
        threadID,
        combatID,
        enemyTargetID(),
        {
          id:
            effects.EFFECT_IDS
              .STUN,

          source:
            userID,

          sourceType:
            "special",

          duration: 1,

          magnitude: 1,
        }
      );

      messages.push(
        "The lightning stuns the enemy."
      );
    }
  }

  if (
    id === "worldbreaker"
  ) {
    await effects.applyEffect(
      threadID,
      combatID,
      enemyTargetID(),
      {
        id:
          effects.EFFECT_IDS
            .DEFENSE_BREAK,

        source:
          userID,

        sourceType:
          "special",

        duration:
          safeNumber(
            effectData.duration,
            4
          ),

        magnitude:
          clamp(
            safeNumber(
              effectData
                .defenseReduction,
              0.25
            ),
            0,
            1
          ),
      }
    );

    messages.push(
      "The enemy's defenses are shattered."
    );
  }

  /*
   * Crimson Requiem heals from ACTUAL
   * damage dealt by the entire special.
   */
  if (
    id === "crimson_requiem"
  ) {
    if (
      totalDamage > 0
    ) {
      const amount =
        effects.calculateLifesteal(
          totalDamage,
          safeNumber(
            effectData
              .lifestealPercent,
            0.4
          )
        );

      const healed =
        await healPlayer({
          threadID,
          combatID,
          session,
          player,
          amount,
        });

      if (
        healed.actualHealing >
        0
      ) {
        messages.push(
          `Crimson Requiem restores ${formatNumber(
            healed.actualHealing
          )} HP.`
        );
      }
    }
  }

  /*
   * Infinite Darkness stuns the enemy.
   */
  if (
    id ===
    "infinite_darkness"
  ) {
    await effects.applyEffect(
      threadID,
      combatID,
      enemyTargetID(),
      {
        id:
          effects.EFFECT_IDS
            .STUN,

        source:
          userID,

        sourceType:
          "special",

        duration:
          1,

        magnitude:
          1,
      }
    );

    messages.push(
      "The enemy is stunned by the darkness."
    );
  }

  /*
   * Ice Wall freezes the enemy's next response.
   */
  if (
    id ===
    "heaven_piercing_ice_wall"
  ) {
    await effects.applyEffect(
      threadID,
      combatID,
      enemyTargetID(),
      {
        id:
          effects.EFFECT_IDS
            .STUN,

        source:
          userID,

        sourceType:
          "special",

        duration:
          1,

        magnitude:
          1,
      }
    );

    messages.push(
      "The ice wall freezes the enemy's next response."
    );
  }

  /*
   * Generic stun-capable specials.
   */
  if (
    effectData.stunChance != null &&
    id !== "heavens_thunder"
  ) {
    if (
      chance(
        clamp(
          safeNumber(
            effectData.stunChance
          ),
          0,
          1
        )
      )
    ) {
      await effects.applyEffect(
        threadID,
        combatID,
        enemyTargetID(),
        {
          id:
            effects.EFFECT_IDS
              .STUN,

          source:
            userID,

          sourceType:
            "special",

          duration: 1,

          magnitude: 1,
        }
      );
    }
  }

  /*
   * Generic healing:
   *
   * Self-heal and ally-heal are two representations
   * of the same player in this single-player combat
   * engine. Do not apply both independently.
   */
  const selfHeal =
    safeNumber(
      effectData
        .healSelfLostHpPercent
    );

  const allyHeal =
    id === "worldbloom"
      ? 0
      : safeNumber(
          effectData
            .healAlliesLostHpPercent
        );

  const totalHeal =
    Math.max(
      selfHeal,
      allyHeal
    );

  if (
    totalHeal > 0 &&
    id !== "crimson_requiem"
  ) {
    const healed =
      await healPlayer({
        threadID,
        combatID,
        session,
        player,
        amount:
          player.maxHp *
          totalHeal,
      });

    if (
      healed.actualHealing >
      0
    ) {
      messages.push(
        `${special.name} restores ${formatNumber(
          healed.actualHealing
        )} HP.`
      );
    }
  }

  setCooldown(
    metadata,
    `special:${id}`,
    Math.max(
      0,
      safeNumber(
        definition.cooldown,
        1
      )
    ) + 1
  );

  /*
   * Persist successful special progression only after the
   * special has fully resolved. Tracking failure must never
   * turn a successful combat action into a failed action.
   */
  try {
    if (
      typeof specials.recordSpecialUse ===
      "function"
    ) {
      await specials.recordSpecialUse(
        threadID,
        userID,
        id,
        25
      );
    }
  } catch (error) {
    console.error(
      "[RPG] Failed to record special mastery:",
      error
    );
  }

  return {
    ok: true,
    damage:
      totalDamage,
    messages:
      messages.length
        ? messages
        : [
            `${special.name} is unleashed.`,
          ],
  };
}

// ============================================================
// ITEM EXECUTION
// ============================================================

async function executeItem({
  threadID,
  userID,
  session,
  player,
  itemID,
}) {
  const id =
    normalizeID(itemID);

  const item =
    getItem(id);

  if (!item) {
    return {
      ok: false,
      reason:
        `Unknown item: ${itemID}`,
    };
  }

  if (
    item.type !==
      "consumable" &&
    item.category !==
      "consumable"
  ) {
    return {
      ok: false,
      reason:
        `${item.name || id} cannot be used in combat.`,
    };
  }

  const effect =
    item.effect ||
    {};

  /*
   * Reject an item that has no usable combat
   * effect before consuming it.
   */
  const hasHp =
    safeNumber(
      effect.hp ??
      effect.heal
    ) > 0;

  const hasMp =
    safeNumber(
      effect.mp
    ) > 0;

  if (
    !hasHp &&
    !hasMp
  ) {
    return {
      ok: false,
      reason:
        `${item.name || id} has no usable combat effect.`,
    };
  }

  /*
   * Consume through db.js so inventory handling
   * stays transactional.
   */
  if (
    typeof db.getRpgItemQuantity ===
    "function"
  ) {
    const quantity =
      await db.getRpgItemQuantity(
        threadID,
        userID,
        id
      );

    if (
      safeNumber(quantity) <=
      0
    ) {
      return {
        ok: false,
        reason:
          `You do not have ${item.name || id}.`,
      };
    }
  } else {
    const result =
      await db.query(
        `
          SELECT quantity
          FROM rpg_inventory_items
          WHERE thread_id = $1
            AND user_id = $2
            AND item_id = $3
          LIMIT 1
        `,
        [
          String(threadID),
          String(userID),
          id,
        ]
      );

    if (
      !result.rows.length ||
      safeNumber(
        result.rows[0].quantity
      ) <= 0
    ) {
      return {
        ok: false,
        reason:
          `You do not have ${item.name || id}.`,
      };
    }
  }

  const messages = [];

  if (hasHp) {
    const amount =
      safeNumber(
        effect.hp ??
        effect.heal
      );

    const healed =
      await healPlayer({
        threadID,
        combatID:
          session.id,
        session,
        player,
        amount,
      });

    if (
      healed.actualHealing >
      0
    ) {
      messages.push(
        `${item.name || id} restores ${formatNumber(
          healed.actualHealing
        )} HP.`
      );
    }
  }

  if (hasMp) {
    const restored =
      safeNumber(
        effect.mp
      );

    session.player_mp =
      clamp(
        getSessionMP(session) +
          restored,
        0,
        player.maxMp
      );

    messages.push(
      `${item.name || id} restores ${formatNumber(
        restored
      )} MP.`
    );
  }

  let consumed = false;

  if (
    typeof db.consumeRpgItem ===
    "function"
  ) {
    const result =
      await db.consumeRpgItem(
        threadID,
        userID,
        id,
        1
      );

    consumed =
      result !== false;
  } else {
    const result =
      await db.query(
        `
          UPDATE rpg_inventory_items
          SET quantity = quantity - 1
          WHERE thread_id = $1
            AND user_id = $2
            AND item_id = $3
            AND quantity > 0
          RETURNING quantity
        `,
        [
          String(threadID),
          String(userID),
          id,
        ]
      );

    consumed =
      result.rowCount > 0;
  }

  if (!consumed) {
    return {
      ok: false,
      reason:
        `Unable to consume ${item.name || id}.`,
    };
  }

  return {
    ok: true,
    damage: 0,
    messages,
  };
}

// ============================================================
// DEFEND
// ============================================================

async function executeDefend({
  session,
  player,
  metadata,
}) {
  metadata.defending = true;

  session.player_mp =
    clamp(
      getSessionMP(session) +
        DEFEND_MP_RESTORE,
      0,
      player.maxMp
    );

  session.player_stamina =
    clamp(
      getSessionStamina(session) +
        DEFEND_STAMINA_RESTORE,
      0,
      player.maxStamina
    );

  return {
    ok: true,
    damage: 0,
    messages: [
      `You guard. Incoming damage is reduced by ${Math.round(
        (1 -
          DEFEND_DAMAGE_MULTIPLIER) *
          100
      )}%.`,
      `You recover ${DEFEND_MP_RESTORE} MP and ${DEFEND_STAMINA_RESTORE} stamina.`,
    ],
  };
}

// ============================================================
// ESCAPE
// ============================================================

async function executeEscape() {
  if (
    chance(
      ESCAPE_CHANCE
    )
  ) {
    return {
      ok: true,
      escaped: true,
      damage: 0,
      messages: [
        "You successfully escape from combat.",
      ],
    };
  }

  return {
    ok: true,
    escaped: false,
    damage: 0,
    messages: [
      "You fail to escape.",
    ],
  };
}

// ============================================================
// WRAITH REVIVAL
// ============================================================

async function tryWraithRevival({
  session,
  player,
  metadata,
}) {
  if (
    player.characterClass !==
    "wraith"
  ) {
    return false;
  }

  if (
    metadata.revivalUsed
  ) {
    return false;
  }

  const weather =
    String(
      metadata.environment
        ?.weather ||
      ""
    ).toLowerCase();

  const night =
    metadata.environment
      ?.night === true ||
    weather.includes(
      "night"
    );

  const probability =
    night
      ? 0.50
      : 0.25;

  if (
    !chance(
      probability
    )
  ) {
    return false;
  }

  metadata.revivalUsed =
    true;

  session.player_hp =
    Math.max(
      1,
      Math.round(
        player.maxHp *
          0.30
      )
    );

  return true;
}

// ============================================================
// VICTORY
// ============================================================

async function resolveVictory({
  threadID,
  userID,
  session,
  metadata,
}) {
  if (
    metadata.resolved === true
  ) {
    return {
      victory: true,
      alreadyResolved: true,
      reward:
        safeNumber(
          metadata.reward
        ),
      xp:
        safeNumber(
          metadata.xp
        ),
      loot:
        metadata.loot || [],
      elite:
        metadata.elite === true,
    };
  }

  const enemy =
    getEnemy(
      session.enemy_id
    );

  if (!enemy) {
    return {
      victory: true,
      reward: 0,
      xp: 0,
      loot: [],
      elite:
        metadata.elite === true,
    };
  }

  metadata.resolved =
    true;

  metadata.result =
    "victory";

  const reward =
    safeNumber(
      enemy.reward
    );

  const xp =
    safeNumber(
      enemy.xp
    );

  if (
    reward > 0 &&
    typeof db.addBalance ===
      "function"
  ) {
    await db.addBalance(
      threadID,
      userID,
      reward
    );
  }

  if (
    xp > 0 &&
    typeof db.addXP ===
      "function"
  ) {
    await db.addXP(
      threadID,
      userID,
      xp
    );
  }

  const loot =
    Array.isArray(
      enemy.loot
    )
      ? [
          ...enemy.loot,
        ]
      : [];

  /*
   * Prefer db.addRpgItem when available.
   */
  for (
    const itemID of loot
  ) {
    try {
      if (
        typeof db.addRpgItem ===
        "function"
      ) {
        await db.addRpgItem(
          threadID,
          userID,
          itemID,
          1
        );
      } else {
        await db.query(
          `
            INSERT INTO rpg_inventory_items
              (
                thread_id,
                user_id,
                item_id,
                quantity
              )
            VALUES
              ($1, $2, $3, 1)
            ON CONFLICT
              (thread_id, user_id, item_id)
            DO UPDATE SET
              quantity =
                rpg_inventory_items.quantity + 1
          `,
          [
            String(threadID),
            String(userID),
            itemID,
          ]
        );
      }
    } catch (_) {
      /*
       * Loot failure must not invalidate
       * the combat victory.
       */
    }
  }

  metadata.reward =
    reward;

  metadata.xp =
    xp;

  metadata.loot =
    loot;

  await saveCombat(
    session.id,
    {
      status:
        "victory",

      enemy_hp:
        0,

      metadata:
        serializeMetadata(
          metadata
        ),
    }
  );

  await cleanupEffects(
    threadID,
    session.id,
    userID
  );

  return {
    victory: true,
    reward,
    xp,
    loot,
    elite:
      metadata.elite === true,
  };
}

// ============================================================
// DEFEAT
// ============================================================

async function resolveDefeat({
  threadID,
  userID,
  session,
  player,
  metadata,
}) {
  if (
    metadata.resolved === true
  ) {
    return {
      defeat: true,
      alreadyResolved: true,
    };
  }

  const revived =
    await tryWraithRevival({
      session,
      player,
      metadata,
    });

  if (revived) {
    pushLog(
      metadata,
      "Wraith revival activates."
    );

    await saveCombat(
      session.id,
      {
        player_hp:
          session.player_hp,

        metadata:
          serializeMetadata(
            metadata
          ),
      }
    );

    await syncPlayerVitals(
      threadID,
      userID,
      session
    );

    return {
      defeat: false,
      revived: true,
    };
  }

  metadata.resolved =
    true;

  metadata.result =
    "defeat";

  session.player_hp =
    0;

  await saveCombat(
    session.id,
    {
      status:
        "defeat",

      player_hp:
        0,

      metadata:
        serializeMetadata(
          metadata
        ),
    }
  );

  try {
    await updateVitals(
      threadID,
      userID,
      {
        hp: 1,
      }
    );
  } catch (_) {}

  await cleanupEffects(
    threadID,
    session.id,
    userID
  );

  return {
    defeat: true,
    revived: false,
  };
}

// ============================================================
// HUNT CREATION
// ============================================================

async function createHunt(
  threadID,
  userID,
  options = {}
) {
  const active =
    await getActiveCombatRow(
      threadID,
      userID
    );

  if (active) {
    return {
      success: false,
      reason:
        "You are already in combat.",
      combat:
        await getCombat(
          threadID,
          userID
        ),
    };
  }

  const player =
    await buildPlayerSnapshot(
      threadID,
      userID
    );

  const state =
    player.state ||
    {};

  const enemy =
    options.enemyID ||
    options.enemyId
      ? getEnemy(
          options.enemyID ||
          options.enemyId
        )
      : chooseEnemy(
          options.elite === true
        );

  if (!enemy) {
    return {
      success: false,
      reason:
        "No valid enemy could be selected.",
    };
  }

  const currentHp =
    clamp(
      safeNumber(
        player.hp ??
        player.currentHp ??
        player.current_hp ??
        state?.player?.hp ??
        state?.hp,
        player.maxHp
      ),
      0,
      player.maxHp
    );

  /*
   * Do not create a combat session with
   * a dead character.
   */
  if (
    currentHp <= 0
  ) {
    return {
      success: false,
      reason:
        "You cannot begin a hunt with 0 HP. Rest and recover first.",
    };
  }

  const currentMp =
    clamp(
      safeNumber(
        player.mp ??
        player.currentMp ??
        player.current_mp ??
        state?.player?.mp ??
        state?.mp,
        player.maxMp
      ),
      0,
      player.maxMp
    );

  const currentStamina =
    clamp(
      safeNumber(
        player.stamina ??
        player.currentStamina ??
        player.current_stamina ??
        state?.player?.stamina ??
        state?.stamina,
        player.maxStamina
      ),
      0,
      player.maxStamina
    );

  const worldEnvironment =
    await getWorldEnvironment(
      threadID
    );

  const clock =
    clockTime();

  const suppliedEnvironment =
    options.environment &&
    typeof options.environment ===
      "object"
      ? options.environment
      : {};

  const environment =
    normalizeEnvironment(
      {
        ...worldEnvironment,
        ...suppliedEnvironment,

        regionId:
          suppliedEnvironment.regionId ??
          suppliedEnvironment.regionID ??
          options.regionID ??
          options.regionId ??
          worldEnvironment.regionId,

        locationId:
          suppliedEnvironment.locationId ??
          suppliedEnvironment.locationID ??
          options.locationID ??
          options.locationId,

        season:
          suppliedEnvironment.season ??
          options.season ??
          worldEnvironment.season,

        weather:
          suppliedEnvironment.weather ??
          options.weather ??
          worldEnvironment.weather,

        night:
          options.night ??
          suppliedEnvironment.night ??
          clock.night,

        morning:
          options.morning ??
          options.isMorning ??
          suppliedEnvironment.morning ??
          suppliedEnvironment.isMorning ??
          clock.morning,
      },
      player
    );

  const metadata = {
    player: {
      characterClass:
        player.characterClass,

      maxHp:
        player.maxHp,

      maxMp:
        player.maxMp,

      maxStamina:
        player.maxStamina,

      strength:
        player.strength,

      defense:
        player.defense,

      agility:
        player.agility,

      intelligence:
        player.intelligence,

      vitality:
        player.vitality,

      luck:
        player.luck,

      regionID:
        player.regionID,

      locationID:
        player.locationID,
    },

    enemy: {
      id:
        enemy.id,

      name:
        enemy.name,

      affinity:
        enemy.affinity,

      maxHp:
        enemy.maxHp,
    },

    cooldowns: {},

    environment,

    elite:
      options.elite === true,

    defending:
      false,

    revivalUsed:
      false,

    resolved:
      false,

    result:
      null,

    log: [],

    createdAt:
      now(),
  };

  pushLog(
    metadata,
    `${enemy.emoji || "⚔️"} ${enemy.name} appears.`
  );

  const nowMs =
    now();

  /*
   * IMPORTANT:
   *
   * rpg_combat_sessions requires the complete
   * enemy snapshot. Do not omit enemy_name,
   * enemy_max_hp, enemy_attack or enemy_defense.
   */
  await db.query(
    `
      INSERT INTO rpg_combat_sessions (
        thread_id,
        user_id,
        enemy_id,
        enemy_name,
        enemy_hp,
        enemy_max_hp,
        enemy_attack,
        enemy_defense,
        player_hp,
        player_mp,
        player_stamina,
        turn_number,
        status,
        metadata,
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
        $9,
        $10,
        $11,
        1,
        'active',
        $12,
        $13,
        $13
      )
    `,
    [
      String(threadID),
      String(userID),

      enemy.id,
      enemy.name,

      enemy.maxHp,
      enemy.maxHp,
      enemy.attack,
      enemy.defense,

      currentHp,
      currentMp,
      currentStamina,

      serializeMetadata(
        metadata
      ),

      nowMs,
    ]
  );

  const combat =
    await getCombat(
      threadID,
      userID
    );

  if (combat) {
    await syncPlayerVitals(
      threadID,
      userID,
      combat
    );
  }

  return {
    success: true,
    combat,
    enemy,
  };
}

// ============================================================
// COMBAT ACTION
// ============================================================

async function combatAction(
  threadID,
  userID,
  action = "attack",
  argument = ""
) {
  const session =
    await getCombat(
      threadID,
      userID
    );

  if (!session) {
    return {
      ok: false,
      active: false,
      reason:
        "You are not in combat.",
    };
  }

  const rawAction =
    normalizeAction(
      action
    );

  const rawArgument =
    String(
      argument || ""
    ).trim();

  const playerSnapshot =
    await buildPlayerSnapshot(
      threadID,
      userID
    );

  const metadata =
    parseMetadata(
      session.metadata
    );

  metadata.environment =
    normalizeEnvironment(
      metadata.environment,
      playerSnapshot
    );

  const player =
    parseCombatPlayer(
      session,
      metadata,
      playerSnapshot
    );

  player.maxHp =
    Math.max(
      1,
      player.maxHp
    );

  if (
    metadata.resolved === true ||
    session.status !== "active"
  ) {
    return {
      ok: false,
      active: false,
      reason:
        `Combat has already ended (${metadata.result || session.status}).`,
    };
  }

  const actionResult = {
    ok: false,
    damage: 0,
    messages: [],
  };

  /*
   * ----------------------------------------------------------
   * PLAYER TURN START
   * ----------------------------------------------------------
   */
  const start =
    await processPlayerStartTurn({
      threadID,
      combatID:
        session.id,
      session,
      player,
      metadata,
    });

  if (
    start.messages.length
  ) {
    actionResult.messages.push(
      ...start.messages
    );
  }

  if (
    getSessionHP(session) <=
    0
  ) {
    const defeat =
      await resolveDefeat({
        threadID,
        userID,
        session,
        player,
        metadata,
      });

    if (
      defeat.revived
    ) {
      actionResult.messages.push(
        `Your Wraith revival restores you to ${formatNumber(
          session.player_hp
        )} HP.`
      );
    } else {
      return {
        ok: true,
        active: false,
        defeat: true,
        messages:
          actionResult.messages.concat(
            "You collapse from your wounds."
          ),
      };
    }
  }

  /*
   * Stunned player loses action.
   */
  if (
    start.stunned
  ) {
    actionResult.ok =
      true;

    actionResult.damage =
      0;

    actionResult.messages.push(
      "Your turn is lost."
    );
  } else {
    /*
     * --------------------------------------------------------
     * PLAYER ACTION
     * --------------------------------------------------------
     */
    switch (rawAction) {
      case "attack":
      case "hit":
      case "strike":
        Object.assign(
          actionResult,
          await executeAttack({
            threadID,
            combatID:
              session.id,
            userID,
            session,
            player,
          })
        );
        break;

      case "skill":
        Object.assign(
          actionResult,
          await executeSkill({
            threadID,
            combatID:
              session.id,
            userID,
            session,
            player,
            metadata,
            skillID:
              rawArgument,
          })
        );
        break;

      case "spell":
      case "cast":
        Object.assign(
          actionResult,
          await executeSpell({
            threadID,
            combatID:
              session.id,
            userID,
            session,
            player,
            metadata,
            spellID:
              rawArgument,
          })
        );
        break;

      case "special":
      case "specials": {
        const parsed =
          splitSpecialInput(
            rawArgument
          );

        Object.assign(
          actionResult,
          await executeSpecial({
            threadID,
            combatID:
              session.id,
            userID,
            session,
            player,
            metadata,
            specialID:
              parsed.specialID,
            argument:
              parsed.argument,
          })
        );

        break;
      }

      case "item":
      case "use":
        Object.assign(
          actionResult,
          await executeItem({
            threadID,
            userID,
            session,
            player,
            itemID:
              rawArgument,
          })
        );
        break;

      case "defend":
      case "guard":
        Object.assign(
          actionResult,
          await executeDefend({
            session,
            player,
            metadata,
          })
        );
        break;

      case "escape":
      case "flee":
        Object.assign(
          actionResult,
          await executeEscape()
        );
        break;

      default:
        return {
          ok: false,
          active: true,
          reason:
            "Unknown combat action. Use attack, skill, spell, special, item, defend, or escape.",
        };
    }
  }

  if (
    !actionResult.ok
  ) {
    return {
      ok: false,
      active: true,
      reason:
        actionResult.reason ||
        "That action failed.",
    };
  }

  for (
    const message of
      actionResult.messages ||
      []
  ) {
    pushLog(
      metadata,
      message
    );
  }

  /*
   * ----------------------------------------------------------
   * ESCAPE
   * ----------------------------------------------------------
   */
  if (
    actionResult.escaped
  ) {
    metadata.resolved =
      true;

    metadata.result =
      "escaped";

    await saveCombat(
      session.id,
      {
        status:
          "escaped",

        metadata:
          serializeMetadata(
            metadata
          ),
      }
    );

    await cleanupEffects(
      threadID,
      session.id,
      userID
    );

    await syncPlayerVitals(
      threadID,
      userID,
      session
    );

    return {
      ok: true,
      active: false,
      escaped: true,
      messages:
        actionResult.messages,
    };
  }

  /*
   * ----------------------------------------------------------
   * PLAYER KILLED ENEMY
   * ----------------------------------------------------------
   */
  if (
    getEnemyHP(session) <=
    0
  ) {
    const victory =
      await resolveVictory({
        threadID,
        userID,
        session,
        metadata,
      });

    await syncPlayerVitals(
      threadID,
      userID,
      session
    );

    return {
      ok: true,
      active: false,
      victory: true,

      reward:
        victory.reward,

      xp:
        victory.xp,

      loot:
        victory.loot,

      elite:
        victory.elite,

      messages:
        actionResult.messages.concat(
          `Victory! You receive ${formatNumber(
            victory.reward
          )} coins and ${formatNumber(
            victory.xp
          )} XP.`
        ),
    };
  }

  /*
   * ----------------------------------------------------------
   * ENEMY TURN
   * ----------------------------------------------------------
   */
  const enemyTurnResult =
    await enemyTurn({
      threadID,
      combatID:
        session.id,
      session,
      player,
      metadata,
    });

  actionResult.messages.push(
    ...enemyTurnResult.messages
  );

  for (
    const message of
      enemyTurnResult.messages
  ) {
    pushLog(
      metadata,
      message
    );
  }

  /*
   * Enemy can die from a DoT at the beginning
   * of its turn. Resolve that victory immediately.
   */
  if (
    getEnemyHP(session) <=
    0
  ) {
    const victory =
      await resolveVictory({
        threadID,
        userID,
        session,
        metadata,
      });

    await syncPlayerVitals(
      threadID,
      userID,
      session
    );

    return {
      ok: true,
      active: false,
      victory: true,

      reward:
        victory.reward,

      xp:
        victory.xp,

      loot:
        victory.loot,

      elite:
        victory.elite,

      messages:
        actionResult.messages.concat(
          `Victory! You receive ${formatNumber(
            victory.reward
          )} coins and ${formatNumber(
            victory.xp
          )} XP.`
        ),
    };
  }

  /*
   * ----------------------------------------------------------
   * PLAYER DEFEAT
   * ----------------------------------------------------------
   */
  if (
    getSessionHP(session) <=
    0
  ) {
    const defeat =
      await resolveDefeat({
        threadID,
        userID,
        session,
        player,
        metadata,
      });

    if (
      defeat.revived
    ) {
      actionResult.messages.push(
        `Your Wraith revival activates! You return with ${formatNumber(
          session.player_hp
        )} HP.`
      );

      pushLog(
        metadata,
        "Wraith revival activates."
      );
    } else {
      await syncPlayerVitals(
        threadID,
        userID,
        session
      );

      return {
        ok: true,
        active: false,
        defeat: true,
        messages:
          actionResult.messages.concat(
            "Defeat. You have fallen."
          ),
      };
    }
  }

  /*
   * ----------------------------------------------------------
   * END-OF-TURN EFFECT EXPIRATION
   * ----------------------------------------------------------
   */
  const playerEnd =
    await effects.processEndOfTurn(
      threadID,
      session.id,
      playerTargetID(
        userID
      )
    );

  const enemyEnd =
    await effects.processEndOfTurn(
      threadID,
      session.id,
      enemyTargetID()
    );

  if (
    playerEnd.expired?.length
  ) {
    for (
      const effect of
        playerEnd.expired
    ) {
      pushLog(
        metadata,
        `${effects.describeEffect(
          effect
        )} expires.`
      );
    }
  }

  if (
    enemyEnd.expired?.length
  ) {
    for (
      const effect of
        enemyEnd.expired
    ) {
      pushLog(
        metadata,
        `${effects.describeEffect(
          effect
        )} expires from the enemy.`
      );
    }
  }

  /*
   * Guard lasts for one round.
   */
  metadata.defending =
    false;

  /*
   * Cooldowns tick once per completed round.
   */
  decrementCooldowns(
    metadata
  );

  const currentTurn =
    Math.max(
      1,
      safeNumber(
        session.turn_number,
        1
      )
    );

  session.turn_number =
    currentTurn + 1;

  /*
   * Save complete combat state.
   */
  await saveCombat(
    session.id,
    {
      player_hp:
        session.player_hp,

      player_mp:
        session.player_mp,

      player_stamina:
        session.player_stamina,

      enemy_hp:
        session.enemy_hp,

      turn_number:
        session.turn_number,

      metadata:
        serializeMetadata(
          metadata
        ),

      status:
        "active",
    }
  );

  await syncPlayerVitals(
    threadID,
    userID,
    session
  );

  return {
    ok: true,
    active: true,

    damage:
      safeNumber(
        actionResult.damage
      ),

    playerHP:
      session.player_hp,

    playerMP:
      session.player_mp,

    playerStamina:
      session.player_stamina,

    enemyHP:
      session.enemy_hp,

    messages:
      actionResult.messages,
  };
}

// ============================================================
// EXPIRED COMBATS
// ============================================================

async function clearExpiredCombats() {
  const cutoff =
    now() -
    COMBAT_TIMEOUT_MS;

  const result =
    await db.query(
      `
        UPDATE rpg_combat_sessions
        SET
          status = 'timeout',
          updated_at = $1
        WHERE status = 'active'
          AND created_at < $2
        RETURNING
          id,
          thread_id,
          user_id
      `,
      [
        now(),
        cutoff,
      ]
    );

  for (
    const row of result.rows
  ) {
    await cleanupEffects(
      row.thread_id,
      row.id,
      row.user_id
    );
  }

  return result.rows.length;
}

// ============================================================
// RENDER
// ============================================================

function renderBar(
  current,
  maximum,
  size = 12
) {
  const max =
    Math.max(
      1,
      safeNumber(
        maximum,
        1
      )
    );

  const value =
    clamp(
      safeNumber(
        current
      ),
      0,
      max
    );

  const filled =
    Math.round(
      (value / max) *
        size
    );

  return (
    "█".repeat(
      filled
    ) +
    "░".repeat(
      Math.max(
        0,
        size - filled
      )
    )
  );
}

function renderCombat(
  session,
  _player = null,
  notice = null
) {
  if (!session) {
    return "No active combat.";
  }

  const metadata =
    parseMetadata(
      session.metadata
    );

  const enemy =
    getEnemy(
      session.enemy_id
    );

  const enemyMax =
    enemy?.maxHp ||
    safeNumber(
      session.enemy_max_hp,
      metadata.enemy?.maxHp,
      1
    );

  const playerMaxHp =
    safeNumber(
      metadata.player?.maxHp,
      session.player_hp
    );

  const playerMaxMp =
    safeNumber(
      metadata.player?.maxMp,
      session.player_mp
    );

  const playerMaxStamina =
    safeNumber(
      metadata.player?.maxStamina,
      session.player_stamina
    );

  const lines = [];

  lines.push(
    "╔══════════════════════════════╗",
    "          ⚔️ COMBAT",
    "╚══════════════════════════════╝",
    ""
  );

  if (notice) {
    lines.push(
      String(notice),
      ""
    );
  }

  lines.push(
    `${enemy?.emoji || "👹"} ${
      enemy?.name ||
      session.enemy_name ||
      session.enemy_id
    }`
  );

  lines.push(
    `HP [${renderBar(
      session.enemy_hp,
      enemyMax
    )}] ${formatNumber(
      session.enemy_hp
    )}/${formatNumber(
      enemyMax
    )}`
  );

  lines.push("");

  lines.push(
    `❤️ HP [${renderBar(
      session.player_hp,
      playerMaxHp
    )}] ${formatNumber(
      session.player_hp
    )}/${formatNumber(
      playerMaxHp
    )}`
  );

  lines.push(
    `💧 MP [${renderBar(
      session.player_mp,
      playerMaxMp
    )}] ${formatNumber(
      session.player_mp
    )}/${formatNumber(
      playerMaxMp
    )}`
  );

  lines.push(
    `⚡ STA [${renderBar(
      session.player_stamina,
      playerMaxStamina
    )}] ${formatNumber(
      session.player_stamina
    )}/${formatNumber(
      playerMaxStamina
    )}`
  );

  lines.push("");

  lines.push(
    `Class: ${
      metadata.player
        ?.characterClass ||
      "knight"
    }`
  );

  lines.push(
    `Turn: ${
      safeNumber(
        session.turn_number,
        1
      )
    }`
  );

  if (
    metadata.defending
  ) {
    lines.push(
      "🛡️ Guarding"
    );
  }

  if (
    metadata.environment
  ) {
    lines.push(
      `🌍 ${
        metadata.environment
          .regionId ||
        "unknown"
      } • ${
        metadata.environment
          .season ||
        "spring"
      } • ${
        metadata.environment
          .weather ||
        "clear"
      }`
    );
  }

  if (
    Array.isArray(
      metadata.log
    ) &&
    metadata.log.length
  ) {
    lines.push(
      "",
      "━━ COMBAT LOG ━━"
    );

    for (
      const entry of
        metadata.log.slice(
          -8
        )
    ) {
      lines.push(
        `• ${entry}`
      );
    }
  }

  lines.push(
    "",
    "Commands:",
    "attack • skill <id> • spell <id>",
    "special <id> • item <id>",
    "defend • escape"
  );

  return lines.join(
    "\n"
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  COMBAT_TIMEOUT_MS,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  DEFEND_DAMAGE_MULTIPLIER,
  DEFEND_MP_RESTORE,
  DEFEND_STAMINA_RESTORE,
  ESCAPE_CHANCE,
  MAX_LOG_ENTRIES,
  INSTANT_DEATH_THRESHOLD,

  ENEMIES,
  ELITE_ENEMIES,
  ALL_ENEMIES,

  now,
  randomInt,
  chance,
  clamp,
  safeNumber,
  normalizeID,
  normalizeAction,
  normalizeTarget,
  formatNumber,

  pushLog,

  safeJsonParse,
  parseMetadata,
  serializeMetadata,

  normalizeEnvironment,

  getEnemy,
  getEnemyPool,
  chooseEnemy,

  getActiveCombatRow,
  getCombat,
  saveCombat,

  buildPlayerSnapshot,
  parseCombatPlayer,

  playerTargetID,
  enemyTargetID,

  getSessionHP,
  getSessionMP,
  getSessionStamina,
  getEnemyHP,
  setPlayerResources,
  setEnemyHP,

  syncPlayerVitals,

  getCooldowns,
  getCooldown,
  setCooldown,
  decrementCooldowns,

  getCombatAffinityMultiplier,

  calculateBaseDamage,
  getEffectiveEnemyDefense,

  applyDamageToPlayer,
  applyDamageToEnemy,
  healPlayer,

  processPlayerStartTurn,
  processEnemyStartTurn,
  applyDamageToEnemyDirect,

  enemyTurn,
  executeAttack,
  executeSkill,
  executeSpell,
  executeSpecial,
  executeItem,
  executeDefend,
  executeEscape,
  tryWraithRevival,

  createHunt,
  combatAction,
  renderCombat,
  clearExpiredCombats,
};
