"use strict";

/**
 * ECLIPSE RPG — EFFECT ENGINE
 * ===========================
 *
 * Central persistent combat-effect system.
 *
 * This file handles:
 *   - buffs
 *   - debuffs
 *   - damage-over-time
 *   - healing-over-time
 *   - stun
 *   - slow
 *   - poison
 *   - burn
 *   - bleed
 *   - shields
 *   - Ice Wall
 *   - Shadow Body
 *   - lifesteal
 *   - defense health / Bark Skin
 *   - damage modifiers
 *   - seasonal/environmental modifiers
 *
 * combat.js should use this engine rather than implementing
 * individual effects itself.
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
// DEFAULT EFFECTS
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

  return {
    id: effectId,
    type: defaults.type,
    stackRule: defaults.stackRule,

    source,
    sourceType,

    duration: Math.max(0, Number(duration) || 0),
    remainingTurns: Math.max(0, Number(duration) || 0),

    magnitude: Number(magnitude) || 0,

    stacks: Math.max(
      1,
      Math.min(
        Number(stacks) || 1,
        defaults.maxStacks || 1
      )
    ),

    data: {
      ...data,
    },
  };
}

// ============================================================
// DATABASE HELPERS
// ============================================================

async function getEffects(threadID, combatID, targetID) {
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

  return result.rows.map((row) => ({
    dbId: row.id,
    id: row.effect_id,
    targetId: row.target_id,
    source: row.source_id,
    sourceType: row.source_type,
    type: row.effect_type,
    stacks: Number(row.stacks || 1),
    magnitude: Number(row.magnitude || 0),
    duration: Number(row.duration || 0),
    remainingTurns: Number(row.remaining_turns || 0),
    data:
      typeof row.data === "string"
        ? safeJsonParse(row.data, {})
        : row.data || {},
    createdAt: row.created_at,
  }));
}

async function getAllCombatEffects(threadID, combatID) {
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

  return result.rows.map((row) => ({
    dbId: row.id,
    id: row.effect_id,
    targetId: row.target_id,
    source: row.source_id,
    sourceType: row.source_type,
    type: row.effect_type,
    stacks: Number(row.stacks || 1),
    magnitude: Number(row.magnitude || 0),
    duration: Number(row.duration || 0),
    remainingTurns: Number(row.remaining_turns || 0),
    data:
      typeof row.data === "string"
        ? safeJsonParse(row.data, {})
        : row.data || {},
    createdAt: row.created_at,
  }));
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

  const existingResult = await db.query(
    `
      SELECT
        id,
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
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11, $12, NOW()
        )
        RETURNING *
      `,
      [
        String(threadID),
        String(combatID),
        String(targetID),
        normalized.source
          ? String(normalized.source)
          : null,
        normalized.sourceType,
        normalized.id,
        normalized.type,
        normalized.stacks,
        normalized.magnitude,
        normalized.duration,
        normalized.remainingTurns,
        JSON.stringify(normalized.data),
      ]
    );

    return {
      created: true,
      refreshed: false,
      stacked: false,
      effect: normalizeDbEffect(result.rows[0]),
    };
  }

  const defaults =
    DEFAULTS[normalized.id] || {};

  let stacks = Number(existing.stacks || 1);
  let magnitude = Number(existing.magnitude || 0);
  let duration = Number(existing.duration || 0);
  let remainingTurns =
    Number(existing.remaining_turns || 0);

  const maxStacks =
    Number(defaults.maxStacks || 1);

  switch (defaults.stackRule) {
    case STACK_RULES.STACK:
      stacks = Math.min(
        maxStacks,
        stacks + normalized.stacks
      );

      magnitude =
        Math.max(magnitude, normalized.magnitude);

      remainingTurns = Math.max(
        remainingTurns,
        normalized.remainingTurns
      );

      break;

    case STACK_RULES.EXTEND:
      magnitude =
        Math.max(magnitude, normalized.magnitude);

      remainingTurns =
        Math.min(
          duration || normalized.duration,
          remainingTurns +
            normalized.remainingTurns
        );

      break;

    case STACK_RULES.STRONGEST:
      if (
        normalized.magnitude > magnitude
      ) {
        magnitude = normalized.magnitude;
        duration = normalized.duration;
        remainingTurns =
          normalized.remainingTurns;
      } else {
        remainingTurns =
          Math.max(
            remainingTurns,
            normalized.remainingTurns
          );
      }

      break;

    case STACK_RULES.REFRESH:
      magnitude =
        Math.max(
          magnitude,
          normalized.magnitude
        );

      duration =
        Math.max(
          duration,
          normalized.duration
        );

      remainingTurns =
        Math.max(
          remainingTurns,
          normalized.remainingTurns
        );

      break;

    case STACK_RULES.REPLACE:
    default:
      stacks = normalized.stacks;
      magnitude = normalized.magnitude;
      duration = normalized.duration;
      remainingTurns =
        normalized.remainingTurns;
      break;
  }

  const mergedData = {
    ...safeJsonParse(existing.data, {}),
    ...normalized.data,
  };

  const result = await db.query(
    `
      UPDATE rpg_combat_effects
      SET
        stacks = $4,
        magnitude = $5,
        duration = $6,
        remaining_turns = $7,
        data = $8
      WHERE id = $1
        AND thread_id = $2
        AND combat_session_id = $3
      RETURNING *
    `,
    [
      existing.id,
      String(threadID),
      String(combatID),
      stacks,
      magnitude,
      duration,
      remainingTurns,
      JSON.stringify(mergedData),
    ]
  );

  return {
    created: false,
    refreshed: true,
    stacked:
      defaults.stackRule === STACK_RULES.STACK,
    effect: normalizeDbEffect(result.rows[0]),
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
  const id = normalizeEffectId(effectID);

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
  const id = normalizeEffectId(effectID);

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
  const id = normalizeEffectId(effectID);

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
    ? normalizeDbEffect(result.rows[0])
    : null;
}

// ============================================================
// TURN PROCESSING
// ============================================================

/**
 * Process effects at the beginning of a target's turn.
 *
 * Returns damage/healing/events.
 *
 * Combat.js is responsible for actually applying HP changes.
 */
async function processStartOfTurn(
  threadID,
  combatID,
  targetID,
  context = {}
) {
  const effects = await getEffects(
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

  for (const effect of effects) {
    const stacks =
      Math.max(1, Number(effect.stacks || 1));

    // --------------------------------------------------------
    // BURN
    // --------------------------------------------------------

    if (effect.id === EFFECT_IDS.BURN) {
      const base =
        Number(effect.magnitude || 0);

      let damage =
        base * stacks;

      if (
        context.season === "summer" ||
        context.weather === "heat"
      ) {
        damage *= 1.25;
      }

      result.damage += Math.max(
        0,
        Math.round(damage)
      );

      result.events.push({
        type: "burn",
        effect,
        damage: Math.round(damage),
      });
    }

    // --------------------------------------------------------
    // POISON
    // --------------------------------------------------------

    else if (
      effect.id === EFFECT_IDS.POISON
    ) {
      const damage =
        Math.max(
          1,
          Math.round(
            Number(effect.magnitude || 0) *
              stacks
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
      effect.id === EFFECT_IDS.BLEED
    ) {
      const damage =
        Math.max(
          1,
          Math.round(
            Number(effect.magnitude || 0) *
              stacks
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
      effect.id === EFFECT_IDS.NECROTIC
    ) {
      const damage =
        Math.max(
          1,
          Math.round(
            Number(effect.magnitude || 0)
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
      effect.id === EFFECT_IDS.STUN
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
      effect.id === EFFECT_IDS.ROOT
    ) {
      result.rooted = true;

      result.events.push({
        type: "root",
        effect,
      });
    }

    // --------------------------------------------------------
    // MANA REGEN
    // --------------------------------------------------------

    else if (
      effect.id === EFFECT_IDS.MANA_REGEN_UP
    ) {
      const maxMp =
        Number(context.maxMp || 0);

      if (maxMp > 0) {
        const mana =
          Math.max(
            1,
            Math.round(
              maxMp *
                Number(effect.magnitude || 0)
            )
          );

        result.mana += mana;
      }
    }

    // --------------------------------------------------------
    // HOT
    // --------------------------------------------------------

    else if (
      effect.type === EFFECT_TYPES.HOT
    ) {
      const healing =
        Math.max(
          0,
          Math.round(
            Number(effect.magnitude || 0) *
              stacks
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

/**
 * Decrements effects after a turn.
 *
 * Effects reaching zero are removed.
 */
async function processEndOfTurn(
  threadID,
  combatID,
  targetID
) {
  const result = await db.query(
    `
      UPDATE rpg_combat_effects
      SET remaining_turns = remaining_turns - 1
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
    ]
  );

  const expired = [];

  for (const row of result.rows) {
    if (
      Number(row.remaining_turns) <= 0
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
  let finalDamage =
    Math.max(0, Number(damage) || 0);

  const effects = await getEffects(
    threadID,
    combatID,
    targetID
  );

  const modifiers = {
    reduction: 0,
    increase: 0,
    blocked: false,
    iceWallTriggered: false,
  };

  // ----------------------------------------------------------
  // ICE WALL
  // ----------------------------------------------------------

  const iceWall = effects.find(
    (effect) =>
      effect.id === EFFECT_IDS.ICE_WALL
  );

  if (iceWall) {
    if (
      Number(iceWall.data.blockDamageEvents || 0) >
      0
    ) {
      finalDamage = 0;

      modifiers.blocked = true;
      modifiers.iceWallTriggered = true;

      await consumeIceWallBlock(
        threadID,
        combatID,
        targetID
      );

      return {
        damage: 0,
        modifiers,
      };
    }

    if (
      iceWall.data.enemyDamageMultiplier
    ) {
      finalDamage *= Number(
        iceWall.data.enemyDamageMultiplier
      );
    }
  }

  // ----------------------------------------------------------
  // GENERIC DAMAGE REDUCTION
  // --------------------------------------------------------

  for (const effect of effects) {
    if (
      effect.id ===
      EFFECT_IDS.DAMAGE_REDUCTION
    ) {
      modifiers.reduction =
        Math.max(
          modifiers.reduction,
          Number(effect.magnitude || 0)
        );
    }

    if (
      effect.id === EFFECT_IDS.INFINITE_DARKNESS
    ) {
      if (
        effect.data.enemyDamageMultiplier
      ) {
        finalDamage *= Number(
          effect.data.enemyDamageMultiplier
        );
      }
    }

    if (
      effect.id === EFFECT_IDS.WEAKNESS
    ) {
      modifiers.increase =
        Math.max(
          modifiers.increase,
          Number(effect.magnitude || 0)
        );
    }
  }

  if (modifiers.reduction > 0) {
    finalDamage *=
      1 - modifiers.reduction;
  }

  if (modifiers.increase > 0) {
    finalDamage *=
      1 + modifiers.increase;
  }

  // ----------------------------------------------------------
  // SHADOW BODY
  // ----------------------------------------------------------

  const shadowBody = effects.find(
    (effect) =>
      effect.id === EFFECT_IDS.SHADOW_BODY
  );

  if (shadowBody && context.targetIsShadow) {
    finalDamage =
      Math.max(
        0,
        Math.round(
          finalDamage *
            Number(
              shadowBody.data.reflectedDamageMultiplier ||
                1.25
            )
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
    Math.max(0, Number(damage) || 0);

  const effects = await getEffects(
    threadID,
    combatID,
    sourceID
  );

  const modifiers = {
    multiplier: 1,
    lifesteal: 0,
  };

  for (const effect of effects) {
    if (
      effect.id === EFFECT_IDS.DAMAGE_UP
    ) {
      modifiers.multiplier *=
        Math.max(
          0,
          Number(effect.magnitude || 1)
        );
    }

    if (
      effect.id === EFFECT_IDS.INFINITE_DARKNESS
    ) {
      if (
        effect.data.damageMultiplier
      ) {
        modifiers.multiplier *=
          Number(
            effect.data.damageMultiplier
          );
      }
    }

    if (
      effect.id === EFFECT_IDS.LIFESTEAL
    ) {
      modifiers.lifesteal =
        Math.max(
          modifiers.lifesteal,
          Number(effect.magnitude || 0)
        );
    }

    if (
      effect.id === EFFECT_IDS.INFINITE_DARKNESS &&
      effect.data.damageToHealing
    ) {
      modifiers.lifesteal =
        Math.max(
          modifiers.lifesteal,
          Number(
            effect.data.damageToHealing
          )
        );
    }
  }

  finalDamage *=
    modifiers.multiplier;

  // Target defense-break can be accounted for by combat
  // before base damage enters this function.

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
      id: EFFECT_IDS.ICE_WALL,

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
  const effect = await getEffect(
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

  const remaining =
    Math.max(
      0,
      Number(
        effect.data.blockDamageEvents || 0
      ) - 1
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

  await db.query(
    `
      UPDATE rpg_combat_effects
      SET data = $4
      WHERE thread_id = $1
        AND combat_session_id = $2
        AND target_id = $3
        AND effect_id = $5
    `,
    [
      String(threadID),
      String(combatID),
      String(targetID),
      JSON.stringify({
        ...effect.data,
        blockDamageEvents: remaining,
      }),
      EFFECT_IDS.ICE_WALL,
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
      id: EFFECT_IDS.SHADOW_BODY,

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
        id: EFFECT_IDS.SHADOW_DISABLED,
        duration:
          Number(
            options.duration || 1
          ),

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
    Number(options.duration || 5);

  await applyEffect(
    threadID,
    combatID,
    sourceID,
    {
      id: EFFECT_IDS.INFINITE_DARKNESS,

      source: sourceID,
      sourceType: "special",

      duration,

      magnitude: 0.2,

      data: {
        stunAllEnemies: true,
        enemyDamageMultiplier: 0.8,
        damageToHealing: 0.2,
        duration,
      },
    }
  );

  return {
    duration,
    enemyDamageMultiplier: 0.8,
    damageToHealing: 0.2,
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
      Math.round(Number(amount) || 0)
    );

  if (!value) {
    return {
      amount: 0,
      total: await getDefenseHealth(
        threadID,
        combatID,
        targetID
      ),
    };
  }

  await applyEffect(
    threadID,
    combatID,
    targetID,
    {
      id: EFFECT_IDS.DEFENSE_HEALTH,

      duration: 999,

      magnitude: value,

      data: {
        defenseHealth: value,
      },
    }
  );

  return {
    amount: value,
    total: await getDefenseHealth(
      threadID,
      combatID,
      targetID
    ),
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
    Number(
      effect.data.defenseHealth ??
        effect.magnitude ??
        0
    )
  );
}

/**
 * Defense Health absorbs incoming damage before HP.
 */
async function absorbDefenseHealth(
  threadID,
  combatID,
  targetID,
  damage
) {
  let incoming =
    Math.max(
      0,
      Math.round(Number(damage) || 0)
    );

  const current =
    await getDefenseHealth(
      threadID,
      combatID,
      targetID
    );

  if (!current || !incoming) {
    return {
      absorbed: 0,
      remainingDamage: incoming,
      remainingDefenseHealth: current,
    };
  }

  const absorbed =
    Math.min(current, incoming);

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
        id: EFFECT_IDS.DEFENSE_HEALTH,
        duration: 999,
        magnitude: remaining,
        data: {
          defenseHealth: remaining,
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

/**
 * Converts overhealing into Defense Health when Bark Skin
 * is active.
 */
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
      Number(healing) || 0
    );

  const hp =
    Math.max(
      0,
      Number(currentHp) || 0
    );

  const max =
    Math.max(
      0,
      Number(maxHp) || 0
    );

  const overheal =
    Math.max(
      0,
      hp + amount - max
    );

  const barkSkin =
    await hasEffect(
      threadID,
      combatID,
      targetID,
      EFFECT_IDS.BARK_SKIN
    );

  if (!barkSkin || overheal <= 0) {
    return {
      actualHealing:
        Math.min(amount, Math.max(0, max - hp)),
      overheal: barkSkin
        ? overheal
        : 0,
      defenseHealth: 0,
    };
  }

  const actualHealing =
    Math.min(
      amount,
      Math.max(0, max - hp)
    );

  await addDefenseHealth(
    threadID,
    combatID,
    targetID,
    overheal
  );

  return {
    actualHealing,
    overheal,
    defenseHealth: overheal,
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
      Number(damage) || 0
    );

  const percent =
    Math.max(
      0,
      Number(ratio) || 0
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
  if (!effect) return "Unknown effect.";

  const labels = {
    [EFFECT_IDS.BURN]: "Burning",
    [EFFECT_IDS.POISON]: "Poisoned",
    [EFFECT_IDS.BLEED]: "Bleeding",
    [EFFECT_IDS.NECROTIC]: "Necrotic",
    [EFFECT_IDS.STUN]: "Stunned",
    [EFFECT_IDS.ROOT]: "Rooted",
    [EFFECT_IDS.SLOW]: "Slowed",
    [EFFECT_IDS.BLIND]: "Blinded",
    [EFFECT_IDS.DIVINE_SHIELD]: "Divine Shield",
    [EFFECT_IDS.ICE_WALL]: "Heaven Piercing Ice Wall",
    [EFFECT_IDS.INFINITE_DARKNESS]: "Infinite Darkness",
    [EFFECT_IDS.SHADOW_BODY]: "Shadow Body",
    [EFFECT_IDS.DAMAGE_UP]: "Damage Up",
    [EFFECT_IDS.DEFENSE_UP]: "Defense Up",
    [EFFECT_IDS.AGILITY_UP]: "Agility Up",
    [EFFECT_IDS.MANA_REGEN_UP]: "Mana Regeneration",
    [EFFECT_IDS.LIFESTEAL]: "Lifesteal",
    [EFFECT_IDS.BARK_SKIN]: "Bark Skin",
    [EFFECT_IDS.DAMAGE_REDUCTION]: "Damage Reduction",
    [EFFECT_IDS.DODGE_UP]: "Dodge Up",
    [EFFECT_IDS.DEFENSE_BREAK]: "Defense Break",
    [EFFECT_IDS.WEAKNESS]: "Weakened",
    [EFFECT_IDS.DEFENSE_HEALTH]: "Defense Health",
    [EFFECT_IDS.SHADOW_DISABLED]: "Shadow Disabled",
  };

  const name =
    labels[effect.id] ||
    effect.id;

  const parts = [name];

  if (effect.stacks > 1) {
    parts.push(`x${effect.stacks}`);
  }

  if (
    effect.remainingTurns != null &&
    effect.remainingTurns < 900
  ) {
    parts.push(
      `${effect.remainingTurns} turn${
        effect.remainingTurns === 1
          ? ""
          : "s"
      }`
    );
  }

  if (
    effect.id === EFFECT_IDS.ICE_WALL
  ) {
    const blocks =
      Number(
        effect.data?.blockDamageEvents || 0
      );

    if (blocks > 0) {
      parts.push(
        `${blocks} blocks`
      );
    }
  }

  if (
    effect.id === EFFECT_IDS.DEFENSE_HEALTH
  ) {
    const defense =
      Number(
        effect.data?.defenseHealth ||
          effect.magnitude ||
          0
      );

    parts.push(
      `${Math.round(defense)} HP`
    );
  }

  return parts.join(" · ");
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function normalizeDbEffect(row) {
  return {
    dbId: row.id,
    id: row.effect_id,
    targetId: row.target_id,
    source: row.source_id,
    sourceType: row.source_type,
    type: row.effect_type,
    stacks: Number(row.stacks || 1),
    magnitude: Number(row.magnitude || 0),
    duration: Number(row.duration || 0),
    remainingTurns: Number(
      row.remaining_turns || 0
    ),
    data:
      typeof row.data === "string"
        ? safeJsonParse(row.data, {})
        : row.data || {},
    createdAt: row.created_at,
  };
}

function safeJsonParse(value, fallback) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  if (
    typeof value === "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
  isShadowDisabled,

  addDefenseHealth,
  getDefenseHealth,
  absorbDefenseHealth,
  convertOverheal,

  calculateLifesteal,

  describeEffect,
};
