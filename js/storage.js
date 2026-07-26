/* ==========================================================================
   storage.js — Persistence layer
   -----------------------------------------------------------------------
   IndexedDB holds everything heavy / structural:
     songs      -> song metadata records (no blobs inside)
     audioBlobs -> { id, blob }  (the actual playable audio file)
     coverBlobs -> { id, blob }  (album art extracted from metadata)
     playlists  -> playlist records
     kv         -> small single-value records (favorites array, queue state)

   LocalStorage only ever holds tiny, synchronous UI preferences that need
   to be available before the DB is even opened (theme flashes otherwise):
     theme, language, volume, repeat, shuffle, last visited page.

   Everything else in the app talks to this module through synchronous
   getters backed by an in-memory cache, so existing callers don't need to
   become async just to read data. Writers persist to IndexedDB in the
   background and keep the cache in sync. Call `initStorage()` once, before
   rendering anything, to hydrate the cache from IndexedDB.
   ========================================================================== */

const DB_NAME = "musicPlayerDB";
const DB_VERSION = 2;

const STORES = {
  SONGS: "songs",
  AUDIO: "audioBlobs",
  COVERS: "coverBlobs",
  PLAYLISTS: "playlists",
  KV: "kv",
  LYRICS: "lyricsCache",
};

const LS_KEYS = {
  THEME: "mp_theme",
  ANIMATION: "mp_animation",
  BLUR: "mp_blur",
  SHOWCOVER: "mp_showcover",
  LANGUAGE: "mp_language",
  VOLUME: "mp_volume",
  REPEAT: "mp_repeat",
  SHUFFLE: "mp_shuffle",
  LAST_PAGE: "mp_last_page",
};

export const DEFAULT_COVER = "assets/images/default-cover.svg";

const DEFAULT_SETTINGS = {
  theme: "dark", // dark | light | system
  animation: true,
  blur: true,
  showCover: true,
};

/* ---------------------------------------------------------------------- */
/* IndexedDB low-level helpers                                            */
/* ---------------------------------------------------------------------- */

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("storage: IndexedDB is not supported in this browser"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORES.SONGS)) {
        db.createObjectStore(STORES.SONGS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.AUDIO)) {
        db.createObjectStore(STORES.AUDIO, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.COVERS)) {
        db.createObjectStore(STORES.COVERS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.PLAYLISTS)) {
        db.createObjectStore(STORES.PLAYLISTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.KV)) {
        db.createObjectStore(STORES.KV, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORES.LYRICS)) {
        db.createObjectStore(STORES.LYRICS, { keyPath: "songId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => console.warn("storage: IndexedDB upgrade blocked by another tab");
  });
  return dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGetAll(storeName) {
  const store = await tx(storeName, "readonly");
  return reqToPromise(store.getAll());
}

async function idbGet(storeName, key) {
  const store = await tx(storeName, "readonly");
  return reqToPromise(store.get(key));
}

async function idbPut(storeName, value) {
  const store = await tx(storeName, "readwrite");
  return reqToPromise(store.put(value));
}

async function idbDelete(storeName, key) {
  const store = await tx(storeName, "readwrite");
  return reqToPromise(store.delete(key));
}

async function idbClearAndFill(storeName, values) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    store.clear();
    values.forEach((value) => store.put(value));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ---------------------------------------------------------------------- */
/* In-memory caches (kept in sync with IndexedDB)                         */
/* ---------------------------------------------------------------------- */

let songsCache = [];
let playlistsCache = [];
let favoritesCache = [];
let queueCache = { ids: [], index: 0 };
let storageReady = false;

/* Object URLs are expensive/leaky if created repeatedly, so we cache one
   per song id and only revoke when the underlying blob is actually gone. */
const audioUrlCache = new Map(); // id -> objectURL
const coverUrlCache = new Map(); // id -> objectURL

async function hydrateCoverUrl(song) {
  if (song.source === "youtube") {
    song.coverUrl = song.thumbnail || DEFAULT_COVER;
    return;
  }
  if (coverUrlCache.has(song.id)) {
    song.coverUrl = coverUrlCache.get(song.id);
    return;
  }
  try {
    const record = await idbGet(STORES.COVERS, song.id);
    if (record && record.blob) {
      const url = URL.createObjectURL(record.blob);
      coverUrlCache.set(song.id, url);
      song.coverUrl = url;
      return;
    }
  } catch (err) {
    console.error("storage: failed to load cover", song.id, err);
  }
  song.coverUrl = DEFAULT_COVER;
}

/**
 * Must be called once at app bootstrap, before any page renders, so that
 * synchronous getters below have real data to return.
 */
export async function initStorage() {
  if (storageReady) return;
  try {
    const [songs, playlists, favoritesRecord, queueRecord] = await Promise.all([
      idbGetAll(STORES.SONGS),
      idbGetAll(STORES.PLAYLISTS),
      idbGet(STORES.KV, "favorites"),
      idbGet(STORES.KV, "queue"),
    ]);
    songsCache = songs.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    playlistsCache = playlists;
    favoritesCache = (favoritesRecord && favoritesRecord.value) || [];
    queueCache = (queueRecord && queueRecord.value) || { ids: [], index: 0 };

    await Promise.all(songsCache.map(hydrateCoverUrl));
  } catch (err) {
    console.error("storage: failed to initialize IndexedDB, falling back to empty state", err);
    songsCache = [];
    playlistsCache = [];
    favoritesCache = [];
    queueCache = { ids: [], index: 0 };
  }
  storageReady = true;
}

export function isStorageReady() {
  return storageReady;
}

/* ---------------- Songs (metadata only — blobs live separately) -------- */

export function getSongs() {
  return songsCache;
}

/** Bulk-replace all song metadata (used for reordering/edits, never touches blobs). */
export async function saveSongs(songs) {
  songsCache = songs;
  try {
    await idbClearAndFill(STORES.SONGS, songs.map(stripRuntimeFields));
    return true;
  } catch (err) {
    console.error("storage: failed to save songs", err);
    return false;
  }
}

/**
 * Add one fully-prepared song: metadata record + its audio blob + optional
 * cover blob. This is the only place a new playable song is created.
 */
export async function addSongRecord(meta, audioBlob, coverBlob) {
  songsCache = [meta, ...songsCache];
  try {
    await idbPut(STORES.SONGS, stripRuntimeFields(meta));
    if (audioBlob) await idbPut(STORES.AUDIO, { id: meta.id, blob: audioBlob });
    if (coverBlob) {
      await idbPut(STORES.COVERS, { id: meta.id, blob: coverBlob });
      const url = URL.createObjectURL(coverBlob);
      coverUrlCache.set(meta.id, url);
      meta.coverUrl = url;
    } else {
      meta.coverUrl = DEFAULT_COVER;
    }
  } catch (err) {
    console.error("storage: failed to persist song", meta.id, err);
  }
  return meta;
}

/** Find an already-imported YouTube song by its video id (dedupe on repeat search/add). */
export function findSongByVideoId(videoId) {
  return songsCache.find((song) => song.source === "youtube" && song.videoId === videoId) || null;
}

/**
 * Persist a YouTube search result as a first-class song record: same shape
 * as a local song (id/title/artist/album/duration/addedAt) plus
 * source:"youtube" + videoId + thumbnail. No audio/cover blob is stored —
 * playback streams live from YouTube and the cover is just their CDN URL.
 */
export async function addYouTubeSongRecord(meta) {
  const record = {
    id: meta.id,
    source: "youtube",
    videoId: meta.videoId,
    title: meta.title || "",
    artist: meta.artist || "",
    album: meta.album || "",
    genre: meta.genre || "",
    year: meta.year || "",
    track: meta.track || "",
    duration: meta.duration || 0,
    thumbnail: meta.thumbnail || "",
    addedAt: meta.addedAt || Date.now(),
    coverUrl: meta.thumbnail || DEFAULT_COVER,
  };
  songsCache = [record, ...songsCache];
  try {
    await idbPut(STORES.SONGS, stripRuntimeFields(record));
  } catch (err) {
    console.error("storage: failed to persist YouTube song", record.id, err);
  }
  return record;
}

/** Remove a song's metadata + audio blob + cover blob + any cached object URLs. */
export async function deleteSongRecord(songId) {
  songsCache = songsCache.filter((song) => song.id !== songId);
  revokeAudioObjectURL(songId);
  revokeCoverObjectURL(songId);
  try {
    await Promise.all([
      idbDelete(STORES.SONGS, songId),
      idbDelete(STORES.AUDIO, songId),
      idbDelete(STORES.COVERS, songId),
      idbDelete(STORES.LYRICS, songId),
    ]);
  } catch (err) {
    console.error("storage: failed to delete song", songId, err);
  }
}

/** Patch metadata fields on an existing song (title/artist/album edits etc). */
export async function patchSongRecord(songId, patch) {
  let updated = null;
  songsCache = songsCache.map((song) => {
    if (song.id !== songId) return song;
    updated = { ...song, ...patch };
    return updated;
  });
  if (updated) {
    try {
      await idbPut(STORES.SONGS, stripRuntimeFields(updated));
    } catch (err) {
      console.error("storage: failed to update song", songId, err);
    }
  }
  return updated;
}

/** Object URLs are runtime-only; never persist them back into IndexedDB. */
function stripRuntimeFields(song) {
  const { coverUrl, ...rest } = song;
  return rest;
}

/* ---------------- Audio blob access (used by the player) --------------- */

export async function getAudioObjectURL(songId) {
  if (audioUrlCache.has(songId)) return audioUrlCache.get(songId);
  const record = await idbGet(STORES.AUDIO, songId);
  if (!record || !record.blob) return null;
  const url = URL.createObjectURL(record.blob);
  audioUrlCache.set(songId, url);
  return url;
}

export function revokeAudioObjectURL(songId) {
  const url = audioUrlCache.get(songId);
  if (url) {
    URL.revokeObjectURL(url);
    audioUrlCache.delete(songId);
  }
}

export function revokeCoverObjectURL(songId) {
  const url = coverUrlCache.get(songId);
  if (url && url !== DEFAULT_COVER) {
    URL.revokeObjectURL(url);
    coverUrlCache.delete(songId);
  }
}

/** Quick duplicate check: same filename + file size already stored. */
export function findDuplicateSong(fingerprint) {
  return songsCache.find((song) => song.fingerprint === fingerprint) || null;
}

/* ---------------- Playlists ---------------- */

export function getPlaylists() {
  return playlistsCache;
}
export async function savePlaylists(playlists) {
  playlistsCache = playlists;
  try {
    await idbClearAndFill(STORES.PLAYLISTS, playlists);
    return true;
  } catch (err) {
    console.error("storage: failed to save playlists", err);
    return false;
  }
}

/* ---------------- Favorites (array of song ids) ---------------- */

export function getFavorites() {
  return favoritesCache;
}
export async function saveFavorites(favorites) {
  favoritesCache = favorites;
  try {
    await idbPut(STORES.KV, { key: "favorites", value: favorites });
    return true;
  } catch (err) {
    console.error("storage: failed to save favorites", err);
    return false;
  }
}

/* ---------------- Queue (array of song ids + pointer) ---------------- */

export function getQueueState() {
  return queueCache;
}
export async function saveQueueState(queueState) {
  queueCache = queueState;
  try {
    await idbPut(STORES.KV, { key: "queue", value: queueState });
    return true;
  } catch (err) {
    console.error("storage: failed to save queue", err);
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* LocalStorage — tiny synchronous preferences only                       */
/* ---------------------------------------------------------------------- */

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}
function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`storage: failed to write ${key}`, err);
    return false;
  }
}

/* ---------- Settings (theme / animation / blur / showCover) ---------- */
export function getSettings() {
  return {
    theme: readLS(LS_KEYS.THEME, DEFAULT_SETTINGS.theme),
    animation: readLS(LS_KEYS.ANIMATION, DEFAULT_SETTINGS.animation),
    blur: readLS(LS_KEYS.BLUR, DEFAULT_SETTINGS.blur),
    showCover: readLS(LS_KEYS.SHOWCOVER, DEFAULT_SETTINGS.showCover),
  };
}
export function saveSettings(settings) {
  writeLS(LS_KEYS.THEME, settings.theme);
  writeLS(LS_KEYS.ANIMATION, settings.animation);
  writeLS(LS_KEYS.BLUR, settings.blur);
  writeLS(LS_KEYS.SHOWCOVER, settings.showCover);
  return true;
}

/* ---------- Language ---------- */
export function getLanguagePreference() {
  return localStorage.getItem(LS_KEYS.LANGUAGE) || "th";
}
export function saveLanguagePreference(langCode) {
  localStorage.setItem(LS_KEYS.LANGUAGE, langCode);
}

/* ---------- Player prefs: volume / repeat / shuffle ---------- */
export function getPlayerPrefs() {
  return {
    volume: readLS(LS_KEYS.VOLUME, 1),
    repeatMode: readLS(LS_KEYS.REPEAT, "off"),
    shuffleOn: readLS(LS_KEYS.SHUFFLE, false),
  };
}
export function savePlayerPrefs(prefs) {
  writeLS(LS_KEYS.VOLUME, prefs.volume);
  writeLS(LS_KEYS.REPEAT, prefs.repeatMode);
  writeLS(LS_KEYS.SHUFFLE, prefs.shuffleOn);
}

/* ---------- Last visited page (for resuming where the user left off) --- */
export function getLastPage() {
  return localStorage.getItem(LS_KEYS.LAST_PAGE) || "library";
}
export function saveLastPage(route) {
  localStorage.setItem(LS_KEYS.LAST_PAGE, route);
}

/* ---------- Lyrics cache (LRC text keyed by songId) --------------------- */
/**
 * Returns the cached lyrics record for a song, or null if nothing is cached.
 * Shape: { songId, status: "synced"|"plain"|"none", syncedLyrics, plainLyrics, savedTime }
 */
export async function getCachedLyrics(songId) {
  try {
    const record = await idbGet(STORES.LYRICS, songId);
    return record || null;
  } catch (err) {
    console.error("storage: failed to read lyrics cache", err);
    return null;
  }
}

export async function saveCachedLyrics(songId, data) {
  try {
    await idbPut(STORES.LYRICS, { songId, savedTime: Date.now(), ...data });
  } catch (err) {
    console.error("storage: failed to save lyrics cache", err);
  }
}

export async function deleteCachedLyrics(songId) {
  try {
    await idbDelete(STORES.LYRICS, songId);
  } catch (err) {
    console.error("storage: failed to delete lyrics cache", err);
  }
}

export { STORES };
