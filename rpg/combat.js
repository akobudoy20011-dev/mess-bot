const db = require("../db");
const { getSkill } = require("./classes");
const { getItem } = require("./items");
const {
  addItem,
  addXp,
  consumeItem,
  getPlayer,
  getUserState,
  updateVitals,
} = require("./player");
const {
  box,
  clamp,
  formatNumber,
  randomInt,
  statLine,
} = require("./utils");
const ENEMIES = [
  {
    id: "shadow_beast",
    name: "Shadow Beast",
    emoji: "👹",
    hp: 180,
    attack: 18,
    defense: 8,
    reward: 160,
    xp: 120,
    loot: "moonleaf",
  },
  {
    id: "ironfang_wolf",
    name: "Ironfang Wolf",
    emoji: "🐺",
    hp: 135,
    attack: 22,
    defense: 5,
    reward: 120,
    xp: 95,
    loot: "iron",
  },
  {
    id: "hollow_knight",
    name: "Hollow Knight",
    emoji: "💀",
    hp: 260,
    attack: 28,
    defense: 18,
    reward: 260,
    xp: 220,
    loot: "void_crystal",
  },
  {
    id: "ash_drake",
    name: "Ash Drake",
    emoji: "🐉",
    hp: 420,
    attack: 42,
    defense: 25,
    reward: 550,
    xp: 480,
    loot: "ember_core",
  },
];
function pickEnemy() {
  return ENEMIES[randomInt(0, ENEMIES.length - 1)];
}
async function getCombat(threadID, userID) {
  const result = await db.query(
    `
    SELECT *
    FROM rpg_combat_sessions
    WHERE thread_id = $1
      AND user_id = $2
      AND status = 'active'
    `,
    [String(threadID), String(userID)]
  );
  return result.rows[0] || null;
}
async function createHunt(threadID, userID) {
  const existing = await getCombat(threadID, userID);
  if (existing) {
    throw new Error("You are already in combat. Attack, defend, or use a skill.");
  }
  const state = await getUserState(threadID, userID);
  if (Number(state.player.hp) <= 0 || state.player.status === "dead") {
    throw new Error("You are defeated. Use !rpg rest before hunting again.");
  }
  const enemy = pickEnemy();
  const now = Date.now();
  await db.query(
    `
    INSERT INTO rpg_combat_sessions (
      thread_id, user_id, enemy_id, enemy_name, enemy_hp, enemy_max_hp,
      enemy_attack, enemy_defense, player_hp, player_mp, player_stamina,
      turn_number, status, defending, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, 1, 'active', FALSE, $11, $11)
    `,
    [
      String(threadID),
      String(userID),
      enemy.id,
      enemy.name,
      enemy.hp,
      enemy.attack,
      enemy.defense,
      state.player.hp,
      state.player.mp,
      state.player.stamina,
      now,
    ]
  );
  return { enemy, session: await getCombat(threadID, userID) };
}
function playerDamage(player, enemy, multiplier = 1, magical = false) {
  const offensive = magical ? Number(player.intelligence) : Number(player.strength);
  const defense = Number(enemy.enemy_defense || 0);
  const base = offensive * multiplier + randomInt(4, 12);
  return Math.max(1, Math.round(base - defense * 0.35));
}
function enemyDamage(player, session, defending) {
  const armor = Number(player.defense || 0);
  const mitigation = defending ? armor * 0.75 : armor * 0.35;
  return Math.max(
    1,
    Math.round(Number(session.enemy_attack) + randomInt(-4, 8) - mitigation)
  );
}
async function finishCombat(threadID, userID, session, result) {
  await db.query(
    `
    UPDATE rpg_combat_sessions
    SET status = $3,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
      AND status = 'active'
    `,
    [String(threadID), String(userID), result, Date.now()]
  );
  if (result === "victory") {
    const enemy = ENEMIES.find((item) => item.id === session.enemy_id) || ENEMIES[0];
    await db.addBalance(threadID, userID, enemy.reward);
    await addXp(threadID, userID, enemy.xp);
    await addItem(threadID, userID, enemy.loot, 1);
    await updateVitals(threadID, userID, {
      hp: Math.max(1, Number(session.player_hp)),
      mp: Number(session.player_mp),
      stamina: Number(session.player_stamina),
      status: "active",
    });
    return [
      "🏆 VICTORY",
      `💰 Loot: +${formatNumber(enemy.reward)} coins`,
      `✨ XP: +${formatNumber(enemy.xp)}`,
      `🎁 Item: ${getItem(enemy.loot)?.name || enemy.loot}`,
    ];
  }
  await updateVitals(threadID, userID, {
    hp: 0,
    mp: Number(session.player_mp),
    stamina: Number(session.player_stamina),
    status: "dead",
  });
  return [
    "💀 DEFEAT",
    "Your character fell in battle.",
    "Use !rpg rest to recover before entering another fight.",
  ];
}
async function combatAction(threadID, userID, action, argument = "") {
  const session = await getCombat(threadID, userID);
  if (!session) {
    throw new Error("You are not currently in combat. Try !rpg hunt.");
  }
  const state = await getUserState(threadID, userID);
  let playerHp = Number(session.player_hp);
  let playerMp = Number(session.player_mp);
  let stamina = Number(session.player_stamina);
  let enemyHp = Number(session.enemy_hp);
  let defending = false;
  let message = [];
  const skill = action === "skill" ? getSkill(argument) : null;
  if (action === "attack") {
    const damage = playerDamage(state.player, session);
    enemyHp = Math.max(0, enemyHp - damage);
    message = [`⚔️ You strike for ${damage} damage.`];
  } else if (action === "defend") {
    defending = true;
    stamina = Math.min(Number(state.player.max_stamina), stamina + 12);
    message = ["🛡️ You brace for the next attack and recover stamina."];
  } else if (action === "skill") {
    if (!skill) throw new Error("That skill is not available.");
    if (playerMp < skill.cost) throw new Error("Not enough mana.");
    if (stamina < skill.stamina) throw new Error("Not enough stamina.");
    playerMp -= skill.cost;
    stamina -= skill.stamina;
    if (skill.effect === "guard" || skill.effect === "dodge") {
      defending = true;
      message = [`${skill.emoji} ${skill.name} activated.`];
    } else {
      const magical = skill.effect === "magic";
      const damage = playerDamage(
        state.player,
        session,
        skill.multiplier,
        magical
      );
      enemyHp = Math.max(0, enemyHp - damage);
      message = [`${skill.emoji} ${skill.name} deals ${damage} damage.`];
      if (skill.effect === "heal_damage" || skill.effect === "guard_heal") {
        const healing = skill.effect === "guard_heal" ? 35 : 18;
        playerHp = Math.min(Number(state.player.max_hp), playerHp + healing);
        message.push(`✨ Restored ${healing} HP.`);
      }
    }
  } else if (action === "item") {
    const item = getItem(argument);
    if (!item || item.type !== "consumable") {
      throw new Error("Use a consumable item such as minor_potion or mana_potion.");
    }
    await consumeItem(threadID, userID, item.id);
    playerHp = Math.min(
      Number(state.player.max_hp),
      playerHp + Number(item.effect?.hp || 0)
    );
    playerMp = Math.min(
      Number(state.player.max_mp),
      playerMp + Number(item.effect?.mp || 0)
    );
    message = [`${item.emoji} Used ${item.name}.`];
  } else {
    throw new Error("Choose attack, skill, defend, or item.");
  }
  if (enemyHp <= 0) {
    const rewards = await finishCombat(threadID, userID, {
      ...session,
      player_hp: playerHp,
      player_mp: playerMp,
      player_stamina: stamina,
      enemy_hp: enemyHp,
    }, "victory");
    return { result: "victory", message: message.concat(rewards) };
  }
  const incoming = enemyDamage(state.player, session, defending);
  playerHp = Math.max(0, playerHp - incoming);
  message.push(
    `👹 ${session.enemy_name} hits you for ${incoming} damage.`
  );
  const nextTurn = Number(session.turn_number) + 1;
  await db.query(
    `
    UPDATE rpg_combat_sessions
    SET enemy_hp = $3,
        player_hp = $4,
        player_mp = $5,
        player_stamina = $6,
        turn_number = $7,
        defending = $8,
        updated_at = $9
    WHERE thread_id = $1
      AND user_id = $2
      AND status = 'active'
    `,
    [
      String(threadID),
      String(userID),
      enemyHp,
      playerHp,
      playerMp,
      stamina,
      nextTurn,
      defending,
      Date.now(),
    ]
  );
  await updateVitals(threadID, userID, {
    hp: playerHp,
    mp: playerMp,
    stamina,
  });
  if (playerHp <= 0) {
    const rewards = await finishCombat(
      threadID,
      userID,
      {
        ...session,
        player_hp: playerHp,
        player_mp: playerMp,
        player_stamina: stamina,
        enemy_hp: enemyHp,
      },
      "defeat"
    );
    return { result: "defeat", message: message.concat(rewards) };
  }
  return { result: "active", message };
}
function renderCombat(session, player, message = []) {
  return box("⚔️ BATTLE", [
    `👤 ${player.character_class}`,
    statLine("❤️", "HP", session.player_hp, player.max_hp),
    statLine("🔷", "MP", session.player_mp, player.max_mp),
    statLine("⚡", "STA", session.player_stamina, player.max_stamina),
    "",
    `👹 ${session.enemy_name}`,
    statLine("❤️", "HP", session.enemy_hp, session.enemy_max_hp),
    "",
    `⚔️ Turn ${session.turn_number}`,
    ...message,
    "",
    "Commands: !rpg attack · !rpg skill <skill> · !rpg defend",
    "!rpg item <minor_potion|mana_potion>",
  ]);
}
module.exports = {
  ENEMIES,
  combatAction,
  createHunt,
  getCombat,
  renderCombat,
};
