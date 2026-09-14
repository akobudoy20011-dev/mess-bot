const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(STATE_DIR, 'riddle-state.json');
const MAX_RECENT = 50;

if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

function loadRiddles() {
  const mod = require('./riddle-questions');
  if (Array.isArray(mod)) return mod.slice();
  if (Array.isArray(mod.default)) return mod.default.slice();
  if (Array.isArray(mod.questions)) return mod.questions.slice();
  return [];
}

function riddleText(raw) {
  return String(raw && (raw.question || raw.q || '') || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ');
}

function makeRiddleId(raw) {
  if (raw && raw.id) return String(raw.id);
  return 'r_' + Buffer.from(riddleText(raw)).toString('base64').replace(/=+$/, '');
}

function normalizeRiddle(raw) {
  if (!raw) return null;
  const question = raw.question || raw.q || '';
  let answers = raw.answers || raw.answer || [];
  if (!Array.isArray(answers)) answers = [String(answers)];
  answers = answers.map((answer) => String(answer).trim()).filter(Boolean);
  if (!question || !answers.length) return null;
  return { question: String(question), answers };
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return { cycles: {} };
    if (!data.cycles || typeof data.cycles !== 'object') data.cycles = {};
    return data;
  } catch {
    return { cycles: {} };
  }
}

function saveState(state) {
  const toSave = { cycles: {} };
  for (const key in state.cycles || {}) {
    const cycle = state.cycles[key] || {};
    toSave.cycles[key] = {
      pool: Array.isArray(cycle.pool) ? cycle.pool : [],
      used: Array.from(cycle.used || []),
      currentIdx: Number.isInteger(cycle.currentIdx) ? cycle.currentIdx : 0,
      recent: Array.isArray(cycle.recent) ? cycle.recent.slice(-MAX_RECENT) : [],
    };
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2), 'utf8');
}

function shuffle(arr) {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

class RiddleManager {
  constructor() {
    const unique = new Map();
    for (const raw of loadRiddles()) {
      const normalized = normalizeRiddle(raw);
      if (!normalized) continue;
      const id = makeRiddleId(raw);
      if (!unique.has(id)) unique.set(id, { ...normalized, _id: id });
    }
    this.allRiddles = Array.from(unique.values());
    this.state = loadState();
    this._repairState();
    console.log('[riddle-manager] Loaded ' + this.allRiddles.length + ' unique riddles');
  }

  _repairState() {
    const validIds = new Set(this.allRiddles.map((riddle) => riddle._id));
    for (const key of Object.keys(this.state.cycles || {})) {
      const cycle = this.state.cycles[key] || {};
      const pool = Array.isArray(cycle.pool) ? cycle.pool.filter((id, index, list) => validIds.has(id) && list.indexOf(id) === index) : [];
      const missing = shuffle(Array.from(validIds).filter((id) => !pool.includes(id)));
      const used = new Set(Array.from(cycle.used || []).filter((id) => validIds.has(id)));
      const recent = Array.isArray(cycle.recent) ? cycle.recent.filter((id, index, list) => validIds.has(id) && list.indexOf(id) === index).slice(-MAX_RECENT) : [];
      this.state.cycles[key] = { pool: pool.concat(missing), used, currentIdx: Math.max(0, Number(cycle.currentIdx) || 0), recent };
    }
    saveState(this.state);
  }

  _scopeKey(threadID) {
    return 'thread:' + String(threadID || 'global');
  }

  async getNextRiddle({ threadID = null } = {}) {
    if (!this.allRiddles.length) {
      console.error('[riddle-manager] No riddles loaded');
      return null;
    }
    const key = this._scopeKey(threadID);
    const ids = this.allRiddles.map((riddle) => riddle._id);
    let cycle = this.state.cycles[key];
    if (!cycle) {
      cycle = { pool: shuffle(ids), used: new Set(), currentIdx: 0, recent: [] };
      this.state.cycles[key] = cycle;
      saveState(this.state);
    }
    if (cycle.used.size >= ids.length || cycle.currentIdx >= cycle.pool.length) {
      cycle.pool = shuffle(ids);
      cycle.used = new Set();
      cycle.currentIdx = 0;
    }

    const recent = new Set(cycle.recent || []);
    let selectedId = null;
    while (cycle.currentIdx < cycle.pool.length) {
      const id = cycle.pool[cycle.currentIdx++];
      if (!cycle.used.has(id) && !recent.has(id)) { selectedId = id; break; }
    }
    if (!selectedId) {
      cycle.currentIdx = 0;
      while (cycle.currentIdx < cycle.pool.length) {
        const id = cycle.pool[cycle.currentIdx++];
        if (!cycle.used.has(id)) { selectedId = id; break; }
      }
    }
    if (!selectedId) {
      console.error('[riddle-manager] Failed to find an unused riddle for ' + key);
      return null;
    }

    cycle.used.add(selectedId);
    cycle.recent = (cycle.recent || []).filter((id) => id !== selectedId).concat(selectedId).slice(-MAX_RECENT);
    saveState(this.state);
    return this.allRiddles.find((riddle) => riddle._id === selectedId) || null;
  }

  async resetThread(threadID) {
    const key = this._scopeKey(threadID);
    if (this.state.cycles[key]) {
      delete this.state.cycles[key];
      saveState(this.state);
      console.log('[riddle-manager] Reset cycle for ' + key);
    }
  }

  async resetAll() {
    this.state.cycles = {};
    saveState(this.state);
    console.log('[riddle-manager] Reset all cycles');
  }
}

module.exports = new RiddleManager();
