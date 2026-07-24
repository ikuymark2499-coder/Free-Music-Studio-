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
  `player.js` (audio engine), `library.js`, `playlist.js`, `search.js`,
  `settings.js`, `language.js`, `storage.js`, `ui.js`.
- `lang/th.json`, `lang/en.json` – every UI string; switch language live
  from Settings with no page reload.
- `music/` – reserved, empty by design.

## Add songs

Use the **+** button on the Library tab to pick audio files from your
device. Files are read via `URL.createObjectURL` and kept only in this
browser session's memory + localStorage metadata (no upload anywhere).

## Not yet implemented (scaffolded for later)

- Service worker / true offline caching
- Media Session API (lock-screen controls) & background audio
- IndexedDB (currently localStorage)
- Playlist import/export, folder import
- ID3 cover-art extraction (a generic icon is shown for every track)
