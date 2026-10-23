import { embeddedVersions } from './id3.mjs';
import { readEmbeddedLyrics, AUDIO_FILE } from './tags.mjs';

// Folia keeps a local song's file in its own database (table local_music). The song a mod is given
// carries the title, artists and album the file is shown with, but not the file, so the record is
// looked up by those; the song's length breaks a tie. Only a few fields of each record are kept,
// and the database is only read: never upgraded, created or written.
let catalogue = null;  // title -> [{ filePath, artists, albums, seconds }]
const artistsOf = record => [
  (record.importedMetadata?.artistNames || []).join(' / '),
  (record.onlineMetadata?.artists || []).map(artist => artist?.name).filter(Boolean).join(' / '),
];
const albumsOf = record => [record.importedMetadata?.albumName, record.onlineMetadata?.album?.name].filter(Boolean);

function readCatalogue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('KineticPlayerDB');
    request.onupgradeneeded = () => { request.transaction.abort(); };
    request.onerror = () => reject(new Error('无法读取 Folia 本地歌曲资料'));
    request.onsuccess = () => {
      const db = request.result, titles = new Map();
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains('local_music')) { db.close(); resolve(titles); return; }
      const transaction = db.transaction('local_music', 'readonly');
      const cursor = transaction.objectStore('local_music').openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return;
        const record = at.value;
        if (record?.title && record.filePath) {
          if (!titles.has(record.title)) titles.set(record.title, []);
          titles.get(record.title).push({ filePath: record.filePath, artists: artistsOf(record), albums: albumsOf(record), seconds: (Number(record.duration) || 0) / 1000 });
        }
        at.continue();
      };
      cursor.onerror = () => reject(new Error('无法读取 Folia 本地歌曲资料'));
      transaction.oncomplete = () => { db.close(); resolve(titles); };
      transaction.onabort = () => { db.close(); reject(new Error('本地歌曲读取被中断')); };
    };
  });
}

/** The local files a song (as mods see it) may be, the likeliest first; usually one. */
export async function findLocalRecords(song, seconds = 0, fresh = false) {
  if (song?.source !== 'local' || !song.title || typeof indexedDB === 'undefined') return [];
  if (!catalogue || fresh) catalogue = await readCatalogue();
  let found = catalogue.get(song.title) || [];
  // a song added since the catalogue was read
  if (!found.length && !fresh) return findLocalRecords(song, seconds, true);
  const narrow = (list, keep) => { const kept = list.filter(keep); return kept.length ? kept : list; };
  found = narrow(found, item => item.artists.includes(song.artist || ''));
  if (song.album) found = narrow(found, item => item.albums.includes(song.album));
  // closest length first; none is dropped, since which file it is shows only in its lyrics
  if (found.length > 1 && seconds > 0) found = [...found].sort((a, b) => Math.abs(a.seconds - seconds) - Math.abs(b.seconds - seconds));
  return found;
}

function readHostRecord(table, key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('KineticPlayerDB');
    request.onupgradeneeded = () => { request.transaction.abort(); };
    request.onerror = () => reject(new Error('无法读取 Folia 本地歌曲资料'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains(table)) { db.close(); resolve(null); return; }
      const transaction = db.transaction(table, 'readonly');
      const record = transaction.objectStore(table).get(key);
      record.onsuccess = () => resolve(record.result || null);
      record.onerror = () => reject(new Error('无法读取当前本地歌曲'));
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => { db.close(); reject(new Error('本地歌曲读取被中断')); };
    };
  });
}

export const isAbsoluteAudioPath = value => /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value || '');

const hostHandles = async () => (await readHostRecord('api_cache', 'local_dir_handles'))?.data || {};
async function audioDirectory(record, getHandles = hostHandles) {
  const pieces = record.filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (pieces.some(piece => piece === '..' || piece === '.')) throw new Error('本地歌曲的相对路径无效');
  const rootName = pieces.shift(), fileName = pieces.pop();
  const handles = await getHandles();
  let directory = handles[rootName];
  if (!directory) throw new Error('Folia 未保存该音乐目录的访问权限');
  if (typeof directory.queryPermission === 'function' && await directory.queryPermission({ mode: 'read' }) !== 'granted') throw new Error('音乐目录的读取权限已失效，请在 Folia 中重新连接目录');
  for (const segment of pieces) directory = await directory.getDirectoryHandle(segment);
  return { directory, fileName };
}

export async function readLocalEmbedded(record, rpc, getHandles = hostHandles) {
  if (!record?.filePath || !AUDIO_FILE.test(record.filePath)) return [];
  if (isAbsoluteAudioPath(record.filePath)) return rpc.call('readEmbedded', { audioPath: record.filePath });
  const { directory, fileName } = await audioDirectory(record, getHandles);
  const file = await (await directory.getFileHandle(fileName)).getFile();
  const read = async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  return embeddedVersions(await readEmbeddedLyrics(read, file.size), fileName);
}
