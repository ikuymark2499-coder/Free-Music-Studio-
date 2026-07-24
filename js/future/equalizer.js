/* ==========================================================================
   future/equalizer.js — Scaffold only (not active yet)
   -----------------------------------------------------------------------
   Plan: build a Web Audio API graph — AudioContext -> MediaElementSource
   (wrapping player.audio) -> a bank of BiquadFilterNode ("peaking" type at
   fixed bands, e.g. 60/230/910/3600/14000 Hz) -> AudioContext.destination.
   Gain per band would be a simple settings.eq array of dB values, stored
   alongside theme/language in storage.js's settings record.

   Left un-implemented for now — the spec marked this "future ready" only.
   ========================================================================== */

export function initEqualizer(/* audioElement */) {
  console.info("equalizer: initEqualizer() is a scaffold — not implemented yet");
  return null;
}
