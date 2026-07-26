/* ==========================================================================
   library.js — Song library: add / edit / delete / render / sort
   ========================================================================== */

import {
  getSongs,
  addSongRecord,
  deleteSongRecord,
  patchSongRecord,
  findDuplicateSong,
  getFavorites,
  DEFAULT_COVER,
} from "./storage.js";
import { icon, showToast, escapeHtml, formatTime, coverImgHTML, openOverlay, closeOverlay, bindOverlayDismiss } from "./ui.js";
import { t } from "./language.js";
import { player } from "./player.js";
import { filterSongs, attachLiveSearch } from "./search.js";
import { readAudioTags } from "./metadata.js";

const ACCEPTED_EXTENSIONS = [".mp3", ".m4a", ".wav", ".ogg"];

function makeId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `song_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getExtension(filename) {
  const match = /\.[^/.]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
}

function isSupportedFile(file) {
  const ext = getExtension(file.name);
  if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
  // Some platforms report an empty/odd mimetype for m4a/ogg, so also accept
  // anything the browser itself claims is audio.
  return typeof file.type === "string" && file.type.startsWith("audio/");
}

/** Read basic playable duration from a File via a hidden <audio> probe. */
function readAudioDuration(objectUrl) {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => resolve(probe.duration || 0));
    probe.addEventListener("error", () => resolve(0));
    probe.src = objectUrl;
  });
}

/** Derive a readable title/artist guess from "Artist - Title.mp3" filenames. */
function parseFilename(filename) {
  const base = filename.replace(/\.[^/.]+$/, "");
  const parts = base.split(" - ");
  if (parts.length >= 2) {
    return { title: parts.slice(1).join(" - ").trim(), artist: parts[0].trim() };
  }
  return { title: base.trim(), artist: "" };
}

function makeFingerprint(file) {
  return `${file.name}::${file.size}`;
}

/**
 * Scan and add many files at once without blocking the UI thread for long:
 * each file is processed, then control yields back to the event loop before
 * the next one, and onProgress(current, total) reports scan progress.
 */
export async function addSongsFromFiles(fileList, onProgress) {
  const files = Array.from(fileList);
  const total = files.length;
  const added = [];
  let skippedInvalid = 0;
  let skippedDuplicate = 0;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    if (onProgress) onProgress(i + 1, total);

    if (!isSupportedFile(file)) {
      skippedInvalid++;
      // Yield to the event loop so the progress UI can repaint.
      await new Promise((resolve) => setTimeout(resolve));
      continue;
    }

    const fingerprint = makeFingerprint(file);
    if (findDuplicateSong(fingerprint)) {
      skippedDuplicate++;
      await new Promise((resolve) => setTimeout(resolve));
      continue;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const [duration, tags] = await Promise.all([readAudioDuration(objectUrl), readAudioTags(file)]);
      const guess = parseFilename(file.name);

      const meta = {
        id: makeId(),
        source: "local",
        title: tags.title || guess.title || file.name,
        artist: tags.artist || guess.artist || "",
        album: tags.album || "",
        genre: tags.genre || "",
        year: tags.year || "",
        track: tags.track || "",
        duration,
        fingerprint,
        addedAt: Date.now(),
      };
      const saved = await addSongRecord(meta, file, tags.coverBlob || null);
      added.push(saved);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    // Yield every file so a large batch (dozens of songs) never freezes the UI.
    await new Promise((resolve) => setTimeout(resolve));
  }

  if (added.length > 0) showToast(t("toast_song_added"));
  if (skippedDuplicate > 0) showToast(t("toast_duplicate_skipped", { count: skippedDuplicate }));
  if (skippedInvalid > 0 && added.length === 0 && skippedDuplicate === 0) {
    showToast(t("toast_no_valid_files"), "error");
  } else if (skippedInvalid > 0) {
    showToast(t("toast_invalid_file"), "error");
  }

  if (added.length > 0) window.dispatchEvent(new CustomEvent("mp:library-changed"));
  return added;
}

export function getAllSongs() {
  return getSongs();
}

export function getSongById(songId) {
  return getSongs().find((song) => song.id === songId) || null;
}

export async function deleteSong(songId) {
  await deleteSongRecord(songId);
  showToast(t("toast_song_deleted"));
}

export async function updateSong(songId, patch) {
  return patchSongRecord(songId, patch);
}

/* ---------------- Sorting ---------------- */

export const SORT_OPTIONS = ["newest", "oldest", "az", "za", "artist", "album", "duration"];

// Maps each sort key to its i18n label key, used to render the trigger
// button's current label and each row inside the sort bottom sheet.
const SORT_LABEL_KEYS = {
  newest: "sort_newest",
  oldest: "sort_oldest",
  az: "sort_az",
  za: "sort_za",
  artist: "sort_artist",
  album: "sort_album",
  duration: "sort_duration",
};

export function sortSongs(songs, sortKey) {
  const list = [...songs];
  switch (sortKey) {
    case "oldest":
      return list.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    case "az":
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case "za":
      return list.sort((a, b) => b.title.localeCompare(a.title));
    case "artist":
      return list.sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
    case "album":
      return list.sort((a, b) => (a.album || "").localeCompare(b.album || ""));
    case "duration":
      return list.sort((a, b) => (a.duration || 0) - (b.duration || 0));
    case "newest":
    default:
      return list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }
}

/* ---------------- Shared song-item rendering (reused by playlist/favorites) ---------------- */

export function songItemHTML(song, { draggable = false, showRemove = false } = {}) {
  const favorites = getFavorites();
  const isFav = favorites.includes(song.id);
  const isActive = player.currentSong && player.currentSong.id === song.id;
  return `
    <div class="song-item${isActive ? " is-active" : ""}" data-song-id="${song.id}" ${draggable ? 'draggable="true"' : ""}>
      ${draggable ? `<span class="drag-handle">${icon("drag")}</span>` : ""}
      <div class="song-cover">${coverImgHTML(song)}</div>
      <div class="song-meta">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-sub">${escapeHtml(song.artist || t("unknown_artist"))} · ${formatTime(song.duration)}</div>
      </div>
      <div class="song-actions">
        <button class="icon-btn fav-toggle" data-action="favorite" aria-label="${t("btn_favorite")}">${icon(isFav ? "heart" : "heartOutline")}</button>
        <button class="icon-btn" data-action="more" aria-label="${t("btn_edit")}">${icon("dots")}</button>
        ${showRemove ? `<button class="icon-btn" data-action="remove" aria-label="${t("btn_remove_from_playlist")}">${icon("trash")}</button>` : ""}
      </div>
    </div>`;
}

export function renderSongList(songs, options = {}) {
  if (songs.length === 0) return "";
  return `<div class="song-list">${songs.map((song) => songItemHTML(song, options)).join("")}</div>`;
}

/* ---------------- Page controller ---------------- */

// The sort sheet itself lives in index.html (the persistent app shell, same
// as the queue/song-menu sheets), not inside the library page markup that
// gets re-fetched/re-rendered on every visit. So its listeners are wired up
// exactly ONCE here at module scope — otherwise re-running initLibraryPage()
// on every Library-tab visit would stack duplicate click handlers on it.
const sortSheet = document.getElementById("library-sort-sheet");
const sortOptionsHost = sortSheet ? sortSheet.querySelector("#library-sort-options") : null;

// Holds the callback for whichever library page instance is currently on
// screen, since sortOptionsHost's click listener below must always act on
// the *current* instance's state, not whichever one existed when it fired.
let onSortOptionSelected = null;

if (sortOptionsHost) {
  sortOptionsHost.addEventListener("click", (event) => {
    const optionBtn = event.target.closest(".sort-option");
    if (!optionBtn || !onSortOptionSelected) return;
    onSortOptionSelected(optionBtn.dataset.sortKey);
  });
}
if (sortSheet) bindOverlayDismiss(sortSheet); // tap the backdrop to close, like every other sheet

export function initLibraryPage(container) {
  const listHost = container.querySelector("#library-list");
  const fileInput = container.querySelector("#library-file-input");
  const addBtn = container.querySelector("#library-add-btn");
  const emptyState = container.querySelector("#library-empty");
  const countPill = container.querySelector("#library-count");
  const searchInput = container.querySelector("#library-search-input");
  const noResults = container.querySelector("#library-no-results");
  const sortTrigger = container.querySelector("#library-sort-trigger");
  const sortTriggerLabel = sortTrigger ? sortTrigger.querySelector(".sort-trigger-label") : null;
  const progressHost = container.querySelector("#library-scan-progress");
  const progressBar = container.querySelector("#library-scan-progress-bar");
  const progressText = container.querySelector("#library-scan-progress-text");

  let currentQuery = "";
  let currentSort = "newest";

  function render() {
    const allSongs = getAllSongs();
    const filtered = filterSongs(allSongs, currentQuery);
    const songs = sortSongs(filtered, currentSort);
    countPill.textContent = t("song_count", { count: allSongs.length });

    if (allSongs.length === 0) {
      listHost.innerHTML = "";
      emptyState.classList.remove("hidden");
      noResults.classList.add("hidden");
      return;
    }
    emptyState.classList.add("hidden");

    if (songs.length === 0) {
      listHost.innerHTML = "";
      noResults.classList.remove("hidden");
      return;
    }
    noResults.classList.add("hidden");
    listHost.innerHTML = renderSongList(songs);
  }

  attachLiveSearch(searchInput, (query) => {
    currentQuery = query;
    render();
  });

  // ---- Sort bottom sheet (Material Design style, replaces the native <select>) ----
  function updateSortTriggerLabel() {
    if (sortTriggerLabel) sortTriggerLabel.textContent = t(SORT_LABEL_KEYS[currentSort] || "sort_newest");
  }

  function renderSortOptions() {
    if (!sortOptionsHost) return;
    sortOptionsHost.innerHTML = SORT_OPTIONS.map((key) => {
      const isSelected = key === currentSort;
      return `
        <button class="sort-option${isSelected ? " is-selected" : ""}" data-sort-key="${key}" type="button">
          <span>${t(SORT_LABEL_KEYS[key])}</span>
          <span class="sort-option-check">${icon("check")}</span>
        </button>`;
    }).join("");
  }

  if (sortTrigger && sortSheet) {
    updateSortTriggerLabel();

    // This listener is scoped to the button inside `container`, which is
    // torn down and rebuilt on every navigation — so, unlike the sheet
    // itself, it's safe to attach fresh each time initLibraryPage() runs.
    sortTrigger.addEventListener("click", () => {
      renderSortOptions(); // refresh checkmarks in case sort changed elsewhere
      openOverlay(sortSheet);
    });

    // Hand this page instance's own logic to the module-level delegate so
    // the single shared sortOptionsHost listener calls into *this* visit.
    onSortOptionSelected = (sortKey) => {
      currentSort = sortKey;
      updateSortTriggerLabel();
      closeOverlay(sortSheet);
      render();
    };
  }

  addBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    progressHost.classList.remove("hidden");
    progressBar.style.width = "0%";
    progressText.textContent = t("scanning_songs", { current: 0, total: files.length });

    await addSongsFromFiles(files, (current, total) => {
      progressBar.style.width = `${Math.round((current / total) * 100)}%`;
      progressText.textContent = t("scanning_songs", { current, total });
    });

    progressHost.classList.add("hidden");
    fileInput.value = "";
    render();
  });

  listHost.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("[data-action]");
    const songItem = event.target.closest(".song-item");
    if (!songItem) return;
    const songId = songItem.getAttribute("data-song-id");

    if (actionBtn && actionBtn.dataset.action === "favorite") {
      window.dispatchEvent(new CustomEvent("mp:toggle-favorite", { detail: { songId } }));
      return;
    }
    if (actionBtn && actionBtn.dataset.action === "more") {
      window.dispatchEvent(new CustomEvent("mp:open-song-menu", { detail: { songId } }));
      return;
    }
    const visibleIds = sortSongs(filterSongs(getAllSongs(), currentQuery), currentSort).map((song) => song.id);
    player.playSongInContext(songId, visibleIds);
  });

  window.addEventListener("mp:library-changed", render);
  window.addEventListener("mp:favorites-changed", render);
  render();
}

export { DEFAULT_COVER };
