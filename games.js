/**
 * games.js
 * =========
 * Messenger Mini-Games
 *
 * Requires:
 *   ./db.js
 *   ./util.js
 *   ./trivia-questions.js
 *
 * Called from index.js:
 *
 *   await handleGamesCommand(api, event, text, originalText)
 *
 * Returns true when the message was handled.
 */

const db = require('./db');
const { reply } = require('./util');
const TRIVIA_QUESTIONS = require('./trivia-questions');

// ============================================================
// CONFIG
// ============================================================

const SESSION_TIMEOUT_MS = 30_000;

const ANIMATION = {
  fast: 450,
  normal: 650,
  slow: 850
};

// ============================================================
// HELPERS
// ============================================================

function randInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function money(amount) {
  return Number(amount || 0).toLocaleString();
}

async function send(api, threadID, text) {
  await reply(api, threadID, text);
}

async function getBalance(threadID, senderID) {
  const user = await db.getUser(
    threadID,
    senderID
  );

  return user.balance;
}

async function canAfford(threadID, senderID, amount) {
  const balance = await getBalance(
    threadID,
    senderID
  );

  return balance >= amount;
}

// ============================================================
// SESSION SYSTEM
// ============================================================

const sessions = new Map();
const sessionTimers = new Map();

function sessionKey(threadID, senderID) {
  return `${threadID}:${senderID}`;
}

function setSession(threadID, senderID, data) {
  const key = sessionKey(
    threadID,
    senderID
  );

  // Clear previous timeout.
  const oldTimer = sessionTimers.get(key);

  if (oldTimer) {
    clearTimeout(oldTimer);
  }

  sessions.set(key, data);

  const timer = setTimeout(() => {
    const current = sessions.get(key);

    if (current === data) {
      sessions.delete(key);
      sessionTimers.delete(key);
    }
  }, SESSION_TIMEOUT_MS);

  sessionTimers.set(key, timer);
}

function getSession(threadID, senderID) {
  return sessions.get(
    sessionKey(threadID, senderID)
  );
}

function clearSession(threadID, senderID) {
  const key = sessionKey(
    threadID,
    senderID
  );

  const timer = sessionTimers.get(key);

  if (timer) {
    clearTimeout(timer);
  }

  sessionTimers.delete(key);
  sessions.delete(key);
}

function clearThreadSessions(threadID) {
  const prefix = `${threadID}:`;

  for (const key of sessions.keys()) {
    if (key.startsWith(prefix)) {
      const timer = sessionTimers.get(key);

      if (timer) {
        clearTimeout(timer);
      }

      sessionTimers.delete(key);
      sessions.delete(key);
    }
  }
}

// ============================================================
// GAME ENABLE / DISABLE
// ============================================================

async function handleGameToggle(api, event, cleanText) {
  const { threadID, senderID } = event;

  if (
    cleanText === '!game on' ||
    cleanText === '!games on'
  ) {
    await db.setGameEnabled(
      String(threadID),
      true
    );

    await send(
      api,
      threadID,
      '╭━━━ 🎮 GAMES ━━━╮\n' +
      '┃\n' +
      '┃ 🟢 GAME CENTER\n' +
      '┃\n' +
      '┃ Games are now ENABLED.\n' +
      '┃ Type !games to see the menu.\n' +
      '┃\n' +
      '╰━━━━━━━━━━━━━━╯'
    );

    return true;
  }

  if (
    cleanText === '!game off' ||
    cleanText === '!games off'
  ) {
    await db.setGameEnabled(
      String(threadID),
      false
    );

    clearThreadSessions(threadID);

    await send(
      api,
      threadID,
      '╭━━━ 🎮 GAMES ━━━╮\n' +
      '┃\n' +
      '┃ 🔴 GAME CENTER\n' +
      '┃\n' +
      '┃ Games are now DISABLED.\n' +
      '┃ Active games have been cancelled.\n' +
      '┃\n' +
      '╰━━━━━━━━━━━━━━╯'
    );

    return true;
  }

  return false;
}

async function gamesAreEnabled(threadID) {
  return await db.isGameEnabled(
    String(threadID)
  );
}

// ============================================================
// TRIVIA
// ============================================================

async function handleTrivia(api, event) {
  const {
    threadID,
    senderID
  } = event;

  if (
    !Array.isArray(TRIVIA_QUESTIONS) ||
    TRIVIA_QUESTIONS.length === 0
  ) {
    await send(
      api,
      threadID,
      '❌ Trivia question bank is empty.'
    );

    return;
  }

  const qdata =
    TRIVIA_QUESTIONS[
      randInt(
        0,
        TRIVIA_QUESTIONS.length - 1
      )
    ];

  if (
    !qdata ||
    typeof qdata.q !== 'string' ||
    !Array.isArray(qdata.options) ||
    qdata.options.length !== 4 ||
    !Number.isInteger(qdata.answer) ||
    qdata.answer < 0 ||
    qdata.answer > 3 ||
    !Number.isFinite(qdata.reward)
  ) {
    await send(
      api,
      threadID,
      '❌ This trivia question is formatted incorrectly.'
    );

    return;
  }

  const labels = [
    'A',
    'B',
    'C',
    'D'
  ];

  setSession(
    threadID,
    senderID,
    {
      type: 'trivia',
      qdata
    }
  );

  const options = qdata.options
    .map(
      (option, i) =>
        `┃ ${labels[i]}  ${option}`
    )
    .join('\n');

  await send(
    api,
    threadID,
    '╭━━━ 🧠 TRIVIA ━━━╮\n' +
    '┃\n' +
    `┃ ${qdata.q}\n` +
    '┃\n' +
    `${options}\n` +
    '┃\n' +
    `┃ 💰 Reward: ${money(qdata.reward)} coins\n` +
    '┃ ⏱️ Answer within 30 seconds\n' +
    '┃ Reply: A / B / C / D\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━━━╯'
  );
}

async function resolveTrivia(
  api,
  event,
  session,
  answer
) {
  const {
    threadID,
    senderID
  } = event;

  clearSession(
    threadID,
    senderID
  );

  const labels = [
    'A',
    'B',
    'C',
    'D'
  ];

  const chosen =
    labels.indexOf(
      String(answer).toUpperCase()
    );

  if (chosen === -1) {
    return;
  }

  const { qdata } = session;

  if (chosen === qdata.answer) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        qdata.reward
      );

    await send(
      api,
      threadID,
      '╭━━━ 🧠 TRIVIA ━━━╮\n' +
      '┃\n' +
      '┃ ✅ CORRECT ANSWER!\n' +
      '┃\n' +
      `┃ You chose: ${labels[chosen]}\n` +
      `┃ ${qdata.options[chosen]}\n` +
      '┃\n' +
      `┃ 💰 +${money(qdata.reward)} coins\n` +
      `┃ 💵 Balance: ${money(newBal)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━╯'
    );
  } else {
    await send(
      api,
      threadID,
      '╭━━━ 🧠 TRIVIA ━━━╮\n' +
      '┃\n' +
      '┃ ❌ WRONG ANSWER\n' +
      '┃\n' +
      `┃ Your answer: ${labels[chosen]}\n` +
      `┃ Correct: ${labels[qdata.answer]}\n` +
      `┃ ${qdata.options[qdata.answer]}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━╯'
    );
  }
}

// ============================================================
// RPS
// ============================================================

async function handleRps(api, event, args) {
  const {
    threadID,
    senderID
  } = event;

  const choice =
    String(args[0] || '')
      .toLowerCase();

  const bet =
    args[1] === undefined
      ? 0
      : parseInt(args[1], 10);

  const choices = [
    'rock',
    'paper',
    'scissors'
  ];

  const emojis = {
    rock: '🪨',
    paper: '📄',
    scissors: '✂️'
  };

  if (!choices.includes(choice)) {
    await send(
      api,
      threadID,
      '⚔️ RPS\n\n' +
      'Usage:\n' +
      '!rps rock [bet]\n' +
      '!rps paper [bet]\n' +
      '!rps scissors [bet]'
    );

    return;
  }

  if (!Number.isInteger(bet) || bet < 0) {
    await send(
      api,
      threadID,
      '❌ Invalid bet.'
    );

    return;
  }

  if (bet > 0) {
    if (
      !(await canAfford(
        threadID,
        senderID,
        bet
      ))
    ) {
      const balance =
        await getBalance(
          threadID,
          senderID
        );

      await send(
        api,
        threadID,
        `💸 You only have ${money(balance)} coins.`
      );

      return;
    }

    await db.addBalance(
      threadID,
      senderID,
      -bet
    );
  }

  await send(
    api,
    threadID,
    '╭━━━ ⚔️ RPS ━━━╮\n' +
    '┃\n' +
    '┃ You chose ' +
    `${emojis[choice]}\n` +
    '┃\n' +
    '┃ 🤖 Bot is choosing...\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━╯'
  );

  await sleep(
    ANIMATION.normal
  );

  const botChoice =
    choices[
      randInt(0, 2)
    ];

  let result;

  if (choice === botChoice) {
    result = 'tie';
  } else if (
    (choice === 'rock' &&
      botChoice === 'scissors') ||
    (choice === 'paper' &&
      botChoice === 'rock') ||
    (choice === 'scissors' &&
      botChoice === 'paper')
  ) {
    result = 'win';
  } else {
    result = 'loss';
  }

  let resultText;

  if (bet > 0) {
    if (result === 'win') {
      const newBal =
        await db.addBalance(
          threadID,
          senderID,
          bet * 2
        );

      resultText =
        `🎉 WIN!\n` +
        `💰 +${money(bet)} coins\n` +
        `💵 Balance: ${money(newBal)}`;
    } else if (result === 'tie') {
      const newBal =
        await db.addBalance(
          threadID,
          senderID,
          bet
        );

      resultText =
        `👔 TIE!\n` +
        `💰 Bet returned\n` +
        `💵 Balance: ${money(newBal)}`;
    } else {
      const balance =
        await getBalance(
          threadID,
          senderID
        );

      resultText =
        `❌ LOSS!\n` +
        `💸 -${money(bet)} coins\n` +
        `💵 Balance: ${money(balance)}`;
    }
  } else {
    resultText =
      result === 'win'
        ? '🎉 YOU WIN!'
        : result === 'tie'
          ? '👔 TIE!'
          : '❌ YOU LOSE!';
  }

  if (result !== 'tie') {
    await db.incrementGameStats(
      threadID,
      senderID,
      result === 'win'
    );
  }

  await send(
    api,
    threadID,
    '╭━━━ ⚔️ RPS ━━━╮\n' +
    '┃\n' +
    `┃ YOU   ${emojis[choice]} ${choice}\n` +
    `┃ BOT   ${emojis[botChoice]} ${botChoice}\n` +
    '┃\n' +
    `┃ ${resultText.replace(/\n/g, '\n┃ ')}\n` +
    '┃\n' +
    '╰━━━━━━━━━━━━╯'
  );
}

// ============================================================
// DICE / ROLL
// ============================================================

async function handleRoll(api, event, args) {
  const {
    threadID,
    senderID
  } = event;

  let sides = 100;
  let bet;

  if (args.length >= 2) {
    sides =
      parseInt(args[0], 10);

    bet =
      parseInt(args[1], 10);
  } else {
    bet =
      parseInt(args[0], 10);
  }

  if (
    !Number.isInteger(sides) ||
    sides < 2
  ) {
    await send(
      api,
      threadID,
      '❌ Sides must be at least 2.'
    );

    return;
  }

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await send(
      api,
      threadID,
      '❌ Usage:\n' +
      '!roll <bet>\n' +
      '!roll <sides> <bet>'
    );

    return;
  }

  if (
    !(await canAfford(
      threadID,
      senderID,
      bet
    ))
  ) {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await send(
      api,
      threadID,
      `💸 You only have ${money(balance)} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  await send(
    api,
    threadID,
    '╭━━━ 🎲 DICE ━━━╮\n' +
    '┃\n' +
    '┃ 🎲 Rolling...\n' +
    '┃\n' +
    '┃      [?]\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━╯'
  );

  await sleep(
    ANIMATION.fast
  );

  const rollVal =
    randInt(1, sides);

  const win =
    rollVal >=
    Math.floor(sides * 0.55);

  await send(
    api,
    threadID,
    '╭━━━ 🎲 DICE ━━━╮\n' +
    '┃\n' +
    `┃      [ ${rollVal} ]\n` +
    '┃\n' +
    (win
      ? '┃ 🎉 HIGH ROLL!\n'
      : '┃ 💀 LOW ROLL!\n') +
    '┃\n' +
    '╰━━━━━━━━━━━━╯'
  );

  let finalText;

  if (win) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        bet * 2
      );

    finalText =
      `🎉 YOU WIN!\n` +
      `💰 +${money(bet)} coins\n` +
      `💵 Balance: ${money(newBal)}`;
  } else {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    finalText =
      `❌ YOU LOSE!\n` +
      `💸 -${money(bet)} coins\n` +
      `💵 Balance: ${money(balance)}`;
  }

  await db.incrementGameStats(
    threadID,
    senderID,
    win
  );

  await send(
    api,
    threadID,
    `🎲 ${rollVal}/${sides}\n\n${finalText}`
  );
}

// ============================================================
// GUESS
// ============================================================

async function handleGuess(api, event, args) {
  const {
    threadID,
    senderID
  } = event;

  const number =
    parseInt(args[0], 10);

  const bet =
    args[1] === undefined
      ? 100
      : parseInt(args[1], 10);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 10
  ) {
    await send(
      api,
      threadID,
      '🎯 GUESS\n\n' +
      'Usage:\n' +
      '!guess <1-10> [bet]'
    );

    return;
  }

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await send(
      api,
      threadID,
      '❌ Bet must be positive.'
    );

    return;
  }

  if (
    !(await canAfford(
      threadID,
      senderID,
      bet
    ))
  ) {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await send(
      api,
      threadID,
      `💸 You only have ${money(balance)} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const secret =
    randInt(1, 10);

  await send(
    api,
    threadID,
    '╭━━━ 🎯 GUESS ━━━╮\n' +
    '┃\n' +
    `┃ Your guess: [ ${number} ]\n` +
    '┃\n' +
    '┃ 🔐 Checking the number...\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━━━╯'
  );

  await sleep(
    ANIMATION.slow
  );

  const win =
    number === secret;

  if (win) {
    const winnings =
      bet * 5;

    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        winnings
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      true
    );

    await send(
      api,
      threadID,
      '╭━━━ 🎯 GUESS ━━━╮\n' +
      '┃\n' +
      `┃ 🔐 Number: [ ${secret} ]\n` +
      '┃\n' +
      '┃ 🎯 EXACT MATCH!\n' +
      '┃\n' +
      `┃ 💰 +${money(winnings)} coins\n` +
      `┃ 💵 Balance: ${money(newBal)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━╯'
    );
  } else {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      false
    );

    await send(
      api,
      threadID,
      '╭━━━ 🎯 GUESS ━━━╮\n' +
      '┃\n' +
      `┃ 🔐 Number: [ ${secret} ]\n` +
      '┃\n' +
      '┃ ❌ WRONG GUESS\n' +
      '┃\n' +
      `┃ You chose: ${number}\n` +
      `┃ 💸 -${money(bet)} coins\n` +
      `┃ 💵 Balance: ${money(balance)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━╯'
    );
  }
}

// ============================================================
// COINFLIP
// ============================================================

async function handleCoinflip(api, event, args) {
  const {
    threadID,
    senderID
  } = event;

  let bet;
  let choice;

  if (
    /^\d+$/.test(
      args[0] || ''
    )
  ) {
    bet =
      parseInt(args[0], 10);

    choice =
      String(args[1] || '')
        .toLowerCase();
  } else if (
    /^\d+$/.test(
      args[1] || ''
    )
  ) {
    bet =
      parseInt(args[1], 10);

    choice =
      String(args[0] || '')
        .toLowerCase();
  } else {
    await send(
      api,
      threadID,
      '🪙 COINFLIP\n\n' +
      'Usage:\n' +
      '!coinflip <bet> <heads/tails>'
    );

    return;
  }

  if (
    ![
      'heads',
      'tails',
      'h',
      't'
    ].includes(choice)
  ) {
    await send(
      api,
      threadID,
      '❌ Choose heads or tails.'
    );

    return;
  }

  choice =
    choice.startsWith('h')
      ? 'heads'
      : 'tails';

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await send(
      api,
      threadID,
      '❌ Bet must be positive.'
    );

    return;
  }

  if (
    !(await canAfford(
      threadID,
      senderID,
      bet
    ))
  ) {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await send(
      api,
      threadID,
      `💸 You only have ${money(balance)} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  await send(
    api,
    threadID,
    '╭━━━ 🪙 COINFLIP ━━━╮\n' +
    '┃\n' +
    `┃ Your call: ${choice.toUpperCase()}\n` +
    '┃\n' +
    '┃        🪙\n' +
    '┃     FLIPPING...\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━━━━━╯'
  );

  await sleep(
    ANIMATION.slow
  );

  const outcome =
    Math.random() < 0.5
      ? 'heads'
      : 'tails';

  const win =
    outcome === choice;

  if (win) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        bet * 2
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      true
    );

    await send(
      api,
      threadID,
      '╭━━━ 🪙 COINFLIP ━━━╮\n' +
      '┃\n' +
      `┃       🪙 ${outcome.toUpperCase()}\n` +
      '┃\n' +
      '┃ 🎉 YOU WIN!\n' +
      `┃ 💰 +${money(bet)} coins\n` +
      `┃ 💵 Balance: ${money(newBal)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━━━╯'
    );
  } else {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      false
    );

    await send(
      api,
      threadID,
      '╭━━━ 🪙 COINFLIP ━━━╮\n' +
      '┃\n' +
      `┃       🪙 ${outcome.toUpperCase()}\n` +
      '┃\n' +
      '┃ ❌ YOU LOSE!\n' +
      `┃ 💸 -${money(bet)} coins\n` +
      `┃ 💵 Balance: ${money(balance)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━━━╯'
    );
  }
}

// ============================================================
// SLOTS
// ============================================================

const SLOT_SYMBOLS = [
  '🍋',
  '🍒',
  '🍇',
  '🔔',
  '💎',
  '7️⃣'
];

function randomSlot() {
  return SLOT_SYMBOLS[
    randInt(
      0,
      SLOT_SYMBOLS.length - 1
    )
  ];
}

function slotLine(a, b, c) {
  return `🎰 │ ${a} │ ${b} │ ${c} │`;
}

async function handleSlots(api, event, args) {
  const {
    threadID,
    senderID
  } = event;

  const bet =
    parseInt(args[0], 10);

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await send(
      api,
      threadID,
      '🎰 SLOTS\n\n' +
      'Usage:\n' +
      '!slots <bet>'
    );

    return;
  }

  if (
    !(await canAfford(
      threadID,
      senderID,
      bet
    ))
  ) {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await send(
      api,
      threadID,
      `💸 You only have ${money(balance)} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  // ----------------------------------------------------------
  // SPIN 1
  // ----------------------------------------------------------

  await send(
    api,
    threadID,
    '╭━━━━━━━━━━━━━━╮\n' +
    '┃     🎰 SLOTS     ┃\n' +
    '┣━━━━━━━━━━━━━━┫\n' +
    `┃ ${slotLine('❔', '❔', '❔')}\n` +
    '┣━━━━━━━━━━━━━━┫\n' +
    `┃ 💰 Bet: ${money(bet)}\n` +
    '┃ 🎰 SPINNING...\n' +
    '╰━━━━━━━━━━━━━━╯'
  );

  await sleep(
    ANIMATION.fast
  );

  // ----------------------------------------------------------
  // SPIN 2
  // ----------------------------------------------------------

  await send(
    api,
    threadID,
    '╭━━━━━━━━━━━━━━╮\n' +
    '┃     🎰 SLOTS     ┃\n' +
    '┣━━━━━━━━━━━━━━┫\n' +
    `┃ ${slotLine(randomSlot(), randomSlot(), randomSlot())}\n` +
    '┣━━━━━━━━━━━━━━┫\n' +
    '┃ 🔄 REEL 1... REEL 2...\n' +
    '╰━━━━━━━━━━━━━━╯'
  );

  await sleep(
    ANIMATION.fast
  );

  // ----------------------------------------------------------
  // FINAL RESULT
  // ----------------------------------------------------------

  const r1 = randomSlot();
  const r2 = randomSlot();
  const r3 = randomSlot();

  await send(
    api,
    threadID,
    '╭━━━━━━━━━━━━━━╮\n' +
    '┃     🎰 SLOTS     ┃\n' +
    '┣━━━━━━━━━━━━━━┫\n' +
    `┃ ${slotLine(r1, r2, r3)}\n` +
    '┣━━━━━━━━━━━━━━┫\n' +
    '┃       RESULT\n' +
    '╰━━━━━━━━━━━━━━╯'
  );

  await sleep(
    ANIMATION.fast
  );

  let won = false;

  if (
    r1 === r2 &&
    r2 === r3
  ) {
    won = true;

    const multiplier =
      r1 === '💎' ||
      r1 === '7️⃣'
        ? 5
        : 3;

    const winnings =
      bet * multiplier;

    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        winnings
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      true
    );

    await send(
      api,
      threadID,
      '╭━━━━━━━━━━━━━━╮\n' +
      '┃   🎰 JACKPOT!   ┃\n' +
      '┣━━━━━━━━━━━━━━┫\n' +
      `┃ ${slotLine(r1, r2, r3)}\n` +
      '┣━━━━━━━━━━━━━━┫\n' +
      '┃ 💎 THREE OF A KIND!\n' +
      `┃ 🔥 ${multiplier}× PAYOUT\n` +
      `┃ 💰 +${money(winnings)} coins\n` +
      `┃ 💵 Balance: ${money(newBal)}\n` +
      '╰━━━━━━━━━━━━━━╯'
    );
  } else if (
    r1 === r2 ||
    r2 === r3 ||
    r1 === r3
  ) {
    won = true;

    const winnings =
      Math.floor(
        bet * 1.5
      );

    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        winnings
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      true
    );

    await send(
      api,
      threadID,
      '╭━━━━━━━━━━━━━━╮\n' +
      '┃    🎰 SMALL WIN   ┃\n' +
      '┣━━━━━━━━━━━━━━┫\n' +
      `┃ ${slotLine(r1, r2, r3)}\n` +
      '┣━━━━━━━━━━━━━━┫\n' +
      '┃ ✨ TWO MATCHED!\n' +
      '┃ 💰 1.5× PAYOUT\n' +
      `┃ 💵 Balance: ${money(newBal)}\n` +
      '╰━━━━━━━━━━━━━━╯'
    );
  } else {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      false
    );

    await send(
      api,
      threadID,
      '╭━━━━━━━━━━━━━━╮\n' +
      '┃      🎰 SLOTS    ┃\n' +
      '┣━━━━━━━━━━━━━━┫\n' +
      `┃ ${slotLine(r1, r2, r3)}\n` +
      '┣━━━━━━━━━━━━━━┫\n' +
      '┃ ❌ NO MATCH\n' +
      `┃ 💸 -${money(bet)} coins\n` +
      `┃ 💵 Balance: ${money(balance)}\n` +
      '╰━━━━━━━━━━━━━━╯'
    );
  }
}

// ============================================================
// BLACKJACK
// ============================================================

const SUITS = [
  '♠️',
  '♥️',
  '♦️',
  '♣️'
];

const RANKS = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A'
];

function freshDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push([
        rank,
        suit
      ]);
    }
  }

  for (
    let i = deck.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() * (i + 1)
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

function calcScore(hand) {
  let score = 0;
  let aces = 0;

  for (const [rank] of hand) {
    if (
      ['J', 'Q', 'K']
        .includes(rank)
    ) {
      score += 10;
    } else if (rank === 'A') {
      aces++;
      score += 11;
    } else {
      score += parseInt(
        rank,
        10
      );
    }
  }

  while (
    score > 21 &&
    aces > 0
  ) {
    score -= 10;
    aces--;
  }

  return score;
}

function renderHand(
  hand,
  hideDealer = false
) {
  if (
    !hand ||
    hand.length === 0
  ) {
    return '—';
  }

  if (hideDealer) {
    return (
      `${hand[0][0]}${hand[0][1]}  🂠`
    );
  }

  return hand
    .map(
      ([rank, suit]) =>
        `${rank}${suit}`
    )
    .join('  ');
}

async function handleBlackjack(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  const bet =
    parseInt(args[0], 10);

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await send(
      api,
      threadID,
      '🃏 BLACKJACK\n\n' +
      'Usage:\n' +
      '!blackjack <bet>'
    );

    return;
  }

  if (
    !(await canAfford(
      threadID,
      senderID,
      bet
    ))
  ) {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await send(
      api,
      threadID,
      `💸 You only have ${money(balance)} coins.`
    );

    return;
  }

  // Cancel an old game before starting another.
  clearSession(
    threadID,
    senderID
  );

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const deck =
    freshDeck();

  const playerHand = [
    deck.pop(),
    deck.pop()
  ];

  const dealerHand = [
    deck.pop(),
    deck.pop()
  ];

  const playerScore =
    calcScore(playerHand);

  // ----------------------------------------------------------
  // NATURAL BLACKJACK
  // ----------------------------------------------------------

  if (playerScore === 21) {
    const winnings =
      Math.floor(
        bet * 2.5
      );

    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        winnings
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      true
    );

    await send(
      api,
      threadID,
      '╭━━━━ 🃏 BLACKJACK ━━━━╮\n' +
      '┃\n' +
      `┃ Dealer: ${renderHand(dealerHand)}\n` +
      `┃ You:    ${renderHand(playerHand)}\n` +
      '┃\n' +
      '┃ 💥 NATURAL BLACKJACK!\n' +
      `┃ 💰 +${money(winnings)} coins\n` +
      `┃ 💵 Balance: ${money(newBal)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━━━━━━━╯'
    );

    return;
  }

  const session = {
    type: 'blackjack',
    bet,
    deck,
    playerHand,
    dealerHand
  };

  setSession(
    threadID,
    senderID,
    session
  );

  await send(
    api,
    threadID,
    '╭━━━━ 🃏 BLACKJACK ━━━━╮\n' +
    '┃\n' +
    `┃ Dealer: ${renderHand(dealerHand, true)}\n` +
    `┃ You:    ${renderHand(playerHand)}\n` +
    `┃         (${playerScore})\n` +
    '┃\n' +
    `┃ 💰 Bet: ${money(bet)}\n` +
    '┃\n' +
    '┃ ➤ !hit   draw a card\n' +
    '┃ ➤ !stand end your turn\n' +
    '┃\n' +
    '┃ ⏱️ 30 seconds\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━━━━━━━━━╯'
  );
}

async function resolveBlackjackHit(
  api,
  event,
  session
) {
  const {
    threadID,
    senderID
  } = event;

  const {
    deck,
    playerHand,
    dealerHand,
    bet
  } = session;

  const nextCard =
    deck.pop();

  if (!nextCard) {
    clearSession(
      threadID,
      senderID
    );

    await send(
      api,
      threadID,
      '❌ Blackjack deck ran out.'
    );

    return;
  }

  playerHand.push(
    nextCard
  );

  const pScore =
    calcScore(playerHand);

  if (pScore > 21) {
    clearSession(
      threadID,
      senderID
    );

    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      false
    );

    await send(
      api,
      threadID,
      '╭━━━━ 🃏 BLACKJACK ━━━━╮\n' +
      '┃\n' +
      `┃ Dealer: ${renderHand(dealerHand)} (${calcScore(dealerHand)})\n` +
      `┃ You:    ${renderHand(playerHand)} (${pScore})\n` +
      '┃\n' +
      '┃ 💥 BUST!\n' +
      `┃ 💸 Lost ${money(bet)} coins\n` +
      `┃ 💵 Balance: ${money(balance)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━━━━━━━╯'
    );

    return;
  }

  // Refresh session and timer correctly.
  setSession(
    threadID,
    senderID,
    session
  );

  await send(
    api,
    threadID,
    '╭━━━━ 🃏 BLACKJACK ━━━━╮\n' +
    '┃\n' +
    `┃ Dealer: ${renderHand(dealerHand, true)}\n` +
    `┃ You:    ${renderHand(playerHand)}\n` +
    `┃         (${pScore})\n` +
    '┃\n' +
    '┃ ➤ !hit\n' +
    '┃ ➤ !stand\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━━━━━━━━━╯'
  );
}

async function resolveBlackjackStand(
  api,
  event,
  session
) {
  const {
    threadID,
    senderID
  } = event;

  const {
    deck,
    playerHand,
    dealerHand,
    bet
  } = session;

  clearSession(
    threadID,
    senderID
  );

  const pScore =
    calcScore(playerHand);

  let dScore =
    calcScore(dealerHand);

  await send(
    api,
    threadID,
    '🃏 Dealer reveals their hand...\n\n' +
    `Dealer: ${renderHand(dealerHand)}`
  );

  await sleep(
    ANIMATION.normal
  );

  while (
    dScore < 17 &&
    deck.length > 0
  ) {
    dealerHand.push(
      deck.pop()
    );

    dScore =
      calcScore(dealerHand);

    await send(
      api,
      threadID,
      `🃏 Dealer draws...\n\n` +
      `Dealer: ${renderHand(dealerHand)} (${dScore})`
    );

    await sleep(
      ANIMATION.fast
    );
  }

  let won = null;

  if (
    dScore > 21 ||
    pScore > dScore
  ) {
    won = true;

    const winnings =
      bet * 2;

    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        winnings
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      true
    );

    await send(
      api,
      threadID,
      '╭━━━━ 🃏 BLACKJACK ━━━━╮\n' +
      '┃\n' +
      `┃ Dealer: ${renderHand(dealerHand)} (${dScore})\n` +
      `┃ You:    ${renderHand(playerHand)} (${pScore})\n` +
      '┃\n' +
      '┃ 🎉 YOU WIN!\n' +
      `┃ 💰 +${money(bet)} coins\n` +
      `┃ 💵 Balance: ${money(newBal)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━━━━━━━╯'
    );
  } else if (
    pScore === dScore
  ) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        bet
      );

    await send(
      api,
      threadID,
      '╭━━━━ 🃏 BLACKJACK ━━━━╮\n' +
      '┃\n' +
      `┃ Dealer: ${renderHand(dealerHand)} (${dScore})\n` +
      `┃ You:    ${renderHand(playerHand)} (${pScore})\n` +
      '┃\n' +
      '┃ 👔 PUSH — TIE\n' +
      '┃ 💰 Bet returned\n' +
      `┃ 💵 Balance: ${money(newBal)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━━━━━━━╯'
    );
  } else {
    won = false;

    const balance =
      await getBalance(
        threadID,
        senderID
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      false
    );

    await send(
      api,
      threadID,
      '╭━━━━ 🃏 BLACKJACK ━━━━╮\n' +
      '┃\n' +
      `┃ Dealer: ${renderHand(dealerHand)} (${dScore})\n` +
      `┃ You:    ${renderHand(playerHand)} (${pScore})\n` +
      '┃\n' +
      '┃ ❌ DEALER WINS\n' +
      `┃ 💸 Lost ${money(bet)} coins\n` +
      `┃ 💵 Balance: ${money(balance)}\n` +
      '┃\n' +
      '╰━━━━━━━━━━━━━━━━━━━━╯'
    );
  }
}

// ============================================================
// 8-BALL
// ============================================================

const EIGHTBALL_RESPONSES = [
  '🟢 It is certain.',
  '🟢 Without a doubt.',
  '🟢 Yes, definitely.',
  '🟢 You may rely on it.',
  '🟢 As I see it, yes.',
  '🟡 Reply hazy, try again.',
  '🟡 Ask again later.',
  '🟡 Better not tell you now.',
  '🟡 Cannot predict now.',
  '🔴 Don\'t count on it.',
  '🔴 My reply is no.',
  '🔴 My sources say no.',
  '🔴 Very doubtful.'
];

async function handleEightball(
  api,
  event,
  question
) {
  const {
    threadID
  } = event;

  if (!question) {
    await send(
      api,
      threadID,
      '🎱 Usage:\n' +
      '!8ball <question>'
    );

    return;
  }

  await send(
    api,
    threadID,
    '╭━━━ 🎱 MAGIC 8-BALL ━━━╮\n' +
    '┃\n' +
    `┃ "${question}"\n` +
    '┃\n' +
    '┃ 🔮 Shaking the ball...\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━━━━━━━━━╯'
  );

  await sleep(
    ANIMATION.slow
  );

  let seed = 0;

  for (
    const character
    of question.toLowerCase()
  ) {
    seed +=
      character.charCodeAt(0);
  }

  const answer =
    EIGHTBALL_RESPONSES[
      seed %
      EIGHTBALL_RESPONSES.length
    ];

  await send(
    api,
    threadID,
    '╭━━━ 🎱 MAGIC 8-BALL ━━━╮\n' +
    '┃\n' +
    '┃        🎱\n' +
    '┃\n' +
    `┃ ${answer}\n` +
    '┃\n' +
    '╰━━━━━━━━━━━━━━━━━━━━╯'
  );
}

// ============================================================
// GAMES MENU
// ============================================================

async function handleGamesList(
  api,
  event
) {
  const enabled =
    await gamesAreEnabled(
      event.threadID
    );

  const status =
    enabled
      ? '🟢 ONLINE'
      : '🔴 OFFLINE';

  await send(
    api,
    event.threadID,

    '╭━━━━━━ 🎮 GAME CENTER ━━━━━━╮\n' +
    '┃\n' +
    `┃ STATUS: ${status}\n` +
    '┃\n' +
    '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n' +
    '┃ 🧠 TRIVIA\n' +
    '┃ !trivia\n' +
    '┃ Answer A/B/C/D for coins.\n' +
    '┃\n' +
    '┃ ⚔️ RPS\n' +
    '┃ !rps rock 100\n' +
    '┃ Win = 2× bet\n' +
    '┃\n' +
    '┃ 🎲 DICE\n' +
    '┃ !roll 100\n' +
    '┃ !roll 100 100\n' +
    '┃ High roll = 2×\n' +
    '┃\n' +
    '┃ 🎯 GUESS\n' +
    '┃ !guess 7 100\n' +
    '┃ Exact match = 5×\n' +
    '┃\n' +
    '┃ 🪙 COINFLIP\n' +
    '┃ !coinflip 100 heads\n' +
    '┃ Win = 2× bet\n' +
    '┃\n' +
    '┃ 🎰 SLOTS\n' +
    '┃ !slots 100\n' +
    '┃ Pair = 1.5× • Jackpot = 3–5×\n' +
    '┃\n' +
    '┃ 🃏 BLACKJACK\n' +
    '┃ !blackjack 100\n' +
    '┃ Then !hit / !stand\n' +
    '┃ Beat dealer = 2×\n' +
    '┃\n' +
    '┃ 🎱 8-BALL\n' +
    '┃ !8ball <question>\n' +
    '┃ Ask the magic 8-ball.\n' +
    '┃\n' +
    '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n' +
    '┃ ⚙️ !game on\n' +
    '┃ ⚙️ !game off\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━╯'
  );
}

// ============================================================
// ROUTER
// ============================================================

async function handleGamesCommand(
  api,
  event,
  text,
  originalText
) {
  const {
    threadID,
    senderID
  } = event;

  const cleanText =
    String(text || '')
      .trim()
      .toLowerCase();

  const original =
    String(
      originalText ||
      text ||
      ''
    ).trim();

  // ----------------------------------------------------------
  // GAME ON/OFF MUST WORK EVEN WHEN GAMES ARE OFF
  // ----------------------------------------------------------

  if (
    await handleGameToggle(
      api,
      event,
      cleanText
    )
  ) {
    return true;
  }

  // ----------------------------------------------------------
  // GAME MENU CAN ALWAYS BE VIEWED
  // ----------------------------------------------------------

  if (cleanText === '!games') {
    await handleGamesList(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // EVERYTHING ELSE REQUIRES GAMES TO BE ON
  // ----------------------------------------------------------

  const enabled =
    await gamesAreEnabled(
      threadID
    );

  if (!enabled) {
    return false;
  }

  // ----------------------------------------------------------
  // PARSE COMMAND
  // ----------------------------------------------------------

  const args =
    original
      .split(/\s+/)
      .slice(1);

  // ----------------------------------------------------------
  // ACTIVE SESSION
  // ----------------------------------------------------------

  const session =
    getSession(
      threadID,
      senderID
    );

  if (session) {

    // Trivia
    if (
      session.type === 'trivia' &&
      /^[abcd]$/i.test(cleanText)
    ) {
      await resolveTrivia(
        api,
        event,
        session,
        cleanText
      );

      return true;
    }

    // Blackjack hit
    if (
      session.type === 'blackjack' &&
      cleanText === '!hit'
    ) {
      await resolveBlackjackHit(
        api,
        event,
        session
      );

      return true;
    }

    // Blackjack stand
    if (
      session.type === 'blackjack' &&
      cleanText === '!stand'
    ) {
      await resolveBlackjackStand(
        api,
        event,
        session
      );

      return true;
    }
  }

  // ----------------------------------------------------------
  // TRIVIA
  // ----------------------------------------------------------

  if (cleanText === '!trivia') {
    await handleTrivia(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // RPS
  // ----------------------------------------------------------

  if (
    cleanText === '!rps' ||
    cleanText.startsWith('!rps ')
  ) {
    await handleRps(
      api,
      event,
      args
    );

    return true;
  }

  // ----------------------------------------------------------
  // ROLL / DICE
  // ----------------------------------------------------------

  if (
    cleanText === '!roll' ||
    cleanText.startsWith('!roll ') ||
    cleanText === '!dice' ||
    cleanText.startsWith('!dice ')
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
    cleanText === '!guess' ||
    cleanText.startsWith('!guess ')
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
    cleanText === '!coinflip' ||
    cleanText.startsWith('!coinflip ') ||
    cleanText === '!cf' ||
    cleanText.startsWith('!cf ')
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
    cleanText === '!slots' ||
    cleanText.startsWith('!slots ')
  ) {
    await handleSlots(
      api,
      event,
      args
    );

    return true;
  }

  // ----------------------------------------------------------
  // BLACKJACK
  // ----------------------------------------------------------

  if (
    cleanText === '!blackjack' ||
    cleanText.startsWith('!blackjack ') ||
    cleanText === '!bj' ||
    cleanText.startsWith('!bj ')
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
    cleanText === '!8ball' ||
    cleanText.startsWith('!8ball ')
  ) {
    const question =
      original
        .slice(
          '!8ball'.length
        )
        .trim();

    await handleEightball(
      api,
      event,
      question
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
