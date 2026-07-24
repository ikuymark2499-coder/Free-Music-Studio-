/* ==========================================================================
   sw.js — Service worker SCAFFOLD (not registered anywhere yet)
   -----------------------------------------------------------------------
   See js/future/pwa.js for the activation plan and reasoning. This file
   intentionally does nothing destructive if it's ever registered by
   accident — install/activate just log, and fetch is a pure pass-through
   to the network (no caching yet), so nothing changes for the app today.
   ========================================================================== */

const CACHE_NAME = "music-player-shell-v1"; // bump when the app-shell file list changes

self.addEventListener("install", (event) => {
  console.info("sw: install (scaffold — no app-shell caching yet)");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.info("sw: activate (scaffold)");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through only. When this is built out for real, this should become
  // a cache-first strategy for the app-shell (index.html, css/, js/, lang/,
  // pages/, assets/) — audio itself never needs to be cached here since it
  // already lives in IndexedDB and is played from Blob object URLs.
  event.respondWith(fetch(event.request));
});
