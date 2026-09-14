"use strict";

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const ytSearch = require("yt-search");
const ffmpegPath = require("ffmpeg-static");

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

const YT_DLP_PATH = path.join(
  __dirname,
  "node_modules",
  "youtube-dl-exec",
  "bin",
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
);

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
      console.log(`[YouTube] No result found for: ${cleanQuery}`);
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
// YT-DLP RUNTIME
// -----------------------------------------------------------------------------

const ytDlpRuntimeArgs = [
  "--js-runtimes",
  `node:${process.execPath}`,
];

// Try several extractor configurations because YouTube can behave
// differently depending on the server/IP and available player clients.
const extractorProfiles = [
  {
    name: "default",
    args: null,
  },
  {
    name: "android",
    args: "youtube:player_client=android",
  },
  {
    name: "ios",
    args: "youtube:player_client=ios",
  },
  {
    name: "web_safari",
    args: "youtube:player_client=web_safari",
  },
  {
    name: "tv",
    args: "youtube:player_client=tv",
  },
];

// -----------------------------------------------------------------------------
// RUN YT-DLP
// -----------------------------------------------------------------------------

function runYtDlp(videoUrl, outputPath, profile, cookieFilePath) {
  return new Promise((resolve, reject) => {
    const args = [
      videoUrl,

      // Output
      "--output",
      outputPath,

      // Audio
      "--format",
      "bestaudio/best",

      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",

      // Do not download playlists.
      "--no-playlist",

      // Reliability
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--retry-sleep",
      "1",

      // Avoid unnecessary output.
      "--no-warnings",

      // FFmpeg
      "--ffmpeg-location",
      ffmpegPath,

      // YouTube player challenge support.
      ...ytDlpRuntimeArgs,
    ];

    // Optional YouTube cookies.
    if (cookieFilePath) {
      args.push(
        "--cookies",
        cookieFilePath
      );
    }

    // Optional extractor profile.
    if (profile?.args) {
      args.push(
        "--extractor-args",
        profile.args
      );
    }

    console.log(
      `[YouTube] yt-dlp profile: ${profile.name}`
    );

    const child = spawn(
      YT_DLP_PATH,
      args,
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(
          new Error(
            "yt-dlp was not found. Run `npm install` and make sure youtube-dl-exec is installed."
          )
        );
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        });
        return;
      }

      const details =
        stderr.trim() ||
        stdout.trim() ||
        `yt-dlp exited with code ${code}`;

      reject(
        new Error(
          `yt-dlp exited with code ${code}: ${details}`
        )
      );
    });
  });
}

// -----------------------------------------------------------------------------
// DOWNLOAD YOUTUBE AUDIO
// -----------------------------------------------------------------------------

async function downloadYouTubeAudio(videoUrl, outputPath) {
  if (!isYouTubeUrl(videoUrl)) {
    throw new Error("Invalid YouTube URL.");
  }

  if (!ffmpegPath) {
    throw new Error(
      "FFmpeg was not found. Make sure ffmpeg-static is installed."
    );
  }

  if (!outputPath || typeof outputPath !== "string") {
    throw new Error("A valid output path is required.");
  }

  // Make sure the output directory exists.
  await fs.mkdir(
    path.dirname(outputPath),
    {
      recursive: true,
    }
  );

  // Remove an old file if one exists.
  await fs.rm(
    outputPath,
    {
      force: true,
    }
  );

  const failures = [];

  let cookieFilePath = null;

  try {
    // -------------------------------------------------------------------------
    // CREATE TEMPORARY COOKIE FILE
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
    // TRY EACH EXTRACTION PROFILE
    // -------------------------------------------------------------------------

    for (const profile of extractorProfiles) {
      await fs.rm(
        outputPath,
        {
          force: true,
        }
      );

      try {
        console.log(
          `[YouTube] Trying profile: ${profile.name}`
        );

        await runYtDlp(
          videoUrl,
          outputPath,
          profile,
          cookieFilePath
        );

        // Verify that the file actually exists.
        const fileInfo =
          await fs.stat(outputPath).catch(
            () => null
          );

        if (
          fileInfo &&
          fileInfo.isFile() &&
          fileInfo.size > 0
        ) {
          console.log(
            `[YouTube] Download succeeded: ${profile.name}`
          );

          return outputPath;
        }

        failures.push(
          `${profile.name}: yt-dlp completed but no audio file was created`
        );
      } catch (error) {
        const message =
          error?.message ||
          String(error);

        failures.push(
          `${profile.name}: ${message}`
        );

        console.error(
          `[YouTube] ${profile.name} failed:`,
          message
        );
      }
    }

    // -------------------------------------------------------------------------
    // DETECT COMMON YOUTUBE BLOCKING ERRORS
    // -------------------------------------------------------------------------

    const combinedFailures =
      failures.join("\n");

    let hint = "";

    if (
      /sign in to confirm|not a bot|confirm you're not a bot|bot detection/i.test(
        combinedFailures
      )
    ) {
      hint +=
        "\n\nYouTube is blocking the server's requests. " +
        "Set a fresh YOUTUBE_COOKIES environment secret using Netscape-format YouTube cookies.";
    }

    if (
      /javascript|js runtime|ejs|challenge/i.test(
        combinedFailures
      )
    ) {
      hint +=
        "\n\nYouTube's player challenge could not be solved. " +
        "Make sure the Node.js runtime and yt-dlp installation are current.";
    }

    if (
      /ffmpeg|postprocessing/i.test(
        combinedFailures
      )
    ) {
      hint +=
        "\n\nFFmpeg/audio conversion failed. " +
        "Make sure ffmpeg-static is installed correctly.";
    }

    throw new Error(
      [
        "All YouTube audio download methods failed.",
        "",
        combinedFailures,
        hint,
      ].join("\n")
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
    return `${hours}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(remainingSeconds).padStart(
      2,
      "0"
    )}`;
  }

  return `${minutes}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}

// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

module.exports = {
  searchYouTube,
  downloadYouTubeAudio,
};
