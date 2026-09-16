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

  // Gemini does not like a conversation beginning with a model message.
  const openingMessage =
    rawContents[0]?.role === "model" ? rawContents.shift() : null;

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
    systemParts.push(
      "OPENING ROLEPLAY CONTEXT:\n" +
        contentToText(openingMessage.parts).trim()
    );
  }

  if (!contents.some((content) => content.role === "user")) {
    throw new Error("Gemini request has no user message.");
  }

  const request = {
    contents,

    generationConfig: {
      temperature: 0.85,
      responseMimeType: "application/json",
    },
  };

  if (systemParts.length) {
    request.systemInstruction = {
      parts: [
        {
          text: systemParts.join("\n\n"),
        },
      ],
    };
  }

  return request;
}

function cleanJsonText(text) {
  let cleaned = String(text || "").trim();

  // Remove markdown fences if Gemini happens to add them.
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return cleaned;
}

function normalizeMemories(memories) {
  if (!Array.isArray(memories)) return [];

  return memories
    .filter(
      (memory) =>
        memory &&
        typeof memory === "object" &&
        typeof memory.content === "string" &&
        memory.content.trim()
    )
    .slice(0, 5)
    .map((memory) => ({
      category:
        String(memory.category || "general")
          .trim()
          .slice(0, 60) || "general",

      content: String(memory.content)
        .trim()
        .slice(0, 1000),

      importance: Math.max(
        1,
        Math.min(5, Number(memory.importance) || 2)
      ),
    }));
}

function normalizeEmotion(emotion) {
  if (!emotion || typeof emotion !== "object") {
    return {
      state: "neutral",
      intensity: 1,
      reason: "",
    };
  }

  return {
    state:
      String(emotion.state || "neutral")
        .trim()
        .slice(0, 50) || "neutral",

    intensity: Math.max(
      0,
      Math.min(5, Number(emotion.intensity) || 1)
    ),

    reason: String(emotion.reason || "")
      .trim()
      .slice(0, 500),
  };
}

function parseGeneratedResponse(text) {
  const cleaned = cleanJsonText(text);

  try {
    const parsed = JSON.parse(cleaned);

    const reply =
      typeof parsed?.reply === "string"
        ? parsed.reply.trim()
        : "";

    if (!reply) {
      throw new Error("Structured Gemini response had no reply.");
    }

    return {
      reply: reply.slice(0, 4000),
      memories: normalizeMemories(parsed.memories),
      emotion: normalizeEmotion(parsed.emotion),
    };
  } catch (error) {
    /*
     * Fallback:
     * If Gemini unexpectedly ignores the JSON instruction,
     * don't break the bot. Use its raw response as the reply.
     */
    console.warn(
      "[Gemini] Could not parse structured response. Using raw response."
    );

    return {
      reply: String(text || "").trim().slice(0, 4000),
      memories: [],
      emotion: {
        state: "neutral",
        intensity: 1,
        reason: "",
      },
    };
  }
}

function getGeneratedText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  const text = Array.isArray(parts)
    ? parts
        .map((part) =>
          typeof part?.text === "string" ? part.text : ""
        )
        .join("")
        .trim()
    : "";

  if (!text) {
    console.error("[Gemini] Response did not contain generated text.", {
      finishReason:
        data?.candidates?.[0]?.finishReason || null,
    });

    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

function configuredGeminiKeys() {
  const names = Object.keys(process.env)
    .filter((name) =>
      /^GEMINI_API_KEY(?:_([2-9]\d*))?$/.test(name)
    )
    .sort((left, right) => {
      const slot = (name) =>
        name === "GEMINI_API_KEY"
          ? 1
          : Number(name.slice("GEMINI_API_KEY_".length));

      return slot(left) - slot(right);
    });

  return names
    .map((name) => ({
      name,
      value: String(process.env[name] || "").trim(),
    }))
    .filter((entry) => entry.value);
}

function providerError(message, status, retryable) {
  const error = new Error(message);

  error.status = status;
  error.retryable = retryable;

  return error;
}

async function requestGemini(messages, model, key) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, 45_000);

  const endpoint =
    GEMINI_API_BASE_URL +
    "/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(key.value);

  try {
    const response = await fetch(endpoint, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(
        toGeminiRequest(messages)
      ),

      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage =
        data?.error?.message ||
        "HTTP " + response.status;

      const retryable = [
        429,
        500,
        502,
        503,
        504,
      ].includes(response.status);

      console.error("[Gemini] API request failed:", {
        keySlot: key.name,
        status: response.status,
        message: providerMessage,
      });

      throw providerError(
        "Gemini request failed (" +
          response.status +
          "): " +
          providerMessage,
        response.status,
        retryable
      );
    }

    const rawText = getGeneratedText(data);

    return parseGeneratedResponse(rawText);
  } catch (error) {
    if (error?.name === "AbortError") {
      console.error("[Gemini] API request timed out:", {
        keySlot: key.name,
      });

      throw providerError(
        "Gemini request timed out.",
        null,
        true
      );
    }

    if (error?.status !== undefined) {
      throw error;
    }

    console.error("[Gemini] Network request failed:", {
      keySlot: key.name,
      message: error?.message || "Unknown network error",
    });

    throw providerError(
      "Gemini network request failed.",
      null,
      true
    );
  } finally {
    clearTimeout(timer);
  }
}

async function generateReply(messages) {
  const keys = configuredGeminiKeys();

  if (!keys.length) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  const configuredModel = String(
    process.env.AI_MODEL || ""
  ).trim();

  if (!configuredModel) {
    throw new Error(
      "AI_MODEL is not configured."
    );
  }

  const model = configuredModel.replace(
    /^models\//,
    ""
  );

  let lastError;

  for (
    let index = 0;
    index < keys.length;
    index += 1
  ) {
    try {
      return await requestGemini(
        messages,
        model,
        keys[index]
      );
    } catch (error) {
      lastError = error;

      const hasNextKey =
        index < keys.length - 1;

      if (!error?.retryable || !hasNextKey) {
        throw error;
      }

      console.error(
        "[Gemini] Trying next configured key after transient failure.",
        {
          failedKeySlot: keys[index].name,
          nextKeySlot: keys[index + 1].name,
          status: error.status || null,
        }
      );
    }
  }

  throw (
    lastError ||
    new Error("Gemini request failed.")
  );
}

module.exports = {
  generateReply,
};
