const { reply } = require("../util");
const {
  CLASSES,
  getClass,
  getClassKey,
  getSkillsForClass,
} = require("./classes");
const {
  ensurePlayer,
  getUserState,
  setClass,
  updateVitals,
} = require("./player");
const { getItem } = require("./items");
const {
  combatAction,
  createHunt,
  getCombat,
  renderCombat,
} = require("./combat");
const {
  getArmy,
  getRegiments,
  setFormation,
  train,
  FORMATIONS,
} = require("./army");
const {
  getBuildings,
  getProperty,
  improveDefense,
  build,
  buyProperty,
  propertySummary,
  propertyTier,
  DEFENSE_PARTS,
} = require("./properties");
const {
  marchStatus,
  marchSummary,
  startMarch,
} = require("./marches");
const {
  LOCATIONS,
  REGIONS,
  locationsInRegion,
  resolveRegion,
} = require("./world");
const {
  advanceDungeon,
  claimQuest,
  enterDungeon,
  getDungeon,
  getQuest,
  questSummary,
  registerHuntProgress,
} = require("./adventure");
const {
  box,
  errorBox,
  formatDuration,
  formatNumber,
  normalizeKey,
  statLine,
  totalUnits,
} = require("./utils");

function playerName(state) {
  return state.user.display_name || "Player " + state.user.user_id;
}

function classLine(player) {
  const definition = getClass(player.character_class);
  return definition.emoji + " " + definition.name;
}

function xpForNextLevel(level) {
  return Math.max(100, Number(level || 1) * 100);
}

function profileText(state, property) {
  const player = state.player;
  const level = Number(state.user.level || 1);
  const xp = Number(state.user.xp || 0);
  const nextXp = xpForNextLevel(level);
  const tier = propertyTier(player.property_tier);
  return box("🌑 ECLIPSE PROFILE", [
    "👤 " + playerName(state),
    classLine(player) + " · Level " + level,
    statLine("✨", "XP", xp % nextXp, nextXp),
    statLine("❤️", "HP", player.hp, player.max_hp),
    statLine("🔷", "MP", player.mp, player.max_mp),
    statLine("⚡", "STA", player.stamina, player.max_stamina),
    "",
    "⚔️ STR " + player.strength + " · 🛡️ DEF " + player.defense,
    "🏃 AGI " + player.agility + " · 🧠 INT " + player.intelligence,
    "🍀 LUCK " + player.luck + " · ✨ Renown " + player.renown,
    "",
    "🗺️ " + (REGIONS[player.region_id]?.emoji || "🗺️") + " " + (REGIONS[player.region_id]?.name || player.region_id),
    "📍 Location: " + (player.location_id || "unknown"),
    "🏰 Domain: " + tier.name,
    "💰 Wallet: " + formatNumber(state.user.balance) + " coins",
  ]);
}

async function send(api, threadID, text) {
  await reply(api, threadID, text);
}

async function handleProfile(api, event) {
  const state = await getUserState(event.threadID, event.senderID);
  const property = await getProperty(event.threadID, event.senderID);
  await send(api, event.threadID, profileText(state, property));
}

async function handleClass(api, event, args) {
  if (!args[0]) {
    const lines = Object.entries(CLASSES).map(([key, definition]) =>
      definition.emoji + " " + key + " — " + definition.style
    );
    await send(api, event.threadID, box("⚔️ CLASSES", lines.concat(["Use !rpg class <name> to choose."])));
    return;
  }
  const key = getClassKey(args[0]);
  const definition = getClass(key);
  await setClass(event.threadID, event.senderID, key);
  await send(api, event.threadID, box("⚔️ CLASS CHOSEN", [
    definition.emoji + " " + definition.name,
    definition.style,
    "Strengths: " + definition.strengths,
    "Weaknesses: " + definition.weaknesses,
    "Skills: " + definition.skills.join(", "),
  ]));
}

async function handleSkills(api, event) {
  const state = await getUserState(event.threadID, event.senderID);
  const skills = getSkillsForClass(state.player.character_class);
  await send(api, event.threadID, box("✨ SKILLS", skills.map((skill) =>
    skill.emoji + " " + skill.name + " — MP " + skill.cost + " · STA " + skill.stamina + "\n" + skill.effect
  )));
}

async function handleInventory(api, event) {
  const state = await getUserState(event.threadID, event.senderID);
  const lines = state.inventory.length
    ? state.inventory.map((entry) => (entry.item?.emoji || "🎁") + " " + (entry.item?.name || entry.item_id) + " x" + entry.quantity + " · " + (entry.item?.rarity || "Unknown"))
    : ["Your inventory is empty."];
  await send(api, event.threadID, box("🎒 INVENTORY", lines));
}

async function handleEquipment(api, event) {
  const state = await getUserState(event.threadID, event.senderID);
  const lines = state.equipment.length
    ? state.equipment.map((entry) => "🧩 " + entry.slot + ": " + (entry.item?.name || entry.item_id))
    : ["No equipment equipped yet."];
  await send(api, event.threadID, box("🛡️ EQUIPMENT", lines));
}

async function handleMap(api, event, args) {
  if (args[0] && normalizeKey(args[0]) === "locations") {
    args = args.slice(1);
  }
  const region = args.length ? resolveRegion(args.join(" ")) : null;
  if (region) {
    const locations = locationsInRegion(region.id);
    await send(api, event.threadID, box(region.emoji + " " + region.name, [
      "Terrain: " + region.terrain,
      "Resources: " + region.resources.join(", "),
      "",
    ].concat(locations.map((location) => "📍 " + location.name + " (" + location.id + ")"))));
    return;
  }
  await send(api, event.threadID, box("🗺️ ECLIPSE WORLD", Object.entries(REGIONS).map(([key, region]) =>
    region.emoji + " " + region.name + " — " + region.terrain + " (" + key + ")"
  ).concat(["Use !rpg locations <region> to inspect locations."])));
}

async function handleProperty(api, event, args) {
  const threadID = event.threadID;
  const userID = event.senderID;
  await ensurePlayer(threadID, userID);
  args = Array.isArray(args) ? args : [];
  const userID = event.senderID;
  const action = normalizeKey(args[0] || "info");
  if (action === "buy") {
    const target = normalizeKey(args[1]);
    const result = await buyProperty(threadID, userID, target);
    await send(api, threadID, box("🏰 DOMAIN EXPANDED", [
      "You now control a " + result.name + ".",
      "💰 Cost: " + formatNumber(result.cost) + " coins",
      "Use !rpg build farm or !rpg defense walls to develop it.",
    ]));
    return;
  }
  if (action === "build") {
    const result = await build(threadID, userID, args[1]);
    await send(api, threadID, box("🏗️ BUILDING UPGRADED", [
      result.definition.emoji + " " + result.definition.name + " level " + result.level,
      "💰 Cost: " + formatNumber(result.cost) + " coins",
    ]));
    return;
  }
  if (action === "defense") {
    const result = await improveDefense(threadID, userID, args[1]);
    await send(api, threadID, box("🛡️ DEFENSE IMPROVED", [
      result.definition.emoji + " " + result.definition.name + ": " + result.level + "%",
      "💰 Cost: " + formatNumber(result.cost) + " coins",
    ]));
    return;
  }
  const property = await getProperty(threadID, userID);
  const summary = propertySummary(property);
  const buildings = await getBuildings(threadID, userID);
  const buildingLines = buildings.length
    ? buildings.map((entry) => "🏗️ " + entry.building_key + " Lv." + entry.level)
    : ["No buildings yet."];
  await send(api, threadID, box("🏰 PROPERTY", [
    "Tier: " + summary.tier.name,
    "Maintenance: " + summary.maintenanceText,
    "",
  ].concat(Object.entries(summary.defense).map(([key, value]) =>
    (DEFENSE_PARTS[key]?.emoji || "🛡️") + " " + key + " " + value + "%"
  ), ["", "Buildings:"], buildingLines, ["", "Next: !rpg property buy " + (propertyTier(Number(property.tier) + 1).key || "empire")])));
}

async function handleArmy(api, event, args) {
  const threadID = event.threadID;
  const userID = event.senderID;
  await ensurePlayer(threadID, userID);
  if (args[0] && normalizeKey(args[0]) === "train") {
    const result = await train(threadID, userID, args[1], args[2]);
    await send(api, threadID, box("⚔️ TRAINING COMPLETE", [
      result.unit.emoji + " " + result.unit.name + ": +" + formatNumber(result.count),
      "💰 Cost: " + formatNumber(result.cost) + " coins",
    ]));
    return;
  }
  if (args[0] && normalizeKey(args[0]) === "formation") {
    if (!args[1]) {
      await send(api, threadID, box("⚔️ FORMATIONS", Object.entries(FORMATIONS).map(([key, value]) => value.emoji + " " + key + " — attack " + value.attack + " · defense " + value.defense)));
      return;
    }
    const result = await setFormation(threadID, userID, args[1]);
    await send(api, threadID, box("⚔️ FORMATION SET", [result.emoji + " " + result.name, "Attack modifier: " + result.attack, "Defense modifier: " + result.defense]));
    return;
  }
  if (args[0] && normalizeKey(args[0]) === "regiment") {
    if (normalizeKey(args[1]) === "create") {
      const result = await require("./army").createRegiment(threadID, userID, args[2], args[3], args[4]);
      await send(api, threadID, box("🪖 REGIMENT FORMED", [result.name, result.unit_type + " x" + result.count, "Tier: " + result.experience_tier]));
      return;
    }
    const regiments = await getRegiments(threadID, userID);
    await send(api, threadID, box("🪖 REGIMENTS", regiments.length ? regiments.map((entry) => entry.name + " — " + entry.unit_type + " x" + entry.count) : ["No regiments formed yet."]));
    return;
  }
  const army = await getArmy(threadID, userID);
  const unitLines = ["⚔️ Infantry: " + formatNumber(army.infantry), "🔱 Spearmen: " + formatNumber(army.spearmen), "🛡️ Heavy Swordsmen: " + formatNumber(army.heavy_swordsmen), "🏹 Archers: " + formatNumber(army.archers), "🐎 Cavalry: " + formatNumber(army.cavalry), "🔷 Mages: " + formatNumber(army.mages), "🗡️ Assassins: " + formatNumber(army.assassins), "🛡️ Shielders: " + formatNumber(army.shielders)];
  await send(api, threadID, box("⚔️ ARMY", [
    "👥 Total troops: " + formatNumber(totalUnits(army)),
    "📍 Region: " + army.region_id,
    "⚔️ Formation: " + army.formation,
    "📦 Supplies: " + army.supplies + "%",
    "",
  ].concat(unitLines, ["", "Use !rpg army train <unit> <amount>."])));
}

async function handleMarch(api, event, args) {
  await ensurePlayer(event.threadID, event.senderID);
  const action = normalizeKey(args[0] || "status");
  if (action === "status") {
    const status = await marchStatus(event.threadID, event.senderID);
    await send(api, event.threadID, box("🚶 MARCH", marchSummary(status).lines));
    return;
  }
  const result = await startMarch(event.threadID, event.senderID, args.join(" "));
  await send(api, event.threadID, box("🚶 ARMY MARCH", [
    "📍 " + (result.origin.name || result.origin.id) + " → " + (result.destination.name || result.destination.id),
    "🛤️ Distance: " + result.distance + " map steps",
    "⏳ Travel time: " + formatDuration(result.duration),
    "👥 Army: " + formatNumber(result.armySize) + " soldiers",
    "⏱️ Maximum travel time: 2 minutes",
  ]));
}

async function handleCombat(api, event, action, args) {
  const threadID = event.threadID;
  const userID = event.senderID;
  if (action === "hunt") {
    const result = await createHunt(threadID, userID);
    const state = await getUserState(threadID, userID);
    await send(api, threadID, renderCombat(result.session, state.player));
    return;
  }
  const result = await combatAction(threadID, userID, action, args.join(" "));
  if (result.result === "active") {
    const session = await getCombat(threadID, userID);
    const state = await getUserState(threadID, userID);
    await send(api, threadID, renderCombat(session, state.player, result.message));
    return;
  }
  if (action === "attack" || action === "skill" || action === "item" || action === "defend") {
    if (result.result === "victory") await registerHuntProgress(threadID, userID);
  }
  await send(api, threadID, box(result.result === "victory" ? "🏆 VICTORY" : "💀 DEFEAT", result.message));
}

async function handleQuest(api, event, args) {
  const quest = args[0] && normalizeKey(args[0]) === "claim"
    ? await claimQuest(event.threadID, event.senderID)
    : await getQuest(event.threadID, event.senderID);
  await send(api, event.threadID, box("📜 QUEST", questSummary(quest)));
}

async function handleDungeon(api, event, args) {
  await ensurePlayer(event.threadID, event.senderID);
  const action = normalizeKey(args[0] || "status");
  if (action === "enter") {
    const result = await enterDungeon(event.threadID, event.senderID, normalizeKey(args[1] || "abyssal_crypt"));
    await send(api, event.threadID, box("🏰 DUNGEON ENTERED", [result.definition.emoji + " " + result.definition.name, "Floors: " + result.definition.floors, "Use !rpg dungeon advance."]));
    return;
  }
  if (action === "advance") {
    const result = await advanceDungeon(event.threadID, event.senderID);
    await send(api, event.threadID, box("🏰 DUNGEON", [result.message].concat(result.reward ? ["💰 " + result.reward.reward + " coins", "✨ " + result.reward.xp + " XP"] : [])));
    return;
  }
  const dungeon = await getDungeon(event.threadID, event.senderID);
  await send(api, event.threadID, box("🏰 DUNGEON", dungeon ? [dungeon.dungeon_key, "Stage " + dungeon.stage + "/" + dungeon.max_stage, "Use !rpg dungeon advance."] : ["No active dungeon. Use !rpg dungeon enter."]));
}

async function handleRest(api, event) {
  const state = await getUserState(event.threadID, event.senderID);
  await updateVitals(event.threadID, event.senderID, {
    hp: state.player.max_hp,
    mp: state.player.max_mp,
    stamina: state.player.max_stamina,
    status: "active",
  });
  await send(api, event.threadID, box("🛏️ RESTED", [
    "❤️ HP restored to " + state.player.max_hp,
    "🔷 MP restored to " + state.player.max_mp,
    "⚡ Stamina restored to " + state.player.max_stamina,
  ]));
}

async function handleHelp(api, event) {
  await send(api, event.threadID, box("🌑 ECLIPSE RPG", [
    "CHARACTER: !rpg start · profile · class · skills · inventory · equipment",
    "ADVENTURE: !rpg hunt · attack · skill <name> · defend · item <name> · rest",
    "WORLD: !rpg map · locations <region> · march <location> · march status",
    "DOMAIN: !rpg property · property buy <tier> · build <building> · defense <part>",
    "ARMY: !rpg army · army train <unit> <amount> · army formation <name>",
    "QUESTS: !rpg quest · quest claim · dungeon enter · dungeon advance",
    "",
    "All RPG state is persisted through PostgreSQL.",
  ]));
}

async function handleRpgCommand(api, event, text, originalText) {
  const cleanText = String(originalText || text || "").trim();
  if (!/^!rpg(?:\s|$)/i.test(cleanText)) return false;
  const parts = cleanText.split(/\s+/);
  const action = normalizeKey(parts[1] || "help");
  const args = parts.slice(2);
  try {
    if (action === "help") await handleHelp(api, event);
    else if (action === "start" || action === "profile" || action === "stats") await handleProfile(api, event);
    else if (action === "class") await handleClass(api, event, args);
    else if (action === "skills") await handleSkills(api, event);
    else if (action === "inventory") await handleInventory(api, event);
    else if (action === "equipment") await handleEquipment(api, event);
    else if (action === "map" || action === "world" || action === "regions" || action === "locations") await handleMap(api, event, action === "locations" ? ["locations"].concat(args) : args);
    else if (action === "property" || action === "kingdom") await handleProperty(api, event, action === "kingdom" ? [] : args);
    else if (action === "build") await handleProperty(api, event, ["build"].concat(args));
    else if (action === "defense") await handleProperty(api, event, ["defense"].concat(args));
    else if (action === "army" || action === "train" || action === "formation" || action === "regiment" || action === "regiments") await handleArmy(api, event, action === "army" ? args : [action].concat(args));
    else if (action === "march" || action === "travel") await handleMarch(api, event, args);
    else if (["hunt", "attack", "skill", "defend", "item"].includes(action)) await handleCombat(api, event, action, args);
    else if (action === "quest") await handleQuest(api, event, args);
    else if (action === "dungeon") await handleDungeon(api, event, args);
    else if (action === "rest") await handleRest(api, event);
    else await send(api, event.threadID, errorBox("Unknown command. Try !rpg help."));
  } catch (error) {
    console.error("RPG command failed:", error);
    await send(api, event.threadID, errorBox(error.message || "The RPG command could not be completed right now."));
  }
  return true;
}

module.exports = {
  handleRpgCommand,
};
