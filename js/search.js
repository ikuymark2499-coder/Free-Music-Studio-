/* ==========================================================================
   search.js — Local instant search + Online (YouTube) search
   ========================================================================== */

import { escapeHtml, showToast, icon, coverImgHTML } from "./ui.js";
import { t } from "./language.js";
import { player } from "./player.js";
import { addYouTubeSongRecord, findSongByVideoId } from "./storage.js";

/* ---------------------------------------------------------------------- */
/* Local instant search — used by library.js / playlist.js / favorites    */
/* (unchanged behavior, kept here since every page already imports from   */
/* this module)                                                          */
/* ---------------------------------------------------------------------- */

function normalize(text) {
  return (text || "").toString().trim().toLowerCase();
}

export function filterSongs(songs, query) {
  const q = normalize(query);
  if (!q) return songs;
  return songs.filter((song) => {
    return (
      normalize(song.title).includes(q) ||
      normalize(song.artist).includes(q) ||
      normalize(song.album).includes(q)
    );
  });
}

export function filterPlaylists(playlists, query) {
  const q = normalize(query);
  if (!q) return playlists;
  return playlists.filter((playlist) => normalize(playlist.name).includes(q));
}

/**
 * Wire a text input for instant (no-debounce) search.
 * @param {HTMLInputElement} inputEl
 * @param {(query: string) => void} onQueryChange
 */
export function attachLiveSearch(inputEl, onQueryChange) {
  if (!inputEl) return;
  inputEl.addEventListener("input", () => onQueryChange(inputEl.value));
  const clearBtn = inputEl.closest(".search-bar")?.querySelector("[data-action='clear-search']");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      inputEl.value = "";
      onQueryChange("");
      inputEl.focus();
    });
  }
}

/* ---------------------------------------------------------------------- */
/* Online search — YouTube Data API v3                                    */
/* -----------------------------------------------------------------------
   No scraping, no unofficial "no-key" proxy APIs (Piped/Invidious/etc.) —
   this calls YouTube's own public Data API v3 endpoint, which is the
   supported way to do this. It needs an API key of your own:

     1. Go to https://console.cloud.google.com/
     2. Create a project (or reuse one) -> enable "YouTube Data API v3"
     3. Create credentials -> API key -> paste it below.

   The free daily quota (10,000 units/day as of this writing — quotas can
   change, so check the console) is plenty for personal use; a single
   search.list call costs 100 units, so roughly 100 searches/day for free.
   ========================================================================== */

const YOUTUBE_API_KEY = "AIzaSyBSrazYdTYp0AGrgn_T9AnE133yif3DSOs"; // <-- ใส่ API Key ของคุณเองที่นี่ (YouTube Data API v3)
const YOUTUBE_SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_MAX_RESULTS = 20;

/**
 * A. Fetch search results from YouTube Data API v3.
 * Returns the raw API response JSON (shape: { items: [...] }).
 * Throws on missing key / network failure / API error so the caller can
 * decide how to surface it (this module never shows UI directly here).
 */
export async function fetchYouTubeData(query) {
  const trimmed = (query || "").trim();
  if (!trimmed) return { items: [] };

  if (!YOUTUBE_API_KEY) {
    throw new Error("missing_api_key");
  }

  const url = new URL(YOUTUBE_SEARCH_ENDPOINT);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoCategoryId", "10"); // "Music" category
  url.searchParams.set("maxResults", String(YOUTUBE_MAX_RESULTS));
  url.searchParams.set("q", trimmed);
  url.searchParams.set("key", YOUTUBE_API_KEY);

  let response;
  try {
    response = await fetch(url.toString());
  } catch (networkErr) {
    throw new Error("network_error");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || `http_${response.status}`;
    throw new Error(`youtube_api_error:${reason}`);
  }

  return response.json();
}

/**
 * B. Render search results into `hostEl`. Extracts videoId / title /
 * thumbnail / channelTitle from each item and builds song-item cards with
 * Play / Favorite / More buttons wired the same way library.js's own song
 * items are (via data-video-id attributes read by the click delegation in
 * initSearchPage below).
 */
export function displaySearchResults(data, hostEl) {
  const items = (data && data.items) || [];

  if (items.length === 0) {
    hostEl.innerHTML = `<p class="song-sub search-status-text">${t("search_no_results")}</p>`;
    return;
  }

  const cards = [];
  for (const item of items) {
    const videoId = item.id && item.id.videoId;
    if (!videoId) continue; // skip channel/playlist results, keep only videos

    const snippet = item.snippet || {};
    const title = snippet.title || "";
    const channelTitle = snippet.channelTitle || "";
    const thumbnails = snippet.thumbnails || {};
    const thumbnail =
      (thumbnails.medium && thumbnails.medium.url) ||
      (thumbnails.default && thumbnails.default.url) ||
      "assets/images/default-cover.svg";

    cards.push(`
      <div class="song-item" data-video-id="${escapeHtml(videoId)}" data-title="${escapeHtml(title)}" data-channel="${escapeHtml(channelTitle)}" data-thumbnail="${escapeHtml(thumbnail)}">
        <div class="song-cover">${coverImgHTML({ title, coverUrl: thumbnail })}</div>
        <div class="song-meta">
          <div class="song-title">${escapeHtml(title)}</div>
          <div class="song-sub">${escapeHtml(channelTitle || t("unknown_artist"))} · YouTube</div>
        </div>
        <div class="song-actions">
          <button class="icon-btn" data-action="play" aria-label="${t("btn_play")}">${icon("play")}</button>
          <button class="icon-btn" data-action="favorite" aria-label="${t("btn_favorite")}">${icon("heartOutline")}</button>
          <button class="icon-btn" data-action="more" aria-label="${t("btn_edit")}">${icon("dots")}</button>
        </div>
      </div>`);
  }

  hostEl.innerHTML = cards.length
    ? `<div class="song-list">${cards.join("")}</div>`
    : `<p class="song-sub search-status-text">${t("search_no_results")}</p>`;
}

/**
 * The first time a YouTube result is actually acted on (played / favorited
 * / opened in the song menu), persist it as a real song record so it can
 * live in the same library/queue/favorites/playlists as local .mp3 files.
 * Repeated actions on the same video reuse the existing record (dedup by
 * videoId) instead of creating duplicates.
 */
async function ensureYouTubeSongStored({ videoId, title, channelTitle, thumbnail }) {
  const existing = findSongByVideoId(videoId);
  if (existing) return existing;

  const meta = {
    id: `yt_${videoId}`,
    videoId,
    title: title || videoId,
    artist: channelTitle || "",
    thumbnail,
    addedAt: Date.now(),
  };
  const saved = await addYouTubeSongRecord(meta);
  window.dispatchEvent(new CustomEvent("mp:library-changed"));
  return saved;
}

/**
 * Wire up the online-search page: query input + button, results rendering,
 * and click delegation for play / favorite / more on each result card.
 */
export function initSearchPage(container) {
  const input = container.querySelector("#search-online-input");
  const searchBtn = container.querySelector("#search-online-btn");
  const resultsHost = container.querySelector("#search-online-results");
  const statusEl = container.querySelector("#search-online-status");
  const hintEl = container.querySelector("#search-online-hint");

  if (!YOUTUBE_API_KEY && hintEl) {
    hintEl.classList.remove("hidden");
    hintEl.textContent = t("search_missing_api_key");
  }

  async function runSearch() {
    const query = input.value.trim();
    if (!query) return;

    statusEl.classList.remove("hidden");
    statusEl.textContent = t("search_loading");
    resultsHost.innerHTML = "";

    try {
      const data = await fetchYouTubeData(query);
      displaySearchResults(data, resultsHost);
    } catch (err) {
      console.error("search: YouTube search failed", err);
      const message = err && err.message === "missing_api_key" ? t("search_missing_api_key") : t("toast_online_error");
      showToast(message, "error");
      resultsHost.innerHTML = `<p class="song-sub search-status-text">${message}</p>`;
    } finally {
      statusEl.classList.add("hidden");
    }
  }

  searchBtn.addEventListener("click", runSearch);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });

  resultsHost.addEventListener("click", async (event) => {
    const card = event.target.closest(".song-item[data-video-id]");
    const actionBtn = event.target.closest("[data-action]");
    if (!card || !actionBtn) return;

    const videoData = {
      videoId: card.dataset.videoId,
      title: card.dataset.title,
      channelTitle: card.dataset.channel,
      thumbnail: card.dataset.thumbnail,
    };

    try {
      const song = await ensureYouTubeSongStored(videoData);
      const action = actionBtn.dataset.action;
      if (action === "play") {
        player.playSongInContext(song.id, [song.id]);
      } else if (action === "favorite") {
        window.dispatchEvent(new CustomEvent("mp:toggle-favorite", { detail: { songId: song.id } }));
      } else if (action === "more") {
        window.dispatchEvent(new CustomEvent("mp:open-song-menu", { detail: { songId: song.id } }));
      }
    } catch (err) {
      console.error("search: failed to handle result action", err);
      showToast(t("toast_online_error"), "error");
    }
  });
}
