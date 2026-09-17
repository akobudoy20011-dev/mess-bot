const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const youtubedl = require("youtube-dl-exec");
const ytSearch = require("yt-search");
const ffmpegPath = require("ffmpeg-static");

const SEARCH_TIMEOUT = 30_000;
const DOWNLOAD_TIMEOUT = 180_000;

/*
 * Resource protection.
 *
 * Only allow a small number of YouTube downloads
 * to run at the same time.
 */
const MAX_CONCURRENT_DOWNLOADS = 2;

let activeDownloads = 0;

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
    await fsp.access(
      filePath,
      fs.constants.F_OK
    );

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
   PROCESS CLEANUP
========================================================= */

async function killDownloadProcess(child) {
  if (!child) {
    return;
  }

  try {
    if (
      typeof child.kill === "function" &&
      !child.killed
    ) {
      console.error(
        "[YouTube] Terminating yt-dlp process..."
      );

      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore termination errors.
      }

      /*
       * Give yt-dlp a short amount of time to exit.
       */
      await new Promise((resolve) =>
        setTimeout(resolve, 1500)
      );

      /*
       * Force kill if it is still alive.
       */
      if (!child.killed) {
        console.error(
          "[YouTube] yt-dlp still running. Force killing..."
        );

        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore force-kill errors.
        }
      }
    }
  } catch (error) {
    console.error(
      "[YouTube] Process cleanup failed:",
      error.message
    );
  }
}

/* =========================================================
   YOUTUBE SEARCH
========================================================= */

async function searchYouTube(query) {
  const cleanQuery =
    String(query || "").trim();

  if (!cleanQuery) {
    throw new Error(
      "Please provide a song name."
    );
  }

  console.log(
    `[YouTube] Searching for: ${cleanQuery}`
  );

  const result =
    await withTimeout(
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

  const video =
    result.videos[0];

  if (
    !video ||
    !video.url
  ) {
    throw new Error(
      "YouTube returned an invalid video result."
    );
  }

  console.log(
    `[YouTube] Found: ${video.title || cleanQuery}`
  );

  return {
    title:
      video.title ||
      cleanQuery,

    url:
      video.url,

    duration:
      video.duration ||
      null,

    thumbnail:
      video.thumbnail ||
      null,

    author:
      video.author?.name ||
      "",
  };
}

/* =========================================================
   COOKIE CONFIGURATION
========================================================= */

/*
 * Render environment variable:
 *
 * YOUTUBE_COOKIES=/opt/render/project/src/cookies.txt
 *
 * The file MUST be a valid Netscape-format cookies.txt file.
 *
 * Do NOT put cookie contents directly into an
 * environment variable.
 */

async function getCookiePath() {
  const configuredPath =
    String(
      process.env.YOUTUBE_COOKIES ||
      ""
    ).trim();

  if (!configuredPath) {
    console.log(
      "[YouTube] No YOUTUBE_COOKIES configured."
    );

    return null;
  }

  const cookiePath =
    path.resolve(
      configuredPath
    );

  if (
    !(await exists(cookiePath))
  ) {
    throw new Error(
      `YOUTUBE_COOKIES is configured, but the cookie file was not found at: ${cookiePath}`
    );
  }

  const stats =
    await fsp.stat(
      cookiePath
    );

  if (!stats.isFile()) {
    throw new Error(
      `YOUTUBE_COOKIES does not point to a file: ${cookiePath}`
    );
  }

  if (stats.size <= 0) {
    throw new Error(
      "The YouTube cookies file is empty."
    );
  }

  console.log(
    `[YouTube] Using cookies file: ${cookiePath}`
  );

  return cookiePath;
}

/* =========================================================
   DOWNLOAD YOUTUBE AUDIO
========================================================= */

/*
 * downloadYouTubeAudio(
 *   videoUrl,
 *   destinationPath,
 *   options
 * )
 *
 * options.signal:
 *   Optional AbortSignal.
 *
 * The queue system uses this so !skip and !stop
 * can immediately cancel an active yt-dlp download.
 */

async function downloadYouTubeAudio(
  videoUrl,
  destinationPath,
  options = {}
) {
  if (!videoUrl) {
    throw new Error(
      "Missing YouTube URL."
    );
  }

  if (!destinationPath) {
    throw new Error(
      "Missing destination path."
    );
  }

  const signal =
    options?.signal || null;

  /*
   * If the caller already cancelled the job,
   * don't start yt-dlp at all.
   */
  if (signal?.aborted) {
    throw new Error(
      "YouTube download cancelled."
    );
  }

  /*
   * Protect Render from too many simultaneous
   * yt-dlp / FFmpeg processes.
   */
  if (
    activeDownloads >=
    MAX_CONCURRENT_DOWNLOADS
  ) {
    throw new Error(
      "Too many music downloads are currently processing. Please wait a moment and try again."
    );
  }

  activeDownloads++;

  console.log(
    `[YouTube] Active downloads: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}`
  );

  const finalPath =
    path.resolve(
      destinationPath
    );

  const outputDirectory =
    path.dirname(
      finalPath
    );

  await fsp.mkdir(
    outputDirectory,
    {
      recursive: true,
    }
  );

  const id =
    crypto.randomUUID();

  /*
   * Unique temporary output.
   */
  const temporaryTemplate =
    path.join(
      outputDirectory,
      `yt-audio-${id}.%(ext)s`
    );

  let child = null;
  let timeoutTimer = null;
  let abortHandler = null;
  let cancelled = false;

  try {
    console.log(
      `[YouTube] Downloading: ${videoUrl}`
    );

    console.log(
      `[YouTube] Temporary output: ${temporaryTemplate}`
    );

    /*
     * Load cookies if configured.
     */
    const cookiesPath =
      await getCookiePath();

    /*
     * yt-dlp options.
     */
    const ytOptions = {
      output:
        temporaryTemplate,

      format:
        "bestaudio/best",

      extractAudio:
        true,

      audioFormat:
        "mp3",

      audioQuality:
        "0",

      /*
       * YouTube JavaScript challenge support.
       */
      jsRuntimes:
        `node:${process.execPath}`,

      remoteComponents:
        "ejs:github",

      /*
       * FFmpeg.
       */
      ffmpegLocation:
        ffmpegPath,

      /*
       * Download reliability.
       */
      retries:
        3,

      fragmentRetries:
        3,

      socketTimeout:
        30,

      /*
       * Prefer IPv4.
       */
      forceIpv4:
        true,

      /*
       * Don't process playlists.
       */
      noPlaylist:
        true,

      /*
       * Ask yt-dlp to print the final filename.
       */
      print:
        "after_move:filepath",

      /*
       * Add cookies only when configured.
       */
      ...(cookiesPath
        ? {
            cookies:
              cookiesPath,
          }
        : {}),
    };

    console.log(
      "[YouTube] Starting yt-dlp..."
    );

    /*
     * Spawn yt-dlp.
     */
    child =
      youtubedl(
        videoUrl,
        ytOptions,
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      );

    /*
     * Capture only a limited amount of output.
     */
    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on(
        "data",
        (chunk) => {
          stdout +=
            chunk.toString();

          if (
            stdout.length >
            10_000
          ) {
            stdout =
              stdout.slice(
                -10_000
              );
          }
        }
      );
    }

    if (child.stderr) {
      child.stderr.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();

          if (
            stderr.length >
            10_000
          ) {
            stderr =
              stderr.slice(
                -10_000
              );
          }
        }
      );
    }

    /* =====================================================
       ABORT / SKIP / STOP SUPPORT
    ===================================================== */

    let abortPromise = null;

    if (signal) {
      abortPromise =
        new Promise(
          (_, reject) => {
            abortHandler =
              async () => {
                if (cancelled) {
                  return;
                }

                cancelled = true;

                console.log(
                  "[YouTube] Download cancellation requested."
                );

                await killDownloadProcess(
                  child
                );

                reject(
                  new Error(
                    "YouTube download cancelled."
                  )
                );
              };

            signal.addEventListener(
              "abort",
              abortHandler,
              {
                once: true,
              }
            );

            /*
             * Handle a signal that became aborted
             * between the initial check and listener setup.
             */
            if (signal.aborted) {
              void abortHandler();
            }
          }
        );
    }

    /* =====================================================
       TIMEOUT
    ===================================================== */

    const timeoutPromise =
      new Promise(
        (_, reject) => {
          timeoutTimer =
            setTimeout(
              async () => {
                if (cancelled) {
                  return;
                }

                console.error(
                  "[YouTube] Download timeout reached."
                );

                await killDownloadProcess(
                  child
                );

                reject(
                  new Error(
                    "YouTube download timed out after 3 minutes. Please try again."
                  )
                );
              },
              DOWNLOAD_TIMEOUT
            );
        }
      );

    /* =====================================================
       DOWNLOAD PROMISE
    ===================================================== */

    const downloadPromise =
      Promise.resolve(child)
        .then(() => ({
          stdout,
          stderr,
        }));

    const racePromises = [
      downloadPromise,
      timeoutPromise,
    ];

    if (abortPromise) {
      racePromises.push(
        abortPromise
      );
    }

    const result =
      await Promise.race(
        racePromises
      );

    if (timeoutTimer) {
      clearTimeout(
        timeoutTimer
      );

      timeoutTimer = null;
    }

    if (
      signal &&
      abortHandler
    ) {
      try {
        signal.removeEventListener(
          "abort",
          abortHandler
        );
      } catch {
        // Ignore listener cleanup errors.
      }
    }

    abortHandler = null;

    console.log(
      "[YouTube] yt-dlp finished."
    );

    if (result?.stderr) {
      console.log(
        "[YouTube] yt-dlp completed with diagnostic output."
      );
    }

    /* =====================================================
       FIND TEMPORARY FILES
    ===================================================== */

    const directoryFiles =
      await fsp.readdir(
        outputDirectory
      );

    const temporaryPrefix =
      `yt-audio-${id}.`;

    const temporaryFiles =
      directoryFiles
        .filter(
          (file) =>
            file.startsWith(
              temporaryPrefix
            )
        )
        .map(
          (file) =>
            path.join(
              outputDirectory,
              file
            )
        );

    console.log(
      "[YouTube] Temporary files found:",
      temporaryFiles
    );

    let sourceFile = null;

    /* =====================================================
       METHOD 1 — FIND MP3
    ===================================================== */

    const mp3File =
      temporaryFiles.find(
        (file) =>
          file
            .toLowerCase()
            .endsWith(".mp3")
      );

    if (mp3File) {
      sourceFile =
        mp3File;
    }

    /* =====================================================
       METHOD 2 — FIND OTHER AUDIO
    ===================================================== */

    if (!sourceFile) {
      const audioExtensions = [
        ".m4a",
        ".webm",
        ".opus",
        ".aac",
        ".wav",
        ".flac",
      ];

      const audioFile =
        temporaryFiles.find(
          (file) =>
            audioExtensions.some(
              (extension) =>
                file
                  .toLowerCase()
                  .endsWith(
                    extension
                  )
            )
        );

      if (audioFile) {
        sourceFile =
          audioFile;
      }
    }

    /* =====================================================
       METHOD 3 — READ PATH PRINTED BY YT-DLP
    ===================================================== */

    if (
      !sourceFile &&
      stdout
    ) {
      const lines =
        stdout
          .split(/\r?\n/)
          .map(
            (line) =>
              line.trim()
          )
          .filter(Boolean);

      for (
        const line of lines
      ) {
        let candidate =
          line;

        candidate =
          candidate.replace(
            /^["']|["']$/g,
            ""
          );

        if (
          !candidate.includes("/") &&
          !candidate.includes("\\")
        ) {
          continue;
        }

        if (
          await exists(candidate)
        ) {
          sourceFile =
            candidate;

          break;
        }

        const relativeCandidate =
          path.resolve(
            outputDirectory,
            candidate
          );

        if (
          await exists(
            relativeCandidate
          )
        ) {
          sourceFile =
            relativeCandidate;

          break;
        }
      }
    }

    /* =====================================================
       NO FILE
    ===================================================== */

    if (!sourceFile) {
      throw new Error(
        "yt-dlp finished but no audio file was produced."
      );
    }

    console.log(
      `[YouTube] Source audio: ${sourceFile}`
    );

    /* =====================================================
       VERIFY SOURCE
    ===================================================== */

    if (
      !(await exists(sourceFile))
    ) {
      throw new Error(
        "The downloaded audio file could not be found."
      );
    }

    const sourceStats =
      await fsp.stat(
        sourceFile
      );

    if (
      !sourceStats.isFile()
    ) {
      throw new Error(
        "The downloaded audio path is not a file."
      );
    }

    if (
      sourceStats.size <= 0
    ) {
      throw new Error(
        "The downloaded audio file is empty."
      );
    }

    console.log(
      `[YouTube] Source size: ${sourceStats.size} bytes`
    );

    /* =====================================================
       MOVE TO FINAL DESTINATION
    ===================================================== */

    await safeUnlink(
      finalPath
    );

    await fsp.rename(
      sourceFile,
      finalPath
    );

    /* =====================================================
       VERIFY FINAL FILE
    ===================================================== */

    if (
      !(await exists(finalPath))
    ) {
      throw new Error(
        "The final audio file could not be created."
      );
    }

    const finalStats =
      await fsp.stat(
        finalPath
      );

    if (
      !finalStats.isFile()
    ) {
      throw new Error(
        "The final audio path is not a file."
      );
    }

    if (
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
      `[YouTube] Final size: ${finalStats.size} bytes`
    );

    return finalPath;
  } catch (error) {
    /*
     * Don't turn an intentional queue cancellation
     * into a scary download failure in the logs.
     */
    if (
      error?.message ===
      "YouTube download cancelled."
    ) {
      console.log(
        "[YouTube] Download cancelled by music queue."
      );
    } else {
      console.error(
        "[YouTube] Download failed:",
        error
      );
    }

    /* =====================================================
       TIMER CLEANUP
    ===================================================== */

    if (timeoutTimer) {
      clearTimeout(
        timeoutTimer
      );

      timeoutTimer = null;
    }

    /* =====================================================
       ABORT LISTENER CLEANUP
    ===================================================== */

    if (
      signal &&
      abortHandler
    ) {
      try {
        signal.removeEventListener(
          "abort",
          abortHandler
        );
      } catch {
        // Ignore listener cleanup errors.
      }

      abortHandler = null;
    }

    /* =====================================================
       PROCESS CLEANUP
    ===================================================== */

    await killDownloadProcess(
      child
    );

    /* =====================================================
       TEMPORARY FILE CLEANUP
    ===================================================== */

    try {
      const files =
        await fsp.readdir(
          outputDirectory
        );

      const prefix =
        `yt-audio-${id}.`;

      for (
        const file of files
      ) {
        if (
          file.startsWith(
            prefix
          )
        ) {
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

    /*
     * Preserve the cancellation error exactly.
     */
    if (
      error?.message ===
      "YouTube download cancelled."
    ) {
      throw error;
    }

    let message =
      error?.stderr ||
      error?.message ||
      String(error);

    if (
      typeof message !==
      "string"
    ) {
      message =
        String(message);
    }

    message =
      message.trim();

    /*
     * Make the error Messenger-friendly.
     */
    if (
      message.length > 3000
    ) {
      message =
        message.slice(-3000);
    }

    throw new Error(
      `YouTube download failed: ${message}`
    );
  } finally {
    /*
     * Release the download slot.
     */
    activeDownloads =
      Math.max(
        0,
        activeDownloads - 1
      );

    console.log(
      `[YouTube] Active downloads: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}`
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
