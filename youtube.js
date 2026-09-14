const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const youtubedl = require("youtube-dl-exec");
const ytSearch = require("yt-search");

const FFMPEG_PATH = require("ffmpeg-static");

const YOUTUBE_SEARCH_TIMEOUT = 30_000;
const YOUTUBE_DOWNLOAD_TIMEOUT = 180_000;

/* =========================================================
   HELPERS
========================================================= */

function withTimeout(promiseFactory, timeout, message) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, timeout);

    Promise.resolve()
      .then(promiseFactory)
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeFile(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Ignore cleanup errors.
  }
}

/* =========================================================
   YOUTUBE SEARCH
========================================================= */

async function searchYouTube(query) {
  const cleanQuery = String(query || "").trim();

  if (!cleanQuery) {
    throw new Error("Please provide a song name.");
  }

  console.log(`[YouTube] Searching for: ${cleanQuery}`);

  const result = await withTimeout(
    () => ytSearch(cleanQuery),
    YOUTUBE_SEARCH_TIMEOUT,
    "YouTube search timed out after 30 seconds. Please try again."
  );

  if (!result || !Array.isArray(result.videos) || result.videos.length === 0) {
    throw new Error(`No YouTube result found for "${cleanQuery}".`);
  }

  const video = result.videos[0];

  if (!video || !video.url) {
    throw new Error("YouTube returned an invalid result.");
  }

  console.log(
    `[YouTube] Found: ${video.title || "Unknown title"}`
  );

  return {
    title: video.title || cleanQuery,
    url: video.url,
    duration: video.duration,
    thumbnail: video.thumbnail,
    author: video.author?.name || "",
  };
}

/* =========================================================
   DOWNLOAD YOUTUBE AUDIO
========================================================= */

async function downloadYouTubeAudio(videoUrl, destinationPath) {
  if (!videoUrl) {
    throw new Error("Missing YouTube URL.");
  }

  if (!destinationPath) {
    throw new Error("Missing destination path.");
  }

  const absoluteDestination = path.resolve(destinationPath);
  const destinationDir = path.dirname(absoluteDestination);

  await fsp.mkdir(destinationDir, {
    recursive: true,
  });

  const uniqueId = crypto.randomUUID();

  /*
   * Use a temporary output template instead of asking yt-dlp
   * to write directly to the final filename.
   *
   * yt-dlp will create:
   *
   *   temporaryBase.mp3
   *
   * after FFmpeg post-processing.
   */
  const temporaryBase = path.join(
    destinationDir,
    `yt-${uniqueId}`
  );

  const outputTemplate = `${temporaryBase}.%(ext)s`;

  console.log("[YouTube] Starting audio download...");
  console.log(`[YouTube] URL: ${videoUrl}`);
  console.log(`[YouTube] Output template: ${outputTemplate}`);

  try {
    const args = {
      output: outputTemplate,

      /*
       * Best audio available.
       */
      format: "bestaudio/best",

      /*
       * Convert extracted audio to MP3.
       */
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",

      /*
       * Current yt-dlp YouTube extraction may require
       * an external JS runtime / EJS challenge solver.
       *
       * Render should use Node 22.
       */
      jsRuntimes: `node:${process.execPath}`,
      remoteComponents: "ejs:github",

      /*
       * FFmpeg supplied by ffmpeg-static.
       */
      ffmpegLocation: FFMPEG_PATH,

      /*
       * Do NOT add:
       *
       * noWarnings: false
       *
       * because youtube-dl-exec would turn that into:
       *
       * --no-no-warnings
       *
       * which is invalid.
       */

      noCheckCertificates: true,

      /*
       * Avoid playlist behavior.
       */
      noPlaylist: true,

      /*
       * Do not download subtitles/thumbnails.
       */
      noWriteThumbnail: true,
      noWriteSubs: true,

      /*
       * Keep output quiet enough for Render logs,
       * while still allowing errors to surface.
       */
      printAfterMove: false,

      /*
       * Retry transient download failures.
       */
      retries: 3,
      fragmentRetries: 3,

      /*
       * Continue through normal HTTP issues.
       */
      socketTimeout: 30,

      /*
       * Prefer IPv4 where available.
       */
      forceIpv4: true,
    };

    console.log("[YouTube] Running yt-dlp...");

    await withTimeout(
      () =>
        youtubedl(videoUrl, args, {
          stdio: ["ignore", "pipe", "pipe"],
        }),
      YOUTUBE_DOWNLOAD_TIMEOUT,
      "YouTube download timed out after 3 minutes. Please try again."
    );

    /*
     * yt-dlp + FFmpeg should produce:
     *
     * yt-UUID.mp3
     */
    const generatedMp3 = `${temporaryBase}.mp3`;

    if (!(await fileExists(generatedMp3))) {
      /*
       * Some yt-dlp/FFmpeg combinations can leave a different
       * extension behind. Search the temporary directory for
       * the generated file.
       */
      const files = await fsp.readdir(destinationDir);

      const generatedFiles = files.filter((file) =>
        file.startsWith(path.basename(temporaryBase) + ".")
      );

      console.log(
        "[YouTube] Generated files:",
        generatedFiles
      );

      const mp3Candidate = generatedFiles.find((file) =>
        file.toLowerCase().endsWith(".mp3")
      );

      if (!mp3Candidate) {
        throw new Error(
          "yt-dlp finished but no audio file was produced."
        );
      }

      const candidatePath = path.join(
        destinationDir,
        mp3Candidate
      );

      await fsp.rename(
        candidatePath,
        absoluteDestination
      );
    } else {
      /*
       * Move the generated MP3 to the destination expected
       * by the rest of the bot.
       */
      await fsp.rename(
        generatedMp3,
        absoluteDestination
      );
    }

    /*
     * Verify the final file exists and isn't empty.
     */
    const stat = await fsp.stat(absoluteDestination);

    if (!stat.isFile()) {
      throw new Error(
        "The downloaded audio path is not a file."
      );
    }

    if (stat.size <= 0) {
      throw new Error(
        "The downloaded audio file is empty."
      );
    }

    console.log(
      `[YouTube] Audio ready: ${absoluteDestination} (${stat.size} bytes)`
    );

    return absoluteDestination;
  } catch (error) {
    console.error(
      "[YouTube] Download failed:",
      error
    );

    /*
     * Cleanup temporary yt-dlp output.
     */
    try {
      const files = await fsp.readdir(destinationDir);

      const prefix =
        path.basename(temporaryBase) + ".";

      for (const file of files) {
        if (file.startsWith(prefix)) {
          await removeFile(
            path.join(destinationDir, file)
          );
        }
      }
    } catch {
      // Ignore cleanup errors.
    }

    /*
     * Preserve useful yt-dlp error text.
     */
    let message =
      error?.stderr ||
      error?.message ||
      String(error);

    if (typeof message !== "string") {
      message = String(message);
    }

    /*
     * Prevent an enormous Render error dump.
     */
    message = message.trim();

    if (message.length > 3000) {
      message = message.slice(-3000);
    }

    throw new Error(
      `YouTube download failed: ${message}`
    );
  }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  searchYouTube,
  downloadYouTubeAudio,
};
