"use strict";

const fs = require("fs/promises");
const path = require("path");
const ytSearch = require("yt-search");
const youtubeDl = require("youtube-dl-exec");
const ffmpegPath = require("ffmpeg-static");

async function searchYouTube(query) {
  if (typeof query !== "string" || !query.trim()) {
    return null;
  }

  const result = await ytSearch(query.trim());
  const videos = Array.isArray(result.videos)
    ? result.videos
    : [];

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

async function downloadYouTubeAudio(videoUrl, outputPath) {
  if (!isYouTubeUrl(videoUrl)) {
    throw new Error("Invalid YouTube URL.");
  }

  if (!ffmpegPath) {
    throw new Error("ffmpeg was not found.");
  }

  await fs.mkdir(path.dirname(outputPath), {
    recursive: true,
  });

  await fs.rm(outputPath, { force: true });

  try {
    await youtubeDl(videoUrl, {
      output: outputPath,
      format: "bestaudio/best",
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",
      noPlaylist: true,
      ffmpegLocation: ffmpegPath,
      retries: 3,
      fragmentRetries: 3,
      noWarnings: false,
      verbose: false,
    });
  } catch (error) {
    const details =
      error.stderr ||
      error.stdout ||
      error.message ||
      String(error);

    throw new Error(
      `YouTube audio download failed:\n${details}`
    );
  }

  const fileInfo = await fs.stat(outputPath).catch(() => null);

  if (!fileInfo || fileInfo.size === 0) {
    throw new Error(
      "The download completed, but no audio file was created."
    );
  }

  return outputPath;
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
