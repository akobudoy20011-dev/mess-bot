/**
 * util.js
 * =======
 * Shared utility helpers for ECLIPSE.
 *
 * IMPORTANT:
 * ws3-fca's sendMessage signature is:
 *
 *   api.sendMessage(message, threadID, callback, replyToMessage)
 *
 * Keep the callback explicitly in the third position and normalize
 * thread IDs to strings before sending.
 */

function reply(api, threadID, message) {
  return new Promise((resolve, reject) => {
    try {
      const cleanThreadID = String(threadID);

      api.sendMessage(
        message,
        cleanThreadID,
        (error, info) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(info);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

function fmtTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

module.exports = {
  reply,
  fmtTime,
};
