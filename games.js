const db = require("./db");
const { reply } = require("./util");
const triviaQuestions = require("./trivia-questions");

// ============================================================
// GAME CONFIG
// ============================================================

const SESSION_TIMEOUT_MS = 30_000;

// Every edit waits a random 3.2–3.8 seconds.
// This feels more natural than exactly 3500ms every time.
const EDIT_MIN_MS = 3200;
const EDIT_MAX_MS = 3800;

const sessions = new Map();
const sessionTimers = new Map();

// ============================================================
// BASIC HELPERS
// ============================================================

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function editDelay() {
  return randInt(EDIT_MIN_MS, EDIT_MAX_MS);
}

function money(n) {
  return Number(n).toLocaleString("en-US");
}

function sessionKey(threadID, userID) {
  return `${threadID}:${userID}`;
}

// ============================================================
// MESSENGER MESSAGE HELPERS
// ============================================================

function sendMessageAsync(api, threadID, text) {
  return new Promise((resolve, reject) => {
    try {
      api.sendMessage(text, threadID, (error, messageInfo) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(messageInfo || null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function getMessageID(messageInfo) {
  if (!messageInfo) return null;

  return (
    messageInfo.messageID ||
    messageInfo.messageId ||
    messageInfo.mid ||
    null
  );
}

function editMessageAsync(api, text, messageID) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof api.editMessage !== "function") {
        reject(new Error("editMessage() is not supported by this FCA version."));
        return;
      }

      api.editMessage(text, messageID, error => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================
// ANIMATOR
// ============================================================
//
// Sends ONE message and keeps editing that same message.
//
// If editing fails, it does NOT spam the chat with every frame.
// It simply sends the final result once.
// ============================================================

async function createAnimator(api, threadID, firstText) {
  const sent = await sendMessageAsync(api, threadID, firstText);

  const messageID = getMessageID(sent);

  let editable =
    Boolean(messageID) &&
    typeof api.editMessage === "function";

  return {
    messageID,

    async edit(text) {
      if (!editable) return false;

      try {
        await editMessageAsync(api, text, messageID);
        return true;
      } catch (error) {
        console.warn("[games] message edit failed:", error.message);
        editable = false;
        return false;
      }
    },

    async waitAndEdit(text) {
      await sleep(editDelay());
      return this.edit(text);
    },

    async final(text) {
      if (editable) {
        try {
          await editMessageAsync(api, text, messageID);
          return true;
        } catch (error) {
          console.warn("[games] final message edit failed:", error.message);
          editable = false;
        }
      }

      try {
        await sendMessageAsync(api, threadID, text);
      } catch (error) {
        console.error("[games] failed to send final message:", error);
      }

      return false;
    }
  };
}

async function safeReply(api, event, text) {
  try {
    await reply(api, event, text);
  } catch (error) {
    console.error("[games] reply failed:", error);
  }
}

async function editOrSend(api, threadID, messageID, text) {
  if (messageID && typeof api.editMessage === "function") {
    try {
      await editMessageAsync(api, text, messageID);
      return true;
    } catch (error) {
      console.warn("[games] edit failed:", error.message);
    }
  }

  try {
    await sendMessageAsync(api, threadID, text);
  } catch (error) {
    console.error("[games] send failed:", error);
  }

  return false;
}

// ============================================================
// GAME SESSION HELPERS
// ============================================================

function clearSession(threadID, userID) {
  const key = sessionKey(threadID, userID);

  sessions.delete(key);

  const timer = sessionTimers.get(key);

  if (timer) {
    clearTimeout(timer);
    sessionTimers.delete(key);
  }
}

function setSession(threadID, userID, session) {
  const key = sessionKey(threadID, userID);

  const oldTimer = sessionTimers.get(key);

  if (oldTimer) {
    clearTimeout(oldTimer);
  }

  sessions.set(key, session);

  const timer = setTimeout(() => {
    sessions.delete(key);
    sessionTimers.delete(key);
  }, SESSION_TIMEOUT_MS);

  sessionTimers.set(key, timer);
}

function getSession(threadID, userID) {
  return sessions.get(sessionKey(threadID, userID));
}

function clearThreadSessions(threadID) {
  for (const [key, session] of sessions.entries()) {
    if (key.startsWith(`${threadID}:`)) {
      sessions.delete(key);

      const timer = sessionTimers.get(key);

      if (timer) {
        clearTimeout(timer);
        sessionTimers.delete(key);
      }
    }
  }
}

// ============================================================
// BALANCE HELPERS
// ============================================================

async function getBalance(threadID, userID) {
  const user = await db.getUser(String(threadID), String(userID));
  return Number(user.balance || 0);
}

async function canAfford(threadID, userID, amount) {
  const balance = await getBalance(threadID, userID);
  return balance >= amount;
}

// ============================================================
// GAME ENABLE / DISABLE
// ============================================================

async function gamesAreEnabled(threadID) {
  try {
    return await db.isGameEnabled(String(threadID));
  } catch (error) {
    console.error("[games] failed checking game setting:", error);

    // Fail closed.
    return false;
  }
}

async function handleGameToggle(api, event, text) {
  const threadID = String(event.threadID);
  const lower = text.toLowerCase().trim();

  let enabled = null;

  if (lower === "!game on" || lower === "!games on") {
    enabled = true;
  }

  if (lower === "!game off" || lower === "!games off") {
    enabled = false;
  }

  if (enabled === null) {
    return false;
  }

  try {
    await db.setGameEnabled(threadID, enabled);

    if (!enabled) {
      clearThreadSessions(threadID);
    }

    const message = enabled
      ? [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎮 GAMES",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "✦ Status: 🟢 ON",
          "",
          "Games are now enabled.",
          "Good luck. Have fun. 🎲",
          "",
          "╰─➤ !games"
        ].join("\n")
      : [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "        🎮 GAMES",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "✦ Status: 🔴 OFF",
          "",
          "Games have been disabled",
          "for this group.",
          "",
          "╰─➤ !game on"
        ].join("\n");

    await safeReply(api, event, message);

    return true;
  } catch (error) {
    console.error("[games] toggle failed:", error);

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

async function handleGamesMenu(api, event) {
  const threadID = String(event.threadID);

  let enabled = false;

  try {
    enabled = await gamesAreEnabled(threadID);
  } catch {}

  const status = enabled ? "🟢 ON" : "🔴 OFF";

  const menu = [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    "        🎮 GAME ROOM",
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `✦ Status: ${status}`,
    "",
    "╭─ 🎯 QUICK GAMES",
    "│",
    "├ 🎲 !roll <bet>",
    "│   Roll the dice.",
    "│",
    "",
    "├ 🎯 !guess <1-10> [bet]",
    "│   Guess the hidden number.",
    "│",
    "",
    "├ 🪙 !coinflip <bet> <heads/tails>",
    "│   Pick the winning side.",
    "│",
    "",
    "├ ✊ !rps <choice> [bet]",
    "│   Rock • Paper • Scissors.",
    "│",
    "╰────────────────────",
    "",
    "╭─ 🎰 FEATURE GAMES",
    "│",
    "├ 🎰 !slots <bet>",
    "│   Match the reels.",
    "│",
    "",
    "├ 🃏 !blackjack <bet>",
    "│   Beat the dealer.",
    "│   Use !hit / !stand",
    "│",
    "",
    "├ 🎱 !8ball <question>",
    "│   Ask the mysterious 8-ball.",
    "│",
    "",
    "├ 🧠 !trivia",
    "│   Answer A / B / C / D.",
    "│",
    "╰────────────────────",
    "",
    "🎁 WIN • PLAY • EARN",
    "",
    "⚙️ Admin:",
    "!game on  •  !game off"
  ].join("\n");

  await safeReply(api, event, menu);
}

// ============================================================
// TRIVIA
// ============================================================

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

  const reward =
    Number(raw.reward || raw.prize || 100);

  if (!question || !Array.isArray(options) || options.length < 4) {
    return null;
  }

  return {
    question,
    options: options.slice(0, 4),
    answer,
    reward: Number.isFinite(reward) ? reward : 100
  };
}

function getTriviaQuestions() {
  if (Array.isArray(triviaQuestions)) {
    return triviaQuestions;
  }

  if (Array.isArray(triviaQuestions.questions)) {
    return triviaQuestions.questions;
  }

  if (Array.isArray(triviaQuestions.default)) {
    return triviaQuestions.default;
  }

  return [];
}

function triviaAnswerMatches(answer, userAnswer) {
  if (answer === undefined || answer === null) {
    return false;
  }

  const normalizedUser = String(userAnswer)
    .trim()
    .toUpperCase();

  if (typeof answer === "number") {
    return (
      answer === userAnswer ||
      answer === userAnswer - 1
    );
  }

  const normalizedAnswer = String(answer)
    .trim()
    .toUpperCase();

  return (
    normalizedAnswer === normalizedUser ||
    normalizedAnswer === String(userAnswer + 1) ||
    normalizedAnswer === String(userAnswer)
  );
}

async function handleTrivia(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const list = getTriviaQuestions();

  if (!list.length) {
    await safeReply(
      api,
      event,
      "❌ No trivia questions are configured."
    );
    return;
  }

  clearSession(threadID, userID);

  const raw = list[randInt(0, list.length - 1)];
  const qdata = normalizeTriviaQuestion(raw);

  if (!qdata) {
    await safeReply(
      api,
      event,
      "❌ This trivia question is malformed."
    );
    return;
  }

  const letters = ["A", "B", "C", "D"];

  const questionText = [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    "          🧠 TRIVIA",
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    `❓ ${qdata.question}`,
    "",
    `A. ${qdata.options[0]}`,
    `B. ${qdata.options[1]}`,
    `C. ${qdata.options[2]}`,
    `D. ${qdata.options[3]}`,
    "",
    "┌────────────────────",
    `│ 💰 Reward: ${money(qdata.reward)} coins`,
    "│ ⏳ Time: 30 seconds",
    "└────────────────────",
    "",
    "✦ Reply with A, B, C or D."
  ].join("\n");

  const animator = await createAnimator(
    api,
    threadID,
    questionText
  );

  setSession(threadID, userID, {
    type: "trivia",
    qdata,
    messageID: animator.messageID
  });
}

async function resolveTrivia(api, event, answer) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "trivia") {
    return false;
  }

  clearSession(threadID, userID);

  const qdata = session.qdata;

  const letters = ["A", "B", "C", "D"];
  const index = letters.indexOf(answer.toUpperCase());

  const correct = triviaAnswerMatches(
    qdata.answer,
    index
  ) || triviaAnswerMatches(
    qdata.answer,
    answer.toUpperCase()
  );

  const correctIndex =
    typeof qdata.answer === "number"
      ? qdata.answer >= 1 && qdata.answer <= 4
        ? qdata.answer - 1
        : qdata.answer
      : letters.indexOf(
          String(qdata.answer).toUpperCase()
        );

  const correctLetter =
    letters[correctIndex] ||
    String(qdata.answer).toUpperCase();

  if (correct) {
    await db.addBalance(
      threadID,
      userID,
      qdata.reward
    );

    await db.incrementGameStats(
      threadID,
      userID,
      true
    );

    const result = [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🧠 TRIVIA",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "✅ CORRECT!",
      "",
      `🎯 Answer: ${correctLetter}`,
      `💰 +${money(qdata.reward)} coins`,
      "",
      "✦ Knowledge pays. 🏆"
    ].join("\n");

    await editOrSend(
      api,
      threadID,
      session.messageID,
      result
    );
  } else {
    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    const result = [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🧠 TRIVIA",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "❌ WRONG ANSWER",
      "",
      `Your answer: ${answer.toUpperCase()}`,
      `Correct answer: ${correctLetter}`,
      "",
      "Better luck next time. 🥲"
    ].join("\n");

    await editOrSend(
      api,
      threadID,
      session.messageID,
      result
    );
  }

  return true;
}

// ============================================================
// ROCK PAPER SCISSORS
// ============================================================

async function handleRPS(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const choice = String(args[0] || "").toLowerCase();

  const valid = ["rock", "paper", "scissors"];

  if (!valid.includes(choice)) {
    await safeReply(
      api,
      event,
      "✊ RPS usage:\n!rps rock [bet]\n!rps paper [bet]\n!rps scissors [bet]"
    );
    return;
  }

  let bet = Number(args[1] || 0);

  if (!Number.isFinite(bet) || bet < 0 || !Number.isInteger(bet)) {
    await safeReply(api, event, "❌ Invalid bet.");
    return;
  }

  if (!(await canAfford(threadID, userID, bet))) {
    await safeReply(api, event, "❌ You don't have enough coins.");
    return;
  }

  clearSession(threadID, userID);

  if (bet > 0) {
    await db.addBalance(threadID, userID, -bet);
  }

  const choices = ["rock", "paper", "scissors"];

  const emoji = {
    rock: "🪨",
    paper: "📄",
    scissors: "✂️"
  };

  const botChoice =
    choices[randInt(0, choices.length - 1)];

  let result;

  if (choice === botChoice) {
    result = "tie";
  } else if (
    (choice === "rock" && botChoice === "scissors") ||
    (choice === "paper" && botChoice === "rock") ||
    (choice === "scissors" && botChoice === "paper")
  ) {
    result = "win";
  } else {
    result = "lose";
  }

  const animator = await createAnimator(
    api,
    threadID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        ✊ RPS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🤖 Bot is choosing...",
      "",
      "     ✊   ✋   ✌️",
      "",
      "⏳ Wait for it..."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        ✊ RPS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 You: ${emoji[choice]}`,
      "",
      "🤖 Bot:",
      "     🌀 choosing...",
      "",
      "⚔️ The match is locked."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        ✊ RPS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 You: ${emoji[choice]}`,
      `🤖 Bot: ${emoji[botChoice]}`,
      "",
      "⚡ FINAL RESULT"
    ].join("\n")
  );

  if (result === "win") {
    const payout = bet * 2;

    if (payout > 0) {
      await db.addBalance(threadID, userID, payout);
    }

    await db.incrementGameStats(
      threadID,
      userID,
      true
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        ✊ RPS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "🏆 YOU WIN!",
        "",
        `👤 You: ${emoji[choice]} ${choice}`,
        `🤖 Bot: ${emoji[botChoice]} ${botChoice}`,
        "",
        `💰 Payout: ${money(payout)}`,
        bet > 0
          ? `📈 Net profit: +${money(bet)}`
          : "🎉 Free play win!",
        "",
        "✦ Clean victory."
      ].join("\n")
    );
  } else if (result === "tie") {
    if (bet > 0) {
      await db.addBalance(threadID, userID, bet);
    }

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        ✊ RPS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "🤝 DRAW!",
        "",
        `👤 You: ${emoji[choice]} ${choice}`,
        `🤖 Bot: ${emoji[botChoice]} ${botChoice}`,
        "",
        `💰 Bet refunded: ${money(bet)}`,
        "",
        "Nobody wins this round."
      ].join("\n")
    );
  } else {
    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        ✊ RPS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "💀 YOU LOSE",
        "",
        `👤 You: ${emoji[choice]} ${choice}`,
        `🤖 Bot: ${emoji[botChoice]} ${botChoice}`,
        "",
        `💸 Lost: ${money(bet)}`,
        "",
        "The bot takes the round."
      ].join("\n")
    );
  }
}

// ============================================================
// ROLL
// ============================================================

async function handleRoll(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  let sides = 100;
  let bet;

  if (args.length === 1) {
    bet = Number(args[0]);
  } else {
    sides = Number(args[0]);
    bet = Number(args[1]);
  }

  if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
    await safeReply(
      api,
      event,
      "❌ Sides must be between 2 and 1000."
    );
    return;
  }

  if (!Number.isInteger(bet) || bet < 1) {
    await safeReply(
      api,
      event,
      "❌ Usage: !roll <bet> or !roll <sides> <bet>"
    );
    return;
  }

  if (!(await canAfford(threadID, userID, bet))) {
    await safeReply(api, event, "❌ Not enough coins.");
    return;
  }

  clearSession(threadID, userID);

  await db.addBalance(threadID, userID, -bet);

  const roll = randInt(1, sides);
  const threshold = Math.floor(sides * 0.55);
  const won = roll >= threshold;

  const animator = await createAnimator(
    api,
    threadID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🎲 DICE",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `🎯 D${sides}`,
      "",
      "🎲 Rolling...",
      "",
      "     ⚀  ⚁  ⚂",
      "     ⚃  ⚄  ⚅",
      "",
      "⏳ The dice are moving..."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🎲 DICE",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `🎯 D${sides}`,
      "",
      "🎲 Rolling...",
      "",
      `     [ ${randInt(1, sides)} ]`,
      "",
      "━━━━━━━━━━━━━━━━━━━━",
      "        🌀",
      "━━━━━━━━━━━━━━━━━━━━"
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🎲 DICE",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `🎯 D${sides}`,
      "",
      "🎲 Final roll...",
      "",
      `     [ ${randInt(1, sides)} ]`,
      "",
      "⚡ LOCKING IN..."
    ].join("\n")
  );

  if (won) {
    const payout = bet * 2;

    await db.addBalance(
      threadID,
      userID,
      payout
    );

    await db.incrementGameStats(
      threadID,
      userID,
      true
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        🎲 DICE",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "🏆 YOU WIN!",
        "",
        `🎲 Roll: ${roll} / ${sides}`,
        `🎯 Target: ${threshold}+`,
        "",
        `💰 Payout: ${money(payout)}`,
        `📈 Profit: +${money(bet)}`,
        "",
        "✦ The dice favored you."
      ].join("\n")
    );
  } else {
    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        🎲 DICE",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "💀 YOU LOSE",
        "",
        `🎲 Roll: ${roll} / ${sides}`,
        `🎯 Target: ${threshold}+`,
        "",
        `💸 Lost: ${money(bet)}`,
        "",
        "✦ The dice betrayed you."
      ].join("\n")
    );
  }
}

// ============================================================
// GUESS
// ============================================================

async function handleGuess(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const guess = Number(args[0]);
  const bet = Number(args[1] || 100);

  if (!Number.isInteger(guess) || guess < 1 || guess > 10) {
    await safeReply(
      api,
      event,
      "🎯 Usage: !guess <1-10> [bet]"
    );
    return;
  }

  if (!Number.isInteger(bet) || bet < 0) {
    await safeReply(api, event, "❌ Invalid bet.");
    return;
  }

  if (!(await canAfford(threadID, userID, bet))) {
    await safeReply(api, event, "❌ Not enough coins.");
    return;
  }

  clearSession(threadID, userID);

  if (bet > 0) {
    await db.addBalance(threadID, userID, -bet);
  }

  const secret = randInt(1, 10);
  const won = guess === secret;

  const animator = await createAnimator(
    api,
    threadID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🎯 GUESS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 Your guess: ${guess}`,
      "",
      "🔎 Searching...",
      "",
      "1 • 2 • 3 • 4 • 5",
      "6 • 7 • 8 • 9 • 10",
      "",
      "⏳ Finding the number..."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🎯 GUESS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 Your guess: ${guess}`,
      "",
      "🔎 Scanning numbers...",
      "",
      `   ${randInt(1, 10)}  →  ${randInt(1, 10)}  →  ?`,
      "",
      "🌀 Locking target..."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🎯 GUESS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 Your guess: ${guess}`,
      "",
      "🎯 TARGET LOCKED",
      "",
      "████████████████",
      "",
      "⚡ REVEALING..."
    ].join("\n")
  );

  if (won) {
    const payout = bet * 5;

    if (payout > 0) {
      await db.addBalance(
        threadID,
        userID,
        payout
      );
    }

    await db.incrementGameStats(
      threadID,
      userID,
      true
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        🎯 GUESS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "🎯 PERFECT GUESS!",
        "",
        `👤 You picked: ${guess}`,
        `🎲 Number was: ${secret}`,
        "",
        `💰 Payout: ${money(payout)}`,
        `🔥 Profit: +${money(bet * 4)}`,
        "",
        "✦ You actually got it."
      ].join("\n")
    );
  } else {
    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "        🎯 GUESS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "❌ WRONG GUESS",
        "",
        `👤 You picked: ${guess}`,
        `🎲 Number was: ${secret}`,
        "",
        `💸 Lost: ${money(bet)}`,
        "",
        "✦ So close. Or not. 😭"
      ].join("\n")
    );
  }
}

// ============================================================
// COINFLIP
// ============================================================

async function handleCoinflip(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (args.length < 2) {
    await safeReply(
      api,
      event,
      "🪙 Usage: !coinflip <bet> <heads/tails>"
    );
    return;
  }

  let bet = Number(args[0]);
  let choice = String(args[1]).toLowerCase();

  if (
    choice !== "heads" &&
    choice !== "tails"
  ) {
    // Allow reversed order:
    // !coinflip heads 100
    choice = String(args[0]).toLowerCase();
    bet = Number(args[1]);
  }

  if (
    choice !== "heads" &&
    choice !== "tails"
  ) {
    await safeReply(
      api,
      event,
      "❌ Pick heads or tails."
    );
    return;
  }

  if (!Number.isInteger(bet) || bet < 1) {
    await safeReply(api, event, "❌ Invalid bet.");
    return;
  }

  if (!(await canAfford(threadID, userID, bet))) {
    await safeReply(api, event, "❌ Not enough coins.");
    return;
  }

  clearSession(threadID, userID);

  await db.addBalance(
    threadID,
    userID,
    -bet
  );

  const result =
    Math.random() < 0.5
      ? "heads"
      : "tails";

  const won = choice === result;

  const animator = await createAnimator(
    api,
    threadID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🪙 COINFLIP",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 You picked: ${choice}`,
      "",
      "🪙 FLIPPING...",
      "",
      "        🪙",
      "       ↗️",
      "      ↘️",
      "",
      "⏳ The coin is in the air..."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🪙 COINFLIP",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 You picked: ${choice}`,
      "",
      "🪙",
      "  ↗️",
      "    ↘️",
      "      🪙",
      "",
      "⚡ Still flipping..."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🪙 COINFLIP",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👤 You picked: ${choice}`,
      "",
      "🪙",
      "",
      "████████████████",
      "",
      "⚡ FINAL..."
    ].join("\n")
  );

  if (won) {
    const payout = bet * 2;

    await db.addBalance(
      threadID,
      userID,
      payout
    );

    await db.incrementGameStats(
      threadID,
      userID,
      true
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🪙 COINFLIP",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "🏆 YOU WIN!",
        "",
        `👤 Pick: ${choice}`,
        `🪙 Result: ${result}`,
        "",
        `💰 Payout: ${money(payout)}`,
        `📈 Profit: +${money(bet)}`,
        "",
        "✦ Perfect call."
      ].join("\n")
    );
  } else {
    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🪙 COINFLIP",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "💀 YOU LOSE",
        "",
        `👤 Pick: ${choice}`,
        `🪙 Result: ${result}`,
        "",
        `💸 Lost: ${money(bet)}`,
        "",
        "✦ The coin chose violence."
      ].join("\n")
    );
  }
}

// ============================================================
// SLOTS
// ============================================================

async function handleSlots(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const bet = Number(args[0]);

  if (!Number.isInteger(bet) || bet < 1) {
    await safeReply(
      api,
      event,
      "🎰 Usage: !slots <bet>"
    );
    return;
  }

  if (!(await canAfford(threadID, userID, bet))) {
    await safeReply(api, event, "❌ Not enough coins.");
    return;
  }

  clearSession(threadID, userID);

  await db.addBalance(
    threadID,
    userID,
    -bet
  );

  const symbols = [
    "🍋",
    "🍒",
    "🍇",
    "🔔",
    "💎",
    "7️⃣"
  ];

  const randomReels = () => [
    symbols[randInt(0, symbols.length - 1)],
    symbols[randInt(0, symbols.length - 1)],
    symbols[randInt(0, symbols.length - 1)]
  ];

  const reel1 = randomReels();
  const reel2 = randomReels();
  const reel3 = randomReels();

  // Final reels are deliberately generated only once.
  const finalReels = [
    symbols[randInt(0, symbols.length - 1)],
    symbols[randInt(0, symbols.length - 1)],
    symbols[randInt(0, symbols.length - 1)]
  ];

  const sameCount =
    finalReels[0] === finalReels[1]
      ? finalReels[1] === finalReels[2]
        ? 3
        : 2
      : finalReels[0] === finalReels[2]
        ? 2
        : finalReels[1] === finalReels[2]
          ? 2
          : 1;

  let multiplier = 0;

  if (sameCount === 3) {
    if (
      finalReels[0] === "💎" ||
      finalReels[0] === "7️⃣"
    ) {
      multiplier = 5;
    } else {
      multiplier = 3;
    }
  } else if (sameCount === 2) {
    multiplier = 1.5;
  }

  const payout = Math.floor(bet * multiplier);

  const reelText = reels =>
    `│       ${reels.join("  |  ")}       │`;

  const animator = await createAnimator(
    api,
    threadID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "         🎰 SLOTS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "┌────────────────────┐",
      reelText(["❔", "❔", "❔"]),
      "└────────────────────┘",
      "",
      `💰 Bet: ${money(bet)}`,
      "",
      "🎰 Starting reels..."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "         🎰 SLOTS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "┌────────────────────┐",
      reelText(reel1),
      "└────────────────────┘",
      "",
      "🎰 REEL 1 • SPINNING",
      "🎰 REEL 2 • SPINNING",
      "🎰 REEL 3 • SPINNING"
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "         🎰 SLOTS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "┌────────────────────┐",
      reelText(reel2),
      "└────────────────────┘",
      "",
      "🎰 REEL 1 • LOCKED",
      "🎰 REEL 2 • SPINNING",
      "🎰 REEL 3 • SPINNING"
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "         🎰 SLOTS",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "┌────────────────────┐",
      reelText(reel3),
      "└────────────────────┘",
      "",
      "🎰 REEL 1 • LOCKED",
      "🎰 REEL 2 • LOCKED",
      "🎰 REEL 3 • FINAL SPIN..."
    ].join("\n")
  );

  if (multiplier > 0) {
    await db.addBalance(
      threadID,
      userID,
      payout
    );

    await db.incrementGameStats(
      threadID,
      userID,
      true
    );

    const jackpot =
      sameCount === 3 &&
      (finalReels[0] === "💎" ||
        finalReels[0] === "7️⃣");

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "         🎰 SLOTS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        jackpot
          ? "💎💎💎 JACKPOT! 💎💎💎"
          : "🎉 WINNER!",
        "",
        "┌────────────────────┐",
        reelText(finalReels),
        "└────────────────────┘",
        "",
        `✦ Multiplier: ${multiplier}x`,
        `💰 Payout: ${money(payout)}`,
        `📈 Profit: +${money(payout - bet)}`,
        "",
        jackpot
          ? "🔥 ABSOLUTE JACKPOT."
          : "✦ Nice spin."
      ].join("\n")
    );
  } else {
    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "         🎰 SLOTS",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "💀 NO MATCH",
        "",
        "┌────────────────────┐",
        reelText(finalReels),
        "└────────────────────┘",
        "",
        `💸 Lost: ${money(bet)}`,
        "",
        "✦ Spin again when you're ready."
      ].join("\n")
    );
  }
}

// ============================================================
// BLACKJACK
// ============================================================

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
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

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function cardValue(card) {
  if (["J", "Q", "K"].includes(card.rank)) {
    return 10;
  }

  if (card.rank === "A") {
    return 11;
  }

  return Number(card.rank);
}

function handValue(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    total += cardValue(card);

    if (card.rank === "A") {
      aces++;
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function handString(hand) {
  return hand
    .map(card => `${card.rank}${card.suit}`)
    .join("  ");
}

function blackjackStateText(
  playerHand,
  dealerHand,
  revealDealer = false
) {
  const player = handValue(playerHand);

  const dealerShown = revealDealer
    ? handString(dealerHand)
    : `${dealerHand[0].rank}${dealerHand[0].suit}  🂠`;

  const dealerValue = revealDealer
    ? handValue(dealerHand)
    : "?";

  return [
    `👤 YOU   [${player}]`,
    `│ ${handString(playerHand)}`,
    "",
    `🤖 DEALER [${dealerValue}]`,
    `│ ${dealerShown}`
  ].join("\n");
}

async function handleBlackjack(api, event, args) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const bet = Number(args[0]);

  if (!Number.isInteger(bet) || bet < 1) {
    await safeReply(
      api,
      event,
      "🃏 Usage: !blackjack <bet>"
    );
    return;
  }

  if (!(await canAfford(threadID, userID, bet))) {
    await safeReply(api, event, "❌ Not enough coins.");
    return;
  }

  clearSession(threadID, userID);

  await db.addBalance(
    threadID,
    userID,
    -bet
  );

  const deck = createDeck();

  const playerHand = [
    deck.pop(),
    deck.pop()
  ];

  const dealerHand = [
    deck.pop(),
    deck.pop()
  ];

  const playerBlackjack =
    handValue(playerHand) === 21;

  const dealerBlackjack =
    handValue(dealerHand) === 21;

  const animator = await createAnimator(
    api,
    threadID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🃏 BLACKJACK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🃏 Dealing cards...",
      "",
      "👤 YOU",
      "│ 🂠  🂠",
      "",
      "🤖 DEALER",
      "│ 🂠  🂠",
      "",
      "⏳ Cards are being dealt..."
    ].join("\n")
  );

  await animator.waitAndEdit(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🃏 BLACKJACK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      blackjackStateText(
        playerHand,
        dealerHand,
        false
      ),
      "",
      "⚡ Reading the table..."
    ].join("\n")
  );

  if (playerBlackjack || dealerBlackjack) {
    if (playerBlackjack && dealerBlackjack) {
      await db.addBalance(
        threadID,
        userID,
        bet
      );

      await animator.final(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "       🃏 BLACKJACK",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "🤝 PUSH",
          "",
          blackjackStateText(
            playerHand,
            dealerHand,
            true
          ),
          "",
          `💰 Bet refunded: ${money(bet)}`,
          "",
          "Both have blackjack."
        ].join("\n")
      );

      return;
    }

    if (playerBlackjack) {
      const payout = Math.floor(bet * 2.5);

      await db.addBalance(
        threadID,
        userID,
        payout
      );

      await db.incrementGameStats(
        threadID,
        userID,
        true
      );

      await animator.final(
        [
          "╭━━━━━━━━━━━━━━━━━━━━╮",
          "       🃏 BLACKJACK",
          "╰━━━━━━━━━━━━━━━━━━━━╯",
          "",
          "♠️ NATURAL BLACKJACK!",
          "",
          blackjackStateText(
            playerHand,
            dealerHand,
            true
          ),
          "",
          `💰 Payout: ${money(payout)}`,
          `🔥 Profit: +${money(payout - bet)}`,
          "",
          "✦ Beautiful hand."
        ].join("\n")
      );

      return;
    }

    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    await animator.final(
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🃏 BLACKJACK",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "💀 DEALER BLACKJACK",
        "",
        blackjackStateText(
          playerHand,
          dealerHand,
          true
        ),
        "",
        `💸 Lost: ${money(bet)}`,
        "",
        "The dealer had it from the start."
      ].join("\n")
    );

    return;
  }

  setSession(threadID, userID, {
    type: "blackjack",
    bet,
    deck,
    playerHand,
    dealerHand,
    messageID: animator.messageID
  });

  await animator.final(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🃏 BLACKJACK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      blackjackStateText(
        playerHand,
        dealerHand,
        false
      ),
      "",
      `💰 Bet: ${money(bet)}`,
      "",
      "⚔️ Your move:",
      "!hit  •  !stand"
    ].join("\n")
  );
}

async function handleBlackjackHit(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "blackjack") {
    return false;
  }

  const card = session.deck.pop();

  session.playerHand.push(card);

  const value = handValue(session.playerHand);

  if (value > 21) {
    clearSession(threadID, userID);

    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    await editOrSend(
      api,
      threadID,
      session.messageID,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🃏 BLACKJACK",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "💥 BUST!",
        "",
        blackjackStateText(
          session.playerHand,
          session.dealerHand,
          false
        ),
        "",
        `💀 Total: ${value}`,
        `💸 Lost: ${money(session.bet)}`,
        "",
        "✦ You went over 21."
      ].join("\n")
    );

    return true;
  }

  setSession(
    threadID,
    userID,
    session
  );

  await sleep(editDelay());

  await editOrSend(
    api,
    threadID,
    session.messageID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🃏 BLACKJACK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🎴 CARD DRAWN",
      "",
      blackjackStateText(
        session.playerHand,
        session.dealerHand,
        false
      ),
      "",
      `💰 Bet: ${money(session.bet)}`,
      "",
      "⚔️ Your move:",
      "!hit  •  !stand"
    ].join("\n")
  );

  return true;
}

async function handleBlackjackStand(api, event) {
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const session = getSession(threadID, userID);

  if (!session || session.type !== "blackjack") {
    return false;
  }

  clearSession(threadID, userID);

  while (
    handValue(session.dealerHand) < 17
  ) {
    session.dealerHand.push(
      session.deck.pop()
    );
  }

  const player = handValue(
    session.playerHand
  );

  const dealer = handValue(
    session.dealerHand
  );

  let result;

  if (dealer > 21) {
    result = "win";
  } else if (player > dealer) {
    result = "win";
  } else if (player === dealer) {
    result = "push";
  } else {
    result = "lose";
  }

  await sleep(editDelay());

  await editOrSend(
    api,
    threadID,
    session.messageID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🃏 BLACKJACK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🤖 DEALER REVEALS",
      "",
      blackjackStateText(
        session.playerHand,
        session.dealerHand,
        true
      ),
      "",
      "🃏 Dealer is checking..."
    ].join("\n")
  );

  await sleep(editDelay());

  await editOrSend(
    api,
    threadID,
    session.messageID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "       🃏 BLACKJACK",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "⚔️ FINAL TABLE",
      "",
      blackjackStateText(
        session.playerHand,
        session.dealerHand,
        true
      ),
      "",
      "⚡ Calculating winner..."
    ].join("\n")
  );

  if (result === "win") {
    const payout = session.bet * 2;

    await db.addBalance(
      threadID,
      userID,
      payout
    );

    await db.incrementGameStats(
      threadID,
      userID,
      true
    );

    await editOrSend(
      api,
      threadID,
      session.messageID,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🃏 BLACKJACK",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "🏆 YOU WIN!",
        "",
        blackjackStateText(
          session.playerHand,
          session.dealerHand,
          true
        ),
        "",
        `💰 Payout: ${money(payout)}`,
        `📈 Profit: +${money(session.bet)}`,
        "",
        "✦ Dealer has been defeated."
      ].join("\n")
    );
  } else if (result === "push") {
    await db.addBalance(
      threadID,
      userID,
      session.bet
    );

    await editOrSend(
      api,
      threadID,
      session.messageID,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🃏 BLACKJACK",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "🤝 PUSH",
        "",
        blackjackStateText(
          session.playerHand,
          session.dealerHand,
          true
        ),
        "",
        `💰 Refunded: ${money(session.bet)}`,
        "",
        "Same score. Nobody wins."
      ].join("\n")
    );
  } else {
    await db.incrementGameStats(
      threadID,
      userID,
      false
    );

    await editOrSend(
      api,
      threadID,
      session.messageID,
      [
        "╭━━━━━━━━━━━━━━━━━━━━╮",
        "       🃏 BLACKJACK",
        "╰━━━━━━━━━━━━━━━━━━━━╯",
        "",
        "💀 DEALER WINS",
        "",
        blackjackStateText(
          session.playerHand,
          session.dealerHand,
          true
        ),
        "",
        `💸 Lost: ${money(session.bet)}`,
        "",
        "✦ Better luck next hand."
      ].join("\n")
    );
  }

  return true;
}

// ============================================================
// 8-BALL
// ============================================================

async function handle8Ball(api, event, text) {
  const threadID = String(event.threadID);
  const question = text
    .replace(/^!8ball\s*/i, "")
    .trim();

  if (!question) {
    await safeReply(
      api,
      event,
      "🎱 Ask something.\nExample: !8ball will I win?"
    );
    return;
  }

  clearSession(
    threadID,
    String(event.senderID)
  );

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
    "My sources say no.",
    "Very doubtful.",
    "Absolutely not."
  ];

  let hash = 0;

  for (let i = 0; i < question.length; i++) {
    hash =
      (hash * 31 + question.charCodeAt(i)) |
      0;
  }

  const answer =
    answers[Math.abs(hash) % answers.length];

  const animator = await createAnimator(
    api,
    threadID,
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🎱 8-BALL",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🔮 THE QUESTION",
      "",
      `"${question}"`,
      "",
      "🎱",
      "",
      "The magic 8-ball is thinking...",
      "⏳ Please wait."
    ].join("\n")
  );

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
      "🎱",
      "     ↻",
      "    ↻",
      "   ↻",
      "",
      "The answer is forming..."
    ].join("\n")
  );

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
      "🎱",
      "",
      "████████████████",
      "",
      "⚡ REVEALING..."
    ].join("\n")
  );

  await animator.final(
    [
      "╭━━━━━━━━━━━━━━━━━━━━╮",
      "        🎱 8-BALL",
      "╰━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "🔮 THE QUESTION",
      "",
      `"${question}"`,
      "",
      "🎱 ANSWER",
      "",
      `「 ${answer} 」`,
      "",
      "✦ Fate has spoken."
    ].join("\n")
  );
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
  if (!event || !event.threadID || !event.senderID) {
    return false;
  }

  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  const cleanText = String(
    text || originalText || ""
  ).trim();

  const lower = cleanText.toLowerCase();

  // ----------------------------------------------------------
  // GAME TOGGLE ALWAYS WORKS
  // ----------------------------------------------------------

  if (
    lower === "!game on" ||
    lower === "!game off" ||
    lower === "!games on" ||
    lower === "!games off"
  ) {
    return await handleGameToggle(
      api,
      event,
      cleanText
    );
  }

  // ----------------------------------------------------------
  // GAME MENU ALWAYS WORKS
  // ----------------------------------------------------------

  if (lower === "!games") {
    await handleGamesMenu(api, event);
    return true;
  }

  // ----------------------------------------------------------
  // DETERMINE WHETHER GAMES ARE ENABLED
  // ----------------------------------------------------------

  const enabled = await gamesAreEnabled(threadID);

  if (!enabled) {
    return false;
  }

  // ----------------------------------------------------------
  // CURRENT SESSION
  // ----------------------------------------------------------

  const session = getSession(
    threadID,
    userID
  );

  // Trivia answer
  if (
    session &&
    session.type === "trivia" &&
    /^[ABCD]$/i.test(cleanText)
  ) {
    return await resolveTrivia(
      api,
      event,
      cleanText
    );
  }

  // Blackjack hit
  if (
    session &&
    session.type === "blackjack" &&
    lower === "!hit"
  ) {
    return await handleBlackjackHit(
      api,
      event
    );
  }

  // Blackjack stand
  if (
    session &&
    session.type === "blackjack" &&
    lower === "!stand"
  ) {
    return await handleBlackjackStand(
      api,
      event
    );
  }

  // ----------------------------------------------------------
  // COMMAND PARSING
  // ----------------------------------------------------------

  const parts = cleanText.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  // ----------------------------------------------------------
  // TRIVIA
  // ----------------------------------------------------------

  if (command === "!trivia") {
    await handleTrivia(api, event);
    return true;
  }

  // ----------------------------------------------------------
  // RPS
  // ----------------------------------------------------------

  if (
    command === "!rps" ||
    command === "!rockpaperscissors"
  ) {
    await handleRPS(api, event, args);
    return true;
  }

  // ----------------------------------------------------------
  // ROLL
  // ----------------------------------------------------------

  if (
    command === "!roll" ||
    command === "!dice"
  ) {
    await handleRoll(api, event, args);
    return true;
  }

  // ----------------------------------------------------------
  // GUESS
  // ----------------------------------------------------------

  if (command === "!guess") {
    await handleGuess(api, event, args);
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
    await handleSlots(api, event, args);
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
      event,
      args
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
