// ============================================================================
// ECLIPSE RPG — Utilities
// ============================================================================

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function statusBar(
  value,
  maximum,
  length = 10,
  fill = "█",
  empty = "░"
) {
  const max = Math.max(1, Number(maximum) || 1);
  const current = clamp(value, 0, max);
  const filled = Math.round((current / max) * length);

  return `${fill.repeat(filled)}${empty.repeat(length - filled)}`;
}

function statLine(icon, label, value, maximum, length = 10) {
  return `${icon} ${label} ${statusBar(
    value,
    maximum,
    length
  )} ${formatNumber(value)}/${formatNumber(maximum)}`;
}

// ============================================================================
// ECLIPSE UI
//
// Designed for Messenger's narrow text layout:
//
// ╭─────────────────────────╮
// │        🌑 ECLIPSE       │
// ╰─────────────────────────╯
//
// Content
//
// ╭─────────────────────────╮
// │       END OF PANEL      │
// ╰─────────────────────────╯
// ============================================================================

const BOX_WIDTH = 25;
const BOX_BAR = "─".repeat(BOX_WIDTH);

function centerTitle(title) {
  const clean = String(title || "").trim();

  if (!clean) {
    return " ".repeat(BOX_WIDTH);
  }

  if (clean.length >= BOX_WIDTH) {
    return clean.slice(0, BOX_WIDTH);
  }

  const totalPadding = BOX_WIDTH - clean.length;
  const leftPadding = Math.floor(totalPadding / 2);

  return (
    " ".repeat(leftPadding) +
    clean +
    " ".repeat(totalPadding - leftPadding)
  );
}

function box(title, lines = []) {
  const content = Array.isArray(lines)
    ? lines
    : [lines];

  return [
    `╭${BOX_BAR}╮`,
    `│${centerTitle(title)}│`,
    `╰${BOX_BAR}╯`,
    "",
    ...content,
    "",
    `╭${BOX_BAR}╮`,
    `│${centerTitle("🌑 ECLIPSE RPG")}│`,
    `╰${BOX_BAR}╯`,
  ].join("\n");
}

function errorBox(message) {
  return box(
    "❌ SYSTEM",
    Array.isArray(message) ? message : [message]
  );
}

// ============================================================================
// NUMBER / TIME HELPERS
// ============================================================================

function parsePositiveInt(value, fallback = 0) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(
    0,
    Math.ceil(Number(milliseconds || 0) / 1_000)
  );

  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainder}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainder}s`;
  }

  return `${remainder}s`;
}

function formatUtc(timestamp) {
  return new Date(Number(timestamp)).toLocaleString("en-US", {
    timeZone: "UTC",
    hour12: false,
  });
}

// ============================================================================
// ARMY / RANDOM HELPERS
// ============================================================================

function totalUnits(army) {
  return [
    "infantry",
    "archers",
    "spearmen",
    "cavalry",
    "heavy_swordsmen",
    "shielders",
    "mages",
    "assassins",
  ].reduce(
    (total, unit) => total + Number(army?.[unit] || 0),
    0
  );
}

function randomInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  box,
  clamp,
  errorBox,
  formatDuration,
  formatNumber,
  formatUtc,
  normalizeKey,
  parsePositiveInt,
  randomInt,
  statLine,
  statusBar,
  totalUnits,
};
