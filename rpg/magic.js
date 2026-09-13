const db = require("../db");
const { normalizeKey } = require("./utils");

const SCHOOLS = {
  elemental:  { name: "Elemental",  emoji: "🔥" },
  arcane:     { name: "Arcane",     emoji: "🔷" },
  divine:     { name: "Divine",     emoji: "✨" },
  nature:     { name: "Nature",     emoji: "🌿" },
  shadow:     { name: "Shadow",     emoji: "🌑" },
  necromancy: { name: "Necromancy", emoji: "💀" },
};

const AFFINITY_TIERS = {
  none:        { label: "None",        canCast: false, power: 0,    costMultiplier: 1 },
  weak:        { label: "Weak",        canCast: true,  power: 0.75, costMultiplier: 1.2 },
  normal:      { label: "Normal",      canCast: true,  power: 1,    costMultiplier: 1 },
  strong:      { label: "Strong",      canCast: true,  power: 1.25, costMultiplier: 0.9 },
  exceptional: { label: "Exceptional", canCast: true,  power: 1.5,  costMultiplier: 0.75 },
};

// One magic affinity per class. Kept here rather than in classes.js so the
// existing class definitions don't need to change at all.
const CLASS_AFFINITY = {
  knight:      { school: "divine",     tier: "weak" },
  bloodreaver: { school: "shadow",     tier: "weak" },
  arcanist:    { school: "arcane",     tier: "exceptional" },
  wraith:      { school: "shadow",     tier: "strong" },
  paladin:     { school: "divine",     tier: "strong" },
  ranger:      { school: "nature",     tier: "normal" },
  assassin:    { school: "shadow",     tier: "normal" },
};

const RARITY_COST = { Common: 150, Uncommon: 350, Rare: 700 };

const SPELLS = {
  firebolt:           { name: "Firebolt",            emoji: "🔥", school: "elemental",  manaCost: 14, power: 2.0, target: "enemy",   effect: "damage",        rarity: "Common" },
  ice_lance:          { name: "Ice Lance",           emoji: "❄️", school: "elemental",  manaCost: 16, power: 1.7, target: "enemy",   effect: "damage_weaken", rarity: "Uncommon" },
  arcane_missile:     { name: "Arcane Missile",      emoji: "🔷", school: "arcane",     manaCost: 12, power: 1.8, target: "enemy",   effect: "damage",        rarity: "Common" },
  healing_light:      { name: "Healing Light",       emoji: "✨", school: "divine",     manaCost: 18, power: 1.6, target: "self",    effect: "heal",          rarity: "Common" },
  divine_shield:      { name: "Divine Shield",       emoji: "🛡️", school: "divine",     manaCost: 15, power: 0,   target: "self",    effect: "guard",         rarity: "Uncommon" },
  entangling_roots:   { name: "Entangling Roots",    emoji: "🌿", school: "nature",     manaCost: 13, power: 1.3, target: "enemy",   effect: "damage_weaken", rarity: "Common" },
  natures_mend:       { name: "Nature's Mend",       emoji: "🌱", school: "nature",     manaCost: 16, power: 1.4, target: "self",    effect: "heal",          rarity: "Common" },
  shadow_veil:        { name: "Shadow Veil",         emoji: "🌑", school: "shadow",     manaCost: 14, power: 0,   target: "self",    effect: "dodge",         rarity: "Uncommon" },
  curse_of_weakness:  { name: "Curse of Weakness",   emoji: "💀", school: "shadow",     manaCost: 15, power: 1.2, target: "enemy",   effect: "damage_weaken", rarity: "Uncommon" },
  drain_life:         { name: "Drain Life",          emoji: "🩸", school: "necromancy", manaCost: 20, power: 1.9, target: "enemy",   effect: "drain",         rarity: "Rare" },
  teleport_sanctuary: { name: "Teleport: Sanctuary", emoji: "🌀", school: "arcane",     manaCost: 30, power: 0,   target: "utility", effect: "teleport",      rarity: "Rare" },
  detect_magic:       { name: "Detect Magic",        emoji: "🔍", school: "arcane",     manaCost: 10, power: 0,   target: "utility", effect: "detect",        rarity: "Common" },
};

function getAffinity(classKey) {
  return CLASS_AFFINITY[normalizeKey(classKey)] || { school: "arcane", tier: "weak" };
}

function getSpell(value) {
  return SPELLS[normalizeKey(value)] || null;
}

function getStartingSpells(classKey) {
  const affinity = getAffinity(classKey);
  if (!AFFINITY_TIERS[affinity.tier]?.canCast) return [];
  const starter = Object.entries(SPELLS).find(
    ([, spell]) => spell.school === affinity.school && spell.rarity === "Common"
  );
  return starter ? [starter[0]] : [];
}

function getLearnableSpells(classKey) {
  const affinity = getAffinity(classKey);
  if (!AFFINITY_TIERS[affinity.tier]?.canCast) return [];
  return Object.entries(SPELLS)
    .filter(([, spell]) => spell.school === affinity.school)
    .map(([id, spell]) => ({ id, ...spell }));
}

async function getLearnedSpells(threadID, userID) {
  const result = await db.query(
    `
    SELECT spell_id
    FROM rpg_player_spells
    WHERE thread_id = $1
      AND user_id = $2
      AND unlocked = TRUE
    ORDER BY spell_id
    `,
    [String(threadID), String(userID)]
  );
  return result.rows.map((row) => row.spell_id);
}

async function grantSpell(threadID, userID, spellId) {
  await db.query(
    `
    INSERT INTO rpg_player_spells (thread_id, user_id, spell_id, unlocked, updated_at)
    VALUES ($1, $2, $3, TRUE, $4)
    ON CONFLICT (thread_id, user_id, spell_id)
    DO UPDATE SET unlocked = TRUE, updated_at = EXCLUDED.updated_at
    `,
    [String(threadID), String(userID), String(spellId), Date.now()]
  );
}

async function learnSpell(threadID, userID, classKey, spellId) {
  const spell = getSpell(spellId);
  if (!spell) throw new Error("That spell does not exist.");

  const affinity = getAffinity(classKey);
  const tier = AFFINITY_TIERS[affinity.tier];
  if (spell.school !== affinity.school || !tier.canCast) {
    throw new Error(
      `Your class cannot learn ${spell.name}. Your affinity is ${SCHOOLS[affinity.school].name} (${tier.label}).`
    );
  }

  const learned = await getLearnedSpells(threadID, userID);
  const key = normalizeKey(spellId);
  if (learned.includes(key)) {
    throw new Error(`You already know ${spell.name}.`);
  }

  const cost = RARITY_COST[spell.rarity] || 250;
  await db.spendBalance(threadID, userID, cost, `RPG spell learned: ${spell.name}`);
  await grantSpell(threadID, userID, key);

  return { spell, cost };
}

module.exports = {
  AFFINITY_TIERS,
  SCHOOLS,
  SPELLS,
  getAffinity,
  getLearnableSpells,
  getLearnedSpells,
  getSpell,
  getStartingSpells,
  grantSpell,
  learnSpell,
};
