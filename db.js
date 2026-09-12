/**
 * db.js
 * =====
 * Neon PostgreSQL persistence
 *
 * Economy:
 * - wallet balance
 * - bank balance
 * - XP / level / rank
 * - daily / work
 * - game statistics
 * - credit score
 * - virtual loan system
 * - inventory
 * - thread settings
 */

const { Pool } = require("pg");

const STARTING_BALANCE = 100;
const STARTING_CREDIT_SCORE = 650;

const RANKS = [
  { name: "Beginner", emoji: "🪶", minXP: 0 },
  { name: "Bronze", emoji: "🥉", minXP: 500 },
  { name: "Silver", emoji: "🥈", minXP: 2000 },
  { name: "Gold", emoji: "🥇", minXP: 5000 },
  { name: "Platinum", emoji: "💎", minXP: 12000 },
  { name: "Diamond", emoji: "🔥", minXP: 25000 },
  { name: "Master", emoji: "👑", minXP: 50000 },
  { name: "Grandmaster", emoji: "🌟", minXP: 100000 }
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  thread_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,

  balance       INTEGER NOT NULL DEFAULT ${STARTING_BALANCE},
  bank_balance  INTEGER NOT NULL DEFAULT 0,

  xp            INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 1,

  last_daily    BIGINT,
  last_work     BIGINT,
  daily_streak  INTEGER NOT NULL DEFAULT 0,

  games_played  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,

  credit_score  INTEGER NOT NULL DEFAULT ${STARTING_CREDIT_SCORE},

  loan_principal INTEGER NOT NULL DEFAULT 0,
  loan_remaining  INTEGER NOT NULL DEFAULT 0,
  loan_due        BIGINT,

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

CREATE TABLE IF NOT EXISTS economy_transactions (
  id          BIGSERIAL PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_user
ON economy_transactions(thread_id, user_id);

CREATE INDEX IF NOT EXISTS idx_users_rank
ON users(thread_id, xp DESC);
`;

let pool = null;

// ============================================================
// CONNECTION
// ============================================================

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
      rejectUnauthorized: false
    }
  });

  await pool.query(SCHEMA);

  /*
   * Safe migrations for existing installations.
   */
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS bank_balance INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS credit_score INTEGER NOT NULL DEFAULT ${STARTING_CREDIT_SCORE};

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS loan_principal INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS loan_remaining INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS loan_due BIGINT;
  `);

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

// ============================================================
// RANK HELPERS
// ============================================================

function getRank(xp) {
  const value = Number(xp) || 0;

  let rank = RANKS[0];

  for (const candidate of RANKS) {
    if (value >= candidate.minXP) {
      rank = candidate;
    }
  }

  return rank;
}

function getNextRank(xp) {
  const value = Number(xp) || 0;

  return (
    RANKS.find(rank => rank.minXP > value) ||
    null
  );
}

function calculateLevel(xp) {
  return Math.max(
    1,
    Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1
  );
}

// ============================================================
// USERS
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
      INSERT INTO users
        (
          thread_id,
          user_id,
          balance,
          bank_balance,
          xp,
          level,
          credit_score
        )
      VALUES
        ($1, $2, $3, 0, 0, 1, $4)
      ON CONFLICT (thread_id, user_id)
      DO NOTHING
      `,
      [
        threadId,
        userId,
        STARTING_BALANCE,
        STARTING_CREDIT_SCORE
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

async function updateUser(threadId, userId, fields) {
  const conn = requireConn();

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const allowedFields = [
    "balance",
    "bank_balance",
    "xp",
    "level",
    "last_daily",
    "last_work",
    "daily_streak",
    "games_played",
    "wins",
    "credit_score",
    "loan_principal",
    "loan_remaining",
    "loan_due"
  ];

  const safeKeys = Object.keys(fields).filter(key =>
    allowedFields.includes(key)
  );

  if (!safeKeys.length) {
    return getUser(threadId, userId);
  }

  const setClause = safeKeys
    .map((key, index) => `${key} = $${index + 3}`)
    .join(", ");

  const values = safeKeys.map(key => fields[key]);

  await conn.query(
    `
    UPDATE users
    SET ${setClause}
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId, ...values]
  );

  return getUser(threadId, userId);
}

// ============================================================
// WALLET
// ============================================================

async function addBalance(threadId, userId, amount) {
  const conn = requireConn();

  threadId = String(threadId);
  userId = String(userId);
  amount = Number(amount);

  if (!Number.isFinite(amount)) {
    throw new Error("Invalid balance amount.");
  }

  await getUser(threadId, userId);

  const { rows } = await conn.query(
    `
    UPDATE users
    SET balance = GREATEST(0, balance + $3)
    WHERE thread_id = $1
      AND user_id = $2
    RETURNING balance
    `,
    [threadId, userId, amount]
  );

  return Number(rows[0].balance);
}

// ============================================================
// BANK
// ============================================================

async function deposit(threadId, userId, amount) {
  const conn = requireConn();

  amount = Number(amount);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Invalid deposit amount.");
  }

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
      [String(threadId), String(userId)]
    );

    if (!rows.length) {
      await getUser(threadId, userId);
    }

    const user = rows.length
      ? rows[0]
      : (await getUser(threadId, userId));

    if (Number(user.balance) < amount) {
      throw new Error("INSUFFICIENT_FUNDS");
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
        (thread_id, user_id, type, amount, created_at)
      VALUES
        ($1, $2, 'deposit', $3, $4)
      `,
      [
        String(threadId),
        String(userId),
        amount,
        Date.now()
      ]
    );

    await client.query("COMMIT");

    return getUser(threadId, userId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withdraw(threadId, userId, amount) {
  const conn = requireConn();

  amount = Number(amount);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Invalid withdrawal amount.");
  }

  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT bank_balance
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [String(threadId), String(userId)]
    );

    if (!rows.length) {
      throw new Error("USER_NOT_FOUND");
    }

    if (Number(rows[0].bank_balance) < amount) {
      throw new Error("INSUFFICIENT_FUNDS");
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
      [
        String(threadId),
        String(userId),
        amount
      ]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, created_at)
      VALUES
        ($1, $2, 'withdraw', $3, $4)
      `,
      [
        String(threadId),
        String(userId),
        amount,
        Date.now()
      ]
    );

    await client.query("COMMIT");

    return getUser(threadId, userId);
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

  amount = Number(amount);

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    throw new Error("INVALID_AMOUNT");
  }

  fromUserId = String(fromUserId);
  toUserId = String(toUserId);

  if (fromUserId === toUserId) {
    throw new Error("SELF_TRANSFER");
  }

  await getUser(threadId, fromUserId);
  await getUser(threadId, toUserId);

  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    const firstId =
      fromUserId < toUserId
        ? fromUserId
        : toUserId;

    const secondId =
      fromUserId < toUserId
        ? toUserId
        : fromUserId;

    const first = await client.query(
      `
      SELECT *
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [String(threadId), firstId]
    );

    const second = await client.query(
      `
      SELECT *
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [String(threadId), secondId]
    );

    const sender = first.rows[0].user_id === fromUserId
      ? first.rows[0]
      : second.rows[0];

    if (Number(sender.balance) < amount) {
      throw new Error("INSUFFICIENT_FUNDS");
    }

    await client.query(
      `
      UPDATE users
      SET balance = balance - $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        String(threadId),
        fromUserId,
        amount
      ]
    );

    await client.query(
      `
      UPDATE users
      SET balance = balance + $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        String(threadId),
        toUserId,
        amount
      ]
    );

    await client.query(
      `
      INSERT INTO economy_transactions
        (thread_id, user_id, type, amount, created_at)
      VALUES
        ($1, $2, 'transfer_out', $3, $4),
        ($1, $5, 'transfer_in', $3, $4)
      `,
      [
        String(threadId),
        fromUserId,
        amount,
        Date.now(),
        toUserId
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return true;
}

// ============================================================
// XP / RANK
// ============================================================

async function addXP(threadId, userId, amount) {
  const user = await getUser(threadId, userId);

  const oldXP = Number(user.xp) || 0;
  const newXP = Math.max(
    0,
    oldXP + Number(amount)
  );

  const newLevel = calculateLevel(newXP);

  await updateUser(threadId, userId, {
    xp: newXP,
    level: newLevel
  });

  return {
    xp: newXP,
    level: newLevel,
    rank: getRank(newXP),
    previousRank: getRank(oldXP)
  };
}

// ============================================================
// GAME STATS
// ============================================================

async function incrementGameStats(
  threadId,
  userId,
  won
) {
  const user = await getUser(threadId, userId);

  await updateUser(threadId, userId, {
    games_played:
      Number(user.games_played) + 1,

    wins:
      Number(user.wins) + (won ? 1 : 0)
  });
}

async function leaderboard(threadId, limit = 10) {
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
    ORDER BY xp DESC, balance DESC
    LIMIT $2
    `,
    [
      String(threadId),
      safeLimit
    ]
  );

  return rows;
}

async function moneyLeaderboard(
  threadId,
  limit = 10
) {
  const conn = requireConn();

  const safeLimit = Math.max(
    1,
    Math.min(50, Number(limit) || 10)
  );

  const { rows } = await conn.query(
    `
    SELECT *,
      (balance + bank_balance) AS net_worth
    FROM users
    WHERE thread_id = $1
    ORDER BY net_worth DESC
    LIMIT $2
    `,
    [
      String(threadId),
      safeLimit
    ]
  );

  return rows;
}

// ============================================================
// LOANS
// ============================================================

async function applyLoan(
  threadId,
  userId,
  amount
) {
  const user = await getUser(threadId, userId);

  amount = Number(amount);

  if (
    !Number.isInteger(amount) ||
    amount < 500 ||
    amount > 50000
  ) {
    throw new Error("INVALID_LOAN");
  }

  if (Number(user.loan_remaining) > 0) {
    throw new Error("EXISTING_LOAN");
  }

  const credit = Number(user.credit_score) || 650;

  if (credit < 500) {
    throw new Error("CREDIT_TOO_LOW");
  }

  /*
   * Pure game-economy loan.
   */
  const interestRate =
    credit >= 750 ? 0.05 :
    credit >= 650 ? 0.08 :
    0.12;

  const total = Math.ceil(
    amount * (1 + interestRate)
  );

  const due =
    Date.now() +
    7 * 24 * 60 * 60 * 1000;

  await updateUser(
    threadId,
    userId,
    {
      balance:
        Number(user.balance) + amount,

      loan_principal: amount,
      loan_remaining: total,
      loan_due: due
    }
  );

  return {
    amount,
    total,
    interestRate,
    due
  };
}

async function payLoan(
  threadId,
  userId,
  amount
) {
  const user = await getUser(threadId, userId);

  amount = Number(amount);

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    throw new Error("INVALID_AMOUNT");
  }

  const remaining =
    Number(user.loan_remaining) || 0;

  if (remaining <= 0) {
    throw new Error("NO_LOAN");
  }

  if (Number(user.balance) < amount) {
    throw new Error("INSUFFICIENT_FUNDS");
  }

  const payment = Math.min(
    amount,
    remaining
  );

  const newRemaining =
    remaining - payment;

  const newCredit =
    newRemaining === 0
      ? Math.min(
          850,
          Number(user.credit_score) + 25
        )
      : Number(user.credit_score);

  await updateUser(
    threadId,
    userId,
    {
      balance:
        Number(user.balance) - payment,

      loan_remaining: newRemaining,

      loan_principal:
        newRemaining === 0
          ? 0
          : Number(user.loan_principal),

      loan_due:
        newRemaining === 0
          ? null
          : user.loan_due,

      credit_score: newCredit
    }
  );

  return {
    paid: payment,
    remaining: newRemaining,
    creditScore: newCredit
  };
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
    ON CONFLICT
      (thread_id, user_id, item_id)
    DO UPDATE SET
      amount =
        inventory.amount + excluded.amount
    `,
    [
      String(threadId),
      String(userId),
      String(itemId),
      Number(amount)
    ]
  );
}

async function getInventory(
  threadId,
  userId
) {
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
      String(userId)
    ]
  );

  const result = {};

  for (const row of rows) {
    result[row.item_id] = row.amount;
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

  if (!rows.length) {
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
      fun_enabled: true
    };
  }

  return rows[0];
}

async function setThreadSettings(
  threadId,
  fields
) {
  const conn = requireConn();

  const id = String(threadId);

  await getThreadSettings(id);

  const allowedFields = [
    "roast_enabled",
    "fun_enabled"
  ];

  const safeFields =
    Object.keys(fields).filter(key =>
      allowedFields.includes(key)
    );

  if (!safeFields.length) {
    return getThreadSettings(id);
  }

  const setClause = safeFields
    .map(
      (key, index) =>
        `${key} = $${index + 2}`
    )
    .join(", ");

  const values =
    safeFields.map(key => fields[key]);

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

async function isRoastEnabled(threadId) {
  const settings =
    await getThreadSettings(threadId);

  return settings.roast_enabled === true;
}

async function setRoastEnabled(
  threadId,
  enabled
) {
  return setThreadSettings(
    threadId,
    {
      roast_enabled: Boolean(enabled)
    }
  );
}

async function isGameEnabled(threadId) {
  const settings =
    await getThreadSettings(threadId);

  return settings.fun_enabled === true;
}

async function setGameEnabled(
  threadId,
  enabled
) {
  return setThreadSettings(
    threadId,
    {
      fun_enabled: Boolean(enabled)
    }
  );
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  connect,

  getUser,
  updateUser,

  addBalance,

  deposit,
  withdraw,
  transfer,

  addXP,

  incrementGameStats,

  leaderboard,
  moneyLeaderboard,

  getRank,
  getNextRank,
  calculateLevel,

  applyLoan,
  payLoan,

  addItem,
  getInventory,

  getThreadSettings,
  setThreadSettings,

  isRoastEnabled,
  setRoastEnabled,

  isGameEnabled,
  setGameEnabled
};
