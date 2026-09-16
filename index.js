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
  observeMessage
} = require("./ai/adaptation");

// ============================================================
// PICTURES
// ============================================================
// General pictures are stored in:
//
// pictures/
//
// IMPORTANT:
// This is completely separate from:
//
// memes/
//
// The memes/ folder remains exclusively for roast attachments.
// ============================================================

const {
  sendRandomPicture,
} = require("./pictures");

const {
  handleRpgCharacterMessage,
} = require("./rpg/character-ai");

/*
 * ============================================================
 * SECRET LOVE QUEST
 * ============================================================
 * THE LAST STAR is handled by rpg/love-quest.js.
 *
 * It is NOT a separate RPG system.
 *
 * Normal RPG remains responsible for:
 * !rpg profile
 * !rpg explore
 * !rpg army
 * !rpg kingdom
 * !rpg property
 * etc.
 *
 * Love Quest only handles:
 * !rpg laststar
 * !rpg laststar follow
 * !rpg laststar continue
 * !rpg laststar read
 * !rpg laststar choose ...
 * etc.
 *
 * Discovery is triggered AFTER normal !rpg explore.
 * ============================================================
 */

const {
  isSpecialPlayer,
  discover: discoverLoveQuest,
  handleLoveQuestCommand,
} = require("./rpg/love-quest");

const { handleAiMessage } = require("./ai");

// MODERATION
const {
  handleModerationMessage,
} = require("./moderation");

const {
  searchYouTube,
  downloadYouTubeAudio,
} = require("./youtube");

const {
  getTriggerReply,
  getNextPublicReply,
} = require("./triggers");

// —————————————————————————
// Configuration
// —————————————————————————

const YOUTUBE_SEARCH_TIMEOUT_MS = 30_000;
const YOUTUBE_DOWNLOAD_TIMEOUT_MS = 180_000;

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

const lastRandomRoastByThread = new Map();
const activeThreads = new Set();

// ===============================
// MEMORY MONITOR
// ===============================

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

// —————————————————————————
// Global bot state
// —————————————————————————

if (typeof global.botDisabled !== "boolean") {
  global.botDisabled = false;
}

// —————————————————————————
// Timeout helper
// —————————————————————————

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
        reject(new Error(timeoutMessage));
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

// —————————————————————————
// Messenger Promise wrapper
// —————————————————————————

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

// —————————————————————————
// YouTube audio
// —————————————————————————

async function sendAudioTrack(
  api,
  requestedSong,
  threadID
) {
  if (
    typeof requestedSong !== "string" ||
    !requestedSong.trim()
  ) {
    api.sendMessage(
      "🎵 Usage: !play <song>",
      threadID,
      (error) => {
        if (error) {
          console.error(
            "Usage message failed:",
            error
          );
        }
      }
    );

    return;
  }

  const temporaryFile = path.join(
    os.tmpdir(),
    `audio-${crypto.randomUUID()}.mp3`
  );

  try {
    api.sendMessage(
      "🔎 Searching for the song...",
      threadID,
      (error) => {
        if (error) {
          console.error(
            "Search status message failed:",
            error
          );
        }
      }
    );

    const video = await withTimeout(
      () => searchYouTube(requestedSong),
      YOUTUBE_SEARCH_TIMEOUT_MS,
      "YouTube search timed out after 30 seconds. Please try again."
    );

    if (!video || !video.url) {
      throw new Error(
        `No YouTube result found for "${requestedSong}".`
      );
    }

    await withTimeout(
      () =>
        downloadYouTubeAudio(
          video.url,
          temporaryFile
        ),
      YOUTUBE_DOWNLOAD_TIMEOUT_MS,
      "YouTube download timed out after 3 minutes. Please try again."
    );

    const fileInfo = await fsp.stat(
      temporaryFile
    );

    if (
      !fileInfo.isFile() ||
      fileInfo.size === 0
    ) {
      throw new Error(
        "The downloaded audio file is empty."
      );
    }

    await sendMessengerMessage(
      api,
      {
        body: `🎵 ${
          video.title || requestedSong
        }`,
        attachment:
          fs.createReadStream(
            temporaryFile
          ),
      },
      threadID
    );
  } catch (error) {
    console.error(
      "Audio command failed:",
      error
    );

    api.sendMessage(
      [
        "❌ Unable to download that song.",
        error.message,
      ].join("\n"),
      threadID,
      (sendError) => {
        if (sendError) {
          console.error(
            "Audio error message failed:",
            sendError
          );
        }
      }
    );
  } finally {
    await fsp
      .unlink(temporaryFile)
      .catch(() => {});
  }
}

// —————————————————————————
// Render health-check web server
// —————————————————————————

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

// —————————————————————————
// Facebook cookies
// —————————————————————————

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

// —————————————————————————
// Login to Facebook
// —————————————————————————

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

          activeThreads.add(threadID);

          console.log(
            `[Threads] Active threads: ${activeThreads.size}`
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

// —————————————————————————
// Message handling
// —————————————————————————

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

  await observeMessage({
    senderID: senderId,
    threadID: threadId,
    body: originalText,
  });
} catch (error) {
  console.error(
    "[AI ADAPTATION] Training/observation failed:",
    error
  );
}
  
  // ———————————————————————
  // GLOBAL BOT CONTROL
  // ———————————————————————

  if (
    /^!(shutdown|startup)$/i.test(
      originalText
    )
  ) {
    if (
      !ADMIN_IDS.includes(senderId)
    ) {
      sendReplyWithTyping(
        api,
        "❌ Only the bot admin can use this command.",
        threadID
      );

      return;
    }

    const controlCommand =
      originalText
        .slice(1)
        .toLowerCase();

    if (
      controlCommand === "shutdown"
    ) {
      global.botDisabled = true;

      sendReplyWithTyping(
        api,
        "🛑 Bot shutdown enabled. The bot is now OFF in all groups.",
        threadID
      );

      return;
    }

    if (
      controlCommand === "startup"
    ) {
      global.botDisabled = false;

      sendReplyWithTyping(
        api,
        "🟢 Bot startup enabled. The bot is now ON.",
        threadID
      );

      return;
    }
  }

  // ============================================================
  // GLOBAL BOT DISABLED STATE
  // ============================================================

  if (global.botDisabled === true) {
    const trimmedText =
      originalText.trim();

    const isAdmin =
      ADMIN_IDS.includes(senderId);

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
      (isStartup || isShutdown)
    ) {
      // Continue.
    }

    else if (
      isAdmin &&
      isGameToggle
    ) {
      // Continue.
    }

    else if (
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
    }

    else {
      return;
    }
  }

  // ———————————————————————
  // SIMPLE DIRECT COMMANDS
  // ———————————————————————

  if (text === "!ping") {
    sendReplyWithTyping(
      api,
      "🏓 Pong!",
      threadID
    );

    return;
  }

  // ———————————————————————
  // PUBLIC HELP
  // ———————————————————————

  if (text === "!help") {
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

  // ———————————————————————
  // MUSIC
  // ———————————————————————

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
  // IMPORTANT:
  // This uses pictures.js -> pictures/
  //
  // It NEVER calls getRandomMemePath().
  //
  // Therefore your existing memes/ roast folder cannot be
  // selected by !pic.
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

  // ———————————————————————
  // BROADCAST
  // ———————————————————————

  if (
    text.startsWith("!broadcast ")
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

    const message =
      originalText
        .slice("!broadcast ".length)
        .trim();

    if (!message) {
      sendReplyWithTyping(
        api,
        "📢 Usage: !broadcast <message>",
        threadID
      );

      return;
    }

    broadcastToAllThreads(
      api,
      message
    );

    sendReplyWithTyping(
      api,
      `📢 Broadcast queued for ${activeThreads.size} active thread(s).`,
      threadID
    );

    return;
  }

  // ------------------------------------------------------------
  // EVERYTHING BELOW THIS POINT REMAINS YOUR EXISTING CODE
  // ------------------------------------------------------------

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

  try {
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

    const gameToggleMatch =
      text.match(
        /^!game\s+(on|off)$/i
      );

    if (gameToggleMatch) {
      if (
        !ADMIN_IDS.includes(senderId)
      ) {
        sendReplyWithTyping(
          api,
          "❌ Only the bot admin can turn games on or off.",
          threadID
        );

        return;
      }

      const enabled =
        gameToggleMatch[1]
          .toLowerCase() === "on";

      try {
        await db.setGameEnabled(
          threadID,
          enabled
        );

        sendReplyWithTyping(
          api,
          enabled
            ? "🎮 Games are now ON in this group."
            : "🎮 Games are now OFF in this group.",
          threadID
        );
      } catch (error) {
        console.error(
          "[game toggle] Error:",
          error
        );

        sendReplyWithTyping(
          api,
          "❌ Failed to change the game setting.",
          threadID
        );
      }

      return;
    }

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

        if (
          subcommand === "rules" ||
          subcommand === "status"
        ) {
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
        }

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

      if (!gamesEnabled) {
        sendReplyWithTyping(
          api,
          [
            "🎮 Games are currently OFF in this group.",
            "",
            "An admin can enable them with !game on.",
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

if (
  text === "!banat on" ||
  text === "!banat off"
) {
  if (
    !ADMIN_IDS.includes(senderId)
  ) {
    sendReplyWithTyping(
      api,
      "❌ Only the bot admin can turn banat on or off.",
      threadID
    );

    return;
  }

  const enabled =
    text === "!banat on";

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
        "╭━━━━━━━━━━━━━━╮",
        "      🔥 BANAT",
        "╰━━━━━━━━━━━━━━╯",
        "",
        enabled
          ? "🟢 Status: ON"
          : "🔴 Status: OFF",
        "",
        enabled
          ? "Automatic banat has been enabled for this group."
          : "Automatic banat has been disabled for this group.",
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
      "❌ Failed to update banat setting.",
      threadID
    );
  }

  return;
}


// -------------------------------------------------------------------------
// BANAT STATUS
// -------------------------------------------------------------------------

let roastEnabled = false;

try {
  roastEnabled =
    await db.isRoastEnabled(threadId);
} catch (error) {
  console.error(
    "[BANAT] Failed to check roast status:",
    error
  );

  roastEnabled = false;
}


// -------------------------------------------------------------------------
// TARGETED TRIGGER / ROAST
// ONLY RUN WHEN BANAT IS ON
// -------------------------------------------------------------------------

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

  
// -------------------------------------------------------------------------
// PUBLIC RANDOM ROAST
// ONLY RUN WHEN BANAT IS ON
// -------------------------------------------------------------------------

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
  
// —————————————————————————
// Game Center fallback
// —————————————————————————

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

// —————————————————————————
// Random roast cooldown
// —————————————————————————

function canRandomRoastThread(
  threadID
) {
  const now = Date.now();

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
        now - roastAt > expiry
      ) {
        lastRandomRoastByThread.delete(
          knownThreadID
        );
      }
    }
  }

  return true;
}

// —————————————————————————
// Broadcast
// —————————————————————————

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

  const threads =
    Array.from(activeThreads);

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

// —————————————————————————
// Safe reply helper
// —————————————————————————

function sendReplyWithTyping(
  api,
  message,
  threadID,
  attachMeme = false
) {
  const typingDelayMs = 1200;

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

// —————————————————————————
// Meme helper
// —————————————————————————

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
