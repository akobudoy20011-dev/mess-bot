"use strict";

/**
 * ECLIPSE RPG — EFFECT ENGINE
 * ===========================
 *
 * Central persistent combat-effect system.
 *
 * Responsibilities:
 *   - persistent buffs/debuffs
 *   - DoT / HoT
 *   - crowd control
 *   - shields
 *   - Ice Wall
 *   - Infinite Darkness
 *   - Shadow Body
 *   - lifesteal
 *   - Defense Health
 *   - Bark Skin / overheal conversion
 *   - damage modifiers
 *   - combat-effect state
 *
 * combat.js remains responsible for:
 *   - turns
 *   - HP/MP/stamina changes
 *   - actions
 *   - enemy AI
 *   - victory/defeat
 *   - rewards
 */

const db = require("../db");

// ============================================================
// EFFECT TYPES
// ============================================================

const EFFECT_TYPES = Object.freeze({
  BUFF: "buff",
  DEBUFF: "debuff",
  DOT: "dot",
  HOT: "hot",
  CONTROL: "control",
  SHIELD: "shield",
  TRANSFORMATION: "transformation",
  PASSIVE: "passive",
  SPECIAL: "special",
});

// ============================================================
// EFFECT IDS
// ============================================================

const EFFECT_IDS = Object.freeze({
  // Damage over time
  BURN: "burn",
  POISON: "poison",
  BLEED: "bleed",
  NECROTIC: "necrotic",

  // Control
  STUN: "stun",
  ROOT: "root",
  SLOW: "slow",
  BLIND: "blind",

  // Defensive
  DIVINE_SHIELD: "divine_shield",
  ICE_WALL: "heaven_piercing_ice_wall",
  DEFENSE_HEALTH: "defense_health",

  // Shadow
  INFINITE_DARKNESS: "infinite_darkness",
  SHADOW_BODY: "shadow_body",
  SHADOW_DISABLED: "shadow_disabled",

  // Buffs
  DAMAGE_UP: "damage_up",
  DEFENSE_UP: "defense_up",
  AGILITY_UP: "agility_up",
  MANA_REGEN_UP: "mana_regen_up",
  LIFESTEAL: "lifesteal",

  // Nature
  BARK_SKIN: "bark_skin",

  // General
  DAMAGE_REDUCTION: "damage_reduction",
  DODGE_UP: "dodge_up",
  DEFENSE_BREAK: "defense_break",
  WEAKNESS: "weakness",
});

// ============================================================
// STACKING RULES
// ============================================================

const STACK_RULES = Object.freeze({
  REPLACE: "replace",
  EXTEND: "extend",
  STACK: "stack",
  STRONGEST: "strongest",
  REFRESH: "refresh",
});

// ============================================================
// DEFAULT EFFECT DEFINITIONS
// ============================================================

const DEFAULTS = {
  [EFFECT_IDS.BURN]: {
    type: EFFECT_TYPES.DOT,
    stackRule: STACK_RULES.REFRESH,
    maxStacks: 1,
  },

  [EFFECT_IDS.POISON]: {
    type: EFFECT_TYPES.DOT,
    stackRule: STACK_RULES.STACK,
    maxStacks: 5,
  },

  [EFFECT_IDS.BLEED]: {
    type: EFFECT_TYPES.DOT,
    stackRule: STACK_RULES.STACK,
    maxStacks: 3,
  },

  [EFFECT_IDS.NECROTIC]: {
    type: EFFECT_TYPES.DOT,
    stackRule: STACK_RULES.REFRESH,
    maxStacks: 1,
  },

  [EFFECT_IDS.STUN]: {
    type: EFFECT_TYPES.CONTROL,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.ROOT]: {
    type: EFFECT_TYPES.CONTROL,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.SLOW]: {
    type: EFFECT_TYPES.DEBUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.BLIND]: {
    type: EFFECT_TYPES.DEBUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.DIVINE_SHIELD]: {
    type: EFFECT_TYPES.SHIELD,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.ICE_WALL]: {
    type: EFFECT_TYPES.SPECIAL,
    stackRule: STACK_RULES.REPLACE,
    maxStacks: 1,
  },

  [EFFECT_IDS.INFINITE_DARKNESS]: {
    type: EFFECT_TYPES.SPECIAL,
    stackRule: STACK_RULES.REPLACE,
    maxStacks: 1,
  },

  [EFFECT_IDS.SHADOW_BODY]: {
    type: EFFECT_TYPES.TRANSFORMATION,
    stackRule: STACK_RULES.REPLACE,
    maxStacks: 1,
  },

  [EFFECT_IDS.DAMAGE_UP]: {
    type: EFFECT_TYPES.BUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.DEFENSE_UP]: {
    type: EFFECT_TYPES.BUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.AGILITY_UP]: {
    type: EFFECT_TYPES.BUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.MANA_REGEN_UP]: {
    type: EFFECT_TYPES.BUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.LIFESTEAL]: {
    type: EFFECT_TYPES.BUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.BARK_SKIN]: {
    type: EFFECT_TYPES.PASSIVE,
    stackRule: STACK_RULES.REPLACE,
    maxStacks: 1,
  },

  [EFFECT_IDS.DAMAGE_REDUCTION]: {
    type: EFFECT_TYPES.BUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.DODGE_UP]: {
    type: EFFECT_TYPES.BUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.DEFENSE_BREAK]: {
    type: EFFECT_TYPES.DEBUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.WEAKNESS]: {
    type: EFFECT_TYPES.DEBUFF,
    stackRule: STACK_RULES.STRONGEST,
    maxStacks: 1,
  },

  [EFFECT_IDS.DEFENSE_HEALTH]: {
    type: EFFECT_TYPES.SHIELD,
    stackRule: STACK_RULES.REPLACE,
    maxStacks: 1,
  },

  [EFFECT_IDS.SHADOW_DISABLED]: {
    type: EFFECT_TYPES.DEBUFF,
    stackRule: STACK_RULES.REPLACE,
    maxStacks: 1,
  },
};

// ============================================================
// NORMALIZATION
// ============================================================

function normalizeEffectId(value) {
  if (!value) return null;

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ============================================================
// BASIC HELPERS
// ============================================================

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function safeJsonParse(value, fallback = {}) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

// ============================================================
// EFFECT OBJECT
// ============================================================

function createEffect({
  id,
  source = null,
  sourceType = "system",
  duration = 1,
  magnitude = 0,
  stacks = 1,
  data = {},
}) {
  const effectId = normalizeEffectId(id);

  if (!effectId) {
    throw new Error("Effect ID is required.");
  }

  const defaults =
    DEFAULTS[effectId] || {
      type: EFFECT_TYPES.BUFF,
      stackRule: STACK_RULES.REPLACE,
      maxStacks: 1,
    };

  const normalizedDuration = Math.max(
    0,
    safeNumber(duration, 0)
  );

  const maxStacks = Math.max(
    1,
    safeNumber(defaults.maxStacks, 1)
  );

  return {
    id: effectId,

    type: defaults.type,
    stackRule: defaults.stackRule,

    source:
      source === null || source === undefined
        ? null
        : String(source),

    sourceType:
      String(sourceType || "system"),

    duration: normalizedDuration,

    remainingTurns: normalizedDuration,

    magnitude: safeNumber(magnitude, 0),

    stacks: clamp(
      Math.floor(safeNumber(stacks, 1)),
      1,
      maxStacks
    ),

    data:
      data && typeof data === "object"
        ? { ...data }
        : {},
  };
}

// ============================================================
// DATABASE HELPERS
// ============================================================

async function getEffects(
  threadID,
  combatID,
  targetID
) {
  const result = await db.query(
    `
      SELECT
        id,
        effect_id,
        target_id,
        source_id,
        source_type,
        effect_type,
        stacks,
        magnitude,
        duration,
        remaining_turns,
        data,
        created_at
      FROM rpg_combat_effects
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
        AND remaining_turns > 0
      ORDER BY id ASC
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),
    ]
  );

  return result.rows.map(normalizeDbEffect);
}

async function getAllCombatEffects(
  threadID,
  combatID
) {
  const result = await db.query(
    `
      SELECT
        id,
        effect_id,
        target_id,
        source_id,
        source_type,
        effect_type,
        stacks,
        magnitude,
        duration,
        remaining_turns,
        data,
        created_at
      FROM rpg_combat_effects
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND remaining_turns > 0
      ORDER BY id ASC
    `,
    [
      String(threadID),
      String(combatID),
    ]
  );

  return result.rows.map(normalizeDbEffect);
}

// ============================================================
// APPLY EFFECT
// ============================================================

async function applyEffect(
  threadID,
  combatID,
  targetID,
  effect
) {
  const normalized = createEffect(effect);

  if (normalized.duration <= 0) {
    return {
      created: false,
      refreshed: false,
      stacked: false,
      effect: null,
      ignored: true,
    };
  }

  const existingResult = await db.query(
    `
      SELECT
        id,
        source_id,
        source_type,
        effect_type,
        stacks,
        magnitude,
        duration,
        remaining_turns,
        data
      FROM rpg_combat_effects
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
        AND effect_id = $4
        AND remaining_turns > 0
      ORDER BY id DESC
      LIMIT 1
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),
      normalized.id,
    ]
  );

  const existing = existingResult.rows[0];

  if (!existing) {
    const nowMs = Date.now();

    const result = await db.query(
      `
        INSERT INTO rpg_combat_effects (
          thread_id,
          combat_session_id,
          target_id,
          source_id,
          source_type,
          effect_id,
          effect_type,
          stacks,
          magnitude,
          duration,
          remaining_turns,
          data,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11, $12,
          $13, $13
        )
        RETURNING *
      `,
      [
        String(threadID),
        String(combatID),
        String(targetID),

        normalized.source,
        normalized.sourceType,

        normalized.id,
        normalized.type,

        normalized.stacks,
        normalized.magnitude,
        normalized.duration,
        normalized.remainingTurns,

        JSON.stringify(normalized.data),

        nowMs,
      ]
    );

    return {
      created: true,
      refreshed: false,
      stacked: false,
      effect: normalizeDbEffect(
        result.rows[0]
      ),
    };
  }

  const defaults =
    DEFAULTS[normalized.id] || {};

  let stacks =
    safeNumber(existing.stacks, 1);

  let magnitude =
    safeNumber(existing.magnitude, 0);

  let duration =
    safeNumber(existing.duration, 0);

  let remainingTurns =
    safeNumber(existing.remaining_turns, 0);

  const maxStacks = Math.max(
    1,
    safeNumber(defaults.maxStacks, 1)
  );

  switch (defaults.stackRule) {
    case STACK_RULES.STACK: {
      stacks = Math.min(
        maxStacks,
        stacks + normalized.stacks
      );

      magnitude = Math.max(
        magnitude,
        normalized.magnitude
      );

      duration = Math.max(
        duration,
        normalized.duration
      );

      remainingTurns = Math.max(
        remainingTurns,
        normalized.remainingTurns
      );

      break;
    }

    case STACK_RULES.EXTEND: {
      magnitude = Math.max(
        magnitude,
        normalized.magnitude
      );

      duration = Math.max(
        duration,
        normalized.duration
      );

      remainingTurns = Math.min(
        Math.max(
          duration,
          normalized.duration
        ),
        remainingTurns +
          normalized.remainingTurns
      );

      break;
    }

    case STACK_RULES.STRONGEST: {
      if (
        normalized.magnitude >
        magnitude
      ) {
        magnitude =
          normalized.magnitude;

        duration =
          normalized.duration;

        remainingTurns =
          normalized.remainingTurns;
      } else {
        remainingTurns =
          Math.max(
            remainingTurns,
            normalized.remainingTurns
          );

        duration =
          Math.max(
            duration,
            normalized.duration
          );
      }

      break;
    }

    case STACK_RULES.REFRESH: {
      magnitude = Math.max(
        magnitude,
        normalized.magnitude
      );

      duration = Math.max(
        duration,
        normalized.duration
      );

      remainingTurns = Math.max(
        remainingTurns,
        normalized.remainingTurns
      );

      break;
    }

    case STACK_RULES.REPLACE:
    default: {
      stacks =
        normalized.stacks;

      magnitude =
        normalized.magnitude;

      duration =
        normalized.duration;

      remainingTurns =
        normalized.remainingTurns;

      break;
    }
  }

  const existingData =
    safeJsonParse(
      existing.data,
      {}
    );

  const mergedData = {
    ...existingData,
    ...normalized.data,
  };

  const nowMs = Date.now();

  const result = await db.query(
    `
      UPDATE rpg_combat_effects
      SET
        source_id = $4,
        source_type = $5,
        effect_type = $6,
        stacks = $7,
        magnitude = $8,
        duration = $9,
        remaining_turns = $10,
        data = $11,
        updated_at = $12
      WHERE id = $1
        AND thread_id = $2
        AND combat_session_id = $3
      RETURNING *
    `,
    [
      existing.id,

      String(threadID),
      String(combatID),

      normalized.source,
      normalized.sourceType,
      normalized.type,

      stacks,
      magnitude,
      duration,
      remainingTurns,

      JSON.stringify(mergedData),

      nowMs,
    ]
  );

  return {
    created: false,
    refreshed: true,
    stacked:
      defaults.stackRule ===
      STACK_RULES.STACK,

    effect:
      normalizeDbEffect(
        result.rows[0]
      ),
  };
}

// ============================================================
// REMOVE EFFECT
// ============================================================

async function removeEffect(
  threadID,
  combatID,
  targetID,
  effectID
) {
  const id =
    normalizeEffectId(effectID);

  if (!id) return false;

  const result = await db.query(
    `
      DELETE FROM rpg_combat_effects
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
        AND effect_id = $4
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),
      id,
    ]
  );

  return result.rowCount > 0;
}

async function removeEffectByDbID(
  threadID,
  combatID,
  dbID
) {
  const result = await db.query(
    `
      DELETE FROM rpg_combat_effects
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND id = $3
    `,
    [
      String(threadID),
      String(combatID),
      Number(dbID),
    ]
  );

  return result.rowCount > 0;
}

async function clearEffects(
  threadID,
  combatID,
  targetID
) {
  const result = await db.query(
    `
      DELETE FROM rpg_combat_effects
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),
    ]
  );

  return result.rowCount;
}

// ============================================================
// CHECK EFFECT
// ============================================================

async function hasEffect(
  threadID,
  combatID,
  targetID,
  effectID
) {
  const id =
    normalizeEffectId(effectID);

  if (!id) return false;

  const result = await db.query(
    `
      SELECT 1
      FROM rpg_combat_effects
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
        AND effect_id = $4
        AND remaining_turns > 0
      LIMIT 1
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),
      id,
    ]
  );

  return result.rowCount > 0;
}

async function getEffect(
  threadID,
  combatID,
  targetID,
  effectID
) {
  const id =
    normalizeEffectId(effectID);

  if (!id) return null;

  const result = await db.query(
    `
      SELECT
        id,
        effect_id,
        target_id,
        source_id,
        source_type,
        effect_type,
        stacks,
        magnitude,
        duration,
        remaining_turns,
        data,
        created_at
      FROM rpg_combat_effects
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
        AND effect_id = $4
        AND remaining_turns > 0
      ORDER BY id DESC
      LIMIT 1
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),
      id,
    ]
  );

  return result.rows.length
    ? normalizeDbEffect(
        result.rows[0]
      )
    : null;
}

// ============================================================
// TURN PROCESSING
// ============================================================

async function processStartOfTurn(
  threadID,
  combatID,
  targetID,
  context = {}
) {
  const activeEffects =
    await getEffects(
      threadID,
      combatID,
      targetID
    );

  const result = {
    damage: 0,
    healing: 0,
    mana: 0,
    stamina: 0,

    stunned: false,
    rooted: false,
    silenced: false,

    events: [],
  };

  for (const effect of activeEffects) {
    const stacks = Math.max(
      1,
      safeNumber(effect.stacks, 1)
    );

    // --------------------------------------------------------
    // BURN
    // --------------------------------------------------------

    if (
      effect.id ===
      EFFECT_IDS.BURN
    ) {
      let damage =
        safeNumber(
          effect.magnitude,
          0
        ) * stacks;

      if (
        String(
          context.season || ""
        ).toLowerCase() === "summer" ||
        String(
          context.weather || ""
        ).toLowerCase() === "heat"
      ) {
        damage *= 1.25;
      }

      damage = Math.max(
        0,
        Math.round(damage)
      );

      result.damage += damage;

      result.events.push({
        type: "burn",
        effect,
        damage,
      });
    }

    // --------------------------------------------------------
    // POISON
    // --------------------------------------------------------

    else if (
      effect.id ===
      EFFECT_IDS.POISON
    ) {
      const damage =
        Math.max(
          1,
          Math.round(
            safeNumber(
              effect.magnitude,
              0
            ) * stacks
          )
        );

      result.damage += damage;

      result.events.push({
        type: "poison",
        effect,
        damage,
      });
    }

    // --------------------------------------------------------
    // BLEED
    // --------------------------------------------------------

    else if (
      effect.id ===
      EFFECT_IDS.BLEED
    ) {
      const damage =
        Math.max(
          1,
          Math.round(
            safeNumber(
              effect.magnitude,
              0
            ) * stacks
          )
        );

      result.damage += damage;

      result.events.push({
        type: "bleed",
        effect,
        damage,
      });
    }

    // --------------------------------------------------------
    // NECROTIC
    // --------------------------------------------------------

    else if (
      effect.id ===
      EFFECT_IDS.NECROTIC
    ) {
      const damage =
        Math.max(
          1,
          Math.round(
            safeNumber(
              effect.magnitude,
              0
            )
          )
        );

      result.damage += damage;

      result.events.push({
        type: "necrotic",
        effect,
        damage,
      });
    }

    // --------------------------------------------------------
    // STUN
    // --------------------------------------------------------

    else if (
      effect.id ===
      EFFECT_IDS.STUN
    ) {
      result.stunned = true;

      result.events.push({
        type: "stun",
        effect,
      });
    }

    // --------------------------------------------------------
    // ROOT
    // --------------------------------------------------------

    else if (
      effect.id ===
      EFFECT_IDS.ROOT
    ) {
      result.rooted = true;

      result.events.push({
        type: "root",
        effect,
      });
    }

    // --------------------------------------------------------
    // SILENCE
    // --------------------------------------------------------

    else if (
      effect.id === "silence"
    ) {
      result.silenced = true;

      result.events.push({
        type: "silence",
        effect,
      });
    }

    // --------------------------------------------------------
    // SLOW
    // --------------------------------------------------------

    else if (
      effect.id ===
      EFFECT_IDS.SLOW
    ) {
      result.events.push({
        type: "slow",
        effect,
        magnitude: clamp(
          safeNumber(
            effect.magnitude,
            0
          ),
          0,
          0.95
        ),
      });
    }

    // --------------------------------------------------------
    // BLIND
    // --------------------------------------------------------

    else if (
      effect.id ===
      EFFECT_IDS.BLIND
    ) {
      result.events.push({
        type: "blind",
        effect,
        magnitude: clamp(
          safeNumber(
            effect.magnitude,
            0
          ),
          0,
          1
        ),
      });
    }

    // --------------------------------------------------------
    // MANA REGEN
    // --------------------------------------------------------

    else if (
      effect.id ===
      EFFECT_IDS.MANA_REGEN_UP
    ) {
      const maxMp =
        safeNumber(
          context.maxMp,
          0
        );

      if (maxMp > 0) {
        const mana =
          Math.max(
            1,
            Math.round(
              maxMp *
                safeNumber(
                  effect.magnitude,
                  0
                )
            )
          );

        result.mana += mana;

        result.events.push({
          type: "mana_regeneration",
          effect,
          mana,
        });
      }
    }

    // --------------------------------------------------------
    // GENERIC HOT
    // --------------------------------------------------------

    else if (
      effect.type ===
      EFFECT_TYPES.HOT
    ) {
      const healing =
        Math.max(
          0,
          Math.round(
            safeNumber(
              effect.magnitude,
              0
            ) * stacks
          )
        );

      result.healing += healing;

      result.events.push({
        type: "healing_over_time",
        effect,
        healing,
      });
    }
  }

  return result;
}

async function processEndOfTurn(
  threadID,
  combatID,
  targetID
) {
  const result = await db.query(
    `
      UPDATE rpg_combat_effects
      SET
        remaining_turns =
          GREATEST(
            remaining_turns - 1,
            0
          ),
        updated_at = $4
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
        AND remaining_turns > 0
      RETURNING *
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),
      Date.now(),
    ]
  );

  const expired = [];

  for (const row of result.rows) {
    if (
      safeNumber(
        row.remaining_turns,
        0
      ) <= 0
    ) {
      expired.push(
        normalizeDbEffect(row)
      );
    }
  }

  if (expired.length) {
    await db.query(
      `
        DELETE FROM rpg_combat_effects
        WHERE thread_id = $1
          AND combat_session_id = $2
          AND target_id = $3
          AND remaining_turns <= 0
      `,
      [
        String(threadID),
        String(combatID),
        String(targetID),
      ]
    );
  }

  return {
    expired,
  };
}

// ============================================================
// DAMAGE MODIFIERS
// ============================================================

async function calculateIncomingDamage(
  threadID,
  combatID,
  targetID,
  damage,
  context = {}
) {
  let finalDamage = Math.max(
    0,
    safeNumber(damage, 0)
  );

  const activeEffects =
    await getEffects(
      threadID,
      combatID,
      targetID
    );

  const modifiers = {
    reduction: 0,
    increase: 0,
    blocked: false,
    iceWallTriggered: false,
    divineShieldTriggered: false,
  };

  // ----------------------------------------------------------
  // ICE WALL
  // ----------------------------------------------------------

  const iceWall =
    activeEffects.find(
      (effect) =>
        effect.id ===
        EFFECT_IDS.ICE_WALL
    );

  if (iceWall) {
    const blocks =
      safeNumber(
        iceWall.data?.blockDamageEvents,
        0
      );

    if (blocks > 0) {
      await consumeIceWallBlock(
        threadID,
        combatID,
        targetID
      );

      return {
        damage: 0,

        modifiers: {
          ...modifiers,
          blocked: true,
          iceWallTriggered: true,
        },
      };
    }

    const wallMultiplier =
      safeNumber(
        iceWall.data
          ?.enemyDamageMultiplier,
        1
      );

    if (
      wallMultiplier > 0 &&
      wallMultiplier !== 1
    ) {
      finalDamage *=
        wallMultiplier;
    }
  }

  // ----------------------------------------------------------
  // DAMAGE MODIFIERS
  // ----------------------------------------------------------

  for (const effect of activeEffects) {
    // --------------------------------------------------------
    // GENERIC DAMAGE REDUCTION
    // --------------------------------------------------------

    if (
      effect.id ===
      EFFECT_IDS.DAMAGE_REDUCTION
    ) {
      modifiers.reduction =
        Math.max(
          modifiers.reduction,
          clamp(
            safeNumber(
              effect.magnitude,
              0
            ),
            0,
            1
          )
        );
    }

    // --------------------------------------------------------
    // DIVINE SHIELD
    //
    // Divine Shield is a 50% incoming-damage reduction.
    // --------------------------------------------------------

    if (
      effect.id ===
      EFFECT_IDS.DIVINE_SHIELD
    ) {
      modifiers.reduction =
        Math.max(
          modifiers.reduction,
          0.5
        );

      modifiers.divineShieldTriggered =
        true;
    }

    // --------------------------------------------------------
    // INFINITE DARKNESS
    // --------------------------------------------------------

    if (
      effect.id ===
      EFFECT_IDS.INFINITE_DARKNESS
    ) {
      const multiplier =
        safeNumber(
          effect.data
            ?.enemyDamageMultiplier,
          1
        );

      if (
        multiplier > 0 &&
        multiplier !== 1
      ) {
        finalDamage *=
          multiplier;
      }
    }

    // --------------------------------------------------------
    // WEAKNESS
    //
    // IMPORTANT:
    // Weakness is NOT an incoming-damage increase here.
    //
    // It is handled by combat.js on the enemy's outgoing
    // damage before this function is called.
    //
    // Keeping it here would double-apply the effect and
    // invert its intended direction.
    // --------------------------------------------------------
  }

  // ----------------------------------------------------------
  // APPLY REDUCTION
  // ----------------------------------------------------------

  if (
    modifiers.reduction > 0
  ) {
    finalDamage *=
      1 - modifiers.reduction;
  }

  // ----------------------------------------------------------
  // SHADOW BODY
  // ----------------------------------------------------------

  const shadowBody =
    activeEffects.find(
      (effect) =>
        effect.id ===
        EFFECT_IDS.SHADOW_BODY
    );

  if (
    shadowBody &&
    context.targetIsShadow === true
  ) {
    finalDamage *=
      Math.max(
        0,
        safeNumber(
          shadowBody.data
            ?.reflectedDamageMultiplier,
          1.25
        )
      );
  }

  return {
    damage: Math.max(
      0,
      Math.round(finalDamage)
    ),

    modifiers,
  };
}

// ============================================================
// OUTGOING DAMAGE
// ============================================================

async function calculateOutgoingDamage(
  threadID,
  combatID,
  sourceID,
  targetID,
  damage,
  context = {}
) {
  let finalDamage =
    Math.max(
      0,
      safeNumber(damage, 0)
    );

  const activeEffects =
    await getEffects(
      threadID,
      combatID,
      sourceID
    );

  const modifiers = {
    multiplier: 1,
    lifesteal: 0,
  };

  for (const effect of activeEffects) {
    // --------------------------------------------------------
    // DAMAGE UP
    // --------------------------------------------------------

    if (
      effect.id ===
      EFFECT_IDS.DAMAGE_UP
    ) {
      /*
       * Some spells can create a DAMAGE_UP effect that is
       * explicitly spell-only.
       *
       * Normal attacks/skills must not accidentally receive
       * that multiplier.
       */
      const spellOnly =
        effect.data?.spellOnly === true ||
        effect.data?.sourceScope === "spell";

      if (
        spellOnly &&
        context.spell !== true
      ) {
        continue;
      }

      const multiplier =
        Math.max(
          0,
          safeNumber(
            effect.magnitude,
            1
          )
        );

      modifiers.multiplier *=
        multiplier;
    }

    // --------------------------------------------------------
    // INFINITE DARKNESS
    // --------------------------------------------------------

    if (
      effect.id ===
      EFFECT_IDS.INFINITE_DARKNESS
    ) {
      const multiplier =
        safeNumber(
          effect.data
            ?.damageMultiplier,
          1
        );

      if (
        multiplier > 0
      ) {
        modifiers.multiplier *=
          multiplier;
      }

      const healingRatio =
        safeNumber(
          effect.data
            ?.damageToHealing,
          0
        );

      if (
        healingRatio > 0
      ) {
        modifiers.lifesteal =
          Math.max(
            modifiers.lifesteal,
            healingRatio
          );
      }
    }

    // --------------------------------------------------------
    // LIFESTEAL
    // --------------------------------------------------------

    if (
      effect.id ===
      EFFECT_IDS.LIFESTEAL
    ) {
      modifiers.lifesteal =
        Math.max(
          modifiers.lifesteal,
          Math.max(
            0,
            safeNumber(
              effect.magnitude,
              0
            )
          )
        );
    }
  }

  finalDamage *=
    modifiers.multiplier;

  return {
    damage: Math.max(
      0,
      Math.round(finalDamage)
    ),

    lifesteal:
      modifiers.lifesteal,

    modifiers,
  };
}

// ============================================================
// ICE WALL
// ============================================================

async function createIceWall(
  threadID,
  combatID,
  targetID,
  sourceID = null
) {
  return applyEffect(
    threadID,
    combatID,
    targetID,
    {
      id:
        EFFECT_IDS.ICE_WALL,

      source: sourceID,
      sourceType: "special",

      duration: 99,

      magnitude: 0,

      data: {
        blockDamageEvents: 3,
        enemyDamageMultiplier: 0.5,
        forcedStunOnUserMove: true,
      },
    }
  );
}

async function consumeIceWallBlock(
  threadID,
  combatID,
  targetID
) {
  const effect =
    await getEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.ICE_WALL
    );

  if (!effect) {
    return {
      remainingBlocks: 0,
      active: false,
    };
  }

  const currentBlocks =
    Math.max(
      0,
      safeNumber(
        effect.data
          ?.blockDamageEvents,
        0
      )
    );

  const remaining =
    Math.max(
      0,
      currentBlocks - 1
    );

  if (remaining <= 0) {
    await removeEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.ICE_WALL
    );

    return {
      remainingBlocks: 0,
      active: false,
    };
  }

  const nowMs = Date.now();

  await db.query(
    `
      UPDATE rpg_combat_effects
      SET
        data = $4,
        updated_at = $6
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
        AND effect_id = $5
        AND remaining_turns > 0
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),

      JSON.stringify({
        ...effect.data,
        blockDamageEvents:
          remaining,
      }),

      EFFECT_IDS.ICE_WALL,

      nowMs,
    ]
  );

  return {
    remainingBlocks: remaining,
    active: true,
  };
}

// ============================================================
// SHADOW BODY
// ============================================================

async function createShadowBody(
  threadID,
  combatID,
  targetID,
  sourceID = null
) {
  return applyEffect(
    threadID,
    combatID,
    targetID,
    {
      id:
        EFFECT_IDS.SHADOW_BODY,

      source: sourceID,
      sourceType: "special",

      duration: 5,

      magnitude: 0.5,

      data: {
        statMultiplier: 0.5,
        reflectedDamageMultiplier: 1.25,
        regainOnDamage: true,
        deathDisablesShadowSpells: true,
      },
    }
  );
}

async function destroyShadowBody(
  threadID,
  combatID,
  targetID,
  options = {}
) {
  const removed =
    await removeEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.SHADOW_BODY
    );

  if (
    options.disableShadowSpells
  ) {
    await applyEffect(
      threadID,
      combatID,
      targetID,
      {
        id:
          EFFECT_IDS.SHADOW_DISABLED,

        duration:
          Math.max(
            1,
            safeNumber(
              options.duration,
              1
            )
          ),

        sourceType: "system",

        data: {
          reason:
            "shadow_body_destroyed",
        },
      }
    );
  }

  return removed;
}

// ============================================================
// INFINITE DARKNESS
// ============================================================

async function createInfiniteDarkness(
  threadID,
  combatID,
  sourceID,
  options = {}
) {
  const duration =
    Math.max(
      1,
      safeNumber(
        options.duration,
        5
      )
    );

  const enemyDamageMultiplier =
    clamp(
      safeNumber(
        options.enemyDamageMultiplier,
        0.8
      ),
      0,
      1
    );

  const damageToHealing =
    Math.max(
      0,
      safeNumber(
        options.damageToHealing,
        0.2
      )
    );

  const damageMultiplier =
    Math.max(
      0,
      safeNumber(
        options.damageMultiplier,
        1
      )
    );

  await applyEffect(
    threadID,
    combatID,
    sourceID,
    {
      id:
        EFFECT_IDS.INFINITE_DARKNESS,

      source: sourceID,
      sourceType: "special",

      duration,

      magnitude:
        damageToHealing,

      data: {
        stunAllEnemies:
          options.stunAllEnemies !==
          false,

        enemyDamageMultiplier,

        damageToHealing,

        damageMultiplier,

        duration,
      },
    }
  );

  return {
    duration,
    enemyDamageMultiplier,
    damageToHealing,
    damageMultiplier,

    stunAllEnemies:
      options.stunAllEnemies !==
      false,
  };
}

// ============================================================
// STATUS HELPERS
// ============================================================

async function isStunned(
  threadID,
  combatID,
  targetID
) {
  return hasEffect(
    threadID,
    combatID,
    targetID,
    EFFECT_IDS.STUN
  );
}

async function isRooted(
  threadID,
  combatID,
  targetID
) {
  return hasEffect(
    threadID,
    combatID,
    targetID,
    EFFECT_IDS.ROOT
  );
}

async function isShadowDisabled(
  threadID,
  combatID,
  targetID
) {
  return hasEffect(
    threadID,
    combatID,
    targetID,
    EFFECT_IDS.SHADOW_DISABLED
  );
}

async function isSilenced(
  threadID,
  combatID,
  targetID
) {
  return hasEffect(
    threadID,
    combatID,
    targetID,
    "silence"
  );
}

// ============================================================
// COMBAT STAT HELPERS
// ============================================================

async function getDefenseBreak(
  threadID,
  combatID,
  targetID
) {
  const effect =
    await getEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.DEFENSE_BREAK
    );

  if (!effect) return 0;

  return clamp(
    safeNumber(
      effect.magnitude,
      0
    ),
    0,
    1
  );
}

async function getDodgeBonus(
  threadID,
  combatID,
  targetID
) {
  const effect =
    await getEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.DODGE_UP
    );

  if (!effect) return 0;

  return clamp(
    safeNumber(
      effect.magnitude,
      0
    ),
    0,
    1
  );
}

async function getDamageMultiplier(
  threadID,
  combatID,
  targetID,
  context = {}
) {
  const effects =
    await getEffects(
      threadID,
      combatID,
      targetID
    );

  let multiplier = 1;

  for (const effect of effects) {
    if (
      effect.id !==
      EFFECT_IDS.DAMAGE_UP
    ) {
      continue;
    }

    const spellOnly =
      effect.data?.spellOnly === true ||
      effect.data?.sourceScope === "spell";

    if (
      spellOnly &&
      context.spell !== true
    ) {
      continue;
    }

    multiplier *= Math.max(
      0,
      safeNumber(
        effect.magnitude,
        1
      )
    );
  }

  return multiplier;
}

async function getDamageReduction(
  threadID,
  combatID,
  targetID
) {
  const effects =
    await getEffects(
      threadID,
      combatID,
      targetID
    );

  let reduction = 0;

  for (const effect of effects) {
    if (
      effect.id ===
      EFFECT_IDS.DAMAGE_REDUCTION
    ) {
      reduction =
        Math.max(
          reduction,
          clamp(
            safeNumber(
              effect.magnitude,
              0
            ),
            0,
            1
          )
        );
    }

    if (
      effect.id ===
      EFFECT_IDS.DIVINE_SHIELD
    ) {
      reduction =
        Math.max(
          reduction,
          0.5
        );
    }
  }

  return reduction;
}

// ============================================================
// DEFENSE HEALTH / BARK SKIN
// ============================================================

async function addDefenseHealth(
  threadID,
  combatID,
  targetID,
  amount
) {
  const value =
    Math.max(
      0,
      Math.round(
        safeNumber(amount, 0)
      )
    );

  const current =
    await getDefenseHealth(
      threadID,
      combatID,
      targetID
    );

  if (!value) {
    return {
      amount: 0,
      total: current,
    };
  }

  const total =
    current + value;

  await applyEffect(
    threadID,
    combatID,
    targetID,
    {
      id:
        EFFECT_IDS.DEFENSE_HEALTH,

      duration: 999,

      magnitude: total,

      data: {
        defenseHealth: total,
      },
    }
  );

  return {
    amount: value,
    total,
  };
}

async function getDefenseHealth(
  threadID,
  combatID,
  targetID
) {
  const effect =
    await getEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.DEFENSE_HEALTH
    );

  if (!effect) return 0;

  return Math.max(
    0,
    safeNumber(
      effect.data
        ?.defenseHealth ??
        effect.magnitude,
      0
    )
  );
}

async function absorbDefenseHealth(
  threadID,
  combatID,
  targetID,
  damage
) {
  const incoming =
    Math.max(
      0,
      Math.round(
        safeNumber(
          damage,
          0
        )
      )
    );

  const current =
    await getDefenseHealth(
      threadID,
      combatID,
      targetID
    );

  if (
    current <= 0 ||
    incoming <= 0
  ) {
    return {
      absorbed: 0,
      remainingDamage: incoming,
      remainingDefenseHealth:
        current,
    };
  }

  const absorbed =
    Math.min(
      current,
      incoming
    );

  const remaining =
    current - absorbed;

  if (remaining <= 0) {
    await removeEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.DEFENSE_HEALTH
    );
  } else {
    await applyEffect(
      threadID,
      combatID,
      targetID,
      {
        id:
          EFFECT_IDS.DEFENSE_HEALTH,

        duration: 999,

        magnitude: remaining,

        data: {
          defenseHealth:
            remaining,
        },
      }
    );
  }

  return {
    absorbed,
    remainingDamage:
      incoming - absorbed,

    remainingDefenseHealth:
      remaining,
  };
}

async function convertOverheal(
  threadID,
  combatID,
  targetID,
  healing,
  currentHp,
  maxHp
) {
  const amount =
    Math.max(
      0,
      safeNumber(
        healing,
        0
      )
    );

  const hp =
    Math.max(
      0,
      safeNumber(
        currentHp,
        0
      )
    );

  const max =
    Math.max(
      0,
      safeNumber(
        maxHp,
        0
      )
    );

  const actualHealing =
    Math.min(
      amount,
      Math.max(
        0,
        max - hp
      )
    );

  const overheal =
    Math.max(
      0,
      amount -
        actualHealing
    );

  const barkSkin =
    await hasEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.BARK_SKIN
    );

  if (
    !barkSkin ||
    overheal <= 0
  ) {
    return {
      actualHealing,
      overheal,
      defenseHealth: 0,
    };
  }

  await addDefenseHealth(
    threadID,
    combatID,
    targetID,
    overheal
  );

  return {
    actualHealing,
    overheal,
    defenseHealth:
      overheal,
  };
}

// ============================================================
// LIFESTEAL
// ============================================================

function calculateLifesteal(
  damage,
  ratio
) {
  const dealt =
    Math.max(
      0,
      safeNumber(
        damage,
        0
      )
    );

  const percent =
    Math.max(
      0,
      safeNumber(
        ratio,
        0
      )
    );

  return Math.max(
    0,
    Math.round(
      dealt * percent
    )
  );
}

// ============================================================
// EFFECT DESCRIPTION
// ============================================================

function describeEffect(effect) {
  if (!effect) {
    return "Unknown effect.";
  }

  const labels = {
    [EFFECT_IDS.BURN]:
      "Burning",

    [EFFECT_IDS.POISON]:
      "Poisoned",

    [EFFECT_IDS.BLEED]:
      "Bleeding",

    [EFFECT_IDS.NECROTIC]:
      "Necrotic",

    [EFFECT_IDS.STUN]:
      "Stunned",

    [EFFECT_IDS.ROOT]:
      "Rooted",

    [EFFECT_IDS.SLOW]:
      "Slowed",

    [EFFECT_IDS.BLIND]:
      "Blinded",

    [EFFECT_IDS.DIVINE_SHIELD]:
      "Divine Shield",

    [EFFECT_IDS.ICE_WALL]:
      "Heaven Piercing Ice Wall",

    [EFFECT_IDS.INFINITE_DARKNESS]:
      "Infinite Darkness",

    [EFFECT_IDS.SHADOW_BODY]:
      "Shadow Body",

    [EFFECT_IDS.DAMAGE_UP]:
      "Damage Up",

    [EFFECT_IDS.DEFENSE_UP]:
      "Defense Up",

    [EFFECT_IDS.AGILITY_UP]:
      "Agility Up",

    [EFFECT_IDS.MANA_REGEN_UP]:
      "Mana Regeneration",

    [EFFECT_IDS.LIFESTEAL]:
      "Lifesteal",

    [EFFECT_IDS.BARK_SKIN]:
      "Bark Skin",

    [EFFECT_IDS.DAMAGE_REDUCTION]:
      "Damage Reduction",

    [EFFECT_IDS.DODGE_UP]:
      "Dodge Up",

    [EFFECT_IDS.DEFENSE_BREAK]:
      "Defense Break",

    [EFFECT_IDS.WEAKNESS]:
      "Weakened",

    [EFFECT_IDS.DEFENSE_HEALTH]:
      "Defense Health",

    [EFFECT_IDS.SHADOW_DISABLED]:
      "Shadow Disabled",
  };

  const name =
    labels[effect.id] ||
    effect.id ||
    "Unknown Effect";

  const parts = [name];

  if (
    safeNumber(
      effect.stacks,
      1
    ) > 1
  ) {
    parts.push(
      `x${effect.stacks}`
    );
  }

  if (
    effect.remainingTurns != null &&
    safeNumber(
      effect.remainingTurns,
      0
    ) < 900
  ) {
    const turns =
      safeNumber(
        effect.remainingTurns,
        0
      );

    parts.push(
      `${turns} turn${
        turns === 1
          ? ""
          : "s"
      }`
    );
  }

  if (
    effect.id ===
    EFFECT_IDS.ICE_WALL
  ) {
    const blocks =
      safeNumber(
        effect.data
          ?.blockDamageEvents,
        0
      );

    if (blocks > 0) {
      parts.push(
        `${blocks} blocks`
      );
    }
  }

  if (
    effect.id ===
    EFFECT_IDS.DEFENSE_HEALTH
  ) {
    const defense =
      safeNumber(
        effect.data
          ?.defenseHealth ??
          effect.magnitude,
        0
      );

    parts.push(
      `${Math.round(
        defense
      )} HP`
    );
  }

  return parts.join(
    " · "
  );
}

// ============================================================
// INTERNAL NORMALIZATION
// ============================================================

function normalizeDbEffect(row) {
  return {
    dbId: row.id,

    id: normalizeEffectId(
      row.effect_id
    ),

    targetId:
      row.target_id,

    source:
      row.source_id,

    sourceType:
      row.source_type,

    type:
      row.effect_type,

    stacks:
      safeNumber(
        row.stacks,
        1
      ),

    magnitude:
      safeNumber(
        row.magnitude,
        0
      ),

    duration:
      safeNumber(
        row.duration,
        0
      ),

    remainingTurns:
      safeNumber(
        row.remaining_turns,
        0
      ),

    data:
      safeJsonParse(
        row.data,
        {}
      ),

    createdAt:
      row.created_at,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  EFFECT_TYPES,
  EFFECT_IDS,
  STACK_RULES,
  DEFAULTS,

  normalizeEffectId,
  createEffect,

  getEffects,
  getAllCombatEffects,

  applyEffect,
  removeEffect,
  removeEffectByDbID,
  clearEffects,

  hasEffect,
  getEffect,

  processStartOfTurn,
  processEndOfTurn,

  calculateIncomingDamage,
  calculateOutgoingDamage,

  createIceWall,
  consumeIceWallBlock,

  createShadowBody,
  destroyShadowBody,

  createInfiniteDarkness,

  isStunned,
  isRooted,
  isSilenced,
  isShadowDisabled,

  getDefenseBreak,
  getDodgeBonus,
  getDamageMultiplier,
  getDamageReduction,

  addDefenseHealth,
  getDefenseHealth,
  absorbDefenseHealth,
  convertOverheal,

  calculateLifesteal,

  describeEffect,
};
