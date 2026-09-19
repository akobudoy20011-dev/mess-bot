"use strict";

const db = require("../db");

const {
  grantStartingSpells,
} = require("./spells");

const {
  getClass,
  getClassKey,
  getSkillsForClass,
} = require("./classes");

const {
  initializeClassAffinity,
  getPrimaryAffinity,
} = require("./affinities");

const { getItem } = require("./items");
const { REGIONS, resolveLocation } = require("./world");

// ============================================================
// HELPERS
// ============================================================

function normalizeID(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ============================================================
// ENSURE PLAYER
// ============================================================

async function ensurePlayer(threadID, userID) {
  const threadId = String(threadID);
  const userId = String(userID);
  const now = Date.now();

  // Make sure the global user exists first.
  await db.getUser(threadId, userId);

  const existing = await db.query(
    `
    SELECT *
    FROM rpg_players
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadId, userId]
  );

  // ----------------------------------------------------------
  // CREATE PLAYER
  // ----------------------------------------------------------

  if (existing.rows.length === 0) {
    const definition = getClass("knight");

    if (!definition || !definition.base) {
      throw new Error("Default RPG class 'knight' is not configured.");
    }

    const base = definition.base;

    await db.query(
      `
      INSERT INTO rpg_players (
        thread_id,
        user_id,
        character_class,
        region_id,
        location_id,
        property_tier,
        property_name,
        hp,
        max_hp,
        mp,
        max_mp,
        stamina,
        max_stamina,
        strength,
        defense,
        agility,
        intelligence,
        vitality,
        luck,
        reputation,
        renown,
        status,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'knight',
        'greenvale',
        'eclipse_castle',
        0,
        NULL,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        0,
        0,
        'active',
        $15,
        $15
      )
      ON CONFLICT (thread_id, user_id) DO NOTHING
      `,
      [
        threadId,
        userId,

        base.maxHp,
        base.maxHp,

        base.maxMp,
        base.maxMp,

        base.maxStamina,
        base.maxStamina,

        base.strength,
        base.defense,
        base.agility,
        base.intelligence,
        base.vitality,
        base.luck,

        now,
      ]
    );
  }

  // ----------------------------------------------------------
  // ENSURE ARMY
  // ----------------------------------------------------------

  await db.query(
    `
    INSERT INTO rpg_armies (
      thread_id,
      user_id,
      region_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'greenvale', $3, $3)
    ON CONFLICT (thread_id, user_id) DO NOTHING
    `,
    [threadId, userId, now]
  );

  // ----------------------------------------------------------
  // GET CURRENT PLAYER
  // ----------------------------------------------------------

  const player = await getPlayer(threadId, userId);

  if (!player) {
    throw new Error("Failed to initialize RPG player.");
  }

  // ----------------------------------------------------------
  // ENSURE CLASS SKILLS
  // ----------------------------------------------------------

  const skills = getSkillsForClass(player.character_class);

  for (const skill of skills) {
    if (!skill || !skill.id) continue;

    await db.query(
      `
      INSERT INTO rpg_player_skills (
        thread_id,
        user_id,
        skill_id,
        level,
        unlocked,
        updated_at
      )
      VALUES ($1, $2, $3, 1, TRUE, $4)
      ON CONFLICT (thread_id, user_id, skill_id) DO NOTHING
      `,
      [
        threadId,
        userId,
        String(skill.id),
        now,
      ]
    );
  }

  // ----------------------------------------------------------
  // STARTING SPELLS
  //
  // grantStartingSpells() handles the fact that
  // getStartingSpells() returns spell objects rather than
  // plain IDs.
  // ----------------------------------------------------------

  try {
    await grantStartingSpells(
      threadId,
      userId,
      player.character_class
    );
  } catch (error) {
    console.error(
      "[RPG] starting spell initialization failed:",
      error.message
    );
  }

  // ----------------------------------------------------------
  // PRIMARY AFFINITY
  // ----------------------------------------------------------

  try {
    const primary = await getPrimaryAffinity(
      threadId,
      userId
    );

    if (!primary) {
      await initializeClassAffinity(
        threadId,
        userId,
        player.character_class
      );
    }
  } catch (error) {
    console.error(
      "[RPG] affinity init failed:",
      error.message
    );
  }

  // ----------------------------------------------------------
  // STARTING INVENTORY
  // ----------------------------------------------------------

  await db.query(
    `
    INSERT INTO rpg_inventory_items (
      thread_id,
      user_id,
      item_id,
      quantity,
      updated_at
    )
    VALUES ($1, $2, 'minor_potion', 2, $3)
    ON CONFLICT (thread_id, user_id, item_id) DO NOTHING
    `,
    [
      threadId,
      userId,
      now,
    ]
  );

  return getPlayer(threadId, userId);
}

// ============================================================
// GET PLAYER
// ============================================================

async function getPlayer(threadID, userID) {
  const result = await db.query(
    `
    SELECT *
    FROM rpg_players
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
    ]
  );

  return result.rows[0] || null;
}

// ============================================================
// GET USER STATE
// ============================================================

async function getUserState(threadID, userID) {
  const player = await ensurePlayer(
    threadID,
    userID
  );

  const user = await db.getUser(
    threadID,
    userID
  );

  const skills = await db.query(
    `
    SELECT
      skill_id,
      level,
      unlocked
    FROM rpg_player_skills
    WHERE thread_id = $1
      AND user_id = $2
      AND unlocked = TRUE
    ORDER BY skill_id
    `,
    [
      String(threadID),
      String(userID),
    ]
  );

  const inventory = await getInventory(
    threadID,
    userID
  );

  const equipment = await getEquipment(
    threadID,
    userID
  );

  return {
    player,
    user,
    skills: skills.rows,
    inventory,
    equipment,
  };
}

// ============================================================
// SET CLASS
// ============================================================

async function setClass(threadID, userID, className) {
  const threadId = String(threadID);
  const userId = String(userID);

  const key = getClassKey(className);
  const definition = getClass(key);

  if (!definition || !definition.base) {
    throw new Error(
      `Unknown RPG class: ${className}`
    );
  }

  const base = definition.base;

  // Make sure player exists first.
  await ensurePlayer(
    threadId,
    userId
  );

  const now = Date.now();

  // ----------------------------------------------------------
  // UPDATE PLAYER BASE STATS
  // ----------------------------------------------------------

  await db.query(
    `
    UPDATE rpg_players
    SET
      character_class = $3,
      subclass = NULL,

      hp = LEAST(hp, $4),
      max_hp = $4,

      mp = LEAST(mp, $5),
      max_mp = $5,

      stamina = LEAST(stamina, $6),
      max_stamina = $6,

      strength = $7,
      defense = $8,
      agility = $9,
      intelligence = $10,
      vitality = $11,
      luck = $12,

      updated_at = $13
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      threadId,
      userId,
      key,

      base.maxHp,
      base.maxMp,
      base.maxStamina,

      base.strength,
      base.defense,
      base.agility,
      base.intelligence,
      base.vitality,
      base.luck,

      now,
    ]
  );

  // ----------------------------------------------------------
  // RESET CLASS SKILLS
  // ----------------------------------------------------------

  const skills = getSkillsForClass(key);

  await db.query(
    `
    DELETE FROM rpg_player_skills
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      threadId,
      userId,
    ]
  );

  for (const skill of skills) {
    if (!skill || !skill.id) continue;

    await db.query(
      `
      INSERT INTO rpg_player_skills (
        thread_id,
        user_id,
        skill_id,
        level,
        unlocked,
        updated_at
      )
      VALUES ($1, $2, $3, 1, TRUE, $4)
      `,
      [
        threadId,
        userId,
        String(skill.id),
        Date.now(),
      ]
    );
  }

  // ----------------------------------------------------------
  // GRANT NEW CLASS STARTING SPELLS
  // ----------------------------------------------------------

  try {
    await grantStartingSpells(
      threadId,
      userId,
      key
    );
  } catch (error) {
    console.error(
      "[RPG] class starting spell initialization failed:",
      error.message
    );
  }

  // ----------------------------------------------------------
  // RESET / INITIALIZE CLASS AFFINITY
  // ----------------------------------------------------------

  try {
    await initializeClassAffinity(
      threadId,
      userId,
      key
    );
  } catch (error) {
    console.error(
      "[RPG] affinity init failed:",
      error.message
    );
  }

  return getPlayer(
    threadId,
    userId
  );
}

// ============================================================
// ADD XP
// ============================================================

async function addXp(threadID, userID, amount) {
  const result = await db.addXP(
    threadID,
    userID,
    amount
  );

  await db.query(
    `
    UPDATE rpg_players
    SET
      renown = renown + $3,
      updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      Math.max(
        0,
        Math.floor(
          safeNumber(amount) / 10
        )
      ),
      Date.now(),
    ]
  );

  return result;
}

// ============================================================
// ADD REPUTATION
// ============================================================

async function addReputation(
  threadID,
  userID,
  amount
) {
  await db.query(
    `
    UPDATE rpg_players
    SET
      reputation = reputation + $3,
      updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      Math.trunc(
        safeNumber(amount)
      ),
      Date.now(),
    ]
  );

  return getPlayer(
    threadID,
    userID
  );
}

// ============================================================
// UPDATE VITALS / LOCATION
// ============================================================

async function updateVitals(
  threadID,
  userID,
  fields
) {
  if (!fields || typeof fields !== "object") {
    return getPlayer(
      threadID,
      userID
    );
  }

  const allowed = [
    "hp",
    "mp",
    "stamina",
    "status",
    "location_id",
    "region_id",
  ];

  const keys = Object.keys(fields).filter(
    (key) => allowed.includes(key)
  );

  if (keys.length === 0) {
    return getPlayer(
      threadID,
      userID
    );
  }

  const assignments = keys
    .map(
      (key, index) =>
        `${key} = $${index + 3}`
    )
    .join(", ");

  await db.query(
    `
    UPDATE rpg_players
    SET
      ${assignments},
      updated_at = $${keys.length + 3}
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),

      ...keys.map(
        (key) => fields[key]
      ),

      Date.now(),
    ]
  );

  return getPlayer(
    threadID,
    userID
  );
}

// ============================================================
// INVENTORY
// ============================================================

async function getInventory(
  threadID,
  userID
) {
  const result = await db.query(
    `
    SELECT
      item_id,
      quantity
    FROM rpg_inventory_items
    WHERE thread_id = $1
      AND user_id = $2
      AND quantity > 0
    ORDER BY item_id
    `,
    [
      String(threadID),
      String(userID),
    ]
  );

  return result.rows.map(
    (row) => ({
      ...row,
      item: getItem(row.item_id),
    })
  );
}

// ============================================================
// ADD ITEM
// ============================================================

async function addItem(
  threadID,
  userID,
  itemID,
  quantity = 1
) {
  await ensurePlayer(
    threadID,
    userID
  );

  const amount = Math.max(
    1,
    Math.floor(
      safeNumber(quantity, 1)
    )
  );

  await db.query(
    `
    INSERT INTO rpg_inventory_items (
      thread_id,
      user_id,
      item_id,
      quantity,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (thread_id, user_id, item_id)
    DO UPDATE SET
      quantity =
        rpg_inventory_items.quantity
        + EXCLUDED.quantity,
      updated_at = EXCLUDED.updated_at
    `,
    [
      String(threadID),
      String(userID),
      String(itemID),
      amount,
      Date.now(),
    ]
  );
}

// ============================================================
// CONSUME ITEM
// ============================================================

async function consumeItem(
  threadID,
  userID,
  itemID
) {
  const result = await db.query(
    `
    UPDATE rpg_inventory_items
    SET
      quantity = quantity - 1,
      updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
      AND item_id = $3
      AND quantity > 0
    RETURNING quantity
    `,
    [
      String(threadID),
      String(userID),
      String(itemID),
      Date.now(),
    ]
  );

  if (result.rows.length === 0) {
    throw new Error(
      "You do not have that item."
    );
  }

  return result.rows[0];
}

// ============================================================
// EQUIPMENT
// ============================================================

async function getEquipment(
  threadID,
  userID
) {
  const result = await db.query(
    `
    SELECT
      slot,
      item_id
    FROM rpg_equipment
    WHERE thread_id = $1
      AND user_id = $2
    ORDER BY slot
    `,
    [
      String(threadID),
      String(userID),
    ]
  );

  return result.rows.map(
    (row) => ({
      ...row,
      item: getItem(row.item_id),
    })
  );
}

// ============================================================
// EQUIP ITEM
// ============================================================

async function equipItem(
  threadID,
  userID,
  slot,
  itemID
) {
  const item = getItem(itemID);

  if (
    !item ||
    !["weapon", "armor"].includes(
      normalizeID(item.type)
    )
  ) {
    throw new Error(
      "That item cannot be equipped."
    );
  }

  await consumeItem(
    threadID,
    userID,
    itemID
  );

  await db.query(
    `
    INSERT INTO rpg_equipment (
      thread_id,
      user_id,
      slot,
      item_id,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (thread_id, user_id, slot)
    DO UPDATE SET
      item_id = EXCLUDED.item_id,
      updated_at = EXCLUDED.updated_at
    `,
    [
      String(threadID),
      String(userID),
      String(slot),
      String(itemID),
      Date.now(),
    ]
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  addItem,
  addXp,
  addReputation,
  consumeItem,
  ensurePlayer,
  equipItem,
  getEquipment,
  getInventory,
  getPlayer,
  getUserState,
  setClass,
  updateVitals,
};
