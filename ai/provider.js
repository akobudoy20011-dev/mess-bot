const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return typeof part?.text === "string" ? part.text : "";
    })
    .join("");
}

function toGeminiRequest(messages) {
  const systemParts = [];
  const rawContents = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    const text = contentToText(message?.content).trim();
    if (!text) continue;

    const role = String(message?.role || "user").toLowerCase();
    if (role === "system") {
      systemParts.push(text);
      continue;
    }

    rawContents.push({
      role: role === "assistant" ? "model" : "user",
      parts: [{ text }],
    });
  }

  // Gemini expects a conversation to begin with a user turn. Lucien's
  // persisted greeting is an assistant turn, so keep it as context instead
  // of sending a model message before the first user message.
  const openingMessage = rawContents[0]?.role === "model" ? rawContents.shift() : null;
  const contents = [];
  for (const content of rawContents) {
    const previous = contents[contents.length - 1];
    if (previous?.role === content.role) {
      previous.parts[0].text += "\n\n" + content.parts[0].text;
    } else {
      contents.push(content);
    }
  }

  if (openingMessage) {
    systemParts.push("OPENING ROLEPLAY CONTEXT:\n" + contentToText(openingMessage.parts).trim());
  }

  if (!contents.some((content) => content.role === "user")) {
    throw new Error("Gemini request has no user message.");
  }

  const request = {
    contents,
    generationConfig: {
      temperature: 0.85,
    },
  };

  if (systemParts.length) {
    request.systemInstruction = {
      parts: [{ text: systemParts.join("\n\n") }],
    };
  }

  return request;
}

function getGeneratedText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("").trim()
    : "";

  if (!text) {
    console.error("[Gemini] Response did not contain generated text.", {
      finishReason: data?.candidates?.[0]?.finishReason || null,
    });
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

async function generateReply(messages) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const configuredModel = String(process.env.AI_MODEL || "").trim();
  if (!configuredModel) throw new Error("AI_MODEL is not configured.");
  const model = configuredModel.replace(/^models\//, "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  const endpoint = GEMINI_API_BASE_URL + "/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toGeminiRequest(messages)),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = data?.error?.message || "HTTP " + response.status;
      console.error("[Gemini] API request failed:", {
        status: response.status,
        message: providerMessage,
      });
      throw new Error("Gemini request failed (" + response.status + "): " + providerMessage);
    }

    return {
      reply: getGeneratedText(data),
      memories: [],
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      console.error("[Gemini] API request timed out.");
      throw new Error("Gemini request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generateReply };
