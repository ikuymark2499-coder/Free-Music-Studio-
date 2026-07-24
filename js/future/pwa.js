/* ==========================================================================
   future/pwa.js — Scaffold only (not active yet)
   -----------------------------------------------------------------------
   Covers spec items: PWA, Background Audio, Notification.

   manifest.json already exists and is linked from index.html, so the app
   is installable today. What's intentionally NOT done yet:

   1. Service worker (see /sw.js at the project root — created but never
      registered). When ready:
        - registerServiceWorker() below should be called from app.js
          bootstrap, guarded by `if ("serviceWorker" in navigator)`.
        - /sw.js should cache the app shell (index.html, css/, js/, lang/,
          pages/, assets/) with a cache-first strategy, and leave audio
          Blob playback alone (audio never goes through the network — it's
          already local via IndexedDB — so the service worker doesn't need
          to intercept those requests at all).

   2. Background audio: <audio> already keeps playing when the tab is
      backgrounded on most browsers/OSes as long as the tab itself isn't
      killed. True OS-level background playback (continuing after the app
      is swiped away, showing lock-screen controls) needs:
        - Media Session API wired up (see future/mediaSession.js)
        - On mobile, wrapping this as a PWA with "display: standalone" and,
          on iOS, testing against Safari's stricter background-audio rules.

   3. Notifications: would need the Notification permission requested from
      a user gesture, then something worth notifying about (e.g. "playlist
      import finished"). Nothing in the current feature set needs it yet.
   ========================================================================== */

export function registerServiceWorker() {
  // Intentionally not called yet. When Phase 5 is greenlit:
  //
  //   if ("serviceWorker" in navigator) {
  //     navigator.serviceWorker.register("./sw.js").catch((err) =>
  //       console.error("pwa: service worker registration failed", err)
  //     );
  //   }
  console.info("pwa: registerServiceWorker() is a scaffold — not wired up yet");
}
