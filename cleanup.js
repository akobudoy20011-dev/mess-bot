"use strict";

const fs = require("fs");
const path = require("path");
const db = require("./db");

// ============================================================
// ECLIPSE MAINTENANCE ENGINE
// ============================================================
//
// Modes:
//   monitor  = inspect only
//   clean    = safe temporary cleanup
//   repair   = deterministic repairs
//   optimize = source/data analysis + recommendations
//   full     = clean + repair + optimize
//
// SAFETY:
// - Never deletes permanent player/economy/RPG progression.
// - Never blindly rewrites source code.
// - Source optimization produces a report first.
// - Database cleanup is schema-aware.
// - Every maintenance run is protected against overlap.
//
// ============================================================

const VERSION = "2.0.0";

const CLEANUP_INTERVAL_MS =
  24 * 60 * 60 * 1000;

const TEMP_FILE_MAX_AGE_MS =
  3 * 24 * 60 * 60 * 1000;

const INACTIVE_GC_DAYS =
  Number(process.env.GC_INACTIVE_DAYS || 30);

const GC_EXPENSIVE_FEATURE_DAYS =
  Number(
    process.env.GC_EXPENSIVE_FEATURE_DAYS || 60
  );

const GC_ARCHIVE_DAYS =
  Number(
    process.env.GC_ARCHIVE_DAYS || 90
  );

const SOURCE_MAX_FILE_SIZE =
  2 * 1024 * 1024;

const MAX_REPORT_ITEMS = 200;

let cleanupTimer = null;
let maintenanceRunning = false;
let lastMaintenanceAt = 0;
let lastMaintenanceResult = null;

const runtimeState = {
  startedAt: Date.now(),
  maintenanceRuns: 0,
};

// ============================================================
// PERMANENT DATA PROTECTION
// ============================================================

const PROTECTED_TABLES = new Set([
  "users",
  "user_data",

  "rpg_players",
  "rpg_armies",
  "rpg_buildings",
  "rpg_properties",
  "rpg_kingdoms",

  "rpg_inventory",
  "rpg_equipment",
  "rpg_skills",
  "rpg_spells",

  "ai_memories",
  "ai_user_adaptation",

  "love_quests",
  "love_quest_progress",

  "balances",
  "economy",
]);

const PROTECTED_PATH_PARTS = [
  "node_modules",
  ".git",
  ".github",
  ".cache",
  ".config",
  "package-lock.json",
  "yarn.lock",
];

// ============================================================
// HELPERS
// ============================================================

function now() {
  return Date.now();
}

function daysAgo(days) {
  return now() - days * 24 * 60 * 60 * 1000;
}

function pushLimited(array, item) {
  if (array.length < MAX_REPORT_ITEMS) {
    array.push(item);
  }
}

function isSafeSourcePath(filePath) {
  const normalized =
    path.resolve(filePath);

  for (const blocked of PROTECTED_PATH_PARTS) {
    if (
      normalized.includes(
        `${path.sep}${blocked}${path.sep}`
      ) ||
      normalized.endsWith(
        `${path.sep}${blocked}`
      ) ||
      path.basename(normalized) === blocked
    ) {
      return false;
    }
  }

  return true;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeReadFile(filePath) {
  try {
    if (!isFile(filePath)) {
      return null;
    }

    const stats =
      fs.statSync(filePath);

    if (
      stats.size >
      SOURCE_MAX_FILE_SIZE
    ) {
      return null;
    }

    return fs.readFileSync(
      filePath,
      "utf8"
    );
  } catch {
    return null;
  }
}

// ============================================================
// DATABASE HELPERS
// ============================================================

async function tableExists(tableName) {
  try {
    const result =
      await db.query(
        `
        SELECT to_regclass($1) AS table_name
        `,
        [tableName]
      );

    return Boolean(
      result?.rows?.[0]?.table_name
    );
  } catch (error) {
    console.error(
      "[MAINTENANCE] tableExists failed:",
      tableName,
      error.message
    );

    return false;
  }
}

async function columnExists(
  tableName,
  columnName
) {
  try {
    const result =
      await db.query(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        LIMIT 1
        `,
        [
          tableName,
          columnName,
        ]
      );

    return Boolean(
      result?.rows?.length
    );
  } catch {
    return false;
  }
}

async function getTableColumns(tableName) {
  try {
    const result =
      await db.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        ORDER BY ordinal_position
        `,
        [tableName]
      );

    return result.rows.map(
      row => row.column_name
    );
  } catch {
    return [];
  }
}

// ============================================================
// TEMP FILE CLEANUP
// ============================================================

function cleanDirectory(
  directory,
  maxAgeMs
) {
  let removed = 0;

  try {
    if (!fileExists(directory)) {
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
      if (!entry.isFile()) {
        continue;
      }

      const filePath =
        path.join(
          directory,
          entry.name
        );

      if (!isSafeSourcePath(filePath)) {
        continue;
      }

      try {
        const stats =
          fs.statSync(filePath);

        const age =
          now() -
          stats.mtime.getTime();

        if (age <= maxAgeMs) {
          continue;
        }

        fs.unlinkSync(filePath);

        removed++;

        console.log(
          "[MAINTENANCE] Removed temporary file:",
          filePath
        );
      } catch (error) {
        console.error(
          "[MAINTENANCE] File cleanup failed:",
          filePath,
          error.message
        );
      }
    }
  } catch (error) {
    console.error(
      "[MAINTENANCE] Directory scan failed:",
      directory,
      error.message
    );
  }

  return removed;
}

function cleanupTemporaryFiles() {
  const directories = [
    path.join(__dirname, "tmp"),
    path.join(__dirname, "temp"),
    path.join(__dirname, "cache"),
    path.join(__dirname, "logs"),
    path.join(__dirname, "debug-logs"),
  ];

  let removed = 0;

  for (const directory of directories) {
    removed += cleanDirectory(
      directory,
      TEMP_FILE_MAX_AGE_MS
    );
  }

  return removed;
}

// ============================================================
// RUNTIME STATE INSPECTION
// ============================================================

function inspectRuntime() {
  const memory =
    process.memoryUsage();

  return {
    uptimeSeconds:
      Math.floor(
        process.uptime()
      ),

    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
    },

    maintenanceRuns:
      runtimeState.maintenanceRuns,
  };
}

// ============================================================
// DATABASE INTEGRITY
// ============================================================

async function checkNegativeBalances() {
  const findings = [];

  const exists =
    await tableExists("users");

  if (!exists) {
    return findings;
  }

  const columns =
    await getTableColumns("users");

  if (
    !columns.includes("balance") &&
    !columns.includes("bank")
  ) {
    return findings;
  }

  try {
    let query = `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE 1 = 0
    `;

    const conditions = [];

    if (
      columns.includes("balance")
    ) {
      conditions.push(
        "COALESCE(balance, 0) < 0"
      );
    }

    if (
      columns.includes("bank")
    ) {
      conditions.push(
        "COALESCE(bank, 0) < 0"
      );
    }

    if (conditions.length) {
      query = `
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE ${conditions.join(" OR ")}
      `;
    }

    const result =
      await db.query(query);

    const count =
      Number(
        result.rows?.[0]?.count || 0
      );

    if (count > 0) {
      findings.push({
        type: "negative_balances",
        count,
        severity: "high",
      });
    }
  } catch (error) {
    findings.push({
      type: "negative_balance_check_failed",
      error: error.message,
      severity: "warning",
    });
  }

  return findings;
}

// ============================================================
// RPG INTEGRITY
// ============================================================

async function checkRPGIntegrity() {
  const findings = [];

  if (
    await tableExists("rpg_players")
  ) {
    const columns =
      await getTableColumns(
        "rpg_players"
      );

    if (
      columns.includes("level")
    ) {
      try {
        const result =
          await db.query(
            `
            SELECT COUNT(*)::int AS count
            FROM rpg_players
            WHERE level IS NULL
               OR level < 1
            `
          );

        const count =
          Number(
            result.rows?.[0]?.count || 0
          );

        if (count) {
          findings.push({
            type: "invalid_rpg_levels",
            count,
            severity: "medium",
          });
        }
      } catch (error) {
        findings.push({
          type: "rpg_level_check_failed",
          error: error.message,
          severity: "warning",
        });
      }
    }
  }

  if (
    await tableExists("rpg_inventory")
  ) {
    const columns =
      await getTableColumns(
        "rpg_inventory"
      );

    if (
      columns.includes("quantity")
    ) {
      try {
        const result =
          await db.query(
            `
            SELECT COUNT(*)::int AS count
            FROM rpg_inventory
            WHERE quantity IS NULL
               OR quantity <= 0
            `
          );

        const count =
          Number(
            result.rows?.[0]?.count || 0
          );

        if (count) {
          findings.push({
            type: "invalid_inventory_quantity",
            count,
            severity: "medium",
          });
        }
      } catch (error) {
        findings.push({
          type: "inventory_check_failed",
          error: error.message,
          severity: "warning",
        });
      }
    }
  }

  return findings;
}

// ============================================================
// GAME INTEGRITY
// ============================================================

async function checkGameIntegrity() {
  const findings = [];

  const gameTables = [
    "game_sessions",
    "active_games",
    "trivia_sessions",
    "riddle_sessions",
    "blackjack_sessions",
  ];

  for (const table of gameTables) {
    if (
      !await tableExists(table)
    ) {
      continue;
    }

    const columns =
      await getTableColumns(table);

    if (
      !columns.includes("status")
    ) {
      continue;
    }

    try {
      const result =
        await db.query(
          `
          SELECT COUNT(*)::int AS count
          FROM ${table}
          WHERE status = 'active'
          `
        );

      const count =
        Number(
          result.rows?.[0]?.count || 0
        );

      if (count > 0) {
        findings.push({
          type: "active_game_records",
          table,
          count,
          severity: "info",
        });
      }
    } catch (error) {
      findings.push({
        type: "game_integrity_check_failed",
        table,
        error: error.message,
        severity: "warning",
      });
    }
  }

  return findings;
}

// ============================================================
// AI INTEGRITY
// ============================================================

async function checkAIIntegrity() {
  const findings = [];

  if (
    await tableExists(
      "ai_conversations"
    )
  ) {
    const columns =
      await getTableColumns(
        "ai_conversations"
      );

    if (
      columns.includes("updated_at")
    ) {
      try {
        const result =
          await db.query(
            `
            SELECT COUNT(*)::int AS count
            FROM ai_conversations
            WHERE updated_at < $1
            `,
            [daysAgo(90)]
          );

        const count =
          Number(
            result.rows?.[0]?.count || 0
          );

        if (count) {
          findings.push({
            type: "old_ai_conversations",
            count,
            severity: "info",
          });
        }
      } catch (error) {
        findings.push({
          type: "ai_integrity_check_failed",
          error: error.message,
          severity: "warning",
        });
      }
    }
  }

  return findings;
}

// ============================================================
// SESSION CLEANUP
// ============================================================
//
// We only clean a table if its schema actually supports
// expiration/status fields.
//
// NEVER use generic "created_at older than 3 days" deletion
// on arbitrary application tables.
//
// ============================================================

const SESSION_TABLES = [
  {
    table: "rpg_combat_sessions",
    statuses: [
      "active",
      "running",
    ],
  },

  {
    table: "rpg_dungeon_sessions",
    statuses: [
      "active",
      "running",
    ],
  },

  {
    table: "rpg_hunt_sessions",
    statuses: [
      "active",
      "running",
    ],
  },

  {
    table: "game_sessions",
    statuses: [
      "active",
      "running",
    ],
  },

  {
    table: "trivia_sessions",
    statuses: [
      "active",
      "running",
    ],
  },

  {
    table: "riddle_sessions",
    statuses: [
      "active",
      "running",
    ],
  },

  {
    table: "blackjack_sessions",
    statuses: [
      "active",
      "running",
    ],
  },
];

async function cleanupSessionTable(rule) {
  const {
    table,
    statuses,
  } = rule;

  if (
    PROTECTED_TABLES.has(table)
  ) {
    return 0;
  }

  if (
    !await tableExists(table)
  ) {
    return 0;
  }

  const columns =
    await getTableColumns(table);

  let condition = null;

  if (
    columns.includes("expires_at")
  ) {
    condition =
      `expires_at IS NOT NULL AND expires_at < NOW()`;
  } else if (
    columns.includes("updated_at")
  ) {
    condition =
      `updated_at < NOW() - INTERVAL '1 day'`;
  } else {
    return 0;
  }

  let statusCondition = "";

  if (
    columns.includes("status") &&
    statuses.length
  ) {
    const escaped =
      statuses
        .map(
          status =>
            `'${status.replace(
              /'/g,
              "''"
            )}'`
        )
        .join(",");

    statusCondition =
      `AND status IN (${escaped})`;
  }

  try {
    const result =
      await db.query(
        `
        DELETE FROM ${table}
        WHERE ${condition}
        ${statusCondition}
        `
      );

    return Number(
      result.rowCount || 0
    );
  } catch (error) {
    console.error(
      `[MAINTENANCE] ${table} cleanup failed:`,
      error.message
    );

    return 0;
  }
}

async function cleanupExpiredSessions() {
  let removed = 0;

  for (
    const rule of SESSION_TABLES
  ) {
    removed +=
      await cleanupSessionTable(
        rule
      );
  }

  return removed;
}

// ============================================================
// TRIVIA / RIDDLE STATE VALIDATION
// ============================================================

function validateStateJSON(
  filePath
) {
  const result = {
    file: filePath,
    exists: false,
    valid: false,
    repaired: false,
  };

  if (
    !fileExists(filePath)
  ) {
    return result;
  }

  result.exists = true;

  try {
    const raw =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    JSON.parse(raw);

    result.valid = true;
  } catch (error) {
    result.error =
      error.message;
  }

  return result;
}

function repairStateJSON(
  filePath,
  fallback = {}
) {
  try {
    fs.mkdirSync(
      path.dirname(filePath),
      {
        recursive: true,
      }
    );

    fs.writeFileSync(
      filePath,
      JSON.stringify(
        fallback,
        null,
        2
      ),
      "utf8"
    );

    return true;
  } catch (error) {
    console.error(
      "[MAINTENANCE] State repair failed:",
      filePath,
      error.message
    );

    return false;
  }
}

function checkGameStateFiles() {
  const findings = [];

  const stateFiles = [
    {
      name: "riddle-state.json",
      path: path.join(
        __dirname,
        "data",
        "riddle-state.json"
      ),
      fallback: {},
    },

    {
      name: "trivia-state.json",
      path: path.join(
        __dirname,
        "data",
        "trivia-state.json"
      ),
      fallback: {},
    },
  ];

  for (
    const state of stateFiles
  ) {
    const result =
      validateStateJSON(
        state.path
      );

    if (
      result.exists &&
      !result.valid
    ) {
      findings.push({
        type: "invalid_state_json",
        name: state.name,
        path: state.path,
        severity: "medium",
      });
    }
  }

  return findings;
}

function repairGameStateFiles() {
  const repaired = [];

  const stateFiles = [
    {
      name: "riddle-state.json",
      path: path.join(
        __dirname,
        "data",
        "riddle-state.json"
      ),
    },

    {
      name: "trivia-state.json",
      path: path.join(
        __dirname,
        "data",
        "trivia-state.json"
      ),
    },
  ];

  for (
    const state of stateFiles
  ) {
    const result =
      validateStateJSON(
        state.path
      );

    if (
      result.exists &&
      !result.valid
    ) {
      if (
        repairStateJSON(
          state.path,
          {}
        )
      ) {
        repaired.push(
          state.name
        );
      }
    }
  }

  return repaired;
}

// ============================================================
// SOURCE CODE OPTIMIZER
// ============================================================
//
// IMPORTANT:
// This does NOT automatically delete source code.
//
// Static analysis can be wrong when functions are:
// - dynamically required
// - called by command routers
// - exported for another module
// - accessed through object properties
//
// Therefore this generates candidates only.
//
// ============================================================

const SOURCE_EXTENSIONS =
  new Set([
    ".js",
    ".cjs",
    ".mjs",
  ]);

const SOURCE_IGNORE_DIRS =
  new Set([
    "node_modules",
    ".git",
    ".cache",
    ".config",
    "coverage",
    "dist",
    "build",
  ]);

function collectSourceFiles(
  directory,
  output = []
) {
  let entries;

  try {
    entries =
      fs.readdirSync(
        directory,
        {
          withFileTypes: true,
        }
      );
  } catch {
    return output;
  }

  for (
    const entry of entries
  ) {
    if (
      SOURCE_IGNORE_DIRS.has(
        entry.name
      )
    ) {
      continue;
    }

    const fullPath =
      path.join(
        directory,
        entry.name
      );

    if (
      entry.isDirectory()
    ) {
      collectSourceFiles(
        fullPath,
        output
      );

      continue;
    }

    if (
      !entry.isFile()
    ) {
      continue;
    }

    if (
      SOURCE_EXTENSIONS.has(
        path.extname(
          entry.name
        )
      )
    ) {
      output.push(
        fullPath
      );
    }
  }

  return output;
}

function stripCommentsForAnalysis(
  source
) {
  return source
    .replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    )
    .replace(
      /(^|[^:])\/\/.*$/gm,
      "$1"
    );
}

function findUnusedImports(
  filePath,
  source
) {
  const findings = [];

  const clean =
    stripCommentsForAnalysis(
      source
    );

  const imports = [];

  const requireRegex =
    /(?:const|let|var)\s+(.+?)\s*=\s*require\(\s*["'](.+?)["']\s*\)/g;

  let match;

  while (
    (match =
      requireRegex.exec(
        clean
      ))
  ) {
    imports.push({
      declaration:
        match[1],
      module:
        match[2],
      index:
        match.index,
    });
  }

  for (
    const item of imports
  ) {
    const names =
      item.declaration
        .replace(
          /[{}\[\]]/g,
          ""
        )
        .split(",")
        .map(
          value =>
            value
              .trim()
              .split(/\s+as\s+/i)[0]
              .trim()
        )
        .filter(Boolean);

    for (
      const name of names
    ) {
      if (
        !/^[A-Za-z_$][\w$]*$/.test(
          name
        )
      ) {
        continue;
      }

      const occurrences =
        clean.match(
          new RegExp(
            `\\b${name}\\b`,
            "g"
          )
        ) || [];

      if (
        occurrences.length <= 1
      ) {
        findings.push({
          type: "possible_unused_import",
          file: filePath,
          name,
          module: item.module,
          severity: "low",
        });
      }
    }
  }

  return findings;
}

function findUnusedFunctions(
  filePath,
  source
) {
  const findings = [];

  const clean =
    stripCommentsForAnalysis(
      source
    );

  const functionRegex =
    /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;

  let match;

  while (
    (match =
      functionRegex.exec(
        clean
      ))
  ) {
    const name =
      match[1];

    const occurrences =
      clean.match(
        new RegExp(
          `\\b${name}\\b`,
          "g"
        )
      ) || [];

    if (
      occurrences.length <= 1
    ) {
      findings.push({
        type: "possible_unused_function",
        file: filePath,
        name,
        severity: "low",
      });
    }
  }

  return findings;
}

function findDuplicateConstants(
  filePath,
  source
) {
  const findings = [];

  const clean =
    stripCommentsForAnalysis(
      source
    );

  const declarations =
    new Map();

  const regex =
    /(?:const|let|var)\s+([A-Z][A-Z0-9_]+)\s*=/g;

  let match;

  while (
    (match =
      regex.exec(clean))
  ) {
    const name =
      match[1];

    if (
      declarations.has(name)
    ) {
      findings.push({
        type: "possible_duplicate_constant",
        file: filePath,
        name,
        severity: "low",
      });
    } else {
      declarations.set(
        name,
        true
      );
    }
  }

  return findings;
}

function analyzeSourceCode() {
  const findings = [];

  const files =
    collectSourceFiles(
      __dirname
    );

  for (
    const filePath of files
  ) {
    if (
      findings.length >=
      MAX_REPORT_ITEMS
    ) {
      break;
    }

    if (
      !isSafeSourcePath(
        filePath
      )
    ) {
      continue;
    }

    const source =
      safeReadFile(
        filePath
      );

    if (
      source === null
    ) {
      continue;
    }

    findings.push(
      ...findUnusedImports(
        filePath,
        source
      )
    );

    findings.push(
      ...findUnusedFunctions(
        filePath,
        source
      )
    );

    findings.push(
      ...findDuplicateConstants(
        filePath,
        source
      )
    );
  }

  return findings.slice(
    0,
    MAX_REPORT_ITEMS
  );
}

// ============================================================
// GC ACTIVITY TRACKING
// ============================================================

async function ensureGCActivityTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_gc_activity (
        thread_id TEXT PRIMARY KEY,
        first_seen_at BIGINT NOT NULL,
        last_active_at BIGINT NOT NULL,
        inactive_since BIGINT,
        status TEXT NOT NULL DEFAULT 'active',
        expensive_features_disabled BOOLEAN NOT NULL DEFAULT FALSE,
        archived_at BIGINT,
        updated_at BIGINT NOT NULL
      )
    `);

    return true;
  } catch (error) {
    console.error(
      "[MAINTENANCE] Could not ensure GC activity table:",
      error.message
    );

    return false;
  }
}

async function updateGCActivity(
  threadID
) {
  if (!threadID) {
    return;
  }

  const ready =
    await ensureGCActivityTable();

  if (!ready) {
    return;
  }

  const timestamp =
    now();

  try {
    await db.query(
      `
      INSERT INTO bot_gc_activity (
        thread_id,
        first_seen_at,
        last_active_at,
        inactive_since,
        status,
        expensive_features_disabled,
        archived_at,
        updated_at
      )
      VALUES (
        $1, $2, $2, NULL, 'active', FALSE, NULL, $2
      )
      ON CONFLICT (thread_id)
      DO UPDATE SET
        last_active_at = EXCLUDED.last_active_at,
        inactive_since = NULL,
        status = 'active',
        updated_at = EXCLUDED.updated_at
      `,
      [
        String(threadID),
        timestamp,
      ]
    );
  } catch (error) {
    console.error(
      "[MAINTENANCE] GC activity update failed:",
      error.message
    );
  }
}

async function processInactiveGCs() {
  const result = {
    markedInactive: 0,
    expensiveFeaturesDisabled: 0,
    archived: 0,
  };

  const ready =
    await ensureGCActivityTable();

  if (!ready) {
    return result;
  }

  const inactiveCutoff =
    daysAgo(
      INACTIVE_GC_DAYS
    );

  const expensiveCutoff =
    daysAgo(
      GC_EXPENSIVE_FEATURE_DAYS
    );

  const archiveCutoff =
    daysAgo(
      GC_ARCHIVE_DAYS
    );

  try {
    const inactive =
      await db.query(
        `
        UPDATE bot_gc_activity
        SET
          status = 'inactive',
          inactive_since = COALESCE(
            inactive_since,
            $1
          ),
          updated_at = $2
        WHERE last_active_at < $1
          AND status = 'active'
        `,
        [
          inactiveCutoff,
          now(),
        ]
      );

    result.markedInactive =
      Number(
        inactive.rowCount || 0
      );

    const expensive =
      await db.query(
        `
        UPDATE bot_gc_activity
        SET
          expensive_features_disabled = TRUE,
          updated_at = $1
        WHERE last_active_at < $2
          AND expensive_features_disabled = FALSE
        `,
        [
          now(),
          expensiveCutoff,
        ]
      );

    result.expensiveFeaturesDisabled =
      Number(
        expensive.rowCount || 0
      );

    const archived =
      await db.query(
        `
        UPDATE bot_gc_activity
        SET
          status = 'archived',
          archived_at = COALESCE(
            archived_at,
            $1
          ),
          updated_at = $1
        WHERE last_active_at < $2
          AND status != 'archived'
        `,
        [
          now(),
          archiveCutoff,
        ]
      );

    result.archived =
      Number(
        archived.rowCount || 0
      );
  } catch (error) {
    console.error(
      "[MAINTENANCE] GC activity processing failed:",
      error.message
    );
  }

  return result;
}

// ============================================================
// DATABASE MAINTENANCE
// ============================================================

async function databaseMaintenance() {
  try {
    await db.query(
      "ANALYZE"
    );

    return true;
  } catch (error) {
    console.error(
      "[MAINTENANCE] ANALYZE failed:",
      error.message
    );

    return false;
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================

async function healthCheck() {
  const result = {
    database: false,
    requiredTables: {},
    sourceDirectory: false,
    memory: inspectRuntime(),
  };

  try {
    await db.query(
      "SELECT 1"
    );

    result.database = true;
  } catch {
    result.database = false;
  }

  const importantTables = [
    "users",
    "rpg_players",
    "rpg_armies",
    "rpg_buildings",
    "ai_conversations",
    "ai_messages",
  ];

  for (
    const table of importantTables
  ) {
    result.requiredTables[table] =
      await tableExists(table);
  }

  result.sourceDirectory =
    fileExists(__dirname);

  return result;
}

// ============================================================
// MAINTENANCE REPORT
// ============================================================

function createReport() {
  return {
    version: VERSION,
    startedAt: new Date().toISOString(),
    mode: null,

    cleaned: {
      temporaryFiles: 0,
      expiredSessions: 0,
    },

    repaired: {
      stateFiles: [],
    },

    integrity: {
      economy: [],
      rpg: [],
      games: [],
      ai: [],
      stateFiles: [],
    },

    optimizer: {
      findings: [],
    },

    gc: {
      markedInactive: 0,
      expensiveFeaturesDisabled: 0,
      archived: 0,
    },

    health: null,

    databaseMaintenance: false,

    durationMs: 0,

    errors: [],
  };
}

// ============================================================
// RUN MAINTENANCE
// ============================================================

async function runCleanup(
  options = {}
) {
  if (
    maintenanceRunning
  ) {
    return {
      skipped: true,
      reason:
        "maintenance already running",
    };
  }

  maintenanceRunning = true;

  const startedAt =
    now();

  runtimeState.maintenanceRuns++;

  const mode =
    String(
      options.mode || "clean"
    ).toLowerCase();

  const report =
    createReport();

  report.mode =
    mode;

  console.log(
    "========================================"
  );

  console.log(
    `[MAINTENANCE] ECLIPSE ${VERSION}`
  );

  console.log(
    `[MAINTENANCE] MODE: ${mode.toUpperCase()}`
  );

  console.log(
    "========================================"
  );

  try {
    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    report.health =
      await healthCheck();

    // --------------------------------------------------------
    // INTEGRITY CHECKS
    // --------------------------------------------------------

    report.integrity.economy =
      await checkNegativeBalances();

    report.integrity.rpg =
      await checkRPGIntegrity();

    report.integrity.games =
      await checkGameIntegrity();

    report.integrity.ai =
      await checkAIIntegrity();

    report.integrity.stateFiles =
      checkGameStateFiles();

    // --------------------------------------------------------
    // CLEAN
    // --------------------------------------------------------

    if (
      mode === "clean" ||
      mode === "repair" ||
      mode === "optimize" ||
      mode === "full"
    ) {
      report.cleaned.temporaryFiles =
        cleanupTemporaryFiles();

      report.cleaned.expiredSessions =
        await cleanupExpiredSessions();

      const gc =
        await processInactiveGCs();

      report.gc = gc;
    }

    // --------------------------------------------------------
    // REPAIR
    // --------------------------------------------------------

    if (
      mode === "repair" ||
      mode === "full"
    ) {
      report.repaired.stateFiles =
        repairGameStateFiles();
    }

    // --------------------------------------------------------
    // OPTIMIZE
    // --------------------------------------------------------

    if (
      mode === "optimize" ||
      mode === "full"
    ) {
      report.optimizer.findings =
        analyzeSourceCode();
    }

    // --------------------------------------------------------
    // DATABASE
    // --------------------------------------------------------

    if (
      mode !== "monitor"
    ) {
      report.databaseMaintenance =
        await databaseMaintenance();
    }

    report.durationMs =
      now() -
      startedAt;

    lastMaintenanceAt =
      now();

    lastMaintenanceResult =
      report;

    console.log(
      "[MAINTENANCE] Complete:",
      JSON.stringify(
        {
          mode,
          files:
            report.cleaned
              .temporaryFiles,
          sessions:
            report.cleaned
              .expiredSessions,
          repairs:
            report.repaired
              .stateFiles.length,
          optimizerFindings:
            report.optimizer
              .findings.length,
          gc:
            report.gc,
          durationMs:
            report.durationMs,
        },
        null,
        2
      )
    );

    return report;
  } catch (error) {
    console.error(
      "[MAINTENANCE] Fatal maintenance error:",
      error
    );

    report.errors.push(
      error.message
    );

    report.durationMs =
      now() -
      startedAt;

    lastMaintenanceResult =
      report;

    return report;
  } finally {
    maintenanceRunning =
      false;
  }
}

// ============================================================
// MODE HELPERS
// ============================================================

async function previewCleanup() {
  return runCleanup({
    mode: "monitor",
  });
}

async function repairCleanup() {
  return runCleanup({
    mode: "repair",
  });
}

async function optimizeCleanup() {
  return runCleanup({
    mode: "optimize",
  });
}

async function fullMaintenance() {
  return runCleanup({
    mode: "full",
  });
}

// ============================================================
// SCHEDULER
// ============================================================

function startCleanupScheduler() {
  if (cleanupTimer) {
    return;
  }

  console.log(
    `[MAINTENANCE] Scheduler started.`
  );

  setTimeout(() => {
    runCleanup({
      mode: "clean",
    }).catch(error => {
      console.error(
        "[MAINTENANCE] Startup maintenance failed:",
        error
      );
    });
  }, 30 * 1000);

  cleanupTimer =
    setInterval(() => {
      runCleanup({
        mode: "clean",
      }).catch(error => {
        console.error(
          "[MAINTENANCE] Scheduled maintenance failed:",
          error
        );
      });
    }, CLEANUP_INTERVAL_MS);

  if (
    typeof cleanupTimer.unref ===
    "function"
  ) {
    cleanupTimer.unref();
  }
}

function stopCleanupScheduler() {
  if (!cleanupTimer) {
    return;
  }

  clearInterval(
    cleanupTimer
  );

  cleanupTimer = null;

  console.log(
    "[MAINTENANCE] Scheduler stopped."
  );
}

// ============================================================
// GC ACTIVITY API
// ============================================================

async function registerGCActivity(
  threadID
) {
  return updateGCActivity(
    threadID
  );
}

// ============================================================
// STATUS
// ============================================================

function getCleanupStatus() {
  return {
    version: VERSION,

    running:
      maintenanceRunning,

    schedulerActive:
      Boolean(cleanupTimer),

    lastCleanupAt:
      lastMaintenanceAt
        ? new Date(
            lastMaintenanceAt
          ).toISOString()
        : null,

    lastResult:
      lastMaintenanceResult,

    uptimeSeconds:
      Math.floor(
        process.uptime()
      ),

    runtime:
      inspectRuntime(),

    configuration: {
      cleanupIntervalMs:
        CLEANUP_INTERVAL_MS,

      tempFileMaxAgeMs:
        TEMP_FILE_MAX_AGE_MS,

      inactiveGCDays:
        INACTIVE_GC_DAYS,

      expensiveFeatureDays:
        GC_EXPENSIVE_FEATURE_DAYS,

      archiveDays:
        GC_ARCHIVE_DAYS,
    },
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERSION,

  runCleanup,
  previewCleanup,
  repairCleanup,
  optimizeCleanup,
  fullMaintenance,

  startCleanupScheduler,
  stopCleanupScheduler,

  getCleanupStatus,

  registerGCActivity,

  healthCheck,
};
