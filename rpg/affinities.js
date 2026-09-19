"use strict";

/**

 * ╔══════════════════════════════════════════════════════════╗

 * ║                    ECLIPSE RPG                          ║

 * ║                  AFFINITY ENGINE                        ║

 * ╚══════════════════════════════════════════════════════════╝

 *

 * Handles:

 * - Primary / secondary affinities

 * - Affinity tiers

 * - Mastery progression

 * - Affinity unlocking

 * - Affinity upgrades

 * - Environmental bonuses

 * - Seasonal / weather bonuses

 * - Kingdom relationships

 *

 * This module does NOT handle:

 * - spells

 * - combat

 * - special moves

 * - quests

 *

 * Those systems consume this module.

 */

"use strict";

const db = require("../db");

// ============================================================

// AFFINITY TIERS

// ============================================================

const AFFINITY_TIERS = {

  NONE: {

    id: 0,

    key: "none",

    name: "None",

    masteryRequired: 0,

    powerMultiplier: 0,

  },

  WEAK: {

    id: 1,

    key: "weak",

    name: "Weak",

    masteryRequired: 100,

    powerMultiplier: 0.75,

  },

  NORMAL: {

    id: 2,

    key: "normal",

    name: "Normal",

    masteryRequired: 300,

    powerMultiplier: 1.0,

  },

  STRONG: {

    id: 3,

    key: "strong",

    name: "Strong",

    masteryRequired: 700,

    powerMultiplier: 1.2,

  },

  EXCEPTIONAL: {

    id: 4,

    key: "exceptional",

    name: "Exceptional",

    masteryRequired: 1500,

    powerMultiplier: 1.45,

  },

  MASTERED: {

    id: 5,

    key: "mastered",

    name: "Mastered",

    masteryRequired: 3000,

    powerMultiplier: 1.8,

  },

  ASCENDED: {

    id: 6,

    key: "ascended",

    name: "Ascended",

    masteryRequired: 6000,

    powerMultiplier: 2.25,

  },

};

const TIER_ORDER = [

  AFFINITY_TIERS.NONE,

  AFFINITY_TIERS.WEAK,

  AFFINITY_TIERS.NORMAL,

  AFFINITY_TIERS.STRONG,

  AFFINITY_TIERS.EXCEPTIONAL,

  AFFINITY_TIERS.MASTERED,

  AFFINITY_TIERS.ASCENDED,

];

// ============================================================

// AFFINITIES

// ============================================================

//

// IMPORTANT:

//

// `kingdom` means POLITICAL KINGDOM.

//

// Domain locations such as:

// - Frostgrave

// - Whispering Forest

// - Azure Coast

// - Celestial Lands

//

// are NOT separate kingdoms.

//

// Political kingdoms:

// - Ashen Dominion

// - Silver Conclave

// - Ironspine Hold

// - Hollow Covenant

//

// Nature / Water / Wind are independent affinities and do not

// require political allegiance to a kingdom.

//

const AFFINITIES = {

  // ==========================================================

  // FIRE

  // ==========================================================

  fire: {

    id: "fire",

    name: "Fire",

    emoji: "🔥",

    description:

      "Destruction, combustion and overwhelming offensive force.",

    kingdom: "ashen_dominion",

    environments: {

      infernal_rift: 1.25,

      scorched_wastes: 1.20,

    },

    seasons: {

      summer: 1.20,

      winter: 0.90,

    },

    weather: {

      heat: 1.15,

      storm: 0.95,

      snow: 0.85,

    },

    opposite: "ice",

    tags: [

      "elemental",

      "offensive",

      "burn",

    ],

  },

  // ==========================================================

  // ICE

  // ==========================================================

  ice: {

    id: "ice",

    name: "Ice",

    emoji: "❄️",

    description:

      "Control, defense, freezing and battlefield suppression.",

    // Frostgrave is an affinity domain.

    // Its political kingdom is Ironspine Hold.

    kingdom: "ironspine_hold",

    environments: {

      frostgrave: 1.25,

      ironspine: 1.10,

    },

    seasons: {

      winter: 1.25,

      summer: 0.90,

    },

    weather: {

      snow: 1.20,

      rain: 1.10,

      heat: 0.85,

    },

    opposite: "fire",

    tags: [

      "elemental",

      "defensive",

      "control",

    ],

  },

  // ==========================================================

  // LIGHTNING

  // ==========================================================

  lightning: {

    id: "lightning",

    name: "Lightning",

    emoji: "⚡",

    description:

      "Speed, electrical destruction and explosive strikes.",

    kingdom: "silver_conclave",

    environments: {

      ironspine: 1.10,

      celestial_lands: 1.15,

    },

    seasons: {

      summer: 1.05,

    },

    weather: {

      storm: 1.30,

      rain: 1.10,

    },

    tags: [

      "elemental",

      "speed",

      "burst",

    ],

  },

  // ==========================================================

  // NATURE

  // ==========================================================

  nature: {

    id: "nature",

    name: "Nature",

    emoji: "🌿",

    description:

      "Growth, regeneration, seasons, weather and living magic.",

    // Whispering Forest is an affinity domain,

    // not a political kingdom.

    kingdom: null,

    domain: "whispering_forest",

    environments: {

      whispering_forest: 1.25,

      lowlands: 1.15,

    },

    seasons: {

      spring: 1.30,

      summer: 1.10,

      autumn: 1.05,

      winter: 0.90,

    },

    weather: {

      rain: 1.20,

      clear: 1.05,

      snow: 0.90,

    },

    tags: [

      "elemental",

      "healing",

      "control",

      "growth",

    ],

  },

  // ==========================================================

  // LIGHT

  // ==========================================================

  light: {

    id: "light",

    name: "Light",

    emoji: "☀️",

    description:

      "Radiant power, purification and offensive holy energy.",

    // Celestial Lands = domain.

    // Silver Conclave = political kingdom.

    kingdom: "silver_conclave",

    domain: "celestial_lands",

    environments: {

      celestial_lands: 1.25,

    },

    seasons: {

      summer: 1.10,

      winter: 0.95,

    },

    weather: {

      clear: 1.20,

      fog: 0.90,

      storm: 0.90,

    },

    tags: [

      "holy",

      "radiant",

      "healing",

    ],

  },

  // ==========================================================

  // DIVINE

  // ==========================================================

  divine: {

    id: "divine",

    name: "Divine",

    emoji: "✦",

    description:

      "Protection, blessings, sacred defense and divine judgment.",

    kingdom: "silver_conclave",

    domain: "celestial_lands",

    environments: {

      celestial_lands: 1.25,

      eclipse_castle: 1.10,

    },

    seasons: {

      spring: 1.05,

      summer: 1.10,

    },

    weather: {

      clear: 1.15,

      storm: 0.95,

    },

    tags: [

      "holy",

      "protection",

      "support",

    ],

  },

  // ==========================================================

  // ARCANE

  // ==========================================================

  arcane: {

    id: "arcane",

    name: "Arcane",

    emoji: "🔮",

    description:

      "Pure magical manipulation, spell amplification and mana control.",

    kingdom: "silver_conclave",

    domain: "celestial_lands",

    environments: {

      celestial_lands: 1.25,

      moonlit_ruins: 1.15,

    },

    seasons: {

      spring: 1.00,

      summer: 1.00,

      autumn: 1.00,

      winter: 1.00,

    },

    weather: {

      clear: 1.05,

      fog: 1.10,

    },

    tags: [

      "magic",

      "mana",

      "versatile",

    ],

  },

  // ==========================================================

  // SHADOW

  // ==========================================================

  shadow: {

    id: "shadow",

    name: "Shadow",

    emoji: "🌑",

    description:

      "Stealth, darkness, evasion, corruption and shadow manifestation.",

    kingdom: "hollow_covenant",

    domain: "abyss",

    environments: {

      abyss: 1.25,

      moonlit_ruins: 1.20,

    },

    seasons: {

      winter: 1.10,

    },

    weather: {

      night: 1.30,

      fog: 1.15,

      clear: 0.95,

    },

    tags: [

      "dark",

      "stealth",

      "control",

    ],

  },

  // ==========================================================

  // NECROMANCY

  // ==========================================================

  necromancy: {

    id: "necromancy",

    name: "Necromancy",

    emoji: "💀",

    description:

      "Death magic, undead manipulation and life-force corruption.",

    kingdom: "hollow_covenant",

    domain: "abyss",

    environments: {

      abyss: 1.30,

      moonlit_ruins: 1.20,

    },

    seasons: {

      winter: 1.15,

    },

    weather: {

      fog: 1.20,

      night: 1.15,

    },

    tags: [

      "dark",

      "death",

      "summoning",

    ],

  },

  // ==========================================================

  // BLOOD

  // ==========================================================

  blood: {

    id: "blood",

    name: "Blood",

    emoji: "🩸",

    description:

      "Sacrifice, lifesteal, rage and converting vitality into power.",

    kingdom: "ashen_dominion",

    environments: {

      scorched_wastes: 1.15,

      abyss: 1.10,

    },

    seasons: {

      autumn: 1.05,

    },

    weather: {

      storm: 1.05,

    },

    tags: [

      "dark",

      "lifesteal",

      "sacrifice",

    ],

  },

  // ==========================================================

  // WATER

  // ==========================================================

  water: {

    id: "water",

    name: "Water",

    emoji: "🌊",

    description:

      "Flow, healing, adaptation and overwhelming aquatic force.",

    // Azure Coast is an affinity domain.

    // Water has no mandatory political kingdom.

    kingdom: null,

    domain: "azure_coast",

    environments: {

      azure_coast: 1.30,

      lowlands: 1.15,

    },

    seasons: {

      spring: 1.10,

      summer: 1.05,

    },

    weather: {

      rain: 1.30,

      storm: 1.15,

      heat: 0.95,

    },

    tags: [

      "elemental",

      "healing",

      "adaptation",

    ],

  },

  // ==========================================================

  // WIND

  // ==========================================================

  wind: {

    id: "wind",

    name: "Wind",

    emoji: "🌪️",

    description:

      "Speed, movement, evasion and cutting pressure.",

    kingdom: null,

    domain: "azure_coast",

    environments: {

      azure_coast: 1.20,

      celestial_lands: 1.10,

    },

    seasons: {

      spring: 1.15,

      autumn: 1.10,

    },

    weather: {

      storm: 1.20,

      clear: 1.10,

    },

    tags: [

      "elemental",

      "speed",

      "evasion",

    ],

  },

  // ==========================================================

  // EARTH

  // ==========================================================

  earth: {

    id: "earth",

    name: "Earth",

    emoji: "🪨",

    description:

      "Defense, endurance, physical power and battlefield stability.",

    kingdom: "ironspine_hold",

    domain: "ironspine",

    environments: {

      ironspine: 1.30,

      lowlands: 1.10,

    },

    seasons: {

      autumn: 1.15,

      winter: 1.05,

    },

    weather: {

      clear: 1.10,

      rain: 0.95,

    },

    tags: [

      "elemental",

      "defense",

      "endurance",

    ],

  },

};

// ============================================================

// CLASS PRIMARY AFFINITIES

// ============================================================

const CLASS_PRIMARY_AFFINITIES = {

  knight: {

    affinity: "light",

    tier: AFFINITY_TIERS.WEAK.id,

  },

  bloodreaver: {

    affinity: "blood",

    tier: AFFINITY_TIERS.NORMAL.id,

  },

  arcanist: {

    affinity: "arcane",

    tier: AFFINITY_TIERS.EXCEPTIONAL.id,

  },

  wraith: {

    affinity: "shadow",

    tier: AFFINITY_TIERS.STRONG.id,

  },

  paladin: {

    affinity: "divine",

    tier: AFFINITY_TIERS.STRONG.id,

  },

  ranger: {

    affinity: "nature",

    tier: AFFINITY_TIERS.NORMAL.id,

  },

  assassin: {

    affinity: "shadow",

    tier: AFFINITY_TIERS.NORMAL.id,

  },

};

// ============================================================

// ALIASES

// ============================================================

const AFFINITY_ALIASES = {

  fire_magic: "fire",

  flame: "fire",

  frost: "ice",

  ice_magic: "ice",

  lightning_magic: "lightning",

  thunder: "lightning",

  nature_magic: "nature",

  natural: "nature",

  holy: "light",

  radiant: "light",

  divine_magic: "divine",

  arcane_magic: "arcane",

  shadow_magic: "shadow",

  darkness: "shadow",

  death: "necromancy",

  death_magic: "necromancy",

  blood_magic: "blood",

  water_magic: "water",

  wind_magic: "wind",

  air: "wind",

  air_magic: "wind",

  earth_magic: "earth",

};

// ============================================================

// NORMALIZATION

// ============================================================

function normalizeAffinityId(value) {

  if (!value) {

    return null;

  }

  const raw = String(value)

    .trim()

    .toLowerCase()

    .replace(/[’']/g, "")

    .replace(/[\s-]+/g, "_");

  if (AFFINITIES[raw]) {

    return raw;

  }

  return AFFINITY_ALIASES[raw] || null;

}

// ============================================================

// LOOKUPS

// ============================================================

function getAffinity(affinityId) {

  const id =

    normalizeAffinityId(

      affinityId

    );

  return id

    ? AFFINITIES[id]

    : null;

}

function getAllAffinities() {

  return Object.values(

    AFFINITIES

  );

}

function getAffinityDomain(

  affinityId

) {

  const affinity =

    getAffinity(

      affinityId

    );

  return affinity?.domain || null;

}

function getAffinityKingdom(

  affinityId

) {

  const affinity =

    getAffinity(

      affinityId

    );

  return affinity?.kingdom || null;

}

// ============================================================

// TIER HELPERS

// ============================================================

function getTier(tier) {

  /*

   * Accept:

   *

   * 0

   * 1

   * 2

   * ...

   *

   * OR:

   *

   * "weak"

   * "normal"

   * "mastered"

   * etc.

   *

   * OR a tier object.

   */

  if (

    tier &&

    typeof tier === "object"

  ) {

    if (

      Number.isFinite(

        Number(tier.id)

      )

    ) {

      tier =

        Number(tier.id);

    } else if (

      tier.key

    ) {

      tier =

        tier.key;

    }

  }

  if (

    typeof tier === "string" &&

    !/^\d+$/.test(

      tier.trim()

    )

  ) {

    return getTierByKey(

      tier

    );

  }

  const numeric = Math.max(

    0,

    Math.min(

      6,

      Number(tier) || 0

    )

  );

  return (

    TIER_ORDER[numeric] ||

    AFFINITY_TIERS.NONE

  );

}

function getTierByKey(key) {

  if (!key) {

    return AFFINITY_TIERS.NONE;

  }

  const normalized =

    String(key)

      .trim()

      .toLowerCase();

  return (

    TIER_ORDER.find(

      tier =>

        tier.key ===

        normalized

    ) ||

    AFFINITY_TIERS.NONE

  );

}

function getNextTier(tier) {

  const current =

    getTier(tier);

  return (

    TIER_ORDER[

      current.id + 1

    ] || null

  );

}

function getMasteryRequiredForTier(

  tier

) {

  return getTier(

    tier

  ).masteryRequired;

}

// ============================================================

// PLAYER AFFINITY QUERIES

// ============================================================

async function getPlayerAffinity(

  threadId,

  userId,

  affinityId

) {

  const id =

    normalizeAffinityId(

      affinityId

    );

  if (!id) {

    throw new Error(

      "Unknown affinity."

    );

  }

  const { rows } =

    await db.query(

      `

        SELECT *

        FROM rpg_player_affinities

        WHERE thread_id = $1

          AND user_id = $2

          AND affinity_id = $3

        LIMIT 1

      `,

      [

        String(threadId),

        String(userId),

        id,

      ]

    );

  if (!rows.length) {

    return null;

  }

  const row =

    rows[0];

  return normalizePlayerAffinityRow(

    row

  );

}

function normalizePlayerAffinityRow(

  row

) {

  if (!row) {

    return null;

  }

  const tier =

    Number(

      row.tier

    ) || 0;

  return {

    ...row,

    affinity_id:

      normalizeAffinityId(

        row.affinity_id

      ),

    tier,

    tierId: tier,

    tierKey:

      getTier(tier).key,

    tierName:

      getTier(tier).name,

    mastery:

      Number(

        row.mastery

      ) || 0,

    unlocked:

      row.unlocked !== false,

    primaryAffinity:

      row.primary_affinity === true,

    powerMultiplier:

      getTier(

        tier

      ).powerMultiplier,

  };

}

async function getPlayerAffinities(

  threadId,

  userId,

  options = {}

) {

  const onlyUnlocked =

    options.onlyUnlocked !== false;

  const { rows } =

    await db.query(

      `

        SELECT *

        FROM rpg_player_affinities

        WHERE thread_id = $1

          AND user_id = $2

          ${

            onlyUnlocked

              ? "AND unlocked = TRUE"

              : ""

          }

        ORDER BY

          primary_affinity DESC,

          tier DESC,

          mastery DESC,

          affinity_id ASC

      `,

      [

        String(threadId),

        String(userId),

      ]

    );

  return rows.map(

    normalizePlayerAffinityRow

  );

}

async function getPrimaryAffinity(

  threadId,

  userId

) {

  const { rows } =

    await db.query(

      `

        SELECT *

        FROM rpg_player_affinities

        WHERE thread_id = $1

          AND user_id = $2

          AND primary_affinity = TRUE

          AND unlocked = TRUE

        ORDER BY

          tier DESC,

          mastery DESC

        LIMIT 1

      `,

      [

        String(threadId),

        String(userId),

      ]

    );

  return rows.length

    ? normalizePlayerAffinityRow(

        rows[0]

      )

    : null;

}

// ============================================================

// AFFINITY COUNT

// ============================================================

async function getAffinityCount(

  threadId,

  userId

) {

  const { rows } =

    await db.query(

      `

        SELECT COUNT(*)::INTEGER AS count

        FROM rpg_player_affinities

        WHERE thread_id = $1

          AND user_id = $2

          AND unlocked = TRUE

      `,

      [

        String(threadId),

        String(userId),

      ]

    );

  return Number(

    rows[0]?.count

  ) || 0;

}

// ============================================================

// PRIMARY / SECONDARY MANAGEMENT

// ============================================================

async function setPrimaryAffinity(

  threadId,

  userId,

  affinityId

) {

  const id =

    normalizeAffinityId(

      affinityId

    );

  if (!id) {

    throw new Error(

      "Unknown affinity."

    );

  }

  const state =

    await getPlayerAffinity(

      threadId,

      userId,

      id

    );

  if (

    !state ||

    !state.unlocked

  ) {

    throw new Error(

      `You have not unlocked ${AFFINITIES[id].name}.`

    );

  }

  /*

   * Only one primary affinity.

   */

  await db.query(

    `

      UPDATE rpg_player_affinities

      SET

        primary_affinity = FALSE,

        updated_at = $3

      WHERE thread_id = $1

        AND user_id = $2

    `,

    [

      String(threadId),

      String(userId),

      Date.now(),

    ]

  );

  await db.query(

    `

      UPDATE rpg_player_affinities

      SET

        primary_affinity = TRUE,

        updated_at = $4

      WHERE thread_id = $1

        AND user_id = $2

        AND affinity_id = $3

    `,

    [

      String(threadId),

      String(userId),

      id,

      Date.now(),

    ]

  );

  return getPlayerAffinity(

    threadId,

    userId,

    id

  );

}

// ============================================================

// UNLOCK AFFINITY

// ============================================================

async function unlockAffinity(

  threadId,

  userId,

  affinityId,

  options = {}

) {

  const id =

    normalizeAffinityId(

      affinityId

    );

  if (!id) {

    throw new Error(

      "Unknown affinity."

    );

  }

  const definition =

    AFFINITIES[id];

  const existing =

    await getPlayerAffinity(

      threadId,

      userId,

      id

    );

  if (existing) {

    /*

     * If the caller explicitly wants the

     * affinity to become primary, update it.

     */

    if (

      options.primary === true &&

      !existing.primaryAffinity

    ) {

      await setPrimaryAffinity(

        threadId,

        userId,

        id

      );

      return {

        created: false,

        changed: true,

        affinity:

          await getPlayerAffinity(

            threadId,

            userId,

            id

          ),

      };

    }

    return {

      created: false,

      changed: false,

      affinity: existing,

    };

  }

  const requestedTier =

    Math.max(

      1,

      Math.min(

        6,

        Number(

          options.tier

        ) || 1

      )

    );

  /*

   * Do not let an unlock call magically

   * create 3000/6000 mastery unless the

   * caller explicitly supplied it.

   */

  const mastery =

    Math.max(

      0,

      Number(

        options.mastery

      ) || 0

    );

  const primary =

    options.primary === true;

  const source =

    options.source ||

    "unknown";

  const now =

    Date.now();

  /*

   * If this is the first affinity,

   * it becomes primary automatically.

   */

  const currentCount =

    await getAffinityCount(

      threadId,

      userId

    );

  const shouldBePrimary =

    primary ||

    currentCount === 0;

  await db.query(

    `

      INSERT INTO rpg_player_affinities(

        thread_id,

        user_id,

        affinity_id,

        tier,

        mastery,

        primary_affinity,

        unlocked,

        source,

        unlocked_at,

        updated_at

      )

      VALUES(

        $1,

        $2,

        $3,

        $4,

        $5,

        $6,

        TRUE,

        $7,

        $8,

        $8

      )

      ON CONFLICT(

        thread_id,

        user_id,

        affinity_id

      )

      DO NOTHING

    `,

    [

      String(threadId),

      String(userId),

      id,

      requestedTier,

      mastery,

      shouldBePrimary,

      String(source),

      now,

    ]

  );

  /*

   * Safety: only one primary affinity.

   */

  if (shouldBePrimary) {

    await db.query(

      `

        UPDATE rpg_player_affinities

        SET

          primary_affinity =

            CASE

              WHEN affinity_id = $3

                THEN TRUE

              ELSE FALSE

            END,

          updated_at = $4

        WHERE thread_id = $1

          AND user_id = $2

      `,

      [

        String(threadId),

        String(userId),

        id,

        Date.now(),

      ]

    );

  }

  return {

    created: true,

    affinity:

      await getPlayerAffinity(

        threadId,

        userId,

        id

      ),

    definition,

  };

}

// ============================================================

// CLASS AFFINITY INITIALIZATION

// ============================================================

async function initializeClassAffinity(

  threadId,

  userId,

  classId

) {

  const key =

    String(

      classId || ""

    )

      .trim()

      .toLowerCase();

  const config =

    CLASS_PRIMARY_AFFINITIES[

      key

    ];

  if (!config) {

    throw new Error(

      `No affinity configuration exists for class "${classId}".`

    );

  }

  /*

   * Make sure an old primary affinity

   * cannot remain after class selection.

   */

  await db.query(

    `

      UPDATE rpg_player_affinities

      SET

        primary_affinity = FALSE,

        updated_at = $3

      WHERE thread_id = $1

        AND user_id = $2

    `,

    [

      String(threadId),

      String(userId),

      Date.now(),

    ]

  );

  return unlockAffinity(

    threadId,

    userId,

    config.affinity,

    {

      tier:

        config.tier,

      mastery: 0,

      primary: true,

      source:

        `class:${key}`,

    }

  );

}

// ============================================================

// MASTERY

// ============================================================

async function addAffinityMastery(

  threadId,

  userId,

  affinityId,

  amount,

  options = {}

) {

  const id =

    normalizeAffinityId(

      affinityId

    );

  if (!id) {

    throw new Error(

      "Unknown affinity."

    );

  }

  const value =

    Math.floor(

      Number(amount)

    );

  if (

    !Number.isFinite(value) ||

    value <= 0

  ) {

    throw new Error(

      "Affinity mastery must be greater than zero."

    );

  }

  let current =

    await getPlayerAffinity(

      threadId,

      userId,

      id

    );

  if (!current) {

    if (

      options.autoUnlock === false

    ) {

      throw new Error(

        `You have not unlocked ${AFFINITIES[id].name} affinity.`

      );

    }

    const unlocked =

      await unlockAffinity(

        threadId,

        userId,

        id,

        {

          tier:

            options.startingTier || 1,

          mastery: 0,

          primary:

            options.primary === true,

          source:

            options.source ||

            "mastery",

        }

      );

    current =

      unlocked.affinity;

  }

  const oldMastery =

    Number(

      current.mastery

    ) || 0;

  const newMastery =

    oldMastery + value;

  const oldTier =

    Number(

      current.tier

    ) || 0;

  let newTier =

    oldTier;

  /*

   * Mastery automatically advances the

   * affinity tier when thresholds are reached.

   */

  while (

    newTier < 6 &&

    newMastery >=

      getTier(

        newTier + 1

      ).masteryRequired

  ) {

    newTier += 1;

  }

  await db.query(

    `

      UPDATE rpg_player_affinities

      SET

        mastery = $4,

        tier = $5,

        updated_at = $6

      WHERE thread_id = $1

        AND user_id = $2

        AND affinity_id = $3

    `,

    [

      String(threadId),

      String(userId),

      id,

      newMastery,

      newTier,

      Date.now(),

    ]

  );

  const nextTier =

    getNextTier(

      newTier

    );

  return {

    affinity: id,

    oldMastery,

    mastery:

      newMastery,

    oldTier,

    tier:

      newTier,

    tierChanged:

      newTier !== oldTier,

    previousTier:

      getTier(oldTier),

    currentTier:

      getTier(newTier),

    nextTier,

    masteryToNext:

      nextTier

        ? Math.max(

            0,

            nextTier.masteryRequired -

              newMastery

          )

        : 0,

  };

}

// ============================================================

// DIRECT TIER UPGRADE

// ============================================================

async function upgradeAffinity(

  threadId,

  userId,

  affinityId

) {

  const id =

    normalizeAffinityId(

      affinityId

    );

  if (!id) {

    throw new Error(

      "Unknown affinity."

    );

  }

  const current =

    await getPlayerAffinity(

      threadId,

      userId,

      id

    );

  if (!current) {

    throw new Error(

      `You have not unlocked ${AFFINITIES[id].name} affinity.`

    );

  }

  const currentTier =

    Number(

      current.tier

    ) || 0;

  if (

    currentTier >= 6

  ) {

    return {

      upgraded: false,

      reason:

        "already_ascended",

      affinity:

        current,

    };

  }

  const nextTier =

    getTier(

      currentTier + 1

    );

  const mastery =

    Number(

      current.mastery

    ) || 0;

  if (

    mastery <

    nextTier.masteryRequired

  ) {

    return {

      upgraded: false,

      reason:

        "insufficient_mastery",

      required:

        nextTier.masteryRequired,

      mastery,

      remaining:

        nextTier.masteryRequired -

        mastery,

      affinity:

        current,

    };

  }

  await db.query(

    `

      UPDATE rpg_player_affinities

      SET

        tier = $4,

        updated_at = $5

      WHERE thread_id = $1

        AND user_id = $2

        AND affinity_id = $3

    `,

    [

      String(threadId),

      String(userId),

      id,

      currentTier + 1,

      Date.now(),

    ]

  );

  return {

    upgraded: true,

    affinity: id,

    previousTier:

      getTier(

        currentTier

      ),

    currentTier:

      getTier(

        currentTier + 1

      ),

    affinityState:

      await getPlayerAffinity(

        threadId,

        userId,

        id

      ),

  };

}

// ============================================================

// ENVIRONMENT

// ============================================================

function getEnvironmentMultiplier(

  affinityId,

  regionId,

  season,

  weather,

  extra = {}

) {

  const affinity =

    getAffinity(

      affinityId

    );

  if (!affinity) {

    return {

      multiplier: 1,

      reasons: [],

    };

  }

  let multiplier = 1;

  const reasons = [];

  const region =

    String(

      regionId || ""

    )

      .trim()

      .toLowerCase();

  const currentSeason =

    String(

      season || ""

    )

      .trim()

      .toLowerCase();

  const currentWeather =

    String(

      weather || ""

    )

      .trim()

      .toLowerCase();

  /*

   * Environment.

   */

  if (

    affinity.environments &&

    affinity.environments[

      region

    ]

  ) {

    const value =

      Number(

        affinity.environments[

          region

        ]

      ) || 1;

    multiplier *= value;

    reasons.push({

      type:

        "environment",

      key:

        region,

      multiplier:

        value,

    });

  }

  /*

   * Season.

   */

  if (

    affinity.seasons &&

    affinity.seasons[

      currentSeason

    ]

  ) {

    const value =

      Number(

        affinity.seasons[

          currentSeason

        ]

      ) || 1;

    multiplier *= value;

    reasons.push({

      type:

        "season",

      key:

        currentSeason,

      multiplier:

        value,

    });

  }

  /*

   * Weather.

   */

  if (

    affinity.weather &&

    affinity.weather[

      currentWeather

    ]

  ) {

    const value =

      Number(

        affinity.weather[

          currentWeather

        ]

      ) || 1;

    multiplier *= value;

    reasons.push({

      type:

        "weather",

      key:

        currentWeather,

      multiplier:

        value,

    });

  }

  /*

   * Time-of-day modifiers.

   *

   * Shadow/Necromancy currently use

   * "night" even though it isn't normal

   * weather. This keeps that mechanic

   * available without polluting weather.js.

   */

  if (

    extra.night === true &&

    affinity.weather?.night

  ) {

    const value =

      Number(

        affinity.weather.night

      ) || 1;

    multiplier *= value;

    reasons.push({

      type:

        "time",

      key:

        "night",

      multiplier:

        value,

    });

  }

  if (

    extra.morning === true &&

    affinity.weather?.morning

  ) {

    const value =

      Number(

        affinity.weather.morning

      ) || 1;

    multiplier *= value;

    reasons.push({

      type:

        "time",

      key:

        "morning",

      multiplier:

        value,

    });

  }

  return {

    multiplier:

      Number(

        multiplier.toFixed(4)

      ),

    reasons,

  };

}

// ============================================================

// AFFINITY POWER

// ============================================================

function getAffinityPowerMultiplier(

  tier

) {

  return getTier(

    tier

  ).powerMultiplier;

}

async function getPlayerAffinityPower(

  threadId,

  userId,

  affinityId,

  environment = {}

) {

  const state =

    await getPlayerAffinity(

      threadId,

      userId,

      affinityId

    );

  if (

    !state ||

    !state.unlocked

  ) {

    return {

      unlocked: false,

      affinity:

        normalizeAffinityId(

          affinityId

        ),

      tier:

        AFFINITY_TIERS.NONE,

      mastery: 0,

      baseMultiplier: 0,

      environmentalMultiplier: 1,

      finalMultiplier: 0,

      environmentalReasons: [],

    };

  }

  const tier =

    getTier(

      state.tier

    );

  const environmental =

    getEnvironmentMultiplier(

      affinityId,

      environment.regionId,

      environment.season,

      environment.weather,

      environment

    );

  const finalMultiplier =

    Number(

      (

        tier.powerMultiplier *

        environmental.multiplier

      ).toFixed(4)

    );

  return {

    unlocked: true,

    affinity:

      normalizeAffinityId(

        affinityId

      ),

    tier,

    mastery:

      Number(

        state.mastery

      ) || 0,

    baseMultiplier:

      tier.powerMultiplier,

    environmentalMultiplier:

      environmental.multiplier,

    finalMultiplier,

    environmentalReasons:

      environmental.reasons,

    /*

     * Compatibility aliases.

     */

    powerMultiplier:

      finalMultiplier,

    multiplier:

      finalMultiplier,

  };

}

// ============================================================

// AFFINITY ACCESS

// ============================================================

function canUseAffinity(

  affinityState,

  requiredTier = 1

) {

  if (!affinityState) {

    return false;

  }

  if (

    affinityState.unlocked === false

  ) {

    return false;

  }

  return (

    Number(

      affinityState.tier

    ) >=

    Number(

      requiredTier

    )

  );

}

function canLearnAffinitySpell(

  affinityState,

  requiredTier = 1,

  requiredMastery = 0

) {

  if (

    !canUseAffinity(

      affinityState,

      requiredTier

    )

  ) {

    return false;

  }

  return (

    Number(

      affinityState.mastery

    ) >=

    Number(

      requiredMastery

    )

  );

}

// ============================================================

// FORMATTING

// ============================================================

function formatAffinity(

  affinityId,

  state = null

) {

  const affinity =

    getAffinity(

      affinityId

    );

  if (!affinity) {

    return "Unknown Affinity";

  }

  if (!state) {

    return [

      affinity.emoji,

      affinity.name,

    ].join(" ");

  }

  const tier =

    getTier(

      state.tier

    );

  const mastery =

    Number(

      state.mastery

    ) || 0;

  const next =

    getNextTier(

      state.tier

    );

  const progress =

    next

      ? `${mastery}/${next.masteryRequired}`

      : `${mastery} MAX`;

  const primary =

    state.primaryAffinity

      ? " • PRIMARY"

      : "";

  return [

    `${affinity.emoji} ${affinity.name}`,

    tier.name,

    `Mastery ${progress}${primary}`,

  ].join(" • ");

}

function formatAffinityList(

  affinities

) {

  if (

    !Array.isArray(

      affinities

    ) ||

    !affinities.length

  ) {

    return "No affinities unlocked.";

  }

  return affinities

    .map(

      state =>

        formatAffinity(

          state.affinity_id,

          state

        )

    )

    .join("\n");

}

// ============================================================

// EXPORTS

// ============================================================

module.exports = {

  // Data

  AFFINITIES,

  AFFINITY_TIERS,

  TIER_ORDER,

  CLASS_PRIMARY_AFFINITIES,

  // Normalization

  normalizeAffinityId,

  // Affinity lookup

  getAffinity,

  getAllAffinities,

  getAffinityDomain,

  getAffinityKingdom,

  // Tiers

  getTier,

  getTierByKey,

  getNextTier,

  getMasteryRequiredForTier,

  // Player state

  getPlayerAffinity,

  getPlayerAffinities,

  getPrimaryAffinity,

  getAffinityCount,

  // Primary / secondary

  setPrimaryAffinity,

  // Unlocking

  unlockAffinity,

  initializeClassAffinity,

  // Mastery

  addAffinityMastery,

  upgradeAffinity,

  // Environment

  getEnvironmentMultiplier,

  getAffinityPowerMultiplier,

  getPlayerAffinityPower,

  // Access

  canUseAffinity,

  canLearnAffinitySpell,

  // Formatting

  formatAffinity,

  formatAffinityList,

};
