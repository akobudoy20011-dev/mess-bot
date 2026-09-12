/**
 * economy.js
 * ==========
 * Ported from cogs/economy.py. Same numbers, same rules —
 * per-thread instead of per-guild, and Postgres instead of SQLite.
 *
 * Commands:
 * !balance / !bal
 * !daily
 * !work
 * !pay <amount>       — reply to someone's message
 * !leaderboard / !lb
 * !shop
 * !buy <item>
 * !inventory / !inv
 *
 * ADMIN:
 * !addmoney <amount>  — adds money to yourself
 */

const db = require('./db');
const { reply, fmtTime } = require('./util');

// ============================================================
// ADMIN CONFIG
// ============================================================

const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
);

function isAdmin(senderID) {
  return ADMIN_IDS.has(String(senderID));
}

// ============================================================
// ECONOMY CONSTANTS
// ============================================================

const DAILY_AMOUNT = 200;
const DAILY_STREAK_BONUS = 25;
const DAILY_STREAK_CAP = 20;

const DAILY_COOLDOWN_MS = 24 * 3600 * 1000;
const DAILY_GRACE_MS = 48 * 3600 * 1000;

const WORK_MIN = 50;
const WORK_MAX = 150;
const WORK_COOLDOWN_MS = 3600 * 1000;

// ============================================================
// SHOP
// ============================================================

const SHOP_ITEMS = {
  cookie: {
    name: '🍪 Cookie',
    price: 100
  },

  crown: {
    name: '👑 Crown',
    price: 1000
  },

  diamond: {
    name: '💎 Diamond',
    price: 2500
  },

  trophy: {
    name: '🏆 Trophy',
    price: 5000
  },

  mystery_box: {
    name: '🎁 Mystery Box',
    price: 2500
  }
};

// ============================================================
// HELPERS
// ============================================================

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
// BALANCE
// ============================================================

async function handleBalance(api, event) {
  const { threadID, senderID } = event;

  const user = await db.getUser(threadID, senderID);

  await reply(
    api,
    threadID,
    `💰 Balance: ${user.balance.toLocaleString()} coins`
  );
}

// ============================================================
// DAILY
// ============================================================

async function handleDaily(api, event) {
  const { threadID, senderID } = event;

  const user = await db.getUser(threadID, senderID);

  const now = Date.now();
  const last = user.last_daily
    ? Number(user.last_daily)
    : null;

  // Still on cooldown
  if (last !== null && now - last < DAILY_COOLDOWN_MS) {
    const remaining =
      (DAILY_COOLDOWN_MS - (now - last)) / 1000;

    await reply(
      api,
      threadID,
      `⏳ Already claimed. Come back in ${fmtTime(remaining)}.`
    );

    return;
  }

  // Calculate streak
  let streak;

  if (
    last !== null &&
    now - last <= DAILY_GRACE_MS
  ) {
    streak = Math.min(
      user.daily_streak + 1,
      9999
    );
  } else {
    streak = 1;
  }

  const bonus =
    Math.min(streak, DAILY_STREAK_CAP) *
    DAILY_STREAK_BONUS;

  const reward =
    DAILY_AMOUNT + bonus;

  const newBalance =
    await db.addBalance(
      threadID,
      senderID,
      reward
    );

  await db.updateUser(
    threadID,
    senderID,
    {
      last_daily: now,
      daily_streak: streak
    }
  );

  await reply(
    api,
    threadID,
    `🎁 Daily reward: +${reward.toLocaleString()} coins\n` +
    `🔥 Streak: ${streak} day${streak !== 1 ? 's' : ''}\n` +
    `💰 Balance: ${newBalance.toLocaleString()}`
  );
}

// ============================================================
// WORK
// ============================================================

async function handleWork(api, event) {
  const { threadID, senderID } = event;

  const user = await db.getUser(
    threadID,
    senderID
  );

  const now = Date.now();

  const last = user.last_work
    ? Number(user.last_work)
    : null;

  if (
    last !== null &&
    now - last < WORK_COOLDOWN_MS
  ) {
    const remaining =
      (WORK_COOLDOWN_MS - (now - last)) / 1000;

    await reply(
      api,
      threadID,
      `😴 You're tired. Try again in ${fmtTime(remaining)}.`
    );

    return;
  }

  const earned =
    randInt(WORK_MIN, WORK_MAX);

  const newBalance =
    await db.addBalance(
      threadID,
      senderID,
      earned
    );

  await db.updateUser(
    threadID,
    senderID,
    {
      last_work: now
    }
  );

  await reply(
    api,
    threadID,
    `🛠️ Work complete: +${earned} coins\n` +
    `💰 Balance: ${newBalance.toLocaleString()}`
  );
}

// ============================================================
// PAY
// !pay <amount>
// Must reply to recipient's message
// ============================================================

async function handlePay(api, event, args) {
  const {
    threadID,
    senderID,
    messageReply
  } = event;

  const amount =
    parseInt(args[0], 10);

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    await reply(
      api,
      threadID,
      '❌ Usage: reply to their message with `!pay <amount>`'
    );

    return;
  }

  if (
    !messageReply ||
    !messageReply.senderID
  ) {
    await reply(
      api,
      threadID,
      "❌ Reply to the person's message to pay them: `!pay <amount>`"
    );

    return;
  }

  const recipientID =
    messageReply.senderID;

  if (recipientID === senderID) {
    await reply(
      api,
      threadID,
      "❌ You can't pay yourself."
    );

    return;
  }

  const sender =
    await db.getUser(
      threadID,
      senderID
    );

  if (sender.balance < amount) {
    await reply(
      api,
      threadID,
      `💸 You only have ${sender.balance.toLocaleString()} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -amount
  );

  await db.addBalance(
    threadID,
    recipientID,
    amount
  );

  await reply(
    api,
    threadID,
    `💸 Sent ${amount.toLocaleString()} coins.`
  );
}

// ============================================================
// LEADERBOARD
// ============================================================

async function handleLeaderboard(api, event) {
  const { threadID } = event;

  const top =
    await db.leaderboard(
      threadID,
      10
    );

  if (top.length === 0) {
    await reply(
      api,
      threadID,
      'No economy data yet.'
    );

    return;
  }

  const medals = [
    '🥇',
    '🥈',
    '🥉'
  ];

  const lines =
    top.map((row, i) => {
      const prefix =
        i < 3
          ? medals[i]
          : `${i + 1}.`;

      return (
        `${prefix} ${row.user_id} — ` +
        `💰 ${row.balance.toLocaleString()}`
      );
    });

  await reply(
    api,
    threadID,
    `🏆 Coin Leaderboard\n${lines.join('\n')}`
  );
}

// ============================================================
// SHOP
// ============================================================

async function handleShop(api, event) {
  const { threadID } = event;

  const lines =
    Object.entries(SHOP_ITEMS).map(
      ([id, item]) =>
        `${item.name}\n` +
        `!buy ${id} — 💰 ${item.price.toLocaleString()}`
    );

  await reply(
    api,
    threadID,
    `🛒 Shop\n\n${lines.join('\n\n')}`
  );
}

// ============================================================
// BUY
// ============================================================

async function handleBuy(api, event, args) {
  const {
    threadID,
    senderID
  } = event;

  const itemId =
    (args[0] || '').toLowerCase();

  const item =
    SHOP_ITEMS[itemId];

  if (!item) {
    await reply(
      api,
      threadID,
      "❌ That item doesn't exist. Use !shop."
    );

    return;
  }

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  if (user.balance < item.price) {
    await reply(
      api,
      threadID,
      `💸 You need ${item.price.toLocaleString()} coins.`
    );

    return;
  }

  await db.addBalance(
    threadID,
    senderID,
    -item.price
  );

  await db.addItem(
    threadID,
    senderID,
    itemId,
    1
  );

  const newBalance =
    (
      await db.getUser(
        threadID,
        senderID
      )
    ).balance;

  await reply(
    api,
    threadID,
    `🛒 Bought ${item.name}!\n` +
    `💰 Balance: ${newBalance.toLocaleString()}`
  );
}

// ============================================================
// INVENTORY
// ============================================================

async function handleInventory(api, event) {
  const {
    threadID,
    senderID
  } = event;

  const items =
    await db.getInventory(
      threadID,
      senderID
    );

  const entries =
    Object.entries(items)
      .filter(([id]) => SHOP_ITEMS[id]);

  if (entries.length === 0) {
    await reply(
      api,
      threadID,
      '🎒 Your inventory is empty.'
    );

    return;
  }

  const lines =
    entries.map(
      ([id, amount]) =>
        `${SHOP_ITEMS[id].name} × ${amount}`
    );

  await reply(
    api,
    threadID,
    `🎒 Inventory\n${lines.join('\n')}`
  );
}

// ============================================================
// ADMIN — ADD MONEY TO YOURSELF
// !addmoney <amount>
// ============================================================

async function handleAddMoney(api, event, args) {
  const {
    threadID,
    senderID
  } = event;

  // ADMIN CHECK
  if (!isAdmin(senderID)) {
    await reply(
      api,
      threadID,
      '❌ You do not have permission to use this command.'
    );

    return;
  }

  const amount =
    parseInt(args[0], 10);

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    await reply(
      api,
      threadID,
      '❌ Usage: !addmoney <amount>'
    );

    return;
  }

  const newBalance =
    await db.addBalance(
      threadID,
      senderID,
      amount
    );

  await reply(
    api,
    threadID,
    `👑 Admin money added!\n` +
    `💰 +${amount.toLocaleString()} coins\n` +
    `💳 Balance: ${newBalance.toLocaleString()} coins`
  );
}

// ============================================================
// COMMAND ROUTER
// ============================================================

async function handleEconomyCommand(
  api,
  event,
  text,
  originalText
) {
  // Make sure text is safe
  text =
    String(text || '')
      .trim()
      .toLowerCase();

  originalText =
    String(originalText || text)
      .trim();

  // ----------------------------------------------------------
  // BALANCE
  // ----------------------------------------------------------

  if (
    text === '!balance' ||
    text === '!bal'
  ) {
    await handleBalance(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // DAILY
  // ----------------------------------------------------------

  if (text === '!daily') {
    await handleDaily(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // WORK
  // ----------------------------------------------------------

  if (text === '!work') {
    await handleWork(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // PAY
  // ----------------------------------------------------------

  if (text.startsWith('!pay ')) {
    const args =
      originalText
        .slice('!pay '.length)
        .trim()
        .split(/\s+/);

    await handlePay(
      api,
      event,
      args
    );

    return true;
  }

  // ----------------------------------------------------------
  // LEADERBOARD
  // ----------------------------------------------------------

  if (
    text === '!leaderboard' ||
    text === '!lb'
  ) {
    await handleLeaderboard(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // SHOP
  // ----------------------------------------------------------

  if (text === '!shop') {
    await handleShop(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // BUY
  // ----------------------------------------------------------

  if (text.startsWith('!buy ')) {
    const args =
      originalText
        .slice('!buy '.length)
        .trim()
        .split(/\s+/);

    await handleBuy(
      api,
      event,
      args
    );

    return true;
  }

  // ----------------------------------------------------------
  // INVENTORY
  // ----------------------------------------------------------

  if (
    text === '!inventory' ||
    text === '!inv'
  ) {
    await handleInventory(
      api,
      event
    );

    return true;
  }

  // ----------------------------------------------------------
  // ADMIN ADD MONEY
  // ----------------------------------------------------------

  if (text.startsWith('!addmoney ')) {
    const args =
      originalText
        .slice('!addmoney '.length)
        .trim()
        .split(/\s+/);

    await handleAddMoney(
      api,
      event,
      args
    );

    return true;
  }

  return false;
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  handleEconomyCommand
};
