"use strict";

// ============================================================
// MESSENGER SEND PROTECTION
// ============================================================
//
// Handles Facebook / ws3-fca send error 1545012.
//
// Flow:
//   send
//     ↓
//   1545012?
//     ↓ yes
//   getThreadInfo()
//     ↓
//   accessible? ── no ──> cooldown + stop
//     ↓ yes
//   retry after 1.5s
//     ↓
//   retry after 4s
//     ↓
//   retry after 8s
//     ↓
//   cooldown + stop
//
// This is intentionally kept inside util.js because most normal
// bot replies eventually pass through reply().
//
// ============================================================

const SEND_RETRY_DELAYS_MS = [
  1500,
  4000,
  8000,
];

const THREAD_COOLDOWN_MS =
  5 * 60 * 1000;

// Per-thread protection state.
// This prevents repeatedly hammering a thread that Facebook
// is currently refusing.
const threadSendState = new Map();

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatError(error) {
  if (error == null) {
    return "Unknown Messenger error.";
  }

  if (error instanceof Error) {
    return (
      error.stack ||
      error.message ||
      String(error)
    );
  }

  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

// ------------------------------------------------------------
// Detect Facebook error 1545012
// ------------------------------------------------------------
//
// ws3-fca may expose the code in different forms depending on
// where the error originated.
//
// Examples:
//   { code: 1545012 }
//   { error: 1545012 }
//   Error("1545012")
//   Error("[object Object]") with nested data
//
// ------------------------------------------------------------

function getErrorCode(error) {
  if (error == null) {
    return null;
  }

  if (typeof error === "number") {
    return error;
  }

  if (typeof error === "string") {
    if (error.includes("1545012")) {
      return 1545012;
    }

    return null;
  }

  if (typeof error === "object") {
    const candidates = [
      error.code,
      error.error,
      error.errorCode,
      error.error_code,
      error.status,
      error.statusCode,
    ];

    for (const value of candidates) {
      if (Number(value) === 1545012) {
        return 1545012;
      }
    }

    // Some Facebook errors are nested.
    try {
      const serialized =
        JSON.stringify(error);

      if (
        typeof serialized === "string" &&
        serialized.includes("1545012")
      ) {
        return 1545012;
      }
    } catch (_) {
      // Ignore serialization failure.
    }
  }

  return null;
}

function is1545012(error) {
  return (
    getErrorCode(error) === 1545012
  );
}

// ------------------------------------------------------------
// Thread state
// ------------------------------------------------------------

function getThreadState(threadID) {
  const key = String(threadID);

  let state =
    threadSendState.get(key);

  if (!state) {
    state = {
      cooldownUntil: 0,
    };

    threadSendState.set(
      key,
      state
    );
  }

  return state;
}

function isThreadOnCooldown(threadID) {
  const key = String(threadID);

  const state =
    threadSendState.get(key);

  if (!state) {
    return false;
  }

  if (
    state.cooldownUntil > Date.now()
  ) {
    return true;
  }

  if (state.cooldownUntil) {
    state.cooldownUntil = 0;
  }

  return false;
}

function setThreadCooldown(
  threadID,
  reason
) {
  const key = String(threadID);

  const state =
    getThreadState(key);

  state.cooldownUntil =
    Date.now() +
    THREAD_COOLDOWN_MS;

  console.warn(
    `[MESSENGER] Thread ${key} placed on ` +
      `send cooldown for 5 minutes.` +
      (reason
        ? ` Reason: ${reason}`
        : "")
  );
}

// ------------------------------------------------------------
// Verify thread access
// ------------------------------------------------------------
//
// Returns:
//   true  = getThreadInfo succeeded
//   false = getThreadInfo failed
//   null  = API doesn't provide getThreadInfo
//
// null is deliberately treated as "unknown", not "inaccessible",
// because some ws3-fca versions/configurations may not expose the
// method.
//
// ------------------------------------------------------------

function verifyThreadAccess(
  api,
  threadID
) {
  return new Promise((resolve) => {
    if (
      !api ||
      typeof api.getThreadInfo !==
        "function"
    ) {
      console.warn(
        "[MESSENGER] getThreadInfo() is " +
          "not available; continuing with retry."
      );

      resolve(null);
      return;
    }

    let finished = false;

    const finish = (value) => {
      if (finished) {
        return;
      }

      finished = true;
      resolve(value);
    };

    try {
      const result =
        api.getThreadInfo(
          String(threadID),
          (error, info) => {
            if (error) {
              console.warn(
                `[MESSENGER] getThreadInfo(${threadID}) ` +
                  "failed:",
                formatError(error)
              );

              finish(false);
              return;
            }

            finish(Boolean(info));
          }
        );

      // Support versions that return a Promise.
      if (
        result &&
        typeof result.then ===
          "function"
      ) {
        result
          .then((info) => {
            finish(Boolean(info));
          })
          .catch((error) => {
            console.warn(
              `[MESSENGER] getThreadInfo(${threadID}) ` +
                "Promise failed:",
              formatError(error)
            );

            finish(false);
          });
      }
    } catch (error) {
      console.warn(
        `[MESSENGER] getThreadInfo(${threadID}) ` +
          "threw:",
        formatError(error)
      );

      finish(false);
    }
  });
}

// ------------------------------------------------------------
// One raw send attempt
// ------------------------------------------------------------
//
// This is the ONLY place where api.sendMessage() is called by
// reply(). Both callback and Promise completion are consumed.
//
// ------------------------------------------------------------

function sendOnce(
  api,
  threadID,
  message
) {
  return new Promise(
    (resolve, reject) => {
      let finished = false;

      const finish = (
        error,
        messageInfo
      ) => {
        if (finished) {
          return;
        }

        finished = true;

        if (error) {
          reject(error);
          return;
        }

        resolve(
          messageInfo || null
        );
      };

      try {
        if (
          !api ||
          typeof api.sendMessage !==
            "function"
        ) {
          finish(
            new Error(
              "Messenger sendMessage is unavailable."
            )
          );

          return;
        }

        const result = api.sendMessage(
          message,
          String(threadID)
        );

        // IMPORTANT:
        // ws3-fca can return a Promise even when
        // a callback was supplied.
        //
        // Without this .catch(), a Facebook send
        // rejection can escape the callback wrapper.
        if (
          result &&
          typeof result.then ===
            "function"
        ) {
          result
            .then(
              (messageInfo) => {
                finish(
                  null,
                  messageInfo
                );
              }
            )
            .catch(
              (error) => {
                finish(error);
              }
            );
        } else {
          finish(null, null);
        }
      } catch (error) {
        finish(error);
      }
    }
  );
}

// ------------------------------------------------------------
// Protected reply
// ------------------------------------------------------------

async function reply(
  api,
  threadID,
  message
) {
  const key = String(threadID);

  // Don't repeatedly send to a thread that recently produced
  // persistent 1545012 failures.
  if (
    isThreadOnCooldown(key)
  ) {
    console.warn(
      `[MESSENGER] Skipping send to thread ${key}: ` +
        "temporary 1545012 cooldown is active."
    );

    return null;
  }

  let lastError = null;

  const totalAttempts =
    SEND_RETRY_DELAYS_MS.length + 1;

  for (
    let attempt = 0;
    attempt < totalAttempts;
    attempt += 1
  ) {
    try {
      const messageInfo =
        await sendOnce(
          api,
          key,
          message
        );

      // A successful send means the thread is usable again.
      const state =
        getThreadState(key);

      state.cooldownUntil = 0;

      return messageInfo;
    } catch (error) {
      lastError = error;

      // ------------------------------------------------------
      // Normal/non-1545012 errors
      // ------------------------------------------------------

      if (!is1545012(error)) {
        console.error(
          "[MESSENGER] sendMessage failed:",
          formatError(error)
        );

        // Preserve existing behavior for unrelated errors.
        throw error;
      }

      // ------------------------------------------------------
      // 1545012
      // ------------------------------------------------------

      console.warn(
        `[MESSENGER] Facebook error 1545012 ` +
          `for thread ${key} ` +
          `(attempt ${attempt + 1}/${totalAttempts}).`
      );

      // Check whether Facebook still considers the thread
      // accessible before spending another retry.
      const threadAccessible =
        await verifyThreadAccess(
          api,
          key
        );

      if (
        threadAccessible === false
      ) {
        setThreadCooldown(
          key,
          "getThreadInfo could not access the thread"
        );

        console.warn(
          `[MESSENGER] Thread ${key} appears ` +
            "inaccessible. Retries stopped."
        );

        // IMPORTANT:
        // Do not throw 1545012 back into the caller.
        return null;
      }

      // No retries left.
      if (
        attempt >=
        SEND_RETRY_DELAYS_MS.length
      ) {
        break;
      }

      const delay =
        SEND_RETRY_DELAYS_MS[attempt];

      console.warn(
        `[MESSENGER] Retrying send to ${key} ` +
          `in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  // ----------------------------------------------------------
  // Persistent 1545012
  // ----------------------------------------------------------

  setThreadCooldown(
    key,
    "1545012 persisted after all retries"
  );

  console.error(
    `[MESSENGER] Giving up on thread ${key} ` +
      `after ${totalAttempts} attempts.`
  );

  console.error(
    "[MESSENGER] Last send error:",
    formatError(lastError)
  );

  // Return null instead of rejecting with 1545012.
  // This prevents the normal reply path from creating another
  // unhandled Promise rejection.
  return null;
}

// ------------------------------------------------------------
// Existing utility
// ------------------------------------------------------------

function fmtTime(seconds) {
  seconds = Math.max(
    0,
    Math.floor(
      Number(seconds) || 0
    )
  );

  const hours = Math.floor(
    seconds / 3600
  );

  const minutes = Math.floor(
    (seconds % 3600) / 60
  );

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

// ------------------------------------------------------------
// Exports
// ------------------------------------------------------------

module.exports = {
  reply,
  fmtTime,
};
