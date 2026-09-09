
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
const { searchYouTube, downloadYouTubeAudio } = require("./youtube");

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

// Track all active threads the bot is in
const activeThreads = new Set();

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

      // Track all threads the bot receives messages from
      if (event?.threadID) {
        activeThreads.add(String(event.threadID));
        console.log(`[Threads] Active threads: ${activeThreads.size}`);
      }

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
        "!broadcast <text> - admin only (sends to all group chats)",
      threadID
    );
    return;
  }

  if (text === "!play" || text.startsWith("!play ")) {
    const requestedSong = body.slice("!play".length).trim();
    sendAudioTrack(api, requestedSong, threadID);
    return;
  }

  if (
    text.startsWith("!broadcast ") &&
    ADMIN_IDS.includes(senderId)
  ) {
    const message = body.slice("!broadcast ".length);
    broadcastToAllThreads(api, message);
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
// Broadcast message to all active threads the bot is in.
// ---------------------------------------------------------------------------
function broadcastToAllThreads(api, message) {
  if (!message || !message.trim()) {
    console.log("[Broadcast] No message to broadcast.");
    return;
  }

  const threadArray = Array.from(activeThreads);
  console.log(`[Broadcast] Broadcasting to ${threadArray.length} threads: "${message}"`);

  if (threadArray.length === 0) {
    console.log("[Broadcast] No active threads to broadcast to.");
    return;
  }

  const broadcastMessage = `📢 ${message}`;

  threadArray.forEach((threadID) => {
    setTimeout(() => {
      api.sendMessage(broadcastMessage, threadID, (err) => {
        if (err) {
          console.error(`[Broadcast] Failed to send to thread ${threadID}:`, err);
        } else {
          console.log(`[Broadcast] Sent to thread ${threadID}`);
        }
      });
    }, 500); // Small delay between sends to avoid rate limiting
  });
}

// ---------------------------------------------------------------------------
// Validate that a URL is publicly accessible and get its size.
// ---------------------------------------------------------------------------
async function validateAudioUrl(audioUrl) {
  try {
    console.log(`[Audio] Validating URL: ${audioUrl}`);
    const res = await fetch(audioUrl, { method: "HEAD" });

    if (!res.ok) {
      console.error(
        `[Audio] URL validation failed: HTTP ${res.status} ${res.statusText}`
      );
      return false;
    }

    const contentType = res.headers.get("content-type") || "";
    const contentLength = res.headers.get("content-length") || "unknown";

    console.log(
      `[Audio] URL valid: content-type=${contentType}, size=${contentLength}`
    );
    return true;
  } catch (error) {
    console.error(
      `[Audio] URL validation error: ${error.message}`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Search audio tracks with fallback chain:
// 1. Jamendo (indie/free music)
// 2. Spotify preview (major label 30-sec clips)
// 3. YouTube (full songs)
// ---------------------------------------------------------------------------
async function sendAudioTrack(api, songName, threadID) {
  if (!songName) {
    sendReplyWithTyping(
      api,
      "Use !play <song name>, for example: !play laufey",
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

    console.log(`[Audio] Searching for: "${songName}"`);

    // 1. Try Jamendo first
    console.log(`[Audio] Attempting Jamendo search...`);
    const jamendoTrack = await searchJamendo(songName).catch((err) => {
      console.log(`[Audio] Jamendo search failed: ${err.message}`);
      return null;
    });

    if (jamendoTrack) {
      console.log(`[Audio] Found on Jamendo: ${jamendoTrack.name}`);
      return sendJamendoAudio(api, jamendoTrack, threadID);
    }

    // 2. Try YouTube next
    console.log(`[Audio] Attempting YouTube search...`);
    const youtubeVideo = await searchYouTube(songName).catch((err) => {
      console.log(`[Audio] YouTube search failed: ${err.message}`);
      return null;
    });

    if (youtubeVideo) {
      console.log(`[Audio] Found on YouTube: ${youtubeVideo.title}`);
      return sendYouTubeAudio(api, youtubeVideo, threadID);
    }

    // 3. No results from any source
    console.log(`[Audio] No results found from any source`);
    sendReplyWithTyping(
      api,
      `❌ I couldn't find audio for "${songName}". Try a different song title or artist name.`,
      threadID
    );
  } catch (error) {
    console.error("[Audio] Track search error:");
    console.error("  Message:", error.message);
    console.error("  Stack:", error.stack);

    sendReplyWithTyping(api, `❌ Error searching for audio. Please try again.`, threadID);
  }
}

// ---------------------------------------------------------------------------
// Send Jamendo audio (already downloaded to temp file in jamendo.js)
// ---------------------------------------------------------------------------
async function sendJamendoAudio(api, track, threadID) {
  try {
    if (typeof api.sendTypingIndicator === "function") {
      api.sendTypingIndicator(threadID, (typingError) => {
        if (typingError) {
          console.error("Typing indicator failed:", typingError);
        }
      });
    }

    // Validate URL before downloading
    const urlIsValid = await validateAudioUrl(track.audio_url);
    if (!urlIsValid) {
      console.error(
        `[Jamendo] Audio URL is not accessible: ${track.audio_url}`
      );
      sendReplyWithTyping(
        api,
        `❌ Audio URL is not accessible. Trying another source...`,
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

    sendReplyWithTyping(api, `❌ Jamendo error: ${error.message}`, threadID);
  }
}

// ---------------------------------------------------------------------------
// Send YouTube audio (download and send)
// ---------------------------------------------------------------------------
async function sendYouTubeAudio(api, video, threadID) {
  let tempPath = null;

  try {
    if (typeof api.sendTypingIndicator === "function") {
      api.sendTypingIndicator(threadID, (typingError) => {
        if (typingError) {
          console.error("Typing indicator failed:", typingError);
        }
      });
    }

    // Generate temp file path
    tempPath = path.join(
      "/tmp",
      `youtube_audio_${crypto.randomUUID()}.mp3`
    );

    console.log(`[YouTube] Downloading audio to: ${tempPath}`);
    sendReplyWithTyping(api, `⏳ Downloading "${video.title}"...`, threadID);

    // Download YouTube audio
    await downloadYouTubeAudio(video.url, tempPath);

    // Verify the file was created and has content
    if (!fs.existsSync(tempPath)) {
      throw new Error("Downloaded file does not exist at " + tempPath);
    }

    const fileStats = fs.statSync(tempPath);
    console.log(
      `[YouTube] Downloaded file size: ${fileStats.size} bytes`
    );

    if (fileStats.size === 0) {
      throw new Error("Downloaded file is empty");
    }

    // Prepare track info message
    const trackInfo = `🎵 ${video.title}\n⏱️ ${video.duration}`;

    // Send track info with audio attachment
    setTimeout(() => {
      try {
        console.log(
          `[YouTube] Sending audio attachment to thread ${threadID}`
        );

        api.sendMessage(
          {
            body: trackInfo,
            attachment: fs.createReadStream(tempPath),
          },
          threadID,
          (sendError) => {
            // Clean up temp file after send attempt
            if (tempPath && fs.existsSync(tempPath)) {
              fs.unlink(tempPath, (unlinkError) => {
                if (unlinkError && unlinkError.code !== "ENOENT") {
                  console.error(
                    "[YouTube] Could not remove temp file:",
                    unlinkError
                  );
                }
              });
            }

            if (sendError) {
              console.error("[YouTube] Messenger send error details:");
              console.error("  Error object:", sendError);
              console.error("  Error message:", sendError.message || "N/A");
              console.error("  Error code:", sendError.code || "N/A");
              console.error("  Error stack:", sendError.stack || "N/A");

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
                `[YouTube] Successfully sent audio: ${video.title}`
              );
            }
          }
        );
      } catch (sendError) {
        console.error("[YouTube] Exception during send:");
        console.error("  Error:", sendError);
        console.error("  Stack:", sendError.stack);

        // Clean up temp file
        if (tempPath && fs.existsSync(tempPath)) {
          fs.unlink(tempPath, () => {});
        }

        sendReplyWithTyping(
          api,
          `❌ Error sending audio: ${sendError.message}`,
          threadID
        );
      }
    }, 1200);
  } catch (error) {
    console.error("[YouTube] Download error:");
    console.error("  Error:", error);
    console.error("  Message:", error.message);
    console.error("  Stack:", error.stack);

    // Clean up temp file if it exists
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlink(tempPath, () => {});
    }

    sendReplyWithTyping(api, `❌ YouTube download error: ${error.message}`, threadID);
  }
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
