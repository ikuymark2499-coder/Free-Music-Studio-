/* ==========================================================================
   future/playlistIO.js — Scaffold only (not active yet)
   -----------------------------------------------------------------------
   Covers spec items: Import Folder, Export Playlist, Import Playlist.

   Plan:
     - exportPlaylist(playlist, songs): serialize { name, songFingerprints:
       songs.map(s => s.fingerprint) } to JSON and trigger a download via
       a Blob + <a download>. Fingerprints (not raw ids) so a playlist can
       be re-matched against a *different* library later.
     - importPlaylistFile(file): parse that JSON, then for each fingerprint
       look up storage.findDuplicateSong(fingerprint) to relink to whatever
       song already exists locally (songs never travel with the playlist
       file — audio stays local per the offline-first design).
     - importFolder(fileSystemDirectoryHandle): walk a dropped folder via
       the File System Access API (showDirectoryPicker / webkitdirectory
       input fallback) and hand the resulting FileList to the existing
       library.addSongsFromFiles(), which already scans/dedupes/reports
       progress — no changes needed there.

   Left un-implemented for now — the spec marked these "future ready"
   rather than required for this pass.
   ========================================================================== */

export function exportPlaylist(/* playlist, songs */) {
  console.info("playlistIO: exportPlaylist() is a scaffold — not implemented yet");
}

export function importPlaylistFile(/* file */) {
  console.info("playlistIO: importPlaylistFile() is a scaffold — not implemented yet");
}

export function importFolder(/* directoryHandleOrFileList */) {
  console.info("playlistIO: importFolder() is a scaffold — not implemented yet");
}
