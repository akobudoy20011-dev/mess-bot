const db = require("../db");
const { UNITS, getArmy, armyPower } = require("./army");
const { getPlayer, addReputation } = require("./player");
const { ensureLocationState, getLocationState, resolveTarget } = require("./scouting");
const { clamp, formatNumber, randomInt, totalUnits } = require("./utils");

const UNIT_COLUMNS = Object.values(UNITS).map((unit) => unit.column);

async function logBattle(threadID, fields) {
  await db.query(
    `
    INSERT INTO rpg_battles (
      thread_id, battle_type, attacker_user_id, defender_user_id,
      location_id, result, attacker_losses, defender_losses, loot_gold, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      String(threadID),
      fields.battleType,
      String(fields.attackerUserId),
      fields.defenderUserId ? String(fields.defenderUserId) : null,
      fields.locationId || null,
      fields.result,
      Math.round(fields.attackerLosses || 0),
      Math.round(fields.defenderLosses || 0),
      Math.round(fields.lootGold || 0),
      Date.now(),
    ]
  );
}

async function applyCasualties(threadID, userID, army, fraction) {
  const safeFraction = clamp(fraction, 0, 0.9);
  let totalLost = 0;

  for (const column of UNIT_COLUMNS) {
    const current = Number(army[column] || 0);
    if (current <= 0) continue;
    const lost = Math.floor(current * safeFraction);
    if (lost <= 0) continue;
    totalLost += lost;
    await db.query(
      `UPDATE rpg_armies SET ${column} = ${column} - $3, updated_at = $4 WHERE thread_id = $1 AND user_id = $2`,
      [String(threadID), String(userID), lost, Date.now()]
    );
  }

  return totalLost;
}

async function raidLocation(threadID, userID, targetValue) {
  const location = resolveTarget(targetValue);
  const player = await getPlayer(threadID, userID);
  const army = await getArmy(threadID, userID);

  if (!player || !army) throw new Error("Start your character before raiding.");
  if (player.region_id !== location.regionId && army.region_id !== location.regionId) {
    throw new Error("March your army into that region before raiding it.");
  }
  if (totalUnits(army) <= 0) {
    throw new Error("Train troops before attempting a raid.");
  }

  const state =
    (await getLocationState(threadID, location.id)) ||
    (await ensureLocationState(threadID, location));

  const power = armyPower(army, army.formation);
  const attackRoll = power.attack + randomInt(0, 60);
  const defenseRoll = Number(state.garrison) + Number(state.defense) + randomInt(0, 60);
  const success = attackRoll > defenseRoll;

  if (!success) {
    const lost = await applyCasualties(threadID, userID, army, 0.05 + Math.random() * 0.1);

    await logBattle(threadID, {
      battleType: "raid",
      attackerUserId: userID,
      locationId: location.id,
      result: "defeat",
      attackerLosses: lost,
    });

    throw new Error(
      `The raid on ${location.name} failed. Your army suffered ${formatNumber(lost)} casualties.`
    );
  }

  const lootPercent = 10 + randomInt(0, 15);
  const lootGold = Math.max(20, Math.round(Number(state.prosperity) * (lootPercent / 100)));
  const garrisonLoss = Math.round(Number(state.garrison) * 0.1);

  await db.query(
    `
    UPDATE rpg_location_states
    SET prosperity = GREATEST(0, prosperity - $3),
        garrison = GREATEST(0, garrison - $4),
        hostility = LEAST(100, hostility + 15),
        last_raided_at = $5,
        updated_at = $5
    WHERE thread_id = $1
      AND location_id = $2
    `,
    [String(threadID), location.id, lootGold, garrisonLoss, Date.now()]
  );

  await db.addBalance(threadID, userID, lootGold);
  await addReputation(threadID, userID, -5);

  await logBattle(threadID, {
    battleType: "raid",
    attackerUserId: userID,
    locationId: location.id,
    result: "victory",
    lootGold,
  });

  return { location, lootGold, garrisonLoss };
}

async function ambushArmy(threadID, attackerUserID, targetUserID) {
  if (String(attackerUserID) === String(targetUserID)) {
    throw new Error("You cannot ambush your own army.");
  }

  const attacker = await getPlayer(threadID, attackerUserID);
  const attackerArmy = await getArmy(threadID, attackerUserID);
  const defender = await getPlayer(threadID, targetUserID);
  const defenderArmy = await getArmy(threadID, targetUserID);

  if (!attacker || !attackerArmy) throw new Error("Start your character before attempting an ambush.");
  if (!defender || !defenderArmy) throw new Error("That player has no army to ambush.");
  if (defenderArmy.status !== "marching") {
    throw new Error("That army is not currently on the move.");
  }
  if (attackerArmy.region_id !== defenderArmy.region_id) {
    throw new Error("Your army must be in the same region to intercept that march.");
  }
  if (totalUnits(attackerArmy) <= 0) {
    throw new Error("Train troops before attempting an ambush.");
  }

  const stealthRoll = Number(attacker.agility) * 1.2 + Number(attacker.luck) + randomInt(0, 40);
  const detectionRoll = Number(defender.agility) + Number(defender.renown) * 0.5 + randomInt(0, 40);
  const surprise = stealthRoll > detectionRoll;

  const attackerPower = armyPower(attackerArmy, attackerArmy.formation);
  const defenderPower = armyPower(defenderArmy, defenderArmy.formation);

  const attackerScore = attackerPower.attack * (surprise ? 1.35 : 1) + randomInt(0, 40);
  const defenderScore = defenderPower.defense + randomInt(0, 40);
  const attackerWins = attackerScore > defenderScore;

  const winnerCasualtyFraction = 0.05 + Math.random() * 0.05;
  const loserCasualtyFraction = 0.2 + Math.random() * 0.2;

  const attackerLosses = await applyCasualties(
    threadID,
    attackerUserID,
    attackerArmy,
    attackerWins ? winnerCasualtyFraction : loserCasualtyFraction
  );
  const defenderLosses = await applyCasualties(
    threadID,
    targetUserID,
    defenderArmy,
    attackerWins ? loserCasualtyFraction : winnerCasualtyFraction
  );

  let lootGold = 0;

  if (attackerWins) {
    await db.query(
      `
      UPDATE rpg_armies
      SET status = 'garrison',
          destination_region = NULL,
          destination_location = NULL,
          departure_at = NULL,
          arrival_at = NULL,
          supplies = GREATEST(0, supplies - 20),
          updated_at = $3
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [String(threadID), String(targetUserID), Date.now()]
    );

    lootGold = 50 + randomInt(0, 150);
    await db.addBalance(threadID, attackerUserID, lootGold);
  }

  await addReputation(threadID, attackerUserID, -8);

  await logBattle(threadID, {
    battleType: "ambush",
    attackerUserId: attackerUserID,
    defenderUserId: targetUserID,
    result: attackerWins ? "attacker_victory" : "defender_repelled",
    attackerLosses,
    defenderLosses,
    lootGold,
  });

  return { surprise, attackerWins, attackerLosses, defenderLosses, lootGold };
}

module.exports = { ambushArmy, raidLocation };
