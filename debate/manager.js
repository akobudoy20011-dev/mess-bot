"use strict";

// ============================================================
// MANAGER
// ------------------------------------------------------------
// Debate state machine:
// opening -> rebuttal -> cross1 -> cross2 -> closing
// -> awaiting_judgment -> done
//
// There is NO automatic debate scoring. An admin decides the
// final score with !debate judge.
// ============================================================

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const db = require("../db");
const judge = require("./judge");
const profile = require("./profile");
const TOPICS = require("./topics.json");

const STATE_FILE = path.join(__dirname, "data", "debate-state.json");

const ROUND_TIME_LIMIT_MS = 5 * 60 * 1000;
const TIMER_BUFFER_MS = 15 * 1000;
const PENDING_JUDGMENT_TIMEOUT_MS = 48 * 60 * 60 * 1000;
const MIN_WORDS = 4;

const sessions = new Map();
const timers = new Map();

let saveQueue = Promise.resolve();
let debateApi = null;
let staleSweepTimer = null;

const STYLES = {
  provocateur: {
    label: "THE PROVOCATEUR",
    rebuttals: [
      'Let\'s be honest — your position on "{topic}" sounds comfortable in theory, but it collapses when real consequences are on the line.',
      "You're arguing the safe answer. The safe answer is usually the one nobody has actually stress-tested.",
    ],
    questions: [
      "If you're so confident, why does your position only work as long as nothing goes wrong?",
      "Would you still hold this position if the consequences landed on you personally, and not just in theory?",
      "Isn't it easier to defend this position from a debate than it would be to defend it to someone actually affected by it?",
      "What would it take — specifically — to make you admit your position is wrong?",
    ],
  },

  diplomat: {
    label: "THE DIPLOMAT",
    rebuttals: [
      'There\'s real merit in parts of what you\'re saying about "{topic}" — but treating this as strictly one-sided ignores the middle ground.',
      'I don\'t think this is really a binary question. Reasonable people can land in the middle on "{topic}".',
    ],
    questions: [
      "Would you accept a compromise version of your position, or does it only work in its most extreme form?",
      "Is there a version of the opposing view you'd concede has a valid point?",
      "If reasonable people land somewhere in the middle, what does that suggest about an absolute stance?",
      "Where exactly is the line where your position would need to bend?",
    ],
  },

  philosopher: {
    label: "THE PHILOSOPHER",
    rebuttals: [
      "Before we go further — what is the underlying principle that makes your position true, and why should anyone accept it?",
      'Your argument assumes something more fundamental than "{topic}" itself. Let\'s examine that assumption directly.',
    ],
    questions: [
      "What principle is your entire position actually resting on?",
      "Why should that principle be accepted as true in the first place?",
      "Does that same principle hold in a case where it clearly produces a bad outcome?",
      "If the principle only applies selectively, is it really a principle at all?",
    ],
  },

  manipulator: {
    label: "THE MANIPULATOR",
    rebuttals: [
      "Your argument sounds persuasive, but sounding persuasive and being logically sound are two very different things. Which one is this?",
      "You are relying heavily on framing. Strip the framing away and defend the actual claim.",
    ],
    questions: [
      "Can you defend your position without relying on emotional framing?",
      "If your position is really that solid, why does it depend so heavily on how the issue is presented?",
      "What important downside does your own side have to answer directly?",
      "Can you defend your position using its weakest reasonable interpretation of the opposing view?",
    ],
  },

  analyst: {
    label: "THE ANALYST",
    rebuttals: [
      'The pattern in situations resembling "{topic}" rarely supports a position this absolute — variance alone should make you less certain than you sound.',
      "Correlation isn't causation. What you've described as an obvious link needs an actual causal mechanism.",
    ],
    questions: [
      "What is the actual causal mechanism connecting your reasoning to your conclusion?",
      "How would your position change if the failure rate were significantly higher than you're assuming?",
      "What specific evidence would falsify your position, if any exists?",
      "Define the key term your argument depends on — precisely.",
    ],
  },

  devils_advocate: {
    label: "THE DEVIL'S ADVOCATE",
    rebuttals: [
      "Let's flip the premise entirely: assume the opposite of your position is true by default. What forces us back to your side?",
      "You're treating your starting assumption as settled. It isn't — walk me through why it should be accepted.",
    ],
    questions: [
      "If we reversed the default assumption behind your position, what actually breaks?",
      "Does your argument survive if its premise is challenged instead of its conclusion?",
      "What does your position require us to simply take on faith?",
      "If your strongest supporting point were removed entirely, would your position still stand?",
    ],
  },
};

const STYLE_KEYS = Object.keys(STYLES);

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list) {
  return list[randInt(0, list.length - 1)];
}

function key(threadID, userID) {
  return `${String(threadID)}:${String(userID)}`;
}

function isAdmin(userID) {
  return (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(String(userID));
}

function send(api, threadID, text) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (error, info) => {
      if (done) return;
      done = true;
      if (error) reject(error);
      else resolve(info || null);
    };

    try {
      api.sendMessage(text, String(threadID), (error, info) => {
        finish(error, info);
      });
    } catch (error) {
      finish(error);
    }
  });
}

async function safeSend(api, threadID, text) {
  try {
    return await send(api, threadID, text);
  } catch (error) {
    console.error("[debate] send:", error);
    return null;
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function header() {
  return [
    "╭────── 🎀 ECLIPSE DEBATE ──────╮",
    "          DEBATE INITIATED",
    "╰───────────────────────────────╯",
  ].join("\n");
}

function buildRebuttalArgument(session) {
  const template = pick(STYLES[session.style].rebuttals);
  return template.replace(/\{topic\}/g, session.topic.replace(/\?$/, ""));
}

function buildPressureQuestion(session) {
  const pool = STYLES[session.style].questions;
  const unused = pool.filter(
    (_, index) => !session.usedQuestionIndices.includes(index)
  );

  const source = unused.length ? unused : pool;
  const chosen = pick(source);
  const index = pool.indexOf(chosen);

  if (!session.usedQuestionIndices.includes(index)) {
    session.usedQuestionIndices.push(index);
  }

  return chosen;
}

function getSession(threadID, userID) {
  return sessions.get(key(threadID, userID)) || null;
}

function armTimer(session) {
  const sessionKey = key(session.threadID, session.userID);

  clearTimeout(timers.get(sessionKey));

  if (session.round === "awaiting_judgment") {
    timers.delete(sessionKey);
    return;
  }

  const remaining =
    Math.max(
      0,
      Number(session.timeLimitMs || ROUND_TIME_LIMIT_MS) -
        (Date.now() - Number(session.roundStartedAt || Date.now()))
    );

  timers.set(
    sessionKey,
    setTimeout(() => {
      timers.delete(sessionKey);
      handleTimeout(session).catch((error) => {
        console.error("[debate] timeout handling:", error);
      });
    }, remaining + TIMER_BUFFER_MS)
  );
}

function clearSessionTimer(session) {
  const sessionKey = key(session.threadID, session.userID);
  clearTimeout(timers.get(sessionKey));
  timers.delete(sessionKey);
}

function persistSessions() {
  saveQueue = saveQueue.then(async () => {
    const out = {};

    for (const [id, session] of sessions.entries()) {
      out[id] = {
        threadID: session.threadID,
        userID: session.userID,
        topicId: session.topicId,
        topic: session.topic,
        position: session.position,
        style: session.style,
        styleLabel: session.styleLabel,
        round: session.round,
        roundStartedAt: session.roundStartedAt,
        timeLimitMs: session.timeLimitMs,
        transcript: session.transcript,
        playerTexts: session.playerTexts,
        contradictionFlags: session.contradictionFlags,
        pendingRebuttalArgument: session.pendingRebuttalArgument,
        pendingQuestion: session.pendingQuestion,
        usedQuestionIndices: session.usedQuestionIndices,
        startedAt: session.startedAt,
        closedAt: session.closedAt || null,
      };
    }

    await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });

    const temp = `${STATE_FILE}.tmp`;
    await fsp.writeFile(
      temp,
      JSON.stringify(out, null, 2),
      "utf8"
    );

    await fsp.rename(temp, STATE_FILE);
  }).catch((error) => {
    console.error("[debate] state save:", error);
  });

  return saveQueue;
}

function setSession(session) {
  sessions.set(key(session.threadID, session.userID), session);
  armTimer(session);
  void persistSessions();
}

function removeSession(session) {
  clearSessionTimer(session);
  sessions.delete(key(session.threadID, session.userID));
  void persistSessions();
}

function hintText(session = null) {
  if (!session) {
    return [
      "🎀 DEBATE TIPS",
      "",
      "♡ opening — define your position and your core reason.",
      "♡ rebuttal — answer the opponent instead of repeating yourself.",
      "♡ cross-exam — answer the exact question before expanding.",
      "♡ closing — tie your strongest points together.",
      "",
      "Use concrete reasoning, define important terms,",
      "and avoid absolute claims unless you can defend them.",
    ].join("\n");
  }

  return [
    "🎀 DEBATE HINT",
    "",
    "Keep your answer tied to the exact question.",
    "State your claim, give the reason, then explain",
    "why that reason survives the strongest objection.",
  ].join("\n");
}

function roundPromptText(session) {
  const elapsed = Math.max(
    0,
    Date.now() - Number(session.roundStartedAt || Date.now())
  );

  const seconds = Math.max(
    0,
    Math.ceil(
      (Number(session.timeLimitMs || ROUND_TIME_LIMIT_MS) - elapsed) /
        1000
    )
  );

  const timerText =
    `⏳ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`;

  switch (session.round) {
    case "opening":
      return [
        header(),
        "",
        "TOPIC",
        `"${session.topic}"`,
        "",
        "YOUR POSITION",
        session.position,
        "",
        "OPPONENT",
        session.styleLabel,
        "",
        "────────────────────────────",
        "",
        "ROUND 1 · OPENING",
        "",
        "Present your opening argument.",
        timerText,
        "",
        "!debate submit <argument>",
        "!debate hint",
        "",
        "╰───────────────────────────────╯",
      ].join("\n");

    case "rebuttal":
      return [
        "OPPONENT:",
        "",
        `"${session.pendingRebuttalArgument}"`,
        "",
        "────────────────────",
        "",
        "ROUND 2 · REBUTTAL",
        "",
        "Respond directly to the opponent.",
        timerText,
        "",
        "!debate submit <response>",
      ].join("\n");

    case "cross1":
      return [
        `${session.styleLabel}:`,
        "",
        "QUESTION 1",
        "",
        session.pendingQuestion,
        "",
        timerText,
        "",
        "!debate answer <response>",
      ].join("\n");

    case "cross2":
      return [
        `${session.styleLabel}:`,
        "",
        "QUESTION 2",
        "",
        session.pendingQuestion,
        "",
        timerText,
        "",
        "!debate answer <response>",
      ].join("\n");

    case "closing":
      return [
        "ROUND 4 · CLOSING",
        "",
        "Your final statement should explain:",
        "",
        "• what your position is",
        "• why the opposing argument fails",
        "• what principle your argument rests upon",
        "",
        timerText,
        "",
        "!debate submit <closing>",
      ].join("\n");

    case "awaiting_judgment":
      return judge.buildCaseFile(session);

    default:
      return "♡ this debate has ended.";
  }
}

async function startDebate(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (getSession(threadID, userID)) {
    await safeSend(
      api,
      threadID,
      "🎀 You already have a debate open. use !debate status."
    );
    return true;
  }

  if (!Array.isArray(TOPICS) || !TOPICS.length) {
    await safeSend(
      api,
      threadID,
      "🎀 the debate topic library is empty right now."
    );
    return true;
  }

  const topicEntry = pick(TOPICS);
  const position = pick(topicEntry.positions);
  const style = pick(STYLE_KEYS);
  const now = Date.now();

  const session = {
    threadID,
    userID,
    topicId: topicEntry.id,
    topic: topicEntry.topic,
    position,
    style,
    styleLabel: STYLES[style].label,
    round: "opening",
    roundStartedAt: now,
    timeLimitMs: ROUND_TIME_LIMIT_MS,
    transcript: [],
    playerTexts: [],
    contradictionFlags: [],
    pendingRebuttalArgument: null,
    pendingQuestion: null,
    usedQuestionIndices: [],
    startedAt: now,
    closedAt: null,
  };

  setSession(session);
  await safeSend(api, threadID, roundPromptText(session));

  return true;
}

function logContradictionIfAny(session, round, text) {
  const found = judge.detectContradiction(session.playerTexts, text);

  if (found) {
    session.contradictionFlags.push({
      ...found,
      round,
    });
  }
}

async function handleSubmit(api, event, text) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);
  const session = getSession(threadID, userID);

  if (!session) return false;

  if (!["opening", "rebuttal", "closing"].includes(session.round)) {
    await safeSend(
      api,
      threadID,
      session.round === "awaiting_judgment"
        ? "🎀 this debate is closed and waiting on an admin's verdict."
        : "🎀 that's not what's open right now. use !debate answer for cross-examination."
    );
    return true;
  }

  if (judge.wordCount(text) < MIN_WORDS) {
    await safeSend(
      api,
      threadID,
      `🎀 that's too short to count as an argument. use at least ${MIN_WORDS} words.`
    );
    return true;
  }

  if (
    Date.now() - Number(session.roundStartedAt || 0) >=
    Number(session.timeLimitMs || ROUND_TIME_LIMIT_MS)
  ) {
    await handleTimeout(session);
    return true;
  }

  session.transcript.push({
    round: session.round,
    role: "player",
    text: String(text).trim(),
  });

  logContradictionIfAny(session, session.round, text);

  session.playerTexts.push({
    round: session.round,
    text: String(text).trim(),
  });

  await advanceAfterRound(api, event, session);
  return true;
}

async function handleAnswer(api, event, text) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);
  const session = getSession(threadID, userID);

  if (!session) return false;

  if (!["cross1", "cross2"].includes(session.round)) {
    await safeSend(
      api,
      threadID,
      session.round === "awaiting_judgment"
        ? "🎀 this debate is closed and waiting on an admin's verdict."
        : "🎀 nothing is asking you a question right now. use !debate submit."
    );
    return true;
  }

  if (judge.wordCount(text) < 2) {
    await safeSend(
      api,
      threadID,
      "🎀 that's not an answer. give the question at least two words."
    );
    return true;
  }

  if (
    Date.now() - Number(session.roundStartedAt || 0) >=
    Number(session.timeLimitMs || ROUND_TIME_LIMIT_MS)
  ) {
    await handleTimeout(session);
    return true;
  }

  session.transcript.push({
    round: session.round,
    role: "player",
    text: String(text).trim(),
  });

  logContradictionIfAny(session, session.round, text);

  session.playerTexts.push({
    round: session.round,
    text: String(text).trim(),
  });

  await advanceAfterRound(api, event, session);
  return true;
}

async function advanceAfterRound(api, event, session) {
  const threadID = session.threadID;

  if (session.round === "opening") {
    session.pendingRebuttalArgument = buildRebuttalArgument(session);
    session.transcript.push({
      round: "rebuttal",
      role: "opponent",
      text: session.pendingRebuttalArgument,
    });
    session.round = "rebuttal";
  } else if (session.round === "rebuttal") {
    session.pendingQuestion = buildPressureQuestion(session);
    session.transcript.push({
      round: "cross1",
      role: "opponent",
      text: session.pendingQuestion,
    });
    session.round = "cross1";
  } else if (session.round === "cross1") {
    session.pendingQuestion = buildPressureQuestion(session);
    session.transcript.push({
      round: "cross2",
      role: "opponent",
      text: session.pendingQuestion,
    });
    session.round = "cross2";
  } else if (session.round === "cross2") {
    session.round = "closing";
  } else if (session.round === "closing") {
    await closeForJudgment(api, event, session);
    return;
  }

  session.roundStartedAt = Date.now();
  setSession(session);
  await safeSend(api, threadID, roundPromptText(session));
}

async function closeForJudgment(api, event, session) {
  session.round = "awaiting_judgment";
  session.closedAt = Date.now();

  setSession(session);

  await safeSend(
    api,
    session.threadID,
    judge.buildCaseFile(session)
  );
}

async function handleTimeout(session) {
  const current = getSession(session.threadID, session.userID);

  if (!current || current !== session) return;
  if (session.round === "awaiting_judgment") return;

  if (
    Date.now() - Number(session.roundStartedAt || 0) <
    Number(session.timeLimitMs || ROUND_TIME_LIMIT_MS)
  ) {
    armTimer(session);
    return;
  }

  if (!debateApi) return;

  const api = debateApi;
  const threadID = session.threadID;

  if (session.round === "opening") {
    removeSession(session);

    await safeSend(
      api,
      threadID,
      "🕯️ the debate expired. no opening argument was submitted."
    );
    return;
  }

  session.transcript.push({
    round: session.round,
    role: "system",
    text: "(no response — round timed out)",
  });

  await safeSend(
    api,
    threadID,
    "⏳ time expired on that round. moving on."
  );

  const fakeEvent = {
    threadID,
    senderID: session.userID,
  };

  await advanceAfterRound(api, fakeEvent, session);
}

function sweepStalePending() {
  const now = Date.now();
  const stale = [];

  for (const session of sessions.values()) {
    if (
      session.round === "awaiting_judgment" &&
      session.closedAt &&
      now - session.closedAt > PENDING_JUDGMENT_TIMEOUT_MS
    ) {
      stale.push(session);
    }
  }

  for (const session of stale) {
    removeSession(session);

    if (debateApi) {
      void safeSend(
        debateApi,
        session.threadID,
        `🎀 the case file for "${session.topic}" expired unjudged after 48 hours.`
      );
    }
  }
}

function pendingInThread(threadID) {
  const list = [];

  for (const session of sessions.values()) {
    if (
      session.round === "awaiting_judgment" &&
      session.threadID === String(threadID)
    ) {
      list.push(session);
    }
  }

  return list.sort(
    (a, b) => Number(a.closedAt || 0) - Number(b.closedAt || 0)
  );
}

function pendingAll() {
  return Array.from(sessions.values())
    .filter((session) => session.round === "awaiting_judgment")
    .sort(
      (a, b) => Number(a.closedAt || 0) - Number(b.closedAt || 0)
    );
}

async function judgeDebate(api, event, args) {
  sweepStalePending();

  const threadID = String(event.threadID);
  const judgeID = String(event.senderID);

  if (!isAdmin(judgeID)) {
    await safeSend(
      api,
      threadID,
      "🎀 only an admin can judge a debate."
    );
    return true;
  }

  const list = Array.isArray(args) ? args : [];

  let targetUserID = null;
  let scoreArg = null;

  if (list.length >= 2) {
    targetUserID = String(list[0]).trim();
    scoreArg = list[1];
  } else if (list.length === 1) {
    scoreArg = list[0];
  }

  const score = Number(scoreArg);

  if (
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100
  ) {
    await safeSend(
      api,
      threadID,
      [
        "🎀 usage:",
        "!debate judge <score 0-100>",
        "!debate judge <userID> <score 0-100>",
      ].join("\n")
    );
    return true;
  }

  let session = null;

  if (targetUserID) {
    session = getSession(threadID, targetUserID);

    if (
      !session ||
      session.round !== "awaiting_judgment"
    ) {
      session =
        pendingAll().find(
          (candidate) => candidate.userID === targetUserID
        ) || null;
    }
  } else {
    const candidates = pendingInThread(threadID);

    if (!candidates.length) {
      await safeSend(
        api,
        threadID,
        "🎀 nothing is pending judgment here."
      );
      return true;
    }

    if (candidates.length > 1) {
      await safeSend(
        api,
        threadID,
        [
          "🎀 more than one debate is pending here — specify a userID:",
          "",
          "!debate judge <userID> <score>",
          "",
          "!debate pending · to see who's waiting",
        ].join("\n")
      );
      return true;
    }

    session = candidates[0];
  }

  if (
    !session ||
    session.round !== "awaiting_judgment"
  ) {
    await safeSend(
      api,
      threadID,
      "🎀 no pending debate found for that userID."
    );
    return true;
  }

  const xp = Math.round(60 + score * 0.9);
  const coins = Math.round(150 + score * 3);

  try {
    await db.addXP(session.threadID, session.userID, xp);
    await db.addBalance(session.threadID, session.userID, coins);
  } catch (error) {
    console.error("[debate] reward error:", error);

    await safeSend(
      api,
      threadID,
      "🎀 the verdict was not finalized because the reward update failed. try judging again."
    );
    return true;
  }

  let balanceText = "";

  try {
    const user = await db.getUser(
      session.threadID,
      session.userID
    );

    balanceText =
      `♡ ${formatNumber(user?.balance ?? 0)} coins   ·   ✧ ${formatNumber(user?.xp ?? 0)} XP`;
  } catch (error) {
    console.error("[debate] balance error:", error);
  }

  const judgeName =
    event.senderName
      ? String(event.senderName)
      : `admin ${judgeID.slice(-4)}`;

  try {
    await profile.recordDebate(
      session.threadID,
      session.userID,
      {
        topic: session.topic,
        position: session.position,
        style: session.styleLabel,
        score,
        contradictionsFlagged: session.contradictionFlags.length,
        judgedBy: judgeName,
      }
    );
  } catch (error) {
    console.error("[debate] profile record error:", error);
  }

  const verdictText = judge.buildVerdictText(
    session,
    score,
    judgeName,
    {
      xp,
      coins,
      balanceText,
    }
  );

  await safeSend(
    api,
    session.threadID,
    verdictText
  );

  if (session.threadID !== threadID) {
    await safeSend(
      api,
      threadID,
      `🎀 verdict sent · ${score}/100 · ${judge.gradeLabel(score)}`
    );
  }

  removeSession(session);
  return true;
}

async function pendingList(api, event) {
  sweepStalePending();

  const threadID = String(event.threadID);
  const judgeID = String(event.senderID);

  if (!isAdmin(judgeID)) {
    await safeSend(
      api,
      threadID,
      "🎀 only an admin can view the pending queue."
    );
    return true;
  }

  const list = pendingInThread(threadID);

  if (!list.length) {
    await safeSend(
      api,
      threadID,
      "🎀 nothing pending judgment in this thread."
    );
    return true;
  }

  const lines = [
    "🎀 PENDING DEBATES — this thread",
    "",
  ];

  list.forEach((session, index) => {
    const minutesAgo = Math.max(
      0,
      Math.round(
        (Date.now() - Number(session.closedAt || Date.now())) / 60000
      )
    );

    lines.push(
      `${index + 1}. userID ${session.userID} · "${session.topic}" · ${session.position} · closed ${minutesAgo}m ago`
    );
  });

  lines.push(
    "",
    "!debate judge <userID> <score>"
  );

  await safeSend(
    api,
    threadID,
    lines.join("\n")
  );

  return true;
}

function normalizeRestoredSession(data) {
  const session = {
    ...data,
    threadID: String(data.threadID),
    userID: String(data.userID),
    topicId: data.topicId || "unknown",
    topic: String(data.topic || "Untitled debate"),
    position: String(data.position || "Undeclared"),
    style: STYLES[data.style] ? data.style : "analyst",
    styleLabel:
      data.styleLabel ||
      (STYLES[data.style] ? STYLES[data.style].label : STYLES.analyst.label),
    round: data.round || "opening",
    roundStartedAt: Number(data.roundStartedAt) || Date.now(),
    timeLimitMs:
      Number(data.timeLimitMs) > 0
        ? Number(data.timeLimitMs)
        : ROUND_TIME_LIMIT_MS,
    transcript: Array.isArray(data.transcript)
      ? data.transcript
      : [],
    playerTexts: Array.isArray(data.playerTexts)
      ? data.playerTexts
      : [],
    contradictionFlags: Array.isArray(data.contradictionFlags)
      ? data.contradictionFlags
      : [],
    pendingRebuttalArgument:
      data.pendingRebuttalArgument || null,
    pendingQuestion:
      data.pendingQuestion || null,
    usedQuestionIndices: Array.isArray(data.usedQuestionIndices)
      ? data.usedQuestionIndices
      : [],
    startedAt: Number(data.startedAt) || Date.now(),
    closedAt: Number(data.closedAt) || null,
  };

  if (!STYLES[session.style]) {
    session.style = "analyst";
    session.styleLabel = STYLES.analyst.label;
  }

  if (!session.styleLabel) {
    session.styleLabel = STYLES[session.style].label;
  }

  return session;
}

async function initDebate(api) {
  debateApi = api;

  if (staleSweepTimer) {
    clearInterval(staleSweepTimer);
  }

  staleSweepTimer = setInterval(
    sweepStalePending,
    60 * 60 * 1000
  );

  if (typeof staleSweepTimer.unref === "function") {
    staleSweepTimer.unref();
  }

  let raw;

  try {
    raw = await fsp.readFile(STATE_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("[debate] state load:", error);
    }
    return;
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("[debate] state parse:", error);
    return;
  }

  let restored = 0;

  for (const [id, data] of Object.entries(parsed || {})) {
    const session = normalizeRestoredSession(data);

    sessions.set(id, session);
    restored += 1;

    if (session.round === "awaiting_judgment") {
      continue;
    }

    const elapsed =
      Date.now() - session.roundStartedAt;

    if (elapsed >= session.timeLimitMs) {
      setTimeout(() => {
        handleTimeout(session).catch((error) => {
          console.error("[debate] recovery timeout:", error);
        });
      }, 2000 + restored * 500);
    } else {
      armTimer(session);
    }
  }

  sweepStalePending();

  console.log(
    `[debate] restored ${restored} open debate${restored === 1 ? "" : "s"}.`
  );
}

module.exports = {
  STYLES,
  startDebate,
  handleSubmit,
  handleAnswer,
  judgeDebate,
  pendingList,
  getSession,
  roundPromptText,
  hintText,
  initDebate,
};
