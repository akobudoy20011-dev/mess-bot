// jamendo.js
//
// Uses Jamendo's official API to search for and retrieve legitimate audio tracks.
// Only uses audio that Jamendo's API indicates is available for download/streaming.
//
// Setup:
//   1. Go to https://developer.jamendo.com
//   2. Sign up and create an application
//   3. Copy the Client ID
//   4. On Render, add one env var:
//        JAMENDO_CLIENT_ID=xxxxx
//
// This module searches Jamendo, checks audiodownload_allowed, and returns
// a track object with:
//   - name
//   - artist_name
//   - audio_url (streaming or download URL, only if permitted)
//   - album_name (optional)
//   - image (optional album artwork)

const JAMENDO_BASE_URL = "https://api.jamendo.com/v3.0";

/**
 * Searches Jamendo for a track and returns the first result that has
 * permitted audio available.
 * @param {string} query - e.g. "relaxing piano"
 * @returns {Promise<{ name: string, artist_name: string, audio_url: string, album_name?: string, image?: string } | null>}
 */
async function searchJamendo(query) {
  const clientId = process.env.JAMENDO_CLIENT_ID;

  if (!clientId || !clientId.trim()) {
    throw new Error(
      "JAMENDO_CLIENT_ID is not set in environment variables."
    );
  }

  if (!query || !query.trim()) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      search: query.trim(),
      limit: "20",
    });

    const url = `${JAMENDO_BASE_URL}/tracks/?${params}`;
    console.log(`[Jamendo] API Request URL: ${url}`);

    const res = await fetch(url);

    console.log(`[Jamendo] API Response Status: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[Jamendo] API Error Response Body: ${text.slice(0, 500)}`
      );
      throw new Error(
        `Jamendo API failed (${res.status}): ${text.slice(0, 100)}`
      );
    }

    const data = await res.json();
    console.log(`[Jamendo] Full API Response: ${JSON.stringify(data, null, 2)}`);

    const tracks = data?.results || [];
    console.log(
      `[Jamendo] Number of tracks returned: ${tracks.length}`
    );

    if (!Array.isArray(tracks) || tracks.length === 0) {
      console.log(
        `[Jamendo] No tracks found for query: "${query}"`
      );
      return null;
    }

    // Iterate through all tracks and log their details
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      console.log(`[Jamendo] Track ${i}:`, {
        name: track.name,
        artist_name: track.artist_name,
        audiodownload_allowed: track.audiodownload_allowed,
        audio: track.audio ? "present" : "missing",
        audiodownload: track.audiodownload ? "present" : "missing",
      });

      // Check if audio download/streaming is permitted
      // Accept tracks that have ANY playable audio (audio or audiodownload)
      if (!track.audio && !track.audiodownload) {
        console.log(
          `[Jamendo] Track ${i} skipped: no audio or audiodownload field`
        );
        continue;
      }

      // Prefer audiodownload if available and permitted, otherwise use audio
      let audioUrl = null;

      if (track.audiodownload_allowed && track.audiodownload) {
        audioUrl = track.audiodownload.trim();
        console.log(
          `[Jamendo] Track ${i} using audiodownload: ${audioUrl}`
        );
      } else if (track.audio) {
        audioUrl = track.audio.trim();
        console.log(
          `[Jamendo] Track ${i} using audio stream: ${audioUrl}`
        );
      } else {
        console.log(
          `[Jamendo] Track ${i} skipped: audiodownload_allowed=${track.audiodownload_allowed} but no suitable URL`
        );
        continue;
      }

      if (!audioUrl || typeof audioUrl !== "string") {
        console.log(`[Jamendo] Track ${i} skipped: invalid audio URL`);
        continue;
      }

      console.log(
        `[Jamendo] Track ${i} ACCEPTED: ${track.name} by ${track.artist_name}`
      );

      return {
        name: track.name || "Unknown",
        artist_name: track.artist_name || "Unknown Artist",
        audio_url: audioUrl,
        album_name: track.album_name || undefined,
        image: track.image || undefined,
      };
    }

    console.log(
      `[Jamendo] No suitable tracks found after checking all ${tracks.length} results`
    );
    return null;
  } catch (error) {
    console.error("[Jamendo] Search error:");
    console.error("  Message:", error.message);
    console.error("  Stack:", error.stack);
    throw error;
  }
}

/**
 * Downloads an audio file from a URL to a temporary file path.
 * Caller is responsible for deleting the file after use.
 * @param {string} audioUrl
 * @param {string} destPath - e.g. "/tmp/jamendo_audio_12345.mp3"
 */
async function downloadAudioToFile(audioUrl, destPath) {
  const fs = require("fs");

  try {
    console.log(`[Jamendo] Starting download from: ${audioUrl}`);
    const res = await fetch(audioUrl);

    console.log(
      `[Jamendo] Download response status: ${res.status} ${res.statusText}`
    );

    if (!res.ok) {
      throw new Error(
        `Failed to download audio (${res.status}) ${res.statusText}`
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    console.log(`[Jamendo] Downloaded ${arrayBuffer.byteLength} bytes`);

    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
    console.log(`[Jamendo] File written to: ${destPath}`);

    return destPath;
  } catch (error) {
    console.error("[Jamendo] Audio download error:");
    console.error("  Message:", error.message);
    console.error("  Stack:", error.stack);
    throw error;
  }
}

module.exports = { searchJamendo, downloadAudioToFile };
