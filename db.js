/**
 * db.js
 * =====
 * Neon PostgreSQL persistence
 *
 * Includes:
 * - Wallet balance
 * - Bank balance
 * - XP + levels
 * - Ranks
 * - Daily rewards
 * - Work rewards
 * - Transfers
 * - Credit score
 * - Loan simulation
 * - Economy transactions
 * - Inventory
 * - Thread settings
 *
 * NOTE:
 * This is a virtual game economy.
 * No real-money wagering is used.
 */

const { Pool } = require("pg");

const STARTING_BALANCE = 100;
const STARTING_CREDIT_SCORE = 600;

// ============================================================
// RANKS
// ============================================================

const RANKS = [
  { name: "Beginner", xp: 0 },
  { name: "Bronze", xp: 500 },
  { name: "Silver", xp: 2000 },
  { name: "Gold", xp: 5000 },
  { name: "Platinum", xp: 12000 },
  { name: "Diamond", xp: 25000 },
  { name: "Master", xp: 50000 },
  { name: "Grandmaster", xp: 100000 },
];

// ============================================================
// DATABASE
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

  // ----------------------------------------------------------
  // ORIGINAL TABLES
  // ----------------------------------------------------------

  await pool.query(`
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
  `);

  // ----------------------------------------------------------
  // IMPORTANT:
  // ADD NEW COLUMNS TO EXISTING USERS TABLE
  //
  // This fixes the "column xp does not exist" error.
  // ----------------------------------------------------------

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS bank_balance INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS credit_score INTEGER NOT NULL DEFAULT ${STARTING_CREDIT_SCORE},
      ADD COLUMN IF NOT EXISTS loan_principal INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS loan_remaining INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS loan_due BIGINT,
      ADD COLUMN IF NOT EXISTS display_name TEXT;
  `);

  // ----------------------------------------------------------
  // THREAD SETTINGS
  // ----------------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS thread_settings (
      thread_id      TEXT PRIMARY KEY,
      roast_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
      fun_enabled     BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  // ----------------------------------------------------------
  // INVENTORY
  // ----------------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      thread_id  TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      amount      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (thread_id, user_id, item_id)
    );
  `);

  // ----------------------------------------------------------
  // ECONOMY TRANSACTIONS
  // ----------------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS economy_transactions (
      id            BIGSERIAL PRIMARY KEY,
      thread_id     TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      type          TEXT NOT NULL,
      amount        INTEGER NOT NULL,
      description   TEXT,
      created_at    BIGINT NOT NULL
    );
  `);

  console.log("[db] connected + schema/migrations ready");
}

// ============================================================
// CONNECTION CHECK
// ============================================================

function requireConn() {
  if (!pool) {
    throw new Error(
      "db.connect() must be called before using db functions."
    );
  }

  return pool;
}

// ============================================================
// USER HELPERS
// ============================================================

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
      INSERT INTO users (
        thread_id,
        user_id,
        balance,
        bank_balance,
        xp,
        level,
        credit_score
      )
      VALUES ($1, $2, $3, 0, 0, 1, $4)
      ON CONFLICT (thread_id, user_id)
      DO NOTHING
      `,
      [
        threadId,
        userId,
        STARTING_BALANCE,
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

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const allowedFields = [
    "balance",
    "bank_balance",
    "last_daily",
    "last_work",
    "daily_streak",
    "games_played",
    "wins",
    "xp",
    "level",
    "credit_score",
    "loan_principal",
    "loan_remaining",
    "loan_due",
    "display_name",
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

// ============================================================
// DISPLAY NAME
// ============================================================

async function setUserDisplayName(threadId, userId, displayName) {
  await getUser(threadId, userId);

  await updateUser(threadId, userId, {
    display_name: String(displayName || "").slice(0, 100),
  });
}

// ============================================================
// WALLET
// ============================================================

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

// ============================================================
// GAME STATS
// ============================================================

async function incrementGameStats(threadId, userId, won) {
  const user = await getUser(threadId, userId);

  await updateUser(threadId, userId, {
    games_played: Number(user.games_played) + 1,
    wins: Number(user.wins) + (won ? 1 : 0),
  });
}

// ============================================================
// XP
// ============================================================

function calculateLevel(xp) {
  xp = Math.max(0, Number(xp) || 0);

  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function getRank(xp) {
  xp = Number(xp) || 0;

  let current = RANKS[0];

  for (const rank of RANKS) {
    if (xp >= rank.xp) {
      current = rank;
    }
  }

  return current;
}

function getNextRank(xp) {
  xp = Number(xp) || 0;

  for (const rank of RANKS) {
    if (xp < rank.xp) {
      return rank;
    }
  }

  return null;
}

async function addXP(threadId, userId, amount) {
  const user = await getUser(threadId, userId);

  const oldXP = Number(user.xp) || 0;
  const newXP = Math.max(0, oldXP + Number(amount));

  const newLevel = calculateLevel(newXP);

  await updateUser(threadId, userId, {
    xp: newXP,
    level: newLevel,
  });

  return {
    xp: newXP,
    level: newLevel,
    rank: getRank(newXP),
    nextRank: getNextRank(newXP),
  };
}

// ============================================================
// WALLET LEADERBOARD
// ============================================================

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

// ============================================================
// MONEY LEADERBOARD
// ============================================================

async function moneyLeaderboard(threadId, limit = 10) {
  const conn = requireConn();

  const { rows } = await conn.query(
    `
    SELECT
      *,
      (balance + bank_balance) AS total_money
    FROM users
    WHERE thread_id = $1
    ORDER BY total_money DESC
    LIMIT $2
    `,
    [String(threadId), Number(limit)]
  );

  return rows;
}

// ============================================================
// BANK DEPOSIT
// ============================================================

async function deposit(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid deposit amount.");
  }

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT *
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [String(threadId), String(userId)]
    );

    const user = rows[0];

    if (Number(user.balance) < amount) {
      throw new Error("Not enough wallet coins.");
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
      [String(threadId), String(userId), amount]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, description, created_at)
      VALUES
        ($1, $2, 'deposit', $3, 'Bank deposit', $4)
      `,
      [
        String(threadId),
        String(userId),
        amount,
        Date.now(),
      ]
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
// BANK WITHDRAW
// ============================================================

async function withdraw(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid withdrawal amount.");
  }

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT *
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [String(threadId), String(userId)]
    );

    const user = rows[0];

    if (Number(user.bank_balance) < amount) {
      throw new Error("Not enough money in the bank.");
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
      [String(threadId), String(userId), amount]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, description, created_at)
      VALUES
        ($1, $2, 'withdraw', $3, 'Bank withdrawal', $4)
      `,
      [
        String(threadId),
        String(userId),
        amount,
        Date.now(),
      ]
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

async function transfer(threadId, fromUserId, toUserId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid transfer amount.");
  }

  fromUserId = String(fromUserId);
  toUserId = String(toUserId);

  if (fromUserId === toUserId) {
    throw new Error("You cannot transfer coins to yourself.");
  }

  await getUser(threadId, fromUserId);
  await getUser(threadId, toUserId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const senderResult = await client.query(
      `
      SELECT *
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [String(threadId), fromUserId]
    );

    const sender = senderResult.rows[0];

    if (Number(sender.balance) < amount) {
      throw new Error("You don't have enough wallet coins.");
    }

    await client.query(
      `
      UPDATE users
      SET balance = balance - $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [String(threadId), fromUserId, amount]
    );

    await client.query(
      `
      UPDATE users
      SET balance = balance + $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [String(threadId), toUserId, amount]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, description, created_at)
      VALUES
        ($1, $2, 'transfer_sent', $3, $4, $5)
      `,
      [
        String(threadId),
        fromUserId,
        amount,
        `Transfer to ${toUserId}`,
        Date.now(),
      ]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, description, created_at)
      VALUES
        ($1, $2, 'transfer_received', $3, $4, $5)
      `,
      [
        String(threadId),
        toUserId,
        amount,
        `Transfer from ${fromUserId}`,
        Date.now(),
      ]
    );

    await client.query("COMMIT");

    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================
// LOANS
// ============================================================

async function applyLoan(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid loan amount.");
  }

  const user = await getUser(threadId, userId);

  if (Number(user.loan_remaining) > 0) {
    throw new Error("You already have an active loan.");
  }

  const maxLoan = Math.max(
    500,
    Math.floor(Number(user.credit_score) * 10)
  );

  if (amount > maxLoan) {
    throw new Error(
      `Your credit score allows a maximum loan of ${maxLoan} coins.`
    );
  }

  const interestRate = 0.10;

  const totalDue = Math.ceil(
    amount * (1 + interestRate)
  );

  const dueDate =
    Date.now() + 7 * 24 * 60 * 60 * 1000;

  await updateUser(threadId, userId, {
    balance: Number(user.balance) + amount,
    loan_principal: amount,
    loan_remaining: totalDue,
    loan_due: dueDate,
  });

  return {
    principal: amount,
    totalDue,
    dueDate,
  };
}

async function payLoan(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid payment amount.");
  }

  const user = await getUser(threadId, userId);

  if (Number(user.loan_remaining) <= 0) {
    throw new Error("You don't have an active loan.");
  }

  if (Number(user.balance) < amount) {
    throw new Error("You don't have enough wallet coins.");
  }

  const payment = Math.min(
    amount,
    Number(user.loan_remaining)
  );

  const remaining =
    Number(user.loan_remaining) - payment;

  let creditScore =
    Number(user.credit_score) || STARTING_CREDIT_SCORE;

  if (remaining === 0) {
    creditScore = Math.min(850, creditScore + 20);
  }

  await updateUser(threadId, userId, {
    balance: Number(user.balance) - payment,
    loan_remaining: remaining,
    credit_score: creditScore,
    loan_principal:
      remaining === 0
        ? 0
        : Number(user.loan_principal),
    loan_due:
      remaining === 0
        ? null
        : user.loan_due,
  });

  return {
    payment,
    remaining,
    creditScore,
  };
}

// ============================================================
// BANK INTEREST
// ============================================================

async function applyBankInterest(threadId, userId) {
  const user = await getUser(threadId, userId);

  const bankBalance = Number(user.bank_balance) || 0;

  if (bankBalance <= 0) {
    return 0;
  }

  // 1% interest
  const interest = Math.floor(bankBalance * 0.01);

  if (interest <= 0) {
    return 0;
  }

  await updateUser(threadId, userId, {
    bank_balance: bankBalance + interest,
  });

  return interest;
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
      (thread_id, user_id, item_id, amount)
    VALUES
      ($1, $2, $3, $4)
    ON CONFLICT (thread_id, user_id, item_id)
    DO UPDATE SET
      amount =
        inventory.amount + excluded.amount
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
    [
      String(threadId),
      String(userId),
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
// BANAT
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
  connect,

  // Users
  getUser,
  updateUser,
  setUserDisplayName,

  // Wallet
  addBalance,

  // Stats
  incrementGameStats,

  // XP / ranks
  addXP,
  calculateLevel,
  getRank,
  getNextRank,

  // Leaderboards
  leaderboard,
  moneyLeaderboard,

  // Bank
  deposit,
  withdraw,
  applyBankInterest,

  // Transfers
  transfer,

  // Loans
  applyLoan,
  payLoan,

  // Inventory
  addItem,
  getInventory,

  // Thread settings
  getThreadSettings,
  setThreadSettings,

  // Banat
  isRoastEnabled,
  setRoastEnabled,

  // Games
  isGameEnabled,
  setGameEnabled,
};
