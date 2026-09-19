index v.2
"use strict";

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

const { explore } = require("./exploration");

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
  scoutLocation,
  scoutSummary,
} = require("./scouting");

const {
  ambushArmy,
  raidLocation,
} = require("./warfare");

/* =========================================================
   SPELLS
   (spells.js is the real spell system. ./magic is only a
   migration bridge and is no longer used by this router.)
========================================================= */

const {
  getLearnedSpells,
  getSpell,
  learnSpell,
  validateSpellCast,
} = require("./spells");

/* =========================================================
   NEW AFFINITY SYSTEM
========================================================= */

const {
  AFFINITY_TIERS: NEW_AFFINITY_TIERS,
  getAffinity,
  getAllAffinities,
  getPlayerAffinity,
  getPlayerAffinities,
  getPrimaryAffinity,
  addAffinityMastery,
  unlockAffinity,
  formatAffinity,
} = require("./affinities");

/* =========================================================
   SPECIAL MOVES
========================================================= */

const {
  getSpecial,
  getAllSpecials,
  getSpecialsByAffinity,
  getPlayerSpecials,
  hasSpecial,
  formatSpecial,
} = require("./specials");

/* =========================================================
   SEASONS
========================================================= */

const {
  getWorldSeason,
  getSeason,
  getAllSeasons,
  formatSeason,
} = require("./seasons");

/* =========================================================
   WEATHER
========================================================= */

const {
  getWorldWeather,
  formatWorldConditions,
} = require("./weather");

/* =========================================================
   KINGDOMS / DIPLOMACY
========================================================= */

const {
  KINGDOMS,
  getKingdom,
  getKingdomTerritory,
  kingdomSummary,
  listKingdoms,
  pledgeToKingdom,
} = require("./kingdoms");

const {
  declareWar,
  getAllRelations,
  offerPeace,
} = require("./diplomacy");

/* =========================================================
   PROGRESSION
   (kingdom quests / reputation, affinity browsing, spell
   browsing, special-move info — see PROGRESSION_COMMANDS
   whitelist below for exactly which actions this covers)
========================================================= */

const {
  handleProgressionCommand,
} = require("./progression");

/* =========================================================
   UTILS
========================================================= */

const {
  box,
  errorBox,
  formatDuration,
  formatNumber,
  normalizeKey,
  statLine,
  totalUnits,
} = require("./utils");


/* =========================================================
   PLAYER HELPERS
========================================================= */

function playerName(state) {
  return (
    state.user.display_name ||
    "Player " + state.user.user_id
  );
}

function classLine(player) {
  const definition =
    getClass(player.character_class);

  return (
    definition.emoji +
    " " +
    definition.name
  );
}

function xpForNextLevel(level) {
  return Math.max(
    100,
    Number(level || 1) * 100
  );
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function prettyName(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, char =>
      char.toUpperCase()
    );
}


/* =========================================================
   PROFILE
========================================================= */

async function profileText(state, property) {
  const player = state.player;

  const level =
    Number(state.user.level || 1);

  const xp =
    Number(state.user.xp || 0);

  const nextXp =
    xpForNextLevel(level);

  const tier =
    propertyTier(
      player.property_tier
    );

  let affinityLine =
    "✨ Affinity: Unknown";

  try {
    const primary =
      await getPrimaryAffinity(
        state.player.thread_id ||
          state.threadID ||
          null,
        state.user.user_id
      );

    if (primary) {
      affinityLine =
        "✨ Affinity: " +
        (
          getAffinity(
            primary.affinity_id
          )?.name ||
          prettyName(
            primary.affinity_id
          )
        ) +
        " · " +
        (
          primary.tierName ||
          "None"
        );
    }
  } catch {
    /*
     * Profile must still work if the
     * affinity tables have not initialized yet.
     */
  }

  return box("🌑 ECLIPSE PROFILE", [
    "👤 " + playerName(state),

    classLine(player) +
      " · Level " +
      level,

    statLine(
      "✨",
      "XP",
      xp % nextXp,
      nextXp
    ),

    statLine(
      "❤️",
      "HP",
      player.hp,
      player.max_hp
    ),

    statLine(
      "🔷",
      "MP",
      player.mp,
      player.max_mp
    ),

    statLine(
      "⚡",
      "STA",
      player.stamina,
      player.max_stamina
    ),

    "",

    "⚔️ STR " +
      player.strength +
      " · 🛡️ DEF " +
      player.defense,

    "🏃 AGI " +
      player.agility +
      " · 🧠 INT " +
      player.intelligence,

    "🍀 LUCK " +
      player.luck +
      " · ✨ Renown " +
      player.renown,

    "",

    affinityLine,

    "",

    "🗺️ " +
      (
        REGIONS[
          player.region_id
        ]?.emoji ||
        "🗺️"
      ) +
      " " +
      (
        REGIONS[
          player.region_id
        ]?.name ||
        player.region_id
      ),

    "📍 Location: " +
      (
        player.location_id ||
        "unknown"
      ),

    "🏰 Domain: " +
      tier.name,

    "💰 Wallet: " +
      formatNumber(
        state.user.balance
      ) +
      " coins",

    ...(player.kingdom_id
      ? [
          "",
          "🏰 Kingdom: " +
            (
              KINGDOMS[
                player.kingdom_id
              ]?.name ||
              player.kingdom_id
            ),
        ]
      : []),

    ...(player.traitor
      ? [
          "⚠️ STATUS: TRAITOR",
          "☠️ Former allegiance: " +
            (
              KINGDOMS[
                player.traitor_kingdom_id
              ]?.name ||
              player.traitor_kingdom_id ||
              "Unknown"
            ),
        ]
      : []),
  ]);
}


/* =========================================================
   MESSAGE HELPER
========================================================= */

async function send(
  api,
  threadID,
  text
) {
  await reply(
    api,
    threadID,
    text
  );
}


/* =========================================================
   PROFILE COMMAND
========================================================= */

async function handleProfile(
  api,
  event
) {
  const state =
    await getUserState(
      event.threadID,
      event.senderID
    );

  const property =
    await getProperty(
      event.threadID,
      event.senderID
    );

  await send(
    api,
    event.threadID,
    await profileText(
      state,
      property
    )
  );
}


/* =========================================================
   CLASS
========================================================= */

async function handleClass(
  api,
  event,
  args
) {
  if (!args[0]) {
    const lines =
      Object.entries(CLASSES)
        .map(
          ([key, definition]) =>
            definition.emoji +
            " " +
            key +
            " — " +
            definition.style
        );

    lines.push("");
    lines.push(
      "⚔️ Choose your class:"
    );
    lines.push(
      "!rpg class <name>"
    );

    await send(
      api,
      event.threadID,
      box(
        "⚔️ ECLIPSE CLASSES",
        lines
      )
    );

    return;
  }

  const key =
    getClassKey(args[0]);

  const definition =
    getClass(key);

  await setClass(
    event.threadID,
    event.senderID,
    key
  );

  await send(
    api,
    event.threadID,
    box(
      "⚔️ CLASS CHOSEN",
      [
        definition.emoji +
          " " +
          definition.name,

        "",

        definition.style,

        "",

        "💪 Strengths: " +
          definition.strengths,

        "⚠️ Weaknesses: " +
          definition.weaknesses,

        "",

        "✨ Skills:",
        definition.skills.join(", "),

        "",

        "🌟 Your starting affinity has been initialized.",

        "Use !rpg affinity to view it.",

        "",

        "Use !rpg skills to view your abilities.",
      ]
    )
  );
}


/* =========================================================
   SKILLS
========================================================= */

async function handleSkills(
  api,
  event
) {
  const state =
    await getUserState(
      event.threadID,
      event.senderID
    );

  const skills =
    getSkillsForClass(
      state.player.character_class
    );

  const lines = [];

  for (const skill of skills) {
    lines.push(
      skill.emoji +
        " " +
        skill.name
    );

    lines.push(
      "   🔷 MP: " +
        skill.cost +
        " · ⚡ STA: " +
        skill.stamina
    );

    lines.push(
      "   " +
        skill.effect
    );

    lines.push(
      "   Use: !rpg skill " +
        skill.key
    );

    lines.push("");
  }

  await send(
    api,
    event.threadID,
    box(
      "✨ YOUR SKILLS",
      lines
    )
  );
}


/* =========================================================
   MAGIC OVERVIEW
========================================================= */

async function handleMagic(
  api,
  event
) {
  const threadID =
    event.threadID;

  const userID =
    event.senderID;

  /*
   * getUserState() runs ensurePlayer(), which grants the
   * class starting spells and affinity on first use.
   */
  const state =
    await getUserState(
      threadID,
      userID
    );

  const learned =
    await getLearnedSpells(
      threadID,
      userID
    );

  const lines = [];

  try {
    const primary =
      await getPrimaryAffinity(
        threadID,
        userID
      );

    if (primary) {
      lines.push(
        "🌟 PRIMARY AFFINITY",
        formatAffinity(
          primary.affinity_id,
          primary
        ),
        ""
      );
    }
  } catch {
    /*
     * Magic view must still work if the affinity
     * tables have not initialized yet.
     */
  }

  lines.push(
    statLine(
      "🔷",
      "MP",
      state.player.mp,
      state.player.max_mp
    ),

    "",

    "✨ KNOWN SPELLS"
  );

  if (!learned.length) {
    lines.push(
      "None yet. Starting spells come from your class."
    );
  } else {
    for (const spell of learned) {
      lines.push(
        "✦ " +
          spell.name +
          " — " +
          prettyName(
            spell.affinity
          ) +
          " · " +
          prettyName(
            spell.tier
          ) +
          " · " +
          safeNumber(
            spell.manaCost
          ) +
          " MP"
      );
    }
  }

  lines.push(
    "",
    "🔮 More:",
    "!rpg spells",
    "!rpg affinity",
    "!rpg special",
    "",
    "Cast in combat:",
    "!rpg spell <name>",
    "Utility:",
    "!rpg cast <spell>",
    "Learn:",
    "!rpg learn <spell>"
  );

  await send(
    api,
    threadID,
    box(
      "🔮 MAGIC",
      lines
    )
  );
}


/* =========================================================
   SPECIAL MOVES (combat execution)

   NOTE: Browsing/inspecting special moves ("!rpg special" and
   "!rpg special <name>" when not mid-combat) is now handled by
   progression.js (see handleSpecials there). This function and
   handleSpecialCombat below remain here because actually
   EXECUTING a special move during combat must stay wired into
   the combat engine — progression.js only ever returns
   descriptive text and must never intercept a live cast.
========================================================= */

async function handleSpecial(
  api,
  event,
  args
) {
  const threadID =
    event.threadID;

  const userID =
    event.senderID;

  await ensurePlayer(
    threadID,
    userID
  );

  const action =
    normalizeKey(
      args[0] || "list"
    );

  /* -------------------------------------------------------
     SPECIFIC SPECIAL
  ------------------------------------------------------- */

  if (
    action !== "list" &&
    action !== "all"
  ) {
    const special =
      getSpecial(
        args.join("_")
      );

    if (!special) {
      throw new Error(
        "Unknown special move: " +
          args.join(" ")
      );
    }

    const owned =
      await hasSpecial(
        threadID,
        userID,
        special.id
      );

    const lines = [
      (
        special.emoji ||
        "🌟"
      ) +
        " " +
        special.name,

      "",

      special.description ||
        "A unique special technique.",

      "",

      "📂 Category: " +
        prettyName(
          special.category
        ),

      "🌟 Affinity: " +
        prettyName(
          special.affinity
        ),

      "🔓 Status: " +
        (
          owned
            ? "Unlocked"
            : "Locked"
        ),
    ];

    if (
      special.cooldown
    ) {
      lines.push(
        "⏳ Cooldown: " +
          special.cooldown
      );
    }

    if (
      special.requirements
    ) {
      lines.push(
        "",
        "📜 REQUIREMENTS"
      );

      for (
        const [
          key,
          value,
        ] of Object.entries(
          special.requirements
        )
      ) {
        lines.push(
          "• " +
            prettyName(key) +
            ": " +
            (
              typeof value ===
              "object"
                ? JSON.stringify(value)
                : String(value)
            )
        );
      }
    }

    lines.push(
      "",
      "Use during combat with:",
      "!rpg special " +
        special.id
    );

    await send(
      api,
      threadID,
      box(
        "🌟 SPECIAL MOVE",
        lines
      )
    );

    return;
  }

  /* -------------------------------------------------------
     PLAYER SPECIALS
  ------------------------------------------------------- */

  const owned =
    await getPlayerSpecials(
      threadID,
      userID
    );

  const lines = [
    "🌟 YOUR SPECIAL MOVES",
    "",
  ];

  if (
    !owned ||
    !owned.length
  ) {
    lines.push(
      "No special moves unlocked yet."
    );
  } else {
    for (
      const row of owned
    ) {
      const id =
        row.special_id ||
        row.id;

      const special =
        getSpecial(id);

      if (!special) continue;

      lines.push(
        formatSpecial(
          special
        )
      );

      lines.push("");
    }
  }

  lines.push(
    "━━━━━━━━━━━━━━━━━━━━━━",
    "Special moves are earned through mastery, kingdom quests, bosses, dungeons, and major story events.",
    "",
    "View every special:",
    "!rpg special all"
  );

  if (
    action === "all" ||
    action === "list"
  ) {
    lines.push(
      "",
      "🌌 AVAILABLE SPECIALS"
    );

    for (
      const special of
      getAllSpecials()
    ) {
      lines.push(
        (
          special.emoji ||
          "🌟"
        ) +
          " " +
          special.name +
          " — " +
          prettyName(
            special.category
          )
      );
    }
  }

  await send(
    api,
    threadID,
    box(
      "🌟 SPECIALS",
      lines
    )
  );
}


/* =========================================================
   WORLD CONDITIONS
========================================================= */

async function handleWorldConditions(
  api,
  event
) {
  const threadID =
    event.threadID;

  /*
   * formatWorldConditions() takes the thread ID and
   * retrieves the current persisted world state itself.
   *
   * Do NOT pass it a pre-fetched conditions object.
   */
  const formatted =
    await formatWorldConditions(
      threadID
    );

  await send(
    api,
    threadID,
    box(
      "🌍 WORLD CONDITIONS",
      [
        formatted,

        "",

        "🌟 Affinity effects change with the world.",
        "Nature users may influence weather and seasons.",
      ]
    )
  );
}


/* =========================================================
   SEASON
========================================================= */

async function handleSeason(
  api,
  event
) {
  const threadID =
    event.threadID;

  const season =
    await getWorldSeason(
      threadID
    );

  const definition =
    getSeason(
      season
    );

  const lines = [
    (
      definition?.emoji ||
      definition?.symbol ||
      "🌍"
    ) +
      " Current season: " +
      (
        definition?.name ||
        season
      ),
  ];

  if (
    definition?.description
  ) {
    lines.push(
      "",
      definition.description
    );
  }

  lines.push(
    "",
    "🌱 Seasons affect affinity power, weather probabilities, monsters, and certain abilities.",
    "",
    "Available seasons:"
  );

  for (
    const entry of
    getAllSeasons()
  ) {
    lines.push(
      (
        entry.emoji ||
        entry.symbol ||
        "🌍"
      ) +
        " " +
        entry.name
    );
  }

  await send(
    api,
    threadID,
    box(
      "🌍 SEASONS",
      lines
    )
  );
}


/* =========================================================
   WEATHER
========================================================= */

async function handleWeather(
  api,
  event
) {
  const threadID =
    event.threadID;

  const weather =
    await getWorldWeather(
      threadID
    );

  await send(
    api,
    threadID,
    box(
      "🌦️ WEATHER",
      [
        "Current weather: " +
          prettyName(
            weather
          ),

        "",

        "Weather modifies affinity power, encounters, and certain special abilities.",

        "",

        "View full conditions:",
        "!rpg world",

        "Nature abilities can influence the weather.",
      ]
    )
  );
}


/* =========================================================
   UTILITY SPELL CASTING
========================================================= */

async function handleCast(
  api,
  event,
  args
) {
  if (!args[0]) {
    throw new Error(
      "Choose a utility spell. Example: !rpg cast detect_magic"
    );
  }

  const threadID =
    event.threadID;

  const userID =
    event.senderID;

  const spell =
    getSpell(
      normalizeKey(
        args.join(" ")
      )
    );

  /*
   * spells.js marks utility spells with type "utility"
   * and a `utility` field ("teleport" | "detect").
   */
  if (
    !spell ||
    spell.type !== "utility"
  ) {
    throw new Error(
      "That is not a utility spell. Use !rpg magic to view your spells."
    );
  }

  /*
   * Casting teleport mid-fight would be an escape exploit.
   */
  if (
    await isInActiveCombat(
      threadID,
      userID
    )
  ) {
    throw new Error(
      "You cannot cast utility spells during combat."
    );
  }

  const state =
    await getUserState(
      threadID,
      userID
    );

  /*
   * Covers "not learned" and "not enough MP".
   */
  const check =
    await validateSpellCast(
      threadID,
      userID,
      spell.id,
      {
        currentMP:
          Number(
            state.player.mp
          ),
      }
    );

  if (!check.ok) {
    throw new Error(
      check.reason ||
        "You cannot cast that spell."
    );
  }

  const manaCost =
    safeNumber(
      spell.manaCost
    );

  const remainingMp =
    Number(
      state.player.mp
    ) - manaCost;

  if (
    spell.utility ===
    "teleport"
  ) {
    await updateVitals(
      threadID,
      userID,
      {
        mp: remainingMp,

        location_id:
          "eclipse_castle",

        region_id:
          "greenvale",
      }
    );

    await send(
      api,
      threadID,
      box(
        "🌀 TELEPORTED",
        [
          "✦ " +
            spell.name +
            " pulls you back to Eclipse Castle.",

          "🔷 -" +
            manaCost +
            " MP",
        ]
      )
    );

    return;
  }

  if (
    spell.utility ===
    "detect"
  ) {
    await updateVitals(
      threadID,
      userID,
      {
        mp: remainingMp,
      }
    );

    const region =
      REGIONS[
        state.player.region_id
      ];

    await send(
      api,
      threadID,
      box(
        "🔍 MAGIC DETECTED",
        [
          "✦ " +
            spell.name +
            " reveals the magical currents of " +
            (
              region?.name ||
              state.player.region_id
            ) +
            ".",

          "🌿 Resources: " +
            (
              region?.resources ||
              []
            ).join(", "),

          "⚔️ Combat modifiers: " +
            (
              Object.entries(
                region?.combat ||
                  {}
              )
                .map(
                  ([k, v]) =>
                    k +
                    " x" +
                    v
                )
                .join(", ") ||
              "none"
            ),

          "🔷 -" +
            manaCost +
            " MP",
        ]
      )
    );

    return;
  }

  throw new Error(
    "That utility spell has no usable effect yet."
  );
}


/* =========================================================
   LEARN SPELL
========================================================= */

async function handleLearnSpell(
  api,
  event,
  args
) {
  if (!args[0]) {
    throw new Error(
      "Choose a spell to learn. Example: !rpg learn firebolt"
    );
  }

  /*
   * spells.js signature: learnSpell(thread, user, spellID, options).
   * It returns { success:false, reason } instead of throwing,
   * except when the wallet is too low (db.spendBalance throws).
   */
  const result =
    await learnSpell(
      event.threadID,
      event.senderID,
      normalizeKey(
        args.join(" ")
      )
    );

  if (!result.success) {
    throw new Error(
      result.reason ||
        "You cannot learn that spell."
    );
  }

  await send(
    api,
    event.threadID,
    box(
      "📖 SPELL LEARNED",
      [
        "✦ " +
          result.spell.name,

        "🌟 Affinity: " +
          prettyName(
            result.spell.affinity
          ),

        "💰 Cost: " +
          formatNumber(
            result.cost
          ) +
          " coins",
      ]
    )
  );
}


/* =========================================================
   INVENTORY
========================================================= */

async function handleInventory(
  api,
  event
) {
  const state =
    await getUserState(
      event.threadID,
      event.senderID
    );

  const lines =
    state.inventory.length
      ? state.inventory.map(
          entry =>
            (
              entry.item?.emoji ||
              "🎁"
            ) +
            " " +
            (
              entry.item?.name ||
              entry.item_id
            ) +
            " x" +
            entry.quantity +
            " · " +
            (
              entry.item?.rarity ||
              "Unknown"
            )
        )
      : [
          "🎒 Your inventory is empty.",
          "",
          "Complete hunts, quests, and dungeons",
          "to discover new items.",
        ];

  await send(
    api,
    event.threadID,
    box(
      "🎒 INVENTORY",
      lines
    )
  );
}


/* =========================================================
   EQUIPMENT
========================================================= */

async function handleEquipment(
  api,
  event
) {
  const state =
    await getUserState(
      event.threadID,
      event.senderID
    );

  const lines =
    state.equipment.length
      ? state.equipment.map(
          entry =>
            "🧩 " +
            entry.slot +
            ": " +
            (
              entry.item?.name ||
              entry.item_id
            )
        )
      : [
          "🛡️ No equipment equipped yet.",
          "",
          "Find equipment through",
          "hunts, quests, and dungeons.",
        ];

  await send(
    api,
    event.threadID,
    box(
      "🛡️ EQUIPMENT",
      lines
    )
  );
}


/* =========================================================
   MAP / WORLD
========================================================= */

async function handleMap(
  api,
  event,
  args
) {
  if (
    args[0] &&
    normalizeKey(args[0]) ===
      "locations"
  ) {
    args =
      args.slice(1);
  }

  const region =
    args.length
      ? resolveRegion(
          args.join(" ")
        )
      : null;

  if (region) {
    const locations =
      locationsInRegion(
        region.id
      );

    await send(
      api,
      event.threadID,
      box(
        region.emoji +
          " " +
          region.name,
        [
          "🌎 Terrain: " +
            region.terrain,

          "🌿 Resources: " +
            region.resources.join(", "),

          "",

          "📍 LOCATIONS",

          ...locations.map(
            location =>
              "• " +
              location.name +
              " [" +
              location.id +
              "]"
          ),

          "",

          "🚶 Travel with:",
          "!rpg march <location>",
        ]
      )
    );

    return;
  }

  await send(
    api,
    event.threadID,
    box(
      "🗺️ ECLIPSE WORLD",
      [
        "Explore the regions of Eclipse.",

        "",

        ...Object.entries(
          REGIONS
        ).map(
          ([key, region]) =>
            region.emoji +
            " " +
            region.name +
            " — " +
            region.terrain +
            " [" +
            key +
            "]"
        ),

        "",

        "🌍 Current world:",
        "!rpg world",

        "🌦️ Weather:",
        "!rpg weather",

        "🌱 Season:",
        "!rpg season",

        "",

        "📍 View locations:",
        "!rpg locations <region>",

        "",

        "🚶 Travel:",
        "!rpg march <location>",
      ]
    )
  );
}


/* =========================================================
   PROPERTY / DOMAIN
========================================================= */

async function handleProperty(
  api,
  event,
  args
) {
  const threadID =
    event.threadID;

  const userID =
    event.senderID;

  await ensurePlayer(
    threadID,
    userID
  );

  args =
    Array.isArray(args)
      ? args
      : [];

  const action =
    normalizeKey(
      args[0] || "info"
    );

  if (
    action === "buy"
  ) {
    const target =
      normalizeKey(
        args[1]
      );

    const result =
      await buyProperty(
        threadID,
        userID,
        target
      );

    await send(
      api,
      threadID,
      box(
        "🏰 DOMAIN EXPANDED",
        [
          "👑 You now control a " +
            result.name +
            ".",

          "",

          "💰 Cost: " +
            formatNumber(
              result.cost
            ) +
            " coins",

          "",

          "🏗️ Develop your domain:",
          "!rpg build farm",

          "🛡️ Improve defenses:",
          "!rpg defense walls",
        ]
      )
    );

    return;
  }

  if (
    action === "build"
  ) {
    const result =
      await build(
        threadID,
        userID,
        args[1]
      );

    await send(
      api,
      threadID,
      box(
        "🏗️ BUILDING UPGRADED",
        [
          result.definition.emoji +
            " " +
            result.definition.name,

          "📈 Level: " +
            result.level,

          "💰 Cost: " +
            formatNumber(
              result.cost
            ) +
            " coins",
        ]
      )
    );

    return;
  }

  if (
    action === "defense"
  ) {
    const result =
      await improveDefense(
        threadID,
        userID,
        args[1]
      );

    await send(
      api,
      threadID,
      box(
        "🛡️ DEFENSE IMPROVED",
        [
          result.definition.emoji +
            " " +
            result.definition.name,

          "🛡️ Strength: " +
            result.level +
            "%",

          "💰 Cost: " +
            formatNumber(
              result.cost
            ) +
            " coins",
        ]
      )
    );

    return;
  }

  const property =
    await getProperty(
      threadID,
      userID
    );

  const summary =
    propertySummary(
      property
    );

  const buildings =
    await getBuildings(
      threadID,
      userID
    );

  const buildingLines =
    buildings.length
      ? buildings.map(
          entry =>
            "🏗️ " +
            entry.building_key +
            " Lv." +
            entry.level
        )
      : [
          "No buildings yet.",
          "Use !rpg build <building>",
        ];

  await send(
    api,
    threadID,
    box(
      "🏰 YOUR DOMAIN",
      [
        "🏰 Tier: " +
          summary.tier.name,

        "💰 Maintenance: " +
          summary.maintenanceText,

        "",

        "🛡️ DEFENSE",

        ...Object.entries(
          summary.defense
        ).map(
          ([key, value]) =>
            (
              DEFENSE_PARTS[key]?.emoji ||
              "🛡️"
            ) +
            " " +
            key +
            " " +
            value +
            "%"
        ),

        "",

        "🏗️ BUILDINGS",

        ...buildingLines,

        "",

        "⬆️ Upgrade property:",
        "!rpg property buy <tier>",
      ]
    )
  );
}


/* =========================================================
   KINGDOM

   NOTE: This is the world-lore / diplomacy view of kingdoms
   (KINGDOMS from ./kingdoms, relations from ./diplomacy),
   including the "!rpg kingdom pledge <name>" subcommand.
   It is intentionally kept separate from progression.js's
   "!rpg kingdoms" (plural) and "!rpg pledge <name>" commands,
   which layer kingdom QUESTS and reputation on top via
   ./kingdom-quests. Routing "kingdom" (singular) through
   progression would silently break the pledge subcommand
   below, so it stays handled here.
========================================================= */

async function handleKingdomInfo(
  api,
  event,
  args
) {
  await ensurePlayer(
    event.threadID,
    event.senderID
  );

  if (!args[0]) {
    const kingdoms =
      await listKingdoms(
        event.threadID
      );

    await send(
      api,
      event.threadID,
      box(
        "🏰 KINGDOMS OF ECLIPSE",
        kingdoms
          .flatMap(
            kingdom => [
              (
                KINGDOMS[
                  kingdom.kingdom_id
                ]?.emoji ||
                "🏰"
              ) +
                " " +
                kingdom.name,

              "   Specialization: " +
                kingdom.specialization,

              "",
            ]
          )
          .concat([
            "View details: !rpg kingdom <name>",
            "Pledge allegiance: !rpg kingdom pledge <name>",
            "Kingdom quests & reputation: !rpg kingdoms",
          ])
      )
    );

    return;
  }

  if (
    normalizeKey(args[0]) ===
    "pledge"
  ) {
    if (!args[1]) {
      throw new Error(
        "Choose a kingdom to pledge to."
      );
    }

    const kingdom =
      await pledgeToKingdom(
        event.threadID,
        event.senderID,
        args.slice(1).join(" ")
      );

    await send(
      api,
      event.threadID,
      box(
        "🏰 ALLEGIANCE PLEDGED",
        [
          "You have pledged fealty to " +
            kingdom.name +
            ".",
        ]
      )
    );

    return;
  }

  const kingdom =
    await getKingdom(
      event.threadID,
      args.join(" ")
    );

  if (!kingdom) {
    throw new Error(
      "Choose a kingdom: " +
        Object.keys(
          KINGDOMS
        ).join(", ") +
        "."
    );
  }

  const territory =
    await getKingdomTerritory(
      event.threadID,
      kingdom.kingdom_id
    );

  const relations =
    await getAllRelations(
      event.threadID,
      kingdom.kingdom_id
    );

  await send(
    api,
    event.threadID,
    box(
      "🏰 " +
        kingdom.name.toUpperCase(),
      [
        ...kingdomSummary(
          kingdom,
          territory
        ),

        "",

        "🤝 RELATIONS",

        ...(
          relations.length
            ? relations.map(
                r =>
                  r.kingdom.name +
                  ": " +
                  r.status
              )
            : [
                "No diplomatic relations recorded.",
              ]
        ),
      ]
    )
  );
}


/* =========================================================
   DIPLOMACY
========================================================= */

async function handleDiplomacy(
  api,
  event,
  args
) {
  const action =
    normalizeKey(
      args[0] || ""
    );

  if (
    action === "war"
  ) {
    if (
      !args[1] ||
      !args[2]
    ) {
      throw new Error(
        "Usage: !rpg diplomacy war <kingdomA> <kingdomB>"
      );
    }

    const result =
      await declareWar(
        event.threadID,
        args[1],
        args[2]
      );

    await send(
      api,
      event.threadID,
      box(
        "⚔️ WAR DECLARED",
        [
          result.attacker.name +
            " has declared war on " +
            result.defender.name +
            ".",
        ]
      )
    );

    return;
  }

  if (
    action === "peace"
  ) {
    if (
      !args[1] ||
      !args[2]
    ) {
      throw new Error(
        "Usage: !rpg diplomacy peace <kingdomA> <kingdomB>"
      );
    }

    const result =
      await offerPeace(
        event.threadID,
        args[1],
        args[2]
      );

    await send(
      api,
      event.threadID,
      box(
        result.accepted
          ? "🕊️ PEACE ACCEPTED"
          : "🕊️ PEACE REJECTED",
        [
          result.accepted
            ? result.kingdomA.name +
              " and " +
              result.kingdomB.name +
              " are now at peace."
            : result.kingdomB.name +
              " rejected the peace offer.",
        ]
      )
    );

    return;
  }

  throw new Error(
    "Usage: !rpg diplomacy war <a> <b> | !rpg diplomacy peace <a> <b>"
  );
}


/* =========================================================
   ARMY
========================================================= */

async function handleArmy(
  api,
  event,
  args
) {
  const threadID =
    event.threadID;

  const userID =
    event.senderID;

  await ensurePlayer(
    threadID,
    userID
  );

  if (
    args[0] &&
    normalizeKey(args[0]) ===
      "train"
  ) {
    const result =
      await train(
        threadID,
        userID,
        args[1],
        args[2]
      );

    await send(
      api,
      threadID,
      box(
        "⚔️ TRAINING COMPLETE",
        [
          result.unit.emoji +
            " " +
            result.unit.name +
            ": +" +
            formatNumber(
              result.count
            ),

          "💰 Cost: " +
            formatNumber(
              result.cost
            ) +
            " coins",

          "",

          "View your army with:",
          "!rpg army",
        ]
      )
    );

    return;
  }

  if (
    args[0] &&
    normalizeKey(args[0]) ===
      "formation"
  ) {
    if (!args[1]) {
      await send(
        api,
        threadID,
        box(
          "⚔️ ARMY FORMATIONS",
          Object.entries(
            FORMATIONS
          ).flatMap(
            ([key, value]) => [
              value.emoji +
                " " +
                key,

              "   ⚔️ Attack: " +
                value.attack,

              "   🛡️ Defense: " +
                value.defense,

              "",
            ]
          )
        )
      );

      return;
    }

    const result =
      await setFormation(
        threadID,
        userID,
        args[1]
      );

    await send(
      api,
      threadID,
      box(
        "⚔️ FORMATION SET",
        [
          result.emoji +
            " " +
            result.name,

          "",

          "⚔️ Attack modifier: " +
            result.attack,

          "🛡️ Defense modifier: " +
            result.defense,
        ]
      )
    );

    return;
  }

  if (
    args[0] &&
    normalizeKey(args[0]) ===
      "regiment"
  ) {
    if (
      normalizeKey(args[1]) ===
      "create"
    ) {
      const result =
        await require("./army")
          .createRegiment(
            threadID,
            userID,
            args[2],
            args[3],
            args[4]
          );

      await send(
        api,
        threadID,
        box(
          "🪖 REGIMENT FORMED",
          [
            "🏷️ " +
              result.name,

            "⚔️ " +
              result.unit_type +
              " x" +
              result.count,

            "⭐ Tier: " +
              result.experience_tier,
          ]
        )
      );

      return;
    }

    const regiments =
      await getRegiments(
        threadID,
        userID
      );

    await send(
      api,
      threadID,
      box(
        "🪖 REGIMENTS",
        regiments.length
          ? regiments.map(
              entry =>
                entry.name +
                " — " +
                entry.unit_type +
                " x" +
                entry.count
            )
          : [
              "No regiments formed yet.",
              "",
              "Create one with:",
              "!rpg army regiment create <name> <unit> <amount>",
            ]
      )
    );

    return;
  }

  const army =
    await getArmy(
      threadID,
      userID
    );

  await send(
    api,
    threadID,
    box(
      "⚔️ YOUR ARMY",
      [
        "👥 Total troops: " +
          formatNumber(
            totalUnits(army)
          ),

        "📍 Region: " +
          army.region_id,

        "⚔️ Formation: " +
          army.formation,

        "📦 Supplies: " +
          army.supplies +
          "%",

        "",

        "⚔️ Infantry: " +
          formatNumber(
            army.infantry
          ),

        "🔱 Spearmen: " +
          formatNumber(
            army.spearmen
          ),

        "🛡️ Heavy Swordsmen: " +
          formatNumber(
            army.heavy_swordsmen
          ),

        "🏹 Archers: " +
          formatNumber(
            army.archers
          ),

        "🐎 Cavalry: " +
          formatNumber(
            army.cavalry
          ),

        "🔷 Mages: " +
          formatNumber(
            army.mages
          ),

        "🗡️ Assassins: " +
          formatNumber(
            army.assassins
          ),

        "🛡️ Shielders: " +
          formatNumber(
            army.shielders
          ),

        "",

        "⚔️ Train troops:",
        "!rpg army train <unit> <amount>",

        "🛡️ Change formation:",
        "!rpg army formation <name>",
      ]
    )
  );
}


/* =========================================================
   MARCH
========================================================= */

async function handleMarch(
  api,
  event,
  args
) {
  await ensurePlayer(
    event.threadID,
    event.senderID
  );

  const action =
    normalizeKey(
      args[0] || "status"
    );

  if (
    action === "status"
  ) {
    const status =
      await marchStatus(
        event.threadID,
        event.senderID
      );

    await send(
      api,
      event.threadID,
      box(
        "🚶 MARCH STATUS",
        marchSummary(status).lines
      )
    );

    return;
  }

  const result =
    await startMarch(
      event.threadID,
      event.senderID,
      args.join(" ")
    );

  await send(
    api,
    event.threadID,
    box(
      "🚶 ARMY MARCH",
      [
        "📍 " +
          (
            result.origin.name ||
            result.origin.id
          ) +
          " → " +
          (
            result.destination.name ||
            result.destination.id
          ),

        "🛤️ Distance: " +
          result.distance +
          " map steps",

        "⏳ Travel time: " +
          formatDuration(
            result.duration
          ),

        "👥 Army: " +
          formatNumber(
            result.armySize
          ) +
          " soldiers",

        "",

        "Check progress with:",
        "!rpg march status",
      ]
    )
  );
}


/* =========================================================
   COMBAT
========================================================= */

async function handleCombat(
  api,
  event,
  action,
  args
) {
  const threadID =
    event.threadID;

  const userID =
    event.senderID;

  /*
   * combat.js result shapes:
   *
   *   createHunt()   -> { success, combat, enemy, reason }
   *   combatAction() -> { ok, active, victory, defeat, escaped,
   *                       messages, reason, reward, xp, loot }
   */

  if (
    action === "hunt"
  ) {
    const hunt =
      await createHunt(
        threadID,
        userID
      );

    if (
      !hunt ||
      !hunt.combat
    ) {
      throw new Error(
        hunt?.reason ||
          "You could not start a hunt right now."
      );
    }

    const state =
      await getUserState(
        threadID,
        userID
      );

    /*
     * If the player was already in combat, createHunt()
     * returns success:false with the existing session.
     * Show that session with the reason as the notice.
     */
    await send(
      api,
      threadID,
      renderCombat(
        hunt.combat,
        state.player,
        hunt.success === false
          ? hunt.reason
          : null
      )
    );

    return;
  }

  const result =
    await combatAction(
      threadID,
      userID,
      action,
      args.join(" ")
    );

  if (
    !result ||
    result.ok === false
  ) {
    throw new Error(
      result?.reason ||
        "That combat action failed."
    );
  }

  const messages =
    Array.isArray(
      result.messages
    )
      ? result.messages
      : [];

  if (
    result.active
  ) {
    const session =
      await getCombat(
        threadID,
        userID
      );

    const state =
      await getUserState(
        threadID,
        userID
      );

    await send(
      api,
      threadID,
      renderCombat(
        session,
        state.player,
        messages.join("\n")
      )
    );

    return;
  }

  if (
    result.victory
  ) {
    try {
      await registerHuntProgress(
        threadID,
        userID
      );
    } catch (error) {
      /*
       * Rewards are already granted; a progress-tracking
       * failure must not replace the victory message.
       */
      console.error(
        "[RPG] Hunt progress failed:",
        error
      );
    }

    const lines = [
      ...messages,
    ];

    if (
      Array.isArray(
        result.loot
      ) &&
      result.loot.length
    ) {
      lines.push(
        "",
        "🎁 Loot: " +
          result.loot
            .map(
              id =>
                getItem(id)?.name ||
                prettyName(id)
            )
            .join(", ")
      );
    }

    await send(
      api,
      threadID,
      box(
        "🏆 VICTORY",
        lines
      )
    );

    return;
  }

  if (
    result.escaped
  ) {
    await send(
      api,
      threadID,
      box(
        "🏃 ESCAPED",
        messages
      )
    );

    return;
  }

  await send(
    api,
    threadID,
    box(
      "💀 DEFEAT",
      messages
    )
  );
}


/* =========================================================
   SPECIAL COMBAT COMMAND

   IMPORTANT: this is what actually casts a special move
   during a live fight. It must never be replaced by
   progression.js's info-only "!rpg special" handler — see
   the whitelist notes on PROGRESSION_COMMANDS below.
========================================================= */

async function handleSpecialCombat(
  api,
  event,
  args
) {
  if (!args.length) {
    await handleSpecial(
      api,
      event,
      ["list"]
    );

    return;
  }

  /*
   * Specials are executed by the combat engine.
   */
  await handleCombat(
    api,
    event,
    "special",
    args
  );
}


/* =========================================================
   ACTIVE COMBAT CHECK

   Used by the special-move router to decide between
   inspecting a special (no fight) and casting it (live fight).
   Any failure to read combat state is treated as "not in
   combat" so browsing specials always keeps working.
========================================================= */

async function isInActiveCombat(
  threadID,
  userID
) {
  try {
    const combat =
      await getCombat(
        threadID,
        userID
      );

    return Boolean(
      combat &&
      (
        combat.status === "active" ||
        combat.state === "active"
      )
    );
  } catch {
    return false;
  }
}


/* =========================================================
   EXPLORE
========================================================= */

async function handleExplore(
  api,
  event
) {
  const threadID =
    event.threadID;

  const userID =
    event.senderID;

  await ensurePlayer(
    threadID,
    userID
  );

  let result;

  try {
    result =
      await explore(
        threadID,
        userID
      );
  } catch (error) {
    const lines = [
      error.message ||
        "You couldn't explore right now.",
    ];

    if (
      error.dorianLine
    ) {
      lines.push(
        "",
        "🧑‍🏫 Dorian: " +
          error.dorianLine
      );
    }

    await send(
      api,
      threadID,
      errorBox(
        lines.join("\n")
      )
    );

    return;
  }

  if (
    result.outcomeType ===
      "encounter" ||
    result.outcomeType ===
      "elite_encounter"
  ) {
    const state =
      await getUserState(
        threadID,
        userID
      );

    const combat =
      result.hunt?.combat;

    if (!combat) {
      await send(
        api,
        threadID,
        errorBox(
          result.hunt?.reason ||
            "The encounter could not be started."
        )
      );

      return;
    }

    const heading =
      result.outcomeType ===
      "elite_encounter"
        ? "👹 AN ELITE MONSTER APPEARED!"
        : "🌲 YOU ENCOUNTERED SOMETHING!";

    await send(
      api,
      threadID,
      renderCombat(
        combat,
        state.player,
        [
          heading,
          "",
          "🧑‍🏫 Dorian: " +
            result.dorianLine,
        ].join("\n")
      )
    );

    return;
  }

  if (
    result.outcomeType ===
    "gold"
  ) {
    await send(
      api,
      threadID,
      box(
        "🌲 EXPLORATION",
        [
          "💰 You discovered " +
            formatNumber(
              result.gold
            ) +
            " coins.",

          "",

          "🧑‍🏫 Dorian: " +
            result.dorianLine,
        ]
      )
    );

    return;
  }

  if (
    result.outcomeType ===
    "item"
  ) {
    await send(
      api,
      threadID,
      box(
        "🌲 EXPLORATION",
        [
          "💎 You found " +
            (
              result.item?.emoji ||
              "🎁"
            ) +
            " " +
            (
              result.item?.name ||
              "a rare material"
            ) +
            ".",

          "",

          "🧑‍🏫 Dorian: " +
            result.dorianLine,
        ]
      )
    );

    return;
  }

  await send(
    api,
    threadID,
    box(
      "🌲 EXPLORATION",
      [
        "Nothing but wind and old footprints.",

        "",

        "🧑‍🏫 Dorian: " +
          result.dorianLine,
      ]
    )
  );
}


/* =========================================================
   QUESTS
========================================================= */

async function handleQuest(
  api,
  event,
  args
) {
  const quest =
    args[0] &&
    normalizeKey(args[0]) ===
      "claim"
      ? await claimQuest(
          event.threadID,
          event.senderID
        )
      : await getQuest(
          event.threadID,
          event.senderID
        );

  await send(
    api,
    event.threadID,
    box(
      "📜 QUESTS",
      questSummary(
        quest
      )
    )
  );
}


/* =========================================================
   DUNGEONS
========================================================= */

async function handleDungeon(
  api,
  event,
  args
) {
  await ensurePlayer(
    event.threadID,
    event.senderID
  );

  const action =
    normalizeKey(
      args[0] || "status"
    );

  if (
    action === "enter"
  ) {
    const result =
      await enterDungeon(
        event.threadID,
        event.senderID,
        normalizeKey(
          args[1] ||
            "abyssal_crypt"
        )
      );

    await send(
      api,
      event.threadID,
      box(
        "🏰 DUNGEON ENTERED",
        [
          result.definition.emoji +
            " " +
            result.definition.name,

          "🏰 Floors: " +
            result.definition.floors,

          "",

          "Advance with:",
          "!rpg dungeon advance",
        ]
      )
    );

    return;
  }

  if (
    action === "advance"
  ) {
    const result =
      await advanceDungeon(
        event.threadID,
        event.senderID
      );

    await send(
      api,
      event.threadID,
      box(
        "🏰 DUNGEON",
        [
          result.message,

          ...(result.reward
            ? [
                "💰 " +
                  result.reward.reward +
                  " coins",

                "✨ " +
                  result.reward.xp +
                  " XP",
              ]
            : []),
        ]
      )
    );

    return;
  }

  const dungeon =
    await getDungeon(
      event.threadID,
      event.senderID
    );

  await send(
    api,
    event.threadID,
    box(
      "🏰 DUNGEON",
      dungeon
        ? [
            "🏰 " +
              dungeon.dungeon_key,

            "📍 Stage " +
              dungeon.stage +
              "/" +
              dungeon.max_stage,

            "",

            "Advance with:",
            "!rpg dungeon advance",
          ]
        : [
            "No active dungeon.",

            "",

            "Enter one with:",
            "!rpg dungeon enter abyssal_crypt",
          ]
    )
  );
}


/* =========================================================
   REST
========================================================= */

async function handleRest(
  api,
  event
) {
  const state =
    await getUserState(
      event.threadID,
      event.senderID
    );

  await updateVitals(
    event.threadID,
    event.senderID,
    {
      hp: state.player.max_hp,
      mp: state.player.max_mp,
      stamina:
        state.player.max_stamina,
      status: "active",
    }
  );

  await send(
    api,
    event.threadID,
    box(
      "🛏️ RESTED",
      [
        "❤️ HP restored to " +
          state.player.max_hp,

        "🔷 MP restored to " +
          state.player.max_mp,

        "⚡ Stamina restored to " +
          state.player.max_stamina,

        "",

        "You are ready for your next adventure.",
      ]
    )
  );
}


/* =========================================================
   SCOUT
========================================================= */

async function handleScout(
  api,
  event,
  args
) {
  const report =
    await scoutLocation(
      event.threadID,
      event.senderID,
      args.join(" ")
    );

  await send(
    api,
    event.threadID,
    box(
      "🔭 SCOUTING REPORT",
      scoutSummary(
        report
      )
    )
  );
}


/* =========================================================
   RAID
========================================================= */

async function handleRaid(
  api,
  event,
  args
) {
  const result =
    await raidLocation(
      event.threadID,
      event.senderID,
      args.join(" ")
    );

  await send(
    api,
    event.threadID,
    box(
      "🔥 RAID SUCCESSFUL",
      [
        "🏘️ Target: " +
          result.location.name,

        "💰 Looted: " +
          formatNumber(
            result.lootGold
          ) +
          " coins",

        "🛡️ Garrison weakened by " +
          formatNumber(
            result.garrisonLoss
          ),

        "",

        "⚠️ Reputation -5. Hostility in this region has risen.",
      ]
    )
  );
}


/* =========================================================
   AMBUSH
========================================================= */

async function handleAmbush(
  api,
  event,
  args
) {
  const targetID =
    event.messageReply?.senderID ||
    args[0];

  if (!targetID) {
    throw new Error(
      "Reply to the player you want to ambush, or use !rpg ambush <userID>."
    );
  }

  const result =
    await ambushArmy(
      event.threadID,
      event.senderID,
      targetID
    );

  await send(
    api,
    event.threadID,
    box(
      result.attackerWins
        ? "⚔️ AMBUSH SUCCESSFUL"
        : "⚔️ AMBUSH REPELLED",
      [
        result.surprise
          ? "🌑 Surprise achieved."
          : "👁️ The enemy spotted you coming.",

        "☠️ Your losses: " +
          formatNumber(
            result.attackerLosses
          ),

        "☠️ Enemy losses: " +
          formatNumber(
            result.defenderLosses
          ),

        ...(result.lootGold
          ? [
              "💰 Looted: " +
                formatNumber(
                  result.lootGold
                ) +
                " coins",
            ]
          : []),

        "",

        "⚠️ Reputation -8.",
      ]
    )
  );
}


/* =========================================================
   HELP CATEGORIES
========================================================= */

const HELP_CATEGORIES = {
  character: {
    emoji: "👤",
    title: "👤 CHARACTER",
    summary: "Profile, class, skills, inventory, equipment.",
    lines: [
      "▶ !rpg profile — View your character and stats.",
      "▶ !rpg class — View available classes.",
      "▶ !rpg class <name> — Choose your class.",
      "▶ !rpg skills — View your class skills.",
      "▶ !rpg inventory — View your RPG inventory.",
      "▶ !rpg equipment — View equipped items.",
    ],
  },

  affinities: {
    emoji: "🌟",
    title: "🌟 AFFINITIES",
    summary: "Your elemental/affinity path and mastery.",
    lines: [
      "▶ !rpg affinity — View your affinities and mastery.",
      "▶ !rpg affinity list — View every affinity in Eclipse.",
      "▶ !rpg affinity <name> — Inspect an affinity.",
      "▶ !rpg affinity learn <name> — Unlock an affinity.",
      "▶ !rpg affinity mastery <name> — View mastery progression.",
    ],
  },

  magic: {
    emoji: "🔮",
    title: "🔮 MAGIC",
    summary: "Spells, spellbook, and utility casting.",
    lines: [
      "▶ !rpg magic — View your magic overview.",
      "▶ !rpg spells — View your spellbook.",
      "▶ !rpg spells <affinity> — View spells for an affinity.",
      "▶ !rpg spell <name> — Cast a spell during combat.",
      "▶ !rpg learn <spell> — Learn a spell.",
      "▶ !rpg cast <spell> — Cast a utility spell.",
    ],
  },

  specials: {
    emoji: "🌟",
    title: "🌟 SPECIAL MOVES",
    summary: "Unlocked and available special moves.",
    lines: [
      "▶ !rpg special — View your unlocked special moves.",
      "▶ !rpg special all — View every special move.",
      "▶ !rpg special <name> — Inspect a special move (or cast it during combat).",
    ],
  },

  adventure: {
    emoji: "⚔️",
    title: "⚔️ ADVENTURE",
    summary: "Hunting, exploring, and combat actions.",
    lines: [
      "▶ !rpg hunt — Start a battle.",
      "▶ !rpg explore — Explore the current region.",
      "▶ !rpg attack — Attack during combat.",
      "▶ !rpg skill <name> — Use a combat skill.",
      "▶ !rpg spell <name> — Use a spell during combat.",
      "▶ !rpg special <name> — Use a special move during combat.",
      "▶ !rpg defend — Defend against the next attack.",
      "▶ !rpg item <name> — Use an item during combat.",
      "▶ !rpg rest — Restore HP, MP, and stamina.",
    ],
  },

  world: {
    emoji: "🌍",
    title: "🌍 WORLD",
    summary: "Map, regions, season, weather, travel.",
    lines: [
      "▶ !rpg map — View world regions.",
      "▶ !rpg locations <region> — View locations in a region.",
      "▶ !rpg world — View season, weather, and world conditions.",
      "▶ !rpg season — View the current season.",
      "▶ !rpg weather — View the current weather.",
      "▶ !rpg march <location> — Travel to another location.",
      "▶ !rpg march status — Check your march.",
    ],
  },

  domain: {
    emoji: "🏰",
    title: "🏰 DOMAIN",
    summary: "Property, buildings, and defenses.",
    lines: [
      "▶ !rpg property — View your domain.",
      "▶ !rpg domain — Alias for !rpg property.",
      "▶ !rpg property buy <tier> — Purchase or upgrade property.",
      "▶ !rpg build <building> — Build or upgrade a building.",
      "▶ !rpg defense <part> — Improve defenses.",
    ],
  },

  kingdoms: {
    emoji: "🏰",
    title: "🏰 KINGDOMS & DIPLOMACY",
    summary: "Kingdom lore, pledging, wars, and reputation.",
    lines: [
      "▶ !rpg kingdom — View the kingdoms of Eclipse.",
      "▶ !rpg kingdom <name> — View kingdom information.",
      "▶ !rpg kingdom pledge <name> — Pledge allegiance.",
      "▶ !rpg kingdoms — View kingdom quests and your reputation.",
      "▶ !rpg pledge <name> — Pledge allegiance (reputation track).",
      "▶ !rpg diplomacy war <a> <b> — Declare kingdom war.",
      "▶ !rpg diplomacy peace <a> <b> — Offer peace.",
    ],
  },

  army: {
    emoji: "⚔️",
    title: "⚔️ ARMY",
    summary: "Troops, training, formations, regiments.",
    lines: [
      "▶ !rpg army — View your army.",
      "▶ !rpg army train <unit> <amount> — Train troops.",
      "▶ !rpg army formation <name> — Change formation.",
      "▶ !rpg army regiment — View regiments.",
      "▶ !rpg army regiment create <name> <unit> <amount> — Form a regiment.",
    ],
  },

  scouting: {
    emoji: "🔭",
    title: "🔭 SCOUTING & WARFARE",
    summary: "Scouting, raiding, and ambushing other players.",
    lines: [
      "▶ !rpg scout <location> — Scout a location.",
      "▶ !rpg raid <location> — Raid a location.",
      "▶ !rpg ambush <userID> — Ambush another player's army.",
    ],
  },

  quests: {
    emoji: "📜",
    title: "📜 QUESTS",
    summary: "Track and claim your current quest.",
    lines: [
      "▶ !rpg quest — View your current quest.",
      "▶ !rpg quest claim — Claim a completed quest.",
    ],
  },

  dungeons: {
    emoji: "🏰",
    title: "🏰 DUNGEONS",
    summary: "Enter and advance through dungeons.",
    lines: [
      "▶ !rpg dungeon — View dungeon status.",
      "▶ !rpg dungeon enter <key> — Enter a dungeon.",
      "▶ !rpg dungeon advance — Advance through a dungeon.",
    ],
  },
};

async function handleHelp(
  api,
  event,
  args = []
) {
  const category =
    normalizeKey(
      args[0] || ""
    );

  if (
    category &&
    HELP_CATEGORIES[category]
  ) {
    const section =
      HELP_CATEGORIES[category];

    await send(
      api,
      event.threadID,
      box(
        section.title,
        [
          ...section.lines,
          "",
          "◀ Back to categories: !rpg help",
        ]
      )
    );

    return;
  }

  if (category) {
    await send(
      api,
      event.threadID,
      errorBox([
        "Unknown help category: " +
          category,

        "",

        "Use !rpg help to see all categories.",
      ])
    );

    return;
  }

  const lines =
    Object.entries(
      HELP_CATEGORIES
    ).map(
      ([key, section]) =>
        section.emoji +
        " !rpg help " +
        key +
        " — " +
        section.summary
    );

  lines.push(
    "",
    "Use !rpg help <category> to view its commands.",
    "",
    "💡 Tip: most browsing commands also work without the \"rpg\" — e.g. !kingdom works the same as !rpg kingdom."
  );

  await send(
    api,
    event.threadID,
    box(
      "🌑 ECLIPSE RPG — HELP",
      lines
    )
  );
}


/* =========================================================
   PROGRESSION ROUTING

   These are the ONLY actions handed off to progression.js.
   "kingdom" (singular) and "special"/"specials" are
   deliberately excluded:

     - "kingdom" is handled above by handleKingdomInfo, which
       supports "!rpg kingdom pledge <name>". progression.js's
       kingdom-profile handler has no pledge subcommand, so
       routing "kingdom" through it would silently break
       pledging.

     - "special"/"specials" must stay wired to handleSpecial /
       handleSpecialCombat below, because casting a special
       move in live combat has to reach the combat engine.
       progression.js's version is informational only and
       would silently stop casts from working if it took over.

   "kingdoms" (plural) and "pledge" are new, non-conflicting
   top-level commands that only progression.js implements.
   "affinity"/"affinities" and "spells"/"spellbook" are fully
   owned by progression.js now — the old local handlers for
   these were removed from this router.
========================================================= */

const PROGRESSION_COMMANDS = new Set([
  "kingdoms",
  "pledge",
  "affinity",
  "affinities",
  "spells",
  "spellbook",
]);


/* =========================================================
   TOP-LEVEL ALIASES

   "!rpg kingdom" and "!kingdom" now do the same thing. Every
   action below can be triggered either with the "!rpg" prefix
   or as a bare "!<action>" command.

   Combat-only actions ("attack", "defend", "skill", "spell",
   "item", "hunt") are deliberately left OUT of this set: those
   stay under "!rpg" only, since a bare "!attack" or "!item"
   would be far too easy to fire by accident from normal chat,
   and "hunt"/"skill"/"spell" already double as words people
   type in plain conversation. Everything here is a browsing /
   informational / setup command, where a stray trigger is low
   consequence.

   If your bot has other top-level "!word" commands elsewhere,
   check for collisions before adding a new entry here — a bare
   alias only fires if nothing else claims that word first
   (whichever command handler runs first in your message router
   wins).
========================================================= */

const TOP_LEVEL_ALIASES = new Set([
  "help",
  "profile",
  "class",
  "skills",
  "magic",
  "learn",
  "cast",
  "special",
  "specials",
  "inventory",
  "inv",
  "equipment",
  "map",
  "world",
  "regions",
  "locations",
  "season",
  "seasons",
  "weather",
  "conditions",
  "property",
  "domain",
  "kingdom",
  "kingdoms",
  "pledge",
  "diplomacy",
  "build",
  "defense",
  "army",
  "train",
  "formation",
  "regiment",
  "regiments",
  "march",
  "travel",
  "scout",
  "raid",
  "ambush",
  "explore",
  "quest",
  "dungeon",
  "rest",
  "affinity",
  "affinities",
]);


/* =========================================================
   MAIN RPG COMMAND ROUTER
========================================================= */

async function handleRpgCommand(
  api,
  event,
  text,
  originalText
) {
  const cleanText =
    String(
      originalText ||
      text ||
      ""
    ).trim();

  let action;
  let args;

  if (
    /^!rpg(?:\s|$)/i.test(
      cleanText
    )
  ) {
    /*
     * "!rpg <action> <args...>"
     */
    const parts =
      cleanText.split(/\s+/);

    action =
      normalizeKey(
        parts[1] ||
          "help"
      );

    args =
      parts.slice(2);
  } else {
    /*
     * Bare top-level alias: "!<action> <args...>".
     * Only recognized words in TOP_LEVEL_ALIASES fire here —
     * anything else is left alone so other command handlers
     * (and normal chat starting with "!") are unaffected.
     */
    const bareMatch =
      cleanText.match(/^!(\S+)/);

    if (!bareMatch) {
      return false;
    }

    const bareAction =
      normalizeKey(
        bareMatch[1]
      );

    if (
      !TOP_LEVEL_ALIASES.has(
        bareAction
      )
    ) {
      return false;
    }

    action = bareAction;

    args =
      cleanText
        .split(/\s+/)
        .slice(1);
  }

  /* =====================================================
     PROGRESSION (whitelisted actions only — see notes above)
  ===================================================== */

  if (PROGRESSION_COMMANDS.has(action)) {
    try {
      const progressionResult =
        await handleProgressionCommand(
          event.threadID,
          event.senderID,
          action,
          args
        );

      if (progressionResult !== null) {
        await send(
          api,
          event.threadID,
          progressionResult
        );

        return true;
      }
      /*
       * progressionResult === null falls through to the
       * normal router below, in case progression.js decides
       * it doesn't own this particular action after all.
       */
    } catch (error) {
      console.error(
        "[RPG] Progression command failed:",
        error
      );

      await send(
        api,
        event.threadID,
        errorBox(
          error.message ||
            "The progression system could not complete that command."
        )
      );

      return true;
    }
  }

  try {

    /* =====================================================
       HELP
    ===================================================== */

    if (
      action === "help"
    ) {
      await handleHelp(
        api,
        event,
        args
      );
    }

    /* =====================================================
       PROFILE
    ===================================================== */

    else if (
      action === "start" ||
      action === "profile" ||
      action === "stats"
    ) {
      await handleProfile(
        api,
        event
      );
    }

    /* =====================================================
       CLASS
    ===================================================== */

    else if (
      action === "class"
    ) {
      await handleClass(
        api,
        event,
        args
      );
    }

    /* =====================================================
       SKILLS
    ===================================================== */

    else if (
      action === "skills"
    ) {
      await handleSkills(
        api,
        event
      );
    }

    /* =====================================================
       MAGIC
    ===================================================== */

    else if (
      action === "magic"
    ) {
      await handleMagic(
        api,
        event
      );
    }

    /* =====================================================
       LEARN SPELL
    ===================================================== */

    else if (
      action === "learn"
    ) {
      await handleLearnSpell(
        api,
        event,
        args
      );
    }

    /* =====================================================
       UTILITY CAST
    ===================================================== */

    else if (
      action === "cast"
    ) {
      await handleCast(
        api,
        event,
        args
      );
    }

    /* =====================================================
       SPECIALS

       - No argument or "all": browse (always informational).
       - In an active fight: execute through the combat engine.
       - Otherwise: inspect it (unknown names error out).

       NOTE: this deliberately does NOT use an early
       `return`. handleRpgCommand must fall through to its
       final `return true` so the caller knows the command
       was handled.
    ===================================================== */

    else if (
      action === "special" ||
      action === "specials"
    ) {
      if (!args.length) {
        await handleSpecial(
          api,
          event,
          ["list"]
        );
      } else if (
        normalizeKey(args[0]) === "all"
      ) {
        await handleSpecial(
          api,
          event,
          ["all"]
        );
      } else if (
        await isInActiveCombat(
          event.threadID,
          event.senderID
        )
      ) {
        /*
         * Live fight: always execute. combat.js resolves
         * multi-word input itself (e.g. Amaterasu's modes).
         */
        await handleSpecialCombat(
          api,
          event,
          args
        );
      } else {
        await handleSpecial(
          api,
          event,
          args
        );
      }
    }

    /* =====================================================
       INVENTORY
    ===================================================== */

    else if (
      action === "inventory" ||
      action === "inv"
    ) {
      await handleInventory(
        api,
        event
      );
    }

    /* =====================================================
       EQUIPMENT
    ===================================================== */

    else if (
      action === "equipment"
    ) {
      await handleEquipment(
        api,
        event
      );
    }

    /* =====================================================
       WORLD / MAP
    ===================================================== */

    else if (
      action === "map" ||
      action === "world" ||
      action === "regions" ||
      action === "locations"
    ) {
      if (
        action === "world"
      ) {
        await handleWorldConditions(
          api,
          event
        );
      } else {
        await handleMap(
          api,
          event,
          action ===
          "locations"
            ? [
                "locations",
                ...args,
              ]
            : args
        );
      }
    }

    /* =====================================================
       SEASON
    ===================================================== */

    else if (
      action === "season" ||
      action === "seasons"
    ) {
      await handleSeason(
        api,
        event
      );
    }

    /* =====================================================
       WEATHER
    ===================================================== */

    else if (
      action === "weather" ||
      action === "conditions"
    ) {
      await handleWeather(
        api,
        event
      );
    }

    /* =====================================================
       PROPERTY
    ===================================================== */

    else if (
      action === "property" ||
      action === "domain"
    ) {
      await handleProperty(
        api,
        event,
        action === "domain"
          ? []
          : args
      );
    }

    /* =====================================================
       KINGDOM (singular — see PROGRESSION_COMMANDS notes)
    ===================================================== */

    else if (
      action === "kingdom"
    ) {
      await handleKingdomInfo(
        api,
        event,
        args
      );
    }

    /* =====================================================
       DIPLOMACY
    ===================================================== */

    else if (
      action === "diplomacy"
    ) {
      await handleDiplomacy(
        api,
        event,
        args
      );
    }

    /* =====================================================
       BUILD
    ===================================================== */

    else if (
      action === "build"
    ) {
      await handleProperty(
        api,
        event,
        [
          "build",
          ...args,
        ]
      );
    }

    /* =====================================================
       DEFENSE
    ===================================================== */

    else if (
      action === "defense"
    ) {
      await handleProperty(
        api,
        event,
        [
          "defense",
          ...args,
        ]
      );
    }

    /* =====================================================
       ARMY
    ===================================================== */

    else if (
      action === "army" ||
      action === "train" ||
      action === "formation" ||
      action === "regiment" ||
      action === "regiments"
    ) {
      await handleArmy(
        api,
        event,
        action === "army"
          ? args
          : [
              action,
              ...args,
            ]
      );
    }

    /* =====================================================
       MARCH
    ===================================================== */

    else if (
      action === "march" ||
      action === "travel"
    ) {
      await handleMarch(
        api,
        event,
        args
      );
    }

    /* =====================================================
       SCOUT
    ===================================================== */

    else if (
      action === "scout"
    ) {
      await handleScout(
        api,
        event,
        args
      );
    }

    /* =====================================================
       RAID
    ===================================================== */

    else if (
      action === "raid"
    ) {
      await handleRaid(
        api,
        event,
        args
      );
    }

    /* =====================================================
       AMBUSH
    ===================================================== */

    else if (
      action === "ambush"
    ) {
      await handleAmbush(
        api,
        event,
        args
      );
    }

    /* =====================================================
       EXPLORE
    ===================================================== */

    else if (
      action === "explore"
    ) {
      await handleExplore(
        api,
        event
      );
    }

    /* =====================================================
       COMBAT
    ===================================================== */

    else if (
      [
        "hunt",
        "attack",
        "skill",
        "spell",
        "defend",
        "item",
      ].includes(action)
    ) {
      await handleCombat(
        api,
        event,
        action,
        args
      );
    }

    /* =====================================================
       QUEST
    ===================================================== */

    else if (
      action === "quest"
    ) {
      await handleQuest(
        api,
        event,
        args
      );
    }

    /* =====================================================
       DUNGEON
    ===================================================== */

    else if (
      action === "dungeon"
    ) {
      await handleDungeon(
        api,
        event,
        args
      );
    }

    /* =====================================================
       REST
    ===================================================== */

    else if (
      action === "rest"
    ) {
      await handleRest(
        api,
        event
      );
    }

    /* =====================================================
       UNKNOWN
    ===================================================== */

    else {
      await send(
        api,
        event.threadID,
        errorBox(
          "Unknown RPG command.\n\n" +
          "Use !rpg help to see all available commands."
        )
      );
    }

  } catch (error) {
    console.error(
      "RPG command failed:",
      error
    );

    await send(
      api,
      event.threadID,
      errorBox(
        error.message ||
          "The RPG command could not be completed right now."
      )
    );
  }

  return true;
}


/* =========================================================
   EXPORT
========================================================= */

module.exports = {
  handleRpgCommand,
};
