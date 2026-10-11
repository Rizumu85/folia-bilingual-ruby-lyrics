import { pairBilingual } from './lyrics.mjs';

const CSS = `
  .reading { height:100%; width:100%; display:flex; flex-direction:column; justify-content:center; gap:clamp(22px,5vh,54px); padding:clamp(28px,7vw,100px); box-sizing:border-box; overflow:hidden; color:var(--reading-primary); text-align:center; }
  .reading button { appearance:none; background:transparent; border:0; color:inherit; font:inherit; padding:0; cursor:pointer; width:100%; }
  .reading button:focus-visible { outline:2px solid var(--reading-accent); outline-offset:10px; border-radius:6px; }
  .reading .line { line-height:1.9; overflow-wrap:anywhere; white-space:pre-wrap; }
  .reading .near { color:var(--reading-secondary); font-size:clamp(17px,2.2vw,29px); opacity:.55; }
  .reading .current { font-size:clamp(25px,4.4vw,62px); font-weight:600; }
  .reading .secondary { font-size:.52em; font-weight:400; color:var(--reading-secondary); margin-top:8px; line-height:2; }
  .reading .romaji { font-size:.42em; font-weight:400; color:var(--reading-secondary); line-height:1.6; letter-spacing:.02em; }
  .reading ruby { ruby-position:over; ruby-align:center; }
  .reading rt { font-size:.38em; font-weight:400; line-height:1.15; letter-spacing:.03em; }
  .reading .timed { color:var(--reading-secondary); }
  .reading .timed.sung { color:var(--reading-primary); }
  .reading .timed.now { color:var(--reading-accent); }
  .reading .empty { font-size:20px; color:var(--reading-secondary); }
  :host { container-type:inline-size; }
  /* The poster card takes the look of Folia's own poster lyrics, so that the card with readings
     matches the one without: each sung unit is filled by a soft sweep, a glow rises and fades
     behind it, the lines before and after are smaller, dimmed and slightly blurred, and the
     edges of the block fade out. The numbers are the host's (sweep softness, glow radii and
     envelope, alpha, scale and blur per line), read from its 0.7.17 source. */
  .reading.poster { --size:clamp(24px,7cqw,56px); --base:color-mix(in srgb, var(--reading-primary) 34%, transparent); --word:color-mix(in srgb, var(--reading-primary) 98%, transparent);
    padding:8px 12px; gap:max(18px, calc(var(--size) * .49)); text-align:left; font-weight:var(--weight,600);
    -webkit-mask-image:linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent), linear-gradient(to right, transparent, #000 4%, #000 96%, transparent); -webkit-mask-composite:source-in; mask-composite:intersect; }
  .reading.poster .line { font-weight:inherit; }
  .reading.poster .current { font-size:var(--size); line-height:1.7; color:var(--base); --soft:clamp(6px,.45em,16px); --near:.2em; --far:.46em; }
  .reading.poster .current.chorus { --word:color-mix(in srgb, var(--reading-primary) 52%, var(--reading-accent)); --near:.32em; --far:.64em; }
  .reading.poster .current .plain { color:var(--word); }
  .reading.poster .current .timed { display:inline-block; color:transparent; -webkit-text-fill-color:transparent; -webkit-background-clip:text; background-clip:text;
    background-image:linear-gradient(90deg, var(--word) calc(var(--p,0%) + (var(--pn,0) - 1) * var(--soft)), var(--base) calc(var(--p,0%) + var(--pn,0) * var(--soft))); }
  .reading.poster .current .timed.glow { filter:drop-shadow(0 0 var(--near) color-mix(in srgb, var(--word) var(--g1,0%), transparent)) drop-shadow(0 0 var(--far) color-mix(in srgb, var(--word) var(--g2,0%), transparent)); }
  .reading.poster .near { font-size:calc(var(--size) * .72); line-height:1.3; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
  .reading.poster .near > div { display:inline; }
  .reading.poster .near.passed { color:var(--word); opacity:.52; filter:blur(1.1px); }
  .reading.poster .near.waiting { color:color-mix(in srgb, var(--reading-primary) 46%, transparent); opacity:.72; filter:blur(.7px); }
  .reading.poster .secondary { font-size:.5em; font-weight:500; margin-top:.3em; line-height:1.35; color:color-mix(in srgb, var(--reading-primary) 68%, transparent); }
  .reading.poster .romaji { color:color-mix(in srgb, var(--reading-primary) 68%, transparent); }
  @media (prefers-reduced-motion: reduce) { .reading.poster .near, .reading.poster .current .timed.glow { filter:none; } }
  .reading.strip { height:auto; position:absolute; left:0; right:0; padding:0 clamp(16px,6vw,96px); gap:0; pointer-events:none; align-items:center; overflow:visible; text-shadow:0 1px 3px rgba(0,0,0,.55), 0 0 14px rgba(0,0,0,.35); }
  /* the bottom offset is worked out from where Folia's own subtitles are; see paint() */
  .reading.strip.bottom { bottom:150px; transition:bottom .25s ease-out; }
  .reading.strip.top { top:clamp(16px,3.5vh,40px); }
  .reading.strip .current { font-size:clamp(18px,2.3vw,34px); font-weight:500; line-height:1.75; }
`;

function appendOriginal(container, line, showRuby, timed) {
  const words = line.words?.length ? line.words : [{ text: line.fullText, startTime: line.startTime, endTime: line.endTime }];
  // main: the lyric text itself, as opposed to the small reading above it (which gets no glow)
  const mark = (element, unit, main = true) => {
    if (Number.isFinite(unit.startTime) && Number.isFinite(unit.endTime)) {
      element.classList.add('timed');
      timed.push({ element, start: unit.startTime, end: unit.endTime, main });
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
          mark(kana, reading, false); rt.append(kana);
        }
        ruby.append(rt); container.append(ruby);
      } else container.append(text);
      if (validSyllables && unit.endsWithSpace) container.append(document.createTextNode(' '));
    }
  }
}

// Folia reports its two-row subtitle setting (romanization above translation) to mods as
// 'translation'. The stored setting says which it is; it is read at most once a second.
let twoRows = { at: -Infinity, value: false };
const hostShowsRomanization = display => {
  if (display.subtitleContentMode === 'romanization') return true;
  if (display.subtitleContentMode !== 'translation') return false;
  const now = Date.now();
  if (now - twoRows.at > 1000) {
    let value = false;
    try { value = globalThis.localStorage?.getItem('subtitle_content_mode') === 'both'; } catch { /* no storage here */ }
    twoRows = { at: now, value };
  }
  return twoRows.value;
};

// How strongly a unit glows at `time`, 0 to 1, with the host's timing for its poster lyrics: the
// glow eases up until a little after the unit has been sung (1.18 times its length), then eases
// away until the line is over, or for about a second if that is later.
const smooth = value => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };
function glowAt(time, start, end, lineEnd) {
  if (time <= start) return 0;
  const rise = Math.max(.001, end - start) * 1.18, peak = start + rise;
  if (time <= peak) return smooth((time - start) / rise);
  return smooth(1 - (time - peak) / Math.max(.18, Math.max(lineEnd, end + 1.05) - peak));
}

// strip: only the line being sung, with its readings, as a caption over another display mode
export function mountReading(container, ctx, folium, params, { poster = false, strip = null } = {}) {
  const style = document.createElement('style'); style.textContent = CSS;
  const root = document.createElement('div'); root.className = strip ? 'reading strip ' + strip : poster ? 'reading poster' : 'reading';
  container.append(style, root);
  const lines = pairBilingual(ctx.lines);
  let previousIndex = -2, optionsKey = '', timed = [], currentEnd = 0;
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
    if (poster) root.style.setProperty('--weight', String(folium.theme.resolveFontWeight?.(theme, 600) ?? 600));
    // The wall remains visible outside the player; showText belongs to the player stage.
    root.style.opacity = String(poster ? 1 : display.showText === false ? 0 : strip ? 1 : display.visualizerOpacity ?? 1);
    if (strip === 'bottom') {
      // Sit right above Folia's own subtitles. They start 112px up (32px while the player
      // controls are hidden) and are one row tall, two when romanization and translation are
      // both shown, none when subtitles are off; a row is the subtitle font at 1.5 line height.
      // The caption's own line box has empty room under the text, so it may dip 12px into the row.
      const mode = display.showSubtitleTranslation === false ? 'none' : display.subtitleContentMode;
      const rows = mode === 'none' ? 0 : mode === 'translation' && hostShowsRomanization(display) ? 2 : 1;
      const font = Math.min(20, Math.max(18, .026 * (root.ownerDocument.defaultView?.innerWidth || 1280))) * (display.subtitleFontScale || 1);
      root.style.bottom = Math.round((display.isPlayerChromeHidden ? 32 : 112) + rows * (font * 1.5 + 4) + Math.max(0, rows - 1) * 8 - (rows ? 12 : 0)) + 'px';
    }
    const time = ctx.currentTime.get(), index = indexAt(time);
    // the romanization row is Folia's to switch: it follows the host's subtitle setting
    const romanized = !strip && hostShowsRomanization(display);
    const key = JSON.stringify([settings.primary, settings.bilingual, settings.ruby, romanized]);
    if (previousIndex !== index || optionsKey !== key) {
      previousIndex = index; optionsKey = key; timed = []; root.replaceChildren();
      const options = strip
        ? { primary: 'original', bilingual: false, ruby: true, romaji: false }
        : { primary: settings.primary === 'translation' ? 'translation' : 'original', bilingual: settings.bilingual !== false, ruby: settings.ruby !== false, romaji: romanized };
      // where: 'passed' for the line before the current one, 'waiting' for the one after
      const addLine = (line, current, where = '') => {
        if (!line) return;
        const row = document.createElement(!poster && !strip && !ctx.isPreview && folium.env.context === 'main' ? 'button' : 'div');
        row.className = current ? 'line current' + (line.isChorus ? ' chorus' : '') : 'line near ' + where;
        if (current) currentEnd = line.endTime;
        if (row.tagName === 'BUTTON') {
          row.type = 'button'; row.title = '跳到这句歌词';
          row.addEventListener('click', () => folium.playback.seekToLyricTime(line.startTime));
        }
        const main = document.createElement('div');
        const translated = options.primary === 'translation' && !!line.translation;
        if (translated) { main.textContent = line.translation; main.className = 'plain'; }
        else appendOriginal(main, line, options.ruby && current, current ? timed : []);
        row.append(main);
        // the romanization goes with the original, wherever that is drawn
        const romaji = current && options.romaji && line.romanization ? document.createElement('div') : null;
        if (romaji) { romaji.className = 'romaji'; romaji.textContent = line.romanization; }
        if (romaji && !translated) row.append(romaji);
        if (current && options.bilingual && line.translation) {
          const secondary = document.createElement('div'); secondary.className = 'secondary';
          if (translated) appendOriginal(secondary, line, options.ruby, timed);
          else secondary.textContent = line.translation;
          row.append(secondary);
          if (romaji && translated) row.append(romaji);
        }
        root.append(row);
      };
      if (strip) addLine(lines[index], true);
      else if (!lines.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '这首歌暂无歌词'; root.append(empty); }
      else if (index < 0) {
        const next = lines.find(line => line.startTime > time);
        if (next) addLine(next, true);
      } else { addLine(lines[index - 1], false, 'passed'); addLine(lines[index], true); addLine(lines[index + 1], false, 'waiting'); }
    }
    for (const unit of timed) {
      const sung = time >= unit.end, now = time >= unit.start && time < unit.end;
      unit.element.classList.toggle('sung', sung);
      unit.element.classList.toggle('now', now);
      if (!poster) continue;
      // the sweep: how much of this unit is filled, as a share of its width
      const filled = sung ? 1 : now ? (time - unit.start) / Math.max(.001, unit.end - unit.start) : 0;
      if (unit.filled !== filled) {
        unit.filled = filled;
        unit.element.style.setProperty('--pn', filled.toFixed(3));
        unit.element.style.setProperty('--p', (filled * 100).toFixed(1) + '%');
      }
      // the glow, in steps of 1/40 so that the filter is not rebuilt for changes nobody can see
      const glow = unit.main && !ctx.staticMode ? Math.round(glowAt(time, unit.start, unit.end, currentEnd) * 40) / 40 : 0;
      if (unit.glow !== glow) {
        unit.glow = glow;
        unit.element.classList.toggle('glow', glow > 0);
        unit.element.style.setProperty('--g1', (glow * 60).toFixed(1) + '%');
        unit.element.style.setProperty('--g2', (glow * 88).toFixed(1) + '%');
      }
    }
  };
  paint();
  const unsubscribeClock = ctx.currentTime.on('change', paint);
  const unsubscribeContext = ctx.subscribe(paint);
  const unsubscribeParams = params.subscribe(paint);
  return () => { unsubscribeClock(); unsubscribeContext(); unsubscribeParams(); root.remove(); style.remove(); };
}
