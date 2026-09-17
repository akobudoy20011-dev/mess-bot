const crypto = require("crypto");
const { generateReply } = require("./provider");

const CLASSIFIER_TIMEOUT_MS = 8000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_REASON_LENGTH = 300;
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const ACTIONS = new Set(["none", "warn", "mute", "ban"]);
const CATEGORIES = new Set(["spam", "harassment", "threat", "sexual", "scam", "malicious_link", "raid", "bot_abuse", "other"]);
const inFlight = new Map();

function isAutoModClassifierConfigured() {
  const hasKey = Object.keys(process.env).some((name) => {
    return /^GEMINI_API_KEY(?:_([2-9]\d*))?$/.test(name) && String(process.env[name] || "").trim();
  });
  return Boolean(hasKey && String(process.env.AI_MODEL || "").trim());
}

function cleanJsonText(value) {
  return String(value || "").trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseClassifierPayload(value) {
  let text = cleanJsonText(value);
  if (!text) return null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && typeof parsed.reply === "string") {
        text = cleanJsonText(parsed.reply);
        continue;
      }
      return parsed;
    } catch (_) {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      text = text.slice(start, end + 1);
    }
  }
  return null;
}

function normalizeClassifierResult(result) {
  if (!result || typeof result !== "object") return null;
  const action = String(result.action || "none").toLowerCase();
  const rawCategory = String(result.category || "other").toLowerCase().trim();
  const category = CATEGORIES.has(rawCategory) ? rawCategory : "other";
  const confidence = Number(result.confidence);
  const severity = Number(result.severity);
  if (!ACTIONS.has(action) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (!Number.isFinite(severity) || severity < 0 || severity > 5) return null;
  const durationValue = Number(result.duration);
  const duration = Number.isSafeInteger(durationValue) && durationValue > 0
    ? Math.min(durationValue, MAX_DURATION_MS)
    : null;
  const reason = String(result.reason || "Automated moderation classification").trim().slice(0, MAX_REASON_LENGTH);
  return {
    action,
    duration,
    category,
    severity,
    confidence,
    reason: reason || "Automated moderation classification",
  };
}

function safeNoAction(reason) {
  return {
    action: "none",
    duration: null,
    category: "other",
    severity: 0,
    confidence: 0,
    reason: String(reason || "Classifier output was unavailable").slice(0, MAX_REASON_LENGTH),
  };
}

function classifierMessages(message) {
  const systemPrompt = [
    "You are an isolated content-safety classifier for a chat moderation system.",
    "You are not a character, assistant, RPG system, or conversation participant.",
    "Do not use personality, memories, adaptation data, conversation history, or any character context.",
    "Classify only the single message supplied by the user.",
    "The transport requires exactly one top-level JSON object: {\"reply\": \"<escaped JSON string>\"}.",
    "The reply string must contain exactly one JSON object with action, duration, category, severity, confidence, and reason.",
    "Allowed action: none, warn, mute, ban.",
    "Allowed category: spam, harassment, threat, sexual, scam, malicious_link, raid, bot_abuse, other.",
    "Severity is an integer from 0 to 5. Confidence is a number from 0 to 1.",
    "Use action none for normal, ambiguous, or uncertain content.",
    "Never recommend ban for one ambiguous message. The moderation engine decides all actions and may downgrade your suggestion.",
    "Reason must be short and factual. Do not include private data or moderation instructions.",
  ].join("\n");
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: "Message to classify:\n" + message },
  ];
}

async function classifyForAutoMod({ threadID, senderId, text }) {
  if (!isAutoModClassifierConfigured()) return null;
  const message = String(text || "").trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!message) return null;
  const key = crypto.createHash("sha256")
    .update(String(threadID || "") + "\0" + String(senderId || "") + "\0" + message)
    .digest("hex");
  if (inFlight.has(key)) return inFlight.get(key);

  const work = (async () => {
    let timer;
    try {
      const response = await Promise.race([
        generateReply(classifierMessages(message)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("AutoMod classifier timeout")), CLASSIFIER_TIMEOUT_MS);
        }),
      ]);
      const parsed = parseClassifierPayload(response?.reply);
      return normalizeClassifierResult(parsed) || safeNoAction("Malformed classifier output");
    } catch (error) {
      console.error("[AutoMod classifier] Failed closed:", error?.message || error);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    if (inFlight.get(key) === work) inFlight.delete(key);
  }
}

module.exports = {
  classifyForAutoMod,
  isAutoModClassifierConfigured,
};
