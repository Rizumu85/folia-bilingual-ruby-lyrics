// Tests for the mod's own logic. All lyric text here is made up.
// The logic is tested from src/; activation and the file reader are tested on the built files
// Folia actually loads. Run: node --test test/mod.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairBilingual } from '../src/lyrics.mjs';
import { parseFaKara } from '../src/fa-kara.mjs';
import { parseId3 } from '../src/id3.mjs';
import { createIntegration } from '../src/integration.mjs';
import { romanizeLine } from '../src/romaji.mjs';
import { readEmbeddedLyrics } from '../src/tags.mjs';
import activate from '../bilingual-ruby-lyrics/client.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const firstLine = lrc => parseFaKara(lrc).lines[0];

test('a line is romanized from its readings, with particles as they are said', () => {
  const lrc = ['[00:01:00]君[00:01:50]は[00:02:00]窓[00:02:50]の[00:03:00]外[00:03:50]へ[00:04:00]', '@Offset=0',
    '@Ruby1=君,[00:00:00]きみ[00:00:50]', '@Ruby2=窓,[00:00:00]まど[00:00:50]', '@Ruby3=外,[00:00:00]そと[00:00:50]', ''].join('\n');
  assert.equal(romanizeLine(firstLine(lrc)), 'kimi wa mado no soto e');
});

test('a special reading, doubled consonants, long marks and loanword sounds are spelled as sung', () => {
  const special = ['[00:01:00]運命[00:02:00]を[00:02:50]待[00:03:00]って[00:04:00]', '@Offset=0', '@Ruby1=運命,[00:00:00]さだめ[00:01:00]', '@Ruby2=待,[00:00:00]ま[00:00:50]', ''].join('\n');
  assert.equal(romanizeLine(firstLine(special)), 'sadame o matte');
  const ending = ['[00:01:00]始[00:01:50]まり[00:02:00]の[00:02:50]歌[00:03:00]', '@Offset=0', '@Ruby1=始,[00:00:00]はじ[00:00:50]', '@Ruby2=歌,[00:00:00]うた[00:00:50]', ''].join('\n');
  assert.equal(romanizeLine(firstLine(ending)), 'hajimari no uta');
  const loan = ['[00:01:00]夜の手[00:02:00]パーティー[00:03:00]しんや[00:04:00]', '@Offset=0', '@Ruby1=夜の手,[00:00:00]ナイトハンド[00:01:00]', ''].join('\n');
  assert.equal(romanizeLine(firstLine(loan)).replace(/[ ']/g, ''), 'naitohandopaatiishinya');
});

test('Hangul is romanized from its readings, and lines with nothing to spell get no romanization', () => {
  const korean = ['[00:01:00]바[00:01:50]다[00:02:00] [00:02:10]가[00:03:00]', '@Offset=0', '@Ruby1=바,[00:00:00]ba[00:00:50]', '@Ruby2=다,[00:00:00]da[00:00:50]', '@Ruby3=가,[00:00:00]ga[00:00:50]', ''].join('\n');
  assert.equal(romanizeLine(firstLine(korean)), 'bada ga');
  assert.equal(romanizeLine({ fullText: 'Night parade', words: [{ text: 'Night parade', startTime: 1, endTime: 2 }] }), undefined);
  assert.equal(romanizeLine({ fullText: '窗外的雨', words: [{ text: '窗外的雨', startTime: 1, endTime: 2 }] }), undefined);
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

const be = (value, bytes) => Array.from({ length: bytes }, (_, index) => value / 256 ** (bytes - 1 - index) & 255);
const le = (value, bytes) => be(value, bytes).reverse();
const reader = bytes => [async (offset, length) => Uint8Array.from(bytes.slice(offset, offset + length)), bytes.length];
const RUBY_TEXT = '[00:01:00]歌[00:02:00]\n@Ruby1=歌,[00:00:00]うた[00:01:00]';

test('Ruby lyrics are read from the comment block of a FLAC file', async () => {
  const comment = text => { const data = [...Buffer.from(text)]; return [...le(data.length, 4), ...data]; };
  const comments = [...le(4, 4), ...Buffer.from('test'), ...le(2, 4), ...comment('TITLE=x'), ...comment('ruby_lyrics=' + RUBY_TEXT)];
  const block = (type, body, last) => [type | (last ? 128 : 0), ...be(body.length, 3), ...body];
  const file = [...Buffer.from('fLaC'), ...block(0, new Array(34).fill(0), false), ...block(4, comments, true), 255, 248, 1, 2];
  assert.deepEqual((await readEmbeddedLyrics(...reader(file))).map(item => item.text), [RUBY_TEXT]);
});

test('Ruby lyrics are read from the tags of an M4A file, wherever the tag atom sits', async () => {
  const atom = (type, body) => [...be(body.length + 8, 4), ...Buffer.from(type, 'latin1'), ...body];
  const freeform = atom('----', [...atom('mean', [0, 0, 0, 0, ...Buffer.from('com.apple.iTunes')]), ...atom('name', [0, 0, 0, 0, ...Buffer.from('RUBY_LYRICS')]), ...atom('data', [0, 0, 0, 1, 0, 0, 0, 0, ...Buffer.from(RUBY_TEXT)])]);
  const moov = atom('moov', [...atom('mvhd', new Array(20).fill(0)), ...atom('udta', atom('meta', [0, 0, 0, 0, ...atom('hdlr', new Array(25).fill(0)), ...atom('ilst', [...atom('\u00a9nam', atom('data', [0, 0, 0, 1, 0, 0, 0, 0, 120])), ...freeform])]))]);
  const file = [...atom('ftyp', [...Buffer.from('M4A ')]), ...atom('mdat', [1, 2, 3, 4, 5]), ...moov];
  assert.deepEqual((await readEmbeddedLyrics(...reader(file))).map(item => item.text), [RUBY_TEXT]);
});

test('Ruby lyrics are read from an Ogg stream whose comment packet is spread over pages', async () => {
  const comment = text => { const data = [...Buffer.from(text)]; return [...le(data.length, 4), ...data]; };
  const packet = [...Buffer.from('OpusTags'), ...le(4, 4), ...Buffer.from('test'), ...le(1, 4), ...comment('RUBY_LYRICS=' + RUBY_TEXT + 'x'.repeat(600))];
  const page = (sequence, segments, body) => [...Buffer.from('OggS'), 0, 0, ...new Array(8).fill(0), ...le(7, 4), ...le(sequence, 4), 0, 0, 0, 0, segments.length, ...segments, ...body];
  const head = [...Buffer.from('OpusHead'), ...new Array(11).fill(0)];
  // the comment packet: 255 + 255 bytes on one page, the rest on the next
  const rest = packet.length - 510;
  const file = [...page(0, [head.length], head), ...page(1, [255, 255], packet.slice(0, 510)), ...page(2, [rest], packet.slice(510)), ...page(3, [3], [1, 2, 3])];
  assert.deepEqual((await readEmbeddedLyrics(...reader(file))).map(item => item.text), [RUBY_TEXT + 'x'.repeat(600)]);
});

test('Ruby lyrics are read from the ID3 chunk of a WAV file and the APE tag at the end of a file', async () => {
  const id3 = [...tag([['USLT', uslt('TimeTag-Ruby', RUBY_TEXT)]])];
  const chunk = (id, body) => [...Buffer.from(id), ...le(body.length, 4), ...body, ...(body.length & 1 ? [0] : [])];
  const chunks = [...chunk('fmt ', new Array(16).fill(0)), ...chunk('data', [1, 2, 3]), ...chunk('id3 ', id3)];
  const wav = [...Buffer.from('RIFF'), ...le(chunks.length + 4, 4), ...Buffer.from('WAVE'), ...chunks];
  assert.deepEqual((await readEmbeddedLyrics(...reader(wav))).map(item => [item.descriptor, item.text]), [['TimeTag-Ruby', RUBY_TEXT]]);

  const value = [...Buffer.from(RUBY_TEXT)];
  const items = [...le(value.length, 4), 0, 0, 0, 0, ...Buffer.from('Ruby_Lyrics'), 0, ...value];
  const footer = [...Buffer.from('APETAGEX'), ...le(2000, 4), ...le(items.length + 32, 4), ...le(1, 4), ...new Array(12).fill(0)];
  const apeFile = [...Buffer.from('wvpk'), ...new Array(40).fill(9), ...items, ...footer];
  assert.deepEqual((await readEmbeddedLyrics(...reader(apeFile))).map(item => item.text), [RUBY_TEXT]);
});

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('the files Folia loads are what the sources build, each in one file', () => {
  const check = spawnSync(process.execPath, [path.join(HERE, '..', 'tools', 'build.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  for (const name of ['client.mjs', 'main.cjs']) {
    const text = fs.readFileSync(path.join(HERE, '..', 'bilingual-ruby-lyrics', name), 'utf8');
    // a helper loaded by a relative path would survive a reload of the mod and run stale
    assert.doesNotMatch(text, /^import |\bimport\(|require\('\.\.?\//m, name + ' loads another file of the mod');
  }
});

test('the built main entry reads the Ruby lyrics out of a file on disk', async () => {
  const comment = text => { const data = [...Buffer.from(text)]; return [...le(data.length, 4), ...data]; };
  const comments = [...le(4, 4), ...Buffer.from('test'), ...le(1, 4), ...comment('RUBY_LYRICS=' + RUBY_TEXT)];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ruby-mod-')), 'made-up.flac');
  fs.writeFileSync(file, Uint8Array.from([...Buffer.from('fLaC'), 4 | 128, ...be(comments.length, 3), ...comments, 255, 248]));
  const handlers = {};
  createRequire(import.meta.url)('../bilingual-ruby-lyrics/main.cjs')({ rpc: { handle: (name, handler) => { handlers[name] = handler; } } });
  try {
    const found = await handlers.readEmbedded({ audioPath: file });
    assert.deepEqual(found.map(item => [item.kind, item.text]), [['ruby', RUBY_TEXT]]);
    assert.deepEqual(await handlers.readEmbedded({ audioPath: file + '.txt' }), []);
  } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});

// just enough of the host for the mod to activate
function fakeHost({ context = 'main' } = {}) {
  const registered = {}, logs = [], toasts = [], listeners = new Set();
  let values = {};
  const registry = name => ({ register: entry => { (registered[name] ||= []).push(entry); return name === 'settingsSections' ? { params } : () => {}; } });
  const params = { get: () => ({ primary: 'original', bilingual: true, ruby: true, strip: 'off', poster: false, ...values }), set: next => { values = { ...values, ...next }; listeners.forEach(fn => fn()); }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const storeListeners = new Set();
  let state = { currentSong: null, lyrics: null, transitionDisplay: false, setLyricsState() {}, setCurrentLineIndex() {} };
  const playback = { getState: () => state, subscribe: fn => { storeListeners.add(fn); return () => storeListeners.delete(fn); }, change(next) { const previous = state; state = { ...state, ...next }; storeListeners.forEach(fn => fn(state, previous)); } };
  const folium = {
    host: { folium: { minor: 4 } }, env: { context },
    registries: new Proxy({}, { get: (_, name) => registry(name) }),
    internals: { stores: { playback, lyricSettings: { getState: () => ({}), subscribe: () => () => {} }, visualizerSettings: { getState: () => ({ visualizerMode: 'classic' }), subscribe: () => () => {} } } },
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
  assert.deepEqual(host.registered.settingsSections[0].settings.map(setting => setting.key), ['primary', 'bilingual', 'ruby', 'strip', 'poster']);
  assert.equal(host.registered.settingsSections[0].settings.find(setting => setting.key === 'poster').defaultValue, false);
  assert.deepEqual(host.registered.commands.map(command => command.id), ['toggle-bilingual', 'toggle-ruby', 'caption-position', 'toggle-caption']);
  // the position command flips bottom and top, and switches the caption on when it is off
  const position = host.registered.commands.find(command => command.id === 'caption-position');
  const after = () => { position.run(); return host.params.get().strip; };
  assert.deepEqual([after(), after(), after()], ['bottom', 'top', 'bottom']);
  dispose();
});

test('poster lyrics and the ruby caption touch nothing until their settings are switched on', () => {
  const host = fakeHost();
  activate(host.folium);
  const container = new Proxy({}, { get(_, name) { throw new Error('the poster layer touched its container (' + String(name) + ') while switched off'); } });
  const lines = [{ words: [{ syllables: [{ text: '歌', ruby: [{ text: 'うた' }] }] }] }];
  for (const layer of host.registered.stageLayers) layer.mount(container, { lines, song: null })();
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
