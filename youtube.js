// youtube.js

const fs = require("fs/promises");
const path = require("path");
const ytSearch = require("yt-search");
const youtubeDl = require("youtube-dl-exec");
const ffmpegPath = require("ffmpeg-static");

/**
 * Search YouTube and return the first usable video.
 *
 * @param {string} query
 * @returns {Promise<object|null>}
 */
async function searchYouTube(query) {
  if (typeof query !== "string" || !query.trim()) {
    return null;
  }

  const searchTerm = query.trim();

  try {
    const result = await ytSearch(searchTerm);
    const videos = Array.isArray(result?.videos) ? result.videos : [];

    const video = videos.find(
      (item) =>
        item &&
        typeof item.url === "string" &&
        item.url.startsWith("https://www.youtube.com/")
    );

    if (!video) {
      return null;
    }

    return {
      title: video.title || "Unknown YouTube video",
      url: video.url,
      duration:
        typeof video.timestamp === "string"
          ? video.timestamp
          : formatDuration(video.seconds),
      thumbnail: video.thumbnail || null,
    };
  } catch (error) {
    throw new Error(`YouTube search failed: ${error.message}`);
  }
}

/**
 * Download a YouTube video as an MP3 file.
 *
 * @param {string} videoUrl
 * @param {string} outputPath
 * @returns {Promise<string>}
 */
async function downloadYouTubeAudio(videoUrl, outputPath) {
  if (typeof videoUrl !== "string" || !isYouTubeUrl(videoUrl)) {
    throw new Error("Invalid YouTube URL.");
  }

  if (typeof outputPath !== "string" || !outputPath.trim()) {
    throw new Error("An output path is required.");
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Remove an old file if one exists.
  await fs.rm(outputPath, { force: true });

  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg was not found. Install the ffmpeg-static package."
    );
  }

  const baseOptions = {
    output: outputPath,

    // Select audio and convert it to MP3.
    format: "bestaudio/best",
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: "0",

    // Do not download playlists accidentally.
    noPlaylist: true,

    // Needed for YouTube challenges and current yt-dlp versions.
    jsRuntimes: "node",
    remoteComponents: "ejs:github",

    // Use the npm-provided ffmpeg binary.
    ffmpegLocation: ffmpegPath,

    // Retry transient network errors.
    retries: 3,
    fragmentRetries: 3,

    // More useful error output.
    noWarnings: false,
    verbose: false,
  };

  try {
    console.log(`[YouTube] Downloading: ${videoUrl}`);

    await youtubeDl(videoUrl, baseOptions);
  } catch (firstError) {
    console.error("[YouTube] First download attempt failed:");
    console.error(firstError.stderr || firstError.message);

    /*
     * YouTube sometimes rejects one player client depending on the server
     * or IP address. Try a second client configuration.
     */
    try {
      console.log("[YouTube] Retrying with an alternate player client...");

      await youtubeDl(videoUrl, {
        ...baseOptions,
        extractorArgs: "youtube:player_client=android,web_safari",
      });
    } catch (secondError) {
      const details =
        secondError.stderr ||
        secondError.stdout ||
        secondError.message ||
        String(secondError);

      throw new Error(`yt-dlp could not extract this video:\n${details}`);
    }
  }

  const fileInfo = await fs.stat(outputPath).catch(() => null);

  if (!fileInfo || fileInfo.size === 0) {
    throw new Error("yt-dlp completed, but no audio file was created.");
  }

  console.log(
    `[YouTube] Audio downloaded successfully: ${fileInfo.size} bytes`
  );

  return outputPath;
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      (url.hostname === "youtube.com" ||
        url.hostname === "www.youtube.com" ||
        url.hostname === "m.youtube.com" ||
        url.hostname === "youtu.be" ||
        url.hostname === "www.youtu.be")
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
