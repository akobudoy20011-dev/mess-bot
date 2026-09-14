const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const youtubedl = require("youtube-dl-exec");
const ytSearch = require("yt-search");
const ffmpegPath = require("ffmpeg-static");

const SEARCH_TIMEOUT = 30_000;
const DOWNLOAD_TIMEOUT = 180_000;

/* =========================================================
   TIMEOUT HELPER
========================================================= */

function withTimeout(task, timeout, message) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;

      finished = true;
      reject(new Error(message));
    }, timeout);

    Promise.resolve()
      .then(task)
      .then((result) => {
        if (finished) return;

        finished = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        if (finished) return;

        finished = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

/* =========================================================
   FILE HELPERS
========================================================= */

async function exists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Ignore cleanup errors.
  }
}

/* =========================================================
   SEARCH YOUTUBE
========================================================= */

async function searchYouTube(query) {
  const cleanQuery = String(query || "").trim();

  if (!cleanQuery) {
    throw new Error("Please provide a song name.");
  }

  console.log(`[YouTube] Searching for: ${cleanQuery}`);

  const result = await withTimeout(
    () => ytSearch(cleanQuery),
    SEARCH_TIMEOUT,
    "YouTube search timed out after 30 seconds. Please try again."
  );

  if (
    !result ||
    !Array.isArray(result.videos) ||
    result.videos.length === 0
  ) {
    throw new Error(
      `No YouTube result found for "${cleanQuery}".`
    );
  }

  const video = result.videos[0];

  if (!video || !video.url) {
    throw new Error(
      "YouTube returned an invalid video result."
    );
  }

  console.log(
    `[YouTube] Found: ${video.title || cleanQuery}`
  );

  return {
    title: video.title || cleanQuery,
    url: video.url,
    duration: video.duration || null,
    thumbnail: video.thumbnail || null,
    author: video.author?.name || "",
  };
}

/* =========================================================
   DOWNLOAD AUDIO
========================================================= */

async function downloadYouTubeAudio(videoUrl, destinationPath) {
  if (!videoUrl) {
    throw new Error("Missing YouTube URL.");
  }

  if (!destinationPath) {
    throw new Error("Missing destination path.");
  }

  const finalPath = path.resolve(destinationPath);
  const outputDirectory = path.dirname(finalPath);

  await fsp.mkdir(outputDirectory, {
    recursive: true,
  });

  const id = crypto.randomUUID();

  const temporaryBase = path.join(
    outputDirectory,
    `yt-audio-${id}`
  );

  const outputTemplate =
    `${temporaryBase}.%(ext)s`;

  console.log(
    `[YouTube] Downloading: ${videoUrl}`
  );

  console.log(
    `[YouTube] Output: ${outputTemplate}`
  );

  try {
    /*
     * IMPORTANT:
     *
     * Only use options that are actually needed.
     *
     * Do NOT add:
     * noWarnings
     * printAfterMove
     * noWriteThumbnail
     * noWriteSubs
     *
     * Those can be translated by youtube-dl-exec
     * into unsupported --no-* arguments.
     */

    const options = {
      output: outputTemplate,

      format: "bestaudio/best",

      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",

      /*
       * yt-dlp YouTube extraction support.
       */
      jsRuntimes: `node:${process.execPath}`,
      remoteComponents: "ejs:github",

      /*
       * FFmpeg used for MP3 conversion.
       */
      ffmpegLocation: ffmpegPath,

      /*
       * Basic download reliability.
       */
      retries: 3,
      fragmentRetries: 3,

      socketTimeout: 30,

      /*
       * Force IPv4.
       */
      forceIpv4: true,
    };

    console.log("[YouTube] Starting yt-dlp...");

    await withTimeout(
      () =>
        youtubedl(videoUrl, options, {
          stdio: ["ignore", "pipe", "pipe"],
        }),
      DOWNLOAD_TIMEOUT,
      "YouTube download timed out after 3 minutes. Please try again."
    );

    console.log("[YouTube] yt-dlp finished.");

    /*
     * Expected post-processed file.
     */
    const expectedMp3 =
      `${temporaryBase}.mp3`;

    let sourceFile = null;

    if (await exists(expectedMp3)) {
      sourceFile = expectedMp3;
    } else {
      /*
       * Fallback:
       * Search for whatever yt-dlp actually produced.
       */
      const files = await fsp.readdir(
        outputDirectory
      );

      const prefix =
        path.basename(temporaryBase) + ".";

      const generated = files.filter((file) =>
        file.startsWith(prefix)
      );

      console.log(
        "[YouTube] Generated files:",
        generated
      );

      /*
       * Prefer MP3.
       */
      const mp3 = generated.find((file) =>
        file.toLowerCase().endsWith(".mp3")
      );

      if (mp3) {
        sourceFile = path.join(
          outputDirectory,
          mp3
        );
      }

      /*
       * If MP3 wasn't produced, look for common
       * audio formats as a fallback.
       */
      if (!sourceFile) {
        const audioExtensions = [
          ".m4a",
          ".webm",
          ".opus",
          ".aac",
          ".wav",
          ".flac",
        ];

        const audioFile = generated.find((file) =>
          audioExtensions.some((extension) =>
            file.toLowerCase().endsWith(extension)
          )
        );

        if (audioFile) {
          sourceFile = path.join(
            outputDirectory,
            audioFile
          );
        }
      }
    }

    if (!sourceFile) {
      throw new Error(
        "yt-dlp finished but no audio file was produced."
      );
    }

    if (!(await exists(sourceFile))) {
      throw new Error(
        "The downloaded audio file could not be found."
      );
    }

    const sourceStats =
      await fsp.stat(sourceFile);

    if (!sourceStats.isFile()) {
      throw new Error(
        "The downloaded audio path is not a file."
      );
    }

    if (sourceStats.size <= 0) {
      throw new Error(
        "The downloaded audio file is empty."
      );
    }

    /*
     * Move the generated audio to the exact path
     * requested by the bot.
     */
    await safeUnlink(finalPath);

    await fsp.rename(
      sourceFile,
      finalPath
    );

    /*
     * Verify final file.
     */
    const finalStats =
      await fsp.stat(finalPath);

    if (
      !finalStats.isFile() ||
      finalStats.size <= 0
    ) {
      throw new Error(
        "The final audio file is empty."
      );
    }

    console.log(
      `[YouTube] Audio ready: ${finalPath}`
    );

    console.log(
      `[YouTube] File size: ${finalStats.size} bytes`
    );

    return finalPath;
  } catch (error) {
    console.error(
      "[YouTube] Download failed:",
      error
    );

    /*
     * Cleanup every temporary file belonging
     * to this download.
     */
    try {
      const files = await fsp.readdir(
        outputDirectory
      );

      const prefix =
        path.basename(temporaryBase) + ".";

      for (const file of files) {
        if (file.startsWith(prefix)) {
          await safeUnlink(
            path.join(
              outputDirectory,
              file
            )
          );
        }
      }
    } catch {
      // Ignore cleanup errors.
    }

    let message =
      error?.stderr ||
      error?.message ||
      String(error);

    if (typeof message !== "string") {
      message = String(message);
    }

    message = message.trim();

    /*
     * Remove excessive duplicate whitespace.
     */
    message = message.replace(
      /\n{3,}/g,
      "\n\n"
    );

    /*
     * Keep Messenger error messages reasonable.
     */
    if (message.length > 3000) {
      message =
        message.slice(-3000);
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
