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

/*
 * Maximum number of thread IDs retained in memory
 * for broadcasting.
 */
const MAX_ACTIVE_THREADS = 1000;

/*
 * Threads older than this are removed from the
 * in-memory broadcast tracker.
 */
const ACTIVE_THREAD_EXPIRY_MS =
  30 * 24 * 60 * 60 * 1000;

const lastRandomRoastByThread = new Map();

/*
 * Map:
 *
 * threadID -> lastSeenTimestamp
 *
 * This replaces the old unbounded Set while
 * preserving broadcast functionality.
 */
const activeThreads = new Map();

// ============================================================
// MEMORY MONITOR
// ============================================================

setInterval(() => {
  const m = process.memoryUsage();

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
      )} MB`
  );
}, 60_000);

// ============================================================
// GLOBAL BOT STATE
// ============================================================

if (typeof global.botDisabled !== "boolean") {
  global.botDisabled = false;
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
// MESSENGER PROMISE WRAPPER
// ============================================================

function sendMessengerMessage(
  api,
  message,
  threadID
) {
  return new Promise((resolve, reject) => {
    try {
      api.sendMessage(
        message,
        threadID,
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================
// YOUTUBE AUDIO — ECLIPSE MUSIC PLAYER
// ============================================================

async function sendAudioTrack(
  api,
  requestedSong,
  threadID
) {
  if (
    typeof requestedSong !== "string" ||
    !requestedSong.trim()
  ) {
    sendReplyWithTyping(
      api,
      "🎵 Usage: !play <song>",
      threadID
    );

    return;
  }

  const cleanSong =
    requestedSong.trim();

  const temporaryFile = path.join(
    os.tmpdir(),
    `audio-${crypto.randomUUID()}.mp3`
  );

  try {
    await sendMessengerMessage(
      api,
      [
        "╭━━━━━━━━━━━━━━━━━━━━━━╮",
        "        🌑 ECLIPSE",
        "       MUSIC PLAYER",
        "╰━━━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "     🔎 SEARCHING...",
        `        ${cleanSong}`,
        "",
        "──────────────────────",
        "       ECLIPSE AUDIO",
        "          ENGINE",
        "──────────────────────",
      ].join("\n"),
      threadID
    );

    const video =
      await searchYouTube(
        cleanSong
      );

    if (
      !video ||
      !video.url
    ) {
      throw new Error(
        `No YouTube result found for "${cleanSong}".`
      );
    }

    const title =
      String(
        video.title || cleanSong
      ).trim();

    const author =
      String(
        video.author || ""
      ).trim();

    await sendMessengerMessage(
      api,
      [
        "╭━━━━━━━━━━━━━━━━━━━━━━╮",
        "        🌑 ECLIPSE",
        "       MUSIC PLAYER",
        "╰━━━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "     ⚙️ PROCESSING AUDIO",
        `        ${title}`,
        author
          ? `        ${author}`
          : "",
        "",
        "──────────────────────",
        "▶  PREPARING STREAM",
        "📡  YouTube",
        "──────────────────────",
      ]
        .filter(Boolean)
        .join("\n"),
      threadID
    );

    await downloadYouTubeAudio(
      video.url,
      temporaryFile
    );

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

    let duration =
      String(
        video.duration || ""
      ).trim();

    if (!duration) {
      duration = "--:--";
    }

    const playerMessage = [
      "╭━━━━━━━━━━━━━━━━━━━━━━╮",
      "        🌑 ECLIPSE",
      "       MUSIC PLAYER",
      "╰━━━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `     🎵 ${title}`,
      author
        ? `        ${author}`
        : "",
      "",
      "──────────────────────",
      "▶  STREAMING",
      `⏱  ${duration}     •     YouTube`,
      "",
      "──────────────────────",
      "       ECLIPSE AUDIO",
      "          ENGINE",
      "──────────────────────",
    ]
      .filter(Boolean)
      .join("\n");

    await sendMessengerMessage(
      api,
      {
        body: playerMessage,
        attachment:
          fs.createReadStream(
            temporaryFile
          ),
      },
      threadID
    );

    console.log(
      `[Music] Sent "${title}" to ${threadID}`
    );
  } catch (error) {
    console.error(
      "[Music] Audio command failed:",
      error
    );

    let errorMessage =
      error?.message ||
      String(error);

    if (
      errorMessage.length > 1000
    ) {
      errorMessage =
        errorMessage.slice(
          0,
          1000
        );
    }

    sendReplyWithTyping(
      api,
      [
        "╭━━━━━━━━━━━━━━━━━━━━━━╮",
        "        🌑 ECLIPSE",
        "       MUSIC PLAYER",
        "╰━━━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "🔴 PLAYBACK FAILED",
        "",
        errorMessage,
        "",
        "Try another song or search again.",
        "──────────────────────",
        "       ECLIPSE AUDIO",
        "          ENGINE",
        "──────────────────────",
      ].join("\n"),
      threadID
    );
  } finally {
    await fsp
      .unlink(temporaryFile)
      .catch(() => {});
  }
}

// ============================================================
// RENDER HEALTH-CHECK WEB SERVER
// ============================================================

const app = express();

app.get("/", (_req, res) => {
  res.status(200).send(
    "Bot is running ✅"
  );
});

const port = Number.parseInt(
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

const server = app.listen(
  port,
  "0.0.0.0",
  () => {
    console.log(
      `Web server listening on port ${port}`
    );
  }
);

server.on("error", (error) => {
  console.error(
    "Web server error:",
    error
  );

  process.exitCode = 1;
});

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
    parsed = JSON.parse(rawCookies);

    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
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

  return parsed.map((cookie) => {
    if (
      !cookie ||
      typeof cookie !== "object" ||
      Array.isArray(cookie)
    ) {
      throw new Error(
        "Each FB_COOKIES entry must be an object."
      );
    }

    const key =
      typeof cookie.key === "string"
        ? cookie.key
        : cookie.name;

    if (
      typeof key !== "string" ||
      !key.trim() ||
      typeof cookie.value !== "string"
    ) {
      throw new Error(
        "Every cookie must contain string name/key and value fields."
      );
    }

    return {
      ...cookie,
      key,
    };
  });
}

let appState;

try {
  appState = readAppState();
} catch (error) {
  console.error(
    `Configuration error: ${error.message}`
  );

  process.exit(1);
}

// ============================================================
// LOGIN TO FACEBOOK
// ============================================================

login(
  appState,
  {
    online: true,
    updatePresence: true,
    selfListen: false,
    randomUserAgent: false,
  },

  async (loginError, api) => {
    if (loginError) {
      console.error(
        "Login failed:",
        loginError
      );

      process.exit(1);
    }

    if (!api) {
      console.error(
        "Login failed: Facebook API object was not returned."
      );

      process.exit(1);
    }

    console.log(
      "Logged in successfully."
    );

    // ========================================================
    // DATABASE CONNECTION
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
    // AUTOMATIC CLEANUP
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
    // FACEBOOK LISTENER OPTIONS
    // ========================================================

    api.setOptions({
      listenEvents: true,
      selfListen: false,
    });

    const startupThreadID =
      process.env.STARTUP_THREAD_ID;

    if (startupThreadID) {
      api.sendMessage(
        "🟢 Bot is online and ready.",
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
      "Listener started. Send a message from a different Facebook account."
    );

    api.listenMqtt(
      (listenError, event) => {
        if (listenError) {
          console.error(
            "Listener error:",
            listenError
          );

          return;
        }

        if (
          !event ||
          typeof event !== "object"
        ) {
          return;
        }

        console.log(
          "Incoming event:",
          {
            type: event.type,
            senderID: event.senderID,
            threadID: event.threadID,
          }
        );

        if (
          (
            event.type === "message" ||
            event.type === "message_reply"
          ) &&
          event.threadID
        ) {
          const threadID =
            String(event.threadID);

          registerActiveThread(
            threadID
          );

          void registerGCActivity(
            threadID
          ).catch((error) => {
            console.error(
              "[GC ACTIVITY] Failed to register activity:",
              error
            );
          });

          console.log(
            `[Threads] Active threads tracked: ${activeThreads.size}`
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

  for (
    const [
      knownThreadID,
      lastSeenAt,
    ] of activeThreads.entries()
  ) {
    if (
      now - lastSeenAt >
      ACTIVE_THREAD_EXPIRY_MS
    ) {
      activeThreads.delete(
        knownThreadID
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
    typeof body !== "string" ||
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
    String(senderID || "").trim();

  // ============================================================
  // AI TRAINING / ADAPTATION
  // ============================================================

  try {
    const trainingHandled =
      await handleTrainingCommand(
        senderId,
        threadId,
        originalText
      );

    if (trainingHandled) {
      return;
    }

    if (
      !originalText.startsWith("!")
    ) {
      await observeMessage({
        senderID: senderId,
        threadID: threadId,
        body: originalText,
      });
    }
  } catch (error) {
    console.error(
      "[AI ADAPTATION] Training/observation failed:",
      error
    );
  }

  // ============================================================
  // ECLIPSE SYSTEM CONSOLE
  // ============================================================

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

  // ============================================================
  // ECLIPSE CLEANUP COMMANDS
  // ============================================================

  const cleanupMatch =
    originalText.match(
      /^!cleanup(?:\s+(status|run|repair|optimize|full))?$/i
    );

  if (cleanupMatch) {
    if (
      !ADMIN_IDS.includes(senderId)
    ) {
      return;
    }

    const cleanupCommand =
      (
        cleanupMatch[1] ||
        ""
      ).toLowerCase();

    // ----------------------------------------------------------
    // CLEANUP MENU
    // ----------------------------------------------------------

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

    // ----------------------------------------------------------
    // STATUS
    // ----------------------------------------------------------

    if (
      cleanupCommand === "status"
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
          "୨୧ maintenance",
          "    ♡ !cleanup run",
          "    ♡ !cleanup repair",
          "    ♡ !cleanup optimize",
          "    ♡ !cleanup full",
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

    // ----------------------------------------------------------
    // CLEANUP MODE
    // ----------------------------------------------------------

    const modeMap = {
      run: "clean",
      repair: "repair",
      optimize: "optimize",
      full: "full",
    };

    const mode =
      modeMap[cleanupCommand];

    if (!mode) {
      return;
    }

    try {
      const result =
        await runCleanup({
          mode,
        });

      if (result?.skipped) {
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
            ?.temporaryFiles || 0
        );

      const expiredSessions =
        Number(
          result?.cleaned
            ?.expiredSessions || 0
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
          ? result.optimizer.findings
          : [];

      const optimizerCount =
        optimizerFindings.length;

      const optimizerDetails =
        optimizerCount > 0
          ? [
              "",
              "୨୧ optimizer findings",
              ...optimizerFindings.map(
                (finding, index) => {
                  if (
                    typeof finding === "string"
                  ) {
                    return `    ♡ ${index + 1}. ${finding}`;
                  }

                  if (
                    finding &&
                    typeof finding === "object"
                  ) {
                    const file =
                      finding.file ||
                      finding.path ||
                      finding.filePath ||
                      "Unknown file";

                    const line =
                      finding.line != null
                        ? `:${finding.line}`
                        : "";

                    const message =
                      finding.message ||
                      finding.issue ||
                      finding.reason ||
                      finding.description ||
                      JSON.stringify(finding);

                    return `    ♡ ${index + 1}. ${file}${line} — ${message}`;
                  }

                  return `    ♡ ${index + 1}. ${String(finding)}`;
                }
              ),
            ]
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
          `୨୧ mode`,
          `    ♡ ${mode.toUpperCase()}`,
          "",
          "୨୧ cleaned",
          `    ♡ temporary files: ${temporaryFiles}`,
          `    ♡ expired sessions: ${expiredSessions}`,
          `    ♡ repairs: ${repairs}`,
          `    ♡ optimizer findings: ${optimizerCount}`,
          ...optimizerDetails,
          "",
          "୨୧ gc maintenance",
          `    ♡ inactive: ${Number(
            gc.markedInactive || 0
          )}`,
          `    ♡ features disabled: ${Number(
            gc.expensiveFeaturesDisabled || 0
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

  // ============================================================
  // ECLIPSE GC MONITOR
  // ============================================================

  if (
    /^!gcstatus$/i.test(
      originalText
    )
  ) {
    if (
      !ADMIN_IDS.includes(senderId)
    ) {
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

  // ============================================================
  // GLOBAL BOT CONTROL
  // ============================================================

  const botControlMatch =
    originalText.match(
      /^!(bot(?:\s+(off|on|status))?|shutdown|startup)$/i
    );

  if (botControlMatch) {
    if (
      !ADMIN_IDS.includes(senderId)
    ) {
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
        botControlMatch[1] || "bot"
      ).toLowerCase();

    // ----------------------------------------------------------
    // BOT MENU
    // ----------------------------------------------------------

    if (
      rawControl === "bot"
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
          "୨୧ communication",
          "    ♡ !broadcast <message>",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );

      return;
    }

    // ----------------------------------------------------------
    // STATUS
    // ----------------------------------------------------------

    if (
      rawControl === "bot status"
    ) {
      sendReplyWithTyping(
        api,
        [
          "╭────── 🎀  BOT STATUS  🎀 ──────╮",
          "",
          `୨୧ global status`,
          `    ♡ ${
            global.botDisabled
              ? "🔴 OFF"
              : "🟢 ON"
          }`,
          "",
          `୨୧ normal commands`,
          `    ♡ ${
            global.botDisabled
              ? "🔴 DISABLED"
              : "🟢 ACTIVE"
          }`,
          "",
          "୨୧ controls",
          "    ♡ !bot on",
          "    ♡ !bot off",
          "    ♡ !shutdown",
          "    ♡ !startup",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );

      return;
    }

    // ----------------------------------------------------------
    // OFF
    // ----------------------------------------------------------

    if (
      rawControl === "bot off" ||
      rawControl === "shutdown"
    ) {
      global.botDisabled = true;

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
          "Normal commands will now be",
          "ignored across all groups.",
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

    // ----------------------------------------------------------
    // ON
    // ----------------------------------------------------------

    if (
      rawControl === "bot on" ||
      rawControl === "startup"
    ) {
      global.botDisabled = false;

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
          "Normal commands are active",
          "again across all groups.",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );

      return;
    }
  }

  // ============================================================
  // GLOBAL BOT DISABLED STATE
  // ============================================================

  if (
    global.botDisabled === true
  ) {
    const trimmedText =
      originalText.trim();

    const isAdmin =
      ADMIN_IDS.includes(senderId);

    const isBotMenu =
      /^!bot$/i.test(
        trimmedText
      );

    const isBotStatus =
      /^!bot\s+status$/i.test(
        trimmedText
      );

    const isBotOn =
      /^!bot\s+on$/i.test(
        trimmedText
      );

    const isBotOff =
      /^!bot\s+off$/i.test(
        trimmedText
      );

    const isStartup =
      /^!startup$/i.test(
        trimmedText
      );

    const isShutdown =
      /^!shutdown$/i.test(
        trimmedText
      );

    const isGameToggle =
      /^!game\s+(on|off)$/i.test(
        trimmedText
      );

    if (
      isAdmin &&
      (
        isBotMenu ||
        isBotStatus ||
        isBotOn ||
        isBotOff ||
        isStartup ||
        isShutdown
      )
    ) {
      return;
    }

    if (
      isAdmin &&
      isGameToggle
    ) {
      // Allow admins to configure games
      // while the general bot is disabled.
    } else if (
      /^!(?:game|games|play)\b/i.test(
        trimmedText
      )
    ) {
      let gamesEnabled = false;

      try {
        gamesEnabled =
          await db.isGameEnabled(
            threadID
          );
      } catch (error) {
        console.error(
          "[SHUTDOWN] Failed to check game state:",
          error
        );

        return;
      }

      if (!gamesEnabled) {
        return;
      }
    } else {
      return;
    }
  }

  // ============================================================
  // SIMPLE DIRECT COMMANDS
  // ============================================================

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

  // ============================================================
  // PUBLIC HELP
  // ============================================================

  if (
    text === "!help"
  ) {
    sendReplyWithTyping(
      api,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "          🌑 ECLIPSE",
        "        PUBLIC MENU",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "⚡ GENERAL",
        "• !ping",
        "  Check if the bot is online.",
        "",
        "• !help",
        "  Show this public command menu.",
        "",
        "🎵 MUSIC",
        "• !play <song>",
        "  Search YouTube and send the audio.",
        "  Example: !play Die With A Smile",
        "",
        "🖼️ PICTURES",
        "• !pic",
        "  Send a random picture.",
        "",
        "• !picture",
        "  Send a random picture.",
        "",
        "• !photo",
        "  Send a random picture.",
        "",
        "🌑 ECLIPSE RPG",
        "• !rpg help",
        "  Open the persistent RPG system.",
        "",
        "• !rpg profile",
        "  View your character and progression.",
        "",
        "• !rpg kingdom",
        "  View your kingdom and domain.",
        "",
        "• !rpg property",
        "  Manage your property.",
        "",
        "• !rpg train <unit> <amount>",
        "  Train troops using your wallet.",
        "",
        "• !rpg march <region>",
        "  Travel through the world map.",
        "",
        "💰 ECONOMY",
        "• !balance / !bal",
        "  Check your coins.",
        "",
        "• !daily",
        "  Claim your daily reward.",
        "",
        "• !work",
        "  Work for coins.",
        "",
        "• !pay <amount>",
        "  Pay someone by replying to them.",
        "",
        "• !leaderboard / !lb",
        "  View the richest players.",
        "",
        "• !shop",
        "  View available items.",
        "",
        "• !buy <item>",
        "  Purchase an item.",
        "",
        "• !inventory / !inv",
        "  View your items.",
        "",
        "🎮 GAMES",
        "• !games",
        "  Open the ECLIPSE Game Center.",
        "",
        "• !games rules",
        "  View detailed game rules.",
        "",
        "• !games status",
        "  View your game status.",
        "",
        "🧠 !trivia",
        "  Answer the generated question.",
        "",
        "✊ !rps <rock|paper|scissors>",
        "  Play Rock, Paper, Scissors.",
        "",
        "🎲 !roll <amount>",
        "  Roll the generated range.",
        "",
        "🎯 !guess <number>",
        "  Guess the secret number.",
        "",
        "🪙 !coinflip <amount> <heads|tails>",
        "  Bet on heads or tails.",
        "",
        "🎰 !slots <amount>",
        "  Spin the slot machine.",
        "",
        "🃏 !blackjack",
        "  Start Blackjack.",
        "  Use !hit or !stand.",
        "",
        "🧮 !math",
        "  Solve the generated problem.",
        "",
        "🧩 !riddle",
        "  Solve the generated riddle.",
        "",
        "🔮 !8ball <question>",
        "  Ask the Magic 8-Ball.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "🌑 Explore ECLIPSE RPG",
        "   to discover more systems.",
        "━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
      threadID
    );

    return;
  }

  // ============================================================
  // MUSIC
  // ============================================================

  if (
    text === "!play" ||
    text.startsWith("!play ")
  ) {
    const requestedSong =
      originalText
        .slice("!play".length)
        .trim();

    void sendAudioTrack(
      api,
      requestedSong,
      threadID
    );

    return;
  }

  // ============================================================
  // RANDOM PICTURE
  // ============================================================

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

  // ============================================================
  // BROADCAST
  // ============================================================

  if (
    text.startsWith("!broadcast ")
  ) {
    if (
      !ADMIN_IDS.includes(senderId)
    ) {
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
        .slice("!broadcast ".length)
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
          "Example:",
          "    ♡ !broadcast Server maintenance tonight.",
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
        `୨୧ active threads`,
        `    ♡ ${targetCount}`,
        "",
        "୨୧ status",
        "    ♡ 🟢 queued",
        "",
        "The announcement has been",
        "queued for active threads.",
        "",
        "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
      ].join("\n"),
      threadID
    );

    return;
  }

  // ============================================================
  // MODERATION
  // ============================================================

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

  // ============================================================
  // AI
  // ============================================================

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

  // ============================================================
  // RPG CHARACTER AI
  // ============================================================

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

  // ============================================================
  // GAME RESPONSE
  // ============================================================

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

  // ============================================================
  // RPG / LOVE QUEST / GAMES / ECONOMY
  // ============================================================

  try {
    // ==========================================================
    // RPG
    // ==========================================================

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

      // ========================================================
      // LOVE QUEST
      // ========================================================

      if (
        isSpecialPlayer(senderId)
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

      // ========================================================
      // RPG EXPLORE
      // ========================================================

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
          isSpecialPlayer(senderId)
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

    // ==========================================================
    // GAME CONTROL
    // ==========================================================

    const gameControlMatch =
      text.match(
        /^!game(?:\s+(on|off|status))?$/i
      );

    if (gameControlMatch) {
      if (
        !ADMIN_IDS.includes(senderId)
      ) {
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

      // --------------------------------------------------------
      // GAME MENU
      // --------------------------------------------------------

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
            "[GAME] Failed to check game status:",
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

      // --------------------------------------------------------
      // GAME STATUS
      // --------------------------------------------------------

      if (
        gameSubcommand === "status"
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
              "୨୧ game center",
              "    ♡ !games",
              "    ♡ !games rules",
              "    ♡ !games status",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );
        } catch (error) {
          console.error(
            "[game status] Error:",
            error
          );

          sendReplyWithTyping(
            api,
            [
              "╭────── 🎀  GAME STATUS  🎀 ──────╮",
              "",
              "🔴 STATUS CHECK FAILED",
              "",
              "Unable to read the game setting.",
              "",
              "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
            ].join("\n"),
            threadID
          );
        }

        return;
      }

      // --------------------------------------------------------
      // GAME ON/OFF
      // --------------------------------------------------------

      const enabled =
        gameSubcommand === "on";

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
            enabled
              ? "Players can now use the game system."
              : "Players can no longer start normal games.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );
      } catch (error) {
        console.error(
          "[game toggle] Error:",
          error
        );

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  GAME CONTROL  🎀 ──────╮",
            "",
            "🔴 UPDATE FAILED",
            "",
            "Failed to change the game setting.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );
      }

      return;
    }

    // ==========================================================
    // GAME COMMANDS
    // ==========================================================

    const gameMatch =
      text.match(
        /^!(trivia|rps|roll|guess|coinflip|blackjack|hit|stand|double|split|surrender|slots|math|riddle|8ball|games)(?:\s+(.*))?$/i
      );

    if (gameMatch) {
      const gameCommand =
        gameMatch[1].toLowerCase();

      const gameArgs =
        gameMatch[2]
          ? gameMatch[2]
              .trim()
              .split(/\s+/)
          : [];

      if (
        gameCommand === "games"
      ) {
        const subcommand =
          (
            gameArgs[0] || ""
          ).toLowerCase();

        const handled =
          await handleGamesCommand(
            api,
            event,
            gameCommand,
            gameArgs
          );

        if (handled) {
          return;
        }

        if (
          subcommand === "" ||
          subcommand === "menu"
        ) {
          sendGameCenter(
            api,
            threadID
          );

          return;
        }

        return;
      }

      const gamesEnabled =
        await db.isGameEnabled(
          threadID
        );

      if (!gamesEnabled) {
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

    // ==========================================================
    // ECONOMY
    // ==========================================================

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

  // ============================================================
  // BANAT CONTROL
  // ============================================================

  const banatControlMatch =
    text.match(
      /^!banat(?:\s+(on|off|status))?$/i
    );

  if (banatControlMatch) {
    if (
      !ADMIN_IDS.includes(senderId)
    ) {
      sendReplyWithTyping(
        api,
        [
          "╭────── 🎀  BANAT CONTROL  🎀 ──────╮",
          "",
          "🔒 ADMIN ONLY",
          "",
          "Only the bot admin can configure",
          "banat.",
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

    // ----------------------------------------------------------
    // BANAT MENU
    // ----------------------------------------------------------

    if (!banatSubcommand) {
      let enabled =
        false;

      try {
        enabled =
          await db.isRoastEnabled(
            threadId
          );
      } catch (error) {
        console.error(
          "[BANAT] Failed to check roast status:",
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
          "    ♡ !banat status",
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

    // ----------------------------------------------------------
    // BANAT STATUS
    // ----------------------------------------------------------

    if (
      banatSubcommand === "status"
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
          "[BANAT] Status check failed:",
          error
        );

        sendReplyWithTyping(
          api,
          [
            "╭────── 🎀  BANAT STATUS  🎀 ──────╮",
            "",
            "🔴 STATUS CHECK FAILED",
            "",
            "Unable to read the banat setting.",
            "",
            "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
          ].join("\n"),
          threadID
        );
      }

      return;
    }

    // ----------------------------------------------------------
    // BANAT ON/OFF
    // ----------------------------------------------------------

    const enabled =
      banatSubcommand === "on";

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
          enabled
            ? "Automatic banat has been enabled."
            : "Automatic banat has been disabled.",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );
    } catch (error) {
      console.error(
        enabled
          ? "Failed to enable banat:"
          : "Failed to disable banat:",
        error
      );

      sendReplyWithTyping(
        api,
        [
          "╭────── 🎀  BANAT CONTROL  🎀 ──────╮",
          "",
          "🔴 UPDATE FAILED",
          "",
          "Failed to update the banat setting.",
          "",
          "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯",
        ].join("\n"),
        threadID
      );
    }

    return;
  }

  // ============================================================
  // BANAT STATUS
  // ============================================================

  let roastEnabled = false;

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

    roastEnabled = false;
  }

  // ============================================================
  // TARGETED TRIGGER / ROAST
  // ============================================================

  if (roastEnabled) {
    try {
      const triggerReply =
        await getTriggerReply(
          body,
          senderId,
          threadId
        );

      if (triggerReply) {
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

  // ============================================================
  // PUBLIC RANDOM ROAST
  // ============================================================

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

    if (publicReply) {
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
// GAME CENTER FALLBACK
// ============================================================

function sendGameCenter(
  api,
  threadID
) {
  sendReplyWithTyping(
    api,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "          🌑 ECLIPSE",
      "        GAME CENTER",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🧠 TRIVIA",
      "!trivia",
      "Answer the generated question.",
      "",
      "✊ ROCK • PAPER • SCISSORS",
      "!rps rock",
      "!rps paper",
      "!rps scissors",
      "",
      "🎲 ROLL",
      "!roll 100",
      "",
      "🎯 GUESS",
      "!guess 7",
      "",
      "🪙 COINFLIP",
      "!coinflip 100 heads",
      "",
      "🎰 SLOTS",
      "!slots 100",
      "",
      "🃏 BLACKJACK",
      "!blackjack",
      "!hit",
      "!stand",
      "",
      "🧮 MATH",
      "!math",
      "",
      "🧩 RIDDLE",
      "!riddle",
      "",
      "🔮 8-BALL",
      "!8ball Will I win?",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━",
      "📜 !games rules",
      "📊 !games status",
      "━━━━━━━━━━━━━━━━━━━━━━",
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
      "[Broadcast] No message to broadcast."
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

  const broadcastMessage = [
    "╭━━━━━━━━━━━━━━━━╮",
    "        📢 ANNOUNCEMENT",
    "╰━━━━━━━━━━━━━━━━╯",
    "",
    message.trim(),
  ].join("\n");

  threads.forEach(
    (threadID, index) => {
      setTimeout(() => {
        api.sendMessage(
          broadcastMessage,
          threadID,
          (sendError) => {
            if (sendError) {
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
      }, index * 500);
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
// SAFE REPLY HELPER
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
          if (typingError) {
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

  setTimeout(() => {
    try {
      const memePath =
        attachMeme
          ? getRandomMemePath()
          : null;

      const outgoingMessage =
        memePath
          ? {
              body: message,
              attachment:
                fs.createReadStream(
                  memePath
                ),
            }
          : message;

      api.sendMessage(
        outgoingMessage,
        threadID,
        (sendError) => {
          if (sendError) {
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
  }, typingDelayMs);
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
                .extname(fileName)
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
