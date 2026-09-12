// funcommands.js
//
// Randomized "meter" style fun commands — !rizz, !aura, !iq, !simp, !clown.
// Each returns a random score plus a flavor line based on where it lands.
// Fully random per call (not tied to any real trait), purely for laughs.

function pickFlavor(score, tiers) {
  for (const tier of tiers) {
    if (score >= tier.min) return tier.text;
  }
  return tiers[tiers.length - 1].text;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// !rizz <name>
// ---------------------------------------------------------------------------
const RIZZ_TIERS = [
  { min: 90, text: "certified rizzler 🗿💯" },
  { min: 70, text: "solid game ngl 😤" },
  { min: 40, text: "mid, needs practice 😐" },
  { min: 15, text: "L rizz, take the L 💀" },
  { min: 0, text: "negative rizz, apologize to your ancestors 🪦" },
];

function getRizz(name) {
  const score = randomInt(0, 100);
  return {
    name,
    score,
    text: `${name}'s rizz meter: ${score}% — ${pickFlavor(score, RIZZ_TIERS)}`,
  };
}

// ---------------------------------------------------------------------------
// !aura <name>
// ---------------------------------------------------------------------------
const AURA_TIERS = [
  { min: 5000, text: "unspoken final boss aura ✨👑" },
  { min: 1000, text: "certified aura farmer 🌾✨" },
  { min: 0, text: "average aura, mid tier 😐" },
  { min: -1000, text: "aura got demoted 📉" },
  { min: -Infinity, text: "negative aura black hole, seek help 🕳️" },
];

function getAura(name) {
  const score = randomInt(-2000, 10000);
  return {
    name,
    score,
    text: `${name}'s aura: ${score} points — ${pickFlavor(score, AURA_TIERS)}`,
  };
}

// ---------------------------------------------------------------------------
// !iq <name>
// ---------------------------------------------------------------------------
const IQ_TIERS = [
  { min: 160, text: "certified genius, go outside though 🧠" },
  { min: 100, text: "actually kinda smart ngl 🤓" },
  { min: 70, text: "average human brain function 😐" },
  { min: 40, text: "questionable decision-making detected 💀" },
  { min: 0, text: "iq of a potato, and the potato is winning 🥔" },
];

function getIQ(name) {
  const score = randomInt(0, 200);
  return {
    name,
    score,
    text: `${name}'s IQ: ${score} — ${pickFlavor(score, IQ_TIERS)}`,
  };
}

// ---------------------------------------------------------------------------
// !simp <name>
// ---------------------------------------------------------------------------
const SIMP_TIERS = [
  { min: 90, text: "certified simp lord, hand over the wallet 💸" },
  { min: 60, text: "simping detected, no cap 😭" },
  { min: 30, text: "mild simp tendencies 👀" },
  { min: 0, text: "zero simp energy, respect 🗿" },
];

function getSimp(name) {
  const score = randomInt(0, 100);
  return {
    name,
    score,
    text: `${name}'s simp level: ${score}% — ${pickFlavor(score, SIMP_TIERS)}`,
  };
}

// ---------------------------------------------------------------------------
// !clown <name>
// ---------------------------------------------------------------------------
const CLOWN_TIERS = [
  { min: 90, text: "full circus, send help 🤡🎪" },
  { min: 60, text: "certified clown behavior 🤡" },
  { min: 30, text: "mild clownery detected 🎈" },
  { min: 0, text: "surprisingly not a clown today 🙂" },
];

function getClown(name) {
  const score = randomInt(0, 100);
  return {
    name,
    score,
    text: `${name}'s clown meter: ${score}% — ${pickFlavor(score, CLOWN_TIERS)}`,
  };
}

module.exports = { getRizz, getAura, getIQ, getSimp, getClown };
