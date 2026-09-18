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

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;

const MAX_BET = 1_000_000;

// Ladder / press-your-luck caps
const ROLL_LADDER_MAX = 3;
const COINFLIP_LADDER_MAX = 5;
const SLOTS_RESPIN_COST_RATIO = 0.5;

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
  return String(value || "").trim().toLowerCase().replace(/^!/, "");
}

// ============================================================
// THE VEIL — VISUAL SYSTEM
// ============================================================

const GAME_STYLE = {
  trivia: { icon: "🧠", name: "THE VEIL • TRIVIA" },
  rps: { icon: "⚔️", name: "THE VEIL • DUEL" },
  roll: { icon: "🎲", name: "THE VEIL • DICE" },
  guess: { icon: "🎯", name: "THE VEIL • GUESS" },
  coinflip: { icon: "🪙", name: "THE VEIL • FATE" },
  blackjack: { icon: "♠️", name: "THE VEIL • BLACKJACK" },
  slots: { icon: "🎰", name: "THE VEIL • REELS" },
  math: { icon: "🧮", name: "THE VEIL • PRECISION" },
  riddle: { icon: "🧩", name: "THE VEIL • RIDDLE" },
  "8ball": { icon: "🔮", name: "THE VEIL • ORACLE" },
  daily: { icon: "✦", name: "THE VEIL • OFFERING" },
  work: { icon: "◈", name: "THE VEIL • CONTRACT" },
};

function gameHeader(type, subtitle = "") {
  const style = GAME_STYLE[type] || { icon: "🌑", name: "THE VEIL" };

  return [
    `╭────────────────────────────╮`,
    `       ${style.icon} ${style.name}`,
    `╰────────────────────────────╯`,
    subtitle ? `♙ ${subtitle}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function divider() {
  return "────────────────────────────";
}

function thinDivider() {
  return "┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄";
}

function playerLine(event) {
  return getPlayerName(event);
}

function rewardLine(reward, balanceText, won = true) {
  const xpSign = won ? "+" : "-";
  const xpValue = Math.abs(Number(reward?.xp || 0));
  const coinValue = Number(reward?.coins || 0);
  const coinText = won && coinValue > 0 ? `+${formatNumber(coinValue)}` : "0";

  return [
    divider(),
    `⭐ XP       ${xpSign}${formatNumber(xpValue)}`,
    `💰 Coins    ${coinText}`,
    "",
    balanceText,
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

  return { xp: xpAmount, coins: won ? baseCoins : 0, won };
}

// Like awardPlayer, but the coin amount is an explicit bet-scaled
// payout rather than the flat table lookup — used by every game
// that now wagers real coins (roll, coinflip, blackjack, slots,
// and the double-down / streak ladders built on top of them).
async function awardBetPlayer(threadID, userID, gameType, won, coinsAmount) {
  const xp = xpForGame(gameType);
  const xpAmount = won ? xp : Math.floor(xp * 0.5);

  await db.addXP(threadID, userID, won ? xpAmount : -xpAmount);

  const coins = Math.max(0, Math.floor(coinsAmount || 0));

  if (won && coins > 0) {
    await db.addBalance(threadID, userID, coins);
  }

  return { xp: xpAmount, coins: won ? coins : 0, won };
}

async function getFinalBalanceText(threadID, userID) {
  const user = await db.getUser(threadID, userID);
  const coins = formatNumber(user?.balance ?? 0);
  const xp = formatNumber(user?.xp ?? 0);

  return `💰 ${coins} coins   •   ⭐ ${xp} XP`;
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

  const id = event && event.senderID ? String(event.senderID) : "Player";

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
  if (!messageID || !api || typeof api.editMessage !== "function") {
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
      `[games] Could not edit message ${messageID}. No duplicate message will be sent.`
    );
  }

  return edited;
}

async function createAnimator(api, threadID, initialText, gameType = "") {
  const result = { messageID: null, stopEdit: null, editCount: 0 };

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
  const key = `${threadID}:${userID}`;

  if (activeGames.has(key)) {
    return false;
  }

  activeGames.add(key);
  return true;
}

function unlockGame(threadID, userID) {
  activeGames.delete(`${threadID}:${userID}`);
}

// ============================================================
// DAILY / WORK — shared "gamble your earnings" follow-up
// ============================================================

function streakFlames(streak) {
  const shown = Math.min(10, Math.max(0, streak));
  return "🔥".repeat(shown) + "▫️".repeat(10 - shown);
}

function claimGambleFooter() {
  return [
    "",
    thinDivider(),
    "↳ Feeling lucky? Reply 'gamble' to risk it all on a",
    "  50/50 double-or-nothing, or 'keep' to bank it.",
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
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

      await safeReply(
        api,
        event,
        [
          "╭────────────────────────────╮",
          "       ✦ THE VEIL",
          "       DAILY OFFERING",
          "╰────────────────────────────╯",
          "",
          "🌑 The offering has already been claimed.",
          "",
          `${streakFlames(currentStreak)}  streak ${currentStreak}`,
          "",
          `⏳ Return in ${hours}h ${minutes}m.`,
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

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("daily", playerLine(event)),
        "",
        "The Veil considers your offering...",
        "",
        "       ✦ ✦ ✦",
      ].join("\n"),
      "daily"
    );

    await sleep(editDelay());

    await db.addBalance(threadID, userID, totalReward);
    await db.addXP(threadID, userID, 50);
    await db.updateUser(threadID, userID, {
      last_daily: now,
      daily_streak: streak,
    });

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("daily", playerLine(event)),
      "",
      "The Veil opens its hand.",
      "",
      `💰 Base        +${formatNumber(baseReward)}`,
      `🔥 Streak      +${formatNumber(streakBonus)}`,
      `✦ Total        +${formatNumber(totalReward)}`,
      `⭐ XP           +50`,
      "",
      `${streakFlames(streak)}`,
      `🔥 Daily streak: ${streak}${
        streakBroken ? " (restarted — grace window missed)" : ""
      }`,
      "",
      balanceText,
      claimGambleFooter(),
    ].join("\n");

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
      "🌑 The Veil could not release today's offering."
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
          "╭────────────────────────────╮",
          "       ◈ THE VEIL",
          "          CONTRACT",
          "╰────────────────────────────╯",
          "",
          "⏳ Your current contract is still cooling down.",
          "",
          `Return in ${minutes}m ${seconds}s.`,
        ].join("\n")
      );

      return true;
    }

    const job = WORK_JOBS[randInt(0, WORK_JOBS.length - 1)];
    const earned = randInt(job.min, job.max);

    const searchLines = [
      "Scanning available contracts...",
      "Negotiating terms...",
      "Confirming the shift...",
    ];

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("work", playerLine(event)),
        "",
        searchLines[0],
        "",
        "▰▱▱▱▱▱▱▱▱▱  10%",
      ].join("\n"),
      "work"
    );

    for (let step = 1; step < searchLines.length; step++) {
      await sleep(editDelay());

      const filled = Math.round(((step + 1) / searchLines.length) * 10);

      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("work", playerLine(event)),
          "",
          searchLines[step],
          "",
          `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}  ${filled * 10}%`,
        ].join("\n")
      );
    }

    await sleep(editDelay());

    await db.addBalance(threadID, userID, earned);
    await db.addXP(threadID, userID, job.xp);
    await db.updateUser(threadID, userID, { last_work: now });

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("work", playerLine(event)),
      "",
      "▰▰▰▰▰▰▰▰▰▰  100%",
      "",
      "A contract has found you.",
      "",
      `💼 ${job.job}`,
      `💰 Earned: +${formatNumber(earned)} coins`,
      `⭐ XP: +${formatNumber(job.xp)}`,
      "",
      "The shift is complete.",
      "",
      balanceText,
      claimGambleFooter(),
    ].join("\n");

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

    await safeReply(api, event, "🌑 The Veil could not assign a contract.");

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
      `✦ Kept. Your ${formatNumber(session.amount)} coins are safe.`
    );

    return true;
  }

  if (!/^(gamble|double|doubledown|risk|yes)$/.test(word)) {
    await safeReply(
      api,
      event,
      "🌑 Reply 'gamble' to risk it, or 'keep' to bank it."
    );

    return true;
  }

  clearSession(threadID, userID);

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
      "🌑 That offering has already slipped from your hands."
    );

    return true;
  }

  const won = randInt(0, 1) === 0;
  const payout = won ? session.amount * 2 : 0;

  if (won) {
    await db.addBalance(threadID, userID, payout);
  }

  const balanceText = await getFinalBalanceText(threadID, userID);

  const finalText = [
    gameHeader(session.source === "daily" ? "daily" : "work", playerLine(event)),
    "",
    won ? "🏆 DOUBLED" : "❌ LOST TO THE VEIL",
    "",
    won
      ? `💰 Payout: +${formatNumber(payout)} coins`
      : `💸 Forfeited: -${formatNumber(session.amount)} coins`,
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
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  try {
    const q = await triviaManager.getNextQuestion({ threadID });

    if (!q) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        "🌑 The Veil has no unanswered questions available."
      );

      return;
    }

    const text = [
      gameHeader("trivia", playerLine(event)),
      "",
      "KNOWLEDGE IS POWER",
      "",
      `❓ ${q.question}`,
      "",
      `〔 A 〕 ${q.options[0]}`,
      `〔 B 〕 ${q.options[1]}`,
      `〔 C 〕 ${q.options[2]}`,
      `〔 D 〕 ${q.options[3]}`,
      "",
      thinDivider(),
      "✦ Correct  +50 XP  •  +150 coins",
      "",
      "↳ Reply with A, B, C or D",
    ].join("\n");

    const animator = await createAnimator(api, threadID, text, "trivia");

    setSession(threadID, userID, {
      type: "trivia",
      qdata: q,
      messageID: animator.messageID,
    });
  } catch (error) {
    unlockGame(threadID, userID);

    console.error("[games] trivia:", error);

    await safeReply(api, event, "🌑 The Veil could not reveal a question.");
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
      correct ? "🏆 KNOWLEDGE PREVAILS" : "❌ THE VEIL REMAINS",
      "",
      `✓ Correct answer: ${correctLetter}`,
      "",
      correct
        ? "✦ Your answer pierced the Veil."
        : "✦ The answer remains beyond your grasp.",
      "",
      rewardLine(reward, balanceText, correct),
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);
  } catch (error) {
    console.error("[games] trivia reward:", error);
  }

  unlockGame(threadID, userID);

  return true;
}

// ============================================================
// ROCK PAPER SCISSORS — best of 3 + persistent win streak
// ============================================================

const RPS_SHAPE_ICON = { rock: "🪨", paper: "📄", scissors: "✂️" };
const RPS_CHOICES = ["rock", "paper", "scissors"];

function rpsRoundResult(playerChoice, botChoice) {
  if (playerChoice === botChoice) return "draw";

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
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  try {
    const playerChoice = String(args?.[0] || "").toLowerCase();
    const aliases = { r: "rock", p: "paper", s: "scissors" };
    const normalizedChoice = aliases[playerChoice] || playerChoice;

    if (!RPS_CHOICES.includes(normalizedChoice)) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "⚔️ Choose rock, paper, or scissors.");

      return;
    }

    const playerIcon = RPS_SHAPE_ICON[normalizedChoice];

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("rps", playerLine(event)),
        "",
        "BEST OF 3 — CHALLENGE ACCEPTED",
        "",
        `♙ YOUR MOVE   ${playerIcon}  ${normalizedChoice.toUpperCase()}`,
        "",
        "Round 1 of 3 — fate decides...",
      ].join("\n"),
      "rps"
    );

    let playerRoundWins = 0;
    let botRoundWins = 0;
    const rounds = [];

    let round = 0;

    while (
      playerRoundWins < 2 &&
      botRoundWins < 2 &&
      round < 3
    ) {
      round++;

      await sleep(editDelay());

      const botChoice = RPS_CHOICES[randInt(0, 2)];
      const outcome = rpsRoundResult(normalizedChoice, botChoice);

      if (outcome === "win") playerRoundWins++;
      else if (outcome === "loss") botRoundWins++;

      rounds.push({ botChoice, outcome });

      const roundLines = rounds
        .map((r, i) => {
          const tag =
            r.outcome === "win"
              ? "✅ WON"
              : r.outcome === "loss"
                ? "❌ LOST"
                : "🤝 DRAW";

          return `Round ${i + 1}  ${RPS_SHAPE_ICON[r.botChoice]} ${r.botChoice.toUpperCase()}  →  ${tag}`;
        })
        .join("\n");

      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("rps", playerLine(event)),
          "",
          `♙ YOUR MOVE   ${playerIcon}  ${normalizedChoice.toUpperCase()}`,
          "",
          roundLines,
          "",
          `Score  •  You ${playerRoundWins} — ${botRoundWins} Opponent`,
        ].join("\n")
      );
    }

    const matchWin = playerRoundWins > botRoundWins;
    const matchLoss = botRoundWins > playerRoundWins;

    const user = await db.getUser(threadID, userID);
    const currentStreak = Number(user?.rps_streak || 0);
    const newStreak = matchWin ? currentStreak + 1 : 0;
    const multiplier = rpsStreakMultiplier(matchWin ? newStreak : currentStreak);

    const baseXp = xpForGame("rps");
    const baseCoins = coinReward("rps");
    const xpAmount = matchWin ? baseXp : Math.floor(baseXp * 0.5);
    const coinsAmount = matchWin ? Math.floor(baseCoins * multiplier) : 0;

    await db.addXP(threadID, userID, matchWin ? xpAmount : -xpAmount);

    if (coinsAmount > 0) {
      await db.addBalance(threadID, userID, coinsAmount);
    }

    await db.updateUser(threadID, userID, { rps_streak: newStreak });

    const balanceText = await getFinalBalanceText(threadID, userID);

    const resultEmoji = matchWin ? "🏆" : matchLoss ? "❌" : "🤝";
    const resultText = matchWin ? "VICTORY" : matchLoss ? "DEFEAT" : "DRAW";

    const finalText = [
      gameHeader("rps"),
      "",
      `${resultEmoji} ${resultText}  •  ${playerRoundWins} - ${botRoundWins}`,
      "",
      thinDivider(),
      "",
      matchWin
        ? `🔥 Win streak: ${newStreak}  (×${multiplier.toFixed(1)} coin multiplier)`
        : currentStreak > 0
          ? `🔥 Win streak reset (was ${currentStreak})`
          : "",
      "",
      matchWin
        ? "✦ The Veil favors you."
        : matchLoss
          ? "✦ The Veil favors your opponent."
          : "✦ Neither warrior prevails.",
      "",
      divider(),
      `⭐ XP       ${matchWin ? "+" : "-"}${formatNumber(xpAmount)}`,
      `💰 Coins    ${coinsAmount > 0 ? `+${formatNumber(coinsAmount)}` : "0"}`,
      "",
      balanceText,
    ]
      .filter((line) => line !== "")
      .join("\n");

    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] rps:", error);

    await safeReply(api, event, "🌑 The duel was interrupted.");
  } finally {
    unlockGame(threadID, userID);
  }
}

// ============================================================
// DICE ROLL — risk tiers + double-or-nothing ladder
// ============================================================

const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

const ROLL_TICKS = 3;

const ROLL_TIERS = {
  safe: { fraction: 0.4, multiplier: 1.5, label: "SAFE" },
  normal: { fraction: 0.55, multiplier: 2, label: "BALANCED" },
  risky: { fraction: 0.75, multiplier: 4, label: "RISKY" },
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
    if (i === resultPos) bar += "🔶";
    else if (i === thresholdPos) bar += "│";
    else if (i >= thresholdPos) bar += "▰";
    else bar += "▱";
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

  return { tier, sides };
}

function rollLadderText(event, session) {
  return [
    gameHeader("roll", playerLine(event)),
    "",
    "🏆 HIGH ROLL",
    "",
    `💰 Pending payout: ${formatNumber(session.pendingPayout)} coins`,
    `🪜 Ladder: ${session.ladderCount} / ${ROLL_LADDER_MAX}`,
    "",
    thinDivider(),
    session.ladderCount >= ROLL_LADDER_MAX
      ? "✦ Maximum ladder reached — reply 'cashout' to bank it."
      : "↳ Reply 'cashout' to bank it, or 'doubledown' for a 50/50 to double it.",
  ].join("\n");
}

async function handleRoll(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

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
        `🎲 Invalid wager.\n\nMinimum: 1\nMaximum: ${formatNumber(MAX_BET)} coins`
      );

      return;
    }

    if (sides < 2 || sides > 1000) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "🎲 Die sides must be between 2 and 1000.");

      return;
    }

    const tierConfig = ROLL_TIERS[tier];
    const highThreshold = Math.floor(sides * tierConfig.fraction);

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("roll", playerLine(event)),
        "",
        `THE DIE IS CAST  •  d${sides}  •  ${tierConfig.label}`,
        "",
        `💰 Wager: ${formatNumber(bet)} coins  →  ${tierConfig.multiplier}× on a HIGH roll`,
        `✦ High zone: ${highThreshold}–${sides}`,
        "",
        rollBar(1, sides, highThreshold),
        "",
        "       🎲  settling the wager...",
      ].join("\n"),
      "roll"
    );

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
          "🌑 WAGER REJECTED",
          "",
          error.message || "Not enough wallet coins.",
        ].join("\n")
      );

      unlockGame(threadID, userID);

      return;
    }

    for (let tick = 0; tick < ROLL_TICKS; tick++) {
      const spinning = randInt(1, sides);

      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("roll"),
          "",
          `THE DIE IS CAST  •  d${sides}  •  ${tierConfig.label}`,
          "",
          `${rollFace(spinning, sides)}  rolling... ${spinning}`,
          "",
          rollBar(spinning, sides, highThreshold),
          "",
          "       spinning...",
        ].join("\n")
      );

      await sleep(editDelay());
    }

    const result = randInt(1, sides);
    const won = result >= highThreshold;
    const payout = won ? Math.floor(bet * tierConfig.multiplier) : 0;

    const margin = Math.abs(result - highThreshold);

    const flavor =
      result === sides
        ? "✦ Maximum roll. The Veil could not stop you."
        : won && margin <= Math.max(1, Math.floor(sides * 0.03))
          ? "✦ Landed right on the edge of the high zone."
          : won
            ? "✦ Comfortably inside the high zone."
            : result === 1
              ? "✦ The lowest the die could show."
              : "✦ Fell short of the high zone.";

    if (!won) {
      settled = true;

      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("roll"),
        "",
        "❌ LOW ROLL",
        "",
        `${rollFace(result, sides)}  Result: ${result} / ${sides}`,
        `✦ High zone: ${highThreshold}–${sides}`,
        "",
        rollBar(result, sides, highThreshold),
        "",
        flavor,
        "",
        `💸 Lost wager: -${formatNumber(bet)} coins`,
        "",
        balanceText,
      ].join("\n");

      await updateGameMessage(api, threadID, animator.messageID, finalText);
      unlockGame(threadID, userID);

      return;
    }

    // Won the initial roll — open the double-or-nothing ladder
    // instead of paying out immediately.
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
      "🏆 HIGH ROLL",
      "",
      `${rollFace(result, sides)}  Result: ${result} / ${sides}`,
      `✦ High zone: ${highThreshold}–${sides}`,
      "",
      rollBar(result, sides, highThreshold),
      "",
      flavor,
      "",
      rollLadderText(event, session),
    ].join("\n");

    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] roll:", error);

    if (betCharged && !settled) {
      const bet = parseBet(args?.[0]);

      if (validBet(bet)) {
        await db.addBalance(threadID, userID, bet).catch(() => {});
      }
    }

    unlockGame(threadID, userID);

    await safeReply(api, event, "🌑 The die could not complete its judgment.");
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
      "💰 BANKED",
      "",
      `+${formatNumber(session.pendingPayout)} coins secured.`,
      "",
      balanceText,
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);
    unlockGame(threadID, userID);

    return true;
  }

  if (/^(doubledown|double)$/.test(word)) {
    if (session.ladderCount >= ROLL_LADDER_MAX) {
      await safeReply(
        api,
        event,
        "🌑 Maximum ladder reached. Reply 'cashout' to bank your winnings."
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
        "❌ THE LADDER COLLAPSES",
        "",
        `You forfeited ${formatNumber(session.pendingPayout)} coins.`,
        "",
        balanceText,
      ].join("\n");

      await updateGameMessage(api, threadID, session.messageID, finalText);
      unlockGame(threadID, userID);

      return true;
    }

    session.pendingPayout *= 2;
    session.ladderCount += 1;

    setSession(threadID, userID, session);

    const finalText = [
      gameHeader("roll"),
      "",
      "🔥 DOUBLED",
      "",
      rollLadderText(event, session),
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);

    return true;
  }

  await safeReply(
    api,
    event,
    "🌑 Reply 'cashout' to bank it, or 'doubledown' to risk it."
  );

  return true;
}

// ============================================================
// NUMBER GUESS — wager mode with attempt-based multipliers + double down
// ============================================================

const GUESS_ATTEMPT_MULTIPLIER = [4, 2.5, 1.5];

async function handleGuess(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  try {
    const min = parseInt(args?.[0], 10) || 1;
    const max = parseInt(args?.[1], 10) || 100;
    const bet = parseBet(args?.[2]);
    const wagered = validBet(bet);

    if (min >= max) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "🎯 Minimum must be lower than maximum.");

      return;
    }

    if (args?.[2] && !wagered) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        `🎯 Invalid wager.\n\nMinimum: 1\nMaximum: ${formatNumber(MAX_BET)} coins`
      );

      return;
    }

    if (wagered) {
      try {
        await db.spendBalance(threadID, userID, bet, `Guess bet: ${bet}`);
      } catch (error) {
        unlockGame(threadID, userID);

        await safeReply(
          api,
          event,
          error.message || "🎯 Not enough wallet coins."
        );

        return;
      }
    }

    const secretNumber = randInt(min, max);

    const wagerLine = wagered
      ? [
          `💰 Wager: ${formatNumber(bet)} coins`,
          "✦ 1st try 4×  •  2nd try 2.5×  •  3rd try 1.5×",
          "↳ Reply 'doubledown' before your final guess to double the wager and payout.",
          "",
        ]
      : [];

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("guess", playerLine(event)),
        "",
        "THE NUMBER IS HIDDEN",
        "",
        `Range: ${min} ───────── ${max}`,
        "",
        ...wagerLine,
        "Attempt: 0 / 3",
        "",
        "✦ Trust your intuition.",
        "",
        "↳ Send your first guess.",
      ].join("\n"),
      "guess"
    );

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
    unlockGame(threadID, userID);

    console.error("[games] guess:", error);

    await safeReply(api, event, "🌑 The Veil could not hide a number.");
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

  // Double down: only while wagered, not yet doubled, and at least
  // one attempt remains after this one.
  if (/^(doubledown|double)$/.test(word)) {
    if (!session.bet) {
      await safeReply(api, event, "🎯 No wager to double — this is a free game.");
      return true;
    }

    if (session.doubled) {
      await safeReply(api, event, "🎯 You've already doubled down.");
      return true;
    }

    if (session.tries >= 2) {
      await safeReply(api, event, "🎯 Too late — this is your final attempt.");
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
        error.message || "🎯 Not enough wallet coins to double down."
      );

      return true;
    }

    session.doubled = true;
    session.bet *= 2;

    setSession(threadID, userID, session);

    await safeReply(
      api,
      event,
      `🔥 Doubled down. Wager is now ${formatNumber(session.bet)} coins — guess carefully.`
    );

    return true;
  }

  const guess = parseNumericAnswer(guessText);

  if (Number.isNaN(guess)) {
    await safeReply(api, event, "🎯 Enter a number.");

    return true;
  }

  const tries = session.tries + 1;

  let resultMessage = "";
  let isCorrect = false;

  if (guess === session.secretNumber) {
    isCorrect = true;

    resultMessage = `🏆 Correct. You found ${session.secretNumber} in ${tries} attempt${tries === 1 ? "" : "s"}.`;
  } else if (tries >= 3) {
    resultMessage = `❌ The hidden number was ${session.secretNumber}.`;
  } else if (guess < session.secretNumber) {
    resultMessage = `📈 Too low. The number is higher. • ${3 - tries} attempt${3 - tries === 1 ? "" : "s"} left`;
  } else {
    resultMessage = `📉 Too high. The number is lower. • ${3 - tries} attempt${3 - tries === 1 ? "" : "s"} left`;
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
        resultMessage,
        "",
        isCorrect
          ? "✦ Your intuition pierced the Veil."
          : "✦ The hidden number remains victorious.",
        session.bet && !isCorrect
          ? `💸 Lost wager: -${formatNumber(session.bet)} coins`
          : "",
        "",
        rewardLine(reward, balanceText, isCorrect),
      ]
        .filter((line) => line !== "")
        .join("\n");

      await updateGameMessage(api, threadID, session.messageID, finalText);
    } catch (error) {
      console.error("[games] guess reward:", error);

      await safeReply(
        api,
        event,
        "🌑 Guess ended, but the reward update failed."
      );
    } finally {
      unlockGame(threadID, userID);
    }
  } else {
    setSession(threadID, userID, { ...session, tries });

    const text = [
      gameHeader("guess"),
      "",
      resultMessage,
      "",
      `Attempt ${tries}/3`,
      "",
      "↳ Try again.",
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, text);
  }

  return true;
}

// ============================================================
// COIN FLIP — win streak double-or-nothing ladder
// ============================================================

function coinflipLadderText(event, session) {
  return [
    gameHeader("coinflip", playerLine(event)),
    "",
    "🏆 THE CALL WAS CORRECT",
    "",
    `💰 Pending payout: ${formatNumber(session.pendingPayout)} coins`,
    `🪜 Streak: ${session.ladderCount} / ${COINFLIP_LADDER_MAX}`,
    "",
    thinDivider(),
    session.ladderCount >= COINFLIP_LADDER_MAX
      ? "✦ Maximum streak reached — reply 'cashout' to bank it."
      : "↳ Reply 'cashout' to bank it, or 'doubledown' for another 50/50 flip.",
  ].join("\n");
}

async function handleCoinFlip(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  let betCharged = false;
  let settled = false;

  try {
    const first = String(args?.[0] || "").trim().toLowerCase();
    const second = String(args?.[1] || "").trim().toLowerCase();
    const aliases = { h: "heads", t: "tails" };

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

    const bet = parseBet(betText);

    if (!validBet(bet) || !["heads", "tails"].includes(choice)) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        "🪙 Usage: !coinflip <bet> <heads|tails>\nExample: !coinflip 100 heads"
      );

      return;
    }

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("coinflip", playerLine(event)),
        "",
        "FATE CHOOSES",
        "",
        `🪙 Your call: ${choice.toUpperCase()}`,
        `💰 Wager: ${formatNumber(bet)} coins`,
        "",
        "       ◉",
        "",
        "       FLIPPING...",
      ].join("\n"),
      "coinflip"
    );

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
          "🌑 WAGER REJECTED",
          "",
          error.message || "Not enough wallet coins.",
        ].join("\n")
      );

      unlockGame(threadID, userID);

      return;
    }

    const coinFaces = ["◉", "◎", "○", "◎"];

    for (let tick = 0; tick < 3; tick++) {
      const tumbling = randInt(0, 1) === 0 ? "heads" : "tails";

      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("coinflip"),
          "",
          "FATE CHOOSES",
          "",
          `🪙 Your call: ${choice.toUpperCase()}`,
          `💰 Wager: ${formatNumber(bet)} coins`,
          "",
          `       ${coinFaces[tick % coinFaces.length]}  ${tumbling.toUpperCase()}...`,
          "",
          "       FLIPPING...",
        ].join("\n")
      );

      await sleep(editDelay());
    }

    const result = randInt(0, 1) === 0 ? "heads" : "tails";
    const won = choice === result;

    if (!won) {
      settled = true;

      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("coinflip"),
        "",
        "❌ THE CALL FAILED",
        "",
        `Your call  •  ${choice.toUpperCase()}`,
        `Result     •  ${result === "heads" ? "👑" : "🪙"}  ${result.toUpperCase()}`,
        `Wager      •  ${formatNumber(bet)} coins`,
        "",
        `💸 Lost wager: -${formatNumber(bet)} coins`,
        "",
        balanceText,
      ].join("\n");

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
      `Your call  •  ${choice.toUpperCase()}`,
      `Result     •  ${result === "heads" ? "👑" : "🪙"}  ${result.toUpperCase()}`,
      "",
      coinflipLadderText(event, session),
    ].join("\n");

    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] coinflip:", error);

    if (betCharged && !settled) {
      const argsArray = normalizeArgs(args);

      const numericArg = argsArray.find((value) => /^\d[\d,]*$/.test(value));
      const bet = parseBet(numericArg);

      if (validBet(bet)) {
        await db.addBalance(threadID, userID, bet).catch(() => {});
      }
    }

    unlockGame(threadID, userID);

    await safeReply(api, event, "🌑 Fate could not complete the coin toss.");
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
      "💰 BANKED",
      "",
      `+${formatNumber(session.pendingPayout)} coins secured.`,
      "",
      balanceText,
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);
    unlockGame(threadID, userID);

    return true;
  }

  if (/^(doubledown|double)$/.test(word)) {
    if (session.ladderCount >= COINFLIP_LADDER_MAX) {
      await safeReply(
        api,
        event,
        "🌑 Maximum streak reached. Reply 'cashout' to bank your winnings."
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
        "❌ THE STREAK BREAKS",
        "",
        `You forfeited ${formatNumber(session.pendingPayout)} coins.`,
        "",
        balanceText,
      ].join("\n");

      await updateGameMessage(api, threadID, session.messageID, finalText);
      unlockGame(threadID, userID);

      return true;
    }

    session.pendingPayout *= 2;
    session.ladderCount += 1;

    setSession(threadID, userID, session);

    const finalText = [
      gameHeader("coinflip"),
      "",
      "🔥 DOUBLED",
      "",
      coinflipLadderText(event, session),
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);

    return true;
  }

  await safeReply(
    api,
    event,
    "🌑 Reply 'cashout' to bank it, or 'doubledown' to risk it."
  );

  return true;
}

// ============================================================
// BLACKJACK — wagered, with natural blackjack + double down
// ============================================================

const CARD_VALUES = {
  2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 10, Q: 10, K: 10, A: 11,
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

  const filled = Math.max(0, Math.min(width, Math.round((value / 21) * width)));

  const zone =
    value > 21
      ? "💥 BUST"
      : value >= 17
        ? "🟩 strong"
        : value >= 12
          ? "🟨 risky"
          : "🟦 safe";

  return `${"█".repeat(filled)}${"░".repeat(width - filled)}  ${zone}`;
}

function blackjackActionsFooter(session) {
  const lines = ["↳ !hit   Draw another card", "↳ !stand Hold your hand"];

  if (session.playerHand.length === 2 && !session.doubled) {
    lines.push("↳ !double Double your wager, draw one card, auto-stand");
  }

  return lines.join("\n");
}

async function handleBlackjack(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  try {
    const bet = parseBet(args?.[0]);

    if (!validBet(bet)) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        `♠️ Usage: !blackjack <bet>\n\nMinimum: 1\nMaximum: ${formatNumber(MAX_BET)} coins`
      );

      return;
    }

    const deck = createDeck();
    const playerHand = [drawCard(deck), drawCard(deck)];
    const botHand = [drawCard(deck), drawCard(deck)];
    const playerValue = calcHandValue(playerHand);
    const dealerValue = calcHandValue(botHand);

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("blackjack", playerLine(event)),
        "",
        `THE TABLE IS OPEN  •  Wager: ${formatNumber(bet)} coins`,
        "",
        `♙ YOU     ${playerHand.join("  ")}`,
        `          Total: ${playerValue}`,
        `          ${handValueBar(playerValue)}`,
        "",
        `♟ DEALER  ${botHand[0]}  ▣`,
        "          Total: ?",
        "",
        thinDivider(),
        "",
        "↳ Dealing...",
      ].join("\n"),
      "blackjack"
    );

    try {
      await db.spendBalance(threadID, userID, bet, `Blackjack bet: ${bet}`);
    } catch (error) {
      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("blackjack"),
          "",
          "🌑 WAGER REJECTED",
          "",
          error.message || "Not enough wallet coins.",
        ].join("\n")
      );

      unlockGame(threadID, userID);

      return;
    }

    // Natural blackjack check
    if (playerValue === 21) {
      const dealerAlsoNatural = dealerValue === 21;

      let finalText;

      if (dealerAlsoNatural) {
        await db.addBalance(threadID, userID, bet);

        const balanceText = await getFinalBalanceText(threadID, userID);

        finalText = [
          gameHeader("blackjack"),
          "",
          "🤝 PUSH — BOTH HOLD BLACKJACK",
          "",
          `♙ YOU     ${playerHand.join("  ")}`,
          `♟ DEALER  ${botHand.join("  ")}`,
          "",
          `💰 Wager refunded: ${formatNumber(bet)} coins`,
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
          "🏆 BLACKJACK! (2.5×)",
          "",
          `♙ YOU     ${playerHand.join("  ")}`,
          `♟ DEALER  ${botHand.join("  ")}`,
          "",
          `💰 Payout: +${formatNumber(payout)} coins`,
          `⭐ XP: +${formatNumber(xpForGame("blackjack"))}`,
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
      gameHeader("blackjack", playerLine(event)),
      "",
      `THE TABLE IS OPEN  •  Wager: ${formatNumber(bet)} coins`,
      "",
      `♙ YOU     ${playerHand.join("  ")}`,
      `          Total: ${playerValue}`,
      `          ${handValueBar(playerValue)}`,
      "",
      `♟ DEALER  ${botHand[0]}  ▣`,
      "          Total: ?",
      "",
      thinDivider(),
      "",
      blackjackActionsFooter(session),
    ].join("\n");

    await updateGameMessage(api, threadID, animator.messageID, text);

    setSession(threadID, userID, session);
  } catch (error) {
    unlockGame(threadID, userID);

    console.error("[games] blackjack:", error);

    await safeReply(api, event, "🌑 The blackjack table could not open.");
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
  let resultText = "The dealer wins.";

  if (botValue > 21) {
    result = "win";
    resultText = "The dealer busted. You win!";
  } else if (playerValue > botValue) {
    result = "win";
    resultText = "Your hand prevails.";
  } else if (playerValue === botValue) {
    result = "draw";
    resultText = "Push — neither hand prevails.";
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
      ? `💰 Wager refunded: ${formatNumber(session.bet)} coins`
      : result === "win"
        ? `💰 Payout: +${formatNumber(session.bet * 2)} coins\n⭐ XP: +${formatNumber(xpForGame("blackjack"))}`
        : `💸 Lost wager: -${formatNumber(session.bet)} coins\n⭐ XP: -${formatNumber(Math.floor(xpForGame("blackjack") * 0.5))}`;

  const finalText = [
    gameHeader("blackjack"),
    "",
    result === "win" ? "🏆 YOU WIN" : result === "draw" ? "🤝 PUSH" : "❌ DEALER WINS",
    "",
    `♙ YOU     ${session.playerHand.join("  ")}`,
    `          Total: ${playerValue}`,
    "",
    `♟ DEALER  ${session.botHand.join("  ")}`,
    `          Total: ${botValue}`,
    "",
    resultText,
    "",
    rewardBlock,
    "",
    balanceText,
  ].join("\n");

  await updateGameMessage(api, threadID, session.messageID, finalText);
}

async function settleBlackjackBust(api, event, session) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const playerValue = calcHandValue(session.playerHand);

  await db.addXP(threadID, userID, -Math.floor(xpForGame("blackjack") * 0.5));

  const balanceText = await getFinalBalanceText(threadID, userID);

  const finalText = [
    gameHeader("blackjack"),
    "",
    "❌ BUST",
    "",
    `♙ ${session.playerHand.join("  ")}`,
    `Total: ${playerValue}`,
    handValueBar(playerValue),
    "",
    "The hand crossed 21.",
    "",
    `💸 Lost wager: -${formatNumber(session.bet)} coins`,
    `⭐ XP: -${formatNumber(Math.floor(xpForGame("blackjack") * 0.5))}`,
    "",
    balanceText,
  ].join("\n");

  await updateGameMessage(api, threadID, session.messageID, finalText);
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
    await safeReply(api, event, "♠️ Use !hit, !stand, or !double.");

    return true;
  }

  try {
    if (cmd === "double") {
      if (session.playerHand.length !== 2 || session.doubled) {
        await safeReply(
          api,
          event,
          "♠️ You can only double down as your first action."
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
          error.message || "♠️ Not enough wallet coins to double down."
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
        `♙ YOU     ${session.playerHand.join("  ")}`,
        `          Total: ${playerValue}`,
        "",
        `♟ DEALER  ${session.botHand[0]}  ▣`,
        "          Total: ?",
        "",
        thinDivider(),
        "",
        blackjackActionsFooter(session),
      ].join("\n");

      await updateGameMessage(api, threadID, session.messageID, text);

      return true;
    }

    // stand
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

    await safeReply(api, event, "🌑 The blackjack hand ended unexpectedly.");

    return true;
  }
}

// ============================================================
// SLOTS — near-miss respin
// ============================================================

const SLOT_SYMBOLS = ["🍒", "🍋", "🍊", "🍉", "⭐", "💎"];

function slotMultiplier(reels) {
  const [a, b, c] = reels;

  if (a === b && b === c) {
    if (a === "💎") return 20;
    if (a === "⭐") return 15;
    return 10;
  }

  if (a === b || b === c || a === c) {
    return 2;
  }

  return 0;
}

function slotsRandomReels() {
  return [
    SLOT_SYMBOLS[randInt(0, SLOT_SYMBOLS.length - 1)],
    SLOT_SYMBOLS[randInt(0, SLOT_SYMBOLS.length - 1)],
    SLOT_SYMBOLS[randInt(0, SLOT_SYMBOLS.length - 1)],
  ];
}

function slotsReelText(reels, highlight = false) {
  const cells = highlight ? reels.map((symbol) => `[${symbol}]`) : reels;
  return `│  ${cells.join("  │  ")}  │`;
}

async function handleSlots(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  let betCharged = false;
  let settled = false;

  try {
    const bet = parseBet(args?.[0]);

    if (!validBet(bet)) {
      unlockGame(threadID, userID);

      await safeReply(
        api,
        event,
        `🎰 Invalid wager.\n\nMinimum: 1\nMaximum: ${formatNumber(MAX_BET)} coins`
      );

      return;
    }

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("slots", playerLine(event)),
        "",
        "THE REELS AWAKEN",
        "",
        "│     🍒   │   🍋   │   ⭐     │",
        "",
        `💰 Wager: ${formatNumber(bet)} coins`,
        "",
        "             SPINNING",
      ].join("\n"),
      "slots"
    );

    try {
      await db.spendBalance(threadID, userID, bet, `Slots bet: ${bet}`);
      betCharged = true;
    } catch (error) {
      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("slots"),
          "",
          "🌑 WAGER REJECTED",
          "",
          error.message || "Not enough wallet coins.",
        ].join("\n")
      );

      unlockGame(threadID, userID);

      return;
    }

    const spinLabels = ["SPINNING", "SPINNING...", "SLOWING DOWN..."];

    await sleep(700);

    for (let i = 0; i < spinLabels.length; i++) {
      const rolling = slotsRandomReels();

      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("slots"),
          "",
          thinDivider(),
          "",
          slotsReelText(rolling),
          "",
          `             ${spinLabels[i]}`,
        ].join("\n")
      );

      await sleep(editDelay());
    }

    const reels = slotsRandomReels();
    const multiplier = slotMultiplier(reels);
    const won = multiplier > 0;
    const payout = won ? bet * multiplier : 0;

    if (won) {
      settled = true;

      await db.addBalance(threadID, userID, payout);
      await db.addXP(threadID, userID, xpForGame("slots"));

      const net = payout - bet;
      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("slots"),
        "",
        thinDivider(),
        "",
        slotsReelText(reels, true),
        "",
        `🏆 ${multiplier}× MATCH`,
        "",
        `💰 Payout: +${formatNumber(payout)} coins`,
        `📈 Net profit: +${formatNumber(net)} coins`,
        "",
        balanceText,
      ].join("\n");

      await updateGameMessage(api, threadID, animator.messageID, finalText);
      unlockGame(threadID, userID);

      return;
    }

    const nearMiss = new Set(reels).size === 2;

    if (!nearMiss) {
      settled = true;

      await db.addXP(threadID, userID, -Math.floor(xpForGame("slots") * 0.5));

      const balanceText = await getFinalBalanceText(threadID, userID);

      const finalText = [
        gameHeader("slots"),
        "",
        thinDivider(),
        "",
        slotsReelText(reels),
        "",
        "❌ NO MATCH",
        "",
        `💸 Lost wager: -${formatNumber(bet)} coins`,
        "",
        balanceText,
      ].join("\n");

      await updateGameMessage(api, threadID, animator.messageID, finalText);
      unlockGame(threadID, userID);

      return;
    }

    // Near miss — offer a paid respin of the third reel only.
    settled = true;

    const respinCost = Math.max(
      1,
      Math.floor(bet * SLOTS_RESPIN_COST_RATIO)
    );

    setSession(threadID, userID, {
      type: "slots_respin",
      reels,
      bet,
      respinCost,
      messageID: animator.messageID,
    });

    const finalText = [
      gameHeader("slots"),
      "",
      thinDivider(),
      "",
      slotsReelText(reels),
      "",
      "✦ So close — two symbols lined up.",
      "",
      `💸 Wager lost: -${formatNumber(bet)} coins`,
      "",
      thinDivider(),
      `↳ Pay ${formatNumber(respinCost)} coins to reroll the third reel for one`,
      "  more shot at completing the match? Reply 'respin' or 'skip'.",
    ].join("\n");

    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] slots:", error);

    if (betCharged && !settled) {
      const bet = parseBet(args?.[0]);

      if (validBet(bet)) {
        await db.addBalance(threadID, userID, bet).catch(() => {});
      }
    }

    unlockGame(threadID, userID);

    await safeReply(api, event, "🌑 The reels could not complete their judgment.");
  }
}

async function resolveSlotsRespin(api, event, actionText) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);
  const session = getSession(threadID, userID);

  if (!session || session.type !== "slots_respin") {
    return false;
  }

  const word = normalizeKeyword(actionText);

  if (/^(skip|no|stop|cancel)$/.test(word)) {
    clearSession(threadID, userID);
    unlockGame(threadID, userID);

    await safeReply(api, event, "🌑 You accept the loss and step away.");

    return true;
  }

  if (!/^(respin|reroll|retry)$/.test(word)) {
    await safeReply(
      api,
      event,
      `🌑 Reply 'respin' (${formatNumber(session.respinCost)} coins) or 'skip'.`
    );

    return true;
  }

  clearSession(threadID, userID);

  try {
    await db.spendBalance(
      threadID,
      userID,
      session.respinCost,
      "Slots respin"
    );
  } catch (error) {
    unlockGame(threadID, userID);

    await safeReply(
      api,
      event,
      error.message || "🌑 Not enough wallet coins for a respin."
    );

    return true;
  }

  const newThird = SLOT_SYMBOLS[randInt(0, SLOT_SYMBOLS.length - 1)];
  const finalReels = [session.reels[0], session.reels[1], newThird];
  const matched = finalReels[0] === finalReels[1] && finalReels[1] === finalReels[2];

  if (matched) {
    const baseMultiplier = slotMultiplier(finalReels);
    const rescueMultiplier = Math.max(2, Math.floor(baseMultiplier / 2));
    const payout = session.bet * rescueMultiplier;

    await db.addBalance(threadID, userID, payout);
    await db.addXP(threadID, userID, xpForGame("slots"));

    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("slots"),
      "",
      thinDivider(),
      "",
      slotsReelText(finalReels, true),
      "",
      `🏆 RESPIN MATCH  •  ${rescueMultiplier}×`,
      "",
      `💰 Payout: +${formatNumber(payout)} coins`,
      "",
      balanceText,
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);
  } else {
    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("slots"),
      "",
      thinDivider(),
      "",
      slotsReelText(finalReels),
      "",
      "❌ THE RESPIN FAILED",
      "",
      `💸 Respin cost: -${formatNumber(session.respinCost)} coins`,
      "",
      balanceText,
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);
  }

  unlockGame(threadID, userID);

  return true;
}

// ============================================================
// MATH
// ============================================================

async function handleMath(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  try {
    const a = randInt(1, 100);
    const b = randInt(1, 100);
    const ops = ["+", "-", "*"];
    const op = ops[randInt(0, 2)];

    let correctAnswer;

    if (op === "+") correctAnswer = a + b;
    else if (op === "-") correctAnswer = a - b;
    else correctAnswer = a * b;

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("math", playerLine(event)),
        "",
        "PRECISION REQUIRED",
        "",
        "🧮 Solve:",
        "",
        `        ${a} ${op} ${b}`,
        "",
        thinDivider(),
        "",
        "↳ Reply with your answer.",
      ].join("\n"),
      "math"
    );

    setSession(threadID, userID, {
      type: "math",
      correctAnswer,
      messageID: animator.messageID,
    });
  } catch (error) {
    unlockGame(threadID, userID);

    console.error("[games] math:", error);

    await safeReply(api, event, "🌑 The Veil could not generate an equation.");
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
      correct ? "🏆 CALCULATION COMPLETE" : "❌ CALCULATION FAILED",
      "",
      `Your answer: ${Number.isNaN(userAnswer) ? "Invalid" : userAnswer}`,
      `Correct: ${session.correctAnswer}`,
      "",
      correct ? "✦ Precision wins." : "✦ The equation wins this round.",
      "",
      rewardLine(reward, balanceText, correct),
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);
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
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  try {
    const riddle = await riddleManager.getNextRiddle({ threadID });

    if (!riddle) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "🌑 The Veil has no riddles available.");

      return;
    }

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("riddle", playerLine(event)),
        "",
        "THE VEIL SPEAKS IN QUESTIONS",
        "",
        `❝ ${riddle.question} ❞`,
        "",
        "🧠 Think carefully.",
        "",
        thinDivider(),
        "",
        "↳ Reply with your answer.",
      ].join("\n"),
      "riddle"
    );

    setSession(threadID, userID, {
      type: "riddle",
      question: riddle.question,
      answers: riddle.answers,
      messageID: animator.messageID,
    });
  } catch (error) {
    unlockGame(threadID, userID);

    console.error("[games] riddle:", error);

    await safeReply(api, event, "🌑 The Veil could not reveal a riddle.");
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
      correct ? "🏆 MYSTERY SOLVED" : "❌ THE VEIL ENDURES",
      "",
      `Your answer: ${answerText}`,
      `Correct: ${session.answers[0]}`,
      "",
      correct
        ? "✦ Your mind pierced the mystery."
        : "✦ The riddle remains undefeated.",
      "",
      rewardLine(reward, balanceText, correct),
    ].join("\n");

    await updateGameMessage(api, threadID, session.messageID, finalText);
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
  "It is certain",
  "It is decidedly so",
  "Without a doubt",
  "Yes definitely",
  "You may rely on it",
  "As I see it, yes",
  "Most likely",
  "Outlook good",
  "Yes",
  "Signs point to yes",
  "Reply hazy, try again",
  "Ask again later",
  "Better not tell you now",
  "Cannot predict now",
  "Concentrate and ask again",
  "Don't count on it",
  "My reply is no",
  "My sources say no",
  "Outlook not so good",
  "Very doubtful",
];

async function handleEightBall(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (!lockGame(threadID, userID)) {
    await safeReply(
      api,
      event,
      "🌑 The Veil is already occupied.\n\nFinish your current challenge first."
    );

    return;
  }

  try {
    const question = Array.isArray(args) ? args.join(" ") : String(args || "");

    if (!question.trim()) {
      unlockGame(threadID, userID);

      await safeReply(api, event, "🔮 Ask the Oracle a question.");

      return;
    }

    const animator = await createAnimator(
      api,
      threadID,
      [
        gameHeader("8ball", playerLine(event)),
        "",
        "THE ORACLE LISTENS",
        "",
        `❝ ${question} ❞`,
        "",
        "🔮 Consulting the Veil...",
        "",
        "             ◉",
      ].join("\n"),
      "8ball"
    );

    await sleep(editDelay());

    const response =
      EIGHTBALL_RESPONSES[randInt(0, EIGHTBALL_RESPONSES.length - 1)];

    const reward = await awardPlayer(threadID, userID, "8ball", true);
    const balanceText = await getFinalBalanceText(threadID, userID);

    const finalText = [
      gameHeader("8ball"),
      "",
      "🔮 THE ORACLE ANSWERS",
      "",
      `❝ ${question} ❞`,
      "",
      `        ✦`,
      "",
      `"${response}"`,
      "",
      thinDivider(),
      "",
      `💰 +${formatNumber(reward.coins)} coins`,
      `⭐ +${formatNumber(reward.xp)} XP`,
      "",
      balanceText,
    ].join("\n");

    await updateGameMessage(api, threadID, animator.messageID, finalText);
  } catch (error) {
    console.error("[games] 8ball:", error);

    await safeReply(api, event, "🌑 The Oracle could not answer.");
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
        "YOUR VEIL STATUS",
        "",
        `💰 Wallet      ${balance}`,
        `⭐ XP          ${xp}`,
        `⚔️ RPS streak  ${rpsStreak}`,
        "",
        `🎮 Active      ${active ? "YES" : "NO"}`,
        `🌑 Session     ${sessionName}`,
        "",
        thinDivider(),
        "",
        active
          ? "✦ A challenge is currently active."
          : "✦ No active challenge.",
        "",
        "The Veil remembers every result.",
      ].join("\n")
    );

    return true;
  } catch (error) {
    console.error("[games] status:", error);

    await safeReply(api, event, "🌑 The Veil could not retrieve your status.");

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
      "╭────────────────────────────╮",
      "          🌑 THE VEIL",
      "           RULEBOOK",
      "╰────────────────────────────╯",
      "",
      "       RISK • SKILL • FATE",
      "",
      "╭────── 🧠 CHALLENGES ──────╮",
      "",
      "🧠 TRIVIA / 🧩 RIDDLE / 🧮 MATH",
      "• One-shot: answer correctly for XP + coins.",
      "• Wrong answers cost half XP.",
      "",
      "╰────────────────────────────╯",
      "",
      "╭────── 🎲 FORTUNE ─────────╮",
      "",
      "🎲 ROLL",
      "!roll <bet> [sides] [safe|normal|risky]",
      "• SAFE: ~40% high zone, 1.5× payout.",
      "• BALANCED (default): ~45% high zone, 2×.",
      "• RISKY: ~25% high zone, 4×.",
      "• A win opens a ladder: reply 'cashout' to",
      "  bank it, or 'doubledown' for a 50/50 to",
      "  double the pending payout (max 3 rungs).",
      "",
      "🪙 COINFLIP",
      "!coinflip <bet> <heads|tails>",
      "• Correct call opens a streak ladder — same",
      "  'cashout' / 'doubledown' choice as ROLL,",
      "  up to 5 consecutive flips.",
      "",
      "🎰 SLOTS",
      "!slots <bet>",
      "• Pair = 2× • Triple = 10× • ⭐⭐⭐ = 15× • 💎💎💎 = 20×.",
      "• A near-miss (two matching) offers a paid",
      "  respin of the third reel at half the bet.",
      "",
      "╰────────────────────────────╯",
      "",
      "╭────── 🎯 CHALLENGES ──────╮",
      "",
      "🎯 GUESS",
      "!guess <min> <max> [bet]",
      "• Optional wager: payout scales with speed —",
      "  1st try 4×, 2nd try 2.5×, 3rd try 1.5×.",
      "• Reply 'doubledown' before your final guess",
      "  to double the wager and payout.",
      "• No bet given = free XP/coin mode as before.",
      "",
      "⚔️ RPS",
      "!rps <rock|paper|scissors>",
      "• Best of 3 rounds settles each match.",
      "• Win streaks persist between matches and",
      "  boost your coin payout up to ×2.5.",
      "• A loss resets your streak to zero.",
      "",
      "╰────────────────────────────╯",
      "",
      "╭────── ♠️ TABLE ───────────╮",
      "",
      "♠️ BLACKJACK",
      "!blackjack <bet>",
      "",
      "Actions:",
      "!hit    !stand    !double",
      "",
      "• Natural 21 pays 2.5× instantly.",
      "• !double doubles your wager, draws exactly",
      "  one card, then auto-stands (first move only).",
      "• Dealer draws to 17. Win = 2×, push = refund.",
      "",
      "╰────────────────────────────╯",
      "",
      "╭────── 🔮 UNKNOWN ─────────╮",
      "",
      "🔮 8-BALL",
      "!8ball <question>",
      "• Ask the Oracle. No wager required.",
      "",
      "╰────────────────────────────╯",
      "",
      "╭────── ✦ CLAIMS ───────────╮",
      "",
      "✦ DAILY / ◈ WORK",
      "• After claiming, reply 'gamble' to risk the",
      "  full amount on a 50/50 double-or-nothing,",
      "  or 'keep' to bank it immediately.",
      "",
      "╰────────────────────────────╯",
      "",
      "╭────── 💰 LIMITS ──────────╮",
      "",
      `Maximum wager: ${formatNumber(MAX_BET)} coins`,
      "",
      "Wagers are charged before resolution.",
      "Unexpected failures are refunded",
      "when the wager has already been charged.",
      "",
      "╰────────────────────────────╯",
      "",
      "        🌑 THE VEIL",
      "",
      "     Enter for fortune.",
      "     Leave with what fate allows.",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "↩ !games • Return to the Game Center",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
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
      "╭────────────────────────────╮",
      "          🌑 THE VEIL",
      "╰────────────────────────────╯",
      "",
      "      FATE • SKILL • FORTUNE",
      "",
      "╭────── 🧠 CHALLENGE ───────╮",
      "",
      "🧠 TRIVIA",
      "   Test your knowledge",
      "   !trivia",
      "",
      "🧩 RIDDLE",
      "   Outsmart the unknown",
      "   !riddle",
      "",
      "🧮 MATH",
      "   Precision under pressure",
      "   !math",
      "",
      "╰────────────────────────────╯",
      "",
      "╭────── 🎲 FORTUNE ─────────╮",
      "",
      "🎲 ROLL",
      "   !roll <bet> [sides] [safe|normal|risky]",
      "   Double-down ladder on every win",
      "",
      "🪙 COINFLIP",
      "   !coinflip <bet> <heads|tails>",
      "   Press-your-luck streak ladder",
      "",
      "🎯 GUESS",
      "   !guess <min> <max> [bet]",
      "   Speed-scaled payout + double down",
      "",
      "🎰 SLOTS",
      "   !slots <bet>",
      "   Near-miss respin rescue",
      "",
      "╰────────────────────────────╯",
      "",
      "╭────── ⚔️ TABLE ───────────╮",
      "",
      "⚔️ RPS",
      "   !rps <rock|paper|scissors>",
      "   Best of 3 + persistent win streak",
      "",
      "♠️ BLACKJACK",
      "   !blackjack <bet>",
      "   !hit • !stand • !double",
      "",
      "🔮 8-BALL",
      "   !8ball <question>",
      "",
      "╰────────────────────────────╯",
      "",
      "🌑 !games rules",
      "   View the complete rulebook.",
      "",
      "🌑 !games status",
      "   View your Veil status.",
      "",
      "        ✦ FATE HAS NO FAVORITES ✦",
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
// MAIN GAME COMMAND DISPATCHER
// ============================================================

async function handleGameCommand(api, event, command, args) {
  const cmd = String(command || "").trim().toLowerCase();
  const normalizedArgs = normalizeArgs(args);

  if (cmd === "games") {
    const subcommand = String(normalizedArgs[0] || "").trim().toLowerCase();

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
      `🌑 UNKNOWN PATH\n\n"${cmd}" is not part of The Veil.\n\nUse !games to view the available games.`
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

  if (session.type === "slots_respin") {
    return resolveSlotsRespin(api, event, answerText);
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
