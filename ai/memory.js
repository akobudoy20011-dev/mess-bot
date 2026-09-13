const db = require("../db");

async function getRelevantMemories(characterId, threadID, userID, limit = 12) {
  const result = await db.query(`SELECT id, category, content, importance, created_at FROM ai_memories WHERE character_id = $1 AND thread_id = $2 AND user_id = $3 ORDER BY importance DESC, created_at DESC LIMIT $4`, [String(characterId), String(threadID), String(userID), Math.max(1, Math.min(30, Number(limit) || 12))]);
  return result.rows;
}

async function saveMemories(characterId, threadID, userID, memories = []) {
  if (!Array.isArray(memories)) return;
  for (const memory of memories.slice(0, 5)) {
    if (!memory || typeof memory.content !== "string" || !memory.content.trim()) continue;
    const content = memory.content.trim().slice(0, 1000);
    const category = String(memory.category || "general").trim().slice(0, 60) || "general";
    const importance = Math.max(1, Math.min(5, Number(memory.importance) || 2));
    await db.query(`INSERT INTO ai_memories (character_id, thread_id, user_id, category, content, importance, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (character_id, thread_id, user_id, content) DO UPDATE SET importance = GREATEST(ai_memories.importance, EXCLUDED.importance), last_used_at = EXCLUDED.last_used_at`, [String(characterId), String(threadID), String(userID), category, content, importance, Date.now()]);
  }
}

module.exports = { getRelevantMemories, saveMemories };