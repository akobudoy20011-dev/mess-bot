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
   LEGACY / COMPATIBILITY MAGIC
========================================================= */

const {
  AFFINITY_TIERS,
  SCHOOLS,
  getAffinity: getLegacyAffinity,
  getLearnedSpells,
  getSpell,
  learnSpell,
} = require("./magic");

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
  getWorldConditions,
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
          primary.name ||
          primary.affinity_name ||
          prettyName(
            primary.affinity_id
          )
        ) +
        " · " +
        (
          primary.tier_name ||
          primary.tier ||
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
   MAGIC / LEGACY SPELL VIEW
========================================================= */

async function handleMagic(
  api,
  event
) {
  const state =
    await getUserState(
      event.threadID,
      event.senderID
    );

  const legacyAffinity =
    getLegacyAffinity(
      state.player.character_class
    );

  const legacyTier =
    AFFINITY_TIERS[
      legacyAffinity.tier
    ];

  const learned =
    await getLearnedSpells(
      event.threadID,
      event.senderID
    );

  const lines = [];

  try {
    const primary =
      await getPrimaryAffinity(
        event.threadID,
        event.senderID
      );

    if (primary) {
      lines.push(
        "🌟 PRIMARY AFFINITY"
      );

      lines.push(
        formatAffinity(primary)
      );

      lines.push("");
    }
  } catch {
    lines.push(
      "✨ Affinity: " +
        (
          SCHOOLS[
            legacyAffinity.school
          ]?.name ||
          legacyAffinity.school
        ) +
        " (" +
        (
          legacyTier?.label ||
          "Unknown"
        ) +
        ")"
    );

    lines.push("");
  }

  lines.push(
    statLine(
      "🔷",
      "MP",
      state.player.mp,
      state.player.max_mp
    )
  );

  lines.push("");

  lines.push(
    "✨ KNOWN SPELLS"
  );

  if (!learned.length) {
    lines.push(
      "None yet. Starting spells come from your class."
    );
  } else {
    for (const spellId of learned) {
      const spell =
        getSpell(spellId);

      if (!spell) continue;

      lines.push(
        spell.emoji +
          " " +
          spell.name
      );
    }
  }

  lines.push("");

  lines.push(
    "🔮 New system:"
  );

  lines.push(
    "!rpg spells"
  );

  lines.push(
    "!rpg affinity"
  );

  lines.push(
    "!rpg special"
  );

  lines.push("");

  lines.push(
    "Cast in combat:",
    "!rpg spell <name>"
  );

  lines.push(
    "Utility:",
    "!rpg cast <spell>"
  );

  await send(
    api,
    event.threadID,
    box(
      "🔮 MAGIC",
      lines
    )
  );
}


/* =========================================================
   AFFINITY
========================================================= */

async function handleAffinity(
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
      args[0] || "status"
    );

  /* -------------------------------------------------------
     LIST ALL
  ------------------------------------------------------- */

  if (
    action === "list" ||
    action === "all"
  ) {
    const affinities =
      getAllAffinities();

    const lines = [
      "🌟 AVAILABLE AFFINITIES",
      "",
    ];

    for (const affinity of affinities) {
      lines.push(
        (
          affinity.emoji ||
          "✨"
        ) +
        " " +
        affinity.name
      );

      lines.push(
        "   Kingdom: " +
          (
            affinity.kingdom
              ? (
                  KINGDOMS[
                    affinity.kingdom
                  ]?.name ||
                  prettyName(
                    affinity.kingdom
                  )
                )
              : "Unknown"
          )
      );

      lines.push("");
    }

    lines.push(
      "Use !rpg affinity <name> for details."
    );

    await send(
      api,
      threadID,
      box(
        "🌟 AFFINITIES",
        lines
      )
    );

    return;
  }

  /* -------------------------------------------------------
     LEARN / UNLOCK
  ------------------------------------------------------- */

  if (
    action === "learn" ||
    action === "unlock"
  ) {
    if (!args[1]) {
      throw new Error(
        "Choose an affinity to learn. Example: !rpg affinity learn fire"
      );
    }

    const affinityID =
      normalizeKey(args[1]);

    const affinity =
      getAffinity(
        affinityID
      );

    if (!affinity) {
      throw new Error(
        "Unknown affinity: " +
          args[1]
      );
    }

    const result =
      await unlockAffinity(
        threadID,
        userID,
        affinityID,
        {
          source: "command",
        }
      );

    await send(
      api,
      threadID,
      box(
        "🌟 AFFINITY UNLOCKED",
        [
          (
            affinity.emoji ||
            "✨"
          ) +
            " " +
            affinity.name,

          "",

          "Tier: " +
            (
              result?.tier_name ||
              result?.tier ||
              "Weak"
            ),

          "",

          "Your new affinity is now available.",
        ]
      )
    );

    return;
  }

  /* -------------------------------------------------------
     MASTERY
  ------------------------------------------------------- */

  if (
    action === "mastery"
  ) {
    if (!args[1]) {
      throw new Error(
        "Choose an affinity. Example: !rpg affinity mastery shadow"
      );
    }

    const affinityID =
      normalizeKey(args[1]);

    const affinity =
      getAffinity(
        affinityID
      );

    if (!affinity) {
      throw new Error(
        "Unknown affinity."
      );
    }

    const row =
      await getPlayerAffinity(
        threadID,
        userID,
        affinityID
      );

    if (!row) {
      throw new Error(
        "You have not unlocked " +
          affinity.name +
          "."
      );
    }

    const mastery =
      safeNumber(
        row.mastery ??
        row.mastery_points
      );

    const tier =
      row.tier_name ||
      row.tier ||
      "Weak";

    const tierData =
      Object.values(
        NEW_AFFINITY_TIERS
      ).find(
        value =>
          value.key ===
          String(tier).toLowerCase()
      );

    const next =
      tierData
        ? Object.values(
            NEW_AFFINITY_TIERS
          ).find(
            value =>
              value.id ===
              tierData.id + 1
          )
        : null;

    await send(
      api,
      threadID,
      box(
        "🌟 AFFINITY MASTERY",
        [
          (
            affinity.emoji ||
            "✨"
          ) +
            " " +
            affinity.name,

          "📊 Tier: " +
            tier,

          "✨ Mastery: " +
            formatNumber(
              mastery
            ),

          ...(next
            ? [
                "⬆️ Next: " +
                  next.name,

                "🎯 Required: " +
                  formatNumber(
                    next.masteryRequired
                  ),
              ]
            : [
                "👑 This affinity has reached its highest tier.",
              ]),
        ]
      )
    );

    return;
  }

  /* -------------------------------------------------------
     SPECIFIC AFFINITY
  ------------------------------------------------------- */

  if (args[0]) {
    const affinityID =
      normalizeKey(
        args.join("_")
      );

    const affinity =
      getAffinity(
        affinityID
      );

    if (affinity) {
      const row =
        await getPlayerAffinity(
          threadID,
          userID,
          affinityID
        );

      const lines = [
        (
          affinity.emoji ||
          "✨"
        ) +
          " " +
          affinity.name,

        "",

        "🌍 Kingdom: " +
          (
            KINGDOMS[
              affinity.kingdom
            ]?.name ||
            prettyName(
              affinity.kingdom
            )
          ),

        "📊 Status: " +
          (
            row
              ? (
                  row.tier_name ||
                  row.tier ||
                  "Weak"
                )
              : "Locked"
          ),

        "✨ Mastery: " +
          formatNumber(
            row
              ? (
                  row.mastery ??
                  row.mastery_points ??
                  0
                )
              : 0
          ),

        "",
      ];

      if (affinity.environment) {
        lines.push(
          "🌎 Environmental bonuses:"
        );

        for (
          const [
            region,
            multiplier,
          ] of Object.entries(
            affinity.environment
          )
        ) {
          lines.push(
            "   " +
              prettyName(region) +
              " x" +
              multiplier
          );
        }

        lines.push("");
      }

      lines.push(
        row
          ? "🔓 This affinity is unlocked."
          : "🔒 This affinity is locked."
      );

      if (!row) {
        lines.push(
          "",
          "Unlock through quests, trials, bosses, dungeons, or special story rewards."
        );
      }

      await send(
        api,
        threadID,
        box(
          "🌟 AFFINITY",
          lines
        )
      );

      return;
    }
  }

  /* -------------------------------------------------------
     PLAYER AFFINITIES
  ------------------------------------------------------- */

  const affinities =
    await getPlayerAffinities(
      threadID,
      userID
    );

  const primary =
    await getPrimaryAffinity(
      threadID,
      userID
    );

  const lines = [
    "🌟 YOUR AFFINITIES",
    "",
  ];

  if (
    primary
  ) {
    lines.push(
      "👑 PRIMARY"
    );

    lines.push(
      formatAffinity(primary)
    );

    lines.push("");
  }

  if (
    !affinities ||
    !affinities.length
  ) {
    lines.push(
      "No secondary affinities unlocked yet."
    );
  } else {
    lines.push(
      "✨ UNLOCKED"
    );

    for (
      const row of affinities
    ) {
      const id =
        row.affinity_id ||
        row.id;

      const definition =
        getAffinity(id);

      if (!definition) continue;

      lines.push(
        (
          definition.emoji ||
          "✨"
        ) +
          " " +
          definition.name +
          " — " +
          (
            row.tier_name ||
            row.tier ||
            "Weak"
          ) +
          " · " +
          formatNumber(
            row.mastery ??
            row.mastery_points ??
            0
          ) +
          " mastery"
      );
    }
  }

  lines.push(
    "",
    "See every affinity: !rpg affinity list",
    "View mastery: !rpg affinity mastery <affinity>",
    "Learn an affinity: !rpg affinity learn <affinity>"
  );

  await send(
    api,
    threadID,
    box(
      "🌟 AFFINITY SYSTEM",
      lines
    )
  );
}


/* =========================================================
   SPELLS
========================================================= */

async function handleSpells(
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

  const learned =
    await getLearnedSpells(
      threadID,
      userID
    );

  const filter =
    args[0]
      ? normalizeKey(args[0])
      : null;

  const lines = [];

  if (filter) {
    const affinity =
      getAffinity(filter);

    if (!affinity) {
      throw new Error(
        "Unknown affinity: " +
          args[0]
      );
    }

    lines.push(
      (
        affinity.emoji ||
        "✨"
      ) +
        " " +
        affinity.name +
        " SPELLS"
    );

    lines.push("");

    /*
     * The legacy magic registry is still used
     * here until the dedicated spells registry
     * is fully switched over.
     */
    for (
      const spellID of learned
    ) {
      const spell =
        getSpell(spellID);

      if (!spell) continue;

      const spellSchool =
        normalizeKey(
          spell.school ||
          spell.affinity ||
          ""
        );

      if (
        spellSchool !==
        normalizeKey(
          affinity.name
        ) &&
        spellSchool !==
        filter
      ) {
        continue;
      }

      lines.push(
        (
          spell.emoji ||
          "🔮"
        ) +
          " " +
          spell.name
      );
    }

    if (
      lines.length === 2
    ) {
      lines.push(
        "No known spells from this affinity."
      );
    }

    lines.push(
      "",
      "Learn spells through affinity mastery, kingdom quests, dungeons, bosses, and special rewards."
    );

    await send(
      api,
      threadID,
      box(
        "🔮 SPELLS",
        lines
      )
    );

    return;
  }

  lines.push(
    "🔮 KNOWN SPELLS"
  );

  lines.push("");

  if (!learned.length) {
    lines.push(
      "No spells learned yet."
    );
  } else {
    for (
      const spellID of learned
    ) {
      const spell =
        getSpell(spellID);

      if (!spell) continue;

      lines.push(
        (
          spell.emoji ||
          "🔮"
        ) +
          " " +
          spell.name
      );

      lines.push(
        "   " +
          prettyName(
            spell.school ||
            spell.affinity ||
            "Unknown affinity"
          )
      );

      if (
        spell.manaCost !== undefined
      ) {
        lines.push(
          "   🔷 " +
            spell.manaCost +
            " MP"
        );
      }

      lines.push("");
    }
  }

  lines.push(
    "━━━━━━━━━━━━━━━━━━━━━━",
    "Filter by affinity:",
    "!rpg spells shadow",
    "!rpg spells fire",
    "!rpg spells arcane",
    "!rpg spells divine"
  );

  await send(
    api,
    threadID,
    box(
      "🔮 SPELLBOOK",
      lines
    )
  );
}


/* =========================================================
   SPECIAL MOVES
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

  const conditions =
    await getWorldConditions(
      threadID
    );

  await send(
    api,
    threadID,
    box(
      "🌍 WORLD CONDITIONS",
      [
        formatWorldConditions(
          conditions
        ),

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

  const spellKey =
    normalizeKey(args[0]);

  const spell =
    getSpell(spellKey);

  if (
    !spell ||
    spell.target !==
      "utility"
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

  if (
    !learned.includes(
      spellKey
    )
  ) {
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
    getLegacyAffinity(
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
    Number(
      state.player.mp
    ) < manaCost
  ) {
    throw new Error(
      "Not enough mana."
    );
  }

  if (
    spell.effect ===
    "teleport"
  ) {
    await updateVitals(
      threadID,
      userID,
      {
        mp:
          Number(
            state.player.mp
          ) -
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
      box(
        "🌀 TELEPORTED",
        [
          spell.emoji +
            " You are pulled back to Eclipse Castle.",

          "🔷 -" +
            manaCost +
            " MP",
        ]
      )
    );

    return;
  }

  if (
    spell.effect ===
    "detect"
  ) {
    await updateVitals(
      threadID,
      userID,
      {
        mp:
          Number(
            state.player.mp
          ) -
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
      box(
        "🔍 MAGIC DETECTED",
        [
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

  const state =
    await getUserState(
      event.threadID,
      event.senderID
    );

  const result =
    await learnSpell(
      event.threadID,
      event.senderID,
      state.player.character_class,
      normalizeKey(args[0])
    );

  await send(
    api,
    event.threadID,
    box(
      "📖 SPELL LEARNED",
      [
        result.spell.emoji +
          " " +
          result.spell.name,

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

  if (
    action === "hunt"
  ) {
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
    result.result ===
    "active"
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

  if (
    [
      "attack",
      "skill",
      "spell",
      "item",
      "defend",
    ].includes(action)
  ) {
    if (
      result.result ===
      "victory"
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
      result.result ===
      "victory"
        ? "🏆 VICTORY"
        : "💀 DEFEAT",
      result.message
    )
  );
}


/* =========================================================
   SPECIAL COMBAT COMMAND
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

    const heading =
      result.outcomeType ===
      "elite_encounter"
        ? "👹 AN ELITE MONSTER APPEARED!"
        : "🌲 YOU ENCOUNTERED SOMETHING!";

    await send(
      api,
      threadID,
      renderCombat(
        result.hunt.session,
        state.player,
        [
          heading,
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
   HELP
========================================================= */

async function handleHelp(
  api,
  event
) {
  await send(
    api,
    event.threadID,
    box(
      "🌑 ECLIPSE RPG",
      [

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

        "🌟 AFFINITIES",

        "▶ !rpg affinity",
        "View your affinities and mastery.",

        "▶ !rpg affinity list",
        "View every affinity in Eclipse.",

        "▶ !rpg affinity <name>",
        "Inspect an affinity.",

        "▶ !rpg affinity learn <name>",
        "Unlock an affinity.",

        "▶ !rpg affinity mastery <name>",
        "View affinity mastery progression.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "🔮 MAGIC",

        "▶ !rpg magic",
        "View your magic overview.",

        "▶ !rpg spells",
        "View your spellbook.",

        "▶ !rpg spells <affinity>",
        "View spells for an affinity.",

        "▶ !rpg spell <name>",
        "Cast a spell during combat.",

        "▶ !rpg learn <spell>",
        "Learn a spell.",

        "▶ !rpg cast <spell>",
        "Cast a utility spell.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "🌟 SPECIAL MOVES",

        "▶ !rpg special",
        "View your unlocked special moves.",

        "▶ !rpg special all",
        "View every special move.",

        "▶ !rpg special <name>",
        "Inspect a special move.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "⚔️ ADVENTURE",

        "▶ !rpg hunt",
        "Start a battle.",

        "▶ !rpg explore",
        "Explore the current region.",

        "▶ !rpg attack",
        "Attack during combat.",

        "▶ !rpg skill <name>",
        "Use a combat skill.",

        "▶ !rpg spell <name>",
        "Use a spell during combat.",

        "▶ !rpg special <name>",
        "Use a special move during combat.",

        "▶ !rpg defend",
        "Defend against the next attack.",

        "▶ !rpg item <name>",
        "Use an item during combat.",

        "▶ !rpg rest",
        "Restore HP, MP, and stamina.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "🌍 WORLD",

        "▶ !rpg map",
        "View world regions.",

        "▶ !rpg locations <region>",
        "View locations in a region.",

        "▶ !rpg world",
        "View current season, weather, and world conditions.",

        "▶ !rpg season",
        "View the current season.",

        "▶ !rpg weather",
        "View the current weather.",

        "▶ !rpg march <location>",
        "Travel to another location.",

        "▶ !rpg march status",
        "Check your march.",

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
        "Improve defenses.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "🏰 KINGDOMS & DIPLOMACY",

        "▶ !rpg kingdom",
        "View the kingdoms of Eclipse.",

        "▶ !rpg kingdom <name>",
        "View kingdom information.",

        "▶ !rpg kingdom pledge <name>",
        "Pledge allegiance.",

        "▶ !rpg diplomacy war <a> <b>",
        "Declare kingdom war.",

        "▶ !rpg diplomacy peace <a> <b>",
        "Offer peace.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "⚔️ ARMY",

        "▶ !rpg army",
        "View your army.",

        "▶ !rpg army train <unit> <amount>",
        "Train troops.",

        "▶ !rpg army formation <name>",
        "Change formation.",

        "▶ !rpg army regiment",
        "View regiments.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "🔭 SCOUTING & WARFARE",

        "▶ !rpg scout <location>",
        "Scout a location.",

        "▶ !rpg raid <location>",
        "Raid a location.",

        "▶ !rpg ambush <userID>",
        "Ambush another player's army.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "📜 QUESTS",

        "▶ !rpg quest",
        "View your current quest.",

        "▶ !rpg quest claim",
        "Claim a completed quest.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "🏰 DUNGEONS",

        "▶ !rpg dungeon",
        "View dungeon status.",

        "▶ !rpg dungeon enter <key>",
        "Enter a dungeon.",

        "▶ !rpg dungeon advance",
        "Advance through a dungeon.",

        "━━━━━━━━━━━━━━━━━━━━━━",

        "Use !rpg help anytime to see this guide.",
      ]
    )
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
  const cleanText =
    String(
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
      parts[1] ||
        "help"
    );

  const args =
    parts.slice(2);

  try {

    /* =====================================================
       HELP
    ===================================================== */

    if (
      action === "help"
    ) {
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
       AFFINITY
    ===================================================== */

    else if (
      action === "affinity" ||
      action === "affinities"
    ) {
      await handleAffinity(
        api,
        event,
        args
      );
    }

    /* =====================================================
       SPELLBOOK
    ===================================================== */

    else if (
      action === "spells" ||
      action === "spellbook"
    ) {
      await handleSpells(
        api,
        event,
        args
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
    ===================================================== */

    else if (
      action === "special" ||
      action === "specials"
    ) {
      /*
       * A named special is routed to combat.
       * "special" alone opens the menu.
       */
      if (
        args.length
      ) {
        const special =
          getSpecial(
            args.join("_")
          );

        if (special) {
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
      } else {
        await handleSpecial(
          api,
          event,
          ["list"]
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
