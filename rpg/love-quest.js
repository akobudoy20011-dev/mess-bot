"use strict";

const db = require("../db");
const { reply } = require("../util");

const QUEST_ID =
  process.env.LOVE_QUEST_ID || "the_last_star";

const SPECIAL_PLAYER_ID =
  String(process.env.SPECIAL_PLAYER_ID || "").trim();

const MAX_CHAPTER = 7;

const CHAPTERS = {
  1: "Another Day, Another Night",
  2: "The Distant Star",
  3: "Two Kingdoms",
  4: "The River",
  5: "The Home",
  6: "Everything",
  7: "Eternal",
};

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function isSpecialPlayer(senderID) {
  if (!SPECIAL_PLAYER_ID) return false;

  return String(senderID || "").trim() === SPECIAL_PLAYER_ID;
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) return [];

  return args
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function now() {
  return Date.now();
}

function formatQuestProgress(quest) {
  if (!quest) return "not started";

  if (quest.status === "completed") {
    return "completed";
  }

  const chapter = Number(quest.chapter || 1);
  const stage = Number(quest.stage || 0);

  return `Chapter ${chapter}/${MAX_CHAPTER} • Stage ${stage}`;
}

/*
 * ============================================================
 * DATABASE
 * ============================================================
 */

let tableReady = false;
let tablePromise = null;

async function ensureTable() {
  if (tableReady) return;

  if (tablePromise) {
    await tablePromise;
    return;
  }

  tablePromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS rpg_special_quests (
        thread_id     TEXT NOT NULL,
        player_id     TEXT NOT NULL,
        quest_id      TEXT NOT NULL,
        chapter       INTEGER NOT NULL DEFAULT 1,
        stage         INTEGER NOT NULL DEFAULT 0,
        status        TEXT NOT NULL DEFAULT 'active',
        started_at    BIGINT NOT NULL,
        updated_at    BIGINT NOT NULL,
        completed_at  BIGINT,
        PRIMARY KEY (thread_id, player_id, quest_id)
      );

      CREATE INDEX IF NOT EXISTS rpg_special_quests_player_idx
        ON rpg_special_quests (player_id, quest_id, status);

      CREATE INDEX IF NOT EXISTS rpg_special_quests_thread_idx
        ON rpg_special_quests (thread_id, player_id);
    `);

    tableReady = true;
  })();

  try {
    await tablePromise;
  } finally {
    tablePromise = null;
  }
}

/*
 * ============================================================
 * QUEST RETRIEVAL
 * ============================================================
 */

async function getQuest(threadID, playerID) {
  if (!isSpecialPlayer(playerID)) {
    return null;
  }

  await ensureTable();

  const result = await db.query(
    `
      SELECT
        thread_id,
        player_id,
        quest_id,
        chapter,
        stage,
        status,
        started_at,
        updated_at,
        completed_at
      FROM rpg_special_quests
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      LIMIT 1
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
    ]
  );

  return result.rows[0] || null;
}

/*
 * ============================================================
 * START QUEST
 * ============================================================
 */

async function startQuest(threadID, playerID) {
  if (!isSpecialPlayer(playerID)) {
    return null;
  }

  await ensureTable();

  const timestamp = now();

  const result = await db.query(
    `
      INSERT INTO rpg_special_quests (
        thread_id,
        player_id,
        quest_id,
        chapter,
        stage,
        status,
        started_at,
        updated_at,
        completed_at
      )
      VALUES ($1, $2, $3, 1, 0, 'active', $4, $4, NULL)
      ON CONFLICT (thread_id, player_id, quest_id)
      DO UPDATE SET
        updated_at = EXCLUDED.updated_at
      RETURNING
        thread_id,
        player_id,
        quest_id,
        chapter,
        stage,
        status,
        started_at,
        updated_at,
        completed_at
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      timestamp,
    ]
  );

  return result.rows[0] || null;
}

/*
 * ============================================================
 * UPDATE QUEST
 * ============================================================
 */

async function updateQuest(
  threadID,
  playerID,
  updates = {}
) {
  if (!isSpecialPlayer(playerID)) {
    return null;
  }

  await ensureTable();

  const current = await getQuest(threadID, playerID);

  if (!current) {
    return null;
  }

  const chapter =
    updates.chapter !== undefined
      ? Number(updates.chapter)
      : Number(current.chapter);

  const stage =
    updates.stage !== undefined
      ? Number(updates.stage)
      : Number(current.stage);

  const status =
    updates.status !== undefined
      ? String(updates.status)
      : String(current.status);

  const completedAt =
    updates.completed_at !== undefined
      ? updates.completed_at
      : current.completed_at;

  const timestamp = now();

  const result = await db.query(
    `
      UPDATE rpg_special_quests
      SET
        chapter = $1,
        stage = $2,
        status = $3,
        updated_at = $4,
        completed_at = $5
      WHERE thread_id = $6
        AND player_id = $7
        AND quest_id = $8
      RETURNING
        thread_id,
        player_id,
        quest_id,
        chapter,
        stage,
        status,
        started_at,
        updated_at,
        completed_at
    `,
    [
      chapter,
      stage,
      status,
      timestamp,
      completedAt,
      String(threadID),
      String(playerID),
      QUEST_ID,
    ]
  );

  return result.rows[0] || null;
}

/*
 * ============================================================
 * MESSAGING
 * ============================================================
 */

async function send(api, threadID, text) {
  return reply(api, threadID, text);
}

/*
 * ============================================================
 * CHAPTER 1
 * ============================================================
 */

async function chapterOne(api, threadID, playerID) {
  const quest = await getQuest(threadID, playerID);

  if (!quest) {
    await startQuest(threadID, playerID);
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Chapter I — Another Day, Another Night",
      "",
      "It was a really interesting day.",
      "",
      "A day I thought would simply pass by—",
      "another day, another night.",
      "",
      "But then, you came.",
      "",
      "I saw you like a star glittering in the sky.",
      "I thought you were too far beyond my grasp,",
      "but perhaps you weren't at all.",
      "",
      "Some encounters are written quietly.",
      "You don't notice their importance until later.",
      "",
      "And somehow...",
      "that moment became the beginning of everything.",
      "",
      "— Dorian",
    ].join("\n")
  );

  await updateQuest(threadID, playerID, {
    chapter: 2,
    stage: 0,
    status: "active",
  });
}

/*
 * ============================================================
 * CHAPTER 2
 * ============================================================
 */

async function chapterTwo(api, threadID, playerID) {
  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Chapter II — The Distant Star",
      "",
      "There was something about you that I couldn't explain.",
      "",
      "At first...",
      "I thought you were mean.",
      "",
      "You were emitting a rarefied air that I couldn't explain.",
      "Yet somehow, I was too captivated to give it a single thought.",
      "",
      "There was distance between us.",
      "",
      "Not the kind measured by roads or kingdoms.",
      "The kind measured by uncertainty.",
      "",
      "And still, I kept looking toward that star.",
      "",
      "Perhaps some stars are worth reaching for.",
    ].join("\n")
  );

  await updateQuest(threadID, playerID, {
    chapter: 3,
    stage: 0,
  });
}

/*
 * ============================================================
 * CHAPTER 3
 * ============================================================
 */

async function chapterThree(api, threadID, playerID) {
  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Chapter III — Two Kingdoms",
      "",
      "Not every story is peaceful.",
      "",
      "We've been through a lot.",
      "",
      "Breakups.",
      "Fights.",
      "Random nights when we both thought",
      "that letting go might be better.",
      "",
      "It sometimes felt like two kingdoms",
      "fighting over the same piece of land.",
      "",
      "Two suns refusing to share the same sky.",
      "",
      "But somehow...",
      "",
      "we fought through it.",
      "",
      "And that's why we are here.",
    ].join("\n")
  );

  await updateQuest(threadID, playerID, {
    chapter: 4,
    stage: 0,
  });
}

/*
 * ============================================================
 * CHAPTER 4
 * ============================================================
 */

async function chapterFour(api, threadID, playerID) {
  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Chapter IV — The River",
      "",
      "There are rivers that separate kingdoms.",
      "",
      "And there are rivers that connect them.",
      "",
      "Like the Nile...",
      "a single source of life flowing through",
      "a boundless desert.",
      "",
      "No matter how vast the land becomes,",
      "water still finds a way forward.",
      "",
      "Perhaps love is like that.",
      "",
      "It doesn't always travel in a straight line.",
      "",
      "Sometimes it bends.",
      "Sometimes it disappears beneath the earth.",
      "Sometimes it has to survive a desert.",
      "",
      "But it keeps flowing.",
    ].join("\n")
  );

  await updateQuest(threadID, playerID, {
    chapter: 5,
    stage: 0,
  });
}

/*
 * ============================================================
 * CHAPTER 5
 * ============================================================
 */

async function chapterFive(api, threadID, playerID) {
  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Chapter V — The Home",
      "",
      "You are very special to me.",
      "",
      "You are someone I'll never outgrow,",
      "someone I'll treasure for the rest of my life.",
      "",
      "And when I imagine the future...",
      "",
      "I don't imagine a throne.",
      "I don't imagine an empire.",
      "I don't imagine riches beyond the stars.",
      "",
      "I imagine a simple family.",
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
    ].join("\n")
  );

  await updateQuest(threadID, playerID, {
    chapter: 6,
    stage: 0,
  });
}

/*
 * ============================================================
 * CHAPTER 6
 * ============================================================
 */

async function chapterSix(api, threadID, playerID) {
  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Chapter VI — Everything",
      "",
      "Now, everything you see here will disappear one day.",
      "",
      "Everything.",
      "",
      "Including me.",
      "",
      "The kingdoms.",
      "The roads.",
      "The battles.",
      "The stars.",
      "The worlds we built.",
      "",
      "Everything eventually becomes silence.",
      "",
      "But you know what will live forever?",
      "",
      "My love for you.",
      "",
      "I know I cannot offer extravagant things at your feet,",
      "but I can offer you my vision for both of us.",
      "",
      "I can build our dreams together",
      "until the first break of dawn.",
      "",
      "We fought together.",
      "We hurt each other.",
      "",
      "Like two kingdoms and suns clashing",
      "over who is right.",
      "",
      "But in the end...",
      "",
      "none of that matters.",
    ].join("\n")
  );

  await updateQuest(threadID, playerID, {
    chapter: 7,
    stage: 0,
  });
}

/*
 * ============================================================
 * CHAPTER 7
 * ============================================================
 */

async function chapterSeven(api, threadID, playerID) {
  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Chapter VII — Eternal",
      "",
      "The world begins to disappear.",
      "",
      "The kingdoms fade.",
      "The roads vanish.",
      "The stars become distant.",
      "",
      "One by one...",
      "everything becomes nothing.",
    ].join("\n")
  );

  await new Promise((resolve) =>
    setTimeout(resolve, 1200)
  );

  await send(
    api,
    threadID,
    [
      "The sky is empty now.",
      "",
      "No kingdoms.",
      "No wars.",
      "No borders.",
      "No throne.",
      "",
      "Just you.",
      "",
      "And me.",
    ].join("\n")
  );

  await new Promise((resolve) =>
    setTimeout(resolve, 1200)
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
    ].join("\n")
  );

  await new Promise((resolve) =>
    setTimeout(resolve, 1200)
  );

  await send(
    api,
    threadID,
    [
      "So, my love...",
      "",
      "Stay until everything collapses.",
      "",
      "Stay until the galaxy itself",
      "dissipates into nothingness.",
    ].join("\n")
  );

  await new Promise((resolve) =>
    setTimeout(resolve, 1400)
  );

  await send(
    api,
    threadID,
    [
      "Because I promise you",
      "",
      "eternal love",
      "",
      "in return.",
    ].join("\n")
  );

  await new Promise((resolve) =>
    setTimeout(resolve, 1500)
  );

  await send(
    api,
    threadID,
    [
      "∞",
      "",
      "THE PERSON I WOULD CHOOSE",
      "IN EVERY WORLD",
      "",
      "❤️",
    ].join("\n")
  );

  await updateQuest(threadID, playerID, {
    chapter: MAX_CHAPTER,
    stage: 1,
    status: "completed",
    completed_at: now(),
  });
}

/*
 * ============================================================
 * CONTINUE QUEST
 * ============================================================
 */

async function continueQuest(api, threadID, playerID) {
  const quest = await getQuest(threadID, playerID);

  if (!quest) {
    await startQuest(threadID, playerID);
    await chapterOne(api, threadID, playerID);
    return true;
  }

  if (quest.status === "completed") {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "This story has already reached its end.",
        "",
        "But some things don't really end.",
        "",
        "∞ ❤️",
      ].join("\n")
    );

    return true;
  }

  switch (Number(quest.chapter)) {
    case 1:
      await chapterOne(api, threadID, playerID);
      break;

    case 2:
      await chapterTwo(api, threadID, playerID);
      break;

    case 3:
      await chapterThree(api, threadID, playerID);
      break;

    case 4:
      await chapterFour(api, threadID, playerID);
      break;

    case 5:
      await chapterFive(api, threadID, playerID);
      break;

    case 6:
      await chapterSix(api, threadID, playerID);
      break;

    case 7:
      await chapterSeven(api, threadID, playerID);
      break;

    default:
      await updateQuest(threadID, playerID, {
        chapter: 1,
        stage: 0,
        status: "active",
      });

      await chapterOne(api, threadID, playerID);
      break;
  }

  return true;
}

/*
 * ============================================================
 * DISCOVER HIDDEN QUEST
 * ============================================================
 *
 * FIRST SUCCESSFUL !rpg explore = GUARANTEED DISCOVERY.
 *
 * After discovery, this function does nothing because the quest
 * already exists in PostgreSQL.
 *
 * No random 1% roll is used here.
 * ============================================================
 */

async function discover(api, threadID, playerID) {
  if (!isSpecialPlayer(playerID)) {
    return false;
  }

  const existing = await getQuest(
    threadID,
    playerID
  );

  /*
   * Already discovered.
   * Never trigger the discovery message again.
   */
  if (existing) {
    return false;
  }

  /*
   * FIRST successful !rpg explore:
   * 100% guaranteed discovery.
   */
  await startQuest(
    threadID,
    playerID
  );

  await send(
    api,
    threadID,
    [
      "🌌 Something feels different.",
      "",
      "For a moment, Dorian stops speaking.",
      "",
      "The path ahead is unfamiliar.",
      "",
      "A single light shines between the trees.",
      "",
      "It doesn't look like a torch.",
      "",
      "It looks like a star.",
      "",
      "🧑‍🏫 Dorian:",
      "\"I've never seen this place before.\"",
      "",
      "A faint inscription appears beneath the light:",
      "",
      "THE LAST STAR",
      "",
      "Perhaps this is a place meant to be followed.",
      "",
      "Use:",
      "!rpg laststar follow",
    ].join("\n")
  );

  return true;
}

/*
 * ============================================================
 * FOLLOW QUEST
 * ============================================================
 */

async function followQuest(
  api,
  threadID,
  playerID
) {
  if (!isSpecialPlayer(playerID)) {
    return false;
  }

  let quest = await getQuest(
    threadID,
    playerID
  );

  if (!quest) {
    quest = await startQuest(
      threadID,
      playerID
    );
  }

  if (!quest) {
    return false;
  }

  if (quest.status === "completed") {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "The star has already shown you the end of the journey.",
        "",
        "∞ ❤️",
      ].join("\n")
    );

    return true;
  }

  await continueQuest(
    api,
    threadID,
    playerID
  );

  return true;
}

/*
 * ============================================================
 * READ QUEST STATUS
 * ============================================================
 */

async function readQuest(
  api,
  threadID,
  playerID
) {
  if (!isSpecialPlayer(playerID)) {
    return false;
  }

  const quest = await getQuest(
    threadID,
    playerID
  );

  if (!quest) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "No record of this story has been found.",
      ].join("\n")
    );

    return true;
  }

  const chapter =
    Number(quest.chapter || 1);

  const chapterName =
    CHAPTERS[chapter] || "Unknown";

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      `Status: ${
        quest.status === "completed"
          ? "COMPLETED"
          : "ACTIVE"
      }`,
      `Chapter: ${chapter}/${MAX_CHAPTER}`,
      `Title: ${chapterName}`,
      `Stage: ${Number(quest.stage || 0)}`,
      "",
      "Some journeys are not meant to be rushed.",
    ].join("\n")
  );

  return true;
}

/*
 * ============================================================
 * RESET QUEST
 * ============================================================
 */

async function resetQuest(
  threadID,
  playerID
) {
  if (!isSpecialPlayer(playerID)) {
    return false;
  }

  await ensureTable();

  await db.query(
    `
      DELETE FROM rpg_special_quests
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
    ]
  );

  return true;
}

/*
 * ============================================================
 * MAIN COMMAND HANDLER
 * ============================================================
 *
 * IMPORTANT:
 * This MUST return false for normal RPG commands.
 *
 * Only !rpg laststar ... is intercepted.
 * ============================================================
 */

async function handleLoveQuestCommand(
  api,
  threadID,
  senderID,
  args = []
) {
  /*
   * Never interfere with normal players.
   */
  if (!isSpecialPlayer(senderID)) {
    return false;
  }

  const parts = normalizeArgs(args);

  if (!parts.length) {
    return false;
  }

  /*
   * Only intercept the Last Star command.
   */
  const root =
    parts[0].toLowerCase();

  if (
    root !== "laststar" &&
    root !== "last-star" &&
    root !== "thelaststar" &&
    root !== "the-last-star"
  ) {
    return false;
  }

  const action =
    (parts[1] || "follow").toLowerCase();

  switch (action) {
    case "follow":
    case "start":
    case "begin":
      return followQuest(
        api,
        threadID,
        senderID
      );

    case "continue":
    case "next":
      return continueQuest(
        api,
        threadID,
        senderID
      );

    case "read":
    case "status":
    case "progress":
      return readQuest(
        api,
        threadID,
        senderID
      );

    case "choose": {
      const choice = parts
        .slice(2)
        .join(" ")
        .trim()
        .toLowerCase();

      if (!choice) {
        await send(
          api,
          threadID,
          [
            "✦ THE LAST STAR ✦",
            "",
            "There is no choice waiting here yet.",
            "",
            "Use:",
            "!rpg laststar continue",
          ].join("\n")
        );

        return true;
      }

      await send(
        api,
        threadID,
        [
          "✦ THE LAST STAR ✦",
          "",
          `You chose: ${choice}`,
          "",
          "The story remembers your choice.",
        ].join("\n")
      );

      return true;
    }

    default:
      await send(
        api,
        threadID,
        [
          "✦ THE LAST STAR ✦",
          "",
          "Available actions:",
          "",
          "!rpg laststar follow",
          "!rpg laststar continue",
          "!rpg laststar read",
        ].join("\n")
      );

      return true;
  }
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  QUEST_ID,
  SPECIAL_PLAYER_ID,
  MAX_CHAPTER,
  CHAPTERS,

  isSpecialPlayer,

  ensureTable,
  getQuest,
  startQuest,
  updateQuest,

  discover,
  followQuest,
  continueQuest,
  readQuest,

  resetQuest,

  handleLoveQuestCommand,
};
