import { pairBilingual } from './lyrics.mjs';

// The display mode and the poster card take their look from Folia's own poster lyrics, so that
// lyrics with readings sit beside the host's without a seam: each sung unit is filled by a soft
// sweep, a glow rises and fades behind it, the lines before and after are smaller, dimmed and
// slightly blurred, a chorus line takes the accent colour, and keywords take the colours the theme
// gives them. The numbers are the host's (sweep softness, glow radii and envelope, alpha, scale
// and blur per line), read from its 0.7.17 source; the drawing itself is plain CSS, not the host's
// GPU renderer.
// The caption is drawn over the host's other display modes, and over those of other mods. They
// have nothing in common but the theme's colours, so the caption uses only those, without effects.
const CSS = `
  :host { container-type:inline-size; }
  .reading { --size:calc(clamp(25px,4.4vw,62px) * var(--scale,1)); --base:color-mix(in srgb, var(--reading-primary) 34%, transparent); --word:color-mix(in srgb, var(--reading-primary) 98%, transparent);
    height:100%; width:100%; display:flex; flex-direction:column; justify-content:center; gap:max(18px, calc(var(--size) * .49)); padding:clamp(28px,7vw,100px); box-sizing:border-box; overflow:hidden;
    color:var(--reading-primary); text-align:center; font-weight:var(--weight,600); }
  .reading button { appearance:none; background:transparent; border:0; color:inherit; font:inherit; padding:0; cursor:pointer; width:100%; }
  .reading button:focus-visible { outline:2px solid var(--reading-accent); outline-offset:10px; border-radius:6px; }
  .reading .line { overflow-wrap:anywhere; white-space:pre-wrap; font-weight:inherit; }
  .reading .current { font-size:var(--size); line-height:1.75; color:var(--base); --soft:clamp(6px,.45em,16px); --near:.2em; --far:.46em; }
  .reading .current.chorus { --word:color-mix(in srgb, var(--reading-primary) 52%, var(--reading-accent)); --near:.32em; --far:.64em; }
  .reading .current .plain { color:var(--word); }
  .reading .current .timed { color:transparent; -webkit-text-fill-color:transparent; -webkit-background-clip:text; background-clip:text;
    background-image:linear-gradient(90deg, var(--word) calc(var(--p,0%) + (var(--pn,0) - 1) * var(--soft)), var(--base) calc(var(--p,0%) + var(--pn,0) * var(--soft))); }
  .reading .current .timed.glow { filter:drop-shadow(0 0 var(--near) color-mix(in srgb, var(--word) var(--g1,0%), transparent)) drop-shadow(0 0 var(--far) color-mix(in srgb, var(--word) var(--g2,0%), transparent)); }
  .reading .near { font-size:calc(var(--size) * .72); line-height:1.3; }
  .reading .near.passed { color:var(--word); opacity:.52; filter:blur(1.1px); }
  .reading .near.passed .timed { color:var(--word); }
  .reading .near.waiting { color:color-mix(in srgb, var(--reading-primary) 46%, transparent); opacity:.72; filter:blur(.7px); }
  .reading .secondary { font-size:calc(.5em * var(--sub-scale,1)); font-weight:500; margin-top:.3em; line-height:1.4; color:color-mix(in srgb, var(--reading-primary) 68%, transparent); }
  /* a translation, wherever it is drawn, is set in the font the host's subtitles use; as the small row it also takes their weight and colour */
  .reading .translation { font-family:var(--sub-font,inherit); }
  .reading .secondary.translation { font-weight:var(--sub-weight,500); color:color-mix(in srgb, var(--reading-sub,var(--reading-primary)) 68%, transparent); }
  .reading .romaji { font-family:var(--sub-font,inherit); font-size:calc(.42em * var(--sub-scale,1)); font-weight:400; line-height:1.6; letter-spacing:.02em; color:color-mix(in srgb, var(--reading-sub,var(--reading-primary)) 68%, transparent); }
  .reading ruby { ruby-position:over; ruby-align:center; }
  .reading rt { font-size:.38em; font-weight:400; line-height:1.15; letter-spacing:.03em; }
  .reading .empty { font-size:20px; font-weight:400; color:var(--reading-secondary); }
  @media (prefers-reduced-motion: reduce) { .reading .near, .reading .current .timed.glow { filter:none; } }

  .reading.poster { --size:clamp(24px,7cqw,56px); padding:8px 12px; text-align:left;
    -webkit-mask-image:linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent), linear-gradient(to right, transparent, #000 4%, #000 96%, transparent); -webkit-mask-composite:source-in; mask-composite:intersect; }
  .reading.poster .current { line-height:1.7; }
  .reading.poster .near { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
  .reading.poster .near > div { display:inline; }

  .reading.strip { --size:calc(clamp(18px,2.3vw,34px) * var(--scale,1)); --weight:500; height:auto; position:absolute; left:0; right:0; padding:0 clamp(16px,6vw,96px); gap:0; pointer-events:none; align-items:center; overflow:visible; }
  /* The caption: no sweep and no glow. Words to come are in the theme's secondary colour, sung
     words in its lyric colour (a keyword in its own), the unit being sung in the accent colour. */
  .reading.strip .current { color:var(--reading-primary); }
  .reading.strip .current.chorus { --word:color-mix(in srgb, var(--reading-primary) 98%, transparent); }
  .reading.strip .current .timed { background-image:none; -webkit-text-fill-color:currentColor; color:var(--reading-secondary); }
  .reading.strip .current .timed.sung { color:var(--word); }
  .reading.strip .current .timed.now { color:var(--reading-accent); }
  /* Its edge is the host's subtitle edge: a thin shadow in the theme's background colour, and a
     wider one only while the host's "subtitle background" setting is on. */
  .reading.strip .current { filter:drop-shadow(0 1px 2px color-mix(in srgb, var(--reading-bg,#000) 24%, transparent)); }
  .reading.strip.backed .current { filter:drop-shadow(0 1px 2px color-mix(in srgb, var(--reading-bg,#000) 55%, transparent)) drop-shadow(0 0 10px color-mix(in srgb, var(--reading-bg,#000) 35%, transparent)); }
  /* the bottom offset is worked out from where Folia's own subtitles are; see paint() */
  .reading.strip.bottom { bottom:150px; transition:bottom .25s ease-out; }
  .reading.strip.top { top:clamp(16px,3.5vh,40px); }
`;

// colours: the theme's keyword colour spans of this line's text (UTF-16 offsets)
function appendOriginal(container, line, showRuby, timed, colours = []) {
  const words = line.words?.length ? line.words : [{ text: line.fullText, startTime: line.startTime, endTime: line.endTime }];
  // main: the lyric text itself, as opposed to the small reading above it (which gets no glow)
  const mark = (element, unit, main = true) => {
    if (Number.isFinite(unit.startTime) && Number.isFinite(unit.endTime)) {
      element.classList.add('timed');
      timed.push({ element, start: unit.startTime, end: unit.endTime, main });
    }
  };
  let offset = 0;
  for (const word of words) {
    const validSyllables = word.syllables?.length && word.syllables.map(s => s.text + (s.endsWithSpace ? ' ' : '')).join('') === word.text;
    const syllables = validSyllables ? word.syllables : [word];
    for (const unit of syllables) {
      const from = offset, to = offset + unit.text.length;
      offset = to + (validSyllables && unit.endsWithSpace ? 1 : 0);
      const text = document.createElement('span'); text.textContent = unit.text;
      mark(text, unit);
      let outer = text;
      if (showRuby && unit.ruby?.length) {
        outer = document.createElement('ruby'); outer.append(text);
        const rt = document.createElement('rt');
        for (const reading of unit.ruby) {
          const kana = document.createElement('span'); kana.textContent = reading.text;
          mark(kana, reading, false); rt.append(kana);
        }
        outer.append(rt);
      }
      // a keyword's colour replaces the sung colour of the units it covers, readings included
      const keyword = colours.find(range => range.startOffset < to && range.endOffset > from);
      if (keyword) outer.style.setProperty('--word', keyword.color);
      container.append(outer);
      if (validSyllables && unit.endsWithSpace) container.append(document.createTextNode(' '));
    }
  }
}

// Which rows go with the lyrics is the host's to say, with its subtitle setting: the translation,
// the romanization, both, or neither. This mod has no switch of its own for them.
// Folia reports its two-row setting (romanization above translation) to mods as 'translation'.
// The stored setting says which it is; it is read at most once a second.
let twoRows = { at: -Infinity, value: false };
const hostRows = display => {
  if (display.showSubtitleTranslation === false) return { translation: false, romaji: false };
  const mode = display.subtitleContentMode ?? 'translation';
  if (mode === 'romanization') return { translation: false, romaji: true };
  if (mode !== 'translation') return { translation: false, romaji: false };
  const now = Date.now();
  if (now - twoRows.at > 1000) {
    let value = false;
    try { value = globalThis.localStorage?.getItem('subtitle_content_mode') === 'both'; } catch { /* no storage here */ }
    twoRows = { at: now, value };
  }
  return { translation: true, romaji: twoRows.value };
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
  // Keyword colours follow the same switch as Folia's poster lyrics (its Monet setting).
  const keywordsOn = () => folium.internals?.stores?.visualizerSettings?.getState?.().monetTuning?.keywordColoringEnabled !== false;
  const paint = () => {
    const theme = ctx.getTheme(), display = ctx.getDisplay(), settings = params.get();
    const shown = hostRows(display);
    root.style.setProperty('--reading-primary', theme.primaryColor);
    root.style.setProperty('--reading-secondary', theme.secondaryColor);
    root.style.setProperty('--reading-accent', theme.accentColor);
    if (strip) {
      root.style.setProperty('--reading-bg', theme.backgroundColor);
      root.classList.toggle('backed', display.subtitleOverlayBackground !== false);
    }
    root.style.fontFamily = folium.theme.resolveFontStack(theme);
    if (!strip) root.style.setProperty('--weight', String(folium.theme.resolveFontWeight?.(theme, 600) ?? 600));
    // Translations and the romanization row follow the host's subtitles: their theme (0.7.17 on;
    // before that the lyric theme), their font and weight.
    let subtitle = theme;
    try { subtitle = ctx.getSubtitleTheme?.() ?? theme; } catch { /* keep the lyric theme */ }
    root.style.setProperty('--reading-sub', subtitle.primaryColor);
    root.style.setProperty('--sub-font', folium.theme.resolveTranslationFontStack?.(subtitle) ?? folium.theme.resolveFontStack(subtitle));
    root.style.setProperty('--sub-weight', String(folium.theme.resolveFontWeight?.(subtitle, 500) ?? 500));
    // Sizes follow the host's multipliers: the lyric size for the display mode, the subtitle size
    // for its translation and for the caption, which sits with the subtitles. The host fits its
    // poster lyrics to the card and has no multiplier there, so the poster has none either.
    root.style.setProperty('--scale', String(poster ? 1 : (strip ? display.subtitleFontScale : display.lyricsFontScale) || 1));
    root.style.setProperty('--sub-scale', String(poster || strip ? 1 : display.subtitleFontScale || 1));
    // The wall remains visible outside the player; showText belongs to the player stage.
    // the caption sits with the host's subtitles and takes their opacity
    root.style.opacity = String(poster ? 1 : display.showText === false ? 0 : strip ? display.subtitleOverlayOpacity ?? 1 : display.visualizerOpacity ?? 1);
    if (strip === 'bottom') {
      // Sit right above Folia's own subtitles. They start 112px up (32px while the player
      // controls are hidden) and are one row tall, two when romanization and translation are
      // both shown, none when subtitles are off or the bottom subtitle layer is hidden; a row is
      // the subtitle font at 1.5 line height.
      // The caption's own line box has empty room under the text, so it may dip 12px into the row.
      const rows = display.hideTranslationSubtitle ? 0 : Number(shown.translation) + Number(shown.romaji);
      const font = Math.min(20, Math.max(18, .026 * (root.ownerDocument.defaultView?.innerWidth || 1280))) * (display.subtitleFontScale || 1);
      root.style.bottom = Math.round((display.isPlayerChromeHidden ? 32 : 112) + rows * (font * 1.5 + 4) + Math.max(0, rows - 1) * 8 - (rows ? 12 : 0)) + 'px';
    }
    const time = ctx.currentTime.get(), index = indexAt(time);
    const keywords = keywordsOn() && theme.wordColors?.length ? theme.wordColors : null;
    const key = JSON.stringify([settings.primary, settings.ruby, shown, keywords]);
    if (previousIndex !== index || optionsKey !== key) {
      previousIndex = index; optionsKey = key; timed = []; root.replaceChildren();
      const options = strip
        ? { primary: 'original', bilingual: false, ruby: true, romaji: false }
        : { primary: settings.primary === 'translation' ? 'translation' : 'original', bilingual: shown.translation, ruby: settings.ruby !== false, romaji: shown.romaji };
      const coloursOf = line => {
        if (!keywords) return [];
        try { return folium.lyrics?.buildWordColorRanges?.(line.fullText, keywords) || []; } catch { return []; }
      };
      // where: 'passed' for the line before the current one, 'waiting' for the one after
      const addLine = (line, current, where = '') => {
        if (!line) return;
        const row = document.createElement(!poster && !strip && !ctx.isPreview && folium.env.context === 'main' ? 'button' : 'div');
        row.className = current ? 'line current' + (line.isChorus ? ' chorus' : '') : 'line near ' + where;
        if (current) {
          // the glow of the last units lasts until the host would take the line off the screen
          let end = line.endTime;
          try { end = Math.max(end, folium.lyrics?.getLineRenderEndTime?.(line) ?? end); } catch { /* keep the line's own end */ }
          currentEnd = end;
        }
        if (row.tagName === 'BUTTON') {
          row.type = 'button'; row.title = '跳到这句歌词';
          row.addEventListener('click', () => folium.playback.seekToLyricTime(line.startTime));
        }
        const main = document.createElement('div');
        const translated = options.primary === 'translation' && !!line.translation;
        if (translated) { main.textContent = line.translation; main.className = 'plain translation'; }
        else appendOriginal(main, line, options.ruby && current, current ? timed : [], coloursOf(line));
        row.append(main);
        // the romanization goes with the original, wherever that is drawn
        const romaji = current && options.romaji && line.romanization ? document.createElement('div') : null;
        if (romaji) { romaji.className = 'romaji'; romaji.textContent = line.romanization; }
        if (romaji && !translated) row.append(romaji);
        if (current && options.bilingual && line.translation) {
          const secondary = document.createElement('div'); secondary.className = 'secondary';
          if (translated) appendOriginal(secondary, line, options.ruby, timed, coloursOf(line));
          else { secondary.textContent = line.translation; secondary.classList.add('translation'); }
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
      const state = sung ? 'sung' : now ? 'now' : '';
      if (unit.state !== state) {
        unit.state = state;
        unit.element.classList.toggle('sung', sung);
        unit.element.classList.toggle('now', now);
      }
      if (strip) continue; // the caption has no sweep and no glow
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
  // the keyword switch lives in a host store; repaint when it is flipped
  const unsubscribeStore = folium.internals?.stores?.visualizerSettings?.subscribe?.(paint);
  return () => { unsubscribeClock(); unsubscribeContext(); unsubscribeParams(); unsubscribeStore?.(); root.remove(); style.remove(); };
}
