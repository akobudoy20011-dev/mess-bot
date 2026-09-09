// youtube.js
//
// Uses YouTube search to find songs and downloads audio using yt-dlp.
// Acts as a fallback source after Jamendo and Spotify.
//
// Warning: Downloading copyrighted music from YouTube may violate
// YouTube's Terms of Service. Use at your own discretion.
// This is intended for non-commercial, personal use only.

const ytSearch = require("yt-search");
const youtubeDl = require("youtube-dl-exec");
const fs = require("fs");

/**
 * Search YouTube for a video.
 *
 * @param {string} query
 * @returns {Promise<object|null>}
 */
async function searchYouTube(query) {
  if (!query || typeof query !== "string" || !query.trim()) {
    return null;
  }

  const searchResult = await ytSearch(query.trim());
  const video = searchResult?.videos?.[0];

  if (!video) {
    return null;
  }

  return {
    title: video.title || "Unknown title",
    url: video.url,
    duration: video.timestamp || "Unknown duration",
    seconds: video.seconds || 0,
    thumbnail: video.thumbnail || null
  };
}

/**
 * Download YouTube audio.
 *
 * This requires ffmpeg for MP3 conversion.
 *
 * @param {string} videoUrl
 * @param {string} outputPath
 * @returns {Promise<string>}
 */
async function downloadYouTubeAudio(videoUrl, outputPath) {
  if (!videoUrl || typeof videoUrl !== "string") {
    throw new TypeError("A valid YouTube URL is required.");
  }

  if (!outputPath || typeof outputPath !== "string") {
    throw new TypeError("A valid output path is required.");
  }

  await youtubeDl(videoUrl, {
    output: outputPath,
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: "128K",
    noPlaylist: true,
    noWarnings: true,
    preferFreeFormats: true
  });

  if (!fs.existsSync(outputPath)) {
    throw new Error("YouTube downloader finished, but no output file was created.");
  }

  const stats = fs.statSync(outputPath);

  if (stats.size === 0) {
    throw new Error("The downloaded YouTube file is empty.");
  }

  return outputPath;
}

module.exports = {
  searchYouTube,
  downloadYouTubeAudio
};
