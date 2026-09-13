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
  scoutLocation,
  scoutSummary,
} = require("./scouting");

const {
  ambushArmy,
  raidLocation,
} = require("./warfare");

const {
  AFFINITY_TIERS,
  SCHOOLS,
  getAffinity,
  getLearnedSpells,
  getSpell,
  learnSpell,
} = require("./magic");

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
  return state.user.display_name || "Player " + state.user.user_id;
}

function classLine(player) {
  const definition = getClass(player.character_class);

  return definition.emoji + " " + definition.name;
}

function xpForNextLevel(level) {
  return Math.max(100, Number(level || 1) * 100);
}


/* =========================================================
   PROFILE
========================================================= */

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

    "⚔️ STR " + player.strength +
      " · 🛡️ DEF " + player.defense,

    "🏃 AGI " + player.agility +
      " · 🧠 INT " + player.intelligence,

    "🍀 LUCK " + player.luck +
      " · ✨ Renown " + player.renown,

    "",

    "🗺️ " +
      (REGIONS[player.region_id]?.emoji || "🗺️") +
      " " +
      (REGIONS[player.region_id]?.name || player.region_id),

    "📍 Location: " +
      (player.location_id || "unknown"),

    "🏰 Domain: " + tier.name,

    "💰 Wallet: " +
      formatNumber(state.user.balance) +
      " coins",
  ]);
}


/* =========================================================
   MESSAGE HELPERS
========================================================= */

async function send(api, threadID, text) {
  await reply(api, threadID, text);
}


/* =========================================================
   PROFILE COMMAND
========================================================= */

async function handleProfile(api, event) {
  const state = await getUserState(
    event.threadID,
    event.senderID
  );

  const property = await getProperty(
    event.threadID,
    event.senderID
  );

  await send(
    api,
    event.threadID,
    profileText(state, property)
  );
}


/* =========================================================
   CLASS COMMAND
========================================================= */

async function handleClass(api, event, args) {
  if (!args[0]) {
    const lines = Object.entries(CLASSES).map(
      ([key, definition]) =>
        definition.emoji +
        " " +
        key +
        " — " +
        definition.style
    );

    lines.push("");
    lines.push("⚔️ Choose your class:");
    lines.push("!rpg class <name>");

    await send(
      api,
      event.threadID,
      box("⚔️ ECLIPSE CLASSES", lines)
    );

    return;
  }

  const key = getClassKey(args[0]);
  const definition = getClass(key);

  await setClass(
    event.threadID,
    event.senderID,
    key
  );

  await send(
    api,
    event.threadID,
    box("⚔️ CLASS CHOSEN", [
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

      "Use !rpg skills to view your abilities.",
    ])
  );
}


/* =========================================================
   SKILLS
========================================================= */

async function handleSkills(api, event) {
  const state = await getUserState(
    event.threadID,
    event.senderID
  );

  const skills = getSkillsForClass(
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
    box("✨ YOUR SKILLS", lines)
  );
}


/* =========================================================
   MAGIC
========================================================= */

async function handleMagic(api, event) {
  const state = await getUserState(
    event.threadID,
    event.senderID
  );

  const affinity = getAffinity(
    state.player.character_class
  );

  const tier =
    AFFINITY_TIERS[affinity.tier];

  const learned =
    await getLearnedSpells(
      event.threadID,
      event.senderID
    );

  const lines = [
    SCHOOLS[affinity.school].emoji +
      " Affinity: " +
      SCHOOLS[affinity.school].name +
      " (" +
      tier.label +
      ")",

    statLine(
      "🔷",
      "MP",
      state.player.mp,
      state.player.max_mp
    ),

    "",

    "✨ KNOWN SPELLS",
  ];

  if (!learned.length) {
    lines.push(
      "None yet. Starting spells come from your class."
    );
  } else {
    for (const spellId of learned) {
      const spell = getSpell(spellId);

      if (!spell) continue;

      lines.push(
        spell.emoji +
          " " +
          spell.name +
          " — " +
          Math.ceil(
            spell.manaCost *
              tier.costMultiplier
          ) +
          " MP"
      );
    }
  }

  lines.push(
    "",
    "Cast in combat: !rpg spell <name>",
    "Learn new spells: !rpg learn <spell>",
    "Utility casting: !rpg cast <spell>"
  );

  await send(
    api,
    event.threadID,
    box("🔮 MAGIC", lines)
  );
}


/* =========================================================
   LEARN SPELL
========================================================= */

async function handleLearnSpell(api, event, args) {
  if (!args[0]) {
    throw new Error(
      "Choose a spell to learn. Example: !rpg learn firebolt"
    );
  }

  const state = await getUserState(
    event.threadID,
    event.senderID
  );

  const result = await learnSpell(
    event.threadID,
    event.senderID,
    state.player.character_class,
    normalizeKey(args[0])
  );

  await send(
    api,
    event.threadID,
    box("📖 SPELL LEARNED", [
      result.spell.emoji +
        " " +
        result.spell.name,

      "💰 Cost: " +
        formatNumber(result.cost) +
        " coins",
    ])
  );
}


/* =========================================================
   UTILITY SPELL CASTING
========================================================= */

async function handleCast(api, event, args) {
  if (!args[0]) {
    throw new Error(
      "Choose a utility spell. Example: !rpg cast detect_magic"
    );
  }

  const threadID = event.threadID;
  const userID = event.senderID;

  const spellKey =
    normalizeKey(args[0]);

  const spell =
    getSpell(spellKey);

  if (
    !spell ||
    spell.target !== "utility"
  ) {
    throw new Error(
      "That is not a utility spell. Use !rpg magic to view your spells."
    );
  }

  const learned =
    await getLearnedSpells(
      threadID,
      userID
    );

  if (!learned.includes(spellKey)) {
    throw new Error(
      "You have not learned " +
        spell.name +
        "."
    );
  }

  const state =
    await getUserState(
      threadID,
      userID
    );

  const affinity =
    getAffinity(
      state.player.character_class
    );

  const tier =
    AFFINITY_TIERS[
      affinity.tier
    ];

  if (
    spell.school !==
      affinity.school ||
    !tier.canCast
  ) {
    throw new Error(
      "Your affinity cannot cast that spell."
    );
  }

  const manaCost =
    Math.ceil(
      spell.manaCost *
        tier.costMultiplier
    );

  if (
    Number(state.player.mp) <
    manaCost
  ) {
    throw new Error(
      "Not enough mana."
    );
  }

  /* -------------------------------------------------------
     TELEPORT
  ------------------------------------------------------- */

  if (
    spell.effect === "teleport"
  ) {
    await updateVitals(
      threadID,
      userID,
      {
        mp:
          Number(state.player.mp) -
          manaCost,

        location_id:
          "eclipse_castle",

        region_id:
          "greenvale",
      }
    );

    await send(
      api,
      threadID,
      box("🌀 TELEPORTED", [
        spell.emoji +
          " You are pulled back to Eclipse Castle.",

        "🔷 -" +
          manaCost +
          " MP",
      ])
    );

    return;
  }

  /* -------------------------------------------------------
     DETECT MAGIC
  ------------------------------------------------------- */

  if (
    spell.effect === "detect"
  ) {
    await updateVitals(
      threadID,
      userID,
      {
        mp:
          Number(state.player.mp) -
          manaCost,
      }
    );

    const region =
      REGIONS[
        state.player.region_id
      ];

    await send(
      api,
      threadID,
      box("🔍 MAGIC DETECTED", [
        spell.emoji +
          " You sense the magical currents of " +
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
      ])
    );

    return;
  }

  throw new Error(
    "That utility spell has no usable effect yet."
  );
}


/* =========================================================
   INVENTORY
========================================================= */

async function handleInventory(api, event) {
  const state = await getUserState(
    event.threadID,
    event.senderID
  );

  const lines = state.inventory.length
    ? state.inventory.map(
        (entry) =>
          (entry.item?.emoji || "🎁") +
          " " +
          (entry.item?.name ||
            entry.item_id) +
          " x" +
          entry.quantity +
          " · " +
          (entry.item?.rarity ||
            "Unknown")
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
    box("🎒 INVENTORY", lines)
  );
}


/* =========================================================
   EQUIPMENT
========================================================= */

async function handleEquipment(api, event) {
  const state = await getUserState(
    event.threadID,
    event.senderID
  );

  const lines = state.equipment.length
    ? state.equipment.map(
        (entry) =>
          "🧩 " +
          entry.slot +
          ": " +
          (entry.item?.name ||
            entry.item_id)
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
    box("🛡️ EQUIPMENT", lines)
  );
}


/* =========================================================
   WORLD / MAP
========================================================= */

async function handleMap(api, event, args) {
  if (
    args[0] &&
    normalizeKey(args[0]) ===
      "locations"
  ) {
    args = args.slice(1);
  }

  const region = args.length
    ? resolveRegion(args.join(" "))
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
            (location) =>
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

async function handleProperty(api, event, args) {
  const threadID = event.threadID;
  const userID = event.senderID;

  await ensurePlayer(
    threadID,
    userID
  );

  args = Array.isArray(args)
    ? args
    : [];

  const action = normalizeKey(
    args[0] || "info"
  );

  if (action === "buy") {
    const target = normalizeKey(
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
      box("🏰 DOMAIN EXPANDED", [
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
      ])
    );

    return;
  }

  if (action === "build") {
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

  if (action === "defense") {
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
    propertySummary(property);

  const buildings =
    await getBuildings(
      threadID,
      userID
    );

  const buildingLines =
    buildings.length
      ? buildings.map(
          (entry) =>
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
    box("🏰 YOUR DOMAIN", [
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
          (DEFENSE_PARTS[key]?.emoji ||
            "🛡️") +
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
    ])
  );
}


/* =========================================================
   KINGDOM INFO
========================================================= */

async function handleKingdomInfo(api, event, args) {
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
            (kingdom) => [
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
        "Choose a kingdom to pledge to. Example: !rpg kingdom pledge ironspine_hold"
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
        Object.keys(KINGDOMS).join(", ") +
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
                (r) =>
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

async function handleDiplomacy(api, event, args) {
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
    "Usage: !rpg diplomacy war <kingdomA> <kingdomB> | !rpg diplomacy peace <kingdomA> <kingdomB>"
  );
}


/* =========================================================
   ARMY
========================================================= */

async function handleArmy(api, event, args) {
  const threadID = event.threadID;
  const userID = event.senderID;

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
      box("⚔️ TRAINING COMPLETE", [
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
      ])
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
              (entry) =>
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

  const unitLines = [
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
  ];

  await send(
    api,
    threadID,
    box("⚔️ YOUR ARMY", [
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

      ...unitLines,

      "",

      "⚔️ Train troops:",
      "!rpg army train <unit> <amount>",

      "🛡️ Change formation:",
      "!rpg army formation <name>",
    ])
  );
}


/* =========================================================
   MARCH / TRAVEL
========================================================= */

async function handleMarch(api, event, args) {
  await ensurePlayer(
    event.threadID,
    event.senderID
  );

  const action = normalizeKey(
    args[0] || "status"
  );

  if (action === "status") {
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
    box("🚶 ARMY MARCH", [
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

      "⏱️ Maximum travel time: 2 minutes",

      "",

      "Check progress with:",
      "!rpg march status",
    ])
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
  const threadID = event.threadID;
  const userID = event.senderID;

  if (action === "hunt") {
    const result =
      await createHunt(
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
        result.session,
        state.player
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
    result.result === "active"
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
        result.message
      )
    );

    return;
  }

  /*
   * IMPORTANT:
   * Spell is included here so a spell kill
   * counts toward hunt/quest progress.
   */
  if (
    action === "attack" ||
    action === "skill" ||
    action === "spell" ||
    action === "item" ||
    action === "defend"
  ) {
    if (
      result.result === "victory"
    ) {
      await registerHuntProgress(
        threadID,
        userID
      );
    }
  }

  await send(
    api,
    threadID,
    box(
      result.result === "victory"
        ? "🏆 VICTORY"
        : "💀 DEFEAT",
      result.message
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
      questSummary(quest)
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

  const action = normalizeKey(
    args[0] || "status"
  );

  if (action === "enter") {
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

  if (action === "advance") {
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

async function handleRest(api, event) {
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
    box("🛏️ RESTED", [
      "❤️ HP restored to " +
        state.player.max_hp,

      "🔷 MP restored to " +
        state.player.max_mp,

      "⚡ Stamina restored to " +
        state.player.max_stamina,

      "",

      "You are ready for your next adventure.",
    ])
  );
}


/* =========================================================
   SCOUTING
========================================================= */

async function handleScout(api, event, args) {
  const report = await scoutLocation(
    event.threadID,
    event.senderID,
    args.join(" ")
  );

  await send(
    api,
    event.threadID,
    box(
      "🔭 SCOUTING REPORT",
      scoutSummary(report)
    )
  );
}


/* =========================================================
   RAID
========================================================= */

async function handleRaid(api, event, args) {
  const result = await raidLocation(
    event.threadID,
    event.senderID,
    args.join(" ")
  );

  await send(
    api,
    event.threadID,
    box("🔥 RAID SUCCESSFUL", [
      "🏘️ Target: " +
        result.location.name,

      "💰 Looted: " +
        formatNumber(result.lootGold) +
        " coins",

      "🛡️ Garrison weakened by " +
        formatNumber(result.garrisonLoss),

      "",

      "⚠️ Reputation -5. Hostility in this region has risen.",
    ])
  );
}


/* =========================================================
   AMBUSH
========================================================= */

async function handleAmbush(api, event, args) {
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
   HELP
========================================================= */

async function handleHelp(api, event) {
  await send(
    api,
    event.threadID,
    box("🌑 ECLIPSE RPG", [

      "━━━━━━━━━━━━━━━━━━━━━━",

      "👤 CHARACTER",

      "▶ !rpg profile",
      "View your character and stats.",

      "▶ !rpg class",
      "View available classes.",

      "▶ !rpg class <name>",
      "Choose your class.",

      "▶ !rpg skills",
      "View your class skills.",

      "▶ !rpg inventory",
      "View your RPG inventory.",

      "▶ !rpg equipment",
      "View equipped items.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "▶ !rpg magic",
      "View your affinity, mana, and known spells.",

      "▶ !rpg spell <name>",
      "Cast a spell during combat.",
      "Example: !rpg spell firebolt",

      "▶ !rpg learn <spell>",
      "Learn a new spell for gold.",
      "Example: !rpg learn healing_light",

      "▶ !rpg cast <spell>",
      "Cast a utility spell outside combat.",
      "Example: !rpg cast detect_magic",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "⚔️ ADVENTURE",

      "▶ !rpg hunt",
      "Start a battle against a random enemy.",

      "▶ !rpg attack",
      "Attack the enemy during combat.",

      "▶ !rpg skill <name>",
      "Use a combat skill.",

      "▶ !rpg defend",
      "Defend against the next attack.",

      "▶ !rpg item <name>",
      "Use an item during combat.",

      "▶ !rpg rest",
      "Restore your HP, MP, and stamina.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "🌍 WORLD",

      "▶ !rpg map",
      "View the world regions.",

      "▶ !rpg locations <region>",
      "View locations in a region.",

      "▶ !rpg march <location>",
      "Travel to another location.",

      "▶ !rpg march status",
      "Check your current march.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "🏰 DOMAIN",

      "▶ !rpg property",
      "View your domain.",

      "▶ !rpg domain",
      "Alias for !rpg property.",

      "▶ !rpg property buy <tier>",
      "Purchase or upgrade property.",

      "▶ !rpg build <building>",
      "Build or upgrade a building.",

      "▶ !rpg defense <part>",
      "Improve your defenses.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "🏰 KINGDOMS & DIPLOMACY",

      "▶ !rpg kingdom",
      "View all kingdoms of Eclipse.",

      "▶ !rpg kingdom <name>",
      "View a kingdom's strength, territory, and relations.",
      "Example: !rpg kingdom ironspine_hold",

      "▶ !rpg kingdom pledge <name>",
      "Pledge allegiance to a kingdom.",

      "▶ !rpg diplomacy war <a> <b>",
      "Declare war between two kingdoms.",

      "▶ !rpg diplomacy peace <a> <b>",
      "Offer peace between two warring kingdoms.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "⚔️ ARMY",

      "▶ !rpg army",
      "View your army.",

      "▶ !rpg army train <unit> <amount>",
      "Train troops.",

      "▶ !rpg army formation <name>",
      "Change army formation.",

      "▶ !rpg army regiment",
      "View your regiments.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "🔭 SCOUTING & WARFARE",

      "▶ !rpg scout <location>",
      "Gather intel on a location's garrison and defenses.",
      "Example: !rpg scout stonehold",

      "▶ !rpg raid <location>",
      "Raid a location with your army for gold.",
      "Example: !rpg raid willowmere",

      "▶ !rpg ambush <userID>",
      "Ambush another player's marching army.",
      "Reply to their message to target them.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "📜 QUESTS",

      "▶ !rpg quest",
      "View your current quest.",

      "▶ !rpg quest claim",
      "Claim a completed quest reward.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "🏰 DUNGEONS",

      "▶ !rpg dungeon",
      "View your dungeon status.",

      "▶ !rpg dungeon enter <key>",
      "Enter a dungeon.",

      "▶ !rpg dungeon advance",
      "Advance through a dungeon.",

      "━━━━━━━━━━━━━━━━━━━━━━",

      "Use !rpg help anytime to see this guide.",
    ])
  );
}


/* =========================================================
   MAIN RPG COMMAND ROUTER
========================================================= */

async function handleRpgCommand(
  api,
  event,
  text,
  originalText
) {
  const cleanText = String(
    originalText ||
      text ||
      ""
  ).trim();

  if (
    !/^!rpg(?:\s|$)/i.test(
      cleanText
    )
  ) {
    return false;
  }

  const parts =
    cleanText.split(/\s+/);

  const action =
    normalizeKey(
      parts[1] || "help"
    );

  const args =
    parts.slice(2);

  try {

    /* =====================================================
       HELP
    ===================================================== */

    if (action === "help") {
      await handleHelp(
        api,
        event
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
       MAP / WORLD
    ===================================================== */

    else if (
      action === "map" ||
      action === "world" ||
      action === "regions" ||
      action === "locations"
    ) {
      await handleMap(
        api,
        event,
        action === "locations"
          ? ["locations"].concat(args)
          : args
      );
    }

    /* =====================================================
       PROPERTY / DOMAIN
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
       KINGDOM
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
        ["build"].concat(args)
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
        ["defense"].concat(args)
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
          : [action].concat(args)
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
       COMBAT

       IMPORTANT:
       "spell" MUST be here.
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
