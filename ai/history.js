const db = require("../db");

async function getOrCreateConversation(characterId, threadID, userID) {
  const result = await db.query(`SELECT * FROM ai_conversations WHERE character_id = $1 AND thread_id = $2 AND user_id = $3`, [String(characterId), String(threadID), String(userID)]);
  if (result.rows[0]) return result.rows[0];
  const inserted = await db.query(`INSERT INTO ai_conversations (character_id, thread_id, user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) ON CONFLICT (character_id, thread_id, user_id) DO UPDATE SET updated_at = EXCLUDED.updated_at RETURNING *`, [String(characterId), String(threadID), String(userID), Date.now()]);
  return inserted.rows[0];
}

async function getActiveSession(characterId, threadID, userID) {
  const result = await db.query(`SELECT * FROM ai_sessions WHERE character_id = $1 AND thread_id = $2 AND user_id = $3 AND active = TRUE`, [String(characterId), String(threadID), String(userID)]);
  return result.rows[0] || null;
}

async function startSession(characterId, threadID, userID) {
  const conversation = await getOrCreateConversation(characterId, threadID, userID);
  await db.query(`INSERT INTO ai_sessions (character_id, thread_id, user_id, conversation_id, active, created_at, updated_at) VALUES ($1, $2, $3, $4, TRUE, $5, $5) ON CONFLICT (character_id, thread_id, user_id) DO UPDATE SET conversation_id = EXCLUDED.conversation_id, active = TRUE, updated_at = EXCLUDED.updated_at`, [String(characterId), String(threadID), String(userID), conversation.id, Date.now()]);
  return conversation;
}

async function stopSession(characterId, threadID, userID) {
  await db.query(`UPDATE ai_sessions SET active = FALSE, updated_at = $4 WHERE character_id = $1 AND thread_id = $2 AND user_id = $3`, [String(characterId), String(threadID), String(userID), Date.now()]);
}

async function clearHistory(conversationId) {
  await db.query(`DELETE FROM ai_messages WHERE conversation_id = $1`, [conversationId]);
  await db.query(`UPDATE ai_conversations SET updated_at = $2 WHERE id = $1`, [conversationId, Date.now()]);
}

async function getRecentMessages(conversationId, limit = 12) {
  const safeLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  const result = await db.query(`SELECT role, content, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [conversationId, safeLimit]);
  return result.rows.reverse();
}

async function saveMessage(conversationId, role, content) {
  const result = await db.query(`INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4) RETURNING *`, [conversationId, role, String(content || "").slice(0, 12000), Date.now()]);
  await db.query(`UPDATE ai_conversations SET updated_at = $2 WHERE id = $1`, [conversationId, Date.now()]);
  return result.rows[0];
}

module.exports = { clearHistory, getActiveSession, getOrCreateConversation, getRecentMessages, saveMessage, startSession, stopSession };