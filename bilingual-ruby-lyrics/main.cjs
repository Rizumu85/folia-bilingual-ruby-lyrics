'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Read only the bounded ID3 prefix; lyric editing and file writing belong to Folia/tooling.
module.exports = function activate(api) {
  api.rpc.handle('readEmbedded', async ({ audioPath }) => {
    if (typeof audioPath !== 'string' || !path.isAbsolute(audioPath) || !/\.mp3$/i.test(audioPath)) return [];
    const id3Url = pathToFileURL(path.join(__dirname, 'id3.mjs')).href + '?v=' + encodeURIComponent(api.manifest?.version || '');
    const { id3Header, parseId3, embeddedVersions } = await import(id3Url);
    const file = await fs.open(audioPath, 'r');
    try {
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
