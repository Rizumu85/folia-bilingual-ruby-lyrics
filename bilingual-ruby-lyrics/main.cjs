'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Read only the tag area (the bounded ID3 prefix of an MP3, the comment block of a FLAC, the
// moov atom of an M4A); lyric editing and file writing belong to Folia/tooling.
module.exports = function activate(api) {
  api.rpc.handle('readEmbedded', async ({ audioPath }) => {
    if (typeof audioPath !== 'string' || !path.isAbsolute(audioPath) || !/\.(mp3|flac|m4a)$/i.test(audioPath)) return [];
    const id3Url = pathToFileURL(path.join(__dirname, 'id3.mjs')).href + '?v=' + encodeURIComponent(api.manifest?.version || '');
    const { id3Header, parseId3, embeddedVersions } = await import(id3Url);
    const file = await fs.open(audioPath, 'r');
    try {
      if (!/\.mp3$/i.test(audioPath)) {
        const tagsUrl = pathToFileURL(path.join(__dirname, 'tags.mjs')).href + '?v=' + encodeURIComponent(api.manifest?.version || '');
        const { readTagLyrics } = await import(tagsUrl);
        const read = async (offset, length) => {
          const bytes = Buffer.alloc(length);
          const { bytesRead } = await file.read(bytes, 0, length, offset);
          return bytes.subarray(0, bytesRead);
        };
        const { size } = await file.stat();
        return embeddedVersions(await readTagLyrics(read, size, path.basename(audioPath)), path.basename(audioPath));
      }
      const first = Buffer.alloc(10);
      await file.read(first, 0, 10, 0);
      const info = id3Header(first);
      if (!info.totalSize) return [];
      const bytes = Buffer.alloc(info.totalSize);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== bytes.length) throw new Error('MP3 的 ID3 标签不完整');
      return embeddedVersions(parseId3(bytes).lyrics, path.basename(audioPath));
    } finally {
      await file.close();
    }
  });
};
