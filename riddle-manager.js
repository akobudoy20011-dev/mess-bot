const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(STATE_DIR, 'riddle-state.json');

if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadRiddles() {
  try {
    const mod = require('./riddle-questions');

    if (Array.isArray(mod)) {
      return mod.slice();
    }

    if (Array.isArray(mod.riddles)) {
      return mod.riddles.slice();
    }

    if (Array.isArray(mod.questions)) {
      return mod.questions.slice();
    }

    if (Array.isArray(mod.default)) {
      return mod.default.slice();
    }

    if (mod && Array.isArray(mod.RIDDLES)) {
      return mod.RIDDLES.slice();
    }

    return [];
  } catch (error) {
    console.error(
      '[RiddleManager] Failed to load riddle-questions.js:',
      error
    );

    return [];
  }
}

function loadState() {
  try {
    const state = JSON.parse(
      fs.readFileSync(STATE_FILE, 'utf8')
    );

    if (!state || typeof state !== 'object') {
      return {
        used: {},
        cycles: {}
      };
    }

    if (!state.used) state.used = {};
    if (!state.cycles) state.cycles = {};

    return state;
  } catch {
    return {
      used: {},
      cycles: {}
    };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(state, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error(
      '[RiddleManager] Failed to save state:',
      error
    );
  }
}

function makeId(riddle, index) {
  if (riddle && riddle.id != null) {
    return String(riddle.id);
  }

  const text = String(
    riddle?.question ||
    riddle?.q ||
    riddle?.prompt ||
    riddle?.text ||
    ''
  ).trim();

  return `r_${index}_${Buffer
    .from(text)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12)}`;
}

function shuffle(array) {
  const result = array.slice();

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [
      result[j],
      result[i]
    ];
  }

  return result;
}

class RiddleManager {
  constructor(opts = {}) {
    this.riddles = loadRiddles().map((r, i) => ({
      ...r,
      _id: makeId(r, i)
    }));

    this.state = loadState();

    this.recentWindowSize =
      Number(opts.recentWindowSize) || 40;
  }

  _scopeKey({ threadID = null } = {}) {
    return `thread:${String(threadID || 'global')}`;
  }

  _getUsed(key) {
    if (!Array.isArray(this.state.used[key])) {
      this.state.used[key] = [];
    }

    return this.state.used[key];
  }

  _getCycle(key) {
    if (!this.state.cycles[key]) {
      this.state.cycles[key] = 1;
    }

    return this.state.cycles[key];
  }

  _resetCycle(key) {
    this.state.used[key] = [];
    this.state.cycles[key] =
      this._getCycle(key) + 1;
  }

  async getNextRiddle({
    threadID = null,
    userID = null
  } = {}) {
    if (
      !this.riddles ||
      this.riddles.length === 0
    ) {
      return null;
    }

    const key = this._scopeKey({
      threadID,
      userID
    });

    const pool = this.riddles.slice();

    let used = this._getUsed(key);

    const poolIds = new Set(
      pool.map((r) => r._id)
    );

    // Remove IDs that no longer exist in the
    // current riddle database.
    used = used.filter((id) =>
      poolIds.has(id)
    );

    this.state.used[key] = used;

    // Get riddles that haven't been used
    // during this cycle.
    let available = pool.filter(
      (r) => !used.includes(r._id)
    );

    // Every riddle has been used.
    // Start a fresh cycle.
    if (available.length === 0) {
      this._resetCycle(key);

      used = [];
      available = pool.slice();
    }

    // Randomly choose one unused riddle.
    const shuffled = shuffle(available);
    const chosen = shuffled[0];

    // Mark it as used.
    this.state.used[key].push(chosen._id);

    saveState(this.state);

    const question =
      chosen.question ||
      chosen.q ||
      chosen.prompt ||
      chosen.text ||
      '';

    let answers = [];

    if (Array.isArray(chosen.answers)) {
      answers = chosen.answers.map(String);
    } else if (Array.isArray(chosen.answer)) {
      answers = chosen.answer.map(String);
    } else if (
      chosen.answer !== undefined &&
      chosen.answer !== null
    ) {
      answers = [String(chosen.answer)];
    }

    return {
      question: String(question),
      answers,
      _raw: chosen,
      cycle: this._getCycle(key)
    };
  }

  async resetUsage() {
    this.state.used = {};
    saveState(this.state);
  }

  async resetRecent() {
    this.state.used = {};
    saveState(this.state);
  }

  async resetThread(threadID) {
    const key = this._scopeKey({
      threadID
    });

    delete this.state.used[key];
    delete this.state.cycles[key];

    saveState(this.state);
  }

  getStats(threadID = null) {
    const key = this._scopeKey({
      threadID
    });

    const used = this._getUsed(key);

    return {
      totalRiddles: this.riddles.length,
      usedThisCycle: used.length,
      remainingThisCycle: Math.max(
        0,
        this.riddles.length - used.length
      ),
      cycle: this._getCycle(key)
    };
  }
}

module.exports = new RiddleManager();
