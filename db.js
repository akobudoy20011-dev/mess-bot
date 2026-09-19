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
  if (pool) return pool;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add your Neon connection string to Render Environment Variables."
    );
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
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
  // ECLIPSE RPG — NEW RPG SYSTEM
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    ALTER TABLE rpg_players
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS traitor BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS traitor_kingdom_id TEXT,
      ADD COLUMN IF NOT EXISTS property_level INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS skill_points INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS affinity_points INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS special_points INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_hunts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_bosses INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_dungeons INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS death_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_rest_at BIGINT,
      ADD COLUMN IF NOT EXISTS last_hunt_at BIGINT;

    /* tier: 0 none, 1 weak, 2 normal, 3 strong, 4 exceptional, 5 mastered, 6 ascended */
    CREATE TABLE IF NOT EXISTS rpg_player_affinities (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      affinity_id TEXT NOT NULL,
      tier INTEGER NOT NULL DEFAULT 0,
      mastery INTEGER NOT NULL DEFAULT 0,
      primary_affinity BOOLEAN NOT NULL DEFAULT FALSE,
      unlocked BOOLEAN NOT NULL DEFAULT TRUE,
      source TEXT,
      unlocked_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, affinity_id)
    );

    CREATE INDEX IF NOT EXISTS rpg_affinity_player_idx
      ON rpg_player_affinities(thread_id, user_id, unlocked, tier DESC, mastery DESC);

    ALTER TABLE rpg_player_spells
      ADD COLUMN IF NOT EXISTS mastery_level INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS learned_at BIGINT;

    CREATE TABLE IF NOT EXISTS rpg_player_special_moves (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      special_id TEXT NOT NULL,
      unlocked BOOLEAN NOT NULL DEFAULT TRUE,
      mastery INTEGER NOT NULL DEFAULT 0,
      uses INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      unlocked_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, special_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_player_traits (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      trait_id TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      unlocked BOOLEAN NOT NULL DEFAULT TRUE,
      source TEXT,
      unlocked_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, trait_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_player_pets (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      pet_id TEXT NOT NULL,
      name TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      experience INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      obtained_from TEXT,
      obtained_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(thread_id, user_id, pet_id)
    );

    CREATE INDEX IF NOT EXISTS rpg_player_pets_lookup_idx
      ON rpg_player_pets(thread_id, user_id, active);

    ALTER TABLE rpg_equipment
      ADD COLUMN IF NOT EXISTS enhancement INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS equipped_at BIGINT;

    ALTER TABLE rpg_quests
      ADD COLUMN IF NOT EXISTS kingdom_id TEXT,
      ADD COLUMN IF NOT EXISTS affinity_id TEXT,
      ADD COLUMN IF NOT EXISTS class_id TEXT,
      ADD COLUMN IF NOT EXISTS reward_coins INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reward_reputation INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reward_affinity_mastery INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reward_spell_id TEXT,
      ADD COLUMN IF NOT EXISTS reward_special_id TEXT,
      ADD COLUMN IF NOT EXISTS reward_pet_id TEXT,
      ADD COLUMN IF NOT EXISTS claimed_at BIGINT;

    CREATE TABLE IF NOT EXISTS rpg_kingdom_reputation (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kingdom_id TEXT NOT NULL,
      reputation INTEGER NOT NULL DEFAULT 0,
      rank TEXT NOT NULL DEFAULT 'stranger',
      quests_completed INTEGER NOT NULL DEFAULT 0,
      last_quest_at BIGINT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id, kingdom_id)
    );

    CREATE INDEX IF NOT EXISTS rpg_kingdom_rep_player_idx
      ON rpg_kingdom_reputation(thread_id, user_id, reputation DESC);

    CREATE TABLE IF NOT EXISTS rpg_kingdom_quests (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      kingdom_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      objective_type TEXT NOT NULL,
      objective_key TEXT,
      target INTEGER NOT NULL DEFAULT 1,
      reward_coins INTEGER NOT NULL DEFAULT 0,
      reward_xp INTEGER NOT NULL DEFAULT 0,
      reward_reputation INTEGER NOT NULL DEFAULT 0,
      reward_affinity TEXT,
      reward_affinity_mastery INTEGER NOT NULL DEFAULT 0,
      reward_spell TEXT,
      reward_special TEXT,
      reward_pet TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT,
      UNIQUE(thread_id, kingdom_id, quest_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_affinity_trials (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      affinity_id TEXT NOT NULL,
      trial_id TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 1,
      progress INTEGER NOT NULL DEFAULT 0,
      target INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      started_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      completed_at BIGINT,
      UNIQUE(thread_id, user_id, affinity_id, trial_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_parties (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      leader_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Eclipse Party',
      status TEXT NOT NULL DEFAULT 'forming',
      max_members INTEGER NOT NULL DEFAULT 5,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_party_members (
      party_id BIGINT NOT NULL REFERENCES rpg_parties(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at BIGINT NOT NULL,
      ready BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY(party_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS rpg_party_members_lookup_idx
      ON rpg_party_members(thread_id, user_id, party_id);

    CREATE TABLE IF NOT EXISTS rpg_boss_sessions (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      boss_id TEXT NOT NULL,
      party_id BIGINT,
      boss_hp INTEGER NOT NULL,
      boss_max_hp INTEGER NOT NULL,
      phase INTEGER NOT NULL DEFAULT 1,
      turn_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      environment TEXT,
      weather TEXT,
      season TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_boss_participants (
      boss_session_id BIGINT NOT NULL REFERENCES rpg_boss_sessions(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      damage_dealt INTEGER NOT NULL DEFAULT 0,
      healing_done INTEGER NOT NULL DEFAULT 0,
      damage_taken INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY(boss_session_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_guilds (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      founder_id TEXT NOT NULL,
      treasury BIGINT NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      experience BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(thread_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_guild_members (
      guild_id BIGINT NOT NULL REFERENCES rpg_guilds(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at BIGINT NOT NULL,
      PRIMARY KEY(guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS rpg_world_state (
      thread_id TEXT PRIMARY KEY,
      season TEXT NOT NULL DEFAULT 'spring',
      weather TEXT NOT NULL DEFAULT 'clear',
      season_started_at BIGINT NOT NULL,
      weather_changed_at BIGINT NOT NULL,
      active_event TEXT,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpg_world_events (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      started_at BIGINT NOT NULL,
      ends_at BIGINT,
      UNIQUE(thread_id, event_id)
    );

    ALTER TABLE rpg_location_states
      ADD COLUMN IF NOT EXISTS season_modifier TEXT,
      ADD COLUMN IF NOT EXISTS weather_modifier TEXT,
      ADD COLUMN IF NOT EXISTS active_event TEXT;

    CREATE TABLE IF NOT EXISTS rpg_combat_effects (
      id BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      combat_id BIGINT,
      boss_session_id BIGINT,
      user_id TEXT,
      target_type TEXT NOT NULL DEFAULT 'player',
      target_id TEXT,
      effect_id TEXT NOT NULL,
      stacks INTEGER NOT NULL DEFAULT 1,
      remaining_turns INTEGER NOT NULL DEFAULT 1,
      magnitude INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS rpg_combat_effects_lookup_idx
      ON rpg_combat_effects(thread_id, user_id, effect_id, remaining_turns);

    ALTER TABLE rpg_combat_sessions
      ADD COLUMN IF NOT EXISTS round_number INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS environment TEXT,
      ADD COLUMN IF NOT EXISTS weather TEXT,
      ADD COLUMN IF NOT EXISTS season TEXT,
      ADD COLUMN IF NOT EXISTS enemy_count INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS rpg_player_statistics (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      enemies_defeated INTEGER NOT NULL DEFAULT 0,
      elites_defeated INTEGER NOT NULL DEFAULT 0,
      bosses_defeated INTEGER NOT NULL DEFAULT 0,
      hunts_completed INTEGER NOT NULL DEFAULT 0,
      dungeons_completed INTEGER NOT NULL DEFAULT 0,
      quests_completed INTEGER NOT NULL DEFAULT 0,
      kingdom_quests_completed INTEGER NOT NULL DEFAULT 0,
      affinity_trials_completed INTEGER NOT NULL DEFAULT 0,
      total_damage INTEGER NOT NULL DEFAULT 0,
      total_healing INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(thread_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS rpg_players_kingdom_idx
      ON rpg_players(thread_id, kingdom_id);

    CREATE INDEX IF NOT EXISTS rpg_players_region_idx
      ON rpg_players(thread_id, region_id);

    CREATE INDEX IF NOT EXISTS rpg_quests_player_status_idx
      ON rpg_quests(thread_id, user_id, status, quest_type);

    CREATE INDEX IF NOT EXISTS rpg_spells_player_idx
      ON rpg_player_spells(thread_id, user_id, unlocked);

    CREATE INDEX IF NOT EXISTS rpg_specials_player_idx
      ON rpg_player_special_moves(thread_id, user_id, unlocked);
  `);

  // ═════════════════════════════════════════════════════════
  // ECLIPSE RPG — SCHEMA REPAIRS
  //
  // The RPG modules (effects.js, spells.js, kingdom-quest.js,
  // weather.js) expect a slightly different layout than the
  // CREATE TABLE statements above produce. Everything here is
  // idempotent and safe to run on every boot.
  // ═════════════════════════════════════════════════════════

  await pool.query(`
    -- effects.js columns
    ALTER TABLE rpg_combat_effects
      ADD COLUMN IF NOT EXISTS combat_session_id BIGINT,
      ADD COLUMN IF NOT EXISTS source_id TEXT,
      ADD COLUMN IF NOT EXISTS source_type TEXT,
      ADD COLUMN IF NOT EXISTS effect_type TEXT,
      ADD COLUMN IF NOT EXISTS duration INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

    -- effects use fractional magnitudes (0.25, 0.05, 1.3)
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'rpg_combat_effects'
          AND column_name = 'magnitude'
          AND data_type <> 'double precision'
      ) THEN
        ALTER TABLE rpg_combat_effects
          ALTER COLUMN magnitude TYPE DOUBLE PRECISION;
      END IF;
    END $$;

    -- timestamps default to "now" so inserts that omit them still work
    ALTER TABLE rpg_combat_effects
      ALTER COLUMN created_at SET DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      ALTER COLUMN updated_at SET DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

    CREATE INDEX IF NOT EXISTS rpg_combat_effects_session_idx
      ON rpg_combat_effects(thread_id, combat_session_id, target_id, effect_id);

    -- spells.js / kingdom-quest.js read and write "mastery"
    ALTER TABLE rpg_player_spells
      ADD COLUMN IF NOT EXISTS mastery INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE rpg_player_spells
      ALTER COLUMN updated_at SET DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

    -- kingdom-quest.js table
    CREATE TABLE IF NOT EXISTS rpg_kingdom_quest_records (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      quest_type TEXT NOT NULL DEFAULT 'kingdom',
      kingdom_id TEXT NOT NULL,
      objective_type TEXT NOT NULL,
      objective_amount INTEGER NOT NULL DEFAULT 0,
      objective_progress INTEGER NOT NULL DEFAULT 0,
      reward_coins INTEGER NOT NULL DEFAULT 0,
      reward_reputation INTEGER NOT NULL DEFAULT 0,
      reward_affinity_mastery INTEGER NOT NULL DEFAULT 0,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      claimed_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (thread_id, user_id, quest_id)
    );

    CREATE INDEX IF NOT EXISTS rpg_kingdom_quest_records_player_idx
      ON rpg_kingdom_quest_records(thread_id, user_id, kingdom_id);

    -- weather.js inserts into rpg_world_state without these columns
    ALTER TABLE rpg_world_state
      ALTER COLUMN season_started_at SET DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      ALTER COLUMN weather_changed_at SET DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      ALTER COLUMN updated_at SET DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  `);

  // ═════════════════════════════════════════════════════════
  // RPG COMBAT — PERSISTENCE / SAFETY INDEXES
  // ═════════════════════════════════════════════════════════

  // Close duplicate active sessions before creating the unique
  // partial index, so Render restarts and duplicate commands are safe.
  await pool.query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id, user_id
          ORDER BY updated_at DESC, id DESC
        ) AS rn
      FROM rpg_combat_sessions
      WHERE status = 'active'
    )
    UPDATE rpg_combat_sessions
    SET
      status = 'ended',
      updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
    WHERE id IN (
      SELECT id FROM ranked WHERE rn > 1
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS rpg_combat_one_active_per_player
      ON rpg_combat_sessions(thread_id, user_id)
      WHERE status = 'active';

    CREATE INDEX IF NOT EXISTS rpg_combat_lookup_idx
      ON rpg_combat_sessions(thread_id, user_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS rpg_combat_effect_combat_idx
      ON rpg_combat_effects(combat_id, target_id, effect_id);

    CREATE INDEX IF NOT EXISTS rpg_combat_effect_target_idx
      ON rpg_combat_effects(thread_id, user_id, combat_id, target_id);

    CREATE INDEX IF NOT EXISTS rpg_inventory_item_lookup_idx
      ON rpg_inventory_items(thread_id, user_id, item_id);
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
      ON ai_memories(character_id, thread_id, user_id, importance DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS ai_sessions_active_idx
      ON ai_sessions(character_id, thread_id, user_id, active);
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

  if (result.rows.length) return result.rows[0];

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
    [threadId, userId, STARTING_BALANCE, STARTING_CREDIT_SCORE]
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

  if (!safeKeys.length) return;

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

  if (!name) return;

  await getUser(threadId, userId);

  await updateUser(threadId, userId, {
    display_name: name,
  });
}

// ═══════════════════════════════════════════════════════════
// WALLET — ADD
// ═══════════════════════════════════════════════════════════

async function addBalance(
  threadId,
  userId,
  amount,
  description = null
) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount === 0) {
    if (amount === 0) {
      return Number((await getUser(threadId, userId)).balance);
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
    try { await client.query("ROLLBACK"); } catch {}
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

    if (!rows.length) throw new Error("User not found.");

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
    try { await client.query("ROLLBACK"); } catch {}
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
    if (xp >= rank.xp) current = rank;
  }

  return current;
}

function getNextRank(xp) {
  xp = Number(xp) || 0;

  for (const rank of RANKS) {
    if (xp < rank.xp) return rank;
  }

  return null;
}

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

    if (!rows.length) throw new Error("User not found.");

    const oldXP = Math.max(0, Number(rows[0].xp) || 0);
    const previousRank = getRank(oldXP);
    const newXP = Math.max(0, oldXP + amount);
    const newLevel = calculateLevel(newXP);

    await client.query(
      `
      UPDATE users
      SET xp = $3, level = $4
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
    try { await client.query("ROLLBACK"); } catch {}
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
    user.display_name && String(user.display_name).trim()
      ? String(user.display_name).trim()
      : `Player ${user.user_id}`;

  let progress = 100;

  if (nextRank) {
    const range = nextRank.xp - currentRank.xp;
    const earned = xp - currentRank.xp;

    progress = Math.floor(
      Math.min(100, Math.max(0, (earned / range) * 100))
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
    xpToNextRank: nextRank ? Math.max(0, nextRank.xp - xp) : 0,
    progress,
    balance: Number(user.balance) || 0,
    bankBalance: Number(user.bank_balance) || 0,
    totalMoney:
      (Number(user.balance) || 0) +
      (Number(user.bank_balance) || 0),
    gamesPlayed: Number(user.games_played) || 0,
    wins: Number(user.wins) || 0,
    creditScore:
      Number(user.credit_score) || STARTING_CREDIT_SCORE,
    loanRemaining: Number(user.loan_remaining) || 0,
  };
}

// ═══════════════════════════════════════════════════════════
// LEADERBOARDS
// ═══════════════════════════════════════════════════════════

function safeLimit(limit) {
  return Math.min(50, Math.max(1, Math.floor(Number(limit) || 10)));
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
        row.display_name && String(row.display_name).trim()
          ? String(row.display_name).trim()
          : `Player ${row.user_id}`,
      xp,
      level: Number(row.level) || calculateLevel(xp),
      rank: getRank(xp),
      balance: Number(row.balance) || 0,
      bankBalance: Number(row.bank_balance) || 0,
      gamesPlayed: Number(row.games_played) || 0,
      wins: Number(row.wins) || 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════
// BANK
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
      WHERE thread_id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) throw new Error("User not found.");
    if (Number(rows[0].balance) < amount) {
      throw new Error("Not enough wallet coins.");
    }

    await client.query(
      `
      UPDATE users
      SET balance = balance - $3,
          bank_balance = bank_balance + $3
      WHERE thread_id = $1 AND user_id = $2
      `,
      [threadId, userId, amount]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id, user_id, type, amount, description, created_at
      )
      VALUES($1, $2, 'deposit', $3, 'Bank deposit', $4)
      `,
      [threadId, userId, amount, Date.now()]
    );

    await client.query("COMMIT");
    return getUser(threadId, userId);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

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
      WHERE thread_id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) throw new Error("User not found.");
    if (Number(rows[0].bank_balance) < amount) {
      throw new Error("Not enough money in the bank.");
    }

    await client.query(
      `
      UPDATE users
      SET bank_balance = bank_balance - $3,
          balance = balance + $3
      WHERE thread_id = $1 AND user_id = $2
      `,
      [threadId, userId, amount]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id, user_id, type, amount, description, created_at
      )
      VALUES($1, $2, 'withdraw', $3, 'Bank withdrawal', $4)
      `,
      [threadId, userId, amount, Date.now()]
    );

    await client.query("COMMIT");
    return getUser(threadId, userId);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// TRANSFERS
// ═══════════════════════════════════════════════════════════

async function transfer(threadId, fromUserId, toUserId, amount) {
  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid transfer amount.");
  }

  threadId = String(threadId);
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

    const firstId = fromUserId < toUserId ? fromUserId : toUserId;
    const secondId = fromUserId < toUserId ? toUserId : fromUserId;

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
      WHERE thread_id = $1 AND user_id = $2
      `,
      [threadId, fromUserId]
    );

    if (!senderResult.rows.length) {
      throw new Error("Sender not found.");
    }

    if (Number(senderResult.rows[0].balance) < amount) {
      throw new Error("You don't have enough wallet coins.");
    }

    await client.query(
      `
      UPDATE users
      SET balance = balance - $3
      WHERE thread_id = $1 AND user_id = $2
      `,
      [threadId, fromUserId, amount]
    );

    await client.query(
      `
      UPDATE users
      SET balance = balance + $3
      WHERE thread_id = $1 AND user_id = $2
      `,
      [threadId, toUserId, amount]
    );

    const now = Date.now();

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id, user_id, type, amount, description, created_at
      )
      VALUES($1, $2, 'transfer_sent', $3, $4, $5)
      `,
      [threadId, fromUserId, amount, `Transfer to ${toUserId}`, now]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id, user_id, type, amount, description, created_at
      )
      VALUES($1, $2, 'transfer_received', $3, $4, $5)
      `,
      [threadId, toUserId, amount, `Transfer from ${fromUserId}`, now]
    );

    await client.query("COMMIT");
    return true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// LOANS
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
      SELECT balance, credit_score, loan_remaining
      FROM users
      WHERE thread_id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) throw new Error("User not found.");

    const user = rows[0];

    if (Number(user.loan_remaining) > 0) {
      throw new Error("You already have an active loan.");
    }

    const creditScore =
      Number(user.credit_score) || STARTING_CREDIT_SCORE;

    const maxLoan = Math.max(500, Math.floor(creditScore * 10));

    if (amount > maxLoan) {
      throw new Error(
        `Your credit score allows a maximum loan of ${maxLoan} coins.`
      );
    }

    const interestRate = 0.10;
    const totalDue = Math.ceil(amount * (1 + interestRate));
    const dueDate = Date.now() + LOAN_DURATION_MS;

    await client.query(
      `
      UPDATE users
      SET balance = balance + $3,
          loan_principal = $3,
          loan_remaining = $4,
          loan_due = $5
      WHERE thread_id = $1 AND user_id = $2
      `,
      [threadId, userId, amount, totalDue, dueDate]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id, user_id, type, amount, description, created_at
      )
      VALUES($1, $2, 'loan', $3, $4, $5)
      `,
      [threadId, userId, amount, `Loan issued: ${totalDue} due`, Date.now()]
    );

    await client.query("COMMIT");

    return {
      principal: amount,
      interestRate,
      totalDue,
      dueDate,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

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
      WHERE thread_id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) throw new Error("User not found.");

    const user = rows[0];
    const loanRemaining = Number(user.loan_remaining) || 0;

    if (loanRemaining <= 0) {
      throw new Error("You don't have an active loan.");
    }

    const balance = Number(user.balance) || 0;

    if (balance < amount) {
      throw new Error("You don't have enough wallet coins.");
    }

    const payment = Math.min(amount, loanRemaining);
    const remaining = loanRemaining - payment;

    let newCreditScore =
      Number(user.credit_score) || STARTING_CREDIT_SCORE;

    if (remaining === 0) {
      newCreditScore = Math.min(850, newCreditScore + 10);
    }

    await client.query(
      `
      UPDATE users
      SET
        balance = balance - $3,
        loan_remaining = $4,
        loan_principal = CASE
          WHEN $4 = 0 THEN 0
          ELSE loan_principal
        END,
        loan_due = CASE
          WHEN $4 = 0 THEN NULL
          ELSE loan_due
        END,
        credit_score = $5
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, userId, payment, remaining, newCreditScore]
    );

    await client.query(
      `
      INSERT INTO economy_transactions(
        thread_id, user_id, type, amount, description, created_at
      )
      VALUES($1, $2, 'loan_payment', $3, $4, $5)
      `,
      [
        threadId,
        userId,
        payment,
        remaining === 0 ? "Loan paid in full" : "Loan payment",
        Date.now(),
      ]
    );

    await client.query("COMMIT");

    return {
      payment,
      remaining,
      paidOff: remaining === 0,
      creditScore: newCreditScore,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
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
      SELECT bank_balance, last_interest_paid
      FROM users
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (!rows.length) throw new Error("User not found.");

    const bankBalance = Number(rows[0].bank_balance) || 0;
    const lastInterest = Number(rows[0].last_interest_paid) || 0;
    const now = Date.now();

    if (lastInterest > 0 && now - lastInterest < INTEREST_COOLDOWN_MS) {
      await client.query("COMMIT");

      return {
        applied: false,
        interest: 0,
        bankBalance,
        nextAt: lastInterest + INTEREST_COOLDOWN_MS,
      };
    }

    const interest = Math.floor(bankBalance * 0.01);

    await client.query(
      `
      UPDATE users
      SET bank_balance = bank_balance + $3,
          last_interest_paid = $4
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadId, userId, interest, now]
    );

    if (interest > 0) {
      await client.query(
        `
        INSERT INTO economy_transactions(
          thread_id, user_id, type, amount, description, created_at
        )
        VALUES($1, $2, 'interest', $3, 'Bank interest', $4)
        `,
        [threadId, userId, interest, now]
      );
    }

    await client.query("COMMIT");

    return {
      applied: true,
      interest,
      bankBalance: bankBalance + interest,
      nextAt: now + INTEREST_COOLDOWN_MS,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// LEGACY INVENTORY
// ═══════════════════════════════════════════════════════════

async function addItem(threadId, userId, itemId, amount = 1) {
  threadId = String(threadId);
  userId = String(userId);
  itemId = String(itemId);

  amount = Math.floor(Number(amount));

  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Invalid inventory amount.");
  }

  await requireConn().query(
    `
    INSERT INTO inventory(thread_id, user_id, item_id, amount)
    VALUES($1, $2, $3, $4)
    ON CONFLICT(thread_id, user_id, item_id)
    DO UPDATE SET
      amount = GREATEST(0, inventory.amount + EXCLUDED.amount)
    `,
    [threadId, userId, itemId, amount]
  );

  return getInventory(threadId, userId);
}

async function getInventory(threadId, userId) {
  const { rows } = await requireConn().query(
    `
    SELECT item_id, amount
    FROM inventory
    WHERE thread_id = $1
      AND user_id = $2
      AND amount > 0
    ORDER BY item_id
    `,
    [String(threadId), String(userId)]
  );

  return rows;
}

// ═══════════════════════════════════════════════════════════
// ECLIPSE RPG — PLAYER
// ═══════════════════════════════════════════════════════════

async function ensureRpgPlayer(threadId, userId) {
  threadId = String(threadId);
  userId = String(userId);

  const now = Date.now();
  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    // Make sure the base economy user exists too.
    await client.query(
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
      [threadId, userId, STARTING_BALANCE, STARTING_CREDIT_SCORE]
    );

    await client.query(
      `
      INSERT INTO rpg_players(
        thread_id, user_id, character_class, region_id, location_id,
        property_tier, property_level,
        hp, max_hp, mp, max_mp, stamina, max_stamina,
        strength, defense, agility, intelligence, vitality, luck,
        reputation, renown,
        skill_points, affinity_points, special_points,
        total_hunts, total_bosses, total_dungeons, death_count,
        status, created_at, updated_at
      )
      VALUES(
        $1, $2, 'knight', 'greenvale', 'eclipse_castle',
        0, 0,
        130, 130, 35, 35, 120, 120,
        18, 16, 10, 6, 16, 8,
        0, 0,
        0, 0, 0,
        0, 0, 0, 0,
        'active', $3, $3
      )
      ON CONFLICT(thread_id, user_id) DO NOTHING
      `,
      [threadId, userId, now]
    );

    await client.query(
      `
      INSERT INTO rpg_properties(thread_id, user_id, tier, name, updated_at)
      VALUES($1, $2, 0, 'Settlement', $3)
      ON CONFLICT(thread_id, user_id) DO NOTHING
      `,
      [threadId, userId, now]
    );

    await client.query(
      `
      INSERT INTO rpg_armies(
        thread_id, user_id, name, region_id, location_id,
        infantry, archers, cavalry, mages, assassins,
        status, supplies, formation, created_at, updated_at
      )
      VALUES(
        $1, $2, 'House Guard', 'greenvale', 'eclipse_castle',
        10, 0, 0, 0, 0,
        'garrison', 100, 'balanced', $3, $3
      )
      ON CONFLICT(thread_id, user_id) DO NOTHING
      `,
      [threadId, userId, now]
    );

    await client.query(
      `
      INSERT INTO rpg_player_statistics(thread_id, user_id, updated_at)
      VALUES($1, $2, $3)
      ON CONFLICT(thread_id, user_id) DO NOTHING
      `,
      [threadId, userId, now]
    );

    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }

  return getRpgPlayer(threadId, userId);
}

async function ensureRpgPlayerIfMissing(threadId, userId) {
  const { rows } = await requireConn().query(
    `
    SELECT user_id
    FROM rpg_players
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId]
  );

  if (!rows.length) {
    await ensureRpgPlayer(threadId, userId);
  }
}

async function getRpgPlayer(threadId, userId) {
  threadId = String(threadId);
  userId = String(userId);

  await ensureRpgPlayerIfMissing(threadId, userId);

  const { rows } = await requireConn().query(
    `
    SELECT
      p.*,

      u.balance,
      u.bank_balance,
      u.xp,
      u.level,
      u.credit_score,
      u.loan_remaining,
      u.loan_due,
      u.display_name,

      s.enemies_defeated,
      s.elites_defeated,
      s.bosses_defeated,
      s.hunts_completed,
      s.dungeons_completed,
      s.quests_completed,
      s.kingdom_quests_completed,
      s.affinity_trials_completed,
      s.total_damage,
      s.total_healing,
      s.deaths

    FROM rpg_players p

    LEFT JOIN users u
      ON u.thread_id = p.thread_id
     AND u.user_id = p.user_id

    LEFT JOIN rpg_player_statistics s
      ON s.thread_id = p.thread_id
     AND s.user_id = p.user_id

    WHERE p.thread_id = $1
      AND p.user_id = $2
    `,
    [threadId, userId]
  );

  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════
// RPG VITALS
//
// Numeric vitals are clamped to >= 0. location_id, region_id
// and status are also accepted so teleport / rest can persist
// through this function.
// ═══════════════════════════════════════════════════════════

const NUMERIC_VITALS = [
  "hp",
  "max_hp",
  "mp",
  "max_mp",
  "stamina",
  "max_stamina",
];

const TEXT_VITALS = ["location_id", "region_id", "status"];

async function updateRpgVitals(threadId, userId, updates = {}) {
  threadId = String(threadId);
  userId = String(userId);

  await ensureRpgPlayerIfMissing(threadId, userId);

  const keys = Object.keys(updates || {}).filter(
    (key) =>
      NUMERIC_VITALS.includes(key) || TEXT_VITALS.includes(key)
  );

  if (!keys.length) {
    return getRpgPlayer(threadId, userId);
  }

  const values = keys.map((key) => {
    if (TEXT_VITALS.includes(key)) {
      const text = String(updates[key] ?? "").trim();

      if (!text) {
        throw new Error(`Invalid RPG value: ${key}`);
      }

      return text;
    }

    const value = Math.floor(Number(updates[key]));

    if (!Number.isFinite(value)) {
      throw new Error(`Invalid RPG vital: ${key}`);
    }

    return Math.max(0, value);
  });

  const setClause = keys
    .map((key, index) => `${key} = $${index + 3}`)
    .join(", ");

  await requireConn().query(
    `
    UPDATE rpg_players
    SET
      ${setClause},
      updated_at = $${keys.length + 3}
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId, ...values, Date.now()]
  );

  return getRpgPlayer(threadId, userId);
}

// ═══════════════════════════════════════════════════════════
// RPG INVENTORY
// ═══════════════════════════════════════════════════════════

async function addRpgItem(threadId, userId, itemId, quantity = 1) {
  threadId = String(threadId);
  userId = String(userId);
  itemId = String(itemId);

  quantity = Math.floor(Number(quantity));

  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new Error("Invalid RPG item quantity.");
  }

  await ensureRpgPlayerIfMissing(threadId, userId);

  await requireConn().query(
    `
    INSERT INTO rpg_inventory_items(
      thread_id,
      user_id,
      item_id,
      quantity,
      updated_at
    )
    VALUES($1, $2, $3, $4, $5)
    ON CONFLICT(thread_id, user_id, item_id)
    DO UPDATE SET
      quantity = GREATEST(
        0,
        rpg_inventory_items.quantity + EXCLUDED.quantity
      ),
      updated_at = EXCLUDED.updated_at
    `,
    [threadId, userId, itemId, quantity, Date.now()]
  );

  return getRpgInventory(threadId, userId);
}

async function getRpgItemQuantity(threadId, userId, itemId) {
  const { rows } = await requireConn().query(
    `
    SELECT quantity
    FROM rpg_inventory_items
    WHERE thread_id = $1
      AND user_id = $2
      AND item_id = $3
    `,
    [String(threadId), String(userId), String(itemId)]
  );

  return rows.length ? Number(rows[0].quantity) || 0 : 0;
}

async function getRpgInventory(threadId, userId) {
  const { rows } = await requireConn().query(
    `
    SELECT item_id, quantity, updated_at
    FROM rpg_inventory_items
    WHERE thread_id = $1
      AND user_id = $2
      AND quantity > 0
    ORDER BY item_id
    `,
    [String(threadId), String(userId)]
  );

  return rows;
}

async function consumeRpgItem(threadId, userId, itemId, quantity = 1) {
  threadId = String(threadId);
  userId = String(userId);
  itemId = String(itemId);

  quantity = Math.floor(Number(quantity));

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Invalid RPG item quantity.");
  }

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT quantity
      FROM rpg_inventory_items
      WHERE thread_id = $1
        AND user_id = $2
        AND item_id = $3
      FOR UPDATE
      `,
      [threadId, userId, itemId]
    );

    if (!rows.length) {
      throw new Error("You don't have that item.");
    }

    const current = Number(rows[0].quantity) || 0;

    if (current < quantity) {
      throw new Error("You don't have enough of that item.");
    }

    const remaining = current - quantity;

    await client.query(
      `
      UPDATE rpg_inventory_items
      SET quantity = $4,
          updated_at = $5
      WHERE thread_id = $1
        AND user_id = $2
        AND item_id = $3
      `,
      [threadId, userId, itemId, remaining, Date.now()]
    );

    await client.query("COMMIT");

    return { itemId, consumed: quantity, remaining };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════
// RPG COMBAT — SESSIONS
// ═══════════════════════════════════════════════════════════

async function getActiveCombat(threadId, userId) {
  const { rows } = await requireConn().query(
    `
    SELECT *
    FROM rpg_combat_sessions
    WHERE thread_id = $1
      AND user_id = $2
      AND status = 'active'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [String(threadId), String(userId)]
  );

  return rows[0] || null;
}

async function getCombatById(combatId) {
  const { rows } = await requireConn().query(
    `
    SELECT *
    FROM rpg_combat_sessions
    WHERE id = $1
    `,
    [Number(combatId)]
  );

  return rows[0] || null;
}

/**
 * Creates a combat session, or returns the player's existing
 * active one. Locks the player row so double-fired commands
 * cannot create two sessions. Accepts snake_case or camelCase.
 */
async function createCombatSession(data = {}) {
  const threadId = String(data.thread_id ?? data.threadId ?? "");
  const userId = String(data.user_id ?? data.userId ?? "");

  if (!threadId || !userId) {
    throw new Error("Combat session requires thread_id and user_id.");
  }

  await ensureRpgPlayerIfMissing(threadId, userId);

  const existing = await getActiveCombat(threadId, userId);
  if (existing) return existing;

  const now = Date.now();

  const int = (value, fallback, min) =>
    Math.max(min, Math.floor(Number(value ?? fallback)));

  const enemyId = String(data.enemy_id ?? data.enemyId ?? "unknown_enemy");
  const enemyName = String(data.enemy_name ?? data.enemyName ?? "Unknown Enemy");

  const enemyHp = int(data.enemy_hp ?? data.enemyHp, 1, 1);
  const enemyMaxHp = int(data.enemy_max_hp ?? data.enemyMaxHp, enemyHp, enemyHp);
  const enemyAttack = int(data.enemy_attack ?? data.enemyAttack, 1, 0);
  const enemyDefense = int(data.enemy_defense ?? data.enemyDefense, 0, 0);

  const playerHp = int(data.player_hp ?? data.playerHp, 0, 0);
  const playerMp = int(data.player_mp ?? data.playerMp, 0, 0);
  const playerStamina = int(data.player_stamina ?? data.playerStamina, 0, 0);

  const turnNumber = int(data.turn_number ?? data.turnNumber, 1, 1);
  const roundNumber = int(data.round_number ?? data.roundNumber, 1, 1);
  const enemyCount = int(data.enemy_count ?? data.enemyCount, 1, 1);

  const environment = data.environment == null ? null : String(data.environment);
  const weather = data.weather == null ? null : String(data.weather);
  const season = data.season == null ? null : String(data.season);

  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? data.metadata
      : {};

  const client = await requireConn().connect();

  try {
    await client.query("BEGIN");

    // Lock the player row before checking again.
    await client.query(
      `
      SELECT user_id
      FROM rpg_players
      WHERE thread_id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [threadId, userId]
    );

    const lockedExisting = await client.query(
      `
      SELECT *
      FROM rpg_combat_sessions
      WHERE thread_id = $1
        AND user_id = $2
        AND status = 'active'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [threadId, userId]
    );

    if (lockedExisting.rows.length) {
      await client.query("COMMIT");
      return lockedExisting.rows[0];
    }

    const result = await client.query(
      `
      INSERT INTO rpg_combat_sessions(
        thread_id,
        user_id,
        enemy_id,
        enemy_name,
        enemy_hp,
        enemy_max_hp,
        enemy_attack,
        enemy_defense,
        player_hp,
        player_mp,
        player_stamina,
        turn_number,
        round_number,
        status,
        defending,
        environment,
        weather,
        season,
        enemy_count,
        metadata,
        created_at,
        updated_at
      )
      VALUES(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        'active',
        FALSE,
        $14, $15, $16, $17,
        $18::jsonb,
        $19, $19
      )
      RETURNING *
      `,
      [
        threadId,
        userId,
        enemyId,
        enemyName,
        enemyHp,
        enemyMaxHp,
        enemyAttack,
        enemyDefense,
        playerHp,
        playerMp,
        playerStamina,
        turnNumber,
        roundNumber,
        environment,
        weather,
        season,
        enemyCount,
        JSON.stringify(metadata),
        now,
      ]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}

    // A concurrent request may have won the unique
    // active-combat index.
    if (error && error.code === "23505") {
      const winner = await getActiveCombat(threadId, userId);
      if (winner) return winner;
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateCombatSession(combatId, fields = {}) {
  const allowedFields = [
    "enemy_hp",
    "enemy_max_hp",
    "enemy_attack",
    "enemy_defense",
    "player_hp",
    "player_mp",
    "player_stamina",
    "turn_number",
    "round_number",
    "status",
    "defending",
    "environment",
    "weather",
    "season",
    "enemy_count",
    "metadata",
  ];

  const integerFields = [
    "enemy_hp",
    "enemy_max_hp",
    "enemy_attack",
    "enemy_defense",
    "player_hp",
    "player_mp",
    "player_stamina",
    "turn_number",
    "round_number",
    "enemy_count",
  ];

  const safeFields = Object.keys(fields || {}).filter((key) =>
    allowedFields.includes(key)
  );

  if (!safeFields.length) return getCombatById(combatId);

  const values = [];
  const setParts = [];

  for (const key of safeFields) {
    let value = fields[key];

    if (integerFields.includes(key)) {
      value = Math.floor(Number(value) || 0);
    }

    if (key === "defending") {
      value = Boolean(value);
    }

    if (key === "metadata") {
      value =
        value && typeof value === "object"
          ? JSON.stringify(value)
          : "{}";
    }

    values.push(value);
    setParts.push(`${key} = $${values.length + 1}`);
  }

  values.push(Date.now());
  setParts.push(`updated_at = $${values.length + 1}`);

  const { rows } = await requireConn().query(
    `
    UPDATE rpg_combat_sessions
    SET ${setParts.join(", ")}
    WHERE id = $1
    RETURNING *
    `,
    [combatId, ...values]
  );

  return rows[0] || null;
}

async function endCombat(combatId, status = "ended") {
  const allowedStatuses = [
    "ended",
    "victory",
    "defeat",
    "escaped",
    "expired",
    "cancelled",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error(`Invalid combat end status: ${status}`);
  }

  const { rows } = await requireConn().query(
    `
    UPDATE rpg_combat_sessions
    SET status = $2,
        updated_at = $3
    WHERE id = $1
    RETURNING *
    `,
    [combatId, status, Date.now()]
  );

  return rows[0] || null;
}

async function expireCombatSessions(timeoutMs = 30 * 60 * 1000) {
  const cutoff = Date.now() - timeoutMs;

  const { rows } = await requireConn().query(
    `
    UPDATE rpg_combat_sessions
    SET status = 'expired',
        updated_at = $2
    WHERE status = 'active'
      AND updated_at < $1
    RETURNING id, thread_id, user_id
    `,
    [cutoff, Date.now()]
  );

  return rows;
}

// ═══════════════════════════════════════════════════════════
// RPG COMBAT — EFFECTS
// ═══════════════════════════════════════════════════════════

async function insertCombatEffect(data) {
  if (!data) {
    throw new Error("Combat effect data is required.");
  }

  const now = Date.now();

  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? data.metadata
      : {};

  const { rows } = await requireConn().query(
    `
    INSERT INTO rpg_combat_effects(
      thread_id,
      combat_id,
      combat_session_id,
      boss_session_id,
      user_id,
      target_type,
      target_id,
      effect_id,
      stacks,
      remaining_turns,
      magnitude,
      metadata,
      created_at,
      updated_at
    )
    VALUES($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
    RETURNING *
    `,
    [
      String(data.threadId),
      data.combatId ?? null,
      data.bossSessionId ?? null,
      data.userId != null ? String(data.userId) : null,
      data.targetType || "player",
      data.targetId != null ? String(data.targetId) : null,
      String(data.effectId),
      Math.max(1, Math.floor(Number(data.stacks) || 1)),
      Math.max(1, Math.floor(Number(data.remainingTurns) || 1)),
      // magnitude is DOUBLE PRECISION now (0.25, 0.05, 1.3 ...)
      Number(data.magnitude) || 0,
      JSON.stringify(metadata),
      now,
    ]
  );

  return rows[0];
}

async function getCombatEffects(threadId, combatId, targetId = null) {
  const params = [String(threadId), combatId];

  let targetClause = "";

  if (targetId !== null && targetId !== undefined) {
    params.push(String(targetId));
    targetClause = `AND target_id = $3`;
  }

  const { rows } = await requireConn().query(
    `
    SELECT *
    FROM rpg_combat_effects
    WHERE thread_id = $1
      AND (combat_id = $2 OR combat_session_id = $2)
      ${targetClause}
      AND remaining_turns > 0
    ORDER BY id ASC
    `,
    params
  );

  return rows;
}

async function deleteCombatEffect(effectDbId) {
  const { rows } = await requireConn().query(
    `
    DELETE FROM rpg_combat_effects
    WHERE id = $1
    RETURNING *
    `,
    [effectDbId]
  );

  return rows[0] || null;
}

async function clearCombatEffects(threadId, combatId) {
  const { rowCount } = await requireConn().query(
    `
    DELETE FROM rpg_combat_effects
    WHERE thread_id = $1
      AND (combat_id = $2 OR combat_session_id = $2)
    `,
    [String(threadId), combatId]
  );

  return rowCount;
}

async function clearAllCombatEffects(combatId) {
  const { rowCount } = await requireConn().query(
    `
    DELETE FROM rpg_combat_effects
    WHERE combat_id = $1
       OR combat_session_id = $1
    `,
    [combatId]
  );

  return rowCount;
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
      INSERT INTO thread_settings(thread_id, roast_enabled, fun_enabled)
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

async function setThreadSettings(threadId, fields) {
  const conn = requireConn();
  const id = String(threadId);

  await getThreadSettings(id);

  const allowedFields = ["roast_enabled", "fun_enabled"];

  const safeFields = Object.keys(fields || {}).filter((key) =>
    allowedFields.includes(key)
  );

  if (!safeFields.length) {
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

async function isRoastEnabled(threadId) {
  const settings = await getThreadSettings(threadId);
  return settings.roast_enabled === true;
}

async function setRoastEnabled(threadId, enabled) {
  return setThreadSettings(threadId, {
    roast_enabled: Boolean(enabled),
  });
}

async function isGameEnabled(threadId) {
  const settings = await getThreadSettings(threadId);
  return settings.fun_enabled === true;
}

async function setGameEnabled(threadId, enabled) {
  return setThreadSettings(threadId, {
    fun_enabled: Boolean(enabled),
  });
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

  // Legacy Inventory
  addItem,
  getInventory,

  // ECLIPSE RPG — Player
  getRpgPlayer,
  ensureRpgPlayer,
  updateRpgVitals,

  // ECLIPSE RPG — Inventory
  addRpgItem,
  getRpgItemQuantity,
  getRpgInventory,
  consumeRpgItem,

  // ECLIPSE RPG — Combat
  getActiveCombat,
  getCombatById,
  createCombatSession,
  updateCombatSession,
  endCombat,
  expireCombatSessions,

  // ECLIPSE RPG — Combat Effects
  insertCombatEffect,
  getCombatEffects,
  deleteCombatEffect,
  clearCombatEffects,
  clearAllCombatEffects,

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
