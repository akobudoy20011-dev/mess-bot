"use strict";
const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const ytSearch = require("yt-search");
const ffmpegPath = require("ffmpeg-static");

// youtube-dl-exec installs the current yt-dlp binary in this project.
const localYtDlpBinary = path.join(__dirname, "node_modules", "youtube-dl-exec", "bin", "yt-dlp");

async function searchYouTube(query) {
  if (typeof query !== "string" || !query.trim()) {
    return null;
  }
  const result = await ytSearch(query.trim());
  const videos = Array.isArray(result.videos) ? result.videos : [];
  const video = videos.find(
    (item) =>
      item &&
      typeof item.url === "string" &&
      isYouTubeUrl(item.url)
  );
  if (!video) {
    return null;
  }
  return {
    title: video.title || "Unknown title",
    url: video.url,
    duration:
      typeof video.timestamp === "string"
        ? video.timestamp
        : formatDuration(video.seconds),
    thumbnail: video.thumbnail || null,
  };
}

// Recent yt-dlp versions use EJS to solve YouTube's player challenges.
// Node 22+ is supported as a JavaScript runtime for that solver.
const ytDlpRuntimeArgs = [
  "--js-runtimes",
  `node:${process.execPath}`,
];

const extractorProfiles = [
  {
    name: "default",
    args: null,
  },
  {
    name: "tv",
    args: "youtube:player_client=tv",
  },
  {
    name: "web_safari",
    args: "youtube:player_client=web_safari",
  },
  {
    name: "mweb",
    args: "youtube:player_client=mweb",
  },
];

function runYtDlp(videoUrl, outputPath, profile) {
  return new Promise((resolve, reject) => {
    const args = [
      videoUrl,
      "--output", outputPath,
      "--format", "bestaudio/best",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--no-playlist",
      "--no-warnings",
      "--retries", "3",
      "--fragment-retries", "3",
      "--ffmpeg-location", ffmpegPath,
      ...ytDlpRuntimeArgs,
    ];

    if (profile.args) {
      args.push("--extractor-args", profile.args);
    }

    const child = spawn(localYtDlpBinary, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "yt-dlp was not found. Install dependencies with: npm install"
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const details = stderr || stdout || `yt-dlp exited with code ${code}`;
        reject(new Error(`YouTube audio download failed:\n${details}`));
      }
    });
  });
}

async function downloadYouTubeAudio(videoUrl, outputPath) {
  if (!isYouTubeUrl(videoUrl)) {
    throw new Error("Invalid YouTube URL.");
  }
  if (!ffmpegPath) {
    throw new Error("ffmpeg was not found.");
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.rm(outputPath, { force: true });

  const failures = [];

  for (const profile of extractorProfiles) {
    await fs.rm(outputPath, { force: true });

    try {
      console.log(
        `[YouTube] Trying extractor profile: ${profile.name}`
      );

      await runYtDlp(videoUrl, outputPath, profile);

      const fileInfo = await fs.stat(outputPath).catch(() => null);

      if (fileInfo && fileInfo.size > 0) {
        console.log(
          `[YouTube] Download succeeded with profile: ${profile.name}`
        );
        return outputPath;
      }

      failures.push(
        `${profile.name}: no audio file was created`
      );
    } catch (error) {
      const message = error?.message || String(error);
      failures.push(`${profile.name}: ${message}`);
      console.error(
        `[YouTube] Profile ${profile.name} failed:`,
        message
      );
    }
  }

  throw new Error(
    `All YouTube extractor profiles failed:\n${failures.join("\n")}`
  );
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "Unknown duration";
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

module.exports = {
  searchYouTube,
  downloadYouTubeAudio,
};
