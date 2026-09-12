/**
 * db.js
 * =====
 * Neon PostgreSQL persistence
 *
 * Stores:
 * - wallet balance
 * - bank balance
 * - XP / levels / ranks
 * - game statistics
 * - inventory
 * - daily/work cooldowns
 * - credit score
 * - simulated loans
 * - per-group settings
 *
 * No real money is involved.
 */

const { Pool } = require("pg");

// ============================================================
// CONFIG
// ============================================================

const STARTING_BALANCE = 100;
const STARTING_BANK = 0;

const STARTING_CREDIT_SCORE = 500;

const RANKS = [
  { name: "Beginner", minXP: 0 },
  { name: "Bronze", minXP: 500 },
  { name: "Silver", minXP: 2000 },
  { name: "Gold", minXP: 5000 },
  { name: "Platinum", minXP: 12000 },
  { name: "Diamond", minXP: 25000 },
  { name: "Master", minXP: 50000 },
  { name: "Grandmaster", minXP: 100000 },
];

// ============================================================
// DATABASE SCHEMA
// ============================================================

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  thread_id        TEXT NOT NULL,
  user_id          TEXT NOT NULL,

  balance          INTEGER NOT NULL DEFAULT ${STARTING_BALANCE},
  bank_balance     INTEGER NOT NULL DEFAULT ${STARTING_BANK},

  xp               INTEGER NOT NULL DEFAULT 0,
  level            INTEGER NOT NULL DEFAULT 1,

  credit_score     INTEGER NOT NULL DEFAULT ${STARTING_CREDIT_SCORE},

  loan_principal   INTEGER NOT NULL DEFAULT 0,
  loan_remaining   INTEGER NOT NULL DEFAULT 0,
  loan_due         BIGINT,

  last_daily       BIGINT,
  last_work        BIGINT,

  daily_streak     INTEGER NOT NULL DEFAULT 0,

  games_played     INTEGER NOT NULL DEFAULT 0,
  wins             INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS thread_settings (
  thread_id     TEXT PRIMARY KEY,
  roast_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  fun_enabled   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventory (
  thread_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (thread_id, user_id, item_id)
);

CREATE TABLE IF NOT EXISTS economy_transactions (
  id         BIGSERIAL PRIMARY KEY,

  thread_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,

  type       TEXT NOT NULL,
  amount     INTEGER NOT NULL,

  created_at BIGINT NOT NULL
);
`;

// ============================================================
// CONNECTION
// ============================================================

let pool = null;

async function connect() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add your Neon connection string to Render Environment Variables."
    );
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  // Create tables if they don't exist.
  await pool.query(SCHEMA);

  // ==========================================================
  // MIGRATION
  // ==========================================================
  //
  // IMPORTANT:
  // CREATE TABLE IF NOT EXISTS does NOT update an old table.
  //
  // These ALTER TABLE statements make sure existing Neon
  // databases receive the new economy columns.
  //

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS bank_balance INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS credit_score INTEGER NOT NULL DEFAULT 500,
      ADD COLUMN IF NOT EXISTS loan_principal INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS loan_remaining INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS loan_due BIGINT;
  `);

  console.log("[db] connected + schema ready");
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function requireConn() {
  if (!pool) {
    throw new Error(
      "db.connect() must be called before using db functions."
    );
  }

  return pool;
}

function normalizeId(value) {
  return String(value);
}

function now() {
  return Date.now();
}

// ============================================================
// USER FUNCTIONS
// ============================================================

async function getUser(threadId, userId) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

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
        (
          thread_id,
          user_id,
          balance,
          bank_balance,
          xp,
          level,
          credit_score,
          loan_principal,
          loan_remaining
        )
      VALUES
        ($1, $2, $3, $4, 0, 1, $5, 0, 0)
      ON CONFLICT (thread_id, user_id)
      DO NOTHING
      `,
      [
        threadId,
        userId,
        STARTING_BALANCE,
        STARTING_BANK,
        STARTING_CREDIT_SCORE,
      ]
    );

    const created = await conn.query(
      `
      SELECT *
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, userId]
    );

    return created.rows[0];
  }

  return rows[0];
}

// ============================================================
// UPDATE USER
// ============================================================

async function updateUser(threadId, userId, fields) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  await getUser(threadId, userId);

  const allowedFields = [
    "balance",
    "bank_balance",
    "xp",
    "level",
    "credit_score",
    "loan_principal",
    "loan_remaining",
    "loan_due",
    "last_daily",
    "last_work",
    "daily_streak",
    "games_played",
    "wins",
  ];

  const safeKeys = Object.keys(fields).filter((key) =>
    allowedFields.includes(key)
  );

  if (safeKeys.length === 0) {
    return;
  }

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

// ============================================================
// WALLET
// ============================================================

async function addBalance(threadId, userId, amount) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  await getUser(threadId, userId);

  const value = Number(amount);

  if (!Number.isFinite(value)) {
    throw new Error("Invalid balance amount.");
  }

  const { rows } = await conn.query(
    `
    UPDATE users
    SET balance = GREATEST(0, balance + $3)
    WHERE thread_id = $1
      AND user_id = $2
    RETURNING balance
    `,
    [threadId, userId, Math.trunc(value)]
  );

  return Number(rows[0].balance);
}

// ============================================================
// GAME STATS
// ============================================================

async function incrementGameStats(threadId, userId, won) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  await getUser(threadId, userId);

  await conn.query(
    `
    UPDATE users
    SET
      games_played = games_played + 1,
      wins = wins + $3
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId, won ? 1 : 0]
  );
}

// ============================================================
// XP
// ============================================================

function calculateLevel(xp) {
  const value = Math.max(0, Number(xp) || 0);

  return Math.floor(Math.sqrt(value / 100)) + 1;
}

async function addXP(threadId, userId, amount) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  await getUser(threadId, userId);

  const xpAmount = Math.max(0, Math.trunc(Number(amount)));

  const { rows } = await conn.query(
    `
    UPDATE users
    SET
      xp = xp + $3,
      level = $4
    WHERE thread_id = $1
      AND user_id = $2
    RETURNING xp, level
    `,
    [
      threadId,
      userId,
      xpAmount,
      calculateLevel(
        (
          await getUser(threadId, userId)
        ).xp
      ) + 0,
    ]
  );

  // Recalculate level correctly from the resulting XP.
  const newXP = Number(rows[0].xp);
  const newLevel = calculateLevel(newXP);

  if (Number(rows[0].level) !== newLevel) {
    await conn.query(
      `
      UPDATE users
      SET level = $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, userId, newLevel]
    );
  }

  return {
    xp: newXP,
    level: newLevel,
  };
}

// ============================================================
// RANKS
// ============================================================

function getRank(xp) {
  const value = Math.max(0, Number(xp) || 0);

  let current = RANKS[0];

  for (const rank of RANKS) {
    if (value >= rank.minXP) {
      current = rank;
    } else {
      break;
    }
  }

  return current;
}

function getNextRank(xp) {
  const value = Math.max(0, Number(xp) || 0);

  for (const rank of RANKS) {
    if (value < rank.minXP) {
      return rank;
    }
  }

  return null;
}

function getRankProgress(xp) {
  const value = Math.max(0, Number(xp) || 0);

  const current = getRank(value);
  const next = getNextRank(value);

  if (!next) {
    return {
      current,
      next: null,
      progress: 100,
      remaining: 0,
    };
  }

  const range = next.minXP - current.minXP;
  const progress =
    range <= 0
      ? 100
      : Math.floor(
          ((value - current.minXP) / range) * 100
        );

  return {
    current,
    next,
    progress: Math.max(0, Math.min(100, progress)),
    remaining: Math.max(0, next.minXP - value),
  };
}

// ============================================================
// MONEY LEADERBOARD
// ============================================================

async function moneyLeaderboard(threadId, limit = 10) {
  const conn = requireConn();

  const safeLimit = Math.max(
    1,
    Math.min(50, Number(limit) || 10)
  );

  const { rows } = await conn.query(
    `
    SELECT *
    FROM users
    WHERE thread_id = $1
    ORDER BY (balance + bank_balance) DESC
    LIMIT $2
    `,
    [normalizeId(threadId), safeLimit]
  );

  return rows;
}

// ============================================================
// OLD LEADERBOARD COMPATIBILITY
// ============================================================

async function leaderboard(threadId, limit = 10) {
  return moneyLeaderboard(threadId, limit);
}

// ============================================================
// BANK
// ============================================================

async function deposit(threadId, userId, amount) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  const value = Math.trunc(Number(amount));

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Deposit amount must be greater than 0.");
  }

  // Make sure the user exists BEFORE starting the transaction.
  await getUser(threadId, userId);

  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT balance, bank_balance
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User does not exist.");
    }

    const wallet = Number(rows[0].balance);

    if (wallet < value) {
      throw new Error("Insufficient wallet balance.");
    }

    await client.query(
      `
      UPDATE users
      SET
        balance = balance - $3,
        bank_balance = bank_balance + $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, userId, value]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, created_at)
      VALUES
        ($1, $2, 'deposit', $3, $4)
      `,
      [threadId, userId, value, now()]
    );

    await client.query("COMMIT");

    return await getUser(threadId, userId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withdraw(threadId, userId, amount) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  const value = Math.trunc(Number(amount));

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Withdrawal amount must be greater than 0.");
  }

  await getUser(threadId, userId);

  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT balance, bank_balance
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User does not exist.");
    }

    const bank = Number(rows[0].bank_balance);

    if (bank < value) {
      throw new Error("Insufficient bank balance.");
    }

    await client.query(
      `
      UPDATE users
      SET
        bank_balance = bank_balance - $3,
        balance = balance + $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, userId, value]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, created_at)
      VALUES
        ($1, $2, 'withdraw', $3, $4)
      `,
      [threadId, userId, value, now()]
    );

    await client.query("COMMIT");

    return await getUser(threadId, userId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================
// TRANSFER
// ============================================================

async function transfer(
  threadId,
  fromUserId,
  toUserId,
  amount
) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  fromUserId = normalizeId(fromUserId);
  toUserId = normalizeId(toUserId);

  const value = Math.trunc(Number(amount));

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Transfer amount must be greater than 0.");
  }

  if (fromUserId === toUserId) {
    throw new Error("You cannot transfer to yourself.");
  }

  await getUser(threadId, fromUserId);
  await getUser(threadId, toUserId);

  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    // Lock both users in deterministic order.
    const firstId =
      fromUserId < toUserId ? fromUserId : toUserId;

    const secondId =
      fromUserId < toUserId ? toUserId : fromUserId;

    await client.query(
      `
      SELECT user_id
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, firstId]
    );

    await client.query(
      `
      SELECT user_id
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, secondId]
    );

    const { rows } = await client.query(
      `
      SELECT balance
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, fromUserId]
    );

    const senderBalance = Number(rows[0].balance);

    if (senderBalance < value) {
      throw new Error("Insufficient wallet balance.");
    }

    await client.query(
      `
      UPDATE users
      SET balance = balance - $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, fromUserId, value]
    );

    await client.query(
      `
      UPDATE users
      SET balance = balance + $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, toUserId, value]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, created_at)
      VALUES
        ($1, $2, 'transfer_sent', $3, $4),
        ($1, $5, 'transfer_received', $3, $4)
      `,
      [
        threadId,
        fromUserId,
        value,
        now(),
        toUserId,
      ]
    );

    await client.query("COMMIT");

    return {
      amount: value,
      from: await getUser(threadId, fromUserId),
      to: await getUser(threadId, toUserId),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================
// BANK INTEREST
// ============================================================

async function applyBankInterest(threadId, userId) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  await getUser(threadId, userId);

  // 1% simulated interest.
  const INTEREST_RATE = 0.01;

  const { rows } = await conn.query(
    `
    SELECT bank_balance
    FROM users
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId]
  );

  if (!rows.length) {
    return 0;
  }

  const bankBalance = Number(rows[0].bank_balance);

  if (bankBalance <= 0) {
    return 0;
  }

  const interest = Math.floor(
    bankBalance * INTEREST_RATE
  );

  if (interest <= 0) {
    return 0;
  }

  await conn.query(
    `
    UPDATE users
    SET bank_balance = bank_balance + $3
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId, interest]
  );

  await conn.query(
    `
    INSERT INTO economy_transactions
      (thread_id, user_id, type, amount, created_at)
    VALUES
      ($1, $2, 'bank_interest', $3, $4)
    `,
    [threadId, userId, interest, now()]
  );

  return interest;
}

// ============================================================
// LOANS
// ============================================================

async function applyLoan(threadId, userId, amount) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  const value = Math.trunc(Number(amount));

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Loan amount must be greater than 0.");
  }

  await getUser(threadId, userId);

  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT
        credit_score,
        loan_remaining
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    const user = rows[0];

    if (Number(user.loan_remaining) > 0) {
      throw new Error(
        "You already have an active loan."
      );
    }

    const creditScore = Number(user.credit_score);

    if (creditScore < 400) {
      throw new Error(
        "Your credit score is too low for another loan."
      );
    }

    const maxLoan = Math.max(
      500,
      Math.floor(creditScore * 10)
    );

    if (value > maxLoan) {
      throw new Error(
        `Your current maximum loan is ${maxLoan} coins.`
      );
    }

    // 10% simulated interest.
    const totalDue = Math.ceil(value * 1.1);

    const dueDate =
      Date.now() +
      7 * 24 * 60 * 60 * 1000;

    await client.query(
      `
      UPDATE users
      SET
        balance = balance + $3,
        loan_principal = $3,
        loan_remaining = $4,
        loan_due = $5
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        threadId,
        userId,
        value,
        totalDue,
        dueDate,
      ]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, created_at)
      VALUES
        ($1, $2, 'loan', $3, $4)
      `,
      [threadId, userId, value, now()]
    );

    await client.query("COMMIT");

    return await getUser(threadId, userId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function payLoan(threadId, userId, amount) {
  const conn = requireConn();

  threadId = normalizeId(threadId);
  userId = normalizeId(userId);

  const value = Math.trunc(Number(amount));

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      "Loan payment must be greater than 0."
    );
  }

  await getUser(threadId, userId);

  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT
        balance,
        loan_remaining
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    const user = rows[0];

    const balance = Number(user.balance);
    const remaining = Number(user.loan_remaining);

    if (remaining <= 0) {
      throw new Error("You do not have an active loan.");
    }

    if (balance < value) {
      throw new Error(
        "You do not have enough wallet coins."
      );
    }

    const payment = Math.min(value, remaining);
    const newRemaining = remaining - payment;

    // Successful repayment improves credit score.
    const newCreditScore =
      newRemaining === 0
        ? Math.min(
            850,
            Number(
              (
                await client.query(
                  `
                  SELECT credit_score
                  FROM users
                  WHERE thread_id = $1
                    AND user_id = $2
                  `,
                  [threadId, userId]
                )
              ).rows[0].credit_score
            ) + 25
          )
        : Number(
            (
              await client.query(
                `
                SELECT credit_score
                FROM users
                WHERE thread_id = $1
                  AND user_id = $2
                `,
                [threadId, userId]
              )
            ).rows[0].credit_score
          );

    await client.query(
      `
      UPDATE users
      SET
        balance = balance - $3,
        loan_remaining = $4,
        credit_score = $5,

        loan_principal =
          CASE
            WHEN $4 = 0 THEN 0
            ELSE loan_principal
          END,

        loan_due =
          CASE
            WHEN $4 = 0 THEN NULL
            ELSE loan_due
          END

      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        threadId,
        userId,
        payment,
        newRemaining,
        newCreditScore,
      ]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, created_at)
      VALUES
        ($1, $2, 'loan_payment', $3, $4)
      `,
      [threadId, userId, payment, now()]
    );

    await client.query("COMMIT");

    return await getUser(threadId, userId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================
// INVENTORY
// ============================================================

async function addItem(
  threadId,
  userId,
  itemId,
  amount = 1
) {
  const conn = requireConn();

  await conn.query(
    `
    INSERT INTO inventory
      (
        thread_id,
        user_id,
        item_id,
        amount
      )
    VALUES
      ($1, $2, $3, $4)

    ON CONFLICT
      (thread_id, user_id, item_id)

    DO UPDATE SET
      amount =
        inventory.amount +
        excluded.amount
    `,
    [
      normalizeId(threadId),
      normalizeId(userId),
      normalizeId(itemId),
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
    [
      normalizeId(threadId),
      normalizeId(userId),
    ]
  );

  const result = {};

  for (const row of rows) {
    result[row.item_id] = Number(row.amount);
  }

  return result;
}

// ============================================================
// THREAD SETTINGS
// ============================================================

async function getThreadSettings(threadId) {
  const conn = requireConn();

  const id = normalizeId(threadId);

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
        (
          thread_id,
          roast_enabled,
          fun_enabled
        )
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

async function setThreadSettings(
  threadId,
  fields
) {
  const conn = requireConn();

  const id = normalizeId(threadId);

  await getThreadSettings(id);

  const allowedFields = [
    "roast_enabled",
    "fun_enabled",
  ];

  const safeFields = Object.keys(fields).filter(
    (key) => allowedFields.includes(key)
  );

  if (safeFields.length === 0) {
    return getThreadSettings(id);
  }

  const setClause = safeFields
    .map(
      (key, index) =>
        `${key} = $${index + 2}`
    )
    .join(", ");

  const values = safeFields.map(
    (key) => fields[key]
  );

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

// ============================================================
// ROAST / BANAT
// ============================================================

async function isRoastEnabled(threadId) {
  const settings =
    await getThreadSettings(threadId);

  return settings.roast_enabled === true;
}

async function setRoastEnabled(
  threadId,
  enabled
) {
  return setThreadSettings(threadId, {
    roast_enabled: Boolean(enabled),
  });
}

// ============================================================
// GAMES ENABLED
// ============================================================

async function isGameEnabled(threadId) {
  const settings =
    await getThreadSettings(threadId);

  return settings.fun_enabled === true;
}

async function setGameEnabled(
  threadId,
  enabled
) {
  return setThreadSettings(threadId, {
    fun_enabled: Boolean(enabled),
  });
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Connection
  connect,

  // Users
  getUser,
  updateUser,

  // Wallet
  addBalance,

  // Stats
  incrementGameStats,

  // XP / levels
  addXP,
  calculateLevel,

  // Ranks
  getRank,
  getNextRank,
  getRankProgress,

  // Leaderboards
  leaderboard,
  moneyLeaderboard,

  // Bank
  deposit,
  withdraw,
  transfer,
  applyBankInterest,

  // Loans
  applyLoan,
  payLoan,

  // Inventory
  addItem,
  getInventory,

  // Thread settings
  getThreadSettings,
  setThreadSettings,

  // Roast
  isRoastEnabled,
  setRoastEnabled,

  // Games
  isGameEnabled,
  setGameEnabled,
};
