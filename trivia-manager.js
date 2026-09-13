const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(STATE_DIR, 'trivia-state.json');

if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadQuestions() {
  try {
    const mod = require('./trivia-questions');

    if (Array.isArray(mod)) return mod.slice();
    if (Array.isArray(mod.questions)) return mod.questions.slice();
    if (Array.isArray(mod.default)) return mod.default.slice();
    if (mod && Array.isArray(mod.TRIVIA_QUESTIONS)) {
      return mod.TRIVIA_QUESTIONS.slice();
    }

    return [];
  } catch (error) {
    console.error('[TriviaManager] Failed to load trivia-questions.js:', error);
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
    console.error('[TriviaManager] Failed to save state:', error);
  }
}

function makeId(question, index) {
  if (question && question.id != null) {
    return String(question.id);
  }

  const text = String(
    question?.q ||
    question?.question ||
    question?.prompt ||
    question?.text ||
    ''
  ).trim();

  return `q_${index}_${Buffer
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

class TriviaManager {
  constructor(opts = {}) {
    this.questions = loadQuestions().map((q, i) => ({
      ...q,
      _id: makeId(q, i)
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

  async getNextQuestion({
    threadID = null,
    userID = null,
    tags = []
  } = {}) {
    if (
      !this.questions ||
      this.questions.length === 0
    ) {
      return null;
    }

    const key = this._scopeKey({
      threadID,
      userID
    });

    let pool = this.questions.slice();

    // Filter by tags if requested.
    if (Array.isArray(tags) && tags.length > 0) {
      pool = pool.filter((q) => {
        if (!Array.isArray(q.tags)) {
          return false;
        }

        return tags.some((tag) =>
          q.tags.includes(tag)
        );
      });
    }

    // If tag filtering produced nothing,
    // fall back to the complete question pool.
    if (pool.length === 0) {
      pool = this.questions.slice();
    }

    let used = this._getUsed(key);

    const poolIds = new Set(
      pool.map((q) => q._id)
    );

    // Only count questions that still exist
    // in the current question database.
    used = used.filter((id) =>
      poolIds.has(id)
    );

    this.state.used[key] = used;

    // Questions that haven't appeared during
    // this cycle.
    let available = pool.filter(
      (q) => !used.includes(q._id)
    );

    // Entire pool has been exhausted.
    // Start a completely new cycle.
    if (available.length === 0) {
      this._resetCycle(key);

      used = [];
      available = pool.slice();
    }

    // Randomly choose from the unused questions.
    const shuffled = shuffle(available);
    const chosen = shuffled[0];

    // Record it as used for this cycle.
    this.state.used[key].push(chosen._id);

    saveState(this.state);

    // Normalize the question text.
    const questionText =
      chosen.q ||
      chosen.question ||
      chosen.prompt ||
      chosen.text ||
      '';

    // Normalize options.
    const options =
      chosen.options ||
      chosen.choices ||
      chosen.answers ||
      null;

    const normalizedOptions =
      Array.isArray(options)
        ? options
            .slice(0, 4)
            .map(String)
        : null;

    // Normalize answer.
    const rawAnswer =
      chosen.answer ??
      chosen.correct ??
      chosen.correctIndex ??
      chosen.correctAnswer ??
      null;

    let answer = null;

    if (
      rawAnswer !== null &&
      rawAnswer !== undefined &&
      rawAnswer !== ''
    ) {
      const numericAnswer = Number(rawAnswer);

      if (Number.isFinite(numericAnswer)) {
        answer = numericAnswer;
      } else if (normalizedOptions) {
        const answerIndex =
          normalizedOptions.findIndex(
            (option) =>
              option.toLowerCase() ===
              String(rawAnswer).toLowerCase()
          );

        if (answerIndex !== -1) {
          answer = answerIndex;
        }
      }
    }

    return {
      question: String(questionText),
      options: normalizedOptions,
      answer,
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
      totalQuestions: this.questions.length,
      usedThisCycle: used.length,
      remainingThisCycle: Math.max(
        0,
        this.questions.length - used.length
      ),
      cycle: this._getCycle(key)
    };
  }
}

module.exports = new TriviaManager();
