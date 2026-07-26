/* ==========================================================================
   ui.js — shared UI helpers: icons, toast, modal/sheet control, formatting
   ========================================================================== */

/* ---------- Inline icon set (no external icon files needed) ---------- */
export const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5l10 7-10 7V5zM18 5h2v14h-2z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 5L8 12l10 7V5zM6 5h2v14H6z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3l4 4-4 4v-3h-3.6l-2-2H17V3zM3 6h4.4l7.6 9.5L17 18h4l-4-4v3h-3.5L6 8.5H3V6zM17 18v3l4-4-4-4v3h-2.5l-1.2-1.5-1.3 1.6L14 18h3z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
  repeatOne: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-6-6h1v4h-1v-3h-1v-1z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.2-4.6-9.7-9C.6 9 1.7 5.7 4.7 4.7c1.9-.6 3.9 0 5.3 1.6 1.4-1.6 3.4-2.2 5.3-1.6 3 1 4.1 4.3 2.4 7.3-2.5 4.4-9.7 9-9.7 9z"/></svg>',
  heartOutline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.2-4.6-9.7-9C.6 9 1.7 5.7 4.7 4.7c1.9-.6 3.9 0 5.3 1.6 1.4-1.6 3.4-2.2 5.3-1.6 3 1 4.1 4.3 2.4 7.3-2.5 4.4-9.7 9-9.7 9z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4zm11.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4zm13.5 3l2.5 2.5-1.4 1.4L16 13.9l-2.5 2.5-1.4-1.4L14.6 12l-2.5-2.5 1.4-1.4L16 10.6l2.5-2.5 1.4 1.4L17.4 12z"/></svg>',
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h10M18 15v6m3-3h-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  playlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h11M4 12h11M4 18h6M17 9v9a2.5 2.5 0 11-2-2.45V9h2z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.6 1z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  drag: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  spinner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinner"><circle cx="12" cy="12" r="10" stroke-dasharray="30 10" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>',
};

export function icon(name) {
  return ICONS[name] || "";
}

/* ---------- Toast ---------- */
export function showToast(message, type = "success") {
  const host = document.getElementById("toast-host");
  if (!host) return;
  const toastEl = document.createElement("div");
  toastEl.className = `toast${type === "error" ? " is-error" : ""}`;
  toastEl.textContent = message;
  host.appendChild(toastEl);
  setTimeout(() => {
    toastEl.style.opacity = "0";
    toastEl.style.transition = "opacity 200ms ease";
    setTimeout(() => toastEl.remove(), 220);
  }, 2200);
}

/* ---------- Formatting ---------- */
export function formatTime(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

/* ---------- Album art <img> markup, shared by every page that lists songs ----------
   The img always gets the same "cover-img" class; sizing/cropping comes from
   the parent container (.song-cover / .mini-cover / .cover-art / .playlist-cover)
   via a shared descendant rule in css/style.css. */
export function coverImgHTML(song) {
  const src = (song && song.coverUrl) || "assets/images/default-cover.svg";
  const alt = escapeHtml((song && song.title) || "");
  return `<img src="${src}" alt="${alt}" class="cover-img" loading="lazy" draggable="false" onerror="this.onerror=null;this.src='assets/images/default-cover.svg';" />`;
}

/* ---------- Modal / sheet control ---------- */
export function openOverlay(el) {
  if (!el) return;
  el.classList.add("is-visible");
}
export function closeOverlay(el) {
  if (!el) return;
  el.classList.remove("is-visible");
}

/* Close overlay when clicking its backdrop directly */
export function bindOverlayDismiss(overlayEl) {
  overlayEl.addEventListener("click", (event) => {
    if (event.target === overlayEl) closeOverlay(overlayEl);
  });
}

/* ---------- Ripple micro-interaction ---------- */
export function attachRipple(el) {
  el.classList.add("ripple-surface");
  el.addEventListener("pointerdown", (event) => {
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const dot = document.createElement("span");
    dot.className = "ripple-dot";
    dot.style.width = dot.style.height = `${size}px`;
    dot.style.left = `${event.clientX - rect.left - size / 2}px`;
    dot.style.top = `${event.clientY - rect.top - size / 2}px`;
    el.appendChild(dot);
    setTimeout(() => dot.remove(), 600);
  });
}

/* ---------- Simple confirm dialog built on modal styles ---------- */
export function confirmAction(message) {
  return window.confirm(message);
}
