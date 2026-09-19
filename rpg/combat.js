"use strict";

/**
 * ECLIPSE RPG — NEW COMBAT ENGINE
 * =================================
 *
 * Architecture:
 *
 *   CLASS
 *     ↓
 *   AFFINITY
 *     ↓
 *   SPELL / SPECIAL
 *     ↓
 *   EFFECT ENGINE
 *     ↓
 *   COMBAT SESSION
 *
 * Designed for:
 * - Solo hunting
 * - Multi-turn combat
 * - Future 3+ player parties
 * - Bosses / multi-phase bosses
 * - Affinity/environment bonuses
 * - Seasons / weather
 * - Persistent combat effects
 * - Class passives
 * - Specials
 * - Shadow Body
 * - Ice Wall
 * - Nature/Bark Skin
 * - Bloodreaver lifesteal
 * - Wraith revival
 * - Assassin poison
 */

const db = require("../db");

const {
  getAffinity,
  getPlayerAffinity,
  getPlayerAffinityPower,
  getEnvironmentMultiplier,
  getPrimaryAffinity,
} = require("./affinities");

const {
  getSpell,
  getLearnedSpells,
  canCastSpell,
} = require("./spells");

const {
  getSpecial,
  canUseSpecial,
} = require("./specials");

const {
  createEffect,
  applyEffect,
  removeEffect,
  getEffects,
  hasEffect,
  getEffect,
  processStartOfTurn,
  processEndOfTurn,
  calculateIncomingDamage,
  calculateOutgoingDamage,
  createIceWall,
  consumeIceWallBlock,
  createShadowBody,
  destroyShadowBody,
  createInfiniteDarkness,
  isStunned,
  isRooted,
  convertOverheal,
  calculateLifesteal,
} = require("./effects");

const {
  getState,
  getPlayer,
  updateVitals,
} = require("./player");

const {
  getRegion,
} = require("./world");

const {
  getSpecial: getSpecialDefinition,
} = require("./specials");

const {
  registerHuntProgress,
} = require("./adventure");


// ============================================================
// CONFIG
// ============================================================

const COMBAT_TIMEOUT_MS = 30 * 60 * 1000;

const BASE_ESCAPE_CHANCE = 0.35;

const CRITICAL_CHANCE = 0.08;
const CRITICAL_MULTIPLIER = 1.75;

const DEFEND_DAMAGE_REDUCTION = 0.45;
const DEFEND_MP_REGEN = 5;

const WRAITH_REVIVE_HP = 0.25;
const WRAITH_REVIVE_HP_NIGHT = 0.50;

const BLOODREAVER_LIFESTEAL = 0.12;

const ASSASSIN_POISON_DAMAGE = 4;
const ASSASSIN_POISON_TURNS = 3;

const NATURE_DEFEND_MP = 10;

const ICE_WALL_DAMAGE_REDUCTION = 0.50;

const SHADOW_BODY_STAT_MULTIPLIER = 0.50;
const SHADOW_BODY_TRANSFER_MULTIPLIER = 1.25;

const MAX_COMBAT_LOG = 30;


// ============================================================
// ENEMIES
// ============================================================

const ENEMIES = {
  shadow_beast: {
    id: "shadow_beast",
    name: "Shadow Beast",
    level: 2,

    hp: 90,
    attack: 16,
    defense: 7,
    agility: 10,

    affinities: {
      shadow: 1.15,
    },

    rewards: {
      coins: 75,
      xp: 80,
    },

    abilities: [
      "shadow_claw",
      "fear_howl",
    ],
  },

  ironfang_wolf: {
    id: "ironfang_wolf",
    name: "Ironfang Wolf",
    level: 3,

    hp: 110,
    attack: 19,
    defense: 9,
    agility: 14,

    affinities: {
      nature: 1.10,
    },

    rewards: {
      coins: 90,
      xp: 100,
    },

    abilities: [
      "fang_rush",
      "pack_howl",
    ],
  },

  hollow_knight: {
    id: "hollow_knight",
    name: "Hollow Knight",
    level: 5,

    hp: 180,
    attack: 23,
    defense: 17,
    agility: 7,

    affinities: {
      necromancy: 1.20,
      shadow: 1.10,
    },

    rewards: {
      coins: 160,
      xp: 180,
    },

    abilities: [
      "grave_strike",
      "bone_guard",
    ],
  },

  ash_drake: {
    id: "ash_drake",
    name: "Ash Drake",
    level: 7,

    hp: 260,
    attack: 31,
    defense: 20,
    agility: 11,

    affinities: {
      fire: 1.25,
    },

    rewards: {
      coins: 250,
      xp: 300,
    },

    abilities: [
      "ember_breath",
      "ash_wing",
    ],
  },

  // ----------------------------------------------------------
  // ELITES
  // ----------------------------------------------------------

  elite_shadow_beast: {
    id: "elite_shadow_beast",
    name: "Elite Shadow Beast",
    level: 8,

    elite: true,

    hp: 420,
    attack: 38,
    defense: 19,
    agility: 16,

    affinities: {
      shadow: 1.35,
    },

    rewards: {
      coins: 500,
      xp: 600,
    },

    abilities: [
      "shadow_claw",
      "fear_howl",
      "dark_pulse",
    ],
  },

  alpha_ironfang: {
    id: "alpha_ironfang",
    name: "Alpha Ironfang",
    level: 9,

    elite: true,

    hp: 500,
    attack: 42,
    defense: 22,
    agility: 20,

    affinities: {
      nature: 1.25,
    },

    rewards: {
      coins: 650,
      xp: 750,
    },

    abilities: [
      "fang_rush",
      "pack_howl",
      "alpha_roar",
    ],
  },

  corrupted_hollow_knight: {
    id: "corrupted_hollow_knight",
    name: "Corrupted Hollow Knight",
    level: 11,

    elite: true,

    hp: 700,
    attack: 49,
    defense: 31,
    agility: 10,

    affinities: {
      shadow: 1.25,
      necromancy: 1.40,
    },

    rewards: {
      coins: 900,
      xp: 1100,
    },

    abilities: [
      "grave_strike",
      "bone_guard",
      "death_wave",
    ],
  },

  elder_ash_drake: {
    id: "elder_ash_drake",
    name: "Elder Ash Drake",
    level: 14,

    elite: true,

    hp: 950,
    attack: 63,
    defense: 37,
    agility: 13,

    affinities: {
      fire: 1.45,
    },

    rewards: {
      coins: 1400,
      xp: 1800,
    },

    abilities: [
      "ember_breath",
      "ash_wing",
      "infernal_roar",
    ],
  },
};


// ============================================================
// COMBAT STORAGE
// ============================================================

const activeCombats = new Map();

function combatKey(threadID, userID) {
  return `${String(threadID)}:${String(userID)}`;
}

function now() {
  return Date.now();
}


// ============================================================
// RANDOM HELPERS
// ============================================================

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(percent) {
  return Math.random() < percent;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


// ============================================================
// TIME / WORLD HELPERS
// ============================================================

function getTimeOfDay() {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return "morning";
  }

  if (hour >= 12 && hour < 18) {
    return "day";
  }

  if (hour >= 18 || hour < 5) {
    return "night";
  }

  return "day";
}


// ============================================================
// ENEMY CREATION
// ============================================================

function createEnemy(enemyID) {
  const base = ENEMIES[enemyID];

  if (!base) {
    throw new Error(`Unknown enemy: ${enemyID}`);
  }

  return {
    id: base.id,
    name: base.name,
    level: base.level,

    maxHP: base.hp,
    hp: base.hp,

    attack: base.attack,
    defense: base.defense,
    agility: base.agility,

    affinities: {
      ...(base.affinities || {}),
    },

    abilities: [...(base.abilities || [])],

    elite: Boolean(base.elite),
    boss: Boolean(base.boss),

    defending: false,
    stunned: false,
    rooted: false,

    effects: [],

    phase: 1,

    metadata: {},
  };
}


// ============================================================
// COMBAT SESSION CREATION
// ============================================================

async function createHunt(threadID, userID, enemyID = null) {
  const state = await getState(threadID, userID);

  if (!state || !state.player) {
    throw new Error("Unable to load RPG player.");
  }

  const key = combatKey(threadID, userID);

  const existing = activeCombats.get(key);

  if (existing && !isCombatExpired(existing)) {
    return existing;
  }

  const enemyPool = [
    "shadow_beast",
    "ironfang_wolf",
    "hollow_knight",
    "ash_drake",
  ];

  const selectedEnemy =
    enemyID && ENEMIES[enemyID]
      ? enemyID
      : enemyPool[randomInt(0, enemyPool.length - 1)];

  const enemy = createEnemy(selectedEnemy);

  const regionID =
    state.player.region_id ||
    state.player.region ||
    "greenvale";

  const region = getRegion(regionID);

  const combat = {
    id: null,

    threadID: String(threadID),
    userID: String(userID),

    type: "hunt",

    startedAt: now(),
    updatedAt: now(),

    round: 1,

    regionID,

    season: null,
    weather: null,

    environment: region
      ? {
          terrain: region.terrain,
          regionID,
        }
      : {
          regionID,
        },

    player: {
      id: String(userID),

      hp: Number(state.player.hp || 0),
      maxHP: Number(state.player.max_hp || 0),

      mp: Number(state.player.mp || 0),
      maxMP: Number(state.player.max_mp || 0),

      stamina: Number(state.player.stamina || 0),
      maxStamina: Number(state.player.max_stamina || 0),

      attack: Number(state.player.strength || 0),
      defense: Number(state.player.defense || 0),
      agility: Number(state.player.agility || 0),
      intelligence: Number(state.player.intelligence || 0),
      vitality: Number(state.player.vitality || 0),
      luck: Number(state.player.luck || 0),

      classID: String(
        state.player.character_class || "knight"
      ),

      subclass: state.player.subclass || null,

      defending: false,

      alive: true,

      shadowBody: null,
    },

    enemies: [enemy],

    activeEnemyIndex: 0,

    party: [
      {
        id: String(userID),
        type: "player",
        alive: true,
      },
    ],

    log: [],

    status: "active",

    metadata: {
      source: "hunt",
      enemyID: selectedEnemy,
    },
  };

  await persistCombatSession(combat);

  activeCombats.set(key, combat);

  addLog(
    combat,
    `⚔️ You encounter **${enemy.name}** in ${regionID}.`
  );

  return combat;
}


// ============================================================
// DATABASE SESSION
// ============================================================

async function persistCombatSession(combat) {
  try {
    const result = await db.query(
      `
      INSERT INTO rpg_combat_sessions
      (
        thread_id,
        user_id,
        status,
        round_number,
        environment,
        weather,
        season,
        enemy_count,
        metadata,
        created_at,
        updated_at
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        NOW(),
        NOW()
      )
      RETURNING id
      `,
      [
        combat.threadID,
        combat.userID,
        combat.status,
        combat.round,
        combat.regionID,
        combat.weather,
        combat.season,
        combat.enemies.length,
        JSON.stringify(combat.metadata),
      ]
    );

    if (result.rows[0]) {
      combat.id = result.rows[0].id;
    }
  } catch (error) {
    /*
     * Combat should still function if an older database does not
     * yet have every optional combat column.
     */
    console.warn(
      "[RPG COMBAT] Session persistence warning:",
      error.message
    );
  }
}

async function updateCombatSession(combat) {
  if (!combat.id) {
    return;
  }

  try {
    await db.query(
      `
      UPDATE rpg_combat_sessions
      SET
        status = $1,
        round_number = $2,
        environment = $3,
        weather = $4,
        season = $5,
        enemy_count = $6,
        metadata = $7,
        updated_at = NOW()
      WHERE id = $8
      `,
      [
        combat.status,
        combat.round,
        combat.regionID,
        combat.weather,
        combat.season,
        combat.enemies.length,
        JSON.stringify(combat.metadata || {}),
        combat.id,
      ]
    );
  } catch (error) {
    console.warn(
      "[RPG COMBAT] Session update warning:",
      error.message
    );
  }
}


// ============================================================
// COMBAT LOOKUP
// ============================================================

async function getCombat(threadID, userID) {
  const key = combatKey(threadID, userID);

  const combat = activeCombats.get(key);

  if (!combat) {
    return null;
  }

  if (isCombatExpired(combat)) {
    await endCombat(combat, "expired");
    return null;
  }

  return combat;
}

function isCombatExpired(combat) {
  return (
    now() - Number(combat.updatedAt || combat.startedAt) >
    COMBAT_TIMEOUT_MS
  );
}


// ============================================================
// LOGGING
// ============================================================

function addLog(combat, message) {
  combat.log.push(message);

  if (combat.log.length > MAX_COMBAT_LOG) {
    combat.log.splice(
      0,
      combat.log.length - MAX_COMBAT_LOG
    );
  }
}


// ============================================================
// TARGET HELPERS
// ============================================================

function getActiveEnemy(combat) {
  return combat.enemies.find(
    (enemy) => enemy.hp > 0
  ) || null;
}

function getAliveEnemies(combat) {
  return combat.enemies.filter(
    (enemy) => enemy.hp > 0
  );
}

function getAllLivingPlayers(combat) {
  return combat.party.filter(
    (member) => member.alive
  );
}


// ============================================================
// AFFINITY / ENVIRONMENT
// ============================================================

async function getCombatAffinityMultiplier(
  combat,
  affinityID
) {
  if (!affinityID) {
    return 1;
  }

  try {
    return await getEnvironmentMultiplier(
      affinityID,
      combat.regionID,
      combat.season,
      combat.weather,
      {
        timeOfDay: getTimeOfDay(),
      }
    );
  } catch {
    return 1;
  }
}

async function getPlayerAffinityMultiplier(
  userID,
  affinityID
) {
  try {
    return await getPlayerAffinityPower(
      null,
      userID,
      affinityID
    );
  } catch {
    return 1;
  }
}


// ============================================================
// CLASS PASSIVES
// ============================================================

function getClassPassive(classID) {
  switch (String(classID).toLowerCase()) {
    case "knight":
      return "iron_resolve";

    case "bloodreaver":
      return "blood_hunger";

    case "arcanist":
      return "arcane_reservoir";

    case "wraith":
      return "unquiet_soul";

    case "paladin":
      return "divine_protector";

    case "ranger":
      return "hunters_instinct";

    case "assassin":
      return "venomous";

    default:
      return null;
  }
}


// ============================================================
// START-OF-TURN CLASS EFFECTS
// ============================================================

async function processClassPassiveStart(combat) {
  const player = combat.player;

  switch (player.classID) {
    // --------------------------------------------------------
    // ARCANIST
    // --------------------------------------------------------

    case "arcanist": {
      const regen = Math.max(
        4,
        Math.floor(player.maxMP * 0.05)
      );

      player.mp = clamp(
        player.mp + regen,
        0,
        player.maxMP
      );

      addLog(
        combat,
        `🔮 **Arcane Reservoir** restores ${regen} MP.`
      );

      break;
    }

    // --------------------------------------------------------
    // BLOODREAVER
    // --------------------------------------------------------

    case "bloodreaver": {
      /*
       * Blood Hunger is primarily applied when damage is dealt.
       * Nothing is needed at turn start.
       */

      break;
    }

    // --------------------------------------------------------
    // WRAITH
    // --------------------------------------------------------

    case "wraith": {
      /*
       * Revival is handled when the player reaches zero HP.
       */

      break;
    }

    // --------------------------------------------------------
    // RANGER / NATURE
    // --------------------------------------------------------

    case "ranger": {
      /*
       * Nature regeneration is tied to DEFEND rather than
       * every turn.
       */

      break;
    }

    // --------------------------------------------------------
    // ASSASSIN
    // --------------------------------------------------------

    case "assassin": {
      /*
       * Venomous is applied when the Assassin successfully
       * damages an enemy.
       */

      break;
    }

    default:
      break;
  }
}


// ============================================================
// DAMAGE CALCULATION
// ============================================================

async function calculatePlayerDamage(
  combat,
  rawDamage,
  options = {}
) {
  const {
    affinityID = null,
    criticalAllowed = true,
    ignoreDefense = false,
    special = false,
  } = options;

  let damage = Math.max(0, Number(rawDamage || 0));

  // ----------------------------------------------------------
  // Affinity power
  // ----------------------------------------------------------

  if (affinityID) {
    const playerAffinity = await getPlayerAffinityMultiplier(
      combat.userID,
      affinityID
    );

    const environmentMultiplier =
      await getCombatAffinityMultiplier(
        combat,
        affinityID
      );

    damage *= playerAffinity;
    damage *= environmentMultiplier;
  }

  // ----------------------------------------------------------
  // Critical hit
  // ----------------------------------------------------------

  let critical = false;

  if (
    criticalAllowed &&
    !special &&
    chance(CRITICAL_CHANCE)
  ) {
    critical = true;
    damage *= CRITICAL_MULTIPLIER;
  }

  // ----------------------------------------------------------
  // Enemy defense
  // ----------------------------------------------------------

  const enemy = getActiveEnemy(combat);

  if (enemy && !ignoreDefense) {
    const defense = Math.max(
      0,
      Number(enemy.defense || 0)
    );

    damage *= 100 / (100 + defense);
  }

  // ----------------------------------------------------------
  // Effects engine
  // ----------------------------------------------------------

  try {
    damage = await calculateOutgoingDamage(
      combat.id,
      combat.userID,
      enemy ? enemy.id : null,
      damage
    );
  } catch {
    // Optional effect persistence.
  }

  return {
    damage: Math.max(1, Math.floor(damage)),
    critical,
  };
}


// ============================================================
// ENEMY DAMAGE
// ============================================================

async function calculateEnemyDamage(
  combat,
  enemy,
  rawDamage
) {
  let damage = Math.max(
    0,
    Number(rawDamage || 0)
  );

  // ----------------------------------------------------------
  // Enemy attack vs player defense
  // ----------------------------------------------------------

  const defense = Math.max(
    0,
    Number(combat.player.defense || 0)
  );

  damage *= 100 / (100 + defense);

  // ----------------------------------------------------------
  // Player defending
  // ----------------------------------------------------------

  if (combat.player.defending) {
    damage *= 1 - DEFEND_DAMAGE_REDUCTION;
  }

  // ----------------------------------------------------------
  // Shadow Body
  // ----------------------------------------------------------

  if (combat.player.shadowBody) {
    damage *= SHADOW_BODY_TRANSFER_MULTIPLIER;
  }

  // ----------------------------------------------------------
  // Infinite Darkness
  // ----------------------------------------------------------

  if (
    await hasEffect(
      combat.id,
      enemy.id,
      "infinite_darkness"
    )
  ) {
    damage *= 0.80;
  }

  // ----------------------------------------------------------
  // Effect engine
  // ----------------------------------------------------------

  try {
    damage = await calculateIncomingDamage(
      combat.id,
      combat.userID,
      damage
    );
  } catch {
    // Optional effect persistence.
  }

  return Math.max(
    1,
    Math.floor(damage)
  );
}


// ============================================================
// PLAYER DAMAGE APPLICATION
// ============================================================

async function damagePlayer(
  combat,
  damage,
  source = "enemy"
) {
  damage = Math.max(
    0,
    Math.floor(damage)
  );

  // ----------------------------------------------------------
  // Shadow Body
  // ----------------------------------------------------------

  if (combat.player.shadowBody) {
    const shadow = combat.player.shadowBody;

    const shadowDamage = Math.max(
      1,
      Math.floor(
        damage / SHADOW_BODY_TRANSFER_MULTIPLIER
      )
    );

    shadow.hp -= shadowDamage;

    addLog(
      combat,
      `🌑 Your **Shadow Body** absorbs ${shadowDamage} damage.`
    );

    if (shadow.hp <= 0) {
      shadow.hp = 0;
      combat.player.shadowBody = null;

      await destroyShadowBody(
        combat.id,
        combat.userID
      );

      addLog(
        combat,
        `🌑 Your Shadow Body has been destroyed.`
      );

      await applyEffect(
        combat.id,
        combat.userID,
        combat.userID,
        "shadow_disabled",
        {
          duration: 999,
          remainingTurns: 999,
          magnitude: 1,
          data: {
            reason: "shadow_body_destroyed",
          },
        }
      );
    }

    /*
     * Shadow Body does not completely remove damage.
     * The real player receives the increased transfer
     * specified by the mechanic.
     */
    damage = Math.floor(
      damage * 0.25
    );
  }

  combat.player.hp -= damage;

  if (combat.player.hp < 0) {
    combat.player.hp = 0;
  }

  addLog(
    combat,
    `💥 You take **${damage} damage**.`
  );

  if (combat.player.hp <= 0) {
    const revived = await attemptWraithRevival(combat);

    if (!revived) {
      combat.player.alive = false;
      combat.status = "defeat";
    }
  }

  return damage;
}


// ============================================================
// WRAITH REVIVAL
// ============================================================

async function attemptWraithRevival(combat) {
  if (combat.player.classID !== "wraith") {
    return false;
  }

  if (
    combat.metadata.wraithRevived
  ) {
    return false;
  }

  const time = getTimeOfDay();

  /*
   * Wraith is more powerful at night.
   * Night revival gets 50%.
   * Normal revival gets 25%.
   */

  const hpPercent =
    time === "night"
      ? WRAITH_REVIVE_HP_NIGHT
      : WRAITH_REVIVE_HP;

  combat.metadata.wraithRevived = true;

  combat.player.hp = Math.max(
    1,
    Math.floor(
      combat.player.maxHP * hpPercent
    )
  );

  combat.player.alive = true;

  addLog(
    combat,
    time === "night"
      ? `👻 **Unquiet Soul** tears you back into existence with **50% HP**.`
      : `👻 **Unquiet Soul** revives you with **25% HP**.`
  );

  return true;
}


// ============================================================
// ENEMY DAMAGE APPLICATION
// ============================================================

async function damageEnemy(
  combat,
  enemy,
  damage,
  source = "player"
) {
  if (!enemy || enemy.hp <= 0) {
    return 0;
  }

  damage = Math.max(
    0,
    Math.floor(damage)
  );

  // ----------------------------------------------------------
  // Enemy defense state
  // ----------------------------------------------------------

  if (enemy.defending) {
    damage = Math.floor(
      damage * 0.60
    );
  }

  // ----------------------------------------------------------
  // Apply damage
  // ----------------------------------------------------------

  enemy.hp -= damage;

  if (enemy.hp < 0) {
    enemy.hp = 0;
  }

  addLog(
    combat,
    `⚔️ **${enemy.name}** takes **${damage} damage**.`
  );

  if (enemy.hp <= 0) {
    addLog(
      combat,
      `☠️ **${enemy.name}** has been defeated.`
    );
  }

  return damage;
}


// ============================================================
// LIFESTEAL
// ============================================================

async function applyLifesteal(
  combat,
  damage,
  amount = BLOODREAVER_LIFESTEAL
) {
  if (combat.player.classID !== "bloodreaver") {
    return 0;
  }

  const healing = Math.max(
    1,
    Math.floor(damage * amount)
  );

  const oldHP = combat.player.hp;

  combat.player.hp = clamp(
    combat.player.hp + healing,
    0,
    combat.player.maxHP
  );

  const actualHealing =
    combat.player.hp - oldHP;

  if (actualHealing > 0) {
    addLog(
      combat,
      `🩸 **Blood Hunger** restores ${actualHealing} HP.`
    );
  }

  return actualHealing;
}


// ============================================================
// ASSASSIN POISON
// ============================================================

async function applyAssassinPoison(
  combat,
  enemy
) {
  if (combat.player.classID !== "assassin") {
    return;
  }

  await applyEffect(
    combat.id,
    enemy.id,
    combat.userID,
    "poison",
    {
      duration: ASSASSIN_POISON_TURNS,
      remainingTurns: ASSASSIN_POISON_TURNS,
      stacks: 1,
      magnitude: ASSASSIN_POISON_DAMAGE,
      data: {
        damage: ASSASSIN_POISON_DAMAGE,
      },
    }
  );

  addLog(
    combat,
    `☠️ **Venomous** poisons ${enemy.name}.`
  );
}


// ============================================================
// BLOODREAVER SACRIFICE
// ============================================================

async function bloodSacrifice(combat) {
  if (combat.player.classID !== "bloodreaver") {
    return {
      ok: false,
      message: "Only Bloodreavers can use Blood Sacrifice.",
    };
  }

  const sacrifice = Math.max(
    1,
    Math.floor(
      combat.player.maxHP * 0.15
    )
  );

  if (
    combat.player.hp <= sacrifice
  ) {
    return {
      ok: false,
      message: "You do not have enough HP.",
    };
  }

  combat.player.hp -= sacrifice;

  const bonusDamage =
    sacrifice * 2;

  addLog(
    combat,
    `🩸 You sacrifice **${sacrifice} HP** for devastating power.`
  );

  return {
    ok: true,
    damage: bonusDamage,
  };
}


// ============================================================
// PLAYER BASIC ATTACK
// ============================================================

async function playerAttack(combat) {
  const enemy = getActiveEnemy(combat);

  if (!enemy) {
    return {
      ok: false,
      message: "There are no enemies remaining.",
    };
  }

  if (await isStunned(combat.id, combat.userID)) {
    return {
      ok: false,
      message: "You are stunned and cannot act.",
    };
  }

  if (await isRooted(combat.id, combat.userID)) {
    return {
      ok: false,
      message: "You are rooted and cannot attack.",
    };
  }

  let rawDamage =
    combat.player.attack +
    Math.floor(
      combat.player.strength || 0
    );

  /*
   * Light / Divine classes get their normal physical
   * affinity integrated here.
   */

  let affinityID = null;

  if (
    combat.player.classID === "knight"
  ) {
    affinityID = "light";
  }

  if (
    combat.player.classID === "paladin"
  ) {
    affinityID = "divine";
  }

  // Nature changes attack according to environment.
  if (
    combat.player.classID === "ranger"
  ) {
    affinityID = "nature";
  }

  const result = await calculatePlayerDamage(
    combat,
    rawDamage,
    {
      affinityID,
    }
  );

  await damageEnemy(
    combat,
    enemy,
    result.damage,
    "attack"
  );

  if (result.critical) {
    addLog(
      combat,
      `✨ **CRITICAL HIT!**`
    );
  }

  await afterPlayerDamage(
    combat,
    enemy,
    result.damage
  );

  return {
    ok: true,
    action: "attack",
    damage: result.damage,
    critical: result.critical,
  };
}


// ============================================================
// POST DAMAGE HOOKS
// ============================================================

async function afterPlayerDamage(
  combat,
  enemy,
  damage
) {
  await applyLifesteal(
    combat,
    damage
  );

  await applyAssassinPoison(
    combat,
    enemy
  );

  /*
   * Shadow Body is regained through dealing damage.
   */

  if (
    combat.player.classID === "wraith" &&
    !combat.player.shadowBody &&
    combat.metadata.shadowCanReturn &&
    damage > 0
  ) {
    await restoreShadowBody(combat);
  }
}


// ============================================================
// SHADOW BODY
// ============================================================

async function restoreShadowBody(combat) {
  if (
    combat.player.classID !== "wraith"
  ) {
    return false;
  }

  if (
    combat.player.shadowBody
  ) {
    return false;
  }

  if (
    await hasEffect(
      combat.id,
      combat.userID,
      "shadow_disabled"
    )
  ) {
    return false;
  }

  const shadow = {
    hp: Math.max(
      1,
      Math.floor(
        combat.player.maxHP *
        SHADOW_BODY_STAT_MULTIPLIER
      )
    ),

    maxHP: Math.max(
      1,
      Math.floor(
        combat.player.maxHP *
        SHADOW_BODY_STAT_MULTIPLIER
      )
    ),

    attack: Math.max(
      1,
      Math.floor(
        combat.player.attack *
        SHADOW_BODY_STAT_MULTIPLIER
      )
    ),

    defense: Math.max(
      1,
      Math.floor(
        combat.player.defense *
        SHADOW_BODY_STAT_MULTIPLIER
      )
    ),

    agility: Math.max(
      1,
      Math.floor(
        combat.player.agility *
        SHADOW_BODY_STAT_MULTIPLIER
      )
    ),
  };

  combat.player.shadowBody = shadow;

  await createShadowBody(
    combat.id,
    combat.userID,
    shadow
  );

  addLog(
    combat,
    `🌑 **Shadow Body** reforms around you.`
  );

  return true;
}


// ============================================================
// DEFEND
// ============================================================

async function playerDefend(combat) {
  if (
    await isStunned(
      combat.id,
      combat.userID
    )
  ) {
    return {
      ok: false,
      message: "You are stunned.",
    };
  }

  combat.player.defending = true;

  /*
   * Nature/Ranger defensive regeneration.
   */

  if (
    combat.player.classID === "ranger"
  ) {
    combat.player.mp = clamp(
      combat.player.mp + NATURE_DEFEND_MP,
      0,
      combat.player.maxMP
    );

    addLog(
      combat,
      `🌿 **Nature's Resolve** restores ${NATURE_DEFEND_MP} MP.`
    );
  }

  /*
   * Generic defend mana recovery.
   */

  if (
    combat.player.classID !== "ranger"
  ) {
    combat.player.mp = clamp(
      combat.player.mp + DEFEND_MP_REGEN,
      0,
      combat.player.maxMP
    );
  }

  addLog(
    combat,
    `🛡️ You brace for the next attack.`
  );

  return {
    ok: true,
    action: "defend",
  };
}


// ============================================================
// SPELL CASTING
// ============================================================

async function playerCastSpell(
  combat,
  spellID
) {
  const spell = getSpell(spellID);

  if (!spell) {
    return {
      ok: false,
      message: `Unknown spell: ${spellID}`,
    };
  }

  if (
    await isStunned(
      combat.id,
      combat.userID
    )
  ) {
    return {
      ok: false,
      message: "You are stunned.",
    };
  }

  // ----------------------------------------------------------
  // Mana
  // ----------------------------------------------------------

  const manaCost = Number(
    spell.manaCost ||
    spell.cost ||
    0
  );

  if (
    combat.player.mp < manaCost
  ) {
    return {
      ok: false,
      message: `You need ${manaCost} MP.`,
    };
  }

  // ----------------------------------------------------------
  // Spell availability
  // ----------------------------------------------------------

  try {
    const allowed = await canCastSpell(
      combat.threadID,
      combat.userID,
      spellID
    );

    if (!allowed) {
      return {
        ok: false,
        message: "You have not learned that spell.",
      };
    }
  } catch {
    /*
     * Allows compatibility while the spell module evolves.
     */
  }

  // ----------------------------------------------------------
  // Pay mana
  // ----------------------------------------------------------

  combat.player.mp -= manaCost;

  // ----------------------------------------------------------
  // Determine affinity
  // ----------------------------------------------------------

  const affinityID =
    spell.affinity ||
    spell.school ||
    spell.affinityId ||
    null;

  const targetMode =
    spell.target ||
    spell.targetType ||
    "enemy";

  // ----------------------------------------------------------
  // Utility spells
  // ----------------------------------------------------------

  if (
    spellID === "teleport_sanctuary" ||
    spellID === "teleport"
  ) {
    addLog(
      combat,
      `✨ **${spell.name}** pulls you toward safety.`
    );

    combat.metadata.teleportReady = true;

    return {
      ok: true,
      action: "spell",
      spell: spellID,
    };
  }

  if (
    spellID === "detect_magic" ||
    spellID === "detect"
  ) {
    addLog(
      combat,
      `🔮 **${spell.name}** reveals the enemy's magical presence.`
    );

    combat.metadata.detectMagic = true;

    return {
      ok: true,
      action: "spell",
      spell: spellID,
    };
  }

  // ----------------------------------------------------------
  // HEAL
  // ----------------------------------------------------------

  if (
    spell.effect === "heal" ||
    spell.type === "heal"
  ) {
    const amount =
      Number(spell.power || spell.heal || 25);

    const oldHP =
      combat.player.hp;

    combat.player.hp = clamp(
      combat.player.hp + amount,
      0,
      combat.player.maxHP
    );

    let healing =
      combat.player.hp - oldHP;

    /*
     * Bark Skin:
     * healing beyond max HP becomes defense health.
     */

    const overheal =
      Math.max(
        0,
        amount - healing
      );

    if (
      overheal > 0 &&
      combat.player.classID === "ranger"
    ) {
      await convertOverheal(
        combat.id,
        combat.userID,
        overheal
      );

      addLog(
        combat,
        `🌿 **Bark Skin** converts ${overheal} overheal into Defense Health.`
      );
    }

    addLog(
      combat,
      `💚 **${spell.name}** restores ${healing} HP.`
    );

    return {
      ok: true,
      action: "spell",
      spell: spellID,
      healing,
    };
  }

  // ----------------------------------------------------------
  // DAMAGE
  // ----------------------------------------------------------

  const enemies =
    targetMode === "all"
      ? getAliveEnemies(combat)
      : [getActiveEnemy(combat)];

  const results = [];

  for (const enemy of enemies) {
    if (!enemy) {
      continue;
    }

    const rawDamage =
      Number(
        spell.power ||
        spell.damage ||
        20
      );

    const result =
      await calculatePlayerDamage(
        combat,
        rawDamage,
        {
          affinityID,
          criticalAllowed: false,
        }
      );

    await damageEnemy(
      combat,
      enemy,
      result.damage,
      "spell"
    );

    results.push({
      enemy: enemy.id,
      damage: result.damage,
    });

    // --------------------------------------------------------
    // Special spell effects
    // --------------------------------------------------------

    if (
      spellID === "firebolt" ||
      affinityID === "fire"
    ) {
      const burnTurns =
        combat.season === "summer"
          ? 6
          : 3;

      await applyEffect(
        combat.id,
        enemy.id,
        combat.userID,
        "burn",
        {
          duration: burnTurns,
          remainingTurns: burnTurns,
          magnitude: Math.max(
            1,
            Math.floor(
              result.damage * 0.15
            )
          ),
          data: {
            damage: Math.max(
              1,
              Math.floor(
                result.damage * 0.15
              )
            ),
          },
        }
      );

      addLog(
        combat,
        `🔥 ${enemy.name} is burning for ${burnTurns} turns.`
      );
    }

    if (
      spellID === "ice_lance" ||
      affinityID === "ice"
    ) {
      await applyEffect(
        combat.id,
        enemy.id,
        combat.userID,
        "slow",
        {
          duration: 2,
          remainingTurns: 2,
          magnitude: 0.25,
        }
      );
    }

    if (
      spellID === "shadow_veil" ||
      affinityID === "shadow"
    ) {
      await applyEffect(
        combat.id,
        combat.userID,
        combat.userID,
        "dodge_up",
        {
          duration: 2,
          remainingTurns: 2,
          magnitude: 0.20,
        }
      );
    }

    if (
      spellID === "curse_of_weakness"
    ) {
      await applyEffect(
        combat.id,
        enemy.id,
        combat.userID,
        "weakness",
        {
          duration: 3,
          remainingTurns: 3,
          magnitude: 0.20,
        }
      );
    }

    if (
      spellID === "drain_life"
    ) {
      const heal =
        Math.max(
          1,
          Math.floor(
            result.damage * 0.50
          )
        );

      combat.player.hp = clamp(
        combat.player.hp + heal,
        0,
        combat.player.maxHP
      );

      addLog(
        combat,
        `🩸 **Drain Life** restores ${heal} HP.`
      );
    }
  }

  addLog(
    combat,
    `✨ You cast **${spell.name}**.`
  );

  return {
    ok: true,
    action: "spell",
    spell: spellID,
    results,
  };
}


// ============================================================
// SPECIAL MOVE
// ============================================================

async function playerUseSpecial(
  combat,
  specialID
) {
  const special =
    getSpecialDefinition(specialID);

  if (!special) {
    return {
      ok: false,
      message: `Unknown special: ${specialID}`,
    };
  }

  const usable =
    await canUseSpecial(
      combat.threadID,
      combat.userID,
      specialID,
      {
        combat: true,
        regionID: combat.regionID,
        timeOfDay: getTimeOfDay(),
        season: combat.season,
        weather: combat.weather,
      }
    );

  if (!usable) {
    return {
      ok: false,
      message: "You cannot use that special move yet.",
    };
  }

  const enemy =
    getActiveEnemy(combat);

  // ==========================================================
  // ICE WALL
  // ==========================================================

  if (
    specialID ===
    "heaven_piercing_ice_wall"
  ) {
    await createIceWall(
      combat.id,
      combat.userID,
      {
        blocks: 3,
        damageReduction: ICE_WALL_DAMAGE_REDUCTION,
        stunCounter: 3,
      }
    );

    addLog(
      combat,
      `❄️ **Heaven Piercing Ice Wall** rises around you.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
    };
  }

  // ==========================================================
  // SCORCHING GARDEN
  // ==========================================================

  if (
    specialID === "scorching_garden"
  ) {
    const enemies =
      getAliveEnemies(combat);

    const results = [];

    for (const target of enemies) {
      const result =
        await calculatePlayerDamage(
          combat,
          combat.player.attack * 2.5,
          {
            affinityID: "fire",
            criticalAllowed: false,
            special: true,
          }
        );

      await damageEnemy(
        combat,
        target,
        result.damage,
        "special"
      );

      const burnTurns =
        combat.season === "summer"
          ? 6
          : 3;

      await applyEffect(
        combat.id,
        target.id,
        combat.userID,
        "burn",
        {
          duration: burnTurns,
          remainingTurns: burnTurns,
          magnitude: Math.max(
            1,
            Math.floor(
              result.damage * 0.20
            )
          ),
          data: {
            damage: Math.max(
              1,
              Math.floor(
                result.damage * 0.20
              )
            ),
          },
        }
      );

      results.push({
        target: target.id,
        damage: result.damage,
      });
    }

    addLog(
      combat,
      `🔥🌹 **Scorching Garden** engulfs the battlefield.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
      results,
    };
  }

  // ==========================================================
  // INFINITE DARKNESS
  // ==========================================================

  if (
    specialID === "infinite_darkness"
  ) {
    await createInfiniteDarkness(
      combat.id,
      combat.userID,
      {
        duration: 5,
        damageReduction: 0.20,
        lifesteal: 0.20,
      }
    );

    const enemies =
      getAliveEnemies(combat);

    for (const target of enemies) {
      await applyEffect(
        combat.id,
        target.id,
        combat.userID,
        "stun",
        {
          duration: 5,
          remainingTurns: 5,
          magnitude: 1,
        }
      );
    }

    addLog(
      combat,
      `🌑 **Infinite Darkness** freezes every enemy in darkness for 5 moves.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
    };
  }

  // ==========================================================
  // HEAVENLY JUDGEMENT
  // ==========================================================

  if (
    specialID === "heavenly_judgement"
  ) {
    if (!enemy) {
      return {
        ok: false,
        message: "There is no enemy to judge.",
      };
    }

    const result =
      await calculatePlayerDamage(
        combat,
        combat.player.attack * 4.5,
        {
          affinityID: "light",
          criticalAllowed: false,
          special: true,
        }
      );

    await damageEnemy(
      combat,
      enemy,
      result.damage,
      "special"
    );

    const lostHP =
      combat.player.maxHP -
      combat.player.hp;

    const healing =
      Math.floor(
        lostHP * 0.30
      );

    combat.player.hp = clamp(
      combat.player.hp + healing,
      0,
      combat.player.maxHP
    );

    addLog(
      combat,
      `⚔️☀️ **Heavenly Judgement** strikes ${enemy.name} for ${result.damage} damage.`
    );

    addLog(
      combat,
      `💛 Divine light restores ${healing} HP.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
      damage: result.damage,
      healing,
    };
  }

  // ==========================================================
  // AMATERASU'S BLESSING
  // ==========================================================

  if (
    specialID === "amaterasus_blessing"
  ) {
    if (
      getTimeOfDay() !== "morning"
    ) {
      return {
        ok: false,
        message:
          "Amaterasu's Blessing can only be invoked in the morning.",
      };
    }

    const enemies =
      getAliveEnemies(combat);

    const results = [];

    for (const target of enemies) {
      const result =
        await calculatePlayerDamage(
          combat,
          combat.player.attack * 2.2,
          {
            affinityID: "light",
            criticalAllowed: false,
            special: true,
          }
        );

      await damageEnemy(
        combat,
        target,
        result.damage,
        "special"
      );

      results.push({
        target: target.id,
        damage: result.damage,
      });
    }

    await applyEffect(
      combat.id,
      combat.userID,
      combat.userID,
      "damage_up",
      {
        duration: 5,
        remainingTurns: 5,
        magnitude: 0.20,
      }
    );

    addLog(
      combat,
      `☀️ **Amaterasu's Blessing** rains solar blades upon the enemy team.`
    );

    addLog(
      combat,
      `✨ Your damage is increased by 20% for 5 moves.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
      results,
    };
  }

  // ==========================================================
  // CRIMSON REQUIEM
  // ==========================================================

  if (
    specialID === "crimson_requiem"
  ) {
    if (
      combat.player.hp <= 1
    ) {
      return {
        ok: false,
        message:
          "You cannot sacrifice more life.",
      };
    }

    const sacrifice =
      Math.floor(
        combat.player.maxHP * 0.25
      );

    combat.player.hp = Math.max(
      1,
      combat.player.hp - sacrifice
    );

    const damage =
      sacrifice * 2.5;

    const result =
      await calculatePlayerDamage(
        combat,
        damage,
        {
          affinityID: "blood",
          criticalAllowed: false,
          special: true,
        }
      );

    await damageEnemy(
      combat,
      enemy,
      result.damage,
      "special"
    );

    const healing =
      Math.floor(
        result.damage * 0.50
      );

    combat.player.hp = clamp(
      combat.player.hp + healing,
      0,
      combat.player.maxHP
    );

    addLog(
      combat,
      `🩸 **Crimson Requiem** sacrifices ${sacrifice} HP.`
    );

    addLog(
      combat,
      `🩸 The attack deals ${result.damage} damage and restores ${healing} HP.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
      damage: result.damage,
      healing,
    };
  }

  // ==========================================================
  // WORLDBLOOM
  // ==========================================================

  if (
    specialID === "worldbloom"
  ) {
    combat.weather = "rain";

    const hpRestore =
      Math.floor(
        combat.player.maxHP * 0.20
      );

    const mpRestore =
      Math.floor(
        combat.player.maxMP * 0.25
      );

    combat.player.hp = clamp(
      combat.player.hp + hpRestore,
      0,
      combat.player.maxHP
    );

    combat.player.mp = clamp(
      combat.player.mp + mpRestore,
      0,
      combat.player.maxMP
    );

    addLog(
      combat,
      `🌿 **Worldbloom** changes the battlefield weather to rain.`
    );

    addLog(
      combat,
      `🌧️ You restore ${hpRestore} HP and ${mpRestore} MP.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
    };
  }

  // ==========================================================
  // ARCANE OVERDRIVE
  // ==========================================================

  if (
    specialID === "arcane_overdrive"
  ) {
    await applyEffect(
      combat.id,
      combat.userID,
      combat.userID,
      "damage_up",
      {
        duration: 5,
        remainingTurns: 5,
        magnitude: 0.35,
      }
    );

    await applyEffect(
      combat.id,
      combat.userID,
      combat.userID,
      "mana_regen_up",
      {
        duration: 5,
        remainingTurns: 5,
        magnitude: 0.10,
      }
    );

    addLog(
      combat,
      `🔮 **Arcane Overdrive** floods your body with raw mana.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
    };
  }

  // ==========================================================
  // HEAVEN'S THUNDER
  // ==========================================================

  if (
    specialID === "heavens_thunder"
  ) {
    const enemies =
      getAliveEnemies(combat);

    const results = [];

    for (const target of enemies) {
      const result =
        await calculatePlayerDamage(
          combat,
          combat.player.intelligence * 3,
          {
            affinityID: "lightning",
            criticalAllowed: false,
            special: true,
          }
        );

      await damageEnemy(
        combat,
        target,
        result.damage,
        "special"
      );

      await applyEffect(
        combat.id,
        target.id,
        combat.userID,
        "stun",
        {
          duration: 1,
          remainingTurns: 1,
          magnitude: 1,
        }
      );

      results.push({
        target: target.id,
        damage: result.damage,
      });
    }

    addLog(
      combat,
      `⚡ **Heaven's Thunder** strikes every enemy.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
      results,
    };
  }

  // ==========================================================
  // ABYSSAL TIDE
  // ==========================================================

  if (
    specialID === "abyssal_tide"
  ) {
    const enemies =
      getAliveEnemies(combat);

    const results = [];

    for (const target of enemies) {
      const result =
        await calculatePlayerDamage(
          combat,
          combat.player.intelligence * 2.5,
          {
            affinityID: "water",
            criticalAllowed: false,
            special: true,
          }
        );

      await damageEnemy(
        combat,
        target,
        result.damage,
        "special"
      );

      await applyEffect(
        combat.id,
        target.id,
        combat.userID,
        "slow",
        {
          duration: 3,
          remainingTurns: 3,
          magnitude: 0.25,
        }
      );

      results.push({
        target: target.id,
        damage: result.damage,
      });
    }

    addLog(
      combat,
      `🌊 **Abyssal Tide** crashes through the battlefield.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
      results,
    };
  }

  // ==========================================================
  // CELESTIAL TEMPEST
  // ==========================================================

  if (
    specialID === "celestial_tempest"
  ) {
    const enemies =
      getAliveEnemies(combat);

    const results = [];

    for (const target of enemies) {
      const result =
        await calculatePlayerDamage(
          combat,
          combat.player.intelligence * 3,
          {
            affinityID: "wind",
            criticalAllowed: false,
            special: true,
          }
        );

      await damageEnemy(
        combat,
        target,
        result.damage,
        "special"
      );

      results.push({
        target: target.id,
        damage: result.damage,
      });
    }

    combat.weather = "storm";

    addLog(
      combat,
      `🌪️ **Celestial Tempest** turns the battlefield into a storm.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
      results,
    };
  }

  // ==========================================================
  // WORLD BREAKER
  // ==========================================================

  if (
    specialID === "worldbreaker"
  ) {
    const enemies =
      getAliveEnemies(combat);

    const results = [];

    for (const target of enemies) {
      const result =
        await calculatePlayerDamage(
          combat,
          (
            combat.player.attack +
            combat.player.intelligence
          ) * 4,
          {
            affinityID: null,
            criticalAllowed: false,
            ignoreDefense: true,
            special: true,
          }
        );

      await damageEnemy(
        combat,
        target,
        result.damage,
        "special"
      );

      results.push({
        target: target.id,
        damage: result.damage,
      });
    }

    addLog(
      combat,
      `🌌 **Worldbreaker** tears through reality itself.`
    );

    return {
      ok: true,
      action: "special",
      special: specialID,
      results,
    };
  }

  return {
    ok: false,
    message: "That special has no combat implementation yet.",
  };
}


// ============================================================
// ENEMY AI
// ============================================================

async function enemyTurn(combat) {
  const enemies =
    getAliveEnemies(combat);

  if (!enemies.length) {
    return;
  }

  for (const enemy of enemies) {
    if (
      combat.status !== "active"
    ) {
      break;
    }

    if (
      await isStunned(
        combat.id,
        enemy.id
      )
    ) {
      addLog(
        combat,
        `💫 **${enemy.name}** is stunned.`
      );

      continue;
    }

    if (
      await isRooted(
        combat.id,
        enemy.id
      )
    ) {
      addLog(
        combat,
        `🌿 **${enemy.name}** is rooted.`
      );

      continue;
    }

    const roll =
      Math.random();

    // --------------------------------------------------------
    // DEFEND
    // --------------------------------------------------------

    if (
      roll < 0.12
    ) {
      enemy.defending = true;

      addLog(
        combat,
        `🛡️ **${enemy.name}** takes a defensive stance.`
      );

      continue;
    }

    // --------------------------------------------------------
    // ABILITY
    // --------------------------------------------------------

    if (
      enemy.abilities.length &&
      roll < 0.35
    ) {
      const ability =
        enemy.abilities[
          randomInt(
            0,
            enemy.abilities.length - 1
          )
        ];

      await enemyAbility(
        combat,
        enemy,
        ability
      );

      continue;
    }

    // --------------------------------------------------------
    // BASIC ATTACK
    // --------------------------------------------------------

    enemy.defending = false;

    const damage =
      await calculateEnemyDamage(
        combat,
        enemy,
        enemy.attack
      );

    await damagePlayer(
      combat,
      damage,
      "enemy"
    );

    if (
      combat.status !== "active"
    ) {
      break;
    }
  }
}


// ============================================================
// ENEMY ABILITIES
// ============================================================

async function enemyAbility(
  combat,
  enemy,
  ability
) {
  switch (ability) {
    case "shadow_claw": {
      const damage =
        await calculateEnemyDamage(
          combat,
          enemy,
          enemy.attack * 1.35
        );

      await damagePlayer(
        combat,
        damage,
        "shadow_claw"
      );

      addLog(
        combat,
        `🌑 **${enemy.name}** uses Shadow Claw.`
      );

      break;
    }

    case "fear_howl": {
      await applyEffect(
        combat.id,
        combat.userID,
        enemy.id,
        "weakness",
        {
          duration: 2,
          remainingTurns: 2,
          magnitude: 0.15,
        }
      );

      addLog(
        combat,
        `👁️ **${enemy.name}** unleashes a terrifying howl.`
      );

      break;
    }

    case "dark_pulse": {
      const damage =
        await calculateEnemyDamage(
          combat,
          enemy,
          enemy.attack * 1.75
        );

      await damagePlayer(
        combat,
        damage,
        "dark_pulse"
      );

      addLog(
        combat,
        `🌑 **${enemy.name}** releases a Dark Pulse.`
      );

      break;
    }

    case "fang_rush": {
      const damage =
        await calculateEnemyDamage(
          combat,
          enemy,
          enemy.attack * 1.50
        );

      await damagePlayer(
        combat,
        damage,
        "fang_rush"
      );

      addLog(
        combat,
        `🐺 **${enemy.name}** charges with Fang Rush.`
      );

      break;
    }

    case "pack_howl": {
      enemy.attack += 3;

      addLog(
        combat,
        `🐺 **${enemy.name}** howls and grows more aggressive.`
      );

      break;
    }

    case "alpha_roar": {
      enemy.attack += 7;

      await applyEffect(
        combat.id,
        combat.userID,
        enemy.id,
        "weakness",
        {
          duration: 2,
          remainingTurns: 2,
          magnitude: 0.20,
        }
      );

      addLog(
        combat,
        `🐺 **${enemy.name}** unleashes an Alpha Roar.`
      );

      break;
    }

    case "grave_strike": {
      const damage =
        await calculateEnemyDamage(
          combat,
          enemy,
          enemy.attack * 1.60
        );

      await damagePlayer(
        combat,
        damage,
        "grave_strike"
      );

      addLog(
        combat,
        `☠️ **${enemy.name}** uses Grave Strike.`
      );

      break;
    }

    case "bone_guard": {
      enemy.defending = true;

      enemy.defense += 8;

      addLog(
        combat,
        `💀 **${enemy.name}** raises a Bone Guard.`
      );

      break;
    }

    case "death_wave": {
      const damage =
        await calculateEnemyDamage(
          combat,
          enemy,
          enemy.attack * 2
        );

      await damagePlayer(
        combat,
        damage,
        "death_wave"
      );

      addLog(
        combat,
        `☠️ **${enemy.name}** releases a Death Wave.`
      );

      break;
    }

    case "ember_breath": {
      const damage =
        await calculateEnemyDamage(
          combat,
          enemy,
          enemy.attack * 1.80
        );

      await damagePlayer(
        combat,
        damage,
        "ember_breath"
      );

      await applyEffect(
        combat.id,
        combat.userID,
        enemy.id,
        "burn",
        {
          duration: 3,
          remainingTurns: 3,
          magnitude: 6,
          data: {
            damage: 6,
          },
        }
      );

      addLog(
        combat,
        `🔥 **${enemy.name}** breathes scorching fire.`
      );

      break;
    }

    case "ash_wing": {
      const damage =
        await calculateEnemyDamage(
          combat,
          enemy,
          enemy.attack * 1.40
        );

      await damagePlayer(
        combat,
        damage,
        "ash_wing"
      );

      addLog(
        combat,
        `🔥 **${enemy.name}** lashes out with Ash Wing.`
      );

      break;
    }

    case "infernal_roar": {
      enemy.attack += 10;

      addLog(
        combat,
        `🔥 **${enemy.name}** unleashes an Infernal Roar.`
      );

      break;
    }

    default: {
      const damage =
        await calculateEnemyDamage(
          combat,
          enemy,
          enemy.attack
        );

      await damagePlayer(
        combat,
        damage,
        ability
      );

      break;
    }
  }
}


// ============================================================
// ICE WALL
// ============================================================

async function checkIceWall(combat) {
  try {
    const wall =
      await getEffect(
        combat.id,
        combat.userID,
        "heaven_piercing_ice_wall"
      );

    if (!wall) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}


// ============================================================
// TURN START
// ============================================================

async function startTurn(combat) {
  combat.player.defending = false;

  for (const enemy of combat.enemies) {
    enemy.defending = false;
  }

  // ----------------------------------------------------------
  // Effects
  // ----------------------------------------------------------

  try {
    await processStartOfTurn(
      combat.id,
      combat.userID
    );

    for (const enemy of combat.enemies) {
      await processStartOfTurn(
        combat.id,
        enemy.id
      );
    }
  } catch {
    // Effects remain optional for compatibility.
  }

  // ----------------------------------------------------------
  // Class passive
  // ----------------------------------------------------------

  await processClassPassiveStart(
    combat
  );

  // ----------------------------------------------------------
  // Sync vitals
  // ----------------------------------------------------------

  await syncPlayerVitals(
    combat
  );
}


// ============================================================
// TURN END
// ============================================================

async function endTurn(combat) {
  try {
    await processEndOfTurn(
      combat.id,
      combat.userID
    );

    for (const enemy of combat.enemies) {
      await processEndOfTurn(
        combat.id,
        enemy.id
      );
    }
  } catch {
    // Optional effects persistence.
  }

  await syncPlayerVitals(
    combat
  );
}


// ============================================================
// SYNC PLAYER DATABASE
// ============================================================

async function syncPlayerVitals(combat) {
  try {
    await updateVitals(
      combat.threadID,
      combat.userID,
      {
        hp: combat.player.hp,
        mp: combat.player.mp,
        stamina: combat.player.stamina,
      }
    );
  } catch (error) {
    console.warn(
      "[RPG COMBAT] Vitals sync warning:",
      error.message
    );
  }
}


// ============================================================
// WIN / LOSS
// ============================================================

async function finishVictory(combat) {
  combat.status = "victory";

  const defeated =
    combat.enemies.filter(
      (enemy) => enemy.hp <= 0
    );

  let coins = 0;
  let xp = 0;

  for (const enemy of defeated) {
    const definition =
      ENEMIES[enemy.id];

    if (!definition) {
      continue;
    }

    coins +=
      Number(
        definition.rewards?.coins || 0
      );

    xp +=
      Number(
        definition.rewards?.xp || 0
      );
  }

  /*
   * Hunt progression remains handled by adventure.js.
   */

  try {
    await registerHuntProgress(
      combat.threadID,
      combat.userID,
      defeated.length
    );
  } catch {
    // Quest system may not yet be initialized.
  }

  combat.metadata.rewards = {
    coins,
    xp,
  };

  addLog(
    combat,
    `🏆 **Victory!**`
  );

  addLog(
    combat,
    `💰 Rewards: ${coins} coins • ⭐ ${xp} XP`
  );

  await syncPlayerVitals(
    combat
  );

  await updateCombatSession(
    combat
  );

  return {
    status: "victory",
    rewards: {
      coins,
      xp,
    },
  };
}

async function finishDefeat(combat) {
  combat.status = "defeat";

  combat.metadata.rewards = {
    coins: 0,
    xp: 0,
  };

  addLog(
    combat,
    `☠️ **You have been defeated.**`
  );

  try {
    await db.query(
      `
      UPDATE rpg_players
      SET
        death_count = COALESCE(death_count, 0) + 1,
        updated_at = NOW()
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        combat.threadID,
        combat.userID,
      ]
    );
  } catch {
    // Optional extended RPG column.
  }

  await syncPlayerVitals(
    combat
  );

  await updateCombatSession(
    combat
  );

  return {
    status: "defeat",
    rewards: {
      coins: 0,
      xp: 0,
    },
  };
}


// ============================================================
// END COMBAT
// ============================================================

async function endCombat(
  combat,
  reason = "ended"
) {
  combat.status =
    reason === "victory"
      ? "victory"
      : reason === "defeat"
        ? "defeat"
        : "ended";

  combat.updatedAt = now();

  await updateCombatSession(
    combat
  );

  activeCombats.delete(
    combatKey(
      combat.threadID,
      combat.userID
    )
  );

  return combat;
}


// ============================================================
// MAIN ACTION ROUTER
// ============================================================

async function combatAction(
  threadID,
  userID,
  action,
  value = null
) {
  const combat =
    await getCombat(
      threadID,
      userID
    );

  if (!combat) {
    return {
      ok: false,
      message:
        "You are not currently in combat. Start a hunt first.",
    };
  }

  if (
    combat.status !== "active"
  ) {
    return {
      ok: false,
      message:
        `This combat has already ended with ${combat.status}.`,
    };
  }

  combat.updatedAt = now();

  // ----------------------------------------------------------
  // Start turn
  // ----------------------------------------------------------

  await startTurn(
    combat
  );

  // ----------------------------------------------------------
  // Player action
  // ----------------------------------------------------------

  let result;

  switch (
    String(action || "")
      .toLowerCase()
  ) {
    case "attack":
      result =
        await playerAttack(
          combat
        );
      break;

    case "defend":
      result =
        await playerDefend(
          combat
        );
      break;

    case "spell":
    case "cast":
      result =
        await playerCastSpell(
          combat,
          value
        );
      break;

    case "special":
      result =
        await playerUseSpecial(
          combat,
          value
        );
      break;

    case "sacrifice":
    case "bloodsacrifice":
      result =
        await bloodSacrifice(
          combat
        );
      break;

    case "escape":
    case "run":
      result =
        await attemptEscape(
          combat
        );
      break;

    default:
      result = {
        ok: false,
        message:
          `Unknown combat action: ${action}`,
      };
      break;
  }

  if (!result.ok) {
    return result;
  }

  // ----------------------------------------------------------
  // Check victory
  // ----------------------------------------------------------

  if (
    getAliveEnemies(combat).length === 0
  ) {
    const victory =
      await finishVictory(
        combat
      );

    return {
      ...result,
      combat,
      ...victory,
    };
  }

  // ----------------------------------------------------------
  // Check defeat
  // ----------------------------------------------------------

  if (
    combat.player.hp <= 0 ||
    !combat.player.alive
  ) {
    const defeat =
      await finishDefeat(
        combat
      );

    return {
      ...result,
      combat,
      ...defeat,
    };
  }

  // ----------------------------------------------------------
  // Enemy turn
  // ----------------------------------------------------------

  await enemyTurn(
    combat
  );

  // ----------------------------------------------------------
  // Check defeat after enemy turn
  // ----------------------------------------------------------

  if (
    combat.player.hp <= 0 ||
    !combat.player.alive
  ) {
    const defeat =
      await finishDefeat(
        combat
      );

    return {
      ...result,
      combat,
      ...defeat,
    };
  }

  // ----------------------------------------------------------
  // Turn end
  // ----------------------------------------------------------

  await endTurn(
    combat
  );

  combat.round += 1;

  await updateCombatSession(
    combat
  );

  return {
    ...result,
    ok: true,
    combat,
    status: combat.status,
  };
}


// ============================================================
// ESCAPE
// ============================================================

async function attemptEscape(combat) {
  let escapeChance =
    BASE_ESCAPE_CHANCE;

  /*
   * Wraith is naturally better at escaping at night.
   */

  if (
    combat.player.classID === "wraith" &&
    getTimeOfDay() === "night"
  ) {
    escapeChance += 0.25;
  }

  /*
   * Shadow affinity is also naturally evasive.
   */

  try {
    const shadow =
      await getPlayerAffinity(
        combat.threadID,
        combat.userID,
        "shadow"
      );

    if (
      shadow &&
      Number(shadow.tier_id || 0) >= 3
    ) {
      escapeChance += 0.10;
    }
  } catch {
    // Optional.
  }

  escapeChance =
    clamp(
      escapeChance,
      0,
      0.90
    );

  if (
    chance(escapeChance)
  ) {
    addLog(
      combat,
      `🌑 You successfully escape from combat.`
    );

    combat.status =
      "escaped";

    await endCombat(
      combat,
      "escaped"
    );

    return {
      ok: true,
      action: "escape",
      escaped: true,
    };
  }

  addLog(
    combat,
    `🏃 You failed to escape!`
  );

  return {
    ok: true,
    action: "escape",
    escaped: false,
  };
}


// ============================================================
// RENDER
// ============================================================

async function renderCombat(
  combat
) {
  if (!combat) {
    return "⚔️ No active combat.";
  }

  const enemy =
    getActiveEnemy(combat);

  const playerHP =
    Math.max(
      0,
      Number(combat.player.hp || 0)
    );

  const playerMaxHP =
    Math.max(
      1,
      Number(combat.player.maxHP || 1)
    );

  const playerMP =
    Math.max(
      0,
      Number(combat.player.mp || 0)
    );

  const playerMaxMP =
    Math.max(
      1,
      Number(combat.player.maxMP || 1)
    );

  const hpPercent =
    Math.floor(
      (playerHP / playerMaxHP) * 100
    );

  const mpPercent =
    Math.floor(
      (playerMP / playerMaxMP) * 100
    );

  let text =
    `╔════════════════════╗\n` +
    `        ⚔️ ECLIPSE COMBAT\n` +
    `╚════════════════════╝\n\n`;

  text +=
    `👤 **${capitalize(
      combat.player.classID
    )}**\n`;

  text +=
    `❤️ HP: ${playerHP}/${playerMaxHP} (${hpPercent}%)\n`;

  text +=
    `💧 MP: ${playerMP}/${playerMaxMP} (${mpPercent}%)\n`;

  text +=
    `🔄 Round: ${combat.round}\n`;

  if (
    combat.regionID
  ) {
    text +=
      `📍 ${combat.regionID}\n`;
  }

  if (
    combat.season
  ) {
    text +=
      `🍂 Season: ${combat.season}\n`;
  }

  if (
    combat.weather
  ) {
    text +=
      `🌦️ Weather: ${combat.weather}\n`;
  }

  if (
    combat.player.shadowBody
  ) {
    text +=
      `🌑 Shadow Body: ${combat.player.shadowBody.hp}/${combat.player.shadowBody.maxHP}\n`;
  }

  text += `\n`;

  if (enemy) {
    const enemyHPPercent =
      Math.floor(
        (
          enemy.hp /
          enemy.maxHP
        ) * 100
      );

    text +=
      `👹 **${enemy.name}**\n`;

    text +=
      `❤️ HP: ${enemy.hp}/${enemy.maxHP} (${enemyHPPercent}%)\n`;

    text +=
      `⚔️ ATK: ${enemy.attack}\n`;

    text +=
      `🛡️ DEF: ${enemy.defense}\n`;

    if (
      enemy.elite
    ) {
      text +=
        `⭐ ELITE\n`;
    }

    if (
      enemy.boss
    ) {
      text +=
        `👑 BOSS\n`;
    }
  } else {
    text +=
      `🏆 **All enemies defeated.**\n`;
  }

  text += `\n`;

  const recentLogs =
    combat.log.slice(-8);

  if (
    recentLogs.length
  ) {
    text +=
      `────── COMBAT LOG ──────\n`;

    for (
      const line of recentLogs
    ) {
      text +=
        `${line}\n`;
    }
  }

  return text;
}


// ============================================================
// UTILITIES
// ============================================================

function capitalize(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .charAt(0)
    .toUpperCase() +
    String(value)
      .slice(1);
}


// ============================================================
// ADMIN / CLEANUP
// ============================================================

async function clearCombat(
  threadID,
  userID
) {
  const key =
    combatKey(
      threadID,
      userID
    );

  const combat =
    activeCombats.get(key);

  if (!combat) {
    return false;
  }

  await endCombat(
    combat,
    "cancelled"
  );

  return true;
}

function getActiveCombatCount() {
  return activeCombats.size;
}

function clearExpiredCombats() {
  for (
    const [
      key,
      combat
    ] of activeCombats.entries()
  ) {
    if (
      isCombatExpired(combat)
    ) {
      activeCombats.delete(key);
    }
  }
}


// ============================================================
// PERIODIC CLEANUP
// ============================================================

const cleanupTimer =
  setInterval(
    clearExpiredCombats,
    5 * 60 * 1000
  );

if (
  cleanupTimer.unref
) {
  cleanupTimer.unref();
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ENEMIES,

  createHunt,
  getCombat,
  combatAction,
  renderCombat,

  playerAttack,
  playerDefend,
  playerCastSpell,
  playerUseSpecial,

  attemptEscape,

  clearCombat,
  getActiveCombatCount,

  getActiveEnemy,
  getAliveEnemies,

  createEnemy,

  calculatePlayerDamage,
  calculateEnemyDamage,

  damagePlayer,
  damageEnemy,

  restoreShadowBody,
};
