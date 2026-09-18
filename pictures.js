function sendRandomPicture(
  api,
  threadID,
  message = ""
) {
  const picturePath =
    getRandomPicturePath();

  if (!picturePath) {
    const text = [
      "🖼️ No pictures are available yet.",
      "",
      "Add .jpg, .jpeg, .png, .gif, or .webp files to:",
      "pictures/",
    ].join("\n");

    try {
      const result = api.sendMessage(
        text,
        String(threadID)
      );

      if (result && typeof result.then === "function") {
        result.catch((error) => {
          console.error(
            "[PICTURES] Failed to send empty-folder message:",
            error
          );
        });
      }
    } catch (error) {
      console.error(
        "[PICTURES] Failed to send empty-folder message:",
        error
      );
    }

    return;
  }

  try {
    const outgoingMessage = {
      body: message,
      attachment: fs.createReadStream(
        picturePath
      ),
    };

    const result = api.sendMessage(
      outgoingMessage,
      String(threadID)
    );

    if (result && typeof result.then === "function") {
      result.catch((error) => {
        console.error(
          "[PICTURES] Failed to send picture:",
          error
        );
      });
    }
  } catch (error) {
    console.error(
      "[PICTURES] Picture send error:",
      error
    );
  }
}

module.exports = {
  getRandomPicturePath,
  sendRandomPicture,
};
