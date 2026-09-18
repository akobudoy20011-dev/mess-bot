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

let shuttingDown = false;
let currentApi = null;
let reconnecting = false;
let loginGeneration = 0;
let reconnectTimer = null;
let mqttListenerActive = false;

let lastMessengerEventAt = null;
let lastSuccessfulSendAt = null;
let lastListenerErrorAt = null;
let lastLoginAttemptAt = null;
let lastLoginSuccessAt = null;
let lastReconnectAt = null;

const MESSENGER_WATCHDOG_MS = Number.parseInt(
  process.env.MESSENGER_WATCHDOG_MS || "180000",
  10
);

if (typeof global.botDisabled !== "boolean") {
  global.botDisabled = false;
}

if (typeof global.botPaused !== "boolean") {
  global.botPaused = false;
}

function invalidateCurrentApi(reason) {
  if (currentApi) {
    console.warn(
      `[FB] Invalidating stale Messenger session (${reason}).`
    );
  }

  currentApi = null;
  mqttListenerActive = false;
}

function resetMessengerWatchdog() {
  if (!Number.isFinite(MESSENGER_WATCHDOG_MS) || MESSENGER_WATCHDOG_MS <= 0) {
    return;
  }

  if (typeof global.__messengerWatchdogTimer !== "undefined") {
    clearTimeout(global.__messengerWatchdogTimer);
  }

  global.__messengerWatchdogTimer = setTimeout(() => {
    if (shuttingDown || reconnecting) {
      return;
    }

    if (!currentApi || !mqttListenerActive) {
      return;
    }

    console.warn(
      `[WATCHDOG] No Messenger activity for ${MESSENGER_WATCHDOG_MS}ms. Invalidating stale session.`
    );

    invalidateCurrentApi("watchdog_inactive");
    scheduleReconnect("watchdog_inactive");
  }, MESSENGER_WATCHDOG_MS);
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
        (
          sendError,
          messageInfo
        ) => {
          finish(
            sendError,
            messageInfo
          );
        }
      );

      if (
        result &&
        typeof result.then === "function"
      ) {
        result.then(
          (messageInfo) => {
            finish(
              null,
              messageInfo
            );
          },
          (sendError) => {
            finish(
              sendError,
              null
            );
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
      lastSuccessfulSendAt = new Date().toISOString();
      console.log(
        `[SEND] Success thread=${key} attempt=${attempt}`
      );

      return {
        ...result,
        skipped: false,
      };
    }

    lastError = result.error;

    if (!is1545012(result.error)) {
      console.error(
        `[SEND] Failed thread=${key} errorCode=${getMessengerErrorCode(result.error)} error=${String(
          result.error
        )}`
      );

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

// ============================================================
// MUSIC AUDIO SENDER
// ============================================================
//
// Watches:
//   1. Messenger callback errors
//   2. Read-stream errors
//   3. Job cancellation state
// ============================================================

function sendMusicAudio(
  api,
  filePath,
  body,
  threadID,
  job = null
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream = null;

    const finish = (error, messageInfo) => {
      if (settled) return;
      settled = true;

      if (stream) {
        try {
          stream.destroy();
        } catch {}
      }

      if (job) {
        job.audioStream = null;
      }

      if (error) {
        reject(
          error instanceof Error
            ? error
            : new Error(String(error))
        );
      } else {
        resolve(messageInfo || null);
      }
    };

    try {
      if (
        !api ||
        typeof api.sendMessage !== "function"
      ) {
        finish(
          new Error("Messenger sendMessage is unavailable.")
        );
        return;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        finish(
          new Error("Audio file no longer exists.")
        );
        return;
      }

      if (job?.cancelled) {
        finish(
          new Error("Music request was cancelled.")
        );
        return;
      }

      stream = fs.createReadStream(filePath);

      if (job) {
        job.audioStream = stream;
      }

      stream.once("error", (error) => {
        console.error("[Music] Audio stream error:", error);
        finish(error);
      });

      let callbackFinished = false;

      const callback = (error, messageInfo) => {
        if (callbackFinished) return;
        callbackFinished = true;

        finish(error, messageInfo);
      };

      const result = api.sendMessage(
        {
          body,
          attachment: stream,
        },
        String(threadID),
        null,
        callback
      );

      if (
        result &&
        typeof result.then === "function"
      ) {
        result.then(
          (messageInfo) => callback(null, messageInfo),
          (error) => callback(error, null)
        );
      }
    } catch (error) {
      finish(error);
    }
  });
}

// ============================================================
// COQUETTE MUSIC PANEL
// ============================================================

function buildMusicPanel({
  title,
  author,
  duration,
  state = "searching",
  position = null,
}) {
  const cleanTitle =
    String(
      title || "Unknown Title"
    ).trim();

  const cleanAuthor =
    String(
      author || ""
    ).trim();

  const cleanDuration =
    String(
      duration || "--:--"
    ).trim();

  const stateMap = {
    pending: {
      icon: "୨୧",
      label: "PENDING",
      detail:
        "waiting for an available music slot ♡",
    },

    searching: {
      icon: "୨୧",
      label: "SEARCHING YOUTUBE",
      detail:
        "finding your song ♡",
    },

    processing: {
      icon: "♡",
      label: "PREPARING AUDIO",
      detail:
        "softly processing your track ♡",
    },

    downloading: {
      icon: "୨୧",
      label: "DOWNLOADING",
      detail:
        "getting your song ready ♡",
    },

    streaming: {
      icon: "♡",
      label: "NOW PLAYING",
      detail:
        "enjoy your music ♡",
    },

    failed: {
      icon: "୨୧",
      label: "PLAYBACK FAILED",
      detail:
        "try another search ♡",
    },

    cancelled: {
      icon: "୨୧",
      label: "CANCELLED",
      detail:
        "music request was cancelled ♡",
    },
  };

  const selected =
    stateMap[state] ||
    stateMap.streaming;

  const queueLine =
    position !== null &&
    Number.isFinite(
      Number(position)
    )
      ? `│ ♡ queue   #${Number(position)}`
      : null;

  return [
    "╭─────── ୨୧ ♡ ୨୧ ───────╮",
    "        🎀 E C L I P S E",
    "          M U S I C",
    "╰─────── ୨୧ ♡ ୨୧ ───────╯",
    "",
    `        ${selected.icon} ${selected.label}`,
    "",
    `୨୧  ${cleanTitle}`,
    cleanAuthor
      ? `     ♡ ${cleanAuthor}`
      : "",
    "",
    "╭────────────────────────╮",
    `│ ♡ status  ${selected.detail}`,
    queueLine,
    `│ ♡ source  YouTube`,
    `│ ♡ time    ${cleanDuration}`,
    "╰────────────────────────╯",
    "",
    "        ♡ ୨୧ 🎀 ୨୧ ♡",
  ]
    .filter(Boolean)
    .join("\n");
}

// ============================================================
// MUSIC HELPERS
// ============================================================

function getMusicQueue(
  threadID
) {
  const id =
    String(threadID);

  let queue =
    musicQueues.get(id);

  if (!queue) {
    queue = [];

    musicQueues.set(
      id,
      queue
    );
  }

  return queue;
}

function getMusicStats() {
  let totalJobs = 0;
  let pendingJobs = 0;
  let activeJobs = 0;

  for (
    const queue of
      musicQueues.values()
  ) {
    totalJobs +=
      queue.length;

    for (
      const job of
      queue
    ) {
      if (
        job.status ===
        "pending"
      ) {
        pendingJobs++;
      }

      if (
        job.status ===
          "searching" ||
        job.status ===
          "processing" ||
        job.status ===
          "downloading" ||
        job.status ===
          "streaming"
      ) {
        activeJobs++;
      }
    }
  }

  return {
    totalJobs,
    pendingJobs,
    activeJobs,
    activeDownloads:
      activeMusicDownloads,
    waitingGlobal:
      musicPendingJobs.length,
    trackedGCs:
      musicQueues.size,
  };
}

function removeMusicJob(
  job
) {
  if (!job) {
    return;
  }

  const queue =
    musicQueues.get(
      job.threadID
    );

  if (!queue) {
    return;
  }

  const index =
    queue.indexOf(job);

  if (index !== -1) {
    queue.splice(
      index,
      1
    );
  }

  if (
    queue.length ===
    0
  ) {
    musicQueues.delete(
      job.threadID
    );
  }
}

function removePendingMusicJob(
  job
) {
  const index =
    musicPendingJobs.indexOf(
      job
    );

  if (index !== -1) {
    musicPendingJobs.splice(
      index,
      1
    );
  }
}

function getMusicQueuePosition(
  job
) {
  const queue =
    musicQueues.get(
      job.threadID
    );

  if (!queue) {
    return null;
  }

  const index =
    queue.indexOf(job);

  if (index === -1) {
    return null;
  }

  return index + 1;
}

// ============================================================
// MUSIC CANCELLATION HELPERS
// ============================================================

function markMusicJobCancelled(
  job,
  reason = "cancelled"
) {
  if (!job) {
    return;
  }

  job.cancelled = true;
  job.cancelReason = reason;
  job.status = "cancelled";

  if (
    job.audioStream &&
    typeof job.audioStream.destroy ===
      "function"
  ) {
    try {
      job.audioStream.destroy();
    } catch (error) {
      console.error(
        `[Music] Failed to destroy audio stream for job ${job.id}:`,
        error
      );
    }

    job.audioStream = null;
  }
}

function getMusicJobsForThread(
  threadID
) {
  const queue =
    musicQueues.get(
      String(threadID)
    );

  if (!queue) {
    return [];
  }

  return [...queue];
}

function cancelAllMusicForThread(
  threadID,
  reason = "stop"
) {
  const jobs =
    getMusicJobsForThread(
      threadID
    );

  let cancelledCount = 0;

  for (
    const job of jobs
  ) {
    if (!job.cancelled) {
      markMusicJobCancelled(
        job,
        reason
      );

      removePendingMusicJob(
        job
      );

      cancelledCount++;
    }
  }

  const queue =
    musicQueues.get(
      String(threadID)
    );

  if (queue) {
    queue.length = 0;
  }

  musicQueues.delete(
    String(threadID)
  );

  return {
    cancelledCount,
  };
}

function clearQueuedMusicForThread(
  threadID
) {
  const queue =
    musicQueues.get(
      String(threadID)
    );

  if (
    !queue ||
    queue.length === 0
  ) {
    return {
      clearedCount: 0,
    };
  }

  let clearedCount = 0;

  for (
    const job of [...queue]
  ) {
    if (
      job.status ===
      "pending"
    ) {
      markMusicJobCancelled(
        job,
        "clear"
      );

      removePendingMusicJob(
        job
      );

      removeMusicJob(
        job
      );

      clearedCount++;
    }
  }

  return {
    clearedCount,
  };
}

function getActiveMusicJobsForThread(
  threadID
) {
  const queue =
    musicQueues.get(
      String(threadID)
    );

  if (!queue) {
    return [];
  }

  return queue.filter(
    (job) =>
      !job.cancelled &&
      (
        job.status === "searching" ||
        job.status === "processing" ||
        job.status === "downloading" ||
        job.status === "streaming"
      )
  );
}

function skipCurrentMusicForThread(
  threadID
) {
  const activeJobs =
    getActiveMusicJobsForThread(
      threadID
    );

  if (
    activeJobs.length ===
    0
  ) {
    return null;
  }

  activeJobs.sort(
    (a, b) =>
      (a.startedAt || a.createdAt) -
      (b.startedAt || b.createdAt)
  );

  const job =
    activeJobs[0];

  markMusicJobCancelled(
    job,
    "skip"
  );

  return job;
}

function formatMusicBytes(
  bytes
) {
  if (
    !Number.isFinite(bytes) ||
    bytes <= 0
  ) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
  ];

  let value = bytes;
  let unitIndex = 0;

  while (
    value >= 1024 &&
    unitIndex <
      units.length - 1
  ) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(
    unitIndex === 0
      ? 0
      : 1
  )} ${units[unitIndex]}`;
}

// ============================================================
// MUSIC QUEUE PROCESSOR
// ============================================================

function processMusicQueue() {
  if (
    global.botDisabled === true ||
    global.botPaused === true
  ) {
    return;
  }

  while (
    activeMusicDownloads <
      MUSIC_MAX_GLOBAL_DOWNLOADS &&
    musicPendingJobs.length >
      0
  ) {
    const job =
      musicPendingJobs.shift();

    if (!job) {
      continue;
    }

    if (
      job.cancelled ||
      job.status !==
        "pending"
    ) {
      continue;
    }

    activeMusicDownloads++;

    void processMusicJob(job)
      .catch((error) => {
        console.error(
          `[Music] Unhandled job ${job.id} error:`,
          error
        );
      })
      .finally(() => {
        activeMusicDownloads =
          Math.max(
            0,
            activeMusicDownloads - 1
          );

        removePendingMusicJob(
          job
        );

        removeMusicJob(
          job
        );

        setImmediate(
          processMusicQueue
        );
      });
  }
}

// ============================================================
// MUSIC JOB
// ============================================================

async function processMusicJob(
  job
) {
  job.startedAt =
    Date.now();

  const {
    api,
    threadID,
  } = job;

  const temporaryFile =
    path.join(
      os.tmpdir(),
      `eclipse-audio-${crypto.randomUUID()}.mp3`
    );

  job.temporaryFile =
    temporaryFile;

  try {
    if (
      job.cancelled
    ) {
      return;
    }

    if (
      global.botDisabled === true ||
      global.botPaused === true
    ) {
      markMusicJobCancelled(
        job,
        "bot_paused"
      );

      return;
    }

    // ========================================================
    // STEP 1
    // SEARCHING
    // ========================================================

    job.status =
      "searching";

    sendMusicStatusMessage(
      api,
      buildMusicPanel({
        title:
          job.requestedSong,
        state:
          "searching",
      }),
      threadID
    );

    console.log(
      `[Music] Job ${job.id}: searching YouTube for "${job.requestedSong}"`
    );

    // ========================================================
    // STEP 2
    // SEARCH YOUTUBE
    // ========================================================

    const video =
      await withTimeout(
        () =>
          searchYouTube(
            job.requestedSong
          ),
        MUSIC_SEARCH_TIMEOUT_MS,
        "YouTube search timed out."
      );

    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id}: cancelled after YouTube search.`
      );

      return;
    }

    if (
      !video ||
      !video.url
    ) {
      throw new Error(
        `No YouTube result found for "${job.requestedSong}".`
      );
    }

    const title =
      String(
        video.title ||
          job.requestedSong
      ).trim();

    const author =
      String(
        video.author ||
          video.channel ||
          ""
      ).trim();

    const duration =
      String(
        video.duration ||
          video.timestamp ||
          "--:--"
      ).trim() ||
      "--:--";

    job.title =
      title;

    job.author =
      author;

    job.duration =
      duration;

    console.log(
      `[Music] Job ${job.id}: found "${title}"${author ? ` by ${author}` : ""}.`
    );

    // ========================================================
    // STEP 3
    // PREPARING
    // ========================================================

    job.status =
      "processing";

    sendMusicStatusMessage(
      api,
      buildMusicPanel({
        title,
        author,
        duration,
        state:
          "processing",
      }),
      threadID
    );

    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id}: cancelled before processing.`
      );

      return;
    }

    if (
      global.botDisabled === true ||
      global.botPaused === true
    ) {
      markMusicJobCancelled(
        job,
        "bot_paused"
      );

      return;
    }

    // ========================================================
    // STEP 4
    // DOWNLOADING
    // ========================================================

    job.status =
      "downloading";

    sendMusicStatusMessage(
      api,
      buildMusicPanel({
        title,
        author,
        duration,
        state:
          "downloading",
      }),
      threadID
    );

    console.log(
      `[Music] Job ${job.id}: downloading "${title}".`
    );

    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id}: cancelled before download.`
      );

      return;
    }

    if (
      global.botDisabled === true ||
      global.botPaused === true
    ) {
      markMusicJobCancelled(
        job,
        "bot_paused"
      );

      return;
    }

    // ========================================================
    // STEP 5
    // DOWNLOAD AUDIO
    // ========================================================

    await withTimeout(
      () =>
        downloadYouTubeAudio(
          video.url,
          temporaryFile
        ),
      MUSIC_DOWNLOAD_TIMEOUT_MS,
      "YouTube audio download timed out."
    );

    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id}: cancelled after download.`
      );

      return;
    }

    // ========================================================
    // STEP 6
    // VERIFY AUDIO
    // ========================================================

    const fileInfo =
      await fsp.stat(
        temporaryFile
      );

    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id}: cancelled during file verification.`
      );

      return;
    }

    if (
      !fileInfo.isFile()
    ) {
      throw new Error(
        "Downloaded audio is not a valid file."
      );
    }

    if (
      fileInfo.size <= 0
    ) {
      throw new Error(
        "The downloaded audio file is empty."
      );
    }

    if (
      fileInfo.size >
      MAX_MUSIC_FILE_BYTES
    ) {
      throw new Error(
        `Audio file is too large (${formatMusicBytes(
          fileInfo.size
        )}). Maximum allowed is ${formatMusicBytes(
          MAX_MUSIC_FILE_BYTES
        )}.`
      );
    }

    console.log(
      `[Music] Job ${job.id}: verified ${formatMusicBytes(
        fileInfo.size
      )} audio file.`
    );

    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id}: cancelled before audio send.`
      );

      return;
    }

    if (
      global.botDisabled === true ||
      global.botPaused === true
    ) {
      markMusicJobCancelled(
        job,
        "bot_paused"
      );

      return;
    }

    // ========================================================
    // STEP 7
    // SEND ACTUAL SONG
    // ========================================================

    job.status =
      "streaming";

    const playerMessage =
      buildMusicPanel({
        title,
        author,
        duration,
        state:
          "streaming",
      });

    console.log(
      `[Music] Job ${job.id}: sending actual audio to ${threadID}.`
    );

    if (
      job.cancelled
    ) {
      return;
    }

    await withTimeout(
      () =>
        sendMusicAudio(
          api,
          temporaryFile,
          playerMessage,
          threadID,
          job
        ),
      MUSIC_SEND_TIMEOUT_MS,
      "Sending the audio to Messenger timed out."
    );

    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id}: cancelled during audio send.`
      );

      return;
    }

    console.log(
      `[Music] Job ${job.id}: successfully sent "${title}" to ${threadID}.`
    );
  } catch (error) {
    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id}: cancelled.`
      );

      return;
    }

    console.error(
      `[Music] Job ${job.id} failed:`,
      error
    );

    let errorMessage =
      error?.message ||
      String(error);

    if (
      errorMessage.length >
      500
    ) {
      errorMessage =
        errorMessage.slice(
          0,
          500
        );
    }

    const failedPanel =
      buildMusicPanel({
        title:
          job.title ||
          job.requestedSong,

        author:
          job.author ||
          "",

        duration:
          job.duration ||
          "--:--",

        state:
          "failed",
      }) +
      `\n\n♡ ${errorMessage}`;

    sendMusicStatusMessage(
      api,
      failedPanel,
      threadID
    );
  } finally {
    if (
      job.audioStream &&
      typeof job.audioStream.destroy ===
        "function"
    ) {
      try {
        job.audioStream.destroy();
      } catch {}
    }

    job.audioStream =
      null;

    await fsp
      .unlink(
        temporaryFile
      )
      .catch(() => {});

    job.temporaryFile =
      null;
  }
}

// ============================================================
// ENQUEUE MUSIC
// ============================================================

function enqueueMusic(
  api,
  requestedSong,
  threadID
) {
  const queue =
    getMusicQueue(threadID);

  if (
    queue.length >=
    MUSIC_MAX_PER_GC
  ) {
    return {
      accepted: false,
      reason: "gc_limit",
    };
  }

  if (
    musicPendingJobs.length >=
    MUSIC_MAX_GLOBAL_QUEUE
  ) {
    return {
      accepted: false,
      reason: "global_limit",
    };
  }

  const job = {
    id:
      ++musicJobCounter,

    api,

    threadID:
      String(threadID),

    requestedSong:
      requestedSong.trim(),

    title:
      requestedSong.trim(),

    author: "",

    duration:
      "--:--",

    status:
      "pending",

    createdAt:
      Date.now(),

    startedAt:
      null,

    temporaryFile:
      null,

    audioStream:
      null,

    cancelled:
      false,

    cancelReason:
      null,
  };

  queue.push(job);
  musicPendingJobs.push(job);

  return {
    accepted:
      true,

    job,

    position:
      getMusicQueuePosition(
        job
      ),
  };
}

// ============================================================
// RESUME MUSIC
// ============================================================

function resumeMusicProcessing() {
  setImmediate(
    processMusicQueue
  );
}

// ============================================================
// COQUETTE MUSIC COMMAND
// ============================================================

function handleMusicCommand(
  api,
  requestedSong,
  threadID
) {
  if (
    typeof requestedSong !==
      "string" ||
    !requestedSong.trim()
  ) {
    sendReplyWithTyping(
      api,
      [
        "╭─────── ୨୧ ♡ ୨୧ ───────╮",
        "          🎀 MUSIC",
        "╰─────── ୨୧ ♡ ୨୧ ───────╯",
        "",
        "♡ usage",
        "   !play <song>",
        "",
        "୨୧ example",
        "   !play Die With A Smile",
        "",
        "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
      ].join("\n"),
      threadID
    );

    return;
  }

  const cleanSong =
    requestedSong.trim();

  if (
    cleanSong.length >
    MUSIC_REQUEST_MAX_LENGTH
  ) {
    sendReplyWithTyping(
      api,
      [
        "╭────── 🎀  MUSIC  🎀 ──────╮",
        "",
        "🔴 REQUEST TOO LONG",
        "",
        `♡ Maximum: ${MUSIC_REQUEST_MAX_LENGTH} characters.`,
        "",
        "Please shorten your song search.",
        "",
        "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
      ].join("\n"),
      threadID
    );

    return;
  }

  if (
    global.botDisabled === true
  ) {
    return;
  }

  if (
    global.botPaused === true
  ) {
    sendReplyWithTyping(
      api,
      [
        "╭────── 🎀  MUSIC  🎀 ──────╮",
        "",
        "🟡 MUSIC IS PAUSED",
        "",
        "Your request was not queued.",
        "",
        "♡ Please wait until ECLIPSE resumes.",
        "",
        "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
      ].join("\n"),
      threadID
    );

    return;
  }

  const result =
    enqueueMusic(
      api,
      cleanSong,
      threadID
    );

  if (
    !result.accepted
  ) {
    if (
      result.reason ===
      "gc_limit"
    ) {
      sendReplyWithTyping(
        api,
        [
          "╭────── 🎀  MUSIC QUEUE  🎀 ──────╮",
          "",
          "🔴 GC MUSIC LIMIT REACHED",
          "",
          `୨୧ maximum: ${MUSIC_MAX_PER_GC} songs`,
          "୨୧ active + pending both count",
          "",
          "♡ Please wait for one song to finish.",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );

      return;
    }

    sendReplyWithTyping(
      api,
      [
        "╭────── 🎀  MUSIC QUEUE  🎀 ──────╮",
        "",
        "🔴 MUSIC SYSTEM BUSY",
        "",
        "Too many music requests are currently",
        "waiting across ECLIPSE.",
        "",
        "♡ Please try again shortly.",
        "",
        "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
      ].join("\n"),
      threadID
    );

    return;
  }

  const {
    job,
    position,
  } = result;

  if (
    position > 1
  ) {
    sendReplyWithTyping(
      api,
      buildMusicPanel({
        title:
          cleanSong,

        state:
          "pending",

        position,
      }),
      threadID
    );
  }

  console.log(
    `[Music] Queued job ${job.id} for ${threadID}: "${cleanSong}"`
  );

  processMusicQueue();
}

// ============================================================
// MUSIC STATUS
// ============================================================

function sendMusicStatus(
  api,
  threadID
) {
  const queue =
    getMusicQueue(threadID);

  const stats =
    getMusicStats();

  if (
    queue.length === 0
  ) {
    sendReplyWithTyping(
      api,
      [
        "╭────── 🎀  MUSIC STATUS  🎀 ──────╮",
        "",
        "♡ this GC has no music requests.",
        "",
        `୨୧ global downloads: ${stats.activeDownloads}/${MUSIC_MAX_GLOBAL_DOWNLOADS}`,
        `୨୧ global pending: ${stats.waitingGlobal}`,
        "",
        "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
      ].join("\n"),
      threadID
    );

    return;
  }

  const lines = [
    "╭────── 🎀  MUSIC STATUS  🎀 ──────╮",
    "",
    `୨୧ GC queue: ${queue.length}/${MUSIC_MAX_PER_GC}`,
    "",
  ];

  queue.forEach(
    (job, index) => {
      const label =
        job.title ||
        job.requestedSong;

      const state =
        String(
          job.status
        ).toUpperCase();

      lines.push(
        `${index + 1}. ${state}`,
        `   ♡ ${label.slice(0, 80)}`
      );
    }
  );

  lines.push(
    "",
    "୨୧ global protection",
    `    ♡ downloads: ${stats.activeDownloads}/${MUSIC_MAX_GLOBAL_DOWNLOADS}`,
    `    ♡ pending: ${stats.waitingGlobal}/${MUSIC_MAX_GLOBAL_QUEUE}`,
    "",
    "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯"
  );

  sendReplyWithTyping(
    api,
    lines.join("\n"),
    threadID
  );
}

// ============================================================
// RENDER HEALTH CHECK
// ============================================================

const app = express();

app.get("/", (_req, res) => {
  res.status(200).send(
    "ECLIPSE is running ♡"
  );
});

app.get("/health", (_req, res) => {
  const music =
    getMusicStats();

  const nowIso =
    new Date().toISOString();

  res.status(200).json({
    ok: true,
    httpServer: true,
    facebookConnected:
      Boolean(currentApi) &&
      !reconnecting &&
      mqttListenerActive &&
      !shuttingDown,
    mqttListening: mqttListenerActive === true,
    reconnecting: reconnecting === true,
    botPaused: global.botPaused === true,
    botDisabled: global.botDisabled === true,
    lastEventAt: lastMessengerEventAt || null,
    lastSuccessfulSendAt: lastSuccessfulSendAt || null,
    lastListenerErrorAt: lastListenerErrorAt || null,
    lastLoginAttemptAt: lastLoginAttemptAt || null,
    lastLoginSuccessAt: lastLoginSuccessAt || null,
    lastReconnectAt: lastReconnectAt || null,
    uptime: process.uptime(),
    music: {
      activeDownloads:
        music.activeDownloads,

      globalPending:
        music.waitingGlobal,

      trackedGCs:
        music.trackedGCs,

      activeJobs:
        music.activeJobs,

      pendingJobs:
        music.pendingJobs,
    },
    timestamp: nowIso,
  });
});

const port =
  Number.parseInt(
    process.env.PORT || "3000",
    10
  );

if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535
) {
  throw new Error(
    `Invalid PORT value: ${process.env.PORT}`
  );
}

const server =
  app.listen(
    port,
    "0.0.0.0",
    () => {
      console.log(
        `Web server listening on port ${port}`
      );
    }
  );

server.on(
  "error",
  (error) => {
    console.error(
      "Web server error:",
      error
    );

    process.exitCode = 1;
  }
);

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

function scheduleReconnect(reason) {
  if (shuttingDown || reconnecting) {
    return;
  }

  reconnecting = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  loginGeneration++;
  currentApi = null;
  mqttListenerActive = false;
  lastReconnectAt = new Date().toISOString();

  console.error(
    `[RECONNECT] Attempting in 10s due to: ${reason}`
  );

  reconnectTimer = setTimeout(() => {
    if (shuttingDown) {
      reconnecting = false;
      reconnectTimer = null;
      return;
    }

    reconnecting = false;
    reconnectTimer = null;
    console.log(
      "[RECONNECT] Attempting to reconnect to Facebook..."
    );

    startLogin();
  }, 10_000);
}

function startLogin() {
  const generation = ++loginGeneration;
  lastLoginAttemptAt = new Date().toISOString();

  console.log(
    `[FB] Login attempt started (generation=${generation})`
  );

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
      if (shuttingDown) {
        console.warn(
          `[FB] Ignoring stale login result (generation=${generation}) after shutdown.`
        );
        return;
      }

      if (generation !== loginGeneration) {
        console.warn(
          `[FB] Ignoring stale login result (generation=${generation}, current=${loginGeneration}).`
        );
        return;
      }

      if (loginError) {
        console.error(
          "[FB] Login failed:",
          loginError
        );

        scheduleReconnect(
          "login_failed"
        );

        return;
      }

      if (!api) {
        console.error(
          "[FB] Login failed: API object was not returned."
        );

        scheduleReconnect(
          "no_api_object"
        );

        return;
      }

      currentApi = api;
      mqttListenerActive = false;

      console.log(
        `[FB] Connected successfully (generation=${generation})`
      );

      lastLoginSuccessAt = new Date().toISOString();

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

      try {
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
                  "[FB] Startup message failed:",
                  sendError
                );
              }
            }
          );
        }

        api.listenMqtt(
          (listenError, event) => {
            if (shuttingDown) {
              return;
            }

            if (generation !== loginGeneration || api !== currentApi) {
              console.warn(
                `[MQTT] Ignoring stale listener callback (generation=${generation}, currentGeneration=${loginGeneration}).`
              );
              return;
            }

            if (listenError) {
              lastListenerErrorAt = new Date().toISOString();
              console.error(
                `[MQTT] Listener error (generation=${generation}):`,
                listenError
              );

              invalidateCurrentApi("listener_error");
              mqttListenerActive = false;
              scheduleReconnect(
                "listener_error"
              );

              return;
            }

            if (
              !event ||
              typeof event !== "object"
            ) {
              console.warn(
                "[MQTT] Ignored invalid event payload."
              );
              return;
            }

            mqttListenerActive = true;
            lastMessengerEventAt = new Date().toISOString();
            resetMessengerWatchdog();

            console.log(
              `[MSG] Incoming event type=${event.type} thread=${event.threadID || "unknown"} sender=${event.senderID || "unknown"}`
            );

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
                  "[HANDLE] Unhandled message failure:",
                  error
                );

                scheduleReconnect(
                  "handle_message_failed"
                );
              });
            }
          }
        );

        mqttListenerActive = true;
        resetMessengerWatchdog();

        console.log(
          `[MQTT] Listener started successfully (generation=${generation})`
        );
      } catch (error) {
        console.error(
          "[MQTT] Failed to start listener:",
          error
        );

        invalidateCurrentApi("listener_start_failed");
        mqttListenerActive = false;
        scheduleReconnect(
          "listener_start_failed"
        );
      }
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

// This is intentionally kept above the first call to ensure
// it exists before startup.

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

  const threadId =
    threadID
      ? String(threadID)
      : "";

  const senderId =
    senderID
      ? String(senderID)
      : "";

  console.log(
    `[CMD] Starting command processing for thread=${threadId} sender=${senderId}`
  );

  try {
    if (
      !threadId ||
      typeof body !==
        "string" ||
      !body.trim()
    ) {
      console.warn(
        `[MSG] Ignored invalid event thread=${threadId} sender=${senderId}`
      );
      return;
    }

    const originalText =
      body.trim();

    const text =
      originalText.toLowerCase();

    const isAdmin =
      ADMIN_IDS.includes(
        senderId
      );

    // ==========================================================
    // PAUSE / RESUME / BOT CONTROL
    // ==========================================================

    const pauseMatch =
      originalText.match(
        /^!pause(?:\s+(status))?$/i
      );

    const resumeMatch =
      /^!resume$/i.test(
        originalText
      );

    if (
      pauseMatch ||
      resumeMatch
    ) {
      if (!isAdmin) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  PAUSE CONTROL  🎀 ──────╮",
            "",
            "🔒 ADMIN ONLY",
            "",
            "Only the bot admin can control",
            "the global pause state.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadId
        );

        return;
      }

      if (resumeMatch) {
        global.botPaused =
          false;

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  E C L I P S E  🎀 ──────╮",
            "",
            "🟢 BOT RESUMED",
            "",
            "୨୧ global pause",
            "    ♡ OFF",
            "",
            "Normal commands are active again.",
            "",
            "♡ pending music may now continue.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadId
        );

        resumeMusicProcessing();

        return;
      }

      if (
        pauseMatch[1] ===
        "status"
      ) {
        const music =
          getMusicStats();

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  PAUSE STATUS  🎀 ──────╮",
            "",
            "୨୧ global pause",
            `    ♡ ${
              global.botPaused
                ? "🟡 PAUSED"
                : "🟢 ACTIVE"
            }`,
            "",
            "୨୧ process",
            "    ♡ 🟢 STILL RUNNING",
            "",
            "୨୧ music",
            `    ♡ active downloads: ${
              music.activeDownloads
            }/${
              MUSIC_MAX_GLOBAL_DOWNLOADS
            }`,
            `    ♡ pending: ${
              music.waitingGlobal
            }`,
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadId
        );

        return;
      }

      global.botPaused =
        true;

      sendReplyWithTyping(
        api,
        [
          "╭────── 🎀  E C L I P S E  🎀 ──────╮",
          "",
          "🟡 BOT IS NOW PAUSED",
          "",
          "୨୧ global pause",
          "    ♡ ON",
          "",
          "Normal commands are now ignored.",
          "",
          "♡ Render process remains alive.",
          "♡ Messenger listener remains alive.",
          "♡ !resume remains available.",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadId
      );

      return;
    }

    // ==========================================================
    // GLOBAL BOT CONTROL
    // ==========================================================

    const botControlMatch =
      originalText.match(
        /^!(bot(?:\s+(off|on|status))?|shutdown|startup)$/i
      );

    if (botControlMatch) {
      if (!isAdmin) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BOT CONTROL  🎀 ──────╮",
            "",
            "🔒 ADMIN ONLY",
            "",
            "Only the bot admin can use",
            "global bot controls.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      const rawControl =
        (
          botControlMatch[1] ||
          "bot"
        ).toLowerCase();

      if (
        rawControl ===
        "bot"
      ) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BOT CONTROL  🎀 ──────╮",
            "୨୧ status",
            "    ♡ !bot status",
            "",
            "୨୧ controls",
            "    ♡ !bot on",
            "    ♡ !bot off",
            "    ♡ !shutdown",
            "    ♡ !startup",
            "",
            "୨୧ pause",
            "    ♡ !pause",
            "    ♡ !pause status",
            "    ♡ !resume",
            "",
            "୨୧ communication",
            "    ♡ !broadcast <message>",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      if (
        rawControl ===
        "bot status"
      ) {
        const music =
          getMusicStats();

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BOT STATUS  🎀 ──────╮",
            "",
            "୨୧ global status",
            `    ♡ ${
              global.botDisabled
                ? "🔴 OFF"
                : "🟢 ON"
            }`,
            "",
            "୨୧ pause status",
            `    ♡ ${
              global.botPaused
                ? "🟡 PAUSED"
                : "🟢 ACTIVE"
            }`,
            "",
            "୨୧ music protection",
            `    ♡ global downloads: ${music.activeDownloads}/${MUSIC_MAX_GLOBAL_DOWNLOADS}`,
            `    ♡ global pending: ${music.waitingGlobal}`,
            "",
            "୨୧ controls",
            "    ♡ !bot on",
            "    ♡ !bot off",
            "    ♡ !pause",
            "    ♡ !resume",
            "    ♡ !shutdown",
            "    ♡ !startup",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      if (
        rawControl ===
          "bot off" ||
        rawControl ===
          "shutdown"
      ) {
        global.botDisabled =
          true;

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BOT CONTROL  🎀 ──────╮",
            "",
            "🔴 BOT IS NOW OFF",
            "",
            "୨୧ global state",
            "    ♡ OFF",
            "",
            "Normal commands are now ignored.",
            "",
            "୨୧ admin controls remain available",
            "    ♡ !bot status",
            "    ♡ !bot on",
            "    ♡ !startup",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      if (
        rawControl ===
          "bot on" ||
        rawControl ===
          "startup"
      ) {
        global.botDisabled =
          false;

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BOT CONTROL  🎀 ──────╮",
            "",
            "🟢 BOT IS NOW ON",
            "",
            "୨୧ global state",
            "    ♡ ON",
            "",
            "Normal commands are active again.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        resumeMusicProcessing();

        return;
      }
    }

    // ==========================================================
    // GLOBAL DISABLED / PAUSED STATE
    // ==========================================================

    if (
      global.botDisabled === true ||
      global.botPaused === true
    ) {
      return;
    }

    // ==========================================================
    // AI TRAINING / ADAPTATION
    // ==========================================================

    try {
      const trainingHandled =
        await handleTrainingCommand(
          senderId,
          threadId,
          originalText
        );

      if (
        trainingHandled
      ) {
        return;
      }

      if (
        !originalText.startsWith(
          "!"
        )
      ) {
        await observeMessage({
          senderID:
            senderId,
          threadID:
            threadId,
          body:
            originalText,
        });
      }
    } catch (error) {
      console.error(
        "[AI ADAPTATION] Training/observation failed:",
        error
      );
    }

    // ==========================================================
    // DEBUG
    // ==========================================================

    try {
      if (
        await handleDebugCommand(
          api,
          event,
          text,
          originalText
        )
      ) {
        return;
      }
    } catch (error) {
      console.error(
        "[DEBUG] Handler failed:",
        error
      );
    }

    // ==========================================================
    // CLEANUP
    // ==========================================================

    const cleanupMatch =
      originalText.match(
        /^!cleanup(?:\s+(status|run|repair|optimize|full))?$/i
      );

    if (cleanupMatch) {
      if (!isAdmin) {
        return;
      }

      const cleanupCommand =
        (
          cleanupMatch[1] ||
          ""
        ).toLowerCase();

      if (!cleanupCommand) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  CLEANUP  🎀 ──────╮",
            "୨୧ status",
            "    ♡ !cleanup status",
            "",
            "୨୧ maintenance",
            "    ♡ !cleanup run",
            "    ♡ !cleanup repair",
            "    ♡ !cleanup optimize",
            "    ♡ !cleanup full",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      if (
        cleanupCommand ===
        "status"
      ) {
        const status =
          getCleanupStatus();

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  CLEANUP  🎀 ──────╮",
            "୨୧ status",
            `    ♡ scheduler: ${
              status.schedulerActive
                ? "🟢 ACTIVE"
                : "🔴 OFF"
            }`,
            `    ♡ running: ${
              status.running
                ? "🟡 YES"
                : "🟢 NO"
            }`,
            `    ♡ last run: ${
              status.lastCleanupAt ||
              "Never"
            }`,
            "",
            "୨୧ schedule",
            "    ♡ every 24 hours",
            "    ♡ temporary files: 3 days",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      const modeMap = {
        run: "clean",
        repair: "repair",
        optimize: "optimize",
        full: "full",
      };

      const mode =
        modeMap[
          cleanupCommand
        ];

      if (!mode) {
        return;
      }

      try {
        const result =
          await runCleanup({
            mode,
          });

        if (
          result?.skipped
        ) {
          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  CLEANUP  🎀 ──────╮",
              "",
              "🟡 CLEANUP ALREADY RUNNING",
              "",
              "Please wait for the current",
              "maintenance operation to finish.",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );

          return;
        }

        const temporaryFiles =
          Number(
            result?.cleaned
              ?.temporaryFiles ||
              0
          );

        const expiredSessions =
          Number(
            result?.cleaned
              ?.expiredSessions ||
              0
          );

        const repairs =
          Array.isArray(
            result?.repaired
              ?.stateFiles
          )
            ? result.repaired
                .stateFiles.length
            : 0;

        const optimizerFindings =
          Array.isArray(
            result?.optimizer
              ?.findings
          )
            ? result.optimizer
                .findings
            : [];

        const gc =
          result?.gc || {};

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  CLEANUP  🎀 ──────╮",
            "          ♡ COMPLETE ♡",
            "╰─────────────────────────────╯",
            "",
            "୨୧ mode",
            `    ♡ ${mode.toUpperCase()}`,
            "",
            "୨୧ cleaned",
            `    ♡ temporary files: ${temporaryFiles}`,
            `    ♡ expired sessions: ${expiredSessions}`,
            `    ♡ repairs: ${repairs}`,
            `    ♡ optimizer findings: ${optimizerFindings.length}`,
            "",
            "୨୧ gc maintenance",
            `    ♡ inactive: ${Number(
              gc.markedInactive || 0
            )}`,
            `    ♡ features off: ${Number(
              gc.expensiveFeaturesDisabled ||
                0
            )}`,
            `    ♡ archived: ${Number(
              gc.archived || 0
            )}`,
            "",
            "୨୧ database",
            `    ♡ ${
              result?.databaseMaintenance
                ? "🟢 OK"
                : "🔴 FAILED"
            }`,
            `    ♡ duration: ${Number(
              result?.durationMs || 0
            )}ms`,
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );
      } catch (error) {
        console.error(
          "[CLEANUP] Manual cleanup failed:",
          error
        );

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  CLEANUP  🎀 ──────╮",
            "",
            "🔴 CLEANUP FAILED",
            "",
            "Check Render logs for details.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );
      }

      return;
    }

    // ==========================================================
    // GC STATUS
    // ==========================================================

    if (
      /^!gcstatus$/i.test(
        originalText
      )
    ) {
      if (!isAdmin) {
        sendReplyWithTyping(
          api,
          "❌ Admin only.",
          threadID
        );

        return;
      }

      try {
        const status =
          await getGCStatus();

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  GC MONITOR  🎀 ──────╮",
            "୨୧ activity",
            `    ♡ tracked GCs: ${status.total}`,
            `    ♡ active: ${status.active}`,
            `    ♡ inactive: ${status.inactive}`,
            "",
            "୨୧ maintenance",
            `    ♡ features off: ${status.featuresDisabled}`,
            `    ♡ archived: ${status.archived}`,
            "",
            "୨୧ database",
            "    ♡ bot_gc_activity",
            "    ♡ tracker: 🟢 ONLINE",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );
      } catch (error) {
        console.error(
          "[GC STATUS] Failed:",
          error
        );

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  GC MONITOR  🎀 ──────╮",
            "",
            "🔴 STATUS CHECK FAILED",
            "",
            "Unable to read GC activity data.",
            "",
            "Check the Render logs.",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );
      }

      return;
    }

    // ==========================================================
    // PING
    // ==========================================================

    if (
      text === "!ping"
    ) {
      sendReplyWithTyping(
        api,
        "🏓 Pong!",
        threadID
      );

      return;
    }

    // ==========================================================
    // HELP
    // ==========================================================

    if (
      text === "!help"
    ) {
      sendReplyWithTyping(
        api,
        [
          "╭─────── ୨୧ ♡ ୨୧ ───────╮",
          "        🎀 E C L I P S E",
          "         P U B L I C",
          "╰─────── ୨୧ ♡ ୨୧ ───────╯",
          "",
          "୨୧ GENERAL",
          "♡ !ping",
          "♡ !help",
          "",
          "୨୧ MUSIC",
          "♡ !play <song>",
          "  Search YouTube + send audio.",
          "♡ !music status",
          "  Show the GC music queue.",
          "♡ !music stop",
          "  Stop all music in this GC.",
          "♡ !music cancel",
          "  Alias for !music stop.",
          "♡ !music clear",
          "  Clear waiting songs only.",
          "♡ !music skip",
          "  Skip the current music request.",
          "♡ Maximum 2 songs per GC.",
          "",
          "୨୧ BOT CONTROL",
          "♡ !pause",
          "♡ !pause status",
          "♡ !resume",
          "",
          "୨୧ PICTURES",
          "♡ !pic",
          "♡ !picture",
          "♡ !photo",
          "",
          "୨୧ ECLIPSE RPG",
          "♡ !rpg help",
          "♡ !rpg profile",
          "♡ !rpg kingdom",
          "♡ !rpg property",
          "♡ !rpg train <unit> <amount>",
          "♡ !rpg march <region>",
          "",
          "୨୧ ECONOMY",
          "♡ !balance / !bal",
          "♡ !daily",
          "♡ !work",
          "♡ !pay <amount>",
          "♡ !leaderboard / !lb",
          "♡ !shop",
          "♡ !buy <item>",
          "♡ !inventory / !inv",
          "",
          "୨୧ GAME CENTER",
          "♡ !games",
          "♡ !games rules",
          "♡ !games status",
          "♡ !trivia",
          "♡ !rps <choice>",
          "♡ !roll <amount>",
          "♡ !guess <number>",
          "♡ !coinflip <amount> <side>",
          "♡ !slots <amount>",
          "♡ !blackjack",
          "♡ !hit / !stand",
          "♡ !math",
          "♡ !riddle",
          "♡ !8ball <question>",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );

      return;
    }

    // ==========================================================
    // MUSIC PLAY
    // ==========================================================

    if (
      text === "!play" ||
      text.startsWith(
        "!play "
      )
    ) {
      const requestedSong =
        originalText
          .slice(
            "!play".length
          )
          .trim();

      handleMusicCommand(
        api,
        requestedSong,
        threadID
      );

      return;
    }

    // ==========================================================
    // MUSIC CONTROL
    // ==========================================================

    const musicControlMatch =
      originalText.match(
        /^!music(?:\s+(status|stop|cancel|clear|skip))?$/i
      );

    if (musicControlMatch) {
      const musicAction =
        (
          musicControlMatch[1] ||
          "status"
        ).toLowerCase();

      // --------------------------------------------------------
      // STATUS
      // --------------------------------------------------------

      if (
        musicAction ===
        "status"
      ) {
        sendMusicStatus(
          api,
          threadID
        );

        return;
      }

      // --------------------------------------------------------
      // STOP / CANCEL
      // --------------------------------------------------------

      if (
        musicAction === "stop" ||
        musicAction === "cancel"
      ) {
        const result =
          cancelAllMusicForThread(
            threadID,
            musicAction
          );

        if (
          result.cancelledCount ===
          0
        ) {
          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  MUSIC CONTROL  🎀 ──────╮",
              "",
              "♡ NOTHING TO CANCEL",
              "",
              "This GC has no active or queued music.",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );

          return;
        }

        sendMusicStatusMessage(
          api,
          [
            "╭────── 🎀  MUSIC CONTROL  🎀 ──────╮",
            "",
            "🔴 MUSIC STOPPED",
            "",
            `୨୧ cancelled: ${result.cancelledCount}`,
            "୨୧ active + pending requests cleared",
            "",
            "♡ no cancelled song will be sent.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        setImmediate(
          processMusicQueue
        );

        return;
      }

      // --------------------------------------------------------
      // CLEAR QUEUE
      // --------------------------------------------------------

      if (
        musicAction ===
        "clear"
      ) {
        const result =
          clearQueuedMusicForThread(
            threadID
          );

        if (
          result.clearedCount ===
          0
        ) {
          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  MUSIC QUEUE  🎀 ──────╮",
              "",
              "♡ NO WAITING SONGS",
              "",
              "There are no pending songs to clear.",
              "",
              "♡ The current song, if any, was left alone.",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );

          return;
        }

        sendMusicStatusMessage(
          api,
          [
            "╭────── 🎀  MUSIC QUEUE  🎀 ──────╮",
            "",
            "🟢 QUEUE CLEARED",
            "",
            `୨୧ removed: ${result.clearedCount}`,
            "",
            "♡ the current active song was left alone.",
            "♡ only waiting songs were removed.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        setImmediate(
          processMusicQueue
        );

        return;
      }

      // --------------------------------------------------------
      // SKIP CURRENT SONG
      // --------------------------------------------------------

      if (
        musicAction ===
        "skip"
      ) {
        const skippedJob =
          skipCurrentMusicForThread(
            threadID
          );

        if (!skippedJob) {
          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  MUSIC CONTROL  🎀 ──────╮",
              "",
              "♡ NOTHING IS PLAYING",
              "",
              "There is no active music request to skip.",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );

          return;
        }

        sendMusicStatusMessage(
          api,
          [
            "╭────── 🎀  MUSIC CONTROL  🎀 ──────╮",
            "",
            "⏭️ MUSIC SKIPPED",
            "",
            `୨୧ ${(
              skippedJob.title ||
              skippedJob.requestedSong ||
              "Current song"
            ).slice(0, 100)}`,
            "",
            "♡ moving to the next request if available.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        setImmediate(
          processMusicQueue
        );

        return;
      }
    }

    // ==========================================================
    // PICTURES
    // ==========================================================

    if (
      text === "!pic" ||
      text === "!picture" ||
      text === "!photo"
    ) {
      try {
        sendRandomPicture(
          api,
          threadID
        );
      } catch (error) {
        console.error(
          "[PICTURES] Command failed:",
          error
        );

        sendReplyWithTyping(
          api,
          "❌ Failed to send a picture.",
          threadID
        );
      }

      return;
    }

    // ==========================================================
    // BROADCAST
    // ==========================================================

    if (
      text.startsWith(
        "!broadcast "
      )
    ) {
      if (!isAdmin) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BROADCAST  🎀 ──────╮",
            "",
            "🔒 ADMIN ONLY",
            "",
            "Only the bot admin can broadcast.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      const message =
        originalText
          .slice(
            "!broadcast ".length
          )
          .trim();

      if (!message) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BROADCAST  🎀 ──────╮",
            "",
            "୨୧ usage",
            "    ♡ !broadcast <message>",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      const targetCount =
        activeThreads.size;

      broadcastToAllThreads(
        api,
        message
      );

      sendReplyWithTyping(
        api,
        [
          "╭────── 🎀  BROADCAST  🎀 ──────╮",
          "",
          "📢 BROADCAST QUEUED",
          "",
          "୨୧ active threads",
          `    ♡ ${targetCount}`,
          "",
          "୨୧ status",
          "    ♡ 🟢 queued",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );

      return;
    }

    // ==========================================================
    // MODERATION
    // ==========================================================

    try {
      if (
        await handleModerationMessage(
          api,
          event,
          text,
          originalText
        )
      ) {
        return;
      }
    } catch (error) {
      console.error(
        "Moderation handler failed:",
        error
      );
    }

    // ==========================================================
    // AI
    // ==========================================================

    try {
      if (
        await handleAiMessage(
          api,
          event,
          text,
          originalText
        )
      ) {
        return;
      }
    } catch (error) {
      console.error(
        "AI message handler failed:",
        error
      );
    }

    // ==========================================================
    // RPG CHARACTER AI
    // ==========================================================

    try {
      if (
        await handleRpgCharacterMessage(
          api,
          event,
          text,
          originalText
        )
      ) {
        return;
      }
    } catch (error) {
      console.error(
        "RPG character handler failed:",
        error
      );
    }

    // ==========================================================
    // GAME RESPONSE
    // ==========================================================

    try {
      if (
        await handleGameResponse(
          api,
          event,
          text,
          originalText
        )
      ) {
        return;
      }
    } catch (error) {
      console.error(
        "Game response failed:",
        error
      );
    }

    // ==========================================================
    // RPG / LOVE QUEST / GAMES / ECONOMY
    // ==========================================================

    try {
      // --------------------------------------------------------
      // RPG
      // --------------------------------------------------------

      if (
        /^!rpg(?:\s|$)/i.test(
          originalText
        )
      ) {
        const rpgParts =
          originalText
            .trim()
            .split(/\s+/);

        const rpgArgs =
          rpgParts.slice(1);

        // ------------------------------------------------------
        // LOVE QUEST
        // ------------------------------------------------------

        if (
          isSpecialPlayer(
            senderId
          )
        ) {
          try {
            const loveQuestHandled =
              await handleLoveQuestCommand(
                api,
                threadID,
                senderId,
                rpgArgs
              );

            if (
              loveQuestHandled
            ) {
              return;
            }
          } catch (loveQuestError) {
            console.error(
              "[LOVE QUEST] Command failed:",
              loveQuestError
            );

            sendReplyWithTyping(
              api,
              "❌ The Last Star quest encountered an error.",
              threadID
            );

            return;
          }
        }

        const isRpgExplore =
          /^!rpg\s+explore(?:\s|$)/i.test(
            originalText
          );

        const rpgHandled =
          await handleRpgCommand(
            api,
            event,
            text,
            originalText
          );

        if (
          rpgHandled
        ) {
          if (
            isRpgExplore &&
            isSpecialPlayer(
              senderId
            )
          ) {
            try {
              await discoverLoveQuest(
                api,
                threadID,
                senderId
              );
            } catch (loveQuestError) {
              console.error(
                "[LOVE QUEST] Discovery failed:",
                loveQuestError
              );
            }
          }

          return;
        }
      }

      // --------------------------------------------------------
      // GAME CONTROL
      // --------------------------------------------------------

      const gameControlMatch =
        text.match(
          /^!game(?:\s+(on|off|status))?$/i
        );

      if (
        gameControlMatch
      ) {
        if (!isAdmin) {
          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  GAME CONTROL  🎀 ──────╮",
              "",
              "🔒 ADMIN ONLY",
              "",
              "Only the bot admin can configure",
              "games.",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );

          return;
        }

        const gameSubcommand =
          (
            gameControlMatch[1] ||
            ""
          ).toLowerCase();

        if (!gameSubcommand) {
          let currentStatus =
            false;

          try {
            currentStatus =
              await db.isGameEnabled(
                threadID
              );
          } catch (error) {
            console.error(
              "[GAME] Failed to check status:",
              error
            );
          }

          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  GAME CONTROL  🎀 ──────╮",
              "୨୧ status",
              `    ♡ ${
                currentStatus
                  ? "🟢 ON"
                  : "🔴 OFF"
              }`,
              "    ♡ !game status",
              "",
              "୨୧ controls",
              "    ♡ !game on",
              "    ♡ !game off",
              "",
              "୨୧ game center",
              "    ♡ !games",
              "    ♡ !games rules",
              "    ♡ !games status",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );

          return;
        }

        if (
          gameSubcommand ===
          "status"
        ) {
          try {
            const enabled =
              await db.isGameEnabled(
                threadID
              );

            sendReplyWithTyping(
              api,
              [
                "╭────── 🎀  GAME STATUS  🎀 ──────╮",
                "",
                "୨୧ current group status",
                `    ♡ ${
                  enabled
                    ? "🟢 ON"
                    : "🔴 OFF"
                }`,
                "",
                "୨୧ controls",
                "    ♡ !game on",
                "    ♡ !game off",
                "",
                "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
              ].join("\n"),
              threadID
            );
          } catch (error) {
            console.error(
              "[GAME STATUS] Error:",
              error
            );

            sendReplyWithTyping(
              api,
              "🔴 Unable to read the game setting.",
              threadID
            );
          }

          return;
        }

        const enabled =
          gameSubcommand ===
          "on";

        try {
          await db.setGameEnabled(
            threadID,
            enabled
          );

          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  GAME CONTROL  🎀 ──────╮",
              "",
              enabled
                ? "🟢 GAMES ARE NOW ON"
                : "🔴 GAMES ARE NOW OFF",
              "",
              "୨୧ group status",
              `    ♡ ${
                enabled
                  ? "ON"
                  : "OFF"
              }`,
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );
        } catch (error) {
          console.error(
            "[GAME TOGGLE] Error:",
            error
          );

          sendReplyWithTyping(
            api,
            "🔴 Failed to change the game setting.",
            threadID
          );
        }

        return;
      }

      // --------------------------------------------------------
      // GAME COMMANDS
      // --------------------------------------------------------

      const gameMatch =
        text.match(
          /^!(trivia|rps|roll|guess|coinflip|blackjack|hit|stand|double|split|surrender|slots|math|riddle|8ball|games)(?:\s+(.*))?$/i
        );

      if (
        gameMatch
      ) {
        const gameCommand =
          gameMatch[1].toLowerCase();

        const gameArgs =
          gameMatch[2]
            ? gameMatch[2]
                .trim()
                .split(/\s+/)
            : [];

        if (
          gameCommand ===
          "games"
        ) {
          const handled =
            await handleGamesCommand(
              api,
              event,
              gameCommand,
              gameArgs
            );

          if (
            handled
          ) {
            return;
          }

          sendGameCenter(
            api,
            threadID
          );

          return;
        }

        const gamesEnabled =
          await db.isGameEnabled(
            threadID
          );

        if (
          !gamesEnabled
        ) {
          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  GAME CENTER  🎀 ──────╮",
              "",
              "🔴 GAMES ARE OFF",
              "",
              "An admin can enable them with:",
              "    ♡ !game on",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );

          return;
        }

        if (
          await handleGamesCommand(
            api,
            event,
            gameCommand,
            gameArgs
          )
        ) {
          return;
        }
      }

      // --------------------------------------------------------
      // ECONOMY
      // --------------------------------------------------------

      if (
        await handleEconomyCommand(
          api,
          event,
          text,
          originalText
        )
      ) {
        return;
      }
    } catch (error) {
      console.error(
        "RPG/economy/games command failed:",
        error
      );

      sendReplyWithTyping(
        api,
        "🌑 Something went wrong running that command. Please try again in a moment.",
        threadID
      );

      return;
    }

    // ==========================================================
    // BANAT CONTROL
    // ==========================================================

    const banatControlMatch =
      text.match(
        /^!banat(?:\s+(on|off|status))?$/i
      );

    if (
      banatControlMatch
    ) {
      if (!isAdmin) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BANAT CONTROL  🎀 ──────╮",
            "",
            "🔒 ADMIN ONLY",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      const banatSubcommand =
        (
          banatControlMatch[1] ||
          ""
        ).toLowerCase();

      if (
        !banatSubcommand
      ) {
        let enabled =
          false;

        try {
          enabled =
            await db.isRoastEnabled(
              threadId
            );
        } catch (error) {
          console.error(
            "[BANAT] Failed to check status:",
            error
          );
        }

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BANAT CONTROL  🎀 ──────╮",
            "୨୧ status",
            `    ♡ ${
              enabled
                ? "🟢 ON"
                : "🔴 OFF"
            }`,
            "",
            "୨୧ controls",
            "    ♡ !banat on",
            "    ♡ !banat off",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      if (
        banatSubcommand ===
        "status"
      ) {
        try {
          const enabled =
            await db.isRoastEnabled(
              threadId
            );

          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  BANAT STATUS  🎀 ──────╮",
              "",
              "୨୧ automatic banat",
              `    ♡ ${
                enabled
                  ? "🟢 ON"
                  : "🔴 OFF"
              }`,
              "",
              "୨୧ controls",
              "    ♡ !banat on",
              "    ♡ !banat off",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );
        } catch (error) {
          console.error(
            "[BANAT] Status failed:",
            error
          );
        }

        return;
      }

      const enabled =
        banatSubcommand ===
        "on";

      try {
        await db.setRoastEnabled(
          threadId,
          enabled
        );

        if (!enabled) {
          lastRandomRoastByThread.delete(
            threadId
          );
        }

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BANAT CONTROL  🎀 ──────╮",
            "",
            enabled
              ? "🟢 BANAT IS NOW ON"
              : "🔴 BANAT IS NOW OFF",
            "",
            "୨୧ group status",
            `    ♡ ${
              enabled
                ? "ON"
                : "OFF"
            }`,
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );
      } catch (error) {
        console.error(
          "[BANAT] Update failed:",
          error
        );

        sendReplyWithTyping(
          api,
          "🔴 Failed to update banat.",
          threadID
        );
      }

      return;
    }

    // ==========================================================
    // BANAT STATUS
    // ==========================================================

    let roastEnabled =
      false;

    try {
      roastEnabled =
        await db.isRoastEnabled(
          threadId
        );
    } catch (error) {
      console.error(
        "[BANAT] Failed to check roast status:",
        error
      );
    }

    // ==========================================================
    // TARGETED TRIGGER
    // ==========================================================

    if (
      roastEnabled
    ) {
      try {
        const triggerReply =
          await getTriggerReply(
            body,
            senderId,
            threadId
          );

        if (
          triggerReply
        ) {
          sendReplyWithTyping(
            api,
            triggerReply,
            threadID,
            true
          );

          return;
        }
      } catch (error) {
        console.error(
          "Trigger system failed:",
          error
        );
      }
    }

    // ==========================================================
    // RANDOM ROAST
    // ==========================================================

    if (
      !RANDOM_ROAST_ENABLED ||
      !roastEnabled
    ) {
      return;
    }

    if (
      canRandomRoastThread(
        threadId
      )
    ) {
      const publicReply =
        getNextPublicReply();

      if (
        publicReply
      ) {
        lastRandomRoastByThread.set(
          threadId,
          Date.now()
        );

        sendReplyWithTyping(
          api,
          publicReply,
          threadID,
          true
        );
      }
    }
  } catch (error) {
    console.error(
      `[HANDLE] Fatal error for thread=${threadId} sender=${senderId}:`,
      error
    );

    try {
      sendReplyWithTyping(
        api,
        "🌑 Something went wrong processing that message. Please try again.",
        threadId
      );
    } catch (replyError) {
      console.error(
        "[HANDLE] Failed to send error reply:",
        replyError
      );
    }
  }
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
                "[SEND] Reply failed thread=%s: %s",
                String(threadID),
                String(sendError)
              );
            } else {
              lastSuccessfulSendAt = new Date().toISOString();
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

async function gracefulShutdown(
  signal
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  reconnecting = false;
  loginGeneration++;
  currentApi = null;
  mqttListenerActive = false;

  console.log(
    `[SYSTEM] Received ${signal}. Cleaning up ECLIPSE...`
  );

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
        (resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }
      );
    }
  } catch (error) {
    console.error(
      "[SYSTEM] Server shutdown failed:",
      error
    );
  }

  if (typeof global.__messengerWatchdogTimer !== "undefined") {
    clearTimeout(global.__messengerWatchdogTimer);
    delete global.__messengerWatchdogTimer;
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

process.on("unhandledRejection", (reason) => {
  console.error(
    "[PROCESS] Unhandled rejection:",
    reason
  );

  if (!shuttingDown) {
    void gracefulShutdown("UNHANDLED_REJECTION");
  }
});

process.on("uncaughtException", (error) => {
  console.error(
    "[PROCESS] Uncaught exception:",
    error
  );

  if (!shuttingDown) {
    void gracefulShutdown("UNCAUGHT_EXCEPTION");
  }
});

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
