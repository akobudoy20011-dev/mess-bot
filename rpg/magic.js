"use strict";

/**
 * ECLIPSE RPG
 * LEGACY MAGIC COMPATIBILITY BRIDGE
 *
 * IMPORTANT:
 * The actual magic system now lives in:
 *
 *   affinities.js
 *   spells.js
 *   specials.js
 *   effects.js
 *
 * This file exists temporarily so older RPG modules that still
 * require("./magic") do not crash during migration.
 */

const affinities = require("./affinities");
const spells = require("./spells");


// ============================================================
// LEGACY SCHOOL COMPATIBILITY
// ============================================================
//
// Old magic.js called these "schools".
// The new system calls them "affinities".
//
// Keep both names working during migration.
//

const SCHOOLS = {};

for (const affinity of affinities.getAllAffinities()) {
  SCHOOLS[affinity.id] = {
    id: affinity.id,
    name: affinity.name,
    description: affinity.description || "",
  };
}


// ============================================================
// LEGACY AFFINITY TIERS
// ============================================================

const AFFINITY_TIERS =
  affinities.AFFINITY_TIERS || {};


// ============================================================
// AFFINITY API
// ============================================================

const {
  getAffinity,
  getAllAffinities,
  getTier,
  getTierByKey,
  getNextTier,

  getPlayerAffinity,
  getPlayerAffinities,
  getPrimaryAffinity,

  unlockAffinity,
  initializeClassAffinity,

  addAffinityMastery,
  upgradeAffinity,

  getEnvironmentMultiplier,
  getAffinityPowerMultiplier,
  getPlayerAffinityPower,

  canUseAffinity,

  formatAffinity,
  formatAffinityList,
} = affinities;


// ============================================================
// SPELL API
// ============================================================

const {
  getSpell,
  getAllSpells,
  getSpellsByAffinity,
  getSpellsByCategory,

  getLearnedSpells,
  getLearnedSpell,
  hasSpell,

  getStartingSpells,

  learnSpell,
  grantStartingSpells,

  getLearnableSpells,

  canCastSpell,

  getSpellPower,
  addSpellMastery,

  getSpellbook,

  formatSpell,
  formatSpellList,
} = spells;


// ============================================================
// LEGACY NAMES
// ============================================================

/*
 * Older code may refer to "schools".
 * Internally we now use affinities.
 */

function getSchool(id) {
  return getAffinity(id);
}

function getAllSchools() {
  return getAllAffinities();
}

function getSchoolSpells(id) {
  return getSpellsByAffinity(id);
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  // Legacy
  SCHOOLS,
  AFFINITY_TIERS,

  // Affinity system
  getAffinity,
  getAllAffinities,
  getTier,
  getTierByKey,
  getNextTier,

  getPlayerAffinity,
  getPlayerAffinities,
  getPrimaryAffinity,

  unlockAffinity,
  initializeClassAffinity,

  addAffinityMastery,
  upgradeAffinity,

  getEnvironmentMultiplier,
  getAffinityPowerMultiplier,
  getPlayerAffinityPower,

  canUseAffinity,

  formatAffinity,
  formatAffinityList,

  // Spell system
  getSpell,
  getAllSpells,
  getSpellsByAffinity,
  getSpellsByCategory,

  getLearnedSpells,
  getLearnedSpell,
  hasSpell,

  getStartingSpells,

  learnSpell,
  grantStartingSpells,

  getLearnableSpells,

  canCastSpell,

  getSpellPower,
  addSpellMastery,

  getSpellbook,

  formatSpell,
  formatSpellList,

  // Legacy aliases
  getSchool,
  getAllSchools,
  getSchoolSpells,
};
