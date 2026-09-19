"use strict";

/**
 * ECLIPSE RPG — KINGDOM QUEST & AFFINITY PROGRESSION
 * ====================================================
 *
 * Kingdoms are the political layer.
 * Affinities are the power layer.
 *
 * A player can:
 *
 *   pledge to a kingdom
 *        ↓
 *   complete kingdom quests
 *        ↓
 *   gain kingdom reputation
 *        ↓
 *   gain affinity mastery
 *        ↓
 *   unlock spells / special moves
 *        ↓
 *   unlock secondary affinities
 *
 * IMPORTANT:
 * The four major kingdoms remain:
 *
 *   ashen_dominion
 *   silver_conclave
 *   ironspine_hold
 *   hollow_covenant
 *
 * Affinity regions such as Frostgrave, Azure Coast,
 * Whispering Forest and Celestial Lands are treated as
 * affinity domains/territories, NOT additional player
 * kingdoms.
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
// MAJOR KINGDOMS
// ============================================================

const KINGDOMS = {
  ashen_dominion: {
    id: "ashen_dominion",
    name: "The Ashen Dominion",
    capital: "Eclipse Castle",

    description:
      "A militaristic kingdom built around conquest, discipline and destructive power.",

    primaryAffinities: [
      "fire",
      "blood",
    ],

    territory: [
      "greenvale",
      "scorched_wastes",
    ],

    reputationTitle: "Ashen Renown",
  },

  silver_conclave: {
    id: "silver_conclave",
    name: "The Silver Conclave",
    capital: "Starfall",

    description:
      "A realm of scholars, divine orders and arcane mastery.",

    primaryAffinities: [
      "arcane",
      "light",
      "divine",
      "lightning",
    ],

    territory: [
      "celestial_lands",
    ],

    reputationTitle: "Silver Renown",
  },

  ironspine_hold: {
    id: "ironspine_hold",
    name: "Ironspine Hold",
    capital: "Stonehold",

    description:
      "A fortified mountain power built on earth, endurance and commerce.",

    primaryAffinities: [
      "earth",
      "ice",
    ],

    territory: [
      "ironspine",
      "frostgrave",
    ],

    reputationTitle: "Iron Renown",
  },

  hollow_covenant: {
    id: "hollow_covenant",
    name: "The Hollow Covenant",
    capital: "Hollow Gate",

    description:
      "A forbidden realm devoted to shadow, death and necromantic power.",

    primaryAffinities: [
      "shadow",
      "necromancy",
    ],

    territory: [
      "abyss",
      "moonlit_ruins",
    ],

    reputationTitle: "Hollow Renown",
  },
};


// ============================================================
// AFFINITY DOMAIN → MAJOR KINGDOM
// ============================================================
//
// This resolves the earlier problem where affinities referenced
// places such as frostgrave or azure_coast as if they were
// kingdom IDs.
//
// These are affinity domains. The actual political kingdom is
// represented separately.
//
// This lets us keep the world expansive without creating
// accidental duplicate kingdom systems.
//

const AFFINITY_DOMAINS = {

  fire: {
    affinity: "fire",
    domain: "Scorched Wastes",
    kingdom: "ashen_dominion",
  },

  blood: {
    affinity: "blood",
    domain: "Scorched Wastes",
    kingdom: "ashen_dominion",
  },

  arcane: {
    affinity: "arcane",
    domain: "Celestial Lands",
    kingdom: "silver_conclave",
  },

  light: {
    affinity: "light",
    domain: "Celestial Lands",
    kingdom: "silver_conclave",
  },

  divine: {
    affinity: "divine",
    domain: "Celestial Lands",
    kingdom: "silver_conclave",
  },

  lightning: {
    affinity: "lightning",
    domain: "Celestial Lands",
    kingdom: "silver_conclave",
  },

  earth: {
    affinity: "earth",
    domain: "Ironspine Mountains",
    kingdom: "ironspine_hold",
  },

  ice: {
    affinity: "ice",
    domain: "Frostgrave",
    kingdom: "ironspine_hold",
  },

  shadow: {
    affinity: "shadow",
    domain: "The Abyss",
    kingdom: "hollow_covenant",
  },

  necromancy: {
    affinity: "necromancy",
    domain: "The Abyss",
    kingdom: "hollow_covenant",
  },

  /*
   * These affinities are not owned exclusively by a major
   * kingdom. They are frontier/domain affinities.
   *
   * They can still be accessed through affinity quests.
   */

  nature: {
    affinity: "nature",
    domain: "Whispering Forest",
    kingdom: null,
  },

  water: {
    affinity: "water",
    domain: "Azure Coast",
    kingdom: null,
  },

  wind: {
    affinity: "wind",
    domain: "Azure Coast",
    kingdom: null,
  },
};


// ============================================================
// QUEST DEFINITIONS
// ============================================================

const KINGDOM_QUESTS = {

  // ==========================================================
  // ASHEN DOMINION
  // ==========================================================

  ash_first_flame: {
    id: "ash_first_flame",
    kingdom: "ashen_dominion",

    name: "The First Flame",
    type: "kingdom",

    description:
      "Prove yourself to the Ashen Dominion by defeating creatures in hostile territory.",

    objective: {
      type: "hunt",
      amount: 5,
    },

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
    kingdom: "ashen_dominion",

    name: "Walk the Warpath",
    type: "kingdom",

    description:
      "Demonstrate your strength through repeated combat.",

    objective: {
      type: "hunt",
      amount: 15,
    },

    requirements: {
      reputation: 75,
    },

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
    kingdom: "ashen_dominion",

    name: "Blood Oath",
    type: "kingdom",

    description:
      "Enter the deeper traditions of the Ashen Dominion.",

    objective: {
      type: "boss",
      amount: 1,
    },

    requirements: {
      reputation: 200,
    },

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
    kingdom: "silver_conclave",

    name: "The First Lesson",
    type: "kingdom",

    description:
      "Prove your worth to the Conclave through disciplined magical combat.",

    objective: {
      type: "hunt",
      amount: 5,
    },

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
    kingdom: "silver_conclave",

    name: "Arcane Trial",
    type: "kingdom",

    description:
      "Demonstrate your ability to control increasingly powerful magic.",

    objective: {
      type: "dungeon",
      amount: 1,
    },

    requirements: {
      reputation: 75,
    },

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
    kingdom: "silver_conclave",

    name: "Trial of the Heavens",
    type: "kingdom",

    description:
      "Enter the celestial domain and survive its trial.",

    objective: {
      type: "boss",
      amount: 1,
    },

    requirements: {
      reputation: 250,
    },

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
    kingdom: "ironspine_hold",

    name: "First Fortification",
    type: "kingdom",

    description:
      "Prove that you possess the endurance required by Ironspine.",

    objective: {
      type: "hunt",
      amount: 5,
    },

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
    kingdom: "ironspine_hold",

    name: "Mountain Trial",
    type: "kingdom",

    description:
      "Survive the harsh mountain territories.",

    objective: {
      type: "explore",
      amount: 3,
    },

    requirements: {
      reputation: 75,
    },

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
    kingdom: "ironspine_hold",

    name: "The Frozen Frontier",
    type: "kingdom",

    description:
      "Push into Frostgrave and survive its supernatural cold.",

    objective: {
      type: "explore",
      amount: 5,
    },

    requirements: {
      reputation: 250,
    },

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
    kingdom: "hollow_covenant",

    name: "First Shadow",
    type: "kingdom",

    description:
      "Enter the path of forbidden power.",

    objective: {
      type: "hunt",
      amount: 5,
    },

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
    kingdom: "hollow_covenant",

    name: "The Dead Remember",
    type: "kingdom",

    description:
      "Descend into an ancient crypt and return alive.",

    objective: {
      type: "dungeon",
      amount: 1,
    },

    requirements: {
      reputation: 75,
    },

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
    kingdom: "hollow_covenant",

    name: "Oath of the Abyss",
    type: "kingdom",

    description:
      "Face the darkness beneath the world.",

    objective: {
      type: "boss",
      amount: 1,
    },

    requirements: {
      reputation: 275,
    },

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
// DOMAIN / KINGDOM HELPERS
// ============================================================

function getKingdom(kingdomID) {
  if (!kingdomID) return null;

  return (
    KINGDOMS[
      String(kingdomID).toLowerCase()
    ] || null
  );
}

function getAllKingdoms() {
  return Object.values(KINGDOMS);
}

function getAffinityDomain(affinityID) {
  if (!affinityID) return null;

  return (
    AFFINITY_DOMAINS[
      String(affinityID).toLowerCase()
    ] || null
  );
}

function getKingdomForAffinity(affinityID) {
  return (
    getAffinityDomain(
      affinityID
    )?.kingdom || null
  );
}

function getKingdomQuests(kingdomID) {
  return Object.values(
    KINGDOM_QUESTS
  ).filter(
    quest =>
      quest.kingdom ===
      String(kingdomID).toLowerCase()
  );
}

function getKingdomQuest(questID) {
  return (
    KINGDOM_QUESTS[
      String(questID || "").toLowerCase()
    ] || null
  );
}


// ============================================================
// PLAYER KINGDOM STATE
// ============================================================

async function getPlayerKingdom(
  threadID,
  userID
) {
  const result =
    await db.query(
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
      [
        String(threadID),
        String(userID),
      ]
    );

  return result.rows[0] || null;
}


// ============================================================
// KINGDOM REPUTATION
// ============================================================

async function getKingdomReputation(
  threadID,
  userID,
  kingdomID
) {
  const kingdom =
    getKingdom(kingdomID);

  if (!kingdom) {
    throw new Error(
      `Unknown kingdom: ${kingdomID}`
    );
  }

  const result =
    await db.query(
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
        kingdom.id,
      ]
    );

  return Number(
    result.rows[0]?.reputation || 0
  );
}

async function addKingdomReputation(
  threadID,
  userID,
  kingdomID,
  amount
) {
  const kingdom =
    getKingdom(kingdomID);

  if (!kingdom) {
    throw new Error(
      `Unknown kingdom: ${kingdomID}`
    );
  }

  const value =
    Number(amount || 0);

  const result =
    await db.query(
      `
        INSERT INTO rpg_kingdom_reputation (
          thread_id,
          user_id,
          kingdom_id,
          reputation
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (
          thread_id,
          user_id,
          kingdom_id
        )
        DO UPDATE SET
          reputation =
            rpg_kingdom_reputation.reputation
            + EXCLUDED.reputation,
          updated_at = NOW()
        RETURNING reputation
      `,
      [
        String(threadID),
        String(userID),
        kingdom.id,
        value,
      ]
    );

  return Number(
    result.rows[0]?.reputation || 0
  );
}


// ============================================================
// QUEST COMPLETION STATE
// ============================================================

async function getQuestRecord(
  threadID,
  userID,
  questID
) {
  const result =
    await db.query(
      `
        SELECT *
        FROM rpg_quests
        WHERE thread_id = $1
          AND user_id = $2
          AND quest_id = $3
        LIMIT 1
      `,
      [
        String(threadID),
        String(userID),
        String(questID),
      ]
    );

  return result.rows[0] || null;
}

async function ensureQuestRecord(
  threadID,
  userID,
  quest
) {
  const existing =
    await getQuestRecord(
      threadID,
      userID,
      quest.id
    );

  if (existing) {
    return existing;
  }

  const result =
    await db.query(
      `
        INSERT INTO rpg_quests (
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
          claimed
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
          FALSE
        )
        ON CONFLICT (
          thread_id,
          user_id,
          quest_id
        )
        DO NOTHING
        RETURNING *
      `,
      [
        String(threadID),
        String(userID),
        quest.id,
        quest.kingdom,
        quest.objective.type,
        Number(
          quest.objective.amount || 1
        ),
        Number(
          quest.rewards.coins || 0
        ),
        Number(
          quest.rewards.reputation || 0
        ),
        Number(
          quest.rewards.affinity?.mastery || 0
        ),
      ]
    );

  if (result.rows[0]) {
    return result.rows[0];
  }

  return getQuestRecord(
    threadID,
    userID,
    quest.id
  );
}


// ============================================================
// QUEST REQUIREMENTS
// ============================================================

async function checkQuestRequirements(
  threadID,
  userID,
  quest
) {
  const player =
    await getPlayerKingdom(
      threadID,
      userID
    );

  if (!player) {
    return {
      allowed: false,
      reason:
        "RPG player profile not found.",
    };
  }

  /*
   * A kingdom quest requires a pledge to that kingdom.
   */
  if (
    player.kingdom_id !==
    quest.kingdom
  ) {
    return {
      allowed: false,
      reason:
        `You must pledge to ${KINGDOMS[quest.kingdom]?.name || quest.kingdom}.`,
    };
  }

  /*
   * Traitors cannot progress quests for the kingdom
   * they betrayed.
   */
  if (
    player.traitor &&
    player.traitor_kingdom_id ===
      quest.kingdom
  ) {
    return {
      allowed: false,
      reason:
        "You are a traitor to this kingdom.",
    };
  }

  const reputation =
    await getKingdomReputation(
      threadID,
      userID,
      quest.kingdom
    );

  const required =
    Number(
      quest.requirements?.reputation || 0
    );

  if (
    reputation <
    required
  ) {
    return {
      allowed: false,
      reason:
        `Requires ${required} kingdom reputation. You have ${reputation}.`,
    };
  }

  return {
    allowed: true,
    reputation,
  };
}


// ============================================================
// START QUEST
// ============================================================

async function startKingdomQuest(
  threadID,
  userID,
  questID
) {
  const quest =
    getKingdomQuest(questID);

  if (!quest) {
    return {
      success: false,
      reason:
        `Unknown kingdom quest: ${questID}`,
    };
  }

  const requirements =
    await checkQuestRequirements(
      threadID,
      userID,
      quest
    );

  if (!requirements.allowed) {
    return {
      success: false,
      reason: requirements.reason,
      quest,
    };
  }

  const record =
    await ensureQuestRecord(
      threadID,
      userID,
      quest
    );

  if (record.claimed) {
    return {
      success: false,
      reason:
        "This quest has already been claimed.",
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
  questType,
  amount = 1
) {
  const player =
    await getPlayerKingdom(
      threadID,
      userID
    );

  if (!player?.kingdom_id) {
    return [];
  }

  const quests =
    getKingdomQuests(
      player.kingdom_id
    );

  const updated = [];

  for (const quest of quests) {
    if (
      quest.objective.type !==
      questType
    ) {
      continue;
    }

    const requirements =
      await checkQuestRequirements(
        threadID,
        userID,
        quest
      );

    if (!requirements.allowed) {
      continue;
    }

    const record =
      await ensureQuestRecord(
        threadID,
        userID,
        quest
      );

    if (
      record.claimed ||
      record.completed
    ) {
      continue;
    }

    const current =
      Number(
        record.objective_progress || 0
      );

    const target =
      Number(
        quest.objective.amount || 1
      );

    const next =
      Math.min(
        target,
        current +
          Number(amount || 1)
      );

    const completed =
      next >= target;

    const result =
      await db.query(
        `
          UPDATE rpg_quests
          SET
            objective_progress = $4,
            completed = $5,
            updated_at = NOW()
          WHERE thread_id = $1
            AND user_id = $2
            AND quest_id = $3
          RETURNING *
        `,
        [
          String(threadID),
          String(userID),
          quest.id,
          next,
          completed,
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
  const value =
    Number(amount || 0);

  if (value <= 0) {
    return;
  }

  /*
   * Use the existing ECLIPSE economy wallet.
   */
  if (
    typeof db.addBalance ===
    "function"
  ) {
    await db.addBalance(
      threadID,
      userID,
      value
    );

    return;
  }

  /*
   * Fallback for db implementations where
   * addBalance is unavailable.
   */
  await db.query(
    `
      UPDATE users
      SET balance =
        COALESCE(balance, 0) + $3
      WHERE thread_id = $1
        AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      value,
    ]
  );
}

async function awardXP(
  threadID,
  userID,
  amount
) {
  const value =
    Number(amount || 0);

  if (value <= 0) {
    return;
  }

  if (
    typeof db.addXP ===
    "function"
  ) {
    await db.addXP(
      threadID,
      userID,
      value
    );

    return;
  }

  /*
   * RPG fallback.
   */
  await db.query(
    `
      UPDATE rpg_players
      SET
        renown =
          COALESCE(renown, 0) + $3,
        updated_at = NOW()
      WHERE thread_id = $1
        AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      value,
    ]
  );
}


// ============================================================
// AFFINITY REWARD
// ============================================================

async function awardAffinityMastery(
  threadID,
  userID,
  affinityID,
  mastery
) {
  if (!affinityID) {
    return null;
  }

  const affinity =
    getAffinity(
      affinityID
    );

  if (!affinity) {
    return null;
  }

  const existing =
    await getPlayerAffinity(
      threadID,
      userID,
      affinity.id
    );

  if (!existing) {
    await unlockAffinity(
      threadID,
      userID,
      affinity.id,
      {
        source: "kingdom_quest",
      }
    );
  }

  return addAffinityMastery(
    threadID,
    userID,
    affinity.id,
    Number(mastery || 0),
    {
      source: "kingdom_quest",
    }
  );
}


// ============================================================
// SPELL REWARD
// ============================================================

async function awardSpell(
  threadID,
  userID,
  spellID
) {
  if (!spellID) {
    return null;
  }

  const spell =
    getSpell(
      spellID
    );

  if (!spell) {
    return {
      success: false,
      reason:
        `Unknown reward spell: ${spellID}`,
    };
  }

  const known =
    await hasSpell(
      threadID,
      userID,
      spell.id
    );

  if (known) {
    return {
      success: true,
      alreadyKnown: true,
      spell,
    };
  }

  /*
   * Quest rewards bypass normal purchase requirements.
   * The affinity itself is still granted if necessary.
   */
  const affinity =
    await getPlayerAffinity(
      threadID,
      userID,
      spell.affinity
    );

  if (!affinity) {
    await unlockAffinity(
      threadID,
      userID,
      spell.affinity,
      {
        source: "kingdom_quest",
      }
    );
  }

  const result =
    await learnSpell(
      threadID,
      userID,
      spell.id,
      {
        source: "kingdom_quest",
        requireKingdom: false,
      }
    );

  /*
   * Some kingdom spells may require a political kingdom
   * that differs from the player's current kingdom.
   *
   * Quest reward should still grant the spell.
   */
  if (!result.success) {
    const forced =
      await db.query(
        `
          INSERT INTO rpg_player_spells (
            thread_id,
            user_id,
            spell_id,
            source,
            mastery,
            learned_at
          )
          VALUES (
            $1,
            $2,
            $3,
            'kingdom_quest',
            0,
            NOW()
          )
          ON CONFLICT (
            thread_id,
            user_id,
            spell_id
          )
          DO NOTHING
          RETURNING *
        `,
        [
          String(threadID),
          String(userID),
          spell.id,
        ]
      );

    return {
      success: true,
      forced: true,
      spell,
      record:
        forced.rows[0] || null,
    };
  }

  return result;
}


// ============================================================
// SPECIAL REWARD
// ============================================================

async function awardSpecial(
  threadID,
  userID,
  specialID
) {
  if (!specialID) {
    return null;
  }

  const special =
    getSpecial(
      specialID
    );

  if (!special) {
    return {
      success: false,
      reason:
        `Unknown special reward: ${specialID}`,
    };
  }

  const known =
    await hasSpecial(
      threadID,
      userID,
      special.id
    );

  if (known) {
    return {
      success: true,
      alreadyKnown: true,
      special,
    };
  }

  const result =
    await unlockSpecial(
      threadID,
      userID,
      special.id,
      {
        source: "kingdom_quest",
        bypassRequirements: true,
      }
    );

  return result;
}


// ============================================================
// CLAIM QUEST
// ============================================================

async function claimKingdomQuest(
  threadID,
  userID,
  questID
) {
  const quest =
    getKingdomQuest(
      questID
    );

  if (!quest) {
    return {
      success: false,
      reason:
        `Unknown kingdom quest: ${questID}`,
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
        "You have not started this quest.",
    };
  }

  if (!record.completed) {
    return {
      success: false,
      reason:
        "Quest objective is not complete.",
      progress:
        Number(
          record.objective_progress || 0
        ),
      required:
        Number(
          quest.objective.amount || 1
        ),
    };
  }

  if (record.claimed) {
    return {
      success: false,
      reason:
        "Quest reward has already been claimed.",
    };
  }

  /*
   * Lock the claim before rewarding anything.
   *
   * This prevents duplicate reward claims if two messages
   * arrive simultaneously.
   */
  const lock =
    await db.query(
      `
        UPDATE rpg_quests
        SET
          claimed = TRUE,
          claimed_at = NOW(),
          updated_at = NOW()
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
        quest.id,
      ]
    );

  if (!lock.rows.length) {
    return {
      success: false,
      reason:
        "Quest reward was already claimed.",
    };
  }

  const rewards = {
    coins: 0,
    xp: 0,
    reputation: 0,
    affinity: null,
    spell: null,
    special: null,
  };

  // ----------------------------------------------------------
  // Coins
  // ----------------------------------------------------------

  rewards.coins =
    Number(
      quest.rewards.coins || 0
    );

  if (rewards.coins > 0) {
    await awardCoins(
      threadID,
      userID,
      rewards.coins
    );
  }

  // ----------------------------------------------------------
  // XP
  // ----------------------------------------------------------

  rewards.xp =
    Number(
      quest.rewards.xp || 0
    );

  if (rewards.xp > 0) {
    await awardXP(
      threadID,
      userID,
      rewards.xp
    );
  }

  // ----------------------------------------------------------
  // Kingdom reputation
  // ----------------------------------------------------------

  rewards.reputation =
    Number(
      quest.rewards.reputation || 0
    );

  if (rewards.reputation !== 0) {
    await addKingdomReputation(
      threadID,
      userID,
      quest.kingdom,
      rewards.reputation
    );
  }

  // ----------------------------------------------------------
  // Affinity mastery
  // ----------------------------------------------------------

  if (
    quest.rewards.affinity?.id
  ) {
    rewards.affinity =
      await awardAffinityMastery(
        threadID,
        userID,
        quest.rewards.affinity.id,
        quest.rewards.affinity.mastery
      );
  }

  // ----------------------------------------------------------
  // Spell
  // ----------------------------------------------------------

  if (
    quest.rewards.spell
  ) {
    rewards.spell =
      await awardSpell(
        threadID,
        userID,
        quest.rewards.spell
      );
  }

  // ----------------------------------------------------------
  // Special
  // ----------------------------------------------------------

  if (
    quest.rewards.special
  ) {
    rewards.special =
      await awardSpecial(
        threadID,
        userID,
        quest.rewards.special
      );
  }

  return {
    success: true,
    quest,
    rewards,
  };
}


// ============================================================
// QUEST SUMMARY
// ============================================================

async function getKingdomQuestSummary(
  threadID,
  userID
) {
  const player =
    await getPlayerKingdom(
      threadID,
      userID
    );

  if (!player?.kingdom_id) {
    return {
      kingdom: null,
      reputation: 0,
      quests: [],
    };
  }

  const kingdom =
    getKingdom(
      player.kingdom_id
    );

  const reputation =
    await getKingdomReputation(
      threadID,
      userID,
      player.kingdom_id
    );

  const quests =
    getKingdomQuests(
      player.kingdom_id
    );

  const output = [];

  for (const quest of quests) {
    const record =
      await getQuestRecord(
        threadID,
        userID,
        quest.id
      );

    output.push({
      quest,
      record,
      progress:
        Number(
          record?.objective_progress || 0
        ),
      required:
        Number(
          quest.objective.amount || 1
        ),
      completed:
        !!record?.completed,
      claimed:
        !!record?.claimed,
    });
  }

  return {
    kingdom,
    reputation,
    quests: output,
  };
}


// ============================================================
// AFFINITY QUEST ACCESS
// ============================================================
//
// These are generated progression paths for affinities that
// don't belong exclusively to a major kingdom.
//

const AFFINITY_QUESTS = {

  nature: {
    id: "nature_path",
    name: "Path of the Worldroot",
    affinity: "nature",
    domain: "Whispering Forest",

    objective: {
      type: "explore",
      amount: 5,
    },

    rewards: {
      coins: 1500,
      xp: 900,
      mastery: 500,
      special: "worldbloom",
    },
  },

  water: {
    id: "water_path",
    name: "Call of the Azure Coast",
    affinity: "water",
    domain: "Azure Coast",

    objective: {
      type: "explore",
      amount: 5,
    },

    rewards: {
      coins: 1500,
      xp: 900,
      mastery: 500,
      special: "abyssal_tide",
    },
  },

  wind: {
    id: "wind_path",
    name: "Voice of the Tempest",
    affinity: "wind",
    domain: "Azure Coast",

    objective: {
      type: "explore",
      amount: 5,
    },

    rewards: {
      coins: 1500,
      xp: 900,
      mastery: 500,
      special: "celestial_tempest",
    },
  },
};


// ============================================================
// AFFINITY DOMAIN LOOKUP
// ============================================================

function getAffinityQuest(
  affinityID
) {
  return (
    AFFINITY_QUESTS[
      String(
        affinityID || ""
      ).toLowerCase()
    ] || null
  );
}

function getAllAffinityQuests() {
  return Object.values(
    AFFINITY_QUESTS
  );
}


// ============================================================
// TRAITOR STATUS
// ============================================================

async function markTraitor(
  threadID,
  userID,
  kingdomID
) {
  const kingdom =
    getKingdom(
      kingdomID
    );

  if (!kingdom) {
    throw new Error(
      `Unknown kingdom: ${kingdomID}`
    );
  }

  await db.query(
    `
      UPDATE rpg_players
      SET
        traitor = TRUE,
        traitor_kingdom_id = $3,
        updated_at = NOW()
      WHERE thread_id = $1
        AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      kingdom.id,
    ]
  );

  /*
   * Heavy reputation damage.
   */
  await addKingdomReputation(
    threadID,
    userID,
    kingdom.id,
    -500
  );

  return {
    traitor: true,
    kingdom,
  };
}


// ============================================================
// CAN PLEDGE
// ============================================================

async function canPledgeToKingdom(
  threadID,
  userID,
  kingdomID
) {
  const kingdom =
    getKingdom(
      kingdomID
    );

  if (!kingdom) {
    return {
      allowed: false,
      reason:
        "Unknown kingdom.",
    };
  }

  const player =
    await getPlayerKingdom(
      threadID,
      userID
    );

  if (!player) {
    return {
      allowed: false,
      reason:
        "RPG player not found.",
    };
  }

  if (
    player.traitor
  ) {
    return {
      allowed: false,
      reason:
        "Traitors cannot pledge to another kingdom.",
    };
  }

  if (
    player.kingdom_id &&
    player.kingdom_id !==
      kingdom.id
  ) {
    return {
      allowed: false,
      reason:
        "You are already pledged to another kingdom.",
    };
  }

  return {
    allowed: true,
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
    return "Unknown kingdom.";
  }

  return [
    `${kingdom.name}`,
    `Capital: ${kingdom.capital}`,
    "",
    kingdom.description,
    "",
    `Affinities: ${
      kingdom.primaryAffinities
        .join(", ")
    }`,
    `Territories: ${
      kingdom.territory
        .join(", ")
    }`,
  ].join("\n");
}

function formatKingdomQuest(
  quest,
  record = null
) {
  if (!quest) {
    return "Unknown quest.";
  }

  const current =
    Number(
      record?.objective_progress || 0
    );

  const required =
    Number(
      quest.objective.amount || 1
    );

  const lines = [
    `${quest.name}`,
    "",
    quest.description,
    "",
    `Objective: ${quest.objective.type}`,
    `Progress: ${current}/${required}`,
  ];

  if (
    quest.requirements?.reputation
  ) {
    lines.push(
      `Required reputation: ${quest.requirements.reputation}`
    );
  }

  lines.push(
    "",
    `Rewards:`,
    `• ${quest.rewards.coins || 0} coins`,
    `• ${quest.rewards.xp || 0} XP`,
    `• ${quest.rewards.reputation || 0} kingdom reputation`
  );

  if (
    quest.rewards.affinity
  ) {
    lines.push(
      `• ${quest.rewards.affinity.mastery} ${quest.rewards.affinity.id} mastery`
    );
  }

  if (
    quest.rewards.spell
  ) {
    lines.push(
      `• Spell: ${quest.rewards.spell}`
    );
  }

  if (
    quest.rewards.special
  ) {
    lines.push(
      `• Special: ${quest.rewards.special}`
    );
  }

  return lines.join("\n");
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  KINGDOMS,
  AFFINITY_DOMAINS,
  KINGDOM_QUESTS,
  AFFINITY_QUESTS,

  getKingdom,
  getAllKingdoms,

  getAffinityDomain,
  getKingdomForAffinity,

  getKingdomQuest,
  getKingdomQuests,

  getPlayerKingdom,

  getKingdomReputation,
  addKingdomReputation,

  getQuestRecord,
  ensureQuestRecord,

  checkQuestRequirements,

  startKingdomQuest,
  progressKingdomQuest,
  claimKingdomQuest,

  getKingdomQuestSummary,

  getAffinityQuest,
  getAllAffinityQuests,

  markTraitor,
  canPledgeToKingdom,

  formatKingdom,
  formatKingdomQuest,
};
