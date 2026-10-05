// Built from src/ by tools/build.mjs — edit the sources, not this file. (client.mjs)
// ---- lyrics.mjs
const __lyrics = (() => {
const TIME_KEYS = new Set(["startTime", "endTime"]);
// Hiragana and katakana letters only: the middle dot and the long-vowel mark also appear in
// Chinese transliterations of foreign names, and must not make a translation look Japanese.
const JAPANESE_KANA = /[\u3041-\u3096\u30a1-\u30fa]/u;
const DEFAULT_TRANSLATION_LANGUAGE = "zh-Hans";
const DEFAULT_ORIGINAL_LANGUAGE = "ja";

const roundSeconds = value => Math.round(value * 1e6) / 1e6;

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function shiftedValue(value, deltaSeconds) {
  if (Array.isArray(value)) return value.map(item => shiftedValue(item, deltaSeconds));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (TIME_KEYS.has(key) && typeof item === "number" && Number.isFinite(item)) {
        return [key, roundSeconds(Math.max(0, item - deltaSeconds))];
      }
      return [key, shiftedValue(item, deltaSeconds)];
    }));
  }
  return value;
}

/** Shift every nested startTime/endTime without changing the source objects. */
function shiftLines(lines, leadMs) {
  const amount = Number.isFinite(leadMs) ? leadMs / 1000 : 0;
  return shiftedValue(Array.isArray(lines) ? lines : [], amount);
}

function translationEntries(line) {
  const entries = [];
  if (typeof line?.translation === "string" && line.translation.length > 0) {
    entries.push({
      role: "translation",
      text: line.translation,
      language: line.alternateTexts?.find(item => item?.role === "translation" && item.text === line.translation)?.language,
    });
  }
  for (const item of Array.isArray(line?.alternateTexts) ? line.alternateTexts : []) {
    if (item?.role === "translation" && typeof item.text === "string" && item.text.length > 0) {
      entries.push({ ...item, role: "translation" });
    }
  }
  return uniqueTextEntries(entries);
}

function uniqueTextEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = [entry.role, entry.language ?? "", entry.text].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasKana(line) {
  return typeof line?.fullText === "string" && JAPANESE_KANA.test(line.fullText);
}

function mergeAlternateTexts(group, chosenTranslation) {
  const entries = [];
  for (const line of group) {
    if (!Array.isArray(line?.alternateTexts)) continue;
    for (const item of line.alternateTexts) {
      if (item && typeof item === "object" && typeof item.role === "string" && typeof item.text === "string") {
        entries.push(cloneValue(item));
      }
    }
  }
  if (chosenTranslation && !entries.some(item => item.role === "translation" && item.text === chosenTranslation.text && item.language === chosenTranslation.language)) {
    entries.push({ ...chosenTranslation });
  }
  return uniqueTextEntries(entries);
}

/**
 * Collapse equal-start lyric lines into one display line. Kana-bearing text wins
 * as the canonical original when present; otherwise input order is retained.
 */
function pairBilingual(lines, primary = "original") {
  if (!Array.isArray(lines)) return [];

  const groupsByStart = new Map();
  for (const line of lines) {
    const key = line?.startTime;
    if (!groupsByStart.has(key)) groupsByStart.set(key, []);
    groupsByStart.get(key).push(line);
  }

  return [...groupsByStart.values()].sort((leftGroup, rightGroup) => {
    const leftStart = Number.isFinite(leftGroup[0]?.startTime) ? leftGroup[0].startTime : Number.POSITIVE_INFINITY;
    const rightStart = Number.isFinite(rightGroup[0]?.startTime) ? rightGroup[0].startTime : Number.POSITIVE_INFINITY;
    return leftStart - rightStart;
  }).flatMap(group => {
    // Lines that each bring their own translation are separate sung lines that happen to start
    // together (a duet), not an original with its translation: keep them all as they are.
    if (group.length > 1 && group.filter(line => translationEntries(line).length).length > 1) return group.map(cloneValue);
    const original = group.find(hasKana) ?? group[0];
    if (!original || typeof original !== "object") return cloneValue(original);

    const pairedLine = group.find(line => line !== original && typeof line?.fullText === "string" && line.fullText.length > 0 && line.fullText !== original.fullText);
    const originalText = typeof original.fullText === "string" ? original.fullText : "";
    const inheritedTranslations = group.flatMap(translationEntries);
    const pairedTranslation = pairedLine
      ? {
          ...translationEntries(pairedLine).find(entry => entry.text === pairedLine.fullText),
          role: "translation",
          text: pairedLine.fullText,
        }
      : undefined;
    const translationEntry = pairedTranslation ?? inheritedTranslations[0];
    const originalTranslation = translationEntry?.text;
    const requestedPrimary = primary === "translation" ? "translation" : "original";
    const displayText = requestedPrimary === "translation" && originalTranslation
      ? originalTranslation
      : originalText;
    const secondaryText = displayText === originalText ? originalTranslation : originalText;

    const timingSource = group.find(line => line?.fullText === displayText && Array.isArray(line.words));
    const result = cloneValue(original);
    result.fullText = displayText;
    result.words = timingSource ? cloneValue(timingSource.words) : [];
    if (secondaryText && secondaryText !== displayText) result.translation = secondaryText;
    else delete result.translation;

    if (timingSource !== original) delete result.wordSegments;
    if (group.length > 1) {
      result.endTime = Math.max(...group.map(line => Number.isFinite(line?.endTime) ? line.endTime : original.endTime));
    }

    const chosenEntry = secondaryText
      ? {
          role: "translation",
          text: secondaryText,
          ...(translationEntry?.language ? { language: translationEntry.language } : {}),
        }
      : undefined;
    const alternateTexts = mergeAlternateTexts(group, chosenEntry);
    if (alternateTexts.length > 0) result.alternateTexts = alternateTexts;
    else delete result.alternateTexts;

    return result;
  });
}

function metadataText(metadata, key) {
  const candidates = [metadata?.[key], metadata?.song?.[key], metadata?.lyrics?.[key]];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
    if (Array.isArray(candidate) && typeof candidate[0] === "string") return candidate[0];
  }
  return undefined;
}
return { shiftLines, pairBilingual };
})();

// ---- renderer.mjs
const __renderer = (() => {
const { pairBilingual } = __lyrics;

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
  .reading.poster { padding:8px 12px; gap:clamp(12px,4cqw,32px); text-align:left; }
  .reading.poster .current { font-size:clamp(20px,6.5cqw,48px); line-height:1.85; }
  .reading.poster .near { font-size:clamp(15px,4cqw,28px); line-height:1.65; }
  .reading.poster .secondary { font-size:.55em; margin-top:10px; }
  .reading.strip { height:auto; position:absolute; left:0; right:0; padding:0 clamp(16px,6vw,96px); gap:0; pointer-events:none; text-shadow:0 1px 3px rgba(0,0,0,.55), 0 0 14px rgba(0,0,0,.35); }
  /* Folia's own subtitles sit about 110px up and take up to two rows: stay just above them */
  .reading.strip.bottom { bottom:clamp(176px,21vh,220px); }
  .reading.strip.top { top:clamp(64px,11vh,120px); }
  .reading.strip .current { font-size:clamp(18px,2.3vw,34px); font-weight:500; line-height:1.9; }
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

// strip: only the line being sung, with its readings, as a caption over another display mode
function mountReading(container, ctx, folium, params, { poster = false, strip = null } = {}) {
  const style = document.createElement('style'); style.textContent = CSS;
  const root = document.createElement('div'); root.className = strip ? 'reading strip ' + strip : poster ? 'reading poster' : 'reading';
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
    root.style.opacity = String(poster ? 1 : display.showText === false ? 0 : strip ? 1 : display.visualizerOpacity ?? 1);
    const time = ctx.currentTime.get(), index = indexAt(time);
    // the romanization row is Folia's to switch: it follows the host's subtitle setting
    const romanized = !strip && hostShowsRomanization(display);
    const key = JSON.stringify([settings.translationFirst, settings.bilingual, settings.ruby, romanized]);
    if (previousIndex !== index || optionsKey !== key) {
      previousIndex = index; optionsKey = key; timed = []; root.replaceChildren();
      const options = strip
        ? { primary: 'original', bilingual: false, ruby: true, romaji: false }
        : { primary: settings.translationFirst === true ? 'translation' : 'original', bilingual: settings.bilingual !== false, ruby: settings.ruby !== false, romaji: romanized };
      const addLine = (line, current) => {
        if (!line) return;
        const row = document.createElement(!poster && !strip && !ctx.isPreview && folium.env.context === 'main' ? 'button' : 'div');
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
return { mountReading };
})();

// ---- poster.mjs
const __poster = (() => {
const { mountReading } = __renderer;

// Opt-in ("海报歌词" in the settings, off by default). Folia 0.7.12 has no registry for the
// lyrics drawn on the expanded poster card, so this adapter reaches into the host page: it adds
// one <style>, one child element and one marker attribute per poster, and watches the page for
// posters appearing. It is pinned to the host version through the manifest's "folia" range and
// removes everything it added when disposed.
// The public app.overlay context supplies the same lyric clock and theme as playback.
const SELECTOR = '.lattice-root .lattice-poster.is-current.is-expanded';
const MARKER = 'data-lyrics-display-split';
const CSS = `
  .lattice-root .lattice-poster[${MARKER}] > .lattice-lyrics { visibility:hidden; }
  .lattice-root .lattice-poster[${MARKER}] > .split-lyrics-poster { position:absolute; inset:128px 24px 110px; z-index:1; pointer-events:none; overflow:hidden; }
  .lattice-root .lattice-poster[${MARKER}] > .lattice-poster-copy { top:74px; bottom:auto; right:100px; }
  .lattice-root .lattice-poster[${MARKER}] > .lattice-poster-copy strong { max-width:100%; font-size:22px; line-height:1.2; -webkit-line-clamp:1; }
  .lattice-root .lattice-poster[${MARKER}] > .lattice-poster-copy small { font-size:13px; margin-top:2px; }
  @media (max-width:640px) {
    .lattice-root .lattice-poster[${MARKER}] > .split-lyrics-poster { top:160px; bottom:164px; }
    .lattice-root .lattice-poster[${MARKER}] > .lattice-poster-copy { top:112px; right:32px; }
  }
`;

function mountPoster(_container, ctx, folium, params) {
  if (!ctx.lines.length || !ctx.song?.title) return () => {};
  const document = _container.ownerDocument;
  const style = document.createElement('style'); style.textContent = CSS;
  document.head.append(style);
  const mounted = new Map();
  let alive = true, queued = false;
  const remove = (poster, entry) => {
    entry.dispose(); entry.host.remove(); poster.removeAttribute(MARKER); mounted.delete(poster);
  };
  const reconcile = () => {
    queued = false;
    if (!alive) return;
    const candidates = new Set([...document.querySelectorAll(SELECTOR)].filter(poster =>
      // During a track transition the previous expanded card can still be in the DOM.
      poster.getAttribute('aria-label')?.startsWith(ctx.song.title + ' · ') &&
      poster.querySelector(':scope > .lattice-lyrics')
    ));
    for (const [poster, entry] of mounted) if (!candidates.has(poster)) remove(poster, entry);
    for (const poster of candidates) {
      if (mounted.has(poster) || poster.hasAttribute(MARKER)) continue;
      const host = document.createElement('div'); host.className = 'split-lyrics-poster';
      // Native sr-only text remains the card's accessible lyric; this is its visual rendition.
      host.setAttribute('aria-hidden', 'true'); poster.append(host);
      try {
        const dispose = mountReading(host.attachShadow({ mode:'open' }), ctx, folium, params, { poster:true });
        mounted.set(poster, { host, dispose }); poster.setAttribute(MARKER, '');
      } catch (error) { host.remove(); folium.log.error('poster lyrics: ' + (error?.message || error)); }
    }
  };
  const schedule = () => { if (alive && !queued) { queued = true; queueMicrotask(reconcile); } };
  const observer = new MutationObserver(records => {
    // Ignore our own painting (isolated in shadow DOM) and native canvas frame updates.
    if (records.some(record => record.type === 'childList' || record.target.matches?.('.lattice-poster, .lattice-root'))) schedule();
  });
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','aria-label'] });
  reconcile();
  return () => {
    alive = false; observer.disconnect();
    for (const [poster, entry] of mounted) remove(poster, entry);
    style.remove();
  };
}
return { mountPoster };
})();

// ---- panel-style.mjs
const __panel_style = (() => {
// Folia 0.7.12: UnifiedPanel owns p-5; SettingsToggle and VisualizerPresetGroup
// define 48x24 switches, themed pill choices and density. Styles stay in shadow DOM.
const PANEL_CSS = `
  .lyrics-panel { color:var(--folium-primary); font:14px/1.5 var(--folium-font,sans-serif); display:flex; flex-direction:column; gap:24px; min-width:0; }
  .lyrics-panel * { box-sizing:border-box; }
  .lyrics-panel h2 { margin:0; font-size:14px; font-weight:600; }
  .lyrics-panel .display { display:flex; flex-direction:column; gap:16px; }
  .lyrics-panel .field { display:flex; flex-direction:column; gap:8px; min-width:0; }
  .lyrics-panel .row { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:28px; }
  .lyrics-panel .field-label { font-size:12px; font-weight:500; color:var(--folium-secondary); }
  .lyrics-panel .choices { display:flex; gap:8px; }
  .lyrics-panel button { appearance:none; cursor:pointer; font:inherit; color:inherit; }
  .lyrics-panel .pill { flex:1; border:1px solid color-mix(in srgb,var(--folium-secondary) 18%,transparent); border-radius:999px; padding:8px 12px; font-size:14px; line-height:1.4; background:color-mix(in srgb,var(--folium-bg) 30%,transparent); transition:background-color 150ms,border-color 150ms; }
  .lyrics-panel .pill:hover { background:color-mix(in srgb,var(--folium-primary) 8%,transparent); }
  .lyrics-panel .pill:active { background:color-mix(in srgb,var(--folium-primary) 12%,transparent); }
  .lyrics-panel .pill[aria-pressed=true] { background:color-mix(in srgb,var(--folium-accent) 12%,transparent); border-color:var(--folium-accent); box-shadow:inset 0 0 0 1px var(--folium-accent); }
  .lyrics-panel .switch { flex:none; width:48px; height:24px; padding:4px; border:0; border-radius:999px; background:color-mix(in srgb,var(--folium-primary) 10%,transparent); transition:background-color 150ms; }
  .lyrics-panel .switch::after { content:''; display:block; width:16px; height:16px; border-radius:50%; background:white; box-shadow:0 1px 2px #0002; transition:transform 150ms; }
  .lyrics-panel .switch[aria-checked=true] { background:var(--folium-secondary); }
  .lyrics-panel .switch[aria-checked=true]::after { transform:translateX(24px); }
  .lyrics-panel button:focus-visible { outline:2px solid var(--folium-accent); outline-offset:3px; }
  @media (prefers-reduced-motion:reduce) { .lyrics-panel button,.lyrics-panel .switch::after { transition:none; } }
`;
return { PANEL_CSS };
})();

// ---- panel.mjs
const __panel = (() => {
const { PANEL_CSS } = __panel_style;

// The player tab mirrors this mod's own settings. Folia owns lyric sources, imports,
// timeline offsets and exports in its native UI.
function mountPanel(container, params) {
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const root = document.createElement('div');
  root.className = 'lyrics-panel';
  root.innerHTML = `
    <h2>双语 · 注音歌词</h2>
    <section class="display" aria-label="双语和注音歌词设置">
      <div class="field">
        <span class="field-label" id="lyrics-primary-label">主要显示</span>
        <div class="choices" role="group" aria-labelledby="lyrics-primary-label">
          <button class="pill" type="button" data-language="original" aria-pressed="true">原文</button>
          <button class="pill" type="button" data-language="translation" aria-pressed="false">译文</button>
        </div>
      </div>
      <div class="row">
        <span id="lyrics-bilingual-label">双语显示</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-bilingual-label" aria-checked="true" data-switch="bilingual"></button>
      </div>
      <div class="row">
        <span id="lyrics-ruby-label">显示注音</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-ruby-label" aria-checked="true" data-switch="ruby"></button>
      </div>
      <div class="field">
        <span class="field-label" id="lyrics-strip-label">注音字幕条（用 Folia 自带的显示模式时）</span>
        <div class="choices" role="group" aria-labelledby="lyrics-strip-label">
          <button class="pill" type="button" data-strip="off" aria-pressed="true">关</button>
          <button class="pill" type="button" data-strip="bottom" aria-pressed="false">底部</button>
          <button class="pill" type="button" data-strip="top" aria-pressed="false">顶部</button>
        </div>
      </div>
      <div class="row">
        <span id="lyrics-poster-label">海报歌词（实验性）</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-poster-label" aria-checked="false" data-switch="poster"></button>
      </div>
    </section>`;

  // bilingual and ruby are on unless turned off; the poster override is off unless turned on
  const isOn = (values, key) => key === 'poster' ? values.poster === true : values[key] !== false;
  const refresh = () => {
    const values = params.get();
    const primary = values.translationFirst === true ? 'translation' : 'original';
    for (const button of root.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === primary));
    const strip = values.caption === true ? (values.captionTop === true ? 'top' : 'bottom') : 'off';
    for (const button of root.querySelectorAll('[data-strip]')) button.setAttribute('aria-pressed', String(button.dataset.strip === strip));
    for (const button of root.querySelectorAll('[data-switch]')) button.setAttribute('aria-checked', String(isOn(values, button.dataset.switch)));
  };
  for (const button of root.querySelectorAll('[data-language]')) button.addEventListener('click', () => params.set({ translationFirst: button.dataset.language === 'translation' }));
  for (const button of root.querySelectorAll('[data-strip]')) button.addEventListener('click', () => params.set(button.dataset.strip === 'off' ? { caption: false } : { caption: true, captionTop: button.dataset.strip === 'top' }));
  for (const button of root.querySelectorAll('[data-switch]')) button.addEventListener('click', () => params.set({ [button.dataset.switch]: !isOn(params.get(), button.dataset.switch) }));
  container.append(style, root);
  refresh();
  const unsubscribe = params.subscribe(refresh);
  return () => { unsubscribe(); root.remove(); style.remove(); };
}
return { mountPanel };
})();

// ---- id3.mjs
const __id3 = (() => {
// A narrow ID3 frame reader. Lyric frames (USLT) are decoded; everything else in the tag
// is skipped. Nothing here writes to a file.
const MAX_TAG_BYTES = 16 * 1024 * 1024;
const ascii = bytes => String.fromCharCode(...bytes);
const uint = bytes => bytes.reduce((n, byte) => n * 256 + byte, 0);
const sync = bytes => {
  if (bytes.some(byte => byte & 128)) throw new Error('ID3 长度字段无效');
  return bytes.reduce((n, byte) => n * 128 + byte, 0);
};
const deunsync = bytes => {
  const result = [];
  for (let i = 0; i < bytes.length; i++) { result.push(bytes[i]); if (bytes[i] === 255 && bytes[i+1] === 0) i++; }
  return Uint8Array.from(result);
};

function id3Header(bytes) {
  if (ascii(bytes.subarray(0, 3)) !== 'ID3') return { version: 3, flags: 0, bodySize: 0, totalSize: 0 };
  if (bytes.length < 10 || ![2, 3, 4].includes(bytes[3]) || bytes[4] === 255) throw new Error('不支持或损坏的 ID3 标签');
  const bodySize = sync(bytes.subarray(6, 10));
  const totalSize = 10 + bodySize + (bytes[3] === 4 && bytes[5] & 16 ? 10 : 0);
  if (totalSize > MAX_TAG_BYTES) throw new Error('MP3 的 ID3 标签超过 16 MB');
  return { version: bytes[3], revision: bytes[4], flags: bytes[5], bodySize, totalSize };
}

function decodeText(bytes, encoding, inheritedEndian = 'utf-16le') {
  if (encoding === 0) return Array.from(bytes, byte => String.fromCharCode(byte)).join('').replace(/\0+$/, '');
  let charset = encoding === 3 ? 'utf-8' : encoding === 2 ? 'utf-16be' : inheritedEndian;
  if (encoding === 1 && bytes[0] === 255 && bytes[1] === 254) charset = 'utf-16le';
  if (encoding === 1 && bytes[0] === 254 && bytes[1] === 255) charset = 'utf-16be';
  if (![1, 2, 3].includes(encoding)) throw new Error('不支持的 ID3 歌词编码');
  return new TextDecoder(charset, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\0+$/, '');
}

function readUslt(payload) {
  if (payload.length < 5) throw new Error('ID3 歌词项不完整');
  const encoding = payload[0], wide = encoding === 1 || encoding === 2;
  let terminator = -1;
  for (let at = 4; at < payload.length; at += wide ? 2 : 1) {
    if (payload[at] === 0 && (!wide || payload[at+1] === 0)) { terminator = at; break; }
  }
  if (terminator < 0) throw new Error('ID3 歌词描述缺少结束符');
  const endian = payload[4] === 254 && payload[5] === 255 ? 'utf-16be' : 'utf-16le';
  const descriptor = decodeText(payload.subarray(4, terminator), encoding, endian);
  const text = decodeText(payload.subarray(terminator + (wide ? 2 : 1)), encoding, endian);
  if (text.length > 1024 * 1024) throw new Error('内嵌歌词超过解析上限');
  return { language: ascii(payload.subarray(1, 4)), descriptor, text };
}

function parseId3(bytes) {
  const header = id3Header(bytes), frames = [], lyrics = [];
  if (!header.totalSize) return { ...header, frames, lyrics };
  if (bytes.length < header.totalSize) throw new Error('ID3 标签不完整');
  let body = bytes.subarray(10, 10 + header.bodySize);
  if (header.version < 4 && header.flags & 128) body = deunsync(body);
  if (header.version === 2 && header.flags & 64) throw new Error('暂不读取压缩的 ID3v2.2 标签');
  let at = 0;
  if (header.version >= 3 && header.flags & 64) {
    at = header.version === 3 ? 4 + uint(body.subarray(0, 4)) : sync(body.subarray(0, 4));
    if (at < 6 || at > body.length) throw new Error('ID3 扩展头无效');
  }
  const width = header.version === 2 ? 6 : 10;
  while (at < body.length && body[at] !== 0) {
    if (at + width > body.length) throw new Error('ID3 帧头不完整');
    const idWidth = header.version === 2 ? 3 : 4;
    const id = ascii(body.subarray(at, at + idWidth));
    if (!new RegExp('^[A-Z0-9]{' + idWidth + '}$').test(id)) throw new Error('ID3 帧标识无效');
    const size = header.version === 2 ? uint(body.subarray(at+3, at+6))
      : (header.version === 4 ? sync : uint)(body.subarray(at+4, at+8));
    const end = at + width + size;
    if (end > body.length) throw new Error('ID3 帧长度无效');
    if (!size) { at = end; continue; } // an empty frame is skipped, not fatal
    const flags = header.version === 2 ? 0 : body[at+9];
    const frame = { id, flags, raw: body.slice(at, end) };
    frames.push(frame);
    if (id === 'USLT' || id === 'ULT') {
      let payload = body.subarray(at+width, end);
      const unsupported = header.version === 3 ? flags & 192 : flags & 12;
      if (unsupported) { at = end; continue; } // compressed or encrypted lyrics: leave them to the host
      if (header.version === 4 && (header.flags & 128 || flags & 2)) payload = deunsync(payload);
      if (flags & (header.version === 3 ? 32 : 64)) payload = payload.subarray(1);
      if (header.version === 4 && flags & 1) payload = payload.subarray(4);
      try { const lyric = readUslt(payload); frame.lyric = lyric; lyrics.push(lyric); } catch { /* one undecodable lyric frame does not hide the others */ }
    }
    at = end;
  }
  return { ...header, frames, lyrics };
}

function embeddedVersions(lyrics, name = 'MP3') {
  const hasRuby = text => /^@Ruby\d+=/m.test(text);
  const usable = lyrics.filter(item => /\[\d+:\d{2}(?:[:.]\d{2,3})?\]/.test(item.text));
  return usable.map(item => ({ ...item, format: 'lrc', embedded: true,
    kind: hasRuby(item.text) ? 'ruby' : 'plain',
    name: name + ' · ' + (hasRuby(item.text) ? '内嵌 Ruby LRC' : '内嵌普通 LRC'),
  })).sort((a, b) => (a.kind === 'ruby' ? 0 : a.descriptor === '' ? 1 : 2) - (b.kind === 'ruby' ? 0 : b.descriptor === '' ? 1 : 2));
}
return { MAX_TAG_BYTES, id3Header, parseId3, embeddedVersions };
})();

// ---- tags.mjs
const __tags = (() => {
// Reads embedded lyrics out of any audio file Folia plays, by the kind of tag found in the file
// rather than by its extension:
//
//   ID3v2            MP3, AAC, TTA; inside a chunk in WAV and AIFF      USLT frames
//   Vorbis comments  FLAC, Ogg Vorbis, Opus                             LYRICS, RUBY_LYRICS
//   MP4 atoms        M4A, ALAC                                          ©lyr, ----:com.apple.iTunes:RUBY_LYRICS
//   APEv2            APE, WavPack, TTA                                  Lyrics, RUBY_LYRICS
//   ASF attributes   WMA                                                WM/Lyrics, RUBY_LYRICS
//
// `read(offset, length)` returns that part of the file (shorter at the end of the file); only
// headers and tag areas are asked for, never the audio. Nothing here writes to a file.
const { id3Header, parseId3 } = __id3;

const RUBY_TAG = 'RUBY_LYRICS';
/** The extensions Folia 0.7.13 accepts as local music. */
const AUDIO_FILE = /\.(mp3|flac|m4a|wav|ogg|opus|aac|alac|ape|wv|tta|wma|aif|aiff|caf)$/i;
const LYRIC_TAGS = new Set(['LYRICS', 'UNSYNCEDLYRICS', 'UNSYNCED LYRICS', 'WM/LYRICS', RUBY_TAG]);
const MAX_BYTES = 16 * 1024 * 1024;
const ascii = bytes => String.fromCharCode(...bytes);
const big = bytes => bytes.reduce((n, byte) => n * 256 + byte, 0);
const little = bytes => bytes.reduceRight((n, byte) => n * 256 + byte, 0);
const utf8 = bytes => new TextDecoder('utf-8').decode(bytes);
const utf16 = bytes => new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '');
const item = (descriptor, text) => ({ language: '', descriptor, text });
const bounded = (length, what) => { if (length > MAX_BYTES) throw new Error(what + ' 的标签区过大'); return length; };
const whole = async (read, offset, length, what) => {
  const bytes = await read(offset, bounded(length, what));
  if (bytes.length !== length) throw new Error(what + ' 的标签不完整');
  return bytes;
};

// An ID3v2 tag starting at `offset`: its lyric frames and where it ends.
async function id3At(read, offset) {
  const info = id3Header(await read(offset, 10));
  if (!info.totalSize) return { lyrics: [], end: offset };
  return { lyrics: parseId3(await whole(read, offset, info.totalSize, 'ID3')).lyrics, end: offset + info.totalSize };
}

// The body of a Vorbis comment header: vendor string, then KEY=value entries.
function vorbisComments(block) {
  const found = [];
  let at = 4 + little(block.subarray(0, 4));
  const count = little(block.subarray(at, at + 4)); at += 4;
  for (let index = 0; index < count && at + 4 <= block.length; index++) {
    const end = at + 4 + little(block.subarray(at, at + 4));
    const comment = block.subarray(at + 4, end), equals = comment.indexOf(61);
    const key = equals > 0 ? ascii(comment.subarray(0, equals)).toUpperCase() : '';
    if (LYRIC_TAGS.has(key)) found.push(item(key, utf8(comment.subarray(equals + 1))));
    at = end;
  }
  return found;
}

async function flac(read, position, size) {
  position += 4;
  for (let last = false; !last && position + 4 <= size;) {
    const header = await read(position, 4), length = big(header.subarray(1, 4));
    if (header.length < 4) break;
    last = (header[0] & 128) !== 0;
    position += 4;
    if ((header[0] & 127) === 4) return vorbisComments(await whole(read, position, length, 'FLAC'));
    position += length;
  }
  return [];
}

// Ogg: the comments are the second packet of the stream; packets are cut into pages.
async function ogg(read, position, size) {
  const packets = [];
  let current = [], length = 0, serial = null;
  while (packets.length < 2 && position + 27 <= size) {
    const header = await read(position, 27 + 255);
    if (header.length < 27 || ascii(header.subarray(0, 4)) !== 'OggS') break;
    const segments = header[26], table = header.subarray(27, 27 + segments);
    const body = table.reduce((sum, value) => sum + value, 0);
    const pageSerial = little(header.subarray(14, 18));
    serial ??= pageSerial;
    if (pageSerial === serial) {
      const data = await whole(read, position + 27 + segments, body, 'Ogg');
      let at = 0;
      for (const value of table) {
        current.push(data.subarray(at, at + value)); at += value; length += value;
        bounded(length, 'Ogg');
        if (value < 255) {
          const packet = new Uint8Array(length);
          let offset = 0;
          for (const part of current) { packet.set(part, offset); offset += part.length; }
          packets.push(packet); current = []; length = 0;
          if (packets.length === 2) break;
        }
      }
    }
    position += 27 + segments + body;
  }
  const comments = packets[1];
  if (!comments) return [];
  if (ascii(comments.subarray(0, 8)) === 'OpusTags') return vorbisComments(comments.subarray(8));
  if (comments[0] === 3 && ascii(comments.subarray(1, 7)) === 'vorbis') return vorbisComments(comments.subarray(7));
  // FLAC in Ogg: a FLAC metadata block, header included
  if ((comments[0] & 127) === 4 && ascii(packets[0].subarray(1, 5)) === 'FLAC') return vorbisComments(comments.subarray(4));
  return [];
}

// WAV (RIFF, little-endian sizes) and AIFF (FORM, big-endian sizes) keep an ID3v2 tag in a chunk.
async function chunked(read, position, size, number) {
  position += 12;
  for (let guard = 0; guard < 4096 && position + 8 <= size; guard++) {
    const header = await read(position, 8);
    if (header.length < 8) break;
    const length = number(header.subarray(4, 8));
    if (ascii(header.subarray(0, 4)).toUpperCase() === 'ID3 ') return (await id3At(read, position + 8)).lyrics;
    position += 8 + length + (length & 1);
  }
  return [];
}

// child atoms of the atom body bytes[from, to): [type, bodyStart, bodyEnd]
function* atoms(bytes, from, to) {
  while (from + 8 <= to) {
    let length = big(bytes.subarray(from, from + 4)), header = 8;
    if (length === 1) { length = big(bytes.subarray(from + 8, from + 16)); header = 16; }
    else if (length === 0) length = to - from;
    if (length < header || from + length > to) return;
    yield [ascii(bytes.subarray(from + 4, from + 8)), from + header, from + length];
    from += length;
  }
}
const child = (bytes, from, to, type) => { for (const atom of atoms(bytes, from, to)) if (atom[0] === type) return atom; return null; };

async function mp4(read, position, size) {
  // top-level atoms: only headers are read until moov, which holds the tags
  while (position + 8 <= size) {
    const header = await read(position, 16);
    if (header.length < 8) break;
    let length = big(header.subarray(0, 4)), headerSize = 8;
    if (length === 1) { length = big(header.subarray(8, 16)); headerSize = 16; }
    else if (length === 0) length = size - position;
    if (length < headerSize) break;
    if (ascii(header.subarray(4, 8)) === 'moov') {
      const moov = await whole(read, position + headerSize, length - headerSize, 'MP4');
      const udta = child(moov, 0, moov.length, 'udta');
      const meta = udta && child(moov, udta[1], udta[2], 'meta');
      // meta has four bytes of version and flags before its children
      const list = meta && child(moov, meta[1] + 4, meta[2], 'ilst');
      const found = [];
      for (const [type, from, to] of list ? atoms(moov, list[1], list[2]) : []) {
        const data = child(moov, from, to, 'data');
        if (!data) continue;
        const text = () => utf8(moov.subarray(data[1] + 8, data[2]));
        if (type === '©lyr') found.push(item('LYRICS', text()));
        else if (type === '----') {
          const name = child(moov, from, to, 'name');
          const key = name ? ascii(moov.subarray(name[1] + 4, name[2])).toUpperCase() : '';
          if (LYRIC_TAGS.has(key)) found.push(item(key, text()));
        }
      }
      return found;
    }
    position += length;
  }
  return [];
}

// APEv2: a footer at the very end of the file (before an ID3v1 tag, if there is one).
async function ape(read, size) {
  let end = size;
  if (end >= 128 && ascii(await read(end - 128, 3)) === 'TAG') end -= 128;
  if (end < 32) return [];
  const footer = await read(end - 32, 32);
  if (ascii(footer.subarray(0, 8)) !== 'APETAGEX') return [];
  const length = little(footer.subarray(12, 16)), count = little(footer.subarray(16, 20));
  if (length < 32 || length > end) return [];
  const body = await whole(read, end - length, length - 32, 'APE');
  const found = [];
  let at = 0;
  for (let index = 0; index < count && at + 8 < body.length; index++) {
    const valueLength = little(body.subarray(at, at + 4)), flags = little(body.subarray(at + 4, at + 8));
    let keyEnd = at + 8;
    while (keyEnd < body.length && body[keyEnd] !== 0) keyEnd++;
    const key = ascii(body.subarray(at + 8, keyEnd)).toUpperCase(), value = body.subarray(keyEnd + 1, keyEnd + 1 + valueLength);
    // bits 1-2 of the flags give the kind of value; 0 is text
    if (LYRIC_TAGS.has(key) && (flags >> 1 & 3) === 0) found.push(item(key, utf8(value)));
    at = keyEnd + 1 + valueLength;
  }
  return found;
}

// ASF (WMA): named attributes in the header. Short values sit in the extended content
// description, long ones (over 64 KB) in the metadata library inside the header extension.
const guid = text => Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
const ASF_HEADER = guid('3026b2758e66cf11a6d900aa0062ce6c');
const ASF_EXTENDED_CONTENT = guid('40a4d0d207e3d21197f000a0c95ea850');
const ASF_HEADER_EXTENSION = guid('b503bf5f2ea9cf118ee300c00c205365');
const ASF_METADATA = guid('eacbf8c5af5b48778467aa8c44fa4cca');
const ASF_METADATA_LIBRARY = guid('941c23449894d149a1411d134e457054');
const same = (bytes, at, id) => id.every((byte, index) => bytes[at + index] === byte);
function* asfObjects(bytes, from, to) {
  while (from + 24 <= to) {
    const length = little(bytes.subarray(from + 16, from + 24));
    if (length < 24 || from + length > to) return;
    yield [from, from + 24, from + length];
    from += length;
  }
}
async function asf(read, position) {
  const top = await read(position, 30), length = little(top.subarray(16, 24));
  const header = await whole(read, position, length, 'ASF');
  const found = [];
  const keep = (name, type, value) => { if (type === 0 && LYRIC_TAGS.has(name.toUpperCase())) found.push(item(name.toUpperCase(), utf16(value))); };
  const records = (from, to) => {
    // metadata and metadata library records: language, stream, name length, type, value length
    let at = from + 2;
    for (let count = little(header.subarray(from, from + 2)); count > 0 && at + 12 <= to; count--) {
      const nameLength = little(header.subarray(at + 4, at + 6)), type = little(header.subarray(at + 6, at + 8)), valueLength = little(header.subarray(at + 8, at + 12));
      const name = utf16(header.subarray(at + 12, at + 12 + nameLength));
      keep(name, type, header.subarray(at + 12 + nameLength, at + 12 + nameLength + valueLength));
      at += 12 + nameLength + valueLength;
    }
  };
  for (const [start, from, to] of asfObjects(header, 30, header.length)) {
    if (same(header, start, ASF_EXTENDED_CONTENT)) {
      let at = from + 2;
      for (let count = little(header.subarray(from, from + 2)); count > 0 && at + 2 <= to; count--) {
        const nameLength = little(header.subarray(at, at + 2));
        const name = utf16(header.subarray(at + 2, at + 2 + nameLength));
        at += 2 + nameLength;
        const type = little(header.subarray(at, at + 2)), valueLength = little(header.subarray(at + 2, at + 4));
        keep(name, type, header.subarray(at + 4, at + 4 + valueLength));
        at += 4 + valueLength;
      }
    } else if (same(header, start, ASF_HEADER_EXTENSION)) {
      // 16 bytes of reserved GUID, 2 reserved, 4 of data size, then nested objects
      for (const [inner, innerFrom, innerTo] of asfObjects(header, from + 22, to)) {
        if (same(header, inner, ASF_METADATA) || same(header, inner, ASF_METADATA_LIBRARY)) records(innerFrom, innerTo);
      }
    }
  }
  return found;
}

/** Every lyric text embedded in the file, as items like those read from ID3 frames. */
async function readEmbeddedLyrics(read, size) {
  const found = [];
  let start = 0, head = await read(0, 16);
  if (ascii(head.subarray(0, 3)) === 'ID3') {
    // MP3, AAC and TTA carry the tag in front; so can a FLAC file, before its own comments
    const tag = await id3At(read, 0);
    found.push(...tag.lyrics);
    start = tag.end;
    head = await read(start, 16);
  }
  const magic = ascii(head.subarray(0, 4));
  if (magic === 'fLaC') found.push(...await flac(read, start, size));
  else if (magic === 'OggS') found.push(...await ogg(read, start, size));
  else if (magic === 'RIFF') found.push(...await chunked(read, start, size, little));
  else if (magic === 'FORM') found.push(...await chunked(read, start, size, big));
  else if (ascii(head.subarray(4, 8)) === 'ftyp') found.push(...await mp4(read, start, size));
  else if (head.length >= 16 && same(head, 0, ASF_HEADER)) found.push(...await asf(read, start));
  else if (magic === 'MAC ' || magic === 'wvpk' || magic === 'TTA1') found.push(...await ape(read, size));
  return found;
}
return { RUBY_TAG, AUDIO_FILE, readEmbeddedLyrics };
})();

// ---- local-song.mjs
const __local_song = (() => {
const { embeddedVersions } = __id3;
const { readEmbeddedLyrics, AUDIO_FILE } = __tags;

// Folia 0.7.12: the current carrier stores a UUID; its file path is in local_music.
// This read-only lookup deliberately never upgrades, creates or writes the host database.
async function readLocalSong(song) {
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

const isAbsoluteAudioPath = value => /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value || '');

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

async function readLocalEmbedded(record, rpc, getHandles = hostHandles) {
  if (!record?.filePath || !AUDIO_FILE.test(record.filePath)) return [];
  if (isAbsoluteAudioPath(record.filePath)) return rpc.call('readEmbedded', { audioPath: record.filePath });
  const { directory, fileName } = await audioDirectory(record, getHandles);
  const file = await (await directory.getFileHandle(fileName)).getFile();
  const read = async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  return embeddedVersions(await readEmbeddedLyrics(read, file.size), fileName);
}

function songIdentity(song, record = null) {
  if (!song) return null;
  record ||= song.localData;
  if (isAbsoluteAudioPath(record?.filePath)) return 'local-file:' + record.filePath.replace(/\\/g, '/').normalize('NFC').toLowerCase();
  if (song.localRef?.songId) return 'local-id:' + song.localRef.songId;
  const ref = song.sourceRef;
  return JSON.stringify([ref?.kind || 'online', ref?.providerId || song.providerId || 'netease', String(ref?.mediaId ?? song.id), ref?.variant || '']);
}
return { readLocalSong, isAbsoluteAudioPath, readLocalEmbedded, songIdentity };
})();

// ---- fa-kara.mjs
const __fa_kara = (() => {
const { shiftLines } = __lyrics;

// TimeTag/NicoKara uses [MM:SS:CC] for centiseconds. The dotted form is
// accepted only as an input compatibility fallback for older LRC exports.
const TAG = /\[(\d+):(\d{2})[:.](\d{2,3})\]/g;
const seconds = match => Number(match[1]) * 60 + Number(match[2]) + Number('0.' + match[3]);
const times = text => [...text.matchAll(new RegExp(TAG.source, 'g'))].map(match => ({ time: seconds(match), index: match.index, length: match[0].length }));
const timedParts = (text, origin = 0, fallbackEnd = null) => {
  const markers = times(text);
  const parts = [];
  if (markers[0]?.index > 0) parts.push({ text: text.slice(0, markers[0].index), startTime: origin, endTime: origin + markers[0].time });
  else if (!markers.length && text) return [{ text, startTime: origin, endTime: fallbackEnd ?? origin }];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i], next = markers[i + 1];
    const value = text.slice(marker.index + marker.length, next?.index ?? text.length);
    if (value) parts.push({ text: value, startTime: origin + marker.time, endTime: next ? origin + next.time : fallbackEnd ?? origin + marker.time });
  }
  return parts;
};

// A word without syllables is one plain unit; ruby always sits on a whole unit.
const unitsOf = word => word.syllables?.length ? word.syllables : [{ text: word.text, startTime: word.startTime, endTime: word.endTime }];
const cut = (unit, from, to) => {
  const at = index => unit.startTime + (unit.endTime - unit.startTime) * index / unit.text.length;
  return { text: unit.text.slice(from, to), startTime: at(from), endTime: at(to) };
};
// Second pass for a @Ruby base that is only part of a chunk or spans several chunks. The touched
// chunks become one word whose syllables keep the plain remainder around the annotated base.
function annotateInside(line, base, reading, start, end) {
  for (let from = line.fullText.indexOf(base); from >= 0; from = line.fullText.indexOf(base, from + base.length)) {
    const to = from + base.length;
    let offset = 0, first = -1, last = -1, origin = 0;
    line.words.forEach((word, index) => {
      if (offset < to && offset + word.text.length > from) { if (first < 0) { first = index; origin = offset; } last = index; }
      offset += word.text.length;
    });
    // Whole-chunk matches belong to the first pass, including its time range and empty-reading rules.
    if (first < 0 || (first === last && from === origin && base.length === line.words[first].text.length)) continue;
    const covered = line.words.slice(first, last + 1), units = [];
    let position = origin, target = null, range = null, free = true;
    for (const unit of covered.flatMap(unitsOf)) {
      const begin = position, finish = position += unit.text.length;
      if (finish <= from || begin >= to) { units.push(unit); continue; }
      if (unit.ruby?.length) { free = false; break; }
      const head = Math.max(from, begin) - begin, tail = Math.min(to, finish) - begin, piece = cut(unit, head, tail);
      if (head > 0) units.push(cut(unit, 0, head));
      if (target) target.endTime = piece.endTime;
      else {
        units.push(target = { text: base, startTime: piece.startTime, endTime: piece.endTime });
        // An occurrence starting mid-chunk has no start tag of its own, so the whole chunk selects it.
        range = [unit.startTime, head > 0 ? unit.endTime : unit.startTime];
      }
      if (tail < unit.text.length) units.push(cut(unit, tail, unit.text.length));
    }
    if (!free || !target || range[1] < start - .001 || range[0] > end + .001) continue;
    target.ruby = timedParts(reading, target.startTime, target.endTime);
    if (!target.ruby.length) continue;
    line.words.splice(first, covered.length, { text: covered.map(word => word.text).join(''), startTime: covered[0].startTime, endTime: covered.at(-1).endTime, syllables: units });
  }
}

// NicoKaraMaker/TimeTag's @Ruby footer contains relative reading starts, and a next-element
// boundary rather than an acoustic end. Keep that limitation when importing LRC.
function parseFaKara(text) {
  const nico = /^@Ruby\d+=/m.test(text);
  const rhythmica = /\[(?:1|10)\|\d+:\d{2}:\d{2,3}\]/.test(text);
  if (!nico && !rhythmica) return null;
  const lines = [];
  if (nico) {
    for (const row of text.split(/\r?\n/)) {
      if (!/^\[\d+:\d{2}[:.]\d{2,3}\]/.test(row)) continue;
      const markers = times(row), words = timedParts(row, 0, markers.at(-1)?.time);
      if (words.length) lines.push({ fullText: words.map(word => word.text).join(''), words, startTime: markers[0].time, endTime: words.at(-1).endTime });
    }
    const rules = [];
    for (const row of text.split(/\r?\n/)) {
      const match = /^@Ruby\d+=([^,]+)(?:,([^,]*))?(?:,([^,]*))?(?:,([^,]*))?$/.exec(row);
      if (!match) continue;
      const start = times(match[3] || '')[0]?.time ?? 0;
      const end = times(match[4] || '')[0]?.time ?? Infinity;
      const rule = { base: match[1], reading: match[2], start, end, hit: false };
      if (match[2]) rules.push(rule);
      for (const word of lines.flatMap(line => line.words)) {
        if (word.text !== match[1] || word.startTime < start - .001 || word.startTime > end + .001) continue;
        if (!match[2]) { delete word.syllables; continue; }
        // The two footer times select occurrences; they do not time the reading.
        const ruby = timedParts(match[2], word.startTime, word.endTime);
        if (ruby.length) { word.syllables = [{ text: word.text, startTime: word.startTime, endTime: word.endTime, ruby }]; rule.hit = true; }
      }
    }
    // Longer bases first, so 今日 is not pre-empted by a rule for 日.
    for (const rule of rules.sort((left, right) => right.base.length - left.base.length)) {
      // A rule that names one instant and already found its chunk there is spent. Looking further
      // would put the reading on the untimed translation line that shares the timestamp
      // (知らない / 不知道: the 知 of the translation is not read し).
      if (rule.hit && rule.end - rule.start < .001) continue;
      for (const line of lines) annotateInside(line, rule.base, rule.reading, rule.start, rule.end);
    }
  } else {
    for (const row of text.split(/\r?\n/)) {
      const tokenRegex = /\{([^{}|]+)\|([^{}]+)\}|\[(?:1|10)\|\d+:\d{2}[:.]\d{2,3}\][^{\[]*/g;
      const tokens = [...row.matchAll(tokenRegex)];
      const words = [], boundaries = [];
      for (const token of tokens) {
        const annotated = token[1] !== undefined;
        const body = (annotated ? token[2] : token[0]).replace(/\[(\d+)\|/g, '[');
        const starts = times(body), start = starts[0]?.time;
        if (start == null) continue;
        boundaries.push(start);
        const surface = annotated ? token[1] : body.slice(starts[0].length);
        if (!surface) continue;
        words.push({ text: surface, startTime: start, endTime: start, ...(annotated ? { syllables: [{ text: surface, startTime: start, endTime: start, ruby: timedParts(body) }] } : {}) });
      }
      for (const word of words) {
        const next = boundaries.find(value => value > word.startTime) ?? word.startTime;
        word.endTime = next;
        if (word.syllables) {
          word.syllables[0].endTime = next;
          const ruby = word.syllables[0].ruby;
          ruby.at(-1).endTime = Math.max(ruby.at(-1).startTime, next);
        }
      }
      if (words.length) lines.push({ fullText: words.map(word => word.text).join(''), words, startTime: words[0].startTime, endTime: words.at(-1).endTime });
    }
  }
  if (!lines.length) throw new Error('FA-Kara 歌词中没有有效的时间轴');
  const offset = /^@Offset=(-?\d+)/mi.exec(text);
  return { lines: shiftLines(lines, offset ? -Number(offset[1]) : 0), isWordByWord: true };
}
return { parseFaKara };
})();

// ---- romaji.mjs
const __romaji = (() => {
// Romanization of a line, built from the readings already on it: kana are spelled out as they
// are, and anything with a ruby annotation is spelled from its reading. Nothing is looked up, so
// the result is exactly as right as the embedded readings.

const KANA = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',
  か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',
  さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',
  た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',
  な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',
  は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',
  ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',
  ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',ゐ:'i',ゑ:'e',を:'o',ゔ:'vu',
  ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o',ゃ:'ya',ゅ:'yu',ょ:'yo',ゎ:'wa',ゕ:'ka',ゖ:'ke',
  きゃ:'kya',きゅ:'kyu',きょ:'kyo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',
  しゃ:'sha',しゅ:'shu',しょ:'sho',しぇ:'she',じゃ:'ja',じゅ:'ju',じょ:'jo',じぇ:'je',
  ちゃ:'cha',ちゅ:'chu',ちょ:'cho',ちぇ:'che',ぢゃ:'ja',ぢゅ:'ju',ぢょ:'jo',
  にゃ:'nya',にゅ:'nyu',にょ:'nyo',ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',
  びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
  みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',
  ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',ふゅ:'fyu',
  てぃ:'ti',でぃ:'di',とぅ:'tu',どぅ:'du',てゅ:'tyu',でゅ:'dyu',
  うぃ:'wi',うぇ:'we',うぉ:'wo',いぇ:'ye',
  ゔぁ:'va',ゔぃ:'vi',ゔぇ:'ve',ゔぉ:'vo',
  つぁ:'tsa',つぃ:'tsi',つぇ:'tse',つぉ:'tso',くぁ:'kwa',ぐぁ:'gwa',
};
// は as a topic marker is said wa. A word splitter gives these as one piece.
const ENDS_IN_PARTICLE_WA = new Set(['では','には','とは','へは','のは','からは','までは','よりは','それでは','これは','それは','あれは','または','あるいは','もしくは','こんにちは','こんばんは']);
const PARTICLES = { は:'わ', へ:'え' };
// Hiragana right after a word with a reading is its ending (始|まり, 行|く) unless it is one of these.
const STANDS_ALONE = new Set(['は','が','を','に','へ','と','で','も','の','や','か','ね','よ','な','さ','ぞ','ぜ','わ','だ','から','まで','より','など','だけ','しか','ほど','ばかり','こそ','さえ','でも','にも','のに','ので','けど','って','とか','なら','です','でしょう','だろう','じゃ','たち','という','ような','ように','みたい','ながら','まま','くらい','ぐらい','ずつ','かも','のが','のを','なんて','なの','だって','として','ない','なく','なんか','だった','じゃない','ですか','かな','かい','だよ','だね','よね','のよ','ごと','ども',
  'のち','こと','もの','とき','ところ','ため','そう','よう','ほう','うち','なか','あと','まえ','いま','ここ','そこ','これ','それ','あれ','どこ','みんな','ずっと','もう','まだ','また','きっと','そっと','ほら','ねえ','さあ','ああ']);

const isKana = char => /[ぁ-ゖァ-ヺー]/u.test(char);
// katakana to hiragana; the long-vowel mark is kept
const hiragana = text => text.replace(/[ァ-ヶ]/gu, char => String.fromCodePoint(char.codePointAt(0) - 0x60));

function kanaToLatin(text) {
  const kana = hiragana(text);
  let out = '', double = false;
  for (let index = 0; index < kana.length; index++) {
    const char = kana[index];
    if (char === 'っ') { double = true; continue; }
    if (char === 'ー') { out += /[aiueo]$/.exec(out)?.[0] ?? ''; continue; }
    let latin = KANA[kana.slice(index, index + 2)];
    if (latin) index++;
    else if (char === 'ん') latin = /^[あいうえおやゆよ]/.test(kana.slice(index + 1)) ? "n'" : 'n';
    else latin = KANA[char];
    if (latin === undefined) { out += char; double = false; continue; }
    if (double && /^[^aiueon]/.test(latin)) latin = (latin.startsWith('ch') ? 't' : latin[0]) + latin;
    double = false;
    out += latin;
  }
  return out;
}

let segmenter;
const wordsOf = text => {
  segmenter ??= typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
  if (!segmenter) return [{ index: 0, segment: text }];
  return [...segmenter.segment(text)];
};

// One entry per character of the line: what is sung there. A ruby base keeps its whole reading on
// its first character; the rest of the base is marked as covered.
function sungCharacters(line) {
  const cells = [];
  for (const word of line.words || []) {
    const valid = word.syllables?.length && word.syllables.map(unit => unit.text + (unit.endsWithSpace ? ' ' : '')).join('') === word.text;
    for (const unit of valid ? word.syllables : [word]) {
      const reading = (unit.ruby || []).map(part => part.text).join('');
      const chars = [...unit.text];
      chars.forEach((char, position) => cells.push(reading ? { text: position ? '' : reading, read: true, inside: position > 0 } : { text: char }));
      if (valid && unit.endsWithSpace) cells.push({ text: ' ' });
    }
  }
  return cells;
}

/** The line in Latin letters, or undefined when it has nothing to spell out (no kana, no readings). */
function romanizeLine(line) {
  const cells = sungCharacters(line);
  const text = typeof line?.fullText === 'string' ? line.fullText : '';
  // the words must add up to the line, or the positions below mean nothing
  if (!cells.length || cells.length !== [...text].length) return undefined;
  if (!cells.some(cell => cell.read || isKana(cell.text))) return undefined;
  // the splitter counts in UTF-16 units, the cells in characters
  const offsets = new Map();
  { let units = 0, count = 0; for (const char of text) { offsets.set(units, count++); units += char.length; } }
  const spell = sung => kanaToLatin(sung).replace(/[^\p{L}\p{N}'’\-]+/gu, ' ');
  const pieces = [], sungPieces = [];
  let afterReading = false;
  for (const { index, segment } of wordsOf(text)) {
    const from = offsets.get(index), count = [...segment].length;
    if (from === undefined) return undefined;
    const part = cells.slice(from, from + count);
    let sung = part.map(cell => cell.text).join('');
    const read = part.some(cell => cell.read);
    if (!read) {
      if (PARTICLES[segment]) sung = PARTICLES[segment];
      else if (ENDS_IN_PARTICLE_WA.has(segment)) sung = segment.slice(0, -1) + 'わ';
    }
    const ending = afterReading && !read && /^[ぁ-ゖ]+$/u.test(segment) && !STANDS_ALONE.has(segment) && !ENDS_IN_PARTICLE_WA.has(segment);
    afterReading = part.at(-1)?.read === true;
    // a word ending, a piece that starts inside a ruby base, or one that starts with a sound that
    // cannot start a word (っ, ー, a small kana) belongs to the word before it; the doubled
    // consonant is worked out there
    if (pieces.length && (ending || part[0]?.inside || /^[っッーぁぃぅぇぉゃゅょァィゥェォャュョ]/.test(sung))) {
      sungPieces[sungPieces.length - 1] += sung;
      pieces[pieces.length - 1] = spell(sungPieces.at(-1));
    }
    else { sungPieces.push(sung); pieces.push(spell(sung)); }
  }
  const result = pieces.join(' ').replace(/\s+/g, ' ').trim();
  return result && result !== text.trim() ? result : undefined;
}

/** Lines with a romanization added where they have none and one can be built. */
const withRomanization = lines => lines.map(line => {
  if (line?.romanization) return line;
  const romanization = romanizeLine(line);
  return romanization ? { ...line, romanization } : line;
});
return { romanizeLine, withRomanization };
})();

// ---- integration.mjs
const __integration = (() => {
const { pairBilingual } = __lyrics;
const { readLocalSong, songIdentity, readLocalEmbedded } = __local_song;
const { parseFaKara } = __fa_kara;
const { withRomanization } = __romaji;

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
function createIntegration(folium, {readEmbedded = record => readLocalEmbedded(record,folium.rpc)} = {}) {
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
      // Folia's own modes show this line when its subtitle setting asks for romanization.
      const lines=withRomanization(cleanHints(carryTranslations(pairBilingual(rich.lines),base?.lines)));
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
return { createIntegration };
})();

// ---- client.mjs
const __client = (() => {
const { mountReading } = __renderer;
const { mountPoster } = __poster;
const { mountPanel } = __panel;
const { createIntegration } = __integration;

const label = (zh, en) => ({ 'zh-CN': zh, en: en || zh });

function activate(folium) {
  if (folium.host.folium.minor < 4) throw new Error('本模组需要 Folium 1.4 / Folia 0.7.12');

  const section = folium.registries.settingsSections.register({
    id: 'display',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    // Switches only: Folia draws a mod's "select" setting as a bare system dropdown, which does
    // not match the rest of its settings.
    settings: [
      { key: 'translationFirst', type: 'boolean', label: label('译文为主', 'Translation first'), description: label('大字显示译文，原文放在下面。关闭时大字显示原文。', 'Show the translation large, with the original below it. When off, the original is the large line.'), defaultValue: false },
      { key: 'bilingual', type: 'boolean', label: label('双语显示', 'Show both languages'), defaultValue: true },
      { key: 'ruby', type: 'boolean', label: label('显示注音', 'Show ruby annotations'), defaultValue: true },
      { key: 'caption', type: 'boolean', label: label('注音字幕条', 'Ruby caption'), description: label('使用 Folia 自带的显示模式时，在画面上加一条带注音的当前歌词。只对有内嵌注音的歌生效。', 'While one of the display modes built into Folia is in use, adds the line being sung with its readings as a caption. Only for songs with embedded readings.'), defaultValue: false },
      { key: 'captionTop', type: 'boolean', label: label('字幕条放在顶部', 'Caption at the top'), description: label('关闭时放在底部，Folia 自己的字幕上方。', 'When off, the caption sits at the bottom, above the subtitles of Folia.'), defaultValue: false },
      {
        key: 'poster',
        type: 'boolean',
        label: label('海报歌词（实验性）', 'Poster lyrics (experimental)'),
        description: label('在展开的海报卡片上也用本模组的歌词。Folia 没有为此提供接口，开启后模组会直接修改 Folia 页面里的海报卡片；Folia 更新后可能失效。', 'Also draw these lyrics on the expanded poster card. Folia has no interface for this, so the mod edits the poster card in the host page directly; it may stop working after a Folia update.'),
        defaultValue: false,
      },
    ],
  });
  const params = section.params;

  folium.registries.visualizers.register({
    id: 'reading',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    order: 510,
    hostLayers: { background: true, subtitles: false },
    mount: (container, ctx) => mountReading(container, ctx, folium, params),
  });

  if (folium.env.context !== 'main') return undefined;

  // Reads the Ruby lyrics embedded in the playing MP3 and hands them to the host's lyric state.
  const integration = createIntegration(folium);

  folium.registries.stageLayers.register({
    id: 'poster-lyrics',
    slot: 'app.overlay',
    interactive: false,
    // Mounted only while the setting is on; turning it off removes everything it added.
    mount: (container, ctx) => {
      let dispose = null;
      const sync = () => {
        const wanted = params.get().poster === true;
        if (wanted && !dispose) dispose = mountPoster(container, ctx, folium, params);
        else if (!wanted && dispose) { dispose(); dispose = null; }
      };
      sync();
      const unsubscribe = params.subscribe(sync);
      return () => { unsubscribe(); dispose?.(); dispose = null; };
    },
  });
  // The display modes built into Folia do not draw readings; this caption does, on top of them.
  const OWN_MODE = 'mod:bilingual-ruby-lyrics:reading';
  const modeStore = folium.internals.stores.visualizerSettings;
  const hasReadings = lines => lines.some(line => line.words?.some(word => word.syllables?.some(unit => unit.ruby?.length)));
  folium.registries.stageLayers.register({
    id: 'ruby-caption',
    slot: 'player.stage.front',
    interactive: false,
    mount: (container, ctx) => {
      if (!hasReadings(ctx.lines)) return () => {};
      let dispose = null, shown = null;
      const sync = () => {
        const values = params.get(), position = values.caption === true ? (values.captionTop === true ? 'top' : 'bottom') : null;
        const wanted = position && modeStore?.getState().visualizerMode !== OWN_MODE ? position : null;
        if (wanted === shown) return;
        dispose?.(); dispose = null; shown = wanted;
        if (wanted) dispose = mountReading(container, ctx, folium, params, { strip: wanted });
      };
      sync();
      const unsubscribe = params.subscribe(sync), unsubscribeMode = modeStore?.subscribe(sync);
      return () => { unsubscribe(); unsubscribeMode?.(); dispose?.(); dispose = null; };
    },
  });
  folium.registries.playerPanelTabs.register({
    id: 'lyrics',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    order: 510,
    mount: container => mountPanel(container, params),
  });
  const toggle = (key, id, zh, en, keywords, fallback) => folium.registries.commands.register({
    id,
    label: label('切换' + zh, 'Toggle ' + en),
    keywords,
    run: () => {
      const enabled = !(params.get()[key] ?? fallback);
      params.set({ [key]: enabled });
      return (enabled ? '已开启' : '已关闭') + zh;
    },
  });
  toggle('bilingual', 'toggle-bilingual', '双语显示', 'bilingual lyrics', ['bilingual', '双语', '译文'], true);
  toggle('ruby', 'toggle-ruby', '注音显示', 'ruby annotations', ['ruby', 'furigana', '假名', '注音'], true);

  return () => integration.dispose();
}
return { activate };
})();

export default __client.activate;
