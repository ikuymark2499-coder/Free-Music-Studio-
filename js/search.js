/* ==========================================================================
   search.js — Local instant search + Online (CORS Proxy + Piped)
   ========================================================================== */

import { escapeHtml, showToast, icon, coverImgHTML } from "./ui.js";
import { t } from "./language.js";
import { player } from "./player.js";
import { addYouTubeSongRecord, findSongByVideoId } from "./storage.js";

/* ---------------------------------------------------------------------- */
/* Local instant search (เหมือนเดิม)                                      */
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
/* Online search — ใช้ Piped + CORS Proxy                                */
/* ---------------------------------------------------------------------- */

// ใช้ CORS proxy เพื่อ bypass CORS ใน Android
const CORS_PROXY = "https://corsproxy.io/?";
const PIPED_BASE = "https://pipedapi.kavin.rocks";

// รายการสำรอง ถ้าตัวหลักใช้ไม่ได้
const FALLBACK_INSTANCES = [
  "https://api.piped.video",
  "https://pipedapi.syncpundit.io",
];

let lastWorkingInstance = PIPED_BASE;

async function fetchFromPiped(query) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // ลองใช้ instance ที่เคยใช้ได้ก่อน
  const instancesToTry = [lastWorkingInstance, ...FALLBACK_INSTANCES];

  for (const instance of instancesToTry) {
    try {
      // ใช้ CORS proxy เพื่อให้ fetch ทำงานใน Android
      const proxyUrl = `${CORS_PROXY}${instance}/search?q=${encodeURIComponent(trimmed)}&filter=videos&page=1`;
      
      // หรือใช้ direct fetch (ถ้า CORS ไม่ใช่ปัญหา)
      // const directUrl = `${instance}/search?q=${encodeURIComponent(trimmed)}&filter=videos&page=1`;
      
      const response = await fetch(proxyUrl, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const items = data.items || [];

      if (items.length > 0) {
        lastWorkingInstance = instance;
        console.log(`✅ Piped success via proxy: ${instance}`);
        return items;
      }
    } catch (err) {
      console.warn(`⚠️ Piped ${instance} failed:`, err.message);
    }
  }

  throw new Error("piped_unavailable");
}

export async function fetchYouTubeData(query) {
  const trimmed = (query || "").trim();
  if (!trimmed) return [];

  try {
    return await fetchFromPiped(trimmed);
  } catch (err) {
    throw new Error("piped_unavailable");
  }
}

export function displaySearchResults(items, hostEl) {
  if (!items || items.length === 0) {
    hostEl.innerHTML = `<p class="song-sub search-status-text">${t("search_no_results")}</p>`;
    return;
  }

  const cards = [];
  for (const item of items) {
    const videoId = item.url?.split("watch?v=")[1] || item.videoId;
    if (!videoId) continue;

    const title = item.title || "";
    const uploaderName = item.uploaderName || item.uploader || "";
    const thumbnail = 
      item.thumbnail || 
      item.thumbnails?.[0]?.url ||
      `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    cards.push(`
      <div class="song-item" data-video-id="${escapeHtml(videoId)}" data-title="${escapeHtml(title)}" data-channel="${escapeHtml(uploaderName)}" data-thumbnail="${escapeHtml(thumbnail)}">
        <div class="song-cover">${coverImgHTML({ title, coverUrl: thumbnail })}</div>
        <div class="song-meta">
          <div class="song-title">${escapeHtml(title)}</div>
          <div class="song-sub">${escapeHtml(uploaderName || t("unknown_artist"))} · YouTube</div>
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

/* ---------------------------------------------------------------------- */
/* Page controller                                                        */
/* ---------------------------------------------------------------------- */

export function initSearchPage(container) {
  const input = container.querySelector("#search-online-input");
  const searchBtn = container.querySelector("#search-online-btn");
  const resultsHost = container.querySelector("#search-online-results");
  const statusEl = container.querySelector("#search-online-status");
  const hintEl = container.querySelector("#search-online-hint");

  if (hintEl) hintEl.classList.add("hidden");

  async function runSearch() {
    const query = input.value.trim();
    if (!query) return;

    statusEl.classList.remove("hidden");
    statusEl.textContent = t("search_loading");
    resultsHost.innerHTML = "";

    try {
      const items = await fetchYouTubeData(query);
      displaySearchResults(items, resultsHost);
    } catch (err) {
      console.error("search: Piped search failed", err);
      const message = "ไม่สามารถเชื่อมต่อ Piped API ได้ (ลองเปิด VPN หรือใช้ WiFi อื่น)";
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