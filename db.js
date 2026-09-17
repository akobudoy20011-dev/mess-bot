/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║                     DATABASE LAYER                      ║
 * ║                  Neon PostgreSQL                         ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Persistent database layer for the Messenger bot.
 *
 * Includes:
 * • Wallet
 * • Bank
 * • XP / Levels / Ranks
 * • Daily / Work persistence
 * • Transfers
 * • Credit / Loans
 * • Economy transactions
 * • Inventory
 * • Thread settings
 * • Moderation
 * • ECLIPSE RPG
 * • Love Quest
 * • Character AI
 */

const { Pool } = require("pg");

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════

const STARTING_BALANCE = 100;
const STARTING_CREDIT_SCORE = 600;

const RANKS = [
  { name: "Beginner", xp: 0, emoji: "🌱" },
  { name: "Bronze", xp: 500, emoji: "🥉" },
  { name: "Silver", xp: 2_000, emoji: "🥈" },
  { name: "Gold", xp: 5_000, emoji: "🥇" },
  { name: "Platinum", xp: 12_000, emoji: "💠" },
  { name: "Diamond", xp: 25_000, emoji: "💎" },
  { name: "Master", xp: 50_000, emoji: "🔥" },
  { name: "Grandmaster", xp: 100_000, emoji: "👑" },
];

const INTEREST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LOAN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

let pool = null;

// ═══════════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════

async function connect() {
  if (pool) {
    return pool;
  }

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
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => {
    console.error("[DB] Unexpected pool error:", error.message);
  });

  // ═════════════════════════════════════════════════════════
  // USERS
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT ${STARTING_BALANCE},
      last_daily BIGINT,
      last_work BIGINT,
      daily_streak INTEGER NOT NULL DEFAULT 0,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (thread_id, user_id)
    );
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS bank_balance INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS credit_score INTEGER NOT NULL DEFAULT ${STARTING_CREDIT_SCORE},
      ADD COLUMN IF NOT EXISTS loan_principal INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS loan_remaining INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS loan_due BIGINT,
      ADD COLUMN IF NOT EXISTS last_interest_paid BIGINT,
      ADD COLUMN IF NOT EXISTS display_name TEXT;
  `);

  // ═════════════════════════════════════════════════════════
  // THREAD SETTINGS
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    CREATE TABLE IF NOT EXISTS thread_settings (
      thread_id TEXT PRIMARY KEY,
      roast_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      fun_enabled BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  await pool.query(`
    ALTER TABLE thread_settings
      ADD COLUMN IF NOT EXISTS fun_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  // ═════════════════════════════════════════════════════════
  // MODERATION
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_warnings (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_bans (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS moderation_strikes (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      strikes INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS moderation_logs (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      target_id TEXT,
      action TEXT NOT NULL,
      reason TEXT,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_abuse_logs (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      admin_id TEXT NOT NULL,
      target_id TEXT,
      abuse_type TEXT NOT NULL,
      command TEXT,
      amount BIGINT,
      reason TEXT,
      severity TEXT NOT NULL DEFAULT 'low',
      blocked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_restrictions (
      thread_id TEXT NOT NULL,
      admin_id TEXT NOT NULL,
      moderation_locked BOOLEAN NOT NULL DEFAULT FALSE,
      economy_locked BOOLEAN NOT NULL DEFAULT FALSE,
      strikes INTEGER NOT NULL DEFAULT 0,
      locked_until BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (thread_id, admin_id)
    );

    CREATE INDEX IF NOT EXISTS moderation_warnings_lookup_idx
      ON moderation_warnings(thread_id, user_id, active, created_at DESC);

    CREATE INDEX IF NOT EXISTS moderation_logs_thread_idx
      ON moderation_logs(thread_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS admin_abuse_logs_lookup_idx
      ON admin_abuse_logs(thread_id, admin_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS moderation_mutes (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT,
      expires_at BIGINT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_moderation_mutes_active
      ON moderation_mutes(thread_id, user_id, active);

    CREATE TABLE IF NOT EXISTS automod_settings (
      thread_id TEXT PRIMARY KEY,
      enabled BOOLEAN DEFAULT FALSE,
      owner_away_timeout BIGINT DEFAULT 900000,
      updated_at BIGINT NOT NULL
    );

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
  `);

  // ═════════════════════════════════════════════════════════
  // INVENTORY
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(thread_id, user_id, item_id)
    );
  `);

  // ═════════════════════════════════════════════════════════
  // ECONOMY TRANSACTIONS
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    CREATE TABLE IF NOT EXISTS economy_transactions (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE economy_transactions
      ADD COLUMN IF NOT EXISTS description TEXT;
  `);

  // ═════════════════════════════════════════════════════════
  // ECLIPSE RPG
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rpg_players (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      character_class TEXT NOT NULL DEFAULT 'knight',
      region_id TEXT NOT NULL DEFAULT 'greenvale',
      property_tier INTEGER NOT NULL DEFAULT 0,
      property_name TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_buildings (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      building_key TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, building_key)
    );

    CREATE TABLE IF NOT EXISTS rpg_armies (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'House Guard',
      region_id TEXT NOT NULL DEFAULT 'greenvale',
      infantry INTEGER NOT NULL DEFAULT 10,
      archers INTEGER NOT NULL DEFAULT 0,
      cavalry INTEGER NOT NULL DEFAULT 0,
      mages INTEGER NOT NULL DEFAULT 0,
      assassins INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'garrison',
      destination_region TEXT,
      departure_at BIGINT,
      arrival_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(thread_id, user_id)
    );
  `);

  await pool.query(`
    ALTER TABLE rpg_players
      ADD COLUMN IF NOT EXISTS location_id TEXT NOT NULL DEFAULT 'eclipse_castle',
      ADD COLUMN IF NOT EXISTS subclass TEXT,
      ADD COLUMN IF NOT EXISTS hp INTEGER NOT NULL DEFAULT 130,
      ADD COLUMN IF NOT EXISTS max_hp INTEGER NOT NULL DEFAULT 130,
      ADD COLUMN IF NOT EXISTS mp INTEGER NOT NULL DEFAULT 35,
      ADD COLUMN IF NOT EXISTS max_mp INTEGER NOT NULL DEFAULT 35,
      ADD COLUMN IF NOT EXISTS stamina INTEGER NOT NULL DEFAULT 120,
      ADD COLUMN IF NOT EXISTS max_stamina INTEGER NOT NULL DEFAULT 120,
      ADD COLUMN IF NOT EXISTS strength INTEGER NOT NULL DEFAULT 18,
      ADD COLUMN IF NOT EXISTS defense INTEGER NOT NULL DEFAULT 16,
      ADD COLUMN IF NOT EXISTS agility INTEGER NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS intelligence INTEGER NOT NULL DEFAULT 6,
      ADD COLUMN IF NOT EXISTS vitality INTEGER NOT NULL DEFAULT 16,
      ADD COLUMN IF NOT EXISTS luck INTEGER NOT NULL DEFAULT 8,
      ADD COLUMN IF NOT EXISTS reputation INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS renown INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

    ALTER TABLE rpg_armies
      ADD COLUMN IF NOT EXISTS location_id TEXT NOT NULL DEFAULT 'eclipse_castle',
      ADD COLUMN IF NOT EXISTS destination_location TEXT,
      ADD COLUMN IF NOT EXISTS supplies INTEGER NOT NULL DEFAULT 100,
      ADD COLUMN IF NOT EXISTS formation TEXT NOT NULL DEFAULT 'balanced',
      ADD COLUMN IF NOT EXISTS spearmen INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS heavy_swordsmen INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS shielders INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS rpg_properties (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tier INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      maintenance INTEGER NOT NULL DEFAULT 0,
      walls INTEGER NOT NULL DEFAULT 0,
      towers INTEGER NOT NULL DEFAULT 0,
      gates INTEGER NOT NULL DEFAULT 0,
      moats INTEGER NOT NULL DEFAULT 0,
      guards INTEGER NOT NULL DEFAULT 0,
      traps INTEGER NOT NULL DEFAULT 0,
      barrier INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_player_skills (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      unlocked BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_player_spells (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      spell_id TEXT NOT NULL,
      unlocked BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, spell_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_inventory_items (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_equipment (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      item_id TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, slot)
    );

    CREATE TABLE IF NOT EXISTS rpg_combat_sessions (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      enemy_id TEXT NOT NULL,
      enemy_name TEXT NOT NULL,
      enemy_hp INTEGER NOT NULL,
      enemy_max_hp INTEGER NOT NULL,
      enemy_attack INTEGER NOT NULL,
      enemy_defense INTEGER NOT NULL,
      player_hp INTEGER NOT NULL,
      player_mp INTEGER NOT NULL,
      player_stamina INTEGER NOT NULL,
      turn_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      defending BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_quests (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      quest_type TEXT NOT NULL,
      quest_key TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      target INTEGER NOT NULL,
      reward_gold INTEGER NOT NULL DEFAULT 0,
      reward_xp INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at BIGINT,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_dungeons (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      dungeon_key TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 1,
      max_stage INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_regiments (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      unit_type TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      experience_tier TEXT NOT NULL DEFAULT 'recruit',
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_marches (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      distance INTEGER NOT NULL,
      duration_ms BIGINT NOT NULL,
      departure_at BIGINT NOT NULL,
      arrival_at BIGINT NOT NULL,
      army_size INTEGER NOT NULL DEFAULT 0,
      commander_id BIGINT,
      status TEXT NOT NULL DEFAULT 'marching',
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_location_states (
      thread_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      garrison INTEGER NOT NULL DEFAULT 0,
      defense INTEGER NOT NULL DEFAULT 0,
      prosperity INTEGER NOT NULL DEFAULT 100,
      hostility INTEGER NOT NULL DEFAULT 0,
      last_raided_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, location_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_scouting_reports (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      accuracy INTEGER NOT NULL,
      garrison_estimate INTEGER,
      defense_estimate INTEGER,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_battles (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      battle_type TEXT NOT NULL,
      attacker_user_id TEXT NOT NULL,
      defender_user_id TEXT,
      location_id TEXT,
      result TEXT NOT NULL,
      attacker_losses INTEGER NOT NULL DEFAULT 0,
      defender_losses INTEGER NOT NULL DEFAULT 0,
      loot_gold INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_kingdoms (
      thread_id TEXT NOT NULL,
      kingdom_id TEXT NOT NULL,
      name TEXT NOT NULL,
      specialization TEXT NOT NULL,
      capital_location_id TEXT NOT NULL,
      treasury INTEGER NOT NULL DEFAULT 0,
      military INTEGER NOT NULL DEFAULT 0,
      magic INTEGER NOT NULL DEFAULT 0,
      stability INTEGER NOT NULL DEFAULT 70,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, kingdom_id)
    );

    ALTER TABLE rpg_location_states
      ADD COLUMN IF NOT EXISTS owner_kingdom_id TEXT;

    ALTER TABLE rpg_players
      ADD COLUMN IF NOT EXISTS kingdom_id TEXT,
      ADD COLUMN IF NOT EXISTS kingdom_role TEXT NOT NULL DEFAULT 'unaffiliated';

    CREATE TABLE IF NOT EXISTS rpg_diplomacy (
      thread_id TEXT NOT NULL,
      kingdom_a TEXT NOT NULL,
      kingdom_b TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'neutral',
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, kingdom_a, kingdom_b)
    );
  `);

  // ═════════════════════════════════════════════════════════
  // LOVE QUEST
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rpg_special_quests (
      thread_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      chapter INTEGER NOT NULL DEFAULT 1,
      stage INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      started_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      completed_at BIGINT,
      PRIMARY KEY(thread_id, player_id, quest_id)
    );

    CREATE INDEX IF NOT EXISTS rpg_special_quests_player_idx
      ON rpg_special_quests(player_id, quest_id, status);

    CREATE INDEX IF NOT EXISTS rpg_special_quests_thread_idx
      ON rpg_special_quests(thread_id, player_id);
  `);

  // ═════════════════════════════════════════════════════════
  // CHARACTER AI
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id BIGSERIAL PRIMARY KEY,
      character_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(character_id, thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL
        REFERENCES ai_conversations(id)
        ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_memories (
      id BIGSERIAL PRIMARY KEY,
      character_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 2,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT NOT NULL,
      UNIQUE(character_id, thread_id, user_id, content)
    );

    CREATE TABLE IF NOT EXISTS ai_sessions (
      character_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      conversation_id BIGINT NOT NULL
        REFERENCES ai_conversations(id)
        ON DELETE CASCADE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(character_id, thread_id, user_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
      ON ai_messages(conversation_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS ai_memories_lookup_idx
      ON ai_memories(
        character_id,
        thread_id,
        user_id,
        importance DESC,
        created_at DESC
      );

    CREATE INDEX IF NOT EXISTS ai_sessions_active_idx
      ON ai_sessions(
        character_id,
        thread_id,
        user_id,
        active
      );
  `);

  console.log("[DB] Neon PostgreSQL ONLINE ✓");

  return pool;
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

async function query(text, params = []) {
  return requireConn().query(text, params);
}

// ═══════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════

async function getUser(threadId, userId) {
  const conn = requireConn();

  threadId = String(threadId);
  userId = String(userId);

  let result = await conn.query(
    `
    SELECT *
    FROM users
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId]
  );

  if (result.rows.length) {
    return result.rows[0];
  }

  await conn.query(
    `
    INSERT INTO users(
      thread_id,
      user_id,
      balance,
      bank_balance,
      xp,
      level,
      credit_score
    )
    VALUES($1, $2, $3, 0, 0, 1, $4)
    ON CONFLICT(thread_id, user_id) DO NOTHING
    `,
    [
      threadId,
      userId,
      STARTING_BALANCE,
      STARTING_CREDIT_SCORE,
    ]
  );

  result = await conn.query(
    `
    SELECT *
    FROM users
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId]
  );

  return result.rows[0];
}

// ═══════════════════════════════════════════════════════════
// USER UPDATES
// ═══════════════════════════════════════════════════════════

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
    "last_interest_paid",
    "display_name",
  ];

  const safeKeys = Object.keys(fields || {}).filter((key) =>
    allowedFields.includes(key)
  );

  if (!safeKeys.length) {
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

// ═══════════════════════════════════════════════════════════
// DISPLAY NAME
// ═══════════════════════════════════════════════════════════

async function setUserDisplayName(threadId, userId, displayName) {
  const name = String(displayName || "")
    .trim()
    .slice(0, 100);

  if (!name) {
    return;
  }

  await getUser(threadId, userId);

  await updateUser(threadId, userId, {
    display_name: name,
  });
}

// ═══════════════════════════════════════════════════════════
// WALLET — ADD
// ═══════════════════════════════════════════════════════════

/**
 * Atomic balance change.
 *
 * This fixes the old:
 *   SELECT balance
 *   calculate
 *   UPDATE balance
 *
 * race condition.
 *
 * Optional transaction logging:
 *   addBalance(thread, user, amount, "daily")
 */
async function addBalance(
  threadId,
  userId,
  amount,
  description = null
) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount === 0) {
    if (amount === 0) {
      return Number(
        (await getUser(threadId, userId)).balance
      );
    }

    throw new Error("Invalid balance amount.");
  }

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      UPDATE users
      SET balance = GREATEST(0, balance + $3)
      WHERE thread_id = $1
        AND user_id = $2
      RETURNING balance
      `,
      [threadId, userId, amount]
    );

    if (!result.rows.length) {
      throw new Error("User not found.");
    }

    if (description) {
      await client.query(
        `
        INSERT INTO economy_transactions(
          thread_id,
          user_id,
          type,
          amount,
          description,
          created_at
        )
        VALUES($1, $2, 'balance_change', $3, $4, $5)
        `,
        [
          threadId,
          userId,
          amount,
          String(description).slice(0, 500),
          Date.now(),
        ]
      );
    }

    await client.query("COMMIT");

    return Number(result.rows[0].balance);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// WALLET — SPEND
// ═══════════════════════════════════════════════════════════

async function spendBalance(
  threadId,
  userId,
  amount,
  description = "Wallet spending"
) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid spending amount.");
  }

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT balance
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User not found.");
    }

    if (Number(rows[0].balance) < amount) {
      throw new Error("Not enough wallet coins.");
    }

    await client.query(
      `
      UPDATE users
      SET balance = balance - $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, userId, amount]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )
      VALUES($1, $2, 'rpg_spend', $3, $4, $5)
      `,
      [
        threadId,
        userId,
        amount,
        String(description).slice(0, 500),
        Date.now(),
      ]
    );

    await client.query("COMMIT");

    return getUser(threadId, userId);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// GAME STATISTICS
// ═══════════════════════════════════════════════════════════

async function incrementGameStats(threadId, userId, won) {
  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const { rows } = await requireConn().query(
    `
    UPDATE users
    SET
      games_played = games_played + 1,
      wins = wins + CASE WHEN $3::boolean THEN 1 ELSE 0 END
    WHERE thread_id = $1
      AND user_id = $2
    RETURNING games_played, wins
    `,
    [threadId, userId, Boolean(won)]
  );

  return rows[0];
}

// ═══════════════════════════════════════════════════════════
// XP / LEVEL
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// XP — ATOMIC
// ═══════════════════════════════════════════════════════════

async function addXP(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount)) {
    throw new Error("Invalid XP amount.");
  }

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT xp
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User not found.");
    }

    const oldXP = Math.max(0, Number(rows[0].xp) || 0);
    const previousRank = getRank(oldXP);

    const newXP = Math.max(0, oldXP + amount);
    const newLevel = calculateLevel(newXP);

    await client.query(
      `
      UPDATE users
      SET
        xp = $3,
        level = $4
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, userId, newXP, newLevel]
    );

    await client.query("COMMIT");

    return {
      xp: newXP,
      level: newLevel,
      rank: getRank(newXP),
      previousRank,
      nextRank: getNextRank(newXP),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// PLAYER RANKING
// ═══════════════════════════════════════════════════════════

async function getPlayerRanking(threadId, userId) {
  const user = await getUser(threadId, userId);

  const xp = Number(user.xp) || 0;
  const level = Number(user.level) || calculateLevel(xp);

  const currentRank = getRank(xp);
  const nextRank = getNextRank(xp);

  const displayName =
    user.display_name &&
    String(user.display_name).trim()
      ? String(user.display_name).trim()
      : `Player ${user.user_id}`;

  let progress = 100;

  if (nextRank) {
    const range = nextRank.xp - currentRank.xp;
    const earned = xp - currentRank.xp;

    progress = Math.floor(
      Math.min(
        100,
        Math.max(0, (earned / range) * 100)
      )
    );
  }

  return {
    userId: String(user.user_id),
    displayName,

    xp,
    level,

    rank: currentRank.name,
    rankXP: currentRank.xp,

    nextRank: nextRank ? nextRank.name : null,
    nextRankXP: nextRank ? nextRank.xp : null,

    xpToNextRank: nextRank
      ? Math.max(0, nextRank.xp - xp)
      : 0,

    progress,

    balance: Number(user.balance) || 0,
    bankBalance: Number(user.bank_balance) || 0,

    totalMoney:
      (Number(user.balance) || 0) +
      (Number(user.bank_balance) || 0),

    gamesPlayed: Number(user.games_played) || 0,
    wins: Number(user.wins) || 0,

    creditScore:
      Number(user.credit_score) ||
      STARTING_CREDIT_SCORE,

    loanRemaining:
      Number(user.loan_remaining) || 0,
  };
}

// ═══════════════════════════════════════════════════════════
// LEADERBOARDS
// ═══════════════════════════════════════════════════════════

function safeLimit(limit) {
  return Math.min(
    50,
    Math.max(1, Math.floor(Number(limit) || 10))
  );
}

async function leaderboard(threadId, limit = 10) {
  const { rows } = await requireConn().query(
    `
    SELECT *
    FROM users
    WHERE thread_id = $1
    ORDER BY balance DESC, user_id ASC
    LIMIT $2
    `,
    [String(threadId), safeLimit(limit)]
  );

  return rows;
}

async function moneyLeaderboard(threadId, limit = 10) {
  const { rows } = await requireConn().query(
    `
    SELECT
      *,
      (balance + bank_balance) AS total_money
    FROM users
    WHERE thread_id = $1
    ORDER BY total_money DESC, user_id ASC
    LIMIT $2
    `,
    [String(threadId), safeLimit(limit)]
  );

  return rows;
}

async function xpLeaderboard(threadId, limit = 10) {
  const { rows } = await requireConn().query(
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
    ORDER BY xp DESC, level DESC, user_id ASC
    LIMIT $2
    `,
    [String(threadId), safeLimit(limit)]
  );

  return rows.map((row, index) => {
    const xp = Number(row.xp) || 0;

    return {
      position: index + 1,
      userId: String(row.user_id),

      displayName:
        row.display_name &&
        String(row.display_name).trim()
          ? String(row.display_name).trim()
          : `Player ${row.user_id}`,

      xp,

      level:
        Number(row.level) ||
        calculateLevel(xp),

      rank: getRank(xp),

      balance: Number(row.balance) || 0,
      bankBalance: Number(row.bank_balance) || 0,

      gamesPlayed:
        Number(row.games_played) || 0,

      wins:
        Number(row.wins) || 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════
// BANK — DEPOSIT
// ═══════════════════════════════════════════════════════════

async function deposit(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid deposit amount.");
  }

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT balance
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User not found.");
    }

    if (Number(rows[0].balance) < amount) {
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
      [threadId, userId, amount]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )
      VALUES($1, $2, 'deposit', $3, 'Bank deposit', $4)
      `,
      [threadId, userId, amount, Date.now()]
    );

    await client.query("COMMIT");

    return getUser(threadId, userId);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// BANK — WITHDRAW
// ═══════════════════════════════════════════════════════════

async function withdraw(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid withdrawal amount.");
  }

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const client = await requireConn().connect();

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
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User not found.");
    }

    if (Number(rows[0].bank_balance) < amount) {
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
      [threadId, userId, amount]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )
      VALUES($1, $2, 'withdraw', $3, 'Bank withdrawal', $4)
      `,
      [threadId, userId, amount, Date.now()]
    );

    await client.query("COMMIT");

    return getUser(threadId, userId);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

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
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid transfer amount.");
  }

  threadId = String(threadId);
  fromUserId = String(fromUserId);
  toUserId = String(toUserId);

  if (fromUserId === toUserId) {
    throw new Error(
      "You cannot transfer coins to yourself."
    );
  }

  await getUser(threadId, fromUserId);
  await getUser(threadId, toUserId);

  const client = await requireConn().connect();

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

    await client.query(
      `
      SELECT user_id
      FROM users
      WHERE thread_id = $1
        AND user_id IN ($2, $3)
      ORDER BY user_id
      FOR UPDATE
      `,
      [threadId, firstId, secondId]
    );

    const senderResult = await client.query(
      `
      SELECT balance
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, fromUserId]
    );

    if (!senderResult.rows.length) {
      throw new Error("Sender not found.");
    }

    if (Number(senderResult.rows[0].balance) < amount) {
      throw new Error(
        "You don't have enough wallet coins."
      );
    }

    await client.query(
      `
      UPDATE users
      SET balance = balance - $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, fromUserId, amount]
    );

    await client.query(
      `
      UPDATE users
      SET balance = balance + $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, toUserId, amount]
    );

    const now = Date.now();

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )
      VALUES($1, $2, 'transfer_sent', $3, $4, $5)
      `,
      [
        threadId,
        fromUserId,
        amount,
        `Transfer to ${toUserId}`,
        now,
      ]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )
      VALUES($1, $2, 'transfer_received', $3, $4, $5)
      `,
      [
        threadId,
        toUserId,
        amount,
        `Transfer from ${fromUserId}`,
        now,
      ]
    );

    await client.query("COMMIT");

    return true;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// LOANS — APPLY
// ═══════════════════════════════════════════════════════════

async function applyLoan(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid loan amount.");
  }

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT
        balance,
        credit_score,
        loan_remaining
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User not found.");
    }

    const user = rows[0];

    if (Number(user.loan_remaining) > 0) {
      throw new Error(
        "You already have an active loan."
      );
    }

    const creditScore =
      Number(user.credit_score) ||
      STARTING_CREDIT_SCORE;

    const maxLoan = Math.max(
      500,
      Math.floor(creditScore * 10)
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
      Date.now() + LOAN_DURATION_MS;

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
        amount,
        totalDue,
        dueDate,
      ]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )
      VALUES(
        $1,
        $2,
        'loan',
        $3,
        $4,
        $5
      )
      `,
      [
        threadId,
        userId,
        amount,
        `Loan issued: ${totalDue} due`,
        Date.now(),
      ]
    );

    await client.query("COMMIT");

    return {
      principal: amount,
      interestRate,
      totalDue,
      dueDate,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// LOANS — PAYMENT
// ═══════════════════════════════════════════════════════════

async function payLoan(threadId, userId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid payment amount.");
  }

  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT
        balance,
        loan_principal,
        loan_remaining,
        loan_due,
        credit_score
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User not found.");
    }

    const user = rows[0];

    const loanRemaining =
      Number(user.loan_remaining) || 0;

    if (loanRemaining <= 0) {
      throw new Error(
        "You don't have an active loan."
      );
    }

    const balance =
      Number(user.balance) || 0;

    if (balance < amount) {
      throw new Error(
        "You don't have enough wallet coins."
      );
    }

    const payment = Math.min(
      amount,
      loanRemaining
    );

    const remaining =
      loanRemaining - payment;

    let creditScore =
      Number(user.credit_score) ||
      STARTING_CREDIT_SCORE;

    if (remaining === 0) {
      creditScore = Math.min(
        850,
        creditScore + 20
      );
    }

    await client.query(
      `
      UPDATE users
      SET
        balance = balance - $3,
        loan_remaining = $4,
        loan_principal = $5,
        loan_due = $6,
        credit_score = $7
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        threadId,
        userId,
        payment,
        remaining,
        remaining === 0
          ? 0
          : Number(user.loan_principal) || 0,
        remaining === 0
          ? null
          : user.loan_due,
        creditScore,
      ]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id,
        user_id,
        type,
        amount,
        description,
        created_at
      )
      VALUES(
        $1,
        $2,
        'loan_payment',
        $3,
        $4,
        $5
      )
      `,
      [
        threadId,
        userId,
        payment,
        remaining === 0
          ? "Loan paid in full"
          : "Loan payment",
        Date.now(),
      ]
    );

    await client.query("COMMIT");

    return {
      payment,
      remaining,
      creditScore,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// BANK INTEREST
// ═══════════════════════════════════════════════════════════

async function applyBankInterest(threadId, userId) {
  threadId = String(threadId);
  userId = String(userId);

  await getUser(threadId, userId);

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT
        bank_balance,
        last_interest_paid
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) {
      throw new Error("User not found.");
    }

    const user = rows[0];

    const now = Date.now();

    const last =
      user.last_interest_paid
        ? Number(user.last_interest_paid)
        : null;

    if (
      last !== null &&
      now - last < INTEREST_COOLDOWN_MS
    ) {
      await client.query("COMMIT");

      return {
        interest: 0,
        applied: false,
        onCooldown: true,
        msRemaining:
          INTEREST_COOLDOWN_MS -
          (now - last),
      };
    }

    const bankBalance =
      Number(user.bank_balance) || 0;

    if (bankBalance <= 0) {
      await client.query(
        `
        UPDATE users
        SET last_interest_paid = $3
        WHERE thread_id = $1
          AND user_id = $2
        `,
        [threadId, userId, now]
      );

      await client.query("COMMIT");

      return {
        interest: 0,
        applied: false,
        onCooldown: false,
      };
    }

    const interest = Math.floor(
      bankBalance * 0.01
    );

    await client.query(
      `
      UPDATE users
      SET
        bank_balance = bank_balance + $3,
        last_interest_paid = $4
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        threadId,
        userId,
        interest,
        now,
      ]
    );

    if (interest > 0) {
      await client.query(
        `
        INSERT INTO economy_transactions(
          thread_id,
          user_id,
          type,
          amount,
          description,
          created_at
        )
        VALUES(
          $1,
          $2,
          'bank_interest',
          $3,
          '1% bank interest',
          $4
        )
        `,
        [
          threadId,
          userId,
          interest,
          now,
        ]
      );
    }

    await client.query("COMMIT");

    return {
      interest,
      applied: interest > 0,
      onCooldown: false,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════

async function addItem(
  threadId,
  userId,
  itemId,
  amount = 1
) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid inventory amount.");
  }

  const conn = requireConn();

  await conn.query(
    `
    INSERT INTO inventory(
      thread_id,
      user_id,
      item_id,
      amount
    )
    VALUES($1, $2, $3, $4)
    ON CONFLICT(thread_id, user_id, item_id)
    DO UPDATE SET
      amount = inventory.amount + EXCLUDED.amount
    `,
    [
      String(threadId),
      String(userId),
      String(itemId),
      amount,
    ]
  );
}

async function getInventory(threadId, userId) {
  const { rows } = await requireConn().query(
    `
    SELECT item_id, amount
    FROM inventory
    WHERE thread_id = $1
      AND user_id = $2
      AND amount > 0
    ORDER BY item_id ASC
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

async function getThreadSettings(threadId) {
  const conn = requireConn();
  const id = String(threadId);

  let { rows } = await conn.query(
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
      INSERT INTO thread_settings(
        thread_id,
        roast_enabled,
        fun_enabled
      )
      VALUES($1, TRUE, TRUE)
      ON CONFLICT(thread_id) DO NOTHING
      `,
      [id]
    );

    ({ rows } = await conn.query(
      `
      SELECT *
      FROM thread_settings
      WHERE thread_id = $1
      `,
      [id]
    ));
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
    "fun_enabled",
  ];

  const safeFields = Object.keys(fields || {}).filter(
    (key) => allowedFields.includes(key)
  );

  if (!safeFields.length) {
    return getThreadSettings(id);
  }

  const setClause = safeFields
    .map((key, index) => `${key} = $${index + 2}`)
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

// ═══════════════════════════════════════════════════════════
// ROAST SETTINGS
// ═══════════════════════════════════════════════════════════

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
      roast_enabled: Boolean(enabled),
    }
  );
}

// ═══════════════════════════════════════════════════════════
// GAME SETTINGS
// ═══════════════════════════════════════════════════════════

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
      fun_enabled: Boolean(enabled),
    }
  );
}

// ╔══════════════════════════════════════════════════════════╗
// ║                         EXPORTS                          ║
// ╚══════════════════════════════════════════════════════════╝

module.exports = {
  // Database
  query,
  connect,

  // Users
  getUser,
  updateUser,
  setUserDisplayName,

  // Wallet
  addBalance,
  spendBalance,

  // Game statistics
  incrementGameStats,

  // XP / ranks
  addXP,
  calculateLevel,
  getRank,
  getNextRank,
  getPlayerRanking,

  // Leaderboards
  leaderboard,
  moneyLeaderboard,
  xpLeaderboard,

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

  // Roast / Banat
  isRoastEnabled,
  setRoastEnabled,

  // Games
  isGameEnabled,
  setGameEnabled,
};
