const { getCharacter } = require("./characters");

const {
  isAuthorized,
  isPrimaryUser,
  authorizeUser,
  revokeUser,
  getAccessType,
} = require("./access");

const { buildMessages } = require("./prompt");
const { generateReply } = require("./provider");

const {
  getRelevantMemories,
  saveMemories,
} = require("./memory");

const {
  clearHistory,
  getActiveSession,
  getRecentMessages,
  saveMessage,
  startSession,
  stopSession,
} = require("./history");

const {
  getAdaptationContext,
} = require("./adaptation");

const CHARACTER_ID = "lucien";


function send(api, message, threadID) {
  return new Promise((resolve, reject) => {
    api.sendMessage(
      message,
      threadID,
      (error) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}


function getCommand(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
}


function getCommandArgument(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/);

  return parts.slice(1).join(" ").trim();
}


async function handleAiMessage(
  api,
  event,
  text,
  originalText
) {
  const normalized = String(
    text || ""
  )
    .trim()
    .toLowerCase();

  const original = String(
    originalText || text || ""
  ).trim();

  const character = getCharacter(
    CHARACTER_ID
  );

  if (!character) {
    console.error(
      "[AI] Character not found:",
      CHARACTER_ID
    );

    return false;
  }

  const threadID = String(
    event.threadID || ""
  ).trim();

  const userID = String(
    event.senderID || ""
  ).trim();

  if (!threadID || !userID) {
    return false;
  }

  const command = getCommand(normalized);

  const isCharacterCommand =
    command ===
    String(character.command || "")
      .trim()
      .toLowerCase();

  /*
   * Character command is intentionally kept as !lucien
   * for compatibility with the existing bot.
   */

  if (isCharacterCommand) {
    if (!isAuthorized(userID)) {
      return true;
    }

    const argument = getCommandArgument(
      original
    ).toLowerCase();

    try {
      /*
       * !lucien off
       */
      if (
        argument === "off" ||
        argument === "stop"
      ) {
        await stopSession(
          character.id,
          threadID,
          userID
        );

        await send(
          api,
          `${character.name} has left the conversation.`,
          threadID
        );

        return true;
      }

      /*
       * !lucien reset
       */
      if (argument === "reset") {
        const conversation =
          await startSession(
            character.id,
            threadID,
            userID
          );

        await clearHistory(
          conversation.id
        );

        await send(
          api,
          "okay, fresh convo 😭",
          threadID
        );

        return true;
      }

      /*
       * !lucien allow USER_ID
       *
       * Only the primary user can authorize
       * another Messenger account.
       */
      if (
        argument.startsWith("allow ")
      ) {
        if (!isPrimaryUser(userID)) {
          return true;
        }

        const targetID = argument
          .slice("allow ".length)
          .trim();

        if (!targetID) {
          await send(
            api,
            "give me the messenger id 😭",
            threadID
          );

          return true;
        }

        authorizeUser(targetID);

        await send(
          api,
          "okay, they can talk to me now",
          threadID
        );

        return true;
      }

      /*
       * !lucien revoke USER_ID
       */
      if (
        argument.startsWith("revoke ")
      ) {
        if (!isPrimaryUser(userID)) {
          return true;
        }

        const targetID = argument
          .slice("revoke ".length)
          .trim();

        if (!targetID) {
          await send(
            api,
            "give me the messenger id 😭",
            threadID
          );

          return true;
        }

        revokeUser(targetID);

        await send(
          api,
          "done",
          threadID
        );

        return true;
      }

      /*
       * !lucien
       */
      if (!argument) {
        const conversation =
          await startSession(
            character.id,
            threadID,
            userID
          );

        const existing =
          await getRecentMessages(
            conversation.id,
            1
          );

        if (!existing.length) {
          await saveMessage(
            conversation.id,
            "assistant",
            character.greeting
          );
        }

        await send(
          api,
          existing.length
            ? `${character.name} is already here.`
            : character.greeting,
          threadID
        );

        return true;
      }

      await send(
        api,
        "use !lucien, !lucien reset, or !lucien off",
        threadID
      );

      return true;

    } catch (error) {
      console.error(
        "[AI] Character session command failed:",
        error
      );

      await send(
        api,
        "wait something broke 😭",
        threadID
      ).catch(() => {});

      return true;
    }
  }


  /*
   * Ignore normal bot commands.
   */
  if (normalized.startsWith("!")) {
    return false;
  }


  /*
   * User must have access before the AI
   * responds to normal messages.
   */
  if (!isAuthorized(userID)) {
    return false;
  }


  /*
   * Find the active character conversation.
   */
  const session =
    await getActiveSession(
      character.id,
      threadID,
      userID
    );


  /*
   * The character only responds when its
   * conversation session is active.
   */
  if (!session) {
    return false;
  }


  try {
    /*
     * Load recent conversation history.
     */
    const history =
      await getRecentMessages(
        session.conversation_id,
        12
      );


    /*
     * Load relevant long-term memories.
     */
    const memories =
      await getRelevantMemories(
        character.id,
        threadID,
        userID,
        12
      );


    /*
     * ========================================================
     * PRIVATE AI ADAPTATION
     * ========================================================
     *
     * The adaptation profile belongs to the BOT OWNER.
     *
     * This means:
     *
     * OWNER trains the AI
     *        ↓
     * adaptation.js learns communication patterns
     *        ↓
     * Neon stores the learned profile
     *        ↓
     * AI loads the profile here
     *        ↓
     * personality/prompt uses it subtly
     *
     * The current user does NOT need to be the owner.
     *
     * The private training data itself is never sent
     * directly to Messenger.
     */

    const ownerID = String(
      process.env.BOT_OWNER_ID || ""
    ).trim();

    let adaptationContext = "";

    if (ownerID) {
      try {
        adaptationContext =
          await getAdaptationContext(
            ownerID
          );
      } catch (adaptationError) {
        console.error(
          "[AI ADAPTATION] Failed to load adaptation:",
          adaptationError
        );

        adaptationContext = "";
      }
    }


    /*
     * Build the final AI prompt.
     *
     * adaptationContext is only a style reference.
     * It must never override the character personality,
     * memories, boundaries, or current conversation context.
     */
    const messages =
      buildMessages(
        character,
        memories,
        history,
        original,
        adaptationContext
      );


    /*
     * Generate response.
     */
    const result =
      await generateReply(messages);


    /*
     * Save the actual conversation.
     */
    await saveMessage(
      session.conversation_id,
      "user",
      original
    );

    await saveMessage(
      session.conversation_id,
      "assistant",
      result.reply
    );


    /*
     * Save ONLY meaningful memories.
     */
    if (
      Array.isArray(result.memories) &&
      result.memories.length
    ) {
      await saveMemories(
        character.id,
        threadID,
        userID,
        result.memories
      );
    }


    /*
     * Emotion is currently kept in the
     * provider result for future persistent
     * emotional-state support.
     *
     * We don't expose it to Messenger.
     */
    if (result.emotion) {
      console.log("[AI] Emotion:", {
        userID,
        state: result.emotion.state,
        intensity: result.emotion.intensity,
      });
    }


    /*
     * Send final response.
     */
    await send(
      api,
      result.reply,
      threadID
    );

  } catch (error) {
    console.error(
      "[AI] Response failed:",
      error
    );

    await send(
      api,
      "wait 😭 something went wrong, try again",
      threadID
    ).catch(() => {});
  }

  return true;
}


module.exports = {
  handleAiMessage,
};
