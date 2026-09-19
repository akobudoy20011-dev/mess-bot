"use strict";

/**
 * ECLIPSE RPG — SPECIAL MOVES
 * ===========================
 *
 * Special moves are NOT normal spells.
 *
 * They are:
 * - class/affinity signature abilities
 * - powerful and mechanically unique
 * - unlocked through affinity mastery, kingdom quests,
 *   class progression, bosses, or story progression
 * - not reduced by seasonal/weather affinity penalties
 * - subject to their own cooldowns
 *
 * Combat execution is handled by combat.js.
 * This file only defines, validates, unlocks, and describes specials.
 */

const db = require("../db");

// ============================================================
// CONFIG
// ============================================================

const SPECIAL_CATEGORIES = {
  SIGNATURE: "signature",
  MASTERY: "mastery",
  KINGDOM: "kingdom",
  CLASS: "class",
  ULTIMATE: "ultimate",
};

const SPECIAL_REQUIREMENTS = {
  NONE: 0,
  WEAK: 1,
  NORMAL: 2,
  STRONG: 3,
  EXCEPTIONAL: 4,
  MASTERED: 5,
  ASCENDED: 6,
};

// ============================================================
// SPECIAL MOVE DEFINITIONS
// ============================================================

const SPECIALS = {
  // ==========================================================
  // ICE
  // ==========================================================

  heaven_piercing_ice_wall: {
    id: "heaven_piercing_ice_wall",
    name: "Heaven Piercing Ice Wall",
    affinity: "ice",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Raises an immense wall of absolute ice that blocks the next three damage events.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 80,
      stamina: 20,
    },

    cooldown: 8,

    effects: {
      blockDamageEvents: 3,
      enemyDamageMultiplier: 0.5,
      stunEnemyOnUserMove: true,
      seasonDefenseBonus: {
        winter: 1.5,
      },
    },

    flags: {
      ignoresSeasonPenalty: true,
      defensive: true,
      stun: true,
    },
  },

  // ==========================================================
  // FIRE
  // ==========================================================

  scorching_garden: {
    id: "scorching_garden",
    name: "Scorching Garden",
    affinity: "fire",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Transforms the battlefield into a burning garden, damaging every enemy and inflicting Burn.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 75,
      stamina: 15,
    },

    cooldown: 7,

    effects: {
      targets: "all_enemies",
      damageMultiplier: 2.25,

      burn: {
        duration: 3,
        damagePercent: 0.08,
      },

      activeDamageMultiplier: 1.2,

      seasonExtension: {
        summer: 6,
        heat: 6,
      },
    },

    flags: {
      ignoresSeasonPenalty: true,
      aoe: true,
      burn: true,
    },
  },

  // ==========================================================
  // SHADOW
  // ==========================================================

  infinite_darkness: {
    id: "infinite_darkness",
    name: "Infinite Darkness",
    affinity: "shadow",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Consumes the battlefield in living darkness, stunning enemies while allowing the caster to feed upon damage dealt.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 100,
      stamina: 25,
    },

    cooldown: 10,

    effects: {
      duration: 5,

      stunAllEnemies: true,

      enemyDamageMultiplier: 0.8,

      damageToHealing: 0.2,

      shadowBody: {
        enabled: true,
        statMultiplier: 0.5,
        reflectedDamageMultiplier: 1.25,
        deathDisablesShadowSpells: true,
        regainOnDamage: true,
      },
    },

    flags: {
      ignoresSeasonPenalty: true,
      aoe: true,
      control: true,
      lifesteal: true,
      shadowBody: true,
    },
  },

  // ==========================================================
  // LIGHT / DIVINE
  // ==========================================================

  heavenly_judgement: {
    id: "heavenly_judgement",
    name: "Heavenly Judgement",
    affinity: "light",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Calls down a devastating celestial strike upon one enemy and restores the wounds of the caster and allies.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 100,
      stamina: 20,
    },

    cooldown: 9,

    effects: {
      targets: "single_enemy",
      damageMultiplier: 4.5,

      healAlliesLostHpPercent: 0.3,
      healSelfLostHpPercent: 0.3,
    },

    flags: {
      ignoresSeasonPenalty: true,
      massiveSingleTarget: true,
      healing: true,
    },
  },

  amaterasus_blessing: {
    id: "amaterasus_blessing",
    name: "Amaterasu's Blessing",
    affinity: "divine",
    category: SPECIAL_CATEGORIES.KINGDOM,

    description:
      "Invokes the sun itself. At morning, divine daggers rain upon the enemy team or a concentrated solar lance strikes the battlefield.",

    requirements: {
      affinityTier: "exceptional",
      mastery: 1500,
      kingdom: "silver_conclave",
    },

    cost: {
      mp: 110,
      stamina: 20,
    },

    cooldown: 10,

    effects: {
      requiresMorning: true,

      modes: {
        daggers: {
          targets: "all_enemies",
          damageMultiplier: 2.0,
        },

        solar_lance: {
          targets: "all_enemies",
          damageMultiplier: 3.25,
        },
      },

      teamDamageMultiplier: 1.2,
      duration: 5,
    },

    flags: {
      ignoresSeasonPenalty: true,
      morningOnly: true,
      aoe: true,
      teamBuff: true,
    },
  },

  // ==========================================================
  // BLOOD
  // ==========================================================

  crimson_requiem: {
    id: "crimson_requiem",
    name: "Crimson Requiem",
    affinity: "blood",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Sacrifices a portion of the user's life to unleash a devastating blood-forged attack.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 20,
      hpPercent: 0.25,
    },

    cooldown: 7,

    effects: {
      targets: "single_enemy",
      damageMultiplier: 5.0,
      selfDamagePercent: 0.25,
      lifestealPercent: 0.4,
    },

    flags: {
      ignoresSeasonPenalty: true,
      healthSacrifice: true,
      lifesteal: true,
    },
  },

  // ==========================================================
  // NATURE
  // ==========================================================

  worldbloom: {
    id: "worldbloom",
    name: "Worldbloom",
    affinity: "nature",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Forces the battlefield into an accelerated natural cycle, restoring the party and empowering Nature.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 90,
      stamina: 10,
    },

    cooldown: 9,

    effects: {
      healAlliesLostHpPercent: 0.2,
      regenerateMpPercent: 0.15,
      regenerateStaminaPercent: 0.15,

      weatherChange: "rain",
      seasonBonus: {
        spring: 1.3,
      },

      barkSkinTurns: 5,
    },

    flags: {
      ignoresSeasonPenalty: true,
      healing: true,
      weatherControl: true,
    },
  },

  // ==========================================================
  // ARCANE
  // ==========================================================

  arcane_overdrive: {
    id: "arcane_overdrive",
    name: "Arcane Overdrive",
    affinity: "arcane",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Overloads the caster's arcane reservoir, dramatically increasing spell output while temporarily accelerating mana recovery.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 50,
      stamina: 10,
    },

    cooldown: 8,

    effects: {
      spellDamageMultiplier: 1.5,
      manaRegenMultiplier: 2.0,
      duration: 5,
    },

    flags: {
      ignoresSeasonPenalty: true,
      casterBuff: true,
    },
  },

  // ==========================================================
  // NECROMANCY
  // ==========================================================

  army_of_the_fallen: {
    id: "army_of_the_fallen",
    name: "Army of the Fallen",
    affinity: "necromancy",
    category: SPECIAL_CATEGORIES.KINGDOM,

    description:
      "Raises fallen spirits to fight alongside the caster for a limited number of turns.",

    requirements: {
      affinityTier: "ascended",
      mastery: 6000,
      kingdom: "hollow_covenant",
    },

    cost: {
      mp: 130,
      stamina: 25,
    },

    cooldown: 12,

    effects: {
      summonCount: 3,
      summonDuration: 5,
      summonStatMultiplier: 0.45,
    },

    flags: {
      ignoresSeasonPenalty: true,
      summon: true,
    },
  },

  // ==========================================================
  // LIGHTNING
  // ==========================================================

  heavens_thunder: {
    id: "heavens_thunder",
    name: "Heaven's Thunder",
    affinity: "lightning",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Calls down a chain of divine lightning across the enemy formation.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 95,
      stamina: 15,
    },

    cooldown: 8,

    effects: {
      targets: "all_enemies",
      damageMultiplier: 2.75,
      stunChance: 0.35,
      stormMultiplier: 1.25,
    },

    flags: {
      ignoresSeasonPenalty: true,
      aoe: true,
      stun: true,
    },
  },

  // ==========================================================
  // WATER
  // ==========================================================

  abyssal_tide: {
    id: "abyssal_tide",
    name: "Abyssal Tide",
    affinity: "water",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Summons a crushing tidal wave that damages enemies and restores part of the party's health.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 90,
      stamina: 15,
    },

    cooldown: 8,

    effects: {
      targets: "all_enemies",
      damageMultiplier: 2.5,
      healAlliesLostHpPercent: 0.15,
      rainMultiplier: 1.25,
    },

    flags: {
      ignoresSeasonPenalty: true,
      aoe: true,
      healing: true,
    },
  },

  // ==========================================================
  // WIND
  // ==========================================================

  celestial_tempest: {
    id: "celestial_tempest",
    name: "Celestial Tempest",
    affinity: "wind",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Creates a violent aerial storm that repeatedly strikes every enemy.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 85,
      stamina: 15,
    },

    cooldown: 8,

    effects: {
      targets: "all_enemies",
      hits: 3,
      damageMultiplierPerHit: 1.0,
      dodgeBonus: 0.15,
    },

    flags: {
      ignoresSeasonPenalty: true,
      aoe: true,
      multiHit: true,
    },
  },

  // ==========================================================
  // EARTH
  // ==========================================================

  worldbreaker: {
    id: "worldbreaker",
    name: "Worldbreaker",
    affinity: "earth",
    category: SPECIAL_CATEGORIES.MASTERY,

    description:
      "Splits the battlefield beneath the enemy, dealing massive damage and temporarily reducing their defense.",

    requirements: {
      affinityTier: "mastered",
      mastery: 3000,
    },

    cost: {
      mp: 85,
      stamina: 25,
    },

    cooldown: 9,

    effects: {
      targets: "all_enemies",
      damageMultiplier: 3.0,
      defenseReduction: 0.25,
      defenseReductionDuration: 4,
    },

    flags: {
      ignoresSeasonPenalty: true,
      aoe: true,
      defenseBreak: true,
    },
  },
};

// ============================================================
// LOOKUPS
// ============================================================

function normalizeSpecialId(value) {
  if (!value) return null;

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getSpecial(id) {
  const key = normalizeSpecialId(id);
  return key ? SPECIALS[key] || null : null;
}

function getAllSpecials() {
  return Object.values(SPECIALS);
}

function getSpecialsByAffinity(affinity) {
  const key = String(affinity || "").trim().toLowerCase();

  return Object.values(SPECIALS).filter(
    (special) => special.affinity === key
  );
}

function getSpecialsByCategory(category) {
  return Object.values(SPECIALS).filter(
    (special) => special.category === category
  );
}

// ============================================================
// PLAYER SPECIALS
// ============================================================

async function getPlayerSpecials(threadID, userID) {
  const result = await db.query(
    `
      SELECT
        special_id,
        mastery,
        unlocked_at,
        source
      FROM rpg_player_special_moves
      WHERE thread_id = $1
        AND user_id = $2
      ORDER BY unlocked_at ASC
    `,
    [String(threadID), String(userID)]
  );

  return result.rows;
}

async function hasSpecial(threadID, userID, specialID) {
  const key = normalizeSpecialId(specialID);

  if (!key) return false;

  const result = await db.query(
    `
      SELECT 1
      FROM rpg_player_special_moves
      WHERE thread_id = $1
        AND user_id = $2
        AND special_id = $3
      LIMIT 1
    `,
    [String(threadID), String(userID), key]
  );

  return result.rowCount > 0;
}

// ============================================================
// REQUIREMENT CHECKING
// ============================================================

async function checkSpecialRequirements(threadID, userID, special) {
  if (!special) {
    return {
      ok: false,
      reason: "Special move does not exist.",
    };
  }

  const {
    getPlayerAffinity,
    getTierByKey,
  } = require("./affinities");

  const affinity = await getPlayerAffinity(
    threadID,
    userID,
    special.affinity
  );

  if (!affinity) {
    return {
      ok: false,
      reason: `You have not unlocked the ${special.affinity} affinity.`,
    };
  }

  const requiredTier = special.requirements?.affinityTier;

  if (requiredTier) {
    const requiredTierData = getTierByKey(requiredTier);

    if (
      !requiredTierData ||
      Number(affinity.tier_id || 0) < Number(requiredTierData.id)
    ) {
      return {
        ok: false,
        reason:
          `Requires ${special.affinity} affinity at ` +
          `${requiredTierData?.name || requiredTier}.`,
      };
    }
  }

  if (
    special.requirements?.mastery &&
    Number(affinity.mastery || 0) < Number(special.requirements.mastery)
  ) {
    return {
      ok: false,
      reason:
        `Requires ${Number(special.requirements.mastery).toLocaleString()} ` +
        `${special.affinity} mastery.`,
    };
  }

  if (special.requirements?.kingdom) {
    const player = await db.query(
      `
        SELECT kingdom_id, traitor, traitor_kingdom_id
        FROM rpg_players
        WHERE thread_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [String(threadID), String(userID)]
    );

    const row = player.rows[0];

    if (!row) {
      return {
        ok: false,
        reason: "RPG player could not be found.",
      };
    }

    if (row.traitor && row.traitor_kingdom_id === special.requirements.kingdom) {
      return {
        ok: false,
        reason:
          "Your betrayal prevents you from receiving this kingdom's special move.",
      };
    }

    if (row.kingdom_id !== special.requirements.kingdom) {
      return {
        ok: false,
        reason:
          `Requires allegiance to ${special.requirements.kingdom}.`,
      };
    }
  }

  return {
    ok: true,
  };
}

// ============================================================
// UNLOCK
// ============================================================

async function unlockSpecial(
  threadID,
  userID,
  specialID,
  source = "system"
) {
  const special = getSpecial(specialID);

  if (!special) {
    throw new Error(`Unknown special move: ${specialID}`);
  }

  const alreadyUnlocked = await hasSpecial(
    threadID,
    userID,
    special.id
  );

  if (alreadyUnlocked) {
    return {
      ok: true,
      alreadyUnlocked: true,
      special,
    };
  }

  const requirementCheck = await checkSpecialRequirements(
    threadID,
    userID,
    special
  );

  if (!requirementCheck.ok) {
    return {
      ok: false,
      reason: requirementCheck.reason,
      special,
    };
  }

  await db.query(
    `
      INSERT INTO rpg_player_special_moves (
        thread_id,
        user_id,
        special_id,
        mastery,
        source,
        unlocked_at
      )
      VALUES ($1, $2, $3, 0, $4, NOW())
      ON CONFLICT (thread_id, user_id, special_id)
      DO NOTHING
    `,
    [
      String(threadID),
      String(userID),
      special.id,
      String(source),
    ]
  );

  return {
    ok: true,
    unlocked: true,
    special,
  };
}

// ============================================================
// MASTERY
// ============================================================

async function addSpecialMastery(
  threadID,
  userID,
  specialID,
  amount
) {
  const special = getSpecial(specialID);

  if (!special) {
    throw new Error(`Unknown special move: ${specialID}`);
  }

  const unlocked = await hasSpecial(
    threadID,
    userID,
    special.id
  );

  if (!unlocked) {
    return {
      ok: false,
      reason: "Special move has not been unlocked.",
    };
  }

  const value = Math.max(0, Number(amount) || 0);

  const result = await db.query(
    `
      UPDATE rpg_player_special_moves
      SET mastery = mastery + $4
      WHERE thread_id = $1
        AND user_id = $2
        AND special_id = $3
      RETURNING *
    `,
    [
      String(threadID),
      String(userID),
      special.id,
      value,
    ]
  );

  return {
    ok: true,
    special,
    record: result.rows[0] || null,
  };
}

// ============================================================
// CAST VALIDATION
// ============================================================

async function canUseSpecial(
  threadID,
  userID,
  specialID,
  context = {}
) {
  const special = getSpecial(specialID);

  if (!special) {
    return {
      ok: false,
      reason: "Special move does not exist.",
    };
  }

  const unlocked = await hasSpecial(
    threadID,
    userID,
    special.id
  );

  if (!unlocked) {
    return {
      ok: false,
      reason: `You have not unlocked ${special.name}.`,
    };
  }

  const playerResult = await db.query(
    `
      SELECT
        hp,
        max_hp,
        mp,
        max_mp,
        stamina,
        max_stamina
      FROM rpg_players
      WHERE thread_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [String(threadID), String(userID)]
  );

  const player = playerResult.rows[0];

  if (!player) {
    return {
      ok: false,
      reason: "RPG player could not be found.",
    };
  }

  const mpCost = Number(special.cost?.mp || 0);
  const staminaCost = Number(special.cost?.stamina || 0);

  if (Number(player.mp || 0) < mpCost) {
    return {
      ok: false,
      reason: `Not enough MP. Requires ${mpCost} MP.`,
    };
  }

  if (Number(player.stamina || 0) < staminaCost) {
    return {
      ok: false,
      reason: `Not enough stamina. Requires ${staminaCost} stamina.`,
    };
  }

  if (
    special.cost?.hpPercent &&
    Number(player.hp || 0) <= 1
  ) {
    return {
      ok: false,
      reason: "You do not have enough HP to sacrifice.",
    };
  }

  if (
    special.effects?.requiresMorning &&
    context.isMorning !== true
  ) {
    return {
      ok: false,
      reason: "This special can only be used in the morning.",
    };
  }

  return {
    ok: true,
    special,
    player,
  };
}

// ============================================================
// DISPLAY
// ============================================================

function formatSpecial(special) {
  if (!special) return "Unknown special.";

  const requirement = special.requirements || {};
  const cost = special.cost || {};

  const lines = [
    `✦ ${special.name}`,
    `Affinity: ${special.affinity}`,
    `Category: ${special.category}`,
    "",
    special.description,
    "",
    `MP: ${Number(cost.mp || 0)}`,
    `Stamina: ${Number(cost.stamina || 0)}`,
    `Cooldown: ${Number(special.cooldown || 0)} turns`,
  ];

  if (cost.hpPercent) {
    lines.push(
      `HP Sacrifice: ${Math.round(cost.hpPercent * 100)}%`
    );
  }

  if (requirement.affinityTier) {
    lines.push(
      `Required Affinity: ${requirement.affinityTier}`
    );
  }

  if (requirement.mastery) {
    lines.push(
      `Required Mastery: ${Number(
        requirement.mastery
      ).toLocaleString()}`
    );
  }

  if (requirement.kingdom) {
    lines.push(`Kingdom: ${requirement.kingdom}`);
  }

  return lines.join("\n");
}

function formatSpecialList(specials) {
  if (!specials.length) {
    return "No special moves found.";
  }

  return specials
    .map(
      (special, index) =>
        `${index + 1}. ${special.name} — ${special.affinity} [${special.category}]`
    )
    .join("\n");
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  SPECIAL_CATEGORIES,
  SPECIAL_REQUIREMENTS,

  SPECIALS,

  normalizeSpecialId,

  getSpecial,
  getAllSpecials,
  getSpecialsByAffinity,
  getSpecialsByCategory,

  getPlayerSpecials,
  hasSpecial,

  checkSpecialRequirements,
  unlockSpecial,

  addSpecialMastery,

  canUseSpecial,

  formatSpecial,
  formatSpecialList,
};
