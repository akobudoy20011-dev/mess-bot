const db = require("./db");

const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const TRUSTED_ADMIN_IDS = String(process.env.TRUSTED_ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const MAX_MOD_ACTIONS_PER_WINDOW = 5;
const MOD_ACTION_WINDOW_MS = 10 * 60 * 1000;

const MAX_ECONOMY_ACTIONS_PER_WINDOW = 10;
const ECONOMY_ACTION_WINDOW_MS = 10 * 60 * 1000;

const MAX_SINGLE_MONEY_AMOUNT = 1000000;
const MAX_SINGLE_XP_AMOUNT = 100000;

const WARN_LIMIT = 3;

/*
|--------------------------------------------------------------------------
| MEMORY CACHE
|--------------------------------------------------------------------------
|
| Database remains the persistent source of truth.
| These caches are only used for short-term rate limiting.
|
*/

const moderationRate = new Map();
const economyRate = new Map();

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function now() {
  return Date.now();
}

function isBotOwner(userId) {
  return ADMIN_IDS.includes(String(userId));
}

function isTrustedAdmin(userId) {
  return TRUSTED_ADMIN_IDS.includes(String(userId));
}

function isAdmin(userId) {
  return isBotOwner(userId) || isTrustedAdmin(userId);
}

function getAdminLevel(userId) {
  if (isBotOwner(userId)) return 3;
  if (isTrustedAdmin(userId)) return 2;
  return 1;
}

function cleanReason(reason) {
  const value = String(reason || "").trim();

  if (!value) {
    return "No reason provided";
  }

  return value.slice(0, 500);
}

function parseTargetId(event, args) {
  /*
   * Messenger mentions are not always exposed identically by every
   * Facebook bot library, so we support:
   *
   * !warn 123456789 reason
   * !warn @123456789 reason
   * !warn <123456789> reason
   *
   * and attempt to use event.mentions when available.
   */

  const mentions = event?.mentions || {};

  const mentionIds = Object.keys(mentions);

  if (mentionIds.length > 0) {
    return mentionIds[0];
  }

  const first = String(args[0] || "").trim();

  if (!first) {
    return null;
  }

  return first
    .replace(/^@/, "")
    .replace(/[<>]/g, "")
    .trim();
}

function getReason(args, targetId) {
  if (!args.length) {
    return "No reason provided";
  }

  let start = 1;

  if (String(args[0]) === String(targetId)) {
    start = 1;
  }

  return cleanReason(args.slice(start).join(" "));
}

function rateLimit(map, key, maxActions, windowMs) {
  const timestamp = now();

  let entries = map.get(key) || [];

  entries = entries.filter(
    (time) => timestamp - time < windowMs
  );

  if (entries.length >= maxActions) {
    map.set(key, entries);
    return false;
  }

  entries.push(timestamp);
  map.set(key, entries);

  return true;
}

async function send(api, threadID, message) {
  return new Promise((resolve) => {
    api.sendMessage(message, threadID, () => resolve());
  });
}

/*
|--------------------------------------------------------------------------
| LOGGING
|--------------------------------------------------------------------------
*/

async function logModeration({
  threadID,
  moderatorId,
  targetId = null,
  action,
  reason = null,
  success = true,
}) {
  try {
    await db.query(
      `
      INSERT INTO moderation_logs
      (
        thread_id,
        moderator_id,
        target_id,
        action,
        reason,
        success,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        threadID,
        moderatorId,
        targetId,
        action,
        reason,
        success,
        now(),
      ]
    );
  } catch (error) {
    console.error(
      "[moderation] Failed to write moderation log:",
      error
    );
  }
}

async function logAdminAbuse({
  threadID,
  adminId,
  targetId = null,
  abuseType,
  command = null,
  amount = null,
  reason = null,
  severity = "low",
  blocked = false,
}) {
  try {
    await db.query(
      `
      INSERT INTO admin_abuse_logs
      (
        thread_id,
        admin_id,
        target_id,
        abuse_type,
        command,
        amount,
        reason,
        severity,
        blocked,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        threadID,
        adminId,
        targetId,
        abuseType,
        command,
        amount,
        reason,
        severity,
        blocked,
        now(),
      ]
    );
  } catch (error) {
    console.error(
      "[moderation] Failed to write abuse log:",
      error
    );
  }
}

/*
|--------------------------------------------------------------------------
| STRIKES
|--------------------------------------------------------------------------
*/

async function getAdminRestriction(threadID, adminId) {
  const result = await db.query(
    `
    SELECT *
    FROM admin_restrictions
    WHERE thread_id = $1
      AND admin_id = $2
    LIMIT 1
    `,
    [threadID, adminId]
  );

  return result.rows[0] || null;
}

async function addAdminStrike(
  threadID,
  adminId,
  type = "moderation"
) {
  const current = await getAdminRestriction(
    threadID,
    adminId
  );

  const strikes = Number(current?.strikes || 0) + 1;

  let moderationLocked =
    Boolean(current?.moderation_locked);

  let economyLocked =
    Boolean(current?.economy_locked);

  let lockedUntil =
    current?.locked_until || null;

  /*
   * Strike escalation:
   *
   * 1 = warning
   * 2 = restriction
   * 3 = temporary lock
   * 4+ = owner should be notified
   */

  if (strikes >= 2 && type === "economy") {
    economyLocked = true;
  }

  if (strikes >= 3) {
    moderationLocked = true;
    lockedUntil = now() + 30 * 60 * 1000;
  }

  await db.query(
    `
    INSERT INTO admin_restrictions
    (
      thread_id,
      admin_id,
      moderation_locked,
      economy_locked,
      strikes,
      locked_until,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)

    ON CONFLICT (thread_id, admin_id)
    DO UPDATE SET
      moderation_locked = EXCLUDED.moderation_locked,
      economy_locked = EXCLUDED.economy_locked,
      strikes = EXCLUDED.strikes,
      locked_until = EXCLUDED.locked_until,
      updated_at = EXCLUDED.updated_at
    `,
    [
      threadID,
      adminId,
      moderationLocked,
      economyLocked,
      strikes,
      lockedUntil,
      now(),
    ]
  );

  return {
    strikes,
    moderationLocked,
    economyLocked,
    lockedUntil,
  };
}

/*
|--------------------------------------------------------------------------
| MODERATION LOCK CHECK
|--------------------------------------------------------------------------
*/

async function checkAdminRestriction(
  threadID,
  adminId,
  type
) {
  const restriction = await getAdminRestriction(
    threadID,
    adminId
  );

  if (!restriction) {
    return false;
  }

  if (
    restriction.locked_until &&
    Number(restriction.locked_until) < now()
  ) {
    await db.query(
      `
      UPDATE admin_restrictions
      SET
        moderation_locked = FALSE,
        locked_until = NULL,
        updated_at = $3
      WHERE thread_id = $1
        AND admin_id = $2
      `,
      [threadID, adminId, now()]
    );

    return false;
  }

  if (
    type === "moderation" &&
    restriction.moderation_locked
  ) {
    return true;
  }

  if (
    type === "economy" &&
    restriction.economy_locked
  ) {
    return true;
  }

  return false;
}

/*
|--------------------------------------------------------------------------
| WARN
|--------------------------------------------------------------------------
*/

async function getWarnings(threadID, userId) {
  const result = await db.query(
    `
    SELECT *
    FROM moderation_warnings
    WHERE thread_id = $1
      AND user_id = $2
      AND active = TRUE
    ORDER BY created_at DESC
    `,
    [threadID, userId]
  );

  return result.rows;
}

async function addWarning(
  threadID,
  targetId,
  moderatorId,
  reason
) {
  await db.query(
    `
    INSERT INTO moderation_warnings
    (
      thread_id,
      user_id,
      moderator_id,
      reason,
      active,
      created_at
    )
    VALUES ($1,$2,$3,$4,TRUE,$5)
    `,
    [
      threadID,
      targetId,
      moderatorId,
      reason,
      now(),
    ]
  );

  return getWarnings(threadID, targetId);
}

/*
|--------------------------------------------------------------------------
| BAN STATE
|--------------------------------------------------------------------------
*/

async function isLocallyBanned(threadID, userId) {
  const result = await db.query(
    `
    SELECT *
    FROM moderation_bans
    WHERE thread_id = $1
      AND user_id = $2
      AND active = TRUE
    LIMIT 1
    `,
    [threadID, userId]
  );

  return Boolean(result.rows[0]);
}

async function createBan(
  threadID,
  targetId,
  moderatorId,
  reason
) {
  await db.query(
    `
    INSERT INTO moderation_bans
    (
      thread_id,
      user_id,
      moderator_id,
      reason,
      active,
      created_at
    )
    VALUES ($1,$2,$3,$4,TRUE,$5)

    ON CONFLICT (thread_id,user_id)
    DO UPDATE SET
      moderator_id = EXCLUDED.moderator_id,
      reason = EXCLUDED.reason,
      active = TRUE,
      created_at = EXCLUDED.created_at
    `,
    [
      threadID,
      targetId,
      moderatorId,
      reason,
      now(),
    ]
  );
}

async function removeBan(
  threadID,
  targetId
) {
  await db.query(
    `
    UPDATE moderation_bans
    SET active = FALSE
    WHERE thread_id = $1
      AND user_id = $2
    `,
    [threadID, targetId]
  );
}

/*
|--------------------------------------------------------------------------
| FACEBOOK GROUP ACTIONS
|--------------------------------------------------------------------------
*/

async function removeFromGroup(
  api,
  threadID,
  targetId
) {
  if (
    typeof api.removeUserFromGroup !== "function"
  ) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      api.removeUserFromGroup(
        targetId,
        threadID,
        (error) => {
          if (error) {
            console.error(
              "[moderation] removeUserFromGroup:",
              error
            );

            resolve(false);
            return;
          }

          resolve(true);
        }
      );
    } catch (error) {
      console.error(
        "[moderation] Failed to remove user:",
        error
      );

      resolve(false);
    }
  });
}

/*
|--------------------------------------------------------------------------
| HIERARCHY
|--------------------------------------------------------------------------
*/

function canModerateTarget(
  moderatorId,
  targetId
) {
  /*
   * Bot owner cannot be punished.
   */

  if (isBotOwner(targetId)) {
    return {
      allowed: false,
      reason:
        "The Bot Owner has the highest moderation authority.",
    };
  }

  const moderatorLevel =
    getAdminLevel(moderatorId);

  const targetLevel =
    getAdminLevel(targetId);

  /*
   * Nobody can punish someone equal/higher in hierarchy.
   */

  if (targetLevel >= moderatorLevel) {
    return {
      allowed: false,
      reason:
        "You cannot moderate an administrator with equal or higher authority.",
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

/*
|--------------------------------------------------------------------------
| MODERATION COMMANDS
|--------------------------------------------------------------------------
*/

async function handleWarn(
  api,
  event,
  threadID,
  moderatorId,
  args
) {
  if (!isAdmin(moderatorId)) {
    await send(
      api,
      threadID,
      "❌ You do not have permission to use moderation commands."
    );

    return true;
  }

  if (
    await checkAdminRestriction(
      threadID,
      moderatorId,
      "moderation"
    )
  ) {
    await send(
      api,
      threadID,
      "🔒 Your moderation privileges are temporarily locked."
    );

    return true;
  }

  if (
    !rateLimit(
      moderationRate,
      `${threadID}:${moderatorId}`,
      MAX_MOD_ACTIONS_PER_WINDOW,
      MOD_ACTION_WINDOW_MS
    )
  ) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      abuseType: "moderation_rate_limit",
      command: "!warn",
      severity: "medium",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation"
    );

    await send(
      api,
      threadID,
      "⚠️ Too many moderation actions in a short period. Your moderation actions are temporarily blocked."
    );

    return true;
  }

  const targetId = parseTargetId(
    event,
    args
  );

  if (!targetId) {
    await send(
      api,
      threadID,
      "Usage: !warn @user reason"
    );

    return true;
  }

  const permission =
    canModerateTarget(
      moderatorId,
      targetId
    );

  if (!permission.allowed) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      targetId,
      abuseType: "unauthorized_moderation",
      command: "!warn",
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation"
    );

    await send(
      api,
      threadID,
      `🛡️ Moderation blocked.\n\n${permission.reason}`
    );

    return true;
  }

  const reason =
    getReason(args, targetId);

  const warnings = await addWarning(
    threadID,
    targetId,
    moderatorId,
    reason
  );

  await logModeration({
    threadID,
    moderatorId,
    targetId,
    action: "warn",
    reason,
  });

  await send(
    api,
    threadID,
    `⚠️ Warning issued.\n\n👤 User: ${targetId}\n📌 Reason: ${reason}\n⚠️ Active warnings: ${warnings.length}/${WARN_LIMIT}`
  );

  return true;
}

async function handleKick(
  api,
  event,
  threadID,
  moderatorId,
  args
) {
  if (!isAdmin(moderatorId)) {
    await send(
      api,
      threadID,
      "❌ You do not have permission to use moderation commands."
    );

    return true;
  }

  if (
    await checkAdminRestriction(
      threadID,
      moderatorId,
      "moderation"
    )
  ) {
    await send(
      api,
      threadID,
      "🔒 Your moderation privileges are temporarily locked."
    );

    return true;
  }

  if (
    !rateLimit(
      moderationRate,
      `${threadID}:${moderatorId}`,
      MAX_MOD_ACTIONS_PER_WINDOW,
      MOD_ACTION_WINDOW_MS
    )
  ) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      abuseType: "moderation_rate_limit",
      command: "!kick",
      severity: "medium",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation"
    );

    await send(
      api,
      threadID,
      "⚠️ Too many moderation actions in a short period."
    );

    return true;
  }

  const targetId = parseTargetId(
    event,
    args
  );

  if (!targetId) {
    await send(
      api,
      threadID,
      "Usage: !kick @user reason"
    );

    return true;
  }

  const permission =
    canModerateTarget(
      moderatorId,
      targetId
    );

  if (!permission.allowed) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      targetId,
      abuseType: "unauthorized_kick",
      command: "!kick",
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation"
    );

    await send(
      api,
      threadID,
      `🛡️ Kick blocked.\n\n${permission.reason}`
    );

    return true;
  }

  const reason =
    getReason(args, targetId);

  const removed =
    await removeFromGroup(
      api,
      threadID,
      targetId
    );

  await logModeration({
    threadID,
    moderatorId,
    targetId,
    action: "kick",
    reason,
    success: removed,
  });

  if (!removed) {
    await send(
      api,
      threadID,
      "❌ I could not remove that user. The bot may not have permission to remove members from this group."
    );

    return true;
  }

  await send(
    api,
    threadID,
    `👢 User removed.\n\n👤 User: ${targetId}\n📌 Reason: ${reason}`
  );

  return true;
}

async function handleBan(
  api,
  event,
  threadID,
  moderatorId,
  args
) {
  if (!isAdmin(moderatorId)) {
    await send(
      api,
      threadID,
      "❌ You do not have permission to use moderation commands."
    );

    return true;
  }

  if (
    await checkAdminRestriction(
      threadID,
      moderatorId,
      "moderation"
    )
  ) {
    await send(
      api,
      threadID,
      "🔒 Your moderation privileges are temporarily locked."
    );

    return true;
  }

  const targetId = parseTargetId(
    event,
    args
  );

  if (!targetId) {
    await send(
      api,
      threadID,
      "Usage: !ban @user reason"
    );

    return true;
  }

  const permission =
    canModerateTarget(
      moderatorId,
      targetId
    );

  if (!permission.allowed) {
    await logAdminAbuse({
      threadID,
      adminId: moderatorId,
      targetId,
      abuseType: "unauthorized_ban",
      command: "!ban",
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      moderatorId,
      "moderation"
    );

    await send(
      api,
      threadID,
      `🛡️ Ban blocked.\n\n${permission.reason}`
    );

    return true;
  }

  const reason =
    getReason(args, targetId);

  await createBan(
    threadID,
    targetId,
    moderatorId,
    reason
  );

  const removed =
    await removeFromGroup(
      api,
      threadID,
      targetId
    );

  await logModeration({
    threadID,
    moderatorId,
    targetId,
    action: "ban",
    reason,
    success: true,
  });

  await send(
    api,
    threadID,
    `🔨 User banned from the bot's local moderation system.\n\n👤 User: ${targetId}\n📌 Reason: ${reason}\n👢 Removed: ${removed ? "Yes" : "No"}`
  );

  return true;
}

async function handleUnban(
  api,
  threadID,
  moderatorId,
  args
) {
  if (!isAdmin(moderatorId)) {
    await send(
      api,
      threadID,
      "❌ You do not have permission to use moderation commands."
    );

    return true;
  }

  const targetId =
    String(args[0] || "")
      .replace(/^@/, "")
      .replace(/[<>]/g, "")
      .trim();

  if (!targetId) {
    await send(
      api,
      threadID,
      "Usage: !unban USER_ID"
    );

    return true;
  }

  await removeBan(
    threadID,
    targetId
  );

  await logModeration({
    threadID,
    moderatorId,
    targetId,
    action: "unban",
    reason: "Manual unban",
  });

  await send(
    api,
    threadID,
    `✅ Local ban removed for ${targetId}.`
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| MODLOG
|--------------------------------------------------------------------------
*/

async function handleModlog(
  api,
  threadID,
  moderatorId
) {
  if (!isAdmin(moderatorId)) {
    await send(
      api,
      threadID,
      "❌ You do not have permission to view the moderation log."
    );

    return true;
  }

  const result = await db.query(
    `
    SELECT
      moderator_id,
      target_id,
      action,
      reason,
      success,
      created_at
    FROM moderation_logs
    WHERE thread_id = $1
    ORDER BY created_at DESC
    LIMIT 15
    `,
    [threadID]
  );

  if (!result.rows.length) {
    await send(
      api,
      threadID,
      "📋 No moderation actions have been logged in this group."
    );

    return true;
  }

  const lines = result.rows.map(
    (row, index) => {
      const date = new Date(
        Number(row.created_at)
      ).toLocaleString();

      return (
        `${index + 1}. ${row.action.toUpperCase()}\n` +
        `👮 ${row.moderator_id}\n` +
        `👤 ${row.target_id || "—"}\n` +
        `📌 ${row.reason || "—"}\n` +
        `✅ ${row.success ? "Success" : "Failed"}\n` +
        `🕒 ${date}`
      );
    }
  );

  await send(
    api,
    threadID,
    `📋 MODERATION LOG\n\n${lines.join("\n\n")}`
  );

  return true;
}

/*
|--------------------------------------------------------------------------
| ECONOMY ABUSE PROTECTION
|--------------------------------------------------------------------------
*/

function parseAmount(value) {
  const clean = String(value || "")
    .replace(/,/g, "")
    .trim();

  if (!/^\d+$/.test(clean)) {
    return null;
  }

  const amount = Number(clean);

  if (!Number.isSafeInteger(amount)) {
    return null;
  }

  return amount;
}

const ECONOMY_COMMANDS = new Set([
  "addmoney",
  "removemoney",
  "setmoney",
  "addbank",
  "removebank",
  "setbank",
  "addxp",
  "removexp",
  "setxp",
]);

async function inspectEconomyCommand(
  threadID,
  adminId,
  originalText
) {
  if (!isAdmin(adminId)) {
    return {
      handled: false,
      blocked: false,
    };
  }

  const parts =
    String(originalText || "")
      .trim()
      .split(/\s+/);

  const command =
    String(parts[0] || "")
      .replace(/^!/, "")
      .toLowerCase();

  if (!ECONOMY_COMMANDS.has(command)) {
    return {
      handled: false,
      blocked: false,
    };
  }

  if (
    await checkAdminRestriction(
      threadID,
      adminId,
      "economy"
    )
  ) {
    await logAdminAbuse({
      threadID,
      adminId,
      abuseType: "economy_locked",
      command: `!${command}`,
      severity: "high",
      blocked: true,
    });

    return {
      handled: true,
      blocked: true,
      message:
        "🔒 Your economy privileges are temporarily locked.",
    };
  }

  const amount =
    parseAmount(parts[1]);

  if (amount === null) {
    return {
      handled: false,
      blocked: false,
    };
  }

  if (
    !rateLimit(
      economyRate,
      `${threadID}:${adminId}`,
      MAX_ECONOMY_ACTIONS_PER_WINDOW,
      ECONOMY_ACTION_WINDOW_MS
    )
  ) {
    await logAdminAbuse({
      threadID,
      adminId,
      abuseType: "economy_rate_limit",
      command: `!${command}`,
      amount,
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      adminId,
      "economy"
    );

    return {
      handled: true,
      blocked: true,
      message:
        "⚠️ Too many economy-admin actions in a short period. Economy privileges have been temporarily restricted.",
    };
  }

  const isXp =
    command.includes("xp");

  const maxAmount = isXp
    ? MAX_SINGLE_XP_AMOUNT
    : MAX_SINGLE_MONEY_AMOUNT;

  if (amount > maxAmount) {
    await logAdminAbuse({
      threadID,
      adminId,
      abuseType: "excessive_economy_amount",
      command: `!${command}`,
      amount,
      severity: "high",
      blocked: true,
    });

    await addAdminStrike(
      threadID,
      adminId,
      "economy"
    );

    return {
      handled: true,
      blocked: true,
      message:
        `🚨 Economy action blocked.\n\nMaximum allowed amount for this command is ${maxAmount.toLocaleString()}.`,
    };
  }

  /*
   * Normal admin economy commands are allowed.
   * They are still recorded so the owner has an audit trail.
   */

  await logAdminAbuse({
    threadID,
    adminId,
    abuseType: "economy_admin_action",
    command: `!${command}`,
    amount,
    severity: "low",
    blocked: false,
  });

  return {
    handled: false,
    blocked: false,
  };
}

/*
|--------------------------------------------------------------------------
| MAIN MODERATION ROUTER
|--------------------------------------------------------------------------
*/

async function handleModerationMessage(
  api,
  event,
  text,
  originalText
) {
  const threadID =
    event.threadID;

  const senderId =
    event.senderID;

  const clean =
    String(originalText || text || "")
      .trim();

  if (!clean) {
    return false;
  }

  const parts =
    clean.split(/\s+/);

  const command =
    parts[0]
      .toLowerCase();

  const args =
    parts.slice(1);

  /*
   * Economy protection is checked here,
   * but normal economy commands are still
   * handled by economy.js.
   */

  if (
    ECONOMY_COMMANDS.has(
      command.replace(/^!/, "")
    )
  ) {
    const result =
      await inspectEconomyCommand(
        threadID,
        senderId,
        clean
      );

    if (result.blocked) {
      await send(
        api,
        threadID,
        result.message
      );

      return true;
    }

    /*
     * Not blocked.
     * Let economy.js handle it.
     */
  }

  switch (command) {
    case "!warn":
      return handleWarn(
        api,
        event,
        threadID,
        senderId,
        args
      );

    case "!kick":
      return handleKick(
        api,
        event,
        threadID,
        senderId,
        args
      );

    case "!ban":
      return handleBan(
        api,
        event,
        threadID,
        senderId,
        args
      );

    case "!unban":
      return handleUnban(
        api,
        threadID,
        senderId,
        args
      );

    case "!modlog":
      return handleModlog(
        api,
        threadID,
        senderId
      );

    default:
      return false;
  }
}

/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {
  handleModerationMessage,
  isBotOwner,
  isTrustedAdmin,
  isAdmin,
  getAdminLevel,
  isLocallyBanned,
  inspectEconomyCommand,
};
