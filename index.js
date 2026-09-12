const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { login } = require("ws3-fca");

const db = require("./db");

const { handleEconomyCommand } = require("./economy");
const { handleGamesCommand } = require("./games");

const {
  searchYouTube,
  downloadYouTubeAudio,
} = require("./youtube");

const {
  getTriggerReply,
  getNextPublicReply,
} = require("./triggers");

const {
  searchJamendo,
  downloadAudioToFile,
} = require("./jamendo");

const {
  getRizz,
  getAura,
  getIQ,
  getSimp,
  getClown,
} = require("./funcommands");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const YOUTUBE_SEARCH_TIMEOUT_MS = 30_000;
const YOUTUBE_DOWNLOAD_TIMEOUT_MS = 180_000;

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// This controls whether the automatic public-roast system is enabled
// globally through the environment variable.
//
// IMPORTANT:
// This is separate from the per-thread !banat on/off setting stored in Neon.
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

// Temporary in-memory cooldown tracking.
// This is NOT used to store whether banat is enabled.
// Banat settings are stored permanently in Neon.
const lastRandomRoastByThread = new Map();

// Threads seen while the bot is running.
// Used by !broadcast.
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
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ---------------------------------------------------------------------------
// YouTube audio
// ---------------------------------------------------------------------------

/**
 * Searches YouTube, downloads the audio, sends it to Messenger,
 * and removes the temporary file afterward.
 */
async function sendAudioTrack(api, requestedSong, threadID) {
  if (
    typeof requestedSong !== "string" ||
    !requestedSong.trim()
  ) {
    api.sendMessage(
      "Usage: !play <song name>",
      threadID,
      (error) => {
        if (error) {
          console.error("Usage message failed:", error);
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
      "YouTube download timed out after 3 minutes. The host may be blocked by YouTube; please try again."
    );

    const fileInfo = await fsp.stat(temporaryFile);

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
        body: `🎵 ${video.title || requestedSong}`,
        attachment: fs.createReadStream(
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
      `❌ Unable to download that song.\n${error.message}`,
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
      .catch(() => {
        // File may not have been created.
      });
  }
}

// ---------------------------------------------------------------------------
// Render health-check web server
// ---------------------------------------------------------------------------

const app = express();

app.get("/", (_req, res) => {
  res.status(200).send("Bot is running ✅");
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

// ---------------------------------------------------------------------------
// Facebook cookies
// ---------------------------------------------------------------------------

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

    // Supports JSON encoded JSON string.
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

    // -----------------------------------------------------------------------
    // Connect Neon BEFORE starting the Messenger listener.
    // -----------------------------------------------------------------------

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

      // The bot now depends on Neon for persistent economy,
      // games, and thread settings, so don't start half-working.
      process.exit(1);
    }

    // -----------------------------------------------------------------------
    // Facebook API options
    // -----------------------------------------------------------------------

    api.setOptions({
      listenEvents: true,
      selfListen: false,
    });

    // -----------------------------------------------------------------------
    // Optional startup message
    // -----------------------------------------------------------------------

    const startupThreadID =
      process.env.STARTUP_THREAD_ID;

    if (startupThreadID) {
      api.sendMessage(
        "Bot is online ✅",
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

    // -----------------------------------------------------------------------
    // Messenger event listener
    // -----------------------------------------------------------------------

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

        if (event.threadID) {
          const threadID =
            String(event.threadID);

          activeThreads.add(threadID);

          console.log(
            `[Threads] Active threads: ${activeThreads.size}`
          );
        }

        if (
          event.type === "message" ||
          event.type === "message_reply"
        ) {
          // handleMessage is async.
          // We intentionally don't await it here because
          // the Messenger listener callback itself is synchronous.
          void handleMessage(
            api,
            event
          );
        }
      }
    );
  }
);

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Economy + games FIRST
  // -------------------------------------------------------------------------
  //
  // These need to be awaited and returned properly.
  // This prevents commands such as !blackjack, !hit,
  // trivia answers, etc. from continuing into the roast system.
  // -------------------------------------------------------------------------

  try {
    if (
      await handleGamesCommand(
        api,
        event,
        text,
        originalText
      )
    ) {
      return;
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
      "Economy/games command failed:",
      error
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Ping
  // -------------------------------------------------------------------------

  if (text === "!ping") {
    sendReplyWithTyping(
      api,
      "pong 🏓",
      threadID
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Help
  // -------------------------------------------------------------------------

  if (text === "!help") {
    sendReplyWithTyping(
      api,
      [
        "Commands:",
        "!ping - health check",
        "!help - this message",
        "!play <song> - send an audio track",
        "!rizz <name> - random rizz meter",
        "!aura <name> - random aura points",
        "!iq <name> - random IQ score",
        "!simp <name> - random simp meter",
        "!clown <name> - random clown meter",
        "!broadcast <text> - admin only",
        "",
        "Banat:",
        "!banat on - enable banat",
        "!banat off - disable banat",
        "",
        "Economy:",
        "!balance / !daily / !work / !pay / !leaderboard",
        "!shop / !buy <item> / !inventory",
        "",
        "Games:",
        "!games",
        "!game on / !game off",
        "!trivia / !rps / !roll / !guess",
        "!coinflip / !slots / !blackjack / !8ball",
      ].join("\n"),
      threadID
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Banat / roast toggle
  // -------------------------------------------------------------------------

  if (text === "!banat on") {
    try {
      await db.setRoastEnabled(
        threadId,
        true
      );

      sendReplyWithTyping(
        api,
        "🔥 Banat is now ON for this group.",
        threadID
      );
    } catch (error) {
      console.error(
        "Failed to enable banat:",
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

  if (text === "!banat off") {
    try {
      await db.setRoastEnabled(
        threadId,
        false
      );

      // Clear the temporary cooldown too.
      lastRandomRoastByThread.delete(
        threadId
      );

      sendReplyWithTyping(
        api,
        "🛑 Banat is now OFF for this group.",
        threadID
      );
    } catch (error) {
      console.error(
        "Failed to disable banat:",
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
  // Play
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Rizz
  // -------------------------------------------------------------------------

  if (
    text === "!rizz" ||
    text.startsWith("!rizz ")
  ) {
    const name =
      originalText
        .slice("!rizz".length)
        .trim() || "You";

    sendReplyWithTyping(
      api,
      getRizz(name).text,
      threadID
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Aura
  // -------------------------------------------------------------------------

  if (
    text === "!aura" ||
    text.startsWith("!aura ")
  ) {
    const name =
      originalText
        .slice("!aura".length)
        .trim() || "You";

    sendReplyWithTyping(
      api,
      getAura(name).text,
      threadID
    );

    return;
  }

  // -------------------------------------------------------------------------
  // IQ
  // -------------------------------------------------------------------------

  if (
    text === "!iq" ||
    text.startsWith("!iq ")
  ) {
    const name =
      originalText
        .slice("!iq".length)
        .trim() || "You";

    sendReplyWithTyping(
      api,
      getIQ(name).text,
      threadID
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Simp
  // -------------------------------------------------------------------------

  if (
    text === "!simp" ||
    text.startsWith("!simp ")
  ) {
    const name =
      originalText
        .slice("!simp".length)
        .trim() || "You";

    sendReplyWithTyping(
      api,
      getSimp(name).text,
      threadID
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Clown
  // -------------------------------------------------------------------------

  if (
    text === "!clown" ||
    text.startsWith("!clown ")
  ) {
    const name =
      originalText
        .slice("!clown".length)
        .trim() || "You";

    sendReplyWithTyping(
      api,
      getClown(name).text,
      threadID
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Broadcast
  // -------------------------------------------------------------------------

  if (
    text.startsWith("!broadcast ") &&
    ADMIN_IDS.includes(senderId)
  ) {
    const message =
      originalText
        .slice("!broadcast ".length)
        .trim();

    broadcastToAllThreads(
      api,
      message
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Targeted trigger / roast
  // -------------------------------------------------------------------------
  //
  // getTriggerReply must be async because it checks the
  // persistent roast_enabled setting in Neon.
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Public roast
  // -------------------------------------------------------------------------
  //
  // This checks BOTH:
  //
  // 1. RANDOM_ROAST environment setting
  // 2. Per-thread roast_enabled setting in Neon
  //
  // Therefore:
  //
  // !banat off
  //
  // actually disables all automatic roast behavior in that group.
  // -------------------------------------------------------------------------

  if (!RANDOM_ROAST_ENABLED) {
    return;
  }

  try {
    const roastEnabled =
      await db.isRoastEnabled(
        threadId
      );

    if (!roastEnabled) {
      return;
    }
  } catch (error) {
    console.error(
      "Could not check roast setting:",
      error
    );

    // Fail closed.
    // If we cannot determine whether banat is enabled,
    // don't send an automatic roast.
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

// ---------------------------------------------------------------------------
// Random roast cooldown
// ---------------------------------------------------------------------------

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

  // Prevent unlimited memory growth.
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

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

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

  if (threads.length === 0) {
    console.log(
      "[Broadcast] No active threads."
    );

    return;
  }

  console.log(
    `[Broadcast] Broadcasting to ${threads.length} threads.`
  );

  const broadcastMessage =
    `📢 ${message.trim()}`;

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

// ---------------------------------------------------------------------------
// Meme helper
// ---------------------------------------------------------------------------

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
        .filter((fileName) =>
          supportedExtensions.has(
            path.extname(
              fileName
            ).toLowerCase()
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
