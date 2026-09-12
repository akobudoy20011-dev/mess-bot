/**
 * db.js
 * =====
 * Neon PostgreSQL persistence
 *
 * Stores:
 * - user balances
 * - game statistics
 * - inventory
 * - per-group banat/roast setting
 * - per-group game setting
 */

const { Pool } = require("pg");

const STARTING_BALANCE = 100;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  thread_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  balance       INTEGER NOT NULL DEFAULT ${STARTING_BALANCE},
  last_daily    BIGINT,
  last_work     BIGINT,
  daily_streak  INTEGER NOT NULL DEFAULT 0,
  games_played  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS thread_settings (
  thread_id      TEXT PRIMARY KEY,
  roast_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  fun_enabled    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventory (
  thread_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id, item_id)
);
`;

let pool = null;

// ------------------------------------------------------------
// CONNECTION
// ------------------------------------------------------------

async function connect() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add your Neon connection string " +
      "to Render Environment Variables."
    );
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await pool.query(SCHEMA);

  console.log("[db] connected + schema ready");
}

function requireConn() {
  if (!pool) {
    throw new Error(
      "db.connect() must be called before using db functions."
    );
  }

  return pool;
}

// ------------------------------------------------------------
// USERS
// ------------------------------------------------------------

async function getUser(threadId, userId) {
  const conn = requireConn();

  threadId = String(threadId);
  userId = String(userId);

  const { rows } = await conn.query(
    `
    SELECT *
    FROM users
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId]
  );

  if (rows.length === 0) {
    await conn.query(
      `
      INSERT INTO users
        (thread_id, user_id, balance)
      VALUES
        ($1, $2, $3)
      ON CONFLICT (thread_id, user_id)
      DO NOTHING
      `,
      [threadId, userId, STARTING_BALANCE]
    );

    return {
      thread_id: threadId,
      user_id: userId,
      balance: STARTING_BALANCE,
      last_daily: null,
      last_work: null,
      daily_streak: 0,
      games_played: 0,
      wins: 0,
    };
  }

  return rows[0];
}

async function updateUser(threadId, userId, fields) {
  const conn = requireConn();

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const allowedFields = [
    "balance",
    "last_daily",
    "last_work",
    "daily_streak",
    "games_played",
    "wins",
  ];

  const safeKeys = Object.keys(fields).filter((key) =>
    allowedFields.includes(key)
  );

  if (safeKeys.length === 0) return;

  const setClause = safeKeys
    .map((key, index) => `${key} = $${index + 3}`)
    .join(", ");

  const values = safeKeys.map((key) => fields[key]);

  await conn.query(
    `
    UPDATE users
    SET ${setClause}
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId, ...values]
  );
}

async function addBalance(threadId, userId, amount) {
  const user = await getUser(threadId, userId);

  const newBalance = Math.max(
    0,
    Number(user.balance) + Number(amount)
  );

  await updateUser(threadId, userId, {
    balance: newBalance,
  });

  return newBalance;
}

async function incrementGameStats(threadId, userId, won) {
  const user = await getUser(threadId, userId);

  await updateUser(threadId, userId, {
    games_played: Number(user.games_played) + 1,
    wins: Number(user.wins) + (won ? 1 : 0),
  });
}

async function leaderboard(threadId, limit = 10) {
  const conn = requireConn();

  const { rows } = await conn.query(
    `
    SELECT *
    FROM users
    WHERE thread_id = $1
    ORDER BY balance DESC
    LIMIT $2
    `,
    [String(threadId), Number(limit)]
  );

  return rows;
}

// ------------------------------------------------------------
// INVENTORY
// ------------------------------------------------------------

async function addItem(threadId, userId, itemId, amount = 1) {
  const conn = requireConn();

  await conn.query(
    `
    INSERT INTO inventory
      (thread_id, user_id, item_id, amount)
    VALUES
      ($1, $2, $3, $4)
    ON CONFLICT (thread_id, user_id, item_id)
    DO UPDATE SET
      amount = inventory.amount + excluded.amount
    `,
    [
      String(threadId),
      String(userId),
      String(itemId),
      Number(amount),
    ]
  );
}

async function getInventory(threadId, userId) {
  const conn = requireConn();

  const { rows } = await conn.query(
    `
    SELECT item_id, amount
    FROM inventory
    WHERE thread_id = $1
      AND user_id = $2
      AND amount > 0
    `,
    [String(threadId), String(userId)]
  );

  const result = {};

  for (const row of rows) {
    result[row.item_id] = row.amount;
  }

  return result;
}

// ------------------------------------------------------------
// THREAD SETTINGS
// ------------------------------------------------------------

async function getThreadSettings(threadId) {
  const conn = requireConn();

  const id = String(threadId);

  const { rows } = await conn.query(
    `
    SELECT *
    FROM thread_settings
    WHERE thread_id = $1
    `,
    [id]
  );

  if (rows.length === 0) {
    await conn.query(
      `
      INSERT INTO thread_settings
        (thread_id, roast_enabled, fun_enabled)
      VALUES
        ($1, TRUE, TRUE)
      ON CONFLICT (thread_id)
      DO NOTHING
      `,
      [id]
    );

    return {
      thread_id: id,
      roast_enabled: true,
      fun_enabled: true,
    };
  }

  return rows[0];
}

async function setThreadSettings(threadId, fields) {
  const conn = requireConn();

  const id = String(threadId);

  await getThreadSettings(id);

  const allowedFields = [
    "roast_enabled",
    "fun_enabled",
  ];

  const safeFields = Object.keys(fields).filter((key) =>
    allowedFields.includes(key)
  );

  if (safeFields.length === 0) {
    return getThreadSettings(id);
  }

  const setClause = safeFields
    .map((key, index) => `${key} = $${index + 2}`)
    .join(", ");

  const values = safeFields.map((key) => fields[key]);

  await conn.query(
    `
    UPDATE thread_settings
    SET ${setClause}
    WHERE thread_id = $1
    `,
    [id, ...values]
  );

  return getThreadSettings(id);
}

// ------------------------------------------------------------
// BANAT / ROAST
// ------------------------------------------------------------

async function isRoastEnabled(threadId) {
  const settings = await getThreadSettings(threadId);

  return settings.roast_enabled === true;
}

async function setRoastEnabled(threadId, enabled) {
  return setThreadSettings(threadId, {
    roast_enabled: Boolean(enabled),
  });
}

// ------------------------------------------------------------
// GAMES
// ------------------------------------------------------------

async function isGameEnabled(threadId) {
  const settings = await getThreadSettings(threadId);

  return settings.fun_enabled === true;
}

async function setGameEnabled(threadId, enabled) {
  return setThreadSettings(threadId, {
    fun_enabled: Boolean(enabled),
  });
}

// ------------------------------------------------------------
// EXPORT
// ------------------------------------------------------------

module.exports = {
  connect,

  // users
  getUser,
  updateUser,
  addBalance,
  incrementGameStats,
  leaderboard,

  // inventory
  addItem,
  getInventory,

  // settings
  getThreadSettings,
  setThreadSettings,

  // banat
  isRoastEnabled,
  setRoastEnabled,

  // games
  isGameEnabled,
  setGameEnabled,
};
