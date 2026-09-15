"use strict";

/*
 * ============================================================
 * THE LAST STAR — SECRET LOVE QUEST
 * ============================================================
 *
 * Standalone special RPG quest.
 *
 * IMPORTANT:
 * - Only the configured SPECIAL_PLAYER_ID can access it.
 * - Progress is persisted in PostgreSQL through db.query().
 * - This file does NOT replace or modify the normal RPG systems.
 *
 * Environment variable:
 *
 *   SPECIAL_PLAYER_ID=HER_MESSENGER_ID
 *
 * Optional:
 *
 *   LOVE_QUEST_ID=the_last_star
 *
 * ============================================================
 */

const db = require("../db");
const { reply } = require("../util");

const QUEST_ID =
  process.env.LOVE_QUEST_ID || "the_last_star";

const SPECIAL_PLAYER_ID =
  process.env.SPECIAL_PLAYER_ID || "";

/*
 * ------------------------------------------------------------
 * CONFIG
 * ------------------------------------------------------------
 */

const MAX_CHAPTER = 7;

/*
 * Small delays are intentionally handled by the caller/router.
 * This module itself does not create long-running timers.
 */

const CHAPTER_NAMES = {
  1: "ANOTHER DAY, ANOTHER NIGHT",
  2: "THE DISTANT STAR",
  3: "TWO KINGDOMS",
  4: "THE RIVER",
  5: "THE HOME",
  6: "EVERYTHING",
  7: "ETERNAL",
};

/*
 * ------------------------------------------------------------
 * DATABASE
 * ------------------------------------------------------------
 *
 * This module expects db.query(text, params).
 *
 * The table is created lazily so the quest does not require
 * a separate manual migration before testing.
 * ------------------------------------------------------------
 */

let tableReadyPromise = null;

async function ensureTable() {
  if (!db || typeof db.query !== "function") {
    throw new Error(
      "love-quest.js requires db.query() to be exported from ../db"
    );
  }

  if (!tableReadyPromise) {
    tableReadyPromise = db.query(`
      CREATE TABLE IF NOT EXISTS rpg_special_quests (
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        chapter INTEGER NOT NULL DEFAULT 1,
        stage TEXT NOT NULL DEFAULT 'start',
        status TEXT NOT NULL DEFAULT 'active',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        PRIMARY KEY (player_id, quest_id)
      )
    `);
  }

  await tableReadyPromise;
}

/*
 * ------------------------------------------------------------
 * ACCESS CONTROL
 * ------------------------------------------------------------
 */

function isSpecialPlayer(senderID) {
  if (!SPECIAL_PLAYER_ID) {
    return false;
  }

  return String(senderID) === String(SPECIAL_PLAYER_ID);
}

/*
 * ------------------------------------------------------------
 * QUEST STATE
 * ------------------------------------------------------------
 */

async function getQuest(senderID) {
  await ensureTable();

  const result = await db.query(
    `
      SELECT
        player_id,
        quest_id,
        chapter,
        stage,
        status,
        started_at,
        updated_at,
        completed_at
      FROM rpg_special_quests
      WHERE player_id = $1
        AND quest_id = $2
      LIMIT 1
    `,
    [String(senderID), QUEST_ID]
  );

  return result.rows?.[0] || null;
}

async function startQuest(senderID) {
  await ensureTable();

  const result = await db.query(
    `
      INSERT INTO rpg_special_quests (
        player_id,
        quest_id,
        chapter,
        stage,
        status
      )
      VALUES ($1, $2, 1, 'start', 'active')
      ON CONFLICT (player_id, quest_id)
      DO UPDATE SET
        updated_at = NOW()
      RETURNING *
    `,
    [String(senderID), QUEST_ID]
  );

  return result.rows?.[0] || null;
}

async function updateQuest(senderID, chapter, stage, status = "active") {
  await ensureTable();

  const completedAt =
    status === "completed"
      ? "NOW()"
      : "NULL";

  const result = await db.query(
    `
      UPDATE rpg_special_quests
      SET
        chapter = $1,
        stage = $2,
        status = $3,
        updated_at = NOW(),
        completed_at = ${completedAt}
      WHERE player_id = $4
        AND quest_id = $5
      RETURNING *
    `,
    [
      Number(chapter),
      String(stage),
      String(status),
      String(senderID),
      QUEST_ID,
    ]
  );

  return result.rows?.[0] || null;
}

/*
 * ------------------------------------------------------------
 * MESSAGE HELPER
 * ------------------------------------------------------------
 */

async function send(api, threadID, message) {
  return reply(api, threadID, message);
}

/*
 * ------------------------------------------------------------
 * ACCESS / DISCOVERY
 * ------------------------------------------------------------
 *
 * Called by exploration or another RPG system when the special
 * player has a chance to discover the hidden location.
 * ------------------------------------------------------------
 */

async function discover(api, threadID, senderID) {
  if (!isSpecialPlayer(senderID)) {
    return false;
  }

  const existing = await getQuest(senderID);

  if (existing) {
    return false;
  }

  await send(
    api,
    threadID,
    [
      "🌌 UNKNOWN LOCATION DISCOVERED",
      "",
      "The world around you suddenly becomes quiet.",
      "",
      "There is no enemy.",
      "No treasure.",
      "No warning.",
      "",
      "Only a single star hanging unusually low in the sky.",
      "",
      "You have never seen this place before.",
      "",
      "Location:",
      "「THE LAST STAR」",
      "",
      "Something tells you to follow it.",
      "",
      "Type:",
      "!rpg laststar follow",
    ].join("\n")
  );

  return true;
}

/*
 * ------------------------------------------------------------
 * CHAPTER 1
 * ------------------------------------------------------------
 */

async function chapterOne(api, threadID, senderID) {
  await updateQuest(senderID, 1, "followed");

  await send(
    api,
    threadID,
    [
      "🌌 THE LAST STAR",
      "",
      "You follow the light.",
      "",
      "For some reason, this place feels familiar.",
      "",
      "The traveler beside you speaks:",
      "",
      "\"Funny, isn't it?\"",
      "",
      "\"Sometimes the days we think will mean nothing",
      "become the days we remember forever.\"",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "CHAPTER I — ANOTHER DAY, ANOTHER NIGHT",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "The star begins to shine brighter.",
      "",
      "Something tells you that this journey",
      "has only just begun.",
      "",
      "Next:",
      "!rpg laststar continue",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * CHAPTER 2
 * ------------------------------------------------------------
 */

async function chapterTwo(api, threadID, senderID) {
  await updateQuest(senderID, 2, "choice");

  await send(
    api,
    threadID,
    [
      "🌌 THE DISTANT STAR",
      "",
      "A star shines far beyond the horizon.",
      "",
      "It looks impossibly distant.",
      "",
      "The traveler asks:",
      "",
      "\"Would you chase something",
      "you believed you could never reach?\"",
      "",
      "Choose:",
      "",
      "1. Chase the star",
      "2. Wait for it",
      "3. Walk away",
      "",
      "!rpg laststar choose 1",
      "!rpg laststar choose 2",
      "!rpg laststar choose 3",
    ].join("\n")
  );
}

async function chapterTwoChoice(
  api,
  threadID,
  senderID,
  choice
) {
  const valid = ["1", "2", "3"];

  if (!valid.includes(choice)) {
    await send(
      api,
      threadID,
      "Choose 1, 2, or 3."
    );
    return;
  }

  await updateQuest(senderID, 2, `choice_${choice}`);

  await send(
    api,
    threadID,
    [
      "The traveler watches you quietly.",
      "",
      "\"Perhaps distance isn't always measured",
      "by how far something is.\"",
      "",
      "The star begins moving closer.",
      "",
      "Closer.",
      "",
      "Until its light touches the ground before you.",
      "",
      "You realize something:",
      "",
      "Some people appear impossibly far away",
      "until one day, somehow...",
      "",
      "they become part of your world.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "CHAPTER II — THE DISTANT STAR",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "Next:",
      "!rpg laststar continue",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * CHAPTER 3
 * ------------------------------------------------------------
 */

async function chapterThree(api, threadID, senderID) {
  await updateQuest(senderID, 3, "battlefield");

  await send(
    api,
    threadID,
    [
      "⚔️ THE KINGDOMS OF SUN AND MOON",
      "",
      "Two kingdoms stand opposite each other.",
      "",
      "Neither will yield.",
      "Neither believes it is wrong.",
      "",
      "Their armies have been fighting for years.",
      "",
      "The traveler speaks:",
      "",
      "\"Sometimes two people can love each other",
      "and still hurt each other.\"",
      "",
      "The battlefield falls silent.",
      "",
      "Three choices stand before you:",
      "",
      "1. Fight for your kingdom",
      "2. Lower your weapon",
      "3. Walk away",
      "",
      "!rpg laststar choose 1",
      "!rpg laststar choose 2",
      "!rpg laststar choose 3",
    ].join("\n")
  );
}

async function chapterThreeChoice(
  api,
  threadID,
  senderID,
  choice
) {
  const valid = ["1", "2", "3"];

  if (!valid.includes(choice)) {
    await send(
      api,
      threadID,
      "Choose 1, 2, or 3."
    );
    return;
  }

  await updateQuest(senderID, 3, `choice_${choice}`);

  await send(
    api,
    threadID,
    [
      "The armies collide.",
      "",
      "Steel strikes steel.",
      "The sky burns with the light of two suns.",
      "",
      "Then...",
      "",
      "silence.",
      "",
      "The armies stop.",
      "",
      "There is no victor.",
      "",
      "Because neither side was ever truly",
      "fighting to destroy the other.",
      "",
      "They were simply trying to be understood.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "CHAPTER III — TWO KINGDOMS",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "You've been through a lot.",
      "",
      "Breakups.",
      "Fights.",
      "Random nights when letting go",
      "seemed like it might be easier.",
      "",
      "But somehow...",
      "",
      "you both kept fighting through it.",
      "",
      "And that is why the story continued.",
      "",
      "Next:",
      "!rpg laststar continue",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * CHAPTER 4
 * ------------------------------------------------------------
 */

async function chapterFour(api, threadID, senderID) {
  await updateQuest(senderID, 4, "desert");

  await send(
    api,
    threadID,
    [
      "🏜️ THE BOUNDLESS DESERT",
      "",
      "There is nothing here.",
      "",
      "No kingdoms.",
      "No armies.",
      "No roads.",
      "",
      "Only endless sand.",
      "",
      "You walk for what feels like hours.",
      "",
      "The heat becomes unbearable.",
      "",
      "Then...",
      "",
      "you hear something.",
      "",
      "Water.",
      "",
      "You follow the sound.",
      "",
      "Type:",
      "!rpg laststar continue",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * CHAPTER 4 CONTINUATION
 * ------------------------------------------------------------
 */

async function chapterFourRiver(
  api,
  threadID,
  senderID
) {
  await updateQuest(senderID, 4, "river");

  await send(
    api,
    threadID,
    [
      "🌊 THE RIVER",
      "",
      "A river cuts through the desert.",
      "",
      "Its water is clear.",
      "",
      "Life grows around it.",
      "",
      "Flowers.",
      "Trees.",
      "Animals.",
      "",
      "For the first time since entering this world...",
      "",
      "you feel at peace.",
      "",
      "The traveler asks:",
      "",
      "\"Do you understand now?\"",
      "",
      "\"Some people don't need to change",
      "the entire world.\"",
      "",
      "\"Sometimes their existence alone",
      "makes your world feel alive.\"",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "CHAPTER IV — THE RIVER",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "Everything about you makes my heart feel at ease.",
      "",
      "Like the Nile, a single source of life",
      "flowing through a boundless desert.",
      "",
      "Next:",
      "!rpg laststar continue",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * CHAPTER 5
 * ------------------------------------------------------------
 */

async function chapterFive(api, threadID, senderID) {
  await updateQuest(senderID, 5, "kingdom");

  await send(
    api,
    threadID,
    [
      "🏰 THE KINGDOM OF EVERYTHING",
      "",
      "You arrive at the greatest kingdom",
      "you have ever seen.",
      "",
      "Gold.",
      "Armies.",
      "Castles.",
      "Treasures.",
      "Power.",
      "",
      "Everything a ruler could want.",
      "",
      "The traveler asks:",
      "",
      "\"What would you choose?\"",
      "",
      "1. The crown",
      "2. The kingdom",
      "3. Something else",
      "",
      "!rpg laststar choose 1",
      "!rpg laststar choose 2",
      "!rpg laststar choose 3",
    ].join("\n")
  );
}

async function chapterFiveChoice(
  api,
  threadID,
  senderID,
  choice
) {
  const valid = ["1", "2", "3"];

  if (!valid.includes(choice)) {
    await send(
      api,
      threadID,
      "Choose 1, 2, or 3."
    );
    return;
  }

  await updateQuest(senderID, 5, `choice_${choice}`);

  await send(
    api,
    threadID,
    [
      "The crown disappears.",
      "",
      "The gold disappears.",
      "",
      "The armies disappear.",
      "",
      "The castle disappears.",
      "",
      "The entire kingdom fades away.",
      "",
      "You are left standing beneath",
      "an ordinary evening sky.",
      "",
      "Then you see it.",
      "",
      "🏠 A SMALL HOUSE",
      "",
      "Warm light shines through the windows.",
      "",
      "There is nothing extravagant about it.",
      "",
      "But somehow...",
      "",
      "it feels like home.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "CHAPTER V — THE HOME",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "A simple family.",
      "",
      "You.",
      "Our children.",
      "A house.",
      "",
      "It might sound simple.",
      "",
      "But it's all I need.",
      "",
      "It's you.",
      "",
      "Next:",
      "!rpg laststar continue",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * CHAPTER 6
 * ------------------------------------------------------------
 */

async function chapterSix(api, threadID, senderID) {
  await updateQuest(senderID, 6, "collapse");

  await send(
    api,
    threadID,
    [
      "⚠️ WORLD EVENT",
      "",
      "Something is happening to the world.",
      "",
      "The forests disappear.",
      "",
      "The kingdoms disappear.",
      "",
      "The roads disappear.",
      "",
      "The dungeons disappear.",
      "",
      "The treasures disappear.",
      "",
      "The map begins fading.",
      "",
      "Then...",
      "",
      "🌌 THE STARS BEGIN TO DISAPPEAR",
      "",
      "One by one.",
      "",
      "Everything you have seen here",
      "will disappear one day.",
      "",
      "Everything.",
      "",
      "The kingdoms.",
      "The treasures.",
      "The battles.",
      "The roads.",
      "",
      "Even the people who walked them.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "CHAPTER VI — EVERYTHING",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "There is only one star left.",
      "",
      "Continue?",
      "",
      "!rpg laststar continue",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * CHAPTER 7
 * ------------------------------------------------------------
 */

async function chapterSeven(api, threadID, senderID) {
  await updateQuest(senderID, 7, "eternal");

  await send(
    api,
    threadID,
    [
      "🌌 THE LAST STAR",
      "",
      "You have reached the end.",
      "",
      "There is no enemy waiting for you.",
      "",
      "No treasure.",
      "",
      "No kingdom.",
      "",
      "No final boss.",
      "",
      "Only one star remains.",
      "",
      "The traveler looks toward it.",
      "",
      "\"Some things disappear because",
      "they were never meant to last.\"",
      "",
      "\"But some things...\"",
      "",
      "\"...are worth believing will last forever.\"",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "CHAPTER VII — ETERNAL",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "The star shines.",
      "",
      "Everything becomes quiet.",
      "",
      "There is only one thing left.",
      "",
      "!rpg laststar read",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * FINAL MESSAGE
 * ------------------------------------------------------------
 */

async function finalMessage(
  api,
  threadID,
  senderID
) {
  await updateQuest(
    senderID,
    MAX_CHAPTER,
    "complete",
    "completed"
  );

  /*
   * Deliberately split into multiple messages.
   * It makes the final reveal feel like a letter rather than
   * one giant wall of text.
   */

  await send(
    api,
    threadID,
    [
      "🌌 THE LAST STAR",
      "",
      "Now, everything you see here will disappear one day.",
      "",
      "Everything—including me.",
      "",
      "But you know what will live forever, for eons?",
      "",
      "My love for you.",
    ].join("\n")
  );

  await send(
    api,
    threadID,
    [
      "I know I cannot offer extravagant things at your feet,",
      "but I can offer you my vision for both of us.",
      "",
      "I can build our dreams together",
      "until the first break of dawn.",
    ].join("\n")
  );

  await send(
    api,
    threadID,
    [
      "We fought together.",
      "",
      "We hurt each other—",
      "like two kingdoms and suns",
      "clashing over who is right.",
      "",
      "But in the end...",
      "",
      "none of that matters.",
    ].join("\n")
  );

  await send(
    api,
    threadID,
    [
      "What good is a world if you are not here?",
      "",
      "What will the stars in the sky do",
      "if they have no one to guide me to you?",
      "",
      "You are far more important than anything.",
      "",
      "Like the Nile, a single source of life",
      "flowing through a boundless desert.",
    ].join("\n")
  );

  await send(
    api,
    threadID,
    [
      "So, my love...",
      "",
      "stay until everything collapses.",
      "",
      "Until the galaxy itself",
      "dissipates into nothingness.",
      "",
      "For I promise you eternal love in return.",
    ].join("\n")
  );

  await send(
    api,
    threadID,
    [
      "╔══════════════════════════════╗",
      "        QUEST COMPLETE",
      "╚══════════════════════════════╝",
      "",
      "「THE LAST STAR」",
      "",
      "There was never a treasure.",
      "There was never a kingdom.",
      "There was never a final boss.",
      "",
      "The entire journey existed",
      "for one person.",
      "",
      "❤️",
      "",
      "ACHIEVEMENT UNLOCKED",
      "",
      "「THE PERSON I WOULD CHOOSE",
      "  IN EVERY WORLD」",
      "",
      "Reward:",
      "∞ ❤️",
    ].join("\n")
  );
}

/*
 * ------------------------------------------------------------
 * COMMAND HANDLER
 * ------------------------------------------------------------
 *
 * Returns:
 *   true  = this command belonged to the secret quest
 *   false = normal RPG should handle it
 * ------------------------------------------------------------
 */

async function handleLoveQuestCommand(
  api,
  threadID,
  senderID,
  args = []
) {
  /*
   * Never reveal the existence of the quest to other players.
   */

  if (!isSpecialPlayer(senderID)) {
    return false;
  }

  const command = String(args[0] || "")
    .trim()
    .toLowerCase();

  const subArg = String(args[1] || "")
    .trim()
    .toLowerCase();

  /*
   * !rpg laststar
   */

  if (!command || command === "laststar") {
    const quest = await getQuest(senderID);

    if (!quest) {
      await send(
        api,
        threadID,
        [
          "🌌 A faint star appears in the distance.",
          "",
          "Something about it feels familiar.",
          "",
          "Type:",
          "!rpg laststar follow",
        ].join("\n")
      );

      return true;
    }

    if (quest.status === "completed") {
      await send(
        api,
        threadID,
        [
          "🌌 THE LAST STAR",
          "",
          "This journey has already been completed.",
          "",
          "Some stories only need to be told once.",
          "",
          "❤️",
        ].join("\n")
      );

      return true;
    }

    await send(
      api,
      threadID,
      [
        "🌌 THE LAST STAR",
        "",
        `Current Chapter: ${quest.chapter}`,
        `「${CHAPTER_NAMES[quest.chapter] || "UNKNOWN"}」`,
        "",
        `Stage: ${quest.stage}`,
        "",
        "Continue:",
        "!rpg laststar continue",
      ].join("\n")
    );

    return true;
  }

  /*
   * FOLLOW
   */

  if (command === "follow") {
    const quest = await getQuest(senderID);

    if (quest) {
      await send(
        api,
        threadID,
        [
          "The star is already waiting for you.",
          "",
          "Continue:",
          "!rpg laststar continue",
        ].join("\n")
      );

      return true;
    }

    await startQuest(senderID);
    await chapterOne(api, threadID, senderID);

    return true;
  }

  /*
   * CONTINUE
   */

  if (command === "continue") {
    const quest = await getQuest(senderID);

    if (!quest) {
      await send(
        api,
        threadID,
        [
          "You haven't discovered this journey yet.",
          "",
          "Explore until you find the star.",
        ].join("\n")
      );

      return true;
    }

    if (quest.status === "completed") {
      await send(
        api,
        threadID,
        "🌌 THE LAST STAR has already been completed. ❤️"
      );

      return true;
    }

    switch (Number(quest.chapter)) {
      case 1:
        await chapterTwo(api, threadID, senderID);
        break;

      case 2:
        await chapterThree(api, threadID, senderID);
        break;

      case 3:
        await chapterFour(api, threadID, senderID);
        break;

      case 4:
        if (quest.stage === "desert") {
          await chapterFourRiver(
            api,
            threadID,
            senderID
          );
        } else {
          await chapterFive(
            api,
            threadID,
            senderID
          );
        }
        break;

      case 5:
        await chapterSix(api, threadID, senderID);
        break;

      case 6:
        await chapterSeven(api, threadID, senderID);
        break;

      case 7:
        await finalMessage(
          api,
          threadID,
          senderID
        );
        break;

      default:
        await send(
          api,
          threadID,
          [
            "The star flickers.",
            "",
            "Something went wrong with the journey.",
            "",
            "Please continue again:",
            "!rpg laststar continue",
          ].join("\n")
        );
        break;
    }

    return true;
  }

  /*
   * CHAPTER CHOICES
   */

  if (command === "choose") {
    const quest = await getQuest(senderID);

    if (!quest) {
      await send(
        api,
        threadID,
        "You haven't started THE LAST STAR."
      );

      return true;
    }

    if (!["1", "2", "3"].includes(subArg)) {
      await send(
        api,
        threadID,
        "Choose 1, 2, or 3."
      );

      return true;
    }

    switch (Number(quest.chapter)) {
      case 2:
        await chapterTwoChoice(
          api,
          threadID,
          senderID,
          subArg
        );
        break;

      case 3:
        await chapterThreeChoice(
          api,
          threadID,
          senderID,
          subArg
        );
        break;

      case 5:
        await chapterFiveChoice(
          api,
          threadID,
          senderID,
          subArg
        );
        break;

      default:
        await send(
          api,
          threadID,
          "There is no choice to make here."
        );
        break;
    }

    return true;
  }

  /*
   * FINAL READ
   */

  if (command === "read") {
    const quest = await getQuest(senderID);

    if (!quest) {
      await send(
        api,
        threadID,
        "The final star has not been reached yet."
      );

      return true;
    }

    if (Number(quest.chapter) < 7) {
      await send(
        api,
        threadID,
        "You haven't reached the final chapter yet."
      );

      return true;
    }

    await finalMessage(
      api,
      threadID,
      senderID
    );

    return true;
  }

  /*
   * Unknown secret-quest subcommand.
   *
   * Keep it secret rather than revealing the whole quest
   * structure to other users.
   */

  await send(
    api,
    threadID,
    [
      "🌌 The last star flickers.",
      "",
      "Try:",
      "!rpg laststar",
      "!rpg laststar continue",
    ].join("\n")
  );

  return true;
}

/*
 * ------------------------------------------------------------
 * EXPORTS
 * ------------------------------------------------------------
 */

module.exports = {
  QUEST_ID,
  isSpecialPlayer,
  ensureTable,
  getQuest,
  startQuest,
  updateQuest,
  discover,
  handleLoveQuestCommand,
};
