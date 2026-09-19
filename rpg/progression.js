"use strict";

/**
 * ECLIPSE RPG — PROGRESSION COMMANDS
 * ===================================
 *
 * COMMAND/UI LAYER ONLY
 *
 * KINGDOM
 *   !rpg kingdoms
 *   !rpg kingdom
 *   !rpg kingdom <id>
 *   !rpg kingdom quests
 *   !rpg kingdom quest <id>
 *   !rpg kingdom claim <id>
 *   !rpg kingdom reputation
 *   !rpg pledge <id>
 *
 * AFFINITY
 *   !rpg affinity
 *   !rpg affinity <name>
 *   !rpg affinity mastery
 *
 * SPELLS
 *   !rpg spells
 *   !rpg spells <affinity>
 *
 * IMPORTANT:
 *   SPECIALS ARE NOT OWNED BY THIS ROUTER.
 *
 *   !rpg special <name>
 *
 * is intentionally handled by the main RPG router because
 * special execution must be able to reach the combat engine.
 *
 * Actual progression/data logic remains in:
 *
 *   kingdom-quest.js
 *   kingdoms.js
 *   affinities.js
 *   spells.js
 *   specials.js
 */

const {
  getKingdom,
  getAllKingdoms,
  getKingdomForAffinity,

  getKingdomQuest,
  getKingdomQuestSummary,
  startKingdomQuest,
  claimKingdomQuest,

  formatKingdom,
  formatKingdomQuest,

  getPlayerKingdom,
  getKingdomReputation,
  canPledgeToKingdom,
} = require("./kingdom-quest");

const kingdoms = require("./kingdoms");
const affinities = require("./affinities");
const spells = require("./spells");

// ============================================================
// HELPERS
// ============================================================

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function title(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getArg(args, index = 0) {
  return String(args?.[index] || "").trim();
}

// ============================================================
// KINGDOM LIST
// ============================================================

async function handleKingdoms(threadID, userID) {
  const list =
    typeof getAllKingdoms === "function"
      ? getAllKingdoms()
      : [];

  const player =
    await getPlayerKingdom(
      threadID,
      userID
    );

  const lines = [
    "╔════════════════════╗",
    "      ECLIPSE KINGDOMS",
    "╚════════════════════╝",
    "",
  ];

  for (const kingdom of list) {
    if (!kingdom) {
      continue;
    }

    const reputation =
      await getKingdomReputation(
        threadID,
        userID,
        kingdom.id
      );

    const pledged =
      player?.kingdom_id === kingdom.id;

    const affinitiesList =
      Array.isArray(kingdom.primaryAffinities)
        ? kingdom.primaryAffinities.join(", ")
        : "None";

    lines.push(
      `${pledged ? "👑" : "◆"} ${kingdom.name}`,
      `   ID: ${kingdom.id}`,
      `   Capital: ${kingdom.capital || "Unknown"}`,
      `   Reputation: ${reputation ?? 0}`,
      `   Affinities: ${affinitiesList}`,
      ""
    );
  }

  if (player?.traitor) {
    lines.push(
      "⚠️ TRAITOR STATUS",
      `You betrayed: ${player.traitor_kingdom_id || "Unknown"}`,
      "You cannot pledge to another kingdom.",
      ""
    );
  }

  lines.push(
    "Use:",
    "!rpg kingdom <id>",
    "!rpg kingdom quests",
    "!rpg kingdom reputation"
  );

  return lines.join("\n");
}

// ============================================================
// KINGDOM PROFILE
// ============================================================

async function handleKingdomProfile(
  threadID,
  userID,
  args
) {
  const requested =
    normalize(getArg(args));

  const player =
    await getPlayerKingdom(
      threadID,
      userID
    );

  const kingdomID =
    requested ||
    normalize(player?.kingdom_id);

  if (!kingdomID) {
    return handleKingdoms(
      threadID,
      userID
    );
  }

  const kingdom =
    getKingdom(kingdomID);

  if (!kingdom) {
    return [
      "❌ Unknown kingdom.",
      "",
      "Use:",
      "!rpg kingdoms",
    ].join("\n");
  }

  const reputation =
    await getKingdomReputation(
      threadID,
      userID,
      kingdom.id
    );

  const lines = [
    formatKingdom(kingdom),
    "",
    `Reputation: ${reputation ?? 0}`,
  ];

  if (
    player?.kingdom_id ===
    kingdom.id
  ) {
    lines.push(
      "Status: Pledged"
    );
  } else {
    lines.push(
      "Status: Available"
    );
  }

  if (
    player?.traitor &&
    player.traitor_kingdom_id ===
      kingdom.id
  ) {
    lines.push(
      "Status: TRAITOR"
    );
  }

  lines.push(
    "",
    "Use:",
    `!rpg kingdom ${kingdom.id} quests`,
    `!rpg kingdom ${kingdom.id} reputation`
  );

  return lines.join("\n");
}

// ============================================================
// KINGDOM REPUTATION
// ============================================================

async function handleKingdomReputation(
  threadID,
  userID
) {
  const player =
    await getPlayerKingdom(
      threadID,
      userID
    );

  const lines = [
    "╔════════════════════════╗",
    "      KINGDOM REPUTATION",
    "╚════════════════════════╝",
    "",
  ];

  if (!player?.kingdom_id) {
    lines.push(
      "You are not pledged to a kingdom.",
      "",
      "Use:",
      "!rpg kingdoms",
      "!rpg pledge <kingdom>"
    );

    return lines.join("\n");
  }

  for (const kingdom of getAllKingdoms()) {
    const reputation =
      await getKingdomReputation(
        threadID,
        userID,
        kingdom.id
      );

    const current =
      kingdom.id === player.kingdom_id;

    lines.push(
      `${current ? "👑" : "◆"} ${kingdom.name}`,
      `  Reputation: ${reputation ?? 0}`
    );

    if (current) {
      lines.push(
        `  Title: ${kingdom.reputationTitle || "Renown"}`
      );
    }

    lines.push("");
  }

  if (player.traitor) {
    lines.push(
      "⚠️ TRAITOR",
      `Betrayed kingdom: ${player.traitor_kingdom_id || "Unknown"}`,
      ""
    );
  }

  return lines.join("\n");
}

// ============================================================
// KINGDOM PLEDGE
// ============================================================

async function handlePledge(
  threadID,
  userID,
  args
) {
  const kingdomID =
    normalize(getArg(args));

  if (!kingdomID) {
    return [
      "╔════════════════════════╗",
      "        KINGDOM OATH",
      "╚════════════════════════╝",
      "",
      "Use:",
      "!rpg pledge <kingdom>",
      "",
      "Available kingdoms:",
      ...getAllKingdoms().map(
        kingdom =>
          `• ${kingdom.id} — ${kingdom.name}`
      ),
    ].join("\n");
  }

  const check =
    await canPledgeToKingdom(
      threadID,
      userID,
      kingdomID
    );

  if (!check?.allowed) {
    return `❌ ${check?.reason || "You cannot pledge to this kingdom."}`;
  }

  if (
    typeof kingdoms.pledgeToKingdom !==
    "function"
  ) {
    return (
      "❌ Kingdom pledge system is unavailable."
    );
  }

  const result =
    await kingdoms.pledgeToKingdom(
      threadID,
      userID,
      kingdomID
    );

  if (
    result &&
    result.success === false
  ) {
    return (
      `❌ ${result.reason || "Unable to pledge."}`
    );
  }

  const kingdom =
    getKingdom(kingdomID);

  if (!kingdom) {
    return "❌ Kingdom no longer exists.";
  }

  const affinitiesList =
    Array.isArray(kingdom.primaryAffinities)
      ? kingdom.primaryAffinities.join(", ")
      : "None";

  return [
    "╔════════════════════╗",
    "       OATH SWORN",
    "╚════════════════════╝",
    "",
    `You have pledged yourself to ${kingdom.name}.`,
    "",
    `Capital: ${kingdom.capital || "Unknown"}`,
    `Affinities: ${affinitiesList}`,
    "",
    "Kingdom quests are now available.",
    "",
    "Use:",
    "!rpg kingdom quests",
  ].join("\n");
}

// ============================================================
// KINGDOM COMMAND ROUTER
// ============================================================

async function handleKingdomCommand(
  threadID,
  userID,
  args
) {
  const subcommand =
    normalize(getArg(args));

  switch (subcommand) {
    case "":
      return handleKingdomProfile(
        threadID,
        userID,
        []
      );

    case "list":
    case "kingdoms":
      return handleKingdoms(
        threadID,
        userID
      );

    case "quests":
    case "questlist":
      return handleKingdomQuests(
        threadID,
        userID
      );

    case "quest":
      return handleKingdomQuest(
        threadID,
        userID,
        args.slice(1)
      );

    case "claim":
      return handleKingdomClaim(
        threadID,
        userID,
        args.slice(1)
      );

    case "reputation":
    case "rep":
      return handleKingdomReputation(
        threadID,
        userID
      );

    case "pledge":
      return handlePledge(
        threadID,
        userID,
        args.slice(1)
      );

    case "info":
    case "profile":
      return handleKingdomProfile(
        threadID,
        userID,
        args.slice(1)
      );

    default:
      return handleKingdomProfile(
        threadID,
        userID,
        [subcommand]
      );
  }
}

// ============================================================
// KINGDOM QUEST LIST
// ============================================================

async function handleKingdomQuests(
  threadID,
  userID
) {
  const summary =
    await getKingdomQuestSummary(
      threadID,
      userID
    );

  if (!summary?.kingdom) {
    return [
      "❌ You are not pledged to a kingdom.",
      "",
      "Use:",
      "!rpg kingdoms",
      "!rpg pledge <kingdom>",
    ].join("\n");
  }

  const lines = [
    "╔════════════════════════════╗",
    `   ${String(summary.kingdom.name || "KINGDOM").toUpperCase()}`,
    "       KINGDOM QUESTS",
    "╚════════════════════════════╝",
    "",
    `Reputation: ${summary.reputation ?? 0}`,
    "",
  ];

  for (const entry of summary.quests || []) {
    const {
      quest,
      progress,
      required,
      completed,
      claimed,
    } = entry;

    if (!quest) {
      continue;
    }

    let status = "○";

    if (claimed) {
      status = "✓";
    } else if (completed) {
      status = "◆";
    }

    lines.push(
      `${status} ${quest.id}`,
      `  ${quest.name}`,
      `  ${quest.objective?.type || "objective"}: ${progress ?? 0}/${required ?? 0}`,
      ""
    );
  }

  lines.push(
    "Use:",
    "!rpg kingdom quest <id>",
    "!rpg kingdom claim <id>"
  );

  return lines.join("\n");
}

// ============================================================
// KINGDOM QUEST DETAILS
// ============================================================

async function handleKingdomQuest(
  threadID,
  userID,
  args
) {
  const questID =
    normalize(getArg(args));

  if (!questID) {
    return handleKingdomQuests(
      threadID,
      userID
    );
  }

  const quest =
    getKingdomQuest(questID);

  if (!quest) {
    return `❌ Unknown kingdom quest: ${questID}`;
  }

  const result =
    await startKingdomQuest(
      threadID,
      userID,
      questID
    );

  if (!result?.success) {
    return [
      `❌ ${result?.reason || "Unable to start quest."}`,
      "",
      formatKingdomQuest(
        quest,
        result?.record
      ),
    ].join("\n");
  }

  return [
    "╔════════════════════════╗",
    "       KINGDOM QUEST",
    "╚════════════════════════╝",
    "",
    formatKingdomQuest(
      quest,
      result.record
    ),
    "",
    "Quest accepted.",
  ].join("\n");
}

// ============================================================
// KINGDOM QUEST CLAIM
// ============================================================

async function handleKingdomClaim(
  threadID,
  userID,
  args
) {
  const questID =
    normalize(getArg(args));

  if (!questID) {
    return [
      "Use:",
      "!rpg kingdom claim <quest-id>",
    ].join("\n");
  }

  const result =
    await claimKingdomQuest(
      threadID,
      userID,
      questID
    );

  if (!result?.success) {
    return `❌ ${result?.reason || "Unable to claim quest."}`;
  }

  const rewards =
    result.rewards || {};

  const questRewards =
    result.quest?.rewards || {};

  const lines = [
    "╔════════════════════════╗",
    "       QUEST COMPLETE",
    "╚════════════════════════╝",
    "",
    result.quest?.name || questID,
    "",
    "Rewards:",
  ];

  if (rewards.coins) {
    lines.push(
      `🪙 +${rewards.coins} coins`
    );
  }

  if (rewards.xp) {
    lines.push(
      `✨ +${rewards.xp} XP`
    );
  }

  if (rewards.reputation) {
    lines.push(
      `👑 +${rewards.reputation} kingdom reputation`
    );
  }

  if (rewards.affinity) {
    const affinity =
      questRewards.affinity?.id;

    const mastery =
      questRewards.affinity?.mastery || 0;

    if (affinity) {
      lines.push(
        `🔮 +${mastery} ${title(affinity)} mastery`
      );
    }
  }

  if (rewards.spell) {
    lines.push(
      `📜 Spell unlocked: ${title(
        rewards.spell
      )}`
    );
  }

  if (rewards.special) {
    lines.push(
      `⚔️ Special unlocked: ${title(
        rewards.special
      )}`
    );
  }

  return lines.join("\n");
}

// ============================================================
// AFFINITY LIST
// ============================================================

async function handleAffinity(
  threadID,
  userID,
  args
) {
  const requested =
    normalize(getArg(args));

  if (
    requested === "mastery" ||
    requested === "progress"
  ) {
    return handleAffinityMastery(
      threadID,
      userID
    );
  }

  if (requested) {
    return handleAffinityDetails(
      threadID,
      userID,
      requested
    );
  }

  const list =
    await affinities.getPlayerAffinities(
      threadID,
      userID
    );

  const ownedList =
    Array.isArray(list)
      ? list
      : [];

  const primary =
    await affinities.getPrimaryAffinity(
      threadID,
      userID
    );

  const lines = [
    "╔════════════════════════╗",
    "      ECLIPSE AFFINITIES",
    "╚════════════════════════╝",
    "",
    `Primary: ${
      primary
        ? title(
            primary.affinity_id ||
            primary.id
          )
        : "None"
    }`,
    "",
  ];

  if (!ownedList.length) {
    lines.push(
      "No affinities unlocked yet."
    );
  } else {
    for (const entry of ownedList) {
      const affinity =
        affinities.getAffinity(
          entry.affinity_id ||
          entry.id
        );

      if (!affinity) {
        continue;
      }

      const tier =
        typeof affinities.getTier === "function"
          ? affinities.getTier(entry.tier)
          : null;

      lines.push(
        `${affinity.name}`,
        `  Tier: ${tier?.name || entry.tier || "None"}`,
        `  Mastery: ${Number(entry.mastery || 0)}`,
        ""
      );
    }
  }

  lines.push(
    "Use:",
    "!rpg affinity <name>",
    "!rpg affinity mastery"
  );

  return lines.join("\n");
}

// ============================================================
// AFFINITY DETAILS
// ============================================================

async function handleAffinityDetails(
  threadID,
  userID,
  affinityID
) {
  const affinity =
    affinities.getAffinity(
      affinityID
    );

  if (!affinity) {
    return [
      `❌ Unknown affinity: ${affinityID}`,
      "",
      "Available affinities:",
      ...affinities
        .getAllAffinities()
        .map(
          entry =>
            `• ${entry.id}`
        ),
    ].join("\n");
  }

  const owned =
    await affinities.getPlayerAffinity(
      threadID,
      userID,
      affinity.id
    );

  const tier =
    owned && typeof affinities.getTier === "function"
      ? affinities.getTier(owned.tier)
      : null;

  const kingdom =
    getKingdomForAffinity(
      affinity.id
    );

  /*
   * getKingdomForAffinity() may return either a kingdom ID
   * or a kingdom object depending on the data implementation.
   */
  let kingdomData = null;

  if (kingdom) {
    kingdomData =
      typeof kingdom === "object"
        ? kingdom
        : getKingdom(kingdom);
  }

  const lines = [
    "╔════════════════════════╗",
    `      ${String(affinity.name || affinity.id).toUpperCase()}`,
    "╚════════════════════════╝",
    "",
    affinity.description ||
      "An affinity of power.",
    "",
    `Tier: ${tier?.name || "None"}`,
    `Mastery: ${Number(owned?.mastery || 0)}`,
  ];

  if (kingdomData) {
    lines.push(
      `Kingdom: ${kingdomData.name || kingdomData.id}`
    );
  } else {
    lines.push(
      "Kingdom: Independent affinity domain"
    );
  }

  lines.push(
    "",
    "Available spells:",
    `!rpg spells ${affinity.id}`
  );

  return lines.join("\n");
}

// ============================================================
// AFFINITY MASTERY
// ============================================================

async function handleAffinityMastery(
  threadID,
  userID
) {
  const list =
    await affinities.getPlayerAffinities(
      threadID,
      userID
    );

  const ownedList =
    Array.isArray(list)
      ? list
      : [];

  if (!ownedList.length) {
    return [
      "You have no unlocked affinities.",
      "",
      "Affinities are gained through",
      "kingdom quests, trials, dungeons,",
      "bosses and story progression.",
    ].join("\n");
  }

  const lines = [
    "╔════════════════════════╗",
    "       AFFINITY MASTERY",
    "╚════════════════════════╝",
    "",
  ];

  for (const entry of ownedList) {
    const affinity =
      affinities.getAffinity(
        entry.affinity_id ||
        entry.id
      );

    if (!affinity) {
      continue;
    }

    const tier =
      typeof affinities.getTier === "function"
        ? affinities.getTier(entry.tier)
        : null;

    const next =
      typeof affinities.getNextTier === "function"
        ? affinities.getNextTier(entry.tier)
        : null;

    lines.push(
      `◆ ${affinity.name}`,
      `  Tier: ${tier?.name || "None"}`,
      `  Mastery: ${Number(entry.mastery || 0)}`
    );

    if (next) {
      lines.push(
        `  Next: ${next.name}`,
        `  Required: ${next.masteryRequired}`
      );
    } else {
      lines.push(
        "  ✦ Maximum tier reached."
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================
// SPELL ROUTER
// ============================================================

async function handleSpells(
  threadID,
  userID,
  args
) {
  const affinityID =
    normalize(getArg(args));

  if (!affinityID) {
    return handleSpellbook(
      threadID,
      userID
    );
  }

  return handleAffinitySpells(
    threadID,
    userID,
    affinityID
  );
}

// ============================================================
// SPELLBOOK
// ============================================================

async function handleSpellbook(
  threadID,
  userID
) {
  if (
    typeof spells.getSpellbook ===
    "function"
  ) {
    const book =
      await spells.getSpellbook(
        threadID,
        userID
      );

    if (book) {
      if (
        typeof spells.formatSpellbook ===
        "function"
      ) {
        return spells.formatSpellbook(
          book
        );
      }
    }
  }

  const learned =
    await spells.getLearnedSpells(
      threadID,
      userID
    );

  const lines = [
    "╔════════════════════════╗",
    "          SPELLBOOK",
    "╚════════════════════════╝",
    "",
  ];

  if (!learned?.length) {
    lines.push(
      "No spells learned yet."
    );
  } else {
    for (const entry of learned) {
      const spellID =
        entry.spell_id ||
        entry.id;

      const spell =
        spells.getSpell(
          spellID
        );

      if (!spell) {
        continue;
      }

      lines.push(
        `◆ ${spell.name}`,
        `  ${spell.affinity || "unknown"} • ${spell.category || "spell"}`,
        ""
      );
    }
  }

  lines.push(
    "Browse:",
    "!rpg spells fire",
    "!rpg spells ice",
    "!rpg spells shadow",
    "!rpg spells arcane"
  );

  return lines.join("\n");
}

// ============================================================
// AFFINITY SPELLS
// ============================================================

async function handleAffinitySpells(
  threadID,
  userID,
  affinityID
) {
  const affinity =
    affinities.getAffinity(
      affinityID
    );

  if (!affinity) {
    return `❌ Unknown affinity: ${affinityID}`;
  }

  let spellsForAffinity = [];

  if (
    typeof spells.getSpellsByAffinity ===
    "function"
  ) {
    spellsForAffinity =
      spells.getSpellsByAffinity(
        affinity.id
      );
  }

  if (!spellsForAffinity?.length) {
    return [
      `${affinity.name} spells`,
      "",
      "No spells are currently registered for this affinity.",
    ].join("\n");
  }

  const learned =
    await spells.getLearnedSpells(
      threadID,
      userID
    );

  const learnedIDs =
    new Set(
      (learned || []).map(
        entry =>
          entry.spell_id ||
          entry.id
      )
    );

  const lines = [
    "╔════════════════════════╗",
    `     ${String(affinity.name || affinity.id).toUpperCase()} SPELLS`,
    "╚════════════════════════╝",
    "",
  ];

  for (const spell of spellsForAffinity) {
    if (!spell) {
      continue;
    }

    const known =
      learnedIDs.has(spell.id);

    const category =
      spell.category ||
      spell.tier ||
      "spell";

    lines.push(
      `${known ? "✓" : "○"} ${spell.name}`,
      `  ID: ${spell.id}`,
      `  Type: ${category}`,
      known
        ? "  Status: Learned"
        : "  Status: Available / Locked",
      ""
    );
  }

  return lines.join("\n");
}

// ============================================================
// MAIN PROGRESSION ROUTER
// ============================================================

async function handleProgressionCommand(
  threadID,
  userID,
  action,
  args
) {
  const command =
    normalize(action);

  switch (command) {
    // --------------------------------------------------------
    // KINGDOMS
    // --------------------------------------------------------

    case "kingdoms":
      return handleKingdoms(
        threadID,
        userID
      );

    case "kingdom":
      return handleKingdomCommand(
        threadID,
        userID,
        args || []
      );

    case "pledge":
      return handlePledge(
        threadID,
        userID,
        args || []
      );

    // --------------------------------------------------------
    // AFFINITIES
    // --------------------------------------------------------

    case "affinity":
    case "affinities":
      return handleAffinity(
        threadID,
        userID,
        args || []
      );

    // --------------------------------------------------------
    // SPELLS
    // --------------------------------------------------------

    case "spells":
    case "spellbook":
      return handleSpells(
        threadID,
        userID,
        args || []
      );

    /*
     * DO NOT ADD:
     *
     * case "special":
     * case "specials":
     *
     * Specials intentionally remain in the main RPG router.
     * The main router needs to distinguish special inspection
     * from actual combat execution.
     */

    default:
      return null;
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  handleProgressionCommand,

  // Kingdom
  handleKingdoms,
  handleKingdomCommand,
  handleKingdomProfile,
  handleKingdomReputation,
  handlePledge,
  handleKingdomQuests,
  handleKingdomQuest,
  handleKingdomClaim,

  // Affinity
  handleAffinity,
  handleAffinityDetails,
  handleAffinityMastery,

  // Spells
  handleSpells,
  handleSpellbook,
  handleAffinitySpells,
};
