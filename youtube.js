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

/*
 * Attempt to terminate yt-dlp when a download fails
 * or reaches the timeout.
 *
 * youtube-dl-exec returns a child-process-like promise
 * that exposes kill() on the spawned process.
 */
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
       * Give yt-dlp a few seconds to exit normally.
       */
      await new Promise((resolve) =>
        setTimeout(resolve, 3000)
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
 * Do NOT put the cookie contents directly into an
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

async function downloadYouTubeAudio(
  videoUrl,
  destinationPath
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
   *
   * yt-dlp will eventually create something like:
   *
   * yt-audio-UUID.mp3
   */
  const temporaryTemplate =
    path.join(
      outputDirectory,
      `yt-audio-${id}.%(ext)s`
    );

  let child = null;
  let timeoutTimer = null;

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
     * Keep yt-dlp options intentionally small.
     */
    const options = {
      /*
       * Output.
       */
      output:
        temporaryTemplate,

      /*
       * Best available audio.
       */
      format:
        "bestaudio/best",

      /*
       * Convert to MP3 using FFmpeg.
       */
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
     * IMPORTANT:
     *
     * Keep the actual child process so that
     * we can kill it if the timeout is reached.
     */
    child =
      youtubedl(
        videoUrl,
        options,
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
     *
     * This prevents a noisy yt-dlp process from
     * creating a huge in-memory stdout/stderr buffer.
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

    /*
     * Kill yt-dlp if it exceeds the
     * three-minute download limit.
     */
    const timeoutPromise =
      new Promise(
        (_, reject) => {
          timeoutTimer =
            setTimeout(
              async () => {
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

    /*
     * Convert the child-process promise into
     * a normal promise that also exposes stdout.
     */
    const downloadPromise =
      Promise.resolve(child)
        .then(() => ({
          stdout,
          stderr,
        }));

    const result =
      await Promise.race([
        downloadPromise,
        timeoutPromise,
      ]);

    if (timeoutTimer) {
      clearTimeout(
        timeoutTimer
      );

      timeoutTimer = null;
    }

    console.log(
      "[YouTube] yt-dlp finished."
    );

    if (result?.stderr) {
      console.log(
        "[YouTube] yt-dlp completed with diagnostic output."
      );
    }

    /*
     * Find all temporary files produced by yt-dlp.
     */
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

        /*
         * Strip surrounding quotes.
         */
        candidate =
          candidate.replace(
            /^["']|["']$/g,
            ""
          );

        /*
         * Ignore ordinary informational lines.
         */
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
    console.error(
      "[YouTube] Download failed:",
      error
    );

    /*
     * Always attempt to terminate yt-dlp
     * if something went wrong.
     */
    if (timeoutTimer) {
      clearTimeout(
        timeoutTimer
      );

      timeoutTimer = null;
    }

    await killDownloadProcess(
      child
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
