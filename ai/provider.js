"use strict";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// ============================================================
// GEMINI KEY POOL
// ------------------------------------------------------------
// Keys are rotated instead of always starting at KEY_1.
// 429 / 5xx failures put only the affected key into cooldown.
// If several requests arrive at once, the pool still distributes
// work across healthy keys instead of hammering the first key.
//
// IMPORTANT:
// Multiple API keys created in the same Google project generally
// share that project's Gemini quota. Key rotation cannot create
// extra quota in that situation; this pool only prevents one key
// from being needlessly hammered and supports genuinely separate
// quotas when they exist.
// ============================================================

const KEY_COOLDOWN_MIN_MS = 5_000;
const KEY_COOLDOWN_MAX_MS = 120_000;
const DEFAULT_429_COOLDOWN_MS = 35_000;
const TRANSIENT_COOLDOWN_MS = 8_000;
const MAX_KEY_FAILURES_BEFORE_LONG_COOLDOWN = 3;
const LONG_COOLDOWN_MS = 60_000;

const geminiKeyState = new Map();
let geminiRoundRobin = 0;

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

function providerError(message, status, retryable, extra = {}) {
  const error = new Error(message);

  error.status = status;
  error.retryable = retryable;

  Object.assign(error, extra);

  return error;
}

function getKeyState(keyName) {
  let state = geminiKeyState.get(keyName);

  if (!state) {
    state = {
      cooldownUntil: 0,
      failures: 0,
      lastStatus: null,
      lastFailureAt: 0,
      successCount: 0,
      failureCount: 0,
    };

    geminiKeyState.set(keyName, state);
  }

  return state;
}

function parseRetryDelayMs(message) {
  const text = String(message || "");

  // Handles messages such as:
  // "Please retry in 30.094537179s."
  const secondsMatch = text.match(
    /retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i
  );

  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);

    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(
        KEY_COOLDOWN_MAX_MS,
        Math.max(
          KEY_COOLDOWN_MIN_MS,
          Math.ceil(seconds * 1000) + 1000
        )
      );
    }
  }

  return DEFAULT_429_COOLDOWN_MS;
}

function markKeyFailure(key, status, message) {
  const state = getKeyState(key.name);

  state.failures += 1;
  state.failureCount += 1;
  state.lastStatus = status;
  state.lastFailureAt = Date.now();

  let cooldownMs;

  if (status === 429) {
    cooldownMs = parseRetryDelayMs(message);
  } else if ([500, 502, 503, 504].includes(status)) {
    cooldownMs = TRANSIENT_COOLDOWN_MS;
  } else {
    cooldownMs = 0;
  }

  if (state.failures >= MAX_KEY_FAILURES_BEFORE_LONG_COOLDOWN) {
    cooldownMs = Math.max(cooldownMs, LONG_COOLDOWN_MS);
  }

  if (cooldownMs > 0) {
    state.cooldownUntil = Date.now() + cooldownMs;
  }

  return cooldownMs;
}

function markKeySuccess(key) {
  const state = getKeyState(key.name);

  state.failures = 0;
  state.lastStatus = null;
  state.cooldownUntil = 0;
  state.successCount += 1;
}

function isKeyReady(key) {
  const state = getKeyState(key.name);
  return state.cooldownUntil <= Date.now();
}

function keyCooldownRemaining(key) {
  const state = getKeyState(key.name);
  return Math.max(0, state.cooldownUntil - Date.now());
}

function chooseNextKey(keys, excludedNames = new Set()) {
  if (!keys.length) return null;

  const start = geminiRoundRobin % keys.length;

  for (let offset = 0; offset < keys.length; offset += 1) {
    const index = (start + offset) % keys.length;
    const key = keys[index];

    if (excludedNames.has(key.name)) continue;
    if (!isKeyReady(key)) continue;

    geminiRoundRobin = (index + 1) % keys.length;
    return key;
  }

  return null;
}

function nextAvailableKey(keys, excludedNames = new Set()) {
  let earliest = null;

  for (const key of keys) {
    if (excludedNames.has(key.name)) continue;

    const remaining = keyCooldownRemaining(key);

    if (remaining <= 0) {
      return key;
    }

    if (!earliest || remaining < earliest.remaining) {
      earliest = { key, remaining };
    }
  }

  return earliest;
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

      body: JSON.stringify(toGeminiRequest(messages)),

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

      const cooldownMs = retryable
        ? markKeyFailure(key, response.status, providerMessage)
        : 0;

      console.error("[Gemini] API request failed:", {
        keySlot: key.name,
        status: response.status,
        cooldownMs,
        message: providerMessage,
      });

      throw providerError(
        "Gemini request failed (" +
          response.status +
          "): " +
          providerMessage,
        response.status,
        retryable,
        {
          cooldownMs,
          providerMessage,
        }
      );
    }

    const rawText = getGeneratedText(data);
    const result = parseGeneratedResponse(rawText);

    markKeySuccess(key);

    return result;
  } catch (error) {
    if (error?.name === "AbortError") {
      markKeyFailure(key, null, "timeout");

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

    markKeyFailure(key, null, error?.message || "network error");

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

  const attemptedKeys = new Set();
  let lastError = null;

  // Try every currently configured key at most once for this request.
  // The starting key rotates between requests, so KEY_1 is not always
  // the first key hit.
  while (attemptedKeys.size < keys.length) {
    const key = chooseNextKey(keys, attemptedKeys);

    if (!key) {
      break;
    }

    attemptedKeys.add(key.name);

    try {
      return await requestGemini(messages, model, key);
    } catch (error) {
      lastError = error;

      if (!error?.retryable) {
        throw error;
      }

      const remainingReadyKeys = keys.filter(
        (candidate) =>
          !attemptedKeys.has(candidate.name) &&
          isKeyReady(candidate)
      );

      if (remainingReadyKeys.length) {
        const nextKey = remainingReadyKeys[0];

        console.error(
          "[Gemini] Switching to next healthy key after transient failure.",
          {
            failedKeySlot: key.name,
            nextKeySlot: nextKey.name,
            status: error.status || null,
            cooldownMs: error.cooldownMs || null,
          }
        );
      }
    }
  }

  // All configured keys were either attempted or are cooling down.
  // If one becomes available very shortly, report the cooldown rather
  // than hammering the same exhausted quota repeatedly.
  const next = nextAvailableKey(keys);

  if (next && next.remaining > 0) {
    const seconds = Math.ceil(next.remaining / 1000);

    console.warn("[Gemini] All configured keys are cooling down.", {
      nextKeySlot: next.key.name,
      retryInSeconds: seconds,
    });

    throw providerError(
      "All configured Gemini API keys are temporarily rate-limited. Retry in about " +
        seconds +
        " seconds.",
      429,
      true,
      {
        cooldownMs: next.remaining,
        allKeysCoolingDown: true,
      }
    );
  }

  throw (
    lastError ||
    new Error("Gemini request failed.")
  );
}

module.exports = {
  generateReply,
};
