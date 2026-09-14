"use strict";

const fs = require("fs/promises");
const path = require("path");

const ytSearch = require("yt-search");
const ytdlp = require("youtube-dl-exec");
const ffmpegPath = require("ffmpeg-static");

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------

const YOUTUBE_COOKIES =
  typeof process.env.YOUTUBE_COOKIES === "string" &&
  process.env.YOUTUBE_COOKIES.trim()
    ? process.env.YOUTUBE_COOKIES.trim()
    : null;

// -----------------------------------------------------------------------------
// SEARCH
// -----------------------------------------------------------------------------

async function searchYouTube(query) {
  if (typeof query !== "string" || !query.trim()) {
    return null;
  }

  const cleanQuery = query.trim();

  console.log(`[YouTube] Searching: ${cleanQuery}`);

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
      console.log("[YouTube] No result found.");
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
        error?.message || "Unknown error"
      }`
    );
  }
}

// -----------------------------------------------------------------------------
// DOWNLOAD
// -----------------------------------------------------------------------------

async function downloadYouTubeAudio(videoUrl, outputPath) {
  if (!isYouTubeUrl(videoUrl)) {
    throw new Error("Invalid YouTube URL.");
  }

  if (!ffmpegPath) {
    throw new Error(
      "FFmpeg is unavailable. Make sure ffmpeg-static is installed."
    );
  }

  if (
    typeof outputPath !== "string" ||
    !outputPath.trim()
  ) {
    throw new Error("Invalid output path.");
  }

  await fs.mkdir(
    path.dirname(outputPath),
    { recursive: true }
  );

  await fs.rm(
    outputPath,
    { force: true }
  );

  let cookieFile = null;

  try {
    // ---------------------------------------------------------
    // COOKIES
    // ---------------------------------------------------------

    if (YOUTUBE_COOKIES) {
      cookieFile =
        `${outputPath}.youtube-cookies.txt`;

      await fs.writeFile(
        cookieFile,
        `${YOUTUBE_COOKIES}\n`,
        {
          mode: 0o600,
        }
      );

      console.log(
        "[YouTube] Using YOUTUBE_COOKIES."
      );
    }

    // ---------------------------------------------------------
    // YT-DLP OPTIONS
    // ---------------------------------------------------------

    const options = {
      output: outputPath,

      format:
        "bestaudio[ext=m4a]/bestaudio/best",

      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",

      noPlaylist: true,

      retries: 5,
      fragmentRetries: 5,

      ffmpegLocation: ffmpegPath,

      // Current yt-dlp requires an external JS runtime
      // for full YouTube extraction.
      jsRuntimes: `node:${process.execPath}`,

      noWarnings: false,
    };

    if (cookieFile) {
      options.cookies = cookieFile;
    }

    // ---------------------------------------------------------
    // EJS CHALLENGE SOLVER
    // ---------------------------------------------------------

    // Allow yt-dlp to obtain its current EJS components.
    options.remoteComponents = "ejs:github";

    console.log(
      "[YouTube] Starting yt-dlp..."
    );

    console.log(
      `[YouTube] URL: ${videoUrl}`
    );

    // ---------------------------------------------------------
    // EXECUTE
    // ---------------------------------------------------------

    await ytdlp(
      videoUrl,
      options,
      {
        timeout: 180000,
      }
    );

    // ---------------------------------------------------------
    // VERIFY
    // ---------------------------------------------------------

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
      `[YouTube] Audio ready: ${fileInfo.size} bytes`
    );

    return outputPath;
  } catch (error) {
    const message =
      error?.stderr ||
      error?.message ||
      String(error);

    console.error(
      "[YouTube] Download failed:",
      message
    );

    if (
      /sign in to confirm|not a bot|confirm you're not a bot|bot detection/i.test(
        message
      )
    ) {
      throw new Error(
        "YouTube is blocking Render's server request. " +
        "A fresh YOUTUBE_COOKIES secret may be required."
      );
    }

    if (
      /javascript|js runtime|ejs|challenge/i.test(
        message
      )
    ) {
      throw new Error(
        "YouTube's JavaScript challenge could not be solved. " +
        "Make sure Render is using Node.js 22+ and the latest yt-dlp."
      );
    }

    if (
      /ffmpeg|postprocess|conversion/i.test(
        message
      )
    ) {
      throw new Error(
        "FFmpeg audio conversion failed."
      );
    }

    throw new Error(
      `YouTube download failed: ${message}`
    );
  } finally {
    if (cookieFile) {
      await fs.rm(
        cookieFile,
        { force: true }
      );
    }
  }
}

// -----------------------------------------------------------------------------
// URL VALIDATION
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

    return [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "www.youtu.be",
    ].includes(
      url.hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// DURATION
// -----------------------------------------------------------------------------

function formatDuration(seconds) {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "Unknown duration";
  }

  const total =
    Math.floor(seconds);

  const hours =
    Math.floor(total / 3600);

  const minutes =
    Math.floor(
      (total % 3600) / 60
    );

  const secs =
    total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(secs).padStart(
      2,
      "0"
    )}`;
  }

  return `${minutes}:${String(secs).padStart(
    2,
    "0"
  )}`;
}

// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

module.exports = {
  searchYouTube,
  downloadYouTubeAudio,
};
