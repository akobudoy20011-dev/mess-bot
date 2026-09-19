"use strict";

/**
 * ECLIPSE RPG — SPELL SYSTEM
 * ===========================
 *
 * Spells are separate from affinities.
 *
 * affinities.js
 *   -> what magical power the player has access to
 *
 * spells.js
 *   -> what spells exist, their costs, requirements and effects
 *
 * specials.js
 *   -> unique class/affinity special moves
 *
 * The system supports:
 *   - 13 affinities
 *   - spell tiers
 *   - mastery requirements
 *   - kingdom unlocks
 *   - class restrictions
 *   - primary / secondary affinities
 *   - Arcanist external-affinity rule
 *   - environmental scaling
 *   - healing
 *   - damage
 *   - buffs
 *   - debuffs
 *   - control
 *   - shields
 *   - utility spells
 *
 * Combat execution is intentionally NOT handled here.
 * This file defines the spell and validates whether a player
 * is allowed to use/learn it.
 */

const db = require("../db");
const affinities = require("./affinities");

// ============================================================
// CONFIG
// ============================================================

const SPELL_CATEGORIES = Object.freeze({
  BASIC: "basic",
  ADVANCED: "advanced",
  MASTERY: "mastery",
  KINGDOM: "kingdom",
  SPECIAL: "special",
  ULTIMATE: "ultimate",
  UTILITY: "utility",
});

const SPELL_TYPES = Object.freeze({
  DAMAGE: "damage",
  HEAL: "heal",
  BUFF: "buff",
  DEBUFF: "debuff",
  CONTROL: "control",
  SHIELD: "shield",
  DRAIN: "drain",
  SUMMON: "summon",
  UTILITY: "utility",
});

const TARGET_TYPES = Object.freeze({
  SELF: "self",
  SINGLE_ENEMY: "single_enemy",
  ALL_ENEMIES: "all_enemies",
  SINGLE_ALLY: "single_ally",
  ALL_ALLIES: "all_allies",
  PARTY: "party",
  AREA: "area",
});

const ELEMENTS = Object.freeze([
  "fire",
  "ice",
  "lightning",
  "nature",
  "light",
  "divine",
  "arcane",
  "shadow",
  "necromancy",
  "blood",
  "water",
  "wind",
  "earth",
]);

// ============================================================
// SPELL DEFINITIONS
// ============================================================

const SPELLS = {
  // ==========================================================
  // FIRE
  // ==========================================================

  firebolt: {
    id: "firebolt",
    name: "Firebolt",
    affinity: "fire",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "A concentrated bolt of flame.",
    mpCost: 8,
    basePower: 28,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 28,
      burnChance: 0.2,
      burnTurns: 3,
    },
  },

  flame_burst: {
    id: "flame_burst",
    name: "Flame Burst",
    affinity: "fire",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "Explodes in a burst of fire around the target area.",
    mpCost: 22,
    basePower: 55,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 2,
    effects: {
      damage: 55,
      burnChance: 0.35,
      burnTurns: 3,
    },
  },

  inferno: {
    id: "inferno",
    name: "Inferno",
    affinity: "fire",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "A devastating wave of flame.",
    mpCost: 40,
    basePower: 95,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 4,
    effects: {
      damage: 95,
      burnChance: 0.75,
      burnTurns: 3,
      specialSeasonBonus: "summer",
    },
  },

  scorching_garden: {
    id: "scorching_garden",
    name: "Scorching Garden",
    affinity: "fire",
    category: SPELL_CATEGORIES.SPECIAL,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description:
      "Creates a burning field that damages every enemy and intensifies while active.",
    mpCost: 55,
    basePower: 115,
    masteryRequired: 3000,
    tierRequired: "mastered",
    cooldown: 8,
    special: true,
    effects: {
      damage: 115,
      burnChance: 1,
      burnTurns: 3,
      activeDamageBonus: 0.2,
      seasonBurnTurns: {
        summer: 6,
      },
    },
  },

  // ==========================================================
  // ICE
  // ==========================================================

  ice_lance: {
    id: "ice_lance",
    name: "Ice Lance",
    affinity: "ice",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "A piercing spear of frozen magic.",
    mpCost: 9,
    basePower: 32,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 32,
      slowChance: 0.25,
      slowTurns: 2,
    },
  },

  frost_nova: {
    id: "frost_nova",
    name: "Frost Nova",
    affinity: "ice",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.CONTROL,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "Freezes the battlefield around the caster.",
    mpCost: 25,
    basePower: 45,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 3,
    effects: {
      damage: 45,
      stunChance: 0.35,
      stunTurns: 1,
      slowTurns: 2,
    },
  },

  glacial_prison: {
    id: "glacial_prison",
    name: "Glacial Prison",
    affinity: "ice",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.CONTROL,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "Encases an enemy in nearly unbreakable ice.",
    mpCost: 42,
    basePower: 70,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 5,
    effects: {
      damage: 70,
      stunTurns: 2,
      damageReduction: 0.5,
    },
  },

  heaven_piercing_ice_wall: {
    id: "heaven_piercing_ice_wall",
    name: "Heaven Piercing Ice Wall",
    affinity: "ice",
    category: SPELL_CATEGORIES.SPECIAL,
    type: SPELL_TYPES.SHIELD,
    target: TARGET_TYPES.SELF,
    description:
      "Raises a colossal ice wall that blocks the next three damage events.",
    mpCost: 60,
    basePower: 0,
    masteryRequired: 3000,
    tierRequired: "mastered",
    cooldown: 9,
    special: true,
    effects: {
      blockedDamageEvents: 3,
      enemyDamageMultiplier: 0.5,
      forcedStunOnUserMoves: true,
      winterDefenseBonus: 0.5,
    },
  },

  // ==========================================================
  // LIGHTNING
  // ==========================================================

  spark: {
    id: "spark",
    name: "Spark",
    affinity: "lightning",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "A fast electrical strike.",
    mpCost: 8,
    basePower: 30,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 30,
      shockChance: 0.2,
    },
  },

  thunder_chain: {
    id: "thunder_chain",
    name: "Thunder Chain",
    affinity: "lightning",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "Lightning jumps from one enemy to another.",
    mpCost: 24,
    basePower: 60,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 2,
    effects: {
      damage: 60,
      chainTargets: 3,
      shockChance: 0.3,
    },
  },

  storm_crown: {
    id: "storm_crown",
    name: "Storm Crown",
    affinity: "lightning",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "Summons a violent storm around the battlefield.",
    mpCost: 48,
    basePower: 105,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 5,
    effects: {
      damage: 105,
      shockChance: 0.6,
      stormBonus: 0.3,
    },
  },

  // ==========================================================
  // NATURE
  // ==========================================================

  thorn_strike: {
    id: "thorn_strike",
    name: "Thorn Strike",
    affinity: "nature",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "Sharp roots and thorns pierce the enemy.",
    mpCost: 8,
    basePower: 28,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 28,
      bleedChance: 0.15,
    },
  },

  natures_mend: {
    id: "natures_mend",
    name: "Nature's Mend",
    affinity: "nature",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.HEAL,
    target: TARGET_TYPES.SINGLE_ALLY,
    description: "Living energy restores an ally's health.",
    mpCost: 20,
    basePower: 60,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 1,
    effects: {
      healing: 60,
      overhealToDefense: true,
    },
  },

  verdant_wrath: {
    id: "verdant_wrath",
    name: "Verdant Wrath",
    affinity: "nature",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "The battlefield erupts with roots and vines.",
    mpCost: 42,
    basePower: 90,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 4,
    effects: {
      damage: 90,
      rootChance: 0.6,
      rootTurns: 2,
    },
  },

  // ==========================================================
  // WATER
  // ==========================================================

  water_bolt: {
    id: "water_bolt",
    name: "Water Bolt",
    affinity: "water",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "A compressed projectile of water.",
    mpCost: 8,
    basePower: 29,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 29,
    },
  },

  tidal_wave: {
    id: "tidal_wave",
    name: "Tidal Wave",
    affinity: "water",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "A massive wave crashes over the enemy team.",
    mpCost: 28,
    basePower: 68,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 3,
    effects: {
      damage: 68,
      knockback: true,
    },
  },

  abyssal_current: {
    id: "abyssal_current",
    name: "Abyssal Current",
    affinity: "water",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "A crushing current tears through the battlefield.",
    mpCost: 45,
    basePower: 100,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 5,
    effects: {
      damage: 100,
      slowTurns: 2,
    },
  },

  // ==========================================================
  // WIND
  // ==========================================================

  wind_blade: {
    id: "wind_blade",
    name: "Wind Blade",
    affinity: "wind",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "A razor-thin blade of compressed wind.",
    mpCost: 8,
    basePower: 31,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 31,
      dodgeBonus: 0.05,
    },
  },

  gale_step: {
    id: "gale_step",
    name: "Gale Step",
    affinity: "wind",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.BUFF,
    target: TARGET_TYPES.SELF,
    description: "Wind surrounds the caster, greatly increasing agility.",
    mpCost: 18,
    basePower: 0,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 2,
    effects: {
      agilityMultiplier: 1.25,
      dodgeChance: 0.2,
      duration: 3,
    },
  },

  tempest: {
    id: "tempest",
    name: "Tempest",
    affinity: "wind",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "A violent storm tears across the battlefield.",
    mpCost: 44,
    basePower: 98,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 5,
    effects: {
      damage: 98,
      dodgeReduction: 0.15,
      duration: 2,
    },
  },

  // ==========================================================
  // EARTH
  // ==========================================================

  stone_shard: {
    id: "stone_shard",
    name: "Stone Shard",
    affinity: "earth",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "Launches a hardened shard of earth.",
    mpCost: 8,
    basePower: 30,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 30,
      defenseIgnore: 0.05,
    },
  },

  earthen_guard: {
    id: "earthen_guard",
    name: "Earthen Guard",
    affinity: "earth",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.SHIELD,
    target: TARGET_TYPES.SELF,
    description: "Stone wraps around the caster as protective armor.",
    mpCost: 20,
    basePower: 0,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 2,
    effects: {
      defenseMultiplier: 1.4,
      duration: 3,
    },
  },

  mountain_wrath: {
    id: "mountain_wrath",
    name: "Mountain Wrath",
    affinity: "earth",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "The ground fractures beneath the enemy.",
    mpCost: 46,
    basePower: 105,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 5,
    effects: {
      damage: 105,
      stunChance: 0.25,
      stunTurns: 1,
    },
  },

  // ==========================================================
  // LIGHT
  // ==========================================================

  holy_light: {
    id: "holy_light",
    name: "Holy Light",
    affinity: "light",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.HEAL,
    target: TARGET_TYPES.SINGLE_ALLY,
    description: "A gentle radiance restores an ally.",
    mpCost: 10,
    basePower: 38,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      healing: 38,
    },
  },

  radiant_strike: {
    id: "radiant_strike",
    name: "Radiant Strike",
    affinity: "light",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "A blade of concentrated light strikes an enemy.",
    mpCost: 18,
    basePower: 58,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 1,
    effects: {
      damage: 58,
      blindChance: 0.2,
    },
  },

  celestial_ray: {
    id: "celestial_ray",
    name: "Celestial Ray",
    affinity: "light",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "A beam of celestial light burns the battlefield.",
    mpCost: 42,
    basePower: 100,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 5,
    effects: {
      damage: 100,
      blindChance: 0.35,
    },
  },

  // ==========================================================
  // DIVINE
  // ==========================================================

  divine_shield: {
    id: "divine_shield",
    name: "Divine Shield",
    affinity: "divine",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.SHIELD,
    target: TARGET_TYPES.SELF,
    description: "A divine barrier protects the caster.",
    mpCost: 12,
    basePower: 0,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 1,
    effects: {
      damageReduction: 0.3,
      duration: 2,
    },
  },

  blessing: {
    id: "blessing",
    name: "Blessing",
    affinity: "divine",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.BUFF,
    target: TARGET_TYPES.ALL_ALLIES,
    description: "Divine power strengthens the entire allied side.",
    mpCost: 25,
    basePower: 0,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 3,
    effects: {
      damageMultiplier: 1.15,
      defenseMultiplier: 1.15,
      duration: 3,
    },
  },

  heavenly_judgement: {
    id: "heavenly_judgement",
    name: "Heavenly Judgement",
    affinity: "divine",
    category: SPELL_CATEGORIES.SPECIAL,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description:
      "A devastating divine strike that restores 30% of lost health to the caster and allies.",
    mpCost: 65,
    basePower: 180,
    masteryRequired: 3000,
    tierRequired: "mastered",
    cooldown: 9,
    special: true,
    effects: {
      damage: 180,
      healAlliesLostHpPercent: 0.3,
    },
  },

  amaterasus_blessing: {
    id: "amaterasus_blessing",
    name: "Amaterasu's Blessing",
    affinity: "divine",
    category: SPELL_CATEGORIES.SPECIAL,
    type: SPELL_TYPES.BUFF,
    target: TARGET_TYPES.ALL_ALLIES,
    description:
      "A morning blessing that calls down the sun and increases allied damage by 20%.",
    mpCost: 60,
    basePower: 0,
    masteryRequired: 3000,
    tierRequired: "mastered",
    cooldown: 10,
    special: true,
    requirements: {
      morningOnly: true,
    },
    effects: {
      damageMultiplier: 1.2,
      duration: 5,
      morningOnly: true,
      mode: "solar_daggers_or_laser",
    },
  },

  // ==========================================================
  // ARCANE
  // ==========================================================

  arcane_missile: {
    id: "arcane_missile",
    name: "Arcane Missile",
    affinity: "arcane",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "Pure arcane energy strikes the enemy.",
    mpCost: 8,
    basePower: 34,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 34,
      ignoresElementalResistance: true,
    },
  },

  mana_surge: {
    id: "mana_surge",
    name: "Mana Surge",
    affinity: "arcane",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.BUFF,
    target: TARGET_TYPES.SELF,
    description: "Temporarily increases mana regeneration.",
    mpCost: 10,
    basePower: 0,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 3,
    effects: {
      manaRegenMultiplier: 2,
      duration: 4,
    },
  },

  astral_barrage: {
    id: "astral_barrage",
    name: "Astral Barrage",
    affinity: "arcane",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "A barrage of raw arcane energy tears through all enemies.",
    mpCost: 50,
    basePower: 120,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 5,
    effects: {
      damage: 120,
      ignoresElementalResistance: true,
    },
  },

  // ==========================================================
  // SHADOW
  // ==========================================================

  shadow_veil: {
    id: "shadow_veil",
    name: "Shadow Veil",
    affinity: "shadow",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.BUFF,
    target: TARGET_TYPES.SELF,
    description: "Darkness conceals the caster.",
    mpCost: 10,
    basePower: 0,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 1,
    effects: {
      dodgeChance: 0.25,
      duration: 2,
    },
  },

  shadow_strike: {
    id: "shadow_strike",
    name: "Shadow Strike",
    affinity: "shadow",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "A sudden strike from the darkness.",
    mpCost: 18,
    basePower: 65,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 1,
    effects: {
      damage: 65,
      bonusAtNight: 0.25,
    },
  },

  dark_pact: {
    id: "dark_pact",
    name: "Dark Pact",
    affinity: "shadow",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.DRAIN,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "Deals damage while converting part of the damage into health.",
    mpCost: 25,
    basePower: 70,
    masteryRequired: 700,
    tierRequired: "strong",
    cooldown: 3,
    effects: {
      damage: 70,
      lifesteal: 0.3,
    },
  },

  infinite_darkness: {
    id: "infinite_darkness",
    name: "Infinite Darkness",
    affinity: "shadow",
    category: SPELL_CATEGORIES.SPECIAL,
    type: SPELL_TYPES.CONTROL,
    target: TARGET_TYPES.ALL_ENEMIES,
    description:
      "Five moves of absolute darkness. Enemies are stunned, weakened, while shadow power converts damage into healing.",
    mpCost: 70,
    basePower: 0,
    masteryRequired: 3000,
    tierRequired: "mastered",
    cooldown: 10,
    special: true,
    effects: {
      stunTurns: 5,
      enemyDamageMultiplier: 0.8,
      damageToHpPercent: 0.2,
      duration: 5,
      shadowBodyAvailable: true,
    },
  },

  // ==========================================================
  // NECROMANCY
  // ==========================================================

  bone_spear: {
    id: "bone_spear",
    name: "Bone Spear",
    affinity: "necromancy",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "A spear formed from cursed bone.",
    mpCost: 9,
    basePower: 34,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 34,
      curseChance: 0.2,
    },
  },

  corpse_burst: {
    id: "corpse_burst",
    name: "Corpse Burst",
    affinity: "necromancy",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.ALL_ENEMIES,
    description: "A fallen corpse erupts with necrotic energy.",
    mpCost: 26,
    basePower: 62,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 3,
    effects: {
      damage: 62,
      necrotic: true,
    },
  },

  raise_dead: {
    id: "raise_dead",
    name: "Raise Dead",
    affinity: "necromancy",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.SUMMON,
    target: TARGET_TYPES.SELF,
    description: "Summons a temporary undead ally.",
    mpCost: 48,
    basePower: 0,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 6,
    effects: {
      summon: "undead_guardian",
      duration: 4,
    },
  },

  // ==========================================================
  // BLOOD
  // ==========================================================

  blood_bolt: {
    id: "blood_bolt",
    name: "Blood Bolt",
    affinity: "blood",
    category: SPELL_CATEGORIES.BASIC,
    type: SPELL_TYPES.DRAIN,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "Condensed blood magic tears through an enemy.",
    mpCost: 9,
    basePower: 35,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    effects: {
      damage: 35,
      lifesteal: 0.15,
    },
  },

  blood_frenzy: {
    id: "blood_frenzy",
    name: "Blood Frenzy",
    affinity: "blood",
    category: SPELL_CATEGORIES.ADVANCED,
    type: SPELL_TYPES.BUFF,
    target: TARGET_TYPES.SELF,
    description: "Sacrifices health to dramatically increase attack power.",
    mpCost: 15,
    basePower: 0,
    masteryRequired: 300,
    tierRequired: "normal",
    cooldown: 3,
    effects: {
      selfHpCostPercent: 0.1,
      damageMultiplier: 1.35,
      lifesteal: 0.2,
      duration: 3,
    },
  },

  crimson_execution: {
    id: "crimson_execution",
    name: "Crimson Execution",
    affinity: "blood",
    category: SPELL_CATEGORIES.MASTERY,
    type: SPELL_TYPES.DAMAGE,
    target: TARGET_TYPES.SINGLE_ENEMY,
    description: "Converts the caster's missing health into devastating damage.",
    mpCost: 35,
    basePower: 100,
    masteryRequired: 1500,
    tierRequired: "exceptional",
    cooldown: 5,
    effects: {
      damage: 100,
      missingHpScaling: 0.75,
    },
  },

  // ==========================================================
  // UTILITY
  // ==========================================================

  teleport_sanctuary: {
    id: "teleport_sanctuary",
    name: "Teleport: Sanctuary",
    affinity: "arcane",
    category: SPELL_CATEGORIES.UTILITY,
    type: SPELL_TYPES.UTILITY,
    target: TARGET_TYPES.SELF,
    description: "Returns the player to a known sanctuary.",
    mpCost: 30,
    basePower: 0,
    masteryRequired: 700,
    tierRequired: "strong",
    cooldown: 6,
    utility: {
      action: "teleport_sanctuary",
    },
  },

  detect_magic: {
    id: "detect_magic",
    name: "Detect Magic",
    affinity: "arcane",
    category: SPELL_CATEGORIES.UTILITY,
    type: SPELL_TYPES.UTILITY,
    target: TARGET_TYPES.SELF,
    description: "Reveals magical traces, affinities and enchanted objects.",
    mpCost: 12,
    basePower: 0,
    masteryRequired: 0,
    tierRequired: "weak",
    cooldown: 0,
    utility: {
      action: "detect_magic",
    },
  },
};

// ============================================================
// NORMALIZATION
// ============================================================

function normalizeSpellId(value) {
  if (!value) return null;

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ============================================================
// LOOKUPS
// ============================================================

function getSpell(spellId) {
  const id = normalizeSpellId(spellId);
  return id ? SPELLS[id] || null : null;
}

function getAllSpells() {
  return Object.values(SPELLS);
}

function getSpellsByAffinity(affinityId) {
  const id = affinities.normalizeAffinityId(affinityId);

  if (!id) return [];

  return Object.values(SPELLS).filter(
    (spell) => spell.affinity === id
  );
}

function getSpellsByCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();

  return Object.values(SPELLS).filter(
    (spell) => spell.category === normalized
  );
}

// ============================================================
// SPELL REQUIREMENTS
// ============================================================

function getSpellTier(spell) {
  if (!spell) return null;

  return affinities.getTierByKey(spell.tierRequired);
}

function getSpellMasteryRequirement(spell) {
  return Number(spell?.masteryRequired || 0);
}

async function getPlayerAffinityState(threadID, userID, affinityId) {
  return affinities.getPlayerAffinity(
    threadID,
    userID,
    affinityId
  );
}

/**
 * Whether a player has the required affinity tier/mastery.
 */
async function meetsAffinityRequirement(
  threadID,
  userID,
  spell
) {
  if (!spell) {
    return {
      ok: false,
      reason: "Spell does not exist.",
    };
  }

  const affinity = await getPlayerAffinityState(
    threadID,
    userID,
    spell.affinity
  );

  if (!affinity) {
    return {
      ok: false,
      reason: `You do not possess the ${spell.affinity} affinity.`,
    };
  }

  const requiredTier = getSpellTier(spell);

  if (
    requiredTier &&
    Number(affinity.tier || 0) < Number(requiredTier.id)
  ) {
    return {
      ok: false,
      reason:
        `Your ${spell.affinity} affinity is only ` +
        `${affinity.tier_name || affinity.tier || "None"}. ` +
        `Required: ${requiredTier.name}.`,
    };
  }

  if (
    Number(affinity.mastery || 0) <
    getSpellMasteryRequirement(spell)
  ) {
    return {
      ok: false,
      reason:
        `${spell.name} requires ${spell.masteryRequired} ` +
        `${spell.affinity} mastery. ` +
        `You have ${affinity.mastery || 0}.`,
    };
  }

  return {
    ok: true,
    affinity,
  };
}

// ============================================================
// ARCANIST SPECIAL RULE
// ============================================================

/**
 * Arcanists can access one external-affinity spell.
 *
 * Their native Arcane spells are unrestricted by this rule.
 *
 * External spell access is stored in rpg_players as:
 *   external_spell_id
 *
 * The DB migration for this field should be present before
 * using this function.
 */

async function getExternalSpell(threadID, userID) {
  try {
    const result = await db.query(
      `
      SELECT external_spell_id
      FROM rpg_players
      WHERE thread_id = $1
        AND user_id = $2
      LIMIT 1
      `,
      [threadID, userID]
    );

    return result.rows[0]?.external_spell_id || null;
  } catch (error) {
    /**
     * Graceful fallback if the migration has not yet been added.
     */
    if (
      String(error.message || "")
        .toLowerCase()
        .includes("external_spell_id")
    ) {
      return null;
    }

    throw error;
  }
}

async function setExternalSpell(threadID, userID, spellId) {
  const spell = getSpell(spellId);

  if (!spell) {
    throw new Error("Unknown spell.");
  }

  if (spell.affinity === "arcane") {
    throw new Error(
      "Arcane spells are already part of the Arcanist's native affinity."
    );
  }

  const result = await db.query(
    `
    UPDATE rpg_players
    SET external_spell_id = $3,
        updated_at = NOW()
    WHERE thread_id = $1
      AND user_id = $2
    RETURNING external_spell_id
    `,
    [threadID, userID, spell.id]
  );

  if (!result.rows.length) {
    throw new Error("RPG player was not found.");
  }

  return spell;
}

async function clearExternalSpell(threadID, userID) {
  try {
    await db.query(
      `
      UPDATE rpg_players
      SET external_spell_id = NULL,
          updated_at = NOW()
      WHERE thread_id = $1
        AND user_id = $2
      `,
      [threadID, userID]
    );
  } catch (error) {
    if (
      !String(error.message || "")
        .toLowerCase()
        .includes("external_spell_id")
    ) {
      throw error;
    }
  }
}

// ============================================================
// PLAYER SPELLS
// ============================================================

async function getLearnedSpells(threadID, userID) {
  const result = await db.query(
    `
    SELECT
      s.spell_id,
      s.mastery,
      s.source,
      s.learned_at
    FROM rpg_player_spells s
    WHERE s.thread_id = $1
      AND s.user_id = $2
    ORDER BY s.learned_at ASC
    `,
    [threadID, userID]
  );

  return result.rows
    .map((row) => ({
      ...row,
      spell: getSpell(row.spell_id),
    }))
    .filter((row) => row.spell);
}

async function hasSpell(threadID, userID, spellId) {
  const id = normalizeSpellId(spellId);

  if (!id) return false;

  const result = await db.query(
    `
    SELECT 1
    FROM rpg_player_spells
    WHERE thread_id = $1
      AND user_id = $2
      AND spell_id = $3
    LIMIT 1
    `,
    [threadID, userID, id]
  );

  return result.rows.length > 0;
}

async function grantSpell(
  threadID,
  userID,
  spellId,
  source = "system"
) {
  const spell = getSpell(spellId);

  if (!spell) {
    throw new Error("Unknown spell.");
  }

  await db.query(
    `
    INSERT INTO rpg_player_spells
      (
        thread_id,
        user_id,
        spell_id,
        mastery,
        source,
        learned_at
      )
    VALUES
      ($1, $2, $3, 0, $4, NOW())
    ON CONFLICT (thread_id, user_id, spell_id)
    DO NOTHING
    `,
    [
      threadID,
      userID,
      spell.id,
      source,
    ]
  );

  return spell;
}

// ============================================================
// CLASS RESTRICTIONS
// ============================================================

const CLASS_RESTRICTIONS = {
  knight: {
    blockedAffinities: [
      "necromancy",
      "shadow",
    ],
  },

  bloodreaver: {
    blockedAffinities: [
      "light",
    ],
  },

  arcanist: {
    blockedAffinities: [],
  },

  wraith: {
    blockedAffinities: [
      "divine",
    ],
  },

  paladin: {
    blockedAffinities: [
      "necromancy",
    ],
  },

  ranger: {
    blockedAffinities: [
      "necromancy",
    ],
  },

  assassin: {
    blockedAffinities: [
      "divine",
    ],
  },
};

function isClassRestricted(characterClass, spell) {
  const id = String(characterClass || "").toLowerCase();

  const restrictions = CLASS_RESTRICTIONS[id];

  if (!restrictions) return false;

  return restrictions.blockedAffinities.includes(
    spell.affinity
  );
}

// ============================================================
// CAN LEARN
// ============================================================

async function canLearnSpell(
  threadID,
  userID,
  spellId,
  options = {}
) {
  const spell = getSpell(spellId);

  if (!spell) {
    return {
      ok: false,
      reason: "That spell does not exist.",
    };
  }

  if (await hasSpell(threadID, userID, spell.id)) {
    return {
      ok: false,
      reason: `You already know ${spell.name}.`,
      spell,
    };
  }

  const playerResult = await db.query(
    `
    SELECT
      character_class,
      kingdom_id,
      kingdom_role,
      traitor
    FROM rpg_players
    WHERE thread_id = $1
      AND user_id = $2
    LIMIT 1
    `,
    [threadID, userID]
  );

  if (!playerResult.rows.length) {
    return {
      ok: false,
      reason: "You have not started your RPG journey yet.",
      spell,
    };
  }

  const player = playerResult.rows[0];

  // ----------------------------------------------------------
  // CLASS RESTRICTION
  // ----------------------------------------------------------

  if (
    isClassRestricted(
      player.character_class,
      spell
    )
  ) {
    return {
      ok: false,
      reason:
        `${spell.name} is incompatible with the ` +
        `${player.character_class} class.`,
      spell,
    };
  }

  // ----------------------------------------------------------
  // AFFINITY REQUIREMENT
  // ----------------------------------------------------------

  const affinityCheck =
    await meetsAffinityRequirement(
      threadID,
      userID,
      spell
    );

  if (!affinityCheck.ok) {
    return {
      ok: false,
      reason: affinityCheck.reason,
      spell,
    };
  }

  // ----------------------------------------------------------
  // KINGDOM REQUIREMENT
  // ----------------------------------------------------------

  const affinity = affinities.getAffinity(
    spell.affinity
  );

  if (
    affinity?.kingdomId &&
    options.requireKingdom !== false
  ) {
    const playerKingdom =
      player.kingdom_id;

    /**
     * Kingdom requirement is only enforced for
     * Kingdom-category spells.
     *
     * Normal affinity spells only require affinity mastery.
     */
    if (
      spell.category === SPELL_CATEGORIES.KINGDOM &&
      playerKingdom !== affinity.kingdomId
    ) {
      return {
        ok: false,
        reason:
          `This spell belongs to the ` +
          `${affinity.name} kingdom path.`,
        spell,
      };
    }
  }

  // ----------------------------------------------------------
  // ARCANIST EXTERNAL SPELL RULE
  // ----------------------------------------------------------

  const playerClass =
    String(player.character_class || "")
      .toLowerCase();

  if (
    playerClass === "arcanist" &&
    spell.affinity !== "arcane"
  ) {
    const externalSpell =
      await getExternalSpell(
        threadID,
        userID
      );

    if (
      externalSpell &&
      externalSpell !== spell.id
    ) {
      return {
        ok: false,
        reason:
          "Arcanists may bind only one external-affinity spell.",
        spell,
      };
    }
  }

  return {
    ok: true,
    spell,
    affinity: affinityCheck.affinity,
  };
}

// ============================================================
// LEARN SPELL
// ============================================================

async function learnSpell(
  threadID,
  userID,
  spellId,
  options = {}
) {
  const check = await canLearnSpell(
    threadID,
    userID,
    spellId,
    options
  );

  if (!check.ok) {
    return check;
  }

  const spell = check.spell;

  const playerResult = await db.query(
    `
    SELECT character_class
    FROM rpg_players
    WHERE thread_id = $1
      AND user_id = $2
    LIMIT 1
    `,
    [threadID, userID]
  );

  const playerClass =
    playerResult.rows[0]?.character_class;

  // Arcanist external spell gets bound immediately.
  if (
    String(playerClass || "").toLowerCase() ===
      "arcanist" &&
    spell.affinity !== "arcane"
  ) {
    await setExternalSpell(
      threadID,
      userID,
      spell.id
    );
  }

  await grantSpell(
    threadID,
    userID,
    spell.id,
    options.source || "affinity"
  );

  return {
    ok: true,
    spell,
    external:
      String(playerClass || "").toLowerCase() ===
        "arcanist" &&
      spell.affinity !== "arcane",
  };
}

// ============================================================
// LEARNABLE SPELLS
// ============================================================

async function getLearnableSpells(
  threadID,
  userID,
  affinityId = null
) {
  let spells = affinityId
    ? getSpellsByAffinity(affinityId)
    : getAllSpells();

  const output = [];

  for (const spell of spells) {
    const check = await canLearnSpell(
      threadID,
      userID,
      spell.id
    );

    output.push({
      ...spell,
      learnable: check.ok,
      reason: check.ok
        ? null
        : check.reason,
    });
  }

  return output;
}

// ============================================================
// SPELL POWER
// ============================================================

async function calculateSpellPower(
  threadID,
  userID,
  spell,
  context = {}
) {
  if (!spell) return 0;

  let power =
    Number(spell.basePower || 0);

  // ----------------------------------------------------------
  // AFFINITY POWER
  // ----------------------------------------------------------

  const affinityPower =
    await affinities.getPlayerAffinityPower(
      threadID,
      userID,
      spell.affinity
    );

  if (affinityPower) {
    power *= affinityPower;
  }

  // ----------------------------------------------------------
  // ENVIRONMENT
  // ----------------------------------------------------------

  if (
    context.regionId ||
    context.season ||
    context.weather
  ) {
    const environmentMultiplier =
      affinities.getEnvironmentMultiplier(
        spell.affinity,
        context.regionId,
        context.season,
        context.weather,
        {
          isNight: !!context.isNight,
          isMorning: !!context.isMorning,
        }
      );

    power *= environmentMultiplier;
  }

  // ----------------------------------------------------------
  // SPECIAL CONTEXT
  // ----------------------------------------------------------

  if (
    spell.effects?.specialSeasonBonus &&
    context.season ===
      spell.effects.specialSeasonBonus
  ) {
    power *= 1.2;
  }

  if (
    spell.effects?.bonusAtNight &&
    context.isNight
  ) {
    power *=
      1 + Number(spell.effects.bonusAtNight);
  }

  return Math.max(
    0,
    Math.round(power)
  );
}

// ============================================================
// CAST VALIDATION
// ============================================================

async function canCastSpell(
  threadID,
  userID,
  spellId,
  context = {}
) {
  const spell = getSpell(spellId);

  if (!spell) {
    return {
      ok: false,
      reason: "That spell does not exist.",
    };
  }

  const learned =
    await hasSpell(
      threadID,
      userID,
      spell.id
    );

  if (!learned) {
    return {
      ok: false,
      reason:
        `You have not learned ${spell.name}.`,
      spell,
    };
  }

  const playerResult = await db.query(
    `
    SELECT
      character_class,
      mp,
      max_mp,
      status
    FROM rpg_players
    WHERE thread_id = $1
      AND user_id = $2
    LIMIT 1
    `,
    [threadID, userID]
  );

  if (!playerResult.rows.length) {
    return {
      ok: false,
      reason: "RPG player not found.",
      spell,
    };
  }

  const player =
    playerResult.rows[0];

  if (
    Number(player.mp || 0) <
    Number(spell.mpCost || 0)
  ) {
    return {
      ok: false,
      reason:
        `Not enough MP. ` +
        `Required ${spell.mpCost}, ` +
        `you have ${player.mp || 0}.`,
      spell,
    };
  }

  // ----------------------------------------------------------
  // MORNING-ONLY SPELL
  // ----------------------------------------------------------

  if (
    spell.requirements?.morningOnly &&
    !context.isMorning
  ) {
    return {
      ok: false,
      reason:
        `${spell.name} can only be used in the morning.`,
      spell,
    };
  }

  // ----------------------------------------------------------
  // SHADOW ROUND LOCK
  // ----------------------------------------------------------

  if (
    spell.affinity === "shadow" &&
    context.shadowDisabled
  ) {
    return {
      ok: false,
      reason:
        "Your shadow power is unavailable for the remainder of this round.",
      spell,
    };
  }

  return {
    ok: true,
    spell,
    player,
  };
}

// ============================================================
// FORMATTERS
// ============================================================

function formatSpell(spell, options = {}) {
  if (!spell) return "Unknown spell.";

  const lines = [];

  lines.push(`✦ ${spell.name}`);

  if (spell.affinity) {
    lines.push(
      `Affinity: ${spell.affinity}`
    );
  }

  if (spell.category) {
    lines.push(
      `Category: ${spell.category}`
    );
  }

  if (spell.type) {
    lines.push(
      `Type: ${spell.type}`
    );
  }

  if (spell.mpCost != null) {
    lines.push(
      `MP: ${spell.mpCost}`
    );
  }

  if (spell.basePower) {
    lines.push(
      `Power: ${spell.basePower}`
    );
  }

  if (spell.tierRequired) {
    lines.push(
      `Tier: ${spell.tierRequired}`
    );
  }

  if (spell.masteryRequired) {
    lines.push(
      `Mastery: ${spell.masteryRequired}`
    );
  }

  if (spell.cooldown) {
    lines.push(
      `Cooldown: ${spell.cooldown} turns`
    );
  }

  if (spell.description) {
    lines.push("");
    lines.push(
      spell.description
    );
  }

  if (
    options.includeEffects &&
    spell.effects
  ) {
    lines.push("");
    lines.push(
      "Effects:"
    );

    for (
      const [key, value]
      of Object.entries(spell.effects)
    ) {
      lines.push(
        `• ${key}: ${JSON.stringify(value)}`
      );
    }
  }

  return lines.join("\n");
}

function formatSpellList(
  spells,
  options = {}
) {
  if (!spells?.length) {
    return "No spells found.";
  }

  const lines = [];

  for (const spell of spells) {
    const learned =
      options.learnedIds?.includes(
        spell.id
      );

    const learnable =
      spell.learnable === true;

    let marker = "○";

    if (learned) {
      marker = "✓";
    } else if (learnable) {
      marker = "◇";
    }

    lines.push(
      `${marker} ${spell.name} ` +
      `— ${spell.affinity} · ` +
      `${spell.category} · ` +
      `${spell.mpCost} MP`
    );

    if (
      options.showRequirements
    ) {
      lines.push(
        `   ${spell.tierRequired} · ` +
        `${spell.masteryRequired} mastery`
      );
    }

    if (
      options.showReasons &&
      spell.reason
    ) {
      lines.push(
        `   ↳ ${spell.reason}`
      );
    }
  }

  return lines.join("\n");
}

// ============================================================
// SPELL SUMMARY
// ============================================================

async function getSpellbook(
  threadID,
  userID
) {
  const learned =
    await getLearnedSpells(
      threadID,
      userID
    );

  const learnedIds =
    learned.map(
      (entry) => entry.spell_id
    );

  return {
    learned,
    learnedIds,
    spells:
      learned
        .map((entry) => entry.spell)
        .filter(Boolean),
  };
}

// ============================================================
// STARTING SPELLS
// ============================================================

async function getStartingSpells(
  characterClass
) {
  const id =
    String(characterClass || "")
      .trim()
      .toLowerCase();

  const starting = {
    knight: [
      "holy_light",
    ],

    bloodreaver: [
      "blood_bolt",
    ],

    arcanist: [
      "arcane_missile",
      "detect_magic",
    ],

    wraith: [
      "shadow_veil",
    ],

    paladin: [
      "holy_light",
      "divine_shield",
    ],

    ranger: [
      "thorn_strike",
    ],

    assassin: [
      "shadow_veil",
    ],
  };

  return starting[id] || [];
}

// ============================================================
// SPELL STATISTICS
// ============================================================

function getSpellCount() {
  return Object.keys(SPELLS).length;
}

function getAffinitySpellCount(
  affinityId
) {
  return getSpellsByAffinity(
    affinityId
  ).length;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Constants
  SPELL_CATEGORIES,
  SPELL_TYPES,
  TARGET_TYPES,
  ELEMENTS,

  // Definitions
  SPELLS,

  // Lookups
  normalizeSpellId,
  getSpell,
  getAllSpells,
  getSpellsByAffinity,
  getSpellsByCategory,

  // Requirements
  getSpellTier,
  getSpellMasteryRequirement,
  meetsAffinityRequirement,
  canLearnSpell,

  // Player spells
  getLearnedSpells,
  getLearnableSpells,
  hasSpell,
  grantSpell,
  learnSpell,
  getSpellbook,

  // Arcanist
  getExternalSpell,
  setExternalSpell,
  clearExternalSpell,

  // Casting
  canCastSpell,
  calculateSpellPower,

  // Starting spells
  getStartingSpells,

  // Formatting
  formatSpell,
  formatSpellList,

  // Statistics
  getSpellCount,
  getAffinitySpellCount,
};
