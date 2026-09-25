"use strict";

// ============================================================
// DEBATE — commands / routing
// ============================================================

const manager = require("./manager");
const profileStore = require("./profile");

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function send(api, threadID, text) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (err, info) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve(info || null);
    };

    try {
      api.sendMessage(text, String(threadID), (err, info) => finish(err, info));
    } catch (error) {
      finish(error);
    }
  });
}

async function safeSend(api, threadID, text) {
  try {
    return await send(api, threadID, text);
  } catch (error) {
    console.error("[debate] send:", error);
    return null;
  }
}

function helpText() {
  return [
    "╭────── 🎀 ECLIPSE DEBATE ──────╮",
    "",
    "Intellectual combat. Four rounds.",
    "No auto-score — an admin judges",
    "the finished case file by hand.",
    "",
    "!debate           start / resume",
    "!debate submit    opening / rebuttal / closing",
    "!debate answer    cross-examination",
    "!debate status    show the open round",
    "!debate hint      show debate tips",
    "!debate stats     your debate profile",
    "!debate rules     how it works",
    "",
    "ROUNDS",
    "1 · opening       — state your thesis",
    "2 · rebuttal      — answer the opponent directly",
    "3 · cross-exam    — survive two questions",
    "4 · closing       — consolidate your position",
    "",
    "5:00 per round. Short submissions are rejected.",
    "Contradictions are flagged for the judge only.",
    "",
    "Closing posts the full case file and waits",
    "for an admin's verdict.",
    "",
    "ADMIN",
    "!debate judge <score>",
    "!debate judge <userID> <score>",
    "!debate pending",
    "",
    "╰───────────────────────────────╯",
  ].join("\n");
}

async function handleDebateCommand(api, event, command, args) {
  const cmd = normalize(command);
  if (cmd !== "debate") return false;

  const normalizedArgs = Array.isArray(args)
    ? args.map(String)
    : String(args || "").trim().split(/\s+/).filter(Boolean);

  const sub = normalize(normalizedArgs[0]);
  const rest = normalizedArgs.slice(1).join(" ").trim();

  if (sub === "help" || sub === "rules") {
    await safeSend(api, event.threadID, helpText());
    return true;
  }

  if (sub === "stats" || sub === "profile") {
    const profile = await profileStore.getProfile(event.threadID, event.senderID);
    await safeSend(api, event.threadID, profileStore.formatProfile(profile));
    return true;
  }

  if (sub === "hint") {
    await safeSend(api, event.threadID, manager.hintText());
    return true;
  }

  if (sub === "judge") {
    return manager.judgeDebate(api, event, normalizedArgs.slice(1));
  }

  if (sub === "pending") {
    return manager.pendingList(api, event);
  }

  if (sub === "submit") {
    const handled = await manager.handleSubmit(api, event, rest);
    if (!handled) {
      await safeSend(api, event.threadID, "🎀 you don't have a debate open. try !debate to start one.");
    }
    return true;
  }

  if (sub === "answer") {
    const handled = await manager.handleAnswer(api, event, rest);
    if (!handled) {
      await safeSend(api, event.threadID, "🎀 you don't have a debate open. try !debate to start one.");
    }
    return true;
  }

  if (sub === "status" || sub === "") {
    const session = manager.getSession(String(event.threadID), String(event.senderID));

    if (session) {
      await safeSend(api, event.threadID, manager.roundPromptText(session));
      return true;
    }

    if (sub === "status") {
      await safeSend(api, event.threadID, "🎀 no debate is open. try !debate to start one.");
      return true;
    }

    return manager.startDebate(api, event);
  }

  await safeSend(api, event.threadID, helpText());
  return true;
}

module.exports = {
  handleDebateCommand,
  initDebate: manager.initDebate,
};
