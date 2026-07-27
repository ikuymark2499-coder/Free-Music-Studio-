/* ==========================================================================
   mediaSession.js — Lock-screen / notification playback controls.
   -----------------------------------------------------------------------
   Wires the browser's Media Session API to the existing PlayerEngine
   (js/player.js) so mobile OSes show a notification/lock-screen card with
   title, artist, artwork and play/pause/next/previous controls, and so
   those controls actually drive playback.

   This module doesn't create any new state — it just mirrors events the
   player engine already emits ("songchange", "statechange", "timeupdate",
   "metadata") into navigator.mediaSession, and forwards the OS-level
   action callbacks back into the player's existing public methods.
   ========================================================================== */

const DEFAULT_ARTWORK_SRC = "assets/images/default-cover.svg";

function isSupported() {
  return "mediaSession" in navigator;
}

/** Build the artwork array MediaMetadata expects. Falls back to the app's
 *  default cover if the song has no thumbnail/cover art yet (e.g. local
 *  files whose cover blob hasn't resolved, or the plain SVG fallback). */
function buildArtwork(song) {
  const src = song?.coverUrl || song?.thumbnail || DEFAULT_ARTWORK_SRC;
  return [
    { src, sizes: "96x96", type: guessType(src) },
    { src, sizes: "192x192", type: guessType(src) },
    { src, sizes: "512x512", type: guessType(src) },
  ];
}

function guessType(src) {
  if (src.endsWith(".svg")) return "image/svg+xml";
  if (src.endsWith(".png")) return "image/png";
  if (src.startsWith("blob:")) return "image/jpeg"; // extracted cover blobs are re-encoded as jpeg/png; jpeg is a safe generic default
  return "image/jpeg";
}

/**
 * Call once at bootstrap. `player` is the PlayerEngine singleton exported
 * from player.js. Registers the action handlers once and starts listening
 * for the events that should update the lock-screen card.
 */
export function initMediaSession(player) {
  if (!isSupported()) return;

  // --- Action handlers: OS/notification controls drive the real player ---
  const handlers = {
    play: () => player.play(),
    pause: () => player.pause(),
    previoustrack: () => player.previous(),
    nexttrack: () => player.next(),
    seekto: (details) => {
      if (details.seekTime != null) player.seek(details.seekTime);
    },
    stop: () => player.stop(),
  };

  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (err) {
      // Some actions (e.g. "stop", "seekto") aren't supported on every
      // browser/OS combo — safe to ignore, the rest still work.
    }
  }

  // --- Metadata: update whenever the current song changes ---
  player.addEventListener("songchange", () => {
    const song = player.currentSong;
    if (!song) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || "",
      artist: song.artist || "",
      artwork: buildArtwork(song),
    });
  });

  // --- Playback state: keep the lock-screen play/pause icon in sync ---
  player.addEventListener("statechange", ({ detail }) => {
    navigator.mediaSession.playbackState = detail.playing ? "playing" : "paused";
  });

  // --- Position state: lets supporting OSes show a scrubber/progress bar ---
  player.addEventListener("timeupdate", ({ detail }) => {
    updatePositionState(detail.duration, detail.currentTime);
  });
  player.addEventListener("metadata", ({ detail }) => {
    updatePositionState(detail.duration, player.getCurrentTime());
  });
}

function updatePositionState(duration, position) {
  if (!isSupported() || typeof navigator.mediaSession.setPositionState !== "function") return;
  if (!isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: 1,
    });
  } catch (err) {
    // Can throw if duration/position momentarily disagree during a track
    // switch — safe to ignore, the next tick corrects it.
  }
}
