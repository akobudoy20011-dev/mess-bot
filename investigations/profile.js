"use strict";

const db = require("../db");

let readyPromise = null;

async function ensureTable() {
  if (!readyPromise) {
    readyPromise = db.query(`
      CREATE TABLE IF NOT EXISTS investigation_profiles (
        thread_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        games_played INTEGER NOT NULL DEFAULT 0,
        games_completed INTEGER NOT NULL DEFAULT 0,
        games_failed INTEGER NOT NULL DEFAULT 0,
        cases_solved INTEGER NOT NULL DEFAULT 0,
        perfect_cases INTEGER NOT NULL DEFAULT 0,
        evidence_found INTEGER NOT NULL DEFAULT 0,
        escape_rooms INTEGER NOT NULL DEFAULT 0,
        heists_completed INTEGER NOT NULL DEFAULT 0,
        trials_won INTEGER NOT NULL DEFAULT 0,
        lost_completed INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        fastest_solve_seconds INTEGER,
        total_xp INTEGER NOT NULL DEFAULT 0,
        total_rewards BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (thread_id, user_id)
      )
    `).catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  await readyPromise;
}

async function getProfile(threadID, userID) {
  await ensureTable();
  const { rows } = await db.query(
    `SELECT * FROM investigation_profiles WHERE thread_id = $1 AND user_id = $2`,
    [String(threadID), String(userID)]
  );
  if (rows[0]) return rows[0];

  const { rows: created } = await db.query(
    `INSERT INTO investigation_profiles (thread_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (thread_id, user_id) DO UPDATE SET thread_id = EXCLUDED.thread_id
     RETURNING *`,
    [String(threadID), String(userID)]
  );
  return created[0];
}

async function recordResult(threadID, userID, mode, result) {
  await ensureTable();
  const profile = await getProfile(threadID, userID);

  const completed = result.completed === true;
  const perfect = result.perfect === true;
  const streak = completed ? Number(profile.current_streak || 0) + 1 : 0;
  const bestStreak = Math.max(Number(profile.best_streak || 0), streak);
  const seconds = Number(result.seconds || 0);
  const oldFastest = profile.fastest_solve_seconds == null
    ? null
    : Number(profile.fastest_solve_seconds);
  const fastest = completed && seconds > 0
    ? (oldFastest == null ? seconds : Math.min(oldFastest, seconds))
    : oldFastest;

  const modeColumn = {
    case: "cases_solved",
    haunt: "escape_rooms",
    incident: "cases_solved",
    heist: "heists_completed",
    trial: "trials_won",
    lost: "lost_completed",
  }[mode];

  const safeColumn = modeColumn || "cases_solved";
  const delta = completed ? 1 : 0;

  const { rows } = await db.query(
    `
      UPDATE investigation_profiles
      SET games_completed = games_completed + $3,
          games_failed = games_failed + $4,
          cases_solved = cases_solved + $5,
          perfect_cases = perfect_cases + $6,
          evidence_found = evidence_found + $7,
          current_streak = $8,
          best_streak = $9,
          fastest_solve_seconds = $10,
          total_xp = total_xp + $11,
          total_rewards = total_rewards + $12,
          ${safeColumn} = ${safeColumn} + $13
      WHERE thread_id = $1 AND user_id = $2
      RETURNING *
    `,
    [
      String(threadID),
      String(userID),
      completed ? 1 : 0,
      completed ? 0 : 1,
      completed ? 1 : 0,
      perfect ? 1 : 0,
      Math.max(0, Number(result.evidenceFound || 0)),
      streak,
      bestStreak,
      fastest,
      Math.max(0, Number(result.xp || 0)),
      Math.max(0, Number(result.reward || 0)),
      delta,
    ]
  );

  return rows[0];
}

async function incrementPlayed(threadID, userID) {
  await ensureTable();
  await getProfile(threadID, userID);
  const { rows } = await db.query(
    `UPDATE investigation_profiles
     SET games_played = games_played + 1
     WHERE thread_id = $1 AND user_id = $2
     RETURNING *`,
    [String(threadID), String(userID)]
  );
  return rows[0];
}

function rankFor(profile) {
  const completed = Number(profile.games_completed || 0);
  const perfect = Number(profile.perfect_cases || 0);
  const evidence = Number(profile.evidence_found || 0);

  if (completed >= 50 && perfect >= 20) return "👑 GRAND INVESTIGATOR";
  if (completed >= 30 && perfect >= 10) return "🏅 MASTER DETECTIVE";
  if (completed >= 20 || evidence >= 100) return "🎖️ SENIOR DETECTIVE";
  if (completed >= 10) return "🔍 DETECTIVE";
  if (completed >= 3) return "🕵️ INVESTIGATOR";
  return "🔎 NOVICE";
}

function formatTime(seconds) {
  if (seconds == null) return "—";
  const s = Math.max(0, Number(seconds));
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatProfile(profile) {
  const gamesPlayed = Number(profile.games_played || 0);
  const completed = Number(profile.games_completed || 0);
  const failed = Number(profile.games_failed || 0);
  const total = completed + failed;

  return [
    "╭──── 🕵️ INVESTIGATOR ────╮",
    "",
    `Games played ........ ${gamesPlayed}`,
    `Games completed ..... ${completed}`,
    `Games failed ........ ${failed}`,
    `Cases solved ........ ${Number(profile.cases_solved || 0)}`,
    `Perfect cases ....... ${Number(profile.perfect_cases || 0)}`,
    `Evidence found ..... ${Number(profile.evidence_found || 0)}`,
    `Escape rooms ........ ${Number(profile.escape_rooms || 0)}`,
    `Heists completed .... ${Number(profile.heists_completed || 0)}`,
    `Trials won .......... ${Number(profile.trials_won || 0)}`,
    `Lost expeditions .... ${Number(profile.lost_completed || 0)}`,
    "",
    rankFor(profile),
    "",
    `Best streak: ${Number(profile.best_streak || 0)}`,
    `Fastest solve: ${formatTime(profile.fastest_solve_seconds)}`,
    `Success rate: ${total ? Math.round((completed / total) * 100) : 0}%`,
    `Investigation XP: ${Number(profile.total_xp || 0)}`,
    "",
    "╰──────────────────────────╯",
  ].join("\n");
}

module.exports = {
  ensureTable,
  getProfile,
  incrementPlayed,
  recordResult,
  rankFor,
  formatProfile,
};
