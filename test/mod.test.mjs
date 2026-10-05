// Tests for the mod's own logic. All lyric text here is made up.
// Run: node --test test/mod.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairBilingual } from '../bilingual-ruby-lyrics/lyrics.mjs';
import { parseFaKara } from '../bilingual-ruby-lyrics/fa-kara.mjs';
import { parseId3 } from '../bilingual-ruby-lyrics/id3.mjs';
import { createIntegration } from '../bilingual-ruby-lyrics/integration.mjs';
import activate from '../bilingual-ruby-lyrics/client.mjs';

const line = (fullText, startTime, extra = {}) => ({ fullText, startTime, endTime: startTime + 2, words: [], ...extra });
const rubyOf = lines => lines.map(item => [item.fullText, (item.words || []).flatMap(word => word.syllables || []).filter(part => part.ruby?.length).map(part => part.text + '=' + part.ruby.map(r => r.text).join(''))]);

test('an original and its translation at the same time become one line', () => {
  const paired = pairBilingual([line('雨が歌う', 1), line('雨在歌唱', 1)]);
  assert.equal(paired.length, 1);
  assert.deepEqual([paired[0].fullText, paired[0].translation], ['雨が歌う', '雨在歌唱']);
});

test('a transliterated name with a middle dot is not mistaken for the Japanese original', () => {
  const paired = pairBilingual([line('NIGHT PARADE', 1), line('夜・游行ー', 1)]);
  assert.deepEqual([paired[0].fullText, paired[0].translation], ['NIGHT PARADE', '夜・游行ー']);
});

test('two sung lines that start together and each have a translation stay two lines', () => {
  const paired = pairBilingual([line('右から歌う', 1, { translation: '从右边唱' }), line('左から歌う', 1, { translation: '从左边唱' })]);
  assert.deepEqual(paired.map(item => [item.fullText, item.translation]), [['右から歌う', '从右边唱'], ['左から歌う', '从左边唱']]);
});

test('a reading stays on its own chunk and off the translation line sharing the timestamp', () => {
  const lrc = ['[00:10:00]知[00:10:50]らない[00:12:00]', '[00:10:00]不知道[00:12:00]', '@Offset=0', '@Ruby1=知,[00:00:00]し[00:00:50],[00:10:00],[00:10:00]', ''].join('\n');
  assert.deepEqual(rubyOf(parseFaKara(lrc).lines), [['知らない', ['知=し']], ['不知道', []]]);
});

test('a reading may cover text that is not kanji, in katakana', () => {
  const lrc = ['[00:01:00]夜の手[00:02:00]を[00:03:00]', '@Offset=0', '@Ruby1=夜の手,[00:00:00]ナイトハンド[00:01:00],[00:01:00],[00:01:00]', ''].join('\n');
  assert.deepEqual(rubyOf(parseFaKara(lrc).lines), [['夜の手を', ['夜の手=ナイトハンド']]]);
});

// ID3v2.4 tag made of the given frames: [id, payload bytes]
const synchsafe = size => [size >> 21 & 127, size >> 14 & 127, size >> 7 & 127, size & 127];
const tag = frames => {
  const body = frames.flatMap(([id, payload]) => [...Buffer.from(id), ...synchsafe(payload.length), 0, 0, ...payload]);
  return Uint8Array.from([73, 68, 51, 4, 0, 0, ...synchsafe(body.length + 16), ...body, ...new Array(16).fill(0)]);
};
const uslt = (descriptor, text) => [3, 106, 112, 110, ...Buffer.from(descriptor), 0, ...Buffer.from(text)];

test('an empty frame and an undecodable lyric frame do not hide the readable lyrics', () => {
  const parsed = parseId3(tag([['TIT2', []], ['USLT', [9, 9]], ['USLT', uslt('TimeTag-Ruby', '[00:01:00]a[00:02:00]')]]));
  assert.deepEqual(parsed.lyrics.map(item => [item.descriptor, item.text]), [['TimeTag-Ruby', '[00:01:00]a[00:02:00]']]);
});

// just enough of the host for the mod to activate
function fakeHost({ context = 'main' } = {}) {
  const registered = {}, logs = [], toasts = [], listeners = new Set();
  let values = {};
  const registry = name => ({ register: entry => { (registered[name] ||= []).push(entry); return name === 'settingsSections' ? { params } : () => {}; } });
  const params = { get: () => ({ primary: 'original', bilingual: true, ruby: true, poster: false, ...values }), set: next => { values = { ...values, ...next }; listeners.forEach(fn => fn()); }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const storeListeners = new Set();
  let state = { currentSong: null, lyrics: null, transitionDisplay: false, setLyricsState() {}, setCurrentLineIndex() {} };
  const playback = { getState: () => state, subscribe: fn => { storeListeners.add(fn); return () => storeListeners.delete(fn); }, change(next) { const previous = state; state = { ...state, ...next }; storeListeners.forEach(fn => fn(state, previous)); } };
  const folium = {
    host: { folium: { minor: 4 } }, env: { context },
    registries: new Proxy({}, { get: (_, name) => registry(name) }),
    internals: { stores: { playback, lyricSettings: { getState: () => ({}), subscribe: () => () => {} } } },
    log: { error: message => logs.push(message) }, ui: { toast: message => toasts.push(message) },
    rpc: { call: async () => [] }, playback: {}, theme: {},
  };
  return { folium, registered, params, playback, logs, toasts };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('the mod registers one display mode, one panel tab and one settings section', () => {
  const host = fakeHost();
  const dispose = activate(host.folium);
  assert.equal(host.registered.visualizers.length, 1);
  assert.equal(host.registered.playerPanelTabs.length, 1);
  assert.deepEqual(host.registered.settingsSections[0].settings.map(setting => setting.key), ['primary', 'bilingual', 'ruby', 'poster']);
  assert.equal(host.registered.settingsSections[0].settings.find(setting => setting.key === 'poster').defaultValue, false);
  assert.deepEqual(host.registered.commands.map(command => command.id), ['toggle-bilingual', 'toggle-ruby']);
  dispose();
});

test('poster lyrics touch nothing until the setting is switched on', () => {
  const host = fakeHost();
  activate(host.folium);
  const container = new Proxy({}, { get(_, name) { throw new Error('the poster layer touched its container (' + String(name) + ') while switched off'); } });
  const release = host.registered.stageLayers[0].mount(container, { lines: [], song: null });
  release();
});

test('a failed read of the embedded lyrics is reported once and not retried for the same song', async () => {
  const host = fakeHost();
  let reads = 0;
  const integration = createIntegration(host.folium, { readEmbedded: async () => { reads++; throw new Error('无法读取'); } });
  const song = { id: 'local', localData: { filePath: 'D:/music/test.mp3' } };
  host.playback.change({ currentSong: song, lyrics: { lines: [] } });
  await settle();
  host.playback.change({ lyrics: { lines: [] } });
  await settle();
  assert.equal(reads, 1);
  assert.equal(host.logs.length, 1);
  assert.equal(host.toasts.length, 1);
  integration.dispose();
});
