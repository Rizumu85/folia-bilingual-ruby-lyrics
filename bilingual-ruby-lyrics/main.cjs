'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Read only headers and the tag area of the playing file; lyric editing and file writing belong
// to Folia/tooling.
module.exports = function activate(api) {
  const load = name => import(pathToFileURL(path.join(__dirname, name)).href + '?v=' + encodeURIComponent(api.manifest?.version || ''));
  api.rpc.handle('readEmbedded', async ({ audioPath }) => {
    const { readEmbeddedLyrics, AUDIO_FILE } = await load('tags.mjs');
    if (typeof audioPath !== 'string' || !path.isAbsolute(audioPath) || !AUDIO_FILE.test(audioPath)) return [];
    const { embeddedVersions } = await load('id3.mjs');
    const file = await fs.open(audioPath, 'r');
    try {
      const read = async (offset, length) => {
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await file.read(bytes, 0, length, offset);
        return bytes.subarray(0, bytesRead);
      };
      const { size } = await file.stat();
      return embeddedVersions(await readEmbeddedLyrics(read, size), path.basename(audioPath));
    } finally {
      await file.close();
    }
  });
};
