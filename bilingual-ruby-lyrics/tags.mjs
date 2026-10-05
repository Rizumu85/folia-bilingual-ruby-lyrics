// Reads the Ruby lyrics kept in FLAC and M4A files, where they sit in a tag named RUBY_LYRICS
// (a Vorbis comment in FLAC, the freeform atom ----:com.apple.iTunes:RUBY_LYRICS in M4A).
// `read(offset, length)` returns that part of the file; only the tag area is ever asked for.
// Nothing here writes to a file.
export const RUBY_TAG = 'RUBY_LYRICS';
const MAX_BYTES = 16 * 1024 * 1024;
const ascii = bytes => String.fromCharCode(...bytes);
const big = bytes => bytes.reduce((n, byte) => n * 256 + byte, 0);
const little = bytes => bytes.reduceRight((n, byte) => n * 256 + byte, 0);
const utf8 = bytes => new TextDecoder('utf-8').decode(bytes);

async function flacLyrics(read, size) {
  let position = 0;
  let head = await read(0, 10);
  if (ascii(head.subarray(0, 3)) === 'ID3') {
    // an ID3 tag in front of the FLAC stream: step over it (sizes are 7 bits per byte)
    position = 10 + head.subarray(6, 10).reduce((n, byte) => n * 128 + (byte & 127), 0);
    head = await read(position, 4);
  }
  if (ascii(head.subarray(0, 4)) !== 'fLaC') return [];
  position += 4;
  for (let last = false; !last && position + 4 <= size;) {
    const header = await read(position, 4), length = big(header.subarray(1, 4));
    last = (header[0] & 128) !== 0;
    position += 4;
    if ((header[0] & 127) === 4) {
      if (length > MAX_BYTES) throw new Error('FLAC 的标签区过大');
      const block = await read(position, length);
      if (block.length !== length) throw new Error('FLAC 的标签不完整');
      const texts = [];
      let at = 4 + little(block.subarray(0, 4));
      const count = little(block.subarray(at, at + 4)); at += 4;
      for (let index = 0; index < count && at + 4 <= block.length; index++) {
        const end = at + 4 + little(block.subarray(at, at + 4));
        const comment = block.subarray(at + 4, end), equals = comment.indexOf(61);
        if (equals > 0 && ascii(comment.subarray(0, equals)).toUpperCase() === RUBY_TAG) texts.push(utf8(comment.subarray(equals + 1)));
        at = end;
      }
      return texts;
    }
    position += length;
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

async function m4aLyrics(read, size) {
  // top-level atoms: only headers are read until moov, which holds the tags
  for (let position = 0; position + 8 <= size;) {
    const header = await read(position, 16);
    let length = big(header.subarray(0, 4)), headerSize = 8;
    if (length === 1) { length = big(header.subarray(8, 16)); headerSize = 16; }
    else if (length === 0) length = size - position;
    if (length < headerSize) return [];
    if (ascii(header.subarray(4, 8)) === 'moov') {
      if (length > MAX_BYTES) throw new Error('M4A 的标签区过大');
      const moov = await read(position + headerSize, length - headerSize);
      const udta = child(moov, 0, moov.length, 'udta');
      const meta = udta && child(moov, udta[1], udta[2], 'meta');
      // meta has four bytes of version and flags before its children
      const list = meta && child(moov, meta[1] + 4, meta[2], 'ilst');
      const texts = [];
      for (const [type, from, to] of list ? atoms(moov, list[1], list[2]) : []) {
        if (type !== '----') continue;
        const name = child(moov, from, to, 'name'), data = child(moov, from, to, 'data');
        if (name && data && ascii(moov.subarray(name[1] + 4, name[2])).toUpperCase() === RUBY_TAG) texts.push(utf8(moov.subarray(data[1] + 8, data[2])));
      }
      return texts;
    }
    position += length;
  }
  return [];
}

/** The Ruby lyric texts in a FLAC or M4A file, as lyric items like those read from ID3. */
export async function readTagLyrics(read, size, fileName) {
  const texts = /\.flac$/i.test(fileName) ? await flacLyrics(read, size) : /\.m4a$/i.test(fileName) ? await m4aLyrics(read, size) : [];
  return texts.map(text => ({ language: '', descriptor: RUBY_TAG, text }));
}
