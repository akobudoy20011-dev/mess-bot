"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { login } = require("ws3-fca");

const {
  getThreadEnabled,
  setThreadEnabled,
  getRandomBanat,
  shouldReply,
  clearThreadRuntime,
} = require("./weh");

const PORT = Number(process.env.PORT || 10000);
const STATE_FILE = path.join(__dirname, "weh-state.json");
const MAX_LOGIN_BACKOFF_MS = 5 * 60_000;

function getAdminIDs() {
  return new Set(
    [
      process.env.WEH_ADMIN_IDS || "",
      process.env.ADMIN_IDS || "",
    ]
      .flatMap((value) => String(value).split(","))
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function isAdmin(senderID) {
  return Boolean(senderID) && getAdminIDs().has(String(senderID));
}

let api = null;
let botUserID = null;
let loginAttempt = 0;
let retryTimer = null;
let loginInProgress = false;

function readAppState() {
  const raw = process.env.FB_COOKIES;

  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("FB_COOKIES is missing.");
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
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

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return;
    }

    const parsed = JSON.parse(
      fs.readFileSync(STATE_FILE, "utf8")
    );

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    for (const [threadID, enabled] of Object.entries(parsed)) {
      if (enabled === true) {
        setThreadEnabled(threadID, true);
        activeThreads.add(String(threadID));
      }
    }

    console.log(
      "[WEH] Restored enabled thread state."
    );
  } catch (error) {
    console.error(
      "[WEH] Could not restore state:",
      error.message
    );
  }
}

function saveState() {
  try {
    const state = {};

    // threadState is intentionally kept private in weh.js, so
    // state is reconstructed from the active-thread registry below.
    for (const threadID of activeThreads) {
      state[threadID] = true;
    }

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(state, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error(
      "[WEH] Could not save state:",
      error.message
    );
  }
}

const activeThreads = new Set();

function enableThread(threadID) {
  const key = String(threadID);
  setThreadEnabled(key, true);
  activeThreads.add(key);
  saveState();
}

function disableThread(threadID) {
  const key = String(threadID);
  setThreadEnabled(key, false);
  activeThreads.delete(key);
  clearThreadRuntime(key);
  saveState();
}

function send(threadID, message) {
  if (!api || typeof api.sendMessage !== "function") {
    return;
  }

  try {
    api.sendMessage(
      message,
      threadID,
      (error) => {
        if (error) {
          console.error(
            "[WEH] sendMessage failed:",
            error
          );
        }
      }
    );
  } catch (error) {
    console.error(
      "[WEH] sendMessage threw:",
      error
    );
  }
}

function handleWehCommand(threadID, body, senderID) {
  const args = body
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => value.toLowerCase());

  const action = args[0] || null;
  const enabled = getThreadEnabled(threadID);

  if (action === "status") {
    send(
      threadID,
      enabled
        ? "୨୧ WEH is ON for this GC. Automatic banat is active. 💀"
        : "୨୧ WEH is OFF for this GC."
    );
    return;
  }

  if (action === "on") {
    if (!isAdmin(senderID)) {
      send(threadID, "୨୧ WEH controls are admin-only. 🎀");
      return;
    }
    if (enabled) {
      send(
        threadID,
        "୨୧ WEH is already ON. 💀"
      );
      return;
    }

    enableThread(threadID);

    send(
      threadID,
      [
        "╭────── ୨୧ WEH ୨୧ ──────╮",
        "",
        "♡ automatic banat: ON",
        "♡ randomized resibo links: ON",
        "♡ cooldown: 25 seconds",
        "",
        "╰────── ୨୧ ♡ ୨୧ ──────╯",
      ].join("\n")
    );
    return;
  }

  if (action === "off") {
    if (!isAdmin(senderID)) {
      send(threadID, "୨୧ WEH controls are admin-only. 🎀");
      return;
    }
    if (!enabled) {
      send(
        threadID,
        "୨୧ WEH is already OFF."
      );
      return;
    }

    disableThread(threadID);

    send(
      threadID,
      "୨୧ WEH is OFF. Tahimik muna. 🎀"
    );
    return;
  }

  if (!isAdmin(senderID)) {
    send(threadID, "୨୧ WEH controls are admin-only. 🎀");
    return;
  }

  if (!enabled) {
    enableThread(threadID);

    send(
      threadID,
      [
        "୨୧ WEH activated. 💀",
        "Automatic banat is now ON for this GC.",
        "Every banat gets one randomized resibo link.",
      ].join("\n")
    );
  } else {
    disableThread(threadID);

    send(
      threadID,
      "୨୧ WEH deactivated. Tahimik muna. 🎀"
    );
  }
}

function handleEvent(event) {
  if (!event || !event.threadID) {
    return;
  }

  if (
    event.type !== "message" &&
    event.type !== "message_reply"
  ) {
    return;
  }

  const threadID = String(event.threadID);
  const body =
    typeof event.body === "string"
      ? event.body.trim()
      : "";

  if (!body) {
    return;
  }

  if (
    botUserID &&
    String(event.senderID) === String(botUserID)
  ) {
    return;
  }

  const lower = body.toLowerCase();

  if (
    lower === "/weh" ||
    lower.startsWith("/weh ")
  ) {
    handleWehCommand(threadID, body, event.senderID);
    return;
  }

  if (!getThreadEnabled(threadID)) {
    return;
  }

  if (body.startsWith("/")) {
    return;
  }

  if (!shouldReply(threadID, body)) {
    return;
  }

  send(threadID, getRandomBanat());
}

function startListening() {
  if (!api || typeof api.listenMqtt !== "function") {
    throw new Error(
      "Messenger API does not expose listenMqtt()."
    );
  }

  console.log("[WEH] Listener started.");

  api.listenMqtt(
    (error, event) => {
      if (error) {
        console.error(
          "[WEH] Listener error:",
          error
        );
        return;
      }

      try {
        handleEvent(event);
      } catch (eventError) {
        console.error(
          "[WEH] Event handler error:",
          eventError
        );
      }
    }
  );
}

function attemptLogin() {
  if (loginInProgress) {
    return;
  }

  loginInProgress = true;

  let appState;

  try {
    appState = readAppState();
  } catch (error) {
    console.error(
      "[WEH] Configuration error:",
      error.message
    );
    process.exitCode = 1;
    loginInProgress = false;
    return;
  }

  console.log(
    "[WEH] Logging into Messenger..."
  );

  login(
    appState,
    {
      online: true,
      updatePresence: true,
      selfListen: false,
      randomUserAgent: false,
    },
    (error, loggedInApi) => {
      loginInProgress = false;

      if (error || !loggedInApi) {
        loginAttempt += 1;

        const backoffMs = Math.min(
          2 ** loginAttempt * 1000,
          MAX_LOGIN_BACKOFF_MS
        );

        console.error(
          "[WEH] Login failed (attempt " +
            loginAttempt +
            "). Retrying in " +
            Math.round(backoffMs / 1000) +
            "s.",
          error || "No API object returned."
        );

        if (retryTimer) {
          clearTimeout(retryTimer);
        }

        retryTimer = setTimeout(() => {
          retryTimer = null;
          attemptLogin();
        }, backoffMs);

        return;
      }

      api = loggedInApi;
      loginAttempt = 0;

      try {
        if (
          typeof api.getCurrentUserID ===
          "function"
        ) {
          botUserID = api.getCurrentUserID();
        }
      } catch {
        botUserID = null;
      }

      console.log(
        "[WEH] Logged in successfully." +
          (botUserID
            ? " User ID: " + botUserID
            : "")
      );

      try {
        startListening();
      } catch (listenError) {
        console.error(
          "[WEH] Could not start listener:",
          listenError
        );
      }
    }
  );
}

function startHealthServer() {
  const app = express();

  app.get("/", (_request, response) => {
    response.status(200).json({
      ok: true,
      service: "weh-banat-bot",
      messengerConnected: Boolean(api),
      activeThreads: activeThreads.size,
      uptimeSeconds: Math.floor(
        process.uptime()
      ),
    });
  });

  app.get("/health", (_request, response) => {
    response.status(200).send("OK");
  });

  app.listen(PORT, () => {
    console.log(
      "[WEH] Health server listening on port " +
        PORT
    );
  });
}

loadState();

startHealthServer();
attemptLogin();

process.on("uncaughtException", (error) => {
  console.error(
    "[WEH] Uncaught exception:",
    error
  );
});

process.on("unhandledRejection", (error) => {
  console.error(
    "[WEH] Unhandled rejection:",
    error
  );
});
