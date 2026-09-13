const db = require("../db");
const { getItem, getShopItems } = require("./items");
const { addItem, consumeItem, ensurePlayer, getInventory, getPlayer, updateVitals } = require("./player");
const { normalizeKey } = require("./utils");

function formatNumber(value) { return Number(value || 0).toLocaleString("en-US"); }
function resolveRpgItem(input) { const value = String(input || "").trim(); const catalog = getShopItems(); if (/^\d+$/.test(value)) return catalog[Number(value) - 1] || null; return getItem(normalizeKey(value)); }

function getShopLines() {
  const catalog = getShopItems(); const lines = [];
  for (const category of ["Consumables", "Equipment", "Materials"]) {
    const entries = catalog.map((item, index) => ({ item, index: index + 1 })).filter((entry) => entry.item.category === category);
    if (!entries.length) continue; lines.push("[" + category.toUpperCase() + "]", "");
    for (const entry of entries) { const item = entry.item; const stats = item.stats ? " · " + Object.entries(item.stats).map(([key, value]) => key + ": +" + value).join(", ") : ""; lines.push(entry.index + ". " + item.emoji + " " + item.name, "   " + item.description, "   Type: " + item.type + stats, "   Price: " + formatNumber(item.value) + " coins", "   Buy: !buy " + entry.index, ""); }
  }
  return lines;
}

async function buyRpgItem(threadID, userID, input, quantity = 1) {
  const item = resolveRpgItem(input); const amount = Math.max(1, Math.min(99, Math.floor(Number(quantity) || 1)));
  if (!item) throw new Error("That RPG item does not exist. Use !shop to see item numbers.");
  const total = Number(item.value) * amount; await ensurePlayer(threadID, userID); let balance;
  try { balance = await db.spendBalance(threadID, userID, total, "RPG shop: " + item.id + " x" + amount); await addItem(threadID, userID, item.id, amount); }
  catch (error) { if (balance !== undefined) await db.addBalance(threadID, userID, total); throw error; }
  return { item, quantity: amount, total, balance };
}

async function getRpgInventory(threadID, userID) { await ensurePlayer(threadID, userID); return (await getInventory(threadID, userID)).filter((entry) => entry.item); }

async function useRpgItem(threadID, userID, input) {
  const item = getItem(normalizeKey(input)); if (!item || item.type !== "consumable") throw new Error("That item is not a usable consumable.");
  const player = await ensurePlayer(threadID, userID); const inventory = await getInventory(threadID, userID); const owned = inventory.find((entry) => entry.item_id === item.id);
  if (!owned || Number(owned.quantity) < 1) throw new Error("You do not have that item.");
  await consumeItem(threadID, userID, item.id); const hpBefore = Number(player.hp); const mpBefore = Number(player.mp);
  const hp = Math.min(Number(player.max_hp), hpBefore + Number(item.effect?.hp || 0)); const mp = Math.min(Number(player.max_mp), mpBefore + Number(item.effect?.mp || 0));
  await updateVitals(threadID, userID, { hp, mp });
  return { item, hpRestored: hp - hpBefore, mpRestored: mp - mpBefore, remaining: Number(owned.quantity) - 1, player: await getPlayer(threadID, userID) };
}

module.exports = { buyRpgItem, getRpgInventory, getShopLines, resolveRpgItem, useRpgItem };