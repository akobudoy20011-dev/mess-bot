"use strict";

/**

 * ECLIPSE RPG — PROGRESSION COMMANDS

 * ===================================

 *

 * Command layer for:

 *

 *   !rpg kingdoms

 *   !rpg kingdom

 *   !rpg kingdom quests

 *   !rpg kingdom quest <id>

 *   !rpg kingdom claim <id>

 *

 *   !rpg affinity

 *   !rpg affinity <name>

 *   !rpg affinity mastery

 *

 *   !rpg spells

 *   !rpg spells <affinity>

 *

 *   !rpg special

 *   !rpg special <name>

 */

const {

  getKingdom,

  getAllKingdoms,

  getKingdomForAffinity,

  getKingdomQuest,

  getKingdomQuests,

  getKingdomQuestSummary,

  startKingdomQuest,

  claimKingdomQuest,

  formatKingdom,

  formatKingdomQuest,

  getPlayerKingdom,

  getKingdomReputation,

  canPledgeToKingdom,

} = require("./kingdom-quests");

const kingdoms = require("./kingdoms");

const affinities = require("./affinities");

const spells = require("./spells");

const specials = require("./specials");

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

function getJoinedArgs(args, start = 0) {

  return args

    .slice(start)

    .join(" ")

    .trim();

}

// ============================================================

// KINGDOM LIST

// ============================================================

async function handleKingdoms(

  threadID,

  userID

) {

  const list =

    getAllKingdoms();

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

    const reputation =

      await getKingdomReputation(

        threadID,

        userID,

        kingdom.id

      );

    const pledged =

      player?.kingdom_id ===

      kingdom.id;

    lines.push(

      `${pledged ? "👑" : "◆"} ${kingdom.name}`,

      `   ID: ${kingdom.id}`,

      `   Capital: ${kingdom.capital}`,

      `   Reputation: ${reputation}`,

      `   Affinities: ${kingdom.primaryAffinities.join(", ")}`,

      ""

    );

  }

  if (player?.traitor) {

    lines.push(

      "⚠️ TRAITOR STATUS",

      `You betrayed: ${player.traitor_kingdom_id}`,

      "You cannot pledge to another kingdom."

    );

  }

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

    normalize(

      getArg(args)

    );

  const player =

    await getPlayerKingdom(

      threadID,

      userID

    );

  let kingdomID =

    requested ||

    player?.kingdom_id;

  if (!kingdomID) {

    return handleKingdoms(

      threadID,

      userID

    );

  }

  const kingdom =

    getKingdom(

      kingdomID

    );

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

    formatKingdom(

      kingdom

    ),

    "",

    `Reputation: ${reputation}`,

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

  return lines.join("\n");

}

// ============================================================

// PLEDGE

// ============================================================

async function handlePledge(

  threadID,

  userID,

  args

) {

  const kingdomID =

    normalize(

      getArg(args)

    );

  if (!kingdomID) {

    return [

      "Use:",

      "!rpg pledge <kingdom>",

      "",

      "Available:",

      ...getAllKingdoms().map(

        k =>

          `• ${k.id} — ${k.name}`

      ),

    ].join("\n");

  }

  const check =

    await canPledgeToKingdom(

      threadID,

      userID,

      kingdomID

    );

  if (!check.allowed) {

    return `❌ ${check.reason}`;

  }

  /*

   * Existing kingdoms.js remains the authority for the

   * actual pledge write.

   */

  if (

    typeof kingdoms.pledgeToKingdom !==

    "function"

  ) {

    return "❌ Kingdom pledge system is unavailable.";

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

    return `❌ ${result.reason || "Unable to pledge."}`;

  }

  const kingdom =

    getKingdom(

      kingdomID

    );

  return [

    "╔════════════════════╗",

    "       OATH SWORN",

    "╚════════════════════╝",

    "",

    `You have pledged yourself to ${kingdom.name}.`,

    "",

    `Capital: ${kingdom.capital}`,

    `Affinities: ${kingdom.primaryAffinities.join(", ")}`,

    "",

    "Kingdom quests are now available.",

    "",

    "Use:",

    "!rpg kingdom quests",

  ].join("\n");

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

  if (!summary.kingdom) {

    return [

      "❌ You are not pledged to a kingdom.",

      "",

      "Use:",

      "!rpg kingdoms",

      "!rpg pledge <kingdom>",

    ].join("\n");

  }

  const lines = [

    `╔════════════════════════════╗`,

    `   ${summary.kingdom.name.toUpperCase()}`,

    `       KINGDOM QUESTS`,

    `╚════════════════════════════╝`,

    "",

    `Reputation: ${summary.reputation}`,

    "",

  ];

  for (

    const entry of summary.quests

  ) {

    const {

      quest,

      progress,

      required,

      completed,

      claimed,

    } = entry;

    let status = "○";

    if (claimed) {

      status = "✓";

    } else if (completed) {

      status = "◆";

    }

    lines.push(

      `${status} ${quest.id}`,

      `  ${quest.name}`,

      `  ${quest.objective.type}: ${progress}/${required}`,

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

    normalize(

      getArg(args)

    );

  if (!questID) {

    return handleKingdomQuests(

      threadID,

      userID

    );

  }

  const quest =

    getKingdomQuest(

      questID

    );

  if (!quest) {

    return `❌ Unknown kingdom quest: ${questID}`;

  }

  const result =

    await startKingdomQuest(

      threadID,

      userID,

      questID

    );

  if (!result.success) {

    return [

      `❌ ${result.reason}`,

      "",

      formatKingdomQuest(

        quest,

        result.record

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

// CLAIM

// ============================================================

async function handleKingdomClaim(

  threadID,

  userID,

  args

) {

  const questID =

    normalize(

      getArg(args)

    );

  if (!questID) {

    return "Use: !rpg kingdom claim <quest-id>";

  }

  const result =

    await claimKingdomQuest(

      threadID,

      userID,

      questID

    );

  if (!result.success) {

    return `❌ ${result.reason}`;

  }

  const lines = [

    "╔════════════════════════╗",

    "       QUEST COMPLETE",

    "╚════════════════════════╝",

    "",

    result.quest.name,

    "",

    "Rewards:",

  ];

  if (

    result.rewards.coins

  ) {

    lines.push(

      `🪙 +${result.rewards.coins} coins`

    );

  }

  if (

    result.rewards.xp

  ) {

    lines.push(

      `✨ +${result.rewards.xp} XP`

    );

  }

  if (

    result.rewards.reputation

  ) {

    lines.push(

      `👑 +${result.rewards.reputation} kingdom reputation`

    );

  }

  if (

    result.rewards.affinity

  ) {

    const affinity =

      result.quest.rewards

        .affinity?.id;

    const mastery =

      result.quest.rewards

        .affinity?.mastery || 0;

    lines.push(

      `🔮 +${mastery} ${title(affinity)} mastery`

    );

  }

  if (

    result.rewards.spell

  ) {

    lines.push(

      `📜 Spell unlocked: ${title(

        result.quest.rewards.spell

      )}`

    );

  }

  if (

    result.rewards.special

  ) {

    lines.push(

      `⚔️ Special unlocked: ${title(

        result.quest.rewards.special

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

    normalize(

      getArg(args)

    );

  /*

   * !rpg affinity mastery

   */

  if (

    requested === "mastery" ||

    requested === "progress"

  ) {

    return handleAffinityMastery(

      threadID,

      userID

    );

  }

  /*

   * !rpg affinity <name>

   */

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

        ? title(primary.affinity_id || primary.id)

        : "None"

    }`,

    "",

  ];

  if (!list.length) {

    lines.push(

      "No affinities unlocked yet."

    );

  } else {

    for (

      const entry of list

    ) {

      const affinity =

        affinities.getAffinity(

          entry.affinity_id ||

          entry.id

        );

      if (!affinity) {

        continue;

      }

      const tier =

        affinities.getTier(

          entry.tier

        );

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

          a =>

            `• ${a.id}`

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

    owned

      ? affinities.getTier(

          owned.tier

        )

      : affinities.getTier(

          "none"

        );

  const kingdom =

    getKingdomForAffinity(

      affinity.id

    );

  const lines = [

    "╔════════════════════════╗",

    `      ${affinity.name.toUpperCase()}`,

    "╚════════════════════════╝",

    "",

    affinity.description ||

      "An affinity of power.",

    "",

    `Tier: ${tier?.name || "None"}`,

    `Mastery: ${Number(owned?.mastery || 0)}`,

  ];

  if (kingdom) {

    const kingdomData =

      getKingdom(

        kingdom

      );

    lines.push(

      `Kingdom: ${kingdomData?.name || kingdom}`

    );

  } else {

    lines.push(

      "Kingdom: Independent domain"

    );

  }

  lines.push(

    "",

    "Available spells:",

    "!rpg spells " + affinity.id

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

  if (!list.length) {

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

  for (

    const entry of list

  ) {

    const affinity =

      affinities.getAffinity(

        entry.affinity_id ||

        entry.id

      );

    if (!affinity) {

      continue;

    }

    const tier =

      affinities.getTier(

        entry.tier

      );

    const next =

      affinities.getNextTier(

        entry.tier

      );

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

// SPELL LIST

// ============================================================

async function handleSpells(

  threadID,

  userID,

  args

) {

  const affinityID =

    normalize(

      getArg(args)

    );

  /*

   * !rpg spells

   */

  if (!affinityID) {

    return handleSpellbook(

      threadID,

      userID

    );

  }

  /*

   * !rpg spells <affinity>

   */

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

    for (

      const entry of learned

    ) {

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

        x =>

          x.spell_id ||

          x.id

      )

    );

  const lines = [

    "╔════════════════════════╗",

    `     ${affinity.name.toUpperCase()} SPELLS`,

    "╚════════════════════════╝",

    "",

  ];

  for (

    const spell of spellsForAffinity

  ) {

    const known =

      learnedIDs.has(

        spell.id

      );

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

// SPECIALS

// ============================================================

async function handleSpecials(

  threadID,

  userID,

  args

) {

  const requested =

    normalize(

      getArg(args)

    );

  if (

    requested

  ) {

    const special =

      specials.getSpecial(

        requested

      );

    if (!special) {

      return `❌ Unknown special: ${requested}`;

    }

    const owned =

      await specials.hasSpecial(

        threadID,

        userID,

        special.id

      );

    const lines = [

      "╔════════════════════════╗",

      `       ${special.name.toUpperCase()}`,

      "╚════════════════════════╝",

      "",

      special.description ||

        "A powerful special ability.",

      "",

      `Status: ${owned ? "Unlocked" : "Locked"}`,

    ];

    if (

      special.affinity

    ) {

      lines.push(

        `Affinity: ${special.affinity}`

      );

    }

    if (

      special.category

    ) {

      lines.push(

        `Category: ${special.category}`

      );

    }

    if (

      special.cooldown

    ) {

      lines.push(

        `Cooldown: ${special.cooldown}`

      );

    }

    return lines.join("\n");

  }

  const list =

    typeof specials.getPlayerSpecials ===

    "function"

      ? await specials.getPlayerSpecials(

          threadID,

          userID

        )

      : [];

  const lines = [

    "╔════════════════════════╗",

    "       SPECIAL MOVES",

    "╚════════════════════════╝",

    "",

  ];

  if (!list.length) {

    lines.push(

      "No special moves unlocked."

    );

  } else {

    for (

      const entry of list

    ) {

      const special =

        specials.getSpecial(

          entry.special_id ||

          entry.id

        );

      if (!special) {

        continue;

      }

      lines.push(

        `◆ ${special.name}`,

        `  ${special.id}`,

        ""

      );

    }

  }

  lines.push(

    "Inspect a special:",

    "!rpg special <name>"

  );

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

      return handleKingdomProfile(

        threadID,

        userID,

        args

      );

    case "pledge":

      return handlePledge(

        threadID,

        userID,

        args

      );

    // --------------------------------------------------------

    // AFFINITIES

    // --------------------------------------------------------

    case "affinity":

    case "affinities":

      return handleAffinity(

        threadID,

        userID,

        args

      );

    // --------------------------------------------------------

    // SPELLS

    // --------------------------------------------------------

    case "spells":

    case "spellbook":

      return handleSpells(

        threadID,

        userID,

        args

      );

    // --------------------------------------------------------

    // SPECIALS

    // --------------------------------------------------------

    case "special":

    case "specials":

      return handleSpecials(

        threadID,

        userID,

        args

      );

    default:

      return null;

  }

}

// ============================================================

// EXPORTS

// ============================================================

module.exports = {

  handleProgressionCommand,

  handleKingdoms,

  handleKingdomProfile,

  handlePledge,

  handleKingdomQuests,

  handleKingdomQuest,

  handleKingdomClaim,

  handleAffinity,

  handleAffinityDetails,

  handleAffinityMastery,

  handleSpells,

  handleSpellbook,

  handleAffinitySpells,

  handleSpecials,

};
