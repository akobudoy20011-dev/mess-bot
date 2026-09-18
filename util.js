"use strict";

function reply(api, threadID, message) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const finish = (error, messageInfo) => {
      if (finished) {
        return;
      }

      finished = true;

      if (error) {
        console.error(
          "[MESSENGER] sendMessage failed:",
          error
        );

        reject(error);
        return;
      }

      resolve(messageInfo || null);
    };

    try {
      if (
        !api ||
        typeof api.sendMessage !== "function"
      ) {
        finish(
          new Error(
            "Messenger sendMessage is unavailable."
          )
        );
        return;
      }

      const result = api.sendMessage(
        message,
        String(threadID),
        null,
        (error, messageInfo) => {
          finish(error, messageInfo);
        }
      );

      // ws3-fca can return a Promise even when
      // a callback is supplied. Catch rejected sends.
      if (
        result &&
        typeof result.then === "function"
      ) {
        result
          .then((messageInfo) => {
            finish(null, messageInfo);
          })
          .catch((error) => {
            finish(error);
          });
      }
    } catch (error) {
      finish(error);
    }
  });
}

function fmtTime(seconds) {
  seconds = Math.max(
    0,
    Math.floor(Number(seconds) || 0)
  );

  const hours = Math.floor(
    seconds / 3600
  );

  const minutes = Math.floor(
    (seconds % 3600) / 60
  );

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

module.exports = {
  reply,
  fmtTime,
};
