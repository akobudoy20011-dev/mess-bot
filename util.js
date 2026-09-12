/**
 * util.js
 * =======
 * Promise-wrapped api.sendMessage, matching the pattern already used
 * in index.js's sendMessengerMessage() — so economy.js/games.js don't
 * need to depend on index.js's internals.
 */

function reply(api, threadID, message) {
  return new Promise((resolve, reject) => {
    try {
      api.sendMessage(message, threadID, (error) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function fmtTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

module.exports = { reply, fmtTime };
