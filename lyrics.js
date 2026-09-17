"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const LYRICS_DIRECTORY = path.join(__dirname, "data", "lyrics");

/*
  ---------------------------------------------------------------------------
  lyrics.js

  Loads timestamped lyrics from:

    data/lyrics/

  Supported file names:

    <videoId>.lrc
    <normalized-title>.lrc

  Example:

    data/lyrics/4uLU6hMCjMI.lrc

  LRC format:

    [00:00.00]First line
    [00:04.20]Second line
    [00:08.75]Third line

  Multiple timestamps on one line are supported:

    [00:10.00][00:20.00]Same lyric

  Returned format:

    [
      { time: 0, text: "First line" },
      { time: 4.2, text: "Second line" },
      { time: 8.75, text: "Third line" }
    ]

  IMPORTANT:
  Put only lyrics you are authorized to use in these files.
  ---------------------------------------------------------------------------
*/


// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

async function ensureLyricsDirectory() {
  await fsp.mkdir(LYRICS_DIRECTORY, {
    recursive: true,
  });
}


// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}


function normalizeFileKey(value) {
  return normalizeText(value)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 180);
}


// ---------------------------------------------------------------------------
// LRC timestamp parser
// ---------------------------------------------------------------------------

function parseLrcTimestamp(timestamp) {
  if (typeof timestamp !== "string") {
    return null;
  }

  const match = timestamp.match(
    /^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/
  );

  if (!match) {
    return null;
  }

  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);

  if (
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    seconds >= 60
  ) {
    return null;
  }

  let fraction = 0;

  if (match[3]) {
    const rawFraction = match[3];

    if (rawFraction.length === 1) {
      fraction = Number(rawFraction) / 10;
    } else if (rawFraction.length === 2) {
      fraction = Number(rawFraction) / 100;
    } else {
      fraction = Number(rawFraction) / 1000;
    }
  }

  return minutes * 60 + seconds + fraction;
}


// ---------------------------------------------------------------------------
// LRC parser
// ---------------------------------------------------------------------------

function parseLrc(content) {
  if (typeof content !== "string") {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const result = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    /*
      Ignore metadata:

        [ar:Artist]
        [ti:Title]
        [al:Album]
        [by:Creator]
        [offset:0]

      while still accepting timestamp lines.
    */

    const timestamps = [
      ...line.matchAll(
        /\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g
      ),
    ];

    if (timestamps.length === 0) {
      continue;
    }

    const text = line
      .replace(
        /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g,
        ""
      )
      .trim();

    /*
      Ignore metadata-only entries such as:

        [ar:Artist]
        [ti:Song]

      because they don't contain a valid timestamp.
    */

    for (const match of timestamps) {
      const time = parseLrcTimestamp(match[1]);

      if (time === null) {
        continue;
      }

      /*
        Empty lines are allowed, but normally aren't useful for
        the Messenger lyric display.
      */

      if (!text) {
        continue;
      }

      result.push({
        time,
        text,
      });
    }
  }

  result.sort((a, b) => a.time - b.time);

  /*
    Remove exact duplicate timestamp/text combinations.
  */

  const deduplicated = [];
  let previous = null;

  for (const line of result) {
    if (
      previous &&
      previous.time === line.time &&
      previous.text === line.text
    ) {
      continue;
    }

    deduplicated.push(line);
    previous = line;
  }

  return deduplicated;
}


// ---------------------------------------------------------------------------
// Validate lyric array
// ---------------------------------------------------------------------------

function validateLyrics(lyrics) {
  if (!Array.isArray(lyrics)) {
    return [];
  }

  return lyrics
    .filter(
      (line) =>
        line &&
        Number.isFinite(Number(line.time)) &&
        typeof line.text === "string" &&
        line.text.trim()
    )
    .map((line) => ({
      time: Math.max(0, Number(line.time)),
      text: line.text.trim(),
    }))
    .sort((a, b) => a.time - b.time);
}


// ---------------------------------------------------------------------------
// Find matching lyric file
// ---------------------------------------------------------------------------

async function findLyricsFile({
  videoId = null,
  title = "",
} = {}) {
  await ensureLyricsDirectory();

  const candidates = [];

  if (videoId) {
    const cleanVideoId = String(videoId)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "");

    if (cleanVideoId) {
      candidates.push(
        path.join(
          LYRICS_DIRECTORY,
          `${cleanVideoId}.lrc`
        )
      );
    }
  }

  const titleKey = normalizeFileKey(title);

  if (titleKey) {
    candidates.push(
      path.join(
        LYRICS_DIRECTORY,
        `${titleKey}.lrc`
      )
    );
  }

  for (const candidate of candidates) {
    try {
      const stat = await fsp.stat(candidate);

      if (stat.isFile() && stat.size > 0) {
        return candidate;
      }
    } catch {
      // File does not exist. Continue searching.
    }
  }

  return null;
}


// ---------------------------------------------------------------------------
// Public: get synced lyrics
// ---------------------------------------------------------------------------

async function getSyncedLyrics({
  videoId = null,
  title = "",
  author = "",
} = {}) {
  try {
    const filePath = await findLyricsFile({
      videoId,
      title,
    });

    if (!filePath) {
      return null;
    }

    const content = await fsp.readFile(
      filePath,
      "utf8"
    );

    const lyrics = validateLyrics(
      parseLrc(content)
    );

    if (lyrics.length === 0) {
      return null;
    }

    return {
      title: title || "",
      author: author || "",
      source: filePath,
      lines: lyrics,
    };
  } catch (error) {
    console.error(
      "[Lyrics] Failed to load lyrics:",
      error
    );

    return null;
  }
}


// ---------------------------------------------------------------------------
// Public: parse arbitrary LRC content
// ---------------------------------------------------------------------------

function parseSyncedLyrics(content) {
  return validateLyrics(
    parseLrc(content)
  );
}


// ---------------------------------------------------------------------------
// Public: check whether lyrics exist
// ---------------------------------------------------------------------------

async function hasSyncedLyrics({
  videoId = null,
  title = "",
} = {}) {
  const filePath = await findLyricsFile({
    videoId,
    title,
  });

  return Boolean(filePath);
}


// ---------------------------------------------------------------------------
// Public: save an LRC file
//
// Useful if you later want another part of the bot to save
// authorized/user-provided timed lyrics.
// ---------------------------------------------------------------------------

async function saveLyricsFile({
  videoId = null,
  title = "",
  content,
} = {}) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Lyrics content is empty.");
  }

  await ensureLyricsDirectory();

  let fileName;

  if (videoId) {
    const cleanVideoId = String(videoId)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "");

    if (!cleanVideoId) {
      throw new Error("Invalid video ID.");
    }

    fileName = `${cleanVideoId}.lrc`;
  } else {
    const titleKey = normalizeFileKey(title);

    if (!titleKey) {
      throw new Error(
        "A video ID or title is required."
      );
    }

    fileName = `${titleKey}.lrc`;
  }

  const filePath = path.join(
    LYRICS_DIRECTORY,
    fileName
  );

  await fsp.writeFile(
    filePath,
    content,
    "utf8"
  );

  return filePath;
}


// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getSyncedLyrics,
  parseSyncedLyrics,
  hasSyncedLyrics,
  saveLyricsFile,
  parseLrcTimestamp,
};
