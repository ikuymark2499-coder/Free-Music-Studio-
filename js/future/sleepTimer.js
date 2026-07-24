/* ==========================================================================
   future/sleepTimer.js — Scaffold only (not active yet)
   -----------------------------------------------------------------------
   Plan: a simple setTimeout wrapping player.pause(), with an optional
   "fade out over the last N seconds" using player.setVolume() on an
   interval before pausing, then restoring the saved volume afterwards.
   No audio-pipeline changes needed — purely a timer around existing
   player controls.
   ========================================================================== */

export function startSleepTimer(/* minutes */) {
  console.info("sleepTimer: startSleepTimer() is a scaffold — not implemented yet");
  return null;
}

export function cancelSleepTimer(/* handle */) {
  console.info("sleepTimer: cancelSleepTimer() is a scaffold — not implemented yet");
}
