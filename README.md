# Music Player (Vanilla HTML/CSS/JS)

Mobile-first web music player. No frameworks, no CDN, no external
libraries — plain HTML, CSS and JavaScript (ES modules).

## Run it

This app loads pages and language files with `fetch()`, so it must be
served over HTTP (not opened directly as a `file://` path). From the
project folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` on your phone or desktop browser.

## Structure

- `index.html` – app shell: routing container, mini player, full player,
  bottom navigation, and all modal/sheet markup.
- `pages/*.html` – per-section markup fragments loaded into the shell.
- `css/` – `variables.css` (design tokens), `style.css` (layout/components),
  `animations.css`, `responsive.css`.
- `js/` – one module per system: `app.js` (router + player UI + favorites),
  `player.js` (audio engine, local files + hidden YouTube IFrame playback),
  `library.js`, `playlist.js`, `search.js`, `settings.js`, `language.js`,
  `storage.js` (IndexedDB persistence layer), `metadata.js` (ID3/MP4/Ogg/WAV
  tag + embedded cover-art parsing), `ui.js`.
- `js/future/` – scaffolding not yet wired into the app: equalizer, lyrics,
  sleep timer, playlist import/export, Media Session API.
- `lang/th.json`, `lang/en.json` – every UI string; switch language live
  from Settings with no page reload.
- `music/` – reserved, empty by design.

## Add songs

Use the **+** button on the Library tab to pick audio files from your
device. Files (and their extracted cover art) are stored in IndexedDB, so
your library and playback position persist across sessions. Only small,
synchronous UI prefs (theme, language, volume, shuffle/repeat, last page)
live in `localStorage`.

## Not yet implemented (scaffolded for later)

- Service worker (`sw.js` exists but isn't registered yet — no true
  offline caching or "Add to Home Screen" install prompt in-app)
- Media Session API (lock-screen / notification controls) & background
  audio when the tab isn't focused
- Playlist import/export, folder import
- Equalizer, lyrics, sleep timer (stubs only, see `js/future/`)
