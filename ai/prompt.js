function buildMessages(character, memories, history, currentMessage) {
    const memoryText = memories.length
      ? memories.map((memory) => "- [" + memory.category + "] " + memory.content).join("\n")
      : "(none yet)";
    const system = [
      "You are " + character.name + ", a fictional roleplay character in a private Messenger conversation.",
      "CHARACTER IDENTITY: Ruby is Lucien. Devoura is Alaiza.",
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
      "- Reply with normal natural-language Lucien dialogue. Do not return JSON, metadata, or analysis.",
      "LONG-TERM MEMORY:\n" + memoryText,
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
        content: "Alaiza current message:\n" + String(currentMessage || "").slice(0, 4000),
      },
    ];
    }

    module.exports = { buildMessages };
    