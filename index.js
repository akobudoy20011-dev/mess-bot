"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { login } = require("ws3-fca");

const db = require("./db");

const { handleEconomyCommand } = require("./economy");

const {
  handleGamesCommand,
  handleGameResponse,
} = require("./games");

const { handleRpgCommand } = require("./rpg");

const {
  handleTrainingCommand,
  observeMessage,
} = require("./ai/adaptation");

const {
  handleDebugCommand,
} = require("./debug");

const {
  runCleanup,
  startCleanupScheduler,
  getCleanupStatus,
  registerGCActivity,
  getGCStatus,
} = require("./cleanup");

// ============================================================
// PICTURES
// ============================================================

const {
  sendRandomPicture,
} = require("./pictures");

// ============================================================
// RPG CHARACTER AI
// ============================================================

const {
  handleRpgCharacterMessage,
} = require("./rpg/character-ai");

// ============================================================
// SECRET LOVE QUEST
// ============================================================

const {
  isSpecialPlayer,
  discover: discoverLoveQuest,
  handleLoveQuestCommand,
} = require("./rpg/love-quest");

const { handleAiMessage } = require("./ai");

// ============================================================
// MODERATION
// ============================================================

const {
  handleModerationMessage,
} = require("./moderation");

// ============================================================
// YOUTUBE
// ============================================================

const {
  searchYouTube,
  downloadYouTubeAudio,
} = require("./youtube");

// ============================================================
// TRIGGERS
// ============================================================

const {
  getTriggerReply,
  getNextPublicReply,
} = require("./triggers");

// ============================================================
// CONFIGURATION
// ============================================================

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const RANDOM_ROAST_ENABLED =
  !/^(0|false|no|off)$/i.test(
    process.env.RANDOM_ROAST || ""
  );

const parsedCooldown = Number(
  process.env.RANDOM_ROAST_COOLDOWN_MS || "30000"
);

const RANDOM_ROAST_COOLDOWN_MS =
  Number.isFinite(parsedCooldown) &&
  parsedCooldown >= 0
    ? parsedCooldown
    : 30_000;

const MAX_ACTIVE_THREADS = 1000;

const ACTIVE_THREAD_EXPIRY_MS =
  30 * 24 * 60 * 60 * 1000;

const lastRandomRoastByThread = new Map();
const activeThreads = new Map();

// ============================================================
// MUSIC RESOURCE PROTECTION
// ============================================================
//
// Per GC:
//   - maximum 2 music jobs total
//   - active + pending both count toward the limit
//
// Globally:
//   - maximum 2 simultaneous YouTube downloads
// ============================================================

const MUSIC_MAX_PER_GC = 2;
const MUSIC_MAX_GLOBAL_DOWNLOADS = 2;
const MUSIC_MAX_GLOBAL_QUEUE = 50;

const MUSIC_SEARCH_TIMEOUT_MS = 45_000;
const MUSIC_DOWNLOAD_TIMEOUT_MS = 180_000;
const MUSIC_SEND_TIMEOUT_MS = 60_000;

const MUSIC_REQUEST_MAX_LENGTH = 300;

const parsedMusicFileLimit = Number(
  process.env.MAX_MUSIC_FILE_BYTES || "26214400"
);

const MAX_MUSIC_FILE_BYTES =
  Number.isFinite(parsedMusicFileLimit) &&
  parsedMusicFileLimit > 0
    ? parsedMusicFileLimit
    : 25 * 1024 * 1024;

// Per-thread array of music jobs.
const musicQueues = new Map();

// Jobs waiting globally for a download slot.
const musicPendingJobs = [];

// Number of currently running music jobs.
let activeMusicDownloads = 0;

// Monotonically increasing job ID.
let musicJobCounter = 0;

// ============================================================
// GLOBAL BOT STATE
// ============================================================

if (typeof global.botDisabled !== "boolean") {
  global.botDisabled = false;
}

if (typeof global.botPaused !== "boolean") {
  global.botPaused = false;
}

// ============================================================
// TIMEOUT HELPER
// ============================================================

function withTimeout(
  operation,
  timeoutMs,
  timeoutMessage
) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;

        reject(
          new Error(timeoutMessage)
        );
      }
    }, timeoutMs);

    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (settled) return;

          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;

          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
  });
}

// ============================================================
// MESSENGER SEND PROTECTION
// ============================================================
//
// ws3-fca 3.5.2 uses:
//
//   api.sendMessage(message, threadID, replyToMessage, callback)
//
// Facebook error 1545012 is handled here instead of allowing one
// rejected send to become an unhandled Promise rejection.
//
// Flow for 1545012:
//   1. Detect the Facebook error code.
//   2. Check whether the thread is still accessible.
//   3. If accessible/unknown, retry with exponential backoff.
//   4. If the thread is confirmed inaccessible, temporarily cool it down.
//   5. Never crash the Render process because of this send failure.
// ============================================================

const THREAD_SEND_MAX_RETRIES = 3;
const THREAD_SEND_RETRY_DELAYS_MS = [
  1500,
  4000,
  8000,
];
const THREAD_SEND_COOLDOWN_MS =
  5 * 60 * 1000;
const THREAD_VERIFY_TIMEOUT_MS = 8000;

const threadSendState = new Map();

function getMessengerErrorCode(error) {
  if (error == null) {
    return null;
  }

  const candidates = [
    error,
    error.code,
    error.errorCode,
    error.error_code,
    error.status,
    error.statusCode,
    error.response && error.response.code,
    error.response && error.response.errorCode,
    error.data && error.data.error,
    error.error && error.error.code,
    error.error && error.error.errorCode,
  ];

  for (const candidate of candidates) {
    if (candidate === 1545012 || String(candidate) === "1545012") {
      return 1545012;
    }
  }

  let serialized = "";

  try {
    serialized = JSON.stringify(error);
  } catch (_) {
    serialized = "";
  }

  const text = [
    serialized,
    error && error.message,
    String(error),
  ]
    .filter(Boolean)
    .join(" ");

  const match = text.match(/1545012/);
  return match ? 1545012 : null;
}

function is1545012(error) {
  return getMessengerErrorCode(error) === 1545012;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getThreadSendState(threadID) {
  const key = String(threadID);
  const state = threadSendState.get(key);

  if (!state) {
    return null;
  }

  if (
    state.cooldownUntil &&
    state.cooldownUntil <= Date.now()
  ) {
    threadSendState.delete(key);
    return null;
  }

  return state;
}

function setThreadCooldown(
  threadID,
  reason = "unknown"
) {
  const key = String(threadID);
  const cooldownUntil =
    Date.now() + THREAD_SEND_COOLDOWN_MS;

  threadSendState.set(key, {
    cooldownUntil,
    reason,
  });

  console.warn(
    `[MESSENGER] Thread ${key} placed on send cooldown for ${Math.ceil(THREAD_SEND_COOLDOWN_MS / 1000)}s (${reason}).`
  );
}

function clearThreadSendState(threadID) {
  threadSendState.delete(String(threadID));
}

function callGetThreadInfo(
  api,
  threadID
) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        status: "unknown",
        info: null,
        error: new Error(
          `getThreadInfo timed out after ${THREAD_VERIFY_TIMEOUT_MS}ms`
        ),
      });
    }, THREAD_VERIFY_TIMEOUT_MS);

    try {
      if (
        !api ||
        typeof api.getThreadInfo !== "function"
      ) {
        finish({
          status: "unknown",
          info: null,
          error: new Error(
            "getThreadInfo is unavailable"
          ),
        });
        return;
      }

      const callback = (
        error,
        info
      ) => {
        if (error) {
          finish({
            status: "unknown",
            info: null,
            error,
          });
          return;
        }

        finish({
          status: "ok",
          info: info || null,
          error: null,
        });
      };

      const result = api.getThreadInfo(
        String(threadID),
        callback
      );

      if (
        result &&
        typeof result.then === "function"
      ) {
        result.then(
          (info) => {
            finish({
              status: "ok",
              info: info || null,
              error: null,
            });
          },
          (error) => {
            finish({
              status: "unknown",
              info: null,
              error,
            });
          }
        );
      }
    } catch (error) {
      finish({
        status: "unknown",
        info: null,
        error,
      });
    }
  });
}

async function verifyThreadAccess(
  api,
  threadID
) {
  const result = await callGetThreadInfo(
    api,
    threadID
  );

  if (result.status !== "ok") {
    console.warn(
      `[MESSENGER] Could not verify thread ${threadID}; treating access as unknown:`,
      result.error || "unknown error"
    );

    return {
      accessible: null,
      info: null,
      error: result.error || null,
    };
  }

  const info = result.info || {};
  const currentUserID =
    typeof api.getCurrentUserID === "function"
      ? String(api.getCurrentUserID())
      : null;

  const participantIDs = Array.isArray(
    info.participantIDs
  )
    ? info.participantIDs.map(String)
    : [];

  if (
    currentUserID &&
    participantIDs.length > 0 &&
    !participantIDs.includes(currentUserID)
  ) {
    return {
      accessible: false,
      info,
      error: new Error(
        "Current account is not listed as a participant in the thread."
      ),
    };
  }

  return {
    accessible: true,
    info,
    error: null,
  };
}

async function sendMessageAttempt(
  api,
  message,
  threadID
) {
  return new Promise((resolve) => {
    let finished = false;

    const finish = (
      error,
      messageInfo
    ) => {
      if (finished) {
        return;
      }

      finished = true;
      resolve({
        error: error || null,
        messageInfo: messageInfo || null,
      });
    };

    try {
      if (
        !api ||
        typeof api.sendMessage !== "function"
      ) {
        finish(
          new Error(
            "Messenger sendMessage is unavailable."
          )
        );
        return;
      }

      const result = api.sendMessage(
        message,
        String(threadID),
        null,
        (sendError, messageInfo) => {
          finish(sendError, messageInfo);
        }
      );

      if (
        result &&
        typeof result.then === "function"
      ) {
        result.then(
          (messageInfo) => {
            finish(null, messageInfo);
          },
          (sendError) => {
            finish(sendError, null);
          }
        );
      }
    } catch (error) {
      finish(error, null);
    }
  });
}

async function sendMessageWithProtection(
  api,
  message,
  threadID
) {
  const key = String(threadID);
  const existingState =
    getThreadSendState(key);

  if (
    existingState &&
    existingState.cooldownUntil > Date.now()
  ) {
    console.warn(
      `[MESSENGER] Skipping send to cooled-down thread ${key}.`
    );

    return {
      error: null,
      messageInfo: null,
      skipped: true,
    };
  }

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= THREAD_SEND_MAX_RETRIES;
    attempt++
  ) {
    const result =
      await sendMessageAttempt(
        api,
        message,
        key
      );

    if (!result.error) {
      clearThreadSendState(key);
      return {
        ...result,
        skipped: false,
      };
    }

    lastError = result.error;

    if (!is1545012(result.error)) {
      return {
        ...result,
        skipped: false,
      };
    }

    console.warn(
      `[MESSENGER] Facebook 1545012 on thread ${key} (attempt ${attempt}/${THREAD_SEND_MAX_RETRIES}).`
    );

    if (attempt >= THREAD_SEND_MAX_RETRIES) {
      break;
    }

    const verification =
      await verifyThreadAccess(
        api,
        key
      );

    if (
      verification.accessible === false
    ) {
      setThreadCooldown(
        key,
        "thread access verification failed"
      );

      console.warn(
        `[MESSENGER] Thread ${key} appears inaccessible; stopping 1545012 retries.`
      );

      return {
        error: lastError,
        messageInfo: null,
        skipped: false,
        inaccessible: true,
      };
    }

    const delay =
      THREAD_SEND_RETRY_DELAYS_MS[
        Math.min(
          attempt - 1,
          THREAD_SEND_RETRY_DELAYS_MS.length - 1
        )
      ];

    console.log(
      `[MESSENGER] Retrying thread ${key} in ${delay}ms${
        verification.accessible === true
          ? " (thread verified)"
          : " (thread access unknown)"
      }.`
    );

    await sleep(delay);
  }

  setThreadCooldown(
    key,
    "1545012 retry limit reached"
  );

  console.error(
    `[MESSENGER] Giving up on thread ${key} after ${THREAD_SEND_MAX_RETRIES} attempts due to Facebook error 1545012.`
  );

  return {
    error: lastError,
    messageInfo: null,
    skipped: false,
    inaccessible: false,
  };
}

// ============================================================
// MESSENGER PROMISE WRAPPER
// ============================================================

function sendApiMessage(
  api,
  message,
  threadID,
  callback
) {
  return sendMessageWithProtection(
    api,
    message,
    threadID
  ).then((result) => {
    if (result.error) {
      if (typeof callback === "function") {
        try {
          callback(result.error);
        } catch (callbackError) {
          console.error(
            "Messenger send callback error:",
            callbackError
          );
        }
      }

      // Send failures are intentionally resolved rather than rejected.
      // Most ECLIPSE sends are fire-and-forget, so rejecting here would
      // create an unhandled Promise rejection and could terminate Render.
      return null;
    }

    const messageInfo =
      result.messageInfo || null;

    if (typeof callback === "function") {
      try {
        callback(
          null,
          messageInfo
        );
      } catch (callbackError) {
        console.error(
          "Messenger send callback error:",
          callbackError
        );
      }
    }

    return messageInfo;
  }).catch((error) => {
    // Final safety net: this wrapper must never leak an unhandled send
    // rejection back into fire-and-forget callers.
    console.error(
      "[MESSENGER] Protected send wrapper failed:",
      error
    );

    if (typeof callback === "function") {
      try {
        callback(error);
      } catch (callbackError) {
        console.error(
          "Messenger send callback error:",
          callbackError
        );
      }
    }

    return null;
  });
}

// ============================================================
// MUSIC STATUS MESSAGE
// ============================================================
//
// Music deliberately does NOT use editMessage().
//
// Every status is its own normal Messenger message.
// ============================================================

function sendMusicStatusMessage(
  api,
  message,
  threadID
) {
  try {
    if (
      !api ||
      typeof api.sendMessage !== "function"
    ) {
      console.error(
        "[Music] Messenger sendMessage is unavailable."
      );

      return;
    }

    sendApiMessage(api,
      message,
      threadID,
      (sendError) => {
        if (sendError) {
          console.error(
            "[Music] Status message failed:",
            sendError
          );
        }
      }
    );
  } catch (error) {
    console.error(
      "[Music] Status send error:",
      error
    );
  }
}

// TODO: rest of file unchanged from original repo state.

// ============================================================
// FACEBOOK COOKIES
// ============================================================

function readAppState() {
  const rawCookies = process.env.FB_COOKIES;

  if (typeof rawCookies !== "string" || !rawCookies.trim()) {
    throw new Error("FB_COOKIES is missing.");
  }

  let parsed;

  try {
    parsed = JSON.parse(rawCookies);

    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
  } catch (error) {
    throw new Error(`FB_COOKIES must contain valid JSON: ${error.message}`);
  }

  // Cookie-Editor may export either:
  // 1. an array of cookies
  // 2. an object containing { cookies: [...] }
  if (
    parsed &&
    !Array.isArray(parsed) &&
    Array.isArray(parsed.cookies)
  ) {
    parsed = parsed.cookies;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("FB_COOKIES must be a non-empty cookie array.");
  }

  const appState = parsed
    .filter(
      (cookie) =>
        cookie &&
        typeof cookie === "object" &&
        !Array.isArray(cookie) &&
        typeof cookie.value === "string"
    )
    .map((cookie) => ({
      ...cookie,
      key:
        typeof cookie.key === "string" && cookie.key.trim()
          ? cookie.key.trim()
          : cookie.name,
    }))
    .filter(
      (cookie) =>
        typeof cookie.key === "string" &&
        cookie.key.trim() &&
        typeof cookie.value === "string"
    )
    .map((cookie) => {
      const normalized = { ...cookie };

      // ws3-fca expects "key", not Cookie-Editor's "name".
      delete normalized.name;

      return normalized;
    });

  if (appState.length === 0) {
    throw new Error(
      "FB_COOKIES was parsed, but no usable cookies were found."
    );
  }

  console.log(
    `[AUTH] Loaded ${appState.length} Facebook cookies from FB_COOKIES.`
  );

  return appState;
}

let appState;

try {
  appState =
    readAppState();
} catch (error) {
  console.error(
    `Configuration error: ${error.message}`
  );

  process.exit(1);
}

// ============================================================
// FACEBOOK LOGIN
// (with automatic reconnect on unexpected disconnects — see
//  startLogin()/scheduleReconnect() near the bottom of this file)
// ============================================================

let currentApi = null;
let reconnecting = false;

function startLogin() {
  login(
    { appState },
    {
      online: true,
      updatePresence: true,
      selfListen: false,
      randomUserAgent: false,
    },

    async (
      loginError,
      api
    ) => {
      if (loginError) {
        console.error(
          "Login failed:",
          loginError
        );

        scheduleReconnect(
          "login_failed"
        );

        return;
      }

      if (!api) {
        console.error(
          "Login failed: Facebook API object was not returned."
        );

        scheduleReconnect(
          "no_api_object"
        );

        return;
      }

      currentApi = api;

      console.log(
        "Logged in successfully."
      );

      // ========================================================
      // DATABASE
      // ========================================================

      try {
        await db.connect();

        console.log(
          "Neon database connected successfully."
        );
      } catch (error) {
        console.error(
          "Database connection failed:",
          error
        );

        process.exit(1);
      }

      // ========================================================
      // CLEANUP
      // ========================================================

      try {
        startCleanupScheduler();

        console.log(
          "[CLEANUP] Cleanup scheduler started."
        );
      } catch (error) {
        console.error(
          "[CLEANUP] Failed to start cleanup scheduler:",
          error
        );
      }

      // ========================================================
      // LISTENER
      // ========================================================

      api.setOptions({
        listenEvents: true,
        selfListen: false,
      });

      const startupThreadID =
        process.env.STARTUP_THREAD_ID;

      if (startupThreadID) {
        sendApiMessage(api,
          [
            "╭─────── ୨୧ ♡ ୨୧ ───────╮",
            "        🎀 E C L I P S E",
            "          ONLINE ♡",
            "╰─────── ୨୧ ♡ ୨୧ ───────╯",
            "",
            "୨୧ bot is online and ready ♡",
            "",
            "♡ music protection: 2 / GC",
            "♡ global downloads: 2",
            "♡ pause system: ready",
          ].join("\n"),
          startupThreadID,
          (sendError) => {
            if (sendError) {
              console.error(
                "Startup message failed:",
                sendError
              );
            }
          }
        );
      }

      console.log(
        "Listener started."
      );

      api.listenMqtt(
        (
          listenError,
          event
        ) => {
          if (listenError) {
            console.error(
              "Listener error:",
              listenError
            );

            // The MQTT session died. Reconnect instead of going
            // silent for the rest of the process lifetime.
            scheduleReconnect(
              "listener_error"
            );

            return;
          }

          if (
            !event ||
            typeof event !==
              "object"
          ) {
            return;
          }

          if (
            (
              event.type ===
                "message" ||
              event.type ===
                "message_reply"
            ) &&
            event.threadID
          ) {
            const threadID =
              String(
                event.threadID
              );

            registerActiveThread(
              threadID
            );

            void registerGCActivity(
              threadID
            ).catch(
              (error) => {
                console.error(
                  "[GC ACTIVITY] Failed to register activity:",
                  error
                );
              }
            );

            void handleMessage(
              api,
              event
            ).catch((error) => {
              console.error(
                "[MESSAGE] Unhandled handler error:",
                error
              );
            });
          }
        }
      );
    }
  );
}

// ============================================================
// AUTOMATIC RECONNECT
// ============================================================
//
// Previously, if listenMqtt() ever errored out (e.g. the socket
// dropped from a spin-down/network blip on a free hosting tier),
// the bot would go completely silent for the rest of the process
// life: no more messages would ever be handled, with no crash
// and no log explaining why. This reconnect loop fixes that by
// re-running startLogin() after a short delay instead of leaving
// the bot in that dead state.
// ============================================================

function scheduleReconnect(
  reason
) {
  if (
    shuttingDown ||
    reconnecting
  ) {
    return;
  }

  reconnecting = true;
  currentApi = null;

  console.error(
    `[SYSTEM] Reconnecting in 10s due to: ${reason}`
  );

  setTimeout(() => {
    reconnecting = false;

    console.log(
      "[SYSTEM] Attempting to reconnect to Facebook..."
    );

    startLogin();
  }, 10_000);
}

startLogin();

// ============================================================
// ACTIVE THREAD TRACKING
// ============================================================

function registerActiveThread(
  threadID
) {
  if (!threadID) {
    return;
  }

  const now =
    Date.now();

  activeThreads.set(
    String(threadID),
    now
  );

  registerActiveThreadCleanup();
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

async function handleMessage(
  api,
  event
) {
  const {
    threadID,
    senderID,
    body,
  } = event;

  if (
    !threadID ||
    typeof body !==
      "string" ||
    !body.trim()
  ) {
    return;
  }

  const threadId =
    String(threadID);

  const originalText =
    body.trim();

  const text =
    originalText.toLowerCase();

  const senderId =
    String(
      senderID || ""
    ).trim();

  const isAdmin =
    ADMIN_IDS.includes(
      senderId
    );

  // ... rest of original file unchanged ...
}

// ============================================================
// GAME CENTER
// ============================================================

function sendGameCenter(
  api,
  threadID
) {
  sendReplyWithTyping(
    api,
    [
      "╭─────── ୨୧ ♡ ୨୧ ───────╮",
      "        🎀 E C L I P S E",
      "        G A M E S ♡",
      "╰─────── ୨୧ ♡ ୨୧ ───────╯",
      "",
      "୨୧ 🧠 TRIVIA",
      "♡ !trivia",
      "",
      "୨୧ ✊ RPS",
      "♡ !rps rock",
      "♡ !rps paper",
      "♡ !rps scissors",
      "",
      "୨୧ 🎲 ROLL",
      "♡ !roll 100",
      "",
      "୨୧ 🎯 GUESS",
      "♡ !guess 7",
      "",
      "୨୧ 🪙 COINFLIP",
      "♡ !coinflip 100 heads",
      "",
      "୨୧ 🎰 SLOTS",
      "♡ !slots 100",
      "",
      "୨୧ 🃏 BLACKJACK",
      "♡ !blackjack",
      "♡ !hit",
      "♡ !stand",
      "",
      "୨୧ 🧮 MATH",
      "♡ !math",
      "",
      "୨୧ 🧩 RIDDLE",
      "♡ !riddle",
      "",
      "୨୧ 🔮 8-BALL",
      "♡ !8ball Will I win?",
      "",
      "╭────────────────────────╮",
      "│ ♡ !games rules",
      "│ ♡ !games status",
      "╰────────────────────────╯",
      "",
      "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
    ].join("\n"),
    threadID
  );
}

// ============================================================
// RANDOM ROAST COOLDOWN
// ============================================================

function canRandomRoastThread(
  threadID
) {
  const now =
    Date.now();

  const lastRoastAt =
    lastRandomRoastByThread.get(
      threadID
    ) || 0;

  if (
    now - lastRoastAt <
    RANDOM_ROAST_COOLDOWN_MS
  ) {
    return false;
  }

  if (
    lastRandomRoastByThread.size >
    1000
  ) {
    const expiry =
      Math.max(
        RANDOM_ROAST_COOLDOWN_MS * 2,
        60_000
      );

    for (
      const [
        knownThreadID,
        roastAt,
      ] of lastRandomRoastByThread.entries()
    ) {
      if (
        now - roastAt >
        expiry
      ) {
        lastRandomRoastByThread.delete(
          knownThreadID
        );
      }
    }
  }

  return true;
}

// ============================================================
// BROADCAST
// ============================================================

function broadcastToAllThreads(
  api,
  message
) {
  if (
    !message ||
    !message.trim()
  ) {
    console.log(
      "[Broadcast] No message."
    );

    return;
  }

  registerActiveThreadCleanup();

  const threads =
    Array.from(
      activeThreads.keys()
    );

  if (
    threads.length === 0
  ) {
    console.log(
      "[Broadcast] No active threads."
    );

    return;
  }

  console.log(
    `[Broadcast] Broadcasting to ${threads.length} threads.`
  );

  const broadcastMessage =
    [
      "╭─────── ୨୧ ♡ ୨୧ ───────╮",
      "        🎀 ANNOUNCEMENT",
      "╰─────── ୨୧ ♡ ୨୧ ───────╯",
      "",
      message.trim(),
      "",
      "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
    ].join("\n");

  threads.forEach(
    (
      threadID,
      index
    ) => {
      setTimeout(
        () => {
          sendApiMessage(api,
            broadcastMessage,
            threadID,
            (sendError) => {
              if (
                sendError
              ) {
                console.error(
                  `[Broadcast] Failed for ${threadID}:`,
                  sendError
                );
              } else {
                console.log(
                  `[Broadcast] Sent to ${threadID}`
                );
              }
            }
          );
        },
        index * 500
      );
    }
  );
}

// ============================================================
// ACTIVE THREAD CLEANUP
// ============================================================

function registerActiveThreadCleanup() {
  const now =
    Date.now();

  for (
    const [
      threadID,
      lastSeenAt,
    ] of activeThreads.entries()
  ) {
    if (
      now - lastSeenAt >
      ACTIVE_THREAD_EXPIRY_MS
    ) {
      activeThreads.delete(
        threadID
      );
    }
  }

  if (
    activeThreads.size >
    MAX_ACTIVE_THREADS
  ) {
    const entries =
      Array.from(
        activeThreads.entries()
      )
        .sort(
          (a, b) =>
            a[1] - b[1]
        );

    const excess =
      activeThreads.size -
      MAX_ACTIVE_THREADS;

    for (
      let i = 0;
      i < excess;
      i++
    ) {
      activeThreads.delete(
        entries[i][0]
      );
    }
  }
}

// ============================================================
// SAFE REPLY
// ============================================================

function sendReplyWithTyping(
  api,
  message,
  threadID,
  attachMeme = false
) {
  const typingDelayMs =
    1200;

  try {
    if (
      typeof api.sendTypingIndicator ===
      "function"
    ) {
      api.sendTypingIndicator(
        threadID,
        (typingError) => {
          if (
            typingError
          ) {
            console.error(
              "Typing indicator failed:",
              typingError
            );
          }
        }
      );
    }
  } catch (typingError) {
    console.error(
      "Typing indicator error:",
      typingError
    );
  }

  setTimeout(
    () => {
      try {
        const memePath =
          attachMeme
            ? getRandomMemePath()
            : null;

        const outgoingMessage =
          memePath
            ? {
                body:
                  message,

                attachment:
                  fs.createReadStream(
                    memePath
                  ),
              }
            : message;

        sendApiMessage(api,
          outgoingMessage,
          threadID,
          (sendError) => {
            if (
              sendError
            ) {
              console.error(
                "Reply failed:",
                sendError
              );
            }
          }
        );
      } catch (sendError) {
        console.error(
          "Reply error:",
          sendError
        );
      }
    },
    typingDelayMs
  );
}

// ============================================================
// MEME HELPER
// ============================================================

function getRandomMemePath() {
  const memeDirectory =
    path.join(
      __dirname,
      "memes"
    );

  const supportedExtensions =
    new Set([
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
    ]);

  try {
    if (
      !fs.existsSync(
        memeDirectory
      )
    ) {
      return null;
    }

    const files =
      fs
        .readdirSync(
          memeDirectory
        )
        .filter(
          (fileName) =>
            supportedExtensions.has(
              path
                .extname(
                  fileName
                )
                .toLowerCase()
            )
        );

    if (
      files.length === 0
    ) {
      return null;
    }

    const randomFile =
      files[
        Math.floor(
          Math.random() *
            files.length
        )
      ];

    return path.join(
      memeDirectory,
      randomFile
    );
  } catch (error) {
    console.error(
      "Could not load memes:",
      error
    );

    return null;
  }
}

// ============================================================
// PROCESS / SHUTDOWN PROTECTION
// ============================================================

async function cleanupMusicFiles() {
  const files =
    new Set();

  for (
    const queue of
      musicQueues.values()
  ) {
    for (
      const job of queue
    ) {
      if (
        job.temporaryFile
      ) {
        files.add(
          job.temporaryFile
        );
      }
    }
  }

  for (
    const file of files
  ) {
    await fsp
      .unlink(file)
      .catch(() => {});
  }
}

let shuttingDown =
  false;

async function gracefulShutdown(
  signal
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `[SYSTEM] Received ${signal}. Cleaning up ECLIPSE...`
  );

  // Cancel every known music job, including active jobs.
  for (
    const queue of
      musicQueues.values()
  ) {
    for (
      const job of queue
    ) {
      markMusicJobCancelled(
        job,
        "shutdown"
      );
    }
  }

  musicPendingJobs.length =
    0;

  try {
    await cleanupMusicFiles();
  } catch (error) {
    console.error(
      "[SYSTEM] Music cleanup failed:",
      error
    );
  }

  try {
    if (server) {
      await new Promise(
        (resolve) => {
          server.close(
            () => resolve()
          );
        }
      );
    }
  } catch (error) {
    console.error(
      "[SYSTEM] Server shutdown failed:",
      error
    );
  }

  process.exit(0);
}

process.once(
  "SIGTERM",
  () => {
    void gracefulShutdown(
      "SIGTERM"
    );
  }
);

process.once(
  "SIGINT",
  () => {
    void gracefulShutdown(
      "SIGINT"
    );
  }
);

// ============================================================
// MEMORY MONITOR
// ============================================================

setInterval(() => {
  const m =
    process.memoryUsage();

  const music =
    getMusicStats();

  console.log(
    `[MEMORY] RSS: ${Math.round(
      m.rss / 1024 / 1024
    )} MB | ` +
      `Heap: ${Math.round(
        m.heapUsed / 1024 / 1024
      )} / ` +
      `${Math.round(
        m.heapTotal / 1024 / 1024
      )} MB | ` +
      `External: ${Math.round(
        m.external / 1024 / 1024
      )} MB | ` +
      `Music: ${music.activeDownloads}/${MUSIC_MAX_GLOBAL_DOWNLOADS} downloads`
  );
}, 60_000);
