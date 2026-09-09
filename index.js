
const { login } = require("ws3-fca");
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  getTriggerReply,
  getRandomRoastReply,
} = require("./triggers");
const { searchJamendo, downloadAudioToFile } = require("./jamendo");

// ---------------------------------------------------------------------------
// Tiny web server so Render sees an open port and keeps the service alive.
// ---------------------------------------------------------------------------
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running ✅");
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Web server listening on port ${process.env.PORT || 3000}`);
});

// ---------------------------------------------------------------------------
// Load Facebook cookies from the FB_COOKIES environment variable.
// ---------------------------------------------------------------------------
function readAppState() {
  const rawCookies = process.env.FB_COOKIES;

  if (!rawCookies || !rawCookies.trim()) {
    throw new Error("FB_COOKIES is missing.");
  }

  let parsed;

  try {
    parsed = JSON.parse(rawCookies);

    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
  } catch {
    throw new Error(
      "FB_COOKIES must contain a JSON array of Facebook cookie objects."
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "FB_COOKIES parsed successfully, but it is not a valid cookie array."
    );
  }

  const normalizedCookies = parsed.map((cookie) => ({
    ...cookie,
    key: typeof cookie.key === "string" ? cookie.key : cookie.name,
  }));

  if (
    normalizedCookies.some(
      (cookie) =>
        !cookie ||
        typeof cookie !== "object" ||
        typeof cookie.key !== "string" ||
        typeof cookie.value !== "string"
    )
  ) {
    throw new Error(
      "FB_COOKIES cookies need string name/key and value fields."
    );
  }

  return normalizedCookies;
}

let appState;

try {
  appState = readAppState();
} catch (err) {
  console.error(`Configuration error: ${err.message}`);
  process.exit(1);
}

// Facebook IDs allowed to use !broadcast.
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// Optional no-trigger roast mode. Keep this probabilistic and rate-limited so
// the bot does not reply to every single message in a busy group chat.
const RANDOM_ROAST_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.RANDOM_ROAST || ""
);

const RANDOM_ROAST_CHANCE = Math.max(
  0,
  Math.min(1, Number(process.env.RANDOM_ROAST_CHANCE || "0.1"))
);

const RANDOM_ROAST_COOLDOWN_MS = Math.max(
  0,
  Number(process.env.RANDOM_ROAST_COOLDOWN_MS || "30000")
);

const lastRandomRoastByThread = new Map();

// ---------------------------------------------------------------------------
// Log in to Facebook.
// ---------------------------------------------------------------------------
login(
  appState,
  {
    online: true,
    updatePresence: true,
    selfListen: false,
    randomUserAgent: false,
  },
  (err, api) => {
    if (err) {
      console.error("Login failed:", err);
      process.exit(1);
    }

    console.log("Logged in successfully.");

    api.setOptions({
      listenEvents: true,
      selfListen: false,
    });

    if (process.env.STARTUP_THREAD_ID) {
      Promise.resolve(
        api.sendMessage(
          "Bot is online ✅",
          process.env.STARTUP_THREAD_ID
        )
      ).catch((sendError) => {
        console.error("Startup message failed:", sendError);
      });
    }

    console.log(
      "Listener started. Send a message from a different Facebook account."
    );

    api.listenMqtt((err, event) => {
      if (err) {
        console.error("Listener error:", err);
        return;
      }

      console.log("Incoming event:", {
        type: event?.type,
        senderID: event?.senderID,
        threadID: event?.threadID,
      });

      if (
        event &&
        (event.type === "message" ||
          event.type === "message_reply")
      ) {
        handleMessage(api, event);
      }
    });
  }
);

// ---------------------------------------------------------------------------
// Message handling.
// ---------------------------------------------------------------------------
function handleMessage(api, event) {
  const { threadID, senderID, body } = event;

  if (!threadID || typeof body !== "string" || !body.trim()) {
    return;
  }

  const text = body.trim().toLowerCase();
  const senderId = String(senderID || "").trim();

  // Temporary diagnostic: compare this value with ASELM_ID in Render.
  if (process.env.ASELM_ID) {
    console.log("Roast ID check:", {
      senderID: senderId,
      ASELM_ID: process.env.ASELM_ID,
    });
  }

  if (text === "!ping") {
    sendReplyWithTyping(api, "pong 🏓", threadID);
    return;
  }

  if (text === "!help") {
    sendReplyWithTyping(
      api,
      "Commands:\n" +
        "!ping - health check\n" +
        "!help - this message\n" +
        "!play <song> - send an audio track\n" +
        "!broadcast <text> - admin only",
      threadID
    );
    return;
  }

  if (text === "!play" || text.startsWith("!play ")) {
    const requestedSong = body.slice("!play".length).trim();
    sendJamendoAudio(api, requestedSong, threadID);
    return;
  }

  if (
    text.startsWith("!broadcast ") &&
    ADMIN_IDS.includes(senderId)
  ) {
    const message = body.slice("!broadcast ".length);

    sendReplyWithTyping(api, `📢 ${message}`, threadID);
    return;
  }

  // Everyone can trigger the roast replies.
  // Roast replies also receive a random meme from the memes folder.
  const triggerReply = getTriggerReply(body, senderId);

  if (triggerReply) {
    sendReplyWithTyping(api, triggerReply, threadID, true);
    return;
  }

  // No trigger word is needed when RANDOM_ROAST is enabled in Render.
  // Commands above are intentionally excluded from this random mode.
  if (
    RANDOM_ROAST_ENABLED &&
    Math.random() < RANDOM_ROAST_CHANCE &&
    canRandomRoastThread(threadID)
  ) {
    const randomRoast = getRandomRoastReply();

    if (randomRoast) {
      lastRandomRoastByThread.set(threadID, Date.now());
      sendReplyWithTyping(api, randomRoast, threadID, true);
    }
  }
}

function canRandomRoastThread(threadID) {
  const lastRoastAt = lastRandomRoastByThread.get(threadID) || 0;

  if (Date.now() - lastRoastAt < RANDOM_ROAST_COOLDOWN_MS) {
    return false;
  }

  // Prevent unbounded memory growth if the bot sees many one-off threads.
  if (lastRandomRoastByThread.size > 1000) {
    for (const [knownThreadID, roastAt] of lastRandomRoastByThread) {
      if (Date.now() - roastAt > RANDOM_ROAST_COOLDOWN_MS * 2) {
        lastRandomRoastByThread.delete(knownThreadID);
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Validate that a URL is publicly accessible and get its size.
// ---------------------------------------------------------------------------
async function validateAudioUrl(audioUrl) {
  try {
    console.log(`[Jamendo] Validating audio URL: ${audioUrl}`);
    const res = await fetch(audioUrl, { method: "HEAD" });

    if (!res.ok) {
      console.error(
        `[Jamendo] URL validation failed: HTTP ${res.status} ${res.statusText}`
      );
      return false;
    }

    const contentType = res.headers.get("content-type") || "";
    const contentLength = res.headers.get("content-length") || "unknown";

    console.log(
      `[Jamendo] URL valid: content-type=${contentType}, size=${contentLength}`
    );
    return true;
  } catch (error) {
    console.error(
      `[Jamendo] URL validation error: ${error.message}`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Search Jamendo and send permitted audio as a Messenger attachment.
// ---------------------------------------------------------------------------
async function sendJamendoAudio(api, songName, threadID) {
  if (!songName) {
    sendReplyWithTyping(
      api,
      "Use !play <song name>, for example: !play relaxing piano",
      threadID
    );
    return;
  }

  try {
    if (typeof api.sendTypingIndicator === "function") {
      api.sendTypingIndicator(threadID, (typingError) => {
        if (typingError) {
          console.error("Typing indicator failed:", typingError);
        }
      });
    }

    console.log(`[Jamendo] Searching for: "${songName}"`);
    const track = await searchJamendo(songName);

    if (!track) {
      sendReplyWithTyping(
        api,
        `❌ I couldn't find an available audio track for "${songName}".`,
        threadID
      );
      return;
    }

    console.log(
      `[Jamendo] Found track: ${track.name} by ${track.artist_name}`
    );
    console.log(`[Jamendo] Audio URL: ${track.audio_url}`);

    // Validate the audio URL before attempting to download
    const urlIsValid = await validateAudioUrl(track.audio_url);
    if (!urlIsValid) {
      console.error(
        `[Jamendo] Audio URL is not accessible: ${track.audio_url}`
      );
      sendReplyWithTyping(
        api,
        `❌ Audio URL is not accessible. Please try another track.`,
        threadID
      );
      return;
    }

    // Download audio to a temporary file
    const tempPath = path.join(
      "/tmp",
      `jamendo_audio_${crypto.randomUUID()}.mp3`
    );

    console.log(`[Jamendo] Downloading audio to: ${tempPath}`);
    await downloadAudioToFile(track.audio_url, tempPath);

    // Verify the file was created and has content
    if (!fs.existsSync(tempPath)) {
      throw new Error("Downloaded file does not exist at " + tempPath);
    }

    const fileStats = fs.statSync(tempPath);
    console.log(
      `[Jamendo] Downloaded file size: ${fileStats.size} bytes`
    );

    if (fileStats.size === 0) {
      throw new Error("Downloaded file is empty");
    }

    // Prepare track info message
    const trackInfo = `🎵 Track: ${track.name}\n👤 Artist: ${track.artist_name}`;

    // Send track info with audio attachment
    setTimeout(() => {
      try {
        console.log(
          `[Jamendo] Sending audio attachment to thread ${threadID}`
        );

        api.sendMessage(
          {
            body: trackInfo,
            attachment: fs.createReadStream(tempPath),
          },
          threadID,
          (sendError) => {
            // Clean up temp file after send attempt
            fs.unlink(tempPath, (unlinkError) => {
              if (unlinkError && unlinkError.code !== "ENOENT") {
                console.error(
                  "[Jamendo] Could not remove temp file:",
                  unlinkError
                );
              }
            });

            if (sendError) {
              console.error("[Jamendo] Messenger send error details:");
              console.error("  Error object:", sendError);
              console.error("  Error message:", sendError.message || "N/A");
              console.error("  Error code:", sendError.code || "N/A");
              console.error("  Error stack:", sendError.stack || "N/A");

              // Try to parse error details
              if (typeof sendError === "object") {
                console.error("  Full error object:", JSON.stringify(sendError, null, 2));
              }

              sendReplyWithTyping(
                api,
                `❌ Messenger API error: ${sendError.message || "Unknown error"}`,
                threadID
              );
            } else {
              console.log(
                `[Jamendo] Successfully sent audio: ${track.name} by ${track.artist_name}`
              );
            }
          }
        );
      } catch (sendError) {
        console.error("[Jamendo] Exception during send:");
        console.error("  Error:", sendError);
        console.error("  Stack:", sendError.stack);

        // Clean up temp file
        fs.unlink(tempPath, () => {});

        sendReplyWithTyping(
          api,
          `❌ Error sending audio: ${sendError.message}`,
          threadID
        );
      }
    }, 1200);
  } catch (error) {
    console.error("[Jamendo] Track fetch/download error:");
    console.error("  Error:", error);
    console.error("  Message:", error.message);
    console.error("  Stack:", error.stack);

    let errorMsg =
      "Could not find a playable audio track. Check the song name or Jamendo credentials.";

    if (error.message && error.message.includes("JAMENDO_CLIENT_ID")) {
      errorMsg =
        "Jamendo is not configured. Admin needs to set JAMENDO_CLIENT_ID on Render.";
    }

    sendReplyWithTyping(api, `❌ ${errorMsg}`, threadID);
  }
}

// ---------------------------------------------------------------------------
// Send a requested song from the songs folder.
// Example: !play magnolia -> songs/magnolia.mp3
// ---------------------------------------------------------------------------
function getRequestedSongPath(songName) {
  if (!songName) {
    return null;
  }

  const songDirectory = path.join(__dirname, "songs");

  const supportedExtensions = new Set([
    ".mp3",
    ".m4a",
    ".wav",
    ".ogg",
    ".aac",
  ]);

  const normalizeSongName = (value) =>
    String(value)
      .toLowerCase()
      .replace(/\.(mp3|m4a|wav|ogg|aac)$/i, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const wantedName = normalizeSongName(songName);

  try {
    if (!fs.existsSync(songDirectory) || !wantedName) {
      return null;
    }

    const matchingFile = fs
      .readdirSync(songDirectory)
      .find((fileName) => {
        const extension = path.extname(fileName).toLowerCase();

        return (
          supportedExtensions.has(extension) &&
          normalizeSongName(path.basename(fileName, extension)) === wantedName
        );
      });

    return matchingFile
      ? path.join(songDirectory, matchingFile)
      : null;
  } catch (error) {
    console.error("Could not load songs:", error);
    return null;
  }
}

function sendSongWithTyping(api, songName, threadID) {
  if (!songName) {
    sendReplyWithTyping(
      api,
      "Use !play <song name>, for example: !play magnolia",
      threadID
    );
    return;
  }

  const songPath = getRequestedSongPath(songName);

  if (!songPath) {
    sendReplyWithTyping(
      api,
      `I could not find "${songName}" in the songs folder.`,
      threadID
    );
    return;
  }

  const typingDelayMs = 1200;

  try {
    if (typeof api.sendTypingIndicator === "function") {
      api.sendTypingIndicator(threadID, (typingError) => {
        if (typingError) {
          console.error("Typing indicator failed:", typingError);
        }
      });
    }
  } catch (typingError) {
    console.error("Typing indicator error:", typingError);
  }

  setTimeout(() => {
    try {
      api.sendMessage(
        {
          body: `🎵 Playing: ${path.basename(songPath)}`,
          attachment: fs.createReadStream(songPath),
        },
        threadID,
        (sendError) => {
          if (sendError) {
            console.error("Song send failed:", sendError);
          }
        }
      );
    } catch (sendError) {
      console.error("Song send error:", sendError);
    }
  }, typingDelayMs);
}

// ---------------------------------------------------------------------------
// Select a random image from the memes folder.
// ---------------------------------------------------------------------------
function getRandomMemePath() {
  const memeDirectory = path.join(__dirname, "memes");

  const supportedExtensions = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
  ]);

  try {
    if (!fs.existsSync(memeDirectory)) {
      return null;
    }

    const memeFiles = fs
      .readdirSync(memeDirectory)
      .filter((fileName) =>
        supportedExtensions.has(
          path.extname(fileName).toLowerCase()
        )
      );

    if (memeFiles.length === 0) {
      return null;
    }

    const randomFile =
      memeFiles[Math.floor(Math.random() * memeFiles.length)];

    return path.join(memeDirectory, randomFile);
  } catch (error) {
    console.error("Could not load memes:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Show typing, then send the message and optional meme.
// ---------------------------------------------------------------------------
function sendReplyWithTyping(
  api,
  message,
  threadID,
  attachMeme = false
) {
  const typingDelayMs = 1200;

  try {
    if (typeof api.sendTypingIndicator === "function") {
      api.sendTypingIndicator(threadID, (typingError) => {
        if (typingError) {
          console.error("Typing indicator failed:", typingError);
        }
      });
    } else {
      console.warn(
        "Typing indicator is not available in this ws3-fca version."
      );
    }
  } catch (typingError) {
    console.error("Typing indicator error:", typingError);
  }

  setTimeout(() => {
    try {
      const memePath = attachMeme
        ? getRandomMemePath()
        : null;

      const outgoingMessage = memePath
        ? {
            body: message,
            attachment: fs.createReadStream(memePath),
          }
        : message;

      api.sendMessage(
        outgoingMessage,
        threadID,
        (sendError) => {
          if (sendError) {
            console.error("Reply failed:", sendError);
          }
        }
      );
    } catch (sendError) {
      console.error("Reply error:", sendError);
    }
  }, typingDelayMs);
}
