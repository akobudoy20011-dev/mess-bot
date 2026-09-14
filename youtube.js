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

  if (
    typeof outputPath !== "string" ||
    !outputPath.trim()
  ) {
    throw new Error("Invalid output path.");
  }

  const outputDirectory = path.dirname(outputPath);

  await fs.mkdir(outputDirectory, {
    recursive: true,
  });

  await fs.rm(outputPath, {
    force: true,
  });

  /*
   * yt-dlp uses an output TEMPLATE.
   *
   * We deliberately don't give it the final .mp3 filename directly.
   * Instead it creates:
   *
   *     <temporary-base>.<extension>
   *
   * and then FFmpeg converts it to:
   *
   *     <temporary-base>.mp3
   *
   * We then move that MP3 to the exact outputPath expected by index.js.
   */

  const temporaryBase = path.join(
    outputDirectory,
    `yt-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );

  const outputTemplate =
    `${temporaryBase}.%(ext)s`;

  let cookieFilePath = null;

  try {
    // -------------------------------------------------------------------------
    // OPTIONAL COOKIES
    // -------------------------------------------------------------------------

    if (YOUTUBE_COOKIES) {
      cookieFilePath =
        `${temporaryBase}.cookies.txt`;

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
    // -------------------------------------------------------------------------

    const options = {
      output: outputTemplate,

      /*
       * Prefer audio-only formats.
       */
      format:
        "bestaudio[ext=m4a]/bestaudio/best",

      /*
       * Convert to MP3 using FFmpeg.
       */
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",

      /*
       * Never download playlists.
       */
      noPlaylist: true,

      /*
       * Retry network requests.
       */
      retries: 5,
      fragmentRetries: 5,

      /*
       * FFmpeg binary supplied by ffmpeg-static.
       */
      ffmpegLocation: ffmpegPath,

      /*
       * JavaScript runtime required by current YouTube extraction.
       */
      jsRuntimes:
        `node:${process.execPath}`,

      /*
       * Enable yt-dlp's EJS challenge components.
       */
      remoteComponents:
        "ejs:github",

      /*
       * Don't hide useful errors.
       */
      noWarnings: false,
    };

    if (cookieFilePath) {
      options.cookies = cookieFilePath;
    }

    console.log(
      "[YouTube] Starting yt-dlp..."
    );

    console.log(
      `[YouTube] URL: ${videoUrl}`
    );

    console.log(
      `[YouTube] Output template: ${outputTemplate}`
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
    // FIND GENERATED MP3
    // -------------------------------------------------------------------------

    let generatedAudio = null;

    const files =
      await fs.readdir(outputDirectory);

    const temporaryPrefix =
      path.basename(temporaryBase) + ".";

    const candidates = files.filter(
      (file) =>
        file.startsWith(temporaryPrefix) &&
        file.toLowerCase().endsWith(".mp3")
    );

    if (candidates.length > 0) {
      generatedAudio =
        path.join(
          outputDirectory,
          candidates[0]
        );
    }

    // -------------------------------------------------------------------------
    // FALLBACK: CHECK EXACT OUTPUT PATH
    // -------------------------------------------------------------------------

    if (!generatedAudio) {
      const exactFile =
        await fs.stat(outputPath).catch(
          () => null
        );

      if (
        exactFile &&
        exactFile.isFile() &&
        exactFile.size > 0
      ) {
        console.log(
          `[YouTube] Audio already exists at output path: ${exactFile.size} bytes`
        );

        return outputPath;
      }
    }

    // -------------------------------------------------------------------------
    // NO AUDIO
    // -------------------------------------------------------------------------

    if (!generatedAudio) {
      throw new Error(
        "yt-dlp finished but no MP3 audio file was produced."
      );
    }

    const generatedInfo =
      await fs.stat(generatedAudio);

    if (
      !generatedInfo.isFile() ||
      generatedInfo.size <= 0
    ) {
      throw new Error(
        "yt-dlp created an empty audio file."
      );
    }

    console.log(
      `[YouTube] Generated MP3: ${generatedInfo.size} bytes`
    );

    // -------------------------------------------------------------------------
    // MOVE MP3 TO EXPECTED OUTPUT PATH
    // -------------------------------------------------------------------------

    await fs.rm(outputPath, {
      force: true,
    });

    await fs.rename(
      generatedAudio,
      outputPath
    );

    // -------------------------------------------------------------------------
    // VERIFY FINAL FILE
    // -------------------------------------------------------------------------

    const finalInfo =
      await fs.stat(outputPath).catch(
        () => null
      );

    if (
      !finalInfo ||
      !finalInfo.isFile() ||
      finalInfo.size <= 0
    ) {
      throw new Error(
        "Audio was generated but could not be moved to the final output path."
      );
    }

    console.log(
      `[YouTube] Final audio ready: ${finalInfo.size} bytes`
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

    if (
      /sign in to confirm|not a bot|confirm you're not a bot|bot detection/i.test(
        message
      )
    ) {
      throw new Error(
        "YouTube is blocking Render's server request. Configure a fresh YOUTUBE_COOKIES secret."
      );
    }

    if (
      /javascript|js runtime|ejs|challenge/i.test(
        message
      )
    ) {
      throw new Error(
        "YouTube's JavaScript challenge could not be solved. Make sure Render is using Node.js 22+ and yt-dlp is current."
      );
    }

    if (
      /ffmpeg|postprocess|conversion/i.test(
        message
      )
    ) {
      throw new Error(
        "FFmpeg audio conversion failed. Make sure ffmpeg-static is installed correctly."
      );
    }

    throw new Error(
      `YouTube download failed: ${message}`
    );
  } finally {
    // -------------------------------------------------------------------------
    // CLEAN TEMPORARY FILES
    // -------------------------------------------------------------------------

    try {
      const files =
        await fs.readdir(outputDirectory);

      const prefix =
        path.basename(temporaryBase) + ".";

      for (const file of files) {
        if (file.startsWith(prefix)) {
          await fs.rm(
            path.join(outputDirectory, file),
            {
              force: true,
            }
          );
        }
      }
    } catch {
      // Ignore cleanup errors.
    }

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

    return [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "www.youtu.be",
    ].includes(hostname);
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
