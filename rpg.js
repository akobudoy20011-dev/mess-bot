const db = require("./db");
const { reply } = require("./util");

const MARCH_MS_PER_DISTANCE = Math.max(
  1_000,
  Number(process.env.RPG_MARCH_MS_PER_DISTANCE || 30_000)
);

const REGIONS = {
  greenvale: {
    name: "Greenvale",
    emoji: "🌾",
    terrain: "Plains",
    x: 0,
    y: 0,
    difficulty: 1,
  },
  whispering_forest: {
    name: "Whispering Forest",
    emoji: "🌲",
    terrain: "Forest",
    x: -1,
    y: 0,
    difficulty: 1.2,
  },
  ironspine: {
    name: "Ironspine Mountains",
    emoji: "⛰️",
    terrain: "Mountains",
    x: 0,
    y: 1,
    difficulty: 1.5,
  },
  scorched_wastes: {
    name: "Scorched Wastes",
    emoji: "🏜️",
    terrain: "Desert",
    x: 1,
    y: 0,
    difficulty: 1.35,
  },
  frostgrave: {
    name: "Frostgrave",
    emoji: "❄️",
    terrain: "Tundra",
    x: 0,
    y: 2,
    difficulty: 1.6,
  },
  azure_coast: {
    name: "Azure Coast",
    emoji: "🌊",
    terrain: "Coast",
    x: -2,
    y: 0,
    difficulty: 1.1,
  },
  lowlands: {
    name: "Lowlands",
    emoji: "🌱",
    terrain: "Wetlands",
    x: 0,
    y: -1,
    difficulty: 1.15,
  },
  infernal_rift: {
    name: "Infernal Rift",
    emoji: "🌋",
    terrain: "Volcanic",
    x: 0,
    y: -2,
    difficulty: 1.8,
  },
  abyss: {
    name: "The Abyss",
    emoji: "🌑",
    terrain: "Abyssal",
    x: 2,
    y: -1,
    difficulty: 2,
  },
  celestial_lands: {
    name: "Celestial Lands",
    emoji: "✨",
    terrain: "Arcane",
    x: 2,
    y: 2,
    difficulty: 2,
  },
};

const CLASS_PROFILES = {
  knight: {
    name: "Knight",
    emoji: "⚔️",
    hp: 120,
    attack: 18,
    defense: 16,
  },
  bloodreaver: {
    name: "Bloodreaver",
    emoji: "🩸",
    hp: 95,
    attack: 24,
    defense: 10,
  },
  arcanist: {
    name: "Arcanist",
    emoji: "🧙",
    hp: 85,
    attack: 26,
    defense: 8,
  },
  wraith: {
    name: "Wraith",
    emoji: "🗡️",
    hp: 90,
    attack: 22,
    defense: 11,
  },
  paladin: {
    name: "Paladin",
    emoji: "🛡️",
    hp: 130,
    attack: 14,
    defense: 22,
  },
};

const PROPERTY_TIERS = [
  { key: "settlement", name: "Settlement", cost: 0 },
  { key: "cottage", name: "Cottage", cost: 500 },
  { key: "estate", name: "Estate", cost: 2_500 },
  { key: "castle", name: "Castle", cost: 10_000 },
  { key: "fortress", name: "Fortress", cost: 50_000 },
];

const BUILDINGS = {
  farm: {
    name: "Farm",
    emoji: "🌾",
    baseCost: 300,
    description: "Improves food production.",
  },
  mine: {
    name: "Mine",
    emoji: "⛏️",
    baseCost: 500,
    description: "Improves resource production.",
  },
  lumber: {
    name: "Lumber Camp",
    emoji: "🪵",
    baseCost: 400,
    description: "Improves timber production.",
  },
  market: {
    name: "Market",
    emoji: "🏪",
    baseCost: 750,
    description: "Improves trade and tax income.",
  },
  guardpost: {
    name: "Guard Post",
    emoji: "🛡️",
    baseCost: 600,
    description: "Improves local defense.",
  },
};

const UNIT_TYPES = {
  infantry: {
    column: "infantry",
    name: "Infantry",
    emoji: "⚔️",
    cost: 10,
  },
  archers: {
    column: "archers",
    name: "Archers",
    emoji: "🏹",
    cost: 16,
  },
  cavalry: {
    column: "cavalry",
    name: "Cavalry",
    emoji: "🐎",
    cost: 25,
  },
  mages: {
    column: "mages",
    name: "Mages",
    emoji: "🧙",
    cost: 40,
  },
  assassins: {
    column: "assassins",
    name: "Assassins",
    emoji: "🗡️",
    cost: 50,
  },
};

function formatCoins(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDate(timestamp) {
  return new Date(Number(timestamp)).toLocaleString("en-US", {
    timeZone: "UTC",
    hour12: false,
  });
}

function createBox(title, lines = []) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    `        ${title}`,
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    ...lines,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function createError(message) {
  return createBox("❌ ECLIPSE RPG", [message]);
}

function displayName(user) {
  const value = user && String(user.display_name || "").trim();
  return value || `Player ${user.user_id}`;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function regionFor(value) {
  const key = normalizeKey(value);
  if (REGIONS[key]) return { key, ...REGIONS[key] };

  return Object.entries(REGIONS).find(
    ([regionKey, region]) =>
      region.name.toLowerCase() === String(value || "").trim().toLowerCase() ||
      regionKey.replace(/_/g, " ") === String(value || "").trim().toLowerCase()
  )?.[1]
    ? {
        key: Object.entries(REGIONS).find(
          ([regionKey, region]) =>
            region.name.toLowerCase() ===
              String(value || "").trim().toLowerCase() ||
            regionKey.replace(/_/g, " ") ===
              String(value || "").trim().toLowerCase()
        )[0],
        ...Object.entries(REGIONS).find(
          ([regionKey, region]) =>
            region.name.toLowerCase() ===
              String(value || "").trim().toLowerCase() ||
            regionKey.replace(/_/g, " ") ===
              String(value || "").trim().toLowerCase()
        )[1],
      }
    : null;
}

function getClassProfile(characterClass) {
  return CLASS_PROFILES[normalizeKey(characterClass)] || CLASS_PROFILES.knight;
}

function totalTroops(army) {
  return ["infantry", "archers", "cavalry", "mages", "assassins"].reduce(
    (total, unit) => total + Number(army[unit] || 0),
    0
  );
}

async function ensurePlayer(threadID, userID) {
  const now = Date.now();

  await db.query(
    `
    INSERT INTO rpg_players (
      thread_id,
      user_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $3)
    ON CONFLICT (thread_id, user_id) DO NOTHING
    `,
    [String(threadID), String(userID), now]
  );

  await db.query(
    `
    INSERT INTO rpg_armies (
      thread_id,
      user_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $3)
    ON CONFLICT (thread_id, user_id) DO NOTHING
    `,
    [String(threadID), String(userID), now]
  );
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

async function getArmy(threadID, userID) {
  const result = await db.query(
    `
    SELECT *
    FROM rpg_armies
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID)]
  );

  return result.rows[0] || null;
}

async function refreshMarch(threadID, userID) {
  const army = await getArmy(threadID, userID);

  if (
    !army ||
    army.status !== "marching" ||
    !army.destination_region ||
    Number(army.arrival_at) > Date.now()
  ) {
    return;
  }

  const destination = army.destination_region;
  const now = Date.now();

  await db.query(
    `
    UPDATE rpg_players
    SET region_id = $3,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID), destination, now]
  );

  await db.query(
    `
    UPDATE rpg_armies
    SET region_id = $3,
        status = 'garrison',
        destination_region = NULL,
        departure_at = NULL,
        arrival_at = NULL,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(userID), destination, now]
  );
}

async function getState(threadID, userID) {
  await ensurePlayer(threadID, userID);
  await refreshMarch(threadID, userID);

  return {
    player: await getPlayer(threadID, userID),
    army: await getArmy(threadID, userID),
  };
}

async function getBuildings(threadID, userID) {
  const result = await db.query(
    `
    SELECT building_key, level
    FROM rpg_buildings
    WHERE thread_id = $1
      AND user_id = $2
    ORDER BY building_key
    `,
    [String(threadID), String(userID)]
  );

  return result.rows;
}

async function handleProfile(api, event) {
  const { threadID, senderID } = event;
  const state = await getState(threadID, senderID);
  const user = await db.getUser(threadID, senderID);
  const region = REGIONS[state.player.region_id] || REGIONS.greenvale;
  const characterClass = getClassProfile(state.player.character_class);

  await reply(
    api,
    threadID,
    createBox("🌑 ECLIPSE PROFILE", [
      `👤 ${displayName(user)}`,
      `${characterClass.emoji} ${characterClass.name} · Level ${user.level}`,
      `✨ XP: ${formatCoins(user.xp)}`,
      `❤️ HP: ${characterClass.hp}`,
      `⚔️ Attack: ${characterClass.attack}`,
      `🛡️ Defense: ${characterClass.defense}`,
      "",
      `${region.emoji} Location: ${region.name}`,
      `🏰 Domain: ${
        PROPERTY_TIERS[Number(state.player.property_tier)]?.name ||
        "Settlement"
      }`,
      "",
      `💵 Wallet: ${formatCoins(user.balance)} coins`,
      `🏦 Bank: ${formatCoins(user.bank_balance)} coins`,
      `💎 Total: ${formatCoins(Number(user.balance) + Number(user.bank_balance))} coins`,
    ])
  );
}

async function handleRegions(api, event) {
  const lines = Object.entries(REGIONS).map(
    ([key, region]) =>
      `${region.emoji} ${region.name} — ${region.terrain} (${key})`
  );

  await reply(
    api,
    event.threadID,
    createBox("🗺️ ECLIPSE WORLD", [
      "Distance controls march duration.",
      "There is no global two-minute march cap.",
      "",
      ...lines,
    ])
  );
}

async function handleArmy(api, event) {
  const { threadID, senderID } = event;
  const state = await getState(threadID, senderID);
  const region = REGIONS[state.army.region_id] || REGIONS.greenvale;
  const troops = totalTroops(state.army);
  const lines = [
    `📍 ${region.emoji} ${region.name}`,
    `👥 Total troops: ${formatCoins(troops)}`,
    `${UNIT_TYPES.infantry.emoji} Infantry: ${formatCoins(state.army.infantry)}`,
    `${UNIT_TYPES.archers.emoji} Archers: ${formatCoins(state.army.archers)}`,
    `${UNIT_TYPES.cavalry.emoji} Cavalry: ${formatCoins(state.army.cavalry)}`,
    `${UNIT_TYPES.mages.emoji} Mages: ${formatCoins(state.army.mages)}`,
    `${UNIT_TYPES.assassins.emoji} Assassins: ${formatCoins(state.army.assassins)}`,
  ];

  if (state.army.status === "marching") {
    const destination = REGIONS[state.army.destination_region];
    lines.push(
      "",
      `🚶 Marching to ${destination?.emoji || ""} ${destination?.name || state.army.destination_region}`,
      `⏳ Remaining: ${formatDuration(Number(state.army.arrival_at) - Date.now())}`,
      `📅 Arrival: ${formatDate(state.army.arrival_at)} UTC`
    );
  } else {
    lines.push("", "🛡️ Status: Garrisoned");
  }

  await reply(api, threadID, createBox("⚔️ ARMY", lines));
}

async function handleKingdom(api, event) {
  const { threadID, senderID } = event;
  const state = await getState(threadID, senderID);
  const user = await db.getUser(threadID, senderID);
  const region = REGIONS[state.player.region_id] || REGIONS.greenvale;
  const property =
    PROPERTY_TIERS[Number(state.player.property_tier)] || PROPERTY_TIERS[0];
  const buildings = await getBuildings(threadID, senderID);

  const buildingLines =
    buildings.length > 0
      ? buildings.map((building) => {
          const definition = BUILDINGS[building.building_key];
          return `${definition?.emoji || "🏗️"} ${
            definition?.name || building.building_key
          } Lv.${building.level}`;
        })
      : ["No buildings yet. Try `!rpg build farm`."];

  await reply(
    api,
    threadID,
    createBox("👑 KINGDOM", [
      `👤 Ruler: ${displayName(user)}`,
      `${property.name === "Settlement" ? "🏕️" : "🏰"} Domain: ${property.name}`,
      `${region.emoji} Region: ${region.name}`,
      `📍 Coordinates: ${region.x}, ${region.y}`,
      "",
      "🏗️ Buildings:",
      ...buildingLines,
      "",
      "Use !rpg property to expand your domain.",
    ])
  );
}

async function handleProperty(api, event, args) {
  const { threadID, senderID } = event;
  const state = await getState(threadID, senderID);
  const currentTier = Number(state.player.property_tier);
  const requested = normalizeKey(args[0]);

  if (!requested || requested === "status") {
    await handleKingdom(api, event);
    return;
  }

  if (requested !== "buy") {
    await reply(
      api,
      threadID,
      createError(
        "Usage: !rpg property buy <cottage|estate|castle|fortress>"
      )
    );
    return;
  }

  const target = normalizeKey(args[1]);
  const targetIndex = PROPERTY_TIERS.findIndex((tier) => tier.key === target);

  if (targetIndex === -1 || targetIndex === 0) {
    await reply(
      api,
      threadID,
      createError(
        "Choose a property in order: cottage, estate, castle, fortress."
      )
    );
    return;
  }

  if (targetIndex !== currentTier + 1) {
    const next = PROPERTY_TIERS[currentTier + 1];
    await reply(
      api,
      threadID,
      createError(
        next
          ? `Your next upgrade is ${next.name}.`
          : "Your domain has reached the current frontier."
      )
    );
    return;
  }

  const tier = PROPERTY_TIERS[targetIndex];

  try {
    await db.spendBalance(threadID, senderID, tier.cost, `RPG property: ${tier.name}`);
    await db.query(
      `
      UPDATE rpg_players
      SET property_tier = $3,
          property_name = $4,
          updated_at = $5
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [
        String(threadID),
        String(senderID),
        targetIndex,
        `${displayName(await db.getUser(threadID, senderID))}'s ${tier.name}`,
        Date.now(),
      ]
    );
    await db.addXP(threadID, senderID, 50);

    await reply(
      api,
      threadID,
      createBox("🏰 DOMAIN EXPANDED", [
        `You now control a ${tier.name}.`,
        `💰 Cost: ${formatCoins(tier.cost)} coins`,
        "🏗️ Build farms, mines, markets, and defenses with !rpg build.",
      ])
    );
  } catch (error) {
    await reply(api, threadID, createError(error.message));
  }
}

async function handleBuild(api, event, args) {
  const { threadID, senderID } = event;
  const state = await getState(threadID, senderID);
  const propertyTier = Number(state.player.property_tier);
  const key = normalizeKey(args[0]);
  const definition = BUILDINGS[key];

  if (!definition) {
    await reply(
      api,
      threadID,
      createError(
        `Usage: !rpg build <${Object.keys(BUILDINGS).join("|")}>`
      )
    );
    return;
  }

  if (propertyTier < 1) {
    await reply(
      api,
      threadID,
      createError("Buy a cottage before building inside your domain.")
    );
    return;
  }

  const existing = await db.query(
    `
    SELECT level
    FROM rpg_buildings
    WHERE thread_id = $1
      AND user_id = $2
      AND building_key = $3
    `,
    [String(threadID), String(senderID), key]
  );
  const currentLevel = Number(existing.rows[0]?.level || 0);
  const nextLevel = currentLevel + 1;
  const cost = definition.baseCost * nextLevel;

  try {
    await db.spendBalance(threadID, senderID, cost, `RPG building: ${key} Lv.${nextLevel}`);
    await db.query(
      `
      INSERT INTO rpg_buildings (
        thread_id,
        user_id,
        building_key,
        level,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (thread_id, user_id, building_key)
      DO UPDATE SET level = EXCLUDED.level,
                    updated_at = EXCLUDED.updated_at
      `,
      [String(threadID), String(senderID), key, nextLevel, Date.now()]
    );
    await db.addXP(threadID, senderID, 15);

    await reply(
      api,
      threadID,
      createBox("🏗️ BUILDING UPGRADED", [
        `${definition.emoji} ${definition.name} is now level ${nextLevel}.`,
        definition.description,
        `💰 Cost: ${formatCoins(cost)} coins`,
      ])
    );
  } catch (error) {
    await reply(api, threadID, createError(error.message));
  }
}

async function handleTrain(api, event, args) {
  const { threadID, senderID } = event;
  const state = await getState(threadID, senderID);
  const type = UNIT_TYPES[normalizeKey(args[0])];
  const amount = Number(args[1]);

  if (!type || !Number.isInteger(amount) || amount <= 0 || amount > 10_000) {
    await reply(
      api,
      threadID,
      createError(
        `Usage: !rpg train <${Object.keys(UNIT_TYPES).join("|")}> <amount>`
      )
    );
    return;
  }

  if (Number(state.player.property_tier) < 1) {
    await reply(
      api,
      threadID,
      createError("Buy a cottage before training a standing army.")
    );
    return;
  }

  const cost = type.cost * amount;

  try {
    await db.spendBalance(threadID, senderID, cost, `RPG training: ${type.name} x${amount}`);
    await db.query(
      `
      UPDATE rpg_armies
      SET ${type.column} = ${type.column} + $3,
          updated_at = $4
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [String(threadID), String(senderID), amount, Date.now()]
    );

    await reply(
      api,
      threadID,
      createBox("⚔️ TRAINING COMPLETE", [
        `${type.emoji} ${type.name}: +${formatCoins(amount)}`,
        `💰 Cost: ${formatCoins(cost)} coins`,
        "Use !rpg army to review your forces.",
      ])
    );
  } catch (error) {
    await reply(api, threadID, createError(error.message));
  }
}

async function handleMarch(api, event, args) {
  const { threadID, senderID } = event;
  const state = await getState(threadID, senderID);
  const destination = regionFor(args.join(" "));

  if (!destination) {
    await reply(
      api,
      threadID,
      createError(
        `Choose a region: ${Object.keys(REGIONS).join(", ")}`
      )
    );
    return;
  }

  if (state.army.status === "marching") {
    await reply(
      api,
      threadID,
      createError(
        `Your army is already marching to ${
          REGIONS[state.army.destination_region]?.name ||
          state.army.destination_region
        }.`
      )
    );
    return;
  }

  const origin = REGIONS[state.player.region_id] || REGIONS.greenvale;
  const troops = totalTroops(state.army);

  if (origin === destination || state.player.region_id === destination.key) {
    await reply(api, threadID, createError("Your army is already in that region."));
    return;
  }

  if (troops <= 0) {
    await reply(api, threadID, createError("Train troops before starting a march."));
    return;
  }

  const distance =
    Math.abs(origin.x - destination.x) +
    Math.abs(origin.y - destination.y);
  const durationMs = Math.ceil(
    Math.max(1, distance) * MARCH_MS_PER_DISTANCE * destination.difficulty
  );
  const departureAt = Date.now();
  const arrivalAt = departureAt + durationMs;

  await db.query(
    `
    UPDATE rpg_armies
    SET status = 'marching',
        destination_region = $3,
        departure_at = $4,
        arrival_at = $5,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [
      String(threadID),
      String(senderID),
      destination.key,
      departureAt,
      arrivalAt,
    ]
  );

  await reply(
    api,
    threadID,
    createBox("🚶 ARMY MARCH", [
      `${origin.emoji} ${origin.name} → ${destination.emoji} ${destination.name}`,
      `🛤️ Distance: ${distance} map steps`,
      `⏳ Travel time: ${formatDuration(durationMs)}`,
      `📅 Arrival: ${formatDate(arrivalAt)} UTC`,
      "",
      "Marches are persisted in the database and resume after restarts.",
      "There is no global maximum march time.",
    ])
  );
}

async function handleClass(api, event, args) {
  const { threadID, senderID } = event;
  await ensurePlayer(threadID, senderID);
  const requested = normalizeKey(args[0]);

  if (!requested || !CLASS_PROFILES[requested]) {
    await reply(
      api,
      threadID,
      createError(
        `Choose a class: ${Object.keys(CLASS_PROFILES).join(", ")}`
      )
    );
    return;
  }

  const characterClass = CLASS_PROFILES[requested];

  await db.query(
    `
    UPDATE rpg_players
    SET character_class = $3,
        updated_at = $4
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [String(threadID), String(senderID), requested, Date.now()]
  );

  await reply(
    api,
    threadID,
    createBox("⚔️ CLASS CHOSEN", [
      `${characterClass.emoji} ${characterClass.name}`,
      `❤️ HP: ${characterClass.hp}`,
      `⚔️ Attack: ${characterClass.attack}`,
      `🛡️ Defense: ${characterClass.defense}`,
    ])
  );
}

async function handleHelp(api, event) {
  await reply(
    api,
    event.threadID,
    createBox("🌑 ECLIPSE RPG", [
      "!rpg profile — character, location, and banking balances",
      "!rpg class knight — choose your character class",
      "!rpg world — list regions and terrain",
      "!rpg kingdom — domain and buildings",
      "!rpg property buy cottage — start your domain",
      "!rpg build farm — develop your domain",
      "!rpg army — inspect your military",
      "!rpg train infantry 10 — train troops",
      "!rpg march ironspine — travel across the map",
      "",
      "RPG purchases use your existing wallet.",
      "Use !withdraw before spending banked coins.",
      "March duration follows distance with no global two-minute cap.",
    ])
  );
}

async function handleRpgCommand(api, event, text, originalText) {
  const cleanText = String(originalText || text || "").trim();

  if (!/^!rpg(?:\s|$)/i.test(cleanText)) {
    return false;
  }

  const parts = cleanText.split(/\s+/);
  const action = normalizeKey(parts[1] || "help");
  const args = parts.slice(2);

  try {
    if (action === "help") await handleHelp(api, event);
    else if (action === "profile" || action === "stats") {
      await handleProfile(api, event);
    } else if (action === "world" || action === "map" || action === "regions") {
      await handleRegions(api, event);
    } else if (action === "class") {
      await handleClass(api, event, args);
    } else if (action === "kingdom" || action === "property") {
      if (action === "property") await handleProperty(api, event, args);
      else await handleKingdom(api, event);
    } else if (action === "build") await handleBuild(api, event, args);
    else if (action === "army") await handleArmy(api, event);
    else if (action === "train") await handleTrain(api, event, args);
    else if (action === "march") await handleMarch(api, event, args);
    else {
      await reply(
        api,
        event.threadID,
        createError("Unknown command. Try !rpg help.")
      );
    }
  } catch (error) {
    console.error("RPG command failed:", error);
    await reply(
      api,
      event.threadID,
      createError("The RPG command could not be completed right now.")
    );
  }

  return true;
}

module.exports = {
  handleRpgCommand,
};