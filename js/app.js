/* ==========================================================================
   app.js — App shell orchestration: routing, mini/full player, favorites,
   song menu, add-to-playlist sheet, queue sheet. The entry point.
   ========================================================================== */

import { initLanguage, onLanguageChange, applyTranslations, t } from "./language.js";
import { initSettingsSystem, initSettingsPage } from "./settings.js";
import { initLibraryPage, getAllSongs, getSongById, updateSong, deleteSong, songItemHTML } from "./library.js";
import { initPlaylistPage, getPlaylists, addSongToPlaylist, createPlaylist } from "./playlist.js";
import { initSearchPage } from "./search.js";
import {
  initStorage,
  getFavorites,
  saveFavorites,
  getLastPage,
  saveLastPage,
  getLyricsChoice,
  saveLyricsChoice,
  saveLyricsOffset,
  getLyricsContent,
  saveLyricsContent,
} from "./storage.js";
import { player } from "./player.js";
import { computeMatchKey, searchLyricsCandidates, fetchLyricsById, findActiveLineIndex } from "./lyrics.js";
import { initLyricsPicker, openLyricsPickerSheet, choicePromptHTML, offsetControlHTML, bindOffsetControl } from "./lyricsPicker.js";
import { playUISound } from "./ui-sound.js";
import { registerServiceWorker, initInstallPrompt, onUpdateReady, applyUpdate } from "./future/pwa.js";
import { initMediaSession } from "./mediaSession.js";
import {
  icon,
  showToast,
  escapeHtml,
  formatTime,
  openOverlay,
  closeOverlay,
  bindOverlayDismiss,
  coverImgHTML,
} from "./ui.js";

const ROUTES = ["library", "search", "playlist", "favorites", "settings", "about"];
const pageContainer = document.getElementById("page-container");
const navButtons = document.querySelectorAll(".nav-btn");

let currentRoute = "library";
const pageCache = new Map();

/* ---------------------------------------------------------------------- */
/* Routing                                                                 */
/* ---------------------------------------------------------------------- */

async function loadPageMarkup(route) {
  if (pageCache.has(route)) return pageCache.get(route);
  const response = await fetch(`pages/${route}.html`);
  const html = await response.text();
  pageCache.set(route, html);
  return html;
}

async function navigate(route) {
  if (!ROUTES.includes(route)) route = "library";
  currentRoute = route;
  const html = await loadPageMarkup(route);
  pageContainer.innerHTML = html;
  pageContainer.classList.remove("page-enter");
  void pageContainer.offsetWidth; // restart animation
  pageContainer.classList.add("page-enter");
  applyTranslations(pageContainer);

  navButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.route === route));

  if (route === "library") initLibraryPage(pageContainer);
  if (route === "search") initSearchPage(pageContainer);
  if (route === "playlist") initPlaylistPage(pageContainer);
  if (route === "favorites") initFavoritesPage(pageContainer);
  if (route === "settings") initSettingsPage(pageContainer);

  refreshActiveSongHighlight();
  window.scrollTo(0, 0);
  saveLastPage(route);
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    playUISound(btn.dataset.route); // synthesized tap sound (Web Audio API)
    navigate(btn.dataset.route);
  });
});

// Allows any page fragment to request navigation (e.g. Settings -> About)
window.addEventListener("mp:navigate", (event) => navigate(event.detail.route));

/* ---------------------------------------------------------------------- */
/* Favorites (no dedicated module per project spec — lives here)          */
/* ---------------------------------------------------------------------- */

function isFavorite(songId) {
  return getFavorites().includes(songId);
}

function toggleFavorite(songId) {
  const favorites = getFavorites();
  const already = favorites.includes(songId);
  const updated = already
    ? favorites.filter((id) => id !== songId)
    : [songId, ...favorites];
  saveFavorites(updated);
  showToast(t(already ? "toast_removed_from_favorites" : "toast_added_to_favorites"));
  window.dispatchEvent(new CustomEvent("mp:favorites-changed"));
  syncFullPlayerFavoriteButton();
}

function initFavoritesPage(container) {
  const listHost = container.querySelector("#favorites-list");
  const emptyState = container.querySelector("#favorites-empty");
  const countPill = container.querySelector("#favorites-count");

  function render() {
    const favIds = getFavorites();
    const songs = favIds.map((id) => getSongById(id)).filter(Boolean);
    countPill.textContent = t("song_count", { count: songs.length });
    if (songs.length === 0) {
      listHost.innerHTML = "";
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");
    listHost.innerHTML = `<div class="song-list">${songs.map((s) => songItemHTML(s)).join("")}</div>`;
  }

  listHost.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("[data-action]");
    const item = event.target.closest(".song-item");
    if (!item) return;
    const songId = item.getAttribute("data-song-id");
    if (actionBtn && actionBtn.dataset.action === "favorite") return toggleFavorite(songId);
    if (actionBtn && actionBtn.dataset.action === "more") return openSongMenu(songId);
    const ids = getFavorites();
    player.playSongInContext(songId, ids);
  });

  window.addEventListener("mp:favorites-changed", render);
  window.addEventListener("mp:library-changed", render);
  render();
}

/* ---------------------------------------------------------------------- */
/* Global song list event bridge (dispatched from library.js / playlist.js)*/
/* ---------------------------------------------------------------------- */

window.addEventListener("mp:toggle-favorite", (event) => toggleFavorite(event.detail.songId));
window.addEventListener("mp:open-song-menu", (event) => openSongMenu(event.detail.songId));

/* ---------------------------------------------------------------------- */
/* Song menu sheet: edit / delete / add to playlist                       */
/* ---------------------------------------------------------------------- */

const songMenuSheet = document.getElementById("song-menu-sheet");
const editModal = document.getElementById("edit-song-modal");
const addToPlaylistSheet = document.getElementById("add-to-playlist-sheet");
let activeSongId = null;

function openSongMenu(songId) {
  activeSongId = songId;
  const song = getSongById(songId);
  if (!song) return;
  songMenuSheet.querySelector("#song-menu-title").textContent = song.title;
  openOverlay(songMenuSheet);
}

document.getElementById("song-menu-edit")?.addEventListener("click", () => {
  const song = getSongById(activeSongId);
  if (!song) return;
  editModal.querySelector("#edit-title-input").value = song.title;
  editModal.querySelector("#edit-artist-input").value = song.artist;
  editModal.querySelector("#edit-album-input").value = song.album;
  closeOverlay(songMenuSheet);
  openOverlay(editModal);
});

document.getElementById("edit-song-save")?.addEventListener("click", async () => {
  const title = editModal.querySelector("#edit-title-input").value.trim();
  const artist = editModal.querySelector("#edit-artist-input").value.trim();
  const album = editModal.querySelector("#edit-album-input").value.trim();
  if (!title) return;
  await updateSong(activeSongId, { title, artist, album });
  closeOverlay(editModal);
  window.dispatchEvent(new CustomEvent("mp:library-changed"));
  showToast(t("toast_settings_saved"));
});
document.getElementById("edit-song-cancel")?.addEventListener("click", () => closeOverlay(editModal));

document.getElementById("song-menu-delete")?.addEventListener("click", async () => {
  if (!activeSongId) return;
  await deleteSong(activeSongId);
  closeOverlay(songMenuSheet);
  window.dispatchEvent(new CustomEvent("mp:library-changed"));
  window.dispatchEvent(new CustomEvent("mp:favorites-changed"));
  window.dispatchEvent(new CustomEvent("mp:playlists-changed"));
});

document.getElementById("song-menu-add-playlist")?.addEventListener("click", () => {
  renderAddToPlaylistSheet();
  closeOverlay(songMenuSheet);
  openOverlay(addToPlaylistSheet);
});

document.getElementById("song-menu-close")?.addEventListener("click", () => closeOverlay(songMenuSheet));

function renderAddToPlaylistSheet() {
  const listHost = addToPlaylistSheet.querySelector("#add-to-playlist-list");
  const playlists = getPlaylists();
  if (playlists.length === 0) {
    listHost.innerHTML = `<p class="song-sub">${t("playlist_empty_desc")}</p>`;
  } else {
    listHost.innerHTML = playlists
      .map(
        (pl) => `
      <button class="song-item" data-playlist-id="${pl.id}" style="width:100%;text-align:left">
        <div class="song-cover">${icon("playlist")}</div>
        <div class="song-meta">
          <div class="song-title">${escapeHtml(pl.name)}</div>
          <div class="song-sub">${t("song_count", { count: pl.songIds.length })}</div>
        </div>
      </button>`
      )
      .join("");
  }
  listHost.querySelectorAll("[data-playlist-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      addSongToPlaylist(btn.dataset.playlistId, activeSongId);
      window.dispatchEvent(new CustomEvent("mp:playlists-changed"));
      closeOverlay(addToPlaylistSheet);
    });
  });
}

document.getElementById("add-to-playlist-new")?.addEventListener("click", () => {
  const name = prompt(t("playlist_name_placeholder"));
  if (!name || !name.trim()) return;
  const playlist = createPlaylist(name);
  addSongToPlaylist(playlist.id, activeSongId);
  window.dispatchEvent(new CustomEvent("mp:playlists-changed"));
  closeOverlay(addToPlaylistSheet);
});
document.getElementById("add-to-playlist-close")?.addEventListener("click", () => closeOverlay(addToPlaylistSheet));

[songMenuSheet, addToPlaylistSheet, editModal].forEach((el) => el && bindOverlayDismiss(el));

/* ---------------------------------------------------------------------- */
/* Mini player + Full player                                              */
/* ---------------------------------------------------------------------- */

const miniPlayer = document.getElementById("mini-player");
const miniCover = document.getElementById("mini-cover");
const miniTitle = document.getElementById("mini-title");
const miniArtist = document.getElementById("mini-artist");
const miniPlayBtn = document.getElementById("mini-play-btn");
const miniNextBtn = document.getElementById("mini-next-btn");
miniNextBtn.innerHTML = icon("next");
const miniProgress = document.getElementById("mini-progress");
const miniCloseBtn = document.getElementById("mini-close-btn");

const fullPlayer = document.getElementById("full-player");
const fpCover = document.getElementById("fp-cover");
const fpTitle = document.getElementById("fp-title");
const fpArtist = document.getElementById("fp-artist");
const fpPlayBtn = document.getElementById("fp-play-btn");
const fpProgressFill = document.getElementById("fp-progress-fill");
const fpProgressThumb = document.getElementById("fp-progress-thumb");
const fpProgressTrack = document.getElementById("fp-progress-track");
const fpCurrentTime = document.getElementById("fp-current-time");
const fpDuration = document.getElementById("fp-duration");
const fpShuffleBtn = document.getElementById("fp-shuffle-btn");
const fpRepeatBtn = document.getElementById("fp-repeat-btn");
const fpFavoriteBtn = document.getElementById("fp-favorite-btn");
const fpQueueBtn = document.getElementById("fp-queue-btn");
const fpLyrics = document.getElementById("fp-lyrics");
const fpLyricsInner = document.getElementById("fp-lyrics-inner");
const fpLyricsInfoBtn = document.getElementById("fp-lyrics-info-btn");
const fpLyricsInfoPopover = document.getElementById("fp-lyrics-info-popover");
const fpLyricsMatchedInfo = document.getElementById("fp-lyrics-matched-info");
const fpLyricsChoice = document.getElementById("fp-lyrics-choice");
const fpLyricsOffsetWrap = document.getElementById("fp-lyrics-offset-wrap");
const fpLyricsOffsetToggleBtn = document.getElementById("fp-lyrics-offset-toggle-btn");
const fpLyricsRechooseBtn = document.getElementById("fp-lyrics-rechoose-btn");
const queueSheet = document.getElementById("queue-sheet");


function closeMiniPlayer() {
  player.stop();
  miniPlayer.classList.add("is-hidden");
  
  miniTitle.textContent = "—";
  miniArtist.textContent = "—";
  miniCover.innerHTML = "";
  miniProgress.style.width = "0%";
  
  updateTransportButtons();
  if (fullPlayer.classList.contains("is-visible")) {
    closeFullPlayer();
  }
}

// เพิ่ม event listener
miniCloseBtn.addEventListener("click", (event) => {
  event.stopPropagation(); // ป้องกันการเปิด full player
  closeMiniPlayer();
});


function refreshMiniPlayer() {
  const song = player.currentSong;
  if (!song) {
    miniPlayer.classList.add("is-hidden");
    return;
  }
  miniPlayer.classList.remove("is-hidden");
  miniTitle.textContent = song.title;
  miniArtist.textContent = song.artist || t("unknown_artist");
  miniCover.innerHTML = coverImgHTML(song);
}

function refreshFullPlayer() {
  const song = player.currentSong;
  if (!song) return;
  fpTitle.textContent = song.title;
  fpArtist.textContent = song.artist || t("unknown_artist");
  fpCover.innerHTML = coverImgHTML(song);
  syncFullPlayerFavoriteButton();
}

function syncFullPlayerFavoriteButton() {
  const song = player.currentSong;
  if (!song || !fpFavoriteBtn) return;
  const fav = isFavorite(song.id);
  fpFavoriteBtn.innerHTML = icon(fav ? "heart" : "heartOutline");
  fpFavoriteBtn.classList.toggle("is-active", fav);
  fpFavoriteBtn.classList.toggle("toggle-btn", true);
}

/* ---------------------------------------------------------------------- */
/* Karaoke lyrics (LRCLIB, cached in IndexedDB via storage.js)            */
/* ---------------------------------------------------------------------- */

let currentLyrics = { status: "none", lines: [] };
let currentLyricsSongId = null;
let currentMatchKey = null;
let currentOffsetSec = 0;
let offsetPanelOpen = false;
let activeLyricsLineIndex = -1;

/* AI is never in this loop by design: matching is title/artist heuristics
   (lyrics.js) plus the user's own confirmation, never a model guess. */

function renderLyrics(result) {
  if (!fpLyricsInner) return;
  if (result.status === "synced" && result.lines.length) {
    fpLyricsInner.innerHTML = result.lines
      .map((line, index) => `<p class="fp-lyrics-line" data-index="${index}">${escapeHtml(line.text || "♪")}</p>`)
      .join("");
  } else if (result.status === "plain" && result.plainText) {
    fpLyricsInner.innerHTML = `<p class="fp-lyrics-plain">${escapeHtml(result.plainText)}</p>`;
  } else {
    fpLyricsInner.innerHTML = `<div class="fp-lyrics-empty">${t("lyrics_none")}</div>`;
  }
  updateLyricsInfoDisclosure(result);
  renderOffsetControl(result);
}

/**
 * Show a small "?" next to the lyrics whenever we actually have lyrics on
 * screen, plus a "choose different lyrics" action, since even a
 * user-confirmed match can turn out wrong later.
 */
function updateLyricsInfoDisclosure(result) {
  if (!fpLyricsInfoBtn) return;

  const hasLyrics = result.status === "synced" || result.status === "plain";
  fpLyricsInfoBtn.classList.toggle("is-hidden", !hasLyrics);
  if (!hasLyrics) {
    hideLyricsInfoPopover();
    return;
  }

  if (fpLyricsMatchedInfo) {
    const track = result.matchedTrackName;
    const artist = result.matchedArtistName;
    fpLyricsMatchedInfo.textContent = track
      ? t("lyrics_matched_as", { track, artist: artist || t("unknown_artist") })
      : "";
  }
}

function hideLyricsInfoPopover() {
  fpLyricsInfoBtn?.classList.remove("is-active");
  fpLyricsInfoPopover?.classList.add("is-hidden");
}

/* Offset control only ever exists once a real (non-"none") choice exists —
   adjusting timing before there's anything timed to adjust makes no sense.
   Even then it stays collapsed behind the gear button until tapped, so it
   doesn't sit in the way while just reading lyrics. */
function renderOffsetControl(result) {
  if (!fpLyricsOffsetWrap) return;

  const eligible = result.status === "synced" && !!currentMatchKey;
  fpLyricsOffsetToggleBtn?.classList.toggle("is-hidden", !eligible);
  fpLyricsOffsetToggleBtn?.classList.toggle("is-active", eligible && offsetPanelOpen);

  if (!eligible || !offsetPanelOpen) {
    fpLyricsOffsetWrap.innerHTML = "";
    return;
  }

  fpLyricsOffsetWrap.innerHTML = offsetControlHTML(currentOffsetSec);
  bindOffsetControl(fpLyricsOffsetWrap, currentOffsetSec, async (nextOffsetSec) => {
    currentOffsetSec = nextOffsetSec;
    renderOffsetControl(result); // re-render immediately, don't wait on the write
    await saveLyricsOffset(currentMatchKey, nextOffsetSec);
  });
}

fpLyricsOffsetToggleBtn?.addEventListener("click", () => {
  offsetPanelOpen = !offsetPanelOpen;
  renderOffsetControl(currentLyrics);
});

/** Resolve a chosen candidate/lyricsId into renderable {status,lines,plainText,...}. */
async function loadContentForChoice(lyricsId) {
  if (lyricsId === null || lyricsId === undefined) {
    return { status: "none", lines: [], plainText: "", matchedTrackName: "", matchedArtistName: "" };
  }
  const cached = await getLyricsContent(lyricsId);
  if (cached) return cached;

  const fetched = await fetchLyricsById(lyricsId);
  const record = fetched || { status: "none", lines: [], plainText: "", matchedTrackName: "", matchedArtistName: "" };
  await saveLyricsContent(lyricsId, record);
  return record;
}

/**
 * Run the search + open the picker sheet, save whatever the person
 * confirms (including "no lyrics"), and return the renderable result.
 * Always shows the sheet, even for exactly one candidate.
 */
async function promptUserToChooseLyrics(song, matchKey) {
  const candidates = await searchLyricsCandidates(song);

  // Cancelled without choosing anything: don't save a choice, so the
  // prompt reappears next time instead of silently defaulting to "none".
  const picked = await openLyricsPickerSheet(song, candidates);
  if (picked === undefined) {
    return { status: "none", lines: [], plainText: "", matchedTrackName: "", matchedArtistName: "" };
  }

  if (picked === null) {
    await saveLyricsChoice(matchKey, { lyricsId: null, status: "none" });
    return { status: "none", lines: [], plainText: "", matchedTrackName: "", matchedArtistName: "" };
  }

  const content = await loadContentForChoice(picked.lyricsId);
  await saveLyricsChoice(matchKey, {
    lyricsId: picked.lyricsId,
    status: content.status,
    trackName: picked.trackName,
    artistName: picked.artistName,
    offsetSec: 0,
  });
  return content;
}

async function loadLyricsForCurrentSong() {
  const song = player.currentSong;
  if (!fpLyricsInner) return;

  if (!song) {
    currentLyrics = { status: "none", lines: [] };
    currentLyricsSongId = null;
    currentMatchKey = null;
    currentOffsetSec = 0;
    offsetPanelOpen = false;
    activeLyricsLineIndex = -1;
    fpLyricsInner.innerHTML = "";
    if (fpLyricsChoice) fpLyricsChoice.innerHTML = "";
    if (fpLyricsOffsetWrap) fpLyricsOffsetWrap.innerHTML = "";
    fpLyricsOffsetToggleBtn?.classList.add("is-hidden");
    return;
  }

  currentLyricsSongId = song.id;
  currentMatchKey = computeMatchKey(song);
  currentOffsetSec = 0;
  offsetPanelOpen = false;
  activeLyricsLineIndex = -1;
  fpLyricsInner.innerHTML = `<div class="fp-lyrics-empty">${t("lyrics_loading")}</div>`;
  fpLyricsInfoBtn?.classList.add("is-hidden");
  fpLyricsOffsetToggleBtn?.classList.add("is-hidden");
  hideLyricsInfoPopover();
  if (fpLyricsChoice) fpLyricsChoice.innerHTML = "";
  if (fpLyricsOffsetWrap) fpLyricsOffsetWrap.innerHTML = "";

  const isStillCurrent = () => player.currentSong && player.currentSong.id === currentLyricsSongId;

  // 1) A choice was already made for this exact video/file before — reuse
  //    it directly, no searching, no picker.
  const saved = await getLyricsChoice(currentMatchKey);
  if (!isStillCurrent()) return;

  if (saved) {
    currentOffsetSec = saved.offsetSec || 0;
    const content = await loadContentForChoice(saved.lyricsId);
    if (!isStillCurrent()) return;
    currentLyrics = { ...content, matchedTrackName: saved.trackName, matchedArtistName: saved.artistName };
    renderLyrics(currentLyrics);
    return;
  }

  // 2) Nothing saved yet: search, then let the person confirm — never
  //    auto-apply a guess, not even when there's only one hit.
  fpLyricsInner.innerHTML = `<div class="fp-lyrics-empty">${t("lyrics_searching")}</div>`;
  const candidates = await searchLyricsCandidates(song);
  if (!isStillCurrent()) return;

  fpLyricsInner.innerHTML = `<div class="fp-lyrics-empty">${t("lyrics_not_chosen_yet")}</div>`;
  if (fpLyricsChoice) {
    fpLyricsChoice.innerHTML = choicePromptHTML(candidates.length);
    document.getElementById("fp-lyrics-choose-btn")?.addEventListener("click", async () => {
      const content = await promptUserToChooseLyrics(song, currentMatchKey);
      if (!isStillCurrent()) return;
      currentLyrics = content;
      currentOffsetSec = 0;
      if (fpLyricsChoice) fpLyricsChoice.innerHTML = content.status === "none" ? choicePromptHTML(candidates.length) : "";
      renderLyrics(content);
    });
  }
}

/** "Choose different lyrics" from the info popover: re-search + re-pick,
    overwriting whatever mapping was saved for this matchKey before. */
async function rechooseLyricsForCurrentSong() {
  const song = player.currentSong;
  if (!song || !currentMatchKey) return;
  hideLyricsInfoPopover();
  const content = await promptUserToChooseLyrics(song, currentMatchKey);
  if (!player.currentSong || player.currentSong.id !== currentLyricsSongId) return;
  currentLyrics = content;
  currentOffsetSec = 0;
  if (fpLyricsChoice) fpLyricsChoice.innerHTML = content.status === "none" ? choicePromptHTML(0) : "";
  renderLyrics(content);
}

fpLyricsRechooseBtn?.addEventListener("click", rechooseLyricsForCurrentSong);

function updateLyricsHighlight(currentTime) {
  if (currentLyrics.status !== "synced" || !currentLyrics.lines.length) return;
  const adjustedTime = currentTime + currentOffsetSec;
  const index = findActiveLineIndex(currentLyrics.lines, adjustedTime);
  if (index === activeLyricsLineIndex) return;
  activeLyricsLineIndex = index;

  const lineEls = fpLyricsInner.querySelectorAll(".fp-lyrics-line");
  lineEls.forEach((el, i) => {
    el.classList.toggle("is-active", i === index);
    el.classList.toggle("is-passed", i < index);
  });

  const activeEl = lineEls[index];
  if (activeEl) activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

function refreshActiveSongHighlight() {
  document.querySelectorAll(".song-item").forEach((item) => {
    const isCurrent = player.currentSong && item.getAttribute("data-song-id") === player.currentSong.id;
    item.classList.toggle("is-active", !!isCurrent);
  });
}

// ฟังก์ชันอัปเดตปุ่มเล่นและปุ่มควบคุมต่างๆ
function updateTransportButtons() {
  const playing = player.isPlaying();
  const loading = player.isLoading ? player.isLoading() : false;

  // ถ้ากำลังโหลด แสดง spinner
  if (loading) {
    miniPlayBtn.innerHTML = icon("spinner");
    fpPlayBtn.innerHTML = icon("spinner");
    return;
  }

  // ถ้าไม่โหลด แสดง play/pause ตามปกติ
  miniPlayBtn.innerHTML = icon(playing ? "pause" : "play");
  fpPlayBtn.innerHTML = icon(playing ? "pause" : "play");
  fpShuffleBtn.classList.toggle("is-active", player.shuffleOn);
  fpRepeatBtn.innerHTML = icon(player.repeatMode === "one" ? "repeatOne" : "repeat");
  fpRepeatBtn.classList.toggle("is-active", player.repeatMode !== "off");
}

// Event Listeners
player.addEventListener("songchange", () => {
  refreshMiniPlayer();
  refreshFullPlayer();
  refreshActiveSongHighlight();
  loadLyricsForCurrentSong();
});

player.addEventListener("statechange", updateTransportButtons);

player.addEventListener("shufflechange", updateTransportButtons);

player.addEventListener("repeatchange", updateTransportButtons);

// เพิ่ม listener สำหรับการโหลด
player.addEventListener("loadstart", updateTransportButtons);
player.addEventListener("loadend", updateTransportButtons);

player.addEventListener("timeupdate", ({ detail }) => {
  const ratio = detail.duration ? detail.currentTime / detail.duration : 0;
  miniProgress.style.width = `${ratio * 100}%`;
  fpProgressFill.style.width = `${ratio * 100}%`;
  fpProgressThumb.style.left = `${ratio * 100}%`;
  fpCurrentTime.textContent = formatTime(detail.currentTime);
  fpDuration.textContent = formatTime(detail.duration);
  updateLyricsHighlight(detail.currentTime);
});

player.addEventListener("metadata", ({ detail }) => {
  const song = player.currentSong;
  if (song && song.source === "youtube" && !song.duration && detail.duration) {
    updateSong(song.id, { duration: detail.duration });
  }
});

miniPlayBtn.addEventListener("click", () => player.togglePlayPause());
miniNextBtn.addEventListener("click", () => player.next());
miniPlayer.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  openFullPlayer();
});

function openFullPlayer() {
  fullPlayer.classList.add("is-visible", "is-open");
  fullPlayer.classList.remove("is-closing");
}
function closeFullPlayer() {
  fullPlayer.classList.add("is-closing");
  setTimeout(() => {
    fullPlayer.classList.remove("is-visible", "is-closing", "is-open");
  }, 220);
}
fpLyricsInfoBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  const willShow = fpLyricsInfoPopover?.classList.contains("is-hidden");
  fpLyricsInfoPopover?.classList.toggle("is-hidden", !willShow);
  fpLyricsInfoBtn.classList.toggle("is-active", willShow);
});
document.addEventListener("click", (event) => {
  if (!fpLyricsInfoPopover || fpLyricsInfoPopover.classList.contains("is-hidden")) return;
  if (event.target === fpLyricsInfoBtn || fpLyricsInfoPopover.contains(event.target)) return;
  hideLyricsInfoPopover();
});

document.getElementById("fp-collapse-btn")?.addEventListener("click", closeFullPlayer);
fpPlayBtn.addEventListener("click", () => player.togglePlayPause());
document.getElementById("fp-next-btn")?.addEventListener("click", () => player.next());
document.getElementById("fp-prev-btn")?.addEventListener("click", () => player.previous());
fpShuffleBtn.addEventListener("click", () => player.toggleShuffle());
fpRepeatBtn.addEventListener("click", () => {
  player.cycleRepeat();
  updateTransportButtons();
});
fpFavoriteBtn.addEventListener("click", () => {
  if (player.currentSong) toggleFavorite(player.currentSong.id);
});

function seekFromClientX(clientX) {
  const rect = fpProgressTrack.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  player.seekByRatio(ratio);
}
fpProgressTrack.addEventListener("click", (event) => seekFromClientX(event.clientX));
fpProgressTrack.addEventListener("pointerdown", (event) => {
  seekFromClientX(event.clientX);
  const onMove = (moveEvent) => seekFromClientX(moveEvent.clientX);
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
});

/* ---------------------------------------------------------------------- */
/* Queue sheet                                                            */
/* ---------------------------------------------------------------------- */

function renderQueueSheet() {
  const upcoming = player.getUpcoming();
  const listHost = queueSheet.querySelector("#queue-list");
  if (upcoming.length === 0) {
    listHost.innerHTML = `<p class="song-sub">${t("queue_empty")}</p>`;
    return;
  }
  listHost.innerHTML = upcoming
    .map(
      (song) => `
    <div class="queue-item" data-song-id="${song.id}">
      <div class="song-cover">${coverImgHTML(song)}</div>
      <div class="song-meta">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-sub">${escapeHtml(song.artist || t("unknown_artist"))}</div>
      </div>
      <button class="icon-btn" data-action="remove-queue" aria-label="${t("btn_delete")}">${icon("trash")}</button>
    </div>`
    )
    .join("");

  listHost.querySelectorAll("[data-action='remove-queue']").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const songId = event.target.closest(".queue-item").getAttribute("data-song-id");
      player.removeFromUpcoming(songId);
      renderQueueSheet();
    });
  });
}

fpQueueBtn.addEventListener("click", () => {
  renderQueueSheet();
  openOverlay(queueSheet);
});
document.getElementById("queue-close")?.addEventListener("click", () => closeOverlay(queueSheet));
bindOverlayDismiss(queueSheet);

/* ---------------------------------------------------------------------- */
/* Bootstrap                                                              */
/* ---------------------------------------------------------------------- */

const LOADER_SLOGAN_KEYS = [
  "loader_slogan_1",
  "loader_slogan_2",
  "loader_slogan_3",
  "loader_slogan_4",
  "loader_slogan_5",
  "loader_slogan_6",
];
const LOADER_MIN_DISPLAY_MS = 1200; // let the letter-wave animation complete at least once

function showRandomLoaderSlogan() {
  const sloganEl = document.getElementById("app-loader-slogan");
  if (!sloganEl) return;
  const key = LOADER_SLOGAN_KEYS[Math.floor(Math.random() * LOADER_SLOGAN_KEYS.length)];
  sloganEl.textContent = t(key);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootstrap() {
  const loaderStartedAt = performance.now();

  registerServiceWorker();
  initInstallPrompt();
  initMediaSession(player);
  onUpdateReady((registration) => {
    showToast(t("pwa_update_ready"));
    // Give the toast a moment to be seen, then swap in the new version.
    setTimeout(() => applyUpdate(registration), 2500);
  });

  initSettingsSystem();
  initLyricsPicker();
  await initLanguage();
  applyTranslations(document);
  showRandomLoaderSlogan();
  await initStorage();

  player.setSongLookup((id) => getSongById(id));
  await player.restoreQueueState();

  onLanguageChange(() => {
    applyTranslations(document);
    applyTranslations(pageContainer);
    updateTransportButtons();
    refreshMiniPlayer();
    refreshFullPlayer();
  });

  await navigate(getLastPage());
  updateTransportButtons();

  // Only wait to top up a *minimum* display time — if real loading already
  // took longer than that, we don't add any extra artificial delay.
  const elapsed = performance.now() - loaderStartedAt;
  if (elapsed < LOADER_MIN_DISPLAY_MS) {
    await delay(LOADER_MIN_DISPLAY_MS - elapsed);
  }

  const appLoader = document.getElementById("app-loader");
  if (appLoader) {
    appLoader.classList.add("is-hidden");
    appLoader.addEventListener("animationend", () => appLoader.remove(), { once: true });
  }
}

bootstrap();
