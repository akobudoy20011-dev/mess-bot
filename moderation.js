async function send(
  api,
  threadID,
  message
) {
  return new Promise((resolve) => {
    try {
      const result = api.sendMessage(
        message,
        String(threadID)
      );

      if (result && typeof result.then === "function") {
        result.then(() => resolve()).catch(() => resolve());
        return;
      }

      resolve();
    } catch (error) {
      console.error(
        "[moderation] send error:",
        error
      );

      resolve();
    }
  });
}

/*
|--------------------------------------------------------------------------
| LOGGING
|--------------------------------------------------------------------------
*/
