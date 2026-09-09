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
      limit: "10",
    });

    const url = `${JAMENDO_BASE_URL}/tracks/?${params}`;
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Jamendo API failed (${res.status}): ${text.slice(0, 100)}`
      );
    }

    const data = await res.json();
    const tracks = data?.results || [];

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return null;
    }

    // Find the first track with permitted audio
    for (const track of tracks) {
      // Check if audio download/streaming is permitted
      if (!track.audiodownload_allowed) {
        continue;
      }

      // Prefer audiodownload URL if available, fall back to audio (streaming)
      const audioUrl = track.audiodownload || track.audio;

      if (!audioUrl || typeof audioUrl !== "string" || !audioUrl.trim()) {
        continue;
      }

      return {
        name: track.name || "Unknown",
        artist_name: track.artist_name || "Unknown Artist",
        audio_url: audioUrl.trim(),
        album_name: track.album_name || undefined,
        image: track.image || undefined,
      };
    }

    // No permitted audio found
    return null;
  } catch (error) {
    console.error("Jamendo search error:", error.message);
    throw error;
  }
}

module.exports = { searchJamendo };
