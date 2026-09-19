"use strict";

const db = require("../db");
const { getUserState, updateVitals } = require("./player");
const { getClass, getSkill } = require("./classes");
const { getItem } = require("./items");
const affinities = require("./affinities");
const spells = require("./spells");
const specials = require("./specials");
const effects = require("./effects");

// ============================================================
// CONFIG
// ============================================================

const COMBAT_TIMEOUT_MS = 30 * 60 * 1000;

const CRIT_CHANCE = 0.08;
const CRIT_MULTIPLIER = 1.75;

const DEFEND_DAMAGE_MULTIPLIER = 0.55;
const DEFEND_MP_REGEN = 5;
const DEFEND_STAMINA_REGEN = 8;

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
    emoji: "🌑",
    hp: 180,
    attack: 18,
    defense: 8,
    agility: 14,
    intelligence: 10,
    luck: 8,
    affinity: "shadow",
    reward: 160,
    xp: 120,
    loot: ["moonleaf"],
  },

  ironfang_wolf: {
    id: "ironfang_wolf",
    name: "Ironfang Wolf",
    emoji: "🐺",
    hp: 135,
    attack: 22,
    defense: 5,
    agility: 20,
    intelligence: 4,
    luck: 10,
    affinity: "nature",
    reward: 120,
    xp: 95,
    loot: ["iron"],
  },

  hollow_knight: {
    id: "hollow_knight",
    name: "Hollow Knight",
    emoji: "🛡️",
    hp: 260,
    attack: 28,
    defense: 18,
    agility: 7,
    intelligence: 8,
    luck: 6,
    affinity: "shadow",
    reward: 260,
    xp: 220,
    loot: ["void_crystal"],
  },

  ash_drake: {
    id: "ash_drake",
    name: "Ash Drake",
    emoji: "🐉",
    hp: 420,
    attack: 42,
    defense: 25,
    agility: 11,
    intelligence: 18,
    luck: 10,
    affinity: "fire",
    reward: 550,
    xp: 480,
    loot: ["ember_core"],
  },
};

const ELITE_ENEMIES = {
  elite_shadow_beast: {
    ...ENEMIES.shadow_beast,
    id: "elite_shadow_beast",
    name: "Elite Shadow Beast",
    hp: 320,
    attack: 30,
    defense: 14,
    agility: 18,
    reward: 340,
    xp: 260,
  },

  alpha_ironfang_wolf: {
    ...ENEMIES.ironfang_wolf,
    id: "alpha_ironfang_wolf",
    name: "Alpha Ironfang Wolf",
    hp: 240,
    attack: 36,
    defense: 10,
    agility: 24,
    reward: 260,
    xp: 210,
  },

  corrupted_hollow_knight: {
    ...ENEMIES.hollow_knight,
    id: "corrupted_hollow_knight",
    name: "Corrupted Hollow Knight",
    hp: 460,
    attack: 44,
    defense: 30,
    agility: 9,
    reward: 560,
    xp: 470,
  },

  elder_ash_drake: {
    ...ENEMIES.ash_drake,
    id: "elder_ash_drake",
    name: "Elder Ash Drake",
    hp: 720,
    attack: 62,
    defense: 38,
    agility: 14,
    reward: 1100,
    xp: 950,
  },
};

const ALL_ENEMIES = {
  ...ENEMIES,
  ...ELITE_ENEMIES,
};

// ============================================================
// INTERNAL HELPERS
// ============================================================

function now() {
  return Date.now();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(value) {
  return Math.random() < value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAction(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeTarget(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function pushLog(log, text) {
  if (!text) return;

  log.push(String(text));

  while (log.length > MAX_LOG_ENTRIES) {
    log.shift();
  }
}

function parseMetadata(session) {
  if (!session || !session.metadata) return {};

  if (typeof session.metadata === "object") {
    return { ...session.metadata };
  }

  try {
    return JSON.parse(session.metadata);
  } catch {
    return {};
  }
}

function serializeMetadata(session, metadata) {
  return {
    ...metadata,
    log: Array.isArray(metadata.log) ? metadata.log.slice(-MAX_LOG_ENTRIES) : [],
  };
}

function getCombatPlayerId(session) {
  return String(session.user_id);
}

function isActive(session) {
  return !!session && session.status === "active";
}

function isTimedOut(session) {
  return now() - safeNumber(session.updated_at, now()) > COMBAT_TIMEOUT_MS;
}

function getEnemyFromSession(session) {
  const metadata = parseMetadata(session);

  if (metadata.enemy) {
    return {
      ...metadata.enemy,
      hp: safeNumber(session.enemy_hp, metadata.enemy.hp),
      maxHp: safeNumber(session.enemy_max_hp, metadata.enemy.maxHp),
    };
  }

  return {
    id: session.enemy_id,
    name: session.enemy_name,
    emoji: "👹",
    hp: safeNumber(session.enemy_hp),
    maxHp: safeNumber(session.enemy_max_hp),
    attack: safeNumber(session.enemy_attack),
    defense: safeNumber(session.enemy_defense),
    agility: 10,
    intelligence: 5,
    luck: 5,
    affinity: null,
    reward: 0,
    xp: 0,
    loot: [],
  };
}

function getCombatState(session) {
  const metadata = parseMetadata(session);

  return {
    ...metadata,
    cooldowns:
      metadata.cooldowns && typeof metadata.cooldowns === "object"
        ? metadata.cooldowns
        : {},
    log: Array.isArray(metadata.log) ? metadata.log : [],
    player: {
      maxHp: safeNumber(metadata.player?.maxHp),
      maxMp: safeNumber(metadata.player?.maxMp),
      maxStamina: safeNumber(metadata.player?.maxStamina),
      strength: safeNumber(metadata.player?.strength),
      defense: safeNumber(metadata.player?.defense),
      agility: safeNumber(metadata.player?.agility),
      intelligence: safeNumber(metadata.player?.intelligence),
      vitality: safeNumber(metadata.player?.vitality),
      luck: safeNumber(metadata.player?.luck),
      characterClass: metadata.player?.characterClass || "knight",
    },
    defending: !!session.defending,
  };
}

async function saveCombat(session, changes = {}, metadata = null) {
  const currentMetadata =
    metadata || {
      ...parseMetadata(session),
    };

  const values = {
    enemy_hp:
      changes.enemy_hp !== undefined
        ? Math.max(0, Math.round(changes.enemy_hp))
        : Math.max(0, Math.round(safeNumber(session.enemy_hp))),

    player_hp:
      changes.player_hp !== undefined
        ? Math.max(0, Math.round(changes.player_hp))
        : Math.max(0, Math.round(safeNumber(session.player_hp))),

    player_mp:
      changes.player_mp !== undefined
        ? Math.max(0, Math.round(changes.player_mp))
        : Math.max(0, Math.round(safeNumber(session.player_mp))),

    player_stamina:
      changes.player_stamina !== undefined
        ? Math.max(0, Math.round(changes.player_stamina))
        : Math.max(0, Math.round(safeNumber(session.player_stamina))),

    turn_number:
      changes.turn_number !== undefined
        ? Math.max(1, Math.round(changes.turn_number))
        : Math.max(1, Math.round(safeNumber(session.turn_number, 1))),

    round_number:
      changes.round_number !== undefined
        ? Math.max(1, Math.round(changes.round_number))
        : Math.max(1, Math.round(safeNumber(session.round_number, 1))),

    defending:
      changes.defending !== undefined
        ? !!changes.defending
        : !!session.defending,

    status:
      changes.status !== undefined
        ? changes.status
        : session.status,

    updated_at: now(),
  };

  const serialized = serializeMetadata(
    session,
    currentMetadata
  );

  const result = await db.query(
    `
      UPDATE rpg_combat_sessions
      SET
        enemy_hp = $1,
        player_hp = $2,
        player_mp = $3,
        player_stamina = $4,
        turn_number = $5,
        round_number = $6,
        defending = $7,
        status = $8,
        metadata = $9::jsonb,
        updated_at = $10
      WHERE id = $11
      RETURNING *
    `,
    [
      values.enemy_hp,
      values.player_hp,
      values.player_mp,
      values.player_stamina,
      values.turn_number,
      values.round_number,
      values.defending,
      values.status,
      JSON.stringify(serialized),
      values.updated_at,
      session.id,
    ]
  );

  return result.rows[0] || null;
}

async function syncPlayerVitals(threadID, userID, session) {
  try {
    await updateVitals(threadID, userID, {
      hp: Math.max(0, Math.round(session.player_hp)),
      mp: Math.max(0, Math.round(session.player_mp)),
      stamina: Math.max(0, Math.round(session.player_stamina)),
    });
  } catch (error) {
    console.warn(
      `[RPG COMBAT] Failed syncing player vitals ${threadID}/${userID}:`,
      error.message
    );
  }
}

function calculateBaseDamage({
  attack,
  strength,
  intelligence,
  skillMultiplier = 1,
  targetDefense,
  magical = false,
}) {
  const offensiveStat = magical
    ? intelligence
    : attack + strength * 0.55;

  const raw =
    offensiveStat *
    skillMultiplier;

  const mitigation =
    Math.max(
      1,
      100 / (100 + Math.max(0, targetDefense))
    );

  return Math.max(
    1,
    Math.round(raw * mitigation)
  );
}

function calculateCrit(luck = 0, agility = 0) {
  const bonus =
    Math.max(0, luck) * 0.0025 +
    Math.max(0, agility) * 0.001;

  return chance(clamp(CRIT_CHANCE + bonus, 0, 0.35));
}

function getEnvironmentContext(session) {
  return {
    environment:
      session.environment ||
      parseMetadata(session).environment ||
      "greenvale",

    weather:
      session.weather ||
      parseMetadata(session).weather ||
      "clear",

    season:
      session.season ||
      parseMetadata(session).season ||
      "spring",
  };
}

function getCooldownRemaining(metadata, key) {
  const value = safeNumber(metadata.cooldowns?.[key], 0);

  return Math.max(0, value - now());
}

function setCooldown(metadata, key, duration) {
  if (!metadata.cooldowns) {
    metadata.cooldowns = {};
  }

  metadata.cooldowns[key] = now() + Math.max(0, duration);
}

function getSkillCooldownKey(skillID) {
  return `skill:${skillID}`;
}

function getSpellCooldownKey(spellID) {
  return `spell:${spellID}`;
}

function getSpecialCooldownKey(specialID) {
  return `special:${specialID}`;
}

async function getEffectsFor(session, targetID) {
  try {
    return await effects.getEffects(
      session.thread_id,
      session.id,
      targetID
    );
  } catch {
    return [];
  }
}

function hasEffectSyncSafe(effectList, effectID) {
  return effectList.some(
    (effect) =>
      String(effect.effect_id || effect.id) === String(effectID)
  );
}

function getEffectMagnitude(effectList, effectID) {
  const found = effectList.find(
    (effect) =>
      String(effect.effect_id || effect.id) === String(effectID)
  );

  return found ? safeNumber(found.magnitude) : 0;
}

// ============================================================
// PLAYER SNAPSHOT
// ============================================================

async function buildPlayerSnapshot(threadID, userID) {
  const state = await getUserState(threadID, userID);

  if (!state || !state.player) {
    throw new Error("RPG player could not be loaded.");
  }

  const player = state.player;
  const classDef = getClass(player.character_class);

  return {
    maxHp: safeNumber(player.max_hp, classDef.base.maxHp),
    maxMp: safeNumber(player.max_mp, classDef.base.maxMp),
    maxStamina: safeNumber(
      player.max_stamina,
      classDef.base.maxStamina
    ),

    strength: safeNumber(
      player.strength,
      classDef.base.strength
    ),

    defense: safeNumber(
      player.defense,
      classDef.base.defense
    ),

    agility: safeNumber(
      player.agility,
      classDef.base.agility
    ),

    intelligence: safeNumber(
      player.intelligence,
      classDef.base.intelligence
    ),

    vitality: safeNumber(
      player.vitality,
      classDef.base.vitality
    ),

    luck: safeNumber(
      player.luck,
      classDef.base.luck
    ),

    characterClass:
      player.character_class || "knight",

    regionID: player.region_id,
    locationID: player.location_id,
  };
}

// ============================================================
// CREATE HUNT
// ============================================================

async function createHunt(threadID, userID, options = {}) {
  const existing = await getCombat(threadID, userID);

  if (existing && existing.status === "active") {
    return {
      ok: false,
      message: "⚔️ You are already in combat.",
      session: existing,
    };
  }

  const player = await buildPlayerSnapshot(
    threadID,
    userID
  );

  const elite = !!options.elite;

  const pool = elite
    ? Object.values(ELITE_ENEMIES)
    : Object.values(ENEMIES);

  const enemy = pool[
    randomInt(0, pool.length - 1)
  ];

  const state = await getUserState(threadID, userID);

  const environment =
    player.regionID ||
    "greenvale";

  const weather = "clear";
  const season = "spring";

  const metadata = {
    player,
    enemy: {
      ...enemy,
      maxHp: enemy.hp,
    },
    cooldowns: {},
    environment,
    weather,
    season,
    elite,
    log: [],
    createdAt: now(),
  };

  const result = await db.query(
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
        round_number,
        environment,
        weather,
        season,
        enemy_count,
        metadata,
        status,
        defending,
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,1,1,$12,$13,$14,1,
        $15::jsonb,'active',FALSE,$16,$16
      )
      RETURNING *
    `,
    [
      threadID,
      userID,
      enemy.id,
      enemy.name,
      enemy.hp,
      enemy.hp,
      enemy.attack,
      enemy.defense,
      clamp(
        safeNumber(player.maxHp),
        1,
        safeNumber(player.maxHp)
      ),
      clamp(
        safeNumber(state.player.mp),
        0,
        safeNumber(player.maxMp)
      ),
      clamp(
        safeNumber(state.player.stamina),
        0,
        safeNumber(player.maxStamina)
      ),
      environment,
      weather,
      season,
      JSON.stringify(metadata),
      now(),
    ]
  );

  const session = result.rows[0];

  pushLog(
    metadata.log,
    `${enemy.emoji || "👹"} ${enemy.name} appears!`
  );

  const saved = await saveCombat(
    session,
    {},
    metadata
  );

  return {
    ok: true,
    result: "active",
    session: saved || session,
    message: `⚔️ You encountered ${enemy.emoji || "👹"} **${enemy.name}**!`,
  };
}

// ============================================================
// GET ACTIVE COMBAT
// ============================================================

async function getCombat(threadID, userID) {
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
    [threadID, userID]
  );

  const session = result.rows[0];

  if (!session) {
    return null;
  }

  if (isTimedOut(session)) {
    await db.query(
      `
        UPDATE rpg_combat_sessions
        SET status = 'timeout',
            updated_at = $1
        WHERE id = $2
      `,
      [now(), session.id]
    );

    return null;
  }

  return session;
}

// ============================================================
// START OF TURN
// ============================================================

async function processStartTurn(session) {
  const metadata = parseMetadata(session);
  const playerID = getCombatPlayerId(session);

  let hpChange = 0;
  let mpChange = 0;
  let message = [];

  try {
    const result = await effects.processStartOfTurn(
      session.thread_id,
      session.id,
      playerID,
      {
        targetType: "player",
        turn: session.turn_number,
        environment: session.environment,
        weather: session.weather,
        season: session.season,
      }
    );

    hpChange += safeNumber(result?.hpChange);
    mpChange += safeNumber(result?.mpChange);

    if (Array.isArray(result?.messages)) {
      message.push(...result.messages);
    }

    if (result?.message) {
      message.push(result.message);
    }
  } catch (error) {
    console.warn(
      `[RPG COMBAT] start effects failed:`,
      error.message
    );
  }

  return {
    hpChange,
    mpChange,
    message,
    metadata,
  };
}

// ============================================================
// END OF TURN
// ============================================================

async function processEndTurn(session) {
  try {
    await effects.processEndOfTurn(
      session.thread_id,
      session.id,
      String(session.user_id)
    );
  } catch (error) {
    console.warn(
      `[RPG COMBAT] end effects failed:`,
      error.message
    );
  }
}

// ============================================================
// PLAYER DAMAGE
// ============================================================

async function applyDamageToPlayer(
  session,
  damage,
  context = {}
) {
  let finalDamage = Math.max(0, Math.round(damage));

  try {
    finalDamage = await effects.calculateIncomingDamage(
      session.thread_id,
      session.id,
      String(session.user_id),
      finalDamage,
      {
        source: context.source || "enemy",
        sourceType: "enemy",
        affinity: context.affinity || null,
        isEnemy: true,
      }
    );
  } catch (error) {
    console.warn(
      `[RPG COMBAT] incoming damage calculation failed:`,
      error.message
    );
  }

  return Math.max(0, Math.round(finalDamage));
}

// ============================================================
// ENEMY DAMAGE
// ============================================================

async function applyDamageToEnemy(
  session,
  damage,
  context = {}
) {
  let finalDamage = Math.max(0, Math.round(damage));

  try {
    finalDamage = await effects.calculateIncomingDamage(
      session.thread_id,
      session.id,
      "enemy",
      finalDamage,
      {
        source: String(session.user_id),
        sourceType: "player",
        affinity: context.affinity || null,
        isEnemy: false,
      }
    );
  } catch (error) {
    console.warn(
      `[RPG COMBAT] enemy damage calculation failed:`,
      error.message
    );
  }

  try {
    finalDamage = await effects.calculateOutgoingDamage(
      session.thread_id,
      session.id,
      String(session.user_id),
      "enemy",
      finalDamage,
      {
        affinity: context.affinity || null,
        magical: !!context.magical,
      }
    );
  } catch (error) {
    console.warn(
      `[RPG COMBAT] outgoing damage calculation failed:`,
      error.message
    );
  }

  return Math.max(0, Math.round(finalDamage));
}

// ============================================================
// ENEMY TURN
// ============================================================

async function enemyTurn(session, player) {
  if (session.enemy_hp <= 0) {
    return {
      damage: 0,
      message: [],
    };
  }

  const enemy = getEnemyFromSession(session);
  const messages = [];

  const darkness = await effects.hasEffect(
    session.thread_id,
    session.id,
    String(session.user_id),
    "infinite_darkness"
  );

  let multiplier = 1;

  if (darkness) {
    multiplier *= 0.8;
  }

  let damage =
    enemy.attack *
    (0.85 + Math.random() * 0.3);

  damage *= multiplier;

  damage = Math.max(
    1,
    Math.round(
      damage *
      (100 /
        (100 +
          Math.max(0, player.defense)))
    )
  );

  if (session.defending) {
    damage = Math.round(
      damage * DEFEND_DAMAGE_MULTIPLIER
    );

    messages.push(
      `🛡️ Your guard reduced the incoming damage.`
    );
  }

  damage = await applyDamageToPlayer(
    session,
    damage,
    {
      source: enemy.id,
      affinity: enemy.affinity,
    }
  );

  messages.push(
    `${enemy.emoji || "👹"} **${enemy.name}** dealt **${damage} damage**.`
  );

  return {
    damage,
    message: messages,
  };
}

// ============================================================
// BASIC ATTACK
// ============================================================

async function executeAttack(session, player) {
  const enemy = getEnemyFromSession(session);

  let damage = calculateBaseDamage({
    attack: player.strength,
    strength: player.strength,
    intelligence: player.intelligence,
    skillMultiplier: 1,
    targetDefense: enemy.defense,
    magical: false,
  });

  let critical = calculateCrit(
    player.luck,
    player.agility
  );

  if (critical) {
    damage = Math.round(
      damage * CRIT_MULTIPLIER
    );
  }

  damage = await applyDamageToEnemy(
    session,
    damage,
    {
      magical: false,
      affinity: null,
    }
  );

  return {
    damage,
    critical,
    message: critical
      ? `⚔️ Critical hit! You dealt **${damage} damage**.`
      : `⚔️ You dealt **${damage} damage**.`,
  };
}

// ============================================================
// SKILL
// ============================================================

async function executeSkill(
  session,
  player,
  skillID
) {
  const skill = getSkill(skillID);

  if (!skill) {
    return {
      ok: false,
      message: "❌ Unknown skill.",
    };
  }

  const metadata = parseMetadata(session);
  const cooldownKey =
    getSkillCooldownKey(skillID);

  const remaining =
    getCooldownRemaining(
      metadata,
      cooldownKey
    );

  if (remaining > 0) {
    return {
      ok: false,
      message: `⏳ **${skill.name}** is on cooldown for ${Math.ceil(
        remaining / 1000
      )}s.`,
    };
  }

  if (session.player_mp < skill.cost) {
    return {
      ok: false,
      message: `🔷 You need **${skill.cost} MP**.`,
    };
  }

  if (session.player_stamina < skill.stamina) {
    return {
      ok: false,
      message: `💨 You need **${skill.stamina} stamina**.`,
    };
  }

  const enemy = getEnemyFromSession(session);

  let damage = 0;
  let healing = 0;
  let critical = false;
  const messages = [];

  if (
    skill.effect === "guard" ||
    skill.effect === "dodge" ||
    skill.effect === "guard_heal"
  ) {
    if (skill.effect === "dodge") {
      metadata.skillDefense = {
        dodge: true,
        turns: 1,
      };

      messages.push(
        `💨 **${skill.name}** activated. Your next incoming attack may miss.`
      );
    }

    if (
      skill.effect === "guard" ||
      skill.effect === "guard_heal"
    ) {
      session.defending = true;

      if (skill.effect === "guard_heal") {
        healing = Math.max(
          1,
          Math.round(player.maxHp * 0.15)
        );

        session.player_hp = clamp(
          session.player_hp + healing,
          0,
          player.maxHp
        );

        messages.push(
          `🛡️ **${skill.name}** restored **${healing} HP**.`
        );
      } else {
        messages.push(
          `🛡️ **${skill.name}** fortified your defenses.`
        );
      }
    }
  } else {
    const magical =
      skill.effect === "magic";

    damage = calculateBaseDamage({
      attack: player.strength,
      strength: player.strength,
      intelligence: player.intelligence,
      skillMultiplier: skill.multiplier,
      targetDefense: enemy.defense,
      magical,
    });

    if (
      skill.effect === "critical" ||
      calculateCrit(
        player.luck,
        player.agility
      )
    ) {
      critical = true;
      damage = Math.round(
        damage * CRIT_MULTIPLIER
      );
    }

    if (skill.effect === "execute") {
      const enemyPercent =
        enemy.maxHp > 0
          ? enemy.hp / enemy.maxHp
          : 1;

      if (enemyPercent <= INSTANT_DEATH_THRESHOLD) {
        damage = enemy.hp;
        messages.push(
          `💀 **Execution** finished the weakened enemy.`
        );
      }
    }

    damage = await applyDamageToEnemy(
      session,
      damage,
      {
        magical,
        affinity:
          player.characterClass === "arcanist"
            ? "arcane"
            : null,
      }
    );

    if (skill.effect === "poison") {
      await effects.applyEffect(
        session.thread_id,
        session.id,
        "enemy",
        {
          id: "poison",
          duration: 3,
          magnitude: 4,
          stacks: 1,
        }
      );

      messages.push(
        `☠️ Poison was applied.`
      );
    }

    if (skill.effect === "stun") {
      await effects.applyEffect(
        session.thread_id,
        session.id,
        "enemy",
        {
          id: "stun",
          duration: 1,
          magnitude: 1,
          stacks: 1,
        }
      );

      messages.push(
        `🪤 The enemy was stunned.`
      );
    }

    if (skill.effect === "heal_damage") {
      healing = Math.max(
        1,
        Math.round(damage * 0.25)
      );

      session.player_hp = clamp(
        session.player_hp + healing,
        0,
        player.maxHp
      );

      messages.push(
        `✨ You restored **${healing} HP**.`
      );
    }

    messages.unshift(
      critical
        ? `${skill.emoji} **${skill.name}** landed a critical hit for **${damage} damage**.`
        : `${skill.emoji} **${skill.name}** dealt **${damage} damage**.`
    );
  }

  session.player_mp -= skill.cost;
  session.player_stamina -= skill.stamina;

  /*
   * Skills don't currently have their own cooldown field.
   * A short lock prevents accidental spam while preserving
   * the class skill system's existing schema.
   */
  setCooldown(
    metadata,
    cooldownKey,
    1000
  );

  return {
    ok: true,
    damage,
    healing,
    critical,
    message: messages.join("\n"),
    metadata,
  };
}

// ============================================================
// SPELL
// ============================================================

async function executeSpell(
  session,
  player,
  spellID
) {
  const spell = spells.getSpell(spellID);

  if (!spell) {
    return {
      ok: false,
      message: "❌ Unknown spell.",
    };
  }

  const metadata = parseMetadata(session);
  const cooldownKey =
    getSpellCooldownKey(spellID);

  const remaining =
    getCooldownRemaining(
      metadata,
      cooldownKey
    );

  if (remaining > 0) {
    return {
      ok: false,
      message: `⏳ **${spell.name}** is on cooldown for ${Math.ceil(
        remaining / 1000
      )}s.`,
    };
  }

  let allowed = false;

  try {
    allowed = await spells.canCastSpell(
      session.thread_id,
      session.user_id,
      spellID,
      {
        inCombat: true,
        combatID: session.id,
        environment: getEnvironmentContext(session),
      }
    );
  } catch (error) {
    console.warn(
      `[RPG COMBAT] spell validation failed:`,
      error.message
    );
  }

  if (!allowed) {
    return {
      ok: false,
      message: `❌ You cannot cast **${spell.name}** right now.`,
    };
  }

  const cost =
    typeof spells.getSpellCost === "function"
      ? spells.getSpellCost(spell)
      : safeNumber(
          spell.manaCost,
          safeNumber(spell.cost?.mp)
        );

  if (session.player_mp < cost) {
    return {
      ok: false,
      message: `🔷 You need **${cost} MP**.`,
    };
  }

  let power = 1;

  try {
    power = await spells.getSpellPower(
      session.thread_id,
      session.user_id,
      spellID
    );
  } catch {
    power = safeNumber(
      spell.power,
      safeNumber(spell.damage, 1)
    );
  }

  let effectData = {};

  try {
    effectData =
      spells.getSpellEffectData(spellID) || {};
  } catch {
    effectData = {};
  }

  const enemy = getEnemyFromSession(session);

  const magicalDamage =
    safeNumber(
      spell.damage,
      1
    ) *
    safeNumber(power, 1);

  let damage = calculateBaseDamage({
    attack: player.intelligence,
    strength: player.strength,
    intelligence: player.intelligence,
    skillMultiplier: magicalDamage,
    targetDefense: enemy.defense,
    magical: true,
  });

  const affinityID =
    spell.affinity ||
    effectData.affinity ||
    null;

  if (affinityID) {
    try {
      const affinityPower =
        await affinities.getPlayerAffinityPower(
          session.thread_id,
          session.user_id,
          affinityID,
          getEnvironmentContext(session)
        );

      /*
       * getPlayerAffinityPower already includes the
       * environment/season/weather multiplier.
       */
      damage = Math.round(
        damage * safeNumber(affinityPower, 1)
      );
    } catch {
      // Keep base spell damage if affinity calculation fails.
    }
  }

  damage = await applyDamageToEnemy(
    session,
    damage,
    {
      magical: true,
      affinity: affinityID,
    }
  );

  session.player_mp -= cost;

  const messages = [
    `✨ **${spell.name}** dealt **${damage} damage**.`,
  ];

  /*
   * Common spell effect mappings.
   * The actual persistent behavior belongs to effects.js.
   */

  if (
    effectData.heal ||
    effectData.healing ||
    spell.effect === "heal"
  ) {
    const amount = Math.max(
      1,
      Math.round(
        player.maxHp *
          safeNumber(
            effectData.healPercent ||
              effectData.healingPercent,
            0.2
          )
      )
    );

    session.player_hp = clamp(
      session.player_hp + amount,
      0,
      player.maxHp
    );

    messages.push(
      `💚 You restored **${amount} HP**.`
    );
  }

  if (effectData.stun) {
    await effects.applyEffect(
      session.thread_id,
      session.id,
      "enemy",
      {
        id: "stun",
        duration: safeNumber(
          effectData.stunTurns,
          1
        ),
        magnitude: 1,
        stacks: 1,
      }
    );

    messages.push("💫 The enemy was stunned.");
  }

  if (effectData.poison) {
    await effects.applyEffect(
      session.thread_id,
      session.id,
      "enemy",
      {
        id: "poison",
        duration: safeNumber(
          effectData.poisonTurns,
          3
        ),
        magnitude: safeNumber(
          effectData.poisonDamage,
          4
        ),
        stacks: 1,
      }
    );

    messages.push("☠️ Poison was applied.");
  }

  setCooldown(
    metadata,
    cooldownKey,
    safeNumber(
      spell.cooldown,
      0
    ) * 1000
  );

  return {
    ok: true,
    damage,
    message: messages.join("\n"),
    metadata,
  };
}

// ============================================================
// SPECIAL
// ============================================================

async function executeSpecial(
  session,
  player,
  specialID
) {
  const special =
    specials.getSpecial(specialID);

  if (!special) {
    return {
      ok: false,
      message: "❌ Unknown special.",
    };
  }

  const metadata = parseMetadata(session);

  const cooldownKey =
    getSpecialCooldownKey(specialID);

  const remaining =
    getCooldownRemaining(
      metadata,
      cooldownKey
    );

  if (remaining > 0) {
    return {
      ok: false,
      message: `⏳ **${special.name}** is on cooldown for ${Math.ceil(
        remaining / 1000
      )}s.`,
    };
  }

  let usable = false;

  try {
    usable = await specials.canUseSpecial(
      session.thread_id,
      session.user_id,
      specialID,
      {
        inCombat: true,
        combatID: session.id,
        environment: getEnvironmentContext(session),
        playerHP: session.player_hp,
        playerMP: session.player_mp,
        playerStamina: session.player_stamina,
      }
    );
  } catch (error) {
    console.warn(
      `[RPG COMBAT] special validation failed:`,
      error.message
    );
  }

  if (!usable) {
    return {
      ok: false,
      message: `❌ You cannot use **${special.name}** right now.`,
    };
  }

  const cost = special.cost || {};

  const mpCost =
    safeNumber(cost.mp, 0);

  const staminaCost =
    safeNumber(cost.stamina, 0);

  const hpPercent =
    safeNumber(cost.hpPercent, 0);

  if (session.player_mp < mpCost) {
    return {
      ok: false,
      message: `🔷 You need **${mpCost} MP**.`,
    };
  }

  if (session.player_stamina < staminaCost) {
    return {
      ok: false,
      message: `💨 You need **${staminaCost} stamina**.`,
    };
  }

  if (
    hpPercent > 0 &&
    session.player_hp <=
      Math.ceil(
        player.maxHp * hpPercent
      )
  ) {
    return {
      ok: false,
      message:
        "❤️ You do not have enough HP to sacrifice for this special.",
    };
  }

  const enemy = getEnemyFromSession(session);
  const specialEffects =
    special.effects || {};

  let damage = 0;
  let healing = 0;
  const messages = [];

  /*
   * Special damage.
   */
  const multiplier =
    safeNumber(
      specialEffects.damageMultiplier,
      0
    );

  if (multiplier > 0) {
    damage = calculateBaseDamage({
      attack: player.strength,
      strength: player.strength,
      intelligence: player.intelligence,
      skillMultiplier: multiplier,
      targetDefense: enemy.defense,
      magical: true,
    });

    damage = await applyDamageToEnemy(
      session,
      damage,
      {
        magical: true,
        affinity:
          special.affinity || null,
      }
    );

    messages.push(
      `${special.emoji || "✨"} **${special.name}** dealt **${damage} damage**.`
    );
  } else {
    messages.push(
      `${special.emoji || "✨"} **${special.name}** activated.`
    );
  }

  /*
   * Heavenly Judgement / other healing specials.
   */
  const healPercent =
    safeNumber(
      specialEffects.healPercent ||
        specialEffects.healingPercent,
      0
    );

  if (healPercent > 0) {
    healing = Math.max(
      1,
      Math.round(
        player.maxHp * healPercent
      )
    );

    session.player_hp = clamp(
      session.player_hp + healing,
      0,
      player.maxHp
    );

    messages.push(
      `💚 You restored **${healing} HP**.`
    );
  }

  /*
   * Worldbloom-style resource regeneration.
   */
  if (
    specialEffects.mpRestorePercent ||
    specialEffects.restoreMpPercent
  ) {
    const percent =
      safeNumber(
        specialEffects.mpRestorePercent ||
          specialEffects.restoreMpPercent,
        0
      );

    const restored =
      Math.round(
        player.maxMp * percent
      );

    session.player_mp = clamp(
      session.player_mp + restored,
      0,
      player.maxMp
    );

    messages.push(
      `🔷 You restored **${restored} MP**.`
    );
  }

  if (
    specialEffects.staminaRestorePercent ||
    specialEffects.restoreStaminaPercent
  ) {
    const percent =
      safeNumber(
        specialEffects.staminaRestorePercent ||
          specialEffects.restoreStaminaPercent,
        0
      );

    const restored =
      Math.round(
        player.maxStamina * percent
      );

    session.player_stamina = clamp(
      session.player_stamina + restored,
      0,
      player.maxStamina
    );

    messages.push(
      `💨 You restored **${restored} stamina**.`
    );
  }

  /*
   * RESOURCE COSTS
   */
  session.player_mp -= mpCost;
  session.player_stamina -= staminaCost;

  if (hpPercent > 0) {
    const sacrifice =
      Math.max(
        1,
        Math.round(
          player.maxHp * hpPercent
        )
      );

    session.player_hp = Math.max(
      1,
      session.player_hp - sacrifice
    );

    messages.push(
      `🩸 You sacrificed **${sacrifice} HP**.`
    );
  }

  /*
   * ==========================================================
   * SPECIAL-SPECIFIC EFFECT ORCHESTRATION
   * ==========================================================
   */

  if (
    specialID ===
    "heaven_piercing_ice_wall"
  ) {
    await effects.createIceWall(
      session.thread_id,
      session.id,
      String(session.user_id),
      {
        blocks:
          safeNumber(
            specialEffects.blocks,
            3
          ),
        damageMultiplier:
          safeNumber(
            specialEffects.enemyDamageMultiplier,
            0.5
          ),
      }
    );

    messages.push(
      "🧊 **Ice Wall** will block incoming attacks."
    );
  }

  if (
    specialID ===
    "infinite_darkness"
  ) {
    await effects.createInfiniteDarkness(
      session.thread_id,
      session.id,
      String(session.user_id),
      {
        duration:
          safeNumber(
            specialEffects.duration,
            5
          ),
        enemyDamageMultiplier:
          safeNumber(
            specialEffects.enemyDamageMultiplier,
            0.8
          ),
        damageToHealing:
          safeNumber(
            specialEffects.damageToHealing,
            0.2
          ),
      }
    );

    await effects.createShadowBody(
      session.thread_id,
      session.id,
      String(session.user_id),
      {
        duration: 5,
        statMultiplier:
          safeNumber(
            specialEffects.shadowBody?.statMultiplier,
            0.5
          ),
        reflectionMultiplier:
          safeNumber(
            specialEffects.shadowBody?.reflectionMultiplier,
            1.25
          ),
      }
    );

    messages.push(
      "🌑 **Shadow Body** surrounds you."
    );
  }

  if (
    specialID ===
    "scorching_garden"
  ) {
    await effects.applyEffect(
      session.thread_id,
      session.id,
      "enemy",
      {
        id: "burn",
        duration:
          safeNumber(
            specialEffects.burn?.duration,
            3
          ),
        magnitude:
          safeNumber(
            specialEffects.burn?.damage,
            8
          ),
        stacks: 1,
      }
    );

    messages.push(
      "🔥 The enemy is burning."
    );
  }

  if (
    specialID ===
    "worldbreaker"
  ) {
    await effects.applyEffect(
      session.thread_id,
      session.id,
      "enemy",
      {
        id: "defense_down",
        duration:
          safeNumber(
            specialEffects.defenseReduction?.duration,
            4
          ),
        magnitude:
          safeNumber(
            specialEffects.defenseReduction?.percent,
            25
          ),
        stacks: 1,
      }
    );

    messages.push(
      "🌍 The enemy's defenses were shattered."
    );
  }

  if (
    specialID ===
    "heavens_thunder"
  ) {
    if (
      chance(
        safeNumber(
          specialEffects.stunChance,
          0.35
        )
      )
    ) {
      await effects.applyEffect(
        session.thread_id,
        session.id,
        "enemy",
        {
          id: "stun",
          duration: 1,
          magnitude: 1,
          stacks: 1,
        }
      );

      messages.push(
        "⚡ The enemy was stunned."
      );
    }
  }

  if (
    specialID ===
    "crimson_requiem"
  ) {
    const lifesteal =
      safeNumber(
        specialEffects.lifesteal,
        0.4
      );

    const healed =
      effects.calculateLifesteal(
        damage,
        lifesteal
      );

    session.player_hp = clamp(
      session.player_hp + healed,
      0,
      player.maxHp
    );

    messages.push(
      `🩸 Blood returned **${healed} HP** to you.`
    );
  }

  /*
   * Apply generic special multipliers/effects.
   */
  if (
    specialEffects.stun &&
    specialID !== "heavens_thunder"
  ) {
    await effects.applyEffect(
      session.thread_id,
      session.id,
      "enemy",
      {
        id: "stun",
        duration:
          safeNumber(
            specialEffects.stunTurns,
            1
          ),
        magnitude: 1,
        stacks: 1,
      }
    );
  }

  setCooldown(
    metadata,
    cooldownKey,
    safeNumber(
      special.cooldown,
      0
    ) * 1000
  );

  return {
    ok: true,
    damage,
    healing,
    message: messages.join("\n"),
    metadata,
  };
}

// ============================================================
// ITEM
// ============================================================

async function executeItem(
  session,
  player,
  itemID
) {
  const item = getItem(itemID);

  if (!item) {
    return {
      ok: false,
      message: "❌ Unknown item.",
    };
  }

  if (item.type !== "consumable") {
    return {
      ok: false,
      message: "❌ That item cannot be used in combat.",
    };
  }

  const inventory =
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
        session.thread_id,
        session.user_id,
        item.id,
      ]
    );

  const quantity =
    safeNumber(
      inventory.rows[0]?.quantity,
      0
    );

  if (quantity <= 0) {
    return {
      ok: false,
      message: `❌ You don't have **${item.name}**.`,
    };
  }

  const effect =
    item.effect || {};

  const oldHp =
    session.player_hp;

  const oldMp =
    session.player_mp;

  session.player_hp = clamp(
    session.player_hp +
      safeNumber(effect.hp, 0),
    0,
    player.maxHp
  );

  session.player_mp = clamp(
    session.player_mp +
      safeNumber(effect.mp, 0),
    0,
    player.maxMp
  );

  if (
    session.player_hp === oldHp &&
    session.player_mp === oldMp
  ) {
    return {
      ok: false,
      message:
        "❌ That item would not restore anything right now.",
    };
  }

  await db.query(
    `
      UPDATE rpg_inventory_items
      SET quantity = quantity - 1,
          updated_at = NOW()
      WHERE thread_id = $1
        AND user_id = $2
        AND item_id = $3
        AND quantity > 0
    `,
    [
      session.thread_id,
      session.user_id,
      item.id,
    ]
  );

  const hpRestored =
    session.player_hp - oldHp;

  const mpRestored =
    session.player_mp - oldMp;

  return {
    ok: true,
    message:
      `🧪 **${item.name}** used.` +
      (hpRestored > 0
        ? ` +${hpRestored} HP.`
        : "") +
      (mpRestored > 0
        ? ` +${mpRestored} MP.`
        : ""),
  };
}

// ============================================================
// DEFEND
// ============================================================

async function executeDefend(
  session,
  player
) {
  session.defending = true;

  session.player_mp = clamp(
    session.player_mp +
      DEFEND_MP_REGEN,
    0,
    player.maxMp
  );

  session.player_stamina = clamp(
    session.player_stamina +
      DEFEND_STAMINA_REGEN,
    0,
    player.maxStamina
  );

  return {
    ok: true,
    message:
      `🛡️ You brace yourself.\n` +
      `🔷 +${DEFEND_MP_REGEN} MP\n` +
      `💨 +${DEFEND_STAMINA_REGEN} stamina\n` +
      `🛡️ Incoming damage reduced this turn.`,
  };
}

// ============================================================
// ESCAPE
// ============================================================

async function executeEscape(session) {
  if (chance(ESCAPE_CHANCE)) {
    return {
      ok: true,
      escaped: true,
      message:
        "🏃 You successfully escaped from combat.",
    };
  }

  return {
    ok: true,
    escaped: false,
    message:
      "🏃 You failed to escape.",
  };
}

// ============================================================
// REVIVAL
// ============================================================

async function tryWraithRevival(
  session,
  player
) {
  if (
    player.characterClass !== "wraith"
  ) {
    return false;
  }

  const metadata =
    parseMetadata(session);

  if (metadata.revivalUsed) {
    return false;
  }

  const night =
    String(session.weather || "")
      .toLowerCase()
      .includes("night");

  const reviveChance =
    night ? 0.5 : 0.25;

  if (!chance(reviveChance)) {
    return false;
  }

  metadata.revivalUsed = true;

  session.player_hp =
    Math.max(
      1,
      Math.round(
        player.maxHp * 0.3
      )
    );

  await saveCombat(
    session,
    {
      player_hp: session.player_hp,
    },
    metadata
  );

  return true;
}

// ============================================================
// VICTORY
// ============================================================

async function resolveVictory(
  session,
  player,
  metadata
) {
  const enemy =
    getEnemyFromSession(session);

  const reward =
    safeNumber(enemy.reward, 0);

  const xp =
    safeNumber(enemy.xp, 0);

  let rewardResult = null;
  let xpResult = null;

  try {
    rewardResult =
      await db.addBalance(
        session.thread_id,
        session.user_id,
        reward,
        `RPG victory: ${enemy.name}`
      );
  } catch (error) {
    console.error(
      "[RPG COMBAT] reward failed:",
      error
    );
  }

  try {
    xpResult =
      await db.addXP(
        session.thread_id,
        session.user_id,
        xp
      );
  } catch (error) {
    console.error(
      "[RPG COMBAT] XP reward failed:",
      error
    );
  }

  const loot = [];

  for (const itemID of enemy.loot || []) {
    try {
      const item = getItem(itemID);

      if (!item) continue;

      await db.query(
        `
          INSERT INTO rpg_inventory_items (
            thread_id,
            user_id,
            item_id,
            quantity,
            updated_at
          )
          VALUES ($1,$2,$3,1,NOW())
          ON CONFLICT (thread_id,user_id,item_id)
          DO UPDATE SET
            quantity = rpg_inventory_items.quantity + 1,
            updated_at = NOW()
        `,
        [
          session.thread_id,
          session.user_id,
          item.id,
        ]
      );

      loot.push(
        `${item.emoji || "📦"} ${item.name}`
      );
    } catch (error) {
      console.warn(
        `[RPG COMBAT] loot ${itemID} failed:`,
        error.message
      );
    }
  }

  await db.query(
    `
      UPDATE rpg_combat_sessions
      SET status = 'victory',
          enemy_hp = 0,
          updated_at = $1,
          metadata = $2::jsonb
      WHERE id = $3
    `,
    [
      now(),
      JSON.stringify({
        ...metadata,
        victory: true,
        reward,
        xp,
        loot,
      }),
      session.id,
    ]
  );

  return {
    result: "victory",
    reward,
    xp,
    loot,
    xpResult,
    rewardResult,
    message:
      `🏆 **VICTORY**\n` +
      `⚔️ Defeated **${enemy.name}**.\n` +
      `🪙 +${reward} coins\n` +
      `✨ +${xp} XP` +
      (loot.length
        ? `\n🎁 Loot: ${loot.join(", ")}`
        : ""),
  };
}

// ============================================================
// DEFEAT
// ============================================================

async function resolveDefeat(
  session,
  player,
  metadata
) {
  const revived =
    await tryWraithRevival(
      session,
      player
    );

  if (revived) {
    return {
      result: "active",
      revived: true,
      message:
        "🌑 **Wraith Revival** triggered!\n" +
        `❤️ You return with **${session.player_hp} HP**.`,
    };
  }

  await db.query(
    `
      UPDATE rpg_combat_sessions
      SET status = 'defeat',
          player_hp = 0,
          updated_at = $1,
          metadata = $2::jsonb
      WHERE id = $3
    `,
    [
      now(),
      JSON.stringify({
        ...metadata,
        defeat: true,
      }),
      session.id,
    ]
  );

  try {
    await updateVitals(
      session.thread_id,
      session.user_id,
      {
        hp: 1,
        mp: session.player_mp,
        stamina: session.player_stamina,
        status: "defeated",
      }
    );
  } catch {}

  return {
    result: "defeat",
    message:
      "☠️ **DEFEATED**\n" +
      "Your hunt has ended.",
  };
}

// ============================================================
// COMBAT ACTION
// ============================================================

async function combatAction(
  threadID,
  userID,
  action,
  argument = ""
) {
  let session =
    await getCombat(
      threadID,
      userID
    );

  if (!session) {
    return {
      result: "none",
      ok: false,
      message:
        "❌ You are not currently in combat.",
    };
  }

  const state =
    await getUserState(
      threadID,
      userID
    );

  if (!state || !state.player) {
    return {
      result: "none",
      ok: false,
      message:
        "❌ Your RPG profile could not be loaded.",
    };
  }

  const player =
    parseCombatPlayer(
      session,
      state.player
    );

  /*
   * ----------------------------------------------------------
   * IMPORTANT:
   * Validate the requested action BEFORE start-of-turn effects.
   * Invalid commands therefore cannot mutate combat state.
   * ----------------------------------------------------------
   */

  const normalized =
    normalizeAction(action);

  const arg =
    normalizeTarget(argument);

  let actionResult = null;

  if (
    normalized === "escape" ||
    normalized === "run"
  ) {
    actionResult =
      await executeEscape(session);
  } else if (
    normalized === "attack" ||
    normalized === "atk"
  ) {
    actionResult =
      await executeAttack(
        session,
        player
      );
  } else if (
    normalized === "defend" ||
    normalized === "def"
  ) {
    actionResult =
      await executeDefend(
        session,
        player
      );
  } else if (
    normalized === "skill"
  ) {
    if (!arg) {
      return {
        result: "active",
        ok: false,
        message:
          "❌ Usage: `skill <skill_id>`",
      };
    }

    actionResult =
      await executeSkill(
        session,
        player,
        arg
      );
  } else if (
    normalized === "spell"
  ) {
    if (!arg) {
      return {
        result: "active",
        ok: false,
        message:
          "❌ Usage: `spell <spell_id>`",
      };
    }

    actionResult =
      await executeSpell(
        session,
        player,
        arg
      );
  } else if (
    normalized === "special"
  ) {
    if (!arg) {
      return {
        result: "active",
        ok: false,
        message:
          "❌ Usage: `special <special_id>`",
      };
    }

    actionResult =
      await executeSpecial(
        session,
        player,
        arg
      );
  } else if (
    normalized === "item" ||
    normalized === "use"
  ) {
    if (!arg) {
      return {
        result: "active",
        ok: false,
        message:
          "❌ Usage: `item <item_id>`",
      };
    }

    actionResult =
      await executeItem(
        session,
        player,
        arg
      );
  } else {
    return {
      result: "active",
      ok: false,
      message:
        "❌ Unknown combat action.\n" +
        "Use: `attack`, `skill`, `spell`, `special`, `item`, `defend`, or `escape`.",
    };
  }

  if (!actionResult?.ok) {
    return {
      result: "active",
      ok: false,
      message:
        actionResult?.message ||
        "❌ That action failed.",
    };
  }

  const metadata =
    actionResult.metadata ||
    parseMetadata(session);

  if (actionResult.escaped) {
    await db.query(
      `
        UPDATE rpg_combat_sessions
        SET status = 'escaped',
            defending = FALSE,
            updated_at = $1,
            metadata = $2::jsonb
        WHERE id = $3
      `,
      [
        now(),
        JSON.stringify({
          ...metadata,
          escaped: true,
        }),
        session.id,
      ]
    );

    return {
      result: "escaped",
      ok: true,
      message:
        actionResult.message,
    };
  }

  /*
   * Apply player-side start-of-turn effects only after
   * the action itself has been validated and executed.
   */
  const start =
    await processStartTurn(
      session
    );

  session.player_hp = clamp(
    session.player_hp +
      start.hpChange,
    0,
    player.maxHp
  );

  session.player_mp = clamp(
    session.player_mp +
      start.mpChange,
    0,
    player.maxMp
  );

  if (
    start.message.length
  ) {
    pushLog(
      metadata.log,
      start.message.join("\n")
    );
  }

  if (session.player_hp <= 0) {
    const defeat =
      await resolveDefeat(
        session,
        player,
        metadata
      );

    return {
      ...defeat,
      ok: true,
    };
  }

  /*
   * Player action log.
   */
  if (actionResult.message) {
    pushLog(
      metadata.log,
      actionResult.message
    );
  }

  /*
   * Enemy defeated by player action.
   */
  if (
    session.enemy_hp -
      safeNumber(actionResult.damage) <=
    0
  ) {
    session.enemy_hp = 0;

    const victory =
      await resolveVictory(
        session,
        player,
        metadata
      );

    await syncPlayerVitals(
      threadID,
      userID,
      session
    );

    return {
      ...victory,
      ok: true,
    };
  }

  /*
   * Apply the player's damage after action.
   */
  if (safeNumber(actionResult.damage) > 0) {
    session.enemy_hp = Math.max(
      0,
      session.enemy_hp -
        safeNumber(actionResult.damage)
    );
  }

  /*
   * Enemy control.
   */
  let enemyDisabled = false;

  try {
    enemyDisabled =
      await effects.isStunned(
        threadID,
        session.id,
        "enemy"
      );
  } catch {}

  if (!enemyDisabled) {
    try {
      const enemyTurnResult =
        await enemyTurn(
          session,
          player
        );

      if (
        enemyTurnResult.message.length
      ) {
        pushLog(
          metadata.log,
          enemyTurnResult.message.join("\n")
        );
      }

      session.player_hp = Math.max(
        0,
        session.player_hp -
          enemyTurnResult.damage
      );
    } catch (error) {
      console.error(
        "[RPG COMBAT] enemy turn failed:",
        error
      );
    }
  } else {
    pushLog(
      metadata.log,
      "💫 The enemy is stunned and loses its turn."
    );
  }

  session.defending = false;

  /*
   * End-of-turn effect expiry.
   */
  await processEndTurn(session);

  /*
   * Player death.
   */
  if (session.player_hp <= 0) {
    const defeat =
      await resolveDefeat(
        session,
        player,
        metadata
      );

    await syncPlayerVitals(
      threadID,
      userID,
      session
    );

    return {
      ...defeat,
      ok: true,
    };
  }

  /*
   * Enemy death after DOT / other effects.
   */
  if (session.enemy_hp <= 0) {
    const victory =
      await resolveVictory(
        session,
        player,
        metadata
      );

    await syncPlayerVitals(
      threadID,
      userID,
      session
    );

    return {
      ...victory,
      ok: true,
    };
  }

  /*
   * Advance turn.
   */
  session.turn_number =
    safeNumber(
      session.turn_number,
      1
    ) + 1;

  if (
    session.turn_number % 2 === 1
  ) {
    session.round_number =
      safeNumber(
        session.round_number,
        1
      ) + 1;
  }

  metadata.cooldowns =
    metadata.cooldowns || {};

  await saveCombat(
    session,
    {
      enemy_hp: session.enemy_hp,
      player_hp: session.player_hp,
      player_mp: session.player_mp,
      player_stamina: session.player_stamina,
      turn_number: session.turn_number,
      round_number: session.round_number,
      defending: false,
      status: "active",
    },
    metadata
  );

  await syncPlayerVitals(
    threadID,
    userID,
    session
  );

  return {
    result: "active",
    ok: true,
    message:
      [
        actionResult.message,
        start.message.length
          ? start.message.join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
  };
}

// ============================================================
// PLAYER SNAPSHOT FROM SESSION
// ============================================================

function parseCombatPlayer(
  session,
  databasePlayer
) {
  const metadata =
    parseMetadata(session);

  const stored =
    metadata.player || {};

  const classDef =
    getClass(
      databasePlayer.character_class
    );

  return {
    maxHp: safeNumber(
      databasePlayer.max_hp,
      safeNumber(
        stored.maxHp,
        classDef.base.maxHp
      )
    ),

    maxMp: safeNumber(
      databasePlayer.max_mp,
      safeNumber(
        stored.maxMp,
        classDef.base.maxMp
      )
    ),

    maxStamina: safeNumber(
      databasePlayer.max_stamina,
      safeNumber(
        stored.maxStamina,
        classDef.base.maxStamina
      )
    ),

    strength: safeNumber(
      stored.strength,
      databasePlayer.strength ??
        classDef.base.strength
    ),

    defense: safeNumber(
      stored.defense,
      databasePlayer.defense ??
        classDef.base.defense
    ),

    agility: safeNumber(
      stored.agility,
      databasePlayer.agility ??
        classDef.base.agility
    ),

    intelligence: safeNumber(
      stored.intelligence,
      databasePlayer.intelligence ??
        classDef.base.intelligence
    ),

    vitality: safeNumber(
      stored.vitality,
      databasePlayer.vitality ??
        classDef.base.vitality
    ),

    luck: safeNumber(
      stored.luck,
      databasePlayer.luck ??
        classDef.base.luck
    ),

    characterClass:
      databasePlayer.character_class ||
      stored.characterClass ||
      "knight",
  };
}

// ============================================================
// RENDER
// ============================================================

function renderBar(
  current,
  max,
  size = 12
) {
  const safeMax =
    Math.max(1, safeNumber(max, 1));

  const ratio =
    clamp(
      safeNumber(current) /
        safeMax,
      0,
      1
    );

  const filled =
    Math.round(
      ratio * size
    );

  return (
    "█".repeat(filled) +
    "░".repeat(size - filled)
  );
}

function renderCombat(
  session,
  player,
  message = []
) {
  if (!session) {
    return "⚔️ No active combat.";
  }

  const enemy =
    getEnemyFromSession(session);

  const metadata =
    parseMetadata(session);

  const lines = [
    "╔══════════════════════╗",
    "        ⚔️ ECLIPSE COMBAT",
    "╚══════════════════════╝",
    "",
    `${enemy.emoji || "👹"} **${enemy.name}**`,
    `❤️ ${renderBar(
      session.enemy_hp,
      enemy.maxHp
    )} ${session.enemy_hp}/${enemy.maxHp} HP`,
    "",
    "──────────────────────",
    "",
    `👤 **${player?.character_class || metadata.player?.characterClass || "Knight"}**`,
    `❤️ ${renderBar(
      session.player_hp,
      player?.max_hp || metadata.player?.maxHp
    )} ${session.player_hp}/${player?.max_hp || metadata.player?.maxHp} HP`,
    `🔷 ${renderBar(
      session.player_mp,
      player?.max_mp || metadata.player?.maxMp
    )} ${session.player_mp}/${player?.max_mp || metadata.player?.maxMp} MP`,
    `💨 ${renderBar(
      session.player_stamina,
      player?.max_stamina || metadata.player?.maxStamina
    )} ${session.player_stamina}/${player?.max_stamina || metadata.player?.maxStamina}`,
    "",
    `🔄 Turn ${session.turn_number || 1}`,
  ];

  if (session.defending) {
    lines.push(
      "🛡️ **GUARDING**"
    );
  }

  if (
    Array.isArray(message)
  ) {
    for (const item of message) {
      if (item) {
        lines.push(
          "",
          String(item)
        );
      }
    }
  } else if (message) {
    lines.push(
      "",
      String(message)
    );
  }

  if (
    Array.isArray(metadata.log) &&
    metadata.log.length
  ) {
    lines.push(
      "",
      "📜 **Recent Combat Log**"
    );

    for (
      const entry of metadata.log.slice(-5)
    ) {
      lines.push(
        `• ${entry}`
      );
    }
  }

  lines.push(
    "",
    "⚔️ `attack`  🛡️ `defend`",
    "✨ `skill <id>`  🔮 `spell <id>`",
    "🌑 `special <id>`  🧪 `item <id>`",
    "🏃 `escape`"
  );

  return lines.join("\n");
}

// ============================================================
// CLEANUP
// ============================================================

async function clearExpiredCombats() {
  const cutoff =
    now() - COMBAT_TIMEOUT_MS;

  await db.query(
    `
      UPDATE rpg_combat_sessions
      SET status = 'timeout',
          updated_at = $1
      WHERE status = 'active'
        AND updated_at < $2
    `,
    [now(), cutoff]
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ENEMIES,
  ELITE_ENEMIES,
  ALL_ENEMIES,

  createHunt,
  getCombat,
  combatAction,
  renderCombat,

  clearExpiredCombats,
};
