/* ==========================================================================
   lyrics.js — Synced (karaoke) lyrics via the LRCLIB API
   -----------------------------------------------------------------------
   Strategy:
   1) Check IndexedDB cache first (storage.js)
   2) Try LRCLIB /api/get with several cleaned query variants
   3) If still missing, try LRCLIB /api/search with multiple fallbacks
   4) Rank candidates by:
      - has syncedLyrics first
      - title similarity
      - artist similarity
      - duration closeness
   5) Cache the chosen result so the same song is not fetched again
   -----------------------------------------------------------------------
   Returns:
     { songId, status, lines, plainText, source, matchedTrackName, matchedArtistName }
   status:
     - "synced" => karaoke-capable timed lines exist
     - "plain"  => plain lyrics only
     - "none"   => nothing usable was found
   ========================================================================== */

import { getCachedLyrics, saveCachedLyrics } from "./storage.js";

const LRCLIB_GET_ENDPOINT = "https://lrclib.net/api/get";
const LRCLIB_SEARCH_ENDPOINT = "https://lrclib.net/api/search";
const FETCH_TIMEOUT_MS = 8000;
const FETCH_RETRY_COUNT = 1;

// ---------------------------------------------------------------------------
// Text cleanup helpers
// ---------------------------------------------------------------------------

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeMetadataBrackets(text) {
  let out = String(text || "");

  // Remove bracketed metadata blocks that usually come from YouTube titles.
  // Examples:
  //   (Official MV)
  //   [Official Lyric Video]
  //   (Audio)
  //   [Live]
  out = out.replace(
    /\s*[\(\[][^\)\]]*\b(official|mv|music video|lyric|lyrics|audio|video|karaoke|visualizer|live|cover|remaster|version|hd|4k|shorts?|teaser)\b[^\)\]]*[\)\]]/gi,
    " "
  );

  // Remove other trailing production tags after separators.
  out = out.replace(/\s*[|•·]\s*.*$/g, "");
  out = out.replace(
    /\s*-\s*(official|mv|music video|lyric|lyrics|audio|video|karaoke|visualizer|live|cover|remaster|version|hd|4k|shorts?|teaser)\b.*$/gi,
    ""
  );

  // Remove feat/ft/featuring tail.
  out = out.replace(/\b(feat\.?|ft\.?|featuring)\b.*$/gi, "");

  return normalizeWhitespace(out);
}

function cleanTrackTitle(rawTitle) {
  if (!rawTitle) return "";

  let title = String(rawTitle);

  // Remove obvious metadata tags first.
  title = removeMetadataBrackets(title);

  // If there are any remaining simple brackets, drop them if they look noisy.
  title = title.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, " ");

  title = normalizeWhitespace(title);
  return title;
}

function cleanArtistName(rawArtist) {
  if (!rawArtist) return "";
  let artist = String(rawArtist);
  artist = removeMetadataBrackets(artist);
  artist = normalizeWhitespace(artist);
  return artist;
}

function normalizeForMatch(text) {
  return cleanTrackTitle(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleSimilarity(a, b) {
  const x = normalizeForMatch(a);
  const y = normalizeForMatch(b);

  if (!x || !y) return 0;
  if (x === y) return 1;

  if (x.includes(y) || y.includes(x)) {
    // Strong signal if one is contained inside the other.
    return 0.92;
  }

  const ax = x.split(" ").filter(Boolean);
  const by = y.split(" ").filter(Boolean);
  if (ax.length === 0 || by.length === 0) return 0;

  const setA = new Set(ax);
  const setB = new Set(by);
  let inter = 0;
  for (const token of setA) {
    if (setB.has(token)) inter++;
  }
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union ? inter / union : 0;

  // Small extra boost when the first words are close.
  const firstA = ax[0];
  const firstB = by[0];
  const firstMatch = firstA && firstB && firstA === firstB ? 0.08 : 0;

  return Math.min(1, jaccard + firstMatch);
}

function isLikelyBadArtist(artistName) {
  const a = normalizeForMatch(artistName);
  if (!a) return true;

  // YouTube channel names and noise words that often do not help LRCLIB.
  const badHints = [
    "topic",
    "official",
    "music",
    "channel",
    "provided to youtube",
    "auto-generated",
    "auto generated",
    "vevo",
    "records",
  ];

  return badHints.some((hint) => a.includes(hint));
}

/**
 * Loose signal only (requirement: "may help guessing, must never be the
 * main rule"). A handful of well-known label/channel suffixes that tend to
 * mean the channelTitle is *also* a decent artist-name guess. This never
 * filters anything out — it only adds a small nudge in scoreCandidate().
 */
function isLikelyTrustedChannel(channelTitle) {
  const c = normalizeForMatch(channelTitle);
  if (!c) return false;
  const trustedHints = ["records", "music", "entertainment", "official", "label", "vevo"];
  return trustedHints.some((hint) => c.includes(hint));
}

function splitTitleGuess(rawTitle) {
  const cleaned = cleanTrackTitle(rawTitle);
  if (!cleaned) return [];

  const guesses = new Set([cleaned]);

  // Common separators in YouTube titles.
  const separators = [" - ", " – ", " — ", " | ", " / ", " : "];
  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      const parts = cleaned.split(sep).map((s) => normalizeWhitespace(s)).filter(Boolean);
      if (parts.length >= 2) {
        // Add all meaningful parts.
        for (const part of parts) guesses.add(part);

        // Heuristic: keep first / last as alternative title guesses.
        guesses.add(parts[0]);
        guesses.add(parts[parts.length - 1]);
      }
    }
  }

  // Remove common leading/trailing noise tokens.
  const extra = cleaned
    .replace(/\b(official|mv|music video|lyric|lyrics|audio|video|karaoke|visualizer|live|cover|remaster|version|hd|4k|shorts?|teaser)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (extra) guesses.add(extra);

  return [...guesses].filter(Boolean);
}

function buildQueryVariants(song) {
  const rawTitle = song?.title || "";
  const rawArtist = song?.artist || "";
  const rawAlbum = song?.album || "";

  const titleVariants = splitTitleGuess(rawTitle);
  const cleanedArtist = cleanArtistName(rawArtist);
  const cleanedAlbum = cleanTrackTitle(rawAlbum);

  const variants = [];

  // 1) Best guess: cleaned title + cleaned artist.
  for (const titleName of titleVariants) {
    variants.push({
      trackName: titleName,
      artistName: cleanedArtist,
      albumName: cleanedAlbum,
      duration: song?.duration,
      mode: "exact-ish",
    });
  }

  // 2) Title only.
  for (const titleName of titleVariants) {
    variants.push({
      trackName: titleName,
      artistName: "",
      albumName: "",
      duration: song?.duration,
      mode: "title-only",
    });
  }

  // 3) If the artist looks noisy, try the title aggressively.
  if (isLikelyBadArtist(cleanedArtist)) {
    for (const titleName of titleVariants) {
      variants.push({
        trackName: titleName,
        artistName: "",
        albumName: cleanedAlbum,
        duration: song?.duration,
        mode: "bad-artist-fallback",
      });
    }
  }

  // 4) If title looks like "Artist - Song", also try the flipped guess.
  const rawClean = cleanTrackTitle(rawTitle);
  const dashMatch = rawClean.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const left = normalizeWhitespace(dashMatch[1]);
    const right = normalizeWhitespace(dashMatch[2]);
    if (left && right) {
      variants.push({
        trackName: right,
        artistName: left,
        albumName: cleanedAlbum,
        duration: song?.duration,
        mode: "flipped-a",
      });
      variants.push({
        trackName: left,
        artistName: right,
        albumName: cleanedAlbum,
        duration: song?.duration,
        mode: "flipped-b",
      });
    }
  }

  // Deduplicate by the query string itself.
  const seen = new Set();
  const unique = [];
  for (const v of variants) {
    const key = [
      normalizeForMatch(v.trackName),
      normalizeForMatch(v.artistName),
      normalizeForMatch(v.albumName),
      v.duration || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v);
  }

  return unique;
}

function parseCandidateDuration(candidate) {
  const d = candidate?.duration;
  return typeof d === "number" && Number.isFinite(d) ? d : null;
}

function scoreCandidate(candidate, query) {
  if (!candidate) return -Infinity;

  const hasSynced = !!candidate.syncedLyrics;
  const hasPlain = !!candidate.plainLyrics;
  if (!hasSynced && !hasPlain) return -Infinity;

  const candidateTrack =
    candidate.trackName || candidate.title || candidate.name || "";
  const candidateArtist =
    candidate.artistName || candidate.artist || "";

  let score = 0;

  // Lyrics quality first.
  score += hasSynced ? 100 : 60;

  // String similarity.
  const trackSim = simpleSimilarity(query.trackName || "", candidateTrack);
  const artistSim = simpleSimilarity(query.artistName || "", candidateArtist);

  score += trackSim * 40;
  score += artistSim * 25;

  // Duration closeness, if available.
  const qDuration = typeof query.duration === "number" ? query.duration : null;
  const cDuration = parseCandidateDuration(candidate);
  if (qDuration && cDuration) {
    const gap = Math.abs(qDuration - cDuration);

    // Small gaps are better; huge gaps are penalized hard.
    // 0s gap => +18
    // 10s gap => +13
    // 30s gap => +3
    // 60s+ gap => +0
    score += Math.max(0, 18 - gap * 0.5);
  }

  // Extra tiny boost if the normalized names are nearly identical.
  if (trackSim > 0.95) score += 12;
  if (artistSim > 0.95) score += 8;

  return score;
}

function dedupeCandidates(candidates) {
  const out = [];
  const seen = new Set();

  for (const c of candidates || []) {
    const key = [
      normalizeForMatch(c?.trackName || c?.title || c?.name || ""),
      normalizeForMatch(c?.artistName || c?.artist || ""),
      normalizeForMatch(c?.albumName || c?.album || ""),
      c?.duration ?? "",
      c?.syncedLyrics ? "S" : "",
      c?.plainLyrics ? "P" : "",
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }

  return out;
}

function normalizeRecordForCache(record, songId, extra = {}) {
  const status =
    record?.status === "synced" || record?.status === "plain"
      ? record.status
      : record?.lines?.length
        ? "synced"
        : record?.plainText
          ? "plain"
          : "none";

  return {
    songId,
    status,
    lines: Array.isArray(record?.lines) ? record.lines : [],
    plainText: typeof record?.plainText === "string" ? record.plainText : "",
    source: record?.source || extra.source || "unknown",
    matchedTrackName: record?.matchedTrackName || extra.matchedTrackName || "",
    matchedArtistName: record?.matchedArtistName || extra.matchedArtistName || "",
    queriedTitle: extra.queriedTitle || "",
    queriedArtist: extra.queriedArtist || "",
    fetchedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// LRC parsing
// ---------------------------------------------------------------------------

/**
 * Parse LRC-formatted text into a sorted array of { time (seconds), text }.
 * Supports multiple time tags on one line, e.g.:
 *   [00:10.00][00:15.00]la la
 */
export function parseLRC(lrcText) {
  if (!lrcText) return [];

  const timeTagRe = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g;
  const lines = [];

  String(lrcText)
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const tags = [...rawLine.matchAll(timeTagRe)];
      if (tags.length === 0) return;

      const text = rawLine.replace(timeTagRe, "").trim();
      if (!text) return;

      tags.forEach((tag) => {
        const minutes = parseInt(tag[1], 10);
        const seconds = parseFloat(tag[2]);
        const time = minutes * 60 + seconds;
        if (Number.isFinite(time)) {
          lines.push({ time, text });
        }
      });
    });

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/**
 * Binary search for the index of the last line whose timestamp has already
 * passed. Returns -1 if playback hasn't reached the first line yet.
 */
export function findActiveLineIndex(lines, currentTime) {
  if (!Array.isArray(lines) || lines.length === 0) return -1;

  let lo = 0;
  let hi = lines.length - 1;
  let answer = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= currentTime) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return answer;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJsonWithRetry(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS, retries = FETCH_RETRY_COUNT) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    last = await fetchJsonWithTimeout(url, options, timeoutMs);
    if (last !== null) return last;
  }
  return last;
}

function buildQueryParams(query) {
  const params = new URLSearchParams();

  if (query?.trackName) params.set("track_name", query.trackName);
  if (query?.artistName) params.set("artist_name", query.artistName);
  if (query?.albumName) params.set("album_name", query.albumName);
  if (typeof query?.duration === "number" && Number.isFinite(query.duration)) {
    params.set("duration", String(Math.round(query.duration)));
  }

  return params;
}

/**
 * Exact-ish lookup. LRCLIB docs support no-registration access, and the API
 * returns lyric data including syncedLyrics/plainLyrics. Try this first.
 */
async function fetchFromLRCLibGet(query) {
  const params = buildQueryParams(query);
  const url = `${LRCLIB_GET_ENDPOINT}?${params.toString()}`;
  const result = await fetchJsonWithRetry(url);

  if (!result || Array.isArray(result)) return null;
  return result;
}

/**
 * Search lookup. Returns an array of candidates (or []).
 */
async function fetchFromLRCLibSearch(query) {
  const params = buildQueryParams(query);
  const url = `${LRCLIB_SEARCH_ENDPOINT}?${params.toString()}`;
  const result = await fetchJsonWithRetry(url);

  if (!result) return [];
  if (Array.isArray(result)) return result;
  return [result];
}

function pickBestCandidate(candidates, queryVariants) {
  const items = dedupeCandidates(candidates).filter((c) => c && (c.syncedLyrics || c.plainLyrics));
  if (items.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const candidate of items) {
    for (const query of queryVariants) {
      const score = scoreCandidate(candidate, query);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// User-driven lyrics selection (picker) API
// ---------------------------------------------------------------------------

/**
 * Stable identity for "this specific song version" — this is the key the
 * user's manual lyrics choice + offset get saved under (storage.js).
 * YouTube songs key on videoId (per the requirement); local files fall back
 * to their content fingerprint (or id) since there's no videoId.
 */
export function computeMatchKey(song) {
  if (!song) return null;
  if (song.source === "youtube" && song.videoId) return `yt:${song.videoId}`;
  return `local:${song.fingerprint || song.id}`;
}

/**
 * Fetch a specific LRCLIB record by its numeric id — used to instantly
 * re-fetch lyrics content for a match the user already chose before,
 * without repeating the search.
 */
export async function fetchLyricsById(lyricsId) {
  if (lyricsId === null || lyricsId === undefined) return null;
  const url = `${LRCLIB_GET_ENDPOINT}/${encodeURIComponent(lyricsId)}`;
  const result = await fetchJsonWithRetry(url);
  if (!result || !(result.syncedLyrics || result.plainLyrics)) return null;
  return candidateToRecord(result);
}

function candidateToRecord(candidate) {
  if (candidate.syncedLyrics) {
    return {
      status: "synced",
      lines: parseLRC(candidate.syncedLyrics),
      plainText: candidate.plainLyrics || "",
      matchedTrackName: candidate.trackName || "",
      matchedArtistName: candidate.artistName || "",
    };
  }
  if (candidate.plainLyrics) {
    return {
      status: "plain",
      lines: [],
      plainText: candidate.plainLyrics,
      matchedTrackName: candidate.trackName || "",
      matchedArtistName: candidate.artistName || "",
    };
  }
  return { status: "none", lines: [], plainText: "", matchedTrackName: "", matchedArtistName: "" };
}

/**
 * Search LRCLIB for every plausible candidate for this song and return a
 * ranked, deduplicated, UI-friendly summary list — this is what the picker
 * sheet renders as tappable options. Nothing here is auto-applied; the
 * caller (app.js) always lets the person confirm, even for a single hit.
 *
 * Returns: Array<{
 *   lyricsId, trackName, artistName, albumName, duration,
 *   hasSynced, hasPlain, score
 * }>, sorted best-first, capped at 8 entries.
 */
export async function searchLyricsCandidates(song, maxResults = 8) {
  if (!song) return [];

  const queryVariants = buildQueryVariants(song);
  const primaryQuery = queryVariants[0] || { trackName: song.title || "", artistName: song.artist || "" };
  const trustedChannel = song.source === "youtube" && isLikelyTrustedChannel(song.artist);

  const allCandidates = [];
  try {
    for (const q of queryVariants) {
      if (!q.trackName) continue;
      const results = await fetchFromLRCLibSearch(q);
      if (Array.isArray(results) && results.length) allCandidates.push(...results);
      // Enough raw material already — searching every variant is wasteful
      // and this flow is not meant to lean on heavy API usage.
      if (allCandidates.length >= 25) break;
    }
  } catch (err) {
    console.error("lyrics: candidate search failed", err);
  }

  const deduped = dedupeCandidates(allCandidates).filter(
    (c) => c && c.id != null && (c.syncedLyrics || c.plainLyrics)
  );

  const ranked = deduped
    .map((c) => {
      let score = scoreCandidate(c, primaryQuery);
      // Small nudge only — never a hard filter (requirement #10/#11).
      if (trustedChannel) score += 5;
      return { candidate: c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ candidate, score }) => ({
      lyricsId: candidate.id,
      trackName: candidate.trackName || "",
      artistName: candidate.artistName || "",
      albumName: candidate.albumName || "",
      duration: parseCandidateDuration(candidate),
      hasSynced: !!candidate.syncedLyrics,
      hasPlain: !!candidate.plainLyrics,
      score,
    }));

  return ranked;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Get lyrics for a song, using the local cache first.
 * Returns:
 *   { songId, status, lines, plainText, source, matchedTrackName, matchedArtistName }
 */
export async function getLyricsForSong(song) {
  if (!song || !song.id) {
    return {
      songId: null,
      status: "none",
      lines: [],
      plainText: "",
      source: "none",
      matchedTrackName: "",
      matchedArtistName: "",
    };
  }

  // 1) Cache first.
  const cached = await getCachedLyrics(song.id);
  if (cached) {
    const normalizedCached = normalizeRecordForCache(cached, song.id, { source: "cache" });
    return normalizedCached;
  }

  const queryVariants = buildQueryVariants(song);
  const titleForExact = cleanTrackTitle(song.title);
  const artistForExact = cleanArtistName(song.artist);

  // 2) Try exact /api/get with the best cleaned title/artist first.
  let apiResult = null;
  let matchedQuery = null;

  try {
    const exactQueries = [
      {
        trackName: titleForExact,
        artistName: artistForExact,
        albumName: cleanTrackTitle(song.album || ""),
        duration: song.duration,
      },
      // If artist is noisy, try title only right away.
      {
        trackName: titleForExact,
        artistName: "",
        albumName: "",
        duration: song.duration,
      },
    ];

    for (const q of exactQueries) {
      if (!q.trackName) continue;
      const r = await fetchFromLRCLibGet(q);
      if (r && (r.syncedLyrics || r.plainLyrics)) {
        apiResult = r;
        matchedQuery = q;
        break;
      }
    }
  } catch (err) {
    console.error("lyrics: failed to reach LRCLIB (get)", err);
  }

  // 3) Search fallback with multiple query variants.
  if (!apiResult || (!apiResult.syncedLyrics && !apiResult.plainLyrics)) {
    try {
      const allCandidates = [];

      for (const q of queryVariants) {
        if (!q.trackName) continue;

        const candidates = await fetchFromLRCLibSearch(q);

        if (Array.isArray(candidates) && candidates.length > 0) {
          allCandidates.push(...candidates);

          // If we already got a very strong candidate, stop early.
          const bestSoFar = pickBestCandidate(allCandidates, queryVariants);
          if (bestSoFar && (bestSoFar.syncedLyrics || bestSoFar.plainLyrics)) {
            apiResult = bestSoFar;
            matchedQuery = q;
            break;
          }
        }
      }

      if (!apiResult) {
        apiResult = pickBestCandidate(allCandidates, queryVariants);
      }
    } catch (err) {
      console.error("lyrics: failed to reach LRCLIB (search)", err);
    }
  }

  // 4) Normalize result into app-friendly shape.
  let record;

  if (apiResult && apiResult.syncedLyrics) {
    record = {
      status: "synced",
      lines: parseLRC(apiResult.syncedLyrics),
      plainText: apiResult.plainLyrics || "",
      source: "lrclib",
      matchedTrackName: apiResult.trackName || apiResult.title || apiResult.name || "",
      matchedArtistName: apiResult.artistName || apiResult.artist || "",
    };
  } else if (apiResult && apiResult.plainLyrics) {
    record = {
      status: "plain",
      lines: [],
      plainText: apiResult.plainLyrics,
      source: "lrclib",
      matchedTrackName: apiResult.trackName || apiResult.title || apiResult.name || "",
      matchedArtistName: apiResult.artistName || apiResult.artist || "",
    };
  } else {
    record = {
      status: "none",
      lines: [],
      plainText: "",
      source: "none",
      matchedTrackName: "",
      matchedArtistName: "",
    };
  }

  const toCache = normalizeRecordForCache(record, song.id, {
    source: record.source,
    matchedTrackName: record.matchedTrackName,
    matchedArtistName: record.matchedArtistName,
    queriedTitle: matchedQuery?.trackName || titleForExact || "",
    queriedArtist: matchedQuery?.artistName || artistForExact || "",
  });

  await saveCachedLyrics(song.id, toCache);

  return toCache;
}