/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║                     DATABASE LAYER                      ║
 * ║                  Neon PostgreSQL                         ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Virtual economy persistence for the Messenger bot.
 *
 * ──────────────────────────────────────────────────────────
 * FEATURES
 * ──────────────────────────────────────────────────────────
 * • Wallet balance
 * • Bank balance
 * • XP + levels
 * • Ranks
 * • Daily rewards
 * • Work rewards
 * • Transfers
 * • Credit score
 * • Loan simulation
 * • Economy transactions
 * • Inventory
 * • Thread settings
 * • Display names
 * • XP / money leaderboards
 *
 * NOTE:
 * This is a virtual game economy.
 * No real-money wagering is used.
 */

const { Pool } = require("pg");


// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const STARTING_BALANCE = 100;
const STARTING_CREDIT_SCORE = 600;


// ═══════════════════════════════════════════════════════════
// RANK SYSTEM
// ═══════════════════════════════════════════════════════════

const RANKS = [
  { name: "Beginner",    xp: 0,       emoji: "🌱" },
  { name: "Bronze",      xp: 500,     emoji: "🥉" },
  { name: "Silver",      xp: 2_000,   emoji: "🥈" },
  { name: "Gold",        xp: 5_000,   emoji: "🥇" },
  { name: "Platinum",    xp: 12_000,  emoji: "💠" },
  { name: "Diamond",     xp: 25_000,  emoji: "💎" },
  { name: "Master",      xp: 50_000,  emoji: "🔥" },
  { name: "Grandmaster", xp: 100_000, emoji: "👑" },
];


// ═══════════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════

let pool = null;


/**
 * Connect to Neon PostgreSQL and initialize the database schema.
 *
 * Existing tables are preserved.
 * Missing columns are added through migrations.
 */
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


  // ─────────────────────────────────────────────────────────
  // USERS
  // ─────────────────────────────────────────────────────────

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


  // ─────────────────────────────────────────────────────────
  // USER MIGRATIONS
  //
  // CREATE TABLE IF NOT EXISTS does NOT modify an existing
  // table. These migrations safely add newer columns.
  //
  // Existing users/data are preserved.
  // ─────────────────────────────────────────────────────────

  await pool.query(`
    ALTER TABLE users

      ADD COLUMN IF NOT EXISTS
        bank_balance INTEGER NOT NULL DEFAULT 0,

      ADD COLUMN IF NOT EXISTS
        xp INTEGER NOT NULL DEFAULT 0,

      ADD COLUMN IF NOT EXISTS
        level INTEGER NOT NULL DEFAULT 1,

      ADD COLUMN IF NOT EXISTS
        credit_score INTEGER NOT NULL DEFAULT ${STARTING_CREDIT_SCORE},

      ADD COLUMN IF NOT EXISTS
        loan_principal INTEGER NOT NULL DEFAULT 0,

      ADD COLUMN IF NOT EXISTS
        loan_remaining INTEGER NOT NULL DEFAULT 0,

      ADD COLUMN IF NOT EXISTS
        loan_due BIGINT,

      ADD COLUMN IF NOT EXISTS
        last_interest_paid BIGINT,

      ADD COLUMN IF NOT EXISTS
        display_name TEXT;
  `);


  // ─────────────────────────────────────────────────────────
  // THREAD SETTINGS
  // ─────────────────────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS thread_settings (
      thread_id      TEXT PRIMARY KEY,

      roast_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
      fun_enabled    BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);


  // ─────────────────────────────────────────────────────────
  // THREAD SETTINGS MIGRATIONS
  //
  // Same reasoning as the `users` migration above: if this
  // table already existed from an earlier deploy (back when
  // it only tracked roast_enabled), CREATE TABLE IF NOT EXISTS
  // is a no-op and fun_enabled would silently never get added.
  // ─────────────────────────────────────────────────────────

  await pool.query(`
    ALTER TABLE thread_settings

      ADD COLUMN IF NOT EXISTS
        fun_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  `);


  // ─────────────────────────────────────────────────────────
  // INVENTORY
  // ─────────────────────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      thread_id  TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      item_id    TEXT NOT NULL,

      amount     INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (
        thread_id,
        user_id,
        item_id
      )
    );
  `);


  // ─────────────────────────────────────────────────────────
  // ECONOMY TRANSACTIONS
  // ─────────────────────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS economy_transactions (
      id           BIGSERIAL PRIMARY KEY,

      thread_id    TEXT NOT NULL,
      user_id      TEXT NOT NULL,

      type         TEXT NOT NULL,
      amount       INTEGER NOT NULL,

      description  TEXT,

      created_at   BIGINT NOT NULL
    );
  `);


  // ─────────────────────────────────────────────────────────
  // ECONOMY TRANSACTIONS MIGRATION
  //
  // THE BUG FIX: CREATE TABLE IF NOT EXISTS above does nothing
  // if economy_transactions already existed from an earlier
  // deploy (before `description` was added to this schema).
  // Every deposit/withdraw/transfer insert includes a
  // `description` value, so on any pre-existing table this was
  // throwing:
  //   column "description" of relation "economy_transactions"
  //   does not exist
  // This ALTER TABLE brings older tables up to date the same
  // way the `users` migration above already does.
  // ─────────────────────────────────────────────────────────

  await pool.query(`
    ALTER TABLE economy_transactions

      ADD COLUMN IF NOT EXISTS
        description TEXT;
  `);


  console.log(
    "╔══════════════════════════════════════════════════════════╗"
  );

  console.log(
    "║                 DATABASE ONLINE ✓                       ║"
  );

  console.log(
    "║                  Neon PostgreSQL                        ║"
  );

  console.log(
    "║                                                        ║"
  );

  console.log(
    "║  ✓ Users        ✓ Inventory       ✓ Transactions       ║"
  );

  console.log(
    "║  ✓ Banking      ✓ Loans           ✓ Thread settings    ║"
  );

  console.log(
    "║  ✓ XP / Ranks   ✓ Display names                         ║"
  );

  console.log(
    "╚══════════════════════════════════════════════════════════╝"
  );
}


// ═══════════════════════════════════════════════════════════
// CONNECTION GUARD
// ═══════════════════════════════════════════════════════════

function requireConn() {
  if (!pool) {
    throw new Error(
      "db.connect() must be called before using db functions."
    );
  }

  return pool;
}


// ═══════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════

/**
 * Get an existing user.
 *
 * If the user doesn't exist yet, automatically creates them
 * with the starting balance and credit score.
 */
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
    [
      threadId,
      userId,
    ]
  );


  if (rows.length > 0) {
    return rows[0];
  }


  // ─────────────────────────────────────────────────────────
  // CREATE NEW USER
  // ─────────────────────────────────────────────────────────

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

    VALUES (
      $1,
      $2,
      $3,
      0,
      0,
      1,
      $4
    )

    ON CONFLICT (
      thread_id,
      user_id
    )

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
    [
      threadId,
      userId,
    ]
  );


  return created.rows[0];
}


// ═══════════════════════════════════════════════════════════
// USER UPDATES
// ═══════════════════════════════════════════════════════════

async function updateUser(
  threadId,
  userId,
  fields
) {
  const conn = requireConn();

  threadId = String(threadId);
  userId = String(userId);


  // Make sure the user exists first.
  await getUser(
    threadId,
    userId
  );


  // Only these database columns may be modified.
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
    "last_interest_paid",

    "display_name",
  ];


  const safeKeys =
    Object.keys(fields).filter(
      (key) =>
        allowedFields.includes(key)
    );


  if (safeKeys.length === 0) {
    return;
  }


  const setClause =
    safeKeys
      .map(
        (key, index) =>
          `${key} = $${index + 3}`
      )
      .join(", ");


  const values =
    safeKeys.map(
      (key) => fields[key]
    );


  await conn.query(
    `
    UPDATE users

    SET ${setClause}

    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      threadId,
      userId,
      ...values,
    ]
  );
}


// ═══════════════════════════════════════════════════════════
// DISPLAY NAME
// ═══════════════════════════════════════════════════════════

async function setUserDisplayName(
  threadId,
  userId,
  displayName
) {
  await getUser(
    threadId,
    userId
  );


  const name =
    String(displayName || "")
      .trim()
      .slice(0, 100);


  if (!name) {
    return;
  }


  await updateUser(
    threadId,
    userId,
    {
      display_name: name,
    }
  );
}


// ═══════════════════════════════════════════════════════════
// WALLET
// ═══════════════════════════════════════════════════════════

async function addBalance(
  threadId,
  userId,
  amount
) {
  const user =
    await getUser(
      threadId,
      userId
    );


  const newBalance =
    Math.max(
      0,
      Number(user.balance) +
        Number(amount)
    );


  await updateUser(
    threadId,
    userId,
    {
      balance: newBalance,
    }
  );


  return newBalance;
}


// ═══════════════════════════════════════════════════════════
// GAME STATISTICS
// ═══════════════════════════════════════════════════════════

async function incrementGameStats(
  threadId,
  userId,
  won
) {
  const user =
    await getUser(
      threadId,
      userId
    );


  await updateUser(
    threadId,
    userId,
    {
      games_played:
        Number(user.games_played) + 1,

      wins:
        Number(user.wins) +
        (won ? 1 : 0),
    }
  );
}


// ═══════════════════════════════════════════════════════════
// XP / LEVEL SYSTEM
// ═══════════════════════════════════════════════════════════

function calculateLevel(xp) {
  xp =
    Math.max(
      0,
      Number(xp) || 0
    );


  return (
    Math.floor(
      Math.sqrt(
        xp / 100
      )
    ) + 1
  );
}


function getRank(xp) {
  xp =
    Number(xp) || 0;


  let current =
    RANKS[0];


  for (const rank of RANKS) {
    if (xp >= rank.xp) {
      current = rank;
    }
  }


  return current;
}


function getNextRank(xp) {
  xp =
    Number(xp) || 0;


  for (const rank of RANKS) {
    if (xp < rank.xp) {
      return rank;
    }
  }


  return null;
}


async function addXP(
  threadId,
  userId,
  amount
) {
  const user =
    await getUser(
      threadId,
      userId
    );


  const oldXP =
    Number(user.xp) || 0;

  // Captured BEFORE the update so callers (games.js's
  // awardPlayer) can detect a rank-up by comparing this
  // against the post-update rank.
  const previousRank =
    getRank(oldXP);


  const newXP =
    Math.max(
      0,
      oldXP + Number(amount)
    );


  const newLevel =
    calculateLevel(
      newXP
    );


  await updateUser(
    threadId,
    userId,
    {
      xp: newXP,
      level: newLevel,
    }
  );


  return {
    xp: newXP,

    level: newLevel,

    rank:
      getRank(newXP),

    previousRank,

    nextRank:
      getNextRank(newXP),
  };
}


// ═══════════════════════════════════════════════════════════
// FULL PLAYER RANKING DETAILS
// ═══════════════════════════════════════════════════════════

async function getPlayerRanking(
  threadId,
  userId
) {
  const user =
    await getUser(
      threadId,
      userId
    );


  const xp =
    Number(user.xp) || 0;


  const level =
    Number(user.level) ||
    calculateLevel(xp);


  const currentRank =
    getRank(xp);


  const nextRank =
    getNextRank(xp);


  const displayName =
    user.display_name &&
    String(
      user.display_name
    ).trim()

      ? String(
          user.display_name
        ).trim()

      : `Player ${user.user_id}`;


  // ─────────────────────────────────────────────────────────
  // RANK PROGRESS
  // ─────────────────────────────────────────────────────────

  let progress = 100;


  if (nextRank) {
    const range =
      nextRank.xp -
      currentRank.xp;


    const earned =
      xp -
      currentRank.xp;


    progress =
      Math.floor(
        Math.min(
          100,
          Math.max(
            0,
            (earned / range) * 100
          )
        )
      );
  }


  return {
    userId:
      String(user.user_id),

    displayName,

    xp,
    level,

    rank:
      currentRank.name,

    rankXP:
      currentRank.xp,

    nextRank:
      nextRank
        ? nextRank.name
        : null,

    nextRankXP:
      nextRank
        ? nextRank.xp
        : null,

    xpToNextRank:
      nextRank
        ? Math.max(
            0,
            nextRank.xp - xp
          )
        : 0,

    progress,

    balance:
      Number(user.balance) || 0,

    bankBalance:
      Number(user.bank_balance) || 0,

    totalMoney:
      (Number(user.balance) || 0) +
      (Number(user.bank_balance) || 0),

    gamesPlayed:
      Number(user.games_played) || 0,

    wins:
      Number(user.wins) || 0,

    creditScore:
      Number(user.credit_score) ||
      STARTING_CREDIT_SCORE,

    loanRemaining:
      Number(user.loan_remaining) || 0,
  };
}


// ═══════════════════════════════════════════════════════════
// WALLET LEADERBOARD
// ═══════════════════════════════════════════════════════════

async function leaderboard(
  threadId,
  limit = 10
) {
  const conn =
    requireConn();


  const safeLimit =
    Math.min(
      50,
      Math.max(
        1,
        Number(limit) || 10
      )
    );


  const { rows } =
    await conn.query(
      `
      SELECT *
      FROM users

      WHERE thread_id = $1

      ORDER BY balance DESC

      LIMIT $2
      `,
      [
        String(threadId),
        safeLimit,
      ]
    );


  return rows;
}


// ═══════════════════════════════════════════════════════════
// TOTAL MONEY LEADERBOARD
// ═══════════════════════════════════════════════════════════

async function moneyLeaderboard(
  threadId,
  limit = 10
) {
  const conn =
    requireConn();


  const safeLimit =
    Math.min(
      50,
      Math.max(
        1,
        Number(limit) || 10
      )
    );


  const { rows } =
    await conn.query(
      `
      SELECT
        *,
        (
          balance +
          bank_balance
        ) AS total_money

      FROM users

      WHERE thread_id = $1

      ORDER BY total_money DESC

      LIMIT $2
      `,
      [
        String(threadId),
        safeLimit,
      ]
    );


  return rows;
}


// ═══════════════════════════════════════════════════════════
// XP LEADERBOARD
// ═══════════════════════════════════════════════════════════

async function xpLeaderboard(
  threadId,
  limit = 10
) {
  const conn =
    requireConn();


  const safeLimit =
    Math.min(
      50,
      Math.max(
        1,
        Number(limit) || 10
      )
    );


  const { rows } =
    await conn.query(
      `
      SELECT
        user_id,
        display_name,

        xp,
        level,

        balance,
        bank_balance,

        games_played,
        wins

      FROM users

      WHERE thread_id = $1

      ORDER BY
        xp DESC,
        level DESC,
        user_id ASC

      LIMIT $2
      `,
      [
        String(threadId),
        safeLimit,
      ]
    );


  return rows.map(
    (row, index) => {
      const xp =
        Number(row.xp) || 0;


      return {
        position:
          index + 1,

        userId:
          String(
            row.user_id
          ),

        displayName:
          row.display_name &&
          String(
            row.display_name
          ).trim()

            ? String(
                row.display_name
              ).trim()

            : `Player ${row.user_id}`,

        xp,

        level:
          Number(row.level) ||
          calculateLevel(xp),

        rank:
          getRank(xp),

        balance:
          Number(row.balance) || 0,

        bankBalance:
          Number(row.bank_balance) || 0,

        gamesPlayed:
          Number(row.games_played) || 0,

        wins:
          Number(row.wins) || 0,
      };
    }
  );
}


// ═══════════════════════════════════════════════════════════
// BANK — DEPOSIT
// ═══════════════════════════════════════════════════════════

async function deposit(
  threadId,
  userId,
  amount
) {
  amount =
    Math.floor(
      Number(amount)
    );


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Invalid deposit amount."
    );
  }


  // Make sure the user exists BEFORE
  // checking out the transaction client.
  await getUser(
    threadId,
    userId
  );


  const client =
    await requireConn().connect();


  try {
    await client.query(
      "BEGIN"
    );


    const { rows } =
      await client.query(
        `
        SELECT *
        FROM users

        WHERE thread_id = $1
          AND user_id = $2

        FOR UPDATE
        `,
        [
          String(threadId),
          String(userId),
        ]
      );


    const user =
      rows[0];


    if (!user) {
      throw new Error(
        "User not found."
      );
    }


    if (
      Number(user.balance) <
      amount
    ) {
      throw new Error(
        "Not enough wallet coins."
      );
    }


    await client.query(
      `
      UPDATE users

      SET
        balance =
          balance - $3,

        bank_balance =
          bank_balance + $3

      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        String(threadId),
        String(userId),
        amount,
      ]
    );


    await client.query(
      `
      INSERT INTO economy_transactions (
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )

      VALUES (
        $1,
        $2,
        'deposit',
        $3,
        'Bank deposit',
        $4
      )
      `,
      [
        String(threadId),
        String(userId),
        amount,
        Date.now(),
      ]
    );


    await client.query(
      "COMMIT"
    );


    return getUser(
      threadId,
      userId
    );

  } catch (error) {

    await client.query(
      "ROLLBACK"
    );

    throw error;

  } finally {

    client.release();
  }
}


// ═══════════════════════════════════════════════════════════
// BANK — WITHDRAW
// ═══════════════════════════════════════════════════════════

async function withdraw(
  threadId,
  userId,
  amount
) {
  amount =
    Math.floor(
      Number(amount)
    );


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Invalid withdrawal amount."
    );
  }


  await getUser(
    threadId,
    userId
  );


  const client =
    await requireConn().connect();


  try {
    await client.query(
      "BEGIN"
    );


    const { rows } =
      await client.query(
        `
        SELECT *
        FROM users

        WHERE thread_id = $1
          AND user_id = $2

        FOR UPDATE
        `,
        [
          String(threadId),
          String(userId),
        ]
      );


    const user =
      rows[0];


    if (!user) {
      throw new Error(
        "User not found."
      );
    }


    if (
      Number(user.bank_balance) <
      amount
    ) {
      throw new Error(
        "Not enough money in the bank."
      );
    }


    await client.query(
      `
      UPDATE users

      SET
        bank_balance =
          bank_balance - $3,

        balance =
          balance + $3

      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        String(threadId),
        String(userId),
        amount,
      ]
    );


    await client.query(
      `
      INSERT INTO economy_transactions (
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )

      VALUES (
        $1,
        $2,
        'withdraw',
        $3,
        'Bank withdrawal',
        $4
      )
      `,
      [
        String(threadId),
        String(userId),
        amount,
        Date.now(),
      ]
    );


    await client.query(
      "COMMIT"
    );


    return getUser(
      threadId,
      userId
    );

  } catch (error) {

    await client.query(
      "ROLLBACK"
    );

    throw error;

  } finally {

    client.release();
  }
}


// ═══════════════════════════════════════════════════════════
// TRANSFERS
// ═══════════════════════════════════════════════════════════

async function transfer(
  threadId,
  fromUserId,
  toUserId,
  amount
) {
  amount =
    Math.floor(
      Number(amount)
    );


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Invalid transfer amount."
    );
  }


  fromUserId =
    String(fromUserId);

  toUserId =
    String(toUserId);


  if (
    fromUserId === toUserId
  ) {
    throw new Error(
      "You cannot transfer coins to yourself."
    );
  }


  await getUser(
    threadId,
    fromUserId
  );


  await getUser(
    threadId,
    toUserId
  );


  const client =
    await requireConn().connect();


  try {
    await client.query(
      "BEGIN"
    );


    // ───────────────────────────────────────────────────────
    // LOCK USERS IN CONSISTENT ORDER
    //
    // This reduces the risk of database deadlocks when two
    // transfers happen at the same time in opposite directions.
    // ───────────────────────────────────────────────────────

    const firstId =
      fromUserId < toUserId
        ? fromUserId
        : toUserId;


    const secondId =
      fromUserId < toUserId
        ? toUserId
        : fromUserId;


    await client.query(
      `
      SELECT user_id

      FROM users

      WHERE thread_id = $1
        AND user_id IN ($2, $3)

      ORDER BY user_id

      FOR UPDATE
      `,
      [
        String(threadId),
        firstId,
        secondId,
      ]
    );


    const senderResult =
      await client.query(
        `
        SELECT *
        FROM users

        WHERE thread_id = $1
          AND user_id = $2
        `,
        [
          String(threadId),
          fromUserId,
        ]
      );


    const sender =
      senderResult.rows[0];


    if (
      Number(sender.balance) <
      amount
    ) {
      throw new Error(
        "You don't have enough wallet coins."
      );
    }


    // ───────────────────────────────────────────────────────
    // REMOVE FROM SENDER
    // ───────────────────────────────────────────────────────

    await client.query(
      `
      UPDATE users

      SET balance =
        balance - $3

      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        String(threadId),
        fromUserId,
        amount,
      ]
    );


    // ───────────────────────────────────────────────────────
    // ADD TO RECEIVER
    // ───────────────────────────────────────────────────────

    await client.query(
      `
      UPDATE users

      SET balance =
        balance + $3

      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        String(threadId),
        toUserId,
        amount,
      ]
    );


    // ───────────────────────────────────────────────────────
    // SENDER TRANSACTION
    // ───────────────────────────────────────────────────────

    await client.query(
      `
      INSERT INTO economy_transactions (
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )

      VALUES (
        $1,
        $2,
        'transfer_sent',
        $3,
        $4,
        $5
      )
      `,
      [
        String(threadId),
        fromUserId,
        amount,
        `Transfer to ${toUserId}`,
        Date.now(),
      ]
    );


    // ───────────────────────────────────────────────────────
    // RECEIVER TRANSACTION
    // ───────────────────────────────────────────────────────

    await client.query(
      `
      INSERT INTO economy_transactions (
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )

      VALUES (
        $1,
        $2,
        'transfer_received',
        $3,
        $4,
        $5
      )
      `,
      [
        String(threadId),
        toUserId,
        amount,
        `Transfer from ${fromUserId}`,
        Date.now(),
      ]
    );


    await client.query(
      "COMMIT"
    );


    return true;

  } catch (error) {

    await client.query(
      "ROLLBACK"
    );

    throw error;

  } finally {

    client.release();
  }
}


// ═══════════════════════════════════════════════════════════
// LOANS — APPLY
// ═══════════════════════════════════════════════════════════

async function applyLoan(
  threadId,
  userId,
  amount
) {
  amount =
    Math.floor(
      Number(amount)
    );


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Invalid loan amount."
    );
  }


  const user =
    await getUser(
      threadId,
      userId
    );


  if (
    Number(user.loan_remaining) > 0
  ) {
    throw new Error(
      "You already have an active loan."
    );
  }


  const maxLoan =
    Math.max(
      500,
      Math.floor(
        Number(user.credit_score) * 10
      )
    );


  if (
    amount > maxLoan
  ) {
    throw new Error(
      `Your credit score allows a maximum loan of ${maxLoan} coins.`
    );
  }


  // 10% simulated interest.
  const interestRate = 0.10;


  const totalDue =
    Math.ceil(
      amount *
      (1 + interestRate)
    );


  // Seven-day repayment period.
  const dueDate =
    Date.now() +
    7 *
      24 *
      60 *
      60 *
      1000;


  await updateUser(
    threadId,
    userId,
    {
      balance:
        Number(user.balance) +
        amount,

      loan_principal:
        amount,

      loan_remaining:
        totalDue,

      loan_due:
        dueDate,
    }
  );


  return {
    principal:
      amount,

    interestRate,

    totalDue,

    dueDate,
  };
}


// ═══════════════════════════════════════════════════════════
// LOANS — PAYMENT
// ═══════════════════════════════════════════════════════════

async function payLoan(
  threadId,
  userId,
  amount
) {
  amount =
    Math.floor(
      Number(amount)
    );


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Invalid payment amount."
    );
  }


  const user =
    await getUser(
      threadId,
      userId
    );


  if (
    Number(user.loan_remaining) <= 0
  ) {
    throw new Error(
      "You don't have an active loan."
    );
  }


  if (
    Number(user.balance) < amount
  ) {
    throw new Error(
      "You don't have enough wallet coins."
    );
  }


  const payment =
    Math.min(
      amount,
      Number(user.loan_remaining)
    );


  const remaining =
    Number(user.loan_remaining) -
    payment;


  let creditScore =
    Number(user.credit_score) ||
    STARTING_CREDIT_SCORE;


  // Reward the player for completely
  // paying off their loan.
  if (
    remaining === 0
  ) {
    creditScore =
      Math.min(
        850,
        creditScore + 20
      );
  }


  await updateUser(
    threadId,
    userId,
    {
      balance:
        Number(user.balance) -
        payment,

      loan_remaining:
        remaining,

      credit_score:
        creditScore,

      loan_principal:
        remaining === 0
          ? 0
          : Number(
              user.loan_principal
            ),

      loan_due:
        remaining === 0
          ? null
          : user.loan_due,
    }
  );


  return {
    payment,

    remaining,

    creditScore,
  };
}


// ═══════════════════════════════════════════════════════════
// BANK INTEREST
// ═══════════════════════════════════════════════════════════

async function applyBankInterest(
  threadId,
  userId
) {
  const user =
    await getUser(
      threadId,
      userId
    );


  const bankBalance =
    Number(
      user.bank_balance
    ) || 0;


  // Once-per-day cooldown so !bank can't be spammed for
  // unlimited free interest. Mirrors the daily-reward pattern
  // already used for last_daily.
  const INTEREST_COOLDOWN_MS =
    24 * 60 * 60 * 1000;

  const now = Date.now();

  const last =
    user.last_interest_paid
      ? Number(user.last_interest_paid)
      : null;

  if (
    last !== null &&
    now - last < INTEREST_COOLDOWN_MS
  ) {
    return {
      interest: 0,
      applied: false,
      onCooldown: true,
      msRemaining:
        INTEREST_COOLDOWN_MS - (now - last),
    };
  }

  if (
    bankBalance <= 0
  ) {
    // Still stamp last_interest_paid so an empty account
    // doesn't get a free "first call always succeeds" edge case
    // the moment they deposit something.
    await updateUser(
      threadId,
      userId,
      {
        last_interest_paid: now,
      }
    );

    return {
      interest: 0,
      applied: false,
      onCooldown: false,
    };
  }


  // 1% simulated bank interest.
  const interest =
    Math.floor(
      bankBalance * 0.01
    );


  await updateUser(
    threadId,
    userId,
    {
      bank_balance:
        bankBalance +
        interest,

      last_interest_paid: now,
    }
  );


  return {
    interest,
    applied: interest > 0,
    onCooldown: false,
  };
}


// ═══════════════════════════════════════════════════════════
// INVENTORY — ADD ITEM
// ═══════════════════════════════════════════════════════════

async function addItem(
  threadId,
  userId,
  itemId,
  amount = 1
) {
  const conn =
    requireConn();


  await conn.query(
    `
    INSERT INTO inventory (
      thread_id,
      user_id,
      item_id,
      amount
    )

    VALUES (
      $1,
      $2,
      $3,
      $4
    )

    ON CONFLICT (
      thread_id,
      user_id,
      item_id
    )

    DO UPDATE SET
      amount =
        inventory.amount +
        excluded.amount
    `,
    [
      String(threadId),
      String(userId),
      String(itemId),
      Number(amount),
    ]
  );
}


// ═══════════════════════════════════════════════════════════
// INVENTORY — GET
// ═══════════════════════════════════════════════════════════

async function getInventory(
  threadId,
  userId
) {
  const conn =
    requireConn();


  const { rows } =
    await conn.query(
      `
      SELECT
        item_id,
        amount

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
    result[row.item_id] =
      Number(row.amount);
  }


  return result;
}


// ═══════════════════════════════════════════════════════════
// THREAD SETTINGS
// ═══════════════════════════════════════════════════════════

async function getThreadSettings(
  threadId
) {
  const conn =
    requireConn();


  const id =
    String(threadId);


  const { rows } =
    await conn.query(
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
      INSERT INTO thread_settings (
        thread_id,
        roast_enabled,
        fun_enabled
      )

      VALUES (
        $1,
        TRUE,
        TRUE
      )

      ON CONFLICT (
        thread_id
      )

      DO NOTHING
      `,
      [id]
    );


    return {
      thread_id:
        id,

      roast_enabled:
        true,

      fun_enabled:
        true,
    };
  }


  return rows[0];
}


// ═══════════════════════════════════════════════════════════
// THREAD SETTINGS — UPDATE
// ═══════════════════════════════════════════════════════════

async function setThreadSettings(
  threadId,
  fields
) {
  const conn =
    requireConn();


  const id =
    String(threadId);


  await getThreadSettings(
    id
  );


  const allowedFields = [
    "roast_enabled",
    "fun_enabled",
  ];


  const safeFields =
    Object.keys(fields).filter(
      (key) =>
        allowedFields.includes(key)
    );


  if (
    safeFields.length === 0
  ) {
    return getThreadSettings(
      id
    );
  }


  const setClause =
    safeFields
      .map(
        (key, index) =>
          `${key} = $${index + 2}`
      )
      .join(", ");


  const values =
    safeFields.map(
      (key) => fields[key]
    );


  await conn.query(
    `
    UPDATE thread_settings

    SET ${setClause}

    WHERE thread_id = $1
    `,
    [
      id,
      ...values,
    ]
  );


  return getThreadSettings(
    id
  );
}


// ═══════════════════════════════════════════════════════════
// ROAST / BANAT SETTINGS
// ═══════════════════════════════════════════════════════════

async function isRoastEnabled(
  threadId
) {
  const settings =
    await getThreadSettings(
      threadId
    );


  return (
    settings.roast_enabled === true
  );
}


async function setRoastEnabled(
  threadId,
  enabled
) {
  return setThreadSettings(
    threadId,
    {
      roast_enabled:
        Boolean(enabled),
    }
  );
}


// ═══════════════════════════════════════════════════════════
// GAME SETTINGS
// ═══════════════════════════════════════════════════════════

async function isGameEnabled(
  threadId
) {
  const settings =
    await getThreadSettings(
      threadId
    );


  return (
    settings.fun_enabled === true
  );
}


async function setGameEnabled(
  threadId,
  enabled
) {
  return setThreadSettings(
    threadId,
    {
      fun_enabled:
        Boolean(enabled),
    }
  );
}


// ╔══════════════════════════════════════════════════════════╗
// ║                         EXPORTS                          ║
// ╚══════════════════════════════════════════════════════════╝

module.exports = {

  // ─────────────────────────────────────────────────────────
  // DATABASE
  // ─────────────────────────────────────────────────────────

  connect,


  // ─────────────────────────────────────────────────────────
  // USERS
  // ─────────────────────────────────────────────────────────

  getUser,
  updateUser,
  setUserDisplayName,


  // ─────────────────────────────────────────────────────────
  // WALLET
  // ─────────────────────────────────────────────────────────

  addBalance,


  // ─────────────────────────────────────────────────────────
  // GAME STATS
  // ─────────────────────────────────────────────────────────

  incrementGameStats,


  // ─────────────────────────────────────────────────────────
  // XP / RANKS
  // ─────────────────────────────────────────────────────────

  addXP,
  calculateLevel,
  getRank,
  getNextRank,
  getPlayerRanking,


  // ─────────────────────────────────────────────────────────
  // LEADERBOARDS
  // ─────────────────────────────────────────────────────────

  leaderboard,
  moneyLeaderboard,
  xpLeaderboard,


  // ─────────────────────────────────────────────────────────
  // BANK
  // ─────────────────────────────────────────────────────────

  deposit,
  withdraw,
  applyBankInterest,


  // ─────────────────────────────────────────────────────────
  // TRANSFERS
  // ─────────────────────────────────────────────────────────

  transfer,


  // ─────────────────────────────────────────────────────────
  // LOANS
  // ─────────────────────────────────────────────────────────

  applyLoan,
  payLoan,


  // ─────────────────────────────────────────────────────────
  // INVENTORY
  // ─────────────────────────────────────────────────────────

  addItem,
  getInventory,


  // ─────────────────────────────────────────────────────────
  // THREAD SETTINGS
  // ─────────────────────────────────────────────────────────

  getThreadSettings,
  setThreadSettings,


  // ─────────────────────────────────────────────────────────
  // ROAST / BANAT
  // ─────────────────────────────────────────────────────────

  isRoastEnabled,
  setRoastEnabled,


  // ─────────────────────────────────────────────────────────
  // GAMES
  // ─────────────────────────────────────────────────────────

  isGameEnabled,
  setGameEnabled,
};
