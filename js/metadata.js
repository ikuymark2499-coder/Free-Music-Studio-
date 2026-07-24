/* ==========================================================================
   metadata.js — Vanilla-JS audio tag reader
   -----------------------------------------------------------------------
   No external libraries: reads just enough of each container format to
   pull out Title / Artist / Album / Genre / Year / Track / cover art.
   Every parser is defensive — a corrupt or unusual file should degrade to
   an empty tag set rather than throw, since library.js falls back to the
   filename when a tag is missing.
   ========================================================================== */

const EMPTY_TAGS = Object.freeze({
  title: "",
  artist: "",
  album: "",
  genre: "",
  year: "",
  track: "",
  coverBlob: null,
});

/** Minimal ID3v1 genre table — covers the common cases; unknown indices
 *  just fall back to an empty genre rather than a wrong guess. */
const ID3_GENRES = [
  "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop",
  "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock",
  "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack",
  "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance",
  "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise",
  "Alternative Rock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop",
  "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic",
  "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40",
  "Christian Rap", "Pop/Funk", "Jungle", "Native US", "Cabaret", "New Wave", "Psychedelic",
  "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka",
  "Retro", "Musical", "Rock & Roll", "Hard Rock",
];

function extOf(filename) {
  const match = /\.[^/.]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
}

export async function readAudioTags(file) {
  try {
    const ext = extOf(file.name);
    if (ext === ".mp3") return await parseID3(file);
    if (ext === ".m4a") return await parseMP4(file);
    if (ext === ".ogg") return await parseOggVorbis(file);
    if (ext === ".wav") return await parseWav(file);
    // Unknown extension but browser thinks it's audio — try ID3 as a best guess.
    return await parseID3(file);
  } catch (err) {
    console.error("metadata: failed to read tags for", file.name, err);
    return { ...EMPTY_TAGS };
  }
}

/* ---------------------------------------------------------------------- */
/* ID3v2 (MP3)                                                            */
/* ---------------------------------------------------------------------- */

function readSynchsafeOrPlain(bytes, offset, synchsafe) {
  if (synchsafe) {
    return (
      ((bytes[offset] & 0x7f) << 21) |
      ((bytes[offset + 1] & 0x7f) << 14) |
      ((bytes[offset + 2] & 0x7f) << 7) |
      (bytes[offset + 3] & 0x7f)
    );
  }
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function decodeTextFrame(bytes) {
  if (bytes.length === 0) return "";
  const encoding = bytes[0];
  const body = bytes.subarray(1);
  let text;
  if (encoding === 1 || encoding === 2) {
    // UTF-16 (with or without BOM)
    const hasBOM = body.length >= 2 && ((body[0] === 0xff && body[1] === 0xfe) || (body[0] === 0xfe && body[1] === 0xff));
    const littleEndian = encoding === 1 ? !(body[0] === 0xfe && body[1] === 0xff) : false;
    const start = hasBOM ? 2 : 0;
    const codeUnits = [];
    for (let i = start; i + 1 < body.length; i += 2) {
      const lo = body[i];
      const hi = body[i + 1];
      codeUnits.push(littleEndian ? (hi << 8) | lo : (lo << 8) | hi);
    }
    text = String.fromCharCode(...codeUnits);
  } else if (encoding === 3) {
    text = new TextDecoder("utf-8").decode(body);
  } else {
    text = new TextDecoder("iso-8859-1").decode(body);
  }
  return text.replace(/\0+$/g, "").trim();
}

function parseGenreText(raw) {
  if (!raw) return "";
  const match = /^\((\d+)\)(.*)$/.exec(raw.trim());
  if (match) {
    const rest = match[2].trim();
    if (rest) return rest;
    const idx = parseInt(match[1], 10);
    return ID3_GENRES[idx] || "";
  }
  return raw;
}

function parseAPIC(bytes, versionMajor) {
  let offset = 0;
  const encoding = bytes[offset];
  offset += 1;
  // MIME type is a null-terminated latin1 string
  let mimeEnd = offset;
  while (mimeEnd < bytes.length && bytes[mimeEnd] !== 0) mimeEnd++;
  const mime = new TextDecoder("iso-8859-1").decode(bytes.subarray(offset, mimeEnd)) || "image/jpeg";
  offset = mimeEnd + 1;
  offset += 1; // picture type byte
  // Description string, terminator width depends on text encoding
  const wide = encoding === 1 || encoding === 2;
  if (wide) {
    while (offset + 1 < bytes.length && !(bytes[offset] === 0 && bytes[offset + 1] === 0)) offset += 2;
    offset += 2;
  } else {
    while (offset < bytes.length && bytes[offset] !== 0) offset += 1;
    offset += 1;
  }
  const imageBytes = bytes.subarray(Math.min(offset, bytes.length));
  if (imageBytes.length === 0) return null;
  return new Blob([imageBytes], { type: mime.includes("/") ? mime : `image/${mime}` });
}

async function parseID3(file) {
  const tags = { ...EMPTY_TAGS };
  const headerBuf = await file.slice(0, 10).arrayBuffer();
  const header = new Uint8Array(headerBuf);
  if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return tags; // not "ID3"

  const versionMajor = header[3];
  const tagSize = readSynchsafeOrPlain(header, 6, true);
  if (!tagSize || tagSize < 0) return tags;

  const bodyBuf = await file.slice(10, 10 + tagSize).arrayBuffer();
  const body = new Uint8Array(bodyBuf);

  const idLength = versionMajor === 2 ? 3 : 4;
  const frameHeaderLength = versionMajor === 2 ? 6 : 10;
  const useSynchsafeSize = versionMajor >= 4;

  const idMap = {
    TIT2: "title", TT2: "title",
    TPE1: "artist", TP1: "artist",
    TALB: "album", TAL: "album",
    TCON: "genre", TCO: "genre",
    TYER: "year", TYE: "year", TDRC: "year",
    TRCK: "track", TRK: "track",
    APIC: "picture", PIC: "picture",
  };

  let offset = 0;
  while (offset + frameHeaderLength <= body.length) {
    const idBytes = body.subarray(offset, offset + idLength);
    if (idBytes.every((b) => b === 0)) break; // padding reached

    const frameId = new TextDecoder("iso-8859-1").decode(idBytes);
    let frameSize;
    if (versionMajor === 2) {
      frameSize = (body[offset + 3] << 16) | (body[offset + 4] << 8) | body[offset + 5];
    } else {
      frameSize = readSynchsafeOrPlain(body, offset + 4, useSynchsafeSize);
    }
    const frameStart = offset + frameHeaderLength;
    if (!frameSize || frameStart + frameSize > body.length) break;
    const frameBody = body.subarray(frameStart, frameStart + frameSize);

    const mapped = idMap[frameId];
    if (mapped === "picture") {
      if (!tags.coverBlob) {
        const blob = parseAPIC(frameBody, versionMajor);
        if (blob) tags.coverBlob = blob;
      }
    } else if (mapped && !tags[mapped]) {
      let text = decodeTextFrame(frameBody);
      if (mapped === "genre") text = parseGenreText(text);
      if (mapped === "year") text = (text.match(/\d{4}/) || [""])[0];
      if (mapped === "track") text = text.split("/")[0].trim();
      tags[mapped] = text;
    }

    offset = frameStart + frameSize;
  }

  return tags;
}

/* ---------------------------------------------------------------------- */
/* MP4 / M4A atoms                                                        */
/* ---------------------------------------------------------------------- */

const MP4_TEXT_KEYS = {
  "\xa9nam": "title",
  "\xa9ART": "artist",
  "\xa9alb": "album",
  "\xa9gen": "genre",
  "\xa9day": "year",
};

async function readBoxHeader(file, offset) {
  const buf = await file.slice(offset, offset + 8).arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 8) return null;
  let size = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  size = size >>> 0;
  const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  let headerSize = 8;
  if (size === 1) {
    const extBuf = await file.slice(offset + 8, offset + 16).arrayBuffer();
    const extBytes = new Uint8Array(extBuf);
    size = 0;
    for (let i = 0; i < 8; i++) size = size * 256 + extBytes[i];
    headerSize = 16;
  } else if (size === 0) {
    size = file.size - offset;
  }
  return { type, size, headerSize, start: offset };
}

/** Walk top-level boxes from `start` to `end`, looking for `targetType`. */
async function findBox(file, start, end, targetType) {
  let offset = start;
  while (offset < end) {
    const box = await readBoxHeader(file, offset);
    if (!box || box.size <= 0) break;
    if (box.type === targetType) return box;
    offset += box.size;
  }
  return null;
}

async function parseMP4(file) {
  const tags = { ...EMPTY_TAGS };
  const moov = await findBox(file, 0, file.size, "moov");
  if (!moov) return tags;
  const udta = await findBox(file, moov.start + moov.headerSize, moov.start + moov.size, "udta");
  if (!udta) return tags;
  const meta = await findBox(file, udta.start + udta.headerSize, udta.start + udta.size, "meta");
  if (!meta) return tags;
  // 'meta' has an extra 4-byte version/flags field before its children.
  const ilst = await findBox(file, meta.start + meta.headerSize + 4, meta.start + meta.size, "ilst");
  if (!ilst) return tags;

  let offset = ilst.start + ilst.headerSize;
  const ilstEnd = ilst.start + ilst.size;
  while (offset < ilstEnd) {
    const item = await readBoxHeader(file, offset);
    if (!item || item.size <= 0) break;
    const dataBox = await findBox(file, item.start + item.headerSize, item.start + item.size, "data");
    if (dataBox) {
      const payloadStart = dataBox.start + dataBox.headerSize + 8; // + version/flags(4) + reserved(4)
      const payloadEnd = dataBox.start + dataBox.size;
      if (payloadEnd > payloadStart) {
        if (item.type === "covr") {
          if (!tags.coverBlob) {
            const buf = await file.slice(payloadStart, payloadEnd).arrayBuffer();
            const bytes = new Uint8Array(buf);
            const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
            tags.coverBlob = new Blob([bytes], { type: isPng ? "image/png" : "image/jpeg" });
          }
        } else if (item.type === "trkn") {
          const buf = await file.slice(payloadStart, payloadEnd).arrayBuffer();
          const bytes = new Uint8Array(buf);
          if (bytes.length >= 4) tags.track = String((bytes[2] << 8) | bytes[3]);
        } else if (MP4_TEXT_KEYS[item.type]) {
          const buf = await file.slice(payloadStart, payloadEnd).arrayBuffer();
          const text = new TextDecoder("utf-8").decode(buf).replace(/\0+$/g, "").trim();
          const field = MP4_TEXT_KEYS[item.type];
          if (field === "year") tags.year = (text.match(/\d{4}/) || [""])[0];
          else tags[field] = text;
        }
      }
    }
    offset += item.size;
  }
  return tags;
}

/* ---------------------------------------------------------------------- */
/* Ogg Vorbis comments                                                    */
/* ---------------------------------------------------------------------- */

async function parseOggVorbis(file) {
  const tags = { ...EMPTY_TAGS };
  // Vorbis comment header is virtually always inside the first ~64KB, right
  // after the identification header page — a full multi-page Ogg parser is
  // overkill for tag reading, so we scan for the comment packet marker.
  const scanLength = Math.min(file.size, 262144);
  const buf = await file.slice(0, scanLength).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const marker = [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]; // 0x03 "vorbis"
  let markerIndex = -1;
  for (let i = 0; i + marker.length <= bytes.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) { match = false; break; }
    }
    if (match) { markerIndex = i; break; }
  }
  if (markerIndex === -1) return tags;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = markerIndex + marker.length;
  if (offset + 4 > bytes.length) return tags;
  const vendorLength = view.getUint32(offset, true);
  offset += 4 + vendorLength;
  if (offset + 4 > bytes.length) return tags;
  const commentCount = view.getUint32(offset, true);
  offset += 4;

  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < commentCount && offset + 4 <= bytes.length; i++) {
    const len = view.getUint32(offset, true);
    offset += 4;
    if (offset + len > bytes.length || len < 0) break;
    const comment = decoder.decode(bytes.subarray(offset, offset + len));
    offset += len;
    const eq = comment.indexOf("=");
    if (eq === -1) continue;
    const key = comment.slice(0, eq).toUpperCase();
    const value = comment.slice(eq + 1).trim();
    if (key === "TITLE" && !tags.title) tags.title = value;
    else if (key === "ARTIST" && !tags.artist) tags.artist = value;
    else if (key === "ALBUM" && !tags.album) tags.album = value;
    else if (key === "GENRE" && !tags.genre) tags.genre = value;
    else if ((key === "DATE" || key === "YEAR") && !tags.year) tags.year = (value.match(/\d{4}/) || [""])[0];
    else if ((key === "TRACKNUMBER" || key === "TRACK") && !tags.track) tags.track = value.split("/")[0].trim();
  }
  // Ogg Vorbis rarely embeds cover art directly (usually via METADATA_BLOCK_PICTURE,
  // base64-encoded FLAC-style picture blocks) — left unsupported for now.
  return tags;
}

/* ---------------------------------------------------------------------- */
/* WAV (RIFF INFO chunk) — rare, but cheap to support                     */
/* ---------------------------------------------------------------------- */

const WAV_INFO_KEYS = { INAM: "title", IART: "artist", IPRD: "album", IGNR: "genre", ICRD: "year" };

async function parseWav(file) {
  const tags = { ...EMPTY_TAGS };
  const headerBuf = await file.slice(0, 12).arrayBuffer();
  const header = new Uint8Array(headerBuf);
  const riff = String.fromCharCode(...header.subarray(0, 4));
  const wave = String.fromCharCode(...header.subarray(8, 12));
  if (riff !== "RIFF" || wave !== "WAVE") return tags;

  let offset = 12;
  const scanEnd = Math.min(file.size, 1048576); // 1MB safety cap
  while (offset + 8 <= scanEnd) {
    const chunkHeaderBuf = await file.slice(offset, offset + 8).arrayBuffer();
    const chunkHeader = new Uint8Array(chunkHeaderBuf);
    const chunkId = String.fromCharCode(...chunkHeader.subarray(0, 4));
    const view = new DataView(chunkHeaderBuf);
    const chunkSize = view.getUint32(4, true);
    const dataStart = offset + 8;

    if (chunkId === "LIST") {
      const listTypeBuf = await file.slice(dataStart, dataStart + 4).arrayBuffer();
      const listType = String.fromCharCode(...new Uint8Array(listTypeBuf));
      if (listType === "INFO") {
        let subOffset = dataStart + 4;
        const listEnd = dataStart + chunkSize;
        while (subOffset + 8 <= listEnd) {
          const subHeaderBuf = await file.slice(subOffset, subOffset + 8).arrayBuffer();
          const subBytes = new Uint8Array(subHeaderBuf);
          const subId = String.fromCharCode(...subBytes.subarray(0, 4));
          const subView = new DataView(subHeaderBuf);
          const subSize = subView.getUint32(4, true);
          const field = WAV_INFO_KEYS[subId];
          if (field) {
            const textBuf = await file.slice(subOffset + 8, subOffset + 8 + subSize).arrayBuffer();
            const text = new TextDecoder("utf-8").decode(textBuf).replace(/\0+$/g, "").trim();
            tags[field] = field === "year" ? (text.match(/\d{4}/) || [""])[0] : text;
          }
          subOffset += 8 + subSize + (subSize % 2);
        }
      }
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  return tags;
}
