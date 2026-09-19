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
      "",
      "♡ MIND",
      "   ┊ !trivia     · test your knowledge",
      "   ┊ !riddle     · solve a mystery",
      "   ┊ !math       · quick calculation",
      "",
      "♡ ECLIPSE",
      "   ┊ !8ball      · ask me anything",
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
// EXPORTS
// ============================================================

module.exports = {
  handleGameCommand,
  handleGamesCommand: handleGameCommand,
  handleGameResponse,

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
