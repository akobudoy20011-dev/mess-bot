"use strict";

const fs = require("fs");
const path = require("path");
const db = require("./db");

// ============================================================
// ECLIPSE AUTO CLEANUP
// ============================================================
//
// Purpose:
// - Remove expired temporary sessions
// - Remove stale temporary files
// - Prevent in-memory data from accumulating forever
// - Keep permanent RPG/player/economy data untouched
//
// IMPORTANT:
// This cleaner does NOT delete:
// - rpg_players
// - rpg_armies
// - rpg_buildings
// - XP
// - levels
// - classes
// - skills
// - equipment
// - property
// - kingdom progress
// - wallet/bank balances
//
// ============================================================

const CLEANUP_INTERVAL_MS =
  24 * 60 * 60 * 1000; // 24 hours

const TEMP_FILE_MAX_AGE_MS =
  3 * 24 * 60 * 60 * 1000; // 3 days

const CLEANUP_LOCK_TIMEOUT_MS =
  10 * 60 * 1000; // 10 minutes

let cleanupTimer = null;
let cleanupRunning = false;
let lastCleanupAt = 0;

// ============================================================
// HELPERS
// ============================================================

function isValidDate(date) {
  return (
    date instanceof Date &&
    !Number.isNaN(date.getTime())
  );
}

function isOlderThan(filePath, maxAgeMs) {
  try {
    const stats =
      fs.statSync(filePath);

    const modifiedAt =
      stats.mtime instanceof Date
        ? stats.mtime.getTime()
        : 0;

    if (!modifiedAt) {
      return false;
    }

    return (
      Date.now() - modifiedAt >
      maxAgeMs
    );
  } catch {
    return false;
  }
}

function safeDeleteFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);

    return true;
  } catch (error) {
    console.error(
      "[CLEANUP] Failed to delete file:",
      filePath,
      error.message
    );

    return false;
  }
}

function cleanDirectory(
  directory,
  maxAgeMs
) {
  let removed = 0;

  try {
    if (!fs.existsSync(directory)) {
      return 0;
    }

    const entries =
      fs.readdirSync(
        directory,
        {
          withFileTypes: true,
        }
      );

    for (const entry of entries) {
      // Do not recursively destroy directories.
      // Cleanup only removes files we explicitly identify.
      if (!entry.isFile()) {
        continue;
      }

      const filePath =
        path.join(
          directory,
          entry.name
        );

      if (
        isOlderThan(
          filePath,
          maxAgeMs
        )
      ) {
        if (
          safeDeleteFile(
            filePath
          )
        ) {
          removed++;
        }
      }
    }
  } catch (error) {
    console.error(
      "[CLEANUP] Directory scan failed:",
      directory,
      error.message
    );
  }

  return removed;
}

// ============================================================
// TEMPORARY FILE CLEANUP
// ============================================================

function cleanupTemporaryFiles() {
  let removed = 0;

  const directories = [
    path.join(
      __dirname,
      "tmp"
    ),

    path.join(
      __dirname,
      "temp"
    ),

    path.join(
      __dirname,
      "cache"
    ),
  ];

  for (const directory of directories) {
    removed += cleanDirectory(
      directory,
      TEMP_FILE_MAX_AGE_MS
    );
  }

  return removed;
}

// ============================================================
// RPG DATABASE CLEANUP
// ============================================================
//
// IMPORTANT:
// We intentionally DO NOT delete player records.
//
// Only cleanup tables if they actually exist.
// PostgreSQL's to_regclass() lets us safely check first.
//
// ============================================================

async function tableExists(
  tableName
) {
  try {
    const result =
      await db.query(
        `
        SELECT to_regclass($1) AS table_name
        `,
        [tableName]
      );

    return Boolean(
      result &&
      result.rows &&
      result.rows[0] &&
      result.rows[0].table_name
    );
  } catch (error) {
    console.error(
      "[CLEANUP] Table check failed:",
      tableName,
      error.message
    );

    return false;
  }
}

async function cleanupRPGTemporaryData() {
  let removed = 0;

  // ----------------------------------------------------------
  // These are ONLY examples of temporary tables.
  //
  // We check whether they exist before touching them.
  // If your database doesn't have them, nothing happens.
  // ----------------------------------------------------------

  const possibleTables = [
    "rpg_sessions",
    "rpg_combat_sessions",
    "rpg_hunt_sessions",
    "rpg_dungeon_sessions",
    "rpg_march_sessions",
  ];

  for (const table of possibleTables) {
    const exists =
      await tableExists(
        table
      );

    if (!exists) {
      continue;
    }

    try {
      const result =
        await db.query(
          `
          DELETE FROM ${table}
          WHERE
            (
              expires_at IS NOT NULL
              AND expires_at < NOW()
            )
            OR
            (
              created_at IS NOT NULL
              AND created_at < NOW() - INTERVAL '3 days'
            )
          `
        );

      removed +=
        Number(
          result.rowCount || 0
        );
    } catch (error) {
      // Some projects may have a table with a different schema.
      // Do not crash the bot because cleanup encountered it.
      console.error(
        `[CLEANUP] Could not clean ${table}:`,
        error.message
      );
    }
  }

  return removed;
}

// ============================================================
// GAME DATABASE CLEANUP
// ============================================================

async function cleanupGameTemporaryData() {
  let removed = 0;

  const possibleTables = [
    "game_sessions",
    "active_games",
    "trivia_sessions",
    "riddle_sessions",
    "blackjack_sessions",
  ];

  for (const table of possibleTables) {
    const exists =
      await tableExists(
        table
      );

    if (!exists) {
      continue;
    }

    try {
      const result =
        await db.query(
          `
          DELETE FROM ${table}
          WHERE
            (
              expires_at IS NOT NULL
              AND expires_at < NOW()
            )
            OR
            (
              created_at IS NOT NULL
              AND created_at < NOW() - INTERVAL '3 days'
            )
          `
        );

      removed +=
        Number(
          result.rowCount || 0
        );
    } catch (error) {
      console.error(
        `[CLEANUP] Could not clean ${table}:`,
        error.message
      );
    }
  }

  return removed;
}

// ============================================================
// AI TEMPORARY DATA CLEANUP
// ============================================================

async function cleanupAITemporaryData() {
  let removed = 0;

  const possibleTables = [
    "ai_cache",
    "ai_sessions",
    "ai_temp_context",
    "ai_pending",
  ];

  for (const table of possibleTables) {
    const exists =
      await tableExists(
        table
      );

    if (!exists) {
      continue;
    }

    try {
      const result =
        await db.query(
          `
          DELETE FROM ${table}
          WHERE
            (
              expires_at IS NOT NULL
              AND expires_at < NOW()
            )
            OR
            (
              created_at IS NOT NULL
              AND created_at < NOW() - INTERVAL '3 days'
            )
          `
        );

      removed +=
        Number(
          result.rowCount || 0
        );
    } catch (error) {
      console.error(
        `[CLEANUP] Could not clean ${table}:`,
        error.message
      );
    }
  }

  return removed;
}

// ============================================================
// OLD DEBUG / LOG FILE CLEANUP
// ============================================================
//
// Only cleans files inside explicitly named directories.
// It does NOT touch source code.
//
// ============================================================

function cleanupOldLogs() {
  let removed = 0;

  const directories = [
    path.join(
      __dirname,
      "logs"
    ),

    path.join(
      __dirname,
      "debug-logs"
    ),
  ];

  for (const directory of directories) {
    removed += cleanDirectory(
      directory,
      TEMP_FILE_MAX_AGE_MS
    );
  }

  return removed;
}

// ============================================================
// DATABASE MAINTENANCE
// ============================================================

async function databaseMaintenance() {
  try {
    // PostgreSQL can reclaim space from dead rows with VACUUM.
    //
    // We deliberately use ANALYZE instead of VACUUM here because
    // VACUUM may have different restrictions depending on the
    // database connection configuration.
    await db.query(
      "ANALYZE"
    );

    return true;
  } catch (error) {
    console.error(
      "[CLEANUP] Database maintenance failed:",
      error.message
    );

    return false;
  }
}

// ============================================================
// MAIN CLEANUP
// ============================================================

async function runCleanup(
  options = {}
) {
  if (cleanupRunning) {
    console.log(
      "[CLEANUP] Cleanup already running."
    );

    return {
      skipped: true,
    };
  }

  cleanupRunning = true;

  const startedAt =
    Date.now();

  console.log(
    "========================================"
  );

  console.log(
    "[CLEANUP] ECLIPSE AUTO CLEANUP STARTED"
  );

  console.log(
    "========================================"
  );

  const results = {
    temporaryFiles: 0,
    logs: 0,
    rpg: 0,
    games: 0,
    ai: 0,
    databaseMaintenance: false,
    durationMs: 0,
  };

  try {
    // --------------------------------------------------------
    // Files
    // --------------------------------------------------------

    results.temporaryFiles =
      cleanupTemporaryFiles();

    results.logs =
      cleanupOldLogs();

    // --------------------------------------------------------
    // Database
    // --------------------------------------------------------

    results.rpg =
      await cleanupRPGTemporaryData();

    results.games =
      await cleanupGameTemporaryData();

    results.ai =
      await cleanupAITemporaryData();

    // --------------------------------------------------------
    // Database statistics
    // --------------------------------------------------------

    results.databaseMaintenance =
      await databaseMaintenance();

    results.durationMs =
      Date.now() -
      startedAt;

    lastCleanupAt =
      Date.now();

    console.log(
      "[CLEANUP] Temporary files removed:",
      results.temporaryFiles
    );

    console.log(
      "[CLEANUP] Old logs removed:",
      results.logs
    );

    console.log(
      "[CLEANUP] RPG records removed:",
      results.rpg
    );

    console.log(
      "[CLEANUP] Game records removed:",
      results.games
    );

    console.log(
      "[CLEANUP] AI records removed:",
      results.ai
    );

    console.log(
      "[CLEANUP] Database maintenance:",
      results.databaseMaintenance
        ? "OK"
        : "FAILED"
    );

    console.log(
      `[CLEANUP] Completed in ${results.durationMs}ms`
    );

    return results;
  } catch (error) {
    console.error(
      "[CLEANUP] Unexpected cleanup error:",
      error
    );

    return {
      ...results,
      error: error.message,
    };
  } finally {
    cleanupRunning =
      false;
  }
}

// ============================================================
// START AUTOMATIC CLEANUP
// ============================================================

function startCleanupScheduler() {
  if (cleanupTimer) {
    return;
  }

  console.log(
    "[CLEANUP] Scheduler started."
  );

  // Run once shortly after startup.
  setTimeout(() => {
    runCleanup().catch(
      (error) => {
        console.error(
          "[CLEANUP] Startup cleanup failed:",
          error
        );
      }
    );
  }, 30 * 1000);

  // Then run every 24 hours.
  cleanupTimer =
    setInterval(() => {
      runCleanup().catch(
        (error) => {
          console.error(
            "[CLEANUP] Scheduled cleanup failed:",
            error
          );
        }
      );
    }, CLEANUP_INTERVAL_MS);

  // Prevent the timer from keeping Node alive
  // if the rest of the application shuts down.
  if (
    cleanupTimer &&
    typeof cleanupTimer.unref ===
      "function"
  ) {
    cleanupTimer.unref();
  }
}

// ============================================================
// STOP SCHEDULER
// ============================================================

function stopCleanupScheduler() {
  if (!cleanupTimer) {
    return;
  }

  clearInterval(
    cleanupTimer
  );

  cleanupTimer = null;

  console.log(
    "[CLEANUP] Scheduler stopped."
  );
}

// ============================================================
// STATUS
// ============================================================

function getCleanupStatus() {
  return {
    running:
      cleanupRunning,

    schedulerActive:
      Boolean(cleanupTimer),

    lastCleanupAt:
      lastCleanupAt
        ? new Date(
            lastCleanupAt
          ).toISOString()
        : null,

    cleanupIntervalMs:
      CLEANUP_INTERVAL_MS,

    temporaryFileMaxAgeMs:
      TEMP_FILE_MAX_AGE_MS,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  runCleanup,
  startCleanupScheduler,
  stopCleanupScheduler,
  getCleanupStatus,
};
