const { login } = require("ws3-fca");
const express = require("express");
const { getTriggerReply } = require("./triggers");

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

    // Accept cookies that were accidentally JSON-stringified twice.
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

  // Some cookie exporters use "name"; ws3-fca expects "key".
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

      // Prevents the bot from reacting to its own messages.
      selfListen: false,
    });

    // Optional startup message.
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

      // Normal messages and Messenger reply messages are both handled.
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

  // Health check command.
  if (text === "!ping") {
    api.sendMessage("pong 🏓", threadID);
    return;
  }

  // Help command.
  if (text === "!help") {
    api.sendMessage(
      "Commands:\n" +
        "!ping - health check\n" +
        "!help - this message\n" +
        "!broadcast <text> - admin only",
      threadID
    );
    return;
  }

  // Admin-only command.
  if (
    text.startsWith("!broadcast ") &&
    ADMIN_IDS.includes(senderId)
  ) {
    const message = body.slice("!broadcast ".length);

    api.sendMessage(`📢 ${message}`, threadID);
    return;
  }

  // Everyone can trigger the roast replies.
  const triggerReply = getTriggerReply(body, senderId);

  if (triggerReply) {
    api.sendMessage(triggerReply, threadID);
    return;
  }
}
