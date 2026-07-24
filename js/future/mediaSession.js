/* ==========================================================================
   future/mediaSession.js — Scaffold only (not active yet)
   -----------------------------------------------------------------------
   Plan for when this gets built: call initMediaSession(player) once from
   app.js bootstrap. It would:

     1. Set navigator.mediaSession.metadata on every "songchange" event,
        using song.title / song.artist / song.album, and song.coverUrl as
        an MediaImage (src, sizes, type) for lock-screen artwork.
     2. Wire action handlers: play, pause, previoustrack, nexttrack,
        seekto — each just forwarding to the existing player.play() /
        pause() / previous() / next() / seek() methods, so no new playback
        logic is needed, only glue code.
     3. Update navigator.mediaSession.playbackState on "statechange".

   Left un-implemented for now because it has no effect outside a real
   mobile browser / installed PWA context, and the spec marked it
   "future ready" rather than required for this pass.
   ========================================================================== */

export function initMediaSession(/* player */) {
  if (!("mediaSession" in navigator)) return;
  // Intentionally a no-op scaffold — see plan above.
  console.info("mediaSession: initMediaSession() is a scaffold — not wired up yet");
}
