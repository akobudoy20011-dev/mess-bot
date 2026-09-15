"use strict";

const db = require("../db");
const { reply } = require("../util");

const QUEST_ID =
  process.env.LOVE_QUEST_ID || "the_last_star";

const SPECIAL_PLAYER_ID =
  String(process.env.SPECIAL_PLAYER_ID || "").trim();

const MAX_CHAPTER = 20;

/*
 * ============================================================
 * THE LAST STAR
 * ============================================================
 *
 * Hidden personal quest.
 *
 * Chapters 1–7:
 *   Part I — The Last Star
 *
 * Chapters 8–20:
 *   Part II — After Everything
 *
 * Chapter 7 awards:
 *   💰 10,000 coins
 *   ✨ 1,000 XP
 *   👑 The Loved One
 *
 * The reward is one-time only.
 *
 * Existing players who already have Chapter 7 marked
 * "completed" can continue directly into Chapter 8.
 *
 * ============================================================
 */

/*
 * ============================================================
 * CHAPTERS
 * ============================================================
 */

const CHAPTERS = {
  1: "Another Day, Another Night",
  2: "The Distant Star",
  3: "Two Kingdoms",
  4: "The River",
  5: "The Home",
  6: "Everything",
  7: "Eternal",

  8: "The Morning After",
  9: "The World We Remember",
  10: "The First Home",
  11: "The New Kingdom",
  12: "The Two Suns",
  13: "The Promise",
  14: "The Road Between Stars",
  15: "The Garden",
  16: "The Silence Between Words",
  17: "The Last War",
  18: "The Choice We Keep",
  19: "The Story",
  20: "The Beginning After Forever",
};

/*
 * Number of story stages in each chapter.
 *
 * 0 = main scene
 * 1 = second scene / choice
 *
 * Chapter 20 is the final ending and has only one stage.
 */

const CHAPTER_STAGES = {
  1: 2,
  2: 2,
  3: 2,
  4: 2,
  5: 2,
  6: 2,
  7: 1,

  8: 2,
  9: 2,
  10: 2,
  11: 2,
  12: 2,
  13: 2,
  14: 2,
  15: 2,
  16: 2,
  17: 2,
  18: 2,
  19: 2,
  20: 1,
};

/*
 * ============================================================
 * REWARD
 * ============================================================
 */

const LOVE_QUEST_REWARD = {
  coins: 10000,
  xp: 1000,
  title: "The Loved One",
};

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function isSpecialPlayer(senderID) {
  if (!SPECIAL_PLAYER_ID) return false;

  return (
    String(senderID || "").trim() ===
    SPECIAL_PLAYER_ID
  );
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

  const chapter = Number(quest.chapter || 1);
  const stage = Number(quest.stage || 0);

  if (
    quest.status === "completed" &&
    chapter >= MAX_CHAPTER
  ) {
    return "completed";
  }

  if (
    quest.status === "part1_completed" ||
    (chapter === 7 && quest.status === "completed")
  ) {
    return `Part I complete • Chapter 7/${MAX_CHAPTER}`;
  }

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
    /*
     * Create the table if it does not exist.
     */

    await db.query(`
      CREATE TABLE IF NOT EXISTS rpg_special_quests (
        thread_id     TEXT NOT NULL,
        player_id     TEXT NOT NULL,
        quest_id      TEXT NOT NULL,
        chapter       INTEGER NOT NULL DEFAULT 1,
        stage         INTEGER NOT NULL DEFAULT 0,
        status        TEXT NOT NULL DEFAULT 'active',
        choice        TEXT,
        started_at    BIGINT NOT NULL,
        updated_at    BIGINT NOT NULL,
        completed_at  BIGINT,
        PRIMARY KEY (thread_id, player_id, quest_id)
      );
    `);

    /*
     * Migrations for existing installations.
     */

    await db.query(`
      ALTER TABLE rpg_special_quests
        ADD COLUMN IF NOT EXISTS choice TEXT;
    `);

    await db.query(`
      ALTER TABLE rpg_special_quests
        ADD COLUMN IF NOT EXISTS reward_claimed BOOLEAN
        NOT NULL DEFAULT FALSE;
    `);

    await db.query(`
      ALTER TABLE rpg_special_quests
        ADD COLUMN IF NOT EXISTS title TEXT;
    `);

    /*
     * Helpful indexes.
     */

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        rpg_special_quests_player_idx
        ON rpg_special_quests
        (player_id, quest_id, status);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS
        rpg_special_quests_thread_idx
        ON rpg_special_quests
        (thread_id, player_id);
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
      choice,
      started_at,
      updated_at,
      completed_at,
      reward_claimed,
      title
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
      choice,
      started_at,
      updated_at,
      completed_at,
      reward_claimed,
      title
    )
    VALUES (
      $1,
      $2,
      $3,
      1,
      0,
      'active',
      NULL,
      $4,
      $4,
      NULL,
      FALSE,
      NULL
    )
    ON CONFLICT (
      thread_id,
      player_id,
      quest_id
    )
    DO UPDATE SET
      updated_at = EXCLUDED.updated_at

    RETURNING
      thread_id,
      player_id,
      quest_id,
      chapter,
      stage,
      status,
      choice,
      started_at,
      updated_at,
      completed_at,
      reward_claimed,
      title
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

  const current = await getQuest(
    threadID,
    playerID
  );

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

  const choice =
    updates.choice !== undefined
      ? String(updates.choice)
      : current.choice;

  const completedAt =
    updates.completed_at !== undefined
      ? updates.completed_at
      : current.completed_at;

  const rewardClaimed =
    updates.reward_claimed !== undefined
      ? Boolean(updates.reward_claimed)
      : Boolean(current.reward_claimed);

  const title =
    updates.title !== undefined
      ? updates.title
      : current.title;

  const timestamp = now();

  const result = await db.query(
    `
    UPDATE rpg_special_quests
    SET
      chapter = $1,
      stage = $2,
      status = $3,
      choice = $4,
      updated_at = $5,
      completed_at = $6,
      reward_claimed = $7,
      title = $8
    WHERE thread_id = $9
      AND player_id = $10
      AND quest_id = $11

    RETURNING
      thread_id,
      player_id,
      quest_id,
      chapter,
      stage,
      status,
      choice,
      started_at,
      updated_at,
      completed_at,
      reward_claimed,
      title
    `,
    [
      chapter,
      stage,
      status,
      choice,
      timestamp,
      completedAt,
      rewardClaimed,
      title,
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

async function pause(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

/*
 * ============================================================
 * CHAPTER 1
 * ============================================================
 */

async function chapterOne(
  api,
  threadID,
  playerID
) {
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

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
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
        "but perhaps you weren’t at all.",
        "",
        "Some encounters are written quietly.",
        "You don’t notice their importance until later.",
        "",
        "And somehow…",
        "that moment became the beginning of everything.",
        "",
        "— Dorian",
        "",
        "Something about that moment stayed with me.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 1,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "I didn’t know it then…",
      "",
      "but I would remember that moment.",
      "",
      "Maybe some people enter our lives",
      "without announcing what they will become.",
      "",
      "Maybe that is what makes them special.",
      "",
      "And somewhere beyond that ordinary night,",
      "a distant light was already waiting.",
      "",
      "Use:",
      "!rpg laststar choose follow",
      "",
      "or",
      "",
      "!rpg laststar choose hesitate",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 2
 * ============================================================
 */

async function chapterTwo(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter II — The Distant Star",
        "",
        "There was something about you that I couldn’t explain.",
        "",
        "At first…",
        "I thought you were mean.",
        "",
        "You were emitting a rarefied air that I couldn’t explain.",
        "Yet somehow, I was too captivated to give it a single thought.",
        "",
        "There was distance between us.",
        "",
        "Not the kind measured by roads or kingdoms.",
        "The kind measured by uncertainty.",
        "",
        "And still, I kept looking toward that star.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 2,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Perhaps some stars are worth reaching for.",
      "",
      "Even when they seem impossibly distant.",
      "",
      "And perhaps…",
      "the distance was never meant to keep us apart.",
      "",
      "It was simply there to make the journey matter.",
      "",
      "Use:",
      "!rpg laststar choose reach",
      "",
      "or",
      "",
      "!rpg laststar choose wait",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 3
 * ============================================================
 */

async function chapterThree(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
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
        "We’ve been through a lot.",
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
        "But somehow…",
        "",
        "we fought through it.",
        "",
        "And that’s why we are here.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 3,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Two kingdoms can fight for years.",
      "",
      "But sometimes the greatest victory",
      "is deciding that neither kingdom has to fall.",
      "",
      "Maybe we didn’t need to win against each other.",
      "",
      "Maybe we needed to stand together.",
      "",
      "Use:",
      "!rpg laststar choose fight",
      "",
      "or",
      "",
      "!rpg laststar choose stay",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 4
 * ============================================================
 */

async function chapterFour(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
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
        "Like the Nile…",
        "a single source of life flowing through",
        "a boundless desert.",
        "",
        "No matter how vast the land becomes,",
        "water still finds a way forward.",
        "",
        "Perhaps love is like that.",
        "",
        "It doesn’t always travel in a straight line.",
        "",
        "Sometimes it bends.",
        "Sometimes it disappears beneath the earth.",
        "Sometimes it has to survive a desert.",
        "",
        "But it keeps flowing.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 4,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "And maybe that is what we did.",
      "",
      "We kept moving.",
      "",
      "Not because everything was easy.",
      "",
      "But because somewhere beneath everything,",
      "there was still a current pulling us forward.",
      "",
      "Toward each other.",
      "",
      "Use:",
      "!rpg laststar choose flow",
      "",
      "or",
      "",
      "!rpg laststar choose stop",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 5
 * ============================================================
 */

async function chapterFive(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
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
        "You are someone I’ll never outgrow,",
        "someone I’ll treasure for the rest of my life.",
        "",
        "And when I imagine the future…",
        "",
        "I don’t imagine a throne.",
        "I don’t imagine an empire.",
        "I don’t imagine riches beyond the stars.",
        "",
        "I imagine a simple family.",
        "",
        "You.",
        "Our children.",
        "A house.",
        "",
        "It might sound simple.",
        "",
        "But it’s all I need.",
        "",
        "It’s you.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 5,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Maybe home was never a place.",
      "",
      "Maybe home was the person",
      "I wanted to come back to.",
      "",
      "And if I could choose where the rest",
      "of my life would begin…",
      "",
      "I would choose beside you.",
      "",
      "Use:",
      "!rpg laststar choose home",
      "",
      "or",
      "",
      "!rpg laststar choose stars",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 6
 * ============================================================
 */

async function chapterSix(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
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
        "But in the end…",
        "",
        "none of that matters.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 6,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "When everything else disappears,",
      "what remains is what mattered most.",
      "",
      "And if I had to choose one thing",
      "to carry beyond the end of everything…",
      "",
      "it would be you.",
      "",
      "Use:",
      "!rpg laststar choose forever",
      "",
      "or",
      "",
      "!rpg laststar choose moment",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 7
 * ============================================================
 *
 * Part I ending.
 *
 * IMPORTANT:
 * Chapter 7 no longer permanently ends the entire quest.
 * It becomes "part1_completed".
 *
 * This allows Chapters 8–20 to continue.
 *
 * Existing rows already marked "completed" at Chapter 7
 * are automatically handled by continueQuest().
 * ============================================================
 */

async function chapterSeven(
  api,
  threadID,
  playerID
) {
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
      "One by one…",
      "everything becomes nothing.",
    ].join("\n")
  );

  await pause(1200);

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

  await pause(1200);

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

  await pause(1200);

  await send(
    api,
    threadID,
    [
      "So, my love…",
      "",
      "Stay until everything collapses.",
      "",
      "Stay until the galaxy itself",
      "dissipates into nothingness.",
    ].join("\n")
  );

  await pause(1400);

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

  await pause(1500);

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

  /*
   * Part I is complete, but the full quest is NOT complete.
   */

  await updateQuest(
    threadID,
    playerID,
    {
      chapter: 7,
      stage: 1,
      status: "part1_completed",
      completed_at: now(),
    }
  );
}

/*
 * ============================================================
 * CHAPTER 8
 * ============================================================
 */

async function chapterEight(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter VIII — The Morning After",
        "",
        "I thought this was it.",
        "",
        "And you thought it was too.",
        "",
        "You thought this was the ending—",
        "the final page, the last thing left to say",
        "after everything we've been through.",
        "",
        "But no.",
        "",
        "There are still so many things I want to tell you.",
        "So many thoughts that have been sitting quietly",
        "inside me, waiting for the right moment to escape.",
        "",
        "But somehow, they get stuck on my tongue.",
        "",
        "Like the morning haze of coffee,",
        "slowly rising from the cup while the first light",
        "of dawn reflects against it.",
        "",
        "Everything is there.",
        "I can see it.",
        "I can feel it.",
        "",
        "I just can't seem to put it into words.",
        "",
        "Maybe I've spent too much time trying",
        "to find the perfect sentence.",
        "",
        "Maybe there isn't one.",
        "",
        "So I'll stop trying to make it perfect.",
        "",
        "I'll just say the one thing that somehow survived",
        "every silence, every fight, every distance,",
        "and every ending we thought we had.",
        "",
        "I love you.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 8,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "The morning came anyway.",
      "",
      "After the end of everything,",
      "there was still light.",
      "",
      "Maybe endings are not always endings.",
      "",
      "Sometimes they are simply the first quiet moment",
      "before something else begins.",
      "",
      "Use:",
      "!rpg laststar choose stay",
      "",
      "or",
      "",
      "!rpg laststar choose wake",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 9
 * ============================================================
 */

async function chapterNine(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter IX — The World We Remember",
        "",
        "The world we remember back then feels oddly different now.",
        "",
        "I used to look at us and think our relationship was perfect.",
        "",
        "Flawless.",
        "",
        "Beyond magnificent.",
        "",
        "I thought that because something could feel that beautiful,",
        "surely nothing could ever break it.",
        "",
        "I thought we'd be okay.",
        "",
        "But even kingdoms fall.",
        "",
        "Armies collapse.",
        "",
        "Walls that once looked impossible to break",
        "eventually become ruins.",
        "",
        "And everything, no matter how magnificent it is,",
        "is bound to change eventually.",
        "",
        "We changed too.",
        "",
        "There were moments when it felt like we were standing",
        "on opposite sides of a battlefield,",
        "staring at each other through all the anger",
        "and everything we couldn't say.",
        "",
        "But somehow, we didn't disappear.",
        "",
        "We stood together.",
        "",
        "We fought back.",
        "",
        "Not because we were perfect,",
        "but because somewhere underneath all the anger,",
        "sorrow, and mistakes,",
        "there was still something worth protecting.",
        "",
        "Us.",
        "",
        "Maybe that's what makes us special.",
        "",
        "Not that we never fell.",
        "",
        "But that we kept finding a reason to stand again.",
        "",
        "And if there is one thing I want us to remember,",
        "it's that.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 9,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "The world we remember doesn't have to be perfect",
      "for it to be worth remembering.",
      "",
      "Even ruins carry the shape of what once stood there.",
      "",
      "And maybe we do too.",
      "",
      "Use:",
      "!rpg laststar choose remember",
      "",
      "or",
      "",
      "!rpg laststar choose let go",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 10
 * ============================================================
 */

async function chapterTen(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter X — The First Home",
        "",
        "First home.",
        "",
        "I always thought home was the place where I lived.",
        "",
        "The roof above my head.",
        "The walls around me.",
        "The room I returned to after a long day.",
        "",
        "Something physical.",
        "Something I could point to and say,",
        "\"This is where I belong.\"",
        "",
        "But who knew it would be you?",
        "",
        "Somehow, you became the place my thoughts",
        "kept returning to.",
        "",
        "My world began revolving around you",
        "the way a planet would revolve around its star—",
        "never quite touching it,",
        "but always being pulled by its gravity.",
        "",
        "And maybe that's why losing you,",
        "even for a moment,",
        "felt like being thrown out of orbit.",
        "",
        "I don't think home was ever really a house.",
        "",
        "Maybe it was never the walls.",
        "",
        "Maybe it was never the roof.",
        "",
        "Maybe home was simply the feeling",
        "of knowing there was someone I wanted to come back to.",
        "",
        "And somehow, that someone was you.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 10,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Maybe we don't need to find the old world again.",
      "",
      "Maybe we can build something new.",
      "",
      "Something that feels like home.",
      "",
      "Use:",
      "!rpg laststar choose build",
      "",
      "or",
      "",
      "!rpg laststar choose wander",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 11
 * ============================================================
 */

async function chapterEleven(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XI — The New Kingdom",
        "",
        "I wanted something they couldn't own.",
        "",
        "Something that would make me feel special.",
        "",
        "Something that would make me feel like,",
        "for once, I had something that belonged only to me.",
        "",
        "I wanted everything the world could possibly hold.",
        "",
        "The treasures.",
        "The victories.",
        "The things people spend their entire lives chasing.",
        "",
        "I thought maybe if I had enough of them,",
        "I'd finally feel complete.",
        "",
        "But then my perspective changed",
        "when it was finally you that I was holding.",
        "",
        "And suddenly, everything I had dreamed of",
        "seemed strangely small.",
        "",
        "As if every treasure I had ever imagined",
        "had somehow been placed into my hands at once.",
        "",
        "Not because you were something I could own.",
        "",
        "You were never something to possess.",
        "",
        "But because having you beside me made me realize",
        "that maybe I had been searching for",
        "the wrong kind of treasure all along.",
        "",
        "I didn't need the whole world.",
        "",
        "For a while, I just needed you.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 11,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "A kingdom doesn't have to be made of gold.",
      "",
      "Sometimes it is simply the life",
      "two people decide to build together.",
      "",
      "And maybe that is the kingdom I wanted.",
      "",
      "Use:",
      "!rpg laststar choose crown",
      "",
      "or",
      "",
      "!rpg laststar choose garden",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 12
 * ============================================================
 */

async function chapterTwelve(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XII — The Two Suns",
        "",
        "Two suns.",
        "",
        "Two moons.",
        "",
        "That's what we are.",
        "",
        "Two people who can be so completely different",
        "that sometimes I wonder how we ever managed",
        "to understand each other.",
        "",
        "There were moments when we felt like polar opposites.",
        "",
        "Different thoughts.",
        "Different feelings.",
        "Different ways of seeing the same things.",
        "",
        "Sometimes it felt like two stars trying",
        "to exist in the same sky",
        "without burning each other apart.",
        "",
        "But somehow, we loved each other deeply enough",
        "that those differences stopped mattering.",
        "",
        "Because maybe love was never about",
        "finding someone exactly like you.",
        "",
        "Maybe it was about finding someone",
        "whose differences you still wanted to understand.",
        "",
        "Someone you could disagree with and still choose.",
        "",
        "Someone you could be angry with and still care for.",
        "",
        "Nothing could really define who we were.",
        "",
        "Not our differences.",
        "Not our similarities.",
        "Not the mistakes we've made.",
        "Not even the worlds we came from.",
        "",
        "We were simply us.",
        "",
        "And somehow, that was enough.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 12,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Maybe two suns were never meant to be identical.",
      "",
      "Maybe their beauty comes from the fact",
      "that each one shines differently.",
      "",
      "And somehow, they still share the same sky.",
      "",
      "Use:",
      "!rpg laststar choose understand",
      "",
      "or",
      "",
      "!rpg laststar choose defend",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 13
 * ============================================================
 */

async function chapterThirteen(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XIII — The Promise",
        "",
        "I promised to stay.",
        "",
        "And that's what I'm going to do.",
        "",
        "I don't know what the road ahead looks like.",
        "",
        "I don't know how many storms we'll have to cross,",
        "or how many times the sky above us will change.",
        "",
        "But I know what I promised.",
        "",
        "I'd sail across the seven seas if I had to.",
        "",
        "I'd cross oceans just to find the shore where you are.",
        "",
        "I'd travel through places I've never seen",
        "just to eventually rest underneath the same sky",
        "and stand upon the same land with you.",
        "",
        "Maybe staying isn't always about",
        "being physically beside someone.",
        "",
        "Sometimes it's choosing them",
        "even when distance makes it difficult.",
        "",
        "Sometimes it's remembering their name",
        "when everything else feels unfamiliar.",
        "",
        "Sometimes it's simply knowing where you want to return.",
        "",
        "And wherever the sea carries me—",
        "",
        "I want that place to be you.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 13,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Promises are strange.",
      "",
      "They are only words when you first say them.",
      "",
      "But every day you keep them,",
      "they become something heavier.",
      "",
      "Something real.",
      "",
      "Use:",
      "!rpg laststar choose promise",
      "",
      "or",
      "",
      "!rpg laststar choose listen",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 14
 * ============================================================
 */

async function chapterFourteen(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XIV — The Road Between Stars",
        "",
        "The road between the stars.",
        "",
        "It felt a lot like the distance between us.",
        "",
        "Something you couldn't properly measure.",
        "",
        "You could look into the sky and see the stars,",
        "but you could never truly see how far away they were.",
        "",
        "That's how it felt.",
        "",
        "Like there was an endless distance between you and me.",
        "",
        "And somewhere in that distance,",
        "there was a wall standing directly in our way.",
        "",
        "No matter how much we wanted to reach the other side,",
        "it always seemed like there was something keeping us apart.",
        "",
        "Maybe it was time.",
        "",
        "Maybe it was circumstances.",
        "",
        "Maybe it was simply us.",
        "",
        "But look.",
        "",
        "Look at how far we've come.",
        "",
        "The road didn't disappear.",
        "",
        "The distance didn't magically become nothing.",
        "",
        "We just kept walking.",
        "",
        "Step after step.",
        "",
        "Until the thing that once looked impossibly far away",
        "became something we could finally look back on.",
        "",
        "And maybe that's the beautiful part.",
        "",
        "We didn't need the stars to move closer.",
        "",
        "We just needed to keep going.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 14,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Maybe the road was never asking us",
      "to know where it ended.",
      "",
      "Maybe it only asked us to keep walking.",
      "",
      "And somehow, we did.",
      "",
      "Use:",
      "!rpg laststar choose follow",
      "",
      "or",
      "",
      "!rpg laststar choose return",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 15
 * ============================================================
 */

async function chapterFifteen(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XV — The Garden",
        "",
        "Do you still remember the first poem I created for you?",
        "",
        "I wonder if you still remember the words.",
        "",
        "I do.",
        "",
        "Maybe that's why I think of it as a garden.",
        "",
        "A garden made entirely out of words.",
        "",
        "Every sentence was something I planted.",
        "Every thought was another seed.",
        "",
        "And somehow, even after all this time,",
        "my love still lingers somewhere between those lines.",
        "",
        "Some flowers withered.",
        "Some words became distant.",
        "Some memories don't feel quite the same anymore.",
        "",
        "But the garden never completely disappeared.",
        "",
        "Because every time I remember you,",
        "something grows again.",
        "",
        "A sentence.",
        "A feeling.",
        "A memory.",
        "",
        "Something small that reminds me",
        "why I wrote it in the first place.",
        "",
        "Maybe that was the point of the poem.",
        "",
        "Not to make something beautiful that would last forever.",
        "",
        "But to leave something behind",
        "that would still bloom whenever I remembered you.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 15,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Some words are forgotten.",
      "",
      "Some stay buried for years.",
      "",
      "And some somehow survive everything.",
      "",
      "Maybe ours did.",
      "",
      "Use:",
      "!rpg laststar choose plant",
      "",
      "or",
      "",
      "!rpg laststar choose protect",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 16
 * ============================================================
 */

async function chapterSixteen(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XVI — The Silence Between Words",
        "",
        "Well...",
        "",
        "It looks like I'm out of words to say.",
        "",
        "Really.",
        "",
        "I've talked about kingdoms falling.",
        "",
        "Stars.",
        "",
        "Moons.",
        "",
        "Wars.",
        "",
        "Home.",
        "",
        "Promises.",
        "",
        "Everything.",
        "",
        "Maybe there isn't anything left.",
        "",
        "Maybe I've finally said enough.",
        "",
        "...",
        "",
        "Actually, no.",
        "",
        "I think I'm kidding.",
        "",
        "Because somehow, whenever I think I've reached",
        "the end of what I can say about you,",
        "another memory appears.",
        "",
        "Another thought.",
        "",
        "Another stupid little thing that reminds me of you.",
        "",
        "So perhaps I'm not really out of words.",
        "",
        "Maybe I'm just trying to figure out",
        "how to say something that words",
        "were never really meant to explain.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 16,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Maybe silence says something too.",
      "",
      "Sometimes the things we cannot explain",
      "are the things we feel the most.",
      "",
      "Use:",
      "!rpg laststar choose speak",
      "",
      "or",
      "",
      "!rpg laststar choose silence",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 17
 * ============================================================
 */

async function chapterSeventeen(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XVII — The Last War",
        "",
        "I'm kidding.",
        "",
        "Every song reminds me of you.",
        "",
        "Which is honestly kind of funny.",
        "",
        "I'll hear something completely unrelated,",
        "and somehow my mind finds a way",
        "to drag you into it.",
        "",
        "A melody.",
        "",
        "A line.",
        "",
        "A certain sound in the background.",
        "",
        "And suddenly I'm somewhere else entirely.",
        "",
        "Back then.",
        "",
        "Back with you.",
        "",
        "Nostalgia will be the death of me.",
        "",
        "It has this strange way of making",
        "the smallest things feel enormous.",
        "",
        "A song becomes a memory.",
        "",
        "A memory becomes a feeling.",
        "",
        "And a feeling becomes you.",
        "",
        "Yet, somehow, I know you'll be the death of me too.",
        "",
        "Not literally.",
        "",
        "You know what I mean.",
        "",
        "Maybe because loving someone gives them",
        "a strange kind of power over you.",
        "",
        "They become capable of hurting you",
        "in ways nobody else could.",
        "",
        "But they also become capable of making",
        "ordinary moments feel like something worth remembering.",
        "",
        "So if nostalgia is going to kill me...",
        "",
        "I suppose I'll let it.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 17,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Maybe the last war was never between us.",
      "",
      "Maybe it was against everything",
      "that tried to make us forget what we were.",
      "",
      "And somehow, the memories survived.",
      "",
      "Use:",
      "!rpg laststar choose unite",
      "",
      "or",
      "",
      "!rpg laststar choose fight",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 18
 * ============================================================
 */

async function chapterEighteen(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XVIII — The Choice We Keep",
        "",
        "The choices we keep are truly magnificent",
        "and insignificant at the same time.",
        "",
        "It's strange.",
        "",
        "A single decision can feel so small when you make it.",
        "",
        "One word.",
        "One step.",
        "One moment.",
        "",
        "Yet years later, you can look back",
        "and realize that tiny choice changed everything.",
        "",
        "You can let go of it.",
        "",
        "You can tell yourself it doesn't matter anymore.",
        "",
        "And maybe, eventually, it won't.",
        "",
        "But that doesn't mean it wasn't valuable.",
        "",
        "Some things are allowed to end",
        "without becoming meaningless.",
        "",
        "Some memories can be left behind",
        "without being erased.",
        "",
        "Maybe that's what our choices are.",
        "",
        "Things we don't have to carry forever...",
        "",
        "but things we can still value",
        "for having existed.",
        "",
        "And perhaps that's enough.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 18,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Maybe some choices are worth keeping.",
      "",
      "Not because they were perfect,",
      "but because they became part of us.",
      "",
      "And maybe choosing you was one of them.",
      "",
      "Use:",
      "!rpg laststar choose forgive",
      "",
      "or",
      "",
      "!rpg laststar choose hold",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 19
 * ============================================================
 */

async function chapterNineteen(
  api,
  threadID,
  playerID
) {
  const quest = await getQuest(
    threadID,
    playerID
  );

  const stage = Number(
    quest?.stage || 0
  );

  if (stage === 0) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Chapter XIX — The Story",
        "",
        "So...",
        "",
        "What do you think about our story?",
        "",
        "Be honest.",
        "",
        "I know it wasn't perfect.",
        "",
        "There were fights.",
        "",
        "There was anger.",
        "",
        "There was sorrow.",
        "",
        "There were moments when we probably wondered",
        "why we were still holding on.",
        "",
        "There were things we said",
        "that we wished we could take back.",
        "",
        "Things we did that hurt more",
        "than we wanted them to.",
        "",
        "Our story wasn't some flawless kingdom",
        "untouched by war.",
        "",
        "It had cracks.",
        "",
        "It had ruins.",
        "",
        "It had nights where the stars",
        "didn't feel bright enough.",
        "",
        "But after everything...",
        "",
        "I still want to ask you one thing.",
        "",
        "Not whether it was perfect.",
        "",
        "Not whether every moment was worth it.",
        "",
        "Just one thing.",
        "",
        "Were you happy?",
        "",
        "Even for a little while?",
        "",
        "Even in between all the chaos?",
        "",
        "Because if there was even one moment where you were...",
        "",
        "then maybe all of this meant something.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 19,
        stage: 1,
      }
    );

    return;
  }

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Maybe a story doesn't need to be perfect",
      "to be worth telling.",
      "",
      "Maybe the cracks are part of what makes it ours.",
      "",
      "Use:",
      "!rpg laststar choose happy",
      "",
      "or",
      "",
      "!rpg laststar choose honest",
    ].join("\n")
  );
}

/*
 * ============================================================
 * CHAPTER 20
 * ============================================================
 *
 * FINAL CHAPTER.
 * ============================================================
 */

async function chapterTwenty(
  api,
  threadID,
  playerID
) {
  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      "Chapter XX — The Beginning After Forever",
      "",
      "If you are...",
      "",
      "then I'm glad that you are.",
      "",
      "This is my message for you.",
      "",
      "I know you've heard me say this before.",
      "",
      "Maybe more times than you can count.",
      "",
      "But I am forever grateful that I met you.",
      "",
      "Out of all the people I could have crossed paths with,",
      "somehow, it was you.",
      "",
      "Just like the moon and the sun aligning with each other",
      "to create an eclipse, our paths somehow aligned too.",
      "",
      "Something that shouldn't happen often.",
      "",
      "Something that feels almost impossible.",
      "",
      "Yet it happened.",
      "",
      "You happened.",
      "",
      "And maybe our future is uncertain.",
      "",
      "Maybe we don't know what tomorrow will look like.",
      "",
      "Maybe the road ahead will change",
      "in ways neither of us can predict.",
      "",
      "But I know one thing.",
      "",
      "I'll love you every day.",
      "",
      "Until the gods themselves stop messing with our fate.",
      "",
      "Until the stars disappear.",
      "",
      "Until the moon forgets the night.",
      "",
      "Until there is nothing left",
      "for the universe to hold.",
      "",
      "You are my Selene.",
      "",
      "My moon beneath every sky.",
      "",
      "My light when the world goes dark.",
      "",
      "My constant in a world that never seems to stay still.",
      "",
      "And if the gods decide to write another world for us...",
      "",
      "I'd still choose you.",
      "",
      "Again.",
      "",
      "And again.",
      "",
      "And again.",
      "",
      "In every kingdom.",
      "",
      "Under every sun.",
      "",
      "Across every sea.",
      "",
      "Through every lifetime.",
      "",
      "You are my Selene.",
      "",
      "And you will forever be.",
    ].join("\n")
  );

  await pause(1800);

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

  await pause(1800);

  await send(
    api,
    threadID,
    [
      "✦ THE END OF THE LAST STAR ✦",
      "",
      "Or perhaps...",
      "",
      "the beginning of something after forever.",
    ].join("\n")
  );

  await updateQuest(
    threadID,
    playerID,
    {
      chapter: 20,
      stage: 1,
      status: "completed",
      completed_at: now(),
    }
  );
}

/*
 * ============================================================
 * ADVANCE CHAPTER
 * ============================================================
 */

async function advanceChapter(
  threadID,
  playerID,
  currentQuest
) {
  const chapter =
    Number(currentQuest.chapter || 1);

  const stage =
    Number(currentQuest.stage || 0);

  const maxStages =
    CHAPTER_STAGES[chapter] || 1;

  /*
   * Current chapter has another stage.
   */

  if (stage < maxStages - 1) {
    return {
      chapter,
      stage: stage + 1,
    };
  }

  /*
   * Move to next chapter.
   */

  if (chapter < MAX_CHAPTER) {
    return {
      chapter: chapter + 1,
      stage: 0,
    };
  }

  return {
    chapter: MAX_CHAPTER,
    stage: 1,
  };
}

/*
 * ============================================================
 * CONTINUE QUEST
 * ============================================================
 */

async function continueQuest(
  api,
  threadID,
  playerID
) {
  let quest = await getQuest(
    threadID,
    playerID
  );

  /*
   * Quest hasn't started.
   */

  if (!quest) {
    quest = await startQuest(
      threadID,
      playerID
    );

    await chapterOne(
      api,
      threadID,
      playerID
    );

    return true;
  }

  /*
   * IMPORTANT MIGRATION:
   *
   * Older version of this quest permanently marked Chapter 7
   * as "completed".
   *
   * If that old state exists, do NOT make the player replay
   * anything.
   *
   * Upgrade directly to Chapter 8.
   */

  if (
    quest.status === "completed" &&
    Number(quest.chapter) === 7
  ) {
    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 8,
        stage: 0,
        status: "active",
        completed_at: null,
      }
    );

    quest = await getQuest(
      threadID,
      playerID
    );
  }

  /*
   * Part I was completed normally.
   */

  if (
    quest.status === "part1_completed" &&
    Number(quest.chapter) === 7
  ) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Part I — The Last Star",
        "has reached its end.",
        "",
        "But the story didn't.",
        "",
        "Everything disappeared.",
        "",
        "And somehow...",
        "there was still a morning waiting.",
        "",
        "Part II begins.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    await pause(1200);

    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 8,
        stage: 0,
        status: "active",
        completed_at: null,
      }
    );

    quest = await getQuest(
      threadID,
      playerID
    );
  }

  /*
   * Final completion.
   */

  if (
    quest.status === "completed" &&
    Number(quest.chapter) >= MAX_CHAPTER
  ) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "The story has already reached its final page.",
        "",
        "But some stories don't really end.",
        "",
        `👑 Title: ${quest.title || LOVE_QUEST_REWARD.title}`,
        "",
        "∞ ❤️",
      ].join("\n")
    );

    return true;
  }

  /*
   * Determine which chapter function should run.
   */

  switch (Number(quest.chapter)) {
    case 1:
      await chapterOne(
        api,
        threadID,
        playerID
      );
      break;

    case 2:
      await chapterTwo(
        api,
        threadID,
        playerID
      );
      break;

    case 3:
      await chapterThree(
        api,
        threadID,
        playerID
      );
      break;

    case 4:
      await chapterFour(
        api,
        threadID,
        playerID
      );
      break;

    case 5:
      await chapterFive(
        api,
        threadID,
        playerID
      );
      break;

    case 6:
      await chapterSix(
        api,
        threadID,
        playerID
      );
      break;

    case 7:
      await chapterSeven(
        api,
        threadID,
        playerID
      );
      break;

    case 8:
      await chapterEight(
        api,
        threadID,
        playerID
      );
      break;

    case 9:
      await chapterNine(
        api,
        threadID,
        playerID
      );
      break;

    case 10:
      await chapterTen(
        api,
        threadID,
        playerID
      );
      break;

    case 11:
      await chapterEleven(
        api,
        threadID,
        playerID
      );
      break;

    case 12:
      await chapterTwelve(
        api,
        threadID,
        playerID
      );
      break;

    case 13:
      await chapterThirteen(
        api,
        threadID,
        playerID
      );
      break;

    case 14:
      await chapterFourteen(
        api,
        threadID,
        playerID
      );
      break;

    case 15:
      await chapterFifteen(
        api,
        threadID,
        playerID
      );
      break;

    case 16:
      await chapterSixteen(
        api,
        threadID,
        playerID
      );
      break;

    case 17:
      await chapterSeventeen(
        api,
        threadID,
        playerID
      );
      break;

    case 18:
      await chapterEighteen(
        api,
        threadID,
        playerID
      );
      break;

    case 19:
      await chapterNineteen(
        api,
        threadID,
        playerID
      );
      break;

    case 20:
      await chapterTwenty(
        api,
        threadID,
        playerID
      );
      break;

    default:
      await updateQuest(
        threadID,
        playerID,
        {
          chapter: 1,
          stage: 0,
          status: "active",
        }
      );

      await chapterOne(
        api,
        threadID,
        playerID
      );

      break;
  }

  return true;
}

/*
 * ============================================================
 * DISCOVER HIDDEN QUEST
 * ============================================================
 *
 * FIRST SUCCESSFUL !rpg explore
 * = GUARANTEED DISCOVERY.
 *
 * The quest is persistent.
 *
 * Leaving the message on read does NOT expire it.
 * ============================================================
 */

async function discover(
  api,
  threadID,
  playerID
) {
  if (!isSpecialPlayer(playerID)) {
    return false;
  }

  const existing =
    await getQuest(
      threadID,
      playerID
    );

  if (existing) {
    return false;
  }

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
      "It doesn’t look like a torch.",
      "",
      "It looks like a star.",
      "",
      "🧑‍🏫 Dorian:",
      "\"I’ve never seen this place before.\"",
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

  let quest =
    await getQuest(
      threadID,
      playerID
    );

  if (!quest) {
    quest =
      await startQuest(
        threadID,
        playerID
      );
  }

  if (!quest) {
    return false;
  }

  /*
   * Old Chapter 7 completion migration.
   */

  if (
    quest.status === "completed" &&
    Number(quest.chapter) === 7
  ) {
    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 8,
        stage: 0,
        status: "active",
        completed_at: null,
      }
    );

    quest = await getQuest(
      threadID,
      playerID
    );
  }

  /*
   * Final completion only blocks continuation
   * when Chapter 20 is actually finished.
   */

  if (
    quest.status === "completed" &&
    Number(quest.chapter) >= MAX_CHAPTER
  ) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "The journey has reached its final page.",
        "",
        `👑 ${quest.title || LOVE_QUEST_REWARD.title}`,
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
 * CHOICE SYSTEM
 * ============================================================
 */

async function makeChoice(
  api,
  threadID,
  playerID,
  choice
) {
  if (!isSpecialPlayer(playerID)) {
    return false;
  }

  const quest =
    await getQuest(
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
        "There is no active story yet.",
        "",
        "Use:",
        "!rpg explore",
      ].join("\n")
    );

    return true;
  }

  /*
   * Final completion only.
   */

  if (
    quest.status === "completed" &&
    Number(quest.chapter) >= MAX_CHAPTER
  ) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "The story has already reached its final ending.",
        "",
        `👑 ${quest.title || LOVE_QUEST_REWARD.title}`,
        "",
        "∞ ❤️",
      ].join("\n")
    );

    return true;
  }

  const cleanChoice =
    String(choice || "")
      .trim()
      .toLowerCase();

  if (!cleanChoice) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "You must choose a path.",
        "",
        "Use:",
        "!rpg laststar continue",
      ].join("\n")
    );

    return true;
  }

  /*
   * Save choice.
   */

  await updateQuest(
    threadID,
    playerID,
    {
      choice: cleanChoice,
    }
  );

  /*
   * Choice-specific flavor.
   *
   * These choices are remembered by the story.
   * They don't create disconnected branches.
   */

  const choiceMessages = {
    follow:
      "You decided to follow the distant light.",

    hesitate:
      "You hesitated, but the star remained.",

    reach:
      "You reached toward the distant star.",

    wait:
      "You chose to wait beneath the night sky.",

    fight:
      "You chose to fight for what mattered.",

    stay:
      "You chose to stay.",

    flow:
      "You chose to keep moving with the river.",

    stop:
      "You chose to stop and look back.",

    home:
      "You chose the home you imagined together.",

    stars:
      "You chose to keep looking toward the stars.",

    forever:
      "You chose forever.",

    moment:
      "You chose to treasure the moment.",

    wake:
      "You chose to wake and face the morning.",

    remember:
      "You chose to remember.",

    "let go":
      "You chose to let go without erasing what mattered.",

    build:
      "You chose to build something new.",

    wander:
      "You chose to wander through what remained.",

    crown:
      "You chose the kingdom you could build together.",

    garden:
      "You chose something that could grow instead of something that could be owned.",

    understand:
      "You chose to understand what made you different.",

    defend:
      "You chose to protect what you believed was worth keeping.",

    promise:
      "You chose to keep the promise.",

    listen:
      "You chose to listen before answering.",

    return:
      "You chose to return to what still mattered.",

    plant:
      "You chose to plant another word in the garden.",

    protect:
      "You chose to protect the garden.",

    speak:
      "You chose to give the feeling a voice.",

    silence:
      "You chose to let the silence speak.",

    unite:
      "You chose to stand together.",

    forgive:
      "You chose forgiveness.",

    hold:
      "You chose to hold on to what mattered.",

    happy:
      "You chose to remember the happiness.",

    honest:
      "You chose honesty.",
  };

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      choiceMessages[cleanChoice] ||
        `You chose: ${cleanChoice}`,
      "",
      "The story remembers your choice.",
      "",
      "Use:",
      "!rpg laststar continue",
    ].join("\n")
  );

  /*
   * Move forward after the choice.
   */

  const next =
    await advanceChapter(
      threadID,
      playerID,
      quest
    );

  await updateQuest(
    threadID,
    playerID,
    {
      chapter: next.chapter,
      stage: next.stage,
      status:
        next.chapter >= MAX_CHAPTER
          ? "active"
          : quest.status === "part1_completed"
            ? "active"
            : quest.status,
    }
  );

  return true;
}

/*
 * ============================================================
 * REWARD
 * ============================================================
 *
 * Chapter 7 reward.
 *
 * Reward:
 *   10,000 coins
 *   1,000 XP
 *   The Loved One
 *
 * The database flag prevents duplicate claims.
 *
 * This works even if the user's existing database row
 * says Chapter 7 is already "completed".
 * ============================================================
 */

async function claimReward(
  api,
  threadID,
  playerID
) {
  if (!isSpecialPlayer(playerID)) {
    return false;
  }

  await ensureTable();

  const quest =
    await getQuest(
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
        "You have not discovered the story yet.",
        "",
        "Use:",
        "!rpg explore",
      ].join("\n")
    );

    return true;
  }

  const chapter =
    Number(quest.chapter || 1);

  const eligible =
    chapter >= 7 ||
    quest.status === "part1_completed" ||
    quest.status === "completed";

  if (!eligible) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "The reward is not yours yet.",
        "",
        "Finish Chapter VII — Eternal first.",
        "",
        `Current progress: ${formatQuestProgress(quest)}`,
      ].join("\n")
    );

    return true;
  }

  /*
   * Already claimed.
   */

  if (quest.reward_claimed) {
    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "You already claimed this reward.",
        "",
        `👑 Title: ${quest.title || LOVE_QUEST_REWARD.title}`,
        "",
        "💰 +10,000 coins",
        "✨ +1,000 XP",
        "",
        "The reward cannot be claimed twice.",
      ].join("\n")
    );

    return true;
  }

  /*
   * Atomically reserve the reward.
   *
   * This prevents double claims if the command is sent
   * twice very quickly.
   */

  const timestamp = now();

  const reserved =
    await db.query(
      `
      UPDATE rpg_special_quests
      SET
        reward_claimed = TRUE,
        title = $1,
        updated_at = $2
      WHERE thread_id = $3
        AND player_id = $4
        AND quest_id = $5
        AND reward_claimed = FALSE
        AND (
          chapter >= 7
          OR status = 'part1_completed'
          OR status = 'completed'
        )
      RETURNING
        thread_id,
        player_id,
        quest_id,
        chapter,
        status,
        reward_claimed,
        title
      `,
      [
        LOVE_QUEST_REWARD.title,
        timestamp,
        String(threadID),
        String(playerID),
        QUEST_ID,
      ]
    );

  if (!reserved.rows.length) {
    const latest =
      await getQuest(
        threadID,
        playerID
      );

    if (latest?.reward_claimed) {
      await send(
        api,
        threadID,
        [
          "✦ THE LAST STAR ✦",
          "",
          "The reward has already been claimed.",
          "",
          `👑 ${latest.title || LOVE_QUEST_REWARD.title}`,
        ].join("\n")
      );
    }

    return true;
  }

  /*
   * Give the actual economy rewards.
   */

  try {
    await db.addBalance(
      String(threadID),
      String(playerID),
      LOVE_QUEST_REWARD.coins
    );

    await db.addXP(
      String(threadID),
      String(playerID),
      LOVE_QUEST_REWARD.xp
    );
  } catch (error) {
    /*
     * If the economy operation fails, release the claim
     * so the player can safely try again.
     */

    console.error(
      "[LOVE QUEST] Failed to grant reward:",
      error
    );

    try {
      await db.query(
        `
        UPDATE rpg_special_quests
        SET
          reward_claimed = FALSE,
          title = NULL,
          updated_at = $1
        WHERE thread_id = $2
          AND player_id = $3
          AND quest_id = $4
        `,
        [
          now(),
          String(threadID),
          String(playerID),
          QUEST_ID,
        ]
      );
    } catch (rollbackError) {
      console.error(
        "[LOVE QUEST] Failed to rollback reward claim:",
        rollbackError
      );
    }

    await send(
      api,
      threadID,
      [
        "✦ THE LAST STAR ✦",
        "",
        "Something went wrong while granting the reward.",
        "",
        "Your reward claim was not consumed.",
        "",
        "Please try again.",
      ].join("\n")
    );

    return true;
  }

  /*
   * Reward success.
   */

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR — PART I REWARD ✦",
      "",
      "You reached Eternal.",
      "",
      "And the story remembered you.",
      "",
      "Reward:",
      "",
      "💰 +10,000 coins",
      "✨ +1,000 XP",
      `👑 Unique Title: ${LOVE_QUEST_REWARD.title}`,
      "",
      "Not a title for a king.",
      "Not a title for a warrior.",
      "Not a title for someone who conquered a world.",
      "",
      "A title for the person who remained",
      "when everything else disappeared.",
      "",
      `You are now known as:`,
      `${LOVE_QUEST_REWARD.title}`,
      "",
      "Part I is complete.",
      "",
      "But the story has not disappeared.",
      "",
      "There is still something left to say.",
      "",
      "Use:",
      "!rpg laststar continue",
    ].join("\n")
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

  const quest =
    await getQuest(
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

  const isFinal =
    quest.status === "completed" &&
    chapter >= MAX_CHAPTER;

  const isPartOneComplete =
    quest.status === "part1_completed" ||
    (
      quest.status === "completed" &&
      chapter === 7
    );

  await send(
    api,
    threadID,
    [
      "✦ THE LAST STAR ✦",
      "",
      `Status: ${
        isFinal
          ? "COMPLETED"
          : isPartOneComplete
            ? "PART I COMPLETE"
            : "ACTIVE"
      }`,
      `Chapter: ${chapter}/${MAX_CHAPTER}`,
      `Title: ${chapterName}`,
      `Stage: ${Number(quest.stage || 0)}`,
      `Last choice: ${quest.choice || "none"}`,
      "",
      `Unique Title: ${
        quest.title || "Not yet earned"
      }`,
      `Reward: ${
        quest.reward_claimed
          ? "CLAIMED"
          : chapter >= 7
            ? "AVAILABLE"
            : "LOCKED"
      }`,
      "",
      formatQuestProgress(quest),
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
 *
 * Testing/admin utility.
 *
 * Deletes the entire Love Quest record for this thread/player.
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
 */

async function handleLoveQuestCommand(
  api,
  threadID,
  senderID,
  args = []
) {
  if (!isSpecialPlayer(senderID)) {
    return false;
  }

  const parts =
    normalizeArgs(args);

  if (!parts.length) {
    return false;
  }

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

    case "reward":
    case "claim":
    case "title":
      return claimReward(
        api,
        threadID,
        senderID
      );

    case "choose": {
      const choice =
        parts
          .slice(2)
          .join(" ")
          .trim()
          .toLowerCase();

      return makeChoice(
        api,
        threadID,
        senderID,
        choice
      );
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
          "!rpg laststar choose <choice>",
          "!rpg laststar reward",
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
  CHAPTER_STAGES,
  LOVE_QUEST_REWARD,

  isSpecialPlayer,

  ensureTable,
  getQuest,
  startQuest,
  updateQuest,

  discover,
  followQuest,
  continueQuest,
  readQuest,
  claimReward,

  resetQuest,

  handleLoveQuestCommand,
};
