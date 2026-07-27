/* ==========================================================================
   sw.js — Service worker: caches the app shell so the player works offline
   and installs as a PWA.
   -----------------------------------------------------------------------
   Strategy:
   - App shell (HTML/CSS/JS/lang/pages/static assets) → cache-first, with a
     background refresh (stale-while-revalidate) so updates still arrive.
   - Everything else (e.g. any future network requests) → network-first,
     falling back to cache if offline.
   - Audio itself is never handled here — it lives in IndexedDB and plays
     from Blob object URLs, so it never goes through the network/SW at all.

   Bump CACHE_NAME whenever the app-shell file list below changes, so old
   caches get cleaned up on the next activate.
   ========================================================================== */

const CACHE_NAME = "music-player-shell-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/variables.css",
  "./css/style.css",
  "./css/animations.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/language.js",
  "./js/settings.js",
  "./js/library.js",
  "./js/playlist.js",
  "./js/search.js",
  "./js/storage.js",
  "./js/player.js",
  "./js/mediaSession.js",
  "./js/lyrics.js",
  "./js/metadata.js",
  "./js/ui.js",
  "./js/ui-sound.js",
  "./js/future/equalizer.js",
  "./js/future/lyrics.js",
  "./js/future/mediaSession.js",
  "./js/future/playlistIO.js",
  "./js/future/pwa.js",
  "./js/future/sleepTimer.js",
  "./lang/en.json",
  "./lang/th.json",
  "./pages/about.html",
  "./pages/favorites.html",
  "./pages/library.html",
  "./pages/playlist.html",
  "./pages/search.html",
  "./pages/settings.html",
  "./assets/images/default-cover.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-192-maskable.png",
  "./assets/icons/icon-512-maskable.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.error("sw: install/precache failed", err))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate update (e.g. from an "update
// available" prompt) instead of waiting for the next full reload.
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isAppShellRequest(request, url) {
  if (request.mode === "navigate") return true;
  return url.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isAppShellRequest(request, url)) return; // let cross-origin requests pass straight through

  // Navigation requests: cache-first fallback to index.html so deep
  // links/refreshes still work offline (this is a single-page app).
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((cached) => cached || fetch(request))
    );
    return;
  }

  // Cache-first, stale-while-revalidate for the rest of the app shell.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline: fall back to whatever we had cached

      return cached || networkFetch;
    })
  );
});
