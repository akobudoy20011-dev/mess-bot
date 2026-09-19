spells
"use strict";

/**
 * ECLIPSE RPG — SPELL SYSTEM
 * ===========================
 *
 * Handles:
 * - 13 affinities
 * - spell tiers
 * - spell mastery
 * - starting class spells
 * - learning / unlearning
 * - kingdom / affinity requirements
 * - Arcanist's one external-affinity spell rule
 * - kingdom quest spell rewards
 * - spell casting validation
 * - spell display helpers
 *
 * DB:
 *   rpg_player_spells
 *
 * Expected columns:
 *   thread_id
 *   user_id
 *   spell_id
 *   mastery
 *   source
 *   learned_at
 *   updated_at
 */

const db = require("../db");

const {
  getAffinity,
  getPlayerAffinity,
} = require("./affinities");

// ============================================================
// CONFIG
// ============================================================

const SPELL_TIERS = {
  BASIC: {
    id: 1,
    key: "basic",
    name: "Basic",
    masteryRequired: 0,
  },

  ADVANCED: {
    id: 2,
    key: "advanced",
    name: "Advanced",
    masteryRequired: 300,
  },

  MASTERY: {
    id: 3,
    key: "mastery",
    name: "Mastery",
    masteryRequired: 1000,
  },

  KINGDOM: {
    id: 4,
    key: "kingdom",
    name: "Kingdom",
    masteryRequired: 1500,
  },

  SPECIAL: {
    id: 5,
    key: "special",
    name: "Special",
    masteryRequired: 2500,
  },

  ULTIMATE: {
    id: 6,
    key: "ultimate",
    name: "Ultimate",
    masteryRequired: 5000,
  },
};

const SPELL_SCHOOLS = [
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
];

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
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 8,
    damage: 24,
    power: 24,
    description: "A compact bolt of flame.",
    effects: [
      {
        id: "burn",
        duration: 3,
        damage: 6,
      },
    ],
  },

  flame_burst: {
    id: "flame_burst",
    name: "Flame Burst",
    affinity: "fire",
    tier: "advanced",
    type: "damage",
    target: "all_enemies",
    manaCost: 22,
    damage: 38,
    power: 38,
    description: "Explodes into a wave of burning flame.",
    effects: [
      {
        id: "burn",
        duration: 3,
        damage: 9,
      },
    ],
  },

  inferno_lance: {
    id: "inferno_lance",
    name: "Inferno Lance",
    affinity: "fire",
    tier: "mastery",
    type: "damage",
    target: "enemy",
    manaCost: 35,
    damage: 68,
    power: 68,
    description: "A concentrated spear of searing fire.",
    effects: [
      {
        id: "burn",
        duration: 4,
        damage: 14,
      },
    ],
  },

  phoenix_flare: {
    id: "phoenix_flare",
    name: "Phoenix Flare",
    affinity: "fire",
    tier: "kingdom",
    type: "damage_heal",
    target: "all_enemies",
    manaCost: 48,
    damage: 92,
    power: 92,
    healPercent: 0.12,
    description:
      "A phoenix-shaped inferno that restores a portion of lost HP.",
    effects: [
      {
        id: "burn",
        duration: 4,
        damage: 18,
      },
    ],
  },

  // ==========================================================
  // ICE
  // ==========================================================

  ice_lance: {
    id: "ice_lance",
    name: "Ice Lance",
    affinity: "ice",
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 9,
    damage: 26,
    power: 26,
    description: "A razor-sharp spear of ice.",
    effects: [
      {
        id: "slow",
        duration: 2,
      },
    ],
  },

  frost_nova: {
    id: "frost_nova",
    name: "Frost Nova",
    affinity: "ice",
    tier: "advanced",
    type: "damage",
    target: "all_enemies",
    manaCost: 24,
    damage: 34,
    power: 34,
    description: "Freezes the battlefield in a burst of frost.",
    effects: [
      {
        id: "slow",
        duration: 2,
      },
    ],
  },

  glacial_spike: {
    id: "glacial_spike",
    name: "Glacial Spike",
    affinity: "ice",
    tier: "mastery",
    type: "damage",
    target: "enemy",
    manaCost: 38,
    damage: 74,
    power: 74,
    description: "A massive spike of compressed ancient ice.",
    effects: [
      {
        id: "stun",
        duration: 1,
      },
    ],
  },

  winter_grasp: {
    id: "winter_grasp",
    name: "Winter's Grasp",
    affinity: "ice",
    tier: "kingdom",
    type: "damage",
    target: "all_enemies",
    manaCost: 52,
    damage: 88,
    power: 88,
    description: "Ancient frost locks enemies in place.",
    effects: [
      {
        id: "stun",
        duration: 1,
      },
      {
        id: "slow",
        duration: 3,
      },
    ],
  },

  // ==========================================================
  // LIGHTNING
  // ==========================================================

  lightning_bolt: {
    id: "lightning_bolt",
    name: "Lightning Bolt",
    affinity: "lightning",
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 10,
    damage: 30,
    power: 30,
    description: "A fast strike of lightning.",
  },

  chain_lightning: {
    id: "chain_lightning",
    name: "Chain Lightning",
    affinity: "lightning",
    tier: "advanced",
    type: "damage",
    target: "all_enemies",
    manaCost: 25,
    damage: 40,
    power: 40,
    description: "Lightning jumps through every enemy.",
    effects: [
      {
        id: "stun",
        duration: 1,
      },
    ],
  },

  thunder_spear: {
    id: "thunder_spear",
    name: "Thunder Spear",
    affinity: "lightning",
    tier: "mastery",
    type: "damage",
    target: "enemy",
    manaCost: 40,
    damage: 82,
    power: 82,
    description: "A devastating spear of compressed lightning.",
  },

  storm_crown: {
    id: "storm_crown",
    name: "Storm Crown",
    affinity: "lightning",
    tier: "kingdom",
    type: "damage_buff",
    target: "all_enemies",
    manaCost: 60,
    damage: 100,
    power: 100,
    description:
      "Summons a storm that empowers every lightning strike.",
    effects: [
      {
        id: "stun",
        duration: 1,
      },
    ],
  },

  // ==========================================================
  // NATURE
  // ==========================================================

  entangling_roots: {
    id: "entangling_roots",
    name: "Entangling Roots",
    affinity: "nature",
    tier: "basic",
    type: "control",
    target: "enemy",
    manaCost: 10,
    damage: 12,
    power: 12,
    description:
      "Roots erupt from the ground and restrain an enemy.",
    effects: [
      {
        id: "root",
        duration: 2,
      },
    ],
  },

  natures_mend: {
    id: "natures_mend",
    name: "Nature's Mend",
    affinity: "nature",
    tier: "basic",
    type: "heal",
    target: "self",
    manaCost: 12,
    healPercent: 0.18,
    power: 0.18,
    description: "Living energy restores health.",
  },

  thorn_barrage: {
    id: "thorn_barrage",
    name: "Thorn Barrage",
    affinity: "nature",
    tier: "advanced",
    type: "damage",
    target: "all_enemies",
    manaCost: 25,
    damage: 42,
    power: 42,
    description: "A storm of razor-sharp thorns.",
    effects: [
      {
        id: "bleed",
        duration: 3,
        damage: 8,
      },
    ],
  },

  ancient_bloom: {
    id: "ancient_bloom",
    name: "Ancient Bloom",
    affinity: "nature",
    tier: "mastery",
    type: "heal_damage",
    target: "all",
    manaCost: 45,
    damage: 48,
    power: 48,
    healPercent: 0.25,
    description:
      "Ancient life energy damages enemies and restores allies.",
  },

  // ==========================================================
  // LIGHT
  // ==========================================================

  healing_light: {
    id: "healing_light",
    name: "Healing Light",
    affinity: "light",
    tier: "basic",
    type: "heal",
    target: "self",
    manaCost: 10,
    healPercent: 0.20,
    power: 0.20,
    description: "A gentle beam of restorative light.",
  },

  radiant_strike: {
    id: "radiant_strike",
    name: "Radiant Strike",
    affinity: "light",
    tier: "advanced",
    type: "damage",
    target: "enemy",
    manaCost: 18,
    damage: 42,
    power: 42,
    description: "A weapon strike infused with holy light.",
  },

  solar_spear: {
    id: "solar_spear",
    name: "Solar Spear",
    affinity: "light",
    tier: "mastery",
    type: "damage",
    target: "enemy",
    manaCost: 35,
    damage: 80,
    power: 80,
    description: "A concentrated spear of sunlight.",
  },

  dawn_restoration: {
    id: "dawn_restoration",
    name: "Dawn Restoration",
    affinity: "light",
    tier: "kingdom",
    type: "heal",
    target: "all",
    manaCost: 50,
    healPercent: 0.35,
    power: 0.35,
    description:
      "Restores a large portion of lost health to the party.",
  },

  // ==========================================================
  // DIVINE
  // ==========================================================

  divine_shield: {
    id: "divine_shield",
    name: "Divine Shield",
    affinity: "divine",
    tier: "basic",
    type: "buff",
    target: "self",
    manaCost: 14,
    description:
      "Wraps the caster in divine protection.",
    effects: [
      {
        id: "divine_shield",
        duration: 3,
      },
    ],
  },

  holy_smite: {
    id: "holy_smite",
    name: "Holy Smite",
    affinity: "divine",
    tier: "advanced",
    type: "damage",
    target: "enemy",
    manaCost: 22,
    damage: 50,
    power: 50,
    description:
      "Calls down divine power upon an enemy.",
  },

  sacred_aegis: {
    id: "sacred_aegis",
    name: "Sacred Aegis",
    affinity: "divine",
    tier: "mastery",
    type: "buff_heal",
    target: "all",
    manaCost: 38,
    healPercent: 0.20,
    power: 0.20,
    description:
      "Strengthens the party with divine protection.",
    effects: [
      {
        id: "defense_up",
        duration: 4,
        amount: 0.25,
      },
    ],
  },

  judgment_ray: {
    id: "judgment_ray",
    name: "Judgment Ray",
    affinity: "divine",
    tier: "kingdom",
    type: "damage",
    target: "all_enemies",
    manaCost: 58,
    damage: 105,
    power: 105,
    description:
      "A column of divine judgment descends upon the battlefield.",
  },

  // ==========================================================
  // ARCANE
  // ==========================================================

  arcane_missile: {
    id: "arcane_missile",
    name: "Arcane Missile",
    affinity: "arcane",
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 7,
    damage: 25,
    power: 25,
    description:
      "Pure magical force condensed into a projectile.",
  },

  arcane_barrier: {
    id: "arcane_barrier",
    name: "Arcane Barrier",
    affinity: "arcane",
    tier: "advanced",
    type: "buff",
    target: "self",
    manaCost: 20,
    description:
      "Creates a protective field of raw magic.",
    effects: [
      {
        id: "damage_reduction",
        duration: 3,
        amount: 0.20,
      },
    ],
  },

  mana_surge: {
    id: "mana_surge",
    name: "Mana Surge",
    affinity: "arcane",
    tier: "advanced",
    type: "mana",
    target: "self",
    manaCost: 0,
    manaRestorePercent: 0.30,
    description:
      "Rapidly restores a portion of maximum mana.",
  },

  void_lance: {
    id: "void_lance",
    name: "Void Lance",
    affinity: "arcane",
    tier: "mastery",
    type: "damage",
    target: "enemy",
    manaCost: 40,
    damage: 88,
    power: 88,
    description:
      "A lance of compressed dimensional energy.",
  },

  /*
   * Kingdom quest reward:
   * silver_arcane_trial
   */
  arcane_blast: {
    id: "arcane_blast",
    name: "Arcane Blast",
    affinity: "arcane",
    tier: "kingdom",
    type: "damage",
    target: "all_enemies",
    manaCost: 52,
    damage: 98,
    power: 98,
    description:
      "A concentrated explosion of pure arcane energy.",
    effects: [
      {
        id: "arcane_blast",
        duration: 1,
      },
    ],
  },

  arcane_annihilation: {
    id: "arcane_annihilation",
    name: "Arcane Annihilation",
    affinity: "arcane",
    tier: "ultimate",
    type: "damage",
    target: "all_enemies",
    manaCost: 85,
    damage: 155,
    power: 155,
    description:
      "Raw arcane force tears through the battlefield.",
  },

  // ==========================================================
  // SHADOW
  // ==========================================================

  shadow_veil: {
    id: "shadow_veil",
    name: "Shadow Veil",
    affinity: "shadow",
    tier: "basic",
    type: "buff",
    target: "self",
    manaCost: 12,
    description:
      "The caster disappears partially into shadow.",
    effects: [
      {
        id: "dodge_up",
        duration: 3,
        amount: 0.25,
      },
    ],
  },

  curse_of_weakness: {
    id: "curse_of_weakness",
    name: "Curse of Weakness",
    affinity: "shadow",
    tier: "basic",
    type: "debuff",
    target: "enemy",
    manaCost: 14,
    description:
      "Weakens an enemy's ability to deal damage.",
    effects: [
      {
        id: "weakness",
        duration: 3,
        amount: 0.20,
      },
    ],
  },

  shadow_bolt: {
    id: "shadow_bolt",
    name: "Shadow Bolt",
    affinity: "shadow",
    tier: "advanced",
    type: "damage",
    target: "enemy",
    manaCost: 20,
    damage: 48,
    power: 48,
    description:
      "A projectile formed from condensed darkness.",
  },

  umbral_chain: {
    id: "umbral_chain",
    name: "Umbral Chain",
    affinity: "shadow",
    tier: "mastery",
    type: "damage",
    target: "all_enemies",
    manaCost: 42,
    damage: 68,
    power: 68,
    description:
      "Chains of darkness bind every enemy.",
    effects: [
      {
        id: "root",
        duration: 2,
      },
    ],
  },

  // ==========================================================
  // NECROMANCY
  // ==========================================================

  necrotic_touch: {
    id: "necrotic_touch",
    name: "Necrotic Touch",
    affinity: "necromancy",
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 12,
    damage: 32,
    power: 32,
    description:
      "Rotting energy infects the target.",
    effects: [
      {
        id: "necrotic",
        duration: 4,
        damage: 8,
      },
    ],
  },

  corpse_drain: {
    id: "corpse_drain",
    name: "Corpse Drain",
    affinity: "necromancy",
    tier: "advanced",
    type: "damage_heal",
    target: "enemy",
    manaCost: 24,
    damage: 45,
    power: 45,
    healPercent: 0.15,
    description:
      "Steals vitality from the target.",
  },

  /*
   * Kingdom quest reward:
   * hollow_crypt
   */
  corpse_bloom: {
    id: "corpse_bloom",
    name: "Corpse Bloom",
    affinity: "necromancy",
    tier: "kingdom",
    type: "damage_heal",
    target: "all_enemies",
    manaCost: 58,
    damage: 92,
    power: 92,
    healPercent: 0.12,
    description:
      "Necrotic energy erupts from the fallen, spreading decay across the battlefield.",
    effects: [
      {
        id: "necrotic",
        duration: 4,
        damage: 14,
      },
    ],
  },

  raise_dead: {
    id: "raise_dead",
    name: "Raise Dead",
    affinity: "necromancy",
    tier: "mastery",
    type: "summon",
    target: "self",
    manaCost: 45,
    description:
      "Raises a temporary undead ally.",
  },

  death_wave: {
    id: "death_wave",
    name: "Death Wave",
    affinity: "necromancy",
    tier: "kingdom",
    type: "damage",
    target: "all_enemies",
    manaCost: 65,
    damage: 110,
    power: 110,
    description:
      "A wave of death energy sweeps across the battlefield.",
    effects: [
      {
        id: "necrotic",
        duration: 4,
        damage: 15,
      },
    ],
  },

  // ==========================================================
  // BLOOD
  // ==========================================================

  blood_spike: {
    id: "blood_spike",
    name: "Blood Spike",
    affinity: "blood",
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 8,
    damage: 30,
    power: 30,
    description:
      "Weaponizes the caster's own blood.",
    effects: [
      {
        id: "bleed",
        duration: 3,
        damage: 7,
      },
    ],
  },

  sanguine_strike: {
    id: "sanguine_strike",
    name: "Sanguine Strike",
    affinity: "blood",
    tier: "advanced",
    type: "damage_heal",
    target: "enemy",
    manaCost: 18,
    damage: 52,
    power: 52,
    lifestealPercent: 0.20,
    description:
      "Deals damage and steals a portion as health.",
  },

  blood_frenzy: {
    id: "blood_frenzy",
    name: "Blood Frenzy",
    affinity: "blood",
    tier: "mastery",
    type: "buff",
    target: "self",
    manaCost: 30,
    description:
      "Transforms pain into offensive power.",
    effects: [
      {
        id: "damage_up",
        duration: 4,
        amount: 0.35,
      },
    ],
  },

  blood_rite: {
    id: "blood_rite",
    name: "Blood Rite",
    affinity: "blood",
    tier: "kingdom",
    type: "damage_heal",
    target: "all_enemies",
    manaCost: 55,
    damage: 100,
    power: 100,
    lifestealPercent: 0.30,
    description:
      "Sacrifices vitality to unleash a wave of blood magic.",
  },

  // ==========================================================
  // WATER
  // ==========================================================

  water_bolt: {
    id: "water_bolt",
    name: "Water Bolt",
    affinity: "water",
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 8,
    damage: 25,
    power: 25,
    description:
      "A compressed projectile of water.",
  },

  tidal_bind: {
    id: "tidal_bind",
    name: "Tidal Bind",
    affinity: "water",
    tier: "advanced",
    type: "control",
    target: "enemy",
    manaCost: 18,
    damage: 35,
    power: 35,
    description:
      "A violent current restrains an enemy.",
    effects: [
      {
        id: "root",
        duration: 2,
      },
    ],
  },

  healing_tide: {
    id: "healing_tide",
    name: "Healing Tide",
    affinity: "water",
    tier: "mastery",
    type: "heal",
    target: "all",
    manaCost: 40,
    healPercent: 0.28,
    power: 0.28,
    description:
      "A restorative wave washes over the party.",
  },

  abyssal_wave: {
    id: "abyssal_wave",
    name: "Abyssal Wave",
    affinity: "water",
    tier: "kingdom",
    type: "damage",
    target: "all_enemies",
    manaCost: 60,
    damage: 105,
    power: 105,
    description:
      "A crushing wall of oceanic force.",
  },

  // ==========================================================
  // WIND
  // ==========================================================

  wind_blade: {
    id: "wind_blade",
    name: "Wind Blade",
    affinity: "wind",
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 7,
    damage: 27,
    power: 27,
    description:
      "A blade of compressed air.",
  },

  gale_step: {
    id: "gale_step",
    name: "Gale Step",
    affinity: "wind",
    tier: "advanced",
    type: "buff",
    target: "self",
    manaCost: 15,
    description:
      "Wind surrounds the caster, increasing agility.",
    effects: [
      {
        id: "agility_up",
        duration: 4,
        amount: 0.25,
      },
    ],
  },

  cyclone: {
    id: "cyclone",
    name: "Cyclone",
    affinity: "wind",
    tier: "mastery",
    type: "damage",
    target: "all_enemies",
    manaCost: 38,
    damage: 70,
    power: 70,
    description:
      "A violent cyclone tears through the battlefield.",
  },

  sky_breaker: {
    id: "sky_breaker",
    name: "Sky Breaker",
    affinity: "wind",
    tier: "kingdom",
    type: "damage",
    target: "all_enemies",
    manaCost: 58,
    damage: 108,
    power: 108,
    description:
      "A devastating atmospheric strike.",
  },

  // ==========================================================
  // EARTH
  // ==========================================================

  stone_shard: {
    id: "stone_shard",
    name: "Stone Shard",
    affinity: "earth",
    tier: "basic",
    type: "damage",
    target: "enemy",
    manaCost: 8,
    damage: 28,
    power: 28,
    description:
      "A sharpened shard of earth.",
  },

  earthen_guard: {
    id: "earthen_guard",
    name: "Earthen Guard",
    affinity: "earth",
    tier: "advanced",
    type: "buff",
    target: "self",
    manaCost: 18,
    description:
      "Stone reinforces the caster's defenses.",
    effects: [
      {
        id: "defense_up",
        duration: 4,
        amount: 0.30,
      },
    ],
  },

  /*
   * Kingdom quest reward:
   * iron_mountain_trial
   */
  stone_wall: {
    id: "stone_wall",
    name: "Stone Wall",
    affinity: "earth",
    tier: "kingdom",
    type: "buff",
    target: "self",
    manaCost: 34,
    description:
      "Raises an immense wall of earth that greatly reduces incoming damage.",
    effects: [
      {
        id: "defense_up",
        duration: 5,
        amount: 0.45,
      },
    ],
  },

  seismic_crush: {
    id: "seismic_crush",
    name: "Seismic Crush",
    affinity: "earth",
    tier: "mastery",
    type: "damage",
    target: "all_enemies",
    manaCost: 42,
    damage: 75,
    power: 75,
    description:
      "The earth erupts beneath every enemy.",
    effects: [
      {
        id: "stun",
        duration: 1,
      },
    ],
  },

  mountain_fall: {
    id: "mountain_fall",
    name: "Mountain Fall",
    affinity: "earth",
    tier: "kingdom",
    type: "damage",
    target: "all_enemies",
    manaCost: 62,
    damage: 115,
    power: 115,
    description:
      "Summons crushing force comparable to a collapsing mountain.",
  },

  // ==========================================================
  // UTILITY
  // ==========================================================

  teleport_sanctuary: {
    id: "teleport_sanctuary",
    name: "Teleport: Sanctuary",
    affinity: "arcane",
    tier: "kingdom",
    type: "utility",
    target: "self",
    manaCost: 35,
    description:
      "Teleport to the player's current sanctuary.",
    utility: "teleport",
  },

  detect_magic: {
    id: "detect_magic",
    name: "Detect Magic",
    affinity: "arcane",
    tier: "basic",
    type: "utility",
    target: "self",
    manaCost: 5,
    description:
      "Reveals magical signatures in the area.",
    utility: "detect",
  },

  teleport: {
    id: "teleport",
    name: "Teleport",
    affinity: "arcane",
    tier: "kingdom",
    type: "utility",
    target: "self",
    manaCost: 35,
    description:
      "Teleport to a known sanctuary.",
    utility: "teleport",
  },

  detect: {
    id: "detect",
    name: "Detect",
    affinity: "arcane",
    tier: "basic",
    type: "utility",
    target: "self",
    manaCost: 5,
    description:
      "Detect magical activity.",
    utility: "detect",
  },
};

// ============================================================
// CLASS STARTING SPELLS
// ============================================================

const CLASS_STARTING_SPELLS = {
  knight: [
    "radiant_strike",
  ],

  bloodreaver: [
    "blood_spike",
    "sanguine_strike",
  ],

  arcanist: [
    "arcane_missile",
    "mana_surge",
    "detect_magic",
  ],

  wraith: [
    "shadow_veil",
    "shadow_bolt",
  ],

  paladin: [
    "healing_light",
    "divine_shield",
    "holy_smite",
  ],

  ranger: [
    "entangling_roots",
    "natures_mend",
  ],

  assassin: [
    "shadow_veil",
    "curse_of_weakness",
  ],
};

// ============================================================
// NORMALIZATION
// ============================================================

function normalizeSpellId(value) {
  if (!value) return null;

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[\s-]+/g, "_");
}

function normalizeTier(value) {
  if (!value) return null;

  const key = String(value)
    .trim()
    .toLowerCase();

  for (const tier of Object.values(SPELL_TIERS)) {
    if (
      tier.key === key ||
      String(tier.id) === key
    ) {
      return tier.key;
    }
  }

  return null;
}

// ============================================================
// LOOKUPS
// ============================================================

function getSpell(spellID) {
  const id = normalizeSpellId(spellID);

  return id
    ? SPELLS[id] || null
    : null;
}

function getAllSpells() {
  return Object.values(SPELLS);
}

function getSpellsByAffinity(affinityID) {
  const id = String(
    affinityID || ""
  ).toLowerCase();

  return getAllSpells().filter(
    spell => spell.affinity === id
  );
}

function getSpellsByTier(tier) {
  const normalized = normalizeTier(tier);

  if (!normalized) {
    return [];
  }

  return getAllSpells().filter(
    spell => spell.tier === normalized
  );
}

function getSpellsByAffinityAndTier(
  affinityID,
  tier
) {
  const normalizedTier = normalizeTier(tier);

  const affinity = String(
    affinityID || ""
  ).toLowerCase();

  return getAllSpells().filter(
    spell =>
      spell.affinity === affinity &&
      spell.tier === normalizedTier
  );
}

// ============================================================
// PLAYER SPELL DATABASE
// ============================================================

async function getLearnedSpellRows(
  threadID,
  userID
) {
  const result = await db.query(
    `
      SELECT
        spell_id,
        COALESCE(mastery, 0) AS mastery,
        source,
        learned_at
      FROM rpg_player_spells
      WHERE thread_id = $1
        AND user_id = $2
      ORDER BY learned_at ASC, spell_id ASC
    `,
    [
      String(threadID),
      String(userID),
    ]
  );

  return result.rows || [];
}

async function getLearnedSpells(
  threadID,
  userID
) {
  const rows = await getLearnedSpellRows(
    threadID,
    userID
  );

  return rows
    .map(row => {
      const spell = getSpell(row.spell_id);

      if (!spell) {
        return null;
      }

      return {
        ...spell,
        mastery: Number(row.mastery || 0),
        source: row.source || "unknown",
        learnedAt: row.learned_at,
      };
    })
    .filter(Boolean);
}

async function hasSpell(
  threadID,
  userID,
  spellID
) {
  const id = normalizeSpellId(spellID);

  if (!id) {
    return false;
  }

  const result = await db.query(
    `
      SELECT 1
      FROM rpg_player_spells
      WHERE thread_id = $1
        AND user_id = $2
        AND spell_id = $3
      LIMIT 1
    `,
    [
      String(threadID),
      String(userID),
      id,
    ]
  );

  return result.rows.length > 0;
}

// ============================================================
// PLAYER HELPERS
// ============================================================

/*
 * FIXED: rpg_players uses `character_class`, not `class`.
 * The previous version queried `class` first and hit a
 * "column does not exist" error on every single call before
 * falling back to `character_class`. SELECT * avoids depending
 * on either exact column name and works with the real schema.
 */
async function getPlayerClass(threadID, userID) {
  try {
    const result = await db.query(
      `
        SELECT *
        FROM rpg_players
        WHERE thread_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [String(threadID), String(userID)]
    );

    const row = result.rows[0];

    return String(
      row?.character_class || row?.class || "knight"
    ).toLowerCase();
  } catch (_) {
    return "knight";
  }
}

async function getPlayerKingdom(
  threadID,
  userID
) {
  try {
    const result = await db.query(
      `
        SELECT
          kingdom_id,
          kingdom_role,
          traitor,
          traitor_kingdom_id
        FROM rpg_players
        WHERE thread_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [
        String(threadID),
        String(userID),
      ]
    );

    return (
      result.rows[0] || {
        kingdom_id: null,
        kingdom_role: null,
        traitor: false,
        traitor_kingdom_id: null,
      }
    );
  } catch (_) {
    return {
      kingdom_id: null,
      kingdom_role: null,
      traitor: false,
      traitor_kingdom_id: null,
    };
  }
}

// ============================================================
// ARCANIST EXTERNAL SPELL RULE
// ============================================================

async function getArcanistExternalSpellCount(
  threadID,
  userID
) {
  const learned = await getLearnedSpells(
    threadID,
    userID
  );

  return learned.filter(
    spell => spell.affinity !== "arcane"
  ).length;
}

async function canArcanistLearnExternalSpell(
  threadID,
  userID,
  spell
) {
  const playerClass = await getPlayerClass(
    threadID,
    userID
  );

  if (playerClass !== "arcanist") {
    return true;
  }

  if (spell.affinity === "arcane") {
    return true;
  }

  const count =
    await getArcanistExternalSpellCount(
      threadID,
      userID
    );

  return count < 1;
}

// ============================================================
// SPELL REQUIREMENTS
// ============================================================

function getRequiredTierForSpell(spell) {
  if (!spell) {
    return SPELL_TIERS.BASIC;
  }

  return (
    SPELL_TIERS[
      String(
        spell.tier || "basic"
      ).toUpperCase()
    ] ||
    SPELL_TIERS.BASIC
  );
}

async function getPlayerAffinityTier(
  threadID,
  userID,
  affinityID
) {
  const affinity = await getPlayerAffinity(
    threadID,
    userID,
    affinityID
  );

  if (!affinity) {
    return {
      unlocked: false,
      tier: "none",
      tierId: 0,
      mastery: 0,
    };
  }

  const tierValue =
    affinity.tierKey ||
    affinity.tier ||
    "none";

  let tierId = Number(
    affinity.tierId ||
      affinity.tier_id ||
      0
  );

  if (!tierId) {
    const tier =
      getAffinityTierDefinition(
        tierValue
      );

    tierId = Number(tier?.id || 0);
  }

  return {
    unlocked: true,
    tier: tierValue,
    tierId,
    mastery: Number(
      affinity.mastery || 0
    ),
  };
}

/*
 * FIXED: rpg_player_affinities.tier is stored as an INTEGER
 * (0-6). The previous version only matched string keys
 * ("weak", "strong", ...), so a raw numeric tier from
 * affinities.js always fell through to "none" and every
 * mastery/tier gate in checkSpellRequirements failed with
 * "requires Basic ... affinity" even when the player actually
 * had the affinity. This now accepts a number, numeric string,
 * or key.
 */
function getAffinityTierDefinition(tier) {
  const tiers = {
    none:        { id: 0, key: "none",        name: "None",        masteryRequired: 0 },
    weak:        { id: 1, key: "weak",        name: "Weak",        masteryRequired: 100 },
    normal:      { id: 2, key: "normal",      name: "Normal",      masteryRequired: 300 },
    strong:      { id: 3, key: "strong",      name: "Strong",      masteryRequired: 700 },
    exceptional: { id: 4, key: "exceptional", name: "Exceptional", masteryRequired: 1500 },
    mastered:    { id: 5, key: "mastered",    name: "Mastered",    masteryRequired: 3000 },
    ascended:    { id: 6, key: "ascended",    name: "Ascended",    masteryRequired: 6000 },
  };

  const value = String(tier ?? "none").trim().toLowerCase();

  if (/^\d+$/.test(value)) {
    return (
      Object.values(tiers).find(t => t.id === Number(value)) ||
      tiers.none
    );
  }

  return tiers[value] || tiers.none;
}

// ============================================================
// CHECK SPELL REQUIREMENTS
// ============================================================

async function checkSpellRequirements(
  threadID,
  userID,
  spellID,
  options = {}
) {
  const spell = getSpell(spellID);

  if (!spell) {
    return {
      ok: false,
      success: false,
      reason: "That spell does not exist.",
      code: "SPELL_NOT_FOUND",
    };
  }

  const alreadyKnown = await hasSpell(
    threadID,
    userID,
    spell.id
  );

  if (alreadyKnown) {
    return {
      ok: false,
      success: false,
      reason: "You already know this spell.",
      code: "ALREADY_KNOWN",
      spell,
    };
  }

  /*
   * Starting/class/quest/system rewards can
   * bypass normal learning requirements.
   */
  if (options.bypassRequirements === true) {
    return {
      ok: true,
      success: true,
      spell,
      bypassed: true,
    };
  }

  const playerClass = await getPlayerClass(
    threadID,
    userID
  );

  const isArcanist =
    playerClass === "arcanist";

  const isExternal =
    isArcanist &&
    spell.affinity !== "arcane";

  const affinity =
    await getPlayerAffinityTier(
      threadID,
      userID,
      spell.affinity
    );

  /*
   * Arcanist's one external spell.
   */
  if (isExternal) {
    const allowed =
      await canArcanistLearnExternalSpell(
        threadID,
        userID,
        spell
      );

    if (!allowed) {
      return {
        ok: false,
        success: false,
        reason:
          "Arcanists may learn only one spell from outside Arcane.",
        code: "ARCANIST_EXTERNAL_LIMIT",
        spell,
      };
    }
  }

  /*
   * Normal affinity requirement.
   *
   * An external Arcanist spell bypasses
   * ownership/mastery of that external affinity.
   */
  if (
    !affinity.unlocked &&
    !isExternal
  ) {
    return {
      ok: false,
      success: false,
      reason:
        `You have not unlocked the ${spell.affinity} affinity.`,
      code: "AFFINITY_LOCKED",
      spell,
    };
  }

  const requiredTier =
    getRequiredTierForSpell(spell);

  if (
    !isExternal &&
    affinity.unlocked
  ) {
    if (
      affinity.tierId <
      requiredTier.id
    ) {
      return {
        ok: false,
        success: false,
        reason:
          `${spell.name} requires ${requiredTier.name} ${spell.affinity} affinity.`,
        code: "AFFINITY_TIER_TOO_LOW",
        spell,
        requiredTier,
        currentTier: affinity.tier,
      };
    }

    if (
      affinity.mastery <
      requiredTier.masteryRequired
    ) {
      return {
        ok: false,
        success: false,
        reason:
          `${spell.name} requires ${requiredTier.masteryRequired} ${spell.affinity} mastery.`,
        code: "MASTERY_TOO_LOW",
        spell,
        requiredMastery:
          requiredTier.masteryRequired,
        currentMastery:
          affinity.mastery,
      };
    }
  }

  /*
   * Kingdom requirements.
   *
   * Kingdom quest/system rewards bypass this
   * section because they already passed through
   * the bypassRequirements path above.
   */
  if (spell.tier === "kingdom") {
    const player =
      await getPlayerKingdom(
        threadID,
        userID
      );

    const affinityDefinition =
      getAffinity(spell.affinity);

    const requiredKingdom =
      affinityDefinition?.kingdom ||
      null;

    if (
      requiredKingdom &&
      !isExternal
    ) {
      if (
        player.traitor &&
        player.traitor_kingdom_id ===
          requiredKingdom
      ) {
        return {
          ok: false,
          success: false,
          reason:
            "You cannot learn rewards belonging to a kingdom you betrayed.",
          code: "TRAITOR_LOCKED",
          spell,
          requiredKingdom,
        };
      }

      if (
        player.kingdom_id !==
        requiredKingdom
      ) {
        return {
          ok: false,
          success: false,
          reason:
            `${spell.name} requires allegiance to ${requiredKingdom}.`,
          code: "KINGDOM_REQUIRED",
          spell,
          requiredKingdom,
        };
      }
    }
  }

  return {
    ok: true,
    success: true,
    spell,
  };
}

// ============================================================
// GRANT SPELL DIRECTLY
// ============================================================

/**
 * Directly grants a spell.
 *
 * Used by:
 * - class starting rewards
 * - kingdom quests
 * - bosses
 * - story rewards
 * - system rewards
 *
 * Does NOT run normal learning requirements.
 */
async function grantSpell(
  threadID,
  userID,
  spellID,
  source = "system"
) {
  const spell = getSpell(spellID);

  if (!spell) {
    throw new Error(
      `Unknown spell: ${spellID}`
    );
  }

  const result = await db.query(
    `
      INSERT INTO rpg_player_spells
        (
          thread_id,
          user_id,
          spell_id,
          mastery,
          source,
          learned_at,
          updated_at
        )
      VALUES
        ($1, $2, $3, 0, $4, $5, $5)
      ON CONFLICT
        (thread_id, user_id, spell_id)
      DO NOTHING
      RETURNING spell_id
    `,
    [
      String(threadID),
      String(userID),
      spell.id,
      source,
      Date.now(),
    ]
  );

  return result.rows.length > 0;
}

// ============================================================
// LEARN SPELL
// ============================================================

/*
 * FIXED: db.spendBalance() returns the updated user row on
 * success and THROWS (it never returns false or a {success}
 * object) when the wallet balance is too low. The previous
 * version tested the return value for `true` / `.success`,
 * which a user row never has, so `paid` was always false: every
 * paid learn silently took the coins via spendBalance and then
 * still reported INSUFFICIENT_FUNDS without granting the spell.
 * This wraps the call in try/catch, matching spendBalance's
 * real contract: a thrown error means the payment failed (and
 * spendBalance guarantees no balance was deducted in that case),
 * no throw means it succeeded.
 */
async function learnSpell(threadID, userID, spellID, options = {}) {
  const id = normalizeSpellId(spellID);

  // Trusted reward sources skip the normal learning gates.
  const bypass =
    options.bypassRequirements === true ||
    options.free === true ||
    options.source === "kingdom" ||
    options.source === "quest" ||
    options.source === "kingdom_quest" ||
    options.source === "boss" ||
    options.source === "system" ||
    options.source === "class_start";

  const check = await checkSpellRequirements(
    threadID,
    userID,
    id,
    { ...options, bypassRequirements: bypass }
  );

  if (!check.ok) {
    return { success: false, ...check };
  }

  const spell = check.spell;
  const source = options.source || "learned";
  const cost = bypass ? 0 : getSpellCost(spell);

  if (cost > 0) {
    try {
      await db.spendBalance(
        String(threadID),
        String(userID),
        cost,
        `Learn spell: ${spell.name}`
      );
    } catch (error) {
      return {
        success: false,
        reason: `You need ${cost.toLocaleString()} coins to learn ${spell.name}.`,
        code: "INSUFFICIENT_FUNDS",
        spell,
        cost,
      };
    }
  }

  const granted = await grantSpell(threadID, userID, spell.id, source);

  if (!granted) {
    // Lost a race with a duplicate learn request: give the coins back.
    if (cost > 0) {
      await db.addBalance(
        String(threadID),
        String(userID),
        cost,
        `Refund: ${spell.name}`
      );
    }

    return {
      success: false,
      reason: "That spell is already known.",
      code: "ALREADY_KNOWN",
      spell,
    };
  }

  return { success: true, spell, cost, source };
}

// ============================================================
// SPELL COST
// ============================================================

function getSpellCost(spell) {
  if (!spell) {
    return 0;
  }

  const costs = {
    basic: 150,
    advanced: 750,
    mastery: 2500,
    kingdom: 5000,
    special: 10000,
    ultimate: 25000,
  };

  return (
    costs[spell.tier] ||
    150
  );
}

// ============================================================
// STARTING SPELLS
// ============================================================

function getStartingSpellIDs(classID) {
  const key = String(
    classID || "knight"
  ).toLowerCase();

  return [
    ...(
      CLASS_STARTING_SPELLS[key] ||
      CLASS_STARTING_SPELLS.knight
    ),
  ];
}

function getStartingSpells(classID) {
  return getStartingSpellIDs(classID)
    .map(id => getSpell(id))
    .filter(Boolean);
}

async function grantStartingSpells(
  threadID,
  userID,
  classID
) {
  const starting =
    getStartingSpells(classID);

  const granted = [];

  for (const spell of starting) {
    const wasGranted =
      await grantSpell(
        threadID,
        userID,
        spell.id,
        "class_start"
      );

    if (wasGranted) {
      granted.push(spell);
    }
  }

  return granted;
}

// ============================================================
// LEARNABLE SPELLS
// ============================================================

async function getLearnableSpells(
  threadID,
  userID,
  affinityID = null
) {
  const all = affinityID
    ? getSpellsByAffinity(affinityID)
    : getAllSpells();

  const learned =
    await getLearnedSpells(
      threadID,
      userID
    );

  const learnedIDs = new Set(
    learned.map(
      spell => spell.id
    )
  );

  const results = [];

  for (const spell of all) {
    if (
      learnedIDs.has(spell.id)
    ) {
      continue;
    }

    const check =
      await checkSpellRequirements(
        threadID,
        userID,
        spell.id
      );

    results.push({
      ...spell,
      canLearn: check.ok,
      reason:
        check.ok
          ? null
          : check.reason,
      code:
        check.code || null,
      cost:
        getSpellCost(spell),
    });
  }

  return results;
}

// ============================================================
// SPELL MASTERY
// ============================================================

async function getSpellMastery(
  threadID,
  userID,
  spellID
) {
  const id =
    normalizeSpellId(spellID);

  const result =
    await db.query(
      `
        SELECT
          spell_id,
          COALESCE(mastery, 0) AS mastery,
          source,
          learned_at
        FROM rpg_player_spells
        WHERE thread_id = $1
          AND user_id = $2
          AND spell_id = $3
        LIMIT 1
      `,
      [
        String(threadID),
        String(userID),
        id,
      ]
    );

  if (!result.rows.length) {
    return null;
  }

  return {
    spellID:
      result.rows[0].spell_id,
    mastery:
      Number(
        result.rows[0].mastery || 0
      ),
    source:
      result.rows[0].source,
    learnedAt:
      result.rows[0].learned_at,
  };
}

async function addSpellMastery(
  threadID,
  userID,
  spellID,
  amount
) {
  const id =
    normalizeSpellId(spellID);

  if (!getSpell(id)) {
    return {
      success: false,
      reason:
        "Unknown spell.",
    };
  }

  const value =
    Math.max(
      0,
      Number(amount || 0)
    );

  if (value <= 0) {
    return {
      success: false,
      reason:
        "Mastery amount must be greater than zero.",
    };
  }

  const result =
    await db.query(
      `
        UPDATE rpg_player_spells
        SET
          mastery =
            COALESCE(mastery, 0) + $4,
          updated_at = $5
        WHERE thread_id = $1
          AND user_id = $2
          AND spell_id = $3
        RETURNING mastery
      `,
      [
        String(threadID),
        String(userID),
        id,
        value,
        Date.now(),
      ]
    );

  if (!result.rows.length) {
    return {
      success: false,
      reason:
        "You have not learned that spell.",
    };
  }

  return {
    success: true,
    spell:
      getSpell(id),
    mastery:
      Number(
        result.rows[0].mastery ||
          0
      ),
  };
}

// ============================================================
// CASTING
// ============================================================

/**
 * Backwards-compatible boolean:
 *
 * await canCastSpell(...)
 *
 * returns true / false.
 *
 * Detailed validation is available through
 * validateSpellCast().
 */
async function canCastSpell(
  threadID,
  userID,
  spellID,
  options = {}
) {
  const result =
    await validateSpellCast(
      threadID,
      userID,
      spellID,
      options
    );

  return result.ok;
}

async function validateSpellCast(
  threadID,
  userID,
  spellID,
  options = {}
) {
  const spell =
    getSpell(spellID);

  if (!spell) {
    return {
      ok: false,
      success: false,
      reason:
        "That spell does not exist.",
      code:
        "SPELL_NOT_FOUND",
    };
  }

  const known =
    await hasSpell(
      threadID,
      userID,
      spell.id
    );

  if (!known) {
    return {
      ok: false,
      success: false,
      reason:
        `You have not learned ${spell.name}.`,
      code:
        "SPELL_NOT_LEARNED",
      spell,
    };
  }

  const currentMP =
    options.currentMP;

  const manaCost =
    Number(
      spell.manaCost || 0
    );

  if (
    currentMP != null &&
    Number(currentMP) <
      manaCost
  ) {
    return {
      ok: false,
      success: false,
      reason:
        `Not enough MP. ${spell.name} requires ${manaCost} MP.`,
      code:
        "INSUFFICIENT_MP",
      spell,
      manaCost,
      currentMP:
        Number(currentMP),
    };
  }

  return {
    ok: true,
    success: true,
    spell,
    manaCost,
  };
}

// ============================================================
// SPELL POWER
// ============================================================

async function getSpellPower(
  threadID,
  userID,
  spellID
) {
  const spell =
    getSpell(spellID);

  if (!spell) {
    return 0;
  }

  let multiplier = 1;

  /*
   * Use the affinity's actual power
   * multiplier when available.
   */
  try {
    const affinity =
      await getPlayerAffinity(
        threadID,
        userID,
        spell.affinity
      );

    if (affinity) {
      multiplier =
        Number(
          affinity.powerMultiplier ??
            affinity.power_multiplier ??
            1
        );

      if (
        !Number.isFinite(multiplier) ||
        multiplier <= 0
      ) {
        multiplier = 1;
      }
    }
  } catch (_) {
    multiplier = 1;
  }

  return Math.round(
    Number(
      spell.power ??
        spell.damage ??
        0
    ) * multiplier
  );
}

// ============================================================
// SPELL EFFECT DATA
// ============================================================

function getSpellEffectData(
  spellID
) {
  const spell =
    getSpell(spellID);

  if (!spell) {
    return null;
  }

  return {
    id: spell.id,

    name: spell.name,

    affinity: spell.affinity,

    tier: spell.tier,

    type: spell.type,

    target: spell.target,

    manaCost: Number(
      spell.manaCost || 0
    ),

    damage: Number(
      spell.damage || 0
    ),

    power: Number(
      spell.power || 0
    ),

    healPercent: Number(
      spell.healPercent || 0
    ),

    manaRestorePercent:
      Number(
        spell.manaRestorePercent ||
          0
      ),

    lifestealPercent:
      Number(
        spell.lifestealPercent ||
          0
      ),

    utility:
      spell.utility || null,

    effects:
      Array.isArray(
        spell.effects
      )
        ? spell.effects.map(
            effect => ({
              ...effect,
            })
          )
        : [],
  };
}

// ============================================================
// FORMATTING
// ============================================================

function formatSpell(
  spell,
  options = {}
) {
  if (!spell) {
    return "Unknown spell";
  }

  const tier =
    SPELL_TIERS[
      String(
        spell.tier ||
          "basic"
      ).toUpperCase()
    ] ||
    SPELL_TIERS.BASIC;

  const lines = [];

  lines.push(
    `✦ ${spell.name} [${String(
      spell.affinity
    ).toUpperCase()}]`
  );

  lines.push(
    `  ${tier.name} • ${
      spell.manaCost || 0
    } MP`
  );

  if (spell.damage) {
    lines.push(
      `  ⚔️ Power: ${spell.damage}`
    );
  }

  if (spell.healPercent) {
    lines.push(
      `  ❤️ Healing: ${Math.round(
        spell.healPercent * 100
      )}%`
    );
  }

  if (
    spell.effects?.length
  ) {
    const effectText =
      spell.effects
        .map(effect => {
          if (
            effect.duration
          ) {
            return `${effect.id} ${effect.duration}t`;
          }

          return effect.id;
        })
        .join(", ");

    lines.push(
      `  ◈ Effects: ${effectText}`
    );
  }

  if (spell.description) {
    lines.push(
      `  ${spell.description}`
    );
  }

  if (
    options.showCost
  ) {
    lines.push(
      `  💰 Learn: ${getSpellCost(
        spell
      ).toLocaleString()} coins`
    );
  }

  return lines.join("\n");
}

function formatSpellList(
  spells,
  options = {}
) {
  if (
    !Array.isArray(spells) ||
    !spells.length
  ) {
    return "No spells found.";
  }

  const groups = {};

  for (const spell of spells) {
    const affinity =
      spell.affinity ||
      "unknown";

    if (!groups[affinity]) {
      groups[affinity] = [];
    }

    groups[affinity].push(
      spell
    );
  }

  const lines = [];

  for (
    const [
      affinity,
      entries,
    ] of Object.entries(groups)
  ) {
    lines.push(
      `\n━━ ${affinity.toUpperCase()} ━━`
    );

    for (const spell of entries) {
      const tier =
        SPELL_TIERS[
          String(
            spell.tier ||
              "basic"
          ).toUpperCase()
        ] ||
        SPELL_TIERS.BASIC;

      let status = "";

      if (
        spell.canLearn === true
      ) {
        status =
          " • ✓ LEARNABLE";
      } else if (
        spell.canLearn === false
      ) {
        status =
          " • 🔒";
      }

      lines.push(
        `✦ ${spell.name} — ${tier.name}${status}`
      );

      if (
        options.showIDs
      ) {
        lines.push(
          `  ID: ${spell.id}`
        );
      }

      if (
        options.showReasons &&
        spell.reason
      ) {
        lines.push(
          `  └ ${spell.reason}`
        );
      }
    }
  }

  return lines.join("\n");
}

function formatLearnedSpellList(
  spells
) {
  if (
    !Array.isArray(spells) ||
    !spells.length
  ) {
    return "You have not learned any spells yet.";
  }

  return spells
    .map(spell => {
      const mastery =
        spell.mastery != null
          ? ` • ${spell.mastery} mastery`
          : "";

      return (
        `✦ ${spell.name} [${spell.affinity}]` +
        ` • ${spell.tier}` +
        mastery
      );
    })
    .join("\n");
}

// ============================================================
// SPELLBOOK
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

  const byAffinity = {};

  for (const spell of learned) {
    if (
      !byAffinity[
        spell.affinity
      ]
    ) {
      byAffinity[
        spell.affinity
      ] = [];
    }

    byAffinity[
      spell.affinity
    ].push(spell);
  }

  return {
    total:
      learned.length,
    learned,
    byAffinity,
  };
}

function formatSpellbook(
  book
) {
  if (
    !book ||
    !Array.isArray(
      book.learned
    ) ||
    !book.learned.length
  ) {
    return [
      "╔════════════════════════╗",
      "          SPELLBOOK",
      "╚════════════════════════╝",
      "",
      "No spells learned yet.",
    ].join("\n");
  }

  const lines = [
    "╔════════════════════════╗",
    "          SPELLBOOK",
    "╚════════════════════════╝",
    "",
    `Total spells: ${book.total}`,
    "",
  ];

  for (
    const [
      affinity,
      spells,
    ] of Object.entries(
      book.byAffinity || {}
    )
  ) {
    lines.push(
      `━━ ${affinity.toUpperCase()} ━━`
    );

    for (const spell of spells) {
      lines.push(
        `✦ ${spell.name}`,
        `  ${spell.tier} • ${spell.mastery || 0} mastery`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Definitions
  SPELLS,
  SPELL_TIERS,
  SPELL_SCHOOLS,
  CLASS_STARTING_SPELLS,

  // Lookup
  normalizeSpellId,
  normalizeTier,
  getSpell,
  getAllSpells,
  getSpellsByAffinity,
  getSpellsByTier,
  getSpellsByAffinityAndTier,

  // Player spells
  getLearnedSpellRows,
  getLearnedSpells,
  getSpellbook,
  hasSpell,

  // Learning
  grantSpell,
  learnSpell,
  getLearnableSpells,
  checkSpellRequirements,

  // Costs
  getSpellCost,

  // Starting spells
  getStartingSpellIDs,
  getStartingSpells,
  grantStartingSpells,

  // Mastery
  getSpellMastery,
  addSpellMastery,

  // Casting
  canCastSpell,
  validateSpellCast,
  getSpellPower,
  getSpellEffectData,

  // Arcanist
  getArcanistExternalSpellCount,
  canArcanistLearnExternalSpell,

  // Formatting
  formatSpell,
  formatSpellList,
  formatLearnedSpellList,
  formatSpellbook,
};
