"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const db = require("./db");

const QUESTIONS = require("./exam-questions");

const EXAM_TOTAL_QUESTIONS = 20;
const EXAM_TIME_LIMIT_MS = 5 * 60 * 1000;
const EXAM_PASS_PERCENT = 70;
const EXAM_RECENT_LIMIT = 80;

const STATE_FILE = path.join(__dirname, "data", "exam-state.json");

const sessions = new Map();
const timers = new Map();
const stateCache = new Map();
let stateLoaded = false;
let stateLoadPromise = null;
let stateWriteQueue = Promise.resolve();

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function key(threadID, userID) {
  return `${String(threadID)}:${String(userID)}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^(?:the\s+)?answer\s*(?:is|:)?\s*/i, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

function parseAnswer(value) {
  const match = normalize(value).match(/^(?:option|choice)?\s*([abcd])(?:[).]\s*)?$/i);
  if (!match) return -1;
  return ["a", "b", "c", "d"].indexOf(match[1].toLowerCase());
}

function sendMessage(api, threadID, text) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, info) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve(info || null);
    };

    try {
      api.sendMessage(text, threadID, (err, info) => finish(err, info));
    } catch (err) {
      finish(err);
    }
  });
}

function editMessage(api, text, messageID) {
  if (!messageID || typeof api.editMessage !== "function") return Promise.resolve(false);

  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => finish(new Error("edit timeout")), 5000);

    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve(!err);
    }

    try {
      api.editMessage(text, messageID, (err) => finish(err));
    } catch (err) {
      finish(err);
    }
  });
}

async function editWithRetry(api, text, messageID) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await editMessage(api, text, messageID)) return true;
    if (attempt < 2) await sleep(400);
  }
  return false;
}

async function safeSend(api, threadID, text) {
  try {
    return await sendMessage(api, threadID, text);
  } catch (error) {
    console.error("[exam] send:", error);
    return null;
  }
}

function header(subtitle = "EXAMINATION") {
  return [
    "╭──────────────────────────────╮",
    "          ♡ ECLIPSE ♡",
    `             🎓 EXAM`,
    "╰──────────────────────────────╯",
    subtitle ? `           ${subtitle}` : "",
  ].filter(Boolean).join("\n");
}

function divider() {
  return "┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄";
}

function getPlayerState(id) {
  if (!stateCache.has(id)) {
    stateCache.set(id, {
      recent: [],
      exams: 0,
      passed: 0,
      bestScore: 0,
      bestPercent: 0,
      questionsAnswered: 0,
      correctAnswers: 0,
      lastExamAt: 0,
    });
  }
  return stateCache.get(id);
}

async function loadState() {
  if (stateLoaded) return;
  if (stateLoadPromise) return stateLoadPromise;

  stateLoadPromise = (async () => {
    try {
      const raw = await fsp.readFile(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      for (const [id, value] of Object.entries(parsed || {})) {
        stateCache.set(id, {
          recent: Array.isArray(value.recent) ? value.recent.slice(-EXAM_RECENT_LIMIT) : [],
          exams: Number(value.exams) || 0,
          passed: Number(value.passed) || 0,
          bestScore: Number(value.bestScore) || 0,
          bestPercent: Number(value.bestPercent) || 0,
          questionsAnswered: Number(value.questionsAnswered) || 0,
          correctAnswers: Number(value.correctAnswers) || 0,
          lastExamAt: Number(value.lastExamAt) || 0,
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") console.error("[exam] state load:", error);
    } finally {
      stateLoaded = true;
      stateLoadPromise = null;
    }
  })();

  return stateLoadPromise;
}

function snapshotState() {
  const out = {};
  for (const [id, value] of stateCache.entries()) out[id] = value;
  return out;
}

function saveState() {
  stateWriteQueue = stateWriteQueue.then(async () => {
    await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });
    const temp = `${STATE_FILE}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(snapshotState(), null, 2), "utf8");
    await fsp.rename(temp, STATE_FILE);
  }).catch((error) => {
    console.error("[exam] state save:", error);
  });

  return stateWriteQueue;
}

function subjectForMode(mode) {
  const aliases = {
    math: "Mathematics",
    mathematics: "Mathematics",
    english: "English",
    physics: "Physics",
    chemistry: "Chemistry",
    chem: "Chemistry",
    biology: "Biology",
    bio: "Biology",
    logic: "Logic",
    geography: "Geography",
    geo: "Geography",
  };
  return aliases[String(mode || "").toLowerCase()] || null;
}

function selectQuestions(threadID, userID, mode = "mixed") {
  const state = getPlayerState(key(threadID, userID));
  const recent = new Set(state.recent);
  const normalized = String(mode || "mixed").toLowerCase();
  const subject = subjectForMode(normalized);

  let pool = QUESTIONS.filter((q) => !recent.has(q.id));

  if (normalized === "science") {
    pool = pool.filter((q) => ["Physics", "Chemistry", "Biology"].includes(q.subject));
  } else if (subject) {
    pool = pool.filter((q) => q.subject === subject);
  }

  // If a track has fewer than 20 unseen questions, recycle the oldest questions
  // from that same track rather than silently switching the player to another subject.
  if (pool.length < EXAM_TOTAL_QUESTIONS) {
    if (normalized === "science") {
      pool = QUESTIONS.filter((q) => ["Physics", "Chemistry", "Biology"].includes(q.subject));
    } else if (subject) {
      pool = QUESTIONS.filter((q) => q.subject === subject);
    } else {
      pool = QUESTIONS.slice();
    }
  }

  return shuffle(pool).slice(0, EXAM_TOTAL_QUESTIONS);
}

function rememberQuestions(threadID, userID, questions) {
  const state = getPlayerState(key(threadID, userID));
  state.recent = [...state.recent, ...questions.map((q) => q.id)].slice(-EXAM_RECENT_LIMIT);
}

function questionText(session) {
  const q = session.questions[session.index];
  const remaining = Math.max(0, session.timeLimitMs - (Date.now() - session.startedAt));
  const seconds = Math.ceil(remaining / 1000);

  return [
    header(`QUESTION ${session.index + 1} / ${session.questions.length}`),
    "",
    `subject · ${q.subject} · ${q.difficulty || "Intermediate"}`,
    "",
    q.q,
    "",
    ...q.options.map((option, i) => `♡ ${["A", "B", "C", "D"][i]}. ${option}`),
    "",
    divider(),
    `⏳ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`,
    "",
    "answer with !answer A, !answer B, !answer C or !answer D",
  ].join("\n");
}

function answeredText(session, questionIndex, correct, chosenLetter) {
  const q = session.questions[questionIndex];
  return [
    "╭──────────────────────────────╮",
    "          ⭐ ANSWERED ⭐",
    "╰──────────────────────────────╯",
    "",
    `question ${questionIndex + 1} · ${q.subject}`,
    correct ? "♡ correct answer recorded" : "୨୧ answer recorded",
    `your answer · ${chosenLetter}`,
    "",
    "the question has been hidden.",
  ].join("\n");
}

function setSession(threadID, userID, session) {
  const k = key(threadID, userID);
  sessions.set(k, session);
  clearTimeout(timers.get(k));
  timers.set(k, setTimeout(() => {
    const current = sessions.get(k);
    if (current === session) sessions.delete(k);
    timers.delete(k);
  }, EXAM_TIME_LIMIT_MS + 10000));
}

function getSession(threadID, userID) {
  return sessions.get(key(threadID, userID)) || null;
}

function clearSession(threadID, userID) {
  const k = key(threadID, userID);
  clearTimeout(timers.get(k));
  timers.delete(k);
  sessions.delete(k);
}

async function finishExam(api, event, session, timedOut = false) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);
  if (getSession(threadID, userID) !== session) return;

  clearSession(threadID, userID);

  const total = session.questions.length;
  const score = Number(session.score) || 0;
  const answered = Number(session.answered) || 0;
  const percent = Math.round((score / total) * 100);
  const passed = !timedOut && percent >= EXAM_PASS_PERCENT;
  const grade = percent >= 95 ? "S" : percent >= 90 ? "A+" : percent >= 85 ? "A" : percent >= 80 ? "B+" : percent >= 75 ? "B" : percent >= 70 ? "C" : percent >= 60 ? "D" : "F";

  const state = getPlayerState(key(threadID, userID));
  state.exams += 1;
  if (passed) state.passed += 1;
  state.bestScore = Math.max(state.bestScore, score);
  state.bestPercent = Math.max(state.bestPercent, percent);
  state.questionsAnswered += answered;
  state.correctAnswers += score;
  state.lastExamAt = Date.now();
  await saveState();

  let xp = 0;
  let coins = 0;
  try {
    xp = passed ? 100 : -50;
    if (passed) coins = 250;
    await db.addXP(threadID, userID, xp);
    if (coins) await db.addBalance(threadID, userID, coins);
  } catch (error) {
    console.error("[exam] reward:", error);
    xp = 0;
    coins = 0;
  }

  let balance = "0";
  try {
    const user = await db.getUser(threadID, userID);
    balance = formatNumber(user?.balance ?? 0);
  } catch (error) {
    console.error("[exam] balance:", error);
  }

  await safeSend(api, threadID, [
    header("RESULTS"),
    "",
    timedOut ? "⏳ TIME EXPIRED" : passed ? "♡ EXAM PASSED" : "୨୧ EXAM FAILED",
    "",
    `score · ${score} / ${total}`,
    `answered · ${answered} / ${total}`,
    `accuracy · ${percent}%`,
    `grade · ${grade}`,
    "",
    `pass mark · ${EXAM_PASS_PERCENT}%`,
    "",
    `♡ XP       ${xp >= 0 ? "+" : ""}${formatNumber(xp)}`,
    `♡ Coins    ${coins ? "+" + formatNumber(coins) : "0"}`,
    "",
    `♡ balance  ${balance} coins`,
    "",
    `exams · ${state.exams}   ·   passed · ${state.passed}`,
  ].join("\n"));
}

async function startExam(api, event, mode) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);
  const k = key(threadID, userID);

  if (sessions.has(k)) {
    await safeSend(api, threadID, "♡ you already have an examination open. finish it first.");
    return true;
  }

  await loadState();
  const questions = selectQuestions(threadID, userID, mode);
  rememberQuestions(threadID, userID, questions);
  await saveState();

  const session = {
    type: "exam",
    mode,
    questions,
    index: 0,
    score: 0,
    answered: 0,
    startedAt: Date.now(),
    timeLimitMs: EXAM_TIME_LIMIT_MS,
    messageID: null,
  };

  try {
    const message = await sendMessage(api, threadID, questionText(session));
    if (!message?.messageID) return true;

    session.messageID = message.messageID;
    setSession(threadID, userID, session);

    setTimeout(async () => {
      const current = getSession(threadID, userID);
      if (current !== session) return;
      if (Date.now() - session.startedAt < EXAM_TIME_LIMIT_MS) return;
      await finishExam(api, event, session, true);
    }, EXAM_TIME_LIMIT_MS + 250);
  } catch (error) {
    console.error("[exam] start:", error);
  }

  return true;
}

async function handleExam(api, event, args = []) {
  const requested = String(args?.[0] || "").trim().toLowerCase();

  if (["help", "rules"].includes(requested)) {
    await safeSend(api, String(event.threadID), [
      header(),
      "",
      "20 questions · 5 minutes · pass mark 70%",
      "",
      "gaokao-inspired format · original English-language questions",
      "mathematics · English · physics · chemistry · biology · logic · geography",
      "",
      "!exam · mixed examination",
      "!exam math · mathematics",
      "!exam science · physics + chemistry + biology",
      "!exam english · English",
      "!exam physics · Physics",
      "!exam chemistry · Chemistry",
      "!exam biology · Biology",
      "!exam logic · Logic",
      "!exam geography · Geography",
      "!exam stats · your examination record",
      "",
      "♡ answer with !answer A / B / C / D",
      "♡ answered questions are edited into ⭐ ANSWERED ⭐",
    ].join("\n"));
    return true;
  }

  if (requested === "stats" || requested === "profile" || requested === "record") {
    await loadState();
    const state = getPlayerState(key(event.threadID, event.senderID));
    const accuracy = state.questionsAnswered
      ? Math.round((state.correctAnswers / state.questionsAnswered) * 100)
      : 0;

    await safeSend(api, String(event.threadID), [
      header("EXAM RECORD"),
      "",
      `examinations · ${state.exams}`,
      `passed · ${state.passed}`,
      `best score · ${state.bestScore} / ${EXAM_TOTAL_QUESTIONS}`,
      `best accuracy · ${state.bestPercent}%`,
      `questions answered · ${state.questionsAnswered}`,
      `overall accuracy · ${accuracy}%`,
      "",
      `recent memory · ${state.recent.length} / ${EXAM_RECENT_LIMIT}`,
    ].join("\n"));
    return true;
  }

  return startExam(api, event, requested || "mixed");
}

async function handleExamResponse(api, event, responseText, originalText) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);
  const session = getSession(threadID, userID);
  if (!session) return false;

  const answer = String(originalText || responseText || "")
    .replace(/^!answer\s*/i, "")
    .trim();
  const chosenIndex = parseAnswer(answer);

  if (chosenIndex < 0) {
    await safeSend(api, threadID, "🎓 EXAM\n\nplease answer with A, B, C or D.\nexample: !answer B");
    return true;
  }

  if (Date.now() - session.startedAt >= session.timeLimitMs) {
    await finishExam(api, event, session, true);
    return true;
  }

  const questionIndex = session.index;
  const question = session.questions[questionIndex];
  const correct = chosenIndex === question.answer;
  session.answered += 1;
  if (correct) session.score += 1;

  await editWithRetry(api, answeredText(session, questionIndex, correct, ["A", "B", "C", "D"][chosenIndex]), session.messageID);

  session.index += 1;
  if (session.index >= session.questions.length) {
    await finishExam(api, event, session, false);
    return true;
  }

  try {
    const next = await sendMessage(api, threadID, questionText(session));
    if (!next?.messageID) {
      await finishExam(api, event, session, true);
      return true;
    }
    session.messageID = next.messageID;
    setSession(threadID, userID, session);
  } catch (error) {
    console.error("[exam] next question:", error);
    await finishExam(api, event, session, true);
  }

  return true;
}

function getExamSession(threadID, userID) {
  return getSession(threadID, userID);
}

module.exports = {
  handleExam,
  handleExamResponse,
  getExamSession,
};
