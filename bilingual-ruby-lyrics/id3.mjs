// A narrow ID3 frame reader. Lyric frames (USLT) are decoded; everything else in the tag
// is skipped. Nothing here writes to a file.
export const MAX_TAG_BYTES = 16 * 1024 * 1024;
const ascii = bytes => String.fromCharCode(...bytes);
const uint = bytes => bytes.reduce((n, byte) => n * 256 + byte, 0);
const sync = bytes => {
  if (bytes.some(byte => byte & 128)) throw new Error('ID3 长度字段无效');
  return bytes.reduce((n, byte) => n * 128 + byte, 0);
};
const deunsync = bytes => {
  const result = [];
  for (let i = 0; i < bytes.length; i++) { result.push(bytes[i]); if (bytes[i] === 255 && bytes[i+1] === 0) i++; }
  return Uint8Array.from(result);
};

export function id3Header(bytes) {
  if (ascii(bytes.subarray(0, 3)) !== 'ID3') return { version: 3, flags: 0, bodySize: 0, totalSize: 0 };
  if (bytes.length < 10 || ![2, 3, 4].includes(bytes[3]) || bytes[4] === 255) throw new Error('不支持或损坏的 ID3 标签');
  const bodySize = sync(bytes.subarray(6, 10));
  const totalSize = 10 + bodySize + (bytes[3] === 4 && bytes[5] & 16 ? 10 : 0);
  if (totalSize > MAX_TAG_BYTES) throw new Error('MP3 的 ID3 标签超过 16 MB');
  return { version: bytes[3], revision: bytes[4], flags: bytes[5], bodySize, totalSize };
}

function decodeText(bytes, encoding, inheritedEndian = 'utf-16le') {
  if (encoding === 0) return Array.from(bytes, byte => String.fromCharCode(byte)).join('').replace(/\0+$/, '');
  let charset = encoding === 3 ? 'utf-8' : encoding === 2 ? 'utf-16be' : inheritedEndian;
  if (encoding === 1 && bytes[0] === 255 && bytes[1] === 254) charset = 'utf-16le';
  if (encoding === 1 && bytes[0] === 254 && bytes[1] === 255) charset = 'utf-16be';
  if (![1, 2, 3].includes(encoding)) throw new Error('不支持的 ID3 歌词编码');
  return new TextDecoder(charset, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\0+$/, '');
}

function readUslt(payload) {
  if (payload.length < 5) throw new Error('ID3 歌词项不完整');
  const encoding = payload[0], wide = encoding === 1 || encoding === 2;
  let terminator = -1;
  for (let at = 4; at < payload.length; at += wide ? 2 : 1) {
    if (payload[at] === 0 && (!wide || payload[at+1] === 0)) { terminator = at; break; }
  }
  if (terminator < 0) throw new Error('ID3 歌词描述缺少结束符');
  const endian = payload[4] === 254 && payload[5] === 255 ? 'utf-16be' : 'utf-16le';
  const descriptor = decodeText(payload.subarray(4, terminator), encoding, endian);
  const text = decodeText(payload.subarray(terminator + (wide ? 2 : 1)), encoding, endian);
  if (text.length > 1024 * 1024) throw new Error('内嵌歌词超过解析上限');
  return { language: ascii(payload.subarray(1, 4)), descriptor, text };
}

export function parseId3(bytes) {
  const header = id3Header(bytes), frames = [], lyrics = [];
  if (!header.totalSize) return { ...header, frames, lyrics };
  if (bytes.length < header.totalSize) throw new Error('ID3 标签不完整');
  let body = bytes.subarray(10, 10 + header.bodySize);
  if (header.version < 4 && header.flags & 128) body = deunsync(body);
  if (header.version === 2 && header.flags & 64) throw new Error('暂不读取压缩的 ID3v2.2 标签');
  let at = 0;
  if (header.version >= 3 && header.flags & 64) {
    at = header.version === 3 ? 4 + uint(body.subarray(0, 4)) : sync(body.subarray(0, 4));
    if (at < 6 || at > body.length) throw new Error('ID3 扩展头无效');
  }
  const width = header.version === 2 ? 6 : 10;
  while (at < body.length && body[at] !== 0) {
    if (at + width > body.length) throw new Error('ID3 帧头不完整');
    const idWidth = header.version === 2 ? 3 : 4;
    const id = ascii(body.subarray(at, at + idWidth));
    if (!new RegExp('^[A-Z0-9]{' + idWidth + '}$').test(id)) throw new Error('ID3 帧标识无效');
    const size = header.version === 2 ? uint(body.subarray(at+3, at+6))
      : (header.version === 4 ? sync : uint)(body.subarray(at+4, at+8));
    const end = at + width + size;
    if (end > body.length) throw new Error('ID3 帧长度无效');
    if (!size) { at = end; continue; } // an empty frame is skipped, not fatal
    const flags = header.version === 2 ? 0 : body[at+9];
    const frame = { id, flags, raw: body.slice(at, end) };
    frames.push(frame);
    if (id === 'USLT' || id === 'ULT') {
      let payload = body.subarray(at+width, end);
      const unsupported = header.version === 3 ? flags & 192 : flags & 12;
      if (unsupported) { at = end; continue; } // compressed or encrypted lyrics: leave them to the host
      if (header.version === 4 && (header.flags & 128 || flags & 2)) payload = deunsync(payload);
      if (flags & (header.version === 3 ? 32 : 64)) payload = payload.subarray(1);
      if (header.version === 4 && flags & 1) payload = payload.subarray(4);
      try { const lyric = readUslt(payload); frame.lyric = lyric; lyrics.push(lyric); } catch { /* one undecodable lyric frame does not hide the others */ }
    }
    at = end;
  }
  return { ...header, frames, lyrics };
}

export function embeddedVersions(lyrics, name = 'MP3') {
  const hasRuby = text => /^@Ruby\d+=/m.test(text);
  const usable = lyrics.filter(item => /\[\d+:\d{2}(?:[:.]\d{2,3})?\]/.test(item.text));
  return usable.map(item => ({ ...item, format: 'lrc', embedded: true,
    kind: hasRuby(item.text) ? 'ruby' : 'plain',
    name: name + ' · ' + (hasRuby(item.text) ? '内嵌 Ruby LRC' : '内嵌普通 LRC'),
  })).sort((a, b) => (a.kind === 'ruby' ? 0 : a.descriptor === '' ? 1 : 2) - (b.kind === 'ruby' ? 0 : b.descriptor === '' ? 1 : 2));
}
