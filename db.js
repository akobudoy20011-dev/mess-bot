/**
 * db.js
 * =====
 * Postgres persistence layer (Neon), keyed by (threadId, userId) —
 * the Messenger equivalent of the Discord bot's (guild_id, user_id)
 * scoping in database.py. Each thread has its own independent economy.
 *
 * Setup: sign up at neon.tech (free, no card), create a project, copy
 * the connection string, set it as DATABASE_URL in Render's env vars.
 *
 * Usage from index.js:
 *   const db = require('./db');
 *   await db.connect();
 *   const user = await db.getUser(threadId, senderId);
 */

const { Pool } = require('pg');

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
  item_id    TEXT NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id, item_id)
);
`;

let pool = null;

async function connect() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Create a free Neon Postgres project ' +
      'at neon.tech and set DATABASE_URL in Render env vars.'
    );
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Neon requires SSL
  });

  await pool.query(SCHEMA);
  console.log('[db] connected + schema ready');
}

function requireConn() {
  if (!pool) throw new Error('db.connect() must be called before using db.*');
  return pool;
}

// ------------------------------------------------------------
// USERS
// ------------------------------------------------------------

async function getUser(threadId, userId) {
  const conn = requireConn();

  const { rows } = await conn.query(
    'SELECT * FROM users WHERE thread_id = $1 AND user_id = $2',
    [threadId, userId]
  );

  if (rows.length === 0) {
    await conn.query(
      'INSERT INTO users (thread_id, user_id, balance) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (thread_id, user_id) DO NOTHING',
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
  await getUser(threadId, userId); // ensure row exists

  const keys = Object.keys(fields);
  if (keys.length === 0) return;

  const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const values = keys.map((k) => fields[k]);

  await conn.query(
    `UPDATE users SET ${setClause} WHERE thread_id = $1 AND user_id = $2`,
    [threadId, userId, ...values]
  );
}

async function addBalance(threadId, userId, amount) {
  const user = await getUser(threadId, userId);
  const newBalance = Math.max(0, user.balance + amount);
  await updateUser(threadId, userId, { balance: newBalance });
  return newBalance;
}

async function incrementGameStats(threadId, userId, won) {
  const user = await getUser(threadId, userId);
  await updateUser(threadId, userId, {
    games_played: user.games_played + 1,
    wins: user.wins + (won ? 1 : 0),
  });
}

async function leaderboard(threadId, limit = 10) {
  const conn = requireConn();
  const { rows } = await conn.query(
    'SELECT * FROM users WHERE thread_id = $1 ORDER BY balance DESC LIMIT $2',
    [threadId, limit]
  );
  return rows;
}

// ------------------------------------------------------------
// INVENTORY
// ------------------------------------------------------------

async function addItem(threadId, userId, itemId, amount = 1) {
  const conn = requireConn();
  await conn.query(
    'INSERT INTO inventory (thread_id, user_id, item_id, amount) ' +
    'VALUES ($1, $2, $3, $4) ' +
    'ON CONFLICT (thread_id, user_id, item_id) ' +
    'DO UPDATE SET amount = inventory.amount + excluded.amount',
    [threadId, userId, itemId, amount]
  );
}

async function getInventory(threadId, userId) {
  const conn = requireConn();
  const { rows } = await conn.query(
    'SELECT item_id, amount FROM inventory ' +
    'WHERE thread_id = $1 AND user_id = $2 AND amount > 0',
    [threadId, userId]
  );
  const result = {};
  for (const row of rows) result[row.item_id] = row.amount;
  return result;
}

// ------------------------------------------------------------
// THREAD SETTINGS (roast/fun toggles — now persistent instead of
// living in a JS Map that resets on every redeploy)
// ------------------------------------------------------------

async function getThreadSettings(threadId) {
  const conn = requireConn();
  const { rows } = await conn.query(
    'SELECT * FROM thread_settings WHERE thread_id = $1',
    [threadId]
  );

  if (rows.length === 0) {
    await conn.query(
      'INSERT INTO thread_settings (thread_id) VALUES ($1) ' +
      'ON CONFLICT (thread_id) DO NOTHING',
      [threadId]
    );
    return { thread_id: threadId, roast_enabled: true, fun_enabled: true };
  }

  return rows[0];
}

async function setThreadSettings(threadId, fields) {
  const conn = requireConn();
  await getThreadSettings(threadId);

  const keys = Object.keys(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);

  await conn.query(
    `UPDATE thread_settings SET ${setClause} WHERE thread_id = $1`,
    [threadId, ...values]
  );
}

module.exports = {
  connect,
  getUser,
  updateUser,
  addBalance,
  incrementGameStats,
  leaderboard,
  addItem,
  getInventory,
  getThreadSettings,
  setThreadSettings,
};
