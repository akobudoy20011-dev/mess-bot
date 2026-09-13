const { normalizeKey } = require("./utils");
const REGIONS = {
  greenvale: {
    name: "Greenvale",
    emoji: "🌾",
    terrain: "Plains",
    x: 0,
    y: 0,
    movement: 1,
    combat: { cavalry: 1.15, defense: 1 },
    resources: ["food", "grain", "horses"],
  },
  whispering_forest: {
    name: "Whispering Forest",
    emoji: "🌲",
    terrain: "Forest",
    x: -1,
    y: 0,
    movement: 1.2,
    combat: { archers: 1.15, assassins: 1.2, cavalry: 0.9, defense: 1.1 },
    resources: ["wood", "herbs", "game"],
  },
  ironspine: {
    name: "Ironspine Mountains",
    emoji: "⛰️",
    terrain: "Mountains",
    x: 0,
    y: 1,
    movement: 1.5,
    combat: { defense: 1.3, archers: 1.15, cavalry: 0.8 },
    resources: ["iron", "stone", "crystal"],
  },
  scorched_wastes: {
    name: "Scorched Wastes",
    emoji: "🏜️",
    terrain: "Desert",
    x: 1,
    y: 0,
    movement: 1.35,
    combat: { defense: 0.95, cavalry: 1.05 },
    resources: ["ore", "salt", "ember"],
  },
  frostgrave: {
    name: "Frostgrave",
    emoji: "❄️",
    terrain: "Tundra",
    x: 0,
    y: 2,
    movement: 1.6,
    combat: { defense: 1.15, cavalry: 0.8 },
    resources: ["ice", "fur", "moonstone"],
  },
  azure_coast: {
    name: "Azure Coast",
    emoji: "🌊",
    terrain: "Coast",
    x: -2,
    y: 0,
    movement: 1.1,
    combat: { defense: 1 },
    resources: ["fish", "salt", "pearls"],
  },
  lowlands: {
    name: "Lowlands",
    emoji: "🌱",
    terrain: "Wetlands",
    x: 0,
    y: -1,
    movement: 1.15,
    combat: { defense: 1.05, cavalry: 0.9 },
    resources: ["peat", "grain", "herbs"],
  },
  infernal_rift: {
    name: "Infernal Rift",
    emoji: "🌋",
    terrain: "Volcanic",
    x: 0,
    y: -2,
    movement: 1.8,
    combat: { defense: 1.05, mages: 1.2 },
    resources: ["ember", "obsidian", "sulfur"],
  },
  abyss: {
    name: "The Abyss",
    emoji: "🌑",
    terrain: "Abyssal",
    x: 2,
    y: -1,
    movement: 2,
    combat: { defense: 0.9, mages: 1.25, assassins: 1.25 },
    resources: ["void_crystal", "ancient_bone", "shadow_ore"],
  },
  celestial_lands: {
    name: "Celestial Lands",
    emoji: "✨",
    terrain: "Arcane",
    x: 2,
    y: 2,
    movement: 2,
    combat: { defense: 1.15, mages: 1.3 },
    resources: ["star_metal", "aether", "sunstone"],
  },
};
const LOCATIONS = [
  ["greenvale", "eclipse_castle", "Eclipse Castle", "castle", 0, 0],
  ["greenvale", "willowmere", "Willowmere", "village", 1, 0],
  ["greenvale", "redbrook", "Redbrook", "village", -1, 0],
  ["greenvale", "kings_road", "King's Road", "road", 0, -1],
  ["whispering_forest", "blackwood", "Blackwood", "village", -1, 0],
  ["whispering_forest", "moonlit_ruins", "Moonlit Ruins", "ruin", -2, 1],
  ["ironspine", "stonehold", "Stonehold", "castle", 0, 1],
  ["ironspine", "kings_pass", "King's Pass", "pass", 0, 2],
  ["scorched_wastes", "emberwatch", "Emberwatch", "watchtower", 1, 0],
  ["frostgrave", "wintermere", "Wintermere", "village", 0, 2],
  ["azure_coast", "azure_port", "Azure Port", "port", -2, 0],
  ["lowlands", "reedmarket", "Reedmarket", "market", 0, -1],
  ["infernal_rift", "ashgate", "Ashgate", "border_post", 0, -2],
  ["abyss", "hollow_gate", "Hollow Gate", "dungeon", 2, -1],
  ["celestial_lands", "starfall", "Starfall", "ruin", 2, 2],
];
const LOCATION_MAP = Object.fromEntries(
  LOCATIONS.map(([regionId, id, name, type, x, y]) => [
    id,
    { id, regionId, name, type, x, y },
  ])
);
function resolveRegion(value) {
  const key = normalizeKey(value);
  if (REGIONS[key]) return { id: key, ...REGIONS[key] };
  const entry = Object.entries(REGIONS).find(
    ([id, region]) =>
      region.name.toLowerCase() === String(value || "").trim().toLowerCase() ||
      id.replace(/_/g, " ") === String(value || "").trim().toLowerCase()
  );
  return entry ? { id: entry[0], ...entry[1] } : null;
}
function resolveLocation(value) {
  const key = normalizeKey(value);
  if (LOCATION_MAP[key]) {
    return { ...LOCATION_MAP[key], region: REGIONS[LOCATION_MAP[key].regionId] };
  }
  const entry = Object.values(LOCATION_MAP).find(
    (location) =>
      location.name.toLowerCase() === String(value || "").trim().toLowerCase()
  );
  return entry ? { ...entry, region: REGIONS[entry.regionId] } : null;
}
function locationsInRegion(regionId) {
  return Object.values(LOCATION_MAP).filter(
    (location) => location.regionId === regionId
  );
}
function distanceBetween(origin, destination) {
  return Math.max(
    1,
    Math.abs(Number(origin.x) - Number(destination.x)) +
      Math.abs(Number(origin.y) - Number(destination.y))
  );
}
function marchDurationMs(origin, destination) {
  const base = Math.max(
    1_000,
    Number(process.env.RPG_MARCH_MS_PER_DISTANCE || 30_000)
  );
  const distance = distanceBetween(origin, destination);
  // Marches may be persistent, but never take more than two real minutes.
  const duration = Math.ceil(distance * base * Number(destination.movement || 1));
  return Math.min(120_000, duration);
}
module.exports = {
  LOCATIONS,
  LOCATION_MAP,
  REGIONS,
  distanceBetween,
  locationsInRegion,
  marchDurationMs,
  resolveLocation,
  resolveRegion,
};
