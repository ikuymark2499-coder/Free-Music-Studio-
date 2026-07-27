/* ==========================================================================
   player.js — Core playback engine
   -----------------------------------------------------------------------
   Two playback backends behind one public API:
     - source: "local"   -> plays through the existing <audio> element
     - source: "youtube" -> plays through a hidden (1x1, off-screen)
                             YouTube IFrame Player, loaded lazily on first use

   app.js / ui components never need to know which backend is active —
   they call play()/pause()/seek()/setVolume()/next()/previous() and listen
   for the same events ("songchange", "statechange", "timeupdate", etc.)
   regardless of source.
   ========================================================================== */

import { getAudioObjectURL, getPlayerPrefs, savePlayerPrefs, getQueueState, saveQueueState } from "./storage.js";
import { showToast } from "./ui.js";
import { t } from "./language.js";

const REPEAT_MODES = ["off", "all", "one"];
const YT_CONTAINER_ID = "yt-hidden-player";

class PlayerEngine extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = "metadata";

    this.queueIds = []; // ordered list of song ids currently playing through
    this.shuffledIds = null; // shuffled view of queueIds when shuffle is on
    this.currentIndex = -1;
    this.currentSong = null;
    this.songLookup = () => null; // injected by app.js: (id) => song

    // --- YouTube (hidden IFrame player) state ---
    this.ytPlayer = null;
    this._ytApiPromise = null;
    this._ytPlayerInitPromise = null;
    this._ytPlayerReady = false;
    this._ytIsPlaying = false;
    this._ytCurrentTime = 0;
    this._ytDuration = 0;
    this._ytPollHandle = null;
    this._isLoading = false;

    const prefs = getPlayerPrefs();
    this.shuffleOn = prefs.shuffleOn;
    this.repeatMode = REPEAT_MODES.includes(prefs.repeatMode) ? prefs.repeatMode : "off";
    this.audio.volume = typeof prefs.volume === "number" ? Math.max(0, Math.min(1, prefs.volume)) : 1;

    this._lastPersistAt = 0;
    this._bindAudioEvents();
    this._bindLifecyclePersistence();
  }

  /* ---------------- Source-aware helpers ---------------- */

  get isYouTubeActive() {
    return !!(this.currentSong && this.currentSong.source === "youtube");
  }
  

  isPlaying() {
    return this.isYouTubeActive ? this._ytIsPlaying : !this.audio.paused;
  }
  
  
  isLoading() {
     return this._isLoading;
  }


  getCurrentTime() {
    return this.isYouTubeActive ? this._ytCurrentTime : this.audio.currentTime;
  }

  getDuration() {
    return this.isYouTubeActive ? this._ytDuration : this.audio.duration || 0;
  }

  _bindLifecyclePersistence() {
    // Best-effort: flush the current position whenever the tab is hidden,
    // paused, or about to close, so a refresh can resume where it left off.
    this.audio.addEventListener("pause", () => this._persistQueueState());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this._persistQueueState();
    });
    window.addEventListener("beforeunload", () => this._persistQueueState());
  }

  _persistQueueState() {
    if (!this.currentSong) return;
    saveQueueState({
      ids: this.queueIds,
      currentSongId: this.currentSong.id,
      positionSeconds: this.getCurrentTime(),
      shuffleOn: this.shuffleOn,
    });
  }

  /**
   * Called once at bootstrap (after setSongLookup) to restore the last
   * playing song, queue order, and playback position. Never auto-plays —
   * browsers block that anyway, and the user should decide to resume.
   */
  async restoreQueueState() {
    try {
      const state = getQueueState();
      if (!state || !Array.isArray(state.ids) || state.ids.length === 0 || !state.currentSongId) return;

      this.queueIds = [...state.ids];
      this.shuffleOn = !!state.shuffleOn;
      this.shuffledIds = this.shuffleOn ? this._shuffleArray(this.queueIds) : null;

      const idx = this.activeList.indexOf(state.currentSongId);
      if (idx === -1) return;
      const song = this.songLookup(state.currentSongId);
      if (!song) return;

      this.currentIndex = idx;
      const resumePosition = state.positionSeconds || 0;

      if (song.source === "youtube") {
        try {
          await this._ensureYtPlayerReady();
          this.currentSong = song;
          this._ytDuration = 0;
          this._ytCurrentTime = resumePosition;
          // Cue (not play) so restoring a session never auto-plays.
          this.ytPlayer.cueVideoById({ videoId: song.videoId, startSeconds: resumePosition });
        } catch (err) {
          console.error("player: failed to restore YouTube session", err);
          return;
        }
      } else {
        const audioUrl = await getAudioObjectURL(state.currentSongId);
        if (!audioUrl) return;
        this.currentSong = song;
        this.audio.src = audioUrl;
        if (resumePosition > 0) {
          this.audio.addEventListener(
            "loadedmetadata",
            () => {
              this.audio.currentTime = Math.min(resumePosition, this.audio.duration || resumePosition);
            },
            { once: true }
          );
        }
      }
      this._emit("songchange", { song });
    } catch (err) {
      console.error("player: failed to restore last session", err);
    }
  }

  _persistPrefs() {
    savePlayerPrefs({ volume: this.audio.volume, repeatMode: this.repeatMode, shuffleOn: this.shuffleOn });
  }

  setSongLookup(lookupFn) {
    this.songLookup = lookupFn;
  }

  _bindAudioEvents() {
    this.audio.addEventListener("timeupdate", () => {
      if (this.isYouTubeActive) return; // YT emits its own timeupdate via polling
      this._emit("timeupdate", {
        currentTime: this.audio.currentTime,
        duration: this.audio.duration || 0,
      });
      this._maybePersistThrottled();
    });
    this.audio.addEventListener("play", () => {
      if (!this.isYouTubeActive) this._emit("statechange", { playing: true });
    });
    this.audio.addEventListener("pause", () => {
      if (!this.isYouTubeActive) this._emit("statechange", { playing: false });
    });
    this.audio.addEventListener("ended", () => {
      if (!this.isYouTubeActive) this._handleEnded();
    });
    this.audio.addEventListener("loadedmetadata", () => {
      if (!this.isYouTubeActive) this._emit("metadata", { duration: this.audio.duration || 0 });
    });
    this.audio.addEventListener("volumechange", () => {
      this._emit("volumechange", { volume: this.audio.volume, muted: this.audio.muted });
    });
  }

  _maybePersistThrottled() {
    const now = Date.now();
    if (now - this._lastPersistAt > 5000) {
      this._lastPersistAt = now;
      this._persistQueueState();
    }
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /* ---------------- YouTube IFrame Player (hidden, 0x0) ---------------- */

  _loadYouTubeIframeAPI() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (this._ytApiPromise) return this._ytApiPromise;
    this._ytApiPromise = new Promise((resolve, reject) => {
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousCallback === "function") previousCallback();
        resolve();
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Failed to load the YouTube IFrame API"));
      document.head.appendChild(script);
    });
    return this._ytApiPromise;
  }

  _ensureYtContainer() {
    let container = document.getElementById(YT_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = YT_CONTAINER_ID;
      // Kept at 1x1 and moved off-screen (never 0x0 / display:none / visibility:hidden).
      // Some browsers treat a truly zero-size or hidden video element as
      // "not actually playing" and throttle/stop its audio once the tab is
      // backgrounded or the screen locks. A 1x1 box that's merely
      // positioned off the visible viewport keeps the element "on screen"
      // as far as that logic is concerned, so background/lock-screen
      // playback (via Media Session) keeps working.
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "-9999px";
      container.style.width = "1px";
      container.style.height = "1px";
      container.style.overflow = "hidden";
      container.style.pointerEvents = "none";
      document.body.appendChild(container);
    }
    return container;
  }

  async _ensureYtPlayerReady() {
    await this._loadYouTubeIframeAPI();
    if (this.ytPlayer && this._ytPlayerReady) return;
    if (this._ytPlayerInitPromise) return this._ytPlayerInitPromise;

    this._ensureYtContainer();
    this._ytPlayerInitPromise = new Promise((resolve, reject) => {
      try {
        this.ytPlayer = new window.YT.Player(YT_CONTAINER_ID, {
          width: "1",
          height: "1",
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => {
              this._ytPlayerReady = true;
              try {
                this.ytPlayer.setVolume(Math.round(this.audio.volume * 100));
                if (this.audio.muted) this.ytPlayer.mute();
              } catch (err) {
                /* non-fatal */
              }
              resolve();
            },
            onStateChange: (event) => this._handleYtStateChange(event),
            onError: (event) => this._handleYtError(event),
          },
        });
      } catch (err) {
        reject(err);
      }
    });
    return this._ytPlayerInitPromise;
  }

  _handleYtStateChange(event) {
    const State = window.YT.PlayerState;
    if (event.data === State.PLAYING) {
      this._ytIsPlaying = true;
      this._ytDuration = this.ytPlayer.getDuration() || 0;
      this._emit("statechange", { playing: true });
      this._emit("metadata", { duration: this._ytDuration });
      this._startYtPolling();
    } else if (event.data === State.PAUSED) {
      this._ytIsPlaying = false;
      this._emit("statechange", { playing: false });
      this._persistQueueState();
    } else if (event.data === State.ENDED) {
      this._ytIsPlaying = false;
      this._emit("statechange", { playing: false });
      this._handleEnded();
    } else if (event.data === State.BUFFERING) {
      this._ytDuration = this.ytPlayer.getDuration() || this._ytDuration;
    }
  }

  _handleYtError(event) {
  console.error("player: YouTube playback error", event.data);
  this._isLoading = false;
  this._emit("loadend", { song: this.currentSong });
  showToast(t("toast_online_error"), "error");
  this._emit("loaderror", { song: this.currentSong, youtubeErrorCode: event.data });
  this.next();
}

  _startYtPolling() {
    this._stopYtPolling();
    this._ytPollHandle = setInterval(() => {
      if (!this.ytPlayer || typeof this.ytPlayer.getCurrentTime !== "function") return;
      this._ytCurrentTime = this.ytPlayer.getCurrentTime() || 0;
      this._emit("timeupdate", { currentTime: this._ytCurrentTime, duration: this._ytDuration });
      this._maybePersistThrottled();
    }, 500);
  }

  _stopYtPolling() {
    if (this._ytPollHandle) {
      clearInterval(this._ytPollHandle);
      this._ytPollHandle = null;
    }
  }

  _stopYouTube() {
    this._stopYtPolling();
    if (this.ytPlayer && this._ytPlayerReady) {
      try {
        this.ytPlayer.stopVideo();
      } catch (err) {
        /* non-fatal */
      }
    }
    this._ytIsPlaying = false;
  }

  /* ---------------- Queue management ---------------- */

  /** Load a fresh ordered list of song ids and start playing at startIndex. */
  loadQueue(songIds, startIndex = 0) {
    this.queueIds = [...songIds];
    this.shuffledIds = this.shuffleOn ? this._shuffleArray(this.queueIds) : null;
    const playIndex = this.shuffleOn
      ? this.shuffledIds.indexOf(this.queueIds[startIndex])
      : startIndex;
    this._playAtIndex(playIndex < 0 ? 0 : playIndex);
  }

  get activeList() {
    return this.shuffleOn && this.shuffledIds ? this.shuffledIds : this.queueIds;
  }

  async _playAtIndex(index) {
    const list = this.activeList;
    if (index < 0 || index >= list.length) return;
    this.currentIndex = index;
    const songId = list[index];
    const song = this.songLookup(songId);
    if (!song) return;

    if (song.source === "youtube") {
      await this._playYouTubeSong(song);
    } else {
      await this._playLocalSong(song);
    }
  }

  async _playLocalSong(song) {
  const loadToken = (this._loadToken = (this._loadToken || 0) + 1);
  this._stopYouTube();
  
  this._isLoading = true;
  this._emit("loadstart", { song });

  let audioUrl;
  try {
    audioUrl = await getAudioObjectURL(song.id);
  } catch (err) {
    console.error("player: failed to load audio blob", song.id, err);
  }
  if (loadToken !== this._loadToken) {
    this._isLoading = false;
    this._emit("loadend", { song });
    return;
  }
  if (!audioUrl) {
    this._isLoading = false;
    this._emit("loadend", { song });
    this._emit("loaderror", { song });
    return;
  }

  this.currentSong = song;
  this.audio.src = audioUrl;
  
  const onLoaded = () => {
    this._isLoading = false;
    this._emit("loadend", { song });
    this.audio.removeEventListener("loadedmetadata", onLoaded);
  };
  this.audio.addEventListener("loadedmetadata", onLoaded);

  const onError = () => {
    this._isLoading = false;
    this._emit("loadend", { song });
    this._emit("loaderror", { song });
    this.audio.removeEventListener("error", onError);
  };
  this.audio.addEventListener("error", onError);

  this.audio.play().catch(() => {});
  this._emit("songchange", { song });
  this._persistQueueState();
}

  async _playYouTubeSong(song) {
  const loadToken = (this._loadToken = (this._loadToken || 0) + 1);
  this.audio.pause();

  this._isLoading = true;
  this._emit("loadstart", { song });

  try {
    await this._ensureYtPlayerReady();
  } catch (err) {
    console.error("player: YouTube player failed to initialize", err);
    this._isLoading = false;
    this._emit("loadend", { song });
    showToast(t("toast_online_error"), "error");
    this._emit("loaderror", { song });
    return;
  }
  if (loadToken !== this._loadToken) {
    this._isLoading = false;
    this._emit("loadend", { song });
    return;
  }

  this.currentSong = song;
  this._ytDuration = 0;
  this._ytCurrentTime = 0;
  try {
    this.ytPlayer.loadVideoById(song.videoId);
  } catch (err) {
    console.error("player: failed to load YouTube video", song.videoId, err);
    this._isLoading = false;
    this._emit("loadend", { song });
    showToast(t("toast_online_error"), "error");
    this._emit("loaderror", { song });
    return;
  }

  const onStateChange = (event) => {
    const State = window.YT.PlayerState;
    if (event.data === State.PLAYING || event.data === State.BUFFERING) {
      this._isLoading = false;
      this._emit("loadend", { song });
      this.ytPlayer.removeEventListener("onStateChange", onStateChange);
    }
  };
  this.ytPlayer.addEventListener("onStateChange", onStateChange);

  this._emit("songchange", { song });
  this._persistQueueState();
}

  playSongInContext(songId, contextIds) {
    const startIndex = contextIds.indexOf(songId);
    this.loadQueue(contextIds, startIndex < 0 ? 0 : startIndex);
  }

  /* ---------------- Transport controls ---------------- */

  play() {
    if (this.isYouTubeActive) {
      if (this.ytPlayer && this._ytPlayerReady) this.ytPlayer.playVideo();
      return;
    }
    this.audio.play().catch(() => {});
  }

  pause() {
    if (this.isYouTubeActive) {
      if (this.ytPlayer && this._ytPlayerReady) this.ytPlayer.pauseVideo();
      return;
    }
    this.audio.pause();
  }

  togglePlayPause() {
    if (this.isPlaying()) this.pause();
    else this.play();
  }

  stop() {
    if (this.isYouTubeActive) {
      this._stopYouTube();
      this._emit("statechange", { playing: false });
      return;
    }
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  next() {
    if (this.activeList.length === 0) return;
    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.activeList.length) {
      if (this.repeatMode === "all") this._playAtIndex(0);
      else this.stop();
    } else {
      this._playAtIndex(nextIndex);
    }
  }

  previous() {
    if (this.activeList.length === 0) return;
    // Restart current track if we're more than 3s in, like most players
    if (this.getCurrentTime() > 3) {
      this.seek(0);
      return;
    }
    const prevIndex = this.currentIndex - 1;
    this._playAtIndex(prevIndex < 0 ? this.activeList.length - 1 : prevIndex);
  }

  seek(seconds) {
    if (!isFinite(seconds)) return;
    if (this.isYouTubeActive) {
      if (this.ytPlayer && this._ytPlayerReady) this.ytPlayer.seekTo(Math.max(0, seconds), true);
      return;
    }
    this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration || 0));
  }

  seekByRatio(ratio) {
    const duration = this.getDuration();
    if (!duration) return;
    this.seek(ratio * duration);
  }

  setVolume(volume01) {
    const clamped = Math.max(0, Math.min(1, volume01));
    this.audio.volume = clamped; // kept in sync even while YT is active, for a smooth switch back
    if (this.ytPlayer && this._ytPlayerReady) {
      this.ytPlayer.setVolume(Math.round(clamped * 100));
      if (clamped > 0) this.ytPlayer.unMute();
    }
    if (clamped > 0) this.audio.muted = false;
    this._persistPrefs();
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    if (this.ytPlayer && this._ytPlayerReady) {
      if (this.audio.muted) this.ytPlayer.mute();
      else this.ytPlayer.unMute();
    }
  }

  toggleShuffle() {
    this.shuffleOn = !this.shuffleOn;
    if (this.currentSong) {
      const currentId = this.currentSong.id;
      this.shuffledIds = this.shuffleOn ? this._shuffleArray(this.queueIds) : null;
      this.currentIndex = this.activeList.indexOf(currentId);
    }
    this._emit("shufflechange", { shuffleOn: this.shuffleOn });
    this._persistPrefs();
  }

  cycleRepeat() {
    const idx = REPEAT_MODES.indexOf(this.repeatMode);
    this.repeatMode = REPEAT_MODES[(idx + 1) % REPEAT_MODES.length];
    this._emit("repeatchange", { repeatMode: this.repeatMode });
    this._persistPrefs();
  }

  _handleEnded() {
    if (this.repeatMode === "one") {
      this.seek(0);
      this.play();
      return;
    }
    this.next();
  }

  _shuffleArray(source) {
    const arr = [...source];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ---------------- Queue view for the UI ---------------- */
  getUpcoming() {
    const list = this.activeList;
    return list.slice(this.currentIndex + 1).map((id) => this.songLookup(id)).filter(Boolean);
  }

  removeFromUpcoming(songId) {
    const upcomingStart = this.currentIndex + 1;
    const activeIdx = this.activeList.indexOf(songId, upcomingStart);
    if (activeIdx === -1) return;
    this.activeList.splice(activeIdx, 1);

    if (this.shuffleOn) {
      // Keep the canonical (unshuffled) order in sync too, so switching
      // shuffle off later doesn't bring the removed song back.
      const canonicalIdx = this.queueIds.indexOf(songId);
      if (canonicalIdx !== -1) this.queueIds.splice(canonicalIdx, 1);
    } else {
      this.queueIds = this.activeList;
    }
    this._persistQueueState();
  }
}

export const player = new PlayerEngine();
export { REPEAT_MODES };
