/**
 * games.js
 * ========
 *
 * Game + Economy System
 *
 * Features:
 * - Free-play games
 * - Coins earned through gameplay
 * - XP / levels / ranks
 * - Daily rewards
 * - Work
 * - Wallet / bank
 * - Transfers
 * - Savings interest
 * - Loan simulation
 * - Credit score
 * - Math
 * - Riddles
 * - Trivia
 * - RPS
 * - Roll
 * - Guess
 * - Coinflip
 * - Slots
 * - Blackjack
 * - 8-ball
 * - Leaderboards
 * - Achievements
 * - Protected Messenger animations
 *
 * No wagering is used.
 */

const db = require("./db");
const { reply } = require("./util");

const triviaQuestions = require("./trivia-questions");
const riddleQuestions = require("./riddle-questions");
const mathQuestions = require("./math-questions");

// ============================================================
// CONFIG
// ============================================================

const SESSION_TIMEOUT_MS = 30_000;

// Animation pacing.
// Never intentionally waits longer than 3 seconds between edits.
const EDIT_MIN_MS = 2200;
const EDIT_MAX_MS = 3000;

// Never let a broken FCA callback freeze a game forever.
const EDIT_TIMEOUT_MS = 3500;

const DAILY_COOLDOWN_MS =
  24 * 60 * 60 * 1000;

const WORK_COOLDOWN_MS =
  60 * 60 * 1000;

const BANK_INTEREST_RATE = 0.01;

const sessions = new Map();
const sessionTimers = new Map();
const activeGames = new Set();


// ============================================================
// BASIC HELPERS
// ============================================================

function randInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}


function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


function editDelay() {
  return randInt(
    EDIT_MIN_MS,
    EDIT_MAX_MS
  );
}


function formatNumber(value) {
  return Number(value || 0)
    .toLocaleString("en-US");
}


function sessionKey(threadID, userID) {
  return `${threadID}:${userID}`;
}


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
    "8ball": 10
  };

  return rewards[type] || 25;
}


function coinReward(type, won = true) {
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
    "8ball": 25
  };

  const base = rewards[type] || 50;

  return won
    ? base
    : Math.floor(base * 0.25);
}


// ============================================================
// PLAYER NAME
// ============================================================

function getPlayerName(event) {
  if (
    event &&
    event.senderName
  ) {
    return String(event.senderName);
  }

  if (
    event &&
    event.userName
  ) {
    return String(event.userName);
  }

  const id =
    event && event.senderID
      ? String(event.senderID)
      : "Player";

  return `Player ${id.slice(-4)}`;
}


// ============================================================
// MESSENGER HELPERS
// ============================================================

function sendMessageAsync(
  api,
  threadID,
  text
) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const finish = (
      error,
      messageInfo
    ) => {
      if (finished) return;

      finished = true;

      if (error) {
        reject(error);
        return;
      }

      resolve(messageInfo || null);
    };

    try {
      api.sendMessage(
        text,
        threadID,
        (error, messageInfo) => {
          finish(
            error,
            messageInfo
          );
        }
      );
    } catch (error) {
      finish(error);
    }
  });
}


function getMessageID(messageInfo) {
  if (!messageInfo) {
    return null;
  }

  return (
    messageInfo.messageID ||
    messageInfo.messageId ||
    messageInfo.mid ||
    null
  );
}


// ============================================================
// SAFE EDIT
// ============================================================

function editMessageSafe(
  api,
  text,
  messageID,
  timeoutMs = EDIT_TIMEOUT_MS
) {
  return new Promise(resolve => {
    let finished = false;

    let timer = null;

    const finish = success => {
      if (finished) return;

      finished = true;

      if (timer) {
        clearTimeout(timer);
      }

      resolve(success);
    };

    timer = setTimeout(() => {
      console.warn(
        "[games] editMessage timeout"
      );

      finish(false);
    }, timeoutMs);

    try {
      if (
        !messageID ||
        typeof api.editMessage !== "function"
      ) {
        finish(false);
        return;
      }

      api.editMessage(
        text,
        messageID,
        error => {
          if (error) {
            console.warn(
              "[games] editMessage error:",
              error.message || error
            );

            finish(false);
            return;
          }

          finish(true);
        }
      );
    } catch (error) {
      console.error(
        "[games] editMessage exception:",
        error
      );

      finish(false);
    }
  });
}


// ============================================================
// ANIMATOR
// ============================================================
//
// Important:
// - One original Messenger message.
// - Sequential edits.
// - Never waits forever.
// - If editing fails, caller can immediately use final fallback.
// ============================================================

async function createAnimator(
  api,
  threadID,
  firstText,
  label = "game"
) {
  const sent =
    await sendMessageAsync(
      api,
      threadID,
      firstText
    );

  const messageID =
    getMessageID(sent);

  const canEdit =
    Boolean(messageID) &&
    typeof api.editMessage === "function";

  let editNumber = 0;
  let broken = false;

  async function edit(text) {
    if (
      broken ||
      !canEdit
    ) {
      return false;
    }

    editNumber++;

    const success =
      await editMessageSafe(
        api,
        text,
        messageID
      );

    console.log(
      `[games:${label}] edit #${editNumber}: ${
        success
          ? "OK"
          : "FAILED"
      }`
    );

    if (!success) {
      broken = true;
    }

    return success;
  }


  async function waitAndEdit(text) {
    if (broken) {
      return false;
    }

    await sleep(
      editDelay()
    );

    return edit(text);
  }


  async function final(text) {
    if (
      !broken &&
      canEdit
    ) {
      const success =
        await editMessageSafe(
          api,
          text,
          messageID
        );

      if (success) {
        return true;
      }

      broken = true;

      console.warn(
        `[games:${label}] final edit failed; using fallback message`
      );
    }

    try {
      await sendMessageAsync(
        api,
        threadID,
        text
      );

      return false;
    } catch (error) {
      console.error(
        `[games:${label}] final send failed:`,
        error
      );

      return false;
    }
  }


  return {
    messageID,
    edit,
    waitAndEdit,
    final,

    get broken() {
      return broken;
    }
  };
}


// ============================================================
// SAFE REPLY
// ============================================================

async function safeReply(
  api,
  event,
  text
) {
  try {
    await reply(
      api,
      event,
      text
    );
  } catch (error) {
    console.error(
      "[games] reply failed:",
      error
    );
  }
}


// ============================================================
// SESSION SYSTEM
// ============================================================

function clearSession(
  threadID,
  userID
) {
  const key =
    sessionKey(
      threadID,
      userID
    );

  sessions.delete(key);

  const timer =
    sessionTimers.get(key);

  if (timer) {
    clearTimeout(timer);
    sessionTimers.delete(key);
  }
}


function setSession(
  threadID,
  userID,
  session
) {
  const key =
    sessionKey(
      threadID,
      userID
    );

  const oldTimer =
    sessionTimers.get(key);

  if (oldTimer) {
    clearTimeout(oldTimer);
  }

  sessions.set(
    key,
    session
  );

  const timer =
    setTimeout(() => {
      sessions.delete(key);
      sessionTimers.delete(key);
      activeGames.delete(key);
    }, SESSION_TIMEOUT_MS);

  sessionTimers.set(
    key,
    timer
  );
}


function getSession(
  threadID,
  userID
) {
  return sessions.get(
    sessionKey(
      threadID,
      userID
    )
  );
}


function clearThreadSessions(
  threadID
) {
  for (
    const [key] of sessions.entries()
  ) {
    if (
      key.startsWith(
        `${threadID}:`
      )
    ) {
      sessions.delete(key);

      const timer =
        sessionTimers.get(key);

      if (timer) {
        clearTimeout(timer);
        sessionTimers.delete(key);
      }

      activeGames.delete(key);
    }
  }
}


function isGameActive(
  threadID,
  userID
) {
  return activeGames.has(
    sessionKey(
      threadID,
      userID
    )
  );
}


function lockGame(
  threadID,
  userID
) {
  const key =
    sessionKey(
      threadID,
      userID
    );

  if (
    activeGames.has(key)
  ) {
    return false;
  }

  activeGames.add(key);

  return true;
}


function unlockGame(
  threadID,
  userID
) {
  activeGames.delete(
    sessionKey(
      threadID,
      userID
    )
  );
}


// ============================================================
// GAME ENABLE / DISABLE
// ============================================================

async function gamesAreEnabled(
  threadID
) {
  try {
    return await db.isGameEnabled(
      String(threadID)
    );
  } catch (error) {
    console.error(
      "[games] game setting error:",
      error
    );

    return false;
  }
}


async function handleGameToggle(
  api,
  event,
  text
) {
  const threadID =
    String(event.threadID);

  const lower =
    text.toLowerCase().trim();

  let enabled = null;

  if (
    lower === "!game on" ||
    lower === "!games on"
  ) {
    enabled = true;
  }

  if (
    lower === "!game off" ||
    lower === "!games off"
  ) {
    enabled = false;
  }

  if (enabled === null) {
    return false;
  }

  try {
    await db.setGameEnabled(
      threadID,
      enabled
    );

    if (!enabled) {
      clearThreadSessions(
        threadID
      );
    }

    await safeReply(
      api,
      event,
      enabled
        ? [
            "╭━━━━━━━━━━━━━━━━━━━━╮",
            "        🎮 GAMES",
            "╰━━━━━━━━━━━━━━━━━━━━╯",
            "",
            "✦ Status: 🟢 ON",
            "",
            "Games are now enabled.",
            "",
            "Use !games to see everything."
          ].join("\n")
        : [
            "╭━━━━━━━━━━━━━━━━━━━━╮",
            "        🎮 GAMES",
            "╰━━━━━━━━━━━━━━━━━━━━╯",
            "",
            "✦ Status: 🔴 OFF",
            "",
            "Games have been disabled."
          ].join("\n")
    );

    return true;
  } catch (error) {
    console.error(
      "[games] toggle failed:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Couldn't change the game setting."
    );

    return true;
  }
}


// ============================================================
// GAME MENU
// ============================================================

async function handleGamesMenu(
  api,
  event
) {
  const enabled =
    await gamesAreEnabled(
      String(event.threadID)
    );

  const status =
    enabled
      ? "🟢 ON"
      : "🔴 OFF";

  const menu = [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    "        🎮 GAME ROOM",
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `✦ Status: ${status}`,
    "",
    "╭─ 🎯 GAMES",
    "│",
    "├ ✊ !rps rock",
    "├ 🎲 !roll",
    "├ 🎯 !guess 1-10",
    "├ 🪙 !coinflip heads",
    "├ 🎰 !slots",
    "├ 🃏 !blackjack",
    "│   └─ !hit / !stand",
    "│",
    "├ 🧠 !trivia",
    "├ 🧮 !math",
    "├ 🧩 !riddle",
    "├ 🎱 !8ball <question>",
    "│",
    "╰────────────────────",
    "",
    "╭─ 💰 ECONOMY",
    "│",
    "├ 💰 !balance",
    "├ 🏦 !bank",
    "├ 💵 !deposit <amount>",
    "├ 💸 !withdraw <amount>",
    "├ 🔄 !transfer <user> <amount>",
    "├ 🎁 !daily",
    "├ 💼 !work",
    "│",
    "├ 👤 !profile",
    "├ 🏆 !rank",
    "├ 📊 !leaderboard",
    "│",
    "├ 🏦 !loan",
    "├ 📝 !loan apply <amount>",
    "├ 💳 !loan pay <amount>",
    "│",
    "╰────────────────────",
    "",
    "⚙️ Admin:",
    "!game on • !game off"
  ].join("\n");

  await safeReply(
    api,
    event,
    menu
  );
}


// ============================================================
// AWARD SYSTEM
// ============================================================

async function awardPlayer(
  threadID,
  userID,
  gameType,
  won = true
) {
  const coins =
    coinReward(
      gameType,
      won
    );

  const xp =
    xpForGame(gameType);

  let newXP;

  try {
    await db.addBalance(
      threadID,
      userID,
      coins
    );

    newXP =
      await db.addXP(
        threadID,
        userID,
        xp
      );

    await db.incrementGameStats(
      threadID,
      userID,
      won
    );
  } catch (error) {
    console.error(
      "[games] award failed:",
      error
    );

    throw error;
  }

  return {
    coins,
    xp,
    rank: newXP.rank,
    level: newXP.level,
    rankUp:
      newXP.rank.name !==
      newXP.previousRank.name
  };
}


// ============================================================
// FINAL BALANCE
// ============================================================

async function getCurrentBalance(
  threadID,
  userID
) {
  try {
    const user =
      await db.getUser(
        threadID,
        userID
      );

    return Number(
      user.balance || 0
    );
  } catch (error) {
    console.error(
      "[games] balance lookup failed:",
      error
    );

    return null;
  }
}


async function getFinalBalanceText(
  threadID,
  userID
) {
  const balance =
    await getCurrentBalance(
      threadID,
      userID
    );

  if (balance === null) {
    return "💳 Balance: unavailable";
  }

  return `💳 Balance: ${formatNumber(balance)} coins`;
}


// ============================================================
// PROFILE
// ============================================================

async function handleProfile(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const user =
    await db.getUser(
      threadID,
      userID
    );

  const rank =
    db.getRank(
      Number(user.xp)
    );

  const nextRank =
    db.getNextRank(
      Number(user.xp)
    );

  const netWorth =
    Number(user.balance) +
    Number(user.bank_balance);

  const progress =
    nextRank
      ? `${formatNumber(
          user.xp
        )} / ${formatNumber(
          nextRank.minXP
        )} XP`
      : `${formatNumber(
          user.xp
        )} XP`;

  const message = [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    "       👤 PROFILE",
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `👤 ${getPlayerName(event)}`,
    "",
    `${rank.emoji} Rank: ${rank.name}`,
    `⭐ Level: ${user.level}`,
    `✨ XP: ${progress}`,
    "",
    `💰 Wallet: ${formatNumber(
      user.balance
    )}`,
    `🏦 Bank: ${formatNumber(
      user.bank_balance
    )}`,
    `📊 Net Worth: ${formatNumber(
      netWorth
    )}`,
    "",
    `🎮 Games: ${user.games_played}`,
    `🏆 Wins: ${user.wins}`,
    `📈 Win Rate: ${
      user.games_played
        ? Math.round(
            (Number(user.wins) /
              Number(user.games_played)) *
              100
          )
        : 0
    }%`,
    "",
    `💳 Credit Score: ${user.credit_score}`,
    `🧾 Loan: ${formatNumber(
      user.loan_remaining
    )}`,
    "",
    nextRank
      ? `🎯 Next: ${nextRank.emoji} ${nextRank.name}`
      : "🌟 Maximum rank reached!"
  ].join("\n");

  await safeReply(
    api,
    event,
    message
  );
}


// ============================================================
// BALANCE
// ============================================================

async function handleBalance(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const user =
    await db.getUser(
      threadID,
      userID
    );

  const total =
    Number(user.balance) +
    Number(user.bank_balance);

  await safeReply(
    api,
    event,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        💰 WALLET",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      `💵 Wallet: ${formatNumber(
        user.balance
      )}`,
      `🏦 Bank: ${formatNumber(
        user.bank_balance
      )}`,
      "",
      `📊 Total: ${formatNumber(
        total
      )}`,
      "",
      "Use !bank for banking options."
    ].join("\n")
  );
}


// ============================================================
// BANK
// ============================================================

async function handleBank(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const user =
    await db.getUser(
      threadID,
      userID
    );

  const interest =
    Math.floor(
      Number(user.bank_balance) *
      BANK_INTEREST_RATE
    );

  await safeReply(
    api,
    event,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "          🏦 BANK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      `💵 Wallet: ${formatNumber(
        user.balance
      )}`,
      `🏦 Savings: ${formatNumber(
        user.bank_balance
      )}`,
      "",
      `📈 Interest preview: +${formatNumber(
        interest
      )}`,
      "",
      "Commands:",
      "💵 !deposit <amount>",
      "💸 !withdraw <amount>",
      "🔄 !transfer <user> <amount>",
      "",
      "🏦 Your savings earn simulated interest."
    ].join("\n")
  );
}


// ============================================================
// DEPOSIT
// ============================================================

async function handleDeposit(
  api,
  event,
  args
) {
  const amount =
    Number(args[0]);

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    await safeReply(
      api,
      event,
      "💵 Usage: !deposit <amount>"
    );

    return;
  }

  try {
    const user =
      await db.deposit(
        event.threadID,
        event.senderID,
        amount
      );

    await safeReply(
      api,
      event,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       💵 DEPOSIT",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        `💵 Deposited: ${formatNumber(
          amount
        )}`,
        `💰 Wallet: ${formatNumber(
          user.balance
        )}`,
        `🏦 Bank: ${formatNumber(
          user.bank_balance
        )}`,
        "",
        "✅ Deposit complete."
      ].join("\n")
    );
  } catch (error) {
    if (
      error.message ===
      "INSUFFICIENT_FUNDS"
    ) {
      await safeReply(
        api,
        event,
        "❌ You don't have enough wallet coins."
      );

      return;
    }

    console.error(
      "[games] deposit:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Deposit failed."
    );
  }
}


// ============================================================
// WITHDRAW
// ============================================================

async function handleWithdraw(
  api,
  event,
  args
) {
  const amount =
    Number(args[0]);

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    await safeReply(
      api,
      event,
      "💸 Usage: !withdraw <amount>"
    );

    return;
  }

  try {
    const user =
      await db.withdraw(
        event.threadID,
        event.senderID,
        amount
      );

    await safeReply(
      api,
      event,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "      💸 WITHDRAW",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        `💵 Withdrawn: ${formatNumber(
          amount
        )}`,
        `💰 Wallet: ${formatNumber(
          user.balance
        )}`,
        `🏦 Bank: ${formatNumber(
          user.bank_balance
        )}`,
        "",
        "✅ Withdrawal complete."
      ].join("\n")
    );
  } catch (error) {
    if (
      error.message ===
      "INSUFFICIENT_FUNDS"
    ) {
      await safeReply(
        api,
        event,
        "❌ Your bank doesn't have enough coins."
      );

      return;
    }

    console.error(
      "[games] withdrawal:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Withdrawal failed."
    );
  }
}


// ============================================================
// TRANSFER
// ============================================================

async function handleTransfer(
  api,
  event,
  args
) {
  if (
    args.length < 2
  ) {
    await safeReply(
      api,
      event,
      "🔄 Usage: !transfer <userID> <amount>"
    );

    return;
  }

  const targetID =
    String(args[0])
      .replace(/[<@>]/g, "");

  const amount =
    Number(args[1]);

  if (
    !targetID ||
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    await safeReply(
      api,
      event,
      "❌ Invalid transfer."
    );

    return;
  }

  try {
    await db.transfer(
      event.threadID,
      event.senderID,
      targetID,
      amount
    );

    await safeReply(
      api,
      event,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🔄 TRANSFER",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        `👤 From: ${getPlayerName(
          event
        )}`,
        `🎯 To: ${targetID}`,
        `💰 Amount: ${formatNumber(
          amount
        )}`,
        "",
        "✅ Transfer completed."
      ].join("\n")
    );
  } catch (error) {
    if (
      error.message ===
      "INSUFFICIENT_FUNDS"
    ) {
      await safeReply(
        api,
        event,
        "❌ You don't have enough coins."
      );

      return;
    }

    if (
      error.message ===
      "SELF_TRANSFER"
    ) {
      await safeReply(
        api,
        event,
        "❌ You can't transfer to yourself."
      );

      return;
    }

    console.error(
      "[games] transfer:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Transfer failed."
    );
  }
}


// ============================================================
// DAILY
// ============================================================

async function handleDaily(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const user =
    await db.getUser(
      threadID,
      userID
    );

  const now =
    Date.now();

  if (
    user.last_daily &&
    now -
      Number(user.last_daily) <
      DAILY_COOLDOWN_MS
  ) {
    const remaining =
      DAILY_COOLDOWN_MS -
      (
        now -
        Number(user.last_daily)
      );

    const hours =
      Math.ceil(
        remaining /
          (60 * 60 * 1000)
      );

    await safeReply(
      api,
      event,
      `⏳ Daily reward already claimed.\nCome back in about ${hours} hour(s).`
    );

    return;
  }

  let streak =
    Number(
      user.daily_streak
    ) || 0;

  const yesterday =
    DAILY_COOLDOWN_MS;

  if (
    user.last_daily &&
    now -
      Number(user.last_daily) <=
      yesterday * 2
  ) {
    streak++;
  } else {
    streak = 1;
  }

  const reward =
    500 +
    Math.min(
      streak * 50,
      1000
    );

  await db.addBalance(
    threadID,
    userID,
    reward
  );

  const xp =
    await db.addXP(
      threadID,
      userID,
      50
    );

  await db.updateUser(
    threadID,
    userID,
    {
      last_daily: now,
      daily_streak: streak
    }
  );

  await safeReply(
    api,
    event,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🎁 DAILY",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      `💰 Reward: +${formatNumber(
        reward
      )}`,
      "⭐ XP: +50",
      `🔥 Streak: ${streak}`,
      "",
      `${xp.rank.emoji} ${xp.rank.name}`
    ].join("\n")
  );
}


// ============================================================
// WORK
// ============================================================

async function handleWork(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const user =
    await db.getUser(
      threadID,
      userID
    );

  const now =
    Date.now();

  if (
    user.last_work &&
    now -
      Number(user.last_work) <
      WORK_COOLDOWN_MS
  ) {
    const remaining =
      WORK_COOLDOWN_MS -
      (
        now -
        Number(user.last_work)
      );

    const minutes =
      Math.ceil(
        remaining /
          (60 * 1000)
      );

    await safeReply(
      api,
      event,
      `⏳ You're tired.\nTry working again in about ${minutes} minute(s).`
    );

    return;
  }

  const jobs = [
    {
      job: "Freelance Developer",
      min: 250,
      max: 700
    },
    {
      job: "Graphic Designer",
      min: 200,
      max: 600
    },
    {
      job: "Delivery Driver",
      min: 150,
      max: 450
    },
    {
      job: "Cafe Worker",
      min: 120,
      max: 350
    },
    {
      job: "Translator",
      min: 200,
      max: 550
    },
    {
      job: "Consultant",
      min: 300,
      max: 800
    }
  ];

  const selected =
    jobs[
      randInt(
        0,
        jobs.length - 1
      )
    ];

  const reward =
    randInt(
      selected.min,
      selected.max
    );

  await db.addBalance(
    threadID,
    userID,
    reward
  );

  const xp =
    await db.addXP(
      threadID,
      userID,
      25
    );

  await db.updateUser(
    threadID,
    userID,
    {
      last_work: now
    }
  );

  await safeReply(
    api,
    event,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        💼 WORK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      `💼 Job: ${selected.job}`,
      `💰 Earned: +${formatNumber(
        reward
      )}`,
      "⭐ XP: +25",
      "",
      `${xp.rank.emoji} ${xp.rank.name}`
    ].join("\n")
  );
}


// ============================================================
// RANK
// ============================================================

async function handleRank(
  api,
  event
) {
  const user =
    await db.getUser(
      event.threadID,
      event.senderID
    );

  const rank =
    db.getRank(
      Number(user.xp)
    );

  const next =
    db.getNextRank(
      Number(user.xp)
    );

  await safeReply(
    api,
    event,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "         🏆 RANK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      `${rank.emoji} ${rank.name}`,
      `⭐ Level ${user.level}`,
      `✨ XP: ${formatNumber(
        user.xp
      )}`,
      "",
      next
        ? [
            `🎯 Next: ${next.emoji} ${next.name}`,
            `Need: ${formatNumber(
              next.minXP -
                Number(user.xp)
            )} XP`
          ].join("\n")
        : "🌟 You reached the highest rank!"
    ].join("\n")
  );
}


// ============================================================
// LEADERBOARD
// ============================================================

async function handleLeaderboard(
  api,
  event
) {
  const rows =
    await db.leaderboard(
      event.threadID,
      10
    );

  if (
    !rows.length
  ) {
    await safeReply(
      api,
      event,
      "🏆 No players yet."
    );

    return;
  }

  const lines = [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    "      🏆 LEADERBOARD",
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    ""
  ];

  rows.forEach(
    (user, index) => {
      const rank =
        db.getRank(
          Number(user.xp)
        );

      lines.push(
        `${index + 1}. ${rank.emoji} ${user.user_id}`,
        `   Lv.${user.level} • ${formatNumber(
          user.xp
        )} XP`,
        ""
      );
    }
  );

  await safeReply(
    api,
    event,
    lines.join("\n")
  );
}


// ============================================================
// LOANS
// ============================================================

async function handleLoanMenu(
  api,
  event
) {
  const user =
    await db.getUser(
      event.threadID,
      event.senderID
    );

  await safeReply(
    api,
    event,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "          🏦 LOANS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `💳 Credit Score: ${user.credit_score}`,
      `🧾 Current Loan: ${formatNumber(
        user.loan_remaining
      )}`,
      "",
      "Commands:",
      "",
      "!loan apply <amount>",
      "!loan pay <amount>",
      "",
      "Maximum loan: 50,000",
      "Minimum loan: 500",
      "",
      "This is a simulated game economy."
    ].join("\n")
  );
}


async function handleLoanApply(
  api,
  event,
  args
) {
  const amount =
    Number(args[1]);

  if (
    !Number.isInteger(amount) ||
    amount < 500 ||
    amount > 50000
  ) {
    await safeReply(
      api,
      event,
      "📝 Usage: !loan apply <500-50000>"
    );

    return;
  }

  try {
    const loan =
      await db.applyLoan(
        event.threadID,
        event.senderID,
        amount
      );

    await safeReply(
      api,
      event,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "      🏦 LOAN APPROVED",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        `💰 Borrowed: ${formatNumber(
          loan.amount
        )}`,
        `📈 Interest: ${Math.round(
          loan.interestRate * 100
        )}%`,
        `🧾 Repayment: ${formatNumber(
          loan.total
        )}`,
        "",
        "⏳ Due in: 7 days",
        "",
        "Use:",
        "!loan pay <amount>"
      ].join("\n")
    );
  } catch (error) {
    const messages = {
      INVALID_LOAN:
        "❌ Loan must be between 500 and 50,000.",
      EXISTING_LOAN:
        "❌ You already have an outstanding loan.",
      CREDIT_TOO_LOW:
        "❌ Your credit score is too low."
    };

    await safeReply(
      api,
      event,
      messages[error.message] ||
        "❌ Loan application failed."
    );
  }
}


async function handleLoanPay(
  api,
  event,
  args
) {
  const amount =
    Number(args[1]);

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    await safeReply(
      api,
      event,
      "💳 Usage: !loan pay <amount>"
    );

    return;
  }

  try {
    const result =
      await db.payLoan(
        event.threadID,
        event.senderID,
        amount
      );

    await safeReply(
      api,
      event,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       💳 LOAN PAYMENT",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        `💵 Paid: ${formatNumber(
          result.paid
        )}`,
        `🧾 Remaining: ${formatNumber(
          result.remaining
        )}`,
        `💳 Credit Score: ${result.creditScore}`,
        "",
        result.remaining === 0
          ? "✅ Loan completely paid!"
          : "⏳ Keep making payments."
      ].join("\n")
    );
  } catch (error) {
    const messages = {
      NO_LOAN:
        "❌ You don't have an active loan.",
      INSUFFICIENT_FUNDS:
        "❌ You don't have enough wallet coins."
    };

    await safeReply(
      api,
      event,
      messages[error.message] ||
        "❌ Loan payment failed."
    );
  }
}


// ============================================================
// TRIVIA
// ============================================================

function getTriviaQuestions() {
  if (
    Array.isArray(
      triviaQuestions
    )
  ) {
    return triviaQuestions;
  }

  if (
    Array.isArray(
      triviaQuestions.questions
    )
  ) {
    return triviaQuestions.questions;
  }

  if (
    Array.isArray(
      triviaQuestions.default
    )
  ) {
    return triviaQuestions.default;
  }

  return [];
}


function normalizeTriviaQuestion(raw) {
  if (!raw) return null;

  const question =
    raw.question ||
    raw.q ||
    raw.text ||
    raw.prompt;

  const options =
    raw.options ||
    raw.choices ||
    raw.answers;

  const answer =
    raw.answer ??
    raw.correct ??
    raw.correctAnswer ??
    raw.correctIndex;

  if (
    !question ||
    !Array.isArray(options) ||
    options.length < 4
  ) {
    return null;
  }

  return {
    question,
    options:
      options.slice(0, 4),
    answer
  };
}


function triviaAnswerMatches(
  answer,
  index,
  letter
) {
  if (
    answer === undefined ||
    answer === null
  ) {
    return false;
  }

  if (
    typeof answer === "number"
  ) {
    return (
      answer === index ||
      answer === index + 1
    );
  }

  const value =
    String(answer)
      .trim()
      .toUpperCase();

  return (
    value === letter ||
    value === String(index) ||
    value === String(index + 1)
  );
}


async function handleTrivia(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const list =
      getTriviaQuestions();

    if (
      !list.length
    ) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ No trivia questions are configured."
      );

      return;
    }

    const raw =
      list[
        randInt(
          0,
          list.length - 1
        )
      ];

    const q =
      normalizeTriviaQuestion(
        raw
      );

    if (!q) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ Trivia question is malformed."
      );

      return;
    }

    const text = [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "          🧠 TRIVIA",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      `❓ ${q.question}`,
      "",
      `A. ${q.options[0]}`,
      `B. ${q.options[1]}`,
      `C. ${q.options[2]}`,
      `D. ${q.options[3]}`,
      "",
      "⭐ Reward: +50 XP",
      "💰 Correct: +150 coins",
      "",
      "⏳ Reply A / B / C / D"
    ].join("\n");

    const animator =
      await createAnimator(
        api,
        threadID,
        text,
        "trivia"
      );

    setSession(
      threadID,
      userID,
      {
        type: "trivia",
        qdata: q,
        messageID:
          animator.messageID
      }
    );
  } catch (error) {
    unlockGame(
      threadID,
      userID
    );

    console.error(
      "[games] trivia:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Trivia failed."
    );
  }
}


async function resolveTrivia(
  api,
  event,
  answer
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const session =
    getSession(
      threadID,
      userID
    );

  if (
    !session ||
    session.type !== "trivia"
  ) {
    return false;
  }

  clearSession(
    threadID,
    userID
  );

  const letters =
    ["A", "B", "C", "D"];

  const normalizedAnswer =
    String(answer)
      .trim()
      .toUpperCase();

  const index =
    letters.indexOf(
      normalizedAnswer
    );

  const correct =
    triviaAnswerMatches(
      session.qdata.answer,
      index,
      normalizedAnswer
    );

  const correctIndex =
    typeof session.qdata.answer ===
    "number"
      ? session.qdata.answer >= 1 &&
        session.qdata.answer <= 4
        ? session.qdata.answer - 1
        : session.qdata.answer
      : letters.indexOf(
          String(
            session.qdata.answer
          ).toUpperCase()
        );

  const correctLetter =
    letters[correctIndex] ||
    "?";

  try {
    const reward =
      await awardPlayer(
        threadID,
        userID,
        "trivia",
        correct
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const finalText = [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "          🧠 TRIVIA",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      correct
        ? "🏆 CORRECT ANSWER!"
        : "❌ WRONG ANSWER",
      "",
      `👤 ${getPlayerName(event)}`,
      `🎯 Your answer: ${normalizedAnswer}`,
      `✅ Correct: ${correctLetter}`,
      "",
      `💰 Reward: +${formatNumber(
        reward.coins
      )} coins`,
      `⭐ XP: +${reward.xp}`,
      balanceText,
      "",
      `${reward.rank.emoji} ${reward.rank.name}`,
      reward.rankUp
        ? "🎉 RANK UP!"
        : "✦ Keep playing."
    ].join("\n");

    const edited =
      await editMessageSafe(
        api,
        finalText,
        session.messageID
      );

    if (!edited) {
      await sendMessageAsync(
        api,
        threadID,
        finalText
      );
    }
  } catch (error) {
    console.error(
      "[games] trivia reward:",
      error
    );
  }

  unlockGame(
    threadID,
    userID
  );

  return true;
}


// ============================================================
// RPS
// ============================================================

async function handleRPS(
  api,
  event,
  args
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const choice =
    String(args[0] || "")
      .toLowerCase();

  const valid = [
    "rock",
    "paper",
    "scissors"
  ];

  if (
    !valid.includes(choice)
  ) {
    await safeReply(
      api,
      event,
      "✊ Usage: !rps rock\n!rps paper\n!rps scissors"
    );

    return;
  }

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const emoji = {
      rock: "🪨",
      paper: "📄",
      scissors: "✂️"
    };

    const botChoice =
      valid[
        randInt(
          0,
          valid.length - 1
        )
      ];

    let result;

    if (
      choice === botChoice
    ) {
      result = "tie";
    } else if (
      (
        choice === "rock" &&
        botChoice === "scissors"
      ) ||
      (
        choice === "paper" &&
        botChoice === "rock"
      ) ||
      (
        choice === "scissors" &&
        botChoice === "paper"
      )
    ) {
      result = "win";
    } else {
      result = "lose";
    }

    const won =
      result === "win";

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        ✊ RPS",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          "🤖 BOT",
          "     🪨   📄   ✂️",
          "",
          `✦ Your choice: ${emoji[choice]}`,
          "",
          "⏳ Choosing..."
        ].join("\n"),
        "rps"
      );

    let success =
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        ✊ RPS",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 You: ${emoji[choice]}`,
          "🤖 Bot: 🌀",
          "",
          "     🪨  →  📄  →  ✂️",
          "",
          "⚡ Match locked."
        ].join("\n")
      );

    if (success) {
      success =
        await animator.waitAndEdit(
          [
            "╭━━━━━━━━━━━━━━━━━━━━╮",
            "        ✊ RPS",
            "╰━━━━━━━━━━━━━━━━━━━━╯",
            "",
            `👤 You: ${emoji[choice]}`,
            `🤖 Bot: ${emoji[botChoice]}`,
            "",
            "⚡ RESULT READY..."
          ].join("\n")
        );
    }

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "rps",
        won
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const title =
      result === "win"
        ? "🏆 YOU WIN!"
        : result === "tie"
          ? "🤝 DRAW!"
          : "❌ YOU LOSE";

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        ✊ RPS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        title,
        "",
        `👤 ${getPlayerName(event)}`,
        "",
        `✦ You: ${emoji[choice]} ${choice}`,
        `✦ Bot: ${emoji[botChoice]} ${botChoice}`,
        "",
        `💰 Reward: +${formatNumber(
          reward.coins
        )} coins`,
        `⭐ XP: +${reward.xp}`,
        balanceText,
        "",
        `${reward.rank.emoji} ${reward.rank.name}`,
        reward.rankUp
          ? "🎉 RANK UP!"
          : "✦ Keep playing."
      ].join("\n")
    );
  } catch (error) {
    console.error(
      "[games] RPS:",
      error
    );
  } finally {
    unlockGame(
      threadID,
      userID
    );
  }
}


// ============================================================
// ROLL
// ============================================================

async function handleRoll(
  api,
  event,
  args
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  let sides = 100;

  if (
    args.length
  ) {
    const requested =
      Number(args[0]);

    if (
      Number.isInteger(requested) &&
      requested >= 2 &&
      requested <= 1000
    ) {
      sides = requested;
    } else {
      await safeReply(
        api,
        event,
        "🎲 Usage: !roll or !roll <2-1000>"
      );

      return;
    }
  }

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const roll =
      randInt(
        1,
        sides
      );

    const target =
      Math.ceil(
        sides * 0.55
      );

    const won =
      roll >= target;

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎲 DICE",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          `🎯 D${sides}`,
          "",
          "🎲 Rolling...",
          "",
          "        ⚀",
          "",
          "⏳ The dice are moving..."
        ].join("\n"),
        "roll"
      );

    let success =
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎲 DICE",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          `🎯 D${sides}`,
          "",
          "🎲 Rolling...",
          "",
          `       [ ${randInt(
            1,
            sides
          )} ]`,
          "",
          "🌀 Shaking..."
        ].join("\n")
      );

    if (success) {
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎲 DICE",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          `🎯 Target: ${target}+`,
          "",
          "🎲 Final roll...",
          "",
          `       [ ${randInt(
            1,
            sides
          )} ]`,
          "",
          "⚡ LOCKING IN..."
        ].join("\n")
      );
    }

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "roll",
        won
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        🎲 DICE",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        won
          ? "🏆 HIGH ROLL!"
          : "❌ LOW ROLL",
        "",
        `👤 ${getPlayerName(event)}`,
        "",
        `🎲 Result: ${roll} / ${sides}`,
        `🎯 Target: ${target}+`,
        "",
        `💰 Reward: +${formatNumber(
          reward.coins
        )} coins`,
        `⭐ XP: +${reward.xp}`,
        balanceText,
        "",
        `${reward.rank.emoji} ${reward.rank.name}`
      ].join("\n")
    );
  } catch (error) {
    console.error(
      "[games] roll:",
      error
    );
  } finally {
    unlockGame(
      threadID,
      userID
    );
  }
}


// ============================================================
// GUESS
// ============================================================

async function handleGuess(
  api,
  event,
  args
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const guess =
    Number(args[0]);

  if (
    !Number.isInteger(guess) ||
    guess < 1 ||
    guess > 10
  ) {
    await safeReply(
      api,
      event,
      "🎯 Usage: !guess <1-10>"
    );

    return;
  }

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const secret =
      randInt(
        1,
        10
      );

    const won =
      guess === secret;

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎯 GUESS",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          `🎯 Your guess: ${guess}`,
          "",
          "🔎 Searching...",
          "",
          "1 • 2 • 3 • 4 • 5",
          "6 • 7 • 8 • 9 • 10",
          "",
          "⏳ Finding the number..."
        ].join("\n"),
        "guess"
      );

    let success =
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎯 GUESS",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          `🎯 Your guess: ${guess}`,
          "",
          "🔎 SCANNING...",
          "",
          `1 → 4 → 7 → 10 → ?`,
          "",
          "🌀 Searching..."
        ].join("\n")
      );

    if (success) {
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎯 GUESS",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          "🎯 TARGET LOCKED",
          "",
          "1  2  3  4  5",
          "6  7  8  9  10",
          "",
          `🔒 Locking on ${guess}...`
        ].join("\n")
      );
    }

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "guess",
        won
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        🎯 GUESS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        won
          ? "🎯 PERFECT GUESS!"
          : "❌ WRONG GUESS",
        "",
        `👤 ${getPlayerName(event)}`,
        "",
        `✦ You picked: ${guess}`,
        `✦ Number was: ${secret}`,
        "",
        `💰 Reward: +${formatNumber(
          reward.coins
        )} coins`,
        `⭐ XP: +${reward.xp}`,
        balanceText,
        "",
        `${reward.rank.emoji} ${reward.rank.name}`
      ].join("\n")
    );
  } catch (error) {
    console.error(
      "[games] guess:",
      error
    );
  } finally {
    unlockGame(
      threadID,
      userID
    );
  }
}


// ============================================================
// COINFLIP
// ============================================================

async function handleCoinflip(
  api,
  event,
  args
) {
  const choice =
    String(args[0] || "")
      .toLowerCase();

  if (
    ![
      "heads",
      "tails"
    ].includes(choice)
  ) {
    await safeReply(
      api,
      event,
      "🪙 Usage: !coinflip heads\nor !coinflip tails"
    );

    return;
  }

  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const result =
      Math.random() < 0.5
        ? "heads"
        : "tails";

    const won =
      choice === result;

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "       🪙 COINFLIP",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          `✦ Pick: ${choice}`,
          "",
          "🪙 FLIPPING",
          "",
          "       🪙",
          "      ↗️",
          "     ↘️",
          "",
          "⏳ The coin is in the air..."
        ].join("\n"),
        "coinflip"
      );

    let success =
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "       🪙 COINFLIP",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 Pick: ${choice}`,
          "",
          "        🪙",
          "       ↗️",
          "      ↘️",
          "     🪙",
          "",
          "🌀 Still flipping..."
        ].join("\n")
      );

    if (success) {
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "       🪙 COINFLIP",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 Pick: ${choice}`,
          "",
          "          🪙",
          "",
          "████████████████",
          "",
          "⚡ FINAL..."
        ].join("\n")
      );
    }

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "coinflip",
        won
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🪙 COINFLIP",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        won
          ? "🏆 CORRECT!"
          : "❌ WRONG",
        "",
        `👤 ${getPlayerName(event)}`,
        "",
        `✦ Pick: ${choice}`,
        `✦ Result: ${result}`,
        "",
        `💰 Reward: +${formatNumber(
          reward.coins
        )} coins`,
        `⭐ XP: +${reward.xp}`,
        balanceText,
        "",
        `${reward.rank.emoji} ${reward.rank.name}`
      ].join("\n")
    );
  } catch (error) {
    console.error(
      "[games] coinflip:",
      error
    );
  } finally {
    unlockGame(
      threadID,
      userID
    );
  }
}


// ============================================================
// SLOTS
// ============================================================

async function handleSlots(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const symbols = [
      "🍋",
      "🍒",
      "🍇",
      "🔔",
      "💎",
      "7️⃣"
    ];

    const randomReels =
      () => [
        symbols[
          randInt(
            0,
            symbols.length - 1
          )
        ],
        symbols[
          randInt(
            0,
            symbols.length - 1
          )
        ],
        symbols[
          randInt(
            0,
            symbols.length - 1
          )
        ]
      ];

    const finalReels =
      randomReels();

    const unique =
      new Set(
        finalReels
      ).size;

    const sameCount =
      unique === 1
        ? 3
        : unique === 2
          ? 2
          : 1;

    const won =
      sameCount >= 2;

    const reelText =
      reels =>
        `│      ${reels.join(
          "  │  "
        )}      │`;

    const frame1 =
      randomReels();

    const frame2 =
      randomReels();

    const frame3 =
      randomReels();

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "         🎰 SLOTS",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          "┌────────────────────┐",
          reelText([
            "❔",
            "❔",
            "❔"
          ]),
          "└────────────────────┘",
          "",
          "🎰 Starting..."
        ].join("\n"),
        "slots"
      );

    let success =
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "         🎰 SLOTS",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "┌────────────────────┐",
          reelText(frame1),
          "└────────────────────┘",
          "",
          "🎰 REELS SPINNING",
          "",
          "🌀 • 🌀 • 🌀"
        ].join("\n")
      );

    if (success) {
      success =
        await animator.waitAndEdit(
          [
            "╭━━━━━━━━━━━━━━━━━━━━╮",
            "         🎰 SLOTS",
            "╰━━━━━━━━━━━━━━━━━━━━╯",
            "",
            "┌────────────────────┐",
            reelText(frame2),
            "└────────────────────┘",
            "",
            "🎰 REEL 1 • LOCKED",
            "🎰 REEL 2 • SPINNING",
            "🎰 REEL 3 • SPINNING"
          ].join("\n")
        );
    }

    if (success) {
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "         🎰 SLOTS",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "┌────────────────────┐",
          reelText(frame3),
          "└────────────────────┘",
          "",
          "🎰 REEL 1 • LOCKED",
          "🎰 REEL 2 • LOCKED",
          "🎰 REEL 3 • FINAL SPIN"
        ].join("\n")
      );
    }

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "slots",
        won
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "         🎰 SLOTS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        won
          ? sameCount === 3
            ? "💎 TRIPLE MATCH!"
            : "🎉 MATCH!"
          : "❌ NO MATCH",
        "",
        "┌────────────────────┐",
        reelText(
          finalReels
        ),
        "└────────────────────┘",
        "",
        `💰 Reward: +${formatNumber(
          reward.coins
        )} coins`,
        `⭐ XP: +${reward.xp}`,
        balanceText,
        "",
        `${reward.rank.emoji} ${reward.rank.name}`,
        reward.rankUp
          ? "🎉 RANK UP!"
          : "✦ Spin again anytime."
      ].join("\n")
    );
  } catch (error) {
    console.error(
      "[games] slots:",
      error
    );
  } finally {
    unlockGame(
      threadID,
      userID
    );
  }
}


// ============================================================
// BLACKJACK HELPERS
// ============================================================

function createDeck() {
  const suits = [
    "♠",
    "♥",
    "♦",
    "♣"
  ];

  const ranks = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K"
  ];

  const deck = [];

  for (
    const suit of suits
  ) {
    for (
      const rank of ranks
    ) {
      deck.push({
        rank,
        suit
      });
    }
  }

  for (
    let i = deck.length - 1;
    i > 0;
    i--
  ) {
    const j =
      randInt(
        0,
        i
      );

    [
      deck[i],
      deck[j]
    ] = [
      deck[j],
      deck[i]
    ];
  }

  return deck;
}


function cardValue(card) {
  if (
    [
      "J",
      "Q",
      "K"
    ].includes(card.rank)
  ) {
    return 10;
  }

  if (
    card.rank === "A"
  ) {
    return 11;
  }

  return Number(
    card.rank
  );
}


function handValue(hand) {
  let total = 0;
  let aces = 0;

  for (
    const card of hand
  ) {
    total +=
      cardValue(card);

    if (
      card.rank === "A"
    ) {
      aces++;
    }
  }

  while (
    total > 21 &&
    aces > 0
  ) {
    total -= 10;
    aces--;
  }

  return total;
}


function handString(hand) {
  return hand
    .map(
      card =>
        `${card.rank}${card.suit}`
    )
    .join("  ");
}


function blackjackStateText(
  playerHand,
  dealerHand,
  revealDealer = false
) {
  const player =
    handValue(
      playerHand
    );

  const dealerShown =
    revealDealer
      ? handString(
          dealerHand
        )
      : dealerHand.length
        ? `${dealerHand[0].rank}${dealerHand[0].suit}  🂠`
        : "🂠  🂠";

  const dealerValue =
    revealDealer
      ? handValue(
          dealerHand
        )
      : "?";

  return [
    `👤 YOU [${player}]`,
    `│ ${handString(
      playerHand
    )}`,
    "",
    `🤖 DEALER [${dealerValue}]`,
    `│ ${dealerShown}`
  ].join("\n");
}


// ============================================================
// BLACKJACK FINAL TEXT
// ============================================================

function blackjackFinalText(
  event,
  playerHand,
  dealerHand,
  result,
  reward,
  balanceText
) {
  let title;

  if (
    result === "win"
  ) {
    title = "🏆 YOU WIN!";
  } else if (
    result === "push"
  ) {
    title = "🤝 PUSH";
  } else if (
    result === "bust"
  ) {
    title = "💥 BUST!";
  } else if (
    result === "natural"
  ) {
    title = "♠️ NATURAL BLACKJACK!";
  } else {
    title = "❌ DEALER WINS";
  }

  return [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    "       🃏 BLACKJACK",
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    title,
    "",
    `👤 ${getPlayerName(event)}`,
    "",
    blackjackStateText(
      playerHand,
      dealerHand,
      true
    ),
    "",
    `💰 Reward: +${formatNumber(
      reward.coins
    )} coins`,
    `⭐ XP: +${reward.xp}`,
    balanceText,
    "",
    `${reward.rank.emoji} ${reward.rank.name}`,
    reward.rankUp
      ? "🎉 RANK UP!"
      : "✦ Game complete."
  ].join("\n");
}


// ============================================================
// BLACKJACK
// ============================================================

async function handleBlackjack(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const deck =
      createDeck();

    const playerHand = [
      deck.pop(),
      deck.pop()
    ];

    const dealerHand = [
      deck.pop(),
      deck.pop()
    ];

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "       🃏 BLACKJACK",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          "🃏 DEALING",
          "",
          "👤 YOU",
          "│ 🂠  🂠",
          "",
          "🤖 DEALER",
          "│ 🂠  🂠",
          "",
          "⏳ Dealing cards..."
        ].join("\n"),
        "blackjack"
      );

    const firstEdit =
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "       🃏 BLACKJACK",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          blackjackStateText(
            playerHand,
            dealerHand,
            false
          ),
          "",
          "🃏 Reading the table..."
        ].join("\n")
      );

    const playerBlackjack =
      handValue(
        playerHand
      ) === 21;

    const dealerBlackjack =
      handValue(
        dealerHand
      ) === 21;

    if (
      playerBlackjack ||
      dealerBlackjack
    ) {
      const won =
        playerBlackjack &&
        !dealerBlackjack;

      const reward =
        await awardPlayer(
          threadID,
          userID,
          "blackjack",
          won
        );

      const balanceText =
        await getFinalBalanceText(
          threadID,
          userID
        );

      const result =
        playerBlackjack
          ? "natural"
          : "lose";

      await animator.final(
        blackjackFinalText(
          event,
          playerHand,
          dealerHand,
          result,
          reward,
          balanceText
        )
      );

      unlockGame(
        threadID,
        userID
      );

      return;
    }

    setSession(
      threadID,
      userID,
      {
        type: "blackjack",
        deck,
        playerHand,
        dealerHand,
        messageID:
          animator.messageID,
        busy: false
      }
    );

    /*
     * If the first edit failed, animator.final() below
     * will send the usable final table as a fallback.
     */
    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🃏 BLACKJACK",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        `👤 ${getPlayerName(event)}`,
        "",
        blackjackStateText(
          playerHand,
          dealerHand,
          false
        ),
        "",
        "⚔️ YOUR MOVE",
        "",
        "➡️ !hit",
        "➡️ !stand"
      ].join("\n")
    );

    /*
     * Keep activeGames locked until
     * !hit, !stand, timeout, or !game off.
     */
  } catch (error) {
    console.error(
      "[games] blackjack:",
      error
    );

    unlockGame(
      threadID,
      userID
    );
  }
}


// ============================================================
// BLACKJACK HIT
// ============================================================

async function handleBlackjackHit(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const session =
    getSession(
      threadID,
      userID
    );

  if (
    !session ||
    session.type !== "blackjack"
  ) {
    return false;
  }

  if (
    session.busy
  ) {
    await safeReply(
      api,
      event,
      "⏳ Your previous blackjack action is still processing."
    );

    return true;
  }

  session.busy = true;

  const card =
    session.deck.pop();

  if (!card) {
    session.busy = false;

    await safeReply(
      api,
      event,
      "❌ The deck ran out of cards."
    );

    return true;
  }

  session.playerHand.push(
    card
  );

  const value =
    handValue(
      session.playerHand
    );

  try {
    if (
      value > 21
    ) {
      clearSession(
        threadID,
        userID
      );

      const reward =
        await awardPlayer(
          threadID,
          userID,
          "blackjack",
          false
        );

      const balanceText =
        await getFinalBalanceText(
          threadID,
          userID
        );

      const finalText =
        blackjackFinalText(
          event,
          session.playerHand,
          session.dealerHand,
          "bust",
          reward,
          balanceText
        );

      const edited =
        await editMessageSafe(
          api,
          finalText,
          session.messageID
        );

      if (!edited) {
        await sendMessageAsync(
          api,
          threadID,
          finalText
        );
      }

      unlockGame(
        threadID,
        userID
      );

      return true;
    }

    const animatorText = [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🃏 BLACKJACK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🎴 CARD DRAWN",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      blackjackStateText(
        session.playerHand,
        session.dealerHand,
        false
      ),
      "",
      "⚔️ YOUR MOVE",
      "",
      "➡️ !hit",
      "➡️ !stand"
    ].join("\n");

    await sleep(
      editDelay()
    );

    const edited =
      await editMessageSafe(
        api,
        animatorText,
        session.messageID
      );

    if (!edited) {
      /*
       * Don't leave the player in a mysterious state.
       * Send the current table once.
       */
      await sendMessageAsync(
        api,
        threadID,
        animatorText
      );
    }

    session.busy = false;

    setSession(
      threadID,
      userID,
      session
    );

    return true;
  } catch (error) {
    console.error(
      "[games] blackjack hit:",
      error
    );

    session.busy = false;

    setSession(
      threadID,
      userID,
      session
    );

    return true;
  }
}


// ============================================================
// BLACKJACK STAND
// ============================================================

async function handleBlackjackStand(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const session =
    getSession(
      threadID,
      userID
    );

  if (
    !session ||
    session.type !== "blackjack"
  ) {
    return false;
  }

  if (
    session.busy
  ) {
    await safeReply(
      api,
      event,
      "⏳ Your previous blackjack action is still processing."
    );

    return true;
  }

  session.busy = true;

  clearSession(
    threadID,
    userID
  );

  try {
    /*
     * Reveal the dealer's hole card first.
     */
    let edited =
      await editMessageSafe(
        api,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "       🃏 BLACKJACK",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "🤖 DEALER REVEALS",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          blackjackStateText(
            session.playerHand,
            session.dealerHand,
            true
          ),
          "",
          "🃏 Dealer is checking..."
        ].join("\n"),
        session.messageID
      );

    if (!edited) {
      /*
       * The original message cannot be edited.
       * Continue the game, but don't wait forever.
       */
      console.warn(
        "[games] blackjack stand reveal edit failed"
      );
    }

    /*
     * Dealer draws cards one by one.
     * We intentionally cap this so a long dealer hand
     * cannot create a huge animation sequence.
     */
    let dealerDraws = 0;

    while (
      handValue(
        session.dealerHand
      ) < 17 &&
      session.deck.length > 0 &&
      dealerDraws < 3
    ) {
      await sleep(
        editDelay()
      );

      const nextCard =
        session.deck.pop();

      if (!nextCard) {
        break;
      }

      session.dealerHand.push(
        nextCard
      );

      dealerDraws++;

      edited =
        await editMessageSafe(
          api,
          [
            "╭━━━━━━━━━━━━━━━━━━━━╮",
            "       🃏 BLACKJACK",
            "╰━━━━━━━━━━━━━━━━━━━━╯",
            "",
            "🤖 DEALER DRAWS",
            "",
            blackjackStateText(
              session.playerHand,
              session.dealerHand,
              true
            ),
            "",
            handValue(
              session.dealerHand
            ) >= 17
              ? "⚡ Dealer is standing..."
              : "🃏 Another card..."
          ].join("\n"),
          session.messageID
        );

      if (!edited) {
        console.warn(
          "[games] blackjack dealer draw edit failed"
        );

        /*
         * Don't keep performing animation edits if
         * Messenger has stopped accepting them.
         */
        break;
      }
    }

    const player =
      handValue(
        session.playerHand
      );

    const dealer =
      handValue(
        session.dealerHand
      );

    let result;

    if (
      dealer > 21
    ) {
      result = "win";
    } else if (
      player > dealer
    ) {
      result = "win";
    } else if (
      player === dealer
    ) {
      result = "push";
    } else {
      result = "lose";
    }

    const won =
      result === "win";

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "blackjack",
        won
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const finalText =
      blackjackFinalText(
        event,
        session.playerHand,
        session.dealerHand,
        result,
        reward,
        balanceText
      );

    edited =
      await editMessageSafe(
        api,
        finalText,
        session.messageID
      );

    if (!edited) {
      await sendMessageAsync(
        api,
        threadID,
        finalText
      );
    }
  } catch (error) {
    console.error(
      "[games] blackjack stand:",
      error
    );
  } finally {
    unlockGame(
      threadID,
      userID
    );
  }

  return true;
}


// ============================================================
// MATH
// ============================================================

function generateMathQuestion() {
  const difficulty =
    randInt(1, 3);

  let a;
  let b;
  let operator;
  let answer;

  if (
    difficulty === 1
  ) {
    a = randInt(2, 30);
    b = randInt(2, 30);

    operator =
      Math.random() < 0.5
        ? "+"
        : "-";
  } else if (
    difficulty === 2
  ) {
    a = randInt(5, 50);
    b = randInt(2, 12);

    operator =
      Math.random() < 0.5
        ? "×"
        : "+";
  } else {
    a = randInt(2, 20);
    b = randInt(2, 20);

    operator =
      Math.random() < 0.5
        ? "×"
        : "-";
  }

  if (
    operator === "+"
  ) {
    answer =
      a + b;
  } else if (
    operator === "-"
  ) {
    answer =
      a - b;
  } else {
    answer =
      a * b;
  }

  return {
    question:
      `${a} ${operator} ${b} = ?`,
    answer,
    difficulty
  };
}


async function handleMath(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const q =
      generateMathQuestion();

    const difficultyName =
      q.difficulty === 1
        ? "Easy"
        : q.difficulty === 2
          ? "Medium"
          : "Hard";

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🧮 MATH",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          `❓ ${q.question}`,
          "",
          `📊 Difficulty: ${difficultyName}`,
          "",
          "⏳ Reply with your answer."
        ].join("\n"),
        "math"
      );

    setSession(
      threadID,
      userID,
      {
        type: "math",
        question:
          q.question,
        answer:
          q.answer,
        messageID:
          animator.messageID
      }
    );
  } catch (error) {
    unlockGame(
      threadID,
      userID
    );

    console.error(
      "[games] math:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Math failed."
    );
  }
}


async function resolveMath(
  api,
  event,
  answerText
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const session =
    getSession(
      threadID,
      userID
    );

  if (
    !session ||
    session.type !== "math"
  ) {
    return false;
  }

  clearSession(
    threadID,
    userID
  );

  const answer =
    Number(
      answerText
    );

  const correct =
    Number.isFinite(answer) &&
    answer ===
      Number(session.answer);

  try {
    const reward =
      await awardPlayer(
        threadID,
        userID,
        "math",
        correct
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const finalText = [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🧮 MATH",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      correct
        ? "🏆 CORRECT!"
        : "❌ WRONG",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      `❓ ${session.question}`,
      `✏️ Your answer: ${answerText}`,
      `✅ Correct answer: ${session.answer}`,
      "",
      `💰 Reward: +${formatNumber(
        reward.coins
      )} coins`,
      `⭐ XP: +${reward.xp}`,
      balanceText,
      "",
      `${reward.rank.emoji} ${reward.rank.name}`,
      reward.rankUp
        ? "🎉 RANK UP!"
        : "✦ Keep solving."
    ].join("\n");

    const edited =
      await editMessageSafe(
        api,
        finalText,
        session.messageID
      );

    if (!edited) {
      await sendMessageAsync(
        api,
        threadID,
        finalText
      );
    }
  } catch (error) {
    console.error(
      "[games] math reward:",
      error
    );
  }

  unlockGame(
    threadID,
    userID
  );

  return true;
}


// ============================================================
// RIDDLES
// ============================================================

const RIDDLES = [
  {
    question:
      "I have keys but open no locks. I have space but no room. What am I?",
    answers: [
      "keyboard"
    ]
  },
  {
    question:
      "What has hands but cannot clap?",
    answers: [
      "clock"
    ]
  },
  {
    question:
      "What gets wetter the more it dries?",
    answers: [
      "towel"
    ]
  },
  {
    question:
      "What has a face and two hands but no arms or legs?",
    answers: [
      "clock"
    ]
  },
  {
    question:
      "What can travel around the world while staying in one corner?",
    answers: [
      "stamp"
    ]
  },
  {
    question:
      "What has many teeth but cannot bite?",
    answers: [
      "comb"
    ]
  },
  {
    question:
      "What has one eye but cannot see?",
    answers: [
      "needle"
    ]
  },
  {
    question:
      "What belongs to you but other people use it more than you do?",
    answers: [
      "name",
      "your name"
    ]
  }
];


async function handleRiddle(
  api,
  event
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const riddle =
      RIDDLES[
        randInt(
          0,
          RIDDLES.length - 1
        )
      ];

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🧩 RIDDLE",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          `❓ ${riddle.question}`,
          "",
          "🧠 Think carefully...",
          "",
          "✦ Reply with your answer."
        ].join("\n"),
        "riddle"
      );

    setSession(
      threadID,
      userID,
      {
        type: "riddle",
        question:
          riddle.question,
        answers:
          riddle.answers,
        messageID:
          animator.messageID
      }
    );
  } catch (error) {
    unlockGame(
      threadID,
      userID
    );

    console.error(
      "[games] riddle:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Riddle failed."
    );
  }
}


async function resolveRiddle(
  api,
  event,
  answerText
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const session =
    getSession(
      threadID,
      userID
    );

  if (
    !session ||
    session.type !== "riddle"
  ) {
    return false;
  }

  clearSession(
    threadID,
    userID
  );

  const normalized =
    String(answerText)
      .trim()
      .toLowerCase();

  const correct =
    session.answers.some(
      answer =>
        normalized ===
        String(answer)
          .toLowerCase()
    );

  try {
    const reward =
      await awardPlayer(
        threadID,
        userID,
        "riddle",
        correct
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const finalText = [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🧩 RIDDLE",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      correct
        ? "🏆 CORRECT!"
        : "❌ NOT QUITE",
      "",
      `👤 ${getPlayerName(event)}`,
      "",
      `❓ ${session.question}`,
      `✏️ Your answer: ${answerText}`,
      `✅ Answer: ${session.answers[0]}`,
      "",
      `💰 Reward: +${formatNumber(
        reward.coins
      )} coins`,
      `⭐ XP: +${reward.xp}`,
      balanceText,
      "",
      `${reward.rank.emoji} ${reward.rank.name}`
    ].join("\n");

    const edited =
      await editMessageSafe(
        api,
        finalText,
        session.messageID
      );

    if (!edited) {
      await sendMessageAsync(
        api,
        threadID,
        finalText
      );
    }
  } catch (error) {
    console.error(
      "[games] riddle reward:",
      error
    );
  }

  unlockGame(
    threadID,
    userID
  );

  return true;
}


// ============================================================
// 8-BALL
// ============================================================

async function handle8Ball(
  api,
  event,
  text
) {
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const question =
    text
      .replace(
        /^!8ball\s*/i,
        ""
      )
      .trim();

  if (!question) {
    await safeReply(
      api,
      event,
      "🎱 Usage: !8ball <question>"
    );

    return;
  }

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ Finish your current game first."
    );

    return;
  }

  try {
    const answers = [
      "Yes. Absolutely.",
      "It is certain.",
      "Without a doubt.",
      "Most likely.",
      "The signs point to yes.",
      "Ask again later.",
      "Cannot predict now.",
      "Better not tell you.",
      "Don't count on it.",
      "Very doubtful.",
      "Absolutely not."
    ];

    let hash = 0;

    for (
      let i = 0;
      i < question.length;
      i++
    ) {
      hash =
        (
          hash * 31 +
          question.charCodeAt(i)
        ) | 0;
    }

    const answer =
      answers[
        Math.abs(hash) %
          answers.length
      ];

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "8ball",
        true
      );

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎱 8-BALL",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `👤 ${getPlayerName(event)}`,
          "",
          "🔮 THE QUESTION",
          "",
          `"${question}"`,
          "",
          "        🎱",
          "",
          "The 8-ball is thinking...",
          "⏳ Please wait."
        ].join("\n"),
        "8ball"
      );

    let success =
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎱 8-BALL",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "🔮 THE QUESTION",
          "",
          `"${question}"`,
          "",
          "       🎱",
          "        ↻",
          "       ↻",
          "      ↻",
          "",
          "🔮 Reading the future..."
        ].join("\n")
      );

    if (success) {
      await animator.waitAndEdit(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎱 8-BALL",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "🔮 THE QUESTION",
          "",
          `"${question}"`,
          "",
          "        🎱",
          "",
          "████████████████",
          "",
          "⚡ REVEALING..."
        ].join("\n")
      );
    }

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        🎱 8-BALL",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        `👤 ${getPlayerName(event)}`,
        "",
        "🔮 THE QUESTION",
        "",
        `"${question}"`,
        "",
        "🎱 ANSWER",
        "",
        `「 ${answer} 」`,
        "",
        `💰 Reward: +${formatNumber(
          reward.coins
        )} coins`,
        `⭐ XP: +${reward.xp}`,
        balanceText,
        "",
        `${reward.rank.emoji} ${reward.rank.name}`
      ].join("\n")
    );
  } catch (error) {
    console.error(
      "[games] 8ball:",
      error
    );
  } finally {
    unlockGame(
      threadID,
      userID
    );
  }
}


// ============================================================
// MAIN ROUTER
// ============================================================

async function handleGamesCommand(
  api,
  event,
  text,
  originalText
) {
  if (
    !event ||
    !event.threadID ||
    !event.senderID
  ) {
    return false;
  }

  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const cleanText =
    String(
      text ||
      originalText ||
      ""
    ).trim();

  if (!cleanText) {
    return false;
  }

  const lower =
    cleanText.toLowerCase();

  // ----------------------------------------------------------
  // TOGGLE
  // ----------------------------------------------------------

  if (
    lower === "!game on" ||
    lower === "!game off" ||
    lower === "!games on" ||
    lower === "!games off"
  ) {
    return handleGameToggle(
      api,
      event,
      cleanText
    );
  }

  // ----------------------------------------------------------
  // MENU
  // ----------------------------------------------------------

  if (
    lower === "!games"
  ) {
    await handleGamesMenu(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // ECONOMY COMMANDS
  // ----------------------------------------------------------

  if (
    lower === "!balance" ||
    lower === "!bal"
  ) {
    await handleBalance(
      api,
      event
    );

    return true;
  }

  if (
    lower === "!bank"
  ) {
    await handleBank(
      api,
      event
    );

    return true;
  }

  if (
    lower.startsWith(
      "!deposit"
    )
  ) {
    const parts =
      cleanText.split(/\s+/);

    await handleDeposit(
      api,
      event,
      parts.slice(1)
    );

    return true;
  }

  if (
    lower.startsWith(
      "!withdraw"
    )
  ) {
    const parts =
      cleanText.split(/\s+/);

    await handleWithdraw(
      api,
      event,
      parts.slice(1)
    );

    return true;
  }

  if (
    lower.startsWith(
      "!transfer"
    )
  ) {
    const parts =
      cleanText.split(/\s+/);

    await handleTransfer(
      api,
      event,
      parts.slice(1)
    );

    return true;
  }

  if (
    lower === "!daily"
  ) {
    await handleDaily(
      api,
      event
    );

    return true;
  }

  if (
    lower === "!work"
  ) {
    await handleWork(
      api,
      event
    );

    return true;
  }

  if (
    lower === "!profile"
  ) {
    await handleProfile(
      api,
      event
    );

    return true;
  }

  if (
    lower === "!rank"
  ) {
    await handleRank(
      api,
      event
    );

    return true;
  }

  if (
    lower === "!leaderboard" ||
    lower === "!lb"
  ) {
    await handleLeaderboard(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // LOANS
  // ----------------------------------------------------------

  if (
    lower === "!loan"
  ) {
    await handleLoanMenu(
      api,
      event
    );

    return true;
  }

  if (
    lower.startsWith(
      "!loan apply"
    )
  ) {
    const parts =
      cleanText.split(/\s+/);

    await handleLoanApply(
      api,
      event,
      parts
    );

    return true;
  }

  if (
    lower.startsWith(
      "!loan pay"
    )
  ) {
    const parts =
      cleanText.split(/\s+/);

    await handleLoanPay(
      api,
      event,
      parts
    );

    return true;
  }

  // ----------------------------------------------------------
  // GAMES ENABLE CHECK
  // ----------------------------------------------------------

  const enabled =
    await gamesAreEnabled(
      threadID
    );

  if (!enabled) {
    /*
     * Returning false here is intentional because the
     * main index.js may have other systems after games.
     */
    return false;
  }

  // ----------------------------------------------------------
  // ACTIVE SESSION ANSWERS
  // ----------------------------------------------------------

  const session =
    getSession(
      threadID,
      userID
    );

  if (
    session &&
    session.type === "trivia" &&
    /^[ABCD]$/i.test(
      cleanText
    )
  ) {
    return resolveTrivia(
      api,
      event,
      cleanText
    );
  }

  if (
    session &&
    session.type === "math" &&
    /^-?\d+$/.test(
      cleanText
    )
  ) {
    return resolveMath(
      api,
      event,
      cleanText
    );
  }

  if (
    session &&
    session.type === "riddle" &&
    !cleanText.startsWith("!")
  ) {
    return resolveRiddle(
      api,
      event,
      cleanText
    );
  }

  if (
    session &&
    session.type === "blackjack" &&
    lower === "!hit"
  ) {
    return handleBlackjackHit(
      api,
      event
    );
  }

  if (
    session &&
    session.type === "blackjack" &&
    lower === "!stand"
  ) {
    return handleBlackjackStand(
      api,
      event
    );
  }

  // ----------------------------------------------------------
  // COMMAND PARSING
  // ----------------------------------------------------------

  const parts =
    cleanText.split(/\s+/);

  const command =
    parts[0].toLowerCase();

  const args =
    parts.slice(1);

  // ----------------------------------------------------------
  // TRIVIA
  // ----------------------------------------------------------

  if (
    command === "!trivia"
  ) {
    await handleTrivia(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // MATH
  // ----------------------------------------------------------

  if (
    command === "!math"
  ) {
    await handleMath(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // RIDDLE
  // ----------------------------------------------------------

  if (
    command === "!riddle"
  ) {
    await handleRiddle(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // RPS
  // ----------------------------------------------------------

  if (
    command === "!rps" ||
    command === "!rockpaperscissors"
  ) {
    await handleRPS(
      api,
      event,
      args
    );

    return true;
  }

  // ----------------------------------------------------------
  // ROLL
  // ----------------------------------------------------------

  if (
    command === "!roll" ||
    command === "!dice"
  ) {
    await handleRoll(
      api,
      event,
      args
    );

    return true;
  }

  // ----------------------------------------------------------
  // GUESS
  // ----------------------------------------------------------

  if (
    command === "!guess"
  ) {
    await handleGuess(
      api,
      event,
      args
    );

    return true;
  }

  // ----------------------------------------------------------
  // COINFLIP
  // ----------------------------------------------------------

  if (
    command === "!coinflip" ||
    command === "!cf"
  ) {
    await handleCoinflip(
      api,
      event,
      args
    );

    return true;
  }

  // ----------------------------------------------------------
  // SLOTS
  // ----------------------------------------------------------

  if (
    command === "!slots" ||
    command === "!slot"
  ) {
    await handleSlots(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // BLACKJACK
  // ----------------------------------------------------------

  if (
    command === "!blackjack" ||
    command === "!bj"
  ) {
    await handleBlackjack(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // 8-BALL
  // ----------------------------------------------------------

  if (
    command === "!8ball" ||
    command === "!8-ball"
  ) {
    await handle8Ball(
      api,
      event,
      cleanText
    );

    return true;
  }

  return false;
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  handleGamesCommand
};
