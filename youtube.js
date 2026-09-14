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
   TIMEOUT
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

  console.log(
    `[YouTube] Searching for: ${cleanQuery}`
  );

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
   DOWNLOAD YOUTUBE AUDIO
========================================================= */

async function downloadYouTubeAudio(
  videoUrl,
  destinationPath
) {
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

  /*
   * Use a unique temporary filename.
   *
   * We intentionally use %(id)s and %(ext)s so yt-dlp
   * tells us exactly what it created.
   */
  const temporaryTemplate = path.join(
    outputDirectory,
    `yt-audio-${id}.%(ext)s`
  );

  console.log(
    `[YouTube] Downloading: ${videoUrl}`
  );

  console.log(
    `[YouTube] Temporary output: ${temporaryTemplate}`
  );

  let temporaryFiles = [];

  try {
    /*
     * Keep the yt-dlp options minimal.
     *
     * IMPORTANT:
     * There is deliberately NO:
     *
     * noWarnings
     * printAfterMove
     * noWriteThumbnail
     * noWriteSubs
     *
     * Those caused invalid --no-* arguments before.
     */
    const options = {
      output: temporaryTemplate,

      format: "bestaudio/best",

      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",

      /*
       * YouTube JS challenge support.
       */
      jsRuntimes: `node:${process.execPath}`,
      remoteComponents: "ejs:github",

      /*
       * FFmpeg.
       */
      ffmpegLocation: ffmpegPath,

      /*
       * Download reliability.
       */
      retries: 3,
      fragmentRetries: 3,
      socketTimeout: 30,
      forceIpv4: true,

      /*
       * Ask yt-dlp to print the final prepared filename.
       */
      print: "after_move:filepath",
    };

    console.log(
      "[YouTube] Starting yt-dlp..."
    );

    const result = await withTimeout(
      () =>
        youtubedl(videoUrl, options, {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }),
      DOWNLOAD_TIMEOUT,
      "YouTube download timed out after 3 minutes. Please try again."
    );

    console.log(
      "[YouTube] yt-dlp finished."
    );

    /*
     * youtube-dl-exec normally returns stdout as a string
     * when stdio is piped.
     */
    let stdout = "";

    if (typeof result === "string") {
      stdout = result;
    } else if (
      result &&
      typeof result.stdout === "string"
    ) {
      stdout = result.stdout;
    }

    console.log(
      "[YouTube] yt-dlp stdout:",
      stdout
    );

    /*
     * Extract possible filepath printed by yt-dlp.
     */
    const printedPaths = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        return (
          line.includes("/") ||
          line.includes("\\")
        );
      });

    /*
     * Look for the actual generated files in the
     * output directory as a second source of truth.
     */
    const directoryFiles =
      await fsp.readdir(outputDirectory);

    const temporaryPrefix =
      `yt-audio-${id}.`;

    temporaryFiles =
      directoryFiles
        .filter((file) =>
          file.startsWith(temporaryPrefix)
        )
        .map((file) =>
          path.join(
            outputDirectory,
            file
          )
        );

    console.log(
      "[YouTube] Temporary files found:",
      temporaryFiles
    );

    /*
     * First preference:
     * the exact filepath reported by yt-dlp.
     */
    let sourceFile = null;

    for (const printedPath of printedPaths) {
      let candidate = printedPath;

      /*
       * yt-dlp may return a relative path.
       */
      if (!path.isAbsolute(candidate)) {
        candidate = path.resolve(
          outputDirectory,
          candidate
        );
      }

      if (await exists(candidate)) {
        sourceFile = candidate;
        break;
      }
    }

    /*
     * Second preference:
     * actual MP3 generated in the directory.
     */
    if (!sourceFile) {
      const mp3File =
        temporaryFiles.find((file) =>
          file.toLowerCase().endsWith(".mp3")
        );

      if (mp3File) {
        sourceFile = mp3File;
      }
    }

    /*
     * Third preference:
     * any audio file generated.
     */
    if (!sourceFile) {
      const audioExtensions = [
        ".m4a",
        ".webm",
        ".opus",
        ".aac",
        ".wav",
        ".flac",
        ".mp3",
      ];

      const audioFile =
        temporaryFiles.find((file) =>
          audioExtensions.some((extension) =>
            file.toLowerCase().endsWith(extension)
          )
        );

      if (audioFile) {
        sourceFile = audioFile;
      }
    }

    /*
     * Nothing was created.
     */
    if (!sourceFile) {
      throw new Error(
        "yt-dlp finished but no audio file was produced."
      );
    }

    console.log(
      `[YouTube] Source audio: ${sourceFile}`
    );

    /*
     * Verify source.
     */
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

    console.log(
      `[YouTube] Source size: ${sourceStats.size} bytes`
    );

    /*
     * Remove an old destination if it exists.
     */
    await removeFile(finalPath);

    /*
     * Move the finished audio into the exact path
     * expected by index.js.
     */
    await fsp.rename(
      sourceFile,
      finalPath
    );

    /*
     * Verify final output.
     */
    if (!(await exists(finalPath))) {
      throw new Error(
        "The final audio file could not be created."
      );
    }

    const finalStats =
      await fsp.stat(finalPath);

    if (!finalStats.isFile()) {
      throw new Error(
        "The final audio path is not a file."
      );
    }

    if (finalStats.size <= 0) {
      throw new Error(
        "The final audio file is empty."
      );
    }

    console.log(
      `[YouTube] Audio ready: ${finalPath}`
    );

    console.log(
      `[YouTube] Final size: ${finalStats.size} bytes`
    );

    return finalPath;
  } catch (error) {
    console.error(
      "[YouTube] Download failed:",
      error
    );

    /*
     * Cleanup temporary files.
     */
    try {
      const files =
        await fsp.readdir(
          outputDirectory
        );

      const prefix =
        `yt-audio-${id}.`;

      for (const file of files) {
        if (file.startsWith(prefix)) {
          await removeFile(
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
     * Keep the Messenger error reasonable.
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
