const { login } = require("ws3-fca");
const express = require("express");
const fs = require("fs");
const path = require("path");
const {
  getTriggerReply,
  getRandomRoastReply,
} = require("./triggers");

// ---------------------------------------------------------------------------
// Tiny web server so Render sees an open port and keeps the service alive.
// ---------------------------------------------------------------------------
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running ✅");
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Web server listening on port ${process.env.PORT || 3000}`);
});

// ---------------------------------------------------------------------------
// Load Facebook cookies from the FB_COOKIES environment variable.
// ---------------------------------------------------------------------------
function readAppState() {
  const rawCookies = process.env.FB_COOKIES;

  if (!rawCookies || !rawCookies.trim()) {
    throw new Error("FB_COOKIES is missing.");
  }

  let parsed;

  try {
    parsed = JSON.parse(rawCookies);

    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
  } catch {
    throw new Error(
      "FB_COOKIES must contain a JSON array of Facebook cookie objects."
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "FB_COOKIES parsed successfully, but it is not a valid cookie array."
    );
  }

  const normalizedCookies = parsed.map((cookie) => ({
    ...cookie,
    key: typeof cookie.key === "string" ? cookie.key : cookie.name,
  }));

  if (
    normalizedCookies.some(
      (cookie) =>
        !cookie ||
        typeof cookie !== "object" ||
        typeof cookie.key !== "string" ||
        typeof cookie.value !== "string"
    )
  ) {
    throw new Error(
      "FB_COOKIES cookies need string name/key and value fields."
    );
  }

  return normalizedCookies;
}

let appState;

try {
  appState = readAppState();
} catch (err) {
  console.error(`Configuration error: ${err.message}`);
  process.exit(1);
}

// Facebook IDs allowed to use !broadcast.
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// Optional no-trigger roast mode. Keep this probabilistic and rate-limited so
// the bot does not reply to every single message in a busy group chat.
const RANDOM_ROAST_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.RANDOM_ROAST || ""
);

const RANDOM_ROAST_CHANCE = Math.max(
  0,
  Math.min(1, Number(process.env.RANDOM_ROAST_CHANCE || "0.1"))
);

const RANDOM_ROAST_COOLDOWN_MS = Math.max(
  0,
  Number(process.env.RANDOM_ROAST_COOLDOWN_MS || "30000")
);

const lastRandomRoastByThread = new Map();

// ---------------------------------------------------------------------------
// Log in to Facebook.
// ---------------------------------------------------------------------------
login(
  appState,
  {
    online: true,
    updatePresence: true,
    selfListen: false,
    randomUserAgent: false,
  },
  (err, api) => {
    if (err) {
      console.error("Login failed:", err);
      process.exit(1);
    }

    console.log("Logged in successfully.");

    api.setOptions({
      listenEvents: true,
      selfListen: false,
    });

    if (process.env.STARTUP_THREAD_ID) {
      Promise.resolve(
        api.sendMessage(
          "Bot is online ✅",
          process.env.STARTUP_THREAD_ID
        )
      ).catch((sendError) => {
        console.error("Startup message failed:", sendError);
      });
    }

    console.log(
      "Listener started. Send a message from a different Facebook account."
    );

    api.listenMqtt((err, event) => {
      if (err) {
        console.error("Listener error:", err);
        return;
      }

      console.log("Incoming event:", {
        type: event?.type,
        senderID: event?.senderID,
        threadID: event?.threadID,
      });

      if (
        event &&
        (event.type === "message" ||
          event.type === "message_reply")
      ) {
        handleMessage(api, event);
      }
    });
  }
);

// ---------------------------------------------------------------------------
// Message handling.
// ---------------------------------------------------------------------------
function handleMessage(api, event) {
  const { threadID, senderID, body } = event;

  if (!threadID || typeof body !== "string" || !body.trim()) {
    return;
  }

  const text = body.trim().toLowerCase();
  const senderId = String(senderID || "");

  if (text === "!ping") {
    sendReplyWithTyping(api, "pong 🏓", threadID);
    return;
  }

  if (text === "!help") {
    sendReplyWithTyping(
      api,
      "Commands:\n" +
        "!ping - health check\n" +
        "!help - this message\n" +
        "!broadcast <text> - admin only",
      threadID
    );
    return;
  }

  if (
    text.startsWith("!broadcast ") &&
    ADMIN_IDS.includes(senderId)
  ) {
    const message = body.slice("!broadcast ".length);

    sendReplyWithTyping(api, `📢 ${message}`, threadID);
    return;
  }

  // Everyone can trigger the roast replies.
  // Roast replies also receive a random meme from the memes folder.
  const triggerReply = getTriggerReply(body, senderId);

  if (triggerReply) {
    sendReplyWithTyping(api, triggerReply, threadID, true);
    return;
  }

  // No trigger word is needed when RANDOM_ROAST is enabled in Render.
  // Commands above are intentionally excluded from this random mode.
  if (
    RANDOM_ROAST_ENABLED &&
    Math.random() < RANDOM_ROAST_CHANCE &&
    canRandomRoastThread(threadID)
  ) {
    const randomRoast = getRandomRoastReply();

    if (randomRoast) {
      lastRandomRoastByThread.set(threadID, Date.now());

      // true keeps the random meme attached to the roast.
      sendReplyWithTyping(api, randomRoast, threadID, true);
    }
  }
}

function canRandomRoastThread(threadID) {
  const lastRoastAt = lastRandomRoastByThread.get(threadID) || 0;

  if (Date.now() - lastRoastAt < RANDOM_ROAST_COOLDOWN_MS) {
    return false;
  }

  // Prevent unbounded memory growth if the bot sees many one-off threads.
  if (lastRandomRoastByThread.size > 1000) {
    for (const [knownThreadID, roastAt] of lastRandomRoastByThread) {
      if (Date.now() - roastAt > RANDOM_ROAST_COOLDOWN_MS * 2) {
        lastRandomRoastByThread.delete(knownThreadID);
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Select a random image from the memes folder.
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

    const memeFiles = fs
      .readdirSync(memeDirectory)
      .filter((fileName) =>
        supportedExtensions.has(
          path.extname(fileName).toLowerCase()
        )
      );

    if (memeFiles.length === 0) {
      return null;
    }

    const randomFile =
      memeFiles[Math.floor(Math.random() * memeFiles.length)];

    return path.join(memeDirectory, randomFile);
  } catch (error) {
    console.error("Could not load memes:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Show typing, then send the message and optional meme.
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
      api.sendTypingIndicator(threadID, (typingError) => {
        if (typingError) {
          console.error("Typing indicator failed:", typingError);
        }
      });
    } else {
      console.warn(
        "Typing indicator is not available in this ws3-fca version."
      );
    }
  } catch (typingError) {
    console.error("Typing indicator error:", typingError);
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
            console.error("Reply failed:", sendError);
          }
        }
      );
    } catch (sendError) {
      console.error("Reply error:", sendError);
    }
  }, typingDelayMs);
}
