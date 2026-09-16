"use strict";

const os = require("os");

// ============================================================
// ECLIPSE SYSTEM CONSOLE
// ============================================================
//
// Admin-only diagnostic system.
//
// Commands:
// !debug
// !debug ai
// !debug adaptation
// !debug banat
// !debug rpg
// !debug games
// !debug env
// !debug memory
//
// Never exposes:
// - API keys
// - cookies
// - passwords
// - raw training messages
// - private adaptation data
// ============================================================

const db = require("./db");

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const startedAt = Date.now();


// ============================================================
// SAFE HELPERS
// ============================================================

function safeRequire(path) {
  try {
    const module = require(path);

    return {
      ok: true,
      module,
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}


function status(ok) {
  return ok ? "🟢 ONLINE" : "🔴 OFFLINE";
}


function configured(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);

  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);

  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);

  const secs = Math.floor(seconds % 60);

  const parts = [];

  if (days) {
    parts.push(`${days}d`);
  }

  if (hours) {
    parts.push(`${hours}h`);
  }

  if (minutes) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${secs}s`);

  return parts.join(" ");
}


function memoryStats() {
  const memory = process.memoryUsage();

  return {
    rss: Math.round(
      memory.rss / 1024 / 1024
    ),

    heapUsed: Math.round(
      memory.heapUsed / 1024 / 1024
    ),

    heapTotal: Math.round(
      memory.heapTotal / 1024 / 1024
    ),

    external: Math.round(
      memory.external / 1024 / 1024
    ),
  };
}


function moduleStatus(path) {
  const result = safeRequire(path);

  if (!result.ok) {
    return {
      ok: false,
      detail: result.error?.message || "Load failed",
    };
  }

  return {
    ok: true,
    detail: "Loaded",
  };
}


// ============================================================
// ADMIN CHECK
// ============================================================

function isAdmin(senderID) {
  return ADMIN_IDS.includes(
    String(senderID || "").trim()
  );
}


// ============================================================
// DATABASE CHECK
// ============================================================

async function checkDatabase() {
  try {
    if (
      !db ||
      typeof db.query !== "function"
    ) {
      return {
        ok: false,
        detail: "db.query unavailable",
      };
    }

    await db.query(
      "SELECT 1 AS eclipse_debug"
    );

    return {
      ok: true,
      detail: "Neon PostgreSQL responded",
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error?.message || "Database query failed",
    };
  }
}


// ============================================================
// AI CHECK
// ============================================================

function checkAI() {
  const character =
    moduleStatus("./ai/characters");

  const prompt =
    moduleStatus("./ai/prompt");

  const provider =
    moduleStatus("./ai/provider");

  const memory =
    moduleStatus("./ai/memory");

  const history =
    moduleStatus("./ai/history");

  const access =
    moduleStatus("./ai/access");

  return {
    ok:
      character.ok &&
      prompt.ok &&
      provider.ok &&
      memory.ok &&
      history.ok &&
      access.ok,

    character,
    prompt,
    provider,
    memory,
    history,
    access,
  };
}


// ============================================================
// ADAPTATION CHECK
// ============================================================

function checkAdaptation() {
  const adaptation =
    safeRequire("./ai/adaptation");

  if (!adaptation.ok) {
    return {
      ok: false,
      loaded: false,
      ownerConfigured:
        configured(
          process.env.BOT_OWNER_ID
        ),
      detail:
        adaptation.error?.message ||
        "Could not load adaptation.js",
    };
  }

  const requiredFunctions = [
    "handleTrainingCommand",
    "observeMessage",
    "getAdaptation",
    "getAdaptationContext",
    "resetAdaptation",
  ];

  const missing =
    requiredFunctions.filter(
      (name) =>
        typeof adaptation.module[name] !==
        "function"
    );

  return {
    ok: missing.length === 0,

    loaded: true,

    ownerConfigured:
      configured(
        process.env.BOT_OWNER_ID
      ),

    missing,
  };
}


// ============================================================
// RPG CHECK
// ============================================================

function checkRPG() {
  const rpg =
    moduleStatus("./rpg");

  const character =
    moduleStatus("./rpg/character-ai");

  const loveQuest =
    moduleStatus("./rpg/love-quest");

  const classes =
    moduleStatus("./rpg/classes");

  return {
    ok:
      rpg.ok &&
      character.ok &&
      loveQuest.ok &&
      classes.ok,

    rpg,
    character,
    loveQuest,
    classes,
  };
}


// ============================================================
// GAMES CHECK
// ============================================================

function checkGames() {
  return moduleStatus("./games");
}


// ============================================================
// MODERATION CHECK
// ============================================================

function checkModeration() {
  return moduleStatus("./moderation");
}


// ============================================================
// TRIGGER CHECK
// ============================================================

function checkTriggers() {
  return moduleStatus("./triggers");
}


// ============================================================
// ENVIRONMENT CHECK
// ============================================================
//
// Only says CONFIGURED / MISSING.
// NEVER prints values.
// ============================================================

function checkEnvironment() {
  const variables = {
    ADMIN_IDS:
      configured(process.env.ADMIN_IDS),

    BOT_OWNER_ID:
      configured(process.env.BOT_OWNER_ID),

    FB_COOKIES:
      configured(process.env.FB_COOKIES),

    PORT:
      configured(process.env.PORT),

    RANDOM_ROAST:
      configured(process.env.RANDOM_ROAST),

    RANDOM_ROAST_COOLDOWN_MS:
      configured(
        process.env.RANDOM_ROAST_COOLDOWN_MS
      ),

    STARTUP_THREAD_ID:
      configured(
        process.env.STARTUP_THREAD_ID
      ),
  };

  return variables;
}


// ============================================================
// THREAD STATUS
// ============================================================

async function checkThread(threadID) {
  const result = {
    banat: false,
    games: false,
  };

  try {
    if (
      typeof db.isRoastEnabled ===
      "function"
    ) {
      result.banat =
        await db.isRoastEnabled(
          threadID
        );
    }
  } catch (error) {
    result.banat = null;
    result.banatError =
      error?.message || "Banat check failed";
  }

  try {
    if (
      typeof db.isGameEnabled ===
      "function"
    ) {
      result.games =
        await db.isGameEnabled(
          threadID
        );
    }
  } catch (error) {
    result.games = null;
    result.gamesError =
      error?.message || "Games check failed";
  }

  return result;
}


// ============================================================
// FULL SYSTEM SCAN
// ============================================================

async function buildFullReport(threadID) {
  const database =
    await checkDatabase();

  const ai =
    checkAI();

  const adaptation =
    checkAdaptation();

  const rpg =
    checkRPG();

  const games =
    checkGames();

  const moderation =
    checkModeration();

  const triggers =
    checkTriggers();

  const environment =
    checkEnvironment();

  const thread =
    await checkThread(threadID);

  const memory =
    memoryStats();

  const uptime =
    process.uptime();

  const systems = [
    database.ok,
    ai.ok,
    adaptation.ok,
    rpg.ok,
    games.ok,
    moderation.ok,
    triggers.ok,
  ];

  const online =
    systems.filter(Boolean).length;

  return {
    database,
    ai,
    adaptation,
    rpg,
    games,
    moderation,
    triggers,
    environment,
    thread,
    memory,
    uptime,
    online,
    total: systems.length,
  };
}


// ============================================================
// MAIN DEBUG REPORT
// ============================================================

function buildMainReport(report) {
  const env = report.environment;

  const adaptationOwner =
    env.BOT_OWNER_ID
      ? "CONFIGURED"
      : "MISSING";

  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "      🌑 ECLIPSE",
    "     SYSTEM CONSOLE",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `⚡ CORE HEALTH`,
    `${status(report.database.ok)} DATABASE`,
    `${status(report.ai.ok)} AI SYSTEM`,
    `${status(report.adaptation.ok)} ADAPTATION`,
    `${status(report.rpg.ok)} RPG SYSTEM`,
    `${status(report.games.ok)} GAME ENGINE`,
    `${status(report.moderation.ok)} MODERATION`,
    `${status(report.triggers.ok)} TRIGGERS`,
    "",
    `📡 SYSTEMS: ${report.online}/${report.total} ONLINE`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "🌐 CURRENT GC",
    "",
    `🔥 BANAT: ${
      report.thread.banat === true
        ? "🟢 ON"
        : report.thread.banat === false
        ? "🔴 OFF"
        : "⚠️ UNKNOWN"
    }`,
    "",
    `🎮 GAMES: ${
      report.thread.games === true
        ? "🟢 ON"
        : report.thread.games === false
        ? "🔴 OFF"
        : "⚠️ UNKNOWN"
    }`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "🧠 AI CONFIG",
    "",
    `Character: ${
      report.ai.character.ok
        ? "🟢 loaded"
        : "🔴 failed"
    }`,
    `Provider: ${
      report.ai.provider.ok
        ? "🟢 loaded"
        : "🔴 failed"
    }`,
    `Memory: ${
      report.ai.memory.ok
        ? "🟢 loaded"
        : "🔴 failed"
    }`,
    `History: ${
      report.ai.history.ok
        ? "🟢 loaded"
        : "🔴 failed"
    }`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "🧬 ADAPTATION",
    "",
    `Module: ${
      report.adaptation.loaded
        ? "🟢 loaded"
        : "🔴 failed"
    }`,
    `Owner: ${adaptationOwner}`,
    `Profile API: ${
      report.adaptation.ok
        ? "🟢 ready"
        : "🔴 incomplete"
    }`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "🖥️ PROCESS",
    "",
    `Uptime: ${formatUptime(report.uptime)}`,
    `RAM: ${report.memory.rss} MB RSS`,
    `Heap: ${report.memory.heapUsed}/${report.memory.heapTotal} MB`,
    `Host: ${os.platform()} ${os.arch()}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "🔐 ENVIRONMENT",
    "",
    `ADMIN_IDS: ${
      env.ADMIN_IDS
        ? "🟢"
        : "🔴"
    }`,
    `BOT_OWNER_ID: ${
      env.BOT_OWNER_ID
        ? "🟢"
        : "🔴"
    }`,
    `FB_COOKIES: ${
      env.FB_COOKIES
        ? "🟢"
        : "🔴"
    }`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "🛠️ COMMANDS",
    "",
    "!debug",
    "!debug ai",
    "!debug adaptation",
    "!debug banat",
    "!debug rpg",
    "!debug games",
    "!debug env",
    "!debug memory",
    "",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
  ].join("\n");
}


// ============================================================
// AI REPORT
// ============================================================

function buildAIReport(report) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "       AI DIAGNOSTIC",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `Character   ${status(report.character.ok)}`,
    `Prompt      ${status(report.prompt.ok)}`,
    `Provider    ${status(report.provider.ok)}`,
    `Memory      ${status(report.memory.ok)}`,
    `History     ${status(report.history.ok)}`,
    `Access      ${status(report.access.ok)}`,
    "",
    `Overall: ${
      report.ok
        ? "🟢 AI STACK READY"
        : "🔴 AI STACK HAS ERRORS"
    }`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}


// ============================================================
// ADAPTATION REPORT
// ============================================================

function buildAdaptationReport(report) {
  const missing =
    report.missing?.length
      ? report.missing.join(", ")
      : "none";

  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "   ADAPTATION CONSOLE",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `Module: ${
      report.loaded
        ? "🟢 LOADED"
        : "🔴 FAILED"
    }`,
    `Owner ID: ${
      report.ownerConfigured
        ? "🟢 CONFIGURED"
        : "🔴 MISSING"
    }`,
    `API: ${
      report.ok
        ? "🟢 COMPLETE"
        : "🔴 INCOMPLETE"
    }`,
    "",
    `Missing: ${missing}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
    "",
    report.ok
      ? "🧬 Learning interface is ready."
      : "⚠️ Adaptation needs attention.",
    "",
  ].join("\n");
}


// ============================================================
// BANAT REPORT
// ============================================================

function buildBanatReport(report) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "      BANAT SCAN",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `Current GC: ${
      report.banat === true
        ? "🟢 BANAT ON"
        : report.banat === false
        ? "🔴 BANAT OFF"
        : "⚠️ UNKNOWN"
    }`,
    "",
    `Random Roast: ${
      /^(0|false|no|off)$/i.test(
        process.env.RANDOM_ROAST || ""
      )
        ? "🔴 disabled"
        : "🟢 enabled"
    }`,
    "",
    `Trigger Module: ${
      report.triggers.ok
        ? "🟢 loaded"
        : "🔴 failed"
    }`,
    "",
    "Targeted triggers are",
    "gated by the current GC",
    "Banat status.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}


// ============================================================
// RPG REPORT
// ============================================================

function buildRPGReport(report) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "      RPG DIAGNOSTIC",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `RPG Core       ${status(report.rpg.ok)}`,
    `Character AI   ${status(report.character.ok)}`,
    `Love Quest     ${status(report.loveQuest.ok)}`,
    `Classes        ${status(report.classes.ok)}`,
    "",
    report.ok
      ? "⚔️ RPG STACK READY"
      : "⚠️ RPG STACK HAS ERRORS",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}


// ============================================================
// GAMES REPORT
// ============================================================

function buildGamesReport(report, threadState) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "     GAME DIAGNOSTIC",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `Module: ${
      report.ok
        ? "🟢 loaded"
        : "🔴 failed"
    }`,
    "",
    `Current GC: ${
      threadState.games === true
        ? "🟢 ENABLED"
        : threadState.games === false
        ? "🔴 DISABLED"
        : "⚠️ UNKNOWN"
    }`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}


// ============================================================
// ENV REPORT
// ============================================================

function buildEnvReport(env) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "    CONFIGURATION SCAN",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `ADMIN_IDS: ${env.ADMIN_IDS ? "🟢 SET" : "🔴 MISSING"}`,
    `BOT_OWNER_ID: ${env.BOT_OWNER_ID ? "🟢 SET" : "🔴 MISSING"}`,
    `FB_COOKIES: ${env.FB_COOKIES ? "🟢 SET" : "🔴 MISSING"}`,
    `PORT: ${env.PORT ? "🟢 SET" : "⚪ DEFAULT"}`,
    `RANDOM_ROAST: ${env.RANDOM_ROAST ? "🟢 SET" : "⚪ DEFAULT"}`,
    `ROAST COOLDOWN: ${env.RANDOM_ROAST_COOLDOWN_MS ? "🟢 SET" : "⚪ DEFAULT"}`,
    `STARTUP THREAD: ${env.STARTUP_THREAD_ID ? "🟢 SET" : "⚪ OPTIONAL"}`,
    "",
    "🔐 Values are intentionally hidden.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}


// ============================================================
// MEMORY REPORT
// ============================================================

function buildMemoryReport(memory) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "     MEMORY MONITOR",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `RSS       ${memory.rss} MB`,
    `Heap Used ${memory.heapUsed} MB`,
    `Heap Max  ${memory.heapTotal} MB`,
    `External  ${memory.external} MB`,
    "",
    memory.rss < 450
      ? "🟢 Memory usage looks normal."
      : memory.rss < 650
      ? "🟡 Memory usage is elevated."
      : "🔴 Memory usage is high.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}


// ============================================================
// COMMAND HANDLER
// ============================================================

async function handleDebugCommand(
  api,
  event,
  text,
  originalText
) {
  const senderID =
    String(
      event?.senderID || ""
    ).trim();

  if (
    !/^!debug(?:\s|$)/i.test(
      originalText
    )
  ) {
    return false;
  }

  // Admin only.
  if (!isAdmin(senderID)) {
    return true;
  }

  const args =
    originalText
      .trim()
      .split(/\s+/)
      .slice(1);

  const subcommand =
    (
      args[0] || ""
    ).toLowerCase();

  try {
    let message = "";

    if (!subcommand) {
      const report =
        await buildFullReport(
          String(event.threadID)
        );

      message =
        buildMainReport(report);
    }

    else if (
      subcommand === "ai"
    ) {
      const report =
        checkAI();

      message =
        buildAIReport(report);
    }

    else if (
      subcommand === "adaptation"
    ) {
      const report =
        checkAdaptation();

      message =
        buildAdaptationReport(
          report
        );
    }

    else if (
      subcommand === "banat"
    ) {
      const thread =
        await checkThread(
          String(event.threadID)
        );

      const triggers =
        checkTriggers();

      message =
        buildBanatReport({
          ...thread,
          triggers,
        });
    }

    else if (
      subcommand === "rpg"
    ) {
      const report =
        checkRPG();

      message =
        buildRPGReport(report);
    }

    else if (
      subcommand === "games"
    ) {
      const report =
        checkGames();

      const thread =
        await checkThread(
          String(event.threadID)
        );

      message =
        buildGamesReport(
          report,
          thread
        );
    }

    else if (
      subcommand === "env"
    ) {
      message =
        buildEnvReport(
          checkEnvironment()
        );
    }

    else if (
      subcommand === "memory"
    ) {
      message =
        buildMemoryReport(
          memoryStats()
        );
    }

    else {
      message = [
        "╭━━━━━━━━━━━━━━━━━━━━━━╮",
        "       🌑 ECLIPSE",
        "    UNKNOWN DIAGNOSTIC",
        "╰━━━━━━━━━━━━━━━━━━━━━━╯",
        "",
        `Unknown module: ${subcommand}`,
        "",
        "Available:",
        "!debug",
        "!debug ai",
        "!debug adaptation",
        "!debug banat",
        "!debug rpg",
        "!debug games",
        "!debug env",
        "!debug memory",
      ].join("\n");
    }

    api.sendMessage(
      message,
      event.threadID,
      (error) => {
        if (error) {
          console.error(
            "[DEBUG] Send failed:",
            error
          );
        }
      }
    );
  } catch (error) {
    console.error(
      "[DEBUG] Diagnostic failed:",
      error
    );

    api.sendMessage(
      [
        "🌑 ECLIPSE SYSTEM CONSOLE",
        "",
        "🔴 Diagnostic failed.",
        "",
        "Check Render logs for details.",
      ].join("\n"),
      event.threadID,
      () => {}
    );
  }

  return true;
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  handleDebugCommand,
};
