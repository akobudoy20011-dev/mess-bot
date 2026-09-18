function sendMessageOnce(api, threadID, text) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, messageInfo) => {
      if (finished) return;
      finished = true;
      if (error) {
        reject(error);
        return;
      }
      resolve(messageInfo || null);
    };
    try {
      if (!api || typeof api.sendMessage !== "function") {
        finish(new Error("Messenger sendMessage is unavailable."));
        return;
      }
      const result = api.sendMessage(
        text,
        String(threadID)
      );
      if (result && typeof result.then === "function") {
        result
          .then((messageInfo) => finish(null, messageInfo))
          .catch((error) => finish(error));
      } else {
        finish(null, null);
      }
    } catch (error) {
      finish(error);
    }
  });
}

async function sendMessageAsync(api, threadID, text) {
