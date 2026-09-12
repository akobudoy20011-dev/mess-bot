/**
 * games.js
 * =========
 * Messenger Mini-Games
 *
 * Features:
 * - Single-message animations using api.editMessage()
 * - Aesthetic game UI
 * - Persistent !game on/off
 * - Persistent game sessions
 * - Trivia / RPS / Dice / Guess / Coinflip / Slots /
 *   Blackjack / 8-Ball
 *
 * Requires:
 *   ./db.js
 *   ./util.js
 *   ./trivia-questions.js
 */

const db = require('./db');
const { reply } = require('./util');
const TRIVIA_QUESTIONS = require('./trivia-questions');

// ============================================================
// CONFIG
// ============================================================

const SESSION_TIMEOUT_MS = 30_000;

const ANIMATION = {
  veryFast: 250,
  fast: 400,
  normal: 600,
  slow: 800
};

// ============================================================
// BASIC HELPERS
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

/**
 * Direct Messenger send.
 *
 * Unlike util.reply(), this keeps the returned messageInfo
 * because we need messageID for editing animations.
 */
function sendMessageAsync(api, threadID, text) {
  return new Promise((resolve, reject) => {
    try {
      api.sendMessage(
        text,
        threadID,
        (error, messageInfo) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(messageInfo);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Edit an existing bot message.
 */
function editMessageAsync(api, text, messageID) {
  return new Promise((resolve, reject) => {
    try {
      if (
        !messageID ||
        typeof api.editMessage !== 'function'
      ) {
        reject(
          new Error(
            'Message editing is unavailable.'
          )
        );

        return;
      }

      api.editMessage(
        text,
        messageID,
        error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Extract message ID from different FCA/ws3-fca formats.
 */
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

/**
 * Send the first frame and then edit that same message.
 *
 * If editing isn't available, only the FIRST frame and FINAL
 * frame are sent instead of spamming every animation frame.
 */
async function animate(
  api,
  threadID,
  frames,
  delays = []
) {
  if (
    !Array.isArray(frames) ||
    frames.length === 0
  ) {
    return null;
  }

  let messageInfo;

  try {
    messageInfo =
      await sendMessageAsync(
        api,
        threadID,
        frames[0]
      );
  } catch (error) {
    console.error(
      '[games] initial animation send failed:',
      error
    );

    return null;
  }

  const messageID =
    getMessageID(messageInfo);

  if (
    !messageID ||
    typeof api.editMessage !== 'function'
  ) {
    // Editing unavailable.
    // Do not spam all animation frames.
    if (frames.length > 1) {
      try {
        await sleep(
          delays[delays.length - 1] ||
          ANIMATION.normal
        );

        await sendMessageAsync(
          api,
          threadID,
          frames[frames.length - 1]
        );
      } catch (error) {
        console.error(
          '[games] animation fallback failed:',
          error
        );
      }
    }

    return messageID;
  }

  for (
    let i = 1;
    i < frames.length;
    i++
  ) {
    await sleep(
      delays[i - 1] ||
      ANIMATION.normal
    );

    try {
      await editMessageAsync(
        api,
        frames[i],
        messageID
      );
    } catch (error) {
      console.error(
        '[games] edit failed:',
        error
      );

      // Send only the final frame as fallback.
      try {
        await sendMessageAsync(
          api,
          threadID,
          frames[frames.length - 1]
        );
      } catch (fallbackError) {
        console.error(
          '[games] final fallback failed:',
          fallbackError
        );
      }

      break;
    }
  }

  return messageID;
}

async function getBalance(
  threadID,
  senderID
) {
  const user =
    await db.getUser(
      threadID,
      senderID
    );

  return user.balance;
}

async function canAfford(
  threadID,
  senderID,
  amount
) {
  const balance =
    await getBalance(
      threadID,
      senderID
    );

  return balance >= amount;
}

async function insufficientFunds(
  api,
  threadID,
  senderID
) {
  const balance =
    await getBalance(
      threadID,
      senderID
    );

  await send(
    api,
    threadID,
    `╭━━━ 💸 WALLET ━━━╮
┃
┃ Insufficient coins.
┃
┃ 💰 Balance: ${money(balance)}
┃
╰━━━━━━━━━━━━━━━━╯`
  );
}

// ============================================================
// SESSION SYSTEM
// ============================================================

const sessions = new Map();
const sessionTimers = new Map();

function sessionKey(
  threadID,
  senderID
) {
  return `${threadID}:${senderID}`;
}

function setSession(
  threadID,
  senderID,
  data
) {
  const key =
    sessionKey(
      threadID,
      senderID
    );

  const oldTimer =
    sessionTimers.get(key);

  if (oldTimer) {
    clearTimeout(oldTimer);
  }

  sessions.set(
    key,
    data
  );

  const timer =
    setTimeout(() => {
      const current =
        sessions.get(key);

      if (current === data) {
        sessions.delete(key);
        sessionTimers.delete(key);
      }
    }, SESSION_TIMEOUT_MS);

  sessionTimers.set(
    key,
    timer
  );
}

function getSession(
  threadID,
  senderID
) {
  return sessions.get(
    sessionKey(
      threadID,
      senderID
    )
  );
}

function clearSession(
  threadID,
  senderID
) {
  const key =
    sessionKey(
      threadID,
      senderID
    );

  const timer =
    sessionTimers.get(key);

  if (timer) {
    clearTimeout(timer);
  }

  sessionTimers.delete(key);
  sessions.delete(key);
}

function clearThreadSessions(
  threadID
) {
  const prefix =
    `${threadID}:`;

  for (
    const key of sessions.keys()
  ) {
    if (
      key.startsWith(prefix)
    ) {
      const timer =
        sessionTimers.get(key);

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

async function handleGameToggle(
  api,
  event,
  cleanText
) {
  const {
    threadID
  } = event;

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
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃      🎮 GAME CENTER
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  🟢 STATUS: ONLINE
┃
┃  Games have been ENABLED.
┃
┃  Type !games for the menu.
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
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

    clearThreadSessions(
      threadID
    );

    await send(
      api,
      threadID,
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃      🎮 GAME CENTER
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  🔴 STATUS: OFFLINE
┃
┃  Games have been DISABLED.
┃  Active games cancelled.
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
    );

    return true;
  }

  return false;
}

async function gamesAreEnabled(
  threadID
) {
  return await db.isGameEnabled(
    String(threadID)
  );
}

// ============================================================
// TRIVIA
// ============================================================

async function handleTrivia(
  api,
  event
) {
  const {
    threadID,
    senderID
  } = event;

  if (
    !Array.isArray(
      TRIVIA_QUESTIONS
    ) ||
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

  const options =
    qdata.options
      .map(
        (option, i) =>
          `┃  ${labels[i]}  ${option}`
      )
      .join('\n');

  const message =
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🧠 TRIVIA
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  ${qdata.q}
┃
${options}
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 Reward: ${money(qdata.reward)}
┃  ⏱️ 30 seconds
┃
┃  ✦ Reply A / B / C / D
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;

  let messageInfo;

  try {
    messageInfo =
      await sendMessageAsync(
        api,
        threadID,
        message
      );
  } catch (error) {
    console.error(
      '[games] trivia send failed:',
      error
    );

    return;
  }

  setSession(
    threadID,
    senderID,
    {
      type: 'trivia',
      qdata,
      messageID:
        getMessageID(messageInfo)
    }
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

  const labels = [
    'A',
    'B',
    'C',
    'D'
  ];

  const chosen =
    labels.indexOf(
      String(answer)
        .toUpperCase()
    );

  clearSession(
    threadID,
    senderID
  );

  if (chosen === -1) {
    return;
  }

  const {
    qdata,
    messageID
  } = session;

  let result;

  if (
    chosen === qdata.answer
  ) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        qdata.reward
      );

    result =
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃       🧠 TRIVIA
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  ✨ CORRECT ANSWER
┃
┃  Your answer:
┃  ${labels[chosen]} — ${qdata.options[chosen]}
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 +${money(qdata.reward)} coins
┃  💵 Balance: ${money(newBal)}
┃
┃  🏆 Excellent!
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;
  } else {
    result =
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃       🧠 TRIVIA
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  ❌ WRONG ANSWER
┃
┃  Your answer:
┃  ${labels[chosen]} — ${qdata.options[chosen]}
┃
┃  Correct:
┃  ${labels[qdata.answer]} — ${qdata.options[qdata.answer]}
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  Better luck next time.
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;
  }

  if (
    messageID &&
    typeof api.editMessage === 'function'
  ) {
    try {
      await editMessageAsync(
        api,
        result,
        messageID
      );

      return;
    } catch (error) {
      console.error(
        '[games] trivia edit failed:',
        error
      );
    }
  }

  await send(
    api,
    threadID,
    result
  );
}

// ============================================================
// RPS
// ============================================================

async function handleRps(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  const choice =
    String(
      args[0] || ''
    ).toLowerCase();

  const bet =
    args[1] === undefined
      ? 0
      : parseInt(
          args[1],
          10
        );

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

  if (
    !choices.includes(choice)
  ) {
    await send(
      api,
      threadID,
      `╭━━━━━━━━━━━━━━╮
┃      ⚔️ RPS
┣━━━━━━━━━━━━━━┫
┃
┃ !rps rock [bet]
┃ !rps paper [bet]
┃ !rps scissors [bet]
┃
╰━━━━━━━━━━━━━━╯`
    );

    return;
  }

  if (
    !Number.isInteger(bet) ||
    bet < 0
  ) {
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
      await insufficientFunds(
        api,
        threadID,
        senderID
      );

      return;
    }

    await db.addBalance(
      threadID,
      senderID,
      -bet
    );
  }

  const botPreview =
    choices[
      randInt(0, 2)
    ];

  const frames = [
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        ⚔️ RPS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  YOU
┃       ${emojis[choice]}
┃       ${choice.toUpperCase()}
┃
┃  VS
┃
┃  🤖 BOT
┃       ❔
┃
┃  ⏳ Choosing...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        ⚔️ RPS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  YOU      🤖 BOT
┃
┃   ${emojis[choice]}       🪨
┃
┃       ⚔️
┃
┃  Calculating...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        ⚔️ RPS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  YOU      🤖 BOT
┃
┃   ${emojis[choice]}       ${emojis[botPreview]}
┃
┃       ⚔️
┃
┃  REVEALING...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
  ];

  await animate(
    api,
    threadID,
    frames,
    [
      ANIMATION.normal,
      ANIMATION.fast
    ]
  );

  const botChoice =
    choices[
      randInt(0, 2)
    ];

  let result;

  if (
    choice === botChoice
  ) {
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
        `🎉 YOU WIN
💰 +${money(bet)} coins
💵 Balance: ${money(newBal)}`;
    } else if (
      result === 'tie'
    ) {
      const newBal =
        await db.addBalance(
          threadID,
          senderID,
          bet
        );

      resultText =
        `👔 TIE
💰 Bet returned
💵 Balance: ${money(newBal)}`;
    } else {
      const balance =
        await getBalance(
          threadID,
          senderID
        );

      resultText =
        `💀 YOU LOSE
💸 -${money(bet)} coins
💵 Balance: ${money(balance)}`;
    }
  } else {
    resultText =
      result === 'win'
        ? '🎉 YOU WIN!'
        : result === 'tie'
          ? '👔 TIE!'
          : '💀 YOU LOSE!';
  }

  if (
    result !== 'tie'
  ) {
    await db.incrementGameStats(
      threadID,
      senderID,
      result === 'win'
    );
  }

  await send(
    api,
    threadID,
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        ⚔️ RPS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  YOU   ${emojis[choice]} ${choice.toUpperCase()}
┃  BOT   ${emojis[botChoice]} ${botChoice.toUpperCase()}
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  ${resultText.replace(
      /\n/g,
      '\n┃  '
    )}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
  );
}

// ============================================================
// DICE / ROLL
// ============================================================

function diceArt(value) {
  const faces = {
    1: '⚀',
    2: '⚁',
    3: '⚂',
    4: '⚃',
    5: '⚄',
    6: '⚅'
  };

  return faces[value] || '🎲';
}

async function handleRoll(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  let sides = 100;
  let bet;

  if (args.length >= 2) {
    sides =
      parseInt(
        args[0],
        10
      );

    bet =
      parseInt(
        args[1],
        10
      );
  } else {
    bet =
      parseInt(
        args[0],
        10
      );
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
      `╭━━━━━━━━━━━━━━╮
┃       🎲 DICE
┣━━━━━━━━━━━━━━┫
┃
┃ !roll <bet>
┃ !roll <sides> <bet>
┃
╰━━━━━━━━━━━━━━╯`
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
    await insufficientFunds(
      api,
      threadID,
      senderID
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const rollingFrames = [
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎲 DICE
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃
┃          🎲
┃
┃       [  ?  ]
┃
┃       ROLLING
┃
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 Bet: ${money(bet)}
┃  🎯 Target: 55%+
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎲 DICE
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃
┃          ⚄
┃
┃       [  ?  ]
┃
┃       ROLLING.
┃
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 Bet: ${money(bet)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎲 DICE
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃
┃          ⚂
┃
┃       [  ?  ]
┃
┃       ROLLING..
┃
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 Bet: ${money(bet)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎲 DICE
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃
┃          ⚅
┃
┃       [  ?  ]
┃
┃       ROLLING...
┃
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 Bet: ${money(bet)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
  ];

  await animate(
    api,
    threadID,
    rollingFrames,
    [
      ANIMATION.veryFast,
      ANIMATION.veryFast,
      ANIMATION.veryFast
    ]
  );

  const rollVal =
    randInt(
      1,
      sides
    );

  const win =
    rollVal >=
    Math.floor(
      sides * 0.55
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
      `🎉 HIGH ROLL
💰 +${money(bet)} coins
💵 Balance: ${money(newBal)}`;
  } else {
    const balance =
      await getBalance(
        threadID,
        senderID
      );

    finalText =
      `💀 LOW ROLL
💸 -${money(bet)} coins
💵 Balance: ${money(balance)}`;
  }

  await db.incrementGameStats(
    threadID,
    senderID,
    win
  );

  await send(
    api,
    threadID,
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎲 DICE
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃          ${sides <= 6
      ? diceArt(rollVal)
      : '🎲'}
┃
┃       [ ${rollVal} ]
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  ${finalText.replace(
      /\n/g,
      '\n┃  '
    )}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
  );
}

// ============================================================
// GUESS
// ============================================================

async function handleGuess(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  const number =
    parseInt(
      args[0],
      10
    );

  const bet =
    args[1] === undefined
      ? 100
      : parseInt(
          args[1],
          10
        );

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 10
  ) {
    await send(
      api,
      threadID,
      `╭━━━━━━━━━━━━━━╮
┃      🎯 GUESS
┣━━━━━━━━━━━━━━┫
┃
┃ !guess <1-10> [bet]
┃
╰━━━━━━━━━━━━━━╯`
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
    await insufficientFunds(
      api,
      threadID,
      senderID
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const secret =
    randInt(
      1,
      10
    );

  const frames = [
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎯 GUESS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  Your number:
┃
┃          [ ${number} ]
┃
┃  🔐 SECRET NUMBER
┃          [ ? ]
┃
┃
┃  Scanning...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎯 GUESS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  Your number:
┃
┃          [ ${number} ]
┃
┃  🔐 SECRET NUMBER
┃          [ ?? ]
┃
┃
┃  Searching...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎯 GUESS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  Your number:
┃
┃          [ ${number} ]
┃
┃  🔐 SECRET NUMBER
┃          [ ??? ]
┃
┃
┃  REVEALING...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
  ];

  await animate(
    api,
    threadID,
    frames,
    [
      ANIMATION.normal,
      ANIMATION.normal
    ]
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
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎯 GUESS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  🔐 SECRET:
┃          [ ${secret} ]
┃
┃  🎯 YOUR GUESS:
┃          [ ${number} ]
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  💥 EXACT MATCH!
┃
┃  💰 +${money(winnings)} coins
┃  💵 Balance: ${money(newBal)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
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
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃        🎯 GUESS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  🔐 SECRET:
┃          [ ${secret} ]
┃
┃  🎯 YOUR GUESS:
┃          [ ${number} ]
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  ❌ WRONG GUESS
┃
┃  💸 -${money(bet)} coins
┃  💵 Balance: ${money(balance)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
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
      parseInt(
        args[0],
        10
      );

    choice =
      String(
        args[1] || ''
      ).toLowerCase();
  } else if (
    /^\d+$/.test(
      args[1] || ''
    )
  ) {
    bet =
      parseInt(
        args[1],
        10
      );

    choice =
      String(
        args[0] || ''
      ).toLowerCase();
  } else {
    await send(
      api,
      threadID,
      `╭━━━━━━━━━━━━━━╮
┃     🪙 COINFLIP
┣━━━━━━━━━━━━━━┫
┃
┃ !coinflip 100 heads
┃ !coinflip heads 100
┃
╰━━━━━━━━━━━━━━╯`
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
    await insufficientFunds(
      api,
      threadID,
      senderID
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const frames = [
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃      🪙 COINFLIP
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  YOUR CALL
┃
┃     ${choice.toUpperCase()}
┃
┃
┃        🪙
┃
┃      FLIP
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃      🪙 COINFLIP
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  YOUR CALL
┃
┃     ${choice.toUpperCase()}
┃
┃
┃        🔄
┃
┃       🪙
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃      🪙 COINFLIP
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  YOUR CALL
┃
┃     ${choice.toUpperCase()}
┃
┃
┃        🪙
┃
┃       🔄
┃
┃      REVEAL...
╰━━━━━━━━━━━━━━━━━━━━╯`
  ];

  await animate(
    api,
    threadID,
    frames,
    [
      ANIMATION.fast,
      ANIMATION.fast
    ]
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
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃      🪙 COINFLIP
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃          🪙
┃
┃     ${outcome.toUpperCase()}
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  🎉 YOU WIN!
┃
┃  💰 +${money(bet)} coins
┃  💵 Balance: ${money(newBal)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
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
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃      🪙 COINFLIP
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃          🪙
┃
┃     ${outcome.toUpperCase()}
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  💀 YOU LOSE
┃
┃  💸 -${money(bet)} coins
┃  💵 Balance: ${money(balance)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
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

function slotLine(
  a,
  b,
  c
) {
  return `┃       │ ${a} │ ${b} │ ${c} │`;
}

async function handleSlots(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  const bet =
    parseInt(
      args[0],
      10
    );

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await send(
      api,
      threadID,
      `╭━━━━━━━━━━━━━━╮
┃       🎰 SLOTS
┣━━━━━━━━━━━━━━┫
┃
┃ !slots <bet>
┃
╰━━━━━━━━━━━━━━╯`
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
    await insufficientFunds(
      api,
      threadID,
      senderID
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const frames = [];

  frames.push(
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃       🎰 SLOTS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃      ┌───────────┐
┃      │ ❔ │ ❔ │ ❔ │
┃      └───────────┘
┃
┃        SPINNING
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 Bet: ${money(bet)}
╰━━━━━━━━━━━━━━━━━━━━╯`
  );

  for (
    let i = 0;
    i < 4;
    i++
  ) {
    frames.push(
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃       🎰 SLOTS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃      ┌───────────┐
${slotLine(
  randomSlot(),
  randomSlot(),
  randomSlot()
)}
┃      └───────────┘
┃
┃        ${i % 2 === 0
        ? '🔄 SPINNING'
        : '🎰 SPINNING'}
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 Bet: ${money(bet)}
╰━━━━━━━━━━━━━━━━━━━━╯`
    );
  }

  await animate(
    api,
    threadID,
    frames,
    [
      ANIMATION.fast,
      ANIMATION.fast,
      ANIMATION.fast,
      ANIMATION.fast
    ]
  );

  const r1 =
    randomSlot();

  const r2 =
    randomSlot();

  const r3 =
    randomSlot();

  let resultText;

  if (
    r1 === r2 &&
    r2 === r3
  ) {
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

    resultText =
      `💎 JACKPOT!
🔥 ${multiplier}× PAYOUT
💰 +${money(winnings)} coins
💵 Balance: ${money(newBal)}`;
  } else if (
    r1 === r2 ||
    r2 === r3 ||
    r1 === r3
  ) {
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

    resultText =
      `✨ TWO MATCHED!
💰 1.5× PAYOUT
💵 Balance: ${money(newBal)}`;
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

    resultText =
      `❌ NO MATCH
💸 -${money(bet)} coins
💵 Balance: ${money(balance)}`;
  }

  await send(
    api,
    threadID,
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃       🎰 SLOTS
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃      ┌───────────┐
${slotLine(
  r1,
  r2,
  r3
)}
┃      └───────────┘
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  ${resultText.replace(
      /\n/g,
      '\n┃  '
    )}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
  );
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

  for (
    const suit of SUITS
  ) {
    for (
      const rank of RANKS
    ) {
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
        Math.random() *
        (i + 1)
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

  for (
    const [rank] of hand
  ) {
    if (
      [
        'J',
        'Q',
        'K'
      ].includes(rank)
    ) {
      score += 10;
    } else if (
      rank === 'A'
    ) {
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
    return `${hand[0][0]}${hand[0][1]}  🂠`;
  }

  return hand
    .map(
      ([rank, suit]) =>
        `${rank}${suit}`
    )
    .join('  ');
}

function blackjackUI(
  dealerHand,
  playerHand,
  hideDealer,
  bet,
  extra = ''
) {
  const dealerScore =
    hideDealer
      ? '?'
      : calcScore(
          dealerHand
        );

  const playerScore =
    calcScore(
      playerHand
    );

  return `╭━━━━━━━━━━━━━━━━━━━━╮
┃     🃏 BLACKJACK
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  DEALER
┃  ${renderHand(
    dealerHand,
    hideDealer
  )}
┃  Score: ${dealerScore}
┃
┃  YOU
┃  ${renderHand(
    playerHand
  )}
┃  Score: ${playerScore}
┃
┣━━━━━━━━━━━━━━━━━━━━┫
┃  💰 Bet: ${money(bet)}
┃
${extra
    ? `┃  ${extra}\n`
    : ''}╰━━━━━━━━━━━━━━━━━━━━╯`;
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
    parseInt(
      args[0],
      10
    );

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await send(
      api,
      threadID,
      `╭━━━━━━━━━━━━━━━━╮
┃   🃏 BLACKJACK
┣━━━━━━━━━━━━━━━━┫
┃
┃ !blackjack <bet>
┃
╰━━━━━━━━━━━━━━━━╯`
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
    await insufficientFunds(
      api,
      threadID,
      senderID
    );

    return;
  }

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
    calcScore(
      playerHand
    );

  // Natural blackjack
  if (
    playerScore === 21
  ) {
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

    await animate(
      api,
      threadID,
      [
        blackjackUI(
          dealerHand,
          playerHand,
          true,
          bet,
          '🂠 DEALER CARD HIDDEN'
        ),

        blackjackUI(
          dealerHand,
          playerHand,
          false,
          bet,
          '💥 NATURAL BLACKJACK!'
        )
      ],
      [
        ANIMATION.normal
      ]
    );

    await send(
      api,
      threadID,
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃     🃏 BLACKJACK
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  💥 NATURAL BLACKJACK!
┃
┃  💰 +${money(winnings)} coins
┃  💵 Balance: ${money(newBal)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
    );

    return;
  }

  const session = {
    type: 'blackjack',
    bet,
    deck,
    playerHand,
    dealerHand,
    messageID: null
  };

  const messageInfo =
    await sendMessageAsync(
      api,
      threadID,
      blackjackUI(
        dealerHand,
        playerHand,
        true,
        bet,
        '➤ !hit   •   !stand'
      )
    );

  session.messageID =
    getMessageID(
      messageInfo
    );

  setSession(
    threadID,
    senderID,
    session
  );
}

async function updateBlackjackMessage(
  api,
  session,
  text
) {
  if (
    session.messageID &&
    typeof api.editMessage === 'function'
  ) {
    try {
      await editMessageAsync(
        api,
        text,
        session.messageID
      );

      return true;
    } catch (error) {
      console.error(
        '[games] blackjack edit failed:',
        error
      );
    }
  }

  return false;
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
    calcScore(
      playerHand
    );

  if (
    pScore > 21
  ) {
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

    const result =
      blackjackUI(
        dealerHand,
        playerHand,
        false,
        bet,
        '💥 BUST!'
      );

    if (
      !(await updateBlackjackMessage(
        api,
        session,
        result
      ))
    ) {
      await send(
        api,
        threadID,
        result
      );
    }

    await send(
      api,
      threadID,
      `💸 Lost ${money(bet)} coins
💵 Balance: ${money(balance)}`
    );

    return;
  }

  setSession(
    threadID,
    senderID,
    session
  );

  const result =
    blackjackUI(
      dealerHand,
      playerHand,
      true,
      bet,
      `🎴 Drew ${nextCard[0]}${nextCard[1]}`
    );

  await updateBlackjackMessage(
    api,
    session,
    result
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
    calcScore(
      playerHand
    );

  // Dealer reveal
  await updateBlackjackMessage(
    api,
    session,
    blackjackUI(
      dealerHand,
      playerHand,
      false,
      bet,
      '👁️ DEALER REVEALS'
    )
  );

  await sleep(
    ANIMATION.normal
  );

  let dScore =
    calcScore(
      dealerHand
    );

  // Dealer animation
  while (
    dScore < 17 &&
    deck.length > 0
  ) {
    dealerHand.push(
      deck.pop()
    );

    dScore =
      calcScore(
        dealerHand
      );

    await updateBlackjackMessage(
      api,
      session,
      blackjackUI(
        dealerHand,
        playerHand,
        false,
        bet,
        '🎴 DEALER DRAWS...'
      )
    );

    await sleep(
      ANIMATION.fast
    );
  }

  let result;
  let balance;

  if (
    dScore > 21 ||
    pScore > dScore
  ) {
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

    result =
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃     🃏 BLACKJACK
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  Dealer: ${dScore}
┃  You:    ${pScore}
┃
┃  🎉 YOU WIN!
┃
┃  💰 +${money(bet)} coins
┃  💵 Balance: ${money(newBal)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;
  } else if (
    pScore === dScore
  ) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        bet
      );

    result =
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃     🃏 BLACKJACK
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  Dealer: ${dScore}
┃  You:    ${pScore}
┃
┃  👔 PUSH — TIE
┃
┃  💰 Bet returned
┃  💵 Balance: ${money(newBal)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;
  } else {
    balance =
      await getBalance(
        threadID,
        senderID
      );

    await db.incrementGameStats(
      threadID,
      senderID,
      false
    );

    result =
      `╭━━━━━━━━━━━━━━━━━━━━╮
┃     🃏 BLACKJACK
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  Dealer: ${dScore}
┃  You:    ${pScore}
┃
┃  💀 DEALER WINS
┃
┃  💸 Lost ${money(bet)} coins
┃  💵 Balance: ${money(balance)}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`;
  }

  if (
    !(await updateBlackjackMessage(
      api,
      session,
      result
    ))
  ) {
    await send(
      api,
      threadID,
      result
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
      `╭━━━━━━━━━━━━━━━━╮
┃   🎱 MAGIC 8-BALL
┣━━━━━━━━━━━━━━━━┫
┃
┃ !8ball <question>
┃
╰━━━━━━━━━━━━━━━━╯`
    );

    return;
  }

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

  const frames = [
    `╭━━━━━━━━━━━━━━━━━━━━╮
┃    🎱 MAGIC 8-BALL
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  "${question}"
┃
┃
┃          🎱
┃
┃       ◌ ◌ ◌
┃
┃     THINKING...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃    🎱 MAGIC 8-BALL
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  "${question}"
┃
┃
┃          🔮
┃
┃       ◌ ◌ ◌
┃
┃     CONSULTING...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃    🎱 MAGIC 8-BALL
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃  "${question}"
┃
┃
┃          🎱
┃
┃       ✦ ✦ ✦
┃
┃      REVEAL...
┃
╰━━━━━━━━━━━━━━━━━━━━╯`,

    `╭━━━━━━━━━━━━━━━━━━━━╮
┃    🎱 MAGIC 8-BALL
┣━━━━━━━━━━━━━━━━━━━━┫
┃
┃          🎱
┃
┃
┃      ✦ ANSWER ✦
┃
┃  ${answer}
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
  ];

  await animate(
    api,
    threadID,
    frames,
    [
      ANIMATION.fast,
      ANIMATION.fast,
      ANIMATION.normal
    ]
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
    `╭━━━━━━━━━━━━━━━━━━━━━━━━━━╮
┃       🎮 GAME CENTER
┣━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃
┃  STATUS: ${status}
┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃
┃  🧠 TRIVIA
┃  !trivia
┃  Answer A/B/C/D → coins
┃
┃  ⚔️ RPS
┃  !rps rock 100
┃  Win → 2×
┃
┃  🎲 DICE
┃  !roll 100
┃  High roll → 2×
┃
┃  🎯 GUESS
┃  !guess 7 100
┃  Exact → 5×
┃
┃  🪙 COINFLIP
┃  !coinflip 100 heads
┃  Win → 2×
┃
┃  🎰 SLOTS
┃  !slots 100
┃  Pair → 1.5×
┃  Jackpot → 3–5×
┃
┃  🃏 BLACKJACK
┃  !blackjack 100
┃  !hit / !stand
┃  Natural → 2.5×
┃
┃  🎱 8-BALL
┃  !8ball <question>
┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃
┃  ⚙️ !game on
┃  ⚙️ !game off
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`
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
    String(
      text || ''
    )
      .trim()
      .toLowerCase();

  const original =
    String(
      originalText ||
      text ||
      ''
    ).trim();

  // ----------------------------------------------------------
  // GAME TOGGLE
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
  // GAME MENU
  // ----------------------------------------------------------

  if (
    cleanText === '!games'
  ) {
    await handleGamesList(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // CHECK ENABLED
  // ----------------------------------------------------------

  const enabled =
    await gamesAreEnabled(
      threadID
    );

  if (!enabled) {
    return false;
  }

  // ----------------------------------------------------------
  // PARSE ARGS
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

    // --------------------------------------------------------
    // TRIVIA ANSWER
    // --------------------------------------------------------

    if (
      session.type === 'trivia' &&
      /^[abcd]$/i.test(
        cleanText
      )
    ) {
      await resolveTrivia(
        api,
        event,
        session,
        cleanText
      );

      return true;
    }

    // --------------------------------------------------------
    // BLACKJACK HIT
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // BLACKJACK STAND
    // --------------------------------------------------------

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

  if (
    cleanText === '!trivia'
  ) {
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
  // DICE
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
