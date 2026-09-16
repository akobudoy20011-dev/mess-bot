"use strict";

const os = require("os");
const db = require("./db");

const ADMIN_IDS = String(
  process.env.ADMIN_IDS || ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// ============================================================
// HELPERS
// ============================================================

function safeRequire(path) {
  try {
    return {
      ok: true,
      module: require(path),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

function status(ok) {
  return ok ? "🟢 ONLINE" : "🔴 ERROR";
}

function configured(value) {
  return value && String(value).trim()
    ? "🟢 CONFIGURED"
    : "🔴 MISSING";
}

function formatUptime(seconds) {
  seconds = Math.floor(seconds);

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function memoryStats() {
  const mem = process.memoryUsage();

  const total = os.totalmem();
  const free = os.freemem();

  const rssMB =
    mem.rss / 1024 / 1024;

  const heapUsedMB =
    mem.heapUsed / 1024 / 1024;

  const heapTotalMB =
    mem.heapTotal / 1024 / 1024;

  const externalMB =
    mem.external / 1024 / 1024;

  const totalMB =
    total / 1024 / 1024;

  const freeMB =
    free / 1024 / 1024;

  const usedMB =
    totalMB - freeMB;

  const ramUsagePercent =
    total > 0
      ? (usedMB / totalMB) * 100
      : 0;

  return {
    rssMB: rssMB.toFixed(0),
    heapUsedMB: heapUsedMB.toFixed(0),
    heapTotalMB: heapTotalMB.toFixed(0),
    externalMB: externalMB.toFixed(0),

    totalMB: totalMB.toFixed(0),
    freeMB: freeMB.toFixed(0),
    usedMB: usedMB.toFixed(0),

    ramUsagePercent:
      ramUsagePercent.toFixed(1),
  };
}

function moduleStatus(path) {
  const result = safeRequire(path);

  return {
    ok: result.ok,
    error: result.error || null,
  };
}

function isAdmin(senderID) {
  return ADMIN_IDS.includes(
    String(senderID)
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
        detail:
          "db.query() is unavailable",
      };
    }

    await db.query(
      "SELECT 1 AS eclipse_debug"
    );

    return {
      ok: true,
      detail: "PostgreSQL responding",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error.message,
    };
  }
}

// ============================================================
// AI CHECK
// ============================================================

function checkAI() {
  const modules = {
    characters:
      moduleStatus("./ai/characters"),

    prompt:
      moduleStatus("./ai/prompt"),

    provider:
      moduleStatus("./ai/provider"),

    memory:
      moduleStatus("./ai/memory"),

    history:
      moduleStatus("./ai/history"),

    access:
      moduleStatus("./ai/access"),
  };

  const ok = Object.values(
    modules
  ).every((item) => item.ok);

  return {
    ok,
    modules,
  };
}

// ============================================================
// ADAPTATION CHECK
// ============================================================

function checkAdaptation() {
  const result =
    safeRequire("./ai/adaptation");

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
    };
  }

  const adaptation =
    result.module;

  const required = [
    "handleTrainingCommand",
    "observeMessage",
    "getAdaptation",
    "getAdaptationContext",
    "resetAdaptation",
  ];

  const missing =
    required.filter(
      (name) =>
        typeof adaptation[name] !==
        "function"
    );

  return {
    ok: missing.length === 0,
    missing,
  };
}

// ============================================================
// RPG CHECK
// ============================================================

function checkRPG() {
  const modules = {
    main:
      moduleStatus("./rpg"),

    characterAI:
      moduleStatus("./rpg/character-ai"),

    loveQuest:
      moduleStatus("./rpg/love-quest"),

    classes:
      moduleStatus("./rpg/classes"),
  };

  const ok = Object.values(
    modules
  ).every((item) => item.ok);

  return {
    ok,
    modules,
  };
}

// ============================================================
// GAMES CHECK
// ============================================================

function checkGames() {
  const games =
    moduleStatus("./games");

  const trivia =
    moduleStatus("./trivia-manager");

  const riddles =
    moduleStatus("./riddle-manager");

  return {
    ok:
      games.ok &&
      trivia.ok &&
      riddles.ok,

    games,
    trivia,
    riddles,
  };
}

// ============================================================
// MODERATION CHECK
// ============================================================

function checkModeration() {
  const moderation =
    moduleStatus("./moderation");

  return {
    ok: moderation.ok,
    moderation,
  };
}

// ============================================================
// TRIGGER CHECK
// ============================================================

function checkTriggers() {
  const triggers =
    moduleStatus("./triggers");

  return {
    ok: triggers.ok,
    triggers,
  };
}

// ============================================================
// ENVIRONMENT CHECK
// ============================================================

function checkEnvironment() {
  return {
    ADMIN_IDS:
      configured(
        process.env.ADMIN_IDS
      ),

    BOT_OWNER_ID:
      configured(
        process.env.BOT_OWNER_ID
      ),

    FB_COOKIES:
      configured(
        process.env.FB_COOKIES
      ),

    PORT:
      configured(
        process.env.PORT
      ),

    RANDOM_ROAST:
      configured(
        process.env.RANDOM_ROAST
      ),

    RANDOM_ROAST_COOLDOWN_MS:
      configured(
        process.env.RANDOM_ROAST_COOLDOWN_MS
      ),

    STARTUP_THREAD_ID:
      configured(
        process.env.STARTUP_THREAD_ID
      ),
  };
}

// ============================================================
// THREAD CHECK
// ============================================================

async function checkThread(
  threadID
) {
  const result = {
    ok: true,
    banat: "UNKNOWN",
    games: "UNKNOWN",
  };

  try {
    if (
      typeof db.isRoastEnabled ===
      "function"
    ) {
      const enabled =
        await db.isRoastEnabled(
          threadID
        );

      result.banat = enabled
        ? "🟢 ON"
        : "🔴 OFF";
    }
  } catch (error) {
    result.ok = false;
    result.banat = "❌ ERROR";
  }

  try {
    if (
      typeof db.isGameEnabled ===
      "function"
    ) {
      const enabled =
        await db.isGameEnabled(
          threadID
        );

      result.games = enabled
        ? "🟢 ON"
        : "🔴 OFF";
    }
  } catch (error) {
    result.ok = false;
    result.games = "❌ ERROR";
  }

  return result;
}

// ============================================================
// FULL REPORT
// ============================================================

async function buildFullReport(
  threadID
) {
  const [
    database,
    ai,
    adaptation,
    rpg,
    games,
    moderation,
    triggers,
    thread,
  ] = await Promise.all([
    checkDatabase(),
    checkAI(),
    checkAdaptation(),
    checkRPG(),
    checkGames(),
    checkModeration(),
    checkTriggers(),
    checkThread(threadID),
  ]);

  const env =
    checkEnvironment();

  const memory =
    memoryStats();

  return {
    database,
    ai,
    adaptation,
    rpg,
    games,
    moderation,
    triggers,
    thread,
    env,
    memory,
  };
}

// ============================================================
// MAIN DEBUG REPORT
// ============================================================

function buildMainReport(
  report
) {
  const allSystems = [
    report.database.ok,
    report.ai.ok,
    report.adaptation.ok,
    report.rpg.ok,
    report.games.ok,
    report.moderation.ok,
    report.triggers.ok,
  ];

  const online =
    allSystems.filter(Boolean)
      .length;

  const total =
    allSystems.length;

  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "     SYSTEM CONSOLE",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `SYSTEMS     ${online}/${total} ONLINE`,
    "",
    `Database    ${status(
      report.database.ok
    )}`,
    `AI Core     ${status(
      report.ai.ok
    )}`,
    `Adaptation  ${status(
      report.adaptation.ok
    )}`,
    `RPG Core    ${status(
      report.rpg.ok
    )}`,
    `Games       ${status(
      report.games.ok
    )}`,
    `Moderation  ${status(
      report.moderation.ok
    )}`,
    `Triggers    ${status(
      report.triggers.ok
    )}`,
    "",
    `Banat       ${report.thread.banat}`,
    `Games       ${report.thread.games}`,
    "",
    `Uptime      ${formatUptime(
      process.uptime()
    )}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// AI REPORT
// ============================================================

function buildAIReport(
  report
) {
  const m =
    report.ai.modules;

  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "          AI CORE",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `Characters  ${status(
      m.characters.ok
    )}`,
    `Prompt      ${status(
      m.prompt.ok
    )}`,
    `Provider    ${status(
      m.provider.ok
    )}`,
    `Memory      ${status(
      m.memory.ok
    )}`,
    `History     ${status(
      m.history.ok
    )}`,
    `Access      ${status(
      m.access.ok
    )}`,
    "",
    "AI modules loaded.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// ADAPTATION REPORT
// ============================================================

function buildAdaptationReport(
  report
) {
  const a =
    report.adaptation;

  if (!a.ok) {
    return [
      "╭━━━━━━━━━━━━━━━━━━━━━━╮",
      "       🌑 ECLIPSE",
      "       ADAPTATION",
      "╰━━━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🔴 Adaptation system error.",
      "",
      `Error: ${
        a.error ||
        "Missing functions"
      }`,
      "",
      a.missing &&
      a.missing.length
        ? `Missing: ${a.missing.join(
            ", "
          )}`
        : "",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
  }

  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "       ADAPTATION",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    "🟢 Module loaded.",
    "",
    "Training commands  ✓",
    "Message observer   ✓",
    "Profile storage    ✓",
    "Prompt context     ✓",
    "Reset system       ✓",
    "",
    "🔒 Training data protected.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// BANAT REPORT
// ============================================================

function buildBanatReport(
  report
) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "        BANAT",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `Current GC     ${report.thread.banat}`,
    "",
    "Trigger system",
    `             ${status(
      report.triggers.ok
    )}`,
    "",
    "Automatic roast",
    `             ${report.thread.banat}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// RPG REPORT
// ============================================================

function buildRPGReport(
  report
) {
  const r =
    report.rpg.modules;

  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "        RPG CORE",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `Main RPG      ${status(
      r.main.ok
    )}`,
    `Character AI  ${status(
      r.characterAI.ok
    )}`,
    `Love Quest     ${status(
      r.loveQuest.ok
    )}`,
    `Classes        ${status(
      r.classes.ok
    )}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// GAMES REPORT
// ============================================================

function buildGamesReport(
  report
) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "       GAME CENTER",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `Games          ${status(
      report.games.games.ok
    )}`,
    `Trivia         ${status(
      report.games.trivia.ok
    )}`,
    `Riddles        ${status(
      report.games.riddles.ok
    )}`,
    "",
    `GC Games       ${report.thread.games}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// ENV REPORT
// ============================================================

function buildEnvReport(
  report
) {
  const e =
    report.env;

  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "     ENVIRONMENT",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `ADMIN_IDS        ${e.ADMIN_IDS}`,
    `BOT_OWNER_ID     ${e.BOT_OWNER_ID}`,
    `FB_COOKIES       ${e.FB_COOKIES}`,
    `PORT             ${e.PORT}`,
    `RANDOM_ROAST     ${e.RANDOM_ROAST}`,
    `ROAST COOLDOWN   ${e.RANDOM_ROAST_COOLDOWN_MS}`,
    `STARTUP THREAD   ${e.STARTUP_THREAD_ID}`,
    "",
    "🔒 Values hidden for security.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// MEMORY REPORT
// ============================================================

function buildMemoryReport() {
  const m =
    memoryStats();

  const usage =
    Number(
      m.ramUsagePercent
    );

  let indicator =
    "🟢 Memory usage looks normal.";

  if (usage >= 80) {
    indicator =
      "🔴 High system RAM usage.";
  } else if (usage >= 65) {
    indicator =
      "🟡 Memory usage is elevated.";
  }

  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "     MEMORY MONITOR",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `RSS          ${m.rssMB} MB`,
    `Heap Used    ${m.heapUsedMB} MB`,
    `Heap Max     ${m.heapTotalMB} MB`,
    `External     ${m.externalMB} MB`,
    "",
    `RAM Usage    ${m.ramUsagePercent}%`,
    `RAM Free     ${m.freeMB} MB`,
    `RAM Total    ${m.totalMB} MB`,
    "",
    indicator,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// MEMORY / DATABASE REPORT
// ============================================================

function buildDatabaseReport(
  report
) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━━━╮",
    "       🌑 ECLIPSE",
    "       DATABASE",
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    status(
      report.database.ok
    ),
    "",
    report.database.detail,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================
// DEBUG COMMAND HANDLER
// ============================================================

async function handleDebugCommand(
  api,
  event,
  text,
  originalText
) {
  const cleanText =
    String(
      originalText ||
        text ||
        ""
    )
      .trim()
      .toLowerCase();

  if (
    !cleanText.startsWith(
      "!debug"
    )
  ) {
    return false;
  }

  const senderID =
    String(
      event.senderID ||
        event.senderId ||
        ""
    );

  // Non-admin users cannot use debug.
  if (!isAdmin(senderID)) {
    return true;
  }

  const threadID =
    String(
      event.threadID ||
        event.threadId ||
        ""
    );

  const parts =
    cleanText
      .split(/\s+/)
      .filter(Boolean);

  const command =
    parts[1] || "main";

  try {
    const report =
      await buildFullReport(
        threadID
      );

    let response;

    switch (command) {
      case "ai":
        response =
          buildAIReport(
            report
          );
        break;

      case "adaptation":
      case "adapt":
      case "training":
        response =
          buildAdaptationReport(
            report
          );
        break;

      case "banat":
      case "roast":
        response =
          buildBanatReport(
            report
          );
        break;

      case "rpg":
        response =
          buildRPGReport(
            report
          );
        break;

      case "games":
      case "game":
        response =
          buildGamesReport(
            report
          );
        break;

      case "env":
      case "environment":
        response =
          buildEnvReport(
            report
          );
        break;

      case "memory":
      case "ram":
        response =
          buildMemoryReport();
        break;

      case "db":
      case "database":
        response =
          buildDatabaseReport(
            report
          );
        break;

      case "main":
      default:
        response =
          buildMainReport(
            report
          );
        break;
    }

    if (
      typeof api.sendMessage ===
      "function"
    ) {
      await api.sendMessage(
        response,
        threadID
      );
    }

    return true;
  } catch (error) {
    console.error(
      "[DEBUG] Handler failed:",
      error
    );

    try {
      if (
        typeof api.sendMessage ===
        "function"
      ) {
        await api.sendMessage(
          "❌ ECLIPSE DEBUG encountered an internal error. Check Render logs.",
          threadID
        );
      }
    } catch (sendError) {
      console.error(
        "[DEBUG] Failed to send error:",
        sendError
      );
    }

    return true;
  }
}

module.exports = {
  handleDebugCommand,
};
