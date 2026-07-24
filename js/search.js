/* ==========================================================================
   search.js — Local instant search + Online (Invidious API)
   ========================================================================== */

import { escapeHtml, showToast, icon, coverImgHTML } from "./ui.js";
import { t } from "./language.js";
import { player } from "./player.js";
import { addYouTubeSongRecord, findSongByVideoId } from "./storage.js";

/* ---------------------------------------------------------------------- */
/* Local instant search                                                   */
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
/* Online search — Invidious API (CORS-friendly, ไม่ต้องใช้ Proxy)        */
/* ---------------------------------------------------------------------- */

// รายชื่อ Invidious instances ที่ใช้งานได้ (เรียงตามความน่าเชื่อถือ)
const INVICIOUS_INSTANCES = [
  "https://invidious.jing.rocks",
  "https://inv.riverside.rocks",
  "https://yewtu.be",
  "https://invidious.nerdvpn.de",
  "https://invidious.lunar.icu",
  "https://inv.vern.cc",
  "https://vid.puffyan.us",
];

let lastWorkingInstance = null;

/**
 * A. Fetch search results จาก Invidious API
 * ลองทีละ instance จนกว่าจะเจอที่ใช้งานได้
 */
async function fetchFromInvidious(query) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // ถ้ามี instance ที่เคยใช้ได้ ให้ลองก่อน
  const instancesToTry = lastWorkingInstance
    ? [lastWorkingInstance, ...INVICIOUS_INSTANCES.filter(i => i !== lastWorkingInstance)]
    : INVICIOUS_INSTANCES;

  let lastError = null;

  for (const instance of instancesToTry) {
    try {
      const url = new URL(`${instance}/api/v1/search`);
      url.searchParams.set("q", trimmed);
      url.searchParams.set("type", "video");
      url.searchParams.set("fields", "videoId,title,author,authorId,authorUrl,viewCount,published,thumbnails,lengthSeconds");

      const response = await fetch(url.toString(), {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000), // 10 วินาที timeout
      });

      if (!response.ok) {
        console.warn(`⚠️ Invidious ${instance} returned ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data && Array.isArray(data) && data.length > 0) {
        lastWorkingInstance = instance;
        console.log(`✅ Invidious success: ${instance} (${data.length} results)`);
        return data;
      }

      // ถ้าได้ array ว่าง แสดงว่าไม่พบผลลัพธ์
      if (Array.isArray(data) && data.length === 0) {
        return [];
      }

    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Invidious ${instance} failed:`, err.message);
    }
  }

  console.error("❌ All Invidious instances failed");
  throw new Error(lastError || "invidious_unavailable");
}

export async function fetchYouTubeData(query) {
  const trimmed = (query || "").trim();
  if (!trimmed) return [];

  try {
    return await fetchFromInvidious(trimmed);
  } catch (err) {
    console.error("All Invidious instances failed");
    throw new Error("invidious_unavailable");
  }
}

/**
 * B. Render search results into `hostEl`.
 * Extracts videoId / title / thumbnail / author from each item.
 */
export function displaySearchResults(items, hostEl) {
  if (!items || items.length === 0) {
    hostEl.innerHTML = `<p class="song-sub search-status-text">${t("search_no_results")}</p>`;
    return;
  }

  const cards = [];
  for (const item of items) {
    // Invidious ใช้ videoId โดยตรง
    const videoId = item.videoId;
    if (!videoId) continue;

    const title = item.title || "";
    const uploaderName = item.author || "";
    
    // ดึง thumbnail จาก thumbnails array
    let thumbnail = item.thumbnails?.[0]?.url;
    if (!thumbnail && videoId) {
      thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    }

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

/**
 * The first time a YouTube result is actually acted on, persist it as a
 * real song record so it can live in the same library/queue/favorites/playlists
 * as local .mp3 files.
 */
async function ensureYouTubeSongStored({ videoId, title, channelTitle, thumbnail }) {
  const existing = findSongByVideoId(videoId);
  if (existing) return existing;

  const meta = {
    id: `yt_${videoId}`,
    videoId,
    title: title || videoId,
    artist: channelTitle || "",
    thumbnail: thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
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
      console.error("search: failed", err);
      let message = "ไม่สามารถค้นหาได้ในขณะนี้";
      
      if (err.message === "invidious_unavailable") {
        message = "Invidious API ไม่พร้อมใช้งาน (ลองเปลี่ยน WiFi หรือใช้ VPN)";
      } else if (err.message === "no_results") {
        message = "ไม่พบผลลัพธ์";
      } else {
        message = "เกิดข้อผิดพลาดในการค้นหา (ลองอีกครั้ง)";
      }
      
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
