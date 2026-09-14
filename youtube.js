"use strict";

const fs = require("fs/promises");
const path = require("path");

const ytSearch = require("yt-search");
const ytdlp = require("youtube-dl-exec");
const ffmpegPath = require("ffmpeg-static");

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

const YOUTUBE_COOKIES =
  typeof process.env.YOUTUBE_COOKIES === "string" &&
  process.env.YOUTUBE_COOKIES.trim()
    ? process.env.YOUTUBE_COOKIES.trim()
    : null;

// -----------------------------------------------------------------------------
// YOUTUBE SEARCH
// -----------------------------------------------------------------------------

async function searchYouTube(query) {
  if (typeof query !== "string" || !query.trim()) {
    return null;
  }

  const cleanQuery = query.trim();

  console.log(`[YouTube] Searching for: ${cleanQuery}`);

  try {
    const result = await ytSearch(cleanQuery);

    const videos = Array.isArray(result?.videos)
      ? result.videos
      : [];

    const video = videos.find(
      (item) =>
        item &&
        typeof item.url === "string" &&
        isYouTubeUrl(item.url)
    );

    if (!video) {
      console.log(
        `[YouTube] No result found for: ${cleanQuery}`
      );

      return null;
    }

    console.log(
      `[YouTube] Found: ${video.title || "Unknown title"}`
    );

    return {
      title: video.title || "Unknown title",
      url: video.url,

      duration:
        typeof video.timestamp === "string"
          ? video.timestamp
          : formatDuration(video.seconds),

      thumbnail: video.thumbnail || null,

      author:
        video.author?.name ||
        video.author?.channel ||
        null,

      views: Number.isFinite(video.views)
        ? video.views
        : null,
    };
  } catch (error) {
    console.error(
      "[YouTube] Search failed:",
      error?.message || error
    );

    throw new Error(
      `YouTube search failed: ${
        error?.message || "Unknown search error"
      }`
    );
  }
}

// -----------------------------------------------------------------------------
// DOWNLOAD YOUTUBE AUDIO
// -----------------------------------------------------------------------------

async function downloadYouTubeAudio(
  videoUrl,
  outputPath
) {
  if (!isYouTubeUrl(videoUrl)) {
    throw new Error("Invalid YouTube URL.");
  }

  if (!ffmpegPath) {
    throw new Error(
      "FFmpeg was not found. Make sure ffmpeg-static is installed."
    );
  }

  if (
    typeof outputPath !== "string" ||
    !outputPath.trim()
  ) {
    throw new Error(
      "A valid output path is required."
    );
  }

  // Make sure the output directory exists.
  await fs.mkdir(
    path.dirname(outputPath),
    {
      recursive: true,
    }
  );

  // Remove any existing output.
  await fs.rm(
    outputPath,
    {
      force: true,
    }
  );

  let cookieFilePath = null;

  try {
    // -------------------------------------------------------------------------
    // OPTIONAL YOUTUBE COOKIES
    // -------------------------------------------------------------------------

    if (YOUTUBE_COOKIES) {
      cookieFilePath =
        `${outputPath}.youtube-cookies.txt`;

      await fs.writeFile(
        cookieFilePath,
        `${YOUTUBE_COOKIES}\n`,
        {
          mode: 0o600,
        }
      );

      console.log(
        "[YouTube] Using YOUTUBE_COOKIES."
      );
    }

    // -------------------------------------------------------------------------
    // YT-DLP OPTIONS
    // -----------------------------------------------------------------------------

    const options = {
      output: outputPath,

      // Prefer normal audio formats, then fall back to best.
      format:
        "bestaudio[ext=m4a]/bestaudio/best",

      // Convert downloaded audio to MP3.
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",

      // Never download a playlist.
      noPlaylist: true,

      // Retry failed requests/fragments.
      retries: 5,
      fragmentRetries: 5,

      // Use ffmpeg-static.
      ffmpegLocation: ffmpegPath,

      // Current yt-dlp YouTube extraction may require
      // a JavaScript runtime.
      jsRuntimes:
        `node:${process.execPath}`,

      // Allow yt-dlp to use its EJS challenge solver.
      remoteComponents:
        "ejs:github",
    };

    // Add cookies only when configured.
    if (cookieFilePath) {
      options.cookies = cookieFilePath;
    }

    console.log(
      "[YouTube] Starting yt-dlp..."
    );

    console.log(
      `[YouTube] Downloading: ${videoUrl}`
    );

    // -------------------------------------------------------------------------
    // RUN YT-DLP
    // -------------------------------------------------------------------------

    await ytdlp(
      videoUrl,
      options,
      {
        timeout: 180000,
      }
    );

    // -------------------------------------------------------------------------
    // VERIFY OUTPUT
    // -------------------------------------------------------------------------

    const fileInfo =
      await fs.stat(outputPath).catch(
        () => null
      );

    if (
      !fileInfo ||
      !fileInfo.isFile() ||
      fileInfo.size <= 0
    ) {
      throw new Error(
        "yt-dlp finished but no audio file was produced."
      );
    }

    console.log(
      `[YouTube] Download succeeded: ${fileInfo.size} bytes`
    );

    return outputPath;
  } catch (error) {
    const stderr =
      typeof error?.stderr === "string"
        ? error.stderr.trim()
        : "";

    const stdout =
      typeof error?.stdout === "string"
        ? error.stdout.trim()
        : "";

    const message =
      stderr ||
      stdout ||
      error?.message ||
      String(error);

    console.error(
      "[YouTube] Download failed:"
    );

    console.error(message);

    // -------------------------------------------------------------------------
    // YOUTUBE BOT DETECTION
    // -------------------------------------------------------------------------

    if (
      /sign in to confirm|not a bot|confirm you're not a bot|bot detection/i.test(
        message
      )
    ) {
      throw new Error(
        "YouTube is blocking Render's server request. " +
        "Configure a fresh YOUTUBE_COOKIES secret using a valid Netscape-format YouTube cookie export."
      );
    }

    // -------------------------------------------------------------------------
    // JAVASCRIPT / EJS CHALLENGE
    // -------------------------------------------------------------------------

    if (
      /javascript|js runtime|ejs|challenge/i.test(
        message
      )
    ) {
      throw new Error(
        "YouTube's player challenge could not be solved. " +
        "Make sure Render is using Node.js 22+ and the latest yt-dlp."
      );
    }

    // -------------------------------------------------------------------------
    // FFMPEG
    // -------------------------------------------------------------------------

    if (
      /ffmpeg|postprocess|conversion/i.test(
        message
      )
    ) {
      throw new Error(
        "FFmpeg audio conversion failed. " +
        "Make sure ffmpeg-static is installed correctly."
      );
    }

    // -------------------------------------------------------------------------
    // GENERAL ERROR
    // -------------------------------------------------------------------------

    throw new Error(
      `YouTube download failed: ${message}`
    );
  } finally {
    // -------------------------------------------------------------------------
    // CLEAN UP COOKIE FILE
    // -------------------------------------------------------------------------

    if (cookieFilePath) {
      await fs.rm(
        cookieFilePath,
        {
          force: true,
        }
      );
    }
  }
}

// -----------------------------------------------------------------------------
// YOUTUBE URL VALIDATION
// -----------------------------------------------------------------------------

function isYouTubeUrl(value) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return false;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      return false;
    }

    const hostname =
      url.hostname.toLowerCase();

    const allowedHosts = new Set([
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "www.youtu.be",
    ]);

    return allowedHosts.has(hostname);
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// FORMAT DURATION
// -----------------------------------------------------------------------------

function formatDuration(seconds) {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "Unknown duration";
  }

  const totalSeconds =
    Math.floor(seconds);

  const hours =
    Math.floor(totalSeconds / 3600);

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const remainingSeconds =
    totalSeconds % 60;

  if (hours > 0) {
    return (
      `${hours}:` +
      `${String(minutes).padStart(2, "0")}:` +
      `${String(remainingSeconds).padStart(2, "0")}`
    );
  }

  return (
    `${minutes}:` +
    `${String(remainingSeconds).padStart(2, "0")}`
  );
}

// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

module.exports = {
  searchYouTube,
  downloadYouTubeAudio,
};
