const { generateReply } = require("../ai/provider");
const {
  clearHistory,
  getRecentMessages,
  saveMessage,
  startSession,
  stopSession,
} = require("../ai/history");
const { CHARACTERS } = require("./characters");

function send(api, message, threadID) {
  return new Promise((resolve, reject) => {
    api.sendMessage(message, threadID, (error) =>
      error ? reject(error) : resolve()
    );
  });
}

function buildMessages(character, history, currentMessage) {
  const system = [
    "You are " + character.name + ", a fictional roleplay character in the Eclipse RPG world.",
    "ROLE: " + character.role,
    "PERSONALITY: " + character.personality,
    "BACKGROUND: " + character.background,
    "RELATIONSHIP: " + character.relationship,
    "SPEECH STYLE: " + character.speechStyle,
    "SCENARIO: " + character.scenario,
    "ROLEPLAY RULES:",
    "- Stay in character and respond naturally to the player's message.",
    "- Do not speak for the player or decide the player's thoughts, feelings, dialogue, or actions.",
    "- Keep the response suitable for an ongoing fantasy RPG conversation.",
    "- Reply with normal natural-language dialogue. Do not return JSON, metadata, or analysis.",
  ].join("\n\n");

  const historyMessages = (Array.isArray(history) ? history : [])
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || "").slice(0, 12000),
    }))
    .filter((message) => message.content.trim());

  return [
    { role: "system", content: system },
    ...historyMessages,
    {
      role: "user",
      content: "Player current message:\n" + String(currentMessage || "").slice(0, 4000),
    },
  ];
}

async function handleRpgCharacterMessage(api, event, text, originalText) {
  const original = String(originalText || text || "").trim();
  const normalized = original.toLowerCase();
  const character = Object.values(CHARACTERS).find(
    (entry) => normalized === entry.command || normalized.startsWith(entry.command + " ")
  );

  if (!character) return false;

  const argument = original.slice(character.command.length).trim();
  const threadID = String(event.threadID);
  const userID = String(event.senderID || "");

  try {
    if (argument.toLowerCase() === "off" || argument.toLowerCase() === "stop") {
      await stopSession(character.id, threadID, userID);
      await send(api, character.name + " has left the conversation.", threadID);
      return true;
    }

    const conversation = await startSession(character.id, threadID, userID);

    if (argument.toLowerCase() === "reset") {
      await clearHistory(conversation.id);
      await send(api, character.name + " conversation history has been reset.", threadID);
      return true;
    }

    if (!argument) {
      const existing = await getRecentMessages(conversation.id, 1);
      if (!existing.length) {
        await saveMessage(conversation.id, "assistant", character.greeting);
        await send(api, character.greeting, threadID);
      } else {
        await send(api, character.name + " is already here.", threadID);
      }
      return true;
    }

    const history = await getRecentMessages(conversation.id, 12);
    const result = await generateReply(buildMessages(character, history, argument));
    await saveMessage(conversation.id, "user", argument);
    await saveMessage(conversation.id, "assistant", result.reply);
    await send(api, result.reply, threadID);
  } catch (error) {
    console.error("RPG character response failed:", error);
    await send(api, character.name + " is unavailable right now. Please try again shortly.", threadID).catch(() => {});
  }

  return true;
}

module.exports = { handleRpgCharacterMessage };
