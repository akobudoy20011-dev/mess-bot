const ITEMS = {
  minor_potion: { id: "minor_potion", name: "Minor Healing Potion", emoji: "🧪", type: "consumable", category: "Consumables", rarity: "Common", value: 100, effect: { hp: 35 }, description: "Restores 35 HP during combat or exploration.", purchasable: true },
  health_potion: { id: "health_potion", name: "Health Potion", emoji: "❤️", type: "consumable", category: "Consumables", rarity: "Common", value: 100, effect: { hp: 50 }, description: "Restores 50 HP.", purchasable: true },
  greater_health_potion: { id: "greater_health_potion", name: "Greater Health Potion", emoji: "💖", type: "consumable", category: "Consumables", rarity: "Uncommon", value: 300, effect: { hp: 125 }, description: "Restores 125 HP.", purchasable: true },
  mana_potion: { id: "mana_potion", name: "Mana Potion", emoji: "🔷", type: "consumable", category: "Consumables", rarity: "Common", value: 120, effect: { mp: 30 }, description: "Restores 30 MP.", purchasable: true },
  greater_mana_potion: { id: "greater_mana_potion", name: "Greater Mana Potion", emoji: "💠", type: "consumable", category: "Consumables", rarity: "Uncommon", value: 320, effect: { mp: 90 }, description: "Restores 90 MP.", purchasable: true },
  iron_sword: { id: "iron_sword", name: "Iron Sword", emoji: "⚔️", type: "weapon", category: "Equipment", rarity: "Common", value: 250, stats: { strength: 5 }, description: "A dependable starter weapon.", purchasable: true },
  ranger_bow: { id: "ranger_bow", name: "Ranger Bow", emoji: "🏹", type: "weapon", category: "Equipment", rarity: "Uncommon", value: 600, stats: { agility: 7, luck: 2 }, description: "A light bow built for accurate shots.", purchasable: true },
  apprentice_robe: { id: "apprentice_robe", name: "Apprentice Robe", emoji: "🧥", type: "armor", category: "Equipment", rarity: "Common", value: 300, stats: { intelligence: 5, maxMp: 15 }, description: "A simple robe with a little arcane protection.", purchasable: true },
  moonleaf: { id: "moonleaf", name: "Moonleaf", emoji: "🌿", type: "material", category: "Materials", rarity: "Uncommon", value: 40, description: "A cool herb used in crafting.", purchasable: true },
  iron: { id: "iron", name: "Iron", emoji: "⛓️", type: "material", category: "Materials", rarity: "Common", value: 25, description: "Refined metal for weapons and buildings.", purchasable: true },
  void_crystal: { id: "void_crystal", name: "Void Crystal", emoji: "💎", type: "material", category: "Materials", rarity: "Epic", value: 500, description: "A dangerous crystal from the Abyss.", purchasable: true },
};

function getItem(itemId) { return ITEMS[String(itemId || "").trim().toLowerCase()] || null; }
function getShopItems() { return Object.values(ITEMS).filter((item) => item.purchasable !== false); }
module.exports = { ITEMS, getItem, getShopItems };