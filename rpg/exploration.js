"use strict";

const db = require("../db");

const {
  addItem,
  getUserState,
  updateVitals,
} = require("./player");

const { createHunt } = require("./combat");
const { getItem } = require("./items");
const { randomInt } = require("./utils");

/* =========================================================
   CONFIG
========================================================= */

const EXPLORE_STAMINA_COST = 15;

/*
 * Reuses loot IDs that already exist elsewhere in the RPG
 * (enemy drop table in combat.js, starting inventory in
 * player.js) so this module never needs to define new items
 * or touch items.js.
 */
const TREASURE_ITEMS = [
  "moonleaf",
  "iron",
  "void_crystal",
  "ember_core",
];

const OUTCOME_TABLE = [
  { type: "encounter", weight: 40 },
  { type: "elite_encounter", weight: 10 },
  { type: "gold", weight: 25 },
  { type: "item", weight: 15 },
  { type: "nothing", weight: 10 },
];

/* =========================================================
   DORIAN FLAVOR LINES
   Deterministic, pre-written — no AI call per explore.
========================================================= */

const DORIAN_LINES = {
  encounter: [
    "\"Something's moving out there. Don't say I didn't warn you.\"",
    "\"Ah. That's not the silence I was hoping for.\"",
  ],

  elite_encounter: [
    "\"That one's stronger than it looks. Mind yourself.\"",
    "\"I'd suggest running, but you never do listen.\"",
  ],

  gold: [
    "\"Well. At least the trip wasn't a total waste.\"",
    "\"Gold, not glory. I suppose it'll do.\"",
  ],

  item: [
    "\"That's worth more than you realize. Don't sell it too cheap.\"",
    "\"Interesting find. Bring it by the shop sometime.\"",
  ],

  nothing: [
    "\"Nothing? Consistent, if uneventful.\"",
    "\"Some days the road gives you nothing. Try again tomorrow.\"",
  ],

  insufficient_stamina: [
    "\"You're in no shape to go wandering. Rest first.\"",
  ],

  active_combat: [
    "\"You're already in a fight. Try surviving that one first.\"",
  ],
};

function pickLine(key) {
  const lines = DORIAN_LINES[key] || [];

  if (!lines.length) {
    return "";
  }

  return lines[
    randomInt(0, lines.length - 1)
  ];
}

/* =========================================================
   ACTIVE COMBAT CHECK
========================================================= */

/*
 * Exploration must not consume stamina when the player is
 * already inside an active combat session.
 *
 * This check intentionally happens BEFORE updateVitals().
 */
async function hasActiveCombat(threadID, userID) {
  const result = await db.query(
    `
      SELECT 1
      FROM rpg_combat_sessions
      WHERE thread_id = $1
        AND user_id = $2
        AND status = 'active'
      LIMIT 1
    `,
    [
      String(threadID),
      String(userID),
    ]
  );

  return result.rows.length > 0;
}

/* =========================================================
   OUTCOME ROLL
========================================================= */

function rollOutcome() {
  const total = OUTCOME_TABLE.reduce(
    (sum, outcome) =>
      sum + outcome.weight,
    0
  );

  let roll = randomInt(1, total);

  for (const outcome of OUTCOME_TABLE) {
    if (roll <= outcome.weight) {
      return outcome.type;
    }

    roll -= outcome.weight;
  }

  return "nothing";
}

/* =========================================================
   EXPLORE
========================================================= */

async function explore(threadID, userID) {
  const state =
    await getUserState(
      threadID,
      userID
    );

  const player = state.player;

  if (
    Number(player.hp) <= 0 ||
    player.status === "dead"
  ) {
    throw new Error(
      "You are defeated. Use !rpg rest before exploring again."
    );
  }

  /*
   * IMPORTANT:
   * Check active combat BEFORE stamina is deducted.
   *
   * Without this check, a player already fighting could
   * spend another 15 stamina by using exploration.
   */
  if (
    await hasActiveCombat(
      threadID,
      userID
    )
  ) {
    const error = new Error(
      "You are already in combat. Finish the current battle before exploring again."
    );

    error.dorianLine =
      pickLine("active_combat");

    throw error;
  }

  if (
    Number(player.stamina) <
    EXPLORE_STAMINA_COST
  ) {
    const error = new Error(
      "Not enough stamina to explore. Use !rpg rest to recover."
    );

    error.dorianLine =
      pickLine("insufficient_stamina");

    throw error;
  }

  /*
   * Stamina is only consumed after all conditions that can
   * reject the exploration have passed.
   */
  await updateVitals(
    threadID,
    userID,
    {
      stamina:
        Number(player.stamina) -
        EXPLORE_STAMINA_COST,
    }
  );

  const outcomeType =
    rollOutcome();

  /* -------------------------------------------------------
     ENCOUNTER (regular or elite)

     Reuses combat.js's existing hunt session rather than
     creating a parallel combat system. "Elite" is currently
     a narrative flag only — it draws from the same enemy
     pool combat.js already defines.
  ------------------------------------------------------- */

  if (
    outcomeType === "encounter" ||
    outcomeType === "elite_encounter"
  ) {
    try {
      const hunt =
        await createHunt(
          threadID,
          userID,
          {
            elite:
              outcomeType ===
              "elite_encounter",
          }
        );

      return {
        outcomeType,
        dorianLine:
          pickLine(outcomeType),
        hunt,
      };
    } catch (error) {
      /*
       * createHunt() should normally succeed because the
       * active-combat check was already performed above.
       *
       * If another combat was created between the check and
       * createHunt(), do not silently create another session.
       * The stamina remains consumed because exploration itself
       * already occurred and the encounter was rolled.
       */
      throw error;
    }
  }

  /* -------------------------------------------------------
     GOLD
  ------------------------------------------------------- */

  if (
    outcomeType === "gold"
  ) {
    const amount =
      randomInt(80, 420);

    await db.addBalance(
      threadID,
      userID,
      amount
    );

    return {
      outcomeType,
      dorianLine:
        pickLine("gold"),
      gold: amount,
    };
  }

  /* -------------------------------------------------------
     ITEM
  ------------------------------------------------------- */

  if (
    outcomeType === "item"
  ) {
    const itemID =
      TREASURE_ITEMS[
        randomInt(
          0,
          TREASURE_ITEMS.length - 1
        )
      ];

    await addItem(
      threadID,
      userID,
      itemID,
      1
    );

    return {
      outcomeType,
      dorianLine:
        pickLine("item"),
      item: getItem(itemID),
    };
  }

  /* -------------------------------------------------------
     NOTHING
  ------------------------------------------------------- */

  return {
    outcomeType: "nothing",
    dorianLine:
      pickLine("nothing"),
  };
}

/* =========================================================
   EXPORT
========================================================= */

module.exports = {
  EXPLORE_STAMINA_COST,
  explore,
};
