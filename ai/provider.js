const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function parseProviderContent(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("The AI provider returned an empty response.");
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (typeof parsed.reply === "string" && parsed.reply.trim()) return { reply: parsed.reply.trim(), memories: parsed.memories || [] };
  } catch (error) {
    // Compatible providers may ignore response_format; preserve the useful text.
  }
  return { reply: text, memories: [] };
}

async function generateReply(messages) {
  const apiKey = String(process.env.AI_API_KEY || "").trim();
  if (!apiKey) throw new Error("AI_API_KEY is not configured.");
  const baseUrl = String(process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = String(process.env.AI_MODEL || "gpt-4o-mini").trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.85, response_format: { type: "json_object" } }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("AI provider request failed: " + (data?.error?.message || "HTTP " + response.status));
    return parseProviderContent(data?.choices?.[0]?.message?.content);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI provider request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generateReply };