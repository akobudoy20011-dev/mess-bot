"use strict";

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
 * Keep this deliberately small on Render.
 */
const MAX_CONCURRENT_DOWNLOADS = 2;

let activeDownloads = 0;

/*
 * Small retry delay.
 *
 * IMPORTANT:
 * We do NOT aggressively hammer YouTube after a 429.
 */
const DOWNLOAD_RETRY_DELAYS = [
  0,
  3_000,
  8_000,
];

/*
 * Prevent multiple simultaneous downloads of
 * the exact same YouTube URL.
 */
const activeVideoDownloads = new Map();

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
   SLEEP
========================================================= */

function sleep(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
  if (!filePath) {
    return;
  }

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
      console.warn(
        "[YouTube] Terminating yt-dlp process..."
      );

      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore termination errors.
      }

      await sleep(1_500);

      if (!child.killed) {
        console.warn(
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
      error?.message || error
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

  /*
   * Prefer an actual video result.
   */
  const video =
    result.videos.find(
      (item) =>
        item &&
        item.url
    ) ||
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

async function getCookiePath() {
  const configuredPath =
    String(
      process.env.YOUTUBE_COOKIES ||
      ""
    ).trim();

  if (!configuredPath) {
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
    "[YouTube] Using configured cookies file."
  );

  return cookiePath;
}

/* =========================================================
   NODE / EJS CONFIGURATION
========================================================= */

function getJsRuntimeOptions() {
  const major =
    Number(
      process.versions.node
        .split(".")[0]
    );

  if (
    Number.isFinite(major) &&
    major >= 22
  ) {
    return {
      jsRuntimes:
        `node:${process.execPath}`,

      remoteComponents:
        "ejs:github",
    };
  }

  console.warn(
    `[YouTube] Node ${process.versions.node} detected. Node 22+ is required for current yt-dlp EJS support.`
  );

  return {};
}

/* =========================================================
   USER AGENT
========================================================= */

function getUserAgent() {
  const value =
    String(
      process.env.YOUTUBE_USER_AGENT ||
      ""
    ).trim();

  return value || null;
}

/* =========================================================
   ERROR CLASSIFICATION
========================================================= */

function getErrorText(error) {
  const pieces = [];

  if (error?.message) {
    pieces.push(
      String(error.message)
    );
  }

  if (error?.stderr) {
    pieces.push(
      String(error.stderr)
    );
  }

  if (error?.stdout) {
    pieces.push(
      String(error.stdout)
    );
  }

  return pieces
    .join("\n")
    .trim();
}

function isRateLimited(error) {
  const text =
    getErrorText(error)
      .toLowerCase();

  return (
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit")
  );
}

function isForbidden(error) {
  const text =
    getErrorText(error)
      .toLowerCase();

  return (
    text.includes("403") ||
    text.includes("forbidden") ||
    text.includes("http error 403")
  );
}

/* =========================================================
   FRIENDLY ERROR
========================================================= */

function createFriendlyDownloadError(error) {
  const raw =
    getErrorText(error);

  const lower =
    raw.toLowerCase();

  if (
    lower.includes("429") ||
    lower.includes("too many requests")
  ) {
    return new Error(
      "YouTube temporarily rate-limited the music server. Please try again in a little while."
    );
  }

  if (
    lower.includes("403") ||
    lower.includes("forbidden")
  ) {
    return new Error(
      "YouTube refused this download request. The video may require a fresh browser session/cookies, or YouTube may be temporarily blocking the server."
    );
  }

  if (
    lower.includes("sign in to confirm") ||
    lower.includes("confirm you're not a bot")
  ) {
    return new Error(
      "YouTube requires verification for this video. Please try another song or refresh the configured YouTube session."
    );
  }

  if (
    lower.includes("private video")
  ) {
    return new Error(
      "That YouTube video is private and cannot be played."
    );
  }

  if (
    lower.includes("age-restricted") ||
    lower.includes("sign in to confirm your age")
  ) {
    return new Error(
      "That YouTube video is age-restricted and could not be played."
    );
  }

  if (
    lower.includes("video unavailable")
  ) {
    return new Error(
      "That YouTube video is unavailable."
    );
  }

  if (
    lower.includes("timed out")
  ) {
    return new Error(
      "YouTube took too long to provide the audio. Please try again."
    );
  }

  return new Error(
    `YouTube download failed: ${
      raw
        .replace(/\s+/g, " ")
        .trim()
        .slice(-1_500) ||
      "Unknown download error."
    }`
  );
}

/* =========================================================
   DOWNLOAD ONCE
========================================================= */

async function downloadYouTubeAudioOnce(
  videoUrl,
  destinationPath,
  options = {}
) {
  const signal =
    options?.signal || null;

  if (
    signal?.aborted
  ) {
    throw new Error(
      "YouTube download cancelled."
    );
  }

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

  const temporaryTemplate =
    path.join(
      outputDirectory,
      `yt-audio-${id}.%(ext)s`
    );

  let child = null;
  let timeoutTimer = null;
  let abortHandler = null;
  let cancelled = false;

  let stdout = "";
  let stderr = "";

  try {
    console.log(
      `[YouTube] Downloading: ${videoUrl}`
    );

    const cookiesPath =
      await getCookiePath();

    const userAgent =
      getUserAgent();

    const runtimeOptions =
      getJsRuntimeOptions();

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

      ffmpegLocation:
        ffmpegPath,

      retries:
        2,

      fragmentRetries:
        2,

      socketTimeout:
        30,

      forceIpv4:
        true,

      noPlaylist:
        true,

      concurrentFragments:
        1,

      print:
        "after_move:filepath",

      ...(cookiesPath
        ? {
            cookies:
              cookiesPath,
          }
        : {}),

      ...(userAgent
        ? {
            userAgent,
          }
        : {}),

      ...runtimeOptions,
    };

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

    if (child?.stdout) {
      child.stdout.on(
        "data",
        (chunk) => {
          stdout +=
            chunk.toString();

          if (
            stdout.length >
            15_000
          ) {
            stdout =
              stdout.slice(
                -15_000
              );
          }
        }
      );
    }

    if (child?.stderr) {
      child.stderr.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();

          if (
            stderr.length >
            15_000
          ) {
            stderr =
              stderr.slice(
                -15_000
              );
          }
        }
      );
    }

    /* =====================================================
       ABORT SUPPORT
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

            if (
              signal.aborted
            ) {
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

                cancelled = true;

                console.error(
                  "[YouTube] Download timeout reached."
                );

                await killDownloadProcess(
                  child
                );

                reject(
                  new Error(
                    "YouTube download timed out after 3 minutes."
                  )
                );
              },
              DOWNLOAD_TIMEOUT
            );
        }
      );

    /* =====================================================
       ACTUALLY WAIT FOR YT-DLP
    ===================================================== */

    const downloadPromise =
      Promise.resolve()
        .then(
          () => child
        );

    const processPromise =
      typeof child?.then === "function"
        ? child.then(
            () => ({
              stdout,
              stderr,
            })
          )
        : new Promise(
            (resolve, reject) => {
              if (
                !child ||
                typeof child.on !== "function"
              ) {
                reject(
                  new Error(
                    "yt-dlp process could not be started."
                  )
                );

                return;
              }

              child.once(
                "error",
                reject
              );

              child.once(
                "close",
                (code) => {
                  if (
                    code !== 0
                  ) {
                    const error =
                      new Error(
                        `yt-dlp exited with code ${code}.`
                      );

                    error.stdout =
                      stdout;

                    error.stderr =
                      stderr;

                    reject(
                      error
                    );

                    return;
                  }

                  resolve({
                    stdout,
                    stderr,
                  });
                }
              );
            }
          );

    void downloadPromise;

    const racePromises = [
      processPromise,
      timeoutPromise,
    ];

    if (
      abortPromise
    ) {
      racePromises.push(
        abortPromise
      );
    }

    let result;

    try {
      result =
        await Promise.race(
          racePromises
        );
    } catch (error) {
      if (
        error &&
        typeof error === "object"
      ) {
        error.stdout =
          error.stdout ||
          stdout;

        error.stderr =
          error.stderr ||
          stderr;
      }

      throw error;
    }

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

      abortHandler = null;
    }

    console.log(
      "[YouTube] yt-dlp finished successfully."
    );

    if (
      result?.stderr
    ) {
      console.log(
        "[YouTube] yt-dlp diagnostic output captured."
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
       FIND MP3
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
       FIND OTHER AUDIO
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
       READ PATH PRINTED BY YT-DLP
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
       VERIFY SOURCE
    ===================================================== */

    if (!sourceFile) {
      const error =
        new Error(
          "yt-dlp finished but no audio file was produced."
        );

      error.stdout =
        stdout;

      error.stderr =
        stderr;

      throw error;
    }

    if (
      !(await exists(
        sourceFile
      ))
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
      !(await exists(
        finalPath
      ))
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
        getErrorText(error)
      );
    }

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

      abortHandler = null;
    }

    await killDownloadProcess(
      child
    );

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

    throw error;
  }
}

/* =========================================================
   DOWNLOAD YOUTUBE AUDIO
========================================================= */

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

  if (
    signal?.aborted
  ) {
    throw new Error(
      "YouTube download cancelled."
    );
  }

  const videoKey =
    String(videoUrl)
      .trim();

  if (
    activeVideoDownloads.has(
      videoKey
    )
  ) {
    console.log(
      "[YouTube] Reusing existing download for the same video."
    );

    return activeVideoDownloads.get(
      videoKey
    );
  }

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

  const downloadPromise =
    (async () => {
      try {
        let lastError = null;

        for (
          let attempt = 0;
          attempt <
          DOWNLOAD_RETRY_DELAYS.length;
          attempt++
        ) {
          const delay =
            DOWNLOAD_RETRY_DELAYS[
              attempt
            ];

          if (
            delay > 0
          ) {
            console.log(
              `[YouTube] Waiting ${delay}ms before retry ${attempt + 1}/${DOWNLOAD_RETRY_DELAYS.length - 1}...`
            );

            await sleep(
              delay
            );
          }

          if (
            signal?.aborted
          ) {
            throw new Error(
              "YouTube download cancelled."
            );
          }

          try {
            console.log(
              `[YouTube] Download attempt ${attempt + 1}/${DOWNLOAD_RETRY_DELAYS.length}`
            );

            return await downloadYouTubeAudioOnce(
              videoUrl,
              destinationPath,
              {
                signal,
              }
            );
          } catch (error) {
            lastError =
              error;

            if (
              error?.message ===
              "YouTube download cancelled."
            ) {
              throw error;
            }

            const rateLimited =
              isRateLimited(
                error
              );

            const forbidden =
              isForbidden(
                error
              );

            if (
              !rateLimited &&
              !forbidden
            ) {
              throw error;
            }

            console.warn(
              `[YouTube] Temporary access failure on attempt ${attempt + 1}: ${
                getErrorText(error)
              }`
            );

            if (
              attempt ===
              DOWNLOAD_RETRY_DELAYS.length - 1
            ) {
              break;
            }
          }
        }

        throw lastError ||
          new Error(
            "YouTube download failed."
          );
      } finally {
        activeDownloads =
          Math.max(
            0,
            activeDownloads - 1
          );

        console.log(
          `[YouTube] Active downloads: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}`
        );
      }
    })();

  activeVideoDownloads.set(
    videoKey,
    downloadPromise
  );

  try {
    return await downloadPromise;
  } catch (error) {
    throw createFriendlyDownloadError(
      error
    );
  } finally {
    activeVideoDownloads.delete(
      videoKey
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
