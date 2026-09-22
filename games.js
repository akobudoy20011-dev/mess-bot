const db = require("./db");
const { reply } = require("./util");
const triviaManager = require("./trivia-manager");
const riddleManager = require("./riddle-manager");

// ============================================================
// CONFIG
// ============================================================

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const EDIT_MIN_MS = 900;
const EDIT_MAX_MS = 1400;
const EDIT_TIMEOUT_MS = 5000;

const EDIT_MAX_RETRIES = 2;
const EDIT_RETRY_DELAY_MS = 400;

// Animation policy: 1 send + max 2 edits per game.
//   EDIT #1 = animation frame, EDIT #2 = final result.
// Player-driven turns (hit, doubledown, guesses, claim gamble) edit once per action.

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;

const MAX_BET = 1_000_000;

// Ladder / press-your-luck caps
const ROLL_LADDER_MAX = 3;
const COINFLIP_LADDER_MAX = 5;

// ============================================================
// STATE
// ============================================================

const sessions = new Map();
const sessionTimers = new Map();
const activeGames = new Set();

// ============================================================
// RANDOM / TIME HELPERS
// ============================================================

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function editDelay() {
  return randInt(EDIT_MIN_MS, EDIT_MAX_MS);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function sessionKey(threadID, userID) {
  return `${threadID}:${userID}`;
}

function normalizeArgs(args) {
  if (Array.isArray(args)) {
    return args.map((x) => String(x)).filter(Boolean);
  }

  return String(args || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseBet(value) {
  const bet = Number(String(value || "").replace(/,/g, "").trim());

  if (!Number.isInteger(bet)) {
    return NaN;
  }

  return bet;
}

function validBet(bet) {
  return Number.isInteger(bet) && bet >= 1 && bet <= MAX_BET;
}

function normalizeKeyword(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^!/, "");
}

// ============================================================
// ECLIPSE — COQUETTE VISUAL SYSTEM
// ============================================================

const GAME_STYLE = {
  trivia: { icon: "♡", name: "TRIVIA" },
  rps: { icon: "୨୧", name: "RPS" },
  roll: { icon: "✧", name: "ROLL" },
  guess: { icon: "♡", name: "GUESS" },
  coinflip: { icon: "୨୧", name: "COINFLIP" },
  blackjack: { icon: "♡", name: "BLACKJACK" },
  slots: { icon: "✧", name: "SLOTS" },
  math: { icon: "♡", name: "MATH" },
  riddle: { icon: "୨୧", name: "RIDDLE" },
  "8ball": { icon: "✧", name: "8-BALL" },
  daily: { icon: "♡", name: "DAILY" },
  work: { icon: "୨୧", name: "WORK" },
};

function gameHeader(type, subtitle = "") {
  const style = GAME_STYLE[type] || { icon: "♡", name: "ECLIPSE" };

  return [
    "╭──────────────────────────────╮",
    `          ♡ ECLIPSE ♡`,
    `             ${style.icon} ${style.name}`,
    "╰──────────────────────────────╯",
    subtitle ? `           ${subtitle}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function divider() {
  return "──────────────────────────────";
}

function thinDivider() {
  return "┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄";
}

function playerLine(event) {
  return getPlayerName(event);
}

function rewardLine(reward, balanceText, won = true) {
  const xpSign = won ? "+" : "-";
  const xpValue = Math.abs(Number(reward?.xp || 0));
  const coinValue = Number(reward?.coins || 0);
  const coinText = won && coinValue > 0
    ? `+${formatNumber(coinValue)}`
    : "0";

  return [
    divider(),
    `♡ XP       ${xpSign}${formatNumber(xpValue)}`,
    `♡ Coins    ${coinText}`,
    "",
    balanceText,
  ].join("\n");
}

function challengeBusyText() {
  return [
    "♡ ECLIPSE",
    "",
    "you already have a little challenge open.",
    "",
    "finish that one first, sweetheart ♡",
  ].join("\n");
}

// ============================================================
// REWARDS
// ============================================================

function xpForGame(type) {
  const rewards = {
    rps: 40,
    roll: 30,
    guess: 50,
    coinflip: 35,
    slots: 45,
    blackjack: 60,
    trivia: 50,
    math: 50,
    riddle: 50,
    "8ball": 10,
  };

  return rewards[type] || 25;
}

function coinReward(type) {
  const rewards = {
    rps: 100,
    roll: 75,
    guess: 150,
    coinflip: 100,
    slots: 125,
    blackjack: 175,
    trivia: 150,
    math: 175,
    riddle: 150,
    "8ball": 25,
  };

  return rewards[type] || 50;
}

async function awardPlayer(threadID, userID, gameType, won = false) {
  const xp = xpForGame(gameType);
  const baseCoins = coinReward(gameType);
  const xpAmount = won ? xp : Math.floor(xp * 0.5);

  await db.addXP(threadID, userID, won ? xpAmount : -xpAmount);

  if (won) {
    await db.addBalance(threadID, userID, baseCoins);
  }

  return {
    xp: xpAmount,
    coins: won ? baseCoins : 0,
    won,
  };
}

async function awardBetPlayer(threadID, userID, gameType, won, coinsAmount) {
  const xp = xpForGame(gameType);
  const xpAmount = won ? xp : Math.floor(xp * 0.5);

  await db.addXP(threadID, userID, won ? xpAmount : -xpAmount);

  const coins = Math.max(0, Math.floor(coinsAmount || 0));

  if (won && coins > 0) {
    await db.addBalance(threadID, userID, coins);
  }

  return {
    xp: xpAmount,
    coins: won ? coins : 0,
    won,
  };
}

async function getFinalBalanceText(threadID, userID) {
  const user = await db.getUser(threadID, userID);

  const coins = formatNumber(user?.balance ?? 0);
  const xp = formatNumber(user?.xp ?? 0);

  return `♡ ${coins} coins   ·   ✧ ${xp} XP`;
}

// ============================================================
// PLAYER
// ============================================================

function getPlayerName(event) {
  if (event && event.senderName) {
    return String(event.senderName);
  }

  if (event && event.userName) {
    return String(event.userName);
  }

  const id = event && event.senderID
    ? String(event.senderID)
    : "Player";

  return `Player ${id.slice(-4)}`;
}

// ============================================================
// MESSAGE HELPERS
// ============================================================

function sendMessageAsync(api, threadID, text) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const finish = (error, messageInfo) => {
      if (finished) return;
      finished = true;

      if (error) {
        reject(error);
        return;
      }

      resolve(messageInfo || null);
    };

    try {
      api.sendMessage(text, threadID, (error, messageInfo) =>
        finish(error, messageInfo)
      );
    } catch (error) {
      finish(error);
    }
  });
}

async function editMessageSafe(api, newText, messageID) {
  if (
    !messageID ||
    !api ||
    typeof api.editMessage !== "function"
  ) {
    return false;
  }

  return new Promise((resolve) => {
    let finished = false;

    const finish = (error) => {
      if (finished) return;

      finished = true;
      resolve(!error);
    };

    const timeout = setTimeout(() => {
      finish(new Error("timeout"));
    }, EDIT_TIMEOUT_MS);

    try {
      api.editMessage(newText, messageID, (error) => {
        clearTimeout(timeout);
        finish(error);
      });
    } catch (error) {
      clearTimeout(timeout);
      finish(error);
    }
  });
}

async function editMessageWithRetry(api, newText, messageID) {
  let lastError = null;

  for (let attempt = 0; attempt <= EDIT_MAX_RETRIES; attempt++) {
    const success = await editMessageSafe(api, newText, messageID);

    if (success) {
      return true;
    }

    lastError = `attempt ${attempt + 1} failed`;

    if (attempt < EDIT_MAX_RETRIES) {
      await sleep(EDIT_RETRY_DELAY_MS);
    }
  }

  console.warn(
    `[games] edit failed after retries for message ${messageID}: ${lastError}`
  );

  return false;
}

async function updateGameMessage(api, threadID, messageID, text) {
  if (!messageID) {
    console.warn("[games] Cannot edit game message: missing messageID");

    return false;
  }

  const edited = await editMessageWithRetry(api, text, messageID);

  if (!edited) {
    console.warn(
      `[games] Could not edit message ${messageID}. ` +
      "No duplicate message will be sent."
    );
  }

  return edited;
}

// Player-driven results are sent as NEW messages (never edits).
// Never throws, so a failed send can't undo an already-credited payout.
async function sendResult(api, threadID, text) {
  try {
    return await sendMessageAsync(api, threadID, text);
  } catch (error) {
    console.error("[games] sendResult:", error);

    return null;
  }
}

async function createAnimator(api, threadID, initialText, gameType = "") {
  const result = {
    messageID: null,
    stopEdit: null,
    editCount: 0,
  };

  try {
    const msgInfo = await sendMessageAsync(api, threadID, initialText);

    if (!msgInfo || !msgInfo.messageID) {
      console.error(`[games] failed to send initial ${gameType} message`);

      return result;
    }

    result.messageID = msgInfo.messageID;
    result.stopEdit = () => {};
  } catch (error) {
    console.error(`[games] animator init (${gameType}):`, error);
  }

  return result;
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

function setSession(threadID, userID, data) {
  const key = sessionKey(threadID, userID);

  sessions.set(key, data);

  clearTimeout(sessionTimers.get(key));

  sessionTimers.set(
    key,
    setTimeout(() => {
      sessions.delete(key);
      sessionTimers.delete(key);
      activeGames.delete(key);
    }, SESSION_TIMEOUT_MS)
  );
}

function getSession(threadID, userID) {
  return sessions.get(sessionKey(threadID, userID)) || null;
}

function clearSession(threadID, userID) {
  const key = sessionKey(threadID, userID);

  clearTimeout(sessionTimers.get(key));

  sessions.delete(key);
  sessionTimers.delete(key);
}

// ============================================================
// GAME LOCK
// ============================================================

function lockGame(threadID, userID) {
  const key = sessionKey(threadID, userID);

  if (activeGames.has(key)) {
    return false;
  }

  activeGames.add(key);

  return true;
}

function unlockGame(threadID, userID) {
  activeGames.delete(sessionKey(threadID, userID));
}

// ============================================================
// DAILY / WORK
// ============================================================

function streakFlames(streak) {
  const shown = Math.min(10, Math.max(0, Number(streak) || 0));

  return "♡".repeat(shown) + "·".repeat(10 - shown);
}

function claimGambleFooter() {
  return [
    "",
    thinDivider(),
    "♡ feeling lucky?",
    "reply 'gamble' to risk it all on a 50/50",
    "or 'keep' to leave it safe in your wallet.",
  ].join("\n");
}

async function handleDaily(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  try {
    const user = await db.getUser(threadID, userID);

    const now = Date.now();
    const lastDaily = Number(user?.last_daily || 0);

    const elapsed = now - lastDaily;
    const currentStreak = Number(user?.daily_streak || 0);

    if (elapsed < DAILY_COOLDOWN_MS) {
      const remaining = DAILY_COOLDOWN_MS - elapsed;

      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const minutes = Math.floor(
        (remaining % (60 * 60 * 1000)) / (60 * 1000)
      );

      await safeReply(
        api,
        event,
        [
          "╭──────────────────────────────╮",
          "          ♡ ECLIPSE ♡",
          "             DAILY",
          "╰──────────────────────────────╯",
          "",
          "you already claimed today's little gift ♡",
          "",
          `${streakFlames(currentStreak)}`,
          `daily streak · ${currentStreak}`,
          "",
          `come back in ${hours}h ${minutes}m.`,
        ].join("\n")
      );

      return true;
    }

    const withinGrace = elapsed <= 48 * 60 * 60 * 1000;

    const streak = withinGrace ? currentStreak + 1 : 1;

    const streakBroken = !withinGrace && currentStreak > 1;

    const baseReward = 200;
    const streakBonus = Math.min(streak * 25, 500);

    const totalReward = baseReward + streakBonus;

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("daily", playerLine(event)),
        "",
        "a little something for you...",
        "",
        "          ♡ ୨୧ ♡",
      ].join("\n"),
      "daily"
    );

    if (!animator.messageID) {
      return true;
    }

    await sleep(editDelay());

    await db.addBalance(threadID, userID, totalReward);
    await db.addXP(threadID, userID, 50);
    await db.updateUser(threadID, userID, {
      last_daily: now,
      daily_streak: streak,
    });

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("daily"),
      "",
      "♡ your little gift has arrived.",
      "",
      `♡ base       +${formatNumber(baseReward)}`,
      `୨୧ streak    +${formatNumber(streakBonus)}`,
      `✧ total      +${formatNumber(totalReward)}`,
      `♡ XP         +50`,
      "",
      `${streakFlames(streak)}`,
      `daily streak · ${streak}${streakBroken ? "  ·  restarted" : ""}`,
      "",
      balanceText,
      claimGambleFooter(),
    ].join("\n");

    // EDIT #1: final result
    await updateGameMessage(api, threadID, animator.messageID, finalText);

    setSession(threadID, userID, {
      type: "claim_gamble",
      source: "daily",
      amount: totalReward,
      messageID: animator.messageID,
    });

    return true;
  } catch (error) {
    console.error("[games] daily:", error);

    await safeReply(
      api,
      event,
      "♡ something went wrong while preparing your daily gift."
    );

    return true;
  }
}

const WORK_JOBS = [
  { job: "Software Developer", min: 100, max: 300, xp: 25 },
  { job: "Graphic Designer", min: 90, max: 260, xp: 22 },
  { job: "Bartender", min: 70, max: 220, xp: 18 },
  { job: "Freelancer", min: 120, max: 350, xp: 30 },
  { job: "Delivery Rider", min: 60, max: 180, xp: 15 },
  { job: "Musician", min: 80, max: 280, xp: 20 },
  { job: "Detective", min: 110, max: 320, xp: 27 },
  { job: "Chef", min: 90, max: 250, xp: 21 },
];

async function handleWork(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  try {
    const user = await db.getUser(threadID, userID);

    const now = Date.now();

    const lastWork = Number(user?.last_work || 0);

    const elapsed = now - lastWork;

    if (elapsed < WORK_COOLDOWN_MS) {
      const remaining = WORK_COOLDOWN_MS - elapsed;

      const minutes = Math.floor(remaining / (60 * 1000));
      const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

      await safeReply(
        api,
        event,
        [
          "╭──────────────────────────────╮",
          "          ♡ ECLIPSE ♡",
          "              WORK",
          "╰──────────────────────────────╯",
          "",
          "your little shift needs some rest ♡",
          "",
          `come back in ${minutes}m ${seconds}s.`,
        ].join("\n")
      );

      return true;
    }

    const job = WORK_JOBS[randInt(0, WORK_JOBS.length - 1)];

    const earned = randInt(job.min, job.max);

    const searchLines = [
      "looking for something for you...",
      "checking the available shifts...",
    ];

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("work", playerLine(event)),
        "",
        searchLines[0],
        "",
        "♡ ─────── ୨୧ ─────── ♡",
      ].join("\n"),
      "work"
    );

    if (!animator.messageID) {
      return true;
    }

    await sleep(editDelay());

    // EDIT #1: only animation frame
    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      [
        gameHeader("work"),
        "",
        searchLines[1],
        "",
        `${"♡".repeat(6)}${"·".repeat(4)}`,
      ].join("\n")
    );

    await sleep(editDelay());

    await db.addBalance(threadID, userID, earned);
    await db.addXP(threadID, userID, job.xp);
    await db.updateUser(threadID, userID, {
      last_work: now,
    });

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("work"),
      "",
      "♡ you found a shift.",
      "",
      `୨୧ ${job.job}`,
      "",
      `♡ earned   +${formatNumber(earned)} coins`,
      `✧ XP       +${formatNumber(job.xp)}`,
      "",
      "that's enough work for now.",
      "",
      balanceText,
      claimGambleFooter(),
    ].join("\n");

    // EDIT #2: final result
    await updateGameMessage(api, threadID, animator.messageID, finalText);

    setSession(threadID, userID, {
      type: "claim_gamble",
      source: "work",
      amount: earned,
      messageID: animator.messageID,
    });

    return true;
  } catch (error) {
    console.error("[games] work:", error);

    await safeReply(
      api,
      event,
      "♡ Eclipse couldn't find you a shift right now."
    );

    return true;
  }
}

async function resolveClaimGamble(api, event, actionText) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "claim_gamble") {
    return false;
  }

  const word = normalizeKeyword(actionText);

  if (/^(keep|cancel|bank|no|stop)$/.test(word)) {
    clearSession(threadID, userID);

    await safeReply(
      api,
      event,
      [
        "♡ kept safely.",
        "",
        `${formatNumber(session.amount)} coins stay in your wallet.`,
        "",
        "good choice... or maybe not ♡",
      ].join("\n")
    );

    return true;
  }

  if (!/^(gamble|double|doubledown|risk|yes)$/.test(word)) {
    await safeReply(
      api,
      event,
      "♡ reply 'gamble' to risk it, or 'keep' to keep it safe."
    );

    return true;
  }

  try {
    await db.spendBalance(
      threadID,
      userID,
      session.amount,
      `${session.source} gamble`
    );
  } catch (error) {
    await safeReply(
      api,
      event,
      "♡ you don't have enough coins to risk the whole amount."
    );

    return true;
  }

  clearSession(threadID, userID);

  const won = randInt(0, 1) === 0;

  const payout = won ? session.amount * 2 : 0;

  if (won) {
    await db.addBalance(threadID, userID, payout);
  }

  const balanceText = await getFinalBalanceText(threadID, userID);

  const finalText = [
    gameHeader(session.source === "daily" ? "daily" : "work"),
    "",
    won ? "♡ YOU GOT IT ♡" : "୨୧ OH... NOT THIS TIME",
    "",
    won
      ? `♡ payout   +${formatNumber(payout)} coins`
      : `♡ lost     -${formatNumber(session.amount)} coins`,
    "",
    won ? "that was a little lucky." : "don't look so sad ♡",
    "",
    balanceText,
  ].join("\n");

  await sendMessageAsync(api, threadID, finalText);

  return true;
}

// ============================================================
// TRIVIA
// ============================================================

async function handleTrivia(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  try {
    const q = await triviaManager.getNextQuestion({ threadID });

    if (!q) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        "♡ Eclipse has no unanswered trivia questions right now."
      );

      return;
    }

    const text = [
      gameHeader("trivia", playerLine(event)),
      "",
      "question ♡",
      "",
      q.question,
      "",
      `♡ A. ${q.options[0]}`,
      `♡ B. ${q.options[1]}`,
      `♡ C. ${q.options[2]}`,
      `♡ D. ${q.options[3]}`,
      "",
      thinDivider(),
      "✧ correct  +50 XP  ·  +150 coins",
      "",
      "reply with A, B, C or D ♡",
    ].join("\n");

    // SEND
    const animator = await createAnimator(api, threadID, text, "trivia");

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    setSession(threadID, userID, {
      type: "trivia",
      qdata: q,
      messageID: animator.messageID,
    });
  } catch (error) {
    unlockGame(threadID, userID);

    console.error("[games] trivia:", error);

    await safeReply(
      api,
      event,
      "♡ Eclipse couldn't reveal a question right now."
    );
  }
}

function normalizeAnswerText(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^(?:the\s+)?answer\s*(?:is|:)?\s*/i, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

function parseNumericAnswer(value) {
  const match = String(value || "").match(/[-+]?\d+(?:\.\d+)*/);

  return match ? Number(match[0]) : NaN;
}

function getTriviaAnswerIndex(answer, qdata) {
  const normalized = normalizeAnswerText(answer);

  const letter = normalized.match(
    /^(?:option|choice)?\s*([abcd])(?:[).]\s*)?$/i
  );

  if (letter) {
    return ["a", "b", "c", "d"].indexOf(letter[1].toLowerCase());
  }

  return (qdata.options || []).findIndex(
    (option) => normalizeAnswerText(option) === normalized
  );
}

async function resolveTrivia(api, event, answer) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "trivia") {
    return false;
  }

  clearSession(threadID, userID);

  const letters = ["A", "B", "C", "D"];

  const chosenIndex = getTriviaAnswerIndex(answer, session.qdata);

  const correctIndex = session.qdata.answer;

  const correct = chosenIndex === correctIndex;

  const correctLetter = letters[correctIndex] || "?";

  try {
    const reward = await awardPlayer(threadID, userID, "trivia", correct);

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("trivia"),
      "",
      correct ? "♡ YOU GOT IT" : "୨୧ NOT QUITE",
      "",
      `correct answer · ${correctLetter}`,
      "",
      correct
        ? "that was actually cute ♡"
        : "the answer slipped away from you.",
      "",
      rewardLine(reward, balanceText, correct),
    ].join("\n");

    // EDIT #1: final result
    await sendResult(api, threadID, finalText);
  } catch (error) {
    console.error("[games] trivia reward:", error);
  }

  unlockGame(threadID, userID);

  return true;
}

// ============================================================
// ROCK PAPER SCISSORS
// ============================================================

const RPS_SHAPE_ICON = {
  rock: "🪨",
  paper: "📄",
  scissors: "✂️",
};

const RPS_CHOICES = ["rock", "paper", "scissors"];

function rpsRoundResult(playerChoice, botChoice) {
  if (playerChoice === botChoice) {
    return "draw";
  }

  const playerWinsAgainst = {
    rock: "scissors",
    scissors: "paper",
    paper: "rock",
  };

  return playerWinsAgainst[playerChoice] === botChoice ? "win" : "loss";
}

function rpsStreakMultiplier(streak) {
  return Math.min(1 + streak * 0.1, 2.5);
}

async function handleRPS(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  try {
    const playerChoice = String(args?.[0] || "").toLowerCase();

    const aliases = {
      r: "rock",
      p: "paper",
      s: "scissors",
    };

    const normalizedChoice = aliases[playerChoice] || playerChoice;

    if (!RPS_CHOICES.includes(normalizedChoice)) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "♡ choose rock, paper, or scissors.");

      return;
    }

    const playerIcon = RPS_SHAPE_ICON[normalizedChoice];

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("rps", playerLine(event)),
        "",
        "୨୧ DUEL ୨୧",
        "",
        "you",
        "♡",
        playerIcon,
        "",
        "vs",
        "",
        "ECLIPSE",
        "♡",
        "?",
        "",
        thinDivider(),
        "",
        "choose your move ♡",
      ].join("\n"),
      "rps"
    );

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    let playerRoundWins = 0;
    let botRoundWins = 0;
    const rounds = [];

    // Play the whole match up front, no edits while deciding
    while (playerRoundWins < 2 && botRoundWins < 2 && rounds.length < 3) {
      const botChoice = RPS_CHOICES[randInt(0, 2)];
      const outcome = rpsRoundResult(normalizedChoice, botChoice);

      if (outcome === "win") {
        playerRoundWins++;
      } else if (outcome === "loss") {
        botRoundWins++;
      }

      rounds.push({ botChoice, outcome });
    }

    const roundLines = rounds
      .map((r, i) => {
        const tag =
          r.outcome === "win"
            ? "♡ WON"
            : r.outcome === "loss"
              ? "୨୧ LOST"
              : "✧ DRAW";

        return (
          `round ${i + 1}  ` +
          `${RPS_SHAPE_ICON[r.botChoice]} ` +
          `${r.botChoice.toUpperCase()}  →  ${tag}`
        );
      })
      .join("\n");

    await sleep(editDelay());

    // EDIT #1: all rounds revealed at once
    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      [
        gameHeader("rps"),
        "",
        `you  ${playerIcon} ${normalizedChoice}`,
        "",
        roundLines,
        "",
        `score  ·  you ${playerRoundWins} — ${botRoundWins} eclipse`,
      ].join("\n")
    );

    await sleep(editDelay());

    const matchWin = playerRoundWins > botRoundWins;

    const matchLoss = botRoundWins > playerRoundWins;

    const user = await db.getUser(threadID, userID);

    const currentStreak = Number(user?.rps_streak || 0);

    const newStreak = matchWin ? currentStreak + 1 : 0;

    const multiplier = rpsStreakMultiplier(
      matchWin ? newStreak : currentStreak
    );

    const baseXp = xpForGame("rps");

    const baseCoins = coinReward("rps");

    // Draws do not count as losses.
    const xpAmount = matchWin
      ? baseXp
      : matchLoss
        ? Math.floor(baseXp * 0.5)
        : 0;

    const coinsAmount = matchWin
      ? Math.floor(baseCoins * multiplier)
      : 0;

    if (xpAmount > 0) {
      await db.addXP(threadID, userID, matchWin ? xpAmount : -xpAmount);
    }

    if (coinsAmount > 0) {
      await db.addBalance(threadID, userID, coinsAmount);
    }

    await db.updateUser(threadID, userID, {
      rps_streak: newStreak,
    });

    const balanceText = await getFinalBalanceText(threadID, userID);

    const resultText = matchWin
      ? "♡ VICTORY"
      : matchLoss
        ? "୨୧ DEFEAT"
        : "✧ DRAW";

    const finalText = [
      gameHeader("rps"),
      "",
      resultText,
      `${playerRoundWins} — ${botRoundWins}`,
      "",
      thinDivider(),
      "",
      matchWin
        ? `♡ win streak · ${newStreak}`
        : matchLoss
          ? `୨୧ streak reset · ${currentStreak}`
          : `✧ streak unchanged · ${currentStreak}`,
      "",
      matchWin
        ? "oh? you did pretty well ♡"
        : matchLoss
          ? "don't be dramatic... again? ♡"
          : "a tie. neither of us wins.",
      "",
      divider(),
      `♡ XP       ${
        xpAmount === 0
          ? "0"
          : matchWin
            ? `+${formatNumber(xpAmount)}`
            : `-${formatNumber(xpAmount)}`
      }`,
      `♡ Coins    ${
        coinsAmount > 0 ? `+${formatNumber(coinsAmount)}` : "0"
      }`,
      "",
      balanceText,
    ].join("\n");

    // EDIT #2: final result
    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] rps:", error);

    await safeReply(api, event, "♡ the duel got interrupted.");
  } finally {
    unlockGame(threadID, userID);
  }
}

// ============================================================
// DICE ROLL
// ============================================================

const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

const ROLL_TIERS = {
  safe: {
    fraction: 0.4,
    multiplier: 1.5,
    label: "SAFE",
  },
  normal: {
    fraction: 0.55,
    multiplier: 2,
    label: "BALANCED",
  },
  risky: {
    fraction: 0.75,
    multiplier: 4,
    label: "RISKY",
  },
};

const ROLL_TIER_KEYWORDS = {
  safe: "safe",
  low: "safe",
  balanced: "normal",
  normal: "normal",
  medium: "normal",
  risky: "risky",
  high: "risky",
  risk: "risky",
};

function rollFace(value, sides) {
  if (sides === 6 && value >= 1 && value <= 6) {
    return DICE_FACES[value - 1];
  }

  return "🎲";
}

function rollBar(result, sides, threshold) {
  const width = 20;

  const clamp = (n) => Math.max(0, Math.min(width - 1, n));

  const resultPos = clamp(Math.floor(((result - 1) / sides) * width));

  const thresholdPos = clamp(Math.floor(((threshold - 1) / sides) * width));

  let bar = "";

  for (let i = 0; i < width; i++) {
    if (i === resultPos) {
      bar += "♡";
    } else if (i === thresholdPos) {
      bar += "│";
    } else if (i >= thresholdPos) {
      bar += "━";
    } else {
      bar += "─";
    }
  }

  return bar;
}

function parseRollArgs(args) {
  let tier = "normal";
  let sidesArg = null;

  for (const raw of args.slice(1)) {
    const lower = String(raw).toLowerCase();

    if (ROLL_TIER_KEYWORDS[lower]) {
      tier = ROLL_TIER_KEYWORDS[lower];

      continue;
    }

    if (!sidesArg && /^\d+$/.test(raw)) {
      sidesArg = raw;
    }
  }

  const sides = parseInt(sidesArg, 10) || 100;

  return {
    tier,
    sides,
  };
}

function rollLadderText(event, session) {
  return [
    "♡ you won.",
    "",
    `pending · ${formatNumber(session.pendingPayout)} coins`,
    `ladder · ${session.ladderCount} / ${ROLL_LADDER_MAX}`,
    "",
    thinDivider(),
    session.ladderCount >= ROLL_LADDER_MAX
      ? "maximum reached ♡ reply 'cashout' to keep it."
      : "reply 'cashout' to keep it,",
    session.ladderCount >= ROLL_LADDER_MAX
      ? ""
      : "or 'doubledown' to risk another 50/50.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function handleRoll(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  let betCharged = false;
  let settled = false;

  try {
    const bet = parseBet(args?.[0]);

    const { tier, sides } = parseRollArgs(args);

    if (!validBet(bet)) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        [
          "♡ invalid wager.",
          "",
          `minimum · 1`,
          `maximum · ${formatNumber(MAX_BET)} coins`,
        ].join("\n")
      );

      return;
    }

    if (sides < 2 || sides > 1000) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "♡ die sides must be between 2 and 1000.");

      return;
    }

    const tierConfig = ROLL_TIERS[tier];

    const highThreshold = Math.floor(sides * tierConfig.fraction);

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("roll", playerLine(event)),
        "",
        "♡ ROLL THE DICE ♡",
        "",
        `d${sides} · ${tierConfig.label}`,
        `wager · ${formatNumber(bet)} coins`,
        "",
        `high zone · ${highThreshold}–${sides}`,
        "",
        rollBar(1, sides, highThreshold),
        "",
        "let's see what you get...",
      ].join("\n"),
      "roll"
    );

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    try {
      await db.spendBalance(threadID, userID, bet, `Roll bet: ${bet}`);

      betCharged = true;
    } catch (error) {
      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("roll"),
          "",
          "୨୧ WAGER REJECTED",
          "",
          error.message || "not enough wallet coins.",
        ].join("\n")
      );

      unlockGame(threadID, userID);

      return;
    }

    const spinning = randInt(1, sides);

    // EDIT #1: single spin frame
    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      [
        gameHeader("roll"),
        "",
        `d${sides} · ${tierConfig.label}`,
        "",
        `${rollFace(spinning, sides)}  ${spinning}`,
        "",
        rollBar(spinning, sides, highThreshold),
        "",
        "spinning... ♡",
      ].join("\n")
    );

    await sleep(editDelay());

    const result = randInt(1, sides);

    const won = result >= highThreshold;

    const payout = won ? Math.floor(bet * tierConfig.multiplier) : 0;

    const margin = Math.abs(result - highThreshold);

    const flavor =
      result === sides
        ? "♡ maximum roll. Eclipse couldn't stop you."
        : won && margin <= Math.max(1, Math.floor(sides * 0.03))
          ? "୨୧ right on the edge..."
          : won
            ? "♡ comfortably inside the high zone."
            : result === 1
              ? "✧ the lowest roll possible."
              : "୨୧ just below the high zone.";

    if (!won) {
      settled = true;

      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("roll"),
        "",
        "୨୧ LOW ROLL",
        "",
        `${rollFace(result, sides)}  result · ${result} / ${sides}`,
        `high zone · ${highThreshold}–${sides}`,
        "",
        rollBar(result, sides, highThreshold),
        "",
        flavor,
        "",
        `♡ lost · -${formatNumber(bet)} coins`,
        "",
        balanceText,
      ].join("\n");

      // EDIT #2: final result
      await updateGameMessage(api, threadID, animator.messageID, finalText);

      unlockGame(threadID, userID);

      return;
    }

    const session = {
      type: "roll_ladder",
      pendingPayout: payout,
      ladderCount: 0,
      messageID: animator.messageID,
    };

    setSession(threadID, userID, session);

    const finalText = [
      gameHeader("roll"),
      "",
      "♡ HIGH ROLL",
      "",
      `${rollFace(result, sides)}  result · ${result} / ${sides}`,
      `high zone · ${highThreshold}–${sides}`,
      "",
      rollBar(result, sides, highThreshold),
      "",
      flavor,
      "",
      rollLadderText(event, session),
    ].join("\n");

    // EDIT #2: final result (opens the ladder)
    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] roll:", error);

    if (betCharged && !settled) {
      const bet = parseBet(args?.[0]);

      if (validBet(bet)) {
        await db.addBalance(threadID, userID, bet).catch(() => {});
      }
    }

    clearSession(threadID, userID);

    unlockGame(threadID, userID);

    await safeReply(
      api,
      event,
      "♡ the dice couldn't finish. your wager was protected."
    );
  }
}

async function resolveRollLadder(api, event, actionText) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "roll_ladder") {
    return false;
  }

  const word = normalizeKeyword(actionText);

  if (/^(cashout|cash|bank|keep|stop)$/.test(word)) {
    clearSession(threadID, userID);

    await db.addBalance(threadID, userID, session.pendingPayout);

    await db.addXP(threadID, userID, xpForGame("roll"));

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("roll"),
      "",
      "♡ BANKED ♡",
      "",
      `+${formatNumber(session.pendingPayout)} coins secured.`,
      `+${formatNumber(xpForGame("roll"))} XP`,
      "",
      "you knew when to stop ♡",
      "",
      balanceText,
    ].join("\n");

    await sendResult(api, threadID, finalText);

    unlockGame(threadID, userID);

    return true;
  }

  if (/^(doubledown|double)$/.test(word)) {
    if (session.ladderCount >= ROLL_LADDER_MAX) {
      await safeReply(
        api,
        event,
        "♡ you've reached the maximum. reply 'cashout' to keep it."
      );

      return true;
    }

    const won = randInt(0, 1) === 0;

    if (!won) {
      clearSession(threadID, userID);

      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("roll"),
        "",
        "୨୧ THE LADDER COLLAPSED",
        "",
        `forfeited · ${formatNumber(session.pendingPayout)} coins`,
        "",
        "you really risked it all ♡",
        "",
        balanceText,
      ].join("\n");

      await sendResult(api, threadID, finalText);

      unlockGame(threadID, userID);

      return true;
    }

    session.pendingPayout *= 2;
    session.ladderCount += 1;

    setSession(threadID, userID, session);

    const finalText = [
      gameHeader("roll"),
      "",
      "♡ DOUBLED ♡",
      "",
      rollLadderText(event, session),
    ].join("\n");

    const sent = await sendResult(api, threadID, finalText);

    // Keep the latest ladder message id on the live session object.
    if (sent && sent.messageID) {
      session.messageID = sent.messageID;
    }

    return true;
  }

  await safeReply(
    api,
    event,
    "♡ reply 'cashout' to keep it, or 'doubledown' to risk it."
  );

  return true;
}

// ============================================================
// NUMBER GUESS
// ============================================================

const GUESS_ATTEMPT_MULTIPLIER = [4, 2.5, 1.5];

async function handleGuess(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  let wagerCharged = false;
  let bet = NaN;

  try {
    const min = parseInt(args?.[0], 10) || 1;

    const max = parseInt(args?.[1], 10) || 100;

    bet = parseBet(args?.[2]);

    const wagered = validBet(bet);

    if (min >= max) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "♡ minimum must be lower than maximum.");

      return;
    }

    if (args?.[2] && !wagered) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        [
          "♡ invalid wager.",
          "",
          "minimum · 1",
          `maximum · ${formatNumber(MAX_BET)} coins`,
        ].join("\n")
      );

      return;
    }

    const secretNumber = randInt(min, max);

    const wagerLine = wagered
      ? [
          `♡ wager · ${formatNumber(bet)} coins`,
          "✧ 1st try 4× · 2nd 2.5× · 3rd 1.5×",
          "୨୧ reply 'doubledown' before your final guess",
          "",
        ]
      : [];

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("guess", playerLine(event)),
        "",
        "୨୧ A LITTLE GUESS",
        "",
        `range · ${min} ───── ${max}`,
        "",
        ...wagerLine,
        "attempt · 0 / 3",
        "",
        "trust your intuition ♡",
        "",
        "send your first guess.",
      ].join("\n"),
      "guess"
    );

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    if (wagered) {
      try {
        await db.spendBalance(threadID, userID, bet, `Guess bet: ${bet}`);

        wagerCharged = true;
      } catch (error) {
        await updateGameMessage(
          api,
          threadID,
          animator.messageID,
          [
            gameHeader("guess"),
            "",
            "୨୧ WAGER REJECTED",
            "",
            error.message || "not enough wallet coins.",
          ].join("\n")
        );

        unlockGame(threadID, userID);

        return;
      }
    }

    setSession(threadID, userID, {
      type: "guess",
      secretNumber,
      min,
      max,
      tries: 0,
      bet: wagered ? bet : 0,
      doubled: false,
      messageID: animator.messageID,
    });
  } catch (error) {
    if (wagerCharged) {
      await db.addBalance(threadID, userID, bet).catch(() => {});
    }

    unlockGame(threadID, userID);

    console.error("[games] guess:", error);

    await safeReply(
      api,
      event,
      "♡ Eclipse couldn't hide a number right now."
    );
  }
}

async function resolveGuess(api, event, guessText) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "guess") {
    return false;
  }

  const word = normalizeKeyword(guessText);

  if (/^(doubledown|double)$/.test(word)) {
    if (!session.bet) {
      await safeReply(
        api,
        event,
        "♡ there's no wager to double — this one is free."
      );

      return true;
    }

    if (session.doubled) {
      await safeReply(api, event, "୨୧ you've already doubled down.");

      return true;
    }

    if (session.tries >= 2) {
      await safeReply(
        api,
        event,
        "♡ too late — this is your final attempt."
      );

      return true;
    }

    try {
      await db.spendBalance(
        threadID,
        userID,
        session.bet,
        "Guess double down"
      );
    } catch (error) {
      await safeReply(
        api,
        event,
        error.message || "♡ not enough wallet coins to double down."
      );

      return true;
    }

    session.doubled = true;
    session.bet *= 2;

    setSession(threadID, userID, session);

    await safeReply(
      api,
      event,
      [
        "♡ doubled down.",
        "",
        `wager · ${formatNumber(session.bet)} coins`,
        "",
        "now choose carefully ♡",
      ].join("\n")
    );

    return true;
  }

  const guess = parseNumericAnswer(guessText);

  if (Number.isNaN(guess)) {
    await safeReply(api, event, "♡ enter a number.");

    return true;
  }

  const tries = session.tries + 1;

  let resultMessage = "";
  let isCorrect = false;

  if (guess === session.secretNumber) {
    isCorrect = true;

    resultMessage =
      `♡ correct. you found ${session.secretNumber} in ${tries} attempt${
        tries === 1 ? "" : "s"
      }.`;
  } else if (tries >= 3) {
    resultMessage = `୨୧ the hidden number was ${session.secretNumber}.`;
  } else if (guess < session.secretNumber) {
    resultMessage =
      `✧ too low. go higher. · ${3 - tries} attempt${
        3 - tries === 1 ? "" : "s"
      } left`;
  } else {
    resultMessage =
      `✧ too high. go lower. · ${3 - tries} attempt${
        3 - tries === 1 ? "" : "s"
      } left`;
  }

  const terminal = isCorrect || tries >= 3;

  if (terminal) {
    clearSession(threadID, userID);

    try {
      let reward;

      if (session.bet) {
        const multiplier = GUESS_ATTEMPT_MULTIPLIER[tries - 1] || 1;

        const coinsAmount = isCorrect
          ? Math.floor(session.bet * multiplier)
          : 0;

        reward = await awardBetPlayer(
          threadID,
          userID,
          "guess",
          isCorrect,
          coinsAmount
        );
      } else {
        reward = await awardPlayer(threadID, userID, "guess", isCorrect);
      }

      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("guess"),
        "",
        isCorrect ? "♡ YOU FOUND IT" : "୨୧ NOT THIS TIME",
        "",
        resultMessage,
        "",
        isCorrect
          ? "your intuition was right ♡"
          : "the number wins this round.",
        session.bet && !isCorrect
          ? `♡ lost · -${formatNumber(session.bet)} coins`
          : "",
        "",
        rewardLine(reward, balanceText, isCorrect),
      ]
        .filter((line) => line !== "")
        .join("\n");

      await sendResult(api, threadID, finalText);
    } catch (error) {
      console.error("[games] guess reward:", error);

      await safeReply(
        api,
        event,
        "♡ the guess ended, but the reward update failed."
      );
    } finally {
      unlockGame(threadID, userID);
    }
  } else {
    setSession(threadID, userID, {
      ...session,
      tries,
    });

    const text = [
      gameHeader("guess"),
      "",
      resultMessage,
      "",
      `attempt · ${tries}/3`,
      "",
      "try again ♡",
    ].join("\n");

    await sendResult(api, threadID, text);
  }

  return true;
}

// ============================================================
// COINFLIP
// ============================================================

function coinflipLadderText(event, session) {
  return [
    "♡ you called it.",
    "",
    `pending · ${formatNumber(session.pendingPayout)} coins`,
    `streak · ${session.ladderCount} / ${COINFLIP_LADDER_MAX}`,
    "",
    thinDivider(),
    session.ladderCount >= COINFLIP_LADDER_MAX
      ? "maximum reached ♡ reply 'cashout'."
      : "reply 'cashout' to keep it,",
    session.ladderCount >= COINFLIP_LADDER_MAX
      ? ""
      : "or 'doubledown' for another 50/50.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function handleCoinFlip(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  let betCharged = false;
  let settled = false;
  let bet = NaN;

  try {
    const first = String(args?.[0] || "").trim().toLowerCase();

    const second = String(args?.[1] || "").trim().toLowerCase();

    const aliases = {
      h: "heads",
      t: "tails",
    };

    const firstChoice = aliases[first] || first;

    const secondChoice = aliases[second] || second;

    let choice;
    let betText;

    if (["heads", "tails"].includes(firstChoice)) {
      choice = firstChoice;
      betText = second;
    } else {
      choice = secondChoice;
      betText = first;
    }

    bet = parseBet(betText);

    if (!validBet(bet) || !["heads", "tails"].includes(choice)) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        [
          "♡ usage:",
          "!coinflip <bet> <heads|tails>",
          "",
          "example · !coinflip 100 heads",
        ].join("\n")
      );

      return;
    }

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("coinflip", playerLine(event)),
        "",
        "୨୧ MAKE YOUR CALL ୨୧",
        "",
        `your call · ${choice}`,
        `wager · ${formatNumber(bet)} coins`,
        "",
        "       ◉",
        "",
        "flipping... ♡",
      ].join("\n"),
      "coinflip"
    );

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    try {
      await db.spendBalance(threadID, userID, bet, `Coinflip bet: ${bet}`);

      betCharged = true;
    } catch (error) {
      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("coinflip"),
          "",
          "୨୧ WAGER REJECTED",
          "",
          error.message || "not enough wallet coins.",
        ].join("\n")
      );

      unlockGame(threadID, userID);

      return;
    }

    const tumbling = randInt(0, 1) === 0 ? "heads" : "tails";

    // EDIT #1: single flip frame
    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      [
        gameHeader("coinflip"),
        "",
        "୨୧ MAKE YOUR CALL",
        "",
        `your call · ${choice}`,
        `wager · ${formatNumber(bet)} coins`,
        "",
        `       ◎  ${tumbling}`,
        "",
        "flipping... ♡",
      ].join("\n")
    );

    await sleep(editDelay());

    const result = randInt(0, 1) === 0 ? "heads" : "tails";

    const won = choice === result;

    if (!won) {
      settled = true;

      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("coinflip"),
        "",
        "୨୧ WRONG CALL",
        "",
        `your call · ${choice}`,
        `result · ${result}`,
        "",
        `♡ lost · -${formatNumber(bet)} coins`,
        "",
        "the coin had other plans.",
        "",
        balanceText,
      ].join("\n");

      // EDIT #2: final result
      await updateGameMessage(api, threadID, animator.messageID, finalText);

      unlockGame(threadID, userID);

      return;
    }

    const session = {
      type: "coinflip_ladder",
      pendingPayout: bet * 2,
      ladderCount: 0,
      messageID: animator.messageID,
    };

    setSession(threadID, userID, session);

    const finalText = [
      gameHeader("coinflip"),
      "",
      `your call · ${choice}`,
      `result · ${result}`,
      "",
      coinflipLadderText(event, session),
    ].join("\n");

    // EDIT #2: final result (opens the ladder)
    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] coinflip:", error);

    if (betCharged && !settled && validBet(bet)) {
      await db.addBalance(threadID, userID, bet).catch(() => {});
    }

    clearSession(threadID, userID);

    unlockGame(threadID, userID);

    await safeReply(
      api,
      event,
      "♡ the coin couldn't finish. your wager was protected."
    );
  }
}

async function resolveCoinflipLadder(api, event, actionText) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "coinflip_ladder") {
    return false;
  }

  const word = normalizeKeyword(actionText);

  if (/^(cashout|cash|bank|keep|stop)$/.test(word)) {
    clearSession(threadID, userID);

    await db.addBalance(threadID, userID, session.pendingPayout);

    await db.addXP(threadID, userID, xpForGame("coinflip"));

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("coinflip"),
      "",
      "♡ BANKED ♡",
      "",
      `+${formatNumber(session.pendingPayout)} coins secured.`,
      `+${xpForGame("coinflip")} XP`,
      "",
      "you knew when to stop ♡",
      "",
      balanceText,
    ].join("\n");

    await sendResult(api, threadID, finalText);

    unlockGame(threadID, userID);

    return true;
  }

  if (/^(doubledown|double)$/.test(word)) {
    if (session.ladderCount >= COINFLIP_LADDER_MAX) {
      await safeReply(
        api,
        event,
        "♡ maximum streak reached. reply 'cashout' to keep it."
      );

      return true;
    }

    const won = randInt(0, 1) === 0;

    if (!won) {
      clearSession(threadID, userID);

      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("coinflip"),
        "",
        "୨୧ THE STREAK BREAKS",
        "",
        `forfeited · ${formatNumber(session.pendingPayout)} coins`,
        "",
        "you really wanted to push your luck ♡",
        "",
        balanceText,
      ].join("\n");

      await sendResult(api, threadID, finalText);

      unlockGame(threadID, userID);

      return true;
    }

    session.pendingPayout *= 2;
    session.ladderCount += 1;

    setSession(threadID, userID, session);

    const finalText = [
      gameHeader("coinflip"),
      "",
      "♡ DOUBLED ♡",
      "",
      coinflipLadderText(event, session),
    ].join("\n");

    const sent = await sendResult(api, threadID, finalText);

    // Keep the latest ladder message id on the live session object.
    if (sent && sent.messageID) {
      session.messageID = sent.messageID;
    }

    return true;
  }

  await safeReply(
    api,
    event,
    "♡ reply 'cashout' to keep it, or 'doubledown' to risk it."
  );

  return true;
}

// ============================================================
// BLACKJACK
// ============================================================

const CARD_VALUES = {
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 10,
  Q: 10,
  K: 10,
  A: 11,
};

const SUITS = ["♠️", "♥️", "♦️", "♣️"];

function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const value of Object.keys(CARD_VALUES)) {
      deck.push(`${value}${suit}`);
    }
  }

  return deck;
}

function drawCard(deck) {
  if (deck.length === 0) {
    deck.push(...createDeck());
  }

  const idx = Math.floor(Math.random() * deck.length);

  const card = deck[idx];

  deck.splice(idx, 1);

  return card;
}

function getCardValue(card) {
  const value = String(card).replace(/[♠️♥️♦️♣️]+$/u, "");

  return CARD_VALUES[value] || 0;
}

function calcHandValue(hand) {
  let value = hand.reduce((sum, card) => sum + getCardValue(card), 0);

  let aces = hand.filter((card) => String(card).startsWith("A")).length;

  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

function handValueBar(value) {
  const width = 10;

  const filled = Math.max(
    0,
    Math.min(width, Math.round((value / 21) * width))
  );

  const zone =
    value > 21
      ? "୨୧ BUST"
      : value >= 17
        ? "♡ strong"
        : value >= 12
          ? "✧ risky"
          : "୨୧ safe";

  return `${"♡".repeat(filled)}${"·".repeat(width - filled)}  ${zone}`;
}

function blackjackActionsFooter(session) {
  const lines = [
    "♡ !hit     draw another card",
    "♡ !stand   hold your hand",
  ];

  if (session.playerHand.length === 2 && !session.doubled) {
    lines.push("୨୧ !double  double wager + draw one");
  }

  return lines.join("\n");
}

async function handleBlackjack(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  let betCharged = false;
  let bet = NaN;

  try {
    bet = parseBet(args?.[0]);

    if (!validBet(bet)) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        [
          "♡ usage · !blackjack <bet>",
          "",
          "minimum · 1",
          `maximum · ${formatNumber(MAX_BET)} coins`,
        ].join("\n")
      );

      return;
    }

    const deck = createDeck();

    const playerHand = [drawCard(deck), drawCard(deck)];

    const botHand = [drawCard(deck), drawCard(deck)];

    const playerValue = calcHandValue(playerHand);

    const dealerValue = calcHandValue(botHand);

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("blackjack", playerLine(event)),
        "",
        "♡ BLACKJACK ♡",
        "",
        `wager · ${formatNumber(bet)} coins`,
        "",
        `you     ${playerHand.join("  ")}`,
        `        total · ${playerValue}`,
        "",
        `dealer  ${botHand[0]}  ▣`,
        "        total · ?",
        "",
        thinDivider(),
        "",
        "dealing... ♡",
      ].join("\n"),
      "blackjack"
    );

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    try {
      await db.spendBalance(threadID, userID, bet, `Blackjack bet: ${bet}`);

      betCharged = true;
    } catch (error) {
      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("blackjack"),
          "",
          "୨୧ WAGER REJECTED",
          "",
          error.message || "not enough wallet coins.",
        ].join("\n")
      );

      unlockGame(threadID, userID);

      return;
    }

    if (playerValue === 21) {
      const dealerAlsoNatural = dealerValue === 21;

      let finalText;

      if (dealerAlsoNatural) {
        await db.addBalance(threadID, userID, bet);

        const balanceText = await getFinalBalanceText(threadID, userID);

        finalText = [
          gameHeader("blackjack"),
          "",
          "✧ PUSH ✧",
          "",
          `you     ${playerHand.join("  ")}`,
          `dealer  ${botHand.join("  ")}`,
          "",
          `♡ refunded · ${formatNumber(bet)} coins`,
          "",
          balanceText,
        ].join("\n");
      } else {
        const payout = Math.floor(bet * 2.5);

        await db.addBalance(threadID, userID, payout);

        await db.addXP(threadID, userID, xpForGame("blackjack"));

        const balanceText = await getFinalBalanceText(threadID, userID);

        finalText = [
          gameHeader("blackjack"),
          "",
          "♡ BLACKJACK ♡",
          "",
          `you     ${playerHand.join("  ")}`,
          `dealer  ${botHand.join("  ")}`,
          "",
          `♡ payout · +${formatNumber(payout)} coins`,
          `✧ XP · +${xpForGame("blackjack")}`,
          "",
          balanceText,
        ].join("\n");
      }

      await updateGameMessage(api, threadID, animator.messageID, finalText);

      unlockGame(threadID, userID);

      return;
    }

    const session = {
      type: "blackjack",
      playerHand,
      botHand,
      deck,
      bet,
      doubled: false,
      messageID: animator.messageID,
    };

    const text = [
      gameHeader("blackjack"),
      "",
      `you     ${playerHand.join("  ")}`,
      `        total · ${playerValue}`,
      `        ${handValueBar(playerValue)}`,
      "",
      `dealer  ${botHand[0]}  ▣`,
      "        total · ?",
      "",
      thinDivider(),
      "",
      blackjackActionsFooter(session),
    ].join("\n");

    // EDIT #1: deal reveal with actions
    await updateGameMessage(api, threadID, animator.messageID, text);

    setSession(threadID, userID, session);
  } catch (error) {
    if (betCharged && validBet(bet)) {
      await db.addBalance(threadID, userID, bet).catch(() => {});
    }

    clearSession(threadID, userID);

    unlockGame(threadID, userID);

    console.error("[games] blackjack:", error);

    await safeReply(
      api,
      event,
      "♡ the blackjack table couldn't open. your wager was protected."
    );
  }
}

async function settleBlackjack(api, event, session) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  let botValue = calcHandValue(session.botHand);

  while (botValue < 17) {
    session.botHand.push(drawCard(session.deck));

    botValue = calcHandValue(session.botHand);
  }

  const playerValue = calcHandValue(session.playerHand);

  let result = "loss";
  let resultText = "the dealer wins.";

  if (botValue > 21) {
    result = "win";
    resultText = "the dealer busted ♡";
  } else if (playerValue > botValue) {
    result = "win";
    resultText = "your hand wins ♡";
  } else if (playerValue === botValue) {
    result = "draw";
    resultText = "push — neither hand wins.";
  }

  if (result === "draw") {
    await db.addBalance(threadID, userID, session.bet);
  } else if (result === "win") {
    await db.addBalance(threadID, userID, session.bet * 2);

    await db.addXP(threadID, userID, xpForGame("blackjack"));
  } else {
    await db.addXP(
      threadID,
      userID,
      -Math.floor(xpForGame("blackjack") * 0.5)
    );
  }

  const balanceText = await getFinalBalanceText(threadID, userID);

  const rewardBlock =
    result === "draw"
      ? `♡ wager refunded · ${formatNumber(session.bet)} coins`
      : result === "win"
        ? `♡ payout · +${formatNumber(session.bet * 2)} coins\n✧ XP · +${xpForGame("blackjack")}`
        : `୨୧ lost · -${formatNumber(session.bet)} coins\n✧ XP · -${Math.floor(xpForGame("blackjack") * 0.5)}`;

  const finalText = [
    gameHeader("blackjack"),
    "",
    result === "win"
      ? "♡ YOU WIN"
      : result === "draw"
        ? "✧ PUSH"
        : "୨୧ DEALER WINS",
    "",
    `you     ${session.playerHand.join("  ")}`,
    `        total · ${playerValue}`,
    "",
    `dealer  ${session.botHand.join("  ")}`,
    `        total · ${botValue}`,
    "",
    resultText,
    "",
    rewardBlock,
    "",
    balanceText,
  ].join("\n");

  await sendResult(api, threadID, finalText);
}

async function settleBlackjackBust(api, event, session) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  const playerValue = calcHandValue(session.playerHand);

  await db.addXP(
    threadID,
    userID,
    -Math.floor(xpForGame("blackjack") * 0.5)
  );

  const balanceText = await getFinalBalanceText(threadID, userID);

  const finalText = [
    gameHeader("blackjack"),
    "",
    "୨୧ BUST",
    "",
    `${session.playerHand.join("  ")}`,
    `total · ${playerValue}`,
    handValueBar(playerValue),
    "",
    "you crossed 21 ♡",
    "",
    `୨୧ lost · -${formatNumber(session.bet)} coins`,
    `✧ XP · -${Math.floor(xpForGame("blackjack") * 0.5)}`,
    "",
    balanceText,
  ].join("\n");

  await sendResult(api, threadID, finalText);
}

async function resolveBlackjack(api, event, action) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "blackjack") {
    return false;
  }

  const cmd = normalizeKeyword(action);

  if (!["hit", "stand", "double"].includes(cmd)) {
    await safeReply(api, event, "♡ use !hit, !stand, or !double.");

    return true;
  }

  try {
    if (cmd === "double") {
      if (session.playerHand.length !== 2 || session.doubled) {
        await safeReply(
          api,
          event,
          "୨୧ you can only double down as your first action."
        );

        return true;
      }

      try {
        await db.spendBalance(
          threadID,
          userID,
          session.bet,
          "Blackjack double down"
        );
      } catch (error) {
        await safeReply(
          api,
          event,
          error.message || "♡ not enough wallet coins to double down."
        );

        return true;
      }

      session.doubled = true;
      session.bet *= 2;

      const card = drawCard(session.deck);

      session.playerHand.push(card);

      const playerValue = calcHandValue(session.playerHand);

      if (playerValue > 21) {
        clearSession(threadID, userID);

        try {
          await settleBlackjackBust(api, event, session);
        } finally {
          unlockGame(threadID, userID);
        }

        return true;
      }

      clearSession(threadID, userID);

      try {
        await settleBlackjack(api, event, session);
      } finally {
        unlockGame(threadID, userID);
      }

      return true;
    }

    if (cmd === "hit") {
      const card = drawCard(session.deck);

      session.playerHand.push(card);

      const playerValue = calcHandValue(session.playerHand);

      if (playerValue > 21) {
        clearSession(threadID, userID);

        try {
          await settleBlackjackBust(api, event, session);
        } finally {
          unlockGame(threadID, userID);
        }

        return true;
      }

      setSession(threadID, userID, session);

      const text = [
        gameHeader("blackjack"),
        "",
        `you     ${session.playerHand.join("  ")}`,
        `        total · ${playerValue}`,
        `        ${handValueBar(playerValue)}`,
        "",
        `dealer  ${session.botHand[0]}  ▣`,
        "        total · ?",
        "",
        thinDivider(),
        "",
        blackjackActionsFooter(session),
      ].join("\n");

      await sendResult(api, threadID, text);

      return true;
    }

    clearSession(threadID, userID);

    try {
      await settleBlackjack(api, event, session);
    } finally {
      unlockGame(threadID, userID);
    }

    return true;
  } catch (error) {
    console.error("[games] blackjack resolve:", error);

    clearSession(threadID, userID);

    unlockGame(threadID, userID);

    await safeReply(api, event, "♡ the blackjack hand ended unexpectedly.");

    return true;
  }
}

// ============================================================
// SLOTS
// ============================================================

const SLOT_SYMBOLS = [
  "🍒",
  "🍋",
  "🍊",
  "🍉",
  "⭐",
  "💎",
];

function slotMultiplier(reels) {
  const [a, b, c] = reels;

  if (a === b && b === c) {
    if (a === "💎") {
      return 20;
    }

    if (a === "⭐") {
      return 15;
    }

    return 10;
  }

  if (a === b || b === c || a === c) {
    return 2;
  }

  return 0;
}

function slotsRandomSymbol() {
  return SLOT_SYMBOLS[randInt(0, SLOT_SYMBOLS.length - 1)];
}

function slotsRandomReels() {
  return [
    slotsRandomSymbol(),
    slotsRandomSymbol(),
    slotsRandomSymbol(),
  ];
}

function slotsReelText(reels, highlight = false) {
  const cells = highlight
    ? reels.map((symbol) => `[${symbol}]`)
    : reels;

  return `♡  ${cells.join("   ·   ")}  ♡`;
}

async function handleSlots(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  let betCharged = false;
  let settled = false;
  let bet = NaN;

  try {
    bet = parseBet(args?.[0]);

    if (!validBet(bet)) {
      await safeReply(
        api,
        event,
        [
          "♡ invalid wager.",
          "",
          "minimum · 1",
          `maximum · ${formatNumber(MAX_BET)} coins`,
        ].join("\n")
      );

      return;
    }

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("slots", playerLine(event)),
        "",
        "✧ SLOTS ✧",
        "",
        "♡     🍒   ·   🍋   ·   ⭐     ♡",
        "",
        `wager · ${formatNumber(bet)} coins`,
        "",
        "spinning... ♡",
      ].join("\n"),
      "slots"
    );

    if (!animator.messageID) {
      return;
    }

    try {
      await db.spendBalance(
        threadID,
        userID,
        bet,
        `Slots bet: ${bet}`
      );

      betCharged = true;
    } catch (error) {
      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("slots"),
          "",
          "୨୧ WAGER REJECTED",
          "",
          error.message || "not enough wallet coins.",
        ].join("\n")
      );

      return;
    }

    await sleep(editDelay());

    // EDIT #1: single spin frame
    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      [
        gameHeader("slots"),
        "",
        thinDivider(),
        "",
        slotsReelText(slotsRandomReels()),
        "",
        "♡ spinning...",
      ].join("\n")
    );

    await sleep(editDelay());

    const reels = slotsRandomReels();
    const multiplier = slotMultiplier(reels);
    const won = multiplier > 0;

    let finalText;

    if (won) {
      const payout = bet * multiplier;
      const net = payout - bet;

      await db.addBalance(threadID, userID, payout);

      // Payout credited: the wager is resolved, never refund it.
      settled = true;

      await db.addXP(threadID, userID, xpForGame("slots"));

      const balanceText = await getFinalBalanceText(
        threadID,
        userID
      );

      finalText = [
        gameHeader("slots"),
        "",
        thinDivider(),
        "",
        slotsReelText(reels, true),
        "",
        `♡ ${multiplier}× MATCH`,
        "",
        `♡ payout · +${formatNumber(payout)} coins`,
        `✧ profit · +${formatNumber(net)} coins`,
        "",
        "that was pretty lucky ♡",
        "",
        balanceText,
      ].join("\n");
    } else {
      // Loss: the wager is already spent, never refund it.
      settled = true;

      await db.addXP(
        threadID,
        userID,
        -Math.floor(xpForGame("slots") * 0.5)
      );

      const balanceText = await getFinalBalanceText(
        threadID,
        userID
      );

      finalText = [
        gameHeader("slots"),
        "",
        thinDivider(),
        "",
        slotsReelText(reels),
        "",
        "୨୧ NO MATCH",
        "",
        `♡ lost · -${formatNumber(bet)} coins`,
        "",
        balanceText,
      ].join("\n");
    }

    // EDIT #2: final result
    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      finalText
    );
  } catch (error) {
    console.error("[games] slots:", error);

    if (betCharged && !settled && validBet(bet)) {
      await db
        .addBalance(threadID, userID, bet)
        .catch(() => {});
    }

    await safeReply(
      api,
      event,
      "♡ the reels couldn't finish. your wager was protected."
    );
  } finally {
    unlockGame(threadID, userID);
  }
}

// ============================================================
// MATH
// ============================================================

async function handleMath(api, event) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  try {
    const a = randInt(1, 100);

    const b = randInt(1, 100);

    const ops = ["+", "-", "*"];

    const op = ops[randInt(0, 2)];

    let correctAnswer;

    if (op === "+") {
      correctAnswer = a + b;
    } else if (op === "-") {
      correctAnswer = a - b;
    } else {
      correctAnswer = a * b;
    }

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("math", playerLine(event)),
        "",
        "♡ QUICK MATH ♡",
        "",
        `        ${a} ${op} ${b}`,
        "",
        thinDivider(),
        "",
        "what's the answer? ♡",
      ].join("\n"),
      "math"
    );

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    setSession(threadID, userID, {
      type: "math",
      correctAnswer,
      messageID: animator.messageID,
    });
  } catch (error) {
    unlockGame(threadID, userID);

    console.error("[games] math:", error);

    await safeReply(api, event, "♡ Eclipse couldn't create an equation.");
  }
}

async function resolveMath(api, event, answerText) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "math") {
    return false;
  }

  clearSession(threadID, userID);

  const userAnswer = parseNumericAnswer(answerText);

  const correct =
    !Number.isNaN(userAnswer) && userAnswer === session.correctAnswer;

  try {
    const reward = await awardPlayer(threadID, userID, "math", correct);

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("math"),
      "",
      correct ? "♡ YOU GOT IT" : "୨୧ NOT QUITE",
      "",
      `your answer · ${Number.isNaN(userAnswer) ? "invalid" : userAnswer}`,
      `correct · ${session.correctAnswer}`,
      "",
      correct ? "precision wins ♡" : "the equation wins this one.",
      "",
      rewardLine(reward, balanceText, correct),
    ].join("\n");

    // EDIT #1: final result
    await sendResult(api, threadID, finalText);
  } catch (error) {
    console.error("[games] math reward:", error);
  }

  unlockGame(threadID, userID);

  return true;
}

// ============================================================
// RIDDLES
// ============================================================

async function handleRiddle(api, event) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  try {
    const riddle = await riddleManager.getNextRiddle({ threadID });

    if (!riddle) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        "♡ Eclipse has no riddles available right now."
      );

      return;
    }

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("riddle", playerLine(event)),
        "",
        "୨୧ A LITTLE MYSTERY ୨୧",
        "",
        `❝ ${riddle.question} ❞`,
        "",
        "think carefully ♡",
        "",
        thinDivider(),
        "",
        "what's your answer?",
      ].join("\n"),
      "riddle"
    );

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    setSession(threadID, userID, {
      type: "riddle",
      question: riddle.question,
      answers: riddle.answers,
      messageID: animator.messageID,
    });
  } catch (error) {
    unlockGame(threadID, userID);

    console.error("[games] riddle:", error);

    await safeReply(api, event, "♡ Eclipse couldn't reveal a riddle.");
  }
}

async function resolveRiddle(api, event, answerText) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "riddle") {
    return false;
  }

  clearSession(threadID, userID);

  const normalized = normalizeAnswerText(answerText);

  const correct = session.answers.some(
    (answer) => normalizeAnswerText(answer) === normalized
  );

  try {
    const reward = await awardPlayer(threadID, userID, "riddle", correct);

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("riddle"),
      "",
      correct ? "♡ MYSTERY SOLVED" : "୨୧ NOT QUITE",
      "",
      `your answer · ${answerText}`,
      `correct · ${session.answers[0]}`,
      "",
      correct ? "you actually got me ♡" : "the riddle keeps its secret.",
      "",
      rewardLine(reward, balanceText, correct),
    ].join("\n");

    // EDIT #1: final result
    await sendResult(api, threadID, finalText);
  } catch (error) {
    console.error("[games] riddle reward:", error);
  }

  unlockGame(threadID, userID);

  return true;
}

// ============================================================
// 8-BALL
// ============================================================

const EIGHTBALL_RESPONSES = [
  "It is certain.",
  "It is decidedly so.",
  "Without a doubt.",
  "Yes definitely.",
  "You may rely on it.",
  "As I see it, yes.",
  "Most likely.",
  "Outlook good.",
  "Yes.",
  "Signs point to yes.",
  "Reply hazy, try again.",
  "Ask again later.",
  "Better not tell you now.",
  "Cannot predict now.",
  "Concentrate and ask again.",
  "Don't count on it.",
  "My reply is no.",
  "My sources say no.",
  "Outlook not so good.",
  "Very doubtful.",
];

async function handleEightBall(api, event, args) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(api, event, challengeBusyText());

    return;
  }

  try {
    const question = Array.isArray(args)
      ? args.join(" ")
      : String(args || "");

    if (!question.trim()) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "♡ ask Eclipse a question.");

      return;
    }

    // SEND
    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("8ball", playerLine(event)),
        "",
        "✧ ASK ECLIPSE ✧",
        "",
        `❝ ${question} ❞`,
        "",
        "thinking...",
        "",
        "          ◉",
      ].join("\n"),
      "8ball"
    );

    if (!animator.messageID) {
      unlockGame(threadID, userID);

      return;
    }

    await sleep(editDelay());

    const response =
      EIGHTBALL_RESPONSES[randInt(0, EIGHTBALL_RESPONSES.length - 1)];

    const reward = await awardPlayer(threadID, userID, "8ball", true);

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("8ball"),
      "",
      "♡ ECLIPSE SAYS",
      "",
      `❝ ${question} ❞`,
      "",
      "୨୧",
      "",
      `"${response}"`,
      "",
      thinDivider(),
      "",
      `♡ +${formatNumber(reward.coins)} coins`,
      `✧ +${formatNumber(reward.xp)} XP`,
      "",
      balanceText,
    ].join("\n");

    // EDIT #1: final result
    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] 8ball:", error);

    await safeReply(api, event, "♡ Eclipse couldn't answer that one.");
  } finally {
    unlockGame(threadID, userID);
  }
}

// ============================================================
// GAME STATUS
// ============================================================

async function handleGameStatus(api, event) {
  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  try {
    const user = await db.getUser(threadID, userID);

    const balance = formatNumber(user?.balance ?? 0);

    const xp = formatNumber(user?.xp ?? 0);

    const rpsStreak = formatNumber(user?.rps_streak ?? 0);

    const active = activeGames.has(sessionKey(threadID, userID));

    const session = getSession(threadID, userID);

    const sessionName = session?.type
      ? String(session.type).toUpperCase()
      : "NONE";

    await sendMessageAsync(
      api,
      threadID,
      [
        gameHeader("8ball", playerLine(event)),
        "",
        "♡ YOUR GAME PROFILE",
        "",
        `♡ wallet       ${balance}`,
        `✧ XP           ${xp}`,
        `୨୧ RPS streak  ${rpsStreak}`,
        "",
        `♡ active       ${active ? "YES" : "NO"}`,
        `✧ session      ${sessionName}`,
        "",
        thinDivider(),
        "",
        active
          ? "you have a little challenge waiting ♡"
          : "nothing is waiting for you.",
        "",
        "Eclipse remembers every result.",
      ].join("\n")
    );

    return true;
  } catch (error) {
    console.error("[games] status:", error);

    await safeReply(
      api,
      event,
      "♡ Eclipse couldn't retrieve your game status."
    );

    return true;
  }
}

// ============================================================
// GAME RULES
// ============================================================

async function handleGameRules(api, event) {
  const threadID = String(event.threadID);

  await sendMessageAsync(
    api,
    threadID,
    [
      "╭──────────────────────────────╮",
      "          ♡ ECLIPSE ♡",
      "           GAME RULES",
      "╰──────────────────────────────╯",
      "",
      "୨୧ CHALLENGES",
      "",
      "♡ !trivia",
      "   answer questions · +50 XP / +150 coins",
      "",
      "♡ !riddle",
      "   solve mysteries · +50 XP / +150 coins",
      "",
      "♡ !math",
      "   solve equations · +50 XP / +175 coins",
      "",
      thinDivider(),
      "",
      "✧ LUCK",
      "",
      "♡ !roll <bet> [sides] [tier]",
      "   safe · 1.5×",
      "   balanced · 2×",
      "   risky · 4×",
      "   wins open a 50/50 ladder · max 3",
      "",
      "୨୧ !coinflip <bet> <heads|tails>",
      "   correct calls open a 50/50 ladder",
      "   max 5 doubles",
      "",
      "♡ !slots <bet>",
      "   pair · 2×",
      "   triple · 10×",
      "   ⭐⭐⭐ · 15×",
      "   💎💎💎 · 20×",
      "",
      thinDivider(),
      "",
      "୨୧ SKILL",
      "",
      "♡ !guess <min> <max> [bet]",
      "   1st try · 4×",
      "   2nd try · 2.5×",
      "   3rd try · 1.5×",
      "   optional double-down before final guess",
      "",
      "୨୧ !rps <rock|paper|scissors>",
      "   best of 3",
      "   persistent win streak",
      "   streak boosts coins up to 2.5×",
      "",
      thinDivider(),
      "",
      "✧ TABLE",
      "",
      "♡ !blackjack <bet>",
      "   natural blackjack · 2.5×",
      "   win · 2×",
      "   push · wager refunded",
      "   !hit · !stand · !double",
      "",
      "🌑 !chamber · last chamber (pvp pot)",
      "   !chamber rules for the full rules",
      "",
      thinDivider(),
      "",
      "୨୧ ECLIPSE",
      "",
      "♡ !8ball <question>",
      "   ask me anything · no wager",
      "",
      "♡ !daily",
      "   claim your daily reward",
      "",
      "♡ !work",
      "   take a little shift",
      "",
      "after daily/work:",
      "reply 'gamble' or 'keep'",
      "",
      thinDivider(),
      "",
      `maximum wager · ${formatNumber(MAX_BET)} coins`,
      "",
      "wagers are charged before resolution.",
      "unexpected wager failures are refunded ♡",
      "",
      "♡ !games · return to the game room",
    ].join("\n")
  );

  return true;
}

// ============================================================
// GAME CENTER
// ============================================================

async function handleGameCenter(api, event) {
  const threadID = String(event.threadID);

  await sendMessageAsync(
    api,
    threadID,
    async function handleGameCenter(api, event) {
  const threadID = String(event.threadID);

  await sendMessageAsync(
    api,
    threadID,
    [
      "╭──────────────────────────────╮",
      "          ♡ ECLIPSE ♡",
      "           GAME ROOM",
      "╰──────────────────────────────╯",
      "",
      "       ୨୧ choose something ୨୧",
      "",
      "♡ LUCK",
      "   ┊ !roll       · roll the dice",
      "   ┊ !coinflip   · heads or tails",
      "   ┊ !slots      · try your luck",
      "   ┊ !guess      · guess the number",
      "",
      "♡ PLAY",
      "   ┊ !rps        · rock paper scissors",
      "   ┊ !blackjack  · beat the dealer",
      "   ┊ !chamber    · last chamber (pvp)",
      "",
      "♡ MIND",
      "   ┊ !trivia       · test your knowledge",
      "   ┊ !riddle       · solve a mystery",
      "   ┊ !math         · quick calculation",
      "   ┊ !exam         · take a little test",
      "   ┊ !investigator · solve the case",
      "",
      "♡ ECLIPSE",
      "   ┊ !8ball      · ask me anything",
      "",
      thinDivider(),
      "",
      "♡ COMING SOON",
      "   ┊ !simulation · coming soon",
      "   ┊ !debate     · coming soon",
      "",
      thinDivider(),
      "",
      "୨୧ OTHER",
      "   ┊ !daily      · daily reward",
      "   ┊ !work       · earn some coins",
      "",
      "♡ !games rules  · complete rules",
      "♡ !games status · your game status",
      "",
      "          ♡ have fun ♡",
    ].join("\n")
  );

  return true;
}

// ============================================================
// REPLY HELPER
// ============================================================

async function safeReply(api, event, text) {
  try {
    const threadID = String(event.threadID);

    const messageID = event.messageID;

    if (messageID && api.setMessageReaction) {
      await new Promise((resolve) => {
        api.setMessageReaction("❌", messageID, () => resolve(), true);
      });
    }

    await sendMessageAsync(api, threadID, text);
  } catch (error) {
    console.error("[games] safeReply:", error);
  }
}

// ============================================================
// ACTION WORDS (open-game replies typed as !commands)
// ============================================================

const SESSION_ACTIONS = {
  blackjack: ["hit", "stand", "double"],
  roll_ladder: ["cashout", "doubledown", "double", "keep"],
  coinflip_ladder: ["cashout", "doubledown", "double", "keep"],
  claim_gamble: ["gamble", "keep"],
  guess: ["doubledown", "double"],
};

const ACTION_COMMANDS = new Set(Object.values(SESSION_ACTIONS).flat());

// ============================================================
// MAIN GAME COMMAND DISPATCHER
// ============================================================

async function handleGameCommand(api, event, command, args) {
  const cmd = String(command || "").trim().toLowerCase();

  const normalizedArgs = normalizeArgs(args);

  // Action words typed like commands (the prompts show "!hit", "!stand"...)
  // are routed to the open game, but only when that game accepts them.
  if (ACTION_COMMANDS.has(cmd)) {
    const session = getSession(
      String(event.threadID),
      String(event.senderID)
    );

    if (session && (SESSION_ACTIONS[session.type] || []).includes(cmd)) {
      return handleGameResponse(api, event, cmd, cmd);
    }

    await safeReply(
      api,
      event,
      [
        "♡ ECLIPSE",
        "",
        "nothing is waiting for that.",
        "",
        "try !games to see what you can play ♡",
      ].join("\n")
    );

    return true;
  }

  if (cmd === "games") {
    const subcommand = String(normalizedArgs[0] || "")
      .trim()
      .toLowerCase();

    if (subcommand === "rules") {
      await handleGameRules(api, event);

      return true;
    }

    if (subcommand === "status") {
      await handleGameStatus(api, event);

      return true;
    }

    await handleGameCenter(api, event);

    return true;
  }

  // 🌑 LAST CHAMBER
  if (cmd === "chamber" || cmd === "roulette" || cmd === "lastchamber") {
    await handleChamber(api, event, normalizedArgs);

    return true;
  }

  if (cmd === "daily") {
    await handleDaily(api, event);

    return true;
  }

  if (cmd === "work") {
    await handleWork(api, event);

    return true;
  }

  if (cmd === "trivia") {
    await handleTrivia(api, event);
  } else if (cmd === "rps") {
    await handleRPS(api, event, normalizedArgs);
  } else if (cmd === "roll") {
    await handleRoll(api, event, normalizedArgs);
  } else if (cmd === "guess") {
    await handleGuess(api, event, normalizedArgs);
  } else if (cmd === "coinflip" || cmd === "flip") {
    await handleCoinFlip(api, event, normalizedArgs);
  } else if (cmd === "blackjack" || cmd === "bj") {
    await handleBlackjack(api, event, normalizedArgs);
  } else if (cmd === "slots" || cmd === "slot") {
    await handleSlots(api, event, normalizedArgs);
  } else if (cmd === "math") {
    await handleMath(api, event);
  } else if (cmd === "riddle") {
    await handleRiddle(api, event);
  } else if (cmd === "8ball" || cmd === "8-ball") {
    await handleEightBall(api, event, normalizedArgs);
  } else {
    await safeReply(
      api,
      event,
      [
        "♡ ECLIPSE",
        "",
        `"${cmd}" isn't in the game room.`,
        "",
        "try !games to see what's waiting for you ♡",
      ].join("\n")
    );

    return false;
  }

  return true;
}

// ============================================================
// GAME RESPONSE DISPATCHER
// ============================================================

async function handleGameResponse(api, event, responseText, originalText) {
  const answerText = String(originalText || responseText || "").trim();

  const threadID = String(event.threadID);

  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session) {
    return false;
  }

  if (session.type === "trivia") {
    return resolveTrivia(api, event, answerText);
  }

  if (session.type === "riddle") {
    return resolveRiddle(api, event, answerText);
  }

  if (session.type === "guess") {
    return resolveGuess(api, event, answerText);
  }

  if (session.type === "blackjack") {
    return resolveBlackjack(api, event, answerText);
  }

  if (session.type === "math") {
    return resolveMath(api, event, answerText);
  }

  if (session.type === "roll_ladder") {
    return resolveRollLadder(api, event, answerText);
  }

  if (session.type === "coinflip_ladder") {
    return resolveCoinflipLadder(api, event, answerText);
  }

  if (session.type === "claim_gamble") {
    return resolveClaimGamble(api, event, answerText);
  }

  return false;
}

// ============================================================
// 🌑 LAST CHAMBER  ·  PvP elimination pot game
// ------------------------------------------------------------
// PASTE THIS WHOLE FILE INTO games.js, directly ABOVE the
// "EXPORTS" banner at the bottom.
//
// Commands (aliases: !chamber / !roulette / !lastchamber)
//   !chamber                 panel
//   !chamber create          open a table
//   !chamber jackpot [bet]   open a jackpot table (4-8 players)
//   !chamber join <bet>      enter (opens a table if none exists)
//   !chamber leave           leave before the start (refund)
//   !chamber start           seal the chamber (host)
//   !chamber status
//   !chamber continue        stay in after a round
//   !chamber cashout         take the offer after a round
//   !chamber cancel          cancel the lobby + refund (host/admin)
//   !chamber history         your record
//   !chamber rules
//
// Design notes
//  * Wager is removed from the wallet the moment you join, in the
//    SAME SQL statement that seats you. Same for refunds, cash-outs
//    and the final payout, so coins can never be lost or duplicated.
//  * Every round is written to the database BEFORE it is revealed.
//    After a crash, initLastChamber() restores the table and the
//    game resumes.
//  * RNG is crypto.randomInt on the server. Nobody sees the result
//    before the reveal.
//  * Fair odds: each round the chamber claims a player with
//    probability proportional to (totalWagers - theirWager). This
//    makes every player's chance to be the LAST survivor exactly
//    proportional to their wager (so a 2M bet is not a free gift
//    to a 100k bet).
// ============================================================

const chamberCrypto = require("crypto");

const CHAMBER = {
  minPlayers: 2,
  maxPlayers: 8,
  minBet: 100_000,
  maxBet: 2_000_000,

  jackpotMinPlayers: 4,
  jackpotMinBet: 500_000,

  lobbyTimeoutMs: 10 * 60 * 1000,
  decisionMs: 25_000,
  startDelayMs: 2_500,
  revealMinMs: 1_800,
  revealJitterMs: 900,
  retryMs: 15_000,
  maxRoundRetries: 5,
  sendTimeoutMs: 20_000,

  // Cash-out offer = this % of the survivor's FAIR SHARE of the pot
  // (pot x their wager / all alive wagers). Round 1 uses [0],
  // round 2 uses [1], ... and the last value repeats.
  // NOTE: a % of the *whole* pot would be a free win in big lobbies
  // (8 players, round 1: 25% of the pot for a 1-in-8 stake).
  cashoutPct: [0.25, 0.4, 0.6, 0.8],
};

const CHAMBER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chamber_sessions (
    id BIGSERIAL PRIMARY KEY,
    thread_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'lobby',
    mode TEXT NOT NULL DEFAULT 'standard',
    host_id TEXT NOT NULL,
    pot BIGINT NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 8,
    current_round INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    started_at BIGINT,
    ended_at BIGINT,
    winner_id TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS chamber_one_open_per_thread
     ON chamber_sessions(thread_id)
     WHERE status IN ('lobby', 'active')`,
  `CREATE TABLE IF NOT EXISTS chamber_players (
    session_id BIGINT NOT NULL REFERENCES chamber_sessions(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT,
    wager BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'alive',
    turn_order INTEGER,
    payout BIGINT NOT NULL DEFAULT 0,
    survived_rounds INTEGER NOT NULL DEFAULT 0,
    joined_at BIGINT NOT NULL,
    eliminated_at BIGINT,
    PRIMARY KEY (session_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS chamber_players_user_idx
     ON chamber_players(thread_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS chamber_rounds (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES chamber_sessions(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chamber_rounds_session_idx
     ON chamber_rounds(session_id, round_number)`,
];

// threadID -> live session
const chamberSessions = new Map();
// threadID -> promise tail (serialises every mutation per thread)
const chamberLocks = new Map();

let chamberApi = null;
let chamberSchemaPromise = null;

// ------------------------------------------------------------
// GENERIC HELPERS
// ------------------------------------------------------------

function withChamberLock(threadID, fn) {
  const key = String(threadID);
  const previous = chamberLocks.get(key) || Promise.resolve();
  const run = previous.then(fn);
  const tail = run.catch(() => {});

  chamberLocks.set(key, tail);

  tail.then(() => {
    if (chamberLocks.get(key) === tail) {
      chamberLocks.delete(key);
    }
  });

  return run;
}

function chamberWithTimeout(promise, ms, label = "operation") {
  let timer;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function chamberIsAdmin(userID) {
  return (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(String(userID));
}

function chamberHalted() {
  return global.botDisabled === true || global.botPaused === true;
}

function chamberLimits(mode) {
  if (mode === "jackpot") {
    return {
      minPlayers: CHAMBER.jackpotMinPlayers,
      minBet: CHAMBER.jackpotMinBet,
      maxBet: CHAMBER.maxBet,
    };
  }

  return {
    minPlayers: CHAMBER.minPlayers,
    minBet: CHAMBER.minBet,
    maxBet: CHAMBER.maxBet,
  };
}

// "2000000", "2,000,000", "500k", "1.5m"
function chamberParseBet(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[,_\s]/g, "");

  const match = raw.match(/^(\d+(?:\.\d+)?)([km])?$/);

  if (!match) return NaN;

  let amount = Number(match[1]);

  if (match[2] === "k") amount *= 1_000;
  if (match[2] === "m") amount *= 1_000_000;

  amount = Math.round(amount);

  return Number.isSafeInteger(amount) ? amount : NaN;
}

function chamberRoman(value) {
  const table = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];

  let n = Math.max(1, Math.floor(Number(value) || 1));
  let out = "";

  for (const [amount, symbol] of table) {
    while (n >= amount) {
      out += symbol;
      n -= amount;
    }
  }

  return out;
}

function chamberShuffle(list) {
  const arr = list.slice();

  for (let i = arr.length - 1; i > 0; i--) {
    const j = chamberCrypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

// Server-side hidden outcome. Elimination weight = (total - wager).
// See design notes: this gives each player a win chance that is
// exactly wager / total wagers.
function chamberPickEliminated(alive) {
  const total = alive.reduce((sum, p) => sum + p.wager, 0);
  const weights = alive.map((p) => total - p.wager);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);

  let roll = chamberCrypto.randomInt(0, weightSum);

  for (let i = 0; i < alive.length; i++) {
    roll -= weights[i];

    if (roll < 0) return alive[i];
  }

  return alive[alive.length - 1];
}

function chamberAlive(s) {
  const ids = s.order.length ? s.order : Array.from(s.players.keys());

  return ids
    .map((id) => s.players.get(id))
    .filter((p) => p && p.status === "alive");
}

function chamberLabel(p) {
  const raw = String(
    p.name || `Player ${String(p.userID).slice(-4)}`
  ).trim();

  return raw.toUpperCase().slice(0, 18);
}

function chamberOdds(s, p) {
  const pool =
    s.status === "lobby"
      ? Array.from(s.players.values())
      : chamberAlive(s);

  const total = pool.reduce((sum, x) => sum + x.wager, 0);

  return total > 0 ? Math.round((p.wager / total) * 100) : 0;
}

function chamberCashoutPct(s) {
  const index =
    Math.min(Math.max(s.round, 1), CHAMBER.cashoutPct.length) - 1;

  return CHAMBER.cashoutPct[index];
}

function chamberCashoutOffer(s, p) {
  const alive = chamberAlive(s);
  const totalWager = alive.reduce((sum, a) => sum + a.wager, 0);

  if (totalWager <= 0) return 0;

  const fairShare = (s.pot * p.wager) / totalWager;

  return Math.max(1, Math.floor(fairShare * chamberCashoutPct(s)));
}

async function chamberSend(threadID, text) {
  if (!chamberApi) return null;

  try {
    return await chamberWithTimeout(
      sendMessageAsync(chamberApi, threadID, text),
      CHAMBER.sendTimeoutMs,
      "send"
    );
  } catch (error) {
    console.error(
      "[chamber] send failed:",
      error && error.message ? error.message : error
    );

    return null;
  }
}

function chamberFail(api, event, message) {
  return safeReply(
    api,
    event,
    ["🌑 LAST CHAMBER", "", String(message)].join("\n")
  );
}

async function chamberResolveName(api, event, threadID, userID) {
  if (event && event.senderName) {
    return String(event.senderName).trim().slice(0, 40);
  }

  try {
    const user = await db.getUser(threadID, userID);

    if (user && user.display_name && String(user.display_name).trim()) {
      return String(user.display_name).trim().slice(0, 40);
    }
  } catch {}

  try {
    if (api && typeof api.getUserInfo === "function") {
      const info = await chamberWithTimeout(
        new Promise((resolve, reject) => {
          api.getUserInfo(userID, (error, data) =>
            error ? reject(error) : resolve(data)
          );
        }),
        4000,
        "getUserInfo"
      );

      const entry = info && (info[userID] || Object.values(info)[0]);
      const name = entry && (entry.name || entry.firstName);

      if (name) {
        db.setUserDisplayName(threadID, userID, name).catch(() => {});

        return String(name).trim().slice(0, 40);
      }
    }
  } catch {}

  return `Player ${String(userID).slice(-4)}`;
}

// ------------------------------------------------------------
// TEXT
// ------------------------------------------------------------

const CHAMBER_LINE = "━━━━━━━━━━━━━━━━━━━━━━";

function chamberHeader(s) {
  return [
    "╔══════════════════════════════╗",
    "        🌑 LAST CHAMBER",
    s && s.mode === "jackpot" ? "          ✦ JACKPOT ✦" : "",
    "╚══════════════════════════════╝",
  ]
    .filter(Boolean)
    .join("\n");
}

function chamberLobbyText(s) {
  const limits = chamberLimits(s.mode);
  const players = Array.from(s.players.values());

  const lines = [
    chamberHeader(s),
    s.mode === "jackpot"
      ? "ONLY ONE LEAVES WITH THE POT."
      : "A game of chance.",
    "One survivor takes the pot.",
    "",
    `Players: ${players.length} / ${s.maxPlayers}`,
    `Pot: 🪙 ${formatNumber(s.pot)}`,
    "",
  ];

  if (players.length === 0) {
    lines.push("The chamber is empty.");
  } else {
    lines.push("Current players:");

    for (const p of players) {
      lines.push(
        `◆ ${chamberLabel(p)}   ${formatNumber(p.wager)}  (${chamberOdds(s, p)}%)`
      );
    }
  }

  lines.push(
    "",
    `Minimum bet: ${formatNumber(limits.minBet)}`,
    `Maximum bet: ${formatNumber(limits.maxBet)}`,
    `Needs ${limits.minPlayers}+ players to start.`,
    "",
    "!chamber join <bet>",
    "!chamber leave",
    "!chamber start"
  );

  return lines.join("\n");
}

function chamberNoTableText() {
  return [
    chamberHeader(null),
    "No chamber is open.",
    "A game of chance. One survivor takes the pot.",
    "",
    "!chamber join <bet>  · open + enter",
    "!chamber create      · open a table",
    "!chamber jackpot     · 4-8 players, 500k+",
    "!chamber rules",
    "!chamber history",
    "",
    `Bets: ${formatNumber(CHAMBER.minBet)} – ${formatNumber(CHAMBER.maxBet)}`,
  ].join("\n");
}

function chamberOfferLines(s) {
  const alive = chamberAlive(s);
  const pct = Math.round(chamberCashoutPct(s) * 100);

  const lines = [
    CHAMBER_LINE,
    "The chamber remains open.",
    "",
    `CASH-OUT OFFER · ${pct}% of your share`,
  ];

  for (const p of alive) {
    lines.push(
      `◆ ${chamberLabel(p)}  🪙 ${formatNumber(chamberCashoutOffer(s, p))}`
    );
  }

  lines.push(
    "",
    "!chamber cashout  · take the offer",
    "!chamber continue · stay in",
    `Next round in ${Math.round(CHAMBER.decisionMs / 1000)}s.`
  );

  return lines;
}

function chamberStartText(s) {
  const lines = [
    chamberHeader(s),
    `Participants: ${s.order.length}`,
    `Pot: 🪙 ${formatNumber(s.pot)}`,
    "",
  ];

  s.order.forEach((id, index) => {
    const p = s.players.get(id);

    lines.push(
      `${index + 1}. ${chamberLabel(p)}  ${formatNumber(p.wager)}  (${chamberOdds(s, p)}%)`
    );
  });

  lines.push(
    "",
    "Turn order has been sealed.",
    "The losing position is hidden.",
    "The game begins..."
  );

  return lines.join("\n");
}

function chamberRoundOpenText(s, roundNo) {
  return [
    chamberHeader(s),
    "",
    `           ROUND ${chamberRoman(roundNo)}`,
    `        POT 🪙 ${formatNumber(s.pot)}`,
    CHAMBER_LINE,
    "        THE CHAMBER TURNS...",
    "",
    "               ◇",
    "               ...",
    "",
    "        fate is choosing.",
  ].join("\n");
}

function chamberRoundResultText(s, roundNo, turns, doomed, survivors) {
  const lines = [
    chamberHeader(s),
    "",
    `           ROUND ${chamberRoman(roundNo)}`,
    CHAMBER_LINE,
  ];

  for (const turn of turns) {
    lines.push(
      turn.eliminated
        ? `◆ ${chamberLabel(turn.player)} — CLICK. ELIMINATED.`
        : `◇ ${chamberLabel(turn.player)} — click. survives.`
    );
  }

  lines.push(
    CHAMBER_LINE,
    `☠ ${chamberLabel(doomed)} HAS FALLEN.`,
    "Wager forfeited:",
    `🪙 ${formatNumber(doomed.wager)}`,
    "",
    `Current pot: 🪙 ${formatNumber(s.pot)}`,
    "",
    "Remaining players:"
  );

  for (const p of survivors) {
    lines.push(`◆ ${chamberLabel(p)}`);
  }

  if (survivors.length > 1) {
    lines.push("", ...chamberOfferLines(s));
  }

  return lines.join("\n");
}

function chamberStatusText(s) {
  if (s.status === "lobby") return chamberLobbyText(s);

  const lines = [
    chamberHeader(s),
    "",
    `ROUND ${chamberRoman(Math.max(1, s.round))}`,
    `POT 🪙 ${formatNumber(s.pot)}`,
    CHAMBER_LINE,
  ];

  if (s.phase === "resolving" || s.phase === "settling") {
    lines.push("THE CHAMBER IS TURNING...");
    return lines.join("\n");
  }

  for (const id of s.order) {
    const p = s.players.get(id);

    if (!p) continue;

    if (p.status === "alive") {
      lines.push(`◆ ${chamberLabel(p)}   ALIVE  (${chamberOdds(s, p)}%)`);
    } else if (p.status === "cashed_out") {
      lines.push(
        `◇ ${chamberLabel(p)}   CASHED OUT  🪙 ${formatNumber(p.payout)}`
      );
    } else {
      lines.push(`☠ ${chamberLabel(p)}   ELIMINATED`);
    }
  }

  if (s.phase === "decision") {
    const seconds = Math.max(
      0,
      Math.ceil((s.decisionEndsAt - Date.now()) / 1000)
    );

    lines.push(
      CHAMBER_LINE,
      `Decision window: ${seconds}s`,
      "!chamber cashout · !chamber continue"
    );
  }

  return lines.join("\n");
}

function chamberWinnerText(s, winner, prize, balance) {
  const net = prize - winner.wager;

  const lines = [
    chamberHeader(s),
    "",
    "        ◇ FINAL RESULT ◇",
    "",
    `${chamberLabel(winner)} SURVIVES.`,
    "",
    CHAMBER_LINE,
    "🏆 LAST SURVIVOR",
    chamberLabel(winner),
    CHAMBER_LINE,
    "Prize:",
    `🪙 ${formatNumber(prize)}`,
    "Wager:",
    `🪙 ${formatNumber(winner.wager)}`,
    "Net gain:",
    `🪙 ${net >= 0 ? "+" : "-"}${formatNumber(Math.abs(net))}`,
    CHAMBER_LINE,
  ];

  if (Number.isFinite(balance)) {
    lines.push(`Wallet: 🪙 ${formatNumber(balance)}`);
  }

  return lines.join("\n");
}

function chamberRulesText() {
  return [
    chamberHeader(null),
    "RULES",
    "",
    "◆ 2–8 players put coins into one shared pot.",
    "◆ Every round the chamber secretly claims one player. Their wager stays in the pot.",
    "◆ The last survivor takes the entire pot.",
    "◆ Odds follow your wager: double the coins, double the chance to be the survivor. The lobby shows your %.",
    "",
    "◆ After each round survivors may:",
    "   !chamber cashout  · guaranteed offer",
    "   !chamber continue · stay in",
    "   The offer rises each round (25% → 80% of your share). No answer in 25s = continue.",
    "",
    `◆ Bets ${formatNumber(CHAMBER.minBet)} – ${formatNumber(CHAMBER.maxBet)}.`,
    `◆ Jackpot: 4–8 players, ${formatNumber(CHAMBER.jackpotMinBet)}+ each.`,
    "◆ Wagers are sealed once you join. You may leave only before the start.",
    "◆ A cancelled table refunds everyone.",
  ].join("\n");
}

// ------------------------------------------------------------
// DATABASE
// Every money movement is ONE SQL statement (CTEs), so it is
// atomic: wallet + pot + player row change together or not at all.
// ------------------------------------------------------------

function chamberEnsureReady() {
  if (!chamberSchemaPromise) {
    chamberSchemaPromise = (async () => {
      for (const statement of CHAMBER_SCHEMA) {
        await db.query(statement);
      }
    })().catch((error) => {
      chamberSchemaPromise = null;
      throw error;
    });
  }

  return chamberSchemaPromise;
}

const chamberStore = {
  async createSession(threadID, mode, hostID, maxPlayers) {
    const { rows } = await db.query(
      `
      INSERT INTO chamber_sessions(
        thread_id, status, mode, host_id, pot,
        max_players, current_round, created_at
      )
      VALUES($1, 'lobby', $2, $3, 0, $4, 0, $5)
      RETURNING id
      `,
      [String(threadID), mode, String(hostID), maxPlayers, Date.now()]
    );

    return Number(rows[0].id);
  },

  // -> { balance, pot } or null (not enough coins / lobby closed)
  async join(sessionId, threadID, userID, wager, name) {
    const { rows } = await db.query(
      `
      WITH s AS (
        SELECT id FROM chamber_sessions
        WHERE id = $1 AND status = 'lobby'
      ),
      spent AS (
        UPDATE users
        SET balance = balance - $4::bigint
        WHERE thread_id = $2 AND user_id = $3
          AND balance >= $4::bigint
          AND EXISTS (SELECT 1 FROM s)
        RETURNING balance
      ),
      ins AS (
        INSERT INTO chamber_players(
          session_id, thread_id, user_id, display_name,
          wager, status, joined_at
        )
        SELECT $1::bigint, $2::text, $3::text, $5::text,
               $4::bigint, 'alive', $6::bigint
        FROM spent
        RETURNING user_id
      ),
      sess AS (
        UPDATE chamber_sessions
        SET pot = pot + $4::bigint
        WHERE id = $1 AND EXISTS (SELECT 1 FROM ins)
        RETURNING pot
      ),
      tx AS (
        INSERT INTO economy_transactions(
          thread_id, user_id, type, amount, description, created_at
        )
        SELECT $2::text, $3::text, 'chamber_wager', $4::int,
               'Last Chamber wager', $6::bigint
        FROM ins
        RETURNING 1
      )
      SELECT
        (SELECT balance FROM spent) AS balance,
        (SELECT pot FROM sess) AS pot
      `,
      [
        Number(sessionId),
        String(threadID),
        String(userID),
        wager,
        String(name || ""),
        Date.now(),
      ]
    );

    const row = rows[0];

    if (!row || row.balance === null || row.pot === null) return null;

    return { balance: Number(row.balance), pot: Number(row.pot) };
  },

  // -> { balance, pot, wager } or null
  async leave(sessionId, threadID, userID) {
    const { rows } = await db.query(
      `
      WITH del AS (
        DELETE FROM chamber_players
        WHERE session_id = $1 AND user_id = $3 AND status = 'alive'
          AND EXISTS (
            SELECT 1 FROM chamber_sessions
            WHERE id = $1 AND status = 'lobby'
          )
        RETURNING wager
      ),
      back AS (
        UPDATE users
        SET balance = balance + (SELECT wager FROM del)
        WHERE thread_id = $2 AND user_id = $3
          AND EXISTS (SELECT 1 FROM del)
        RETURNING balance
      ),
      sess AS (
        UPDATE chamber_sessions
        SET pot = pot - (SELECT wager FROM del)
        WHERE id = $1 AND EXISTS (SELECT 1 FROM del)
        RETURNING pot
      ),
      tx AS (
        INSERT INTO economy_transactions(
          thread_id, user_id, type, amount, description, created_at
        )
        SELECT $2::text, $3::text, 'chamber_refund', wager::int,
               'Last Chamber refund', $4::bigint
        FROM del
        RETURNING 1
      )
      SELECT
        (SELECT balance FROM back) AS balance,
        (SELECT pot FROM sess) AS pot,
        (SELECT wager FROM del) AS wager
      `,
      [Number(sessionId), String(threadID), String(userID), Date.now()]
    );

    const row = rows[0];

    if (!row || row.balance === null) return null;

    return {
      balance: Number(row.balance),
      pot: Number(row.pot),
      wager: Number(row.wager),
    };
  },

  async setHost(sessionId, hostID) {
    await db.query(
      `UPDATE chamber_sessions SET host_id = $2 WHERE id = $1`,
      [Number(sessionId), String(hostID)]
    );
  },

  // Refunds every seated player. -> { cancelled, refunded }
  async cancel(sessionId) {
    const { rows } = await db.query(
      `
      WITH s AS (
        UPDATE chamber_sessions
        SET status = 'cancelled', ended_at = $2::bigint, pot = 0
        WHERE id = $1 AND status = 'lobby'
        RETURNING id
      ),
      refunded AS (
        UPDATE users u
        SET balance = u.balance + cp.wager
        FROM chamber_players cp
        WHERE cp.session_id = $1 AND cp.status = 'alive'
          AND u.thread_id = cp.thread_id AND u.user_id = cp.user_id
          AND EXISTS (SELECT 1 FROM s)
        RETURNING u.user_id
      ),
      tx AS (
        INSERT INTO economy_transactions(
          thread_id, user_id, type, amount, description, created_at
        )
        SELECT cp.thread_id, cp.user_id, 'chamber_refund', cp.wager::int,
               'Last Chamber refund', $2::bigint
        FROM chamber_players cp
        WHERE cp.session_id = $1 AND cp.status = 'alive'
          AND EXISTS (SELECT 1 FROM s)
        RETURNING 1
      ),
      pl AS (
        UPDATE chamber_players
        SET status = 'refunded', payout = wager
        WHERE session_id = $1 AND status = 'alive'
          AND EXISTS (SELECT 1 FROM s)
        RETURNING 1
      )
      SELECT
        (SELECT COUNT(*) FROM s)::int AS cancelled,
        (SELECT COUNT(*) FROM refunded)::int AS refunded
      `,
      [Number(sessionId), Date.now()]
    );

    return {
      cancelled: Number(rows[0]?.cancelled) > 0,
      refunded: Number(rows[0]?.refunded) || 0,
    };
  },

  // -> true when the lobby was moved to 'active'
  async start(sessionId, order) {
    const { rows } = await db.query(
      `
      WITH s AS (
        UPDATE chamber_sessions
        SET status = 'active', started_at = $3::bigint
        WHERE id = $1 AND status = 'lobby'
        RETURNING id
      ),
      o AS (
        SELECT t.uid, t.ord::int AS ord
        FROM unnest($2::text[]) WITH ORDINALITY AS t(uid, ord)
      ),
      p AS (
        UPDATE chamber_players cp
        SET turn_order = o.ord
        FROM o
        WHERE cp.session_id = $1 AND cp.user_id = o.uid
          AND EXISTS (SELECT 1 FROM s)
        RETURNING 1
      )
      SELECT (SELECT COUNT(*) FROM s)::int AS started
      `,
      [Number(sessionId), order.map(String), Date.now()]
    );

    return Number(rows[0]?.started) > 0;
  },

  // Persists one round (result BEFORE it is revealed). -> true if stored
  async recordRound(
    sessionId,
    roundNo,
    eliminatedId,
    survivorIds,
    turnIds,
    turnOutcomes
  ) {
    const { rows } = await db.query(
      `
      WITH e AS (
        UPDATE chamber_players
        SET status = 'eliminated', eliminated_at = $7::bigint
        WHERE session_id = $1 AND user_id = $3 AND status = 'alive'
          AND $2::int > (
            SELECT current_round FROM chamber_sessions
            WHERE id = $1 AND status = 'active'
          )
        RETURNING 1
      ),
      sv AS (
        UPDATE chamber_players
        SET survived_rounds = survived_rounds + 1
        WHERE session_id = $1 AND user_id = ANY($4::text[])
          AND status = 'alive'
          AND $2::int > (
            SELECT current_round FROM chamber_sessions
            WHERE id = $1 AND status = 'active'
          )
        RETURNING 1
      ),
      r AS (
        INSERT INTO chamber_rounds(
          session_id, round_number, player_id, outcome, created_at
        )
        SELECT $1::bigint, $2::int, t.uid, t.oc, $7::bigint
        FROM unnest($5::text[], $6::text[]) AS t(uid, oc)
        WHERE $2::int > (
          SELECT current_round FROM chamber_sessions
          WHERE id = $1 AND status = 'active'
        )
        RETURNING 1
      ),
      s AS (
        UPDATE chamber_sessions
        SET current_round = $2::int
        WHERE id = $1 AND status = 'active'
          AND current_round < $2::int
        RETURNING id
      )
      SELECT
        (SELECT COUNT(*) FROM s)::int AS ok,
        (SELECT COUNT(*) FROM e)::int AS eliminated
      `,
      [
        Number(sessionId),
        roundNo,
        String(eliminatedId),
        survivorIds.map(String),
        turnIds.map(String),
        turnOutcomes,
        Date.now(),
      ]
    );

    return (
      Number(rows[0]?.ok) > 0 && Number(rows[0]?.eliminated) > 0
    );
  },

  // -> { balance, pot } or null
  async cashout(sessionId, threadID, userID, amount) {
    const { rows } = await db.query(
      `
      WITH pl AS (
        UPDATE chamber_players
        SET status = 'cashed_out', payout = $3::bigint
        WHERE session_id = $1 AND user_id = $2 AND status = 'alive'
          AND EXISTS (
            SELECT 1 FROM chamber_sessions
            WHERE id = $1 AND status = 'active'
          )
        RETURNING user_id
      ),
      sp AS (
        UPDATE chamber_sessions
        SET pot = pot - $3::bigint
        WHERE id = $1 AND EXISTS (SELECT 1 FROM pl)
        RETURNING pot
      ),
      bk AS (
        UPDATE users
        SET balance = balance + $3::bigint
        WHERE thread_id = $4 AND user_id = $2
          AND EXISTS (SELECT 1 FROM pl)
        RETURNING balance
      ),
      tx AS (
        INSERT INTO economy_transactions(
          thread_id, user_id, type, amount, description, created_at
        )
        SELECT $4::text, $2::text, 'chamber_cashout', $3::int,
               'Last Chamber cash-out', $5::bigint
        FROM pl
        RETURNING 1
      )
      SELECT
        (SELECT balance FROM bk) AS balance,
        (SELECT pot FROM sp) AS pot
      `,
      [
        Number(sessionId),
        String(userID),
        amount,
        String(threadID),
        Date.now(),
      ]
    );

    const row = rows[0];

    if (!row || row.balance === null || row.pot === null) return null;

    return { balance: Number(row.balance), pot: Number(row.pot) };
  },

  // Pays the pot to the winner and closes the session (once only).
  // -> { settled, prize, balance }
  async settle(sessionId, threadID, winnerId) {
    const { rows } = await db.query(
      `
      WITH s AS (
        UPDATE chamber_sessions
        SET status = 'ended', ended_at = $4::bigint, winner_id = $2::text
        WHERE id = $1 AND status = 'active'
        RETURNING pot
      ),
      pl AS (
        UPDATE chamber_players
        SET status = 'winner', payout = (SELECT pot FROM s)
        WHERE session_id = $1 AND user_id = $2
          AND EXISTS (SELECT 1 FROM s)
        RETURNING user_id
      ),
      bk AS (
        UPDATE users
        SET balance = balance + (SELECT pot FROM s)
        WHERE thread_id = $3 AND user_id = $2
          AND EXISTS (SELECT 1 FROM s)
        RETURNING balance
      ),
      tx AS (
        INSERT INTO economy_transactions(
          thread_id, user_id, type, amount, description, created_at
        )
        SELECT $3::text, $2::text, 'chamber_win', pot::int,
               'Last Chamber prize', $4::bigint
        FROM s
        RETURNING 1
      )
      SELECT
        (SELECT COUNT(*) FROM s)::int AS settled,
        (SELECT pot FROM s) AS prize,
        (SELECT balance FROM bk) AS balance
      `,
      [Number(sessionId), String(winnerId), String(threadID), Date.now()]
    );

    const row = rows[0] || {};

    return {
      settled: Number(row.settled) > 0,
      prize: Number(row.prize) || 0,
      balance: row.balance === null ? NaN : Number(row.balance),
    };
  },

  async loadOpen() {
    const sessions = await db.query(
      `
      SELECT * FROM chamber_sessions
      WHERE status IN ('lobby', 'active')
      ORDER BY id
      `
    );

    if (!sessions.rows.length) return { sessions: [], players: [] };

    const players = await db.query(
      `
      SELECT * FROM chamber_players
      WHERE session_id = ANY($1::bigint[])
      ORDER BY turn_order NULLS LAST, joined_at, user_id
      `,
      [sessions.rows.map((row) => String(row.id))]
    );

    return { sessions: sessions.rows, players: players.rows };
  },

  async stats(threadID, userID) {
    const totals = await db.query(
      `
      SELECT
        COUNT(*)::int AS games,
        COALESCE(SUM(p.survived_rounds), 0)::int AS survived,
        COUNT(*) FILTER (WHERE p.status = 'winner')::int AS victories,
        COUNT(*) FILTER (WHERE p.status = 'eliminated')::int AS eliminations,
        COALESCE(SUM(GREATEST(p.payout - p.wager, 0)), 0)::bigint AS coins_won,
        COALESCE(SUM(GREATEST(p.wager - p.payout, 0)), 0)::bigint AS coins_lost
      FROM chamber_players p
      JOIN chamber_sessions s ON s.id = p.session_id
      WHERE p.thread_id = $1 AND p.user_id = $2 AND s.status = 'ended'
      `,
      [String(threadID), String(userID)]
    );

    const recent = await db.query(
      `
      SELECT s.id, p.status, p.wager, p.payout
      FROM chamber_players p
      JOIN chamber_sessions s ON s.id = p.session_id
      WHERE p.thread_id = $1 AND p.user_id = $2 AND s.status = 'ended'
      ORDER BY s.ended_at DESC
      LIMIT 5
      `,
      [String(threadID), String(userID)]
    );

    return { totals: totals.rows[0] || {}, recent: recent.rows };
  },
};

// ------------------------------------------------------------
// TIMERS
// ------------------------------------------------------------

function chamberClearTimers(s) {
  clearTimeout(s.lobbyTimer);
  clearTimeout(s.decisionTimer);
  clearTimeout(s.retryTimer);

  s.lobbyTimer = null;
  s.decisionTimer = null;
  s.retryTimer = null;
}

function chamberArmLobbyTimer(s, ms = CHAMBER.lobbyTimeoutMs) {
  clearTimeout(s.lobbyTimer);

  s.lobbyTimer = setTimeout(() => {
    s.lobbyTimer = null;

    withChamberLock(s.threadID, () => chamberExpireLobby(s)).catch(
      (error) => console.error("[chamber] lobby expiry:", error)
    );
  }, ms);
}

function chamberArmDecisionTimer(s, ms = CHAMBER.decisionMs) {
  clearTimeout(s.decisionTimer);

  s.decisionEndsAt = Date.now() + ms;

  s.decisionTimer = setTimeout(() => {
    s.decisionTimer = null;

    withChamberLock(s.threadID, () => chamberAdvance(s)).catch((error) =>
      console.error("[chamber] advance:", error)
    );
  }, ms);
}

// ------------------------------------------------------------
// LOBBY LIFECYCLE
// ------------------------------------------------------------

async function chamberOpenTable(threadID, hostID, mode) {
  const id = await chamberStore.createSession(
    threadID,
    mode,
    hostID,
    CHAMBER.maxPlayers
  );

  const s = {
    id,
    threadID: String(threadID),
    status: "lobby",
    phase: "lobby",
    mode,
    hostID: String(hostID),
    pot: 0,
    maxPlayers: CHAMBER.maxPlayers,
    round: 0,
    players: new Map(),
    order: [],
    lobbyTimer: null,
    decisionTimer: null,
    retryTimer: null,
    retryCount: 0,
    decisionEndsAt: 0,
    createdAt: Date.now(),
  };

  chamberSessions.set(s.threadID, s);
  chamberArmLobbyTimer(s);

  return s;
}

async function chamberCancelLobby(s, reason) {
  const result = await chamberStore.cancel(s.id);

  chamberClearTimers(s);

  s.status = "cancelled";
  s.phase = "done";

  if (chamberSessions.get(s.threadID) === s) {
    chamberSessions.delete(s.threadID);
  }

  const refunded = result.refunded;

  await chamberSend(
    s.threadID,
    [
      chamberHeader(s),
      "",
      "THE CHAMBER HAS CLOSED.",
      reason,
      "",
      refunded > 0
        ? `All ${refunded} wager${refunded === 1 ? "" : "s"} refunded.`
        : "No wagers were placed.",
    ].join("\n")
  );
}

async function chamberExpireLobby(s) {
  if (chamberSessions.get(s.threadID) !== s || s.status !== "lobby") {
    return;
  }

  try {
    await chamberCancelLobby(s, "The lobby expired.");
  } catch (error) {
    console.error("[chamber] expire failed, retrying:", error);

    chamberArmLobbyTimer(s, 60_000);
  }
}

// Joins under the thread lock. Opens a table if none exists.
async function chamberDoJoin(api, event, betText, forcedMode) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  let s = chamberSessions.get(threadID) || null;

  const mode = s ? s.mode : forcedMode || "standard";
  const limits = chamberLimits(mode);
  const bet = chamberParseBet(betText);

  if (!Number.isFinite(bet) || bet < limits.minBet || bet > limits.maxBet) {
    await chamberFail(
      api,
      event,
      [
        "usage · !chamber join <bet>",
        "",
        `minimum · ${formatNumber(limits.minBet)}`,
        `maximum · ${formatNumber(limits.maxBet)}`,
        "",
        "you can write 500k or 1.5m.",
      ].join("\n")
    );

    return;
  }

  if (s && s.status !== "lobby") {
    await chamberFail(
      api,
      event,
      "the chamber is already sealed.\nwait for the next one."
    );

    return;
  }

  if (s && s.players.has(userID)) {
    await chamberFail(
      api,
      event,
      "you are already inside.\nwagers are sealed once placed."
    );

    return;
  }

  if (s && s.players.size >= s.maxPlayers) {
    await chamberFail(api, event, "the chamber is full.");

    return;
  }

  let created = false;

  if (!s) {
    try {
      s = await chamberOpenTable(threadID, userID, mode);
      created = true;
    } catch (error) {
      if (error && error.code === "23505") {
        await chamberFail(
          api,
          event,
          "a chamber is still being restored here.\ntry again in a moment."
        );

        return;
      }

      throw error;
    }
  }

  await db.getUser(threadID, userID);

  const name = await chamberResolveName(api, event, threadID, userID);

  let joined = null;

  try {
    joined = await chamberStore.join(s.id, threadID, userID, bet, name);
  } catch (error) {
    console.error("[chamber] join failed:", error);
  }

  if (!joined) {
    let balance = 0;

    try {
      balance = Number((await db.getUser(threadID, userID))?.balance) || 0;
    } catch {}

    if (created && s.players.size === 0) {
      await chamberStore.cancel(s.id).catch(() => {});
      chamberClearTimers(s);
      chamberSessions.delete(threadID);
    }

    await chamberFail(
      api,
      event,
      [
        "you cannot afford that wager.",
        "",
        `wager  · ${formatNumber(bet)}`,
        `wallet · ${formatNumber(balance)}`,
      ].join("\n")
    );

    return;
  }

  s.players.set(userID, {
    userID,
    name,
    wager: bet,
    status: "alive",
    turnOrder: null,
    payout: 0,
    survivedRounds: 0,
    ready: false,
  });

  s.pot = joined.pot;

  chamberArmLobbyTimer(s);

  await sendMessageAsync(
    api,
    threadID,
    [
      created ? chamberHeader(s) : "",
      `🌑 ${name.toUpperCase().slice(0, 18)} ENTERED THE CHAMBER.`,
      `Wager: 🪙 ${formatNumber(bet)}`,
      `Pot: 🪙 ${formatNumber(s.pot)}`,
      `The chamber now contains ${s.players.size} player${
        s.players.size === 1 ? "" : "s"
      }.`,
      "",
      `Win chance: ${chamberOdds(s, s.players.get(userID))}%  ·  players ${
        s.players.size
      }/${s.maxPlayers}`,
    ]
      .filter((line, index) => line !== "" || index > 0)
      .join("\n")
  );
}

// ------------------------------------------------------------
// GAME ENGINE  (every function below runs with the thread lock)
// ------------------------------------------------------------

async function chamberAdvance(s) {
  if (
    chamberSessions.get(s.threadID) !== s ||
    s.status !== "active" ||
    s.phase !== "decision"
  ) {
    return;
  }

  if (chamberHalted()) {
    chamberArmDecisionTimer(s, 5_000);

    return;
  }

  await chamberRunRound(s);
}

async function chamberRunRound(s) {
  const threadID = s.threadID;

  clearTimeout(s.decisionTimer);
  clearTimeout(s.retryTimer);

  s.decisionTimer = null;
  s.retryTimer = null;
  s.phase = "resolving";

  for (const p of s.players.values()) p.ready = false;

  const alive = chamberAlive(s);

  if (alive.length <= 1) {
    await chamberFinish(s);

    return;
  }

  const roundNo = s.round + 1;

  // Hidden result, decided on the server.
  const doomed = chamberPickEliminated(alive);
  const doomIndex = alive.findIndex((p) => p.userID === doomed.userID);

  const turns = alive.slice(0, doomIndex + 1).map((player, index) => ({
    player,
    eliminated: index === doomIndex,
  }));

  const survivors = alive.filter((p) => p.userID !== doomed.userID);

  // Persist FIRST, reveal second.
  let stored = false;

  try {
    stored = await chamberStore.recordRound(
      s.id,
      roundNo,
      doomed.userID,
      survivors.map((p) => p.userID),
      turns.map((t) => t.player.userID),
      turns.map((t) => (t.eliminated ? "eliminated" : "survived"))
    );
  } catch (error) {
    console.error("[chamber] recordRound failed:", error);
  }

  if (!stored) {
    s.retryCount = (s.retryCount || 0) + 1;

    if (s.retryCount > CHAMBER.maxRoundRetries) {
      await chamberSend(
        threadID,
        [
          chamberHeader(s),
          "",
          "THE CHAMBER IS JAMMED.",
          "All wagers are safe in the database.",
          "An admin needs to restart the bot to resume this table.",
        ].join("\n")
      );

      return;
    }

    s.retryTimer = setTimeout(() => {
      s.retryTimer = null;

      withChamberLock(threadID, () => chamberRunRound(s)).catch((error) =>
        console.error("[chamber] retry round:", error)
      );
    }, CHAMBER.retryMs);

    return;
  }

  s.retryCount = 0;

  doomed.status = "eliminated";

  for (const p of survivors) p.survivedRounds += 1;

  s.round = roundNo;

  try {
    const sent = await chamberSend(threadID, chamberRoundOpenText(s, roundNo));

    await sleep(
      CHAMBER.revealMinMs + randInt(0, CHAMBER.revealJitterMs)
    );

    const resultText = chamberRoundResultText(
      s,
      roundNo,
      turns,
      doomed,
      survivors
    );

    let shown = false;

    if (sent && sent.messageID) {
      shown = await updateGameMessage(
        chamberApi,
        threadID,
        sent.messageID,
        resultText
      );
    }

    if (!shown) {
      await chamberSend(threadID, resultText);
    }
  } catch (error) {
    console.error("[chamber] reveal failed:", error);
  }

  if (survivors.length <= 1) {
    await chamberFinish(s);

    return;
  }

  s.phase = "decision";

  chamberArmDecisionTimer(s);
}

async function chamberFinish(s) {
  chamberClearTimers(s);

  s.phase = "settling";

  const alive = chamberAlive(s);

  if (alive.length !== 1) {
    console.error(
      `[chamber] session ${s.id} cannot settle: ${alive.length} players alive.`
    );

    return;
  }

  const winner = alive[0];

  let result = null;

  try {
    result = await chamberStore.settle(s.id, s.threadID, winner.userID);
  } catch (error) {
    console.error("[chamber] settle failed, retrying:", error);

    s.retryTimer = setTimeout(() => {
      s.retryTimer = null;

      withChamberLock(s.threadID, () => chamberFinish(s)).catch((err) =>
        console.error("[chamber] settle retry:", err)
      );
    }, CHAMBER.retryMs);

    return;
  }

  s.status = "ended";
  s.phase = "done";

  if (chamberSessions.get(s.threadID) === s) {
    chamberSessions.delete(s.threadID);
  }

  if (!result.settled) return; // already paid earlier

  winner.status = "winner";
  winner.payout = result.prize;
  s.pot = result.prize;

  await chamberSend(
    s.threadID,
    chamberWinnerText(s, winner, result.prize, result.balance)
  );
}

// ------------------------------------------------------------
// RECOVERY  (call once at boot, after db.connect())
// ------------------------------------------------------------

async function chamberRecover() {
  const { sessions, players } = await chamberStore.loadOpen();

  let resumed = 0;

  for (const row of sessions) {
    const threadID = String(row.thread_id);

    const s = {
      id: Number(row.id),
      threadID,
      status: row.status,
      phase: row.status === "lobby" ? "lobby" : "resolving",
      mode: row.mode,
      hostID: String(row.host_id),
      pot: Number(row.pot) || 0,
      maxPlayers: Number(row.max_players) || CHAMBER.maxPlayers,
      round: Number(row.current_round) || 0,
      players: new Map(),
      order: [],
      lobbyTimer: null,
      decisionTimer: null,
      retryTimer: null,
      retryCount: 0,
      decisionEndsAt: 0,
      createdAt: Number(row.created_at) || Date.now(),
    };

    for (const pr of players.filter(
      (p) => String(p.session_id) === String(row.id)
    )) {
      s.players.set(String(pr.user_id), {
        userID: String(pr.user_id),
        name: pr.display_name || "",
        wager: Number(pr.wager) || 0,
        status: pr.status,
        turnOrder: pr.turn_order === null ? null : Number(pr.turn_order),
        payout: Number(pr.payout) || 0,
        survivedRounds: Number(pr.survived_rounds) || 0,
        ready: false,
      });
    }

    if (s.status === "active") {
      s.order = Array.from(s.players.values())
        .sort((a, b) => (a.turnOrder || 0) - (b.turnOrder || 0))
        .map((p) => p.userID);
    }

    chamberSessions.set(threadID, s);

    if (s.status === "lobby") {
      chamberArmLobbyTimer(s);
    } else {
      const delay = 5_000 + resumed * 2_000;

      resumed += 1;

      setTimeout(() => {
        withChamberLock(threadID, () => chamberResume(s)).catch((error) =>
          console.error("[chamber] resume:", error)
        );
      }, delay);
    }
  }

  return sessions.length;
}

async function chamberResume(s) {
  if (chamberSessions.get(s.threadID) !== s || s.status !== "active") return;

  if (chamberHalted()) {
    setTimeout(() => {
      withChamberLock(s.threadID, () => chamberResume(s)).catch(() => {});
    }, 5_000);

    return;
  }

  const alive = chamberAlive(s);

  if (alive.length <= 1) {
    await chamberFinish(s);

    return;
  }

  await chamberSend(
    s.threadID,
    [
      chamberHeader(s),
      "",
      "THE CHAMBER FLICKERS BACK TO LIFE.",
      "The game resumes where it stopped.",
      "",
      `Round ${chamberRoman(s.round + 1)} · Pot 🪙 ${formatNumber(s.pot)}`,
      "",
      ...alive.map((p) => `◆ ${chamberLabel(p)}`),
    ].join("\n")
  );

  await sleep(3_000);
  await chamberRunRound(s);
}

async function initLastChamber(api) {
  chamberApi = api;

  await chamberEnsureReady();

  const count = await chamberRecover();

  console.log(
    `[chamber] Last Chamber ready. Restored ${count} open table${
      count === 1 ? "" : "s"
    }.`
  );
}

// ------------------------------------------------------------
// COMMANDS
// ------------------------------------------------------------

async function chamberPanelCmd(api, event) {
  const s = chamberSessions.get(String(event.threadID));

  await sendMessageAsync(
    api,
    String(event.threadID),
    s ? chamberStatusText(s) : chamberNoTableText()
  );
}

async function chamberCreateCmd(api, event, mode) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  await withChamberLock(threadID, async () => {
    const existing = chamberSessions.get(threadID);

    if (existing) {
      await sendMessageAsync(
        api,
        threadID,
        "🌑 a chamber is already open here.\n\n" +
          chamberStatusText(existing)
      );

      return;
    }

    let s;

    try {
      s = await chamberOpenTable(threadID, userID, mode);
    } catch (error) {
      if (error && error.code === "23505") {
        await chamberFail(
          api,
          event,
          "a chamber is still being restored here.\ntry again in a moment."
        );

        return;
      }

      throw error;
    }

    await sendMessageAsync(api, threadID, chamberLobbyText(s));
  });
}

async function chamberJoinCmd(api, event, betText, forcedMode = null) {
  await withChamberLock(String(event.threadID), () =>
    chamberDoJoin(api, event, betText, forcedMode)
  );
}

async function chamberJackpotCmd(api, event, betText) {
  const threadID = String(event.threadID);

  const existing = chamberSessions.get(threadID);

  if (existing) {
    if (existing.mode === "jackpot" && betText) {
      await chamberJoinCmd(api, event, betText, "jackpot");

      return;
    }

    await chamberFail(
      api,
      event,
      "a chamber is already open here.\nuse !chamber status."
    );

    return;
  }

  if (betText) {
    await chamberJoinCmd(api, event, betText, "jackpot");

    return;
  }

  await chamberCreateCmd(api, event, "jackpot");
}

async function chamberLeaveCmd(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  await withChamberLock(threadID, async () => {
    const s = chamberSessions.get(threadID);

    if (!s || !s.players.has(userID)) {
      await chamberFail(api, event, "you are not inside a chamber.");

      return;
    }

    if (s.status !== "lobby") {
      await chamberFail(
        api,
        event,
        "the chamber is sealed.\nno one leaves once it begins."
      );

      return;
    }

    const p = s.players.get(userID);

    const result = await chamberStore.leave(s.id, threadID, userID);

    if (!result) {
      await chamberFail(api, event, "could not leave right now.");

      return;
    }

    s.players.delete(userID);
    s.pot = result.pot;

    let extra = "";

    if (s.hostID === userID && s.players.size > 0) {
      s.hostID = s.players.keys().next().value;

      await chamberStore.setHost(s.id, s.hostID).catch(() => {});

      extra = `\n${chamberLabel(s.players.get(s.hostID))} is now the host.`;
    }

    await sendMessageAsync(
      api,
      threadID,
      [
        `🌑 ${chamberLabel(p)} LEFT THE CHAMBER.`,
        `Refunded: 🪙 ${formatNumber(result.wager)}`,
        `Pot: 🪙 ${formatNumber(s.pot)}`,
        `Players: ${s.players.size} / ${s.maxPlayers}`,
      ].join("\n") + extra
    );

    if (s.players.size === 0 && s.hostID === userID) {
      await chamberCancelLobby(s, "Everyone left.");
    }
  });
}

async function chamberStartCmd(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  await withChamberLock(threadID, async () => {
    const s = chamberSessions.get(threadID);

    if (!s || s.status !== "lobby") {
      await chamberFail(
        api,
        event,
        s
          ? "the chamber has already begun."
          : "no chamber is open.\nuse !chamber join <bet>."
      );

      return;
    }

    const hostIsSeated = s.players.has(s.hostID);

    const allowed =
      userID === s.hostID ||
      chamberIsAdmin(userID) ||
      (!hostIsSeated && s.players.has(userID));

    if (!allowed) {
      await chamberFail(
        api,
        event,
        "only the host can seal the chamber."
      );

      return;
    }

    const limits = chamberLimits(s.mode);

    if (s.players.size < limits.minPlayers) {
      await chamberFail(
        api,
        event,
        `the chamber needs at least ${limits.minPlayers} players.\n` +
          `currently ${s.players.size}.`
      );

      return;
    }

    const order = chamberShuffle(Array.from(s.players.keys()));

    const started = await chamberStore.start(s.id, order);

    if (!started) {
      await chamberFail(api, event, "could not seal the chamber.");

      return;
    }

    chamberClearTimers(s);

    s.status = "active";
    s.phase = "resolving";
    s.order = order;

    order.forEach((id, index) => {
      s.players.get(id).turnOrder = index + 1;
    });

    await chamberSend(threadID, chamberStartText(s));

    await sleep(CHAMBER.startDelayMs);

    await chamberRunRound(s);
  });
}

async function chamberStatusCmd(api, event) {
  await chamberPanelCmd(api, event);
}

async function chamberContinueCmd(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const early = chamberSessions.get(threadID);

  if (!early || early.status !== "active") {
    await chamberFail(api, event, "no chamber is running.");

    return;
  }

  if (early.phase !== "decision") {
    await chamberFail(
      api,
      event,
      "the chamber is turning.\nanswer when the window opens."
    );

    return;
  }

  await withChamberLock(threadID, async () => {
    const s = chamberSessions.get(threadID);

    if (!s || s !== early || s.phase !== "decision") {
      await chamberFail(api, event, "the window has closed.");

      return;
    }

    const p = s.players.get(userID);

    if (!p || p.status !== "alive") {
      await chamberFail(api, event, "you are not alive in this chamber.");

      return;
    }

    if (p.ready) {
      await chamberFail(api, event, "you already chose to continue.");

      return;
    }

    p.ready = true;

    const alive = chamberAlive(s);
    const readyCount = alive.filter((a) => a.ready).length;

    if (readyCount >= alive.length) {
      await chamberSend(
        threadID,
        `🌑 ${chamberLabel(p)} HOLDS. ALL SURVIVORS STAND.\nThe chamber turns again...`
      );

      await chamberRunRound(s);

      return;
    }

    await sendMessageAsync(
      api,
      threadID,
      `🌑 ${chamberLabel(p)} HOLDS THEIR PLACE. (${readyCount}/${alive.length} ready)`
    );
  });
}

async function chamberCashoutCmd(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const early = chamberSessions.get(threadID);

  if (!early || early.status !== "active") {
    await chamberFail(api, event, "no chamber is running.");

    return;
  }

  if (early.phase !== "decision") {
    await chamberFail(
      api,
      event,
      "the chamber is turning.\ncash-out opens after each round."
    );

    return;
  }

  await withChamberLock(threadID, async () => {
    const s = chamberSessions.get(threadID);

    if (!s || s !== early || s.phase !== "decision") {
      await chamberFail(api, event, "the window has closed.");

      return;
    }

    const p = s.players.get(userID);

    if (!p || p.status !== "alive") {
      await chamberFail(api, event, "you are not alive in this chamber.");

      return;
    }

    const amount = chamberCashoutOffer(s, p);
    const pct = Math.round(chamberCashoutPct(s) * 100);

    let result = null;

    try {
      result = await chamberStore.cashout(s.id, threadID, userID, amount);
    } catch (error) {
      console.error("[chamber] cashout failed:", error);
    }

    if (!result) {
      await chamberFail(api, event, "could not cash out right now.");

      return;
    }

    p.status = "cashed_out";
    p.payout = amount;
    s.pot = result.pot;

    const alive = chamberAlive(s);

    await sendMessageAsync(
      api,
      threadID,
      [
        `🌑 ${chamberLabel(p)} LEFT THE CHAMBER ALIVE.`,
        `Cashed out: 🪙 ${formatNumber(amount)}  (${pct}% offer)`,
        `Pot: 🪙 ${formatNumber(s.pot)}`,
        "",
        "Remaining players:",
        ...alive.map((a) => `◆ ${chamberLabel(a)}`),
      ].join("\n")
    );

    if (alive.length === 1) {
      await chamberFinish(s);

      return;
    }

    if (alive.every((a) => a.ready)) {
      await chamberRunRound(s);
    }
  });
}

async function chamberCancelCmd(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  await withChamberLock(threadID, async () => {
    const s = chamberSessions.get(threadID);

    if (!s) {
      await chamberFail(api, event, "no chamber is open.");

      return;
    }

    if (s.status !== "lobby") {
      await chamberFail(
        api,
        event,
        "a running chamber cannot be cancelled."
      );

      return;
    }

    if (userID !== s.hostID && !chamberIsAdmin(userID)) {
      await chamberFail(
        api,
        event,
        "only the host can cancel the chamber."
      );

      return;
    }

    await chamberCancelLobby(s, "The host cancelled the table.");
  });
}

async function chamberHistoryCmd(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const { totals, recent } = await chamberStore.stats(threadID, userID);

  const lines = [
    chamberHeader(null),
    "YOUR RECORD",
    "",
    `Games:         ${Number(totals.games) || 0}`,
    `Rounds survived: ${Number(totals.survived) || 0}`,
    `Victories:     ${Number(totals.victories) || 0}`,
    `Eliminations:  ${Number(totals.eliminations) || 0}`,
    `Coins won:     🪙 ${formatNumber(Number(totals.coins_won) || 0)}`,
    `Coins lost:    🪙 ${formatNumber(Number(totals.coins_lost) || 0)}`,
  ];

  if (recent.length) {
    lines.push("", "Recent:");

    for (const row of recent) {
      const net = Number(row.payout) - Number(row.wager);

      const tag =
        row.status === "winner"
          ? "WON"
          : row.status === "cashed_out"
            ? "CASHED"
            : "OUT";

      lines.push(
        `#${row.id}  ${tag}  🪙 ${net >= 0 ? "+" : "-"}${formatNumber(Math.abs(net))}`
      );
    }
  }

  await sendMessageAsync(api, threadID, lines.join("\n"));
}

async function handleChamber(api, event, args) {
  chamberApi = api;

  const list = Array.isArray(args) ? args : [];
  const sub = String(list[0] || "").toLowerCase();
  const rest = list.slice(1);

  try {
    await chamberEnsureReady();

    switch (sub) {
      case "":
      case "panel":
      case "info":
      case "status":
        await chamberStatusCmd(api, event);
        break;

      case "create":
      case "open":
      case "new":
        await chamberCreateCmd(api, event, "standard");
        break;

      case "jackpot":
        await chamberJackpotCmd(api, event, rest[0]);
        break;

      case "join":
      case "enter":
        await chamberJoinCmd(api, event, rest[0]);
        break;

      case "leave":
      case "exit":
        await chamberLeaveCmd(api, event);
        break;

      case "start":
      case "begin":
        await chamberStartCmd(api, event);
        break;

      case "continue":
      case "hold":
        await chamberContinueCmd(api, event);
        break;

      case "cashout":
      case "cash":
        await chamberCashoutCmd(api, event);
        break;

      case "cancel":
        await chamberCancelCmd(api, event);
        break;

      case "history":
      case "stats":
      case "record":
        await chamberHistoryCmd(api, event);
        break;

      case "rules":
      case "help":
        await sendMessageAsync(
          api,
          String(event.threadID),
          chamberRulesText()
        );
        break;

      default:
        await sendMessageAsync(
          api,
          String(event.threadID),
          chamberNoTableText()
        );
    }
  } catch (error) {
    console.error("[chamber] command failed:", error);

    await safeReply(
      api,
      event,
      "🌑 LAST CHAMBER\n\nthe chamber hit an error.\ncheck !chamber status to see where things stand."
    );
  }

  return true;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  handleGameCommand,
  handleGamesCommand: handleGameCommand,
  handleGameResponse,

  handleChamber,
  initLastChamber,

  handleDaily,
  handleWork,
  handleTrivia,
  handleRPS,
  handleRoll,
  handleGuess,
  handleCoinFlip,
  handleBlackjack,
  handleSlots,
  handleMath,
  handleRiddle,
  handleEightBall,

  handleGameCenter,
  handleGameRules,
  handleGameStatus,

  lockGame,
  unlockGame,
};
