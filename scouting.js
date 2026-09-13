const db = require("../db");
const { resolveLocation, resolveRegion, distanceBetween } = require("./world");
const { getPlayer } = require("./player");
const { clamp, formatNumber, randomInt } = require("./utils");

const BASE_LOCATION_STATS = {
  castle: { garrison: 120, defense: 60, prosperity: 200 },
  village: { garrison: 20, defense: 15, prosperity: 100 },
  town: { garrison: 40, defense: 25, prosperity: 150 },
  city: { garrison: 80, defense: 40, prosperity: 250 },
  capital: { garrison: 200, defense: 80, prosperity: 400 },
  watchtower: { garrison: 30, defense: 35, prosperity: 50 },
  port: { garrison: 35, defense: 20, prosperity: 130 },
  market: { garrison: 15, defense: 10, prosperity: 140 },
  border_post: { garrison: 45, defense: 30, prosperity: 60 },
  ruin: { garrison: 10, defense: 5, prosperity: 0 },
  dungeon: { garrison: 0, defense: 0, prosperity: 0 },
  pass: { garrison: 25, defense: 40, prosperity: 20 },
  road: { garrison: 5, defense: 5, prosperity: 10 },
  default: { garrison: 20, defense: 15, prosperity: 80 },
};

function baseStatsFor(location) {
  return BASE_LOCATION_STATS[location.type] || BASE_LOCATION_STATS.default;
}

function resolveTarget(value) {
  const location = resolveLocation(value);
  if (!location) {
    throw new Error("That location does not exist. Use !rpg map to view the world.");
  }
  return location;
}

async function getLocationState(threadID, locationId) {
  const result = await db.query(
    `SELECT * FROM rpg_location_states WHERE thread_id = $1 AND location_id = $2`,
    [String(threadID), locationId]
  );
  return result.rows[0] || null;
}

async function ensureLocationState(threadID, location) {
  const base = baseStatsFor(location);
  await db.query(
    `
    INSERT INTO rpg_location_states (
      thread_id, location_id, garrison, defense, prosperity, hostility, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 0, $6)
    ON CONFLICT (thread_id, location_id) DO NOTHING
    `,
    [String(threadID), location.id, base.garrison, base.defense, base.prosperity, Date.now()]
  );
  return getLocationState(threadID, location.id);
}

async function scoutLocation(threadID, userID, targetValue) {
  const location = resolveTarget(targetValue);
  const state =
    (await getLocationState(threadID, location.id)) ||
    (await ensureLocationState(threadID, location));

  const player = await getPlayer(threadID, userID);
  if (!player) throw new Error("Start your character before scouting.");

  const origin = resolveLocation(player.location_id) || resolveRegion(player.region_id);
  const distance = distanceBetween(origin, location);

  const skill =
    Number(player.agility) * 1.1 + Number(player.luck) * 0.9 + Number(player.renown) * 0.15;
  const difficulty = Number(state.defense) + distance * 7;
  const roll = skill + randomInt(0, 40) - difficulty;
  const accuracy = Math.round(clamp(50 + roll, 10, 97));

  await db.query(
    `
    INSERT INTO rpg_scouting_reports (
      thread_id, user_id, location_id, accuracy, garrison_estimate, defense_estimate, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      String(threadID),
      String(userID),
      location.id,
      accuracy,
      Math.round(Number(state.garrison)),
      Math.round(Number(state.defense)),
      Date.now(),
    ]
  );

  return { location, state, accuracy, distance };
}

function scoutSummary(report) {
  const { location, state, accuracy } = report;
  const lines = [
    (location.type || "location") + ": " + location.name,
    "🎯 Scouting accuracy: " + accuracy + "%",
    "",
  ];

  if (accuracy >= 80) {
    lines.push(
      "🛡️ Garrison: " + formatNumber(state.garrison) + " troops",
      "🧱 Defense rating: " + state.defense,
      "💰 Prosperity: " + formatNumber(state.prosperity),
      "⚠️ Hostility: " + state.hostility
    );
  } else if (accuracy >= 50) {
    const roughGarrison = Math.round(Number(state.garrison) / 10) * 10;
    lines.push(
      "🛡️ Garrison: roughly " + formatNumber(roughGarrison) + " troops",
      "🧱 Defenses appear " + (state.defense > 40 ? "heavily fortified" : "lightly fortified"),
      "⚠️ Hostility: " + (state.hostility > 30 ? "elevated" : "calm")
    );
  } else {
    lines.push(
      "🛡️ Garrison: unknown — your scouts could not get close enough.",
      "🧱 Defenses appear " + (state.defense > 40 ? "formidable" : "unclear") + "."
    );
  }

  return lines;
}

module.exports = {
  BASE_LOCATION_STATS,
  ensureLocationState,
  getLocationState,
  resolveTarget,
  scoutLocation,
  scoutSummary,
};
