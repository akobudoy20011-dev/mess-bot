/**
 * economy.js
 * ==========
 * Messenger Economy System
 *
 * Commands:
 *   !balance / !bal
 *   !daily
 *   !work
 *   !pay <amount>       — reply to someone's message
 *   !leaderboard / !lb
 *   !shop
 *   !buy <item>
 *   !inventory / !inv
 *
 * Admin:
 *   !addmoney <amount>
 *
 * Design:
 *   - Consistent boxed Messenger UI
 *   - Display names instead of raw user IDs
 *   - Wallet + bank + total money display
 *   - Clean success/error/status messages
 *   - Compatible with the current db.js
 *
 * NOTE:
 * This is a virtual game economy.
 * No real-money wagering is used.
 */

const db = require("./db");
const { reply, fmtTime } = require("./util");

// ============================================================================
// ADMIN CONFIGURATION
// ============================================================================

const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

function isAdmin(senderID) {
  return ADMIN_IDS.has(String(senderID));
}

// ============================================================================
// ECONOMY CONSTANTS
// ============================================================================

const DAILY_AMOUNT = 200;
const DAILY_STREAK_BONUS = 25;
const DAILY_STREAK_CAP = 20;

const DAILY_COOLDOWN_MS =
  24 * 60 * 60 * 1000;

const DAILY_GRACE_MS =
  48 * 60 * 60 * 1000;

const WORK_MIN = 50;
const WORK_MAX = 150;

const WORK_COOLDOWN_MS =
  60 * 60 * 1000;

// ============================================================================
// SHOP
// ============================================================================

const SHOP_ITEMS = {
  cookie: {
    name: "🍪 Cookie",
    price: 100,
  },

  crown: {
    name: "👑 Crown",
    price: 1000,
  },

  diamond: {
    name: "💎 Diamond",
    price: 2500,
  },

  trophy: {
    name: "🏆 Trophy",
    price: 5000,
  },

  mystery_box: {
    name: "🎁 Mystery Box",
    price: 2500,
  },
};

// ============================================================================
// DISPLAY HELPERS
// ============================================================================

function formatCoins(amount) {
  return Number(amount || 0).toLocaleString();
}

function getDisplayName(user) {
  if (
    user &&
    user.display_name &&
    String(user.display_name).trim()
  ) {
    return String(user.display_name).trim();
  }

  if (user && user.user_id) {
    return `Player ${user.user_id}`;
  }

  return "Player";
}

function createBox(title, lines = []) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    `        ${title}`,
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    ...lines,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function createError(message) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    "          ❌ ERROR",
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    message,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// ============================================================================
// RANDOM INTEGER
// ============================================================================

function randInt(min, max) {
  return (
    Math.floor(
      Math.random() * (max - min + 1)
    ) + min
  );
}

// ============================================================================
// BALANCE
// ============================================================================

async function handleBalance(api, event) {
  const {
    threadID,
    senderID,
  } = event;

  const user = await db.getUser(
    threadID,
    senderID
  );

  const wallet =
    Number(user.balance) || 0;

  const bank =
    Number(user.bank_balance) || 0;

  const total =
    wallet + bank;

  const name =
    getDisplayName(user);

  await reply(
    api,
    threadID,
    createBox(
      "💰 WALLET",
      [
        `👤 ${name}`,
        "",
        `💵 Wallet: ${formatCoins(wallet)} coins`,
        `🏦 Bank: ${formatCoins(bank)} coins`,
        `💎 Total: ${formatCoins(total)} coins`,
      ]
    )
  );
}

// ============================================================================
// DAILY
// ============================================================================

async function handleDaily(api, event) {
  const {
    threadID,
    senderID,
  } = event;

  const user = await db.getUser(
    threadID,
    senderID
  );

  const now = Date.now();

  const last =
    user.last_daily
      ? Number(user.last_daily)
      : null;

  // --------------------------------------------------------------------------
  // COOLDOWN
  // --------------------------------------------------------------------------

  if (
    last !== null &&
    now - last < DAILY_COOLDOWN_MS
  ) {
    const remaining =
      (DAILY_COOLDOWN_MS -
        (now - last)) /
      1000;

    await reply(
      api,
      threadID,
      createBox(
        "⏳ DAILY",
        [
          "You've already claimed",
          "your daily reward.",
          "",
          `🕐 Come back in ${fmtTime(remaining)}.`,
          "",
          "🔥 Keep your streak alive!",
        ]
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // STREAK
  // --------------------------------------------------------------------------

  let streak;

  if (
    last !== null &&
    now - last <= DAILY_GRACE_MS
  ) {
    streak = Math.min(
      Number(user.daily_streak || 0) + 1,
      9999
    );
  } else {
    streak = 1;
  }

  // --------------------------------------------------------------------------
  // REWARD
  // --------------------------------------------------------------------------

  const bonus =
    Math.min(
      streak,
      DAILY_STREAK_CAP
    ) *
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
      daily_streak: streak,
    }
  );

  const streakText =
    `${streak} day${streak !== 1 ? "s" : ""}`;

  await reply(
    api,
    threadID,
    createBox(
      "🎁 DAILY REWARD",
      [
        "✨ Your daily reward has arrived!",
        "",
        `💰 Base reward: +${formatCoins(DAILY_AMOUNT)}`,
        `🔥 Streak bonus: +${formatCoins(bonus)}`,
        `🎁 Total earned: +${formatCoins(reward)}`,
        "",
        `🔥 Streak: ${streakText}`,
        `💵 Balance: ${formatCoins(newBalance)} coins`,
      ]
    )
  );
}

// ============================================================================
// WORK
// ============================================================================

async function handleWork(api, event) {
  const {
    threadID,
    senderID,
  } = event;

  const user = await db.getUser(
    threadID,
    senderID
  );

  const now = Date.now();

  const last =
    user.last_work
      ? Number(user.last_work)
      : null;

  // --------------------------------------------------------------------------
  // COOLDOWN
  // --------------------------------------------------------------------------

  if (
    last !== null &&
    now - last < WORK_COOLDOWN_MS
  ) {
    const remaining =
      (WORK_COOLDOWN_MS -
        (now - last)) /
      1000;

    await reply(
      api,
      threadID,
      createBox(
        "😴 WORK",
        [
          "You've worked enough for now.",
          "",
          `⏳ Try again in ${fmtTime(remaining)}.`,
          "",
          "Take a little break.",
        ]
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // PAYOUT
  // --------------------------------------------------------------------------

  const earned =
    randInt(
      WORK_MIN,
      WORK_MAX
    );

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
      last_work: now,
    }
  );

  await reply(
    api,
    threadID,
    createBox(
      "🛠️ WORK COMPLETE",
      [
        "💼 You finished your shift.",
        "",
        `💰 Earned: +${formatCoins(earned)} coins`,
        `💵 Balance: ${formatCoins(newBalance)} coins`,
      ]
    )
  );
}

// ============================================================================
// PAY
// !pay <amount>
// Must reply to recipient's message
// ============================================================================

async function handlePay(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID,
    messageReply,
  } = event;

  const amount =
    parseInt(
      args[0],
      10
    );

  // --------------------------------------------------------------------------
  // INVALID AMOUNT
  // --------------------------------------------------------------------------

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    await reply(
      api,
      threadID,
      createError(
        "Usage: reply to someone's message with\n`!pay <amount>`"
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // NO REPLY
  // --------------------------------------------------------------------------

  if (
    !messageReply ||
    !messageReply.senderID
  ) {
    await reply(
      api,
      threadID,
      createError(
        "Reply to the person's message to pay them.\n\nExample:\n!pay 500"
      )
    );

    return;
  }

  const recipientID =
    String(
      messageReply.senderID
    );

  const senderIDString =
    String(senderID);

  // --------------------------------------------------------------------------
  // SELF PAYMENT
  // --------------------------------------------------------------------------

  if (
    recipientID ===
    senderIDString
  ) {
    await reply(
      api,
      threadID,
      createError(
        "You can't transfer coins to yourself."
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // LOAD USERS
  // --------------------------------------------------------------------------

  const sender =
    await db.getUser(
      threadID,
      senderID
    );

  const recipient =
    await db.getUser(
      threadID,
      recipientID
    );

  const senderBalance =
    Number(sender.balance) || 0;

  if (
    senderBalance < amount
  ) {
    await reply(
      api,
      threadID,
      createBox(
        "💸 PAYMENT",
        [
          "Transfer failed.",
          "",
          `💰 Your balance: ${formatCoins(senderBalance)} coins`,
          `💵 Required: ${formatCoins(amount)} coins`,
          "",
          `You need ${formatCoins(
            amount - senderBalance
          )} more coins.`,
        ]
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // TRANSFER
  // --------------------------------------------------------------------------

  try {
    await db.transfer(
      threadID,
      senderIDString,
      recipientID,
      amount
    );
  } catch (error) {
    console.error(
      "Payment transfer failed:",
      error
    );

    await reply(
      api,
      threadID,
      createError(
        error.message ||
          "The payment could not be completed."
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // GET UPDATED BALANCE
  // --------------------------------------------------------------------------

  const updatedSender =
    await db.getUser(
      threadID,
      senderID
    );

  const updatedRecipient =
    await db.getUser(
      threadID,
      recipientID
    );

  const senderName =
    getDisplayName(
      updatedSender
    );

  const recipientName =
    getDisplayName(
      updatedRecipient
    );

  await reply(
    api,
    threadID,
    createBox(
      "💸 PAYMENT SENT",
      [
        `👤 From: ${senderName}`,
        `🎯 To: ${recipientName}`,
        "",
        `💰 Amount: ${formatCoins(amount)} coins`,
        "",
        `💵 Your balance: ${formatCoins(
          updatedSender.balance
        )} coins`,
      ]
    )
  );
}

// ============================================================================
// LEADERBOARD
// ============================================================================

async function handleLeaderboard(
  api,
  event
) {
  const {
    threadID,
  } = event;

  const top =
    await db.leaderboard(
      threadID,
      10
    );

  if (
    top.length === 0
  ) {
    await reply(
      api,
      threadID,
      createBox(
        "🏆 LEADERBOARD",
        [
          "No economy data yet.",
          "",
          "Start earning coins with",
          "`!daily` or `!work`.",
        ]
      )
    );

    return;
  }

  const medals = [
    "🥇",
    "🥈",
    "🥉",
  ];

  const lines = [];

  top.forEach(
    (row, index) => {
      const position =
        index < 3
          ? medals[index]
          : `${index + 1}.`;

      const name =
        row.display_name &&
        String(row.display_name).trim()
          ? String(row.display_name).trim()
          : `Player ${row.user_id}`;

      const balance =
        Number(row.balance) || 0;

      lines.push(
        `${position} ${name}`,
        `   💰 ${formatCoins(balance)} coins`,
        ""
      );
    }
  );

  await reply(
    api,
    threadID,
    createBox(
      "🏆 RICHEST PLAYERS",
      lines
    )
  );
}

// ============================================================================
// SHOP
// ============================================================================

async function handleShop(
  api,
  event
) {
  const {
    threadID,
  } = event;

  const lines = [
    "🛍️ Spend your coins on collectibles.",
    "",
  ];

  Object.entries(
    SHOP_ITEMS
  ).forEach(
    ([id, item], index) => {
      lines.push(
        `${index + 1}. ${item.name}`,
        `   💰 ${formatCoins(item.price)} coins`,
        `   🛒 !buy ${id}`,
        ""
      );
    }
  );

  lines.push(
    "💡 Buy an item with the command shown above."
  );

  await reply(
    api,
    threadID,
    createBox(
      "🛒 SHOP",
      lines
    )
  );
}

// ============================================================================
// BUY
// ============================================================================

async function handleBuy(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID,
  } = event;

  const itemId =
    String(
      args[0] || ""
    )
      .trim()
      .toLowerCase();

  // --------------------------------------------------------------------------
  // INVALID ITEM
  // --------------------------------------------------------------------------

  if (!itemId) {
    await reply(
      api,
      threadID,
      createError(
        "Usage: !buy <item>\n\nUse `!shop` to see available items."
      )
    );

    return;
  }

  const item =
    SHOP_ITEMS[itemId];

  if (!item) {
    await reply(
      api,
      threadID,
      createError(
        "That item doesn't exist.\n\nUse `!shop` to view the available items."
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // USER
  // --------------------------------------------------------------------------

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  const balance =
    Number(user.balance) || 0;

  // --------------------------------------------------------------------------
  // NOT ENOUGH MONEY
  // --------------------------------------------------------------------------

  if (
    balance < item.price
  ) {
    const missing =
      item.price - balance;

    await reply(
      api,
      threadID,
      createBox(
        "🛒 SHOP",
        [
          `You can't afford ${item.name}.`,
          "",
          `💰 Price: ${formatCoins(item.price)} coins`,
          `💵 Balance: ${formatCoins(balance)} coins`,
          `📉 Missing: ${formatCoins(missing)} coins`,
        ]
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // PURCHASE
  // --------------------------------------------------------------------------

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

  const updatedUser =
    await db.getUser(
      threadID,
      senderID
    );

  const newBalance =
    Number(
      updatedUser.balance
    ) || 0;

  await reply(
    api,
    threadID,
    createBox(
      "🛍️ PURCHASE COMPLETE",
      [
        `👤 ${getDisplayName(updatedUser)}`,
        "",
        `🎁 Item: ${item.name}`,
        `💰 Price: ${formatCoins(item.price)} coins`,
        "",
        `💵 Balance: ${formatCoins(newBalance)} coins`,
        "",
        "✨ Added to your inventory!",
      ]
    )
  );
}

// ============================================================================
// INVENTORY
// ============================================================================

async function handleInventory(
  api,
  event
) {
  const {
    threadID,
    senderID,
  } = event;

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  const items =
    await db.getInventory(
      threadID,
      senderID
    );

  const entries =
    Object.entries(items)
      .filter(
        ([id]) =>
          SHOP_ITEMS[id]
      );

  // --------------------------------------------------------------------------
  // EMPTY
  // --------------------------------------------------------------------------

  if (
    entries.length === 0
  ) {
    await reply(
      api,
      threadID,
      createBox(
        "🎒 INVENTORY",
        [
          `👤 ${getDisplayName(user)}`,
          "",
          "Your inventory is empty.",
          "",
          "Visit `!shop` to buy items.",
        ]
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // ITEMS
  // --------------------------------------------------------------------------

  const lines = [
    `👤 ${getDisplayName(user)}`,
    "",
  ];

  entries.forEach(
    ([id, amount]) => {
      lines.push(
        `${SHOP_ITEMS[id].name} × ${amount}`,
        ""
      );
    }
  );

  lines.push(
    `📦 ${entries.length} item type${
      entries.length !== 1
        ? "s"
        : ""
    } collected`
  );

  await reply(
    api,
    threadID,
    createBox(
      "🎒 INVENTORY",
      lines
    )
  );
}

// ============================================================================
// ADMIN — ADD MONEY
// !addmoney <amount>
// ============================================================================

async function handleAddMoney(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID,
  } = event;

  // --------------------------------------------------------------------------
  // ADMIN CHECK
  // --------------------------------------------------------------------------

  if (
    !isAdmin(senderID)
  ) {
    await reply(
      api,
      threadID,
      createError(
        "You do not have permission to use this command."
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // AMOUNT
  // --------------------------------------------------------------------------

  const amount =
    parseInt(
      args[0],
      10
    );

  if (
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    await reply(
      api,
      threadID,
      createError(
        "Usage: !addmoney <amount>"
      )
    );

    return;
  }

  // --------------------------------------------------------------------------
  // ADD
  // --------------------------------------------------------------------------

  const newBalance =
    await db.addBalance(
      threadID,
      senderID,
      amount
    );

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  await reply(
    api,
    threadID,
    createBox(
      "👑 ADMIN REWARD",
      [
        `👤 ${getDisplayName(user)}`,
        "",
        `💰 Added: +${formatCoins(amount)} coins`,
        `💳 Balance: ${formatCoins(newBalance)} coins`,
      ]
    )
  );
}

// ============================================================================
// COMMAND ROUTER
// ============================================================================

async function handleEconomyCommand(
  api,
  event,
  text,
  originalText
) {
  text =
    String(text || "")
      .trim()
      .toLowerCase();

  originalText =
    String(
      originalText || text
    ).trim();

  // ==========================================================================
  // BALANCE
  // ==========================================================================

  if (
    text === "!balance" ||
    text === "!bal"
  ) {
    await handleBalance(
      api,
      event
    );

    return true;
  }

  // ==========================================================================
  // DAILY
  // ==========================================================================

  if (
    text === "!daily"
  ) {
    await handleDaily(
      api,
      event
    );

    return true;
  }

  // ==========================================================================
  // WORK
  // ==========================================================================

  if (
    text === "!work"
  ) {
    await handleWork(
      api,
      event
    );

    return true;
  }

  // ==========================================================================
  // PAY
  // ==========================================================================

  if (
    text === "!pay" ||
    text.startsWith("!pay ")
  ) {
    const args =
      originalText
        .slice("!pay".length)
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    await handlePay(
      api,
      event,
      args
    );

    return true;
  }

  // ==========================================================================
  // LEADERBOARD
  // ==========================================================================

  if (
    text === "!leaderboard" ||
    text === "!lb"
  ) {
    await handleLeaderboard(
      api,
      event
    );

    return true;
  }

  // ==========================================================================
  // SHOP
  // ==========================================================================

  if (
    text === "!shop"
  ) {
    await handleShop(
      api,
      event
    );

    return true;
  }

  // ==========================================================================
  // BUY
  // ==========================================================================

  if (
    text === "!buy" ||
    text.startsWith("!buy ")
  ) {
    const args =
      originalText
        .slice("!buy".length)
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    await handleBuy(
      api,
      event,
      args
    );

    return true;
  }

  // ==========================================================================
  // INVENTORY
  // ==========================================================================

  if (
    text === "!inventory" ||
    text === "!inv"
  ) {
    await handleInventory(
      api,
      event
    );

    return true;
  }

  // ==========================================================================
  // ADMIN — ADD MONEY
  // ==========================================================================

  if (
    text === "!addmoney" ||
    text.startsWith("!addmoney ")
  ) {
    const args =
      originalText
        .slice("!addmoney".length)
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    await handleAddMoney(
      api,
      event,
      args
    );

    return true;
  }

  // ==========================================================================
  // NOT AN ECONOMY COMMAND
  // ==========================================================================

  return false;
}

// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  handleEconomyCommand,
};
