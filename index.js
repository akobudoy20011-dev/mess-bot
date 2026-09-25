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
  initLastChamber,
} = require("./games");

// ============================================================
// ECLIPSE ACADEMY / EXAM
// ============================================================

const {
  handleExam,
  handleExamResponse,
} = require("./exam-manager");

// ============================================================
// ECLIPSE DEBATE
// ============================================================

const {
  handleDebateCommand,
  initDebate,
} = require("./debate");

// ============================================================
// ECLIPSE INVESTIGATIONS
// ============================================================

const {
  handleInvestigationCommand,
} = require("./investigations");

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

function watchdogHeartbeat() {
  const now =
    Date.now();

  watchdogLastHealthyAt =
    now;

  watchdogConsecutiveFailures =
    0;

  watchdogRecomputeMode();
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

// ============================================================
// WATCHDOG MODE / TRAFFIC LINK
// ============================================================
//
// Bridges watchdog health into the Traffic Governor. The
// governor's trafficMode()/trafficEffectiveGapMs() functions
// look for these two globals; previously neither was ever
// declared, so the link was permanently inert. This makes it
// real: as health degrades, outgoing sends space out more.
// ============================================================

let watchdogMode = "normal"; // normal | degraded | critical

function watchdogRecomputeMode() {
  if (
    watchdogConsecutiveFailures >=
    WATCHDOG_FAILURE_LIMIT - 1
  ) {
    watchdogMode = "critical";
    return;
  }

  const now = Date.now();

  const eventLoopAgeMs =
    now - watchdogLastTickAt;

  if (
    watchdogConsecutiveFailures > 0 ||
    eventLoopAgeMs >
      WATCHDOG_EVENT_LOOP_TIMEOUT_MS / 2
  ) {
    watchdogMode = "degraded";
    return;
  }

  watchdogMode = "normal";
}

function watchdogGetTrafficMultiplier() {
  if (watchdogMode === "critical") {
    return 3;
  }

  if (watchdogMode === "degraded") {
    return 1.75;
  }

  return 1;
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

    mode:
      watchdogMode,

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

    watchdogRecomputeMode();

    return;
  }

  const eventLoopHealthy =
    eventLoopDelay <=
    WATCHDOG_EVENT_LOOP_TIMEOUT_MS;

  if (
    !eventLoopHealthy
  ) {
    watchdogConsecutiveFailures++;

    watchdogRecomputeMode();

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

  watchdogRecomputeMode();

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

  watchdogRecomputeMode();

  watchdogTimer =
    setInterval(
      runWatchdogCheck,
      WATCHDOG_INTERVAL_MS
    );

  if (
    watchdogTimer &&
    typeof watchdogTimer.unref ===
      "function"
  ) {
    watchdogTimer.unref();
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

  watchdogStarted =
    false;

  console.log(
    "[WATCHDOG] Local watchdog stopped."
  );
}


// ============================================================
// ECLIPSE VEIL — TRAFFIC GOVERNOR
// ============================================================
//
// Legitimate reliability layer between ECLIPSE and Messenger.
// It is designed to prevent accidental bursts, duplicate command
// storms, retry amplification, and runaway outgoing traffic.
// It is NOT an anti-detection or enforcement-evasion system.
// ============================================================

const TRAFFIC_GOVERNOR = Object.freeze({
  globalPerMinute: Math.max(
    20,
    Number(process.env.ECLIPSE_GLOBAL_SENDS_PER_MINUTE || 60)
  ),

  threadPerMinute: Math.max(
    5,
    Number(process.env.ECLIPSE_THREAD_SENDS_PER_MINUTE || 20)
  ),

  userCommandsPerMinute: Math.max(
    5,
    Number(process.env.ECLIPSE_USER_COMMANDS_PER_MINUTE || 20)
  ),

  threadCommandsPerMinute: Math.max(
    10,
    Number(process.env.ECLIPSE_THREAD_COMMANDS_PER_MINUTE || 60)
  ),

  queueMax: Math.max(
    50,
    Number(process.env.ECLIPSE_TRAFFIC_QUEUE_MAX || 300)
  ),

  baseGapMs: Math.max(
    250,
    Number(process.env.ECLIPSE_TRAFFIC_GAP_MS || 750)
  ),

  duplicateWindowMs: Math.max(
    1000,
    Number(process.env.ECLIPSE_TRAFFIC_DUPLICATE_WINDOW_MS || 5000)
  ),
});

const trafficSendQueue = [];
const trafficGlobalSendTimes = [];
const trafficThreadSendTimes = new Map();
const trafficRecentMessages = new Map();
const trafficUserCommandTimes = new Map();
const trafficThreadCommandTimes = new Map();

let trafficGovernorRunning = false;
let trafficGovernorTimer = null;
let trafficGovernorInstalled = false;
let trafficLastSendAt = 0;
let trafficTotalSent = 0;
let trafficTotalDelayed = 0;
let trafficTotalSuppressed = 0;
let trafficTotalRejected = 0;
let trafficTotalDuplicateBlocked = 0;
let trafficTotalCommandBlocked = 0;
let trafficPeakQueue = 0;

// ============================================================
// INCOMING EVENT DEDUPLICATION
// ============================================================
// Prevents one Messenger event from executing a command twice
// during transient listener reconnects or duplicate delivery.
// ============================================================

const INCOMING_DEDUP_WINDOW_MS = Math.max(
  2_000,
  Number(process.env.ECLIPSE_INCOMING_DEDUP_WINDOW_MS || 10_000)
);

const recentIncomingEvents = new Map();

function incomingEventKeys(event) {
  if (!event || typeof event !== "object") {
    return [];
  }

  const keys = [];

  const messageID = String(
    event.messageID ||
      event.messageId ||
      event.message_id ||
      ""
  ).trim();

  if (messageID) {
    keys.push(`id:${messageID}`);
  }

  // Messenger/FCA can occasionally deliver the same logical event
  // through a reconnect with a different/absent message ID. Keep a
  // second semantic fingerprint so one user action cannot execute twice.
  const timestamp = Number(
    event.timestamp ||
      event.timestampMS ||
      event.timestamp_ms ||
      NaN
  );

  const threadID = String(event.threadID || "").trim();
  const senderID = String(event.senderID || "").trim();
  const body = String(event.body || "").trim();

  if (
    threadID &&
    senderID &&
    Number.isFinite(timestamp) &&
    body
  ) {
    keys.push(
      `semantic:${threadID}:${senderID}:${timestamp}:${body}`
    );

    // Some reconnect paths can reproduce the same event with a tiny
    // timestamp difference. A one-second bucket catches that case
    // without using a long-lived body-only fingerprint that could
    // suppress two legitimate identical commands minutes later.
    keys.push(
      `semantic1s:${threadID}:${senderID}:${Math.floor(timestamp / 1000)}:${body}`
    );
  }

  return keys;
}

function shouldProcessIncomingEvent(event) {
  const keys = incomingEventKeys(event);

  if (!keys.length) {
    return true;
  }

  const now = Date.now();

  for (const key of keys) {
    const previous = recentIncomingEvents.get(key);

    if (
      previous &&
      now - previous < INCOMING_DEDUP_WINDOW_MS
    ) {
      console.warn(
        `[EVENT] Duplicate Messenger event suppressed: ${key}`
      );
      return false;
    }
  }

  for (const key of keys) {
    recentIncomingEvents.set(key, now);
  }

  return true;
}

function cleanupIncomingEventDedup() {
  const now = Date.now();

  for (const [key, timestamp] of recentIncomingEvents.entries()) {
    if (now - timestamp >= INCOMING_DEDUP_WINDOW_MS) {
      recentIncomingEvents.delete(key);
    }
  }
}

const incomingEventCleanupTimer = setInterval(
  cleanupIncomingEventDedup,
  Math.min(INCOMING_DEDUP_WINDOW_MS, 30_000)
);

if (
  incomingEventCleanupTimer &&
  typeof incomingEventCleanupTimer.unref === "function"
) {
  incomingEventCleanupTimer.unref();
}

function trafficNow() {
  return Date.now();
}

function trafficPruneTimes(list, now, windowMs = 60_000) {
  while (list.length && now - list[0] >= windowMs) {
    list.shift();
  }
}

function trafficPruneMap(map, now, windowMs = 60_000) {
  for (const [key, list] of map.entries()) {
    trafficPruneTimes(list, now, windowMs);
    if (!list.length) {
      map.delete(key);
    }
  }
}

function trafficFingerprint(message, threadID) {
  let body = "";

  if (typeof message === "string") {
    body = message;
  } else if (message && typeof message === "object") {
    body = String(message.body || "");
  }

  return crypto
    .createHash("sha1")
    .update(`${String(threadID)}\n${body.trim()}`)
    .digest("hex");
}

function trafficEffectiveGapMs() {
  let multiplier = 1;

  if (typeof watchdogGetTrafficMultiplier === "function") {
    multiplier = watchdogGetTrafficMultiplier();
  }

  return Math.round(
    TRAFFIC_GOVERNOR.baseGapMs * multiplier
  );
}

function trafficMode() {
  if (typeof watchdogMode !== "undefined") {
    return watchdogMode;
  }

  return "normal";
}

function trafficCanAcceptCommand(senderID, threadID) {
  const now = trafficNow();
  const sender = String(senderID || "").trim();
  const thread = String(threadID || "").trim();

  if (!sender || !thread) {
    return true;
  }

  const userTimes =
    trafficUserCommandTimes.get(sender) || [];

  const threadTimes =
    trafficThreadCommandTimes.get(thread) || [];

  trafficPruneTimes(userTimes, now);
  trafficPruneTimes(threadTimes, now);

  if (
    userTimes.length >=
    TRAFFIC_GOVERNOR.userCommandsPerMinute
  ) {
    trafficTotalCommandBlocked++;
    trafficUserCommandTimes.set(sender, userTimes);
    return false;
  }

  if (
    threadTimes.length >=
    TRAFFIC_GOVERNOR.threadCommandsPerMinute
  ) {
    trafficTotalCommandBlocked++;
    trafficThreadCommandTimes.set(thread, threadTimes);
    return false;
  }

  userTimes.push(now);
  threadTimes.push(now);

  trafficUserCommandTimes.set(sender, userTimes);
  trafficThreadCommandTimes.set(thread, threadTimes);

  return true;
}

function trafficCanSendNow(threadID, message) {
  const now = trafficNow();
  const thread = String(threadID || "");

  trafficPruneTimes(
    trafficGlobalSendTimes,
    now
  );

  const threadTimes =
    trafficThreadSendTimes.get(thread) || [];

  trafficPruneTimes(threadTimes, now);
  trafficThreadSendTimes.set(thread, threadTimes);

  const fingerprint =
    trafficFingerprint(message, thread);

  const recentAt =
    trafficRecentMessages.get(fingerprint) || 0;

  if (
    recentAt &&
    now - recentAt <
      TRAFFIC_GOVERNOR.duplicateWindowMs
  ) {
    trafficTotalDuplicateBlocked++;
    return {
      ok: false,
      reason: "duplicate",
      waitMs: 0,
    };
  }

  if (
    trafficGlobalSendTimes.length >=
    TRAFFIC_GOVERNOR.globalPerMinute
  ) {
    const waitMs =
      Math.max(
        100,
        60_000 -
          (now - trafficGlobalSendTimes[0])
      );

    return {
      ok: false,
      reason: "global_limit",
      waitMs,
    };
  }

  if (
    threadTimes.length >=
    TRAFFIC_GOVERNOR.threadPerMinute
  ) {
    const waitMs =
      Math.max(
        100,
        60_000 -
          (now - threadTimes[0])
      );

    return {
      ok: false,
      reason: "thread_limit",
      waitMs,
    };
  }

  const gapRemaining =
    Math.max(
      0,
      trafficEffectiveGapMs() -
        (now - trafficLastSendAt)
    );

  if (gapRemaining > 0) {
    return {
      ok: false,
      reason: "spacing",
      waitMs: gapRemaining,
    };
  }

  return {
    ok: true,
    reason: "ok",
    waitMs: 0,
    fingerprint,
  };
}

function trafficRecordSend(threadID, fingerprint) {
  const now = trafficNow();
  const thread = String(threadID || "");

  trafficGlobalSendTimes.push(now);

  const threadTimes =
    trafficThreadSendTimes.get(thread) || [];

  threadTimes.push(now);
  trafficThreadSendTimes.set(thread, threadTimes);

  trafficRecentMessages.set(
    fingerprint || trafficFingerprint("", thread),
    now
  );

  trafficLastSendAt = now;
  trafficTotalSent++;
}

function trafficCleanup() {
  const now = trafficNow();

  trafficPruneTimes(
    trafficGlobalSendTimes,
    now
  );

  trafficPruneMap(
    trafficThreadSendTimes,
    now
  );

  trafficPruneMap(
    trafficUserCommandTimes,
    now
  );

  trafficPruneMap(
    trafficThreadCommandTimes,
    now
  );

  for (const [key, timestamp] of trafficRecentMessages.entries()) {
    if (
      now - timestamp >=
      TRAFFIC_GOVERNOR.duplicateWindowMs
    ) {
      trafficRecentMessages.delete(key);
    }
  }
}

function trafficSafetyStatus() {
  trafficCleanup();

  const now = trafficNow();
  const watchdog =
    typeof getWatchdogStatus === "function"
      ? getWatchdogStatus()
      : null;

  return {
    mode: trafficMode(),
    queue: trafficSendQueue.length,
    queueMax: TRAFFIC_GOVERNOR.queueMax,
    queuePercent: Math.round(
      (trafficSendQueue.length /
        TRAFFIC_GOVERNOR.queueMax) *
        100
    ),
    globalSendsLastMinute:
      trafficGlobalSendTimes.length,
    globalLimit:
      TRAFFIC_GOVERNOR.globalPerMinute,
    activeThreads:
      trafficThreadSendTimes.size,
    lastSendAgoMs:
      trafficLastSendAt
        ? now - trafficLastSendAt
        : null,
    effectiveGapMs:
      trafficEffectiveGapMs(),
    totalSent:
      trafficTotalSent,
    totalDelayed:
      trafficTotalDelayed,
    totalSuppressed:
      trafficTotalSuppressed,
    totalRejected:
      trafficTotalRejected,
    duplicateBlocked:
      trafficTotalDuplicateBlocked,
    commandBlocked:
      trafficTotalCommandBlocked,
    peakQueue:
      trafficPeakQueue,
    watchdogMode:
      watchdog?.mode || trafficMode(),
    timestamp:
      new Date().toISOString(),
  };
}

function trafficQueueSend(api, message, threadID, callback) {
  if (
    trafficSendQueue.length >=
    TRAFFIC_GOVERNOR.queueMax
  ) {
    trafficTotalRejected++;

    const error =
      new Error(
        "ECLIPSE traffic queue is full."
      );

    if (typeof callback === "function") {
      setImmediate(() => callback(error));
    }

    return false;
  }

  const rawApi =
    api && api.__eclipseTrafficRawApi
      ? api.__eclipseTrafficRawApi
      : api;

  trafficSendQueue.push({
    api: rawApi,
    message,
    threadID: String(threadID),
    callback,
    enqueuedAt: trafficNow(),
  });

  trafficPeakQueue = Math.max(
    trafficPeakQueue,
    trafficSendQueue.length
  );

  if (
    trafficSendQueue.length > 1
  ) {
    trafficTotalDelayed++;
  }

  trafficStartWorker();
  return true;
}

async function trafficProcessQueue() {
  if (trafficGovernorRunning) {
    return;
  }

  trafficGovernorRunning = true;

  try {
    while (trafficSendQueue.length) {
      const job =
        trafficSendQueue[0];

      const decision =
        trafficCanSendNow(
          job.threadID,
          job.message
        );

      if (!decision.ok) {
        trafficSendQueue.shift();

        if (decision.reason === "duplicate") {
          trafficTotalSuppressed++;
          if (typeof job.callback === "function") {
            const error =
              new Error(
                "Duplicate Messenger send suppressed by ECLIPSE Traffic Governor."
              );
            error.code = "ECLIPSE_DUPLICATE_SUPPRESSED";
            job.callback(error);
          }
          continue;
        }

        trafficSendQueue.unshift(job);

        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(
              Math.max(100, decision.waitMs),
              60_000
            )
          )
        );

        continue;
      }

      trafficSendQueue.shift();

      try {
        trafficRecordSend(
          job.threadID,
          decision.fingerprint
        );

        await new Promise((resolve) => {
          try {
            job.api.sendMessage(
              job.message,
              job.threadID,
              (error, messageInfo) => {
                if (typeof job.callback === "function") {
                  try {
                    job.callback(
                      error || null,
                      messageInfo || null
                    );
                  } catch (callbackError) {
                    console.error(
                      "[TRAFFIC] Messenger callback failed:",
                      callbackError
                    );
                  }
                }

                resolve();
              }
            );
          } catch (error) {
            if (typeof job.callback === "function") {
              try {
                job.callback(error);
              } catch (callbackError) {
                console.error(
                  "[TRAFFIC] Messenger callback failed:",
                  callbackError
                );
              }
            }

            resolve();
          }
        });
      } catch (error) {
        console.error(
          "[TRAFFIC] Send worker error:",
          error
        );
      }
    }
  } finally {
    trafficGovernorRunning = false;
  }
}

function trafficStartWorker() {
  if (trafficGovernorTimer) {
    return;
  }

  trafficGovernorTimer = setImmediate(() => {
    trafficGovernorTimer = null;
    trafficProcessQueue().catch((error) => {
      console.error(
        "[TRAFFIC] Queue worker failed:",
        error
      );
    });
  });
}

function installTrafficGovernor(api) {
  if (!api || typeof api.sendMessage !== "function") {
    return api || null;
  }

  if (api.__eclipseTrafficProxy === true) {
    trafficGovernorInstalled = true;
    return api;
  }

  const rawApi = api;

  const guardedApi = new Proxy(rawApi, {
    get(target, property) {
      if (property === "__eclipseTrafficProxy") {
        return true;
      }

      if (property === "__eclipseTrafficRawApi") {
        return rawApi;
      }

      if (property === "sendMessage") {
        return function guardedSendMessage(
          message,
          threadID,
          callback
        ) {
          return trafficQueueSend(
            rawApi,
            message,
            threadID,
            callback
          );
        };
      }

      const value = Reflect.get(target, property, target);

      if (typeof value === "function") {
        return value.bind(target);
      }

      return value;
    },
  });

  trafficGovernorInstalled = true;

  console.log(
    "[TRAFFIC] ECLIPSE VEIL Traffic Governor installed (proxy mode)."
  );

  return guardedApi;
}

function trafficSendMessage(api, message, threadID, callback) {
  return trafficQueueSend(api, message, threadID, callback);
}

const trafficCleanupTimer = setInterval(() => {
  trafficCleanup();
  if (trafficSendQueue.length) {
    trafficStartWorker();
  }
}, 15_000);

if (trafficCleanupTimer && typeof trafficCleanupTimer.unref === "function") {
  trafficCleanupTimer.unref();
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
//
// botDisabled / botPaused are persisted to a small local JSON
// file so a Render restart (crash, manual `!watchdog restart`)
// doesn't silently un-pause or re-enable the bot. This does NOT
// survive a fresh deploy (new container = new disk), only
// same-container restarts.
// ============================================================

const BOT_STATE_FILE = path.join(
  __dirname,
  ".eclipse-state.json"
);

function loadPersistedBotState() {
  try {
    const raw = fs.readFileSync(
      BOT_STATE_FILE,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    global.botDisabled =
      Boolean(parsed.botDisabled);

    global.botPaused =
      Boolean(parsed.botPaused);

    console.log(
      `[STATE] Restored persisted state: disabled=${global.botDisabled}, paused=${global.botPaused}`
    );
  } catch {
    if (
      typeof global.botDisabled !== "boolean"
    ) {
      global.botDisabled = false;
    }

    if (
      typeof global.botPaused !== "boolean"
    ) {
      global.botPaused = false;
    }
  }
}

function persistBotState() {
  try {
    fs.writeFileSync(
      BOT_STATE_FILE,
      JSON.stringify({
        botDisabled: global.botDisabled === true,
        botPaused: global.botPaused === true,
        savedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.error(
      "[STATE] Failed to persist bot state:",
      error
    );
  }
}

loadPersistedBotState();

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
// MESSENGER PROMISE WRAPPER
// ============================================================
//
// IMPORTANT:
// The callback's messageInfo is returned so music can capture
// the message ID and edit the original status message.
// ============================================================

function sendMessengerMessage(
  api,
  message,
  threadID
) {
  return new Promise((resolve, reject) => {
    try {
      trafficSendMessage(api, 
        message,
        threadID,
        (error, messageInfo) => {
          if (error) {
            reject(error);
          } else {
            resolve(
              messageInfo || null
            );
          }
        }
      );
    } catch (error) {
      reject(error);
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
// DATABASE HEALTH CHECK
// ============================================================
//
// Best-effort: db.js's exact shape isn't known here, so this
// tries the common patterns (a pg-style pool, or an explicit
// ping/healthCheck export) and falls back to "unknown" rather
// than guessing wrong. Tell me what db.js exports and I'll make
// this exact.
// ============================================================

async function checkDatabaseHealth() {
  try {
    if (
      db &&
      db.pool &&
      typeof db.pool.query === "function"
    ) {
      await db.pool.query("SELECT 1");
      return true;
    }

    if (
      db &&
      typeof db.ping === "function"
    ) {
      await db.ping();
      return true;
    }

    if (
      db &&
      typeof db.healthCheck === "function"
    ) {
      await db.healthCheck();
      return true;
    }

    return null; // unknown — db.js doesn't expose a health check
  } catch (error) {
    console.error(
      "[DB HEALTH] Check failed:",
      error
    );

    return false;
  }
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

app.get("/health", async (_req, res) => {
  const music =
    getMusicStats();

  const watchdog =
    getWatchdogStatus();

  const databaseHealthy =
    await checkDatabaseHealth();

  const healthOk =
    watchdog.ok &&
    databaseHealthy !== false;

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

    database:
      databaseHealthy,

    trafficGovernor: trafficSafetyStatus(),

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
//
// Wrapped in a retryable function with exponential backoff.
// A raw process.exit(1) on the first failure (the old behavior)
// combined with Render's auto-restart could produce a tight
// crash-restart loop against Facebook's login endpoint, which
// is exactly the kind of pattern that gets accounts flagged.
// Backoff caps at MAX_LOGIN_BACKOFF_MS between attempts.
// ============================================================

let loginAttempt = 0;
let listenFailureCount = 0;
let loginInProgress = false;
let listenerGeneration = 0;
let activeListenerGeneration = 0;
let startupSchedulersInitialized = false;
let loginRetryTimer = null;
let activeMessengerApi = null;

// Prevent accidentally attaching two MQTT listeners to the same
// Messenger API object during reconnect races.
const listenerStartedApis = new WeakSet();

const MAX_LOGIN_BACKOFF_MS = 5 * 60_000;
const MAX_LISTEN_RETRIES = 5;

function attemptLogin() {
  if (loginInProgress) {
    console.warn("[LOGIN] Login attempt already in progress; skipping duplicate attempt.");
    return;
  }

  loginInProgress = true;
  const thisGeneration = ++listenerGeneration;

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
      // A previous login callback can arrive after a newer login
      // attempt has already started. Never let that stale callback
      // change login state, schedule another retry, or attach a
      // second Messenger listener.
      if (thisGeneration !== listenerGeneration) {
        console.warn(
          `[LOGIN] Discarding stale login callback (generation ${thisGeneration}, current ${listenerGeneration}).`
        );
        return;
      }

      if (loginError || !api) {
        loginAttempt++;

        const backoffMs = Math.min(
          2 ** loginAttempt * 1000,
          MAX_LOGIN_BACKOFF_MS
        );

        console.error(
          `Login failed (attempt ${loginAttempt}). Retrying in ${backoffMs}ms.`,
          loginError || "No API object returned."
        );

        watchdogSetMessengerConnected(
          false
        );

        loginInProgress = false;

        if (loginRetryTimer) {
          clearTimeout(loginRetryTimer);
        }

        loginRetryTimer = setTimeout(() => {
          loginRetryTimer = null;
          attemptLogin();
        }, backoffMs);

        return;
      }

      loginAttempt = 0;
      listenFailureCount = 0;
      loginInProgress = false;

      if (loginRetryTimer) {
        clearTimeout(loginRetryTimer);
        loginRetryTimer = null;
      }

      activeListenerGeneration = thisGeneration;

      // This generation now owns message processing. Any older
      // listener callback will fail the generation check below.
      api = installTrafficGovernor(api) || api;
      activeMessengerApi = api;

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
      // LAST CHAMBER
      // Restores any open table after a restart.
      // ========================================================

      try {
        await initLastChamber(api);
      } catch (error) {
        console.error(
          "[chamber] init failed:",
          error
        );
      }

      // ========================================================
      // DEBATE
      // Restores open debate sessions after a restart.
      // ========================================================

      try {
        await initDebate(api);
      } catch (error) {
        console.error(
          "[debate] init failed:",
          error
        );
      }

      // ========================================================
      // CLEANUP
      // ========================================================

      try {
        if (!startupSchedulersInitialized) {
          startCleanupScheduler();
          startupSchedulersInitialized = true;

          console.log(
            "[CLEANUP] Cleanup scheduler started."
          );
        } else {
          console.log(
            "[CLEANUP] Cleanup scheduler already initialized; skipping duplicate start."
          );
        }
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
        trafficSendMessage(api, 
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

      const rawApiForListener =
        api && api.__eclipseTrafficRawApi
          ? api.__eclipseTrafficRawApi
          : api;

      if (
        rawApiForListener &&
        listenerStartedApis.has(rawApiForListener)
      ) {
        console.warn(
          "[LISTENER] Listener already attached to this Messenger API; skipping duplicate listener."
        );
        return;
      }

      if (rawApiForListener) {
        listenerStartedApis.add(rawApiForListener);
      }

      console.log(
        "Listener started."
      );

      api.listenMqtt(
        (
          listenError,
          event
        ) => {
          if (thisGeneration !== activeListenerGeneration) {
            return;
          }

          if (activeMessengerApi && activeMessengerApi !== api) {
            return;
          }

          if (listenError) {
            if (thisGeneration === activeListenerGeneration) {
              // Invalidate this listener immediately. Do not allow an
              // old socket to keep processing events while reconnecting.
              activeListenerGeneration = 0;
              activeMessengerApi = null;
            }

            watchdogSetMessengerConnected(
              false
            );

            listenFailureCount++;

            console.error(
              `Listener error (failure ${listenFailureCount}/${MAX_LISTEN_RETRIES}):`,
              listenError
            );

            if (
              listenFailureCount <=
              MAX_LISTEN_RETRIES
            ) {
              const backoffMs = Math.min(
                2 ** listenFailureCount * 1000,
                60_000
              );

              if (!loginRetryTimer) {
                console.error(
                  `[LISTENER] Attempting re-login in ${backoffMs}ms.`
                );

                loginRetryTimer = setTimeout(() => {
                  loginRetryTimer = null;
                  attemptLogin();
                }, backoffMs);
              } else {
                console.warn(
                  "[LISTENER] Re-login already scheduled; ignoring duplicate listener error."
                );
              }
            } else {
              console.error(
                "[LISTENER] Retry limit reached. Exiting so Render can restart cleanly."
              );

              process.exit(1);
            }

            return;
          }

          listenFailureCount = 0;

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

          if (!shouldProcessIncomingEvent(event)) {
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
}

attemptLogin();

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
  // TRAFFIC GOVERNOR — INCOMING COMMAND GUARD
  // ==========================================================

  if (
    originalText.startsWith("!") &&
    !trafficCanAcceptCommand(senderId, threadId)
  ) {
    // Intentionally do not send a warning here. Sending a warning
    // during a command storm would itself add more Messenger traffic.
    console.warn(
      `[TRAFFIC] Command suppressed for sender=${senderId} thread=${threadId}`
    );
    return;
  }

  // ==========================================================
  // OWNER CONSOLE / ECLIPSE VEIL
  // ==========================================================

  const ownerMatch =
    originalText.match(
      /^!owner(?:\s+(bot|automated|economy|rpg|music|moderation|system))?$/i
    );

  if (ownerMatch) {
    if (!isAdmin) {
      sendReplyWithTyping(
        api,
        "🔒 Owner access only.",
        threadId
      );
      return;
    }

    const section =
      (ownerMatch[1] || "home").toLowerCase();

    if (section === "automated") {
      const traffic = trafficSafetyStatus();
      const watchdog = getWatchdogStatus();

      sendReplyWithTyping(
        api,
        [
          "🪽 E C L I P S E 🪽",
          "T H E   V E I L",
          "",
          "♡ TRAFFIC PROTECTION",
          "────────────────────",
          "",
          "WATCHDOG",
          `  mode       · ${String(watchdog.mode || "normal").toUpperCase()}`,
          `  health     · ${watchdog.ok ? "🟢 HEALTHY" : "🔴 UNHEALTHY"}`,
          `  Messenger  · ${watchdog.messengerConnected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"}`,
          "",
          "TRAFFIC GOVERNOR",
          "────────────────────",
          `  global     · ${traffic.globalSendsLastMinute}/${traffic.globalLimit} / min`,
          `  queue      · ${traffic.queue}/${traffic.queueMax}`,
          `  sent       · ${traffic.totalSent}`,
          `  delayed    · ${traffic.totalDelayed}`,
          `  suppressed · ${traffic.totalSuppressed}`,
          `  duplicates · ${traffic.duplicateBlocked}`,
          `  blocked    · ${traffic.commandBlocked}`,
          "",
          "ACTIVE GUARDIANS",
          "  ● global limiter",
          "  ● thread limiter",
          "  ● command limiter",
          "  ● burst guard",
          "  ● duplicate guard",
          "  ● retry spacing",
          "  ● queue governor",
          "",
          "CONTROLS",
          "  !watchdog status",
          "  !watchdog stats",
          "  !watchdog test",
          "  !watchdog pause",
          "  !watchdog resume",
          "  !watchdog reset",
          "  !watchdog restart",
          "",
          "  !owner automated",
          "",
          "♡ protection layer online ♡",
        ].join("\n"),
        threadId
      );

      return;
    }

    if (section === "bot") {
      sendReplyWithTyping(
        api,
        [
          "╭────── ୨୧ E C L I P S E ୨୧ ──────╮",
          "│            O W N E R             │",
          "│               B O T              │",
          "╰──────────────────────────────────╯",
          "",
          "♡ !debug",
          "♡ !cleanup",
          "♡ !game",
          "♡ !economy",
          "♡ !mod",
          "♡ !automod",
          "♡ !rpg",
          "",
          "♡ use !owner <section>",
        ].join("\n"),
        threadId
      );
      return;
    }

    if (section !== "home") {
      sendReplyWithTyping(
        api,
        [
          `╭────── ୨୧ ${section.toUpperCase()} ୨୧ ──────╮`,
          "",
          "This owner section is reserved for",
          "the corresponding subsystem controls.",
          "",
          `♡ !owner ${section}`,
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadId
      );
      return;
    }

    sendReplyWithTyping(
      api,
      [
        "╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮",
        "┃                                    ┃",
        "┃          ୨୧ E C L I P S E ୨୧       ┃",
        "┃             O W N E R              ┃",
        "┃           C O N S O L E            ┃",
        "┃                                    ┃",
        "┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫",
        "┃  ◈ CORE                            ┃",
        "┃    !owner bot                      ┃",
        "┃                                    ┃",
        "┃  🪽 AUTOMATED BOT                  ┃",
        "┃    !owner automated                ┃",
        "┃                                    ┃",
        "┃  💗 ECONOMY                        ┃",
        "┃    !owner economy                  ┃",
        "┃                                    ┃",
        "┃  🌸 RPG                            ┃",
        "┃    !owner rpg                      ┃",
        "┃                                    ┃",
        "┃  🎀 MUSIC                          ┃",
        "┃    !owner music                    ┃",
        "┃                                    ┃",
        "┃  🛡 MODERATION                     ┃",
        "┃    !owner moderation               ┃",
        "┃                                    ┃",
        "┃  ⚙ SYSTEM                          ┃",
        "┃    !owner system                   ┃",
        "┃                                    ┃",
        "╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯",
        "             ୨୧ E C L I P S E ୨୧",
      ].join("\n"),
      threadId
    );

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

      persistBotState();

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

    persistBotState();

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

      persistBotState();

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

      persistBotState();

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
  // WATCHDOG CONTROL
  // ==========================================================

  const watchdogMatch =
    originalText.match(
      /^!watchdog(?:\s+(status|restart))?$/i
    );

  if (
    watchdogMatch
  ) {
    if (!isAdmin) {
      sendReplyWithTyping(
        api,
        [
          "╭────── 🎀  WATCHDOG  🎀 ──────╮",
          "",
          "🔒 ADMIN ONLY",
          "",
          "Only the bot admin can inspect",
          "or restart the watchdog.",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );

      return;
    }

    const watchdogCommand =
      (
        watchdogMatch[1] ||
        "status"
      ).toLowerCase();

    if (
      watchdogCommand ===
      "restart"
    ) {
      sendReplyWithTyping(
        api,
        [
          "╭────── 🎀  WATCHDOG  🎀 ──────╮",
          "",
          "🔴 MANUAL RESTART REQUESTED",
          "",
          "ECLIPSE will exit now.",
          "Render should automatically restart",
          "the service.",
          "",
          "♡ This is intentional.",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );

      setTimeout(
        () => {
          watchdogSetShuttingDown(
            true
          );

          watchdogSetMessengerConnected(
            false
          );

          stopWatchdog();

          process.exit(1);
        },
        1500
      );

      return;
    }

    const watchdog =
      getWatchdogStatus();

    const uptimeSeconds =
      Math.floor(
        process.uptime()
      );

    const uptimeMinutes =
      Math.floor(
        uptimeSeconds / 60
      );

    const uptimeHours =
      Math.floor(
        uptimeMinutes / 60
      );

    const displayMinutes =
      uptimeMinutes % 60;

    const displaySeconds =
      uptimeSeconds % 60;

    sendReplyWithTyping(
      api,
      [
        "╭────── 🎀  WATCHDOG STATUS  🎀 ──────╮",
        "",
        "୨୧ watchdog",
        `    ♡ ${
          watchdog.ok
            ? "🟢 HEALTHY"
            : "🔴 UNHEALTHY"
        }`,
        `    ♡ mode: ${String(watchdog.mode || "normal").toUpperCase()}`,
        "",
        "୨୧ process",
        "    ♡ 🟢 RUNNING",
        `    ♡ uptime: ${uptimeHours}h ${displayMinutes}m ${displaySeconds}s`,
        "",
        "୨୧ Messenger",
        `    ♡ ${
          watchdog.messengerConnected
            ? "🟢 CONNECTED"
            : "🔴 DISCONNECTED"
        }`,
        "",
        "୨୧ event loop",
        `    ♡ last tick: ${watchdog.eventLoopAgeMs}ms ago`,
        `    ♡ failures: ${watchdog.consecutiveFailures}`,
        "",
        "୨୧ watchdog",
        `    ♡ started: ${
          watchdog.started
            ? "YES"
            : "NO"
        }`,
        `    ♡ shutdown: ${
          watchdog.shuttingDown
            ? "YES"
            : "NO"
        }`,
        "",
        "୨୧ commands",
        "    ♡ !watchdog",
        "    ♡ !watchdog status",
        "    ♡ !watchdog restart",
        "",
        "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
      ].join("\n"),
      threadID
    );

    return;
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
        "♡ !games — open the full game panel",
        "♡ !trivia",
        "♡ !rps <choice>",
        "♡ !roll <amount>",
        "♡ !guess <number>",
        "♡ !coinflip <amount> <side>",
        "♡ !slots <amount>",
        "♡ !blackjack / !hit / !stand",
        "♡ !math / !riddle / !8ball",
        "♡ !exam — academic challenge",
        "♡ !case / !haunt / !incident",
        "♡ !heist / !trial / !lost",
        "♡ !investigator / !investigations",
        "◇ !simulation — COMING SOON",
        "♡ !debate — debate challenge + human admin judgment",
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
  // EXAM RESPONSE
  // !answer A/B/C/D
  // Must run before the normal game-response router.
  // ==========================================================

  if (/^!answer(?:\s|$)/i.test(originalText)) {
    try {
      if (
        await handleExamResponse(
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
        "[EXAM] Response handler failed:",
        error
      );

      await sendReplyWithTyping(
        api,
        "🎓 The exam system encountered an error. Please try again.",
        threadID
      );

      return;
    }
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
    // DEBATE COMMANDS
    // --------------------------------------------------------

    const debateMatch =
      text.match(
        /^!debate(?:\\s+(.*))?$/i
      );

    if (debateMatch) {
      const debateArgs = debateMatch[1]
        ? debateMatch[1].trim().split(/\\s+/)
        : [];

      try {
        if (
          await handleDebateCommand(
            api,
            event,
            "debate",
            debateArgs
          )
        ) {
          return;
        }
      } catch (error) {
        console.error(
          "[DEBATE] Command failed:",
          error
        );

        await sendReplyWithTyping(
          api,
          "🎀 The debate system encountered an error. Please try again.",
          threadID
        );

        return;
      }
    }

    // --------------------------------------------------------
    // EXAM COMMANDS
    // --------------------------------------------------------

    const examMatch =
      text.match(
        /^!exam(?:\s+(.*))?$/i
      );

    if (examMatch) {
      const examArgs = examMatch[1]
        ? examMatch[1].trim().split(/\s+/)
        : [];

      try {
        if (await handleExam(api, event, examArgs)) {
          return;
        }
      } catch (error) {
        console.error(
          "[EXAM] Command failed:",
          error
        );

        await sendReplyWithTyping(
          api,
          "🎓 The exam system encountered an error. Please try again.",
          threadID
        );

        return;
      }
    }

    // --------------------------------------------------------
    // INVESTIGATION COMMANDS
    // !case / !haunt / !incident / !heist / !trial / !lost
    // !investigator / !investigations
    // --------------------------------------------------------

    const investigationMatch =
      text.match(
        /^!(investigations?|investigator|case|haunt|incident|heist|trial|lost)(?:\s+(.*))?$/i
      );

    if (investigationMatch) {
      const investigationCommand =
        investigationMatch[1].toLowerCase();

      const investigationArgs = investigationMatch[2]
        ? investigationMatch[2].trim().split(/\s+/)
        : [];

      try {
        if (
          await handleInvestigationCommand(
            api,
            event,
            investigationCommand,
            investigationArgs
          )
        ) {
          return;
        }
      } catch (error) {
        console.error(
          "[INVESTIGATIONS] Command failed:",
          error
        );

        await sendReplyWithTyping(
          api,
          "🕵️ The investigation system encountered an error. Please try again.",
          threadID
        );

        return;
      }
    }

    // --------------------------------------------------------
    // GAME COMMANDS
    // --------------------------------------------------------

    const gameMatch =
      text.match(
        /^!(trivia|rps|roll|guess|coinflip|blackjack|hit|stand|double|split|surrender|slots|math|riddle|8ball|games|chamber|roulette|lastchamber)(?:\s+(.*))?$/i
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
      "🎀 E C L I P S E",
      "G A M E S",
      "",
      "♡ GAME CENTER",
      "────────────────────",
      "",
      "🎯 TRIVIA",
      "  !trivia",
      "",
      "✊ ROCK · PAPER · SCISSORS",
      "  !rps rock",
      "  !rps paper",
      "  !rps scissors",
      "",
      "🎲 ROLL",
      "  !roll 100",
      "",
      "🎯 GUESS",
      "  !guess 7",
      "",
      "🪙 COINFLIP",
      "  !coinflip 100 heads",
      "",
      "🎰 SLOTS",
      "  !slots 100",
      "",
      "🃏 BLACKJACK",
      "  !blackjack",
      "  !hit · !stand · !double · !split",
      "",
      "🧮 MATH",
      "  !math",
      "",
      "🧩 RIDDLE",
      "  !riddle",
      "",
      "🔮 8-BALL",
      "  !8ball <question>",
      "",
      "🎓 EXAM",
      "  !exam",
      "  !exam math · !exam science",
      "",
      "🕵️ INVESTIGATION",
      "  !case · !haunt · !incident",
      "  !heist · !trial · !lost",
      "  !investigator · !investigations",
      "",
      "🌌 COMING SOON",
      "  ◇ SIMULATION",
      "  ◇ DEBATE",
      "",
      "♡ !games rules",
      "♡ !games status",
      "",
      "୨୧ play · compete · explore ୨୧",
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
//
// pendingBroadcastTimers tracks each staggered setTimeout so
// gracefulShutdown can cancel outstanding ones. Without this, a
// large broadcast (many active threads) could still be firing
// send calls seconds after the process began tearing down.
// ============================================================

const pendingBroadcastTimers = new Set();

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
      const timer = setTimeout(
        () => {
          pendingBroadcastTimers.delete(timer);

          trafficSendMessage(api, 
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

      pendingBroadcastTimers.add(timer);
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

        trafficSendMessage(api, 
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

  for (const timer of pendingBroadcastTimers) {
    clearTimeout(timer);
  }

  pendingBroadcastTimers.clear();

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
