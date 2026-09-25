"use strict";

// ============================================================
// PROFILE
// ------------------------------------------------------------
// Persistent debate history. Scores are supplied only by an
// admin verdict and stored in data/debate-profiles.json.
// ============================================================

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const judge = require("./judge");

const STATE_FILE = path.join(__dirname, "data", "debate-profiles.json");
const HISTORY_LIMIT = 15;

const cache = new Map();
let loaded = false;
let loadPromise = null;
let writeQueue = Promise.resolve();

function key(threadID, userID) {
  return `${String(threadID)}:${String(userID)}`;
}

function defaultProfile() {
  return {
    debates: 0,
    totalScore: 0,
    bestScore: 0,
    contradictionsFlagged: 0,
    lastDebateAt: 0,
    history: [],
  };
}

async function loadState() {
  if (loaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const raw = await fsp.readFile(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);

      for (const [id, value] of Object.entries(parsed || {})) {
        const base = defaultProfile();
        cache.set(id, Object.assign(base, value, {
          debates: Number(value?.debates) || 0,
          totalScore: Number(value?.totalScore) || 0,
          bestScore: Number(value?.bestScore) || 0,
          contradictionsFlagged: Number(value?.contradictionsFlagged) || 0,
          lastDebateAt: Number(value?.lastDebateAt) || 0,
          history: Array.isArray(value?.history)
            ? value.history.slice(-HISTORY_LIMIT)
            : [],
        }));
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("[debate] profile load:", error);
      }
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

function snapshot() {
  const out = {};
  for (const [id, value] of cache.entries()) {
    out[id] = value;
  }
  return out;
}

function saveState() {
  writeQueue = writeQueue.then(async () => {
    await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });

    const temp = `${STATE_FILE}.tmp`;
    await fsp.writeFile(
      temp,
      JSON.stringify(snapshot(), null, 2),
      "utf8"
    );

    await fsp.rename(temp, STATE_FILE);
  }).catch((error) => {
    console.error("[debate] profile save:", error);
  });

  return writeQueue;
}

async function getProfile(threadID, userID) {
  await loadState();

  const id = key(threadID, userID);

  if (!cache.has(id)) {
    cache.set(id, defaultProfile());
  }

  return cache.get(id);
}

async function recordDebate(threadID, userID, result) {
  await loadState();

  const id = key(threadID, userID);
  const profile = cache.get(id) || defaultProfile();
  const score = Math.max(0, Math.min(100, Number(result.score) || 0));

  profile.debates += 1;
  profile.totalScore += score;
  profile.bestScore = Math.max(profile.bestScore, score);
  profile.contradictionsFlagged +=
    Number(result.contradictionsFlagged) || 0;
  profile.lastDebateAt = Date.now();

  profile.history.push({
    at: Date.now(),
    topic: result.topic,
    position: result.position,
    style: result.style,
    score,
    grade: judge.gradeLabel(score),
    judgedBy: result.judgedBy || "an admin",
  });

  profile.history = profile.history.slice(-HISTORY_LIMIT);
  cache.set(id, profile);

  await saveState();
  return profile;
}

function rankFor(profile) {
  const debates = Number(profile?.debates) || 0;
  const avgScore =
    debates > 0
      ? Math.round(Number(profile.totalScore || 0) / debates)
      : 0;

  if (debates < 3) return "🎀 NOVICE DEBATER";
  if (debates < 10 || avgScore < 55) return "🎀 SEASONED DEBATER";
  if (debates < 25 || avgScore < 70) return "🎀 SHARP DEBATER";
  if (avgScore < 85) return "🎀 MASTER DEBATER";
  return "🎀 ECLIPSE-TIER DEBATER";
}

function formatProfile(profile) {
  const debates = Number(profile?.debates) || 0;

  if (!debates) {
    return [
      "🎀 ECLIPSE DEBATE PROFILE",
      "",
      "No judged debates yet.",
      "",
      "!debate · start your first one",
    ].join("\n");
  }

  const avgScore =
    Math.round(Number(profile.totalScore || 0) / debates);

  const lines = [
    rankFor(profile),
    "",
    `DEBATES               ${debates}`,
    `AVERAGE SCORE         ${avgScore}/100`,
    `BEST SCORE            ${Number(profile.bestScore) || 0}/100`,
    `CONTRADICTIONS FLAGGED ${Number(profile.contradictionsFlagged) || 0}`,
  ];

  if (profile.history?.length) {
    lines.push("", "Recent:");

    for (const entry of profile.history.slice(-5).reverse()) {
      lines.push(
        `• ${entry.position} · ${entry.score}/100 · ${entry.grade} · judged by ${entry.judgedBy}`
      );
    }
  }

  return lines.join("\n");
}

module.exports = {
  getProfile,
  recordDebate,
  formatProfile,
  rankFor,
};
