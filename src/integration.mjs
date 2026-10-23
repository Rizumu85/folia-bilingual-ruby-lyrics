import { pairBilingual } from './lyrics.mjs';
import { findLocalRecords, readLocalEmbedded } from './local-song.mjs';
import { parseFaKara } from './fa-kara.mjs';
import { withRomanization } from './romaji.mjs';

const cleanHints = lines => lines.map(({renderHints,...line}) => line);
const translationsOf = line => (line?.alternateTexts || []).filter(item => item?.role==='translation' && item.text);
const translationOf = line => line?.translation || translationsOf(line)[0]?.text;
// A raw o_ruby.lrc has no translation rows; keep the ones Folia already resolved for the same lines.
const carryTranslations = (lines,hostLines) => {
  const host=(hostLines || []).filter(translationOf);
  if (!host.length || lines.some(translationOf)) return lines;
  return lines.map(line => {
    const match=host.find(item => Math.abs(item.startTime-line.startTime)<=.02) || host.find(item => item.fullText===line.fullText);
    if (!match) return line;
    const alternateTexts=[...(line.alternateTexts || []),...translationsOf(match)];
    return {...line,translation:translationOf(match),...(alternateTexts.length ? {alternateTexts} : {})};
  });
};
// What Folia worked out for its own copy of a line stays on ours: the chorus mark and its light
// effect, the song part, the singer, background vocals, saved word boundaries. Only the text, the
// timing and the readings come from the file. Render hints follow the timing, so they are left
// for the host to rebuild.
const FROM_THE_FILE = new Set(['words','startTime','endTime','fullText','translation','romanization','alternateTexts','renderHints']);
const keepHostData = (lines,hostLines) => {
  const host=hostLines || [];
  if (!host.length) return lines;
  const near = (item,line) => Math.abs(item.startTime-line.startTime)<=.02;
  return lines.map(line => {
    const match=host.find(item => near(item,line) && item.fullText===line.fullText) || host.find(item => near(item,line)) || host.find(item => item.fullText===line.fullText);
    if (!match) return line;
    const kept=Object.fromEntries(Object.entries(match).filter(([name]) => !FROM_THE_FILE.has(name)));
    // word boundaries only fit the text they were made for: the user's saved ones, and (0.7.19 on)
    // the ones Folia works out by itself
    for (const name of ['wordSegments','autoWordSegments'])
      if (Array.isArray(kept[name]) && kept[name].join('')!==line.fullText) delete kept[name];
    return {...kept,...line};
  });
};
const hasRuby = lines => lines?.some(line => line.words?.some(word => word.ruby?.length || word.syllables?.some(unit => unit.ruby?.length)));
// Whether Folia is showing the lyrics embedded in the file (the plain version written beside the
// readings) rather than lyrics from somewhere else: online ones, a lyric file next to the song, a
// version the user picked, or none at all for a song marked instrumental. Most of its lines then
// have a line of ours at the same time with the same text.
const fromTheFile = (ours,host) => {
  let same=0;
  for (const line of host) if (ours.some(item => Math.abs(item.startTime-line.startTime)<=.05 && item.fullText===line.fullText)) same++;
  return same>=Math.max(1,Math.ceil(.6*Math.min(host.length,ours.length)));
};
const KEEP = 16;  // songs whose readings are remembered

// The readings come in through Folia's own lyrics hook: when the lyrics of a song reach the player,
// `lyrics.transform` hands its lines here and the lines with readings go back in their place. The
// hook is synchronous and reading the file is not, so the first time a song comes by its file is
// read, and once it has been, `folium.lyrics.refresh()` has Folia run the hook again. Folia owns
// the choice of lyric source and the offset clock: the lines are only replaced while Folia shows
// the lyrics embedded in the file, which the readings are a richer version of.
export function createIntegration(folium, {readEmbedded = record => readLocalEmbedded(record,folium.rpc), findRecords = findLocalRecords} = {}) {
  const known = new Map();  // song key -> [parsed lyrics, one per matching file] | null | a pending read
  let disposed=false, asked=null, reported=null;
  let state={song:null,embedded:false,error:null,ready:false};
  const keyOf = song => song?.source==='local' && song.title ? JSON.stringify([song.id,song.title,song.artist,song.album]) : null;
  const remember = (key,value) => {
    known.delete(key); known.set(key,value);
    while (known.size>KEEP) known.delete(known.keys().next().value);
  };
  const load = song => {
    const key=keyOf(song);
    const job=(async () => {
      const seconds=folium.playback?.getState?.()?.duration || 0;
      const readAll = async records => {
        const found=[];
        for (const record of records.slice(0,3)) {
          for (const source of await readEmbedded(record)) {
            // Ordinary embedded lyrics are already Folia's.
            if (!/@Ruby\d*\s*=/.test(source.text)) continue;
            try {
              const lyrics=parseFaKara(source.text);
              if (hasRuby(lyrics?.lines)) {found.push(lyrics);break;}
            } catch { /* a malformed extension: the host's normal lyrics stay */ }
          }
        }
        return found;
      };
      let found;
      try {found=await readAll(await findRecords(song,seconds));}
      // the file may have moved since Folia's table was read: look it up there again, once
      catch {found=await readAll(await findRecords(song,seconds,true));}
      return found.length ? found : null;
    })();
    remember(key,job);
    job.then(found => {
      if (disposed || known.get(key)!==job) return;
      remember(key,found);
      if (!found) state={song,embedded:false,error:null,ready:true};
      const shown=keyOf(folium.playback?.getState?.()?.song);
      if (found && (shown===key || asked===key)) folium.lyrics.refresh();
    }, error => {
      if (disposed || known.get(key)!==job) return;
      // Keep the host's own lyrics, do not read the file again for this song, and say why once.
      remember(key,null);
      state={song,embedded:false,error:error.message,ready:true};
      if (reported!==key) {
        reported=key;
        folium.log.error('内嵌注音歌词读取失败：'+error.message);
        folium.ui?.toast?.('内嵌注音歌词读取失败：'+error.message,{type:'info',durationMs:4000});
      }
    });
  };
  // A song that comes back is read again: its file may have been written in between (new readings,
  // corrected timing). Only the song on now is kept (during an automix blend the incoming track is
  // asked for before it is on, and is on by the time this fires).
  const stopSong=folium.events.on('playback.songChanged', event => {
    const now=keyOf(event.song);
    for (const key of [...known.keys()]) if (key!==now) known.delete(key);
  });
  const stop=folium.events.on('lyrics.transform', event => {
    const key=keyOf(event.song);
    if (!key || !event.lines?.length || hasRuby(event.lines)) return;
    asked=key;
    const entry=known.get(key);
    if (entry===undefined) {load(event.song);return;}
    if (!Array.isArray(entry)) return;  // no readings in the file, or still reading it
    const rich=entry.find(lyrics => fromTheFile(lyrics.lines,event.lines));
    if (!rich) {state={song:event.song,embedded:false,error:null,ready:true};return;}
    // Folia's own modes show the romanization line when its subtitle setting asks for it.
    event.lines=withRomanization(keepHostData(cleanHints(carryTranslations(pairBilingual(rich.lines),event.lines)),event.lines));
    state={song:event.song,embedded:true,error:null,ready:true};
  });
  return {
    get:()=>({...state}),
    dispose() {
      disposed=true;stop?.();stopSong?.();known.clear();
      // Folia runs the hook again without this handler: its own lyrics come back.
      try {folium.lyrics.refresh();} catch { /* the host is going away */ }
    },
  };
}
