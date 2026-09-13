const db = require("../db");
const { getClass, getClassKey, getSkillsForClass } = require("./classes");
const { getItem } = require("./items");
const { REGIONS, resolveLocation } = require("./world");
async function ensurePlayer(threadID, userID) {
  const threadId = String(threadID);
  const userId = String(userID);
  const now = Date.now();
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
  if (existing.rows.length === 0) {
    const definition = getClass("knight");
    const base = definition.base;
    await db.query(
      `
      INSERT INTO rpg_players (
        thread_id, user_id, character_class, region_id, location_id,
        property_tier, property_name, hp, max_hp, mp, max_mp,
        stamina, max_stamina, strength, defense, agility,
        intelligence, vitality, luck, reputation, renown,
        status, created_at, updated_at
      )
      VALUES (
        $1, $2, 'knight', 'greenvale', 'eclipse_castle',
        0, NULL, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, 0, 0,
        'active', $15, $15
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
  await db.query(
    `
    INSERT INTO rpg_armies (
      thread_id, user_id, region_id, created_at, updated_at
    )
    VALUES ($1, $2, 'greenvale', $3, $3)
    ON CONFLICT (thread_id, user_id) DO NOTHING
    `,
    [threadId, userId, now]
  );
  const player = await getPlayer(threadId, userId);
  const skills = getSkillsForClass(player.character_class);
  for (const skill of skills) {
    await db.query(
      `
      INSERT INTO rpg_player_skills (
        thread_id, user_id, skill_id, level, unlocked, updated_at
      )
      VALUES ($1, $2, $3, 1, TRUE, $4)
      ON CONFLICT (thread_id, user_id, skill_id) DO NOTHING
      `,
      [threadId, userId, skill.id, now]
    );
  }
  await db.query(
    `
    INSERT INTO rpg_inventory_items (
      thread_id, user_id, item_id, quantity, updated_at
    )
    VALUES ($1, $2, 'minor_potion', 2, $3)
    ON CONFLICT (thread_id, user_id, item_id) DO NOTHING
    `,
    [threadId, userId, now]
  );
  return player;
}
async function getPlayer(threadID, userID) {
  const result = await db.query(
    `
    SELECT *
    FROM rpg_players
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID)]
  );
  return result.rows[0] || null;
}
async function getUserState(threadID, userID) {
  const player = await ensurePlayer(threadID, userID);
  const user = await db.getUser(threadID, userID);
  const skills = await db.query(
    `
    SELECT skill_id, level, unlocked
    FROM rpg_player_skills
    WHERE thread_id = $1
      AND user_id = $2
      AND unlocked = TRUE
    ORDER BY skill_id
    `,
    [String(threadID), String(userID)]
  );
  const inventory = await getInventory(threadID, userID);
  const equipment = await getEquipment(threadID, userID);
  return {
    player,
    user,
    skills: skills.rows,
    inventory,
    equipment,
  };
}
async function setClass(threadID, userID, className) {
  const key = getClassKey(className);
  const definition = getClass(key);
  const base = definition.base;
  await ensurePlayer(threadID, userID);
  await db.query(
    `
    UPDATE rpg_players
    SET character_class = $3,
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
      String(threadID),
      String(userID),
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
      Date.now(),
    ]
  );
  const skills = getSkillsForClass(key);
  await db.query(
    `
    DELETE FROM rpg_player_skills
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID)]
  );
  for (const skill of skills) {
    await db.query(
      `
      INSERT INTO rpg_player_skills (
        thread_id, user_id, skill_id, level, unlocked, updated_at
      )
      VALUES ($1, $2, $3, 1, TRUE, $4)
      `,
      [String(threadID), String(userID), skill.id, Date.now()]
    );
  }
  return getPlayer(threadID, userID);
}
async function addXp(threadID, userID, amount) {
  const result = await db.addXP(threadID, userID, amount);
  await db.query(
    `
    UPDATE rpg_players
    SET renown = renown + $3,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID), Math.max(0, Math.floor(Number(amount) / 10)), Date.now()]
  );
  return result;
}
async function updateVitals(threadID, userID, fields) {
  const allowed = [
    "hp",
    "mp",
    "stamina",
    "status",
    "location_id",
    "region_id",
  ];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key));
  if (keys.length === 0) return getPlayer(threadID, userID);
  const assignments = keys
    .map((key, index) => `${key} = $${index + 3}`)
    .join(", ");
  await db.query(
    `
    UPDATE rpg_players
    SET ${assignments},
        updated_at = $${keys.length + 3}
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      ...keys.map((key) => fields[key]),
      Date.now(),
    ]
  );
  return getPlayer(threadID, userID);
}
async function getInventory(threadID, userID) {
  const result = await db.query(
    `
    SELECT item_id, quantity
    FROM rpg_inventory_items
    WHERE thread_id = $1
      AND user_id = $2
      AND quantity > 0
    ORDER BY item_id
    `,
    [String(threadID), String(userID)]
  );
  return result.rows.map((row) => ({
    ...row,
    item: getItem(row.item_id),
  }));
}
async function addItem(threadID, userID, itemID, quantity = 1) {
  await ensurePlayer(threadID, userID);
  await db.query(
    `
    INSERT INTO rpg_inventory_items (
      thread_id, user_id, item_id, quantity, updated_at
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (thread_id, user_id, item_id)
    DO UPDATE SET quantity = rpg_inventory_items.quantity + EXCLUDED.quantity,
                  updated_at = EXCLUDED.updated_at
    `,
    [
      String(threadID),
      String(userID),
      String(itemID),
      Math.max(1, Math.floor(Number(quantity))),
      Date.now(),
    ]
  );
}
async function consumeItem(threadID, userID, itemID) {
  const result = await db.query(
    `
    UPDATE rpg_inventory_items
    SET quantity = quantity - 1,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
      AND item_id = $3
      AND quantity > 0
    RETURNING quantity
    `,
    [String(threadID), String(userID), String(itemID), Date.now()]
  );
  if (result.rows.length === 0) {
    throw new Error("You do not have that item.");
  }
  return result.rows[0];
}
async function getEquipment(threadID, userID) {
  const result = await db.query(
    `
    SELECT slot, item_id
    FROM rpg_equipment
    WHERE thread_id = $1
      AND user_id = $2
    ORDER BY slot
    `,
    [String(threadID), String(userID)]
  );
  return result.rows.map((row) => ({ ...row, item: getItem(row.item_id) }));
}
async function equipItem(threadID, userID, slot, itemID) {
  const item = getItem(itemID);
  if (!item || !["weapon", "armor"].includes(item.type)) {
    throw new Error("That item cannot be equipped.");
  }
  await consumeItem(threadID, userID, itemID);
  await db.query(
    `
    INSERT INTO rpg_equipment (
      thread_id, user_id, slot, item_id, updated_at
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (thread_id, user_id, slot)
    DO UPDATE SET item_id = EXCLUDED.item_id,
                  updated_at = EXCLUDED.updated_at
    `,
    [String(threadID), String(userID), String(slot), itemID, Date.now()]
  );
}
module.exports = {
  addItem,
  addXp,
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
