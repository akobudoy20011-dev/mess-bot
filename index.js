const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const {
  searchYouTube,
  downloadYouTubeAudio,
} = require("./youtube");

const {
  getTriggerReply,
  getRandomRoastReply,
} = require("./triggers");

const {
  searchJamendo,
  downloadAudioToFile,
} = require("./jamendo");
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
          console.error("Search status message failed:", error);
        }
      }
    );

    const video = await searchYouTube(requestedSong);

    if (!video || !video.url) {
      throw new Error(
        `No YouTube result found for "${requestedSong}".`
      );
    }

    await downloadYouTubeAudio(video.url, temporaryFile);

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
        if (sendError) {
          console.error("Audio error message failed:", sendError);
        }
      }
    );
  } finally {
    await fsp.unlink(temporaryFile).catch(() => {
      // The file may not have been created.
    });
  }
}

/**
 * Converts ws3-fca's callback-based sendMessage API into a Promise.
 */
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
// Load Facebook cookies from FB_COOKIES
// ---------------------------------------------------------------------------

function readAppState() {
  const rawCookies = process.env.FB_COOKIES;

  if (typeof rawCookies !== "string" || !rawCookies.trim()) {
    throw new Error("FB_COOKIES is missing.");
  }

  let parsed;

  try {
    parsed = JSON.parse(rawCookies);

    // Supports an environment variable containing a JSON-encoded JSON string.
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
  } catch (error) {
    throw new Error(
      "FB_COOKIES must contain a valid JSON array of Facebook cookie objects."
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "FB_COOKIES parsed successfully, but it is not a valid cookie array."
    );
  }

  const invalidCookie = parsed.find((cookie) => {
    if (
      !cookie ||
      typeof cookie !== "object" ||
      Array.isArray(cookie)
    ) {
      return true;
    }

    const cookieName =
      typeof cookie.key === "string"
        ? cookie.key
        : cookie.name;

    return (
      typeof cookieName !== "string" ||
      !cookieName.trim() ||
      typeof cookie.value !== "string"
    );
  });

  if (invalidCookie) {
    throw new Error(
      "Every FB_COOKIES entry must contain string name/key and value fields."
    );
  }

  // ws3-fca expects the cookie name in the `key` property.
  return parsed.map((cookie) => ({
    ...cookie,
    key:
      typeof cookie.key === "string"
        ? cookie.key
        : cookie.name,
  }));
}

let appState;

try {
  appState = readAppState();
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const RANDOM_ROAST_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.RANDOM_ROAST || ""
);

const parsedRoastChance = Number(
  process.env.RANDOM_ROAST_CHANCE || "0.1"
);

const RANDOM_ROAST_CHANCE = Number.isFinite(parsedRoastChance)
  ? Math.max(0, Math.min(1, parsedRoastChance))
  : 0.1;

const parsedCooldown = Number(
  process.env.RANDOM_ROAST_COOLDOWN_MS || "30000"
);

const RANDOM_ROAST_COOLDOWN_MS =
  Number.isFinite(parsedCooldown) && parsedCooldown >= 0
    ? parsedCooldown
    : 30000;

const lastRandomRoastByThread = new Map();
const activeThreads = new Set();

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
  (loginError, api) => {
    if (loginError) {
      console.error("Login failed:", loginError);
      process.exit(1);
    }

    if (!api) {
      console.error("Login failed: Facebook API object was not returned.");
      process.exit(1);
    }

    console.log("Logged in successfully.");

    api.setOptions({
      listenEvents: true,
      selfListen: false,
    });

    const startupThreadID = process.env.STARTUP_THREAD_ID;

    if (startupThreadID) {
      api.sendMessage(
        "Bot is online ✅",
        startupThreadID,
        (sendError) => {
          if (sendError) {
            console.error("Startup message failed:", sendError);
          }
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

      if (!event || typeof event !== "object") {
        return;
      }

      console.log("Incoming event:", {
        type: event.type,
        senderID: event.senderID,
        threadID: event.threadID,
      });

      if (event.threadID) {
        activeThreads.add(String(event.threadID));
        console.log(
          `[Threads] Active threads: ${activeThreads.size}`
        );
      }

      if (
        event.type === "message" ||
        event.type === "message_reply"
      ) {
        handleMessage(api, event);
      }
    });
  }
);

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleMessage(api, event) {
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

  const originalText = body.trim();
  const text = originalText.toLowerCase();
  const senderId = String(senderID || "").trim();

  if (text === "!ping") {
    sendReplyWithTyping(api, "pong 🏓", threadID);
    return;
  }

  if (text === "!help") {
    sendReplyWithTyping(
      api,
      [
        "Commands:",
        "!ping - health check",
        "!help - this message",
        "!play <song> - send an audio track",
        "!broadcast <text> - admin only",
      ].join("\n"),
      threadID
    );
    return;
  }

  if (text === "!play" || text.startsWith("!play ")) {
    const requestedSong = originalText
      .slice("!play".length)
      .trim();

    void sendAudioTrack(api, requestedSong, threadID);
    return;
  }

  if (
    text.startsWith("!broadcast ") &&
    ADMIN_IDS.includes(senderId)
  ) {
    const message = originalText
      .slice("!broadcast ".length)
      .trim();

    broadcastToAllThreads(api, message);
    return;
  }

  const triggerReply = getTriggerReply(body, senderId);

  if (triggerReply) {
    sendReplyWithTyping(api, triggerReply, threadID, true);
    return;
  }

  if (
    RANDOM_ROAST_ENABLED &&
    Math.random() < RANDOM_ROAST_CHANCE &&
    canRandomRoastThread(String(threadID))
  ) {
    const randomRoast = getRandomRoastReply();

    if (randomRoast) {
      lastRandomRoastByThread.set(
        String(threadID),
        Date.now()
      );

      sendReplyWithTyping(
        api,
        randomRoast,
        threadID,
        true
      );
    }
  }
}

function canRandomRoastThread(threadID) {
  const now = Date.now();
  const lastRoastAt =
    lastRandomRoastByThread.get(threadID) || 0;

  if (
    now - lastRoastAt <
    RANDOM_ROAST_COOLDOWN_MS
  ) {
    return false;
  }

  if (lastRandomRoastByThread.size > 1000) {
    for (const [
      knownThreadID,
      roastAt,
    ] of lastRandomRoastByThread.entries()) {
      if (
        now - roastAt >
        Math.max(RANDOM_ROAST_COOLDOWN_MS * 2, 60000)
      ) {
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

  const broadcastMessage = `📢 ${message.trim()}`;

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
            console.log(
              `[Broadcast] Sent to ${threadID}`
            );
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
    if (
      typeof api.sendTypingIndicator === "function"
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
      const memePath = attachMeme
        ? getRandomMemePath()
        : null;

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
            console.error(
              "Reply failed:",
              sendError
            );
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
