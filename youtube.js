// youtube.js
//
// Uses YouTube search to find songs and downloads audio using yt-dlp.
// Acts as a fallback source after Jamendo and Spotify.
//
// Warning: Downloading copyrighted music from YouTube may violate
// YouTube's Terms of Service. Use at your own discretion.
// This is intended for non-commercial, personal use only.

const yts = require("yt-search");
const ytdlp = require("yt-dlp-exec");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Searches YouTube for a song and returns video metadata.
 * @param {string} query - e.g. "laufey flowers"
 * @returns {Promise<{ title: string, url: string, duration: number, views: number } | null>}
 */
async function searchYouTube(query) {
  try {
    if (!query || !query.trim()) {
      return null;
    }

    console.log(`[YouTube] Searching for: "${query}"`);

    const searchResults = await yts(query);
    const video = searchResults?.videos?.[0];

    if (!video) {
      console.log(`[YouTube] No results found for: "${query}"`);
      return null;
    }

    console.log(`[YouTube] Found: ${video.title}`);
    console.log(`[YouTube] URL: ${video.url}`);
    console.log(`[YouTube] Duration: ${video.timestamp}`);
    console.log(`[YouTube] Views: ${video.views}`);

    return {
      title: video.title,
      url: video.url,
      duration: video.timestamp,
      views: video.views,
    };
  } catch (error) {
    console.error("[YouTube] Search error:");
    console.error("  Message:", error.message);
    console.error("  Stack:", error.stack);
    throw error;
  }
}

/**
 * Downloads audio from a YouTube URL using yt-dlp.
 * Caller is responsible for deleting the file after use.
 * @param {string} videoUrl
 * @param {string} destPath - e.g. "/tmp/youtube_audio_12345.mp3"
 */
async function downloadYouTubeAudio(videoUrl, destPath) {
  try {
    console.log(`[YouTube] Starting download from: ${videoUrl}`);
    console.log(`[YouTube] Destination: ${destPath}`);

    await ytdlp(videoUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      output: destPath,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      quiet: false,
    });

    if (!fs.existsSync(destPath)) {
      throw new Error(`Downloaded file does not exist at ${destPath}`);
    }

    const fileStats = fs.statSync(destPath);
    console.log(`[YouTube] Download complete. File size: ${fileStats.size} bytes`);

    return destPath;
  } catch (error) {
    console.error("[YouTube] Download error:");
    console.error("  Message:", error.message);
    console.error("  Stack:", error.stack);
    throw error;
  }
}

module.exports = { searchYouTube, downloadYouTubeAudio };
