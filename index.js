const ws3fca = require("ws3-fca");
// Different versions/forks of ws3-fca export the login function differently:
// sometimes as `module.exports = login`, sometimes as `module.exports = { login }`.
// This handles both so we don't crash with "login is not a function".
const login = typeof ws3fca === "function" ? ws3fca : ws3fca.login;
const express = require("express");
const { getTriggerReply } = require("./triggers");

// ---------------------------------------------------------------------------
// Tiny web server so Render sees an open port and keeps the service "alive".
// Render web services expect something listening on process.env.PORT.
// ---------------------------------------------------------------------------
const app = express();
app.get("/", (req, res) => res.send("Bot is running ✅"));
app.listen(process.env.PORT || 3000, () => {
  console.log(`Web server listening on port ${process.env.PORT || 3000}`);
});

// ---------------------------------------------------------------------------
// Load cookies (appState) from an environment variable, NOT a committed file.
// On Render: Dashboard → your service → Environment → add FB_COOKIES
// with the raw JSON array as the value.
// Locally: create a real cookies.json (see cookies.example.json) and run
//   FB_COOKIES=$(cat cookies.json) node index.js
// ---------------------------------------------------------------------------
let appState;
try {
  appState = JSON.parse(process.env.FB_COOKIES);
} catch (err) {
  console.error("FB_COOKIES is missing or not valid JSON. Aborting.");
  process.exit(1);
}

// Who the bot is allowed to auto-message / who counts as an "admin" for
// commands. Fill in real Facebook user IDs, comma-separated, in the
// ADMIN_IDS env var, e.g. ADMIN_IDS=1000123456,1000987654
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);

login({ appState }, (err, api) => {
  if (err) {
    console.error("Login failed:", err);
    process.exit(1);
  }

  console.log("Logged in successfully.");

  api.setOptions({
    listenEvents: true,
    selfListen: false, // don't react to the bot's own messages
  });

  // -------------------------------------------------------------------
  // Example: send one message on startup. Comment out if you don't want
  // a message fired every time the service restarts/redeploys.
  // -------------------------------------------------------------------
  if (process.env.STARTUP_THREAD_ID) {
    api.sendMessage("Bot is online ✅", process.env.STARTUP_THREAD_ID);
  }

  // -------------------------------------------------------------------
  // Main listener: reacts to incoming messages/events.
  // -------------------------------------------------------------------
  api.listenMqtt((err, event) => {
    if (err) {
      console.error("Listener error:", err);
      return;
    }

    if (event.type === "message") {
      handleMessage(api, event);
    }
  });
});

// ---------------------------------------------------------------------------
// Command handling — extend this with whatever behavior you want.
// ---------------------------------------------------------------------------
function handleMessage(api, event) {
  const { threadID, senderID, body } = event;
  if (!body) return;

  const text = body.trim().toLowerCase();

  if (text === "!ping") {
    api.sendMessage("pong 🏓", threadID);
    return;
  }

  if (text === "!help") {
    api.sendMessage(
      "Commands:\n!ping - health check\n!help - this message",
      threadID
    );
    return;
  }

  // Example admin-only command
  if (text.startsWith("!broadcast ") && ADMIN_IDS.includes(senderID)) {
    const msg = body.slice("!broadcast ".length);
    api.sendMessage(`📢 ${msg}`, threadID);
    return;
  }

  // Preset trigger-word banter (see triggers.js). Checked last so it never
  // overrides the explicit commands above.
  const triggerReply = getTriggerReply(body);
  if (triggerReply) {
    api.sendMessage(triggerReply, threadID);
    return;
  }
}
