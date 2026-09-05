const { login } = require("ws3-fca");
const express = require("express");
const { getTriggerReply } = require("./triggers");

// ---------------------------------------------------------------------------
// Tiny web server so Render sees an open port and keeps the service "alive".
// Render web services expect something listening on process.env.PORT.
// ---------------------------------------------------------------------------
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running ✅");
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Web server listening on port ${process.env.PORT || 3000}`);
});

// ---------------------------------------------------------------------------
// Load cookies from the FB_COOKIES environment variable.
// ---------------------------------------------------------------------------
function readAppState() {
  const rawCookies = process.env.FB_COOKIES;

  if (!rawCookies || !rawCookies.trim()) {
    throw new Error("FB_COOKIES is missing.");
  }

  let parsed;

  try {
    parsed = JSON.parse(rawCookies);

    // Accept one extra layer of JSON quoting.
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
      "FB_COOKIES parsed successfully, but it is not a valid cookie array. " +
        "Expected an array of cookie objects."
    );
  }

  // Browser cookie exporters commonly use either `key` or `name`.
  // Normalize both formats to `key`.
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
      "FB_COOKIES parsed successfully, but its cookies need string name/key " +
        "and value fields."
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

// ---------------------------------------------------------------------------
// Admin Facebook user IDs.
// Example: ADMIN_IDS=1000123456,1000987654
// ---------------------------------------------------------------------------
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// ws3-fca v2 expects:
// login(cookieArray, options, callback)
//
// Do not use login({ appState }, ...).
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

    // Optional startup message.
    if (process.env.STARTUP_THREAD_ID) {
      api.sendMessage("Bot is online ✅", process.env.STARTUP_THREAD_ID);
    }

    // Listen for incoming Messenger events.
    api.listenMqtt((err, event) => {
      if (err) {
        console.error("Listener error:", err);
        return;
      }

      if (event && event.type === "message") {
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
    api.sendMessage("pong 🏓", threadID);
    return;
  }

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

  if (text.startsWith("!broadcast ") && ADMIN_IDS.includes(senderId)) {
    const msg = body.slice("!broadcast ".length);
    api.sendMessage(`📢 ${msg}`, threadID);
    return;
  }

  const triggerReply = getTriggerReply(body, senderId);

  if (triggerReply) {
    api.sendMessage(triggerReply, threadID);
  }
}
