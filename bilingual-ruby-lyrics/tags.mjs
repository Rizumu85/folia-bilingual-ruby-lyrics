// Reads embedded lyrics out of any audio file Folia plays, by the kind of tag found in the file
// rather than by its extension:
//
//   ID3v2            MP3, AAC, TTA; inside a chunk in WAV and AIFF      USLT frames
//   Vorbis comments  FLAC, Ogg Vorbis, Opus                             LYRICS, RUBY_LYRICS
//   MP4 atoms        M4A, ALAC                                          ©lyr, ----:com.apple.iTunes:RUBY_LYRICS
//   APEv2            APE, WavPack, TTA                                  Lyrics, RUBY_LYRICS
//   ASF attributes   WMA                                                WM/Lyrics, RUBY_LYRICS
//
// `read(offset, length)` returns that part of the file (shorter at the end of the file); only
// headers and tag areas are asked for, never the audio. Nothing here writes to a file.
import { id3Header, parseId3 } from './id3.mjs';

export const RUBY_TAG = 'RUBY_LYRICS';
/** The extensions Folia 0.7.13 accepts as local music. */
export const AUDIO_FILE = /\.(mp3|flac|m4a|wav|ogg|opus|aac|alac|ape|wv|tta|wma|aif|aiff|caf)$/i;
const LYRIC_TAGS = new Set(['LYRICS', 'UNSYNCEDLYRICS', 'UNSYNCED LYRICS', 'WM/LYRICS', RUBY_TAG]);
const MAX_BYTES = 16 * 1024 * 1024;
const ascii = bytes => String.fromCharCode(...bytes);
const big = bytes => bytes.reduce((n, byte) => n * 256 + byte, 0);
const little = bytes => bytes.reduceRight((n, byte) => n * 256 + byte, 0);
const utf8 = bytes => new TextDecoder('utf-8').decode(bytes);
const utf16 = bytes => new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '');
const item = (descriptor, text) => ({ language: '', descriptor, text });
const bounded = (length, what) => { if (length > MAX_BYTES) throw new Error(what + ' 的标签区过大'); return length; };
const whole = async (read, offset, length, what) => {
  const bytes = await read(offset, bounded(length, what));
  if (bytes.length !== length) throw new Error(what + ' 的标签不完整');
  return bytes;
};

// An ID3v2 tag starting at `offset`: its lyric frames and where it ends.
async function id3At(read, offset) {
  const info = id3Header(await read(offset, 10));
  if (!info.totalSize) return { lyrics: [], end: offset };
  return { lyrics: parseId3(await whole(read, offset, info.totalSize, 'ID3')).lyrics, end: offset + info.totalSize };
}

// The body of a Vorbis comment header: vendor string, then KEY=value entries.
function vorbisComments(block) {
  const found = [];
  let at = 4 + little(block.subarray(0, 4));
  const count = little(block.subarray(at, at + 4)); at += 4;
  for (let index = 0; index < count && at + 4 <= block.length; index++) {
    const end = at + 4 + little(block.subarray(at, at + 4));
    const comment = block.subarray(at + 4, end), equals = comment.indexOf(61);
    const key = equals > 0 ? ascii(comment.subarray(0, equals)).toUpperCase() : '';
    if (LYRIC_TAGS.has(key)) found.push(item(key, utf8(comment.subarray(equals + 1))));
    at = end;
  }
  return found;
}

async function flac(read, position, size) {
  position += 4;
  for (let last = false; !last && position + 4 <= size;) {
    const header = await read(position, 4), length = big(header.subarray(1, 4));
    if (header.length < 4) break;
    last = (header[0] & 128) !== 0;
    position += 4;
    if ((header[0] & 127) === 4) return vorbisComments(await whole(read, position, length, 'FLAC'));
    position += length;
  }
  return [];
}

// Ogg: the comments are the second packet of the stream; packets are cut into pages.
async function ogg(read, position, size) {
  const packets = [];
  let current = [], length = 0, serial = null;
  while (packets.length < 2 && position + 27 <= size) {
    const header = await read(position, 27 + 255);
    if (header.length < 27 || ascii(header.subarray(0, 4)) !== 'OggS') break;
    const segments = header[26], table = header.subarray(27, 27 + segments);
    const body = table.reduce((sum, value) => sum + value, 0);
    const pageSerial = little(header.subarray(14, 18));
    serial ??= pageSerial;
    if (pageSerial === serial) {
      const data = await whole(read, position + 27 + segments, body, 'Ogg');
      let at = 0;
      for (const value of table) {
        current.push(data.subarray(at, at + value)); at += value; length += value;
        bounded(length, 'Ogg');
        if (value < 255) {
          const packet = new Uint8Array(length);
          let offset = 0;
          for (const part of current) { packet.set(part, offset); offset += part.length; }
          packets.push(packet); current = []; length = 0;
          if (packets.length === 2) break;
        }
      }
    }
    position += 27 + segments + body;
  }
  const comments = packets[1];
  if (!comments) return [];
  if (ascii(comments.subarray(0, 8)) === 'OpusTags') return vorbisComments(comments.subarray(8));
  if (comments[0] === 3 && ascii(comments.subarray(1, 7)) === 'vorbis') return vorbisComments(comments.subarray(7));
  // FLAC in Ogg: a FLAC metadata block, header included
  if ((comments[0] & 127) === 4 && ascii(packets[0].subarray(1, 5)) === 'FLAC') return vorbisComments(comments.subarray(4));
  return [];
}

// WAV (RIFF, little-endian sizes) and AIFF (FORM, big-endian sizes) keep an ID3v2 tag in a chunk.
async function chunked(read, position, size, number) {
  position += 12;
  for (let guard = 0; guard < 4096 && position + 8 <= size; guard++) {
    const header = await read(position, 8);
    if (header.length < 8) break;
    const length = number(header.subarray(4, 8));
    if (ascii(header.subarray(0, 4)).toUpperCase() === 'ID3 ') return (await id3At(read, position + 8)).lyrics;
    position += 8 + length + (length & 1);
  }
  return [];
}

// child atoms of the atom body bytes[from, to): [type, bodyStart, bodyEnd]
function* atoms(bytes, from, to) {
  while (from + 8 <= to) {
    let length = big(bytes.subarray(from, from + 4)), header = 8;
    if (length === 1) { length = big(bytes.subarray(from + 8, from + 16)); header = 16; }
    else if (length === 0) length = to - from;
    if (length < header || from + length > to) return;
    yield [ascii(bytes.subarray(from + 4, from + 8)), from + header, from + length];
    from += length;
  }
}
const child = (bytes, from, to, type) => { for (const atom of atoms(bytes, from, to)) if (atom[0] === type) return atom; return null; };

async function mp4(read, position, size) {
  // top-level atoms: only headers are read until moov, which holds the tags
  while (position + 8 <= size) {
    const header = await read(position, 16);
    if (header.length < 8) break;
    let length = big(header.subarray(0, 4)), headerSize = 8;
    if (length === 1) { length = big(header.subarray(8, 16)); headerSize = 16; }
    else if (length === 0) length = size - position;
    if (length < headerSize) break;
    if (ascii(header.subarray(4, 8)) === 'moov') {
      const moov = await whole(read, position + headerSize, length - headerSize, 'MP4');
      const udta = child(moov, 0, moov.length, 'udta');
      const meta = udta && child(moov, udta[1], udta[2], 'meta');
      // meta has four bytes of version and flags before its children
      const list = meta && child(moov, meta[1] + 4, meta[2], 'ilst');
      const found = [];
      for (const [type, from, to] of list ? atoms(moov, list[1], list[2]) : []) {
        const data = child(moov, from, to, 'data');
        if (!data) continue;
        const text = () => utf8(moov.subarray(data[1] + 8, data[2]));
        if (type === '©lyr') found.push(item('LYRICS', text()));
        else if (type === '----') {
          const name = child(moov, from, to, 'name');
          const key = name ? ascii(moov.subarray(name[1] + 4, name[2])).toUpperCase() : '';
          if (LYRIC_TAGS.has(key)) found.push(item(key, text()));
        }
      }
      return found;
    }
    position += length;
  }
  return [];
}

// APEv2: a footer at the very end of the file (before an ID3v1 tag, if there is one).
async function ape(read, size) {
  let end = size;
  if (end >= 128 && ascii(await read(end - 128, 3)) === 'TAG') end -= 128;
  if (end < 32) return [];
  const footer = await read(end - 32, 32);
  if (ascii(footer.subarray(0, 8)) !== 'APETAGEX') return [];
  const length = little(footer.subarray(12, 16)), count = little(footer.subarray(16, 20));
  if (length < 32 || length > end) return [];
  const body = await whole(read, end - length, length - 32, 'APE');
  const found = [];
  let at = 0;
  for (let index = 0; index < count && at + 8 < body.length; index++) {
    const valueLength = little(body.subarray(at, at + 4)), flags = little(body.subarray(at + 4, at + 8));
    let keyEnd = at + 8;
    while (keyEnd < body.length && body[keyEnd] !== 0) keyEnd++;
    const key = ascii(body.subarray(at + 8, keyEnd)).toUpperCase(), value = body.subarray(keyEnd + 1, keyEnd + 1 + valueLength);
    // bits 1-2 of the flags give the kind of value; 0 is text
    if (LYRIC_TAGS.has(key) && (flags >> 1 & 3) === 0) found.push(item(key, utf8(value)));
    at = keyEnd + 1 + valueLength;
  }
  return found;
}

// ASF (WMA): named attributes in the header. Short values sit in the extended content
// description, long ones (over 64 KB) in the metadata library inside the header extension.
const guid = text => Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
const ASF_HEADER = guid('3026b2758e66cf11a6d900aa0062ce6c');
const ASF_EXTENDED_CONTENT = guid('40a4d0d207e3d21197f000a0c95ea850');
const ASF_HEADER_EXTENSION = guid('b503bf5f2ea9cf118ee300c00c205365');
const ASF_METADATA = guid('eacbf8c5af5b48778467aa8c44fa4cca');
const ASF_METADATA_LIBRARY = guid('941c23449894d149a1411d134e457054');
const same = (bytes, at, id) => id.every((byte, index) => bytes[at + index] === byte);
function* asfObjects(bytes, from, to) {
  while (from + 24 <= to) {
    const length = little(bytes.subarray(from + 16, from + 24));
    if (length < 24 || from + length > to) return;
    yield [from, from + 24, from + length];
    from += length;
  }
}
async function asf(read, position) {
  const top = await read(position, 30), length = little(top.subarray(16, 24));
  const header = await whole(read, position, length, 'ASF');
  const found = [];
  const keep = (name, type, value) => { if (type === 0 && LYRIC_TAGS.has(name.toUpperCase())) found.push(item(name.toUpperCase(), utf16(value))); };
  const records = (from, to) => {
    // metadata and metadata library records: language, stream, name length, type, value length
    let at = from + 2;
    for (let count = little(header.subarray(from, from + 2)); count > 0 && at + 12 <= to; count--) {
      const nameLength = little(header.subarray(at + 4, at + 6)), type = little(header.subarray(at + 6, at + 8)), valueLength = little(header.subarray(at + 8, at + 12));
      const name = utf16(header.subarray(at + 12, at + 12 + nameLength));
      keep(name, type, header.subarray(at + 12 + nameLength, at + 12 + nameLength + valueLength));
      at += 12 + nameLength + valueLength;
    }
  };
  for (const [start, from, to] of asfObjects(header, 30, header.length)) {
    if (same(header, start, ASF_EXTENDED_CONTENT)) {
      let at = from + 2;
      for (let count = little(header.subarray(from, from + 2)); count > 0 && at + 2 <= to; count--) {
        const nameLength = little(header.subarray(at, at + 2));
        const name = utf16(header.subarray(at + 2, at + 2 + nameLength));
        at += 2 + nameLength;
        const type = little(header.subarray(at, at + 2)), valueLength = little(header.subarray(at + 2, at + 4));
        keep(name, type, header.subarray(at + 4, at + 4 + valueLength));
        at += 4 + valueLength;
      }
    } else if (same(header, start, ASF_HEADER_EXTENSION)) {
      // 16 bytes of reserved GUID, 2 reserved, 4 of data size, then nested objects
      for (const [inner, innerFrom, innerTo] of asfObjects(header, from + 22, to)) {
        if (same(header, inner, ASF_METADATA) || same(header, inner, ASF_METADATA_LIBRARY)) records(innerFrom, innerTo);
      }
    }
  }
  return found;
}

/** Every lyric text embedded in the file, as items like those read from ID3 frames. */
export async function readEmbeddedLyrics(read, size) {
  const found = [];
  let start = 0, head = await read(0, 16);
  if (ascii(head.subarray(0, 3)) === 'ID3') {
    // MP3, AAC and TTA carry the tag in front; so can a FLAC file, before its own comments
    const tag = await id3At(read, 0);
    found.push(...tag.lyrics);
    start = tag.end;
    head = await read(start, 16);
  }
  const magic = ascii(head.subarray(0, 4));
  if (magic === 'fLaC') found.push(...await flac(read, start, size));
  else if (magic === 'OggS') found.push(...await ogg(read, start, size));
  else if (magic === 'RIFF') found.push(...await chunked(read, start, size, little));
  else if (magic === 'FORM') found.push(...await chunked(read, start, size, big));
  else if (ascii(head.subarray(4, 8)) === 'ftyp') found.push(...await mp4(read, start, size));
  else if (head.length >= 16 && same(head, 0, ASF_HEADER)) found.push(...await asf(read, start));
  else if (magic === 'MAC ' || magic === 'wvpk' || magic === 'TTA1') found.push(...await ape(read, size));
  return found;
}
