/**
 * economy.js
 * ==========
 * Messenger Economy System
 *
 * Features:
 * - strict amount parsing
 * - atomic deposit/withdraw via db.js
 * - safer admin arithmetic
 * - safer payment parsing
 * - admin !economy menu
 * - admin !xp menu
 * - admin money/bank/XP commands support @mentions
 * - admin money/bank/XP commands support message replies
 * - preserves RPG shop/inventory integration
 *
 * Admin targeting priority:
 *
 *   1. Reply target
 *      Reply to someone's message:
 *      !removemoney 8000
 *
 *   2. @mention target
 *      !removemoney @user 8000
 *
 *   3. Sender
 *      !removemoney 8000
 *
 * Examples:
 *
 *   !addmoney 5000
 *   !addmoney @user 5000
 *   [reply] !addmoney 5000
 *
 *   !removemoney 5000
 *   !removemoney @user 5000
 *   [reply] !removemoney 5000
 *
 *   !setmoney 5000
 *   !setmoney @user 5000
 *   [reply] !setmoney 5000
 *
 *   !addbank @user 5000
 *   [reply] !addbank 5000
 *
 *   !removebank @user 5000
 *   [reply] !removebank 5000
 *
 *   !setbank @user 5000
 *   [reply] !setbank 5000
 *
 *   !addxp @user 5000
 *   [reply] !addxp 5000
 *
 *   !removexp @user 5000
 *   [reply] !removexp 5000
 *
 *   !setxp @user 5000
 *   [reply] !setxp 5000
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
// ADMIN
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
// CONSTANTS
// ============================================================================

const DAILY_AMOUNT = 200;
const DAILY_STREAK_BONUS = 25;
const DAILY_STREAK_CAP = 20;

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_GRACE_MS = 48 * 60 * 60 * 1000;

const WORK_MIN = 50;
const WORK_MAX = 150;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;

// ============================================================================
// LEGACY SHOP
// ============================================================================

const SHOP_ITEMS = {
  cookie: {
    name: "🍪 Cookie",
    price: 100
  },

  crown: {
    name: "👑 Crown",
    price: 1000
  },

  diamond: {
    name: "💎 Diamond",
    price: 2500
  },

  trophy: {
    name: "🏆 Trophy",
    price: 5000
  },

  mystery_box: {
    name: "🎁 Mystery Box",
    price: 2500
  }
};

// ============================================================================
// HELPERS
// ============================================================================

function formatCoins(amount) {
  return Number(amount || 0).toLocaleString();
}

/**
 * Strict amount parser.
 *
 * Accepted:
 *   500
 *   1,000
 *   all
 *   max
 *
 * Rejected:
 *   500abc
 *   1.5
 *   -500
 *   5k
 *   500.00
 */
function parseAmountInput(input, maxAmount) {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase();

  if (!raw) {
    return null;
  }

  if (raw === "all" || raw === "max") {
    const max = Number(maxAmount);

    if (
      !Number.isSafeInteger(max) ||
      max <= 0
    ) {
      return null;
    }

    return max;
  }

  const normalized = raw.replace(/,/g, "");

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return amount;
}

function parseAdminAmount(input, allowZero = false) {
  const raw = String(input ?? "").trim();

  if (!raw) {
    return null;
  }

  const cleaned = raw.replace(/,/g, "");

  if (!/^\d+$/.test(cleaned)) {
    return null;
  }

  const amount = Number(cleaned);

  if (!Number.isSafeInteger(amount)) {
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

function safeAdd(a, b) {
  const result = Number(a) + Number(b);

  if (
    !Number.isSafeInteger(result) ||
    result < 0
  ) {
    throw new Error(
      "The resulting value is too large."
    );
  }

  return result;
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

function createBox(title, lines = []) {
  return [
    "╭━━━━━━━━━━━━━━━━━━━━╮",
    `        ${title}`,
    "╰━━━━━━━━━━━━━━━━━━━━╯",
    "",
    ...lines,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}

function createCoquetteBox(title, lines = []) {
  return [
    `╭────── 🎀  ${title}  🎀 ──────╮`,
    ...lines,
    "╰────── ♡ ୨୧ 🎀 ୨୧ ♡ ──────╯"
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
    "━━━━━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}

function randInt(min, max) {
  return (
    Math.floor(
      Math.random() *
      (max - min + 1)
    ) + min
  );
}

// ============================================================================
// ADMIN TARGET RESOLUTION
// ============================================================================

/**
 * Get the target user from a Messenger @mention.
 *
 * Normal FCA/ws3-fca format:
 *
 *   event.mentions = {
 *     "123456789": "Username"
 *   }
 *
 * Some versions can expose slightly different structures,
 * so this also supports object entries containing an ID.
 */
function getMentionedUserID(event) {
  const mentions = event?.mentions;

  if (
    !mentions ||
    typeof mentions !== "object"
  ) {
    return null;
  }

  // Standard FCA format:
  // { "123456789": "Username" }
  const ids = Object.keys(mentions);

  if (ids.length) {
    return String(ids[0]);
  }

  // Compatibility with array-based mention formats.
  if (Array.isArray(mentions)) {
    for (const mention of mentions) {
      if (
        !mention ||
        typeof mention !== "object"
      ) {
        continue;
      }

      const id =
        mention.id ??
        mention.userID ??
        mention.userId ??
        mention.senderID ??
        mention.senderId;

      if (id != null) {
        return String(id);
      }
    }
  }

  return null;
}

/**
 * Resolve the target for an admin economy command.
 *
 * Priority:
 *
 * 1. MESSAGE REPLY
 *
 *    Reply to someone's message:
 *
 *      !removemoney 8000
 *
 *    The person whose message was replied to becomes
 *    the target.
 *
 * 2. @MENTION
 *
 *      !removemoney @user 8000
 *
 * 3. SENDER
 *
 *      !removemoney 8000
 *
 *    With no reply or mention, the command affects the
 *    admin who sent it. This preserves the old behavior.
 *
 * The amount is detected from the first numeric argument.
 *
 * Examples:
 *
 *   args = ["8000"]
 *   reply target exists
 *   => target = replied user
 *   => amount = 8000
 *
 *   args = ["@user", "8000"]
 *   mention exists
 *   => target = mentioned user
 *   => amount = 8000
 *
 *   args = ["8000"]
 *   no reply/mention
 *   => target = sender
 *   => amount = 8000
 */
function resolveAdminTarget(event, args) {
  args = Array.isArray(args)
    ? args
    : [];

  // --------------------------------------------------------------------------
  // 1. REPLY TARGET
  // --------------------------------------------------------------------------

  const replyTargetID =
    event?.messageReply?.senderID ??
    event?.messageReply?.senderId ??
    event?.messageReply?.authorID ??
    event?.messageReply?.authorId;

  if (replyTargetID != null) {
    const amountInput =
      args.find((arg) =>
        /^\d[\d,]*$/.test(
          String(arg).trim()
        )
      );

    return {
      targetID: String(replyTargetID),
      amountInput
    };
  }

  // --------------------------------------------------------------------------
  // 2. @MENTION TARGET
  // --------------------------------------------------------------------------

  const mentionedID =
    getMentionedUserID(event);

  if (mentionedID) {
    const amountInput =
      args.find((arg) =>
        /^\d[\d,]*$/.test(
          String(arg).trim()
        )
      );

    return {
      targetID: mentionedID,
      amountInput
    };
  }

  // --------------------------------------------------------------------------
  // 3. DEFAULT TO SENDER
  // --------------------------------------------------------------------------

  return {
    targetID: String(event.senderID),
    amountInput: args[0]
  };
}

async function getTargetUser(
  threadID,
  targetID
) {
  return db.getUser(
    threadID,
    targetID
  );
}

// ============================================================================
// ADMIN MENUS
// ============================================================================

function createEconomyAdminMenu() {
  return createCoquetteBox(
    "ECONOMY ADMIN",
    [
      "୨୧ money",
      "    ♡ !addmoney <amount>",
      "    ♡ !addmoney @user <amount>",
      "    ♡ reply + !addmoney <amount>",
      "    ♡ !removemoney <amount>",
      "    ♡ !removemoney @user <amount>",
      "    ♡ reply + !removemoney <amount>",
      "    ♡ !setmoney <amount>",
      "    ♡ !setmoney @user <amount>",
      "    ♡ reply + !setmoney <amount>",
      "",
      "୨୧ bank",
      "    ♡ !addbank <amount>",
      "    ♡ !addbank @user <amount>",
      "    ♡ reply + !addbank <amount>",
      "    ♡ !removebank <amount>",
      "    ♡ !removebank @user <amount>",
      "    ♡ reply + !removebank <amount>",
      "    ♡ !setbank <amount>",
      "    ♡ !setbank @user <amount>",
      "    ♡ reply + !setbank <amount>",
      "",
      "୨୧ maintenance",
      "    ♡ !resetmoney",
      "    ♡ !resetmoney confirm",
      "    ♡ !resetmoney bank confirm",
      "",
      "୨୧ player economy",
      "    ♡ !balance",
      "    ♡ !bank",
      "    ♡ !leaderboard"
    ]
  );
}

function createXpAdminMenu() {
  return createCoquetteBox(
    "XP ADMIN",
    [
      "୨୧ controls",
      "    ♡ !addxp <amount>",
      "    ♡ !addxp @user <amount>",
      "    ♡ reply + !addxp <amount>",
      "    ♡ !removexp <amount>",
      "    ♡ !removexp @user <amount>",
      "    ♡ reply + !removexp <amount>",
      "    ♡ !setxp <amount>",
      "    ♡ !setxp @user <amount>",
      "    ♡ reply + !setxp <amount>",
      "",
      "୨୧ information",
      "    ♡ add XP directly",
      "    ♡ remove XP directly",
      "    ♡ set XP directly"
    ]
  );
}

// ============================================================================
// BALANCE
// ============================================================================

async function handleBalance(api, event) {
  const {
    threadID,
    senderID
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

  await reply(
    api,
    threadID,
    createBox(
      "💳 BANK ACCOUNT",
      [
        `👤 ${getDisplayName(user)}`,
        "",
        `💵 Wallet: ${formatCoins(wallet)} coins`,
        `🏦 Bank: ${formatCoins(bank)} coins`,
        `💎 Total: ${formatCoins(total)} coins`
      ]
    )
  );
}

// ============================================================================
// DEPOSIT
// ============================================================================

async function handleDeposit(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  const wallet =
    Number(user.balance) || 0;

  const amount =
    parseAmountInput(
      args[0],
      wallet
    );

  if (amount === null) {
    return reply(
      api,
      threadID,
      createError(
        "Specify a valid amount to deposit.\n\nUsage: !deposit <amount|all>"
      )
    );
  }

  if (amount > wallet) {
    return reply(
      api,
      threadID,
      createBox(
        "📥 DEPOSIT FAILED",
        [
          "You do not have enough coins in your wallet.",
          "",
          `💵 Wallet: ${formatCoins(wallet)} coins`,
          `💵 Deposit Amount: ${formatCoins(amount)} coins`
        ]
      )
    );
  }

  try {
    const result =
      await db.deposit(
        threadID,
        senderID,
        amount
      );

    await reply(
      api,
      threadID,
      createBox(
        "📥 DEPOSIT COMPLETE",
        [
          `💰 Deposited: +${formatCoins(amount)} coins`,
          "",
          `💵 Wallet: ${formatCoins(result.balance)} coins`,
          `🏦 Bank: ${formatCoins(result.bank_balance)} coins`
        ]
      )
    );
  } catch (error) {
    console.error(
      "[economy deposit]",
      error
    );

    await reply(
      api,
      threadID,
      createError(
        error.message ||
        "The deposit could not be completed."
      )
    );
  }
}

// ============================================================================
// WITHDRAW
// ============================================================================

async function handleWithdraw(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  const user =
    await db.getUser(
      threadID,
      senderID
    );

  const bank =
    Number(user.bank_balance) || 0;

  const amount =
    parseAmountInput(
      args[0],
      bank
    );

  if (amount === null) {
    return reply(
      api,
      threadID,
      createError(
        "Specify a valid amount to withdraw.\n\nUsage: !withdraw <amount|all>"
      )
    );
  }

  if (amount > bank) {
    return reply(
      api,
      threadID,
      createBox(
        "📤 WITHDRAW FAILED",
        [
          "You do not have enough coins in your bank balance.",
          "",
          `🏦 Bank Balance: ${formatCoins(bank)} coins`,
          `💵 Requested: ${formatCoins(amount)} coins`
        ]
      )
    );
  }

  try {
    const result =
      await db.withdraw(
        threadID,
        senderID,
        amount
      );

    await reply(
      api,
      threadID,
      createBox(
        "📤 WITHDRAW COMPLETE",
        [
          `💰 Withdrawn: +${formatCoins(amount)} coins`,
          "",
          `💵 Wallet: ${formatCoins(result.balance)} coins`,
          `🏦 Bank: ${formatCoins(result.bank_balance)} coins`
        ]
      )
    );
  } catch (error) {
    console.error(
      "[economy withdraw]",
      error
    );

    await reply(
      api,
      threadID,
      createError(
        error.message ||
        "The withdrawal could not be completed."
      )
    );
  }
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
    senderID
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
          "🔥 Keep your streak alive!"
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
    DAILY_AMOUNT +
    bonus;

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
        `💵 Balance: ${formatCoins(newBalance)} coins`
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
    senderID
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
          "Take a little break."
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
      last_work: now
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
        `💵 Balance: ${formatCoins(newBalance)} coins`
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
    messageReply
  } = event;

  const rawAmount =
    String(
      args[0] ?? ""
    )
      .trim()
      .replace(/,/g, "");

  if (
    !/^\d+$/.test(
      rawAmount
    )
  ) {
    return reply(
      api,
      threadID,
      createError(
        "Usage: reply to someone's message with\n!pay <amount>"
      )
    );
  }

  const amount =
    Number(rawAmount);

  if (
    !Number.isSafeInteger(
      amount
    ) ||
    amount <= 0
  ) {
    return reply(
      api,
      threadID,
      createError(
        "The payment amount must be a valid positive integer."
      )
    );
  }

  if (
    !messageReply ||
    !messageReply.senderID
  ) {
    return reply(
      api,
      threadID,
      createError(
        "Reply to the person's message to pay them.\n\nExample:\n!pay 500"
      )
    );
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
    return reply(
      api,
      threadID,
      createError(
        "You can't transfer coins to yourself."
      )
    );
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
      "[economy pay]",
      error
    );

    return reply(
      api,
      threadID,
      createError(
        error.message ||
        "The payment could not be completed."
      )
    );
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

  await reply(
    api,
    threadID,
    createBox(
      "💸 PAYMENT SENT",
      [
        `👤 From: ${getDisplayName(updatedSender)}`,
        `🎯 To: ${getDisplayName(updatedRecipient)}`,
        "",
        `💰 Amount: ${formatCoins(amount)} coins`,
        "",
        `💵 Your balance: ${formatCoins(updatedSender.balance)} coins`
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
    threadID
  } = event;

  const top =
    await db.leaderboard(
      threadID,
      10
    );

  if (
    top.length === 0
  ) {
    return reply(
      api,
      threadID,
      createBox(
        "🏆 LEADERBOARD",
        [
          "No economy data yet.",
          "",
          "Start earning coins with",
          "!daily or !work."
        ]
      )
    );
  }

  const medals = [
    "🥇",
    "🥈",
    "🥉"
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
        Number(
          row.balance
        ) || 0;

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
    ""
  ];

  Object.entries(
    SHOP_ITEMS
  ).forEach(
    ([id, item]) => {
      lines.push(
        `${item.name} · ${formatCoins(item.price)} coins`,
        `   Buy: !buy ${id}`,
        ""
      );
    }
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

  const parsedQuantity =
    Number(
      args[1]
    );

  const quantity =
    Number.isFinite(
      parsedQuantity
    ) &&
    parsedQuantity >= 1
      ? Math.min(
          99,
          Math.floor(
            parsedQuantity
          )
        )
      : 1;

  if (!input) {
    return reply(
      api,
      event.threadID,
      createError(
        "Usage: !buy <item number or item id> [quantity]\n\nUse !shop to see available items."
      )
    );
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

      return reply(
        api,
        event.threadID,
        createBox(
          "🛍️ RPG PURCHASE COMPLETE",
          [
            `🎁 ${result.item.name} ×${result.quantity}`,
            `💰 Cost: ${formatCoins(result.total)} coins`,
            `💵 Remaining Gold: ${formatCoins(result.balance)} coins`,
            "✨ Added to your RPG inventory."
          ]
        )
      );
    } catch (error) {
      return reply(
        api,
        event.threadID,
        createError(
          error.message ||
          "The RPG purchase could not be completed."
        )
      );
    }
  }

  const item =
    SHOP_ITEMS[input];

  if (!item) {
    return reply(
      api,
      event.threadID,
      createError(
        "That item does not exist. Use !shop to view the available items."
      )
    );
  }

  const user =
    await db.getUser(
      event.threadID,
      event.senderID
    );

  const balance =
    Number(
      user.balance
    ) || 0;

  if (
    balance <
    item.price
  ) {
    return reply(
      api,
      event.threadID,
      createBox(
        "🛒 SHOP",
        [
          `You cannot afford ${item.name}.`,
          "",
          `💰 Price: ${formatCoins(item.price)} coins`,
          `💵 Balance: ${formatCoins(balance)} coins`,
          `📉 Missing: ${formatCoins(item.price - balance)} coins`
        ]
      )
    );
  }

  try {
    await db.spendBalance(
      event.threadID,
      event.senderID,
      item.price,
      `Economy shop: ${input}`
    );

    await db.addItem(
      event.threadID,
      event.senderID,
      input,
      1
    );
  } catch (error) {
    console.error(
      "[economy shop purchase]",
      error
    );

    return reply(
      api,
      event.threadID,
      createError(
        error.message ||
        "The purchase could not be completed."
      )
    );
  }

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
        `🎁 Item: ${item.name}`,
        `💰 Price: ${formatCoins(item.price)} coins`,
        "",
        `💵 Balance: ${formatCoins(updatedUser.balance)} coins`,
        "",
        "✨ Added to your inventory!"
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
    return reply(
      api,
      event.threadID,
      createBox(
        "🎒 INVENTORY",
        [
          `👤 ${getDisplayName(user)}`,
          "",
          "Your inventory is empty.",
          "",
          "Visit !shop to buy items."
        ]
      )
    );
  }

  const lines = [
    `👤 ${getDisplayName(user)}`,
    ""
  ];

  if (
    rpgItems.length
  ) {
    lines.push(
      "🛡️ RPG ITEMS",
      ""
    );

    for (
      const entry of rpgItems
    ) {
      lines.push(
        `${entry.item.emoji || "🎁"} ${entry.item.name} ×${entry.quantity}`,
        `   ${entry.item.description}`,
        ""
      );
    }
  }

  if (
    economyItems.length
  ) {
    lines.push(
      "🎁 COLLECTIBLES",
      ""
    );

    for (
      const [id, amount]
      of economyItems
    ) {
      lines.push(
        `${SHOP_ITEMS[id].name} ×${amount}`,
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
// RESET MONEY
// ============================================================================

async function handleResetMoney(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  if (
    !isAdmin(senderID)
  ) {
    return reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );
  }

  const action =
    String(
      args[0] || ""
    )
      .trim()
      .toLowerCase();

  const secondAction =
    String(
      args[1] || ""
    )
      .trim()
      .toLowerCase();

  if (!action) {
    return reply(
      api,
      threadID,
      createBox(
        "⚠️ ECONOMY RESET",
        [
          "This will reset ALL members' wallet money in this GC to 0 coins.",
          "",
          "🏦 Bank balances will NOT be changed.",
          "",
          "Nothing has been reset yet.",
          "",
          "To confirm:",
          "!resetmoney confirm",
          "",
          "For wallet + bank:",
          "!resetmoney bank confirm"
        ]
      )
    );
  }

  if (
    action === "bank" &&
    secondAction === "confirm"
  ) {
    try {
      const result =
        await db.query(
          `
          UPDATE users
          SET balance = 0,
              bank_balance = 0
          WHERE thread_id = $1
          `,
          [threadID]
        );

      return reply(
        api,
        threadID,
        createBox(
          "💥 ECONOMY RESET COMPLETE",
          [
            "All members' money has been reset.",
            "",
            `👥 Members affected: ${result.rowCount}`,
            "💵 Wallet: 0 coins",
            "🏦 Bank: 0 coins",
            "",
            "⚠️ This action cannot be undone unless you restore a database backup."
          ]
        )
      );
    } catch (error) {
      console.error(
        "[admin resetmoney bank]",
        error
      );

      return reply(
        api,
        threadID,
        createError(
          error.message ||
          "Failed to reset the economy."
        )
      );
    }
  }

  if (
    action === "confirm"
  ) {
    try {
      const result =
        await db.query(
          `
          UPDATE users
          SET balance = 0
          WHERE thread_id = $1
          `,
          [threadID]
        );

      return reply(
        api,
        threadID,
        createBox(
          "💥 ECONOMY RESET COMPLETE",
          [
            "All members' wallet money has been reset.",
            "",
            `👥 Members affected: ${result.rowCount}`,
            "💵 Wallet: 0 coins",
            "🏦 Bank balances were left unchanged.",
            "",
            "⚠️ This action cannot be undone unless you restore a database backup."
          ]
        )
      );
    } catch (error) {
      console.error(
        "[admin resetmoney]",
        error
      );

      return reply(
        api,
        threadID,
        createError(
          error.message ||
          "Failed to reset the economy."
        )
      );
    }
  }

  return reply(
    api,
    threadID,
    createError(
      "Invalid reset command.\n\n" +
      "Wallet reset:\n" +
      "!resetmoney confirm\n\n" +
      "Wallet + bank reset:\n" +
      "!resetmoney bank confirm"
    )
  );
}

// ============================================================================
// ADMIN MONEY
// ============================================================================

async function handleAddMoney(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  if (!isAdmin(senderID)) {
    return reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );
  }

  const {
    targetID,
    amountInput
  } =
    resolveAdminTarget(
      event,
      args
    );

  const amount =
    parseAdminAmount(
      amountInput
    );

  if (
    amount === null
  ) {
    return reply(
      api,
      threadID,
      createError(
        "Usage:\n!addmoney <amount>\n!addmoney @user <amount>\n\nReply to a user's message:\n!addmoney <amount>\n\nExample:\n!addmoney @user 1000000"
      )
    );
  }

  try {
    const newBalance =
      await db.addBalance(
        threadID,
        targetID,
        amount
      );

    const user =
      await getTargetUser(
        threadID,
        targetID
      );

    const targetName =
      getDisplayName(user);

    await reply(
      api,
      threadID,
      createBox(
        "👑 ADMIN — ADD MONEY",
        [
          `👤 ${targetName}`,
          "",
          `💰 Added: +${formatCoins(amount)} coins`,
          `💵 New Wallet: ${formatCoins(newBalance)} coins`
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
// ADMIN REMOVE MONEY
// ============================================================================

async function handleRemoveMoney(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  if (!isAdmin(senderID)) {
    return reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );
  }

  const {
    targetID,
    amountInput
  } =
    resolveAdminTarget(
      event,
      args
    );

  const amount =
    parseAdminAmount(
      amountInput
    );

  if (
    amount === null
  ) {
    return reply(
      api,
      threadID,
      createError(
        "Usage:\n!removemoney <amount>\n!removemoney @user <amount>\n\nReply to a user's message:\n!removemoney <amount>\n\nExample:\n!removemoney @user 5000"
      )
    );
  }

  try {
    const targetUser =
      await getTargetUser(
        threadID,
        targetID
      );

    const currentBalance =
      Number(
        targetUser.balance
      ) || 0;

    if (
      amount >
      currentBalance
    ) {
      return reply(
        api,
        threadID,
        createError(
          `${getDisplayName(targetUser)} only has ${formatCoins(currentBalance)} coins in their wallet.`
        )
      );
    }

    const newBalance =
      await db.addBalance(
        threadID,
        targetID,
        -amount
      );

    await reply(
      api,
      threadID,
      createBox(
        "👑 ADMIN — REMOVE MONEY",
        [
          `👤 ${getDisplayName(targetUser)}`,
          "",
          `💸 Removed: -${formatCoins(amount)} coins`,
          `💵 New Wallet: ${formatCoins(newBalance)} coins`
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
// ADMIN SET MONEY
// ============================================================================

async function handleSetMoney(
  api,
  event,
  args
) {
  const {
    threadID,
    senderID
  } = event;

  if (!isAdmin(senderID)) {
    return reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );
  }

  const {
    targetID,
    amountInput
  } =
    resolveAdminTarget(
      event,
      args
    );

  const amount =
    parseAdminAmount(
      amountInput,
      true
    );

  if (
    amount === null
  ) {
    return reply(
      api,
      threadID,
      createError(
        "Usage:\n!setmoney <amount>\n!setmoney @user <amount>\n\nReply to a user's message:\n!setmoney <amount>\n\nExample:\n!setmoney @user 999999999"
      )
    );
  }

  try {
    await db.updateUser(
      threadID,
      targetID,
      {
        balance: amount
      }
    );

    const user =
      await getTargetUser(
        threadID,
        targetID
      );

    await reply(
      api,
      threadID,
      createBox(
        "👑 ADMIN — SET MONEY",
        [
          `👤 ${getDisplayName(user)}`,
          "",
          `💵 Wallet set to: ${formatCoins(amount)} coins`
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
// ADMIN BANK
// ============================================================================

async function handleAdminBank(
  api,
  event,
  args,
  mode
) {
  const {
    threadID,
    senderID
  } = event;

  if (!isAdmin(senderID)) {
    return reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );
  }

  const {
    targetID,
    amountInput
  } =
    resolveAdminTarget(
      event,
      args
    );

  const amount =
    parseAdminAmount(
      amountInput,
      mode === "setbank"
    );

  if (
    amount === null
  ) {
    return reply(
      api,
      threadID,
      createError(
        `Usage:\n!${mode} <amount>\n!${mode} @user <amount>\n\nReply to a user's message:\n!${mode} <amount>\n\nExample:\n!${mode} @user 100000`
      )
    );
  }

  try {
    const user =
      await getTargetUser(
        threadID,
        targetID
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
        safeAdd(
          currentBank,
          amount
        );
    } else if (
      mode === "removebank"
    ) {
      if (
        amount >
        currentBank
      ) {
        return reply(
          api,
          threadID,
          createError(
            `${getDisplayName(user)} only has ${formatCoins(currentBank)} coins in their bank.`
          )
        );
      }

      newBank =
        currentBank -
        amount;
    } else {
      newBank =
        amount;
    }

    await db.updateUser(
      threadID,
      targetID,
      {
        bank_balance:
          newBank
      }
    );

    await reply(
      api,
      threadID,
      createBox(
        `👑 ADMIN — ${mode.toUpperCase()}`,
        [
          `👤 ${getDisplayName(user)}`,
          "",
          `🏦 Bank: ${formatCoins(newBank)} coins`
        ]
      )
    );
  } catch (error) {
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
// ADMIN XP
// ============================================================================

async function handleAdminXp(
  api,
  event,
  args,
  mode
) {
  const {
    threadID,
    senderID
  } = event;

  if (!isAdmin(senderID)) {
    return reply(
      api,
      threadID,
      createError(
        "Only the bot admin can use this command."
      )
    );
  }

  const {
    targetID,
    amountInput
  } =
    resolveAdminTarget(
      event,
      args
    );

  const amount =
    parseAdminAmount(
      amountInput,
      mode === "setxp"
    );

  if (
    amount === null
  ) {
    return reply(
      api,
      threadID,
      createError(
        `Usage:\n!${mode} <amount>\n!${mode} @user <amount>\n\nReply to a user's message:\n!${mode} <amount>\n\nExample:\n!${mode} @user 50000`
      )
    );
  }

  try {
    const user =
      await getTargetUser(
        threadID,
        targetID
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
        safeAdd(
          currentXp,
          amount
        );
    } else if (
      mode === "removexp"
    ) {
      newXp =
        Math.max(
          0,
          currentXp -
          amount
        );
    } else {
      newXp =
        amount;
    }

    await db.updateUser(
      threadID,
      targetID,
      {
        xp: newXp
      }
    );

    await reply(
      api,
      threadID,
      createBox(
        `👑 ADMIN — ${mode.toUpperCase()}`,
        [
          `👤 ${getDisplayName(user)}`,
          "",
          `✨ XP: ${formatCoins(newXp)}`
        ]
      )
    );
  } catch (error) {
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

  // --------------------------------------------------------------------------
  // ADMIN MENUS
  // --------------------------------------------------------------------------

  if (
    economyCommand ===
    "!economy"
  ) {
    if (
      !isAdmin(
        event.senderID
      )
    ) {
      await reply(
        api,
        event.threadID,
        createError(
          "Only the bot admin can use this command."
        )
      );

      return true;
    }

    await reply(
      api,
      event.threadID,
      createEconomyAdminMenu()
    );

    return true;
  }

  if (
    economyCommand ===
    "!xp"
  ) {
    if (
      !isAdmin(
        event.senderID
      )
    ) {
      await reply(
        api,
        event.threadID,
        createError(
          "Only the bot admin can use this command."
        )
      );

      return true;
    }

    await reply(
      api,
      event.threadID,
      createXpAdminMenu()
    );

    return true;
  }

  // --------------------------------------------------------------------------
  // ADMIN MONEY
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // ADMIN RESET
  // --------------------------------------------------------------------------

  if (
    economyCommand ===
    "!resetmoney"
  ) {
    await handleResetMoney(
      api,
      event,
      economyArgs
    );

    return true;
  }

  // --------------------------------------------------------------------------
  // ADMIN BANK
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // ADMIN XP
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // BALANCE / BANK
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // DEPOSIT
  // --------------------------------------------------------------------------

  if (
    text === "!deposit" ||
    text.startsWith("!deposit ") ||
    text === "!dep" ||
    text.startsWith("!dep ")
  ) {
    const cmdName =
      text.startsWith("!deposit")
        ? "!deposit"
        : "!dep";

    const args =
      originalText
        .slice(cmdName.length)
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

  // --------------------------------------------------------------------------
  // WITHDRAW
  // --------------------------------------------------------------------------

  if (
    text === "!withdraw" ||
    text.startsWith("!withdraw ") ||
    text === "!wd" ||
    text.startsWith("!wd ")
  ) {
    const cmdName =
      text.startsWith("!withdraw")
        ? "!withdraw"
        : "!wd";

    const args =
      originalText
        .slice(cmdName.length)
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

  // --------------------------------------------------------------------------
  // DAILY
  // --------------------------------------------------------------------------

  if (
    text === "!daily"
  ) {
    await handleDaily(
      api,
      event
    );

    return true;
  }

  // --------------------------------------------------------------------------
  // WORK
  // --------------------------------------------------------------------------

  if (
    text === "!work"
  ) {
    await handleWork(
      api,
      event
    );

    return true;
  }

  // --------------------------------------------------------------------------
  // PAY
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // LEADERBOARD
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // SHOP
  // --------------------------------------------------------------------------

  if (
    text === "!shop"
  ) {
    await handleShop(
      api,
      event
    );

    return true;
  }

  // --------------------------------------------------------------------------
  // BUY
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // INVENTORY
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // USE RPG ITEM
  // --------------------------------------------------------------------------

  if (
    text === "!use" ||
    text.startsWith("!use ")
  ) {
    const args =
      originalText
        .slice("!use".length)
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
          `❤️ HP +${result.hpRestored}`
        );
      }

      if (
        result.mpRestored
      ) {
        effects.push(
          `🔷 MP +${result.mpRestored}`
        );
      }

      await reply(
        api,
        event.threadID,
        createBox(
          "🧪 ITEM USED",
          [
            `${result.item.emoji} ${result.item.name}`,
            "",
            effects.join(" · ") ||
              "No effect.",
            `Remaining: ${result.remaining}`
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

  return false;
}

// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  handleEconomyCommand
};
