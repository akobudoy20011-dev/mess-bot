const db = require("../db");
const { getArmy } = require("./army");
const { getPlayer, updateVitals } = require("./player");
const {
  distanceBetween,
  marchDurationMs,
  resolveLocation,
  resolveRegion,
} = require("./world");
const { formatDuration, formatUtc, totalUnits } = require("./utils");
async function refreshMarch(threadID, userID) {
  const army = await getArmy(threadID, userID);
  if (
    !army ||
    army.status !== "marching" ||
    !army.destination_region ||
    Number(army.arrival_at) > Date.now()
  ) {
    return army;
  }
  const destinationRegion = army.destination_region;
  const destinationLocation = army.destination_location || null;
  const now = Date.now();
  await db.query(
    `
    UPDATE rpg_armies
    SET region_id = $3,
        location_id = COALESCE($4, location_id),
        status = 'garrison',
        destination_region = NULL,
        destination_location = NULL,
        departure_at = NULL,
        arrival_at = NULL,
        updated_at = $5
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      destinationRegion,
      destinationLocation,
      now,
    ]
  );
  await updateVitals(threadID, userID, {
    region_id: destinationRegion,
    location_id: destinationLocation || resolveRegion(destinationRegion)?.id,
  });
  await db.query(
    `
    UPDATE rpg_marches
    SET status = 'arrived',
        updated_at = $3
    WHERE thread_id = $1
      AND user_id = $2
      AND status = 'marching'
    `,
    [String(threadID), String(userID), now]
  );
  return getArmy(threadID, userID);
}
async function startMarch(threadID, userID, destinationValue) {
  await refreshMarch(threadID, userID);
  const army = await getArmy(threadID, userID);
  const player = await getPlayer(threadID, userID);
  const destination =
    resolveLocation(destinationValue) || resolveRegion(destinationValue);
  if (!destination) {
    throw new Error("That region or location is not on the world map.");
  }
  if (!army || !player) {
    throw new Error("Start your character before commanding an army.");
  }
  if (army.status === "marching") {
    throw new Error(
      `Your army is already marching to ${
        resolveRegion(army.destination_region)?.name ||
        army.destination_region
      }.`
    );
  }
  const destinationRegionId = destination.regionId || destination.id;
  if (army.region_id === destinationRegionId || player.region_id === destinationRegionId) {
    throw new Error("Your army is already in that region.");
  }
  if (totalUnits(army) <= 0) {
    throw new Error("Train troops before starting a march.");
  }
  const origin =
    resolveLocation(army.location_id) ||
    resolveRegion(army.region_id) ||
    resolveRegion("greenvale");
  const distance = distanceBetween(origin, destination);
  const duration = marchDurationMs(origin, destination);
  const departure = Date.now();
  const arrival = departure + duration;
  const destinationRegion = destination.regionId || destination.id;
  const destinationLocation = destination.regionId ? destination.id : null;
  await db.query(
    `
    UPDATE rpg_armies
    SET status = 'marching',
        destination_region = $3,
        destination_location = $4,
        departure_at = $5,
        arrival_at = $6,
        updated_at = $5
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(userID),
      destinationRegion,
      destinationLocation,
      departure,
      arrival,
    ]
  );
  await db.query(
    `
    INSERT INTO rpg_marches (
      thread_id, user_id, origin, destination, distance,
      duration_ms, departure_at, arrival_at, army_size,
      commander_id, status, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, 'marching', $7)
    `,
    [
      String(threadID),
      String(userID),
      origin.id || origin.regionId,
      destinationLocation || destinationRegion,
      distance,
      duration,
      departure,
      arrival,
      totalUnits(army),
    ]
  );
  return {
    origin,
    destination,
    distance,
    duration,
    departure,
    arrival,
    armySize: totalUnits(army),
  };
}
async function marchStatus(threadID, userID) {
  const army = await refreshMarch(threadID, userID);
  if (!army) throw new Error("Your army has not been initialized yet.");
  if (army.status !== "marching") {
    return { marching: false, army };
  }
  const total = Number(army.arrival_at) - Number(army.departure_at);
  const elapsed = Date.now() - Number(army.departure_at);
  const progress = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  return {
    marching: true,
    army,
    progress,
    remaining: Number(army.arrival_at) - Date.now(),
    arrival: Number(army.arrival_at),
    destination: resolveLocation(army.destination_location) ||
      resolveRegion(army.destination_region),
  };
}
function marchSummary(status) {
  if (!status.marching) {
    return {
      lines: ["🛡️ Status: Garrisoned"],
    };
  }
  const destination = status.destination;
  return {
    lines: [
      `🚶 Destination: ${destination?.emoji || "🗺️"} ${
        destination?.name || status.army.destination_region
      }`,
      `📍 Progress: ${status.progress}% ${"█".repeat(
        Math.round(status.progress / 10)
      )}${"░".repeat(10 - Math.round(status.progress / 10))}`,
      `👥 Army: ${totalUnits(status.army)} soldiers`,
      `⏳ ETA: ${formatDuration(status.remaining)}`,
      `📅 Arrival: ${formatUtc(status.arrival)} UTC`,
      "⏱️ Maximum travel time: 2 minutes",
    ],
  };
}
module.exports = {
  marchStatus,
  marchSummary,
  refreshMarch,
  startMarch,
};
