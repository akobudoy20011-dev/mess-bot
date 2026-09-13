const { getCharacter } = require("./characters");
const { isAuthorized } = require("./access");
const { buildMessages } = require("./prompt");
const { generateReply } = require("./provider");
const { getRelevantMemories, saveMemories } = require("./memory");
const { clearHistory, getActiveSession, getRecentMessages, saveMessage, startSession, stopSession } = require("./history");

function send(api, message, threadID) {
  return new Promise((resolve, reject) => api.sendMessage(message, threadID, (error) => error ? reject(error) : resolve()));
}

async function handleAiMessage(api, event, text, originalText) {
  const normalized = String(text || "").trim().toLowerCase();
  const original = String(originalText || text || "").trim();
  const isLucienCommand = normalized === "!lucien" || normalized.startsWith("!lucien " );
  if (isLucienCommand && !isAuthorized(event.senderID)) return true;
  if (!isAuthorized(event.senderID)) return false;
  const character = getCharacter("lucien");
  const threadID = String(event.threadID);
  const userID = String(event.senderID);

  if (isLucienCommand) {
    const argument = original.slice("!lucien".length).trim().toLowerCase();
    try {
      if (argument === "off" || argument === "stop") {
        await stopSession(character.id, threadID, userID);
        await send(api, "Lucien has left the conversation.", threadID);
        return true;
      }
      const conversation = await startSession(character.id, threadID, userID);
      if (argument === "reset") {
        await clearHistory(conversation.id);
        await send(api, "Lucien conversation history has been reset.", threadID);
        return true;
      }
      if (!argument) {
        const existing = await getRecentMessages(conversation.id, 1);
        if (!existing.length) await saveMessage(conversation.id, "assistant", character.greeting);
        await send(api, existing.length ? "Lucien is already here." : character.greeting, threadID);
        return true;
      }
      await send(api, "Use !lucien to start, !lucien reset to clear history, or !lucien off to end the session.", threadID);
      return true;
    } catch (error) {
      console.error("Lucien session command failed:", error);
      await send(api, "Lucien is unavailable right now.", threadID).catch(() => {});
      return true;
    }
  }

  if (normalized.startsWith("!")) return false;
  const session = await getActiveSession(character.id, threadID, userID);
  if (!session) return false;

  try {
    const history = await getRecentMessages(session.conversation_id, 12);
    const memories = await getRelevantMemories(character.id, threadID, userID, 12);
    const result = await generateReply(buildMessages(character, memories, history, original));
    await saveMessage(session.conversation_id, "user", original);
    await saveMessage(session.conversation_id, "assistant", result.reply);
    await saveMemories(character.id, threadID, userID, result.memories);
    await send(api, result.reply, threadID);
  } catch (error) {
    console.error("Lucien response failed:", error);
    await send(api, "Lucien is unavailable right now. Please try again shortly.", threadID).catch(() => {});
  }
  return true;
}

module.exports = { handleAiMessage };