/* ==========================================================================
   lyricsPicker.js — UI for manually picking/confirming lyrics + adjusting
   playback offset once a choice is made.
   -----------------------------------------------------------------------
   This module owns no data itself: lyrics.js does the searching/fetching,
   storage.js persists the chosen matchKey -> lyricsId + offset. This file
   is purely presentation:
     - a compact inline "prompt card" shown inside the lyrics panel when a
       song has no saved choice yet ("พบ N เวอร์ชัน — แตะเพื่อเลือก")
     - a full-screen bottom sheet listing every candidate as a tappable row,
       always including a "ไม่ใช้เนื้อเพลง" (no lyrics) option
     - a small offset stepper (-/+ 0.5s, reset) that only ever renders once
       a real choice exists (offset is meaningless before that)
   ========================================================================== */

import { icon, escapeHtml, bindOverlayDismiss, openOverlay, closeOverlay } from "./ui.js";
import { t } from "./language.js";

let sheetEl = null;
let listEl = null;
let titleEl = null;
let closeBtn = null;
let resolveActive = null; // resolves the promise from openLyricsPickerSheet

/** Call once at startup, after index.html's picker sheet markup exists. */
export function initLyricsPicker() {
  sheetEl = document.getElementById("lyrics-picker-sheet");
  listEl = document.getElementById("lyrics-picker-list");
  titleEl = document.getElementById("lyrics-picker-title");
  closeBtn = document.getElementById("lyrics-picker-close");
  if (!sheetEl) return;

  bindOverlayDismiss(sheetEl);
  closeBtn?.addEventListener("click", () => settle(undefined));
}

function settle(value) {
  const resolve = resolveActive;
  resolveActive = null;
  closeOverlay(sheetEl);
  if (resolve) resolve(value);
}

function candidateRowHTML(candidate, index) {
  const durationLabel =
    typeof candidate.duration === "number" ? `${Math.floor(candidate.duration / 60)}:${String(Math.round(candidate.duration % 60)).padStart(2, "0")}` : "";
  const badge = candidate.hasSynced ? t("lyrics_badge_synced") : t("lyrics_badge_plain");

  return `
    <button class="song-item lyrics-candidate-item" style="width:100%;text-align:left" data-index="${index}">
      <div class="song-cover" style="color:var(--color-accent, currentColor)">${icon(candidate.hasSynced ? "music" : "queue")}</div>
      <div class="song-meta">
        <div class="song-title">${escapeHtml(candidate.trackName || t("lyrics_unknown_title"))}</div>
        <div class="song-sub">${escapeHtml(candidate.artistName || t("unknown_artist"))}${durationLabel ? ` · ${durationLabel}` : ""} · ${escapeHtml(badge)}</div>
      </div>
    </button>`;
}

/**
 * Show the full picker sheet. Always resolves — never auto-picks:
 *   - candidate object  -> user tapped that row
 *   - null              -> user tapped "no lyrics for this song"
 *   - undefined         -> user dismissed the sheet without choosing
 */
export function openLyricsPickerSheet(song, candidates) {
  if (!sheetEl || !listEl) return Promise.resolve(undefined);

  if (titleEl) {
    titleEl.textContent = (song && song.title) || t("lyrics_picker_title");
  }

  const rows = candidates.map((c, i) => candidateRowHTML(c, i)).join("");
  const noneRow = `
    <button class="song-item lyrics-candidate-item lyrics-candidate-none" style="width:100%;text-align:left" data-index="none">
      <div class="song-cover">${icon("mute")}</div>
      <div class="song-meta"><div class="song-title">${escapeHtml(t("lyrics_choose_none"))}</div></div>
    </button>`;

  listEl.innerHTML =
    (candidates.length ? rows : `<div class="fp-lyrics-empty">${escapeHtml(t("lyrics_no_candidates"))}</div>`) + noneRow;

  listEl.querySelectorAll(".lyrics-candidate-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.index;
      if (idx === "none") {
        settle(null);
      } else {
        settle(candidates[Number(idx)]);
      }
    });
  });

  openOverlay(sheetEl);

  return new Promise((resolve) => {
    resolveActive = resolve;
  });
}

/**
 * Compact inline card rendered inside the lyrics panel before any choice
 * has been made. Tapping it opens the full picker sheet above.
 */
export function choicePromptHTML(candidateCount) {
  const message = candidateCount > 0 ? t("lyrics_prompt_found", { count: candidateCount }) : t("lyrics_prompt_none_found");
  return `
    <button id="fp-lyrics-choose-btn" class="lyrics-choice-prompt">
      <span class="lyrics-choice-prompt-text">${escapeHtml(message)}</span>
      <span class="lyrics-choice-prompt-cta">${escapeHtml(t("lyrics_choose_cta"))}</span>
    </button>`;
}

/**
 * Small footer control shown under the lyrics panel once a real choice
 * (with actual synced timing) exists. step/reset call back with the new
 * offsetSec; rendering itself never persists anything.
 */
export function offsetControlHTML(offsetSec) {
  const label = offsetSec === 0 ? "0.0s" : `${offsetSec > 0 ? "+" : ""}${offsetSec.toFixed(1)}s`;
  return `
    <div class="lyrics-offset-control" id="fp-lyrics-offset">
      <button class="lyrics-offset-btn" data-step="-0.5" aria-label="${t("lyrics_offset_earlier")}">−0.5s</button>
      <button class="lyrics-offset-btn" data-step="-0.1" aria-label="${t("lyrics_offset_earlier")}">−0.1s</button>
      <span class="lyrics-offset-value">${escapeHtml(label)}</span>
      <button class="lyrics-offset-btn" data-step="0.1" aria-label="${t("lyrics_offset_later")}">+0.1s</button>
      <button class="lyrics-offset-btn" data-step="0.5" aria-label="${t("lyrics_offset_later")}">+0.5s</button>
      <button class="lyrics-offset-reset" data-step="reset" aria-label="${t("lyrics_offset_reset")}">${icon("repeat")}</button>
    </div>`;
}

/** Wire up the +/- buttons rendered by offsetControlHTML above. */
export function bindOffsetControl(container, currentOffsetSec, onChange) {
  const el = container.querySelector("#fp-lyrics-offset");
  if (!el) return;
  el.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = btn.dataset.step;
      const next = step === "reset" ? 0 : Math.round((currentOffsetSec + parseFloat(step)) * 10) / 10;
      onChange(next);
    });
  });
}
