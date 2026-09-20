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
// WATCHDOG
// ============================================================
//
// Local process watchdog.
//
// Purpose:
//   - Detect prolonged event-loop stalls.
//   - Confirm the Node process is still alive.
//   - Track Messenger connection state.
//   - Expose watchdog state through /health.
//   - Allow admin status/restart commands.
//   - Exit with code 1 when the process is genuinely unhealthy
//     so Render can restart it.
//
// IMPORTANT:
//   The watchdog does NOT spawn another copy of ECLIPSE.
//   Render is responsible for restarting the failed process.
// ============================================================

const WATCHDOG_INTERVAL_MS = 30_000;

const WATCHDOG_EVENT_LOOP_TIMEOUT_MS =
  90_000;

const WATCHDOG_FAILURE_LIMIT = 3;

const WATCHDOG_STARTUP_GRACE_MS =
  2 * 60 * 1000;

const WATCHDOG_LOG_INTERVAL_MS =
  5 * 60 * 1000;

let watchdogStarted = false;
let watchdogTimer = null;

let watchdogStartedAt = Date.now();

let watchdogLastTickAt =
  Date.now();

let watchdogLastHealthyAt =
  Date.now();

let watchdogConsecutiveFailures = 0;

let watchdogMessengerConnected =
  false;

let watchdogShuttingDown = false;

let watchdogLastLogAt = 0;

const WATCHDOG_MODES = Object.freeze({
  NORMAL: "normal",
  REDUCED: "reduced",
  PROTECTIVE: "protective",
  EMERGENCY: "emergency",
  RECOVERY: "recovery",
});

const WATCHDOG_EVENT_LOOP_SAMPLE_MS = 5_000;
const WATCHDOG_MEMORY_REDUCED_MB = Math.max(256, Number(process.env.WATCHDOG_MEMORY_REDUCED_MB || 450));
const WATCHDOG_MEMORY_PROTECTIVE_MB = Math.max(WATCHDOG_MEMORY_REDUCED_MB + 64, Number(process.env.WATCHDOG_MEMORY_PROTECTIVE_MB || 650));
const WATCHDOG_MEMORY_EMERGENCY_MB = Math.max(WATCHDOG_MEMORY_PROTECTIVE_MB + 64, Number(process.env.WATCHDOG_MEMORY_EMERGENCY_MB || 800));
const WATCHDOG_RECOVERY_STABLE_MS = Math.max(30_000, Number(process.env.WATCHDOG_RECOVERY_STABLE_MS || 60_000));

let watchdogMode = WATCHDOG_MODES.NORMAL;
let watchdogModeChangedAt = Date.now();
let watchdogLastEventLoopSampleAt = Date.now();
let watchdogLastEventLoopLagMs = 0;
let watchdogEventLoopTimer = null;
let watchdogStableSince = Date.now();
let watchdogLastReason = "startup";
let watchdogResourcePressure = "normal";
let watchdogLastTransitionLogAt = 0;

function watchdogSetMode(mode, reason = "") {
  const key = String(mode || "").toUpperCase();
  const nextMode = WATCHDOG_MODES[key];
  if (!nextMode) return;
  if (watchdogMode === nextMode) {
    watchdogLastReason = reason || watchdogLastReason;
    return;
  }
  const previous = watchdogMode;
  watchdogMode = nextMode;
  watchdogModeChangedAt = Date.now();
  watchdogLastReason = reason || "state transition";
  watchdogStableSince = nextMode === WATCHDOG_MODES.NORMAL || nextMode === WATCHDOG_MODES.RECOVERY ? Date.now() : 0;
  if (Date.now() - watchdogLastTransitionLogAt > 5_000) {
    watchdogLastTransitionLogAt = Date.now();
    console.warn(`[WATCHDOG] Mode ${previous.toUpperCase()} -> ${nextMode.toUpperCase()} | ${watchdogLastReason}`);
  }
}

function watchdogRecordEventLoopLag(lagMs) {
  watchdogLastEventLoopLagMs = Math.max(0, Number(lagMs) || 0);
  watchdogLastEventLoopSampleAt = Date.now();
  if (watchdogLastEventLoopLagMs >= WATCHDOG_EVENT_LOOP_TIMEOUT_MS) {
    watchdogSetMode("PROTECTIVE", `event-loop lag ${Math.round(watchdogLastEventLoopLagMs)}ms`);
  } else if (watchdogLastEventLoopLagMs >= 5_000 && watchdogMode === WATCHDOG_MODES.NORMAL) {
    watchdogSetMode("REDUCED", `event-loop lag ${Math.round(watchdogLastEventLoopLagMs)}ms`);
  }
}

function watchdogSampleEventLoop() {
  const now = Date.now();
  const elapsed = now - watchdogLastEventLoopSampleAt;
  watchdogLastEventLoopSampleAt = now;
  watchdogRecordEventLoopLag(Math.max(0, elapsed - WATCHDOG_EVENT_LOOP_SAMPLE_MS));
}

function watchdogEvaluateResources() {
  const rssMb = process.memoryUsage().rss / 1024 / 1024;
  let pressure = "normal";
  if (rssMb >= WATCHDOG_MEMORY_EMERGENCY_MB) pressure = "emergency";
  else if (rssMb >= WATCHDOG_MEMORY_PROTECTIVE_MB) pressure = "protective";
  else if (rssMb >= WATCHDOG_MEMORY_REDUCED_MB) pressure = "reduced";
  watchdogResourcePressure = pressure;
  if (pressure === "emergency") watchdogSetMode("EMERGENCY", `RSS ${Math.round(rssMb)}MB`);
  else if (pressure === "protective") watchdogSetMode("PROTECTIVE", `RSS ${Math.round(rssMb)}MB`);
  else if (pressure === "reduced" && watchdogMode === WATCHDOG_MODES.NORMAL) watchdogSetMode("REDUCED", `RSS ${Math.round(rssMb)}MB`);
}

function watchdogCanStartBackgroundWork(kind = "normal") {
  if (watchdogMode === WATCHDOG_MODES.EMERGENCY) return kind === "critical";
  if (watchdogMode === WATCHDOG_MODES.PROTECTIVE) return kind !== "background";
  return true;
}

function watchdogGetTrafficMultiplier() {
  switch (watchdogMode) {
    case WATCHDOG_MODES.REDUCED: return 1.35;
    case WATCHDOG_MODES.PROTECTIVE: return 2.0;
    case WATCHDOG_MODES.EMERGENCY: return 4.0;
    case WATCHDOG_MODES.RECOVERY: return 1.5;
    default: return 1.0;
  }
}

function watchdogMaybeRecover() {
  if (watchdogMode === WATCHDOG_MODES.NORMAL) return;
  const rssMb = process.memoryUsage().rss / 1024 / 1024;
  if ([WATCHDOG_MODES.EMERGENCY, WATCHDOG_MODES.PROTECTIVE, WATCHDOG_MODES.REDUCED].includes(watchdogMode)) {
    if (rssMb < WATCHDOG_MEMORY_REDUCED_MB && watchdogLastEventLoopLagMs < 2_000) {
      if (!watchdogStableSince) watchdogStableSince = Date.now();
      if (Date.now() - watchdogStableSince >= WATCHDOG_RECOVERY_STABLE_MS) watchdogSetMode("RECOVERY", "resources stable");
    } else {
      watchdogStableSince = 0;
    }
  } else if (watchdogMode === WATCHDOG_MODES.RECOVERY && Date.now() - watchdogModeChangedAt >= WATCHDOG_RECOVERY_STABLE_MS) {
    watchdogSetMode("NORMAL", "recovery complete");
  }
}

function watchdogHeartbeat() {
  const now =
    Date.now();

  watchdogLastHealthyAt =
    now;

  watchdogConsecutiveFailures =
    0;
}

function watchdogSetMessengerConnected(
  connected
) {
  watchdogMessengerConnected =
    Boolean(connected);

  if (
    watchdogMessengerConnected
  ) {
    watchdogHeartbeat();
  }
}

function watchdogSetShuttingDown(
  value
) {
  watchdogShuttingDown =
    Boolean(value);
}

function getWatchdogStatus() {
  const now =
    Date.now();

  const uptimeMs =
    now - watchdogStartedAt;

  const eventLoopAgeMs =
    now - watchdogLastTickAt;

  const healthyAgeMs =
    now - watchdogLastHealthyAt;

  const inStartupGrace =
    uptimeMs <
    WATCHDOG_STARTUP_GRACE_MS;

  const eventLoopHealthy =
    eventLoopAgeMs <=
    WATCHDOG_EVENT_LOOP_TIMEOUT_MS;

  const watchdogHealthy =
    !watchdogShuttingDown &&
    (
      inStartupGrace ||
      (
        eventLoopHealthy &&
        watchdogConsecutiveFailures <
          WATCHDOG_FAILURE_LIMIT
      )
    );

  return {
    ok:
      watchdogHealthy,

    started:
      watchdogStarted,

    shuttingDown:
      watchdogShuttingDown,

    messengerConnected:
      watchdogMessengerConnected,

    uptimeMs,

    eventLoopAgeMs,

    healthyAgeMs,

    consecutiveFailures:
      watchdogConsecutiveFailures,

    startupGrace:
      inStartupGrace,

    lastHealthyAt:
      watchdogLastHealthyAt,

    mode: watchdogMode,
    modeChangedAt: watchdogModeChangedAt,
    modeReason: watchdogLastReason,
    resourcePressure: watchdogResourcePressure,
    eventLoopLagMs: Math.round(watchdogLastEventLoopLagMs),
    eventLoopSampleAgeMs: now - watchdogLastEventLoopSampleAt,
    recoveryStableMs: watchdogStableSince ? now - watchdogStableSince : 0,

    timestamp:
      new Date().toISOString(),
  };
}

function runWatchdogCheck() {
  if (
    watchdogShuttingDown
  ) {
    return;
  }

  const now =
    Date.now();

  const expectedInterval =
    WATCHDOG_INTERVAL_MS;

  const elapsedSinceTick =
    now - watchdogLastTickAt;

  const eventLoopDelay =
    elapsedSinceTick -
    expectedInterval;

  watchdogLastTickAt =
    now;

  const startupAge =
    now - watchdogStartedAt;

  if (
    startupAge <
    WATCHDOG_STARTUP_GRACE_MS
  ) {
    watchdogLastHealthyAt =
      now;

    watchdogConsecutiveFailures =
      0;

    return;
  }

  watchdogRecordEventLoopLag(eventLoopDelay);
  watchdogEvaluateResources();
  watchdogMaybeRecover();

  const eventLoopHealthy =
    eventLoopDelay <=
    WATCHDOG_EVENT_LOOP_TIMEOUT_MS;

  if (
    !eventLoopHealthy
  ) {
    watchdogConsecutiveFailures++;

    console.error(
      `[WATCHDOG] Event-loop stall detected: ${eventLoopDelay}ms`
    );

    console.error(
      `[WATCHDOG] Failure ${watchdogConsecutiveFailures}/${WATCHDOG_FAILURE_LIMIT}`
    );

    if (
      watchdogConsecutiveFailures >=
      WATCHDOG_FAILURE_LIMIT
    ) {
      console.error(
        "[WATCHDOG] ECLIPSE appears unhealthy."
      );

      console.error(
        "[WATCHDOG] Exiting with code 1 so Render can restart the process."
      );

      process.exit(1);
    }

    return;
  }

  watchdogLastHealthyAt =
    now;

  watchdogConsecutiveFailures =
    0;

  if (
    now - watchdogLastLogAt >=
    WATCHDOG_LOG_INTERVAL_MS
  ) {
    watchdogLastLogAt =
      now;

    const memory =
      process.memoryUsage();

    console.log(
      `[WATCHDOG] Healthy | ` +
        `Messenger: ${
          watchdogMessengerConnected
            ? "connected"
            : "not connected"
        } | ` +
        `RSS: ${Math.round(
          memory.rss /
            1024 /
            1024
        )} MB`
    );
  }
}

function startWatchdog() {
  if (
    watchdogStarted
  ) {
    return;
  }

  watchdogStarted =
    true;

  watchdogShuttingDown =
    false;

  watchdogStartedAt =
    Date.now();

  watchdogLastTickAt =
    Date.now();

  watchdogLastHealthyAt =
    Date.now();

  watchdogConsecutiveFailures =
    0;

  watchdogLastLogAt =
    Date.now();

  watchdogTimer =
    setInterval(
      runWatchdogCheck,
      WATCHDOG_INTERVAL_MS
    );

  watchdogEventLoopTimer = setInterval(watchdogSampleEventLoop, WATCHDOG_EVENT_LOOP_SAMPLE_MS);

  if (
    watchdogTimer &&
    typeof watchdogTimer.unref ===
      "function"
  ) {
    watchdogTimer.unref();
  }

  if (watchdogEventLoopTimer && typeof watchdogEventLoopTimer.unref === "function") {
    watchdogEventLoopTimer.unref();
  }

  console.log(
    "[WATCHDOG] Local watchdog started."
  );
}

function stopWatchdog() {
  watchdogShuttingDown =
    true;

  if (
    watchdogTimer
  ) {
    clearInterval(
      watchdogTimer
    );

    watchdogTimer =
      null;
  }

  if (watchdogEventLoopTimer) {
    clearInterval(watchdogEventLoopTimer);
    watchdogEventLoopTimer = null;
  }

  watchdogStarted =
    false;

  console.log(
    "[WATCHDOG] Local watchdog stopped."
  );
}

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
//
// This prevents multiple groups from spawning unlimited
// downloads and exhausting Render memory / CPU / disk.
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

// Number of currently running download jobs.
let activeMusicDownloads = 0;

// Monotonically increasing job ID.
let musicJobCounter = 0;

// When true, no NEW music jobs will start (queueing still works,
// and any job already downloading/searching/sending finishes normally).
let musicPaused = false;

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
// MESSENGER SAFETY MANAGER
// ============================================================
// Responsible traffic protection for Messenger sends.
// This does NOT attempt to disguise automation or bypass Meta
// enforcement. It keeps ECLIPSE from producing accidental bursts,
// duplicate sends, retry storms, and concurrent API overload.
// ============================================================

const MESSENGER_SAFETY = {
  globalMinGapMs: Math.max(
    150,
    Number(process.env.MESSENGER_GLOBAL_GAP_MS || 350)
  ),
  threadMinGapMs: Math.max(
    500,
    Number(process.env.MESSENGER_THREAD_GAP_MS || 1500)
  ),
  maxQueue: Math.max(
    50,
    Number(process.env.MESSENGER_MAX_QUEUE || 500)
  ),
  maxRetries: Math.min(
    3,
    Math.max(0, Number(process.env.MESSENGER_MAX_RETRIES || 2))
  ),
  retryBaseMs: Math.max(
    500,
    Number(process.env.MESSENGER_RETRY_BASE_MS || 1500)
  ),
  circuitFailureLimit: Math.max(
    3,
    Number(process.env.MESSENGER_CIRCUIT_FAILURE_LIMIT || 5)
  ),
  circuitPauseMs: Math.max(
    10_000,
    Number(process.env.MESSENGER_CIRCUIT_PAUSE_MS || 30_000)
  ),
  duplicateWindowMs: Math.max(
    1000,
    Number(process.env.MESSENGER_DUPLICATE_WINDOW_MS || 4000)
  ),
};

const messengerSendQueue = [];
const messengerThreadNextAt = new Map();
const messengerRecentSends = new Map();
let messengerSendWorkerRunning = false;
let messengerLastSendAt = 0;
let messengerConsecutiveFailures = 0;
let messengerCircuitOpenUntil = 0;
let messengerTotalSent = 0;
let messengerTotalFailures = 0;
let messengerTotalRetries = 0;
let messengerTotalSuppressed = 0;
let messengerTotalRejected = 0;
let messengerNextJobId = 0;

function messengerErrorCode(error) {
  return String(
    error?.errorCode ??
    error?.code ??
    error?.status ??
    error?.statusCode ??
    ""
  ).trim();
}

function isMessengerTransientError(error) {
  const code = messengerErrorCode(error);
  const message = String(error?.message || error || "").toLowerCase();

  return (
    code === "1545012" ||
    code === "613" ||
    code === "429" ||
    /rate.?limit|too many|temporar|throttl|try again|timeout|timed out|econnreset|socket hang up|network/i.test(message)
  );
}

function messengerRetryDelay(attempt) {
  const exponential =
    MESSENGER_SAFETY.retryBaseMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(30_000, exponential + jitter);
}

function messengerPayloadFingerprint(message, threadID) {
  let body = "";

  if (typeof message === "string") {
    body = message;
  } else if (message && typeof message === "object") {
    body = String(message.body || "");
    if (message.attachment) {
      body += `|attachment:${message.attachment.path || message.attachment.fd || "stream"}`;
    }
  }

  return crypto
    .createHash("sha1")
    .update(`${String(threadID)}|${body}`)
    .digest("hex");
}

function messengerCleanupSafetyState(now = Date.now()) {
  for (const [threadID, nextAt] of messengerThreadNextAt.entries()) {
    if (nextAt < now - 60_000) {
      messengerThreadNextAt.delete(threadID);
    }
  }

  for (const [key, sentAt] of messengerRecentSends.entries()) {
    if (sentAt < now - MESSENGER_SAFETY.duplicateWindowMs * 2) {
      messengerRecentSends.delete(key);
    }
  }
}

function messengerSafetyStatus() {
  const now = Date.now();
  return {
    queue: messengerSendQueue.length,
    workerRunning: messengerSendWorkerRunning,
    lastSendAt: messengerLastSendAt,
    consecutiveFailures: messengerConsecutiveFailures,
    circuitOpen: now < messengerCircuitOpenUntil,
    circuitOpenUntil: messengerCircuitOpenUntil,
    totalSent: messengerTotalSent,
    totalFailures: messengerTotalFailures,
    totalRetries: messengerTotalRetries,
    totalSuppressed: messengerTotalSuppressed,
    totalRejected: messengerTotalRejected,
    effective: {
      globalGapMs: messengerEffectiveGlobalGapMs(),
      threadGapMs: messengerEffectiveThreadGapMs(),
      trafficMultiplier: watchdogGetTrafficMultiplier(),
    },
    limits: {
      globalGapMs: MESSENGER_SAFETY.globalMinGapMs,
      threadGapMs: MESSENGER_SAFETY.threadMinGapMs,
      maxQueue: MESSENGER_SAFETY.maxQueue,
      maxRetries: MESSENGER_SAFETY.maxRetries,
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messengerEffectiveGlobalGapMs() {
  return Math.ceil(MESSENGER_SAFETY.globalMinGapMs * watchdogGetTrafficMultiplier());
}

function messengerEffectiveThreadGapMs() {
  return Math.ceil(MESSENGER_SAFETY.threadMinGapMs * watchdogGetTrafficMultiplier());
}

function waitForMessengerSlot(threadID) {
  const now = Date.now();
  const globalWait = Math.max(0, messengerLastSendAt + messengerEffectiveGlobalGapMs() - now);
  const threadNextAt = messengerThreadNextAt.get(String(threadID)) || 0;
  const threadWait = Math.max(0, threadNextAt - now);
  return Math.max(globalWait, threadWait);
}

async function performMessengerSend(api, message, threadID) {
  let lastError = null;

  for (let attempt = 0; attempt <= MESSENGER_SAFETY.maxRetries; attempt++) {
    const circuitWait = Math.max(0, messengerCircuitOpenUntil - Date.now());
    if (circuitWait > 0) {
      await sleep(circuitWait);
    }

    const slotWait = waitForMessengerSlot(threadID);
    if (slotWait > 0) {
      await sleep(slotWait);
    }

    try {
      const result = await new Promise((resolve, reject) => {
        try {
          api.sendMessage(
            message,
            threadID,
            (error, messageInfo) => {
              if (error) reject(error);
              else resolve(messageInfo || null);
            }
          );
        } catch (error) {
          reject(error);
        }
      });

      const now = Date.now();
      messengerLastSendAt = now;
      messengerThreadNextAt.set(
        String(threadID),
        now + messengerEffectiveThreadGapMs()
      );
      messengerConsecutiveFailures = 0;
      messengerCircuitOpenUntil = 0;
      messengerTotalSent++;
      watchdogSetMessengerConnected(true);

      return result;
    } catch (error) {
      lastError = error;
      messengerConsecutiveFailures++;
      messengerTotalFailures++;

      if (messengerConsecutiveFailures >= MESSENGER_SAFETY.circuitFailureLimit) {
        messengerCircuitOpenUntil =
          Date.now() + MESSENGER_SAFETY.circuitPauseMs;
        console.error(
          `[MESSENGER SAFETY] Circuit opened for ${MESSENGER_SAFETY.circuitPauseMs}ms after ${messengerConsecutiveFailures} consecutive send failures.`
        );
      }

      const retryable = isMessengerTransientError(error);
      if (!retryable || attempt >= MESSENGER_SAFETY.maxRetries) {
        throw error;
      }

      const delay = messengerRetryDelay(attempt);
      messengerTotalRetries++;
      console.warn(
        `[MESSENGER SAFETY] Transient send error (${messengerErrorCode(error) || "unknown"}); retry ${attempt + 1}/${MESSENGER_SAFETY.maxRetries} in ${delay}ms.`
      );
      await sleep(delay);
    }
  }

  throw lastError || new Error("Messenger send failed.");
}

function enqueueMessengerSend(api, message, threadID) {
  const normalizedThreadID = String(threadID);
  const fingerprint = messengerPayloadFingerprint(message, normalizedThreadID);
  const now = Date.now();

  messengerCleanupSafetyState(now);

  if (now < messengerCircuitOpenUntil) {
    return Promise.reject(
      new Error("Messenger safety circuit is temporarily open.")
    );
  }

  const previous = messengerRecentSends.get(fingerprint);
  if (previous && now - previous < MESSENGER_SAFETY.duplicateWindowMs) {
    messengerTotalSuppressed++;
    console.warn(
      `[MESSENGER SAFETY] Duplicate send suppressed for thread ${normalizedThreadID}.`
    );
    return Promise.resolve(null);
  }

  if (messengerSendQueue.length >= MESSENGER_SAFETY.maxQueue) {
    messengerTotalRejected++;
    return Promise.reject(
      new Error("Messenger safety queue is full; send rejected to protect the connection.")
    );
  }

  messengerRecentSends.set(fingerprint, now);

  return new Promise((resolve, reject) => {
    messengerSendQueue.push({
      id: ++messengerNextJobId,
      api,
      message,
      threadID: normalizedThreadID,
      resolve,
      reject,
      enqueuedAt: now,
    });

    void processMessengerSendQueue();
  });
}

async function processMessengerSendQueue() {
  if (messengerSendWorkerRunning) return;
  messengerSendWorkerRunning = true;

  try {
    while (messengerSendQueue.length > 0) {
      const job = messengerSendQueue.shift();
      if (!job) continue;

      try {
        const result = await performMessengerSend(
          job.api,
          job.message,
          job.threadID
        );
        job.resolve(result);
      } catch (error) {
        job.reject(error);
      }
    }
  } finally {
    messengerSendWorkerRunning = false;
    if (messengerSendQueue.length > 0) {
      void processMessengerSendQueue();
    }
  }
}

// ============================================================
// MESSENGER PROMISE WRAPPER
// ============================================================
//
// All normal Messenger sends now pass through the centralized
// safety manager above. Existing callers do not need to change.
// ============================================================

function sendMessengerMessage(
  api,
  message,
  threadID
) {
  return enqueueMessengerSend(
    api,
    message,
    threadID
  );
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

function getMusicQueue(threadID) {
  const id = String(threadID);

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

  for (const queue of musicQueues.values()) {
    totalJobs += queue.length;

    for (const job of queue) {
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
          "downloading"
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

function removeMusicJob(job) {
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

  if (queue.length === 0) {
    musicQueues.delete(
      job.threadID
    );
  }
}

function removePendingMusicJob(job) {
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

function getMusicQueuePosition(job) {
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

function formatMusicBytes(bytes) {
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
    global.botPaused === true ||
    musicPaused === true
  ) {
    return;
  }

  if (!watchdogCanStartBackgroundWork("background")) {
    return;
  }

  while (
    activeMusicDownloads <
      MUSIC_MAX_GLOBAL_DOWNLOADS &&
    musicPendingJobs.length > 0
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

    void processMusicJob(
      job
    ).finally(() => {
      activeMusicDownloads =
        Math.max(
          0,
          activeMusicDownloads - 1
        );

      removeMusicJob(job);

      setImmediate(
        processMusicQueue
      );
    });
  }
}

// ============================================================
// MUSIC JOB
// ============================================================
//
// FLOW:
//
// 1. SEND "SEARCHING YOUTUBE" MESSAGE.
// 2. SEARCH.
// 3. SEND "PREPARING AUDIO" MESSAGE.
// 4. SEND "DOWNLOADING" MESSAGE.
// 5. DOWNLOAD.
// 6. SEND NEW MESSAGE containing the actual audio.
// 7. On failure, SEND a new failure message.
//
// Every status update is its own message (no editing), since
// editing the same Messenger message was buggy/unreliable.
// ============================================================

async function processMusicJob(job) {
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
      global.botDisabled === true ||
      job.cancelled
    ) {
      job.cancelled = true;
      return;
    }

    // ========================================================
    // STEP 1
    // SEND "SEARCHING" MESSAGE
    // ========================================================

    job.status =
      "searching";

    await sendMessengerMessage(
      api,
      buildMusicPanel({
        title:
          job.requestedSong,
        state:
          "searching",
      }),
      threadID
    ).catch((sendError) => {
      console.error(
        `[Music] Failed to send searching status for job ${job.id}:`,
        sendError
      );
    });

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
      !video ||
      !video.url
    ) {
      throw new Error(
        `No YouTube result found for "${job.requestedSong}".`
      );
    }

    if (
      job.cancelled
    ) {
      return;
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

    let duration =
      String(
        video.duration ||
          video.timestamp ||
          ""
      ).trim();

    if (!duration) {
      duration = "--:--";
    }

    job.title =
      title;

    job.author =
      author;

    job.duration =
      duration;

    // ========================================================
    // STEP 3
    // SEND "PREPARING AUDIO" MESSAGE
    // ========================================================

    job.status =
      "processing";

    await sendMessengerMessage(
      api,
      buildMusicPanel({
        title,
        author,
        duration,
        state:
          "processing",
      }),
      threadID
    ).catch((sendError) => {
      console.error(
        `[Music] Failed to send processing status for job ${job.id}:`,
        sendError
      );
    });

    if (
      global.botDisabled === true ||
      job.cancelled
    ) {
      job.cancelled = true;
      return;
    }

    // ========================================================
    // STEP 4
    // SEND "DOWNLOADING" MESSAGE
    // ========================================================

    job.status =
      "downloading";

    await sendMessengerMessage(
      api,
      buildMusicPanel({
        title,
        author,
        duration,
        state:
          "downloading",
      }),
      threadID
    ).catch((sendError) => {
      console.error(
        `[Music] Failed to send downloading status for job ${job.id}:`,
        sendError
      );
    });

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
      !fileInfo.isFile() ||
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

    if (
      global.botDisabled === true ||
      job.cancelled
    ) {
      job.cancelled = true;
      return;
    }

    // ========================================================
    // STEP 7
    // SEND NEW MESSAGE
    // THIS IS THE ACTUAL SONG
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

    await withTimeout(
      () =>
        sendMessengerMessage(
          api,
          {
            body:
              playerMessage,

            attachment:
              fs.createReadStream(
                temporaryFile
              ),
          },
          threadID
        ),
      MUSIC_SEND_TIMEOUT_MS,
      "Sending the audio to Messenger timed out."
    );

    console.log(
      `[Music] Sent "${title}" to ${threadID}`
    );
  } catch (error) {
    if (
      job.cancelled
    ) {
      console.log(
        `[Music] Job ${job.id} cancelled.`
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

    // ========================================================
    // FAILURE
    // SEND A NEW FAILURE MESSAGE
    // ========================================================

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

    try {
      await sendMessengerMessage(
        api,
        failedPanel,
        threadID
      );
    } catch (sendError) {
      console.error(
        "[Music] Failed to send error message:",
        sendError
      );
    }
  } finally {
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

    temporaryFile:
      null,

    cancelled:
      false,
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
// ADD MUSIC QUEUE AFTER PAUSE RESUMES
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
        "୨୧ also try",
        "   !music queue",
        "   !music skip",
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
// MUSIC SKIP
// ============================================================
//
// Skips whatever song is currently active for this GC (searching /
// processing / downloading / streaming). If nothing is active yet,
// skips the next pending song in this GC's queue instead.
// ============================================================

function handleMusicSkip(
  api,
  threadID
) {
  const queue =
    getMusicQueue(threadID);

  const activeJob =
    queue.find(
      (job) =>
        job.status !==
          "pending" &&
        !job.cancelled
    );

  if (activeJob) {
    activeJob.cancelled =
      true;

    sendReplyWithTyping(
      api,
      buildMusicPanel({
        title:
          activeJob.title ||
          activeJob.requestedSong,

        author:
          activeJob.author ||
          "",

        duration:
          activeJob.duration ||
          "--:--",

        state:
          "cancelled",
      }),
      threadID
    );

    return;
  }

  const pendingJob =
    queue.find(
      (job) =>
        job.status ===
          "pending" &&
        !job.cancelled
    );

  if (pendingJob) {
    pendingJob.cancelled =
      true;

    removePendingMusicJob(
      pendingJob
    );

    removeMusicJob(
      pendingJob
    );

    sendReplyWithTyping(
      api,
      buildMusicPanel({
        title:
          pendingJob.title ||
          pendingJob.requestedSong,

        state:
          "cancelled",
      }),
      threadID
    );

    return;
  }

  sendReplyWithTyping(
    api,
    [
      "╭────── 🎀  MUSIC SKIP  🎀 ──────╮",
      "",
      "♡ there's nothing to skip in this GC.",
      "",
      "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
    ].join("\n"),
    threadID
  );
}

// ============================================================
// MUSIC PAUSE / RESUME
// ============================================================
//
// Pausing does NOT stop a song that's already downloading or
// being sent - it just stops the next queued song from starting.
// ============================================================

function handleMusicPauseToggle(
  api,
  threadID,
  paused
) {
  musicPaused = paused;

  if (!paused) {
    resumeMusicProcessing();
  }

  sendReplyWithTyping(
    api,
    [
      "╭────── 🎀  MUSIC  🎀 ──────╮",
      "",
      paused
        ? "🟡 MUSIC QUEUE PAUSED"
        : "🟢 MUSIC QUEUE RESUMED",
      "",
      "୨୧ effect",
      paused
        ? "    ♡ no new songs will start"
        : "    ♡ queued songs will start again",
      "    ♡ a song already downloading/",
      "      sending is not affected",
      "",
      "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
    ].join("\n"),
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

  const watchdog =
    getWatchdogStatus();

  const healthOk =
    watchdog.ok;

  res.status(
    healthOk
      ? 200
      : 503
  ).json({
    ok:
      healthOk,

    botDisabled:
      global.botDisabled === true,

    botPaused:
      global.botPaused === true,

    uptime:
      process.uptime(),

    watchdog,

    messengerSafety: messengerSafetyStatus(),

    resources: {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      externalMb: Math.round(process.memoryUsage().external / 1024 / 1024),
    },

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

    timestamp:
      new Date().toISOString(),
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

      startWatchdog();
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
  const rawCookies =
    process.env.FB_COOKIES;

  if (
    typeof rawCookies !== "string" ||
    !rawCookies.trim()
  ) {
    throw new Error(
      "FB_COOKIES is missing."
    );
  }

  let parsed;

  try {
    parsed =
      JSON.parse(
        rawCookies
      );

    if (
      typeof parsed ===
      "string"
    ) {
      parsed =
        JSON.parse(
          parsed
        );
    }
  } catch {
    throw new Error(
      "FB_COOKIES must contain valid JSON."
    );
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0
  ) {
    throw new Error(
      "FB_COOKIES must be a non-empty cookie array."
    );
  }

  return parsed.map(
    (cookie) => {
      if (
        !cookie ||
        typeof cookie !==
          "object" ||
        Array.isArray(cookie)
      ) {
        throw new Error(
          "Each FB_COOKIES entry must be an object."
        );
      }

      const key =
        typeof cookie.key ===
        "string"
          ? cookie.key
          : cookie.name;

      if (
        typeof key !==
          "string" ||
        !key.trim() ||
        typeof cookie.value !==
          "string"
      ) {
        throw new Error(
          "Every cookie must contain string name/key and value fields."
        );
      }

      return {
        ...cookie,
        key,
      };
    }
  );
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
// ============================================================

login(
  appState,
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

      watchdogSetMessengerConnected(
        false
      );

      process.exit(1);
    }

    if (!api) {
      console.error(
        "Login failed: Facebook API object was not returned."
      );

      watchdogSetMessengerConnected(
        false
      );

      process.exit(1);
    }

    watchdogSetMessengerConnected(
      true
    );

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
      void sendMessengerMessage(
        api,
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
          "♡ watchdog: active",
        ].join("\n"),
        startupThreadID
      ).catch((sendError) => {
        console.error(
          "Startup message failed:",
          sendError
        );
      });
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
          watchdogSetMessengerConnected(
            false
          );

          console.error(
            "Listener error:",
            listenError
          );

          return;
        }

        watchdogSetMessengerConnected(
          true
        );

        watchdogHeartbeat();

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
          );
        }
      }
    );
  }
);

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
// WATCHDOG COMMAND + ADMISSION LAYER
// ============================================================
//
// This is an additional protection layer above feature handlers.
// It limits command storms before they reach RPG, games, music,
// AI, economy, or Messenger. It is intentionally conservative and
// does not attempt to disguise automation or bypass Meta systems.
// ============================================================

const WATCHDOG_COMMAND_WINDOW_MS = Math.max(
  5_000,
  Number(process.env.WATCHDOG_COMMAND_WINDOW_MS || 10_000)
);

const WATCHDOG_COMMAND_LIMIT = Math.max(
  10,
  Number(process.env.WATCHDOG_COMMAND_LIMIT || 40)
);

const WATCHDOG_COMMAND_BURST_LIMIT = Math.max(
  5,
  Number(process.env.WATCHDOG_COMMAND_BURST_LIMIT || 12)
);

const watchdogCommandBuckets = new Map();
const watchdogCommandWarnings = new Map();

function watchdogResetCounters() {
  watchdogConsecutiveFailures = 0;
  watchdogLastEventLoopLagMs = 0;
  watchdogLastReason = "manual reset";
  watchdogResourcePressure = "normal";
  watchdogStableSince = Date.now();
  messengerConsecutiveFailures = 0;
  messengerCircuitOpenUntil = 0;
  messengerCleanupSafetyState();
}

function watchdogResetMessengerCounters() {
  messengerConsecutiveFailures = 0;
  messengerCircuitOpenUntil = 0;
  messengerCleanupSafetyState();
}

function watchdogFormatStatus() {
  const status = getWatchdogStatus();
  const messenger = messengerSafetyStatus();
  const memory = process.memoryUsage();
  const rssMb = Math.round(memory.rss / 1024 / 1024);

  return [
    "╔══════════════════════════════╗",
    "        🌑 ECLIPSE WATCHDOG",
    "╚══════════════════════════════╝",
    "",
    `Mode: ${status.mode.toUpperCase()}`,
    `Health: ${status.ok ? "🟢 STABLE" : "🔴 UNHEALTHY"}`,
    `Reason: ${status.modeReason || "none"}`,
    "",
    "⚙️ SYSTEM",
    `Node: ✓ (${Math.round(process.uptime())}s uptime)`,
    `Event Loop: ${status.eventLoopLagMs}ms`,
    `Memory: ${rssMb}MB (${status.resourcePressure})`,
    `Database: available`,
    "",
    "📡 MESSENGER",
    `Connection: ${status.messengerConnected ? "🟢 CONNECTED" : "🟡 WAITING"}`,
    `Queue: ${messenger.queue}/${messenger.limits.maxQueue}`,
    `Circuit: ${messenger.circuitOpen ? "🔴 OPEN" : "🟢 CLOSED"}`,
    `Failures: ${messenger.consecutiveFailures}`,
    `Retries: ${messenger.totalRetries}`,
    `Duplicates: ${messenger.totalSuppressed}`,
    `Rejected: ${messenger.totalRejected}`,
    "",
    `Traffic multiplier: ${messenger.effective.trafficMultiplier}x`,
    `Global gap: ${messenger.effective.globalGapMs}ms`,
    `Thread gap: ${messenger.effective.threadGapMs}ms`,
  ].join("\n");
}

function watchdogAdmitCommand(threadId, senderId, originalText, isAdmin) {
  if (isAdmin) return true;

  const text = String(originalText || "").trim();
  if (!/^!/i.test(text)) return true;

  const now = Date.now();
  const key = `${String(threadId)}:${String(senderId)}`;
  let bucket = watchdogCommandBuckets.get(key);

  if (!bucket || now - bucket.startedAt > WATCHDOG_COMMAND_WINDOW_MS) {
    bucket = {
      startedAt: now,
      count: 0,
      lastCommand: "",
      burstCount: 0,
      lastAt: 0,
    };
    watchdogCommandBuckets.set(key, bucket);
  }

  bucket.count++;
  if (bucket.lastCommand === text && now - bucket.lastAt <= 3_000) {
    bucket.burstCount++;
  } else {
    bucket.burstCount = 1;
  }
  bucket.lastCommand = text;
  bucket.lastAt = now;

  if (
    bucket.count > WATCHDOG_COMMAND_LIMIT ||
    bucket.burstCount > WATCHDOG_COMMAND_BURST_LIMIT
  ) {
    const lastWarning = watchdogCommandWarnings.get(key) || 0;
    if (now - lastWarning > WATCHDOG_COMMAND_WINDOW_MS) {
      watchdogCommandWarnings.set(key, now);
      console.warn(
        `[WATCHDOG] Command storm suppressed for ${key}.`
      );
    }
    return false;
  }

  if (watchdogMode === WATCHDOG_MODES.EMERGENCY) {
    return false;
  }

  return true;
}

function watchdogCleanupCommandState() {
  const cutoff = Date.now() - WATCHDOG_COMMAND_WINDOW_MS * 3;
  for (const [key, bucket] of watchdogCommandBuckets.entries()) {
    if (bucket.lastAt < cutoff) watchdogCommandBuckets.delete(key);
  }
  for (const [key, at] of watchdogCommandWarnings.entries()) {
    if (at < cutoff) watchdogCommandWarnings.delete(key);
  }
}

setInterval(watchdogCleanupCommandState, WATCHDOG_COMMAND_WINDOW_MS * 3).unref?.();

// ============================================================
// MESSAGE HANDLING
// ============================================================

async function handleMessage(
  api,
  event
) {
  watchdogHeartbeat();

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

  // ==========================================================
  // WATCHDOG COMMANDS
  // Read-only commands are public. Control commands are admin-only.
  // ==========================================================

  const watchdogMatch = originalText.match(
    /^!watchdog(?:\s+(status|stats|test|pause|resume|reset|restart))?$/i
  );

  if (watchdogMatch) {
    const action = String(watchdogMatch[1] || "status").toLowerCase();

    if (["pause", "resume", "reset", "restart"].includes(action) && !isAdmin) {
      await sendReplyWithTyping(
        api,
        "🔒 WATCHDOG CONTROL IS ADMIN-ONLY.\n\nYou can use `!watchdog`, `!watchdog status`, `!watchdog stats`, and `!watchdog test` to view health.",
        threadId
      );
      return;
    }

    if (action === "restart") {
      sendReplyWithTyping(
        api,
        "🌑 WATCHDOG\n\n🔴 MANUAL RESTART REQUESTED\n\nECLIPSE will exit so the external process manager can restart it.",
        threadId
      );
      setTimeout(() => {
        watchdogSetShuttingDown(true);
        watchdogSetMessengerConnected(false);
        stopWatchdog();
        process.exit(1);
      }, 1500);
      return;
    }

    if (action === "pause") {
      watchdogSetMode("PROTECTIVE", "manual admin pause");
      musicPaused = true;
      sendReplyWithTyping(
        api,
        "🌑 WATCHDOG\n\n🟠 PROTECTIVE MODE ENABLED\n\nNon-essential background activity is being restricted.\n\nUse `!watchdog resume` when you want automatic operation restored.",
        threadId
      );
      return;
    }

    if (action === "resume") {
      watchdogResetMessengerCounters();
      watchdogStableSince = Date.now();
      watchdogSetMode("RECOVERY", "manual admin resume");
      resumeMusicProcessing();
      sendReplyWithTyping(
        api,
        "🌑 WATCHDOG\n\n🔵 RECOVERY MODE\n\nSystems are resuming gradually. Watchdog will return to NORMAL after the stability window.",
        threadId
      );
      return;
    }

    if (action === "reset") {
      watchdogResetCounters();
      sendReplyWithTyping(
        api,
        "🌑 WATCHDOG\n\n♻️ STATE RESET\n\nWatchdog and Messenger failure counters were reset. Automatic protection remains enabled.",
        threadId
      );
      return;
    }

    if (action === "stats") {
      const status = getWatchdogStatus();
      const messenger = messengerSafetyStatus();
      const memory = process.memoryUsage();
      sendReplyWithTyping(
        api,
        [
          watchdogFormatStatus(),
          "",
          "📊 TELEMETRY",
          `Successful sends: ${messenger.totalSent}`,
          `Failed sends: ${messenger.totalFailures}`,
          `Retries: ${messenger.totalRetries}`,
          `Suppressed duplicates: ${messenger.totalSuppressed}`,
          `Rejected by queue: ${messenger.totalRejected}`,
          `RSS: ${Math.round(memory.rss / 1024 / 1024)}MB`,
          `Event-loop lag: ${status.eventLoopLagMs}ms`,
        ].join("\n"),
        threadId
      );
      return;
    }

    if (action === "test") {
      const status = getWatchdogStatus();
      const memory = process.memoryUsage();
      const checks = [
        `Node process: ${status.shuttingDown ? "❌" : "✓"}`,
        `Watchdog timer: ${status.started ? "✓" : "❌"}`,
        `Event loop: ${status.eventLoopLagMs < 5000 ? "✓" : "⚠️"}`,
        `Memory: ${status.resourcePressure === "normal" ? "✓" : "⚠️"}`,
        `Messenger circuit: ${messengerCircuitOpenUntil > Date.now() ? "⚠️ OPEN" : "✓ CLOSED"}`,
        `RSS: ${Math.round(memory.rss / 1024 / 1024)}MB`,
      ];
      sendReplyWithTyping(
        api,
        "🌑 WATCHDOG SELF-TEST\n\n" + checks.join("\n") + "\n\nNo test spam was sent to Messenger.",
        threadId
      );
      return;
    }

    sendReplyWithTyping(
      api,
      watchdogFormatStatus(),
      threadId
    );
    return;
  }

  if (!watchdogAdmitCommand(threadId, senderId, originalText, isAdmin)) {
    return;
  }

  // ==========================================================
  // PAUSE / RESUME / BOT CONTROL
  // These MUST be checked before normal AI/training so that
  // pause actually pauses normal message processing.
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

      const watchdog =
        getWatchdogStatus();

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
          "୨୧ watchdog",
          `    ♡ ${
            watchdog.ok
              ? "🟢 HEALTHY"
              : "🔴 UNHEALTHY"
          }`,
          "",
          "୨୧ music",
          `    ♡ active downloads: ${
            music.activeDownloads
          }/${MUSIC_MAX_GLOBAL_DOWNLOADS}`,
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
          "୨୧ watchdog",
          "    ♡ !watchdog",
          "    ♡ !watchdog status",
          "    ♡ !watchdog restart",
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

      const watchdog =
        getWatchdogStatus();

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
          "୨୧ watchdog",
          `    ♡ ${
            watchdog.ok
              ? "🟢 HEALTHY"
              : "🔴 UNHEALTHY"
          }`,
          `    ♡ Messenger: ${
            watchdog.messengerConnected
              ? "🟢 CONNECTED"
              : "🔴 DISCONNECTED"
          }`,
          `    ♡ send queue: ${messengerSendQueue.length}/${MESSENGER_SAFETY.maxQueue}`,
          `    ♡ safety circuit: ${Date.now() < messengerCircuitOpenUntil ? "🟡 PAUSED" : "🟢 CLOSED"}`,
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
          "    ♡ !watchdog status",
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
        "♡ !music status / !music queue",
        "  Show the GC music queue.",
        "♡ !music skip",
        "  Skip the current/next song.",
        "♡ !music pause (admin)",
        "  Stop new songs from starting.",
        "♡ !music resume / !music play (admin)",
        "  Let the queue continue.",
        "♡ Maximum 2 songs per GC.",
        "",
        "୨୧ BOT CONTROL",
        "♡ !pause",
        "♡ !pause status",
        "♡ !resume",
        "",
        "୨୧ WATCHDOG",
        "♡ !watchdog",
        "♡ !watchdog status",
        "♡ !watchdog restart",
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
  // MUSIC
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
  // MUSIC QUEUE / SKIP / PAUSE / RESUME
  // ==========================================================

  const musicSubMatch =
    originalText.match(
      /^!music\s+(status|queue|skip|pause|resume|play)$/i
    );

  if (musicSubMatch) {
    const musicSubcommand =
      musicSubMatch[1].toLowerCase();

    if (
      musicSubcommand ===
        "status" ||
      musicSubcommand ===
        "queue"
    ) {
      sendMusicStatus(
        api,
        threadID
      );

      return;
    }

    if (
      musicSubcommand ===
      "skip"
    ) {
      handleMusicSkip(
        api,
        threadID
      );

      return;
    }

    if (
      musicSubcommand ===
      "pause"
    ) {
      if (!isAdmin) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  MUSIC  🎀 ──────╮",
            "",
            "🔒 ADMIN ONLY",
            "",
            "Only the bot admin can pause",
            "the music queue.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      handleMusicPauseToggle(
        api,
        threadID,
        true
      );

      return;
    }

    if (
      musicSubcommand ===
        "resume" ||
      musicSubcommand ===
        "play"
    ) {
      if (!isAdmin) {
        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  MUSIC  🎀 ──────╮",
            "",
            "🔒 ADMIN ONLY",
            "",
            "Only the bot admin can resume",
            "the music queue.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );

        return;
      }

      handleMusicPauseToggle(
        api,
        threadID,
        false
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
          void sendMessengerMessage(
            api,
            broadcastMessage,
            threadID
          )
            .then(() => {
              console.log(
                `[Broadcast] Sent to ${threadID}`
              );
            })
            .catch((sendError) => {
              console.error(
                `[Broadcast] Failed for ${threadID}:`,
                sendError
              );
            });
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

        void sendMessengerMessage(
          api,
          outgoingMessage,
          threadID
        ).catch((sendError) => {
          console.error(
            "Reply failed:",
            sendError
          );
        });
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
  const files = new Set();

  for (const queue of musicQueues.values()) {
    for (const job of queue) {
      if (job.temporaryFile) {
        files.add(
          job.temporaryFile
        );
      }
    }
  }

  for (const file of files) {
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

  watchdogSetShuttingDown(
    true
  );

  watchdogSetMessengerConnected(
    false
  );

  stopWatchdog();

  console.log(
    `[SYSTEM] Received ${signal}. Cleaning up ECLIPSE...`
  );

  for (
    const job of musicPendingJobs
  ) {
    job.cancelled =
      true;
  }

  musicPendingJobs.length = 0;

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
  watchdogEvaluateResources();
  watchdogMaybeRecover();

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
