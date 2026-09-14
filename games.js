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

// ============================================================
// AESTHETIC SYSTEM
// ============================================================

const GAME_STYLE = {
  trivia: {
    icon: "🧠",
    name: "TRIVIA",
    accent: "✦",
  },

  rps: {
    icon: "⚔️",
    name: "ROCK • PAPER • SCISSORS",
    accent: "✦",
  },

  roll: {
    icon: "🎲",
    name: "DICE ROLL",
    accent: "✦",
  },

  guess: {
    icon: "🎯",
    name: "NUMBER GUESS",
    accent: "✦",
  },

  coinflip: {
    icon: "🪙",
    name: "COIN FLIP",
    accent: "✦",
  },

  blackjack: {
    icon: "♠️",
    name: "BLACKJACK",
    accent: "✦",
  },

  slots: {
    icon: "🎰",
    name: "SLOTS",
    accent: "✦",
  },

  math: {
    icon: "🧮",
    name: "MATH",
    accent: "✦",
  },

  riddle: {
    icon: "🧩",
    name: "RIDDLE",
    accent: "✦",
  },

  "8ball": {
    icon: "🎱",
    name: "8-BALL",
    accent: "✦",
  },
};

function gameHeader(type, subtitle = "") {
  const style = GAME_STYLE[type] || {
    icon: "🎮",
    name: "GAME",
    accent: "✦",
  };

  return [
    `╭────────── ${style.icon} ${style.name} ──────────╮`,
    subtitle ? `│  ${subtitle}` : "│",
    "╰────────────────────────────────────╯",
  ].join("\n");
}

function divider() {
  return "┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄";
}

function playerLine(event) {
  return `♙ ${getPlayerName(event)}`;
}

function rewardLine(reward, balanceText, won = true) {
  const coinSign = won ? "+" : "-";
  const xpSign = won ? "+" : "-";

  return [
    divider(),
    `⭐ XP   ${xpSign}${formatNumber(reward.xp)}`,
    `💰 Coins ${coinSign}${formatNumber(reward.coins)}`,
    "",
    balanceText,
  ].join("\n");
}

function resultBadge(type) {
  if (type === "win") {
    return "╭────── 🏆 VICTORY ──────╮";
  }

  if (type === "loss") {
    return "╭────── ❌ DEFEAT ───────╮";
  }

  return "╭────── 🤝 DRAW ─────────╮";
}

function resultBadgeBottom() {
  return "╰─────────────────────────╯";
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

  const coins = won
    ? baseCoins
    : Math.floor(baseCoins * 0.25);

  const xpAmount = won
    ? xp
    : Math.floor(xp * 0.5);

  await db.addXP(
    threadID,
    userID,
    won ? xpAmount : -xpAmount
  );

  await db.addBalance(
    threadID,
    userID,
    won ? coins : -coins
  );

  return {
    xp: xpAmount,
    coins,
    won,
  };
}

async function getFinalBalanceText(threadID, userID) {
  const user = await db.getUser(
    threadID,
    userID
  );

  const coins = formatNumber(
    user?.balance ?? 0
  );

  const xp = formatNumber(
    user?.xp ?? 0
  );

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

  const id =
    event && event.senderID
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
      api.sendMessage(
        text,
        threadID,
        (error, messageInfo) =>
          finish(error, messageInfo)
      );
    } catch (error) {
      finish(error);
    }
  });
}

async function editMessageSafe(
  api,
  newText,
  messageID,
  threadID
) {
  if (!messageID || !api || !api.editMessage) {
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
      api.editMessage(
        newText,
        messageID,
        (error) => {
          clearTimeout(timeout);
          finish(error);
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      finish(error);
    }
  });
}

async function editMessageWithRetry(
  api,
  newText,
  messageID,
  threadID
) {
  let lastError = null;

  for (
    let attempt = 0;
    attempt <= EDIT_MAX_RETRIES;
    attempt++
  ) {
    const success = await editMessageSafe(
      api,
      newText,
      messageID,
      threadID
    );

    if (success) {
      return true;
    }

    lastError =
      `attempt ${attempt + 1} failed`;

    if (attempt < EDIT_MAX_RETRIES) {
      await sleep(
        EDIT_RETRY_DELAY_MS
      );
    }
  }

  console.warn(
    `[games] edit failed after retries for message ${messageID}: ${lastError}`
  );

  return false;
}

async function updateGameMessage(
  api,
  threadID,
  messageID,
  text
) {
  const edited =
    await editMessageWithRetry(
      api,
      text,
      messageID,
      threadID
    );

  if (!edited) {
    try {
      await sendMessageAsync(
        api,
        threadID,
        text
      );
    } catch (error) {
      console.error(
        "[games] fallback send failed:",
        error
      );
    }
  }

  return edited;
}

// ============================================================
// ANIMATION
// ============================================================

async function createAnimator(
  api,
  threadID,
  initialText,
  gameType = ""
) {
  const result = {
    messageID: null,
    stopEdit: null,
    editCount: 0,
  };

  try {
    const msgInfo =
      await sendMessageAsync(
        api,
        threadID,
        initialText
      );

    if (!msgInfo || !msgInfo.messageID) {
      console.error(
        `[games] failed to send initial ${gameType} message`
      );

      return result;
    }

    result.messageID =
      msgInfo.messageID;

    result.stopEdit = () => {};
  } catch (error) {
    console.error(
      `[games] animator init (${gameType}):`,
      error
    );
  }

  return result;
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

function setSession(
  threadID,
  userID,
  data
) {
  const key =
    sessionKey(
      threadID,
      userID
    );

  sessions.set(
    key,
    data
  );

  clearTimeout(
    sessionTimers.get(key)
  );

  sessionTimers.set(
    key,
    setTimeout(() => {
      sessions.delete(key);
      sessionTimers.delete(key);

      // IMPORTANT:
      // A timed-out session must also release
      // the active-game lock. Otherwise the player
      // can become permanently locked out of games.
      activeGames.delete(key);
    }, SESSION_TIMEOUT_MS)
  );
}

function getSession(
  threadID,
  userID
) {
  return (
    sessions.get(
      sessionKey(
        threadID,
        userID
      )
    ) || null
  );
}

function clearSession(
  threadID,
  userID
) {
  const key =
    sessionKey(
      threadID,
      userID
    );

  clearTimeout(
    sessionTimers.get(key)
  );

  sessions.delete(key);
  sessionTimers.delete(key);
}

// ============================================================
// GAME LOCK
// ============================================================

function lockGame(
  threadID,
  userID
) {
  const key =
    `${threadID}:${userID}`;

  if (activeGames.has(key)) {
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
    `${threadID}:${userID}`
  );
}

// ============================================================
// TRIVIA
// ============================================================

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
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const q =
      await triviaManager.getNextQuestion({
        threadID,
      });

    if (!q) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ No trivia questions are available."
      );

      return;
    }

    const text = [
      gameHeader(
        "trivia",
        playerLine(event)
      ),
      "",
      divider(),
      "",
      `❓ ${q.question}`,
      "",
      `〔 A 〕 ${q.options[0]}`,
      `〔 B 〕 ${q.options[1]}`,
      `〔 C 〕 ${q.options[2]}`,
      `〔 D 〕 ${q.options[3]}`,
      "",
      divider(),
      "⭐ +50 XP   •   💰 +150 coins",
      "",
      "↳ Reply with A, B, C or D",
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
          animator.messageID,
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
  const match = String(value || "").match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

function getTriviaAnswerIndex(answer, qdata) {
  const normalized = normalizeAnswerText(answer);
  const letter = normalized.match(/^(?:option|choice)?\s*([abcd])(?:[).]\s*)?$/i);
  if (letter) return ["a", "b", "c", "d"].indexOf(letter[1].toLowerCase());

  return (qdata.options || []).findIndex(
    (option) => normalizeAnswerText(option) === normalized
  );
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

  const letters = [
    "A",
    "B",
    "C",
    "D",
  ];

  const chosenIndex = getTriviaAnswerIndex(answer, session.qdata);

  const correctIndex =
    session.qdata.answer;

  const correct =
    chosenIndex === correctIndex;

  const correctLetter =
    letters[correctIndex] || "?";

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
      gameHeader("trivia"),
      "",
      correct
        ? "╭──── 🏆 CORRECT ────╮"
        : "╭──── ❌ INCORRECT ──╮",
      correct
        ? "│  Excellent answer!"
        : "│  Better luck next time.",
      "╰────────────────────╯",
      "",
      `✓ Correct answer: ${correctLetter}`,
      "",
      rewardLine(
        reward,
        balanceText,
        correct
      ),
    ].join("\n");

    await updateGameMessage(
      api,
      threadID,
      session.messageID,
      finalText
    );
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
// ROCK PAPER SCISSORS
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

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const playerChoice =
      String(
        args?.[0] || ""
      ).toLowerCase();

    if (
      ![
        "rock",
        "paper",
        "scissors",
      ].includes(playerChoice)
    ) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ Choose rock, paper, or scissors."
      );

      return;
    }

    const choices = [
      "rock",
      "paper",
      "scissors",
    ];

    const botChoice =
      choices[
        randInt(0, 2)
      ];

    let result = "draw";

    if (
      (
        playerChoice === "rock" &&
        botChoice === "scissors"
      ) ||
      (
        playerChoice === "scissors" &&
        botChoice === "paper"
      ) ||
      (
        playerChoice === "paper" &&
        botChoice === "rock"
      )
    ) {
      result = "win";
    } else if (
      playerChoice !== botChoice
    ) {
      result = "loss";
    }

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "rps",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          "⚔️ The opponent is choosing...",
          "",
          "      ⟡  ⟡  ⟡",
          "",
          "          WAIT",
        ].join("\n"),
        "rps"
      );

    await sleep(
      editDelay()
    );

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "rps",
        result === "win"
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const resultEmoji =
      result === "win"
        ? "🏆"
        : result === "loss"
          ? "❌"
          : "🤝";

    const resultText =
      result === "win"
        ? "VICTORY"
        : result === "loss"
          ? "DEFEAT"
          : "DRAW";

    const finalText = [
      gameHeader("rps"),
      "",
      `${resultEmoji} ${resultText}`,
      "",
      divider(),
      "",
      `♙ YOU      ${playerChoice.toUpperCase()}`,
      `♟ OPPONENT ${botChoice.toUpperCase()}`,
      "",
      rewardLine(
        reward,
        balanceText,
        result === "win"
      ),
    ].join("\n");

    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      finalText
    );
  } catch (error) {
    console.error(
      "[games] rps:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ RPS failed."
    );
  }

  unlockGame(
    threadID,
    userID
  );
}

// ============================================================
// DICE ROLL
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

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const sides =
      parseInt(
        args?.[0],
        10
      ) || 20;

    if (
      sides < 2 ||
      sides > 1000
    ) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ Die sides must be between 2 and 1000."
      );

      return;
    }

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "roll",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          `🎲 Rolling a ${sides}-sided die...`,
          "",
          "       ⚄",
          "",
          "       ROLLING...",
        ].join("\n"),
        "roll"
      );

    await sleep(
      editDelay()
    );

    const result =
      randInt(1, sides);

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const finalText = [
      gameHeader("roll"),
      "",
      "╭──────── RESULT ────────╮",
      `│        🎲 ${result}`,
      "╰────────────────────────╯",
      "",
      `You rolled a ${sides}-sided die.`,
      "",
      balanceText,
    ].join("\n");

    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      finalText
    );
  } catch (error) {
    console.error(
      "[games] roll:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Roll failed."
    );
  }

  unlockGame(
    threadID,
    userID
  );
}

// ============================================================
// NUMBER GUESS
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

  if (
    !lockGame(
      threadID,
      userID
    )
  ) {
    await safeReply(
      api,
      event,
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const min =
      parseInt(
        args?.[0],
        10
      ) || 1;

    const max =
      parseInt(
        args?.[1],
        10
      ) || 100;

    if (min >= max) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ Minimum must be lower than maximum."
      );

      return;
    }

    const secretNumber =
      randInt(
        min,
        max
      );

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "guess",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          "🎯 Find the number between",
          `   ${min} and ${max}`,
          "",
          "You have 3 attempts.",
          "",
          "↳ Send your first guess.",
        ].join("\n"),
        "guess"
      );

    setSession(
      threadID,
      userID,
      {
        type: "guess",
        secretNumber,
        min,
        max,
        tries: 0,
        messageID:
          animator.messageID,
      }
    );
  } catch (error) {
    unlockGame(
      threadID,
      userID
    );

    console.error(
      "[games] guess:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Guess failed."
    );
  }
}

async function resolveGuess(
  api,
  event,
  guessText
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
    session.type !== "guess"
  ) {
    return false;
  }

  const guess = parseNumericAnswer(guessText);

  if (
    Number.isNaN(guess)
  ) {
    await safeReply(
      api,
      event,
      "❌ Enter a number."
    );

    return true;
  }

  const tries =
    session.tries + 1;

  let resultMessage = "";
  let isCorrect = false;

  if (
    guess ===
    session.secretNumber
  ) {
    isCorrect = true;

    resultMessage =
      `🏆 Correct! You found ${session.secretNumber} in ${tries} attempt${tries === 1 ? "" : "s"}.`;
  } else if (
    tries >= 3
  ) {
    resultMessage =
      `❌ The number was ${session.secretNumber}.`;
  } else if (
    guess <
    session.secretNumber
  ) {
    resultMessage =
      `📈 Too low. Go higher. • ${3 - tries} attempt${3 - tries === 1 ? "" : "s"} left`;
  } else {
    resultMessage =
      `📉 Too high. Go lower. • ${3 - tries} attempt${3 - tries === 1 ? "" : "s"} left`;
  }

  const terminal =
    isCorrect ||
    tries >= 3;

  if (terminal) {
    clearSession(
      threadID,
      userID
    );

    try {
      const reward =
        await awardPlayer(
          threadID,
          userID,
          "guess",
          isCorrect
        );

      const balanceText =
        await getFinalBalanceText(
          threadID,
          userID
        );

      const finalText = [
        gameHeader("guess"),
        "",
        resultMessage,
        "",
        isCorrect
          ? "✦ Your intuition was correct."
          : "✦ The number remains hidden no longer.",
        "",
        rewardLine(
          reward,
          balanceText,
          isCorrect
        ),
      ].join("\n");

      await updateGameMessage(
        api,
        threadID,
        session.messageID,
        finalText
      );
    } catch (error) {
      console.error(
        "[games] guess reward:",
        error
      );

      try {
        await safeReply(
          api,
          event,
          "❌ Guess ended, but the final reward update failed."
        );
      } catch (_) {}
    } finally {
      unlockGame(
        threadID,
        userID
      );
    }
  } else {
    setSession(
      threadID,
      userID,
      {
        ...session,
        tries,
      }
    );

    const text = [
      gameHeader("guess"),
      "",
      resultMessage,
      "",
      `Attempt ${tries}/3`,
      "",
      "↳ Try again.",
    ].join("\n");

    try {
      await updateGameMessage(
        api,
        threadID,
        session.messageID,
        text
      );
    } catch (error) {
      console.error(
        "[games] guess update:",
        error
      );
    }
  }

  return true;
}

// ============================================================
// COIN FLIP
// ============================================================

async function handleCoinFlip(
  api,
  event,
  args
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
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const choice =
      String(
        args?.[0] || ""
      ).toLowerCase();

    if (
      ![
        "heads",
        "tails",
      ].includes(choice)
    ) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ Choose heads or tails."
      );

      return;
    }

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "coinflip",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          `🪙 Your call: ${choice.toUpperCase()}`,
          "",
          "       ◉",
          "",
          "       FLIPPING...",
        ].join("\n"),
        "coinflip"
      );

    await sleep(
      editDelay()
    );

    const result =
      randInt(0, 1) === 0
        ? "heads"
        : "tails";

    const isCorrect =
      choice === result;

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "coinflip",
        isCorrect
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const finalText = [
      gameHeader("coinflip"),
      "",
      `🪙 ${result.toUpperCase()}`,
      "",
      `Your call  •  ${choice.toUpperCase()}`,
      `Result     •  ${result.toUpperCase()}`,
      "",
      isCorrect
        ? "🏆 You called it."
        : "❌ The coin disagreed.",
      "",
      rewardLine(
        reward,
        balanceText,
        isCorrect
      ),
    ].join("\n");

    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      finalText
    );
  } catch (error) {
    console.error(
      "[games] coinflip:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Coin flip failed."
    );
  }

  unlockGame(
    threadID,
    userID
  );
}

// ============================================================
// BLACKJACK
// ============================================================

const CARD_VALUES = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 10,
  Q: 10,
  K: 10,
  A: 11,
};

const SUITS = [
  "♠️",
  "♥️",
  "♦️",
  "♣️",
];

function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (
      const value of Object.keys(
        CARD_VALUES
      )
    ) {
      deck.push(
        `${value}${suit}`
      );
    }
  }

  return deck;
}

function drawCard(deck) {
  if (deck.length === 0) {
    deck.push(
      ...createDeck()
    );
  }

  const idx =
    Math.floor(
      Math.random() *
        deck.length
    );

  const card =
    deck[idx];

  deck.splice(
    idx,
    1
  );

  return card;
}

function getCardValue(card) {
  const value =
    card.slice(0, -1);

  return (
    CARD_VALUES[value] ||
    0
  );
}

function calcHandValue(hand) {
  let value =
    hand.reduce(
      (sum, card) =>
        sum +
        getCardValue(card),
      0
    );

  let aces =
    hand.filter(
      (card) =>
        card.startsWith("A")
    ).length;

  while (
    value > 21 &&
    aces > 0
  ) {
    value -= 10;
    aces--;
  }

  return value;
}

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
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const deck =
      createDeck();

    const playerHand = [
      drawCard(deck),
      drawCard(deck),
    ];

    const botHand = [
      drawCard(deck),
      drawCard(deck),
    ];

    const playerValue =
      calcHandValue(
        playerHand
      );

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "blackjack",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          `♙ YOU     ${playerHand.join("  ")}`,
          `          Total: ${playerValue}`,
          "",
          `♟ DEALER  ${botHand[0]}  ▣`,
          "          Total: ?",
          "",
          divider(),
          "",
          "↳ hit   •   draw another card",
          "↳ stand •   hold your hand",
        ].join("\n"),
        "blackjack"
      );

    setSession(
      threadID,
      userID,
      {
        type: "blackjack",
        playerHand,
        botHand,
        deck,
        messageID:
          animator.messageID,
      }
    );
  } catch (error) {
    unlockGame(
      threadID,
      userID
    );

    console.error(
      "[games] blackjack:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Blackjack failed."
    );
  }
}

async function resolveBlackjack(
  api,
  event,
  action
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

  // Supports both:
  // hit
  // !hit
  // stand
  // !stand
  const cmd =
    String(action)
      .trim()
      .toLowerCase()
      .replace(/^!/, "");

  if (
    cmd !== "hit" &&
    cmd !== "stand"
  ) {
    await safeReply(
      api,
      event,
      "❌ Use `hit` or `stand`."
    );

    return true;
  }

  try {
    // ----------------------------------------------------------
    // HIT
    // ----------------------------------------------------------

    if (cmd === "hit") {
      const card =
        drawCard(
          session.deck
        );

      session.playerHand.push(
        card
      );

      const playerValue =
        calcHandValue(
          session.playerHand
        );

      // Player busts.
      if (playerValue > 21) {
        clearSession(
          threadID,
          userID
        );

        try {
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

          const finalText = [
            gameHeader(
              "blackjack"
            ),
            "",
            "╭────────── BUST ─────────╮",
            "│  ❌ Your hand went over 21.",
            "╰─────────────────────────╯",
            "",
            `♙ ${session.playerHand.join("  ")}`,
            `Total: ${playerValue}`,
            "",
            rewardLine(
              reward,
              balanceText,
              false
            ),
          ].join("\n");

          await updateGameMessage(
            api,
            threadID,
            session.messageID,
            finalText
          );
        } finally {
          unlockGame(
            threadID,
            userID
          );
        }

        return true;
      }

      // Player is still in the game.
      // Refresh the session timeout and KEEP
      // the active-game lock.
      setSession(
        threadID,
        userID,
        session
      );

      const text = [
        gameHeader(
          "blackjack"
        ),
        "",
        divider(),
        "",
        `♙ YOU     ${session.playerHand.join("  ")}`,
        `          Total: ${playerValue}`,
        "",
        `♟ DEALER  ${session.botHand[0]}  ▣`,
        "          Total: ?",
        "",
        divider(),
        "",
        "↳ hit   •   draw another card",
        "↳ stand •   hold your hand",
      ].join("\n");

      await updateGameMessage(
        api,
        threadID,
        session.messageID,
        text
      );

      return true;
    }

    // ----------------------------------------------------------
    // STAND
    // ----------------------------------------------------------

    clearSession(
      threadID,
      userID
    );

    let botValue =
      calcHandValue(
        session.botHand
      );

    while (
      botValue < 17
    ) {
      session.botHand.push(
        drawCard(
          session.deck
        )
      );

      botValue =
        calcHandValue(
          session.botHand
        );
    }

    const playerValue =
      calcHandValue(
        session.playerHand
      );

    let result = "loss";
    let resultText =
      "Dealer wins.";

    if (
      botValue > 21
    ) {
      result = "win";
      resultText =
        "Dealer busted. You win!";
    } else if (
      playerValue > botValue
    ) {
      result = "win";
      resultText =
        "You win!";
    } else if (
      playerValue === botValue
    ) {
      result = "draw";
      resultText =
        "Push — it's a draw.";
    }

    try {
      const reward =
        await awardPlayer(
          threadID,
          userID,
          "blackjack",
          result === "win"
        );

      const balanceText =
        await getFinalBalanceText(
          threadID,
          userID
        );

      const finalText = [
        gameHeader(
          "blackjack"
        ),
        "",
        result === "win"
          ? "🏆 YOU WIN"
          : result === "draw"
            ? "🤝 PUSH"
            : "❌ DEALER WINS",
        "",
        divider(),
        "",
        `♙ YOU     ${session.playerHand.join("  ")}`,
        `          Total: ${playerValue}`,
        "",
        `♟ DEALER  ${session.botHand.join("  ")}`,
        `          Total: ${botValue}`,
        "",
        resultText,
        "",
        rewardLine(
          reward,
          balanceText,
          result === "win"
        ),
      ].join("\n");

      await updateGameMessage(
        api,
        threadID,
        session.messageID,
        finalText
      );
    } finally {
      // Critical:
      // even if DB reward or message edit fails,
      // the player must not remain permanently locked.
      unlockGame(
        threadID,
        userID
      );
    }

    return true;
  } catch (error) {
    console.error(
      "[games] blackjack resolve:",
      error
    );

    clearSession(
      threadID,
      userID
    );

    unlockGame(
      threadID,
      userID
    );

    try {
      await safeReply(
        api,
        event,
        "❌ Blackjack ended because something went wrong."
      );
    } catch (_) {}

    return true;
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
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const symbols = [
      "🍎",
      "🍊",
      "🍋",
      "🍌",
      "🍉",
    ];

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "slots",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          "│     🍎   │   🍊   │   🍋     │",
          "",
          "             SPINNING",
        ].join("\n"),
        "slots"
      );

    await sleep(700);

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
        ],
      ];

    const reelText =
      (reels) =>
        `│     ${reels.join("   │   ")}     │`;

    for (let i = 0; i < 2; i++) {
      const rolling =
        randomReels();

      await updateGameMessage(
        api,
        threadID,
        animator.messageID,
        [
          gameHeader("slots"),
          "",
          divider(),
          "",
          reelText(rolling),
          "",
          "             SPINNING...",
        ].join("\n")
      );

      await sleep(
        editDelay()
      );
    }

    const reels =
      randomReels();

    const isWinner =
      reels[0] === reels[1] &&
      reels[1] === reels[2];

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "slots",
        isWinner
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const finalText = [
      gameHeader("slots"),
      "",
      divider(),
      "",
      reelText(reels),
      "",
      isWinner
        ? "🏆 JACKPOT — THREE OF A KIND!"
        : "❌ No match this time.",
      "",
      rewardLine(
        reward,
        balanceText,
        isWinner
      ),
    ].join("\n");

    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      finalText
    );
  } catch (error) {
    console.error(
      "[games] slots:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ Slots failed."
    );
  }

  unlockGame(
    threadID,
    userID
  );
}

// ============================================================
// MATH
// ============================================================

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
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const a =
      randInt(1, 100);

    const b =
      randInt(1, 100);

    const ops = [
      "+",
      "-",
      "*",
    ];

    const op =
      ops[
        randInt(0, 2)
      ];

    let correctAnswer;

    if (op === "+") {
      correctAnswer =
        a + b;
    } else if (op === "-") {
      correctAnswer =
        a - b;
    } else {
      correctAnswer =
        a * b;
    }

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "math",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          "🧮 Solve the equation",
          "",
          `        ${a} ${op} ${b}`,
          "",
          divider(),
          "",
          "↳ Reply with your answer.",
        ].join("\n"),
        "math"
      );

    setSession(
      threadID,
      userID,
      {
        type: "math",
        correctAnswer,
        messageID:
          animator.messageID,
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

  const userAnswer = parseNumericAnswer(answerText);

  const correct =
    !Number.isNaN(
      userAnswer
    ) &&
    userAnswer ===
      session.correctAnswer;

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
      gameHeader("math"),
      "",
      correct
        ? "🏆 CORRECT"
        : "❌ WRONG",
      "",
      `Answer: ${session.correctAnswer}`,
      "",
      correct
        ? "✦ Calculation complete."
        : "✦ The equation wins this round.",
      "",
      rewardLine(
        reward,
        balanceText,
        correct
      ),
    ].join("\n");

    await updateGameMessage(
      api,
      threadID,
      session.messageID,
      finalText
    );
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
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const riddle =
      await riddleManager.getNextRiddle({
        threadID,
      });

    if (!riddle) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ No riddles are available."
      );

      return;
    }

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "riddle",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          `❓ ${riddle.question}`,
          "",
          "🧠 Think carefully.",
          "",
          divider(),
          "",
          "↳ Reply with your answer.",
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
          animator.messageID,
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

  const normalized = normalizeAnswerText(answerText);

  const correct =
    session.answers.some(
      (answer) => normalizeAnswerText(answer) === normalized
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
      gameHeader("riddle"),
      "",
      correct
        ? "🏆 CORRECT ANSWER"
        : "❌ WRONG ANSWER",
      "",
      `Correct answer: ${session.answers[0]}`,
      "",
      correct
        ? "✦ Your mind solved it."
        : "✦ The riddle remains undefeated.",
      "",
      rewardLine(
        reward,
        balanceText,
        correct
      ),
    ].join("\n");

    await updateGameMessage(
      api,
      threadID,
      session.messageID,
      finalText
    );
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

async function handleEightBall(
  api,
  event,
  args
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
      "⏳ You already have a game in progress."
    );

    return;
  }

  try {
    const question =
      Array.isArray(args)
        ? args.join(" ")
        : String(args || "");

    if (!question.trim()) {
      unlockGame(
        threadID,
        userID
      );

      await safeReply(
        api,
        event,
        "❌ Ask a yes/no question."
      );

      return;
    }

    const animator =
      await createAnimator(
        api,
        threadID,
        [
          gameHeader(
            "8ball",
            playerLine(event)
          ),
          "",
          divider(),
          "",
          `❝ ${question} ❞`,
          "",
          "🎱 Consulting the oracle...",
          "",
          "             ◉",
        ].join("\n"),
        "8ball"
      );

    await sleep(
      editDelay()
    );

    const response =
      EIGHTBALL_RESPONSES[
        randInt(
          0,
          EIGHTBALL_RESPONSES.length - 1
        )
      ];

    const reward =
      await awardPlayer(
        threadID,
        userID,
        "8ball",
        true
      );

    const balanceText =
      await getFinalBalanceText(
        threadID,
        userID
      );

    const finalText = [
      gameHeader("8ball"),
      "",
      divider(),
      "",
      `❝ ${question} ❞`,
      "",
      `🎱 ${response}`,
      "",
      divider(),
      "",
      `💰 +${reward.coins} coins`,
      "",
      balanceText,
    ].join("\n");

    await updateGameMessage(
      api,
      threadID,
      animator.messageID,
      finalText
    );
  } catch (error) {
    console.error(
      "[games] 8ball:",
      error
    );

    await safeReply(
      api,
      event,
      "❌ 8Ball failed."
    );
  }

  unlockGame(
    threadID,
    userID
  );
}

// ============================================================
// REPLY HELPER
// ============================================================

async function safeReply(
  api,
  event,
  text
) {
  try {
    const threadID =
      String(event.threadID);

    const messageID =
      event.messageID;

    if (
      messageID &&
      api.setMessageReaction
    ) {
      await new Promise(
        (resolve) => {
          api.setMessageReaction(
            "❌",
            messageID,
            () => resolve(),
            true
          );
        }
      );
    }

    await sendMessageAsync(
      api,
      threadID,
      text
    );
  } catch (error) {
    console.error(
      "[games] safeReply:",
      error
    );
  }
}

// ============================================================
// MAIN GAME COMMAND DISPATCHER
// ============================================================

async function handleGameCommand(
  api,
  event,
  command,
  args
) {
  const cmd =
    String(command || "")
      .trim()
      .toLowerCase();

  // ----------------------------------------------------------
  // IMPORTANT FIX:
  // index.js currently passes gameArgs as a string.
  //
  // Games such as RPS, roll, guess, and coinflip
  // expect args[0], args[1], etc.
  //
  // Normalize both formats so either works.
  // ----------------------------------------------------------

  const normalizedArgs =
    Array.isArray(args)
      ? args
      : String(args || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);

  if (cmd === "trivia") {
    await handleTrivia(
      api,
      event
    );
  } else if (cmd === "rps") {
    await handleRPS(
      api,
      event,
      normalizedArgs
    );
  } else if (cmd === "roll") {
    await handleRoll(
      api,
      event,
      normalizedArgs
    );
  } else if (cmd === "guess") {
    await handleGuess(
      api,
      event,
      normalizedArgs
    );
  } else if (cmd === "coinflip") {
    await handleCoinFlip(
      api,
      event,
      normalizedArgs
    );
  } else if (cmd === "blackjack") {
    await handleBlackjack(
      api,
      event
    );
  } else if (cmd === "slots") {
    await handleSlots(
      api,
      event
    );
  } else if (cmd === "math") {
    await handleMath(
      api,
      event
    );
  } else if (cmd === "riddle") {
    await handleRiddle(
      api,
      event
    );
  } else if (cmd === "8ball") {
    await handleEightBall(
      api,
      event,
      normalizedArgs
    );
  } else {
    await safeReply(
      api,
      event,
      `❌ Unknown game: ${cmd}`
    );

    return false;
  }

  // IMPORTANT:
  // index.js uses:
  //
  // if (await handleGamesCommand(...)) {
  //   return;
  // }
  //
  // Therefore recognized commands MUST return true.
  return true;
}

// ============================================================
// GAME RESPONSE DISPATCHER
// ============================================================

async function handleGameResponse(
  api,
  event,
  responseText,
  originalText
) {
  const answerText = String(originalText || responseText || "").trim();
  const threadID =
    String(event.threadID);

  const userID =
    String(event.senderID);

  const session =
    getSession(
      threadID,
      userID
    );

  if (!session) {
    return false;
  }

  if (
    session.type === "trivia"
  ) {
    return resolveTrivia(
      api,
      event,
      answerText
    );
  }

  if (
    session.type === "riddle"
  ) {
    return resolveRiddle(
      api,
      event,
      answerText
    );
  }

  if (
    session.type === "guess"
  ) {
    return resolveGuess(
      api,
      event,
      answerText
    );
  }

  if (
    session.type === "blackjack"
  ) {
    return resolveBlackjack(
      api,
      event,
      answerText
    );
  }

  if (
    session.type === "math"
  ) {
    return resolveMath(
      api,
      event,
      answerText
    );
  }

  return false;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  handleGameCommand,

  // Backwards compatibility:
  // index.js may still import/use handleGamesCommand.
  handleGamesCommand:
    handleGameCommand,

  handleGameResponse,

  lockGame,
  unlockGame,
};
