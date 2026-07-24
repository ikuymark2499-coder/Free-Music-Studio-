/* ==========================================================================
   future/lyrics.js — Scaffold only (not active yet)
   -----------------------------------------------------------------------
   Plan: add an optional `lyrics` (plain text or LRC-timed) field on the
   song metadata record in storage.js, editable from the same edit-song
   modal used for title/artist/album. Synced LRC playback would tap the
   player's existing "timeupdate" event to highlight the current line —
   no changes needed to the audio pipeline itself.
   ========================================================================== */

export function getLyricsForSong(/* song */) {
  console.info("lyrics: getLyricsForSong() is a scaffold — not implemented yet");
  return null;
}
