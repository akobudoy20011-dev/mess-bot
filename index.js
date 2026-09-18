async function sendMessageAttempt(
  api,
  message,
  threadID
) {
  return new Promise((resolve) => {
    let finished = false;

    const finish = (
      error,
      messageInfo
    ) => {
      if (finished) {
        return;
      }

      finished = true;
      resolve({
        error: error || null,
        messageInfo: messageInfo || null,
      });
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
        String(threadID)
      );

      if (
        result &&
        typeof result.then === "function"
      ) {
        result.then(
          (messageInfo) => {
            finish(
              null,
              messageInfo
            );
          },
          (sendError) => {
            finish(
              sendError,
              null
            );
          }
        );
      } else {
        finish(null, null);
      }
    } catch (error) {
      finish(error, null);
    }
  });
}

async function sendMessageWithProtection(
  api,
  message,
  threadID
) {
