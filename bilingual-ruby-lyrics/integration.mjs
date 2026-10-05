import { pairBilingual } from './lyrics.mjs';
import { readLocalSong, songIdentity, readLocalEmbedded } from './local-song.mjs';
import { parseFaKara } from './fa-kara.mjs';

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
const hasRuby = lines => lines?.some(line => line.words?.some(word => word.ruby?.length || word.syllables?.some(unit => unit.ruby?.length)));
// Same source precedence as Folia 0.7.12 selectLocalSongLyricsSource.
const hostSource = (record,priority) => {
  if (record?.lyricsSource) return record.lyricsSource;
  if (priority==='online' && record?.matchedLyrics) return 'online';
  if (record?.hasLocalLyrics && record.localLyricsContent) return 'local';
  if (record?.hasEmbeddedLyrics && record.embeddedLyricsContent) return 'embedded';
  if (record?.matchedLyrics) return 'online';
  return null;
};

// Folia owns source selection and the offset clock. Supplement its default embedded
// LRC with the extra Ruby USLT item; never load former imports or plugin lead settings.
export function createIntegration(folium, {readEmbedded = record => readLocalEmbedded(record,folium.rpc)} = {}) {
  const store = folium.internals.stores.playback, embedded = new Map();
  const lyricSettings=folium.internals.stores.lyricSettings;
  let disposed=false, ownWrite=false, queued=false, revision=0, carrier=null, base=null, applied=null;
  let state={song:null,embedded:false,error:null,ready:false}, reported=null;
  const reconcile = async () => {
    queued=false;
    if (disposed) return;
    const ticket=++revision, snapshot=store.getState(), song=snapshot.currentSong, identity=songIdentity(song);
    if (!song) {carrier=null;base=null;applied=null;state={song:null,embedded:false,error:null,ready:false};return;}
    const changed=identity!==carrier;
    if (changed) {carrier=identity;base=snapshot.lyrics;applied=null;embedded.clear();}
    else if (snapshot.lyrics!==applied) base=snapshot.lyrics;
    const current = () => !disposed && ticket===revision && songIdentity(store.getState().currentSong)===identity;
    state={song,embedded:false,error:null,ready:false};
    try {
      const record=await readLocalSong(song);
      if (!current()) return;
      let rich=null;
      // Honor both explicit and automatic source choices, and host lyrics already containing ruby.
      const source=hostSource(record,lyricSettings?.getState().localLyricsPriority);
      if (!hasRuby(base?.lines) && (!source || source==='embedded') && record) {
        if (!embedded.has(identity)) {
          let parsed=null;
          for (const source of await readEmbedded(record)) {
            if (!current()) return;
            // Ordinary embedded lyrics are already handled by Folia.
            if (!/@Ruby\d*\s*=/.test(source.text)) continue;
            try {
              const lyrics=parseFaKara(source.text);
              if (hasRuby(lyrics?.lines)) {parsed=lyrics;break;}
            } catch { /* Keep the host's normal lyrics if the extension is malformed. */ }
          }
          if (!current()) return;
          embedded.set(identity,parsed);
        }
        rich=embedded.get(identity);
      }
      if (!current() || store.getState().transitionDisplay) return;
      if (!rich) {
        // No embedded Ruby: the host's lyrics object stays exactly as Folia built it.
        if (applied && store.getState().lyrics===applied) {
          ownWrite=true;
          try {store.getState().setLyricsState(base);store.getState().setCurrentLineIndex(-1);}
          finally {ownWrite=false;}
        }
        applied=null;
        state={song,embedded:false,error:null,ready:true};
        return;
      }
      const lines=cleanHints(carryTranslations(pairBilingual(rich.lines),base?.lines));
      applied={...(base || {}),lines,isWordByWord:rich.isWordByWord ?? base?.isWordByWord ?? false};
      ownWrite=true;
      try {store.getState().setLyricsState(applied);store.getState().setCurrentLineIndex(-1);}
      finally {ownWrite=false;}
      state={song,embedded:true,error:null,ready:true};
    } catch (error) {
      if (!current()) return;
      state={song,embedded:false,error:error.message,ready:true};
      // Keep the host's own lyrics, do not read the file again for this song, and say why once.
      embedded.set(identity,null);
      if (reported!==identity) {
        reported=identity;
        folium.log.error('内嵌注音歌词读取失败：'+error.message);
        folium.ui?.toast?.('内嵌注音歌词读取失败：'+error.message,{type:'info',durationMs:4000});
      }
    }
  };
  const schedule = () => {
    if (disposed || queued) return;
    queued=true; queueMicrotask(()=>void reconcile());
  };
  const unsubscribe=store.subscribe((next,previous)=>{
    if (!ownWrite && (next.currentSong!==previous.currentSong || next.lyrics!==previous.lyrics || next.transitionDisplay!==previous.transitionDisplay)) schedule();
  });
  const unsubscribeSettings=lyricSettings?.subscribe((next,previous)=>{
    if(next.localLyricsPriority!==previous.localLyricsPriority) schedule();
  });
  schedule();
  return {
    get:()=>({...state}),
    dispose() {
      disposed=true;revision++;unsubscribe();unsubscribeSettings?.();embedded.clear();
      if (store.getState().lyrics===applied) store.getState().setLyricsState(base);
    },
  };
}
