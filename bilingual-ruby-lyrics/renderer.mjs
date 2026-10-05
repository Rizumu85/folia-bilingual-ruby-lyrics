import { pairBilingual } from './lyrics.mjs';

const CSS = `
  .reading { height:100%; width:100%; display:flex; flex-direction:column; justify-content:center; gap:clamp(22px,5vh,54px); padding:clamp(28px,7vw,100px); box-sizing:border-box; overflow:hidden; color:var(--reading-primary); text-align:center; }
  .reading button { appearance:none; background:transparent; border:0; color:inherit; font:inherit; padding:0; cursor:pointer; width:100%; }
  .reading button:focus-visible { outline:2px solid var(--reading-accent); outline-offset:10px; border-radius:6px; }
  .reading .line { line-height:1.9; overflow-wrap:anywhere; white-space:pre-wrap; }
  .reading .near { color:var(--reading-secondary); font-size:clamp(17px,2.2vw,29px); opacity:.55; }
  .reading .current { font-size:clamp(25px,4.4vw,62px); font-weight:600; }
  .reading .secondary { font-size:.52em; font-weight:400; color:var(--reading-secondary); margin-top:8px; line-height:2; }
  .reading ruby { ruby-position:over; ruby-align:center; }
  .reading rt { font-size:.38em; font-weight:400; line-height:1.15; letter-spacing:.03em; }
  .reading .timed { color:var(--reading-secondary); }
  .reading .timed.sung { color:var(--reading-primary); }
  .reading .timed.now { color:var(--reading-accent); }
  .reading .empty { font-size:20px; color:var(--reading-secondary); }
  :host { container-type:inline-size; }
  .reading.poster { padding:8px 12px; gap:clamp(12px,4cqw,32px); text-align:left; }
  .reading.poster .current { font-size:clamp(20px,6.5cqw,48px); line-height:1.85; }
  .reading.poster .near { font-size:clamp(15px,4cqw,28px); line-height:1.65; }
  .reading.poster .secondary { font-size:.55em; margin-top:10px; }
`;

function appendOriginal(container, line, showRuby, timed) {
  const words = line.words?.length ? line.words : [{ text: line.fullText, startTime: line.startTime, endTime: line.endTime }];
  const mark = (element, unit) => {
    if (Number.isFinite(unit.startTime) && Number.isFinite(unit.endTime)) {
      element.classList.add('timed');
      timed.push({ element, start: unit.startTime, end: unit.endTime });
    }
  };
  for (const word of words) {
    const validSyllables = word.syllables?.length && word.syllables.map(s => s.text + (s.endsWithSpace ? ' ' : '')).join('') === word.text;
    const syllables = validSyllables ? word.syllables : [word];
    for (const unit of syllables) {
      const text = document.createElement('span'); text.textContent = unit.text;
      mark(text, unit);
      if (showRuby && unit.ruby?.length) {
        const ruby = document.createElement('ruby'); ruby.append(text);
        const rt = document.createElement('rt');
        for (const reading of unit.ruby) {
          const kana = document.createElement('span'); kana.textContent = reading.text;
          mark(kana, reading); rt.append(kana);
        }
        ruby.append(rt); container.append(ruby);
      } else container.append(text);
      if (validSyllables && unit.endsWithSpace) container.append(document.createTextNode(' '));
    }
  }
}

export function mountReading(container, ctx, folium, params, { poster = false } = {}) {
  const style = document.createElement('style'); style.textContent = CSS;
  const root = document.createElement('div'); root.className = poster ? 'reading poster' : 'reading';
  container.append(style, root);
  const lines = pairBilingual(ctx.lines);
  let previousIndex = -2, optionsKey = '', timed = [];
  const indexAt = time => {
    if (ctx.staticMode) return Math.min(lines.length - 1, Math.max(0, ctx.staticLineIndex ?? 0));
    let selected = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startTime <= time) selected = i;
      else break;
    }
    if (selected >= 0 && time > lines[selected].endTime + 1) return -1;
    return selected;
  };
  const paint = () => {
    const theme = ctx.getTheme(), display = ctx.getDisplay(), settings = params.get();
    root.style.setProperty('--reading-primary', theme.primaryColor);
    root.style.setProperty('--reading-secondary', theme.secondaryColor);
    root.style.setProperty('--reading-accent', theme.accentColor);
    root.style.fontFamily = folium.theme.resolveFontStack(theme);
    // The wall remains visible outside the player; showText belongs to the player stage.
    root.style.opacity = String(poster ? 1 : display.showText === false ? 0 : display.visualizerOpacity ?? 1);
    const time = ctx.currentTime.get(), index = indexAt(time);
    const key = JSON.stringify([settings.primary, settings.bilingual, settings.ruby]);
    if (previousIndex !== index || optionsKey !== key) {
      previousIndex = index; optionsKey = key; timed = []; root.replaceChildren();
      const options = { primary: settings.primary || 'original', bilingual: settings.bilingual !== false, ruby: settings.ruby !== false };
      const addLine = (line, current) => {
        if (!line) return;
        const row = document.createElement(!poster && !ctx.isPreview && folium.env.context === 'main' ? 'button' : 'div');
        row.className = current ? 'line current' : 'line near';
        if (row.tagName === 'BUTTON') {
          row.type = 'button'; row.title = '跳到这句歌词';
          row.addEventListener('click', () => folium.playback.seekToLyricTime(line.startTime));
        }
        const main = document.createElement('div');
        const translated = options.primary === 'translation' && !!line.translation;
        if (translated) main.textContent = line.translation;
        else appendOriginal(main, line, options.ruby && current, current ? timed : []);
        row.append(main);
        if (current && options.bilingual && line.translation) {
          const secondary = document.createElement('div'); secondary.className = 'secondary';
          if (translated) appendOriginal(secondary, line, options.ruby, timed);
          else secondary.textContent = line.translation;
          row.append(secondary);
        }
        root.append(row);
      };
      if (!lines.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '这首歌暂无歌词'; root.append(empty); }
      else if (index < 0) {
        const next = lines.find(line => line.startTime > time);
        if (next) addLine(next, true);
      } else { addLine(lines[index - 1], false); addLine(lines[index], true); addLine(lines[index + 1], false); }
    }
    for (const unit of timed) {
      unit.element.classList.toggle('sung', time >= unit.end);
      unit.element.classList.toggle('now', time >= unit.start && time < unit.end);
    }
  };
  paint();
  const unsubscribeClock = ctx.currentTime.on('change', paint);
  const unsubscribeContext = ctx.subscribe(paint);
  const unsubscribeParams = params.subscribe(paint);
  return () => { unsubscribeClock(); unsubscribeContext(); unsubscribeParams(); root.remove(); style.remove(); };
}
