/* ==========================================================================
   playlist.js — Playlist CRUD, song membership, drag & drop reordering
   ========================================================================== */

import { getPlaylists, savePlaylists } from "./storage.js";
import { getAllSongs, getSongById, renderSongList } from "./library.js";
import { icon, showToast, escapeHtml, openOverlay, closeOverlay, confirmAction } from "./ui.js";
import { t } from "./language.js";
import { player } from "./player.js";
import { filterPlaylists, attachLiveSearch } from "./search.js";

function makeId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `pl_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createPlaylist(name) {
  const playlists = getPlaylists();
  const playlist = { id: makeId(), name: name.trim(), songIds: [], createdAt: Date.now() };
  savePlaylists([...playlists, playlist]);
  showToast(t("toast_playlist_created"));
  return playlist;
}

export function renamePlaylist(playlistId, newName) {
  const playlists = getPlaylists().map((pl) => (pl.id === playlistId ? { ...pl, name: newName.trim() } : pl));
  savePlaylists(playlists);
  showToast(t("toast_playlist_renamed"));
}

export function deletePlaylist(playlistId) {
  savePlaylists(getPlaylists().filter((pl) => pl.id !== playlistId));
  showToast(t("toast_playlist_deleted"));
}

export function addSongToPlaylist(playlistId, songId) {
  const playlists = getPlaylists().map((pl) => {
    if (pl.id !== playlistId) return pl;
    if (pl.songIds.includes(songId)) return pl;
    return { ...pl, songIds: [...pl.songIds, songId] };
  });
  savePlaylists(playlists);
  showToast(t("toast_added_to_playlist"));
}

export function removeSongFromPlaylist(playlistId, songId) {
  const playlists = getPlaylists().map((pl) =>
    pl.id === playlistId ? { ...pl, songIds: pl.songIds.filter((id) => id !== songId) } : pl
  );
  savePlaylists(playlists);
  showToast(t("toast_removed_from_playlist"));
}

export function reorderPlaylistSongs(playlistId, fromIndex, toIndex) {
  const playlists = getPlaylists().map((pl) => {
    if (pl.id !== playlistId) return pl;
    const songIds = [...pl.songIds];
    const [moved] = songIds.splice(fromIndex, 1);
    songIds.splice(toIndex, 0, moved);
    return { ...pl, songIds };
  });
  savePlaylists(playlists);
}

export function getPlaylistById(playlistId) {
  return getPlaylists().find((pl) => pl.id === playlistId) || null;
}

// Re-exported so other modules (app.js) can get playlists without also
// having to import storage.js directly.
export { getPlaylists };

/* ---------------- Page controller ---------------- */

export function initPlaylistPage(container) {
  const gridHost = container.querySelector("#playlist-grid");
  const emptyState = container.querySelector("#playlist-empty");
  const createBtn = container.querySelector("#playlist-create-btn");
  const detailHost = container.querySelector("#playlist-detail");
  const modal = container.querySelector("#playlist-modal");
  const modalTitle = modal.querySelector("#playlist-modal-title");
  const modalInput = modal.querySelector("#playlist-name-input");
  const modalSave = modal.querySelector("#playlist-modal-save");
  const modalCancel = modal.querySelector("#playlist-modal-cancel");

  const searchInput = container.querySelector("#playlist-search-input");
  let editingPlaylistId = null;
  let openPlaylistId = null;
  let currentQuery = "";

  function renderGrid() {
    const allPlaylists = getPlaylists();
    const playlists = filterPlaylists(allPlaylists, currentQuery);
    if (allPlaylists.length === 0) {
      gridHost.innerHTML = "";
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");
    gridHost.innerHTML = playlists
      .map(
        (pl) => `
      <button class="playlist-card card-enter" data-playlist-id="${pl.id}">
        <div class="playlist-cover">${icon("playlist")}</div>
        <div class="playlist-name">${escapeHtml(pl.name)}</div>
        <div class="playlist-count">${t("song_count", { count: pl.songIds.length })}</div>
      </button>`
      )
      .join("");
  }

  function renderDetail(playlistId) {
    const playlist = getPlaylistById(playlistId);
    if (!playlist) return closeDetail();
    const songs = playlist.songIds.map((id) => getSongById(id)).filter(Boolean);
    detailHost.innerHTML = `
      <div class="app-topbar">
        <button class="icon-btn" id="playlist-back-btn" aria-label="${t("btn_close")}">${icon("back")}</button>
        <h1>${escapeHtml(playlist.name)}</h1>
        <button class="icon-btn" id="playlist-rename-btn" aria-label="${t("btn_rename")}">${icon("edit")}</button>
      </div>
      <p class="count-pill">${t("song_count", { count: songs.length })}</p>
      <div style="margin-top:12px">
        ${songs.length ? renderSongList(songs, { draggable: true, showRemove: true }) : `
          <div class="empty-state">
            <div>${icon("music")}</div>
            <p>${t("playlist_detail_empty")}</p>
          </div>`}
      </div>
      <button class="btn btn-danger btn-block" id="playlist-delete-btn" style="margin-top:24px">${icon("trash")} ${t("btn_delete")}</button>
    `;
    detailHost.classList.remove("hidden");
    gridHost.classList.add("hidden");
    emptyState.classList.add("hidden");
    createBtn.classList.add("hidden");

    detailHost.querySelector("#playlist-back-btn").addEventListener("click", closeDetail);
    detailHost.querySelector("#playlist-rename-btn").addEventListener("click", () => openModal("rename", playlist));
    detailHost.querySelector("#playlist-delete-btn").addEventListener("click", () => {
      if (!confirmAction(t("playlist_delete_confirm"))) return;
      deletePlaylist(playlist.id);
      closeDetail();
      renderGrid();
    });

    const list = detailHost.querySelector(".song-list");
    if (list) bindSongListInteractions(list, playlist.id, songs);
  }

  function closeDetail() {
    openPlaylistId = null;
    detailHost.classList.add("hidden");
    gridHost.classList.remove("hidden");
    createBtn.classList.remove("hidden");
    renderGrid();
  }

  function bindSongListInteractions(list, playlistId, songs) {
    list.addEventListener("click", (event) => {
      const actionBtn = event.target.closest("[data-action]");
      const item = event.target.closest(".song-item");
      if (!item) return;
      const songId = item.getAttribute("data-song-id");
      if (actionBtn && actionBtn.dataset.action === "favorite") {
        window.dispatchEvent(new CustomEvent("mp:toggle-favorite", { detail: { songId } }));
        return;
      }
      if (actionBtn && actionBtn.dataset.action === "remove") {
        removeSongFromPlaylist(playlistId, songId);
        renderDetail(playlistId);
        return;
      }
      if (actionBtn && actionBtn.dataset.action === "more") return;
      player.playSongInContext(songId, songs.map((s) => s.id));
    });

    let dragFromIndex = null;
    list.querySelectorAll(".song-item").forEach((item, index) => {
      item.addEventListener("dragstart", () => {
        dragFromIndex = index;
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        item.classList.add("drag-over");
      });
      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("drag-over");
        const toIndex = index;
        if (dragFromIndex === null || dragFromIndex === toIndex) return;
        reorderPlaylistSongs(playlistId, dragFromIndex, toIndex);
        renderDetail(playlistId);
      });
    });
  }

  function openModal(mode, playlist = null) {
    editingPlaylistId = mode === "rename" ? playlist.id : null;
    modalTitle.textContent = mode === "rename" ? t("playlist_rename_title") : t("playlist_create_title");
    modalInput.value = mode === "rename" ? playlist.name : "";
    openOverlay(modal);
    modalInput.focus();
  }

  attachLiveSearch(searchInput, (query) => {
    currentQuery = query;
    renderGrid();
  });

  createBtn.addEventListener("click", () => openModal("create"));
  modalCancel.addEventListener("click", () => closeOverlay(modal));
  modalSave.addEventListener("click", () => {
    const name = modalInput.value.trim();
    if (!name) return;
    if (editingPlaylistId) {
      renamePlaylist(editingPlaylistId, name);
      if (openPlaylistId) renderDetail(openPlaylistId);
    } else {
      createPlaylist(name);
    }
    closeOverlay(modal);
    renderGrid();
  });

  gridHost.addEventListener("click", (event) => {
    const card = event.target.closest(".playlist-card");
    if (!card) return;
    openPlaylistId = card.getAttribute("data-playlist-id");
    renderDetail(openPlaylistId);
  });

  window.addEventListener("mp:playlists-changed", renderGrid);
  window.addEventListener("mp:favorites-changed", () => {
    if (openPlaylistId) renderDetail(openPlaylistId);
  });

  renderGrid();
}
