"use strict";

/**
 * ECLIPSE RPG — KINGDOM QUEST & AFFINITY PROGRESSION
 * ==================================================
 *
 * Handles:
 * - Kingdom definitions
 * - Kingdom affinity domains
 * - Kingdom quest definitions
 * - Kingdom reputation
 * - Kingdom quest progress
 * - Kingdom quest claiming
 * - Kingdom reward distribution
 * - Affinity mastery rewards
 * - Spell rewards
 * - Special-move rewards
 * - Traitor / kingdom allegiance state
 *
 * IMPORTANT:
 * - RPG timestamps are stored as BIGINT epoch milliseconds.
 * - Kingdom quest records live in rpg_kingdom_quest_records.
 * - This module is intentionally self-contained.
 */

const db = require("../db");

const {
  getAffinity,
  getPlayerAffinity,
  unlockAffinity,
  addAffinityMastery,
} = require("./affinities");

const {
  getSpell,
  hasSpell,
  learnSpell,
} = require("./spells");

const {
  getSpecial,
  hasSpecial,
  unlockSpecial,
} = require("./specials");

// ============================================================
// KINGDOMS
// ============================================================

const KINGDOMS = {
  ashen_dominion: {
    id: "ashen_dominion",
    name: "Ashen Dominion",
    title: "The Ashen Dominion",
    description:
      "A warbound kingdom forged through flame, blood, conquest, and relentless ambition.",
    affinities: ["fire", "blood"],
    color: "#8B1E24",
  },

  silver_conclave: {
    id: "silver_conclave",
    name: "Silver Conclave",
    title: "The Silver Conclave",
    description:
      "A scholarly and celestial kingdom devoted to arcane knowledge, divine power, and disciplined magic.",
    affinities: ["arcane", "light", "divine", "lightning"],
    color: "#A9B7C6",
  },

  ironspine_hold: {
    id: "ironspine_hold",
    name: "Ironspine Hold",
    title: "Ironspine Hold",
    description:
      "A hardened mountain kingdom built around endurance, stone, ice, and unbreakable defense.",
    affinities: ["earth", "ice"],
    color: "#66717A",
  },

  hollow_covenant: {
    id: "hollow_covenant",
    name: "Hollow Covenant",
    title: "The Hollow Covenant",
    description:
      "A secretive kingdom of shadow, death, forbidden rites, and powers drawn from the abyss.",
    affinities: ["shadow", "necromancy"],
    color: "#352D46",
  },
};

// ============================================================
// AFFINITY DOMAINS
// ============================================================

const AFFINITY_DOMAINS = {
  fire: {
    affinity: "fire",
    kingdom: "ashen_dominion",
  },

  blood: {
    affinity: "blood",
    kingdom: "ashen_dominion",
  },

  arcane: {
    affinity: "arcane",
    kingdom: "silver_conclave",
  },

  light: {
    affinity: "light",
    kingdom: "silver_conclave",
  },

  divine: {
    affinity: "divine",
    kingdom: "silver_conclave",
  },

  lightning: {
    affinity: "lightning",
    kingdom: "silver_conclave",
  },

  earth: {
    affinity: "earth",
    kingdom: "ironspine_hold",
  },

  ice: {
    affinity: "ice",
    kingdom: "ironspine_hold",
  },

  shadow: {
    affinity: "shadow",
    kingdom: "hollow_covenant",
  },

  necromancy: {
    affinity: "necromancy",
    kingdom: "hollow_covenant",
  },

  nature: {
    affinity: "nature",
    kingdom: null,
  },

  water: {
    affinity: "water",
    kingdom: null,
  },

  wind: {
    affinity: "wind",
    kingdom: null,
  },
};

// ============================================================
// KINGDOM QUESTS
// ============================================================

const KINGDOM_QUESTS = {
  // ==========================================================
  // ASHEN DOMINION
  // ==========================================================

  ash_first_flame: {
    id: "ash_first_flame",
    kingdomId: "ashen_dominion",
    name: "First Flame",
    description:
      "Prove yourself to the Ashen Dominion by hunting enemies in the wilds.",
    objectiveType: "hunt",
    objectiveAmount: 5,
    requiredReputation: 0,

    rewards: {
      coins: 500,
      xp: 300,
      reputation: 75,
      affinity: {
        id: "fire",
        mastery: 100,
      },
    },
  },

  ash_warpath: {
    id: "ash_warpath",
    kingdomId: "ashen_dominion",
    name: "The Warpath",
    description:
      "Walk the path of conquest and prove that your allegiance to the Ashen Dominion is genuine.",
    objectiveType: "hunt",
    objectiveAmount: 15,
    requiredReputation: 75,

    rewards: {
      coins: 1000,
      xp: 650,
      reputation: 125,
      affinity: {
        id: "fire",
        mastery: 250,
      },
      spell: "flame_burst",
    },
  },

  ash_blood_oath: {
    id: "ash_blood_oath",
    kingdomId: "ashen_dominion",
    name: "Blood Oath",
    description:
      "Defeat a powerful boss and bind yourself to the Ashen Dominion through blood.",
    objectiveType: "boss",
    objectiveAmount: 1,
    requiredReputation: 200,

    rewards: {
      coins: 2500,
      xp: 1200,
      reputation: 250,
      affinity: {
        id: "blood",
        mastery: 500,
      },
      special: "crimson_requiem",
    },
  },

  // ==========================================================
  // SILVER CONCLAVE
  // ==========================================================

  silver_first_lesson: {
    id: "silver_first_lesson",
    kingdomId: "silver_conclave",
    name: "The First Lesson",
    description:
      "Begin your studies with the Silver Conclave by proving yourself against hostile creatures.",
    objectiveType: "hunt",
    objectiveAmount: 5,
    requiredReputation: 0,

    rewards: {
      coins: 500,
      xp: 350,
      reputation: 75,
      affinity: {
        id: "arcane",
        mastery: 100,
      },
    },
  },

  silver_arcane_trial: {
    id: "silver_arcane_trial",
    kingdomId: "silver_conclave",
    name: "Arcane Trial",
    description:
      "Enter a dungeon and survive its dangers to demonstrate your magical potential.",
    objectiveType: "dungeon",
    objectiveAmount: 1,
    requiredReputation: 75,

    rewards: {
      coins: 1200,
      xp: 700,
      reputation: 150,
      affinity: {
        id: "arcane",
        mastery: 300,
      },
      spell: "arcane_blast",
    },
  },

  silver_celestial_trial: {
    id: "silver_celestial_trial",
    kingdomId: "silver_conclave",
    name: "Celestial Trial",
    description:
      "Defeat a boss worthy of the Silver Conclave and prove your command over celestial power.",
    objectiveType: "boss",
    objectiveAmount: 1,
    requiredReputation: 250,

    rewards: {
      coins: 3000,
      xp: 1500,
      reputation: 300,
      affinity: {
        id: "divine",
        mastery: 500,
      },
      special: "heavenly_judgement",
    },
  },

  // ==========================================================
  // IRONSPINE HOLD
  // ==========================================================

  iron_first_fortification: {
    id: "iron_first_fortification",
    kingdomId: "ironspine_hold",
    name: "First Fortification",
    description:
      "Prove your endurance by hunting threats around the Ironspine frontier.",
    objectiveType: "hunt",
    objectiveAmount: 5,
    requiredReputation: 0,

    rewards: {
      coins: 500,
      xp: 300,
      reputation: 75,
      affinity: {
        id: "earth",
        mastery: 100,
      },
    },
  },

  iron_mountain_trial: {
    id: "iron_mountain_trial",
    kingdomId: "ironspine_hold",
    name: "Mountain Trial",
    description:
      "Explore the mountains and endure their unforgiving terrain.",
    objectiveType: "explore",
    objectiveAmount: 3,
    requiredReputation: 75,

    rewards: {
      coins: 1100,
      xp: 650,
      reputation: 150,
      affinity: {
        id: "earth",
        mastery: 300,
      },
      spell: "stone_wall",
    },
  },

  iron_frozen_frontier: {
    id: "iron_frozen_frontier",
    kingdomId: "ironspine_hold",
    name: "Frozen Frontier",
    description:
      "Push deep into the frozen frontier and prove that you can withstand the cold.",
    objectiveType: "explore",
    objectiveAmount: 5,
    requiredReputation: 250,

    rewards: {
      coins: 2800,
      xp: 1400,
      reputation: 275,
      affinity: {
        id: "ice",
        mastery: 500,
      },
      special: "heaven_piercing_ice_wall",
    },
  },

  // ==========================================================
  // HOLLOW COVENANT
  // ==========================================================

  hollow_first_shadow: {
    id: "hollow_first_shadow",
    kingdomId: "hollow_covenant",
    name: "First Shadow",
    description:
      "Enter the path of the Hollow Covenant by hunting beneath the veil of darkness.",
    objectiveType: "hunt",
    objectiveAmount: 5,
    requiredReputation: 0,

    rewards: {
      coins: 500,
      xp: 350,
      reputation: 75,
      affinity: {
        id: "shadow",
        mastery: 100,
      },
    },
  },

  hollow_crypt: {
    id: "hollow_crypt",
    kingdomId: "hollow_covenant",
    name: "The Crypt",
    description:
      "Descend into an ancient crypt and survive what waits beneath it.",
    objectiveType: "dungeon",
    objectiveAmount: 1,
    requiredReputation: 75,

    rewards: {
      coins: 1300,
      xp: 750,
      reputation: 175,
      affinity: {
        id: "necromancy",
        mastery: 300,
      },
      spell: "corpse_bloom",
    },
  },

  hollow_abyssal_oath: {
    id: "hollow_abyssal_oath",
    kingdomId: "hollow_covenant",
    name: "Abyssal Oath",
    description:
      "Defeat a powerful boss and swear yourself to the deepest shadows.",
    objectiveType: "boss",
    objectiveAmount: 1,
    requiredReputation: 275,

    rewards: {
      coins: 3200,
      xp: 1600,
      reputation: 350,
      affinity: {
        id: "shadow",
        mastery: 600,
      },
      special: "infinite_darkness",
    },
  },
};

// ============================================================
// KINGDOM HELPERS
// ============================================================

function getKingdom(kingdomId) {
  if (!kingdomId) return null;
  return KINGDOMS[String(kingdomId)] || null;
}

function getAllKingdoms() {
  return Object.values(KINGDOMS);
}

function getAffinityDomain(affinityId) {
  if (!affinityId) return null;

  const key = String(affinityId).toLowerCase();
  return AFFINITY_DOMAINS[key] || null;
}

function getKingdomForAffinity(affinityId) {
  const domain = getAffinityDomain(affinityId);
  return domain ? getKingdom(domain.kingdom) : null;
}

function getKingdomQuests(kingdomId) {
  return Object.values(KINGDOM_QUESTS).filter(
    (quest) => quest.kingdomId === kingdomId
  );
}

function getKingdomQuest(questId) {
  if (!questId) return null;
  return KINGDOM_QUESTS[String(questId)] || null;
}

// ============================================================
// PLAYER KINGDOM STATE
// ============================================================

async function getPlayerKingdom(threadID, userID) {
  const result = await db.query(
    `
      SELECT
        kingdom_id,
        kingdom_role,
        traitor,
        traitor_kingdom_id,
        reputation
      FROM rpg_players
      WHERE thread_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [String(threadID), String(userID)]
  );

  if (!result.rows.length) {
    return {
      kingdomId: null,
      kingdomRole: null,
      traitor: false,
      traitorKingdomId: null,
      reputation: 0,
    };
  }

  const row = result.rows[0];

  return {
    kingdomId: row.kingdom_id || null,
    kingdomRole: row.kingdom_role || null,
    traitor: Boolean(row.traitor),
    traitorKingdomId: row.traitor_kingdom_id || null,
    reputation: Number(row.reputation || 0),
  };
}

// ============================================================
// KINGDOM REPUTATION
// ============================================================

async function getKingdomReputation(threadID, userID, kingdomId) {
  const result = await db.query(
    `
      SELECT reputation
      FROM rpg_kingdom_reputation
      WHERE thread_id = $1
        AND user_id = $2
        AND kingdom_id = $3
      LIMIT 1
    `,
    [
      String(threadID),
      String(userID),
      String(kingdomId),
    ]
  );

  if (!result.rows.length) return 0;

  return Number(result.rows[0].reputation || 0);
}

async function addKingdomReputation(
  threadID,
  userID,
  kingdomId,
  amount
) {
  const kingdom = getKingdom(kingdomId);

  if (!kingdom) {
    throw new Error(`Unknown kingdom: ${kingdomId}`);
  }

  const value = Number(amount || 0);

  if (!Number.isFinite(value) || value === 0) {
    return getKingdomReputation(threadID, userID, kingdomId);
  }

  const timestamp = Date.now();

  const result = await db.query(
    `
      INSERT INTO rpg_kingdom_reputation (
        thread_id,
        user_id,
        kingdom_id,
        reputation,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (thread_id, user_id, kingdom_id)
      DO UPDATE SET
        reputation =
          rpg_kingdom_reputation.reputation + EXCLUDED.reputation,
        updated_at = $5
      RETURNING reputation
    `,
    [
      String(threadID),
      String(userID),
      String(kingdomId),
      value,
      timestamp,
    ]
  );

  return Number(result.rows[0]?.reputation || 0);
}

// ============================================================
// KINGDOM QUEST RECORDS
// ============================================================

async function getQuestRecord(threadID, userID, questId) {
  const result = await db.query(
    `
      SELECT *
      FROM rpg_kingdom_quest_records
      WHERE thread_id = $1
        AND user_id = $2
        AND quest_id = $3
      LIMIT 1
    `,
    [
      String(threadID),
      String(userID),
      String(questId),
    ]
  );

  return result.rows[0] || null;
}

async function ensureQuestRecord(threadID, userID, quest) {
  if (!quest) {
    throw new Error("Quest definition is required.");
  }

  const existing = await getQuestRecord(
    threadID,
    userID,
    quest.id
  );

  if (existing) {
    return existing;
  }

  const timestamp = Date.now();

  const result = await db.query(
    `
      INSERT INTO rpg_kingdom_quest_records (
        thread_id,
        user_id,
        quest_id,
        quest_type,
        kingdom_id,
        objective_type,
        objective_amount,
        objective_progress,
        reward_coins,
        reward_reputation,
        reward_affinity_mastery,
        completed,
        claimed,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'kingdom',
        $4,
        $5,
        $6,
        0,
        $7,
        $8,
        $9,
        FALSE,
        FALSE,
        $10,
        $10
      )
      ON CONFLICT (thread_id, user_id, quest_id)
      DO UPDATE SET
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `,
    [
      String(threadID),
      String(userID),
      String(quest.id),
      String(quest.kingdomId),
      String(quest.objectiveType),
      Number(quest.objectiveAmount || 0),
      Number(quest.rewards?.coins || 0),
      Number(quest.rewards?.reputation || 0),
      Number(quest.rewards?.affinity?.mastery || 0),
      timestamp,
    ]
  );

  return result.rows[0];
}

// ============================================================
// QUEST REQUIREMENTS
// ============================================================

async function checkQuestRequirements(
  threadID,
  userID,
  quest
) {
  if (!quest) {
    return {
      ok: false,
      reason: "Quest not found.",
    };
  }

  const player = await getPlayerKingdom(
    threadID,
    userID
  );

  if (!player.kingdomId) {
    return {
      ok: false,
      reason: `You are not pledged to ${getKingdom(quest.kingdomId)?.name || "this kingdom"}.`,
    };
  }

  if (player.kingdomId !== quest.kingdomId) {
    return {
      ok: false,
      reason: `This quest belongs to ${getKingdom(quest.kingdomId)?.name || quest.kingdomId}.`,
    };
  }

  if (
    player.traitor &&
    player.traitorKingdomId &&
    player.traitorKingdomId !== quest.kingdomId
  ) {
    return {
      ok: false,
      reason:
        "Your traitor status prevents you from progressing this kingdom quest.",
    };
  }

  const reputation = await getKingdomReputation(
    threadID,
    userID,
    quest.kingdomId
  );

  const required = Number(
    quest.requiredReputation || 0
  );

  if (reputation < required) {
    return {
      ok: false,
      reason: `You need ${required} kingdom reputation. Current reputation: ${reputation}.`,
      reputation,
      requiredReputation: required,
    };
  }

  return {
    ok: true,
    reputation,
  };
}

// ============================================================
// START KINGDOM QUEST
// ============================================================

async function startKingdomQuest(
  threadID,
  userID,
  questId
) {
  const quest = getKingdomQuest(questId);

  if (!quest) {
    return {
      success: false,
      reason: "Kingdom quest not found.",
    };
  }

  const requirements = await checkQuestRequirements(
    threadID,
    userID,
    quest
  );

  if (!requirements.ok) {
    return {
      success: false,
      reason: requirements.reason,
    };
  }

  const record = await ensureQuestRecord(
    threadID,
    userID,
    quest
  );

  if (record.claimed) {
    return {
      success: false,
      reason: "This quest has already been claimed.",
      quest,
      record,
    };
  }

  return {
    success: true,
    quest,
    record,
  };
}

// ============================================================
// QUEST PROGRESS
// ============================================================

async function progressKingdomQuest(
  threadID,
  userID,
  objectiveType,
  amount = 1
) {
  const player = await getPlayerKingdom(
    threadID,
    userID
  );

  if (!player.kingdomId) {
    return [];
  }

  const increment = Math.max(
    1,
    Number(amount || 1)
  );

  const quests = getKingdomQuests(
    player.kingdomId
  );

  const updated = [];

  for (const quest of quests) {
    if (quest.objectiveType !== objectiveType) {
      continue;
    }

    const requirements =
      await checkQuestRequirements(
        threadID,
        userID,
        quest
      );

    if (!requirements.ok) {
      continue;
    }

    const record = await ensureQuestRecord(
      threadID,
      userID,
      quest
    );

    if (record.claimed || record.completed) {
      continue;
    }

    const current = Number(
      record.objective_progress || 0
    );

    const target = Number(
      quest.objectiveAmount || 0
    );

    const nextProgress = Math.min(
      target,
      current + increment
    );

    const completed =
      nextProgress >= target;

    const timestamp = Date.now();

    const result = await db.query(
      `
        UPDATE rpg_kingdom_quest_records
        SET
          objective_progress = $4,
          completed = $5,
          updated_at = $6
        WHERE thread_id = $1
          AND user_id = $2
          AND quest_id = $3
        RETURNING *
      `,
      [
        String(threadID),
        String(userID),
        String(quest.id),
        nextProgress,
        completed,
        timestamp,
      ]
    );

    if (result.rows[0]) {
      updated.push({
        quest,
        record: result.rows[0],
      });
    }
  }

  return updated;
}

// ============================================================
// REWARD HELPERS
// ============================================================

async function awardCoins(
  threadID,
  userID,
  amount
) {
  const value = Number(amount || 0);

  if (value <= 0) {
    return {
      success: true,
      amount: 0,
    };
  }

  await db.addBalance(
    String(threadID),
    String(userID),
    value
  );

  return {
    success: true,
    amount: value,
  };
}

async function awardXP(
  threadID,
  userID,
  amount
) {
  const value = Number(amount || 0);

  if (value <= 0) {
    return {
      success: true,
      amount: 0,
    };
  }

  await db.addXP(
    String(threadID),
    String(userID),
    value
  );

  return {
    success: true,
    amount: value,
  };
}

async function awardAffinityMastery(
  threadID,
  userID,
  affinityId,
  mastery
) {
  if (!affinityId) {
    return {
      success: true,
      affinity: null,
      mastery: 0,
    };
  }

  const affinity = getAffinity(
    affinityId
  );

  if (!affinity) {
    throw new Error(
      `Unknown affinity reward: ${affinityId}`
    );
  }

  let playerAffinity =
    await getPlayerAffinity(
      threadID,
      userID,
      affinityId
    );

  if (!playerAffinity) {
    playerAffinity = await unlockAffinity(
      threadID,
      userID,
      affinityId,
      {
        source: "kingdom_quest",
      }
    );
  }

  const value = Number(mastery || 0);

  if (value > 0) {
    await addAffinityMastery(
      threadID,
      userID,
      affinityId,
      value
    );
  }

  return {
    success: true,
    affinity: affinityId,
    mastery: value,
    playerAffinity,
  };
}

// ============================================================
// SPELL REWARD
// ============================================================

async function awardSpell(
  threadID,
  userID,
  spellId
) {
  if (!spellId) {
    return {
      success: true,
      spell: null,
      alreadyKnown: false,
    };
  }

  const spell = getSpell(spellId);

  if (!spell) {
    throw new Error(
      `Unknown spell reward: ${spellId}`
    );
  }

  const alreadyKnown = await hasSpell(
    threadID,
    userID,
    spellId
  );

  if (alreadyKnown) {
    return {
      success: true,
      spell,
      alreadyKnown: true,
    };
  }

  let result;

  try {
    result = await learnSpell(
      threadID,
      userID,
      spellId,
      {
        source: "kingdom_quest",
        requireKingdom: false,
      }
    );
  } catch (error) {
    console.error(
      `[RPG KINGDOM QUEST] learnSpell failed for ${spellId}:`,
      error
    );

    result = null;
  }

  if (
    result &&
    result.success !== false
  ) {
    return {
      ...result,
      success: true,
      spell,
      alreadyKnown: false,
    };
  }

  /*
   * Kingdom quests are authoritative reward sources.
   *
   * If the normal spell-learning path rejects the reward for
   * a requirement that should not apply to a kingdom reward,
   * perform a defensive direct grant.
   */
  try {
    const timestamp = Date.now();

    await db.query(
      `
        INSERT INTO rpg_player_spells (
          thread_id,
          user_id,
          spell_id,
          mastery,
          source,
          learned_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          0,
          'kingdom_quest',
          $4,
          $4
        )
        ON CONFLICT (
          thread_id,
          user_id,
          spell_id
        )
        DO NOTHING
      `,
      [
        String(threadID),
        String(userID),
        String(spellId),
        timestamp,
      ]
    );

    return {
      success: true,
      spell,
      alreadyKnown: false,
      fallbackGrant: true,
    };
  } catch (error) {
    console.error(
      `[RPG KINGDOM QUEST] Direct spell reward failed for ${spellId}:`,
      error
    );

    return {
      success: false,
      spell,
      reason: "Spell reward could not be granted.",
    };
  }
}

// ============================================================
// SPECIAL REWARD
// ============================================================

async function awardSpecial(
  threadID,
  userID,
  specialId
) {
  if (!specialId) {
    return {
      success: true,
      special: null,
      alreadyKnown: false,
    };
  }

  const special = getSpecial(
    specialId
  );

  if (!special) {
    throw new Error(
      `Unknown special reward: ${specialId}`
    );
  }

  const alreadyKnown =
    await hasSpecial(
      threadID,
      userID,
      specialId
    );

  if (alreadyKnown) {
    return {
      success: true,
      special,
      alreadyKnown: true,
    };
  }

  const result = await unlockSpecial(
    threadID,
    userID,
    specialId,
    {
      source: "kingdom_quest",
      bypassRequirements: true,
    }
  );

  if (
    result === false ||
    (result &&
      typeof result === "object" &&
      result.success === false)
  ) {
    return {
      success: false,
      special,
      reason:
        result?.reason ||
        "Special reward could not be unlocked.",
    };
  }

  if (
    result &&
    typeof result === "object"
  ) {
    return {
      ...result,
      success: true,
      special,
      alreadyKnown: false,
    };
  }

  return {
    success: true,
    special,
    alreadyKnown: false,
  };
}

// ============================================================
// CLAIM KINGDOM QUEST
// ============================================================

async function claimKingdomQuest(
  threadID,
  userID,
  questId
) {
  const quest = getKingdomQuest(
    questId
  );

  if (!quest) {
    return {
      success: false,
      reason: "Kingdom quest not found.",
    };
  }

  /*
   * Preflight reward definitions before locking the quest.
   * This prevents a malformed reward from consuming the quest.
   */
  if (quest.rewards?.affinity?.id) {
    const affinity = getAffinity(
      quest.rewards.affinity.id
    );

    if (!affinity) {
      return {
        success: false,
        reason:
          "This quest has an invalid affinity reward.",
      };
    }
  }

  if (quest.rewards?.spell) {
    const spell = getSpell(
      quest.rewards.spell
    );

    if (!spell) {
      return {
        success: false,
        reason:
          "This quest has an invalid spell reward.",
      };
    }
  }

  if (quest.rewards?.special) {
    const special = getSpecial(
      quest.rewards.special
    );

    if (!special) {
      return {
        success: false,
        reason:
          "This quest has an invalid special reward.",
      };
    }
  }

  const requirements =
    await checkQuestRequirements(
      threadID,
      userID,
      quest
    );

  if (!requirements.ok) {
    return {
      success: false,
      reason: requirements.reason,
    };
  }

  const record =
    await getQuestRecord(
      threadID,
      userID,
      quest.id
    );

  if (!record) {
    return {
      success: false,
      reason:
        "You have not started this kingdom quest.",
    };
  }

  if (record.claimed) {
    return {
      success: false,
      reason:
        "This kingdom quest has already been claimed.",
      quest,
      record,
    };
  }

  if (!record.completed) {
    return {
      success: false,
      reason:
        `Quest progress is ${Number(
          record.objective_progress || 0
        )}/${Number(
          quest.objectiveAmount || 0
        )}.`,
      quest,
      record,
    };
  }

  /*
   * Lock the quest before granting rewards.
   *
   * The lock is reverted below if reward distribution fails.
   * This prevents two simultaneous claim requests from both
   * passing the initial claimed=false check.
   */
  const claimTimestamp = Date.now();

  const lockResult = await db.query(
    `
      UPDATE rpg_kingdom_quest_records
      SET
        claimed = TRUE,
        claimed_at = $4,
        updated_at = $4
      WHERE thread_id = $1
        AND user_id = $2
        AND quest_id = $3
        AND completed = TRUE
        AND claimed = FALSE
      RETURNING *
    `,
    [
      String(threadID),
      String(userID),
      String(quest.id),
      claimTimestamp,
    ]
  );

  if (!lockResult.rows.length) {
    return {
      success: false,
      reason:
        "This quest is already being claimed or has already been claimed.",
    };
  }

  const rewards = quest.rewards || {};

  try {
    const rewardResults = {};

    // --------------------------------------------------------
    // COINS
    // --------------------------------------------------------

    rewardResults.coins =
      await awardCoins(
        threadID,
        userID,
        rewards.coins
      );

    if (
      rewardResults.coins &&
      rewardResults.coins.success === false
    ) {
      throw new Error(
        "Coin reward could not be granted."
      );
    }

    // --------------------------------------------------------
    // XP
    // --------------------------------------------------------

    rewardResults.xp =
      await awardXP(
        threadID,
        userID,
        rewards.xp
      );

    if (
      rewardResults.xp &&
      rewardResults.xp.success === false
    ) {
      throw new Error(
        "XP reward could not be granted."
      );
    }

    // --------------------------------------------------------
    // KINGDOM REPUTATION
    // --------------------------------------------------------

    if (
      Number(rewards.reputation || 0) !== 0
    ) {
      const reputation =
        await addKingdomReputation(
          threadID,
          userID,
          quest.kingdomId,
          Number(rewards.reputation || 0)
        );

      rewardResults.reputation = {
        success: true,
        amount: Number(
          rewards.reputation || 0
        ),
        total: reputation,
      };
    } else {
      rewardResults.reputation = {
        success: true,
        amount: 0,
      };
    }

    // --------------------------------------------------------
    // AFFINITY MASTERY
    // --------------------------------------------------------

    if (
      rewards.affinity?.id
    ) {
      rewardResults.affinity =
        await awardAffinityMastery(
          threadID,
          userID,
          rewards.affinity.id,
          Number(
            rewards.affinity.mastery || 0
          )
        );

      if (
        rewardResults.affinity &&
        rewardResults.affinity.success === false
      ) {
        throw new Error(
          "Affinity reward could not be granted."
        );
      }
    }

    // --------------------------------------------------------
    // SPELL
    // --------------------------------------------------------

    if (rewards.spell) {
      rewardResults.spell =
        await awardSpell(
          threadID,
          userID,
          rewards.spell
        );

      if (
        !rewardResults.spell ||
        rewardResults.spell.success === false
      ) {
        throw new Error(
          "Spell reward could not be granted."
        );
      }
    }

    // --------------------------------------------------------
    // SPECIAL
    // --------------------------------------------------------

    if (rewards.special) {
      rewardResults.special =
        await awardSpecial(
          threadID,
          userID,
          rewards.special
        );

      if (
        !rewardResults.special ||
        rewardResults.special.success === false
      ) {
        throw new Error(
          "Special reward could not be granted."
        );
      }
    }

    return {
      success: true,
      quest,
      record: lockResult.rows[0],
      rewards: rewardResults,
    };
  } catch (error) {
    console.error(
      `[RPG KINGDOM QUEST] Reward distribution failed for ${quest.id} (${threadID}/${userID}):`,
      error
    );

    /*
     * Re-open the quest claim if reward distribution failed.
     *
     * This lets the player retry instead of leaving the quest
     * permanently stuck as claimed.
     */
    try {
      await db.query(
        `
          UPDATE rpg_kingdom_quest_records
          SET
            claimed = FALSE,
            claimed_at = NULL,
            updated_at = $4
          WHERE thread_id = $1
            AND user_id = $2
            AND quest_id = $3
            AND claimed = TRUE
        `,
        [
          String(threadID),
          String(userID),
          String(quest.id),
          Date.now(),
        ]
      );
    } catch (rollbackError) {
      console.error(
        `[RPG KINGDOM QUEST] Failed to rollback claim for ${quest.id}:`,
        rollbackError
      );
    }

    return {
      success: false,
      reason:
        "The quest rewards could not be fully granted. The quest claim has been restored so it can be retried.",
      quest,
    };
  }
}

// ============================================================
// KINGDOM QUEST SUMMARY
// ============================================================

async function getKingdomQuestSummary(
  threadID,
  userID,
  kingdomId
) {
  const kingdom = getKingdom(
    kingdomId
  );

  if (!kingdom) {
    return null;
  }

  const reputation =
    await getKingdomReputation(
      threadID,
      userID,
      kingdomId
    );

  const quests =
    getKingdomQuests(
      kingdomId
    );

  const records = [];

  for (const quest of quests) {
    const record =
      await getQuestRecord(
        threadID,
        userID,
        quest.id
      );

    records.push({
      quest,
      record,
    });
  }

  return {
    kingdom,
    reputation,
    quests: records,
  };
}

// ============================================================
// AFFINITY QUESTS
// ============================================================
//
// These are independent of the four major kingdoms and are
// intended for frontier / unaligned affinities.
// ============================================================

const AFFINITY_QUESTS = {
  nature: {
    id: "nature",
    affinityId: "nature",
    name: "Voice of the Wild",
    description:
      "Follow the living world and awaken your connection with nature.",
    special: "verdant_rebirth",
  },

  water: {
    id: "water",
    affinityId: "water",
    name: "Tideborn Path",
    description:
      "Follow the movement of water and learn to command its endless flow.",
    special: "tidal_wrath",
  },

  wind: {
    id: "wind",
    affinityId: "wind",
    name: "Path of the Gale",
    description:
      "Move with the wind and master the freedom of the open sky.",
    special: "tempest_step",
  },
};

function getAffinityQuest(
  affinityId
) {
  if (!affinityId) return null;

  return (
    AFFINITY_QUESTS[
      String(affinityId).toLowerCase()
    ] || null
  );
}

function getAllAffinityQuests() {
  return Object.values(
    AFFINITY_QUESTS
  );
}

// ============================================================
// TRAITOR SYSTEM
// ============================================================

async function markTraitor(
  threadID,
  userID,
  kingdomId
) {
  const kingdom = getKingdom(
    kingdomId
  );

  if (!kingdom) {
    return {
      success: false,
      reason: "Unknown kingdom.",
    };
  }

  const timestamp = Date.now();

  const result = await db.query(
    `
      UPDATE rpg_players
      SET
        traitor = TRUE,
        traitor_kingdom_id = $3,
        updated_at = $4
      WHERE thread_id = $1
        AND user_id = $2
      RETURNING
        kingdom_id,
        kingdom_role,
        traitor,
        traitor_kingdom_id,
        reputation
    `,
    [
      String(threadID),
      String(userID),
      String(kingdomId),
      timestamp,
    ]
  );

  if (!result.rows.length) {
    return {
      success: false,
      reason: "RPG player not found.",
    };
  }

  return {
    success: true,
    player: result.rows[0],
  };
}

// ============================================================
// KINGDOM PLEDGE VALIDATION
// ============================================================

async function canPledgeToKingdom(
  threadID,
  userID,
  kingdomId
) {
  const kingdom = getKingdom(
    kingdomId
  );

  if (!kingdom) {
    return {
      ok: false,
      reason: "Unknown kingdom.",
    };
  }

  const player =
    await getPlayerKingdom(
      threadID,
      userID
    );

  if (
    player.kingdomId &&
    player.kingdomId !== kingdomId
  ) {
    return {
      ok: false,
      reason:
        `You are already pledged to ${getKingdom(player.kingdomId)?.name || player.kingdomId}.`,
    };
  }

  if (
    player.traitor &&
    player.traitorKingdomId &&
    player.traitorKingdomId !== kingdomId
  ) {
    return {
      ok: false,
      reason:
        "Your traitor status prevents you from pledging to this kingdom.",
    };
  }

  return {
    ok: true,
    kingdom,
  };
}

// ============================================================
// FORMATTING
// ============================================================

function formatKingdom(
  kingdom
) {
  if (!kingdom) {
    return "Unknown Kingdom";
  }

  const affinities =
    Array.isArray(kingdom.affinities)
      ? kingdom.affinities.join(", ")
      : "None";

  return [
    `🏰 ${kingdom.name}`,
    "",
    kingdom.description || "",
    "",
    `✨ Affinities: ${affinities}`,
  ].join("\n");
}

function formatKingdomQuest(
  quest,
  record = null
) {
  if (!quest) {
    return "Unknown quest.";
  }

  const progress = record
    ? Number(
        record.objective_progress || 0
      )
    : 0;

  const target = Number(
    quest.objectiveAmount || 0
  );

  const completed = Boolean(
    record?.completed
  );

  const claimed = Boolean(
    record?.claimed
  );

  const rewards = [];

  if (
    Number(
      quest.rewards?.coins || 0
    ) > 0
  ) {
    rewards.push(
      `💰 ${quest.rewards.coins} coins`
    );
  }

  if (
    Number(
      quest.rewards?.xp || 0
    ) > 0
  ) {
    rewards.push(
      `✨ ${quest.rewards.xp} XP`
    );
  }

  if (
    Number(
      quest.rewards?.reputation || 0
    ) > 0
  ) {
    rewards.push(
      `🏰 +${quest.rewards.reputation} reputation`
    );
  }

  if (
    quest.rewards?.affinity?.id
  ) {
    rewards.push(
      `🔮 ${quest.rewards.affinity.id} +${quest.rewards.affinity.mastery} mastery`
    );
  }

  if (quest.rewards?.spell) {
    rewards.push(
      `📜 Spell: ${quest.rewards.spell}`
    );
  }

  if (quest.rewards?.special) {
    rewards.push(
      `⚔️ Special: ${quest.rewards.special}`
    );
  }

  const status = claimed
    ? "CLAIMED"
    : completed
      ? "READY TO CLAIM"
      : `${progress}/${target}`;

  return [
    `📜 ${quest.name}`,
    "",
    quest.description || "",
    "",
    `🎯 Objective: ${quest.objectiveType}`,
    `📊 Progress: ${status}`,
    `⭐ Required Reputation: ${quest.requiredReputation || 0}`,
    "",
    "🎁 Rewards:",
    rewards.length
      ? rewards.map(
          (reward) => `• ${reward}`
        ).join("\n")
      : "• None",
  ].join("\n");
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Kingdoms
  KINGDOMS,
  getKingdom,
  getAllKingdoms,

  // Affinity domains
  AFFINITY_DOMAINS,
  getAffinityDomain,
  getKingdomForAffinity,

  // Kingdom quests
  KINGDOM_QUESTS,
  getKingdomQuests,
  getKingdomQuest,

  // Player kingdom state
  getPlayerKingdom,

  // Reputation
  getKingdomReputation,
  addKingdomReputation,

  // Quest records
  getQuestRecord,
  ensureQuestRecord,

  // Quest requirements / progression
  checkQuestRequirements,
  startKingdomQuest,
  progressKingdomQuest,
  claimKingdomQuest,

  // Reward helpers
  awardCoins,
  awardXP,
  awardAffinityMastery,
  awardSpell,
  awardSpecial,

  // Summary
  getKingdomQuestSummary,

  // Independent affinity quests
  AFFINITY_QUESTS,
  getAffinityQuest,
  getAllAffinityQuests,

  // Traitor / allegiance
  markTraitor,
  canPledgeToKingdom,

  // Formatting
  formatKingdom,
  formatKingdomQuest,
};
