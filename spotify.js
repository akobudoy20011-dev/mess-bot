// spotify.js
//
// Uses Spotify's Client Credentials flow (no user login needed) to search
// for a track and return its officially-provided 30-second preview clip.
// This only uses data/audio Spotify explicitly serves for this purpose —
// no scraping, no downloading full songs, no YouTube cookies.
//
// Setup:
//   1. Go to https://developer.spotify.com/dashboard
//   2. Log in with any Spotify account (free account is fine)
//   3. Create an app (any name/description, redirect URI can be
//      http://localhost:3000 — not actually used by this flow)
//   4. Copy the Client ID and Client Secret
//   5. On Render, add two env vars:
//        SPOTIFY_CLIENT_ID=xxxxx
//        SPOTIFY_CLIENT_SECRET=xxxxx
//
// Note: not every track has a preview_url — Spotify has been reducing
// preview availability over time. getSpotifyPreview() checks the top
// few search results and returns the first one that actually has a
// preview clip, or null if none do.

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set in environment variables."
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Refresh a little early (subtract 60s) to avoid edge-of-expiry failures
  cachedTokenExpiresAt = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Searches Spotify for a track and returns the first result that has a
 * playable preview clip.
 * @param {string} query - e.g. "magnolia playboi carti"
 * @returns {Promise<{ url: string, name: string, artists: string, spotifyUrl: string } | null>}
 */
async function getSpotifyPreview(query) {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: "5",
  });

  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify search failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const tracks = data?.tracks?.items || [];

  const withPreview = tracks.find((t) => t.preview_url);
  if (!withPreview) return null;

  return {
    url: withPreview.preview_url,
    name: withPreview.name,
    artists: withPreview.artists.map((a) => a.name).join(", "),
    spotifyUrl: withPreview.external_urls?.spotify || null,
  };
}

/**
 * Downloads a preview clip to a temp file and returns the local path.
 * Caller is responsible for deleting the file after use.
 * @param {string} previewUrl
 * @param {string} destPath - e.g. "/tmp/preview_12345.mp3"
 */
async function downloadPreviewToFile(previewUrl, destPath) {
  const fs = require("fs");
  const res = await fetch(previewUrl);
  if (!res.ok) {
    throw new Error(`Failed to download preview clip (${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  return destPath;
}

module.exports = { getSpotifyPreview, downloadPreviewToFile };
