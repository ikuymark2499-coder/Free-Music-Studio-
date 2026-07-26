/* ==========================================================================
   ui-sound.js — Synthesized "UI tap" sounds (Web Audio API only)
   -----------------------------------------------------------------------
   No MP3 / WAV / external audio files are used anywhere in this module.
   Every sound is generated on the fly with oscillators + gain envelopes.

   PUBLIC API
   -----------------------------------------------------------------------
     playUISound(type)        Play a short UI tone. type is one of:
                              "home" | "search" | "library" |
                              "playlist" | "settings" | "favorites"

     setUISoundEnabled(bool)  Turn the whole UI sound system on/off
     getUISoundEnabled()      Read current on/off state
     setUIVolume(0..1)        Set master volume for UI sounds
     getUIVolume()            Read current master volume
     setUIInstrument(name)    Reserved for future sound sets ("piano" only
                              one implemented today, but the hook is here
                              so a "musicbox"/"marimba" set can be added
                              later without touching call sites)

     enableUISound / uiVolume / uiInstrument
                              Exported live bindings that mirror the state
                              above, in case some code prefers to just read
                              them directly (import { uiVolume } from ...).
                              To CHANGE these values from other files, use
                              the setters above — plain module bindings in
                              ES6 cannot be reassigned from the outside.

   WHERE TO CALL THINGS (see bottom of file for a written summary too)
   -----------------------------------------------------------------------
     - Call playUISound("home" | "search" | "library" | "playlist" |
       "settings") from the bottom navigation click handler.
     - Call setUISoundEnabled(checked) from the Settings page toggle.
     - Nothing else needs to change — the AudioContext is created lazily
       and resumed automatically on the user's first tap/click/key press.
   ========================================================================== */

/* ---------------------------------------------------------------------- *
 * Configurable state                                                      *
 * ---------------------------------------------------------------------- */

// Whether UI sounds are played at all. Persisted to localStorage.
export let enableUISound = true;

// Master volume for UI sounds, 0..1 (spec asks for ~20-30%).
export let uiVolume = 0.25;

// Reserved for future sound sets. Only "piano" (soft piano / music-box
// style) is implemented right now, but playUISound() already reads this
// value so a new instrument can be plugged in later without changing any
// call sites elsewhere in the app.
export let uiInstrument = "piano";

const LS_KEY_ENABLED = "uiSound_enabled";
const LS_KEY_VOLUME = "uiSound_volume";

// Load any previously saved preference. Wrapped in try/catch because
// localStorage can throw in private-browsing / restricted contexts.
try {
  const storedEnabled = window.localStorage.getItem(LS_KEY_ENABLED);
  if (storedEnabled !== null) enableUISound = storedEnabled === "1";

  const storedVolume = window.localStorage.getItem(LS_KEY_VOLUME);
  if (storedVolume !== null) {
    const parsed = parseFloat(storedVolume);
    if (!Number.isNaN(parsed)) uiVolume = Math.min(1, Math.max(0, parsed));
  }
} catch (_) {
  /* ignore — fall back to defaults above */
}

/* ---------------------------------------------------------------------- *
 * Note table — Major Pentatonic (C D E G A), per spec                    *
 * ---------------------------------------------------------------------- */

const NOTE_FREQ = {
  home: 523.25, // C5
  search: 587.33, // D5
  library: 659.25, // E5
  playlist: 783.99, // G5
  settings: 880.0, // A5
  // "favorites" is not part of the original 5-note spec, but this project's
  // bottom nav has a 5th tab (Favorites) with no assigned note. Reusing the
  // C5 ("home") tone keeps every tap on-scale without inventing a 6th note.
  favorites: 523.25, // C5
};

/* ---------------------------------------------------------------------- *
 * AudioContext — one single shared instance, created lazily              *
 * ---------------------------------------------------------------------- */

let audioCtx = null;
let audioApiSupported = true; // flips to false permanently if unsupported

function getAudioContext() {
  if (!audioApiSupported) return null;
  if (audioCtx) return audioCtx;

  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      audioApiSupported = false;
      return null;
    }
    audioCtx = new AudioContextCtor();
    return audioCtx;
  } catch (_) {
    // Some browsers can still throw (e.g. hitting a context limit).
    audioApiSupported = false;
    return null;
  }
}

// Browsers require a user gesture before audio can actually play.
// We listen once for the first tap/click/key press anywhere on the page
// and resume the shared AudioContext at that point. This runs completely
// silently and never throws, even on browsers without Web Audio support.
function resumeOnFirstGesture() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  } catch (_) {
    /* no-op — never let audio break the app */
  }
}

["pointerdown", "touchstart", "click", "keydown"].forEach((eventName) => {
  document.addEventListener(eventName, resumeOnFirstGesture, {
    once: true,
    passive: true,
  });
});

/* ---------------------------------------------------------------------- *
 * Sound generation                                                       *
 * ---------------------------------------------------------------------- */

/**
 * Play one short, soft "UI tap" tone for the given tab type.
 * Safe to call on every click — it silently does nothing if UI sounds are
 * disabled, the type is unknown, or Web Audio isn't supported.
 *
 * @param {"home"|"search"|"library"|"playlist"|"settings"|"favorites"} type
 */
export function playUISound(type) {
  try {
    if (!enableUISound) return;

    const freq = NOTE_FREQ[type];
    if (!freq) return; // unknown type -> ignore silently, never throw

    const ctx = getAudioContext();
    if (!ctx) return; // Web Audio not supported -> silently do nothing

    if (ctx.state === "suspended") {
      // Belt-and-braces resume in case the first-gesture listener hasn't
      // fired yet on this particular browser.
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const attackTime = 0.008; // ~8ms soft attack (avoids clicks/pops)
    const duration = 0.09; // ~90ms total, within the 70-120ms target
    const stopTime = now + duration;

    const peak = Math.min(1, Math.max(0, uiVolume));

    // Master gain for this single note instance.
    // Unity gain here — the attack/fade envelope is already fully shaped by
    // bodyGain and shimmerGain below, this node just sums them cleanly.
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(1, now);
    masterGain.connect(ctx.destination);

    // --- Fundamental tone -------------------------------------------------
    // Triangle wave: rounder and softer than a square/sine "beep", closer
    // to a gentle piano/music-box body.
    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = "triangle";
    bodyOsc.frequency.setValueAtTime(freq, now);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.linearRampToValueAtTime(peak * 0.8, now + attackTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    // --- Octave shimmer -----------------------------------------------
    // A quiet sine one octave up gives the tone its "music box" sparkle
    // without making it sound like a synth beep.
    const shimmerOsc = ctx.createOscillator();
    shimmerOsc.type = "sine";
    shimmerOsc.frequency.setValueAtTime(freq * 2, now);

    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(0.0001, now);
    shimmerGain.gain.linearRampToValueAtTime(peak * 0.25, now + attackTime);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    bodyOsc.connect(bodyGain).connect(masterGain);
    shimmerOsc.connect(shimmerGain).connect(masterGain);

    const hardStop = stopTime + 0.02; // small tail so the ramp finishes cleanly
    bodyOsc.start(now);
    shimmerOsc.start(now);
    bodyOsc.stop(hardStop);
    shimmerOsc.stop(hardStop);

    // Clean up nodes once the sound has finished playing.
    shimmerOsc.onended = () => {
      try {
        bodyOsc.disconnect();
        bodyGain.disconnect();
        shimmerOsc.disconnect();
        shimmerGain.disconnect();
        masterGain.disconnect();
      } catch (_) {
        /* nodes may already be disconnected — ignore */
      }
    };
  } catch (_) {
    // Absolute safety net: a UI sound must never break the app.
  }
}

/* ---------------------------------------------------------------------- *
 * Settings API (used by the Settings page toggle)                        *
 * ---------------------------------------------------------------------- */

export function setUISoundEnabled(value) {
  enableUISound = !!value;
  try {
    window.localStorage.setItem(LS_KEY_ENABLED, enableUISound ? "1" : "0");
  } catch (_) {
    /* ignore persistence errors */
  }
}

export function getUISoundEnabled() {
  return enableUISound;
}

export function setUIVolume(value) {
  const numeric = Number(value);
  uiVolume = Number.isNaN(numeric) ? uiVolume : Math.min(1, Math.max(0, numeric));
  try {
    window.localStorage.setItem(LS_KEY_VOLUME, String(uiVolume));
  } catch (_) {
    /* ignore persistence errors */
  }
}

export function getUIVolume() {
  return uiVolume;
}

export function setUIInstrument(name) {
  // Reserved for future sound sets — currently only "piano" is implemented.
  uiInstrument = name;
}

/**
 * Read-only diagnostic snapshot — not part of the core feature, just here
 * to make "I don't hear anything" reports easy to debug. Shows whether the
 * shared AudioContext actually exists and what state it's in.
 */
export function getUISoundDebugInfo() {
  return {
    webAudioSupported: audioApiSupported,
    contextExists: !!audioCtx,
    contextState: audioCtx ? audioCtx.state : "(not created yet)",
    sampleRate: audioCtx ? audioCtx.sampleRate : null,
    enabled: enableUISound,
    volume: uiVolume,
  };
}

/* ==========================================================================
   INTEGRATION NOTES
   -----------------------------------------------------------------------
   1) js/app.js — bottom navigation click handler:
        import { playUISound } from "./ui-sound.js";
        navButtons.forEach((btn) => {
          btn.addEventListener("click", () => {
            playUISound(btn.dataset.route); // route names already match
            navigate(btn.dataset.route);     // "search"/"library"/"playlist"/
          });                                 // "settings"/"favorites"
        });

   2) pages/settings.html + js/settings.js — on/off toggle:
        <input type="checkbox" id="toggle-uisound" />
        ...
        import { setUISoundEnabled, getUISoundEnabled } from "./ui-sound.js";
        uiSoundToggle.checked = getUISoundEnabled();
        uiSoundToggle.addEventListener("change", () => {
          setUISoundEnabled(uiSoundToggle.checked);
        });

   No other file needs to change. The AudioContext is created lazily on the
   first call to playUISound() / first user gesture, so importing this file
   has zero side effects on page load.
   ========================================================================== */
