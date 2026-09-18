function send(api, message, threadID) {
  return new Promise((resolve, reject) => {
    try {
      const result = api.sendMessage(
        message,
        String(threadID)
      );

      if (result && typeof result.then === "function") {
        result.then(() => resolve()).catch((error) => reject(error));
        return;
      }

      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function buildMessages(character, history, currentMessage) {
