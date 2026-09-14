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
const { handleRpgCharacterMessage } = require("./rpg/character-ai");
const { handleAiMessage } = require("./ai");

const {
  searchYouTube,
  downloadYouTubeAudio,
} = require("./youtube");

const {
  getTriggerReply,
  getNextPublicReply,
} = require("./triggers");


// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const YOUTUBE_SEARCH_TIMEOUT_MS = 30_000;
const YOUTUBE_DOWNLOAD_TIMEOUT_MS = 180_000;

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const RANDOM_ROAST_ENABLED = !/^(0|false|no|off)$/i.test(
  process.env.RANDOM_ROAST || ""
);

const parsedCooldown = Number(
  process.env.RANDOM_ROAST_COOLDOWN_MS || "30000"
);

const RANDOM_ROAST_COOLDOWN_MS =
  Number.isFinite(parsedCooldown) && parsedCooldown >= 0
    ? parsedCooldown
    : 30_000;

const lastRandomRoastByThread = new Map();
const activeThreads = new Set();


// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout(operation, timeoutMs, timeoutMessage) {
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


// ---------------------------------------------------------------------------
// Messenger Promise wrapper
// ---------------------------------------------------------------------------

function sendMessengerMessage(api, message, threadID) {
  return new Promise((resolve, reject) => {
    try {
      api.sendMessage(message, threadID, (error) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}


// ---------------------------------------------------------------------------
// YouTube audio
// ---------------------------------------------------------------------------

async function sendAudioTrack(api, requestedSong, threadID) {
  if (typeof requestedSong !== "string" || !requestedSong.trim()) {
    api.sendMessage(
      "🎵 Usage: !play <song name>",
      threadID,
      (error) => {
        if (error) console.error("Usage message failed:", error);
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
        if (error) console.error("Search status message failed:", error);
      }
    );

    const video = await withTimeout(
      () => searchYouTube(requestedSong),
      YOUTUBE_SEARCH_TIMEOUT_MS,
      "YouTube search timed out after 30 seconds. Please try again."
    );

    if (!video || !video.url) {
      throw new Error(`No YouTube result found for "${requestedSong}".`);
    }

    await withTimeout(
      () => downloadYouTubeAudio(video.url, temporaryFile),
      YOUTUBE_DOWNLOAD_TIMEOUT_MS,
      "YouTube download timed out after 3 minutes. Please try again."
    );

    const fileInfo = await fsp.stat(temporaryFile);

    if (!fileInfo.isFile() || fileInfo.size === 0) {
      throw new Error("The downloaded audio file is empty.");
    }

    await sendMessengerMessage(
      api,
      {
        body: `🎵 ${video.title || requestedSong}`,
        attachment: fs.createReadStream(temporaryFile),
      },
      threadID
    );
  } catch (error) {
    console.error("Audio command failed:", error);

    api.sendMessage(
      `❌ Unable to download that song.\n${error.message}`,
      threadID,
      (sendError) => {
        if (sendError) console.error("Audio error message failed:", sendError);
      }
    );
  } finally {
    await fsp.unlink(temporaryFile).catch(() => {});
  }
}


// ---------------------------------------------------------------------------
// Render health-check web server
// ---------------------------------------------------------------------------

const app = express();

app.get("/", (_req, res) => {
  res.status(200).send("Bot is running ✅");
});

const port = Number.parseInt(process.env.PORT || "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Web server listening on port ${port}`);
});

server.on("error", (error) => {
  console.error("Web server error:", error);
  process.exitCode = 1;
});


// ---------------------------------------------------------------------------
// Facebook cookies
// ---------------------------------------------------------------------------

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
  } catch {
    throw new Error("FB_COOKIES must contain valid JSON.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("FB_COOKIES must be a non-empty cookie array.");
  }

  return parsed.map((cookie) => {
    if (
      !cookie ||
      typeof cookie !== "object" ||
      Array.isArray(cookie)
    ) {
      throw new Error("Each FB_COOKIES entry must be an object.");
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
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}


// ---------------------------------------------------------------------------
// Login to Facebook
// ---------------------------------------------------------------------------

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
      console.error("Login failed:", loginError);
      process.exit(1);
    }

    if (!api) {
      console.error("Login failed: Facebook API object was not returned.");
      process.exit(1);
    }

    console.log("Logged in successfully.");

    try {
      await db.connect();
      console.log("Neon database connected successfully.");
    } catch (error) {
      console.error("Database connection failed:", error);
      process.exit(1);
    }

    api.setOptions({
      listenEvents: true,
      selfListen: false,
    });

    const startupThreadID = process.env.STARTUP_THREAD_ID;

    if (startupThreadID) {
      api.sendMessage(
        "🟢 Bot is online and ready.",
        startupThreadID,
        (sendError) => {
          if (sendError) console.error("Startup message failed:", sendError);
        }
      );
    }

    console.log(
      "Listener started. Send a message from a different Facebook account."
    );

    api.listenMqtt((listenError, event) => {
      if (listenError) {
        console.error("Listener error:", listenError);
        return;
      }

      if (!event || typeof event !== "object") return;

      console.log("Incoming event:", {
        type: event.type,
        senderID: event.senderID,
        threadID: event.threadID,
      });

      if (
        (event.type === "message" || event.type === "message_reply") &&
        event.threadID
      ) {
        const threadID = String(event.threadID);
        activeThreads.add(threadID);

        console.log(`[Threads] Active threads: ${activeThreads.size}`);

        void handleMessage(api, event);
      }
    });
  }
);


// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handleMessage(api, event) {
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

  const threadId = String(threadID);
  const originalText = body.trim();
  const text = originalText.toLowerCase();
  const senderId = String(senderID || "").trim();

  // -------------------------------------------------------------------------
  // GLOBAL BOT CONTROL — !shutdown / !startup
  // -------------------------------------------------------------------------

  if (/^!(shutdown|startup)$/i.test(originalText)) {
    if (!ADMIN_IDS.includes(senderId)) {
      sendReplyWithTyping(
        api,
        "❌ Only the bot admin can use this command.",
        threadID
      );
      return;
    }

    const controlCommand =
      originalText.slice(1).toLowerCase();

    if (controlCommand === "shutdown") {
      global.botDisabled = true;

      sendReplyWithTyping(
        api,
        "🛑 Bot shutdown enabled. The bot is now OFF in all groups.",
        threadID
      );
      return;
    }

    if (controlCommand === "startup") {
      global.botDisabled = false;

      sendReplyWithTyping(
        api,
        "🟢 Bot startup enabled. The bot is now ON.",
        threadID
      );
      return;
    }
  }

  if (global.botDisabled === true) {
    return;
  }


  // -------------------------------------------------------------------------
  // SIMPLE DIRECT COMMANDS
  //
  // These are intentionally FIRST.
  // This prevents AI/RPG/game/economy handlers from swallowing !ping,
  // !help, !play, or !broadcast when one of those handlers errors.
  // -------------------------------------------------------------------------

  if (text === "!ping") {
    sendReplyWithTyping(api, "🏓 Pong!", threadID);
    return;
  }

  if (text === "!help") {
    sendReplyWithTyping(
      api,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🤖 BOT MENU",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "⚡ GENERAL",
        "• !ping",
        "  Check if the bot is online.",
        "",
        "• !help",
        "  Show this command menu.",
        "",
        "🎵 MUSIC",
        "• !play <song>",
        "  Search YouTube and send the audio.",
        "  Example: !play Die With A Smile",
        "",
        "🌑 ECLIPSE RPG",
        "• !rpg help",
        "  Open the persistent character, kingdom, and army system.",
        "• !rpg profile / !rpg kingdom",
        "  View your ruler and domain.",
        "• !rpg property buy cottage",
        "  Start expanding your domain.",
        "• !rpg train infantry 10",
        "  Train troops using your wallet.",
        "• !rpg march ironspine",
        "  Travel by map distance with no global time cap.",
        "",
        "🎭 LUCIEN AI",
        "• !lucien",
        "  Start Lucien for Alaiza only.",
        "• !lucien reset / !lucien off",
        "  Reset history or end the private session.",
        "",
        "🔥 BANAT",
        "• !banat on",
        "  Turn automatic banat ON.",
        "",
        "• !banat off",
        "  Turn automatic banat OFF.",
        "",
        "💰 ECONOMY",
        "• !balance / !bal",
        "  Check your coins.",
        "",
        "• !daily",
        "  Claim your daily coins.",
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
        "  Open the full Game Center + rules.",
        "",
        "• !game on",
        "  Enable games in this group.",
        "",
        "• !game off",
        "  Disable games in this group.",
        "",
        "🧠 !trivia",
        "  Answer A, B, C, or D.",
        "  Correct answers earn coins.",
        "",
        "✊ !rps <choice> [bet]",
        "  Rock, Paper, Scissors.",
        "  Win = 2× • Tie = refund.",
        "",
        "🎲 !roll <bet>",
        "  Roll a d100.",
        "  55+ wins 2×.",
        "",
        "🎯 !guess <1-10> [bet]",
        "  Guess the secret number.",
        "  Exact guess = 5×.",
        "",
        "🪙 !coinflip <bet> <heads/tails>",
        "  Pick heads or tails.",
        "  Correct = 2×.",
        "",
        "🎰 !slots <bet>",
        "  Spin the slot machine.",
        "  Matching symbols pay out.",
        "",
        "🃏 !blackjack <bet>",
        "  Play against the dealer.",
        "  Use !hit or !stand.",
        "",
        "🔮 !8ball <question>",
        "  Ask the Magic 8-Ball.",
        "",
        "👑 ADMIN",
        "• !broadcast <text>",
        "  Send a message to active threads.",
        "  Admin only.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "💡 Type !games for detailed",
        "   game rules and payouts.",
        "━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
      threadID
    );
    return;
  }

  if (text === "!play" || text.startsWith("!play ")) {
    const requestedSong = originalText.slice("!play".length).trim();

    void sendAudioTrack(api, requestedSong, threadID);
    return;
  }

  if (text.startsWith("!broadcast ")) {
    if (!ADMIN_IDS.includes(senderId)) {
      sendReplyWithTyping(api, "❌ Admin only.", threadID);
      return;
    }

    const message = originalText.slice("!broadcast ".length).trim();

    if (!message) {
      sendReplyWithTyping(
        api,
        "📢 Usage: !broadcast <message>",
        threadID
      );
      return;
    }

    broadcastToAllThreads(api, message);
    sendReplyWithTyping(
      api,
      `📢 Broadcast queued for ${activeThreads.size} active thread(s).`,
      threadID
    );
    return;
  }


  // -------------------------------------------------------------------------
  // AI / RPG CHARACTER SESSIONS
  // -------------------------------------------------------------------------

  try {
    if (await handleAiMessage(api, event, text, originalText)) {
      return;
    }
  } catch (error) {
    console.error("AI message handler failed:", error);
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
    console.error("RPG character handler failed:", error);
  }


  // -------------------------------------------------------------------------
  // ACTIVE GAME RESPONSES
  // -------------------------------------------------------------------------

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
    console.error("Game response failed:", error);
  }


  // -------------------------------------------------------------------------
  // RPG / GAMES / ECONOMY COMMANDS
  // -------------------------------------------------------------------------

  if (/^!rpg(?:\s|$)/i.test(originalText)) {
  if (
    await handleRpgCommand(
      api,
      event,
      text,
      originalText
    )
  ) {
    return;
  }
}
  
    // -----------------------------------------------------------------------
    // GAME TOGGLE — !game on / !game off
    // -----------------------------------------------------------------------

    const gameToggleMatch = text.match(
      /^!game\s+(on|off)$/i
    );

    if (gameToggleMatch) {
      if (!ADMIN_IDS.includes(senderId)) {
        sendReplyWithTyping(
          api,
          "❌ Only the bot admin can turn games on or off.",
          threadID
        );
        return;
      }

      const enabled =
        gameToggleMatch[1].toLowerCase() === "on";

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

    const gameMatch = text.match(
      /^!(trivia|rps|roll|guess|coinflip|blackjack|hit|stand|double|split|surrender|slots|math|riddle|8ball|games)(?:\s+(.*))?$/i
    );

    if (gameMatch) {
      const gameCommand = gameMatch[1].toLowerCase();

      // !games is handled here so it cannot become "Unknown game".
      if (gameCommand === "games") {
        sendGameCenter(api, threadID);
        return;
      }

      // All actual games respect the persistent per-group game switch.
      const gamesEnabled =
        await db.isGameEnabled(threadID);

      if (!gamesEnabled) {
        sendReplyWithTyping(
          api,
          "🎮 Games are currently OFF in this group.\n\nAn admin can enable them with !game on.",
          threadID
        );
        return;
      }

      const gameArgs = gameMatch[2]
        ? gameMatch[2].trim().split(/\s+/)
        : [];

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

    // Do NOT return here.
    // A failed optional handler must not prevent the fallback systems
    // below from running.
  }


  // -------------------------------------------------------------------------
  // BANAT ON
  // -------------------------------------------------------------------------

  if (text === "!banat on") {
    try {
      await db.setRoastEnabled(threadId, true);

      sendReplyWithTyping(
        api,
        [
          "╭━━━━━━━━━━━━━━╮",
          "      🔥 BANAT",
          "╰━━━━━━━━━━━━━━╯",
          "",
          "🟢 Status: ON",
          "",
          "Automatic banat has been",
          "enabled for this group.",
        ].join("\n"),
        threadID
      );
    } catch (error) {
      console.error("Failed to enable banat:", error);

      sendReplyWithTyping(
        api,
        "❌ Failed to update banat setting.",
        threadID
      );
    }

    return;
  }


  // -------------------------------------------------------------------------
  // BANAT OFF
  // -------------------------------------------------------------------------

  if (text === "!banat off") {
    try {
      await db.setRoastEnabled(threadId, false);

      lastRandomRoastByThread.delete(threadId);

      sendReplyWithTyping(
        api,
        [
          "╭━━━━━━━━━━━━━━╮",
          "      🛑 BANAT",
          "╰━━━━━━━━━━━━━━╯",
          "",
          "🔴 Status: OFF",
          "",
          "Automatic banat has been",
          "disabled for this group.",
        ].join("\n"),
        threadID
      );
    } catch (error) {
      console.error("Failed to disable banat:", error);

      sendReplyWithTyping(
        api,
        "❌ Failed to update banat setting.",
        threadID
      );
    }

    return;
  }


  // -------------------------------------------------------------------------
  // TARGETED TRIGGER / ROAST
  // -------------------------------------------------------------------------

  try {
    const triggerReply = await getTriggerReply(
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
    console.error("Trigger system failed:", error);
  }


  // -------------------------------------------------------------------------
  // PUBLIC RANDOM ROAST
  // -------------------------------------------------------------------------

  if (!RANDOM_ROAST_ENABLED) {
    return;
  }

  try {
    const roastEnabled = await db.isRoastEnabled(threadId);

    if (!roastEnabled) {
      return;
    }
  } catch (error) {
    console.error("Could not check roast setting:", error);
    return;
  }

  if (canRandomRoastThread(threadId)) {
    const publicReply = getNextPublicReply();

    if (publicReply) {
      lastRandomRoastByThread.set(threadId, Date.now());

      sendReplyWithTyping(
        api,
        publicReply,
        threadID,
        true
      );
    }
  }
}


// ---------------------------------------------------------------------------
// Game Center
// ---------------------------------------------------------------------------

function sendGameCenter(api, threadID) {
  sendReplyWithTyping(
    api,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🎮 GAME CENTER",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🧠 TRIVIA",
      "!trivia",
      "Answer A, B, C, or D.",
      "",
      "✊ RPS",
      "!rps rock 100",
      "!rps paper 100",
      "!rps scissors 100",
      "Win = 2× • Tie = refund.",
      "",
      "🎲 ROLL",
      "!roll 100",
      "55+ wins 2×.",
      "",
      "🎯 GUESS",
      "!guess 7 100",
      "Exact guess = 5×.",
      "",
      "🪙 COINFLIP",
      "!coinflip 100 heads",
      "Correct = 2×.",
      "",
      "🎰 SLOTS",
      "!slots 100",
      "Matching symbols pay out.",
      "",
      "🃏 BLACKJACK",
      "!blackjack 100",
      "Then use !hit / !stand.",
      "",
      "🔮 8-BALL",
      "!8ball Will I win?",
      "",
      "🧮 MATH",
      "!math",
      "Solve the generated problem.",
      "",
      "🧩 RIDDLE",
      "!riddle",
      "Solve the generated riddle.",
      "",
      "⚙️ GAME SWITCH",
      "!game on",
      "!game off",
      "",
      "💡 Type !help for the complete bot menu.",
    ].join("\n"),
    threadID
  );
}


// ---------------------------------------------------------------------------
// Random roast cooldown
// ---------------------------------------------------------------------------

function canRandomRoastThread(threadID) {
  const now = Date.now();

  const lastRoastAt =
    lastRandomRoastByThread.get(threadID) || 0;

  if (now - lastRoastAt < RANDOM_ROAST_COOLDOWN_MS) {
    return false;
  }

  if (lastRandomRoastByThread.size > 1000) {
    const expiry = Math.max(
      RANDOM_ROAST_COOLDOWN_MS * 2,
      60_000
    );

    for (
      const [knownThreadID, roastAt] of lastRandomRoastByThread.entries()
    ) {
      if (now - roastAt > expiry) {
        lastRandomRoastByThread.delete(knownThreadID);
      }
    }
  }

  return true;
}


// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

function broadcastToAllThreads(api, message) {
  if (!message || !message.trim()) {
    console.log("[Broadcast] No message to broadcast.");
    return;
  }

  const threads = Array.from(activeThreads);

  if (threads.length === 0) {
    console.log("[Broadcast] No active threads.");
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

  threads.forEach((threadID, index) => {
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
            console.log(`[Broadcast] Sent to ${threadID}`);
          }
        }
      );
    }, index * 500);
  });
}


// ---------------------------------------------------------------------------
// Safe reply helper
// ---------------------------------------------------------------------------

function sendReplyWithTyping(
  api,
  message,
  threadID,
  attachMeme = false
) {
  const typingDelayMs = 1200;

  try {
    if (typeof api.sendTypingIndicator === "function") {
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
    console.error("Typing indicator error:", typingError);
  }

  setTimeout(() => {
    try {
      const memePath = attachMeme ? getRandomMemePath() : null;

      const outgoingMessage = memePath
        ? {
            body: message,
            attachment: fs.createReadStream(memePath),
          }
        : message;

      api.sendMessage(
        outgoingMessage,
        threadID,
        (sendError) => {
          if (sendError) {
            console.error("Reply failed:", sendError);
          }
        }
      );
    } catch (sendError) {
      console.error("Reply error:", sendError);
    }
  }, typingDelayMs);
}


// ---------------------------------------------------------------------------
// Meme helper
// ---------------------------------------------------------------------------

function getRandomMemePath() {
  const memeDirectory = path.join(__dirname, "memes");

  const supportedExtensions = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
  ]);

  try {
    if (!fs.existsSync(memeDirectory)) {
      return null;
    }

    const files = fs
      .readdirSync(memeDirectory)
      .filter((fileName) =>
        supportedExtensions.has(
          path.extname(fileName).toLowerCase()
        )
      );

    if (files.length === 0) {
      return null;
    }

    const randomFile =
      files[Math.floor(Math.random() * files.length)];

    return path.join(memeDirectory, randomFile);
  } catch (error) {
    console.error("Could not load memes:", error);
    return null;
  }
}
