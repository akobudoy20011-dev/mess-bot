/**
 * games.js
 * ========
 * Mini-games for Messenger.
 *
 * Trivia questions are stored separately in:
 *   ./trivia-questions.js
 *
 * trivia-questions.js must export:
 *   module.exports = TRIVIA_QUESTIONS;
 *
 * Call handleGamesCommand(api, event, text, originalText)
 * from index.js's handleMessage().
 *
 * Returns true if the message was handled.
 */

const db = require('./db');
const { reply } = require('./util');
const TRIVIA_QUESTIONS = require('./trivia-questions');

// ------------------------------------------------------------
// RANDOM
// ------------------------------------------------------------

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ------------------------------------------------------------
// SESSION STATE
// ------------------------------------------------------------

// Used for:
// - Trivia answer window
// - Blackjack hit/stand
//
// Sessions are NOT persisted.
// Balances ARE persisted through db.js / Neon.

const sessions = new Map();

const SESSION_TIMEOUT_MS = 30_000;

function sessionKey(threadID, senderID) {
  return `${threadID}:${senderID}`;
}

function setSession(threadID, senderID, data) {
  const key = sessionKey(threadID, senderID);

  sessions.set(key, data);

  setTimeout(() => {
    const current = sessions.get(key);

    if (current === data) {
      sessions.delete(key);
    }
  }, SESSION_TIMEOUT_MS);
}

function getSession(threadID, senderID) {
  return sessions.get(
    sessionKey(threadID, senderID)
  );
}

function clearSession(threadID, senderID) {
  sessions.delete(
    sessionKey(threadID, senderID)
  );
}

// ------------------------------------------------------------
// TRIVIA
// ------------------------------------------------------------

async function handleTrivia(api, event) {
  const { threadID, senderID } = event;

  // Make sure the question bank loaded correctly.
  if (
    !Array.isArray(TRIVIA_QUESTIONS) ||
    TRIVIA_QUESTIONS.length === 0
  ) {
    await reply(
      api,
      threadID,
      '❌ Trivia question bank is empty or could not be loaded.'
    );

    return;
  }

  // Random question from the entire bank.
  const qdata =
    TRIVIA_QUESTIONS[
      randInt(
        0,
        TRIVIA_QUESTIONS.length - 1
      )
    ];

  // Basic validation so one malformed question
  // does not crash the bot.
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
    await reply(
      api,
      threadID,
      '❌ This trivia question is formatted incorrectly.'
    );

    return;
  }

  const labels = ['A', 'B', 'C', 'D'];

  setSession(
    threadID,
    senderID,
    {
      type: 'trivia',
      qdata
    }
  );

  const optionLines = qdata.options
    .map(
      (option, index) =>
        `${labels[index]}: ${option}`
    )
    .join('\n');

  await reply(
    api,
    threadID,
    `🧠 Trivia — ${qdata.q}\n` +
      `${optionLines}\n\n` +
      `Reply with A/B/C/D within 30 seconds!`
  );
}

async function resolveTrivia(
  api,
  event,
  session,
  answerLetter
) {
  const { threadID, senderID } = event;

  const labels = ['A', 'B', 'C', 'D'];

  const chosenIdx = labels.indexOf(
    String(answerLetter).toUpperCase()
  );

  clearSession(threadID, senderID);

  if (chosenIdx === -1) {
    return;
  }

  const { qdata } = session;

  if (chosenIdx === qdata.answer) {
    const newBal = await db.addBalance(
      threadID,
      senderID,
      qdata.reward
    );

    await reply(
      api,
      threadID,
      `🎉 Correct! You picked ${qdata.options[chosenIdx]}\n` +
        `💰 +${qdata.reward.toLocaleString()} coins — ` +
        `Balance: ${newBal.toLocaleString()}`
    );
  } else {
    await reply(
      api,
      threadID,
      `❌ Wrong. You picked ${qdata.options[chosenIdx]}\n` +
        `✅ Correct answer: ${qdata.options[qdata.answer]}`
    );
  }
}

// ------------------------------------------------------------
// RPS
// ------------------------------------------------------------

async function handleRps(api, event, args) {
  const { threadID, senderID } = event;

  const choice =
    (args[0] || '').toLowerCase();

  const bet =
    parseInt(args[1], 10) || 0;

  if (
    ![
      'rock',
      'paper',
      'scissors'
    ].includes(choice)
  ) {
    await reply(
      api,
      threadID,
      '❌ Usage: !rps <rock/paper/scissors> [bet]'
    );

    return;
  }

  if (bet < 0) {
    await reply(
      api,
      threadID,
      '❌ Bet cannot be negative.'
    );

    return;
  }

  if (bet > 0) {
    const user =
      await db.getUser(
        threadID,
        senderID
      );

    if (user.balance < bet) {
      await reply(
        api,
        threadID,
        `💸 You only have ${user.balance.toLocaleString()} coins.`
      );

      return;
    }

    await db.addBalance(
      threadID,
      senderID,
      -bet
    );
  }

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

  const botChoice =
    choices[randInt(0, 2)];

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

  let desc;

  if (bet > 0) {
    if (result === 'win') {
      const newBal =
        await db.addBalance(
          threadID,
          senderID,
          bet * 2
        );

      desc =
        `🎉 You won ${bet.toLocaleString()} coins! ` +
        `Balance: ${newBal.toLocaleString()}`;
    } else if (result === 'tie') {
      const newBal =
        await db.addBalance(
          threadID,
          senderID,
          bet
        );

      desc =
        `👔 Tie! Bet returned. ` +
        `Balance: ${newBal.toLocaleString()}`;
    } else {
      const user =
        await db.getUser(
          threadID,
          senderID
        );

      desc =
        `❌ You lost ${bet.toLocaleString()} coins. ` +
        `Balance: ${user.balance.toLocaleString()}`;
    }
  } else {
    desc =
      result === 'win'
        ? '🎉 You won!'
        : result === 'tie'
          ? '👔 Tie!'
          : '❌ You lost!';
  }

  if (result !== 'tie') {
    await db.incrementGameStats(
      threadID,
      senderID,
      result === 'win'
    );
  }

  await reply(
    api,
    threadID,
    `🎮 RPS — You: ${emojis[choice]} ${choice} | ` +
      `Bot: ${emojis[botChoice]} ${botChoice}\n` +
      `${desc}`
  );
}

// ------------------------------------------------------------
// ROLL
// ------------------------------------------------------------

async function handleRoll(api, event, args) {
  const { threadID, senderID } = event;

  let sides = 100;
  let bet;

  if (args.length >= 2) {
    sides = parseInt(args[0], 10);
    bet = parseInt(args[1], 10);
  } else {
    bet = parseInt(args[0], 10);
  }

  if (
    !Number.isInteger(sides) ||
    sides < 2
  ) {
    await reply(
      api,
      threadID,
      '❌ Sides must be a whole number of at least 2.'
    );

    return;
  }

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await reply(
      api,
      threadID,
      '❌ Usage: !roll <bet> OR !roll <sides> <bet>'
    );

    return;
  }

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  if (user.balance < bet) {
    await reply(
      api,
      threadID,
      `💸 You only have ${user.balance.toLocaleString()} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const rollVal =
    randInt(1, sides);

  const win =
    rollVal >=
    Math.floor(sides * 0.55);

  let text;

  if (win) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        bet * 2
      );

    text =
      `🎲 Rolled ${rollVal}/${sides}! 🎉 ` +
      `You won ${bet.toLocaleString()} coins! ` +
      `Balance: ${newBal.toLocaleString()}`;
  } else {
    const newBal =
      (
        await db.getUser(
          threadID,
          senderID
        )
      ).balance;

    text =
      `🎲 Rolled ${rollVal}/${sides}. ❌ ` +
      `You lost ${bet.toLocaleString()} coins. ` +
      `Balance: ${newBal.toLocaleString()}`;
  }

  await db.incrementGameStats(
    threadID,
    senderID,
    win
  );

  await reply(
    api,
    threadID,
    text
  );
}

// ------------------------------------------------------------
// GUESS
// ------------------------------------------------------------

async function handleGuess(api, event, args) {
  const { threadID, senderID } = event;

  const number =
    parseInt(args[0], 10);

  const bet =
    parseInt(args[1], 10) || 100;

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 10
  ) {
    await reply(
      api,
      threadID,
      '❌ Usage: !guess <1-10> [bet]'
    );

    return;
  }

  if (bet <= 0) {
    await reply(
      api,
      threadID,
      '❌ Bet must be positive.'
    );

    return;
  }

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  if (user.balance < bet) {
    await reply(
      api,
      threadID,
      `💸 You only have ${user.balance.toLocaleString()} coins.`
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

  const win =
    number === secret;

  let text;

  if (win) {
    const winnings =
      bet * 5;

    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        winnings
      );

    text =
      `🎯 EXACT MATCH! It was ${secret}! 🎉 ` +
      `Won ${winnings.toLocaleString()} coins (5x)! ` +
      `Balance: ${newBal.toLocaleString()}`;
  } else {
    const newBal =
      (
        await db.getUser(
          threadID,
          senderID
        )
      ).balance;

    text =
      `❌ Wrong! It was ${secret} ` +
      `(you guessed ${number}). ` +
      `Lost ${bet.toLocaleString()} coins. ` +
      `Balance: ${newBal.toLocaleString()}`;
  }

  await db.incrementGameStats(
    threadID,
    senderID,
    win
  );

  await reply(
    api,
    threadID,
    text
  );
}

// ------------------------------------------------------------
// COINFLIP
// ------------------------------------------------------------

async function handleCoinflip(api, event, args) {
  const { threadID, senderID } = event;

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
      (args[1] || '')
        .toLowerCase();
  } else if (
    /^\d+$/.test(
      args[1] || ''
    )
  ) {
    bet =
      parseInt(args[1], 10);

    choice =
      (args[0] || '')
        .toLowerCase();
  } else {
    await reply(
      api,
      threadID,
      '❌ Usage: !coinflip <bet> <heads/tails>'
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
    await reply(
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

  if (bet <= 0) {
    await reply(
      api,
      threadID,
      '❌ Bet must be positive.'
    );

    return;
  }

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  if (user.balance < bet) {
    await reply(
      api,
      threadID,
      `💸 You only have ${user.balance.toLocaleString()} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const outcome =
    Math.random() < 0.5
      ? 'heads'
      : 'tails';

  const win =
    outcome === choice;

  let text;

  if (win) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        bet * 2
      );

    text =
      `🪙 Landed on ${outcome}! 🎉 ` +
      `Won ${bet.toLocaleString()} coins! ` +
      `Balance: ${newBal.toLocaleString()}`;
  } else {
    const newBal =
      (
        await db.getUser(
          threadID,
          senderID
        )
      ).balance;

    text =
      `🪙 Landed on ${outcome}. ❌ ` +
      `Lost ${bet.toLocaleString()} coins. ` +
      `Balance: ${newBal.toLocaleString()}`;
  }

  await db.incrementGameStats(
    threadID,
    senderID,
    win
  );

  await reply(
    api,
    threadID,
    text
  );
}

// ------------------------------------------------------------
// SLOTS
// ------------------------------------------------------------

async function handleSlots(api, event, args) {
  const { threadID, senderID } = event;

  const bet =
    parseInt(args[0], 10);

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await reply(
      api,
      threadID,
      '❌ Usage: !slots <bet>'
    );

    return;
  }

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  if (user.balance < bet) {
    await reply(
      api,
      threadID,
      `💸 You only have ${user.balance.toLocaleString()} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -bet
  );

  const symbols = [
    '🍋',
    '🍒',
    '🍇',
    '🔔',
    '💎',
    '7️⃣'
  ];

  const r1 =
    symbols[
      randInt(
        0,
        symbols.length - 1
      )
    ];

  const r2 =
    symbols[
      randInt(
        0,
        symbols.length - 1
      )
    ];

  const r3 =
    symbols[
      randInt(
        0,
        symbols.length - 1
      )
    ];

  let text;
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

    text =
      `🎰 [ ${r1} | ${r2} | ${r3} ]\n` +
      `🎉 JACKPOT! Won ${winnings.toLocaleString()} coins ` +
      `(${multiplier}x)! ` +
      `Balance: ${newBal.toLocaleString()}`;
  } else if (
    r1 === r2 ||
    r2 === r3 ||
    r1 === r3
  ) {
    won = true;

    const winnings =
      Math.floor(bet * 1.5);

    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        winnings
      );

    text =
      `🎰 [ ${r1} | ${r2} | ${r3} ]\n` +
      `✨ Small win! Won ${winnings.toLocaleString()} coins ` +
      `(1.5x)! ` +
      `Balance: ${newBal.toLocaleString()}`;
  } else {
    const newBal =
      (
        await db.getUser(
          threadID,
          senderID
        )
      ).balance;

    text =
      `🎰 [ ${r1} | ${r2} | ${r3} ]\n` +
      `❌ Lost ${bet.toLocaleString()} coins. ` +
      `Balance: ${newBal.toLocaleString()}`;
  }

  await db.incrementGameStats(
    threadID,
    senderID,
    won
  );

  await reply(
    api,
    threadID,
    text
  );
}

// ------------------------------------------------------------
// BLACKJACK
// ------------------------------------------------------------

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
      aces += 1;
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
    aces -= 1;
  }

  return score;
}

function renderHand(
  hand,
  hideDealer = false
) {
  if (hideDealer) {
    return (
      `${hand[0][0]}${hand[0][1]} 🂠`
    );
  }

  return hand
    .map(
      ([rank, suit]) =>
        `${rank}${suit}`
    )
    .join(' ');
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
    await reply(
      api,
      threadID,
      '❌ Usage: !blackjack <bet>'
    );

    return;
  }

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  if (user.balance < bet) {
    await reply(
      api,
      threadID,
      `💸 You only have ${user.balance.toLocaleString()} coins.`
    );

    return;
  }

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

  const pScore =
    calcScore(playerHand);

  // Natural blackjack
  if (pScore === 21) {
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

    await reply(
      api,
      threadID,
      `🃏 BLACKJACK! ` +
        `Dealer: ${renderHand(dealerHand)} | ` +
        `You: ${renderHand(playerHand)} (21)\n` +
        `🎉 Natural blackjack! ` +
        `Won ${winnings.toLocaleString()} coins! ` +
        `Balance: ${newBal.toLocaleString()}`
    );

    return;
  }

  setSession(
    threadID,
    senderID,
    {
      type: 'blackjack',
      bet,
      deck,
      playerHand,
      dealerHand
    }
  );

  await reply(
    api,
    threadID,
    `🃏 Blackjack\n` +
      `Dealer: ${renderHand(
        dealerHand,
        true
      )}\n` +
      `You: ${renderHand(
        playerHand
      )} (${pScore})\n\n` +
      `Reply "!hit" or "!stand" within 30 seconds.`
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

    await reply(
      api,
      threadID,
      '❌ Blackjack deck ran out of cards.'
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

    const newBal =
      (
        await db.getUser(
          threadID,
          senderID
        )
      ).balance;

    await db.incrementGameStats(
      threadID,
      senderID,
      false
    );

    await reply(
      api,
      threadID,
      `🃏 BUST! ` +
        `Dealer: ${renderHand(dealerHand)} ` +
        `(${calcScore(dealerHand)}) | ` +
        `You: ${renderHand(playerHand)} ` +
        `(${pScore})\n` +
        `💥 You lost ${bet.toLocaleString()} coins. ` +
        `Balance: ${newBal.toLocaleString()}`
    );

    return;
  }

  // Refresh timeout
  setSession(
    threadID,
    senderID,
    session
  );

  await reply(
    api,
    threadID,
    `🃏 Dealer: ${renderHand(
      dealerHand,
      true
    )}\n` +
      `You: ${renderHand(
        playerHand
      )} (${pScore})\n\n` +
      `Reply "!hit" or "!stand".`
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

  while (
    dScore < 17 &&
    deck.length > 0
  ) {
    dealerHand.push(
      deck.pop()
    );

    dScore =
      calcScore(dealerHand);
  }

  let text;
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

    text =
      `🎉 WIN! ` +
      `Dealer: ${renderHand(dealerHand)} (${dScore}) | ` +
      `You: ${renderHand(playerHand)} (${pScore})\n` +
      `Won ${winnings.toLocaleString()} coins! ` +
      `Balance: ${newBal.toLocaleString()}`;
  } else if (
    pScore === dScore
  ) {
    const newBal =
      await db.addBalance(
        threadID,
        senderID,
        bet
      );

    text =
      `👔 PUSH! ` +
      `Dealer: ${renderHand(dealerHand)} (${dScore}) | ` +
      `You: ${renderHand(playerHand)} (${pScore})\n` +
      `Bet returned. ` +
      `Balance: ${newBal.toLocaleString()}`;
  } else {
    won = false;

    const newBal =
      (
        await db.getUser(
          threadID,
          senderID
        )
      ).balance;

    text =
      `❌ LOSS! ` +
      `Dealer: ${renderHand(dealerHand)} (${dScore}) | ` +
      `You: ${renderHand(playerHand)} (${pScore})\n` +
      `Lost ${bet.toLocaleString()} coins. ` +
      `Balance: ${newBal.toLocaleString()}`;
  }

  if (won !== null) {
    await db.incrementGameStats(
      threadID,
      senderID,
      won
    );
  }

  await reply(
    api,
    threadID,
    text
  );
}

// ------------------------------------------------------------
// 8BALL
// ------------------------------------------------------------

const EIGHTBALL_RESPONSES = [
  '🟢 It is certain.',
  '🟢 Without a doubt, the signs point to yes.',
  '🟢 Yes, definitely.',
  '🟢 You may rely on it.',
  '🟢 As I see it, yes.',
  '🟡 Reply hazy, try again.',
  '🟡 Ask again later.',
  '🟡 Better not tell you now.',
  '🟡 Cannot predict now.',
  "🔴 Don't count on it.",
  '🔴 My reply is no.',
  '🔴 My sources say no.',
  '🔴 Very doubtful.'
];

async function handleEightball(
  api,
  event,
  question
) {
  const { threadID } = event;

  if (!question) {
    await reply(
      api,
      threadID,
      '❌ Usage: !8ball <question>'
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

  await reply(
    api,
    threadID,
    `🎱 ${question}\n🔮 ${answer}`
  );
}

// ------------------------------------------------------------
// GAMES LIST
// ------------------------------------------------------------

async function handleGamesList(
  api,
  event
) {
  await reply(
    api,
    event.threadID,
    '🎮 Mini-Games\n' +
      '!trivia — answer for coins\n' +
      '!rps <rock/paper/scissors> [bet]\n' +
      '!roll <bet> OR !roll <sides> <bet> — 55%+ wins 2x\n' +
      '!guess <1-10> <bet> — 5x payout\n' +
      '!coinflip <bet> <heads/tails> — 2x\n' +
      '!slots <bet>\n' +
      '!blackjack <bet>\n' +
      '!8ball <question>'
  );
}

// ------------------------------------------------------------
// ROUTER
// ------------------------------------------------------------

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
      originalText || text || ''
    ).trim();

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

    // Trivia answer
    if (
      session.type === 'trivia' &&
      /^[abcd]$/i.test(
        cleanText.replace(
          /^!/,
          ''
        )
      )
    ) {
      await resolveTrivia(
        api,
        event,
        session,
        cleanText.replace(
          /^!/,
          ''
        )
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
  // COMMANDS
  // ----------------------------------------------------------

  if (cleanText === '!games') {
    await handleGamesList(
      api,
      event
    );

    return true;
  }

  if (cleanText === '!trivia') {
    await handleTrivia(
      api,
      event
    );

    return true;
  }

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

  if (
    cleanText === '!8ball' ||
    cleanText.startsWith('!8ball ')
  ) {
    const question =
      original
        .slice('!8ball'.length)
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

// ------------------------------------------------------------
// EXPORT
// ------------------------------------------------------------

module.exports = {
  handleGamesCommand
};
