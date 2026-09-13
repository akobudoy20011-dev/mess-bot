function buildMessages(character, memories, history, currentMessage) {
  const memoryText = memories.length ? memories.map((memory) => "- [" + memory.category + "] " + memory.content).join("\n") : "(none yet)";
  const historyText = history.length ? history.map((message) => (message.role === "assistant" ? "Lucien" : "Alaiza") + ": " + message.content).join("\n") : "(conversation just started)";
  const system = [
    "You are " + character.name + ", a fictional roleplay character in a private Messenger conversation.",
    "Stay in character and respond dynamically; never use predetermined responses or mention being an AI.",
    "PERSONALITY: " + character.personality,
    "BACKGROUND: " + character.background,
    "RELATIONSHIP: " + character.relationship,
    "SPEECH STYLE: " + character.speechStyle,
    "SCENARIO: " + character.scenario,
    "ROLEPLAY RULES:",
    "- Control Lucien and reasonable events or characters he can interact with.",
    "- Never speak for Alaiza or decide her thoughts, feelings, dialogue, decisions, movements, or actions.",
    "- React to what Alaiza actually says, while allowing Lucien to initiate topics and have emotions.",
    "- Keep the response natural and conversational, with action beats only when useful.",
    "LONG-TERM MEMORY:\n" + memoryText,
    "RECENT CONVERSATION:\n" + historyText,
    "Return JSON with exactly two keys: reply (string) and memories (array). memories may contain at most 3 objects with category, content, and importance 1-5. Only store durable facts or meaningful relationship events, not guesses.",
  ].join("\n\n");
  return [{ role: "system", content: system }, { role: "user", content: "Alaiza current message:\n" + String(currentMessage || "").slice(0, 4000) }];
}

module.exports = { buildMessages };