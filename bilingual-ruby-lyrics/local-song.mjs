import { id3Header, parseId3, embeddedVersions } from './id3.mjs';

// Folia 0.7.12: the current carrier stores a UUID; its file path is in local_music.
// This read-only lookup deliberately never upgrades, creates or writes the host database.
export async function readLocalSong(song) {
  if (song?.localData?.filePath) return song.localData;
  const id = song?.localRef?.songId;
  if (!id || typeof indexedDB === 'undefined') return null;
  return readHostRecord('local_music', id);
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
  if (!record?.filePath || !/\.mp3$/i.test(record.filePath)) return [];
  if (isAbsoluteAudioPath(record.filePath)) return rpc.call('readEmbedded', { audioPath: record.filePath });
  const { directory, fileName } = await audioDirectory(record, getHandles);
  const file = await (await directory.getFileHandle(fileName)).getFile();
  const info = id3Header(new Uint8Array(await file.slice(0, 10).arrayBuffer()));
  if (!info.totalSize) return [];
  const bytes = new Uint8Array(await file.slice(0, info.totalSize).arrayBuffer());
  return embeddedVersions(parseId3(bytes).lyrics, fileName);
}

export function songIdentity(song, record = null) {
  if (!song) return null;
  record ||= song.localData;
  if (isAbsoluteAudioPath(record?.filePath)) return 'local-file:' + record.filePath.replace(/\\/g, '/').normalize('NFC').toLowerCase();
  if (song.localRef?.songId) return 'local-id:' + song.localRef.songId;
  const ref = song.sourceRef;
  return JSON.stringify([ref?.kind || 'online', ref?.providerId || song.providerId || 'netease', String(ref?.mediaId ?? song.id), ref?.variant || '']);
}
