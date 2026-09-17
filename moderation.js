"use strict";

const db = require("./db");

const {
  classifyForAutoMod,
  isAutoModClassifierConfigured,
} = require("./ai/moderation-classifier");

const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const TRUSTED_ADMIN_IDS = String(process.env.TRUSTED_ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const MAX_MOD_ACTIONS_PER_WINDOW = 5;
const MOD_ACTION_WINDOW_MS = 10 * 60 * 1000;

const MAX_ECONOMY_ACTIONS_PER_WINDOW = 10;
const ECONOMY_ACTION_WINDOW_MS = 10 * 60 * 1000;

const MAX_SINGLE_MONEY_AMOUNT = 1000000;
const MAX_SINGLE_XP_AMOUNT = 100000;

const WARN_LIMIT = 3;

const ADMIN_STRIKE_LOCK_MS = 30 * 60 * 1000;
const OWNER_NOTIFY_STRIKE_THRESHOLD = 4;

/*
|--------------------------------------------------------------------------
| AUTONOMOUS MODERATION
|--------------------------------------------------------------------------
*/

const AUTOMOD_DEFAULT_OWNER_AWAY_MS = 15 * 60 * 1000;
const AUTOMOD_MAX_MESSAGE_LENGTH = 2000;
const AUTOMOD_MIN_CONFIDENCE = 0.88;
const AUTOMOD_INCIDENT_WINDOW_MS = 60 * 60 * 1000;

const AUTOMOD_MUTE_LEVEL = 3;
const AUTOMOD_BAN_LEVEL = 6;

const AUTOMOD_MUTE_DURATIONS = {
  low: 5 * 60 * 1000,
  medium: 30 * 60 * 1000,
  high: 2 * 60 * 60 * 1000,
};

/*
|--------------------------------------------------------------------------
| PER-GROUP MODERATION SETTINGS
|--------------------------------------------------------------------------
|
| These settings are stored per Messenger group/thread.
|
| NOTE:
| links_enabled / spam_enabled / mentions_enabled / raid_enabled
| are configuration switches for the corresponding protection systems.
| The actual detectors can be added/expanded independently without
| changing this settings system.
|--------------------------------------------------------------------------
*/

const MOD_DEFAULT_SETTINGS = {
  links_enabled: false,
  spam_enabled: true,
  mentions_enabled: true,
  raid_enabled: true,
  warnings_enabled: true,

  warn_limit: WARN_LIMIT,

  automod_mute_level: AUTOMOD_MUTE_LEVEL,
  automod_ban_level: AUTOMOD_BAN_LEVEL,
  automod_min_confidence: AUTOMOD_MIN_CONFIDENCE,

  spam_window_ms: 10 * 1000,
  spam_max_messages: 6,

  mention_window_ms: 10 * 1000,
  mention_max: 5,
};

const MOD_SETTING_COLUMNS = new Set([
  "links_enabled",
  "spam_enabled",
  "mentions_enabled",
  "raid_enabled",
  "warnings_enabled",
  "warn_limit",
  "automod_mute_level",
  "automod_ban_level",
  "automod_min_confidence",
  "spam_window_ms",
  "spam_max_messages",
  "mention_window_ms",
  "mention_max",
]);

/*
|--------------------------------------------------------------------------
| MEMORY CACHE
|--------------------------------------------------------------------------
*/

const moderationRate = new Map();
const economyRate = new Map();

const automodOwnerLastSeen = new Map();

const moderationSettingsCache = new Map();

let autoModAnalyzer = null;

let automodTablesReady = false;
let automodTablesPromise = null;

let moderationSettingsTablesReady = false;
let moderationSettingsTablesPromise = null;

const automodSeenMessageIds = new Map();

/*
|--------------------------------------------------------------------------
| AUTONOMOUS MODERATION DATABASE
|--------------------------------------------------------------------------
*/

async function ensureAutoModTables() {
  if (automodTablesReady) {
    return;
  }

  if (automodTablesPromise) {
    return automodTablesPromise;
  }

  automodTablesPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS automod_settings (
        thread_id TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        owner_away_timeout BIGINT NOT NULL DEFAULT 900000,
        owner_last_seen BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL
      );

      ALTER TABLE automod_settings
        ADD COLUMN IF NOT EXISTS owner_last_seen BIGINT NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS automod_incidents (
        id BIGSERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        severity INTEGER NOT NULL,
        confidence REAL NOT NULL,
        suggested_action TEXT NOT NULL DEFAULT 'none',
        action TEXT NOT NULL,
        reason TEXT,
        created_at BIGINT NOT NULL
      );

      ALTER TABLE automod_incidents
        ADD COLUMN IF NOT EXISTS suggested_action TEXT NOT NULL DEFAULT 'none';

      CREATE INDEX IF NOT EXISTS idx_automod_incidents_user
        ON automod_incidents(thread_id, user_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_automod_incidents_thread
        ON automod_incidents(thread_id, created_at);

      CREATE TABLE IF NOT EXISTS moderation_mutes (
        id BIGSERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT,
        expires_at BIGINT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_moderation_mutes_active
        ON moderation_mutes(thread_id, user_id, active, expires_at);
    `);
  })();

  try {
    await automodTablesPromise;
    automodTablesReady = true;
  } finally {
    automodTablesPromise = null;
  }
}

/*
|--------------------------------------------------------------------------
| MODERATION SETTINGS DATABASE
|--------------------------------------------------------------------------
*/

async function ensureModerationSettingsTable() {
  if (moderationSettingsTablesReady) {
    return;
  }

  if (moderationSettingsTablesPromise) {
    return moderationSettingsTablesPromise;
  }

  moderationSettingsTablesPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS moderation_settings (
        thread_id TEXT PRIMARY KEY,

        links_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        spam_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        mentions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        raid_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        warnings_enabled BOOLEAN NOT NULL DEFAULT TRUE,

        warn_limit INTEGER NOT NULL DEFAULT 3,

        automod_mute_level INTEGER NOT NULL DEFAULT 3,
        automod_ban_level INTEGER NOT NULL DEFAULT 6,
        automod_min_confidence REAL NOT NULL DEFAULT 0.88,

        spam_window_ms BIGINT NOT NULL DEFAULT 10000,
        spam_max_messages INTEGER NOT NULL DEFAULT 6,

        mention_window_ms BIGINT NOT NULL DEFAULT 10000,
        mention_max INTEGER NOT NULL DEFAULT 5,

        updated_at BIGINT NOT NULL
      );
    `);
  })();

  try {
    await moderationSettingsTablesPromise;
    moderationSettingsTablesReady = true;
  } finally {
    moderationSettingsTablesPromise = null;
  }
}

function normalizeModerationSettings(row = {}) {
  const confidence =
    Number(row.automod_min_confidence);

  return {
    thread_id:
      String(row.thread_id || ""),

    links_enabled:
      row.links_enabled === true,

    spam_enabled:
      row.spam_enabled !== false,

    mentions_enabled:
      row.mentions_enabled !== false,

    raid_enabled:
      row.raid_enabled !== false,

    warnings_enabled:
      row.warnings_enabled !== false,

    warn_limit:
      Number.isSafeInteger(
        Number(row.warn_limit)
      )
        ? Math.max(
            1,
            Math.min(
              20,
              Number(row.warn_limit)
            )
          )
        : MOD_DEFAULT_SETTINGS.warn_limit,

    automod_mute_level:
      Number.isSafeInteger(
        Number(row.automod_mute_level)
      )
        ? Math.max(
            1,
            Math.min(
              10,
              Number(row.automod_mute_level)
            )
          )
        : MOD_DEFAULT_SETTINGS.automod_mute_level,

    automod_ban_level:
      Number.isSafeInteger(
        Number(row.automod_ban_level)
      )
        ? Math.max(
            1,
            Math.min(
              10,
              Number(row.automod_ban_level)
            )
          )
        : MOD_DEFAULT_SETTINGS.automod_ban_level,

    automod_min_confidence:
      Number.isFinite(confidence)
        ? Math.max(
            0.5,
            Math.min(
              1,
              confidence
            )
          )
        : MOD_DEFAULT_SETTINGS.automod_min_confidence,

    spam_window_ms:
      Number.isSafeInteger(
        Number(row.spam_window_ms)
      )
        ? Math.max(
            1000,
            Math.min(
              5 * 60 * 1000,
              Number(row.spam_window_ms)
            )
          )
        : MOD_DEFAULT_SETTINGS.spam_window_ms,

    spam_max_messages:
      Number.isSafeInteger(
        Number(row.spam_max_messages)
      )
        ? Math.max(
            2,
            Math.min(
              100,
              Number(row.spam_max_messages)
            )
          )
        : MOD_DEFAULT_SETTINGS.spam_max_messages,

    mention_window_ms:
      Number.isSafeInteger(
        Number(row.mention_window_ms)
      )
        ? Math.max(
            1000,
            Math.min(
              5 * 60 * 1000,
              Number(row.mention_window_ms)
            )
          )
        : MOD_DEFAULT_SETTINGS.mention_window_ms,

    mention_max:
      Number.isSafeInteger(
        Number(row.mention_max)
      )
        ? Math.max(
            1,
            Math.min(
              100,
              Number(row.mention_max)
            )
          )
        : MOD_DEFAULT_SETTINGS.mention_max,

    updated_at:
      Number(row.updated_at || 0),
  };
}

async function getModerationSettings(threadID) {
  const threadKey = String(threadID);

  if (
    moderationSettingsCache.has(
      threadKey
    )
  ) {
    return moderationSettingsCache.get(
      threadKey
    );
  }

  await ensureModerationSettingsTable();

  const result = await db.query(
    `
    SELECT *
    FROM moderation_settings
    WHERE thread_id = $1
    LIMIT 1
    `,
    [threadKey]
  );

  if (result.rows[0]) {
    const settings =
      normalizeModerationSettings(
        result.rows[0]
      );

    moderationSettingsCache.set(
      threadKey,
      settings
    );

    return settings;
  }

  const timestamp = now();

  await db.query(
    `
    INSERT INTO moderation_settings
    (
      thread_id,
      links_enabled,
      spam_enabled,
      mentions_enabled,
      raid_enabled,
      warnings_enabled,
      warn_limit,
      automod_mute_level,
      automod_ban_level,
      automod_min_confidence,
      spam_window_ms,
      spam_max_messages,
      mention_window_ms,
      mention_max,
      updated_at
    )
    VALUES
    (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15
    )
    ON CONFLICT (thread_id)
    DO NOTHING
    `,
    [
      threadKey,
      MOD_DEFAULT_SETTINGS.links_enabled,
      MOD_DEFAULT_SETTINGS.spam_enabled,
      MOD_DEFAULT_SETTINGS.mentions_enabled,
      MOD_DEFAULT_SETTINGS.raid_enabled,
      MOD_DEFAULT_SETTINGS.warnings_enabled,
      MOD_DEFAULT_SETTINGS.warn_limit,
      MOD_DEFAULT_SETTINGS.automod_mute_level,
      MOD_DEFAULT_SETTINGS.automod_ban_level,
      MOD_DEFAULT_SETTINGS.automod_min_confidence,
      MOD_DEFAULT_SETTINGS.spam_window_ms,
      MOD_DEFAULT_SETTINGS.spam_max_messages,
      MOD_DEFAULT_SETTINGS.mention_window_ms,
      MOD_DEFAULT_SETTINGS.mention_max,
      timestamp,
    ]
  );

  const settings = {
    thread_id: threadKey,
    ...MOD_DEFAULT_SETTINGS,
    updated_at: timestamp,
  };

  moderationSettingsCache.set(
    threadKey,
    settings
  );

  return settings;
}

async function updateModerationSetting(
  threadID,
  column,
  value
) {
  if (
    !MOD_SETTING_COLUMNS.has(
      column
    )
  ) {
    throw new Error(
      "Invalid moderation setting."
    );
  }

  await ensureModerationSettingsTable();

  await getModerationSettings(
    threadID
  );

  await db.query(
    `
    UPDATE moderation_settings
    SET
      ${column} = $1,
      updated_at = $2
    WHERE thread_id = $3
    `,
    [
      value,
      now(),
      String(threadID),
    ]
  );

  moderationSettingsCache.delete(
    String(threadID)
  );

  return getModerationSettings(
    threadID
  );
}

/*
|--------------------------------------------------------------------------
| AUTMOD OWNER ACTIVITY
|--------------------------------------------------------------------------
*/

function noteOwnerActivity(
  threadID,
  userId
) {
  if (
    !threadID ||
    !userId ||
    !isBotOwner(userId)
  ) {
    return;
  }

  const threadKey =
    String(threadID);

  const timestamp =
    now();

  automodOwnerLastSeen.set(
    threadKey,
    timestamp
  );

  /*
   * Persist the owner's latest activity.
   *
   * This is intentionally fire-and-forget because the message
   * router should not be blocked by this bookkeeping query.
   */
  ensureAutoModTables()
    .then(() => {
      return db.query(
        `
        INSERT INTO automod_settings
        (
          thread_id,
          enabled,
          owner_away_timeout,
          owner_last_seen,
          updated_at
        )
        VALUES
        ($1, FALSE, $2, $3, $3)

        ON CONFLICT (thread_id)
        DO UPDATE SET
          owner_last_seen = EXCLUDED.owner_last_seen,
          updated_at = EXCLUDED.updated_at
        `,
        [
          threadKey,
          AUTOMOD_DEFAULT_OWNER_AWAY_MS,
          timestamp,
        ]
      );
    })
    .catch((error) => {
      console.error(
        "[AutoMod] Failed to persist owner activity:",
        error
      );
    });
}

/*
|--------------------------------------------------------------------------
| OWNER AWAY CHECK
|--------------------------------------------------------------------------
*/

async function isOwnerAway(
  threadID
) {
  await ensureAutoModTables();

  const result =
    await db.query(
      `
      SELECT
        owner_away_timeout,
        owner_last_seen
      FROM automod_settings
      WHERE thread_id = $1
      LIMIT 1
      `,
      [threadID]
    );

  const row =
    result.rows[0];

  const timeout =
    Number(
      row?.owner_away_timeout ||
      AUTOMOD_DEFAULT_OWNER_AWAY_MS
    );

  const memoryLastSeen =
    Number(
      automodOwnerLastSeen.get(
        String(threadID)
      ) || 0
    );

  const databaseLastSeen =
    Number(
      row?.owner_last_seen || 0
    );

  const lastSeen =
    Math.max(
      memoryLastSeen,
      databaseLastSeen
    );

  if (!lastSeen) {
    return false;
  }

  return (
    now() - lastSeen >= timeout
  );
}

/*
|--------------------------------------------------------------------------
| AUTOMOD SETTINGS
|--------------------------------------------------------------------------
*/

async function getAutoModSettings(
  threadID
) {
  await ensureAutoModTables();

  const result =
    await db.query(
      `
      SELECT *
      FROM automod_settings
      WHERE thread_id = $1
      LIMIT 1
      `,
      [threadID]
    );

  if (result.rows[0]) {
    return result.rows[0];
  }

  const timestamp =
    now();

  await db.query(
    `
    INSERT INTO automod_settings
    (
      thread_id,
      enabled,
      owner_away_timeout,
      owner_last_seen,
      updated_at
    )
    VALUES
    ($1, FALSE, $2, 0, $3)

    ON CONFLICT (thread_id)
    DO NOTHING
    `,
    [
      threadID,
      AUTOMOD_DEFAULT_OWNER_AWAY_MS,
      timestamp,
    ]
  );

  return {
    thread_id: threadID,
    enabled: false,
    owner_away_timeout:
      AUTOMOD_DEFAULT_OWNER_AWAY_MS,
    owner_last_seen: 0,
    updated_at: timestamp,
  };
}

async function setAutoModEnabled(
  threadID,
  enabled,
  ownerAwayTimeout = null
) {
  await ensureAutoModTables();

  const requestedTimeout =
    Number(ownerAwayTimeout);

  const timeout =
    Number.isSafeInteger(
      requestedTimeout
    ) &&
    requestedTimeout >= 60000
      ? requestedTimeout
      : AUTOMOD_DEFAULT_OWNER_AWAY_MS;

  await db.query(
    `
    INSERT INTO automod_settings
    (
      thread_id,
      enabled,
      owner_away_timeout,
      owner_last_seen,
      updated_at
    )
    VALUES
    ($1, $2, $3, 0, $4)

    ON CONFLICT (thread_id)
    DO UPDATE SET
      enabled = EXCLUDED.enabled,
      owner_away_timeout = EXCLUDED.owner_away_timeout,
      updated_at = EXCLUDED.updated_at
    `,
    [
      threadID,
      Boolean(enabled),
      timeout,
      now(),
    ]
  );

  return getAutoModSettings(
    threadID
  );
}

/*
|--------------------------------------------------------------------------
| AUTOMOD ANALYZER
|--------------------------------------------------------------------------
*/

function setAutoModAnalyzer(
  analyzer
) {
  if (
    analyzer !== null &&
    typeof analyzer !== "function"
  ) {
    throw new TypeError(
      "AutoMod analyzer must be a function or null."
    );
  }

  autoModAnalyzer =
    analyzer;
}

async function analyzeForAutoMod({
  event,
  threadID,
  senderId,
  text,
}) {
  const message =
    String(text || "")
      .trim()
      .slice(
        0,
        AUTOMOD_MAX_MESSAGE_LENGTH
      );

  if (
    !message ||
    typeof autoModAnalyzer !==
      "function"
  ) {
    return null;
  }

  try {
    const result =
      await autoModAnalyzer({
        event,
        threadID,
        senderId,
        text: message,
      });

    if (
      !result ||
      typeof result !== "object"
    ) {
      return null;
    }

    return normalizeAutoModResult(
      result
    );
  } catch (error) {
    console.error(
      "[AutoMod] Analyzer error:",
      error
    );

    return null;
  }
}

function normalizeAutoModResult(
  result
) {
  const allowedActions =
    new Set([
      "none",
      "warn",
      "mute",
      "ban",
    ]);

  const action =
    String(
      result.action || "none"
    )
      .toLowerCase()
      .trim();

  const category =
    String(
      result.category || "unknown"
    )
      .toLowerCase()
      .slice(0, 100);

  let confidence =
    Number(result.confidence);

  let severity =
    Number(result.severity);

  if (!Number.isFinite(confidence)) {
    return null;
  }

  if (!Number.isFinite(severity)) {
    severity = 0;
  }

  confidence =
    Math.max(
      0,
      Math.min(
        1,
        confidence
      )
    );

  severity =
    Math.max(
      0,
      Math.min(
        10,
        severity
      )
    );

  const reason =
    cleanReason(
      result.reason ||
      "Automated moderation classification"
    );

  if (
    !allowedActions.has(
      action
    )
  ) {
    return null;
  }

  return {
    action,
    category,
    confidence,
    severity,
    reason,
  };
}

/*
|--------------------------------------------------------------------------
| AUTOMOD INCIDENTS
|--------------------------------------------------------------------------
*/

async function getRecentAutoModIncidents(
  threadID,
  userId
) {
  await ensureAutoModTables();

  const result =
    await db.query(
      `
      SELECT *
      FROM automod_incidents
      WHERE thread_id = $1
        AND user_id = $2
        AND created_at >= $3
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [
        threadID,
        userId,
        now() -
          AUTOMOD_INCIDENT_WINDOW_MS,
      ]
    );

  return result.rows;
}

async function logAutoModIncident({
  threadID,
  userId,
  category,
  severity,
  confidence,
  suggestedAction,
  action,
  reason,
}) {
  await ensureAutoModTables();

  const finalSuggestedAction =
    suggestedAction || action;

  await db.query(
    `
    INSERT INTO automod_incidents
    (
      thread_id,
      user_id,
      category,
      severity,
      confidence,
      suggested_action,
      action,
      reason,
      created_at
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      threadID,
      userId,
      category,
      severity,
      confidence,
      finalSuggestedAction,
      action,
      reason,
      now(),
    ]
  );
}

/*
|--------------------------------------------------------------------------
| AUTOMOD MUTES
|--------------------------------------------------------------------------
*/

async function createMute(
  threadID,
  userId,
  moderatorId,
  durationMs,
  reason
) {
  await ensureAutoModTables();

  const safeDuration =
    Math.max(
      60 * 1000,
      Number(durationMs) || 0
    );

  const expiresAt =
    now() + safeDuration;

  await db.query(
    `
    UPDATE moderation_mutes
    SET active = FALSE
    WHERE thread_id = $1
      AND user_id = $2
      AND active = TRUE
    `,
    [
      threadID,
      userId,
    ]
  );

  await db.query(
    `
    INSERT INTO moderation_mutes
    (
      thread_id,
      user_id,
      moderator_id,
      reason,
      expires_at,
      active,
      created_at
    )
    VALUES
    ($1,$2,$3,$4,$5,TRUE,$6)
    `,
    [
      threadID,
      userId,
      moderatorId,
      cleanReason(reason),
      expiresAt,
      now(),
    ]
  );

  return expiresAt;
}

async function isMuted(
  threadID,
  userId
) {
  await ensureAutoModTables();

  const timestamp =
    now();

  const result =
    await db.query(
      `
      SELECT *
      FROM moderation_mutes
      WHERE thread_id = $1
        AND user_id = $2
        AND active = TRUE
        AND expires_at > $3
      ORDER BY expires_at DESC
      LIMIT 1
      `,
      [
        threadID,
        userId,
        timestamp,
      ]
    );

  if (result.rows[0]) {
    return result.rows[0];
  }

  await db.query(
    `
    UPDATE moderation_mutes
    SET active = FALSE
    WHERE thread_id = $1
      AND user_id = $2
      AND active = TRUE
      AND expires_at <= $3
    `,
    [
      threadID,
      userId,
      timestamp,
    ]
  );

  return null;
}

/*
|--------------------------------------------------------------------------
| CLASSIFIER CONNECTION
|--------------------------------------------------------------------------
*/

if (
  isAutoModClassifierConfigured()
) {
  setAutoModAnalyzer(
    classifyForAutoMod
  );
}

/*
|--------------------------------------------------------------------------
| DUPLICATE MESSAGE PROTECTION
|--------------------------------------------------------------------------
*/

function isDuplicateAutoModMessage(
  event
) {
  const messageId =
    String(
      event?.messageID ||
      event?.messageId ||
      ""
    ).trim();

  if (!messageId) {
    return false;
  }

  const timestamp =
    now();

  for (
    const [
      key,
      seenAt,
    ] of automodSeenMessageIds.entries()
  ) {
    if (
      timestamp - seenAt >
      60 * 1000
    ) {
      automodSeenMessageIds.delete(
        key
      );
    }
  }

  if (
    automodSeenMessageIds.has(
      messageId
    )
  ) {
    return true;
  }

  automodSeenMessageIds.set(
    messageId,
    timestamp
  );

  return false;
}

/*
|--------------------------------------------------------------------------
| AUTOMOD TARGET SAFETY
|--------------------------------------------------------------------------
*/

function canAutoModTarget(
  userId
) {
  return (
    !isBotOwner(userId) &&
    !isTrustedAdmin(userId)
  );
}

/*
|--------------------------------------------------------------------------
| AUTOMOD DECISION ENGINE
|--------------------------------------------------------------------------
*/

async function evaluateAutoMod({
  api,
  event,
  threadID,
  senderId,
  text,
}) {
  if (
    !threadID ||
    !senderId ||
    !text
  ) {
    return false;
  }

  if (
    event?.isBot ||
    event?.isEcho ||
    event?.isSelf
  ) {
    return false;
  }

  if (
    !canAutoModTarget(
      senderId
    )
  ) {
    return false;
  }

  if (
    isDuplicateAutoModMessage(
      event
    )
  ) {
    return false;
  }

  const settings =
    await getAutoModSettings(
      threadID
    );

  if (
    !settings.enabled
  ) {
    return false;
  }

  if (
    !(await isOwnerAway(
      threadID
    ))
  ) {
    return false;
  }

  if (
    await isMuted(
      threadID,
      senderId
    )
  ) {
    return true;
  }

  const analysis =
    await analyzeForAutoMod({
      event,
      threadID,
      senderId,
      text,
    });

  if (!analysis) {
    return false;
  }

  const modSettings =
    await getModerationSettings(
      threadID
    );

  const minConfidence =
    modSettings.automod_min_confidence;

  const muteLevel =
    modSettings.automod_mute_level;

  const banLevel =
    modSettings.automod_ban_level;

  if (
    analysis.confidence <
    minConfidence
  ) {
    await logAutoModIncident({
      threadID,
      userId: senderId,
      category: analysis.category,
      severity: analysis.severity,
      confidence: analysis.confidence,
      suggestedAction:
        analysis.action,
      action: "none",
      reason:
        "Low-confidence classification: " +
        analysis.reason,
    });

    return false;
  }

  const previous =
    await getRecentAutoModIncidents(
      threadID,
      senderId
    );

  const validPrevious =
    previous.filter(
      (incident) =>
        Number(
          incident.confidence || 0
        ) >= minConfidence
    );

  const previousSeverity =
    validPrevious.reduce(
      (total, incident) =>
        total +
        Number(
          incident.severity || 0
        ),
      0
    );

  const totalSeverity =
    previousSeverity +
    analysis.severity;

  let action =
    analysis.action;

  if (
    action === "ban" &&
    totalSeverity <
      banLevel
  ) {
    action = "mute";
  }

  if (
    action === "mute" &&
    totalSeverity <
      muteLevel
  ) {
    action = "warn";
  }

  if (
    action === "warn" &&
    analysis.severity < 2
  ) {
    action = "none";
  }

  await logAutoModIncident({
    threadID,
    userId: senderId,
    category: analysis.category,
    severity: analysis.severity,
    confidence: analysis.confidence,
    suggestedAction:
      analysis.action,
    action,
    reason: analysis.reason,
  });

  if (
    action === "none"
  ) {
    return false;
  }

  /*
   * WARN
   */
  if (
    action === "warn"
  ) {
    if (
      !modSettings.warnings_enabled
    ) {
      return false;
    }

    const warnings =
      await addWarning(
        threadID,
        senderId,
        "AUTOMOD",
        analysis.reason
      );

    await logModeration({
      threadID,
      moderatorId: "AUTOMOD",
      targetId: senderId,
      action: "automod_warn",
      reason: analysis.reason,
      success: true,
    });

    if (
      warnings.length >=
      modSettings.warn_limit
    ) {
      await logModeration({
        threadID,
        moderatorId: "AUTOMOD",
        targetId: senderId,
        action:
          "automod_warning_threshold_reached",
        reason:
          `${modSettings.warn_limit} active warnings reached`,
        success: true,
      });
    }

    return true;
  }

  /*
   * MUTE
   */
  if (
    action === "mute"
  ) {
    const severityName =
      analysis.severity >= 7
        ? "high"
        : analysis.severity >= 4
          ? "medium"
          : "low";

    const expiresAt =
      await createMute(
        threadID,
        senderId,
        "AUTOMOD",
        AUTOMOD_MUTE_DURATIONS[
          severityName
        ],
        analysis.reason
      );

    await logModeration({
      threadID,
      moderatorId: "AUTOMOD",
      targetId: senderId,
      action: "automod_mute",
      reason: analysis.reason,
      success: true,
    });

    await send(
      api,
      threadID,
      [
        "🔇 AutoMod action",
        "",
        `👤 User: ${senderId}`,
        `📌 Reason: ${analysis.reason}`,
        `⏱️ Mute expires: ${new Date(
          expiresAt
        ).toLocaleString()}`,
      ].join("\n")
    );

    return true;
  }

  /*
   * BAN
   */
  if (
    action === "ban"
  ) {
    if (
      !canAutoModTarget(
        senderId
      )
    ) {
      return false;
    }

    await createBan(
      threadID,
      senderId,
      "AUTOMOD",
      analysis.reason
    );

    const removal =
      await removeFromGroup(
        api,
        threadID,
        senderId
      );

    await logModeration({
      threadID,
      moderatorId: "AUTOMOD",
      targetId: senderId,
      action: "automod_ban",
      reason: analysis.reason,
      success: removal.ok,
    });

    await send(
      api,
      threadID,
      [
        "🔨 AutoMod action",
        "",
        `👤 User: ${senderId}`,
        `📌 Reason: ${analysis.reason}`,
        `👢 Removed from group: ${
          removal.ok
            ? "Yes"
            : "No"
        }`,
        "",
        removal.ok
          ? "The user was removed and locally banned."
          : "The Facebook removal failed, but the local ban remains active.",
      ].join("\n")
    );

    return true;
  }

  return false;
}

/*
|--------------------------------------------------------------------------
| AUTOMOD COMMAND
|--------------------------------------------------------------------------
*/

async function handleAutoModCommand(
  api,
  threadID,
  moderatorId,
  args
) {
  if (
    !isBotOwner(moderatorId)
  ) {
    await send(
      api,
      threadID,
      "❌ Only the Bot Owner can control AutoMod."
    );

    return true;
  }

  noteOwnerActivity(
    threadID,
    moderatorId
  );

  const subcommand =
    String(
      args[0] || "status"
    ).toLowerCase();

  if (
    subcommand === "on"
  ) {
    const settings =
      await setAutoModEnabled(
        threadID,
        true
      );

    const analyzerConnected =
      typeof autoModAnalyzer ===
      "function";

    await send(
      api,
      threadID,
      [
        "🛡️ AUTONOMOUS MODERATION",
        "",
        "Status: ON",
        "Mode: Owner-away",
        "Owner-away timeout: " +
          Math.round(
            Number(
              settings.owner_away_timeout
            ) / 60000
          ) +
          " minutes",
        "AI analyzer: " +
          (
            analyzerConnected
              ? "Connected"
              : "Not connected; no automatic punishment will occur."
          ),
      ].join("\n")
    );

    return true;
  }

  if (
    subcommand === "off"
  ) {
    await setAutoModEnabled(
      threadID,
      false
    );

    await send(
      api,
      threadID,
      "🛡️ AutoMod is now OFF for this group."
    );

    return true;
  }

  if (
    subcommand === "status"
  ) {
    const settings =
      await getAutoModSettings(
        threadID
      );

    const away =
      await isOwnerAway(
        threadID
      );

    const analyzerConnected =
      typeof autoModAnalyzer ===
      "function";

    await send(
      api,
      threadID,
      [
        "🛡️ AUTONOMOUS MODERATION",
        "",
        "Status: " +
          (
            settings.enabled
              ? "ON"
              : "OFF"
          ),
        "Owner-away mode: " +
          (
            away
              ? "ACTIVE"
              : "DORMANT"
          ),
        "Owner-away timeout: " +
          Math.round(
            Number(
              settings.owner_away_timeout
            ) / 60000
          ) +
          " minutes",
        "AI analyzer: " +
          (
            analyzerConnected
              ? "Connected"
              : "Not connected"
          ),
      ].join("\n")
    );

    return true;
  }

  await send(
    api,
    threadID,
    [
      "Usage:",
      "!automod on",
      "!automod off",
      "!automod status",
    ].join("\n")
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| MOD CONTROL PANEL
|--------------------------------------------------------------------------
*/

function formatMinutes(
  milliseconds
) {
  return Math.round(
    Number(milliseconds) / 60000
  );
}

function settingOnOff(
  value
) {
  return value
    ? "ON"
    : "OFF";
}

async function handleModCommand(
  api,
  threadID,
  moderatorId,
  args
) {
  if (
    !isAdmin(moderatorId)
  ) {
    await send(
      api,
      threadID,
      "❌ You do not have permission to view moderation settings."
    );

    return true;
  }

  const subcommand =
    String(
      args[0] || "status"
    ).toLowerCase();

  const settings =
    await getModerationSettings(
      threadID
    );

  /*
   * ================================================================
   * STATUS
   * ================================================================
   */

  if (
    subcommand === "status"
  ) {
    await send(
      api,
      threadID,
      [
        "🛡️ MODERATION STATUS",
        "",
        `🔗 Links: ${settingOnOff(
          settings.links_enabled
        )}`,
        `💬 Spam protection: ${settingOnOff(
          settings.spam_enabled
        )}`,
        `🏷️ Mention protection: ${settingOnOff(
          settings.mentions_enabled
        )}`,
        `🚨 Raid protection: ${settingOnOff(
          settings.raid_enabled
        )}`,
        `⚠️ Warnings: ${settingOnOff(
          settings.warnings_enabled
        )}`,
        "",
        `⚠️ Warning limit: ${settings.warn_limit}`,
        `🔇 AutoMod mute threshold: ${settings.automod_mute_level}`,
        `🔨 AutoMod ban threshold: ${settings.automod_ban_level}`,
        `🎯 AutoMod confidence: ${settings.automod_min_confidence}`,
        "",
        `👤 Your authority: ${
          isBotOwner(moderatorId)
            ? "Bot Owner"
            : "Trusted Admin"
        }`,
        "",
        "Use !mod settings for the complete configuration.",
      ].join("\n")
    );

    return true;
  }

  /*
   * ================================================================
   * SETTINGS
   * ================================================================
   */

  if (
    subcommand === "settings"
  ) {
    await send(
      api,
      threadID,
      [
        "⚙️ MODERATION SETTINGS",
        "",
        `🔗 Links: ${settingOnOff(
          settings.links_enabled
        )}`,
        `💬 Spam: ${settingOnOff(
          settings.spam_enabled
        )}`,
        `🏷️ Mentions: ${settingOnOff(
          settings.mentions_enabled
        )}`,
        `🚨 Raid: ${settingOnOff(
          settings.raid_enabled
        )}`,
        `⚠️ Warnings: ${settingOnOff(
          settings.warnings_enabled
        )}`,
        "",
        `⚠️ Warning limit: ${settings.warn_limit}`,
        `🔇 Mute threshold: ${settings.automod_mute_level}`,
        `🔨 Ban threshold: ${settings.automod_ban_level}`,
        `🎯 Confidence: ${settings.automod_min_confidence}`,
        "",
        `💬 Spam threshold: ${settings.spam_max_messages} messages / ${formatMinutes(
          settings.spam_window_ms
        )} min`,
        `🏷️ Mention threshold: ${settings.mention_max} mentions / ${formatMinutes(
          settings.mention_window_ms
        )} min`,
        "",
        "Only the Bot Owner can change these settings.",
      ].join("\n")
    );

    return true;
  }

  /*
   * ================================================================
   * FILTERS
   * ================================================================
   */

  if (
    subcommand === "filters"
  ) {
    await send(
      api,
      threadID,
      [
        "🧰 MODERATION FILTERS",
        "",
        `🔗 Link filtering: ${settingOnOff(
          settings.links_enabled
        )}`,
        `💬 Spam/flood protection: ${settingOnOff(
          settings.spam_enabled
        )}`,
        `🏷️ Mention protection: ${settingOnOff(
          settings.mentions_enabled
        )}`,
        `🚨 Raid protection: ${settingOnOff(
          settings.raid_enabled
        )}`,
        `⚠️ Warning system: ${settingOnOff(
          settings.warnings_enabled
        )}`,
        "",
        "These switches control whether each protection system is enabled for this group.",
      ].join("\n")
    );

    return true;
  }

  /*
   * ================================================================
   * THRESHOLDS
   * ================================================================
   */

  if (
    subcommand === "thresholds"
  ) {
    await send(
      api,
      threadID,
      [
        "📊 MODERATION THRESHOLDS",
        "",
        `⚠️ Warning limit: ${settings.warn_limit}`,
        `🔇 AutoMod mute level: ${settings.automod_mute_level}`,
        `🔨 AutoMod ban level: ${settings.automod_ban_level}`,
        `🎯 AutoMod confidence: ${settings.automod_min_confidence}`,
        "",
        `💬 Spam: ${settings.spam_max_messages} messages / ${formatMinutes(
          settings.spam_window_ms
        )} min`,
        `🏷️ Mentions: ${settings.mention_max} / ${formatMinutes(
          settings.mention_window_ms
        )} min`,
      ].join("\n")
    );

    return true;
  }

  /*
   * ================================================================
   * OWNER-ONLY SETTINGS CHANGES
   * ================================================================
   */

  if (
    !isBotOwner(moderatorId)
  ) {
    await send(
      api,
      threadID,
      "❌ Only the Bot Owner can change moderation settings."
    );

    return true;
  }

  noteOwnerActivity(
    threadID,
    moderatorId
  );

  /*
   * !mod links on/off
   */

  if (
    subcommand === "links"
  ) {
    const value =
      parseOnOff(
        args[1]
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod links on/off"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "links_enabled",
        value
      );

    await send(
      api,
      threadID,
      `🔗 Link filtering is now ${settingOnOff(
        updated.links_enabled
      )} for this group.`
    );

    return true;
  }

  /*
   * !mod spam on/off
   */

  if (
    subcommand === "spam"
  ) {
    const value =
      parseOnOff(
        args[1]
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod spam on/off"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "spam_enabled",
        value
      );

    await send(
      api,
      threadID,
      `💬 Spam protection is now ${settingOnOff(
        updated.spam_enabled
      )} for this group.`
    );

    return true;
  }

  /*
   * !mod mentions on/off
   */

  if (
    subcommand === "mentions"
  ) {
    const value =
      parseOnOff(
        args[1]
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod mentions on/off"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "mentions_enabled",
        value
      );

    await send(
      api,
      threadID,
      `🏷️ Mention protection is now ${settingOnOff(
        updated.mentions_enabled
      )} for this group.`
    );

    return true;
  }

  /*
   * !mod raid on/off
   */

  if (
    subcommand === "raid"
  ) {
    const value =
      parseOnOff(
        args[1]
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod raid on/off"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "raid_enabled",
        value
      );

    await send(
      api,
      threadID,
      `🚨 Raid protection is now ${settingOnOff(
        updated.raid_enabled
      )} for this group.`
    );

    return true;
  }

  /*
   * !mod warnings on/off
   */

  if (
    subcommand === "warnings"
  ) {
    const value =
      parseOnOff(
        args[1]
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod warnings on/off"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "warnings_enabled",
        value
      );

    await send(
      api,
      threadID,
      `⚠️ Warning system is now ${settingOnOff(
        updated.warnings_enabled
      )} for this group.`
    );

    return true;
  }

  /*
   * !mod warnlimit <number>
   */

  if (
    subcommand === "warnlimit"
  ) {
    const value =
      parseIntegerSetting(
        args[1],
        1,
        20
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod warnlimit <1-20>"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "warn_limit",
        value
      );

    await send(
      api,
      threadID,
      `⚠️ Warning limit set to ${updated.warn_limit}.`
    );

    return true;
  }

  /*
   * !mod mutethreshold <number>
   */

  if (
    subcommand === "mutethreshold"
  ) {
    const value =
      parseIntegerSetting(
        args[1],
        1,
        10
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod mutethreshold <1-10>"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "automod_mute_level",
        value
      );

    await send(
      api,
      threadID,
      `🔇 AutoMod mute threshold set to ${updated.automod_mute_level}.`
    );

    return true;
  }

  /*
   * !mod banthreshold <number>
   */

  if (
    subcommand === "banthreshold"
  ) {
    const value =
      parseIntegerSetting(
        args[1],
        1,
        10
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod banthreshold <1-10>"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "automod_ban_level",
        value
      );

    await send(
      api,
      threadID,
      `🔨 AutoMod ban threshold set to ${updated.automod_ban_level}.`
    );

    return true;
  }

  /*
   * !mod confidence <0-1>
   */

  if (
    subcommand === "confidence"
  ) {
    const value =
      Number(
        args[1]
      );

    if (
      !Number.isFinite(value) ||
      value < 0.5 ||
      value > 1
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod confidence <0.5-1>"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "automod_min_confidence",
        value
      );

    await send(
      api,
      threadID,
      `🎯 AutoMod confidence threshold set to ${updated.automod_min_confidence}.`
    );

    return true;
  }

  /*
   * !mod spamthreshold <count>
   */

  if (
    subcommand === "spamthreshold"
  ) {
    const value =
      parseIntegerSetting(
        args[1],
        2,
        100
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod spamthreshold <2-100>"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "spam_max_messages",
        value
      );

    await send(
      api,
      threadID,
      `💬 Spam threshold set to ${updated.spam_max_messages} messages.`
    );

    return true;
  }

  /*
   * !mod mentionthreshold <count>
   */

  if (
    subcommand === "mentionthreshold"
  ) {
    const value =
      parseIntegerSetting(
        args[1],
        1,
        100
      );

    if (
      value === null
    ) {
      await send(
        api,
        threadID,
        "Usage: !mod mentionthreshold <1-100>"
      );

      return true;
    }

    const updated =
      await updateModerationSetting(
        threadID,
        "mention_max",
        value
      );

    await send(
      api,
      threadID,
      `🏷️ Mention threshold set to ${updated.mention_max}.`
    );

    return true;
  }

  /*
   * HELP
   */

  await send(
    api,
    threadID,
    [
      "🛡️ MODERATION CONTROL",
      "",
      "!mod status",
      "!mod settings",
      "!mod filters",
      "!mod thresholds",
      "",
      "!mod links on/off",
      "!mod spam on/off",
      "!mod mentions on/off",
      "!mod raid on/off",
      "!mod warnings on/off",
      "",
      "!mod warnlimit <1-20>",
      "!mod mutethreshold <1-10>",
      "!mod banthreshold <1-10>",
      "!mod confidence <0.5-1>",
      "!mod spamthreshold <2-100>",
      "!mod mentionthreshold <1-100>",
      "",
      "👑 Only the Bot Owner can change settings.",
    ].join("\n")
  );

  return true;
}

function parseOnOff(
  value
) {
  const normalized =
    String(
      value || ""
    ).toLowerCase();

  if (
    normalized === "on" ||
    normalized === "true" ||
    normalized === "1"
  ) {
    return true;
  }

  if (
    normalized === "off" ||
    normalized === "false" ||
    normalized === "0"
  ) {
    return false;
  }

  return null;
}

function parseIntegerSetting(
  value,
  minimum,
  maximum
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    )
  ) {
    return null;
  }

  if (
    number < minimum ||
    number > maximum
  ) {
    return null;
  }

  return number;
}

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function now() {
  return Date.now();
}

function isBotOwner(
  userId
) {
  return ADMIN_IDS.includes(
    String(userId)
  );
}

function isTrustedAdmin(
  userId
) {
  return TRUSTED_ADMIN_IDS.includes(
    String(userId)
  );
}

function isAdmin(
  userId
) {
  return (
    isBotOwner(userId) ||
    isTrustedAdmin(userId)
  );
}

function getAdminLevel(
  userId
) {
  if (
    isBotOwner(userId)
  ) {
    return 3;
  }

  if (
    isTrustedAdmin(userId)
  ) {
    return 2;
  }

  return 1;
}

function cleanReason(
  reason
) {
  const value =
    String(
      reason || ""
    ).trim();

  if (!value) {
    return "No reason provided";
  }

  return value.slice(
    0,
    500
  );
}

/*
|--------------------------------------------------------------------------
| TARGET PARSING
|--------------------------------------------------------------------------
*/

function parseTargetId(
  event,
  args
) {
  const mentions =
    event?.mentions || {};

  if (
    mentions &&
    typeof mentions ===
      "object"
  ) {
    const mentionIds =
      Object.keys(
        mentions
      );

    if (
      mentionIds.length > 0
    ) {
      return String(
        mentionIds[0]
      );
    }
  }

  const first =
    String(
      args[0] || ""
    ).trim();

  if (!first) {
    return null;
  }

  return first
    .replace(/^@/, "")
    .replace(/[<>]/g, "")
    .trim();
}

function getReason(
  args,
  targetId
) {
  if (
    !args.length
  ) {
    return "No reason provided";
  }

  const reasonArgs =
    args.slice(1);

  if (
    reasonArgs.length === 0
  ) {
    return "No reason provided";
  }

  return cleanReason(
    reasonArgs.join(" ")
  );
}

/*
|--------------------------------------------------------------------------
| RATE LIMIT
|--------------------------------------------------------------------------
*/

function rateLimit(
  map,
  key,
  maxActions,
  windowMs
) {
  const timestamp =
    now();

  if (
    map.size > 1000
  ) {
    for (
      const [
        existingKey,
        entries,
      ] of map.entries()
    ) {
      const valid =
        entries.filter(
          (time) =>
            timestamp - time <
            windowMs
        );

      if (
        valid.length === 0
      ) {
        map.delete(
          existingKey
        );
      } else {
        map.set(
          existingKey,
          valid
        );
      }
    }
  }

  let entries =
    map.get(key) || [];

  entries =
    entries.filter(
      (time) =>
        timestamp - time <
        windowMs
    );

  if (
    entries.length >=
    maxActions
  ) {
    map.set(
      key,
      entries
    );

    return false;
  }

  entries.push(
    timestamp
  );

  map.set(
    key,
    entries
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| SEND
|--------------------------------------------------------------------------
*/

async function send(
  api,
  threadID,
  message
) {
  return new Promise(
    (resolve) => {
      try {
        api.sendMessage(
          message,
          threadID,
          () => resolve()
        );
      } catch (error) {
        console.error(
          "[moderation] send error:",
          error
        );

        resolve();
      }
    }
  );
}

/*
|--------------------------------------------------------------------------
| LOGGING
|--------------------------------------------------------------------------
*/

async function logModeration({
  threadID,
  moderatorId,
  targetId = null,
  action,
  reason = null,
  success = true,
}) {
  try {
    await db.query(
      `
      INSERT INTO moderation_logs
      (
        thread_id,
        moderator_id,
        target_id,
        action,
        reason,
        success,
        created_at
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        threadID,
        moderatorId,
        targetId,
        action,
        reason,
        success,
        now(),
      ]
    );
  } catch (error) {
    console.error(
      "[moderation] Failed to write moderation log:",
      error
    );
  }
}

async function logAdminAbuse({
  threadID,
  adminId,
  targetId = null,
  abuseType,
  command = null,
  amount = null,
  reason = null,
  severity = "low",
  blocked = false,
}) {
  try {
    await db.query(
      `
      INSERT INTO admin_abuse_logs
      (
        thread_id,
        admin_id,
        target_id,
        abuse_type,
        command,
        amount,
        reason,
        severity,
        blocked,
        created_at
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        threadID,
        adminId,
        targetId,
        abuseType,
        command,
        amount,
        reason,
        severity,
        blocked,
        now(),
      ]
    );
  } catch (error) {
    console.error(
      "[moderation] Failed to write abuse log:",
      error
    );
  }
}

/*
|--------------------------------------------------------------------------
| OWNER NOTIFICATION
|--------------------------------------------------------------------------
*/

async function notifyOwner(
  api,
  threadID,
  adminId,
  strikes,
  reason
) {
  if (
    !ADMIN_IDS.length ||
    !api
  ) {
    return;
  }

  const message =
    [
      "🚨 ADMIN ABUSE ALERT",
      "",
      `👮 Admin: ${adminId}`,
      `⚠️ Strikes: ${strikes}`,
      `📌 Reason: ${cleanReason(
        reason
      )}`,
      "",
      "The moderation system has detected repeated suspicious administrator activity.",
    ].join("\n");

  await send(
    api,
    threadID,
    message
  );
}

/*
|--------------------------------------------------------------------------
| ADMIN RESTRICTIONS
|--------------------------------------------------------------------------
*/

async function getAdminRestriction(
  threadID,
  adminId
) {
  const result =
    await db.query(
      `
      SELECT *
      FROM admin_restrictions
      WHERE thread_id = $1
        AND admin_id = $2
      LIMIT 1
      `,
      [
        threadID,
        adminId,
      ]
    );

  return (
    result.rows[0] ||
    null
  );
}

async function addAdminStrike(
  threadID,
  adminId,
  type = "moderation",
  api = null
) {
  const current =
    await getAdminRestriction(
      threadID,
      adminId
    );

  const strikes =
    Number(
      current?.strikes || 0
    ) + 1;

  let moderationLocked =
    Boolean(
      current?.moderation_locked
    );

  let economyLocked =
    Boolean(
      current?.economy_locked
    );

  let lockedUntil =
    current?.locked_until ||
    null;

  if (
    strikes >= 2 &&
    type === "economy"
  ) {
    economyLocked = true;
  }

  if (
    strikes >= 3
  ) {
    moderationLocked = true;

    lockedUntil =
      now() +
      ADMIN_STRIKE_LOCK_MS;
  }

  await db.query(
    `
    INSERT INTO admin_restrictions
    (
      thread_id,
      admin_id,
      moderation_locked,
      economy_locked,
      strikes,
      locked_until,
      updated_at
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,$7)

    ON CONFLICT
      (thread_id, admin_id)

    DO UPDATE SET
      moderation_locked =
        EXCLUDED.moderation_locked,
      economy_locked =
        EXCLUDED.economy_locked,
      strikes =
        EXCLUDED.strikes,
      locked_until =
        EXCLUDED.locked_until,
      updated_at =
        EXCLUDED.updated_at
    `,
    [
      threadID,
      adminId,
      moderationLocked,
      economyLocked,
      strikes,
      lockedUntil,
      now(),
    ]
  );

  if (
    strikes >=
      OWNER_NOTIFY_STRIKE_THRESHOLD &&
    api
  ) {
    await notifyOwner(
      api,
      threadID,
      adminId,
      strikes,
      `Repeated ${type} abuse`
    );
  }

  return {
    strikes,
    moderationLocked,
    economyLocked,
    lockedUntil,
  };
}

/*
|--------------------------------------------------------------------------
| MODERATION LOCK CHECK
|--------------------------------------------------------------------------
*/

async function checkAdminRestriction(
  threadID,
  adminId,
  type
) {
  if (
    isBotOwner(adminId)
  ) {
    return false;
  }

  const restriction =
    await getAdminRestriction(
      threadID,
      adminId
    );

  if (!restriction) {
    return false;
  }

  if (
    restriction.locked_until &&
    Number(
      restriction.locked_until
    ) < now()
  ) {
    await db.query(
      `
      UPDATE admin_restrictions
      SET
        moderation_locked = FALSE,
        locked_until = NULL,
        updated_at = $3
      WHERE thread_id = $1
        AND admin_id = $2
      `,
      [
        threadID,
        adminId,
        now(),
      ]
    );

    if (
      type === "moderation"
    ) {
      return false;
    }
  }

  if (
    type === "moderation" &&
    restriction.moderation_locked
  ) {
    return true;
  }

  if (
    type === "economy" &&
    restriction.economy_locked
  ) {
    return true;
  }

  return false;
}

/*
|--------------------------------------------------------------------------
| WARNINGS
|--------------------------------------------------------------------------
*/

async function getWarnings(
  threadID,
  userId
) {
  const result =
    await db.query(
      `
      SELECT *
      FROM moderation_warnings
      WHERE thread_id = $1
        AND user_id = $2
        AND active = TRUE
      ORDER BY created_at DESC
      `,
      [
        threadID,
        userId,
      ]
    );

  return result.rows;
}

async function addWarning(
  threadID,
  targetId,
  moderatorId,
  reason
) {
  await db.query(
    `
    INSERT INTO moderation_warnings
    (
      thread_id,
      user_id,
      moderator_id,
      reason,
      active,
      created_at
    )
    VALUES
    ($1,$2,$3,$4,TRUE,$5)
    `,
    [
      threadID,
      targetId,
      moderatorId,
      reason,
      now(),
    ]
  );

  return getWarnings(
    threadID,
    targetId
  );
}

/*
|--------------------------------------------------------------------------
| BAN STATE
|--------------------------------------------------------------------------
*/

async function isLocallyBanned(
  threadID,
  userId
) {
  const result =
    await db.query(
      `
      SELECT *
      FROM moderation_bans
      WHERE thread_id = $1
        AND user_id = $2
        AND active = TRUE
      LIMIT 1
      `,
      [
        threadID,
        userId,
      ]
    );

  return Boolean(
    result.rows[0]
  );
}

async function getLocalBan(
  threadID,
  userId
) {
  const result =
    await db.query(
      `
      SELECT *
      FROM moderation_bans
      WHERE thread_id = $1
        AND user_id = $2
        AND active = TRUE
      LIMIT 1
      `,
      [
        threadID,
        userId,
      ]
    );

  return (
    result.rows[0] ||
    null
  );
}

async function createBan(
  threadID,
  targetId,
  moderatorId,
  reason
) {
  await db.query(
    `
    INSERT INTO moderation_bans
    (
      thread_id,
      user_id,
      moderator_id,
      reason,
      active,
      created_at
    )
    VALUES
    ($1,$2,$3,$4,TRUE,$5)

    ON CONFLICT
      (thread_id,user_id)

    DO UPDATE SET
      moderator_id =
        EXCLUDED.moderator_id,
      reason =
        EXCLUDED.reason,
      active = TRUE,
      created_at =
        EXCLUDED.created_at
    `,
    [
      threadID,
      targetId,
      moderatorId,
      reason,
      now(),
    ]
  );
}

async function removeBan(
  threadID,
  targetId
) {
  await db.query(
    `
    UPDATE moderation_bans
    SET active = FALSE
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      threadID,
      targetId,
    ]
  );
}

/*
|--------------------------------------------------------------------------
| FACEBOOK GROUP ACTIONS
|--------------------------------------------------------------------------
|
| Returns a structured result instead of only true/false.
| This makes !kick and !ban able to show useful diagnostics.
|--------------------------------------------------------------------------
*/

function serializeFacebookError(
  error
) {
  if (!error) {
    return null;
  }

  const details = {};

  const possibleFields = [
    "code",
    "message",
    "error",
    "errorCode",
    "errorSummary",
    "errorDescription",
    "statusCode",
    "status",
  ];

  for (
    const field of possibleFields
  ) {
    if (
      error[field] !== undefined &&
      error[field] !== null
    ) {
      details[field] =
        String(error[field]);
    }
  }

  if (
    !Object.keys(details).length
  ) {
    try {
      return JSON.stringify(
        error
      );
    } catch {
      return String(error);
    }
  }

  return JSON.stringify(
    details
  );
}

async function removeFromGroup(
  api,
  threadID,
  targetId
) {
  if (
    typeof api.removeUserFromGroup !==
    "function"
  ) {
    return {
      ok: false,
      errorCode:
        "METHOD_UNAVAILABLE",
      errorMessage:
        "removeUserFromGroup is not available in the Facebook API client.",
      rawError: null,
    };
  }

  return new Promise(
    (resolve) => {
      let settled = false;

      const finish =
        (result) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(result);
        };

      try {
        api.removeUserFromGroup(
          targetId,
          threadID,
          (error) => {
            if (error) {
              console.error(
                "[moderation] removeUserFromGroup:",
                error
              );

              finish({
                ok: false,
                errorCode:
                  error?.code ||
                  error?.errorCode ||
                  "FACEBOOK_ERROR",
                errorMessage:
                  error?.message ||
                  error?.errorDescription ||
                  error?.errorSummary ||
                  "Facebook rejected the group-removal request.",
                rawError:
                  serializeFacebookError(
                    error
                  ),
              });

              return;
            }

            finish({
              ok: true,
              errorCode: null,
              errorMessage: null,
              rawError: null,
            });
          }
        );
      } catch (error) {
        console.error(
          "[moderation] Failed to remove user:",
          error
        );

        finish({
          ok: false,
          errorCode:
            error?.code ||
            error?.errorCode ||
            "EXCEPTION",
          errorMessage:
            error?.message ||
            "An exception occurred while attempting to remove the user.",
          rawError:
            serializeFacebookError(
              error
            ),
        });
      }
    }
  );
}

function formatRemovalFailure(
  removal
) {
  if (!removal) {
    return "Unknown Facebook removal error.";
  }

  const code =
    removal.errorCode
      ? String(
          removal.errorCode
        )
      : "UNKNOWN";

  const message =
    removal.errorMessage
      ? String(
          removal.errorMessage
        )
      : "Facebook rejected the request.";

  return [
    `Code: ${code}`,
    `Reason: ${message}`,
  ].join("\n");
}

/*
|--------------------------------------------------------------------------
| HIERARCHY
|--------------------------------------------------------------------------
*/

function canModerateTarget(
  moderatorId,
  targetId
) {
  if (
    isBotOwner(targetId)
  ) {
    return {
      allowed: false,
      reason:
        "The Bot Owner has the highest moderation authority.",
    };
  }

  const moderatorLevel =
    getAdminLevel(
      moderatorId
    );

  const targetLevel =
    getAdminLevel(
      targetId
    );

  if (
    targetLevel >=
    moderatorLevel
  ) {
    return {
      allowed: false,
      reason:
        "You cannot moderate an administrator with equal or higher authority.",
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

/*
|--------------------------------------------------------------------------
| MODERATION PRECHECK
|--------------------------------------------------------------------------
*/

async function validateModerator(
  api,
  threadID,
  moderatorId
) {
  if (
    !isAdmin(moderatorId)
  ) {
    await send(
      api,
      threadID,
      "❌ You do not have permission to use moderation commands."
    );

    return false;
  }

  if (
    await checkAdminRestriction(
      threadID,
      moderatorId,
      "moderation"
    )
  ) {
    await send(
      api,
      threadID,
      "🔒 Your moderation privileges are temporarily locked."
    );

    return false;
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| WARN
|--------------------------------------------------------------------------
*/

async function handleWarn(
  api,
  event,
  threadID,
  moderatorId,
  args
) {
  if (
    !(await validateModerator(
      api,
      threadID,
      moderatorId
    ))
  ) {
    return true;
  }

  const modSettings =
    await getModerationSettings(
      threadID
    );

  if (
    !modSettings.warnings_enabled
  ) {
    await send(
      api,
      threadID,
      "⚠️ The warning system is disabled for this group."
    );

    return true;
  }

  if (
    !rateLimit(
      moderationRate,
      `${threadID}:${moderatorId}`,
      MAX_MOD_ACTIONS_PER_WINDOW,
      MOD_ACTION_WINDOW_MS
    )
  ) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      abuseType:
        "moderation_rate_limit",
      command: "!warn",
      severity: "medium",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation",
      api
    );

    await send(
      api,
      threadID,
      "⚠️ Too many moderation actions in a short period. Your moderation actions are temporarily blocked."
    );

    return true;
  }

  const targetId =
    parseTargetId(
      event,
      args
    );

  if (!targetId) {
    await send(
      api,
      threadID,
      "Usage: !warn @user reason"
    );

    return true;
  }

  const permission =
    canModerateTarget(
      moderatorId,
      targetId
    );

  if (!permission.allowed) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      targetId,
      abuseType:
        "unauthorized_moderation",
      command: "!warn",
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation",
      api
    );

    await send(
      api,
      threadID,
      `🛡️ Moderation blocked.\n\n${permission.reason}`
    );

    return true;
  }

  const reason =
    getReason(
      args,
      targetId
    );

  const warnings =
    await addWarning(
      threadID,
      targetId,
      moderatorId,
      reason
    );

  await logModeration({
    threadID,
    moderatorId,
    targetId,
    action: "warn",
    reason,
  });

  if (
    warnings.length >=
    modSettings.warn_limit
  ) {
    await logModeration({
      threadID,
      moderatorId,
      targetId,
      action:
        "warning_threshold_reached",
      reason:
        `${modSettings.warn_limit} active warnings reached`,
    });
  }

  await send(
    api,
    threadID,
    [
      "⚠️ Warning issued.",
      "",
      `👤 User: ${targetId}`,
      `📌 Reason: ${reason}`,
      `⚠️ Active warnings: ${warnings.length}/${modSettings.warn_limit}`,
    ].join("\n")
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| KICK
|--------------------------------------------------------------------------
*/

async function handleKick(
  api,
  event,
  threadID,
  moderatorId,
  args
) {
  if (
    !(await validateModerator(
      api,
      threadID,
      moderatorId
    ))
  ) {
    return true;
  }

  if (
    !rateLimit(
      moderationRate,
      `${threadID}:${moderatorId}`,
      MAX_MOD_ACTIONS_PER_WINDOW,
      MOD_ACTION_WINDOW_MS
    )
  ) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      abuseType:
        "moderation_rate_limit",
      command: "!kick",
      severity: "medium",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation",
      api
    );

    await send(
      api,
      threadID,
      "⚠️ Too many moderation actions in a short period."
    );

    return true;
  }

  const targetId =
    parseTargetId(
      event,
      args
    );

  if (!targetId) {
    await send(
      api,
      threadID,
      "Usage: !kick @user reason"
    );

    return true;
  }

  const permission =
    canModerateTarget(
      moderatorId,
      targetId
    );

  if (!permission.allowed) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      targetId,
      abuseType:
        "unauthorized_kick",
      command: "!kick",
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation",
      api
    );

    await send(
      api,
      threadID,
      `🛡️ Kick blocked.\n\n${permission.reason}`
    );

    return true;
  }

  const reason =
    getReason(
      args,
      targetId
    );

  const removal =
    await removeFromGroup(
      api,
      threadID,
      targetId
    );

  await logModeration({
    threadID,
    moderatorId,
    targetId,
    action: "kick",
    reason,
    success: removal.ok,
  });

  if (
    !removal.ok
  ) {
    await send(
      api,
      threadID,
      [
        "❌ I could not remove that user.",
        "",
        `👤 Target: ${targetId}`,
        `📌 Reason: ${reason}`,
        "",
        "🔎 Facebook response:",
        formatRemovalFailure(
          removal
        ),
        "",
        "Possible causes:",
        "• The target has equal/higher Facebook group authority.",
        "• The bot account lacks Facebook-level removal authority.",
        "• Facebook rejected the request.",
        "• The Messenger/FCA session does not expose the required permission.",
      ].join("\n")
    );

    return true;
  }

  await send(
    api,
    threadID,
    [
      "👢 User removed.",
      "",
      `👤 User: ${targetId}`,
      `📌 Reason: ${reason}`,
    ].join("\n")
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| BAN
|--------------------------------------------------------------------------
*/

async function handleBan(
  api,
  event,
  threadID,
  moderatorId,
  args
) {
  if (
    !(await validateModerator(
      api,
      threadID,
      moderatorId
    ))
  ) {
    return true;
  }

  if (
    !rateLimit(
      moderationRate,
      `${threadID}:${moderatorId}`,
      MAX_MOD_ACTIONS_PER_WINDOW,
      MOD_ACTION_WINDOW_MS
    )
  ) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      abuseType:
        "moderation_rate_limit",
      command: "!ban",
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation",
      api
    );

    await send(
      api,
      threadID,
      "⚠️ Too many moderation actions in a short period."
    );

    return true;
  }

  const targetId =
    parseTargetId(
      event,
      args
    );

  if (!targetId) {
    await send(
      api,
      threadID,
      "Usage: !ban @user reason"
    );

    return true;
  }

  const permission =
    canModerateTarget(
      moderatorId,
      targetId
    );

  if (!permission.allowed) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      targetId,
      abuseType:
        "unauthorized_ban",
      command: "!ban",
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation",
      api
    );

    await send(
      api,
      threadID,
      `🛡️ Ban blocked.\n\n${permission.reason}`
    );

    return true;
  }

  const reason =
    getReason(
      args,
      targetId
    );

  await createBan(
    threadID,
    targetId,
    moderatorId,
    reason
  );

  const removal =
    await removeFromGroup(
      api,
      threadID,
      targetId
    );

  await logModeration({
    threadID,
    moderatorId,
    targetId,
    action: "ban",
    reason,
    success: removal.ok,
  });

  await send(
    api,
    threadID,
    [
      "🔨 User banned from the bot's local moderation system.",
      "",
      `👤 User: ${targetId}`,
      `📌 Reason: ${reason}`,
      `👢 Removed from group: ${
        removal.ok
          ? "Yes"
          : "No"
      }`,
      "",
      removal.ok
        ? "The user was removed and locally banned."
        : "The Facebook group removal failed, but the local ban remains active.",
      "",
      removal.ok
        ? ""
        : `🔎 Facebook: ${formatRemovalFailure(
            removal
          )}`,
    ]
      .filter(Boolean)
      .join("\n")
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| UNBAN
|--------------------------------------------------------------------------
*/

async function handleUnban(
  api,
  threadID,
  moderatorId,
  args
) {
  if (
    !(await validateModerator(
      api,
      threadID,
      moderatorId
    ))
  ) {
    return true;
  }

  const targetId =
    String(
      args[0] || ""
    )
      .replace(/^@/, "")
      .replace(/[<>]/g, "")
      .trim();

  if (!targetId) {
    await send(
      api,
      threadID,
      "Usage: !unban USER_ID"
    );

    return true;
  }

  if (
    isAdmin(targetId) &&
    !isBotOwner(moderatorId)
  ) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      targetId,
      abuseType:
        "unauthorized_admin_unban",
      command: "!unban",
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation",
      api
    );

    await send(
      api,
      threadID,
      "🛡️ Only the Bot Owner can change the local ban status of an administrator."
    );

    return true;
  }

  const existing =
    await getLocalBan(
      threadID,
      targetId
    );

  await removeBan(
    threadID,
    targetId
  );

  await logModeration({
    threadID,
    moderatorId,
    targetId,
    action: "unban",
    reason: existing
      ? "Manual unban"
      : "Unban requested; no active ban found",
  });

  await send(
    api,
    threadID,
    existing
      ? `✅ Local ban removed for ${targetId}.`
      : `ℹ️ No active local ban was found for ${targetId}.`
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| MODLOG
|--------------------------------------------------------------------------
*/

async function handleModlog(
  api,
  threadID,
  moderatorId
) {
  if (
    !isAdmin(moderatorId)
  ) {
    await send(
      api,
      threadID,
      "❌ You do not have permission to view the moderation log."
    );

    return true;
  }

  const result =
    await db.query(
      `
      SELECT
        moderator_id,
        target_id,
        action,
        reason,
        success,
        created_at
      FROM moderation_logs
      WHERE thread_id = $1
      ORDER BY created_at DESC
      LIMIT 15
      `,
      [threadID]
    );

  if (
    !result.rows.length
  ) {
    await send(
      api,
      threadID,
      "📋 No moderation actions have been logged in this group."
    );

    return true;
  }

  const lines =
    result.rows.map(
      (row, index) => {
        const date =
          new Date(
            Number(
              row.created_at
            )
          ).toLocaleString();

        return (
          `${index + 1}. ${String(
            row.action
          ).toUpperCase()}\n` +
          `👮 ${row.moderator_id}\n` +
          `👤 ${row.target_id || "—"}\n` +
          `📌 ${row.reason || "—"}\n` +
          `✅ ${
            row.success
              ? "Success"
              : "Failed"
          }\n` +
          `🕒 ${date}`
        );
      }
    );

  await send(
    api,
    threadID,
    `📋 MODERATION LOG\n\n${lines.join(
      "\n\n"
    )}`
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| ADMIN ABUSE LOG
|--------------------------------------------------------------------------
*/

async function handleAdminLog(
  api,
  threadID,
  moderatorId
) {
  if (
    !isBotOwner(moderatorId)
  ) {
    await send(
      api,
      threadID,
      "❌ Only the Bot Owner can view the administrator abuse log."
    );

    return true;
  }

  const result =
    await db.query(
      `
      SELECT
        admin_id,
        target_id,
        abuse_type,
        command,
        amount,
        reason,
        severity,
        blocked,
        created_at
      FROM admin_abuse_logs
      WHERE thread_id = $1
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [threadID]
    );

  if (
    !result.rows.length
  ) {
    await send(
      api,
      threadID,
      "📋 No administrator abuse events have been logged."
    );

    return true;
  }

  const lines =
    result.rows.map(
      (row, index) => {
        const date =
          new Date(
            Number(
              row.created_at
            )
          ).toLocaleString();

        return [
          `${index + 1}. ${String(
            row.abuse_type
          ).toUpperCase()}`,
          `👮 Admin: ${row.admin_id}`,
          `🎯 Target: ${
            row.target_id || "—"
          }`,
          `⌨️ Command: ${
            row.command || "—"
          }`,
          `💰 Amount: ${
            row.amount == null
              ? "—"
              : Number(
                  row.amount
                ).toLocaleString()
          }`,
          `⚠️ Severity: ${row.severity}`,
          `🚫 Blocked: ${
            row.blocked
              ? "Yes"
              : "No"
          }`,
          `🕒 ${date}`,
        ].join("\n");
      }
    );

  await send(
    api,
    threadID,
    `🚨 ADMIN ABUSE LOG\n\n${lines.join(
      "\n\n"
    )}`
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| ECONOMY ABUSE PROTECTION
|--------------------------------------------------------------------------
*/

function parseAmount(
  value
) {
  const clean =
    String(
      value || ""
    )
      .replace(/,/g, "")
      .trim();

  if (
    !/^\d+$/.test(clean)
  ) {
    return null;
  }

  const amount =
    Number(clean);

  if (
    !Number.isSafeInteger(
      amount
    )
  ) {
    return null;
  }

  return amount;
}

const ECONOMY_COMMANDS =
  new Set([
    "addmoney",
    "removemoney",
    "setmoney",
    "addbank",
    "removebank",
    "setbank",
    "addxp",
    "removexp",
    "setxp",
  ]);

/*
|--------------------------------------------------------------------------
| ECONOMY COMMAND INSPECTION
|--------------------------------------------------------------------------
*/

async function inspectEconomyCommand(
  threadID,
  adminId,
  originalText,
  api = null
) {
  if (
    !isAdmin(adminId)
  ) {
    return {
      handled: false,
      blocked: false,
    };
  }

  const parts =
    String(
      originalText || ""
    )
      .trim()
      .split(/\s+/);

  const command =
    String(
      parts[0] || ""
    )
      .replace(/^!/, "")
      .toLowerCase();

  if (
    !ECONOMY_COMMANDS.has(
      command
    )
  ) {
    return {
      handled: false,
      blocked: false,
    };
  }

  if (
    !isBotOwner(adminId) &&
    (await checkAdminRestriction(
      threadID,
      adminId,
      "economy"
    ))
  ) {
    await logAdminAbuse({
      threadID,
      adminId,
      abuseType:
        "economy_locked",
      command: `!${command}`,
      severity: "high",
      blocked: true,
    });

    return {
      handled: true,
      blocked: true,
      message:
        "🔒 Your economy privileges are temporarily locked.",
    };
  }

  const amount =
    parseAmount(
      parts[1]
    );

  if (
    amount === null
  ) {
    return {
      handled: false,
      blocked: false,
    };
  }

  if (
    !isBotOwner(adminId) &&
    !rateLimit(
      economyRate,
      `${threadID}:${adminId}`,
      MAX_ECONOMY_ACTIONS_PER_WINDOW,
      ECONOMY_ACTION_WINDOW_MS
    )
  ) {
    await logAdminAbuse({
      threadID,
      adminId,
      abuseType:
        "economy_rate_limit",
      command: `!${command}`,
      amount,
      severity: "high",
      blocked: true,
    });

    const restriction =
      await addAdminStrike(
        threadID,
        adminId,
        "economy",
        api
      );

    return {
      handled: true,
      blocked: true,
      message:
        restriction.economyLocked
          ? "🚨 Economy action blocked.\n\nYour economy privileges have been temporarily restricted because of repeated administrator economy activity."
          : "⚠️ Too many economy-admin actions in a short period.",
    };
  }

  const isXp =
    command.includes("xp");

  const maxAmount =
    isXp
      ? MAX_SINGLE_XP_AMOUNT
      : MAX_SINGLE_MONEY_AMOUNT;

  if (
    !isBotOwner(adminId) &&
    amount > maxAmount
  ) {
    await logAdminAbuse({
      threadID,
      adminId,
      abuseType:
        "excessive_economy_amount",
      command: `!${command}`,
      amount,
      severity: "high",
      blocked: true,
    });

    const restriction =
      await addAdminStrike(
        threadID,
        adminId,
        "economy",
        api
      );

    return {
      handled: true,
      blocked: true,
      message:
        `🚨 Economy action blocked.\n\nMaximum allowed amount for this command is ${maxAmount.toLocaleString()}.\n\n⚠️ Administrator abuse strike: ${restriction.strikes}`,
    };
  }

  let severity =
    "low";

  if (
    command === "setmoney" ||
    command === "setbank" ||
    command === "setxp"
  ) {
    severity = "medium";
  }

  await logAdminAbuse({
    threadID,
    adminId,
    abuseType:
      "economy_admin_action",
    command: `!${command}`,
    amount,
    severity,
    blocked: false,
  });

  return {
    handled: false,
    blocked: false,
  };
}

/*
|--------------------------------------------------------------------------
| LOCAL BAN / MUTE ENFORCEMENT
|--------------------------------------------------------------------------
*/

async function enforceLocalBan(
  api,
  event,
  threadID,
  senderId
) {
  if (
    isBotOwner(senderId)
  ) {
    return false;
  }

  const mute =
    await isMuted(
      threadID,
      senderId
    );

  if (mute) {
    await logModeration({
      threadID,
      moderatorId:
        mute.moderator_id,
      targetId:
        senderId,
      action:
        "blocked_mute_attempt",
      reason:
        mute.reason,
      success: true,
    });

    return true;
  }

  const ban =
    await getLocalBan(
      threadID,
      senderId
    );

  if (!ban) {
    return false;
  }

  await logModeration({
    threadID,
    moderatorId:
      ban.moderator_id,
    targetId:
      senderId,
    action:
      "blocked_local_ban_attempt",
    reason:
      ban.reason,
    success: true,
  });

  return true;
}

/*
|--------------------------------------------------------------------------
| MAIN MODERATION ROUTER
|--------------------------------------------------------------------------
*/

async function handleModerationMessage(
  api,
  event,
  text,
  originalText
) {
  const threadID =
    String(
      event?.threadID || ""
    );

  const senderId =
    String(
      event?.senderID || ""
    );

  const clean =
    String(
      originalText ||
        text ||
        ""
    ).trim();

  if (
    !threadID ||
    !senderId ||
    !clean
  ) {
    return false;
  }

  /*
   * Owner activity is recorded before anything else.
   */
  noteOwnerActivity(
    threadID,
    senderId
  );

  /*
   * ================================================================
   * LOCAL BAN / MUTE CHECK
   * ================================================================
   */

  if (
    await enforceLocalBan(
      api,
      event,
      threadID,
      senderId
    )
  ) {
    return true;
  }

  const parts =
    clean.split(/\s+/);

  const command =
    String(
      parts[0] || ""
    ).toLowerCase();

  const args =
    parts.slice(1);

  /*
   * ================================================================
   * MOD CONTROL PANEL
   * ================================================================
   */

  if (
    command === "!mod"
  ) {
    return handleModCommand(
      api,
      threadID,
      senderId,
      args
    );
  }

  /*
   * ================================================================
   * AUTOMOD COMMAND
   * ================================================================
   */

  if (
    command === "!automod"
  ) {
    return handleAutoModCommand(
      api,
      threadID,
      senderId,
      args
    );
  }

  /*
   * ================================================================
   * AUTONOMOUS MODERATION
   * ================================================================
   *
   * Only normal messages are analyzed.
   */

  if (
    !command.startsWith("!")
  ) {
    const autoModHandled =
      await evaluateAutoMod({
        api,
        event,
        threadID,
        senderId,
        text: clean,
      });

    if (
      autoModHandled
    ) {
      return true;
    }
  }

  /*
   * ================================================================
   * ECONOMY PROTECTION
   * ================================================================
   */

  if (
    ECONOMY_COMMANDS.has(
      command.replace(/^!/, "")
    )
  ) {
    const result =
      await inspectEconomyCommand(
        threadID,
        senderId,
        clean,
        api
      );

    if (
      result.blocked
    ) {
      await send(
        api,
        threadID,
        result.message
      );

      return true;
    }
  }

  /*
   * ================================================================
   * MODERATION COMMANDS
   * ================================================================
   */

  switch (command) {
    case "!warn":
      return handleWarn(
        api,
        event,
        threadID,
        senderId,
        args
      );

    case "!kick":
      return handleKick(
        api,
        event,
        threadID,
        senderId,
        args
      );

    case "!ban":
      return handleBan(
        api,
        event,
        threadID,
        senderId,
        args
      );

    case "!unban":
      return handleUnban(
        api,
        threadID,
        senderId,
        args
      );

    case "!modlog":
      return handleModlog(
        api,
        threadID,
        senderId
      );

    case "!adminlog":
      return handleAdminLog(
        api,
        threadID,
        senderId
      );

    default:
      return false;
  }
}

/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {
  handleModerationMessage,

  isBotOwner,
  isTrustedAdmin,
  isAdmin,
  getAdminLevel,

  isLocallyBanned,
  inspectEconomyCommand,

  setAutoModAnalyzer,
  noteOwnerActivity,
  getAutoModSettings,
  setAutoModEnabled,
  isMuted,

  getModerationSettings,
  updateModerationSetting,
};
