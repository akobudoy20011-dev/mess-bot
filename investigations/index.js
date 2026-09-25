
"use strict";

const path = require("path");
const fs = require("fs");

const db = require("../db");
const { recordResult, incrementPlayed, getProfile, formatProfile } = require("./profile");

const DATA_DIR = path.join(__dirname, "data");
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_EVIDENCE_TO_SOLVE = 2;
const HINT_REWARD_PENALTY = 0.25;
const sessions = new Map();
const scenarioHistory = new Map();

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
  if (!value || typeof value !== "object") return [];

  const preferredKeys = [
    "scenarios", "data", "pool", "cases", "case", "haunt",
    "haunts", "incidents", "incident", "heists", "heist",
    "trials", "trial", "lost", "lostCases", "investigations",
  ];

  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return value[key];
  }

  if (value.default) {
    const nested = normalizePool(value.default);
    if (nested.length) return nested;
  }

  // Some older investigation files export an object whose values are the
  // actual scenarios rather than wrapping them in an array.
  const values = Object.values(value);
  const scenarioValues = values.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry.title || entry.intro || entry.clues || entry.choices || entry.answer)
  );

  if (scenarioValues.length) return scenarioValues;

  // A single scenario object is also valid.
  if (value.title && (value.intro || value.clues || value.choices || value.answer)) {
    return [value];
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
      /*
       * The investigation data files in this repository use the .js
       * extension but contain raw JSON arrays rather than
       * `module.exports = ...`. Requiring one of those files succeeds
       * but returns an empty exports object, which made every mode look
       * like it had no available investigations.
       *
       * Parse the file as JSON first. If it is a real CommonJS module,
       * fall back to require() for backwards compatibility.
       */
      const source = fs.readFileSync(jsPath, "utf8").replace(/^\\uFEFF/, "").trim();

      try {
        const parsed = JSON.parse(source);
        const pool = normalizePool(parsed);
        if (pool.length) return pool;
      } catch {
        delete require.cache[require.resolve(jsPath)];
        const loaded = require(jsPath);
        const pool = normalizePool(loaded);
        if (pool.length) return pool;
      }

      console.warn(
        `[INVESTIGATIONS] ${path.basename(jsPath)} loaded but contains no scenarios.`
      );
    } catch (error) {
      console.error(
        `[INVESTIGATIONS] Failed loading ${path.basename(jsPath)}:`,
        error
      );
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

function pickForSession(pool, sessionKey) {
  if (!pool.length) return null;

  const history = scenarioHistory.get(sessionKey) || [];
  const recent = new Set(history);
  const available = pool.filter((scenario) => !recent.has(String(scenario.id || scenario.title)));

  const scenario = pick(available.length ? available : pool);
  if (!scenario) return null;

  const id = String(scenario.id || scenario.title);
  const nextHistory = [...history.filter((value) => value !== id), id].slice(-5);
  scenarioHistory.set(sessionKey, nextHistory);
  return scenario;
}

function inspectableEntries(scenario, mode) {
  const entries = [];
  const source = scenario.clues || scenario.choices || {};

  for (const key of Object.keys(source)) {
    entries.push({
      key,
      label: key,
      type: "evidence",
      value: source[key],
    });
  }

  if (mode === "case" && scenario.suspects && typeof scenario.suspects === "object") {
    for (const key of Object.keys(scenario.suspects)) {
      entries.push({
        key: "suspect " + key,
        label: "suspect " + key,
        type: "suspect",
        value: scenario.suspects[key],
      });
    }
  }

  return entries;
}

function answerLabel(session) {
  const answer = normalize(session.scenario.answer);
  if (session.mode === "case" && session.scenario.suspects && session.scenario.suspects[answer]) {
    return "!case accuse " + answer;
  }
  return "!" + session.mode + " conclude " + answer;
}

function sessionText(session) {
  const info = MODE_INFO[session.mode];
  const scenario = session.scenario;
  const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
  const remaining = Math.max(0, Math.ceil((SESSION_TIMEOUT_MS / 1000) - elapsed));
  const entries = inspectableEntries(scenario, session.mode);
  const lines = [
    info.icon + " " + info.label,
    "",
    "📁 " + scenario.title,
    "",
    scenario.intro,
    "",
    "⏳ " + Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0") + " remaining",
    "",
    "🔎 INSPECT:",
  ];

  const evidenceEntries = entries.filter((entry) => entry.type === "evidence");
  const suspectEntries = entries.filter((entry) => entry.type === "suspect");

  if (evidenceEntries.length) {
    lines.push(
      ...evidenceEntries.map(
        (entry) => "!" + session.mode + " inspect " + entry.label
      )
    );
  }

  if (suspectEntries.length) {
    lines.push(
      "",
      "👤 SUSPECTS / TESTIMONY:",
      ...suspectEntries.map(
        (entry) => "!" + session.mode + " inspect " + entry.label
      )
    );
  }

  lines.push(
    "",
    "🧩 SOLVE:",
    "!" + session.mode + " status",
    "!" + session.mode + " hint",
    answerLabel(session),
    "!" + session.mode + " quit",
    "",
    "Evidence found: " + session.evidenceFound + "/" + session.totalClues,
    "Minimum to solve: " + Math.min(MIN_EVIDENCE_TO_SOLVE, session.totalClues),
    session.hintUsed
      ? "💡 Hint used: reward reduced."
      : "💡 Hints reveal direction but reduce the final reward."
  );

  if (session.discovered.size) {
    lines.push(
      "",
      "✓ Investigated: " +
        Array.from(session.discovered)
          .map((x) => x.split(":").pop())
          .join(", ")
    );
  }

  return lines.join("\n");
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
  const perfect =
    completed &&
    session.evidenceFound >= session.totalClues &&
    !session.hintUsed;
  const baseReward = completed ? Number(session.scenario.reward || 0) : 0;
  const bonus = perfect ? Number(session.scenario.perfectBonus || 0) : 0;
  const hintPenalty = session.hintUsed
    ? Math.floor((baseReward + bonus) * HINT_REWARD_PENALTY)
    : 0;
  const reward = Math.max(0, baseReward + bonus - hintPenalty);
  const xp = completed
    ? Math.max(
        0,
        Number(session.scenario.xp || 0) +
          (perfect ? 50 : 0) -
          (session.hintUsed ? 20 : 0)
      )
    : 0;

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

function clueCount(scenario, mode) {
  return inspectableEntries(scenario, mode).length;
}

function answerIsKnown(session, answer) {
  const normalized = normalize(answer);
  if (!normalized) return false;
  if (normalized === normalize(session.scenario.answer)) return true;

  const source = session.scenario.clues || session.scenario.choices || {};
  return Boolean(source[normalized]);
}

function hintText(session) {
  if (session.hintUsed) {
    return "💡 You already used your hint. Keep working with the evidence.";
  }

  const answer = normalize(session.scenario.answer);
  const source = session.scenario.clues || session.scenario.choices || {};
  const direct = source[answer];

  session.hintUsed = true;

  if (direct) {
    return [
      "💡 DETECTIVE'S HINT",
      "",
      "One of the strongest leads concerns: " + answer + ".",
      "Inspect it and compare it against the rest of the evidence.",
      "",
      "Your final reward will be reduced because a hint was used.",
    ].join("\n");
  }

  if (session.mode === "case" && session.scenario.suspects && session.scenario.suspects[answer]) {
    return [
      "💡 DETECTIVE'S HINT",
      "",
      "Pay close attention to " + answer + " and whether their statement survives the physical evidence.",
      "",
      "Your final reward will be reduced because a hint was used.",
    ].join("\n");
  }

  return [
    "💡 DETECTIVE'S HINT",
    "",
    "The answer is tied to the strongest contradiction in the evidence you can inspect.",
    "Look for the clue that explains the anomaly rather than the most dramatic detail.",
    "",
    "Your final reward will be reduced because a hint was used.",
  ].join("\n");
}
async function start(api, event, mode) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);
  const sessionKey = key(threadID, userID);

  if (sessions.has(sessionKey)) {
    await send(api, threadID, "🕵️ You already have an active investigation. Finish it before starting another.");
    return true;
  }

  const scenario = pickForSession(pools[mode] || [], sessionKey);
  if (!scenario) {
    await send(api, threadID, "🕯️ No investigations are currently available for this mode.");
    return true;
  }

  const session = {
    threadID,
    userID,
    mode,
    scenario,
    startedAt: Date.now(),
    evidenceFound: 0,
    discovered: new Set(),
    totalClues: clueCount(scenario, mode),
    hintUsed: false,
    timer: null,
    lastMessageID: null,
  };

  // Reserve the session before the database call so two rapid !case
  // messages cannot create two simultaneous investigations for the same user.
  sessions.set(sessionKey, session);

  try {
    await incrementPlayed(threadID, userID);
  } catch (error) {
    sessions.delete(sessionKey);
    console.error("[INVESTIGATIONS] Failed to start profile session:", error);
    await send(api, threadID, "🕯️ The investigation could not be started. Please try again.");
    return true;
  }

  session.timer = setTimeout(() => {
    void finish(api, session, {
      completed: false,
      reason: "⏰ Time expired. The case remains unsolved.",
    });
  }, SESSION_TIMEOUT_MS);

  const sent = await send(api, threadID, sessionText(session));
  if (sent && sent.messageID) session.lastMessageID = sent.messageID;
  return true;
}

async function inspect(session, target) {
  const normalized = normalize(target);
  if (!normalized) return "Tell me what you want to inspect.";

  const entries = inspectableEntries(session.scenario, session.mode);
  const entry = entries.find((item) => normalize(item.key) === normalized);

  if (!entry) {
    const available = entries.map((item) => item.label).join(", ");
    return [
      "❔ I can't find anything matching \"" + target + "\".",
      "",
      "Try one of these:",
      available || "No inspectable evidence is configured for this scenario.",
    ].join("\n");
  }

  const discoveryKey = session.mode + ":" + entry.key;
  const firstDiscovery = !session.discovered.has(discoveryKey);

  if (firstDiscovery) {
    session.discovered.add(discoveryKey);
    session.evidenceFound += 1;
  }

  return [
    firstDiscovery ? "🔎 NEW EVIDENCE" : "🔎 EVIDENCE REVIEW",
    "",
    String(entry.value),
    "",
    "Evidence found: " + session.evidenceFound + "/" + session.totalClues,
    firstDiscovery
      ? "✓ This evidence is now added to your investigation."
      : "↻ You already examined this evidence.",
  ].join("\n");
}
async function conclude(api, session, answer) {
  const normalized = normalize(answer);
  const requiredEvidence = Math.min(MIN_EVIDENCE_TO_SOLVE, session.totalClues);

  if (session.evidenceFound < requiredEvidence) {
    await send(api, session.threadID, [
      "🔒 NOT ENOUGH EVIDENCE",
      "",
      "You need at least " + requiredEvidence + " pieces of evidence before making the final call.",
      "Evidence found: " + session.evidenceFound + "/" + session.totalClues,
      "",
      "Use !" + session.mode + " inspect <clue> to investigate further.",
    ].join("\n"));
    return true;
  }

  if (!answerIsKnown(session, normalized)) {
    await send(api, session.threadID, [
      "❔ \"" + answer + "\" is not a valid conclusion for this investigation.",
      "",
      "Review the available evidence with !" + session.mode + " status.",
    ].join("\n"));
    return true;
  }

  const correct = normalized === normalize(session.scenario.answer);

  if (!correct) {
    await send(api, session.threadID, [
      "❌ WRONG CONCLUSION",
      "",
      "That theory does not fit the complete evidence.",
      "The investigation remains open. Keep examining clues.",
      "",
      "Evidence found: " + session.evidenceFound + "/" + session.totalClues,
    ].join("\n"));
    return true;
  }

  await send(api, session.threadID, [
    "✓ CONCLUSION ACCEPTED",
    "",
    session.scenario.explanation || "The evidence supports your conclusion.",
    "",
    session.hintUsed
      ? "💡 You solved it with a hint."
      : "🧠 You solved it from the evidence.",
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

  if (!action || action === "status" || action === "help") {
    await send(api, event.threadID, sessionText(session));
    return true;
  }

  if (action === "hint") {
    await send(api, event.threadID, hintText(session));
    return true;
  }

  if (["inspect", "examine", "explore", "investigate", "search", "look"].includes(action)) {
    const result = await inspect(session, target);
    await send(api, event.threadID, result);
    return true;
  }

  const finalActions = [
    "accuse",
    "conclude",
    "execute",
    "verdict",
    "choose",
    "escape",
    "solve",
    "final",
  ];

  if (finalActions.includes(action)) {
    return conclude(api, session, target || action);
  }

  if (action === "quit" || action === "abandon" || action === "cancel") {
    await finish(api, session, {
      completed: false,
      reason: "You abandoned the investigation.",
    });
    return true;
  }

  await send(api, event.threadID, [
    "❔ I don't recognize \"" + args[0] + "\".",
    "",
    "Use !" + mode + " status to see the available actions.",
  ].join("\n"));
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
