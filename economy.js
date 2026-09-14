/**
 * economy.js
 * ==========
 * Messenger Economy System
 *
 * Commands:
 *   !balance / !bal
 *   !bank
 *   !deposit / !dep <amount|all>
 *   !withdraw / !wd <amount|all>
 *   !daily
 *   !work
 *   !pay <amount>       — reply to someone's message
 *   !leaderboard / !lb
 *   !shop
 *   !buy <item>
 *   !inventory / !inv
 *   !use <item>
 *
 * Admin:
 *   !addmoney <amount>
 *   !removemoney <amount>
 *   !setmoney <amount>
 *   !addbank <amount>
 *   !removebank <amount>
 *   !setbank <amount>
 *   !addxp <amount>
 *   !removexp <amount>
 *   !setxp <amount>
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
const {
  getShopLines,
  resolveRpgItem,
  buyRpgItem,
  getRpgInventory,
  useRpgItem
} = require("./rpg/shop");

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
// DISPLAY & UTILITY HELPERS
// ============================================================================

function formatCoins(amount) {
  return Number(amount || 0).toLocaleString();
}

function parseAmountInput(input, maxAmount) {
  if (!input) return 0;

  const str =
    String(input)
      .toLowerCase()
      .trim();

  if (
    str === "all" ||
    str === "max"
  ) {
    return maxAmount;
  }

  const cleaned =
    str.replace(/[^0-9]/g, "");

  const val =
    parseInt(cleaned, 10);

  return isNaN(val)
    ? 0
    : val;
}

function getDisplayName(user) {
  if (
    user &&
    user.display_name &&
    String(user.display_name).trim()
  ) {
    return String(
      user.display_name
    ).trim();
  }

  if (
    user &&
    user.user_id
  ) {
    return `Player ${user.user_id}`;
  }

  return "Player";
}

function createBox(
  title,
  lines = []
) {
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

function randInt(
  min,
  max
) {
  return (
    Math.floor(
      Math.random() *
        (max - min + 1)
    ) + min
  );
}

// ============================================================================
// BALANCE & BANK
// ============================================================================

async function handleBalance(
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
      "💳 BANK ACCOUNT",
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

async function handleDeposit(
  api,
  event,
  args
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

  const wallet =
    Number(user.balance) || 0;

  const bank =
    Number(user.bank_balance) || 0;

  const amount =
    parseAmountInput(
      args[0],
      wallet
    );

  if (amount <= 0) {
    return reply(
      api,
      threadID,
      createError(
        "Specify a valid amount to deposit.\n\nUsage: !deposit <amount|all>"
      )
    );
  }

  if (wallet < amount) {
    return reply(
      api,
      threadID,
      createBox(
        "📥 DEPOSIT FAILED",
        [
          "You do not have enough coins in your wallet.",
          "",
          `💵 Wallet: ${formatCoins(wallet)} coins`,
          `💵 Deposit Amount: ${formatCoins(amount)} coins`,
        ]
      )
    );
  }

  const newWallet =
    wallet - amount;

  const newBank =
    bank + amount;

  await db.updateUser(
    threadID,
    senderID,
    {
      balance: newWallet,
      bank_balance: newBank,
    }
  );

  await reply(
    api,
    threadID,
    createBox(
      "📥 DEPOSIT COMPLETE",
      [
        `💰 Deposited: +${formatCoins(amount)} coins`,
        "",
        `💵 Wallet: ${formatCoins(newWallet)} coins`,
        `🏦 Bank: ${formatCoins(newBank)} coins`,
      ]
    )
  );
}

async function handleWithdraw(
  api,
  event,
  args
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

  const wallet =
    Number(user.balance) || 0;

  const bank =
    Number(user.bank_balance) || 0;

  const amount =
    parseAmountInput(
      args[0],
      bank
    );

  if (amount <= 0) {
    return reply(
      api,
      threadID,
      createError(
        "Specify a valid amount to withdraw.\n\nUsage: !withdraw <amount|all>"
      )
    );
  }

  if (bank < amount) {
    return reply(
      api,
      threadID,
      createBox(
        "📤 WITHDRAW FAILED",
        [
          "You do not have enough coins in your bank balance.",
          "",
          `🏦 Bank Balance: ${formatCoins(bank)} coins`,
          `💵 Requested: ${formatCoins(amount)} coins`,
        ]
      )
    );
  }

  const newWallet =
    wallet + amount;

  const newBank =
    bank - amount;

  await db.updateUser(
    threadID,
    senderID,
    {
      balance: newWallet,
      bank_balance: newBank,
    }
  );

  await reply(
    api,
    threadID,
    createBox(
      "📤 WITHDRAW COMPLETE",
      [
        `💰 Withdrawn: +${formatCoins(amount)} coins`,
        "",
        `💵 Wallet: ${formatCoins(newWallet)} coins`,
        `🏦 Bank: ${formatCoins(newBank)} coins`,
      ]
    )
  );
}

// ============================================================================
// DAILY
// ============================================================================

async function handleDaily(
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

  const now =
    Date.now();

  const last =
    user.last_daily
      ? Number(user.last_daily)
      : null;

  if (
    last !== null &&
    now - last <
      DAILY_COOLDOWN_MS
  ) {
    const remaining =
      (
        DAILY_COOLDOWN_MS -
        (now - last)
      ) / 1000;

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

  let streak;

  if (
    last !== null &&
    now - last <=
      DAILY_GRACE_MS
  ) {
    streak =
      Math.min(
        Number(
          user.daily_streak || 0
        ) + 1,
        9999
      );
  } else {
    streak = 1;
  }

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

async function handleWork(
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

  const now =
    Date.now();

  const last =
    user.last_work
      ? Number(user.last_work)
      : null;

  if (
    last !== null &&
    now - last <
      WORK_COOLDOWN_MS
  ) {
    const remaining =
      (
        WORK_COOLDOWN_MS -
        (now - last)
      ) / 1000;

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
        String(
          row.display_name
        ).trim()
          ? String(
              row.display_name
            ).trim()
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
  const lines = [
    "🛡️ ECLIPSE RPG ITEMS",
    "",
    ...getShopLines(),
    "🎁 COLLECTIBLES",
    "",
    "These legacy economy collectibles remain available:",
    "",
  ];

  Object.entries(
    SHOP_ITEMS
  ).forEach(
    ([id, item]) =>
      lines.push(
        item.name +
          " · " +
          formatCoins(item.price) +
          " coins",
        "   Buy: !buy " +
          id,
        ""
      )
  );

  await reply(
    api,
    event.threadID,
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
  const input =
    String(
      args[0] || ""
    )
      .trim()
      .toLowerCase();

  const quantity =
    Math.max(
      1,
      Math.min(
        99,
        Math.floor(
          Number(args[1]) || 1
        )
      )
    );

  if (!input) {
    await reply(
      api,
      event.threadID,
      createError(
        "Usage: !buy <item number or item id> [quantity]\n\nUse !shop to see available items."
      )
    );

    return;
  }

  const rpgItem =
    resolveRpgItem(input);

  if (
    rpgItem ||
    /^\d+$/.test(input)
  ) {
    try {
      const result =
        await buyRpgItem(
          event.threadID,
          event.senderID,
          input,
          quantity
        );

      await reply(
        api,
        event.threadID,
        createBox(
          "🛍️ RPG PURCHASE COMPLETE",
          [
            "🎁 " +
              result.item.name +
              " ×" +
              result.quantity,

            "💰 Cost: " +
              formatCoins(
                result.total
              ) +
              " coins",

            "💵 Remaining Gold: " +
              formatCoins(
                result.balance
              ) +
              " coins",

            "✨ Added to your RPG inventory.",
          ]
        )
      );
    } catch (error) {
      await reply(
        api,
        event.threadID,
        createError(
          error.message ||
            "The RPG purchase could not be completed."
        )
      );
    }

    return;
  }

  const item =
    SHOP_ITEMS[input];

  if (!item) {
    await reply(
      api,
      event.threadID,
      createError(
        "That item does not exist. Use !shop to view the available items."
      )
    );

    return;
  }

  const user =
    await db.getUser(
      event.threadID,
      event.senderID
    );

  const balance =
    Number(user.balance) || 0;

  if (
    balance <
    item.price
  ) {
    await reply(
      api,
      event.threadID,
      createBox(
        "🛒 SHOP",
        [
          "You cannot afford " +
            item.name +
            ".",
          "",
          "💰 Price: " +
            formatCoins(
              item.price
            ) +
            " coins",

          "💵 Balance: " +
            formatCoins(
              balance
            ) +
            " coins",

          "📉 Missing: " +
            formatCoins(
              item.price -
                balance
            ) +
            " coins",
        ]
      )
    );

    return;
  }

  await db.spendBalance(
    event.threadID,
    event.senderID,
    item.price,
    "Economy shop: " +
      input
  );

  await db.addItem(
    event.threadID,
    event.senderID,
    input,
    1
  );

  const updatedUser =
    await db.getUser(
      event.threadID,
      event.senderID
    );

  await reply(
    api,
    event.threadID,
    createBox(
      "🛍️ PURCHASE COMPLETE",
      [
        "🎁 Item: " +
          item.name,

        "💰 Price: " +
          formatCoins(
            item.price
          ) +
          " coins",

        "",

        "💵 Balance: " +
          formatCoins(
            updatedUser.balance
          ) +
          " coins",

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
  const user =
    await db.getUser(
      event.threadID,
      event.senderID
    );

  const economyItems =
    Object.entries(
      await db.getInventory(
        event.threadID,
        event.senderID
      )
    ).filter(
      ([id]) =>
        SHOP_ITEMS[id]
    );

  const rpgItems =
    await getRpgInventory(
      event.threadID,
      event.senderID
    );

  if (
    !economyItems.length &&
    !rpgItems.length
  ) {
    await reply(
      api,
      event.threadID,
      createBox(
        "🎒 INVENTORY",
        [
          "👤 " +
            getDisplayName(
              user
            ),

          "",

          "Your inventory is empty.",

          "",

          "Visit !shop to buy items.",
        ]
      )
    );

    return;
  }

  const lines = [
    "👤 " +
      getDisplayName(user),
    "",
  ];

  if (rpgItems.length) {
    lines.push(
      "🛡️ RPG ITEMS",
      ""
    );

    for (
      const entry of rpgItems
    ) {
      lines.push(
        (entry.item.emoji ||
          "🎁") +
          " " +
          entry.item.name +
          " ×" +
          entry.quantity,

        "   " +
          entry.item.description,

        ""
      );
    }
  }

  if (economyItems.length) {
    lines.push(
      "🎁 COLLECTIBLES",
      ""
    );

    for (
      const [id, amount]
      of economyItems
    ) {
      lines.push(
        SHOP_ITEMS[id].name +
          " ×" +
          amount,
        ""
      );
    }
  }

  await reply(
    api,
    event.threadID,
    createBox(
      "🎒 INVENTORY",
      lines
    )
  );
}

// ============================================================================
// ADMIN — ECONOMY COMMANDS
// ============================================================================

function parseAdminAmount(
  input,
  allowZero = false
) {
  const raw =
    String(
      input ?? ""
    ).trim();

  if (
    allowZero &&
    raw === "0"
  ) {
    return 0;
  }

  if (!raw) {
    return null;
  }

  const cleaned =
    raw.replace(
      /,/g,
      ""
    );

  if (
    !/^\d+$/.test(cleaned)
  ) {
    return null;
  }

  const amount =
    Number(cleaned);

  if (
    !Number.isSafeInteger(
      amount
    )
  ) {
    return null;
  }

  if (
    allowZero
      ? amount < 0
      : amount <= 0
  ) {
    return null;
  }

  return amount;
}

// ============================================================================
// !addmoney
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

  if (!isAdmin(senderID)) {
    await reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );

    return;
  }

  const amount =
    parseAdminAmount(
      args[0]
    );

  if (
    amount === null
  ) {
    await reply(
      api,
      threadID,
      createError(
        "Usage: !addmoney <amount>\n\nExample:\n!addmoney 1000000"
      )
    );

    return;
  }

  try {
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
        "👑 ADMIN — ADD MONEY",
        [
          `👤 ${getDisplayName(user)}`,
          "",
          `💰 Added: +${formatCoins(amount)} coins`,
          `💵 New Wallet: ${formatCoins(newBalance)} coins`,
        ]
      )
    );
  } catch (error) {
    console.error(
      "[admin addmoney]",
      error
    );

    await reply(
      api,
      threadID,
      createError(
        error.message ||
          "Failed to add money."
      )
    );
  }
}

// ============================================================================
// !removemoney
// ============================================================================

async function handleRemoveMoney(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID,
  } = event;

  if (!isAdmin(senderID)) {
    await reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );

    return;
  }

  const amount =
    parseAdminAmount(
      args[0]
    );

  if (
    amount === null
  ) {
    await reply(
      api,
      threadID,
      createError(
        "Usage: !removemoney <amount>\n\nExample:\n!removemoney 5000"
      )
    );

    return;
  }

  try {
    const user =
      await db.getUser(
        threadID,
        senderID
      );

    const balance =
      Number(
        user.balance
      ) || 0;

    if (
      amount > balance
    ) {
      await reply(
        api,
        threadID,
        createError(
          `You only have ${formatCoins(balance)} coins in your wallet.`
        )
      );

      return;
    }

    const newBalance =
      await db.addBalance(
        threadID,
        senderID,
        -amount
      );

    await reply(
      api,
      threadID,
      createBox(
        "👑 ADMIN — REMOVE MONEY",
        [
          `💸 Removed: -${formatCoins(amount)} coins`,
          `💵 New Wallet: ${formatCoins(newBalance)} coins`,
        ]
      )
    );
  } catch (error) {
    console.error(
      "[admin removemoney]",
      error
    );

    await reply(
      api,
      threadID,
      createError(
        error.message ||
          "Failed to remove money."
      )
    );
  }
}

// ============================================================================
// !setmoney
// ============================================================================

async function handleSetMoney(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID,
  } = event;

  if (!isAdmin(senderID)) {
    await reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );

    return;
  }

  const amount =
    parseAdminAmount(
      args[0],
      true
    );

  if (
    amount === null
  ) {
    await reply(
      api,
      threadID,
      createError(
        "Usage: !setmoney <amount>\n\nExample:\n!setmoney 999999999"
      )
    );

    return;
  }

  try {
    await db.updateUser(
      threadID,
      senderID,
      {
        balance: amount,
      }
    );

    await reply(
      api,
      threadID,
      createBox(
        "👑 ADMIN — SET MONEY",
        [
          `💵 Wallet set to: ${formatCoins(amount)} coins`,
        ]
      )
    );
  } catch (error) {
    console.error(
      "[admin setmoney]",
      error
    );

    await reply(
      api,
      threadID,
      createError(
        error.message ||
          "Failed to set money."
      )
    );
  }
}

// ============================================================================
// BANK ADMIN
// ============================================================================

async function handleAdminBank(
  api,
  event,
  args,
  mode
) {
  const {
    threadID,
    senderID,
  } = event;

  if (!isAdmin(senderID)) {
    await reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );

    return;
  }

  const amount =
    parseAdminAmount(
      args[0],
      mode === "setbank"
    );

  if (
    amount === null
  ) {
    await reply(
      api,
      threadID,
      createError(
        `Usage: !${mode} <amount>\n\nExample:\n!${mode} 100000`
      )
    );

    return;
  }

  try {
    const user =
      await db.getUser(
        threadID,
        senderID
      );

    const currentBank =
      Number(
        user.bank_balance
      ) || 0;

    let newBank;

    if (
      mode === "addbank"
    ) {
      newBank =
        currentBank +
        amount;
    }

    else if (
      mode === "removebank"
    ) {
      if (
        amount >
        currentBank
      ) {
        await reply(
          api,
          threadID,
          createError(
            `You only have ${formatCoins(currentBank)} coins in your bank.`
          )
        );

        return;
      }

      newBank =
        currentBank -
        amount;
    }

    else {
      newBank =
        amount;
    }

    if (
      !Number.isSafeInteger(
        newBank
      )
    ) {
      await reply(
        api,
        threadID,
        createError(
          "The resulting bank balance is too large."
        )
      );

      return;
    }

    await db.updateUser(
      threadID,
      senderID,
      {
        bank_balance:
          newBank,
      }
    );

    await reply(
      api,
      threadID,
      createBox(
        `👑 ADMIN — ${mode.toUpperCase()}`,
        [
          `🏦 Bank: ${formatCoins(newBank)} coins`,
        ]
      )
    );
  }

  catch (error) {
    console.error(
      `[admin ${mode}]`,
      error
    );

    await reply(
      api,
      threadID,
      createError(
        error.message ||
          `Failed to execute !${mode}.`
      )
    );
  }
}

// ============================================================================
// XP ADMIN
// ============================================================================

async function handleAdminXp(
  api,
  event,
  args,
  mode
) {
  const {
    threadID,
    senderID,
  } = event;

  if (!isAdmin(senderID)) {
    await reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );

    return;
  }

  const amount =
    parseAdminAmount(
      args[0],
      mode === "setxp"
    );

  if (
    amount === null
  ) {
    await reply(
      api,
      threadID,
      createError(
        `Usage: !${mode} <amount>\n\nExample:\n!${mode} 50000`
      )
    );

    return;
  }

  try {
    const user =
      await db.getUser(
        threadID,
        senderID
      );

    const currentXp =
      Number(
        user.xp
      ) || 0;

    let newXp;

    if (
      mode === "addxp"
    ) {
      newXp =
        currentXp +
        amount;
    }

    else if (
      mode === "removexp"
    ) {
      newXp =
        Math.max(
          0,
          currentXp -
            amount
        );
    }

    else {
      newXp =
        amount;
    }

    if (
      !Number.isSafeInteger(
        newXp
      )
    ) {
      await reply(
        api,
        threadID,
        createError(
          "The resulting XP value is too large."
        )
      );

      return;
    }

    await db.updateUser(
      threadID,
      senderID,
      {
        xp: newXp,
      }
    );

    await reply(
      api,
      threadID,
      createBox(
        `👑 ADMIN — ${mode.toUpperCase()}`,
        [
          `✨ XP: ${formatCoins(newXp)}`,
        ]
      )
    );
  }

  catch (error) {
    console.error(
      `[admin ${mode}]`,
      error
    );

    await reply(
      api,
      threadID,
      createError(
        error.message ||
          `Failed to execute !${mode}.`
      )
    );
  }
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
  // ADMIN ECONOMY COMMAND ROUTER
  // ==========================================================================

  const economyParts =
    originalText
      .split(/\s+/)
      .filter(Boolean);

  const economyCommand =
    String(
      economyParts[0] || ""
    ).toLowerCase();

  const economyArgs =
    economyParts.slice(1);

  if (
    economyCommand ===
    "!addmoney"
  ) {
    await handleAddMoney(
      api,
      event,
      economyArgs
    );

    return true;
  }

  if (
    economyCommand ===
    "!removemoney"
  ) {
    await handleRemoveMoney(
      api,
      event,
      economyArgs
    );

    return true;
  }

  if (
    economyCommand ===
    "!setmoney"
  ) {
    await handleSetMoney(
      api,
      event,
      economyArgs
    );

    return true;
  }

  if (
    economyCommand ===
    "!addbank"
  ) {
    await handleAdminBank(
      api,
      event,
      economyArgs,
      "addbank"
    );

    return true;
  }

  if (
    economyCommand ===
    "!removebank"
  ) {
    await handleAdminBank(
      api,
      event,
      economyArgs,
      "removebank"
    );

    return true;
  }

  if (
    economyCommand ===
    "!setbank"
  ) {
    await handleAdminBank(
      api,
      event,
      economyArgs,
      "setbank"
    );

    return true;
  }

  if (
    economyCommand ===
    "!addxp"
  ) {
    await handleAdminXp(
      api,
      event,
      economyArgs,
      "addxp"
    );

    return true;
  }

  if (
    economyCommand ===
    "!removexp"
  ) {
    await handleAdminXp(
      api,
      event,
      economyArgs,
      "removexp"
    );

    return true;
  }

  if (
    economyCommand ===
    "!setxp"
  ) {
    await handleAdminXp(
      api,
      event,
      economyArgs,
      "setxp"
    );

    return true;
  }

  // ==========================================================================
  // BALANCE / BANK
  // ==========================================================================

  if (
    text === "!balance" ||
    text === "!bal" ||
    text === "!bank"
  ) {
    await handleBalance(
      api,
      event
    );

    return true;
  }

  // ==========================================================================
  // DEPOSIT
  // ==========================================================================

  if (
    text === "!deposit" ||
    text.startsWith(
      "!deposit "
    ) ||
    text === "!dep" ||
    text.startsWith(
      "!dep "
    )
  ) {
    const cmdName =
      text.startsWith(
        "!deposit"
      )
        ? "!deposit"
        : "!dep";

    const args =
      originalText
        .slice(
          cmdName.length
        )
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    await handleDeposit(
      api,
      event,
      args
    );

    return true;
  }

  // ==========================================================================
  // WITHDRAW
  // ==========================================================================

  if (
    text === "!withdraw" ||
    text.startsWith(
      "!withdraw "
    ) ||
    text === "!wd" ||
    text.startsWith(
      "!wd "
    )
  ) {
    const cmdName =
      text.startsWith(
        "!withdraw"
      )
        ? "!withdraw"
        : "!wd";

    const args =
      originalText
        .slice(
          cmdName.length
        )
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    await handleWithdraw(
      api,
      event,
      args
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
    text.startsWith(
      "!pay "
    )
  ) {
    const args =
      originalText
        .slice(
          "!pay".length
        )
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
    text.startsWith(
      "!buy "
    )
  ) {
    const args =
      originalText
        .slice(
          "!buy".length
        )
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
  // STANDALONE RPG CONSUMABLES
  // ==========================================================================

  if (
    text === "!use" ||
    text.startsWith(
      "!use "
    )
  ) {
    const args =
      originalText
        .slice(
          "!use".length
        )
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    try {
      const result =
        await useRpgItem(
          event.threadID,
          event.senderID,
          args[0]
        );

      const effects = [];

      if (
        result.hpRestored
      ) {
        effects.push(
          "❤️ HP +" +
            result.hpRestored
        );
      }

      if (
        result.mpRestored
      ) {
        effects.push(
          "🔷 MP +" +
            result.mpRestored
        );
      }

      await reply(
        api,
        event.threadID,
        createBox(
          "🧪 ITEM USED",
          [
            result.item.emoji +
              " " +
              result.item.name,

            "",

            effects.join(
              " · "
            ) ||
              "No effect.",

            "Remaining: " +
              result.remaining,
          ]
        )
      );
    } catch (error) {
      await reply(
        api,
        event.threadID,
        createError(
          error.message ||
            "That item could not be used."
        )
      );
    }

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
