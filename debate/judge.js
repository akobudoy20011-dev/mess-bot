"use strict";

// ============================================================
// JUDGE
// ------------------------------------------------------------
// Human-admin judging only. This module never calculates a
// debate score. It only detects possible contradictions,
// formats the case file/verdict, and labels the admin's score.
// ============================================================

const ROUND_LABELS = {
  opening: "OPENING",
  rebuttal: "REBUTTAL",
  cross1: "CROSS-EXAMINATION I",
  cross2: "CROSS-EXAMINATION II",
  closing: "CLOSING",
};

const ABSOLUTES = [
  "always", "never", "completely", "entirely", "must", "cannot",
  "only", "solely", "totally", "fully", "every single", "all of",
  "none of", "no exceptions",
];

const QUALIFIERS = [
  "sometimes", "in some cases", "partially", "occasionally",
  "under certain conditions", "to some extent", "in certain",
  "depending on", "in most cases", "generally speaking",
];

const AFFIRM_MARKERS = [
  "should", "support", "agree", "necessary", "important",
  "benefit", "justified", "is right", "is correct", "favor",
  "we must", "it is good",
];

const NEGATE_MARKERS = [
  "should not", "shouldn't", "should never", "oppose",
  "unnecessary", "harmful", "against", "reject", "is wrong",
  "is incorrect", "problematic", "not justified", "we must not",
];

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "and",
  "or", "in", "on", "for", "that", "this", "it", "as", "be", "by",
  "with", "at", "from", "but", "if", "should", "would", "could",
  "you", "your", "i", "we", "they", "he", "she", "not", "so",
  "then", "than", "will", "can", "do", "does", "did", "has", "have",
]);

function normalize(text) {
  return String(text || "").toLowerCase();
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function countMatches(text, phrases) {
  const t = normalize(text);
  let count = 0;

  for (const phrase of phrases) {
    if (t.includes(phrase)) count++;
  }

  return count;
}

function keywords(text) {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

function overlapRatio(a, b) {
  const setA = new Set(keywords(a));
  const setB = new Set(keywords(b));

  if (!setA.size || !setB.size) return 0;

  let shared = 0;
  for (const word of setA) {
    if (setB.has(word)) shared++;
  }

  return shared / Math.min(setA.size, setB.size);
}

function excerpt(text, max = 140) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function detectContradiction(priorTexts, newText) {
  const currentPolarity =
    countMatches(newText, AFFIRM_MARKERS) -
    countMatches(newText, NEGATE_MARKERS);

  const currentAbsolute =
    countMatches(newText, ABSOLUTES) > 0;

  const currentQualifier =
    countMatches(newText, QUALIFIERS) > 0;

  for (const entry of priorTexts) {
    if (overlapRatio(entry.text, newText) <= 0.12) continue;

    const priorPolarity =
      countMatches(entry.text, AFFIRM_MARKERS) -
      countMatches(entry.text, NEGATE_MARKERS);

    if (
      priorPolarity !== 0 &&
      currentPolarity !== 0 &&
      Math.sign(priorPolarity) !== Math.sign(currentPolarity)
    ) {
      return {
        type: "polarity",
        earlierRound: entry.round,
        earlierText: entry.text,
        currentText: newText,
      };
    }

    const priorAbsolute =
      countMatches(entry.text, ABSOLUTES) > 0;

    const priorQualifier =
      countMatches(entry.text, QUALIFIERS) > 0;

    if (
      (priorAbsolute && currentQualifier) ||
      (priorQualifier && currentAbsolute)
    ) {
      return {
        type: "degree",
        earlierRound: entry.round,
        earlierText: entry.text,
        currentText: newText,
      };
    }
  }

  return null;
}

function gradeLabel(score) {
  const n = Number(score) || 0;
  if (n >= 85) return "EXCELLENT";
  if (n >= 70) return "STRONG";
  if (n >= 55) return "MIXED";
  if (n >= 35) return "WEAK";
  return "POOR";
}

function buildCaseFile(session) {
  const lines = [
    "╭────── 🎀 DEBATE CASE FILE ──────╮",
    "",
    "TOPIC",
    session.topic,
    "",
    "POSITION",
    session.position,
    "",
    "OPPONENT",
    session.styleLabel,
    "",
    "────────────────────────────────",
  ];

  for (const entry of session.transcript) {
    const roundLabel =
      ROUND_LABELS[entry.round] ||
      String(entry.round).toUpperCase();

    const who =
      entry.role === "player"
        ? "PLAYER"
        : entry.role === "opponent"
          ? "OPPONENT"
          : "SYSTEM";

    lines.push(
      "",
      `${roundLabel} · ${who}`,
      excerpt(entry.text, 600)
    );
  }

  if (session.contradictionFlags.length) {
    lines.push(
      "",
      "────────────────────────────────",
      "",
      "⚠️ FLAGGED CONTRADICTIONS",
      ""
    );

    session.contradictionFlags.forEach((flag, index) => {
      const earlierLabel =
        ROUND_LABELS[flag.earlierRound] ||
        flag.earlierRound;

      const currentLabel =
        ROUND_LABELS[flag.round] ||
        flag.round;

      lines.push(
        `${index + 1}. ${earlierLabel} vs ${currentLabel}`,
        `   earlier: ${excerpt(flag.earlierText)}`,
        `   current: ${excerpt(flag.currentText)}`,
        ""
      );
    });
  }

  lines.push(
    "────────────────────────────────",
    "",
    "AWAITING JUDGMENT",
    "",
    "an admin can score this with:",
    "!debate judge <score 0-100>",
    "",
    "(if more than one debate is pending in",
    "this thread: !debate judge <userID> <score>)",
    "",
    "╰──────────────────────────────╯"
  );

  return lines.join("\n");
}

function buildVerdictText(session, score, judgeName, reward) {
  return [
    "╭────── 🩶 DEBATE VERDICT ──────╮",
    "",
    "TOPIC",
    session.topic,
    "",
    "POSITION",
    session.position,
    "",
    "────────────────────────────────",
    "",
    `SCORE · ${score}/100 · ${gradeLabel(score)}`,
    `judged by ${judgeName}`,
    "",
    session.contradictionFlags.length
      ? `${session.contradictionFlags.length} contradiction${session.contradictionFlags.length === 1 ? "" : "s"} flagged during the debate.`
      : "no contradictions flagged.",
    "",
    "────────────────────────────────",
    "",
    `♡ XP     +${reward.xp}`,
    `♡ Coins  +${reward.coins}`,
    "",
    reward.balanceText || "",
    "",
    "╰──────────────────────────────╯",
  ].filter((line) => line !== undefined).join("\n");
}

module.exports = {
  wordCount,
  excerpt,
  detectContradiction,
  gradeLabel,
  buildCaseFile,
  buildVerdictText,
};
