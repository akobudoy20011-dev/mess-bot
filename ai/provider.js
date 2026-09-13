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
    generationConfig: { temperature: 0.85 },
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

function configuredGeminiKeys() {
  const names = Object.keys(process.env)
    .filter((name) => /^GEMINI_API_KEY(?:_([2-9]\d*))?$/.test(name))
    .sort((left, right) => {
      const slot = (name) => name === "GEMINI_API_KEY" ? 1 : Number(name.slice("GEMINI_API_KEY_".length));
      return slot(left) - slot(right);
    });

  return names
    .map((name) => ({ name, value: String(process.env[name] || "").trim() }))
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
  const timer = setTimeout(() => controller.abort(), 45_000);
  const endpoint = GEMINI_API_BASE_URL + "/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key.value);

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
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      console.error("[Gemini] API request failed:", {
        keySlot: key.name,
        status: response.status,
        message: providerMessage,
      });
      throw providerError("Gemini request failed (" + response.status + "): " + providerMessage, response.status, retryable);
    }

    return {
      reply: getGeneratedText(data),
      memories: [],
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      console.error("[Gemini] API request timed out:", { keySlot: key.name });
      throw providerError("Gemini request timed out.", null, true);
    }
    if (error?.status !== undefined) throw error;
    console.error("[Gemini] Network request failed:", { keySlot: key.name, message: error?.message || "Unknown network error" });
    throw providerError("Gemini network request failed.", null, true);
  } finally {
    clearTimeout(timer);
  }
}

async function generateReply(messages) {
  const keys = configuredGeminiKeys();
  if (!keys.length) throw new Error("GEMINI_API_KEY is not configured.");

  const configuredModel = String(process.env.AI_MODEL || "").trim();
  if (!configuredModel) throw new Error("AI_MODEL is not configured.");
  const model = configuredModel.replace(/^models\//, "");

  let lastError;
  for (let index = 0; index < keys.length; index += 1) {
    try {
      return await requestGemini(messages, model, keys[index]);
    } catch (error) {
      lastError = error;
      const hasNextKey = index < keys.length - 1;
      if (!error?.retryable || !hasNextKey) throw error;
      console.error("[Gemini] Trying next configured key after transient failure.", {
        failedKeySlot: keys[index].name,
        nextKeySlot: keys[index + 1].name,
        status: error.status || null,
      });
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

module.exports = { generateReply };
