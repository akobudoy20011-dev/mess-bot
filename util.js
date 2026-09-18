"use strict";

/**
 * util.js
 * =======
 * Shared utility helpers for ECLIPSE.
 *
 * IMPORTANT:
 * The installed ws3-fca version uses:
 *
 *   api.sendMessage(message, threadID, replyToMessage, callback)
 *
 * Therefore the callback MUST be the 4th argument.
 *
 * Passing the callback as the 3rd argument makes ws3-fca
 * interpret the function as a message ID, causing:
 *
 *   MessageID should be of type string and not String.
 */

// ============================================================
// SAFE REPLY
// ============================================================

function reply(api, threadID, message) {
  return new Promise((resolve, reject) => {
    try {
      if (
        !api ||
        typeof api.sendMessage !== "function"
      ) {
        reject(
          new Error(
            "Messenger sendMessage is unavailable."
          )
        );

        return;
      }

      const cleanThreadID =
        String(threadID);

      api.sendMessage(
        message,
        cleanThreadID,
        null,
        (error, messageInfo) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(
            messageInfo || null
          );
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================
// TIME FORMATTER
// ============================================================

function fmtTime(seconds) {
  seconds =
    Math.max(
      0,
      Math.floor(
        Number(seconds) || 0
      )
    );

  const hours =
    Math.floor(
      seconds / 3600
    );

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  reply,
  fmtTime,
};
