'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// @modules  (the build puts id3.mjs and tags.mjs here, as __id3 and __tags)

// Read only headers and the tag area of the playing file; lyric editing and file writing belong
// to Folia/tooling.
module.exports = function activate(api) {
  api.rpc.handle('readEmbedded', async ({ audioPath }) => {
    if (typeof audioPath !== 'string' || !path.isAbsolute(audioPath) || !__tags.AUDIO_FILE.test(audioPath)) return [];
    const file = await fs.open(audioPath, 'r');
    try {
      const read = async (offset, length) => {
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await file.read(bytes, 0, length, offset);
        return bytes.subarray(0, bytesRead);
      };
      const { size } = await file.stat();
      return __id3.embeddedVersions(await __tags.readEmbeddedLyrics(read, size), path.basename(audioPath));
    } finally {
      await file.close();
    }
  });
};
