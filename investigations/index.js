"use strict";

const path = require("path");
const fs = require("fs");

const db = require("../db");
const { recordResult, incrementPlayed, getProfile, formatProfile } = require("./profile");

const DATA_DIR = path.join(__dirname, "data");
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const sessions = new Map();

const MODE_INFO = {
  case: { command: "case", label: "MURDER / MYSTERY", icon: "🕵️", file: "cases.json", final: "accuse" },
  haunt: { command: "haunt", label: "HORROR INVESTIGATION", icon: "🏚️", file: "haunt.json", final: "escape" },
  incident: { command: "incident", label: "SCI-FI INCIDENT", icon: "☣️", file: "incident.json", final: "conclude" },
  heist: { command: "heist", label: "CRIMINAL PLANNING", icon: "💎", file: "heist.json", final: "execute" },
  trial: { command: "trial", label: "COURTROOM REASONING", icon: "⚖️", file: "trial.json", final: "verdict" },
  lost: { command: "lost", label: "EXPLORATION MYSTERY", icon: "🌲", file: "lost.json", final: "escape" },
};

function normalizePool(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.scenarios)) return value.scenarios;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.pool)) return value.pool;
  if (value && value.default && Array.isArray(value.default)) return value.default;
  if (value && value.default && Array.isArray(value.default.scenarios)) {
    return value.default.scenarios;
  }
  return [];
}

function loadPool(info) {
  const jsonPath = path.join(DATA_DIR, info.file);
  const jsPath = path.join(DATA_DIR, info.file.replace(/\.json$/i, ".js"));

  // Prefer the JSON format, but also support the JS scenario files that are
  // currently present in the repository. This keeps the loader compatible
  // with both investigation data layouts.
  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const pool = normalizePool(parsed);
      if (pool.length) return pool;
      console.warn(`[INVESTIGATIONS] ${info.file} loaded but contains no scenarios.`);
    } catch (error) {
      console.error(`[INVESTIGATIONS] Failed parsing ${info.file}:`, error);
    }
  }

  if (fs.existsSync(jsPath)) {
    try {
      delete require.cache[require.resolve(jsPath)];
      const loaded = require(jsPath);
      const pool = normalizePool(loaded);
      if (pool.length) return pool;
      console.warn(`[INVESTIGATIONS] ${path.basename(jsPath)} loaded but contains no scenarios.`);
    } catch (error) {
      console.error(`[INVESTIGATIONS] Failed loading ${path.basename(jsPath)}:`, error);
    }
  }

  return [];
}

const pools = {};
for (const [mode, info] of Object.entries(MODE_INFO)) {
  pools[mode] = loadPool(info);
  console.log(`[INVESTIGATIONS] Loaded ${pools[mode].length} ${mode} scenario(s).`);
}

function key(threadID, userID) {
  return `${String(threadID)}:${String(userID)}`;
}

function send(api, threadID, text) {
  return new Promise((resolve) => {
    try {
      if (!api || typeof api.sendMessage !== "function") return resolve(null);
      let settled = false;
      const finish = (error, info) => {
        if (settled) return;
        settled = true;
        if (error) console.error("[INVESTIGATIONS] send error:", error);
        resolve(info || null);
      };
      const result = api.sendMessage(text, String(threadID), null, finish);
      if (result && typeof result.then === "function") {
        result.then((info) => finish(null, info)).catch((error) => finish(error));
      }
    } catch (error) {
      console.error("[INVESTIGATIONS] send exception:", error);
      resolve(null);
    }
  });
}

function edit(api, messageID, text) {
  return new Promise((resolve) => {
    try {
      if (!api || typeof api.editMessage !== "function" || !messageID) return resolve(false);
      let settled = false;
      const finish = (error, info) => {
        if (settled) return;
        settled = true;
        if (error) console.warn("[INVESTIGATIONS] edit failed:", error);
        resolve(!error && info !== false);
      };
      const result = api.editMessage(text, String(messageID), finish);
      if (result && typeof result.then === "function") {
        result.then((info) => finish(null, info)).catch((error) => finish(error));
      }
    } catch (error) {
      console.warn("[INVESTIGATIONS] edit exception:", error);
      resolve(false);
    }
  });
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function pick(pool) {
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function sessionText(session) {
  const info = MODE_INFO[session.mode];
  const scenario = session.scenario;
  const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
  const remaining = Math.max(0, Math.ceil((SESSION_TIMEOUT_MS / 1000) - elapsed));

  const commands = {
    case: [
      "!case inspect window",
      "!case inspect clock",
      "!case inspect glass",
      "!case inspect desk",
      "!case inspect suspect <name>",
      "!case accuse <name>",
    ],
    haunt: ["!haunt explore library", "!haunt explore basement", "!haunt explore stairs", "!haunt choose fireplace"],
    incident: ["!incident inspect logs", "!incident inspect lab3", "!incident inspect security", "!incident inspect terminal", "!incident conclude <clue>"],
    heist: ["!heist plan scout", "!heist plan hack", "!heist plan disguise", "!heist execute stealth"],
    trial: ["!trial examine witness", "!trial examine keycard", "!trial examine photo", "!trial verdict"],
    lost: ["!lost explore north", "!lost explore cave", "!lost explore structure", "!lost choose river"],
  };

  return [
    `${info.icon} ${info.label}`,
    "",
    `📁 ${scenario.title}`,
    "",
    scenario.intro,
    "",
    `⏳ ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining`,
    "",
    "Available actions:",
    ...(commands[session.mode] || []),
    "",
    `Evidence found: ${session.evidenceFound}`,
  ].join("\n");
}

function helpText() {
  return [
    "╭──── 🕵️ ECLIPSE INVESTIGATIONS ────╮",
    "",
    "!case       → Murder / mystery",
    "!haunt      → Horror investigation",
    "!incident   → Sci-fi investigation",
    "!heist      → Criminal planning",
    "!trial      → Courtroom reasoning",
    "!lost       → Exploration mystery",
    "",
    "!investigator → View your Investigator profile",
    "!investigator stats → Same profile view",
    "",
    "Start a mode with its command, then follow the actions shown by ECLIPSE.",
    "Each investigation has a time limit and rewards coins + XP.",
    "",
    "╰────────────────────────────────────╯",
  ].join("\n");
}

function profileHelp() {
  return [
    "🕵️ Investigator profile",
    "",
    "Use:",
    "!investigator",
    "!investigator stats",
    "",
    "Your score, games played, evidence, streaks, fastest solve, and rank are saved per group.",
  ].join("\n");
}

async function award(threadID, userID, reward, xp, description) {
  try {
    if (reward > 0 && typeof db.addBalance === "function") {
      await db.addBalance(threadID, userID, reward, description);
    }
  } catch (error) {
    console.error("[INVESTIGATIONS] reward error:", error);
  }
  try {
    if (xp > 0 && typeof db.addXP === "function") {
      await db.addXP(threadID, userID, xp);
    }
  } catch (error) {
    console.error("[INVESTIGATIONS] XP error:", error);
  }
}

async function finish(api, session, outcome) {
  const sessionKey = key(session.threadID, session.userID);
  if (!sessions.has(sessionKey)) return;
  sessions.delete(sessionKey);
  clearTimeout(session.timer);

  const seconds = Math.floor((Date.now() - session.startedAt) / 1000);
  const completed = outcome.completed === true;
  const perfect = completed && session.evidenceFound >= session.totalClues;
  const baseReward = completed ? Number(session.scenario.reward || 0) : 0;
  const bonus = perfect ? Number(session.scenario.perfectBonus || 0) : 0;
  const reward = baseReward + bonus;
  const xp = completed ? Number(session.scenario.xp || 0) + (perfect ? 50 : 0) : 0;

  try {
    await recordResult(session.threadID, session.userID, session.mode, {
      completed,
      perfect,
      evidenceFound: session.evidenceFound,
      seconds,
      reward,
      xp,
    });
  } catch (error) {
    console.error("[INVESTIGATIONS] profile update failed:", error);
  }

  if (completed) {
    await award(session.threadID, session.userID, reward, xp, `Investigation reward: ${session.scenario.title}`);
  }

  const rank = await getProfile(session.threadID, session.userID).catch(() => null);
  const rankText = rank ? require("./profile").rankFor(rank) : "🕵️ INVESTIGATOR";

  if (completed) {
    await send(api, session.threadID, [
      "╭──── 🕵️ CASE CLOSED ────╮",
      "",
      `📁 ${session.scenario.title}`,
      "",
      "✓ Investigation completed.",
      `Evidence found: ${session.evidenceFound}/${session.totalClues}`,
      `Time: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      perfect ? "🌟 PERFECT INVESTIGATION" : "✓ Successful investigation",
      "",
      `💰 Reward: ${reward.toLocaleString()} coins`,
      `✨ XP: ${xp}`,
      "",
      rankText,
      "",
      "╰─────────────────────────╯",
    ].join("\n"));
  } else {
    await send(api, session.threadID, [
      "╭──── 🕯️ INVESTIGATION FAILED ────╮",
      "",
      `📁 ${session.scenario.title}`,
      "",
      outcome.reason || "The investigation ended without a successful conclusion.",
      "",
      `Evidence found: ${session.evidenceFound}/${session.totalClues}`,
      `Time: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      "",
      "No reward was issued.",
      "╰─────────────────────────────────╯",
    ].join("\n"));
  }
}

function clueCount(scenario) {
  if (scenario.clues) return Object.keys(scenario.clues).length;
  if (scenario.choices) return Object.keys(scenario.choices).length;
  return 0;
}

async function start(api, event, mode) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);
  const sessionKey = key(threadID, userID);

  if (sessions.has(sessionKey)) {
    await send(api, threadID, "🕵️ You already have an active investigation. Finish it before starting another.");
    return true;
  }

  const scenario = pick(pools[mode] || []);
  if (!scenario) {
    await send(api, threadID, "🕯️ No investigations are currently available for this mode.");
    return true;
  }

  await incrementPlayed(threadID, userID);

  const session = {
    threadID,
    userID,
    mode,
    scenario,
    startedAt: Date.now(),
    evidenceFound: 0,
    discovered: new Set(),
    totalClues: clueCount(scenario),
    timer: null,
    lastMessageID: null,
  };

  session.timer = setTimeout(() => {
    void finish(api, session, { completed: false, reason: "⏰ Time expired. The case remains unsolved." });
  }, SESSION_TIMEOUT_MS);

  sessions.set(sessionKey, session);
  const sent = await send(api, threadID, sessionText(session));
  if (sent && sent.messageID) session.lastMessageID = sent.messageID;
  return true;
}

async function inspect(session, target) {
  const scenario = session.scenario;
  const normalized = normalize(target);
  if (!normalized) return "Tell me what you want to inspect.";

  let source = scenario.clues || scenario.choices || {};
  let keyName = normalized;

  if (session.mode === "case" && normalized.startsWith("suspect ")) {
    keyName = normalized;
    source = scenario.suspects || {};
  }

  const value = source[keyName];
  if (!value) return `❔ I can't find anything matching "${target}".`;

  if (!session.discovered.has(`${session.mode}:${keyName}`)) {
    session.discovered.add(`${session.mode}:${keyName}`);
    session.evidenceFound += 1;
  }

  return [
    "🔎 EVIDENCE FOUND",
    "",
    String(value),
    "",
    `Evidence found: ${session.evidenceFound}/${session.totalClues}`,
  ].join("\n");
}

async function conclude(api, session, answer) {
  const normalized = normalize(answer);
  const correct = normalized === normalize(session.scenario.answer);
  if (!correct) {
    await send(api, session.threadID, [
      "❌ That conclusion does not fit the evidence.",
      "",
      "You can continue investigating and try again.",
      `Evidence found: ${session.evidenceFound}/${session.totalClues}`,
    ].join("\n"));
    return true;
  }

  await send(api, session.threadID, [
    "✓ CONCLUSION ACCEPTED",
    "",
    session.scenario.explanation,
    "",
    "Closing the investigation...",
  ].join("\n"));
  await finish(api, session, { completed: true });
  return true;
}

async function handleSession(api, event, mode, args) {
  const session = sessions.get(key(event.threadID, event.senderID));
  if (!session || session.mode !== mode) return false;

  const action = normalize(args[0]);
  const target = args.slice(1).join(" ").trim();

  if (!action || action === "status") {
    await send(api, event.threadID, sessionText(session));
    return true;
  }

  if (["inspect", "examine", "explore", "investigate"].includes(action)) {
    const text = await inspect(session, target);
    await send(api, event.threadID, text);
    return true;
  }

  const finalActions = ["accuse", "conclude", "execute", "verdict", "choose", "escape"];
  if (finalActions.includes(action)) {
    const answer = target || action;
    return conclude(api, session, answer);
  }

  if (action === "quit" || action === "abandon") {
    await finish(api, session, { completed: false, reason: "You abandoned the investigation." });
    return true;
  }

  await send(api, event.threadID, sessionText(session));
  return true;
}

async function handleInvestigationCommand(api, event, command, args) {
  const cmd = normalize(command);
  const normalizedArgs = Array.isArray(args)
    ? args.map(String)
    : String(args || "").trim().split(/\s+/).filter(Boolean);

  if (cmd === "investigations" || cmd === "investigation") {
    await send(api, event.threadID, helpText());
    return true;
  }

  if (cmd === "investigator") {
    const sub = normalize(normalizedArgs[0]);
    if (sub === "help") {
      await send(api, event.threadID, profileHelp());
      return true;
    }
    const profile = await getProfile(event.threadID, event.senderID);
    await send(api, event.threadID, formatProfile(profile));
    return true;
  }

  if (!MODE_INFO[cmd]) return false;

  if (await handleSession(api, event, cmd, normalizedArgs)) return true;
  return start(api, event, cmd);
}

function activeSessionCount() {
  return sessions.size;
}

module.exports = {
  handleInvestigationCommand,
  activeSessionCount,
};
