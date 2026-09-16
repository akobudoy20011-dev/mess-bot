const db = require("../db");

// -----------------------------------------------------------------------------
// HIDDEN PERSONAL ADAPTATION / TRAINING SYSTEM
//
// IMPORTANT:
// - Only BOT_OWNER_ID can control training.
// - Training commands are completely silent.
// - Only the owner's messages are observed.
// - Other people's messages are NOT saved as training data.
// - Raw messages are not permanently stored.
// - Stable communication patterns are extracted and stored instead.
// -----------------------------------------------------------------------------

const OWNER_ID = String(
  process.env.BOT_OWNER_ID || ""
).trim();

const activeTrainingThreads = new Set();

// Don't analyze every single message with Gemini.
// We collect a small batch and periodically analyze it.
const pendingObservations = new Map();

const MAX_PENDING_MESSAGES = 25;
const MIN_MESSAGES_BEFORE_ANALYSIS = 8;

let tableReadyPromise = null;


// -----------------------------------------------------------------------------
// AUTHORIZATION
// -----------------------------------------------------------------------------

function isTrainingOwner(senderID) {
  const sender = String(senderID || "").trim();

  return Boolean(
    OWNER_ID &&
    sender &&
    sender === OWNER_ID
  );
}


// -----------------------------------------------------------------------------
// DATABASE SETUP
// -----------------------------------------------------------------------------

async function ensureAdaptationTable() {
  if (tableReadyPromise) {
    return tableReadyPromise;
  }

  tableReadyPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ai_user_adaptation (
        user_id TEXT PRIMARY KEY,

        profile JSONB NOT NULL DEFAULT '{}'::jsonb,

        observations INTEGER NOT NULL DEFAULT 0,

        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  })().catch((error) => {
    tableReadyPromise = null;

    console.error(
      "[adaptation] Failed to create adaptation table:",
      error
    );

    throw error;
  });

  return tableReadyPromise;
}


// -----------------------------------------------------------------------------
// TRAINING STATE
// -----------------------------------------------------------------------------

function isTrainingActive(threadID) {
  return activeTrainingThreads.has(
    String(threadID || "").trim()
  );
}


function startTraining(threadID) {
  const id = String(threadID || "").trim();

  if (!id) {
    return false;
  }

  activeTrainingThreads.add(id);

  if (!pendingObservations.has(id)) {
    pendingObservations.set(id, []);
  }

  console.log(
    `[adaptation] Training silently enabled in thread ${id}`
  );

  return true;
}


function stopTraining(threadID) {
  const id = String(threadID || "").trim();

  if (!id) {
    return false;
  }

  activeTrainingThreads.delete(id);
  pendingObservations.delete(id);

  console.log(
    `[adaptation] Training silently disabled in thread ${id}`
  );

  return true;
}


function stopAllTraining() {
  activeTrainingThreads.clear();
  pendingObservations.clear();
}


// -----------------------------------------------------------------------------
// HIDDEN COMMAND HANDLER
//
// !lucien
//      owner only -> silently toggles training
//
// !lucien train
//      owner only -> silently toggles training
//
// !lucien learn
//      owner only -> silently toggles training
//
// !lucien off
//      owner only -> silently disables training
//
// !lucien training
//      owner only -> silently toggles training
//
// !lucien reset-training
//      owner only -> silently clears learned profile
// -----------------------------------------------------------------------------

async function handleTrainingCommand(senderID, threadID, originalText) {
  if (!isTrainingOwner(senderID)) {
    return false;
  }

  const text = String(originalText || "")
    .trim()
    .toLowerCase();

  if (!text) {
    return false;
  }

  if (text !== "!lucien" &&
      !text.startsWith("!lucien ")) {
    return false;
  }

  const args = text
    .replace(/^!lucien\s*/i, "")
    .trim();

  // ---------------------------------------------------------------------------
  // Bare !lucien
  //
  // Silent toggle.
  // ---------------------------------------------------------------------------

  if (!args) {
    if (isTrainingActive(threadID)) {
      stopTraining(threadID);
    } else {
      startTraining(threadID);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Explicit training ON
  // ---------------------------------------------------------------------------

  if (
    args === "train" ||
    args === "learn" ||
    args === "on" ||
    args === "training"
  ) {
    startTraining(threadID);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Explicit training OFF
  // ---------------------------------------------------------------------------

  if (
    args === "off" ||
    args === "stop" ||
    args === "learn off" ||
    args === "train off"
  ) {
    stopTraining(threadID);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Reset learned profile
  // ---------------------------------------------------------------------------

  if (
    args === "reset-training" ||
    args === "reset training"
  ) {
    await resetAdaptation(senderID);
    return true;
  }

  return false;
}


// -----------------------------------------------------------------------------
// OBSERVATION
// -----------------------------------------------------------------------------

async function observeMessage({
  senderID,
  threadID,
  body
}) {
  if (!isTrainingOwner(senderID)) {
    return false;
  }

  const thread = String(threadID || "").trim();
  const sender = String(senderID || "").trim();
  const message = String(body || "").trim();

  if (!thread || !sender || !message) {
    return false;
  }

  if (!isTrainingActive(thread)) {
    return false;
  }

  // Don't train on the hidden commands themselves.
  if (/^!lucien(?:\s|$)/i.test(message)) {
    return false;
  }

  let queue = pendingObservations.get(thread);

  if (!queue) {
    queue = [];
    pendingObservations.set(thread, queue);
  }

  queue.push({
    text: message,
    timestamp: Date.now()
  });

  // Prevent unlimited memory growth.
  if (queue.length > MAX_PENDING_MESSAGES) {
    queue.splice(
      0,
      queue.length - MAX_PENDING_MESSAGES
    );
  }

  // Only analyze after enough natural messages have accumulated.
  if (queue.length >= MIN_MESSAGES_BEFORE_ANALYSIS) {
    await analyzePendingObservations(sender, thread);
  }

  return true;
}


// -----------------------------------------------------------------------------
// STYLE ANALYSIS
//
// This first layer extracts obvious deterministic patterns locally.
// That means we don't need to call Gemini for every message.
//
// Gemini-style semantic analysis can be added later.
// -----------------------------------------------------------------------------

function analyzeLocalPatterns(messages) {
  const texts = messages
    .map((item) => String(item.text || "").trim())
    .filter(Boolean);

  if (!texts.length) {
    return {};
  }

  const combined = texts.join(" ");

  const lowercaseCount = texts.filter(
    (text) => text === text.toLowerCase()
  ).length;

  const taglishSignals = [
    "ano",
    "bat",
    "bakit",
    "paano",
    "wala",
    "meron",
    "ganon",
    "ganun",
    "kasi",
    "naman",
    "yung",
    "yan",
    "ito",
    "eto",
    "ako",
    "ikaw",
    "mo",
    "ko",
    "na",
    "pa",
    "lang",
    "sige",
    "teka",
    "hala",
    "grabe",
    "gago",
    "bro",
    "tol",
    "pre"
  ];

  const abbreviationSignals = [
    "js",
    "ion",
    "abt",
    "rn",
    "n",
    "u",
    "ur",
    "im",
    "ye",
    "wdym",
    "ngl",
    "medj",
    "idk",
    "btw",
    "bc"
  ];

  const emojiSignals = [
    "😭",
    "😂",
    "🤣",
    "💀",
    "😔",
    "😡",
    "❤️",
    "❤",
    "😩",
    "😳",
    "🙄",
    "😎"
  ];

  const foundWords = [];

  for (const word of abbreviationSignals) {
    const regex = new RegExp(
      `(^|\\s)${escapeRegex(word)}(?=\\s|$|[,.!?])`,
      "i"
    );

    if (regex.test(combined)) {
      foundWords.push(word);
    }
  }

  const foundEmojis = emojiSignals.filter(
    (emoji) => combined.includes(emoji)
  );

  const taglishCount = taglishSignals.filter(
    (word) => new RegExp(
      `(^|\\s)${escapeRegex(word)}(?=\\s|$|[,.!?])`,
      "i"
    ).test(combined)
  ).length;

  const averageLength =
    texts.reduce(
      (sum, text) => sum + text.length,
      0
    ) / texts.length;

  const shortMessageRatio =
    texts.filter((text) => text.length <= 35).length /
    texts.length;

  const typoSignals = detectTypoSignals(texts);

  return {
    lowercaseRatio: round(
      lowercaseCount / texts.length
    ),

    taglishSignalCount: taglishCount,

    abbreviations: foundWords,

    emojis: foundEmojis,

    averageMessageLength: Math.round(
      averageLength
    ),

    shortMessageRatio: round(
      shortMessageRatio
    ),

    typoSignals
  };
}


// -----------------------------------------------------------------------------
// TYPO DETECTION
//
// We don't assume every unusual spelling is a typo.
// These are only observations that can later become patterns if repeated.
// -----------------------------------------------------------------------------

function detectTypoSignals(texts) {
  const signals = [];

  const suspiciousPatterns = [
    /\bmonts\b/i,
    /\blouke\b/i,
    /\btypins\b/i,
    /\bcauafe\b/i,
    /\bthi\b/i,
    /\bouts\b/i,
    /\bthats\b/i
  ];

  for (const text of texts) {
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(text)) {
        const match = text.match(pattern);

        if (match && match[0]) {
          signals.push(match[0].toLowerCase());
        }
      }
    }
  }

  return [...new Set(signals)];
}


// -----------------------------------------------------------------------------
// MERGE PROFILE
// -----------------------------------------------------------------------------

async function analyzePendingObservations(userID, threadID) {
  const queue = pendingObservations.get(threadID);

  if (!queue || queue.length === 0) {
    return;
  }

  // Take a snapshot and clear the queue.
  const observations = queue.splice(
    0,
    queue.length
  );

  const localProfile =
    analyzeLocalPatterns(observations);

  try {
    await ensureAdaptationTable();

    const existing = await getAdaptation(userID);

    const merged = mergeProfiles(
      existing.profile || {},
      localProfile
    );

    await db.query(
      `
      INSERT INTO ai_user_adaptation (
        user_id,
        profile,
        observations,
        updated_at
      )
      VALUES ($1, $2::jsonb, $3, NOW())

      ON CONFLICT (user_id)
      DO UPDATE SET
        profile = EXCLUDED.profile,
        observations =
          ai_user_adaptation.observations + EXCLUDED.observations,
        updated_at = NOW()
      `,
      [
        userID,
        JSON.stringify(merged),
        observations.length
      ]
    );

    console.log(
      `[adaptation] Learned from ${observations.length} message(s) from owner`
    );
  } catch (error) {
    console.error(
      "[adaptation] Failed to save observations:",
      error
    );
  }
}


// -----------------------------------------------------------------------------
// PROFILE MERGING
// -----------------------------------------------------------------------------

function mergeProfiles(oldProfile, newProfile) {
  const old = oldProfile || {};
  const next = newProfile || {};

  return {
    ...old,

    communication: {
      ...(old.communication || {}),

      lowercaseRatio:
        weightedAverage(
          old.communication?.lowercaseRatio,
          next.lowercaseRatio
        ),

      averageMessageLength:
        weightedAverage(
          old.communication?.averageMessageLength,
          next.averageMessageLength
        ),

      shortMessageRatio:
        weightedAverage(
          old.communication?.shortMessageRatio,
          next.shortMessageRatio
        ),

      taglishSignalCount:
        Math.max(
          Number(
            old.communication?.taglishSignalCount || 0
          ),
          Number(
            next.taglishSignalCount || 0
          )
        ),

      abbreviations:
        mergeUnique(
          old.communication?.abbreviations,
          next.abbreviations
        ),

      emojis:
        mergeUnique(
          old.communication?.emojis,
          next.emojis
        ),

      typoSignals:
        mergeUnique(
          old.communication?.typoSignals,
          next.typoSignals
        )
    }
  };
}


// -----------------------------------------------------------------------------
// RETRIEVE PROFILE
// -----------------------------------------------------------------------------

async function getAdaptation(userID) {
  const user = String(userID || "").trim();

  if (!user) {
    return {
      profile: {},
      observations: 0
    };
  }

  await ensureAdaptationTable();

  const result = await db.query(
    `
    SELECT
      profile,
      observations,
      updated_at
    FROM ai_user_adaptation
    WHERE user_id = $1
    LIMIT 1
    `,
    [user]
  );

  if (!result.rows.length) {
    return {
      profile: {},
      observations: 0
    };
  }

  return result.rows[0];
}


// -----------------------------------------------------------------------------
// PROFILE FOR PROMPT
//
// This intentionally returns a compact description.
// We don't want to dump the entire database profile into every Gemini call.
// -----------------------------------------------------------------------------

async function getAdaptationContext(userID) {
  try {
    const data = await getAdaptation(userID);

    const profile = data.profile || {};
    const communication =
      profile.communication || {};

    if (
      !communication ||
      Number(data.observations || 0) <= 0
    ) {
      return "";
    }

    const lines = [];

    if (
      typeof communication.lowercaseRatio ===
        "number" &&
      communication.lowercaseRatio >= 0.65
    ) {
      lines.push(
        "- Usually types in lowercase."
      );
    }

    if (
      typeof communication.averageMessageLength ===
        "number"
    ) {
      lines.push(
        `- Average observed message length: ${Math.round(
          communication.averageMessageLength
        )} characters.`
      );
    }

    if (
      typeof communication.shortMessageRatio ===
        "number" &&
      communication.shortMessageRatio >= 0.6
    ) {
      lines.push(
        "- Frequently uses short Messenger-style messages."
      );
    }

    if (
      Number(
        communication.taglishSignalCount || 0
      ) >= 2
    ) {
      lines.push(
        "- Frequently mixes Filipino and English naturally."
      );
    }

    if (
      Array.isArray(communication.abbreviations) &&
      communication.abbreviations.length
    ) {
      lines.push(
        `- Frequently observed shorthand: ${communication.abbreviations
          .slice(0, 15)
          .join(", ")}`
      );
    }

    if (
      Array.isArray(communication.emojis) &&
      communication.emojis.length
    ) {
      lines.push(
        `- Frequently observed emojis: ${communication.emojis
          .slice(0, 10)
          .join(" ")}`
      );
    }

    if (
      Array.isArray(communication.typoSignals) &&
      communication.typoSignals.length
    ) {
      lines.push(
        "- Sometimes makes rushed/accidental spelling mistakes."
      );
    }

    if (!lines.length) {
      return "";
    }

    return `
LEARNED COMMUNICATION PROFILE
These observations were learned gradually from the user's own messages.

${lines.join("\n")}

Use these patterns naturally.
Do not imitate every message literally.
Do not force abbreviations or typos into every response.
The learned profile is guidance, not a script.
`;
  } catch (error) {
    console.error(
      "[adaptation] Failed to build adaptation context:",
      error
    );

    return "";
  }
}


// -----------------------------------------------------------------------------
// RESET
// -----------------------------------------------------------------------------

async function resetAdaptation(senderID) {
  if (!isTrainingOwner(senderID)) {
    return false;
  }

  try {
    await ensureAdaptationTable();

    await db.query(
      `
      DELETE FROM ai_user_adaptation
      WHERE user_id = $1
      `,
      [String(senderID).trim()]
    );

    console.log(
      "[adaptation] Owner adaptation profile reset."
    );

    return true;
  } catch (error) {
    console.error(
      "[adaptation] Failed to reset profile:",
      error
    );

    return false;
  }
}


// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function mergeUnique(first, second) {
  const values = [
    ...(Array.isArray(first) ? first : []),
    ...(Array.isArray(second) ? second : [])
  ];

  return [...new Set(values)].slice(0, 50);
}


function weightedAverage(a, b) {
  const first =
    typeof a === "number" ? a : null;

  const second =
    typeof b === "number" ? b : null;

  if (first === null && second === null) {
    return null;
  }

  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return round(
    first * 0.7 +
    second * 0.3
  );
}


function round(number) {
  return Math.round(
    Number(number || 0) * 100
  ) / 100;
}


function escapeRegex(value) {
  return String(value || "").replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

module.exports = {
  isTrainingOwner,
  isTrainingActive,
  startTraining,
  stopTraining,
  stopAllTraining,

  handleTrainingCommand,
  observeMessage,

  getAdaptation,
  getAdaptationContext,

  resetAdaptation
};
