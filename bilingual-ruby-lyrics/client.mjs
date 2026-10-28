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

// The display mode and the poster card take their look from Folia's own poster lyrics, so that
// lyrics with readings sit beside the host's without a seam: each sung unit is filled by a soft
// sweep, a glow rises and fades behind it, the lines before and after are smaller, dimmed and
// slightly blurred, a chorus line takes the accent colour, and keywords take the colours the theme
// gives them, and a line moves, grows or shrinks and fades as it changes place. The numbers are the
// host's (sweep softness, glow radii and envelope, alpha, scale and blur per line, the poster's
// size and margins), checked against its 0.7.22 source; the drawing itself is plain CSS, not the
// host's GPU renderer.
// The caption is drawn over the host's other display modes, and over those of other mods. They
// have nothing in common but the theme's colours, so the caption uses only those, without effects.
const CSS = `
  :host { container-type:inline-size; }
  .reading { --size:calc(clamp(25px,4.4vw,62px) * var(--scale,1)); --base:color-mix(in srgb, var(--reading-primary) 34%, transparent); --word:color-mix(in srgb, var(--reading-primary) 98%, transparent);
    height:100%; width:100%; position:relative; display:flex; flex-direction:column; justify-content:center; gap:max(18px, calc(var(--size) * .49)); padding:clamp(28px,7vw,100px); box-sizing:border-box; overflow:hidden;
    color:var(--reading-primary); text-align:center; font-weight:var(--weight,600); }
  .reading button { appearance:none; background:transparent; border:0; color:inherit; font:inherit; padding:0; cursor:pointer; width:100%; }
  .reading button:focus-visible { outline:2px solid var(--reading-accent); outline-offset:10px; border-radius:6px; }
  .reading .line { overflow-wrap:anywhere; white-space:pre-wrap; font-weight:inherit; }
  .reading .current { font-size:var(--size); line-height:1.75; color:var(--base); --soft:clamp(6px,.45em,16px); --near:.2em; --far:.46em; }
  .reading .current.chorus { --word:color-mix(in srgb, var(--reading-primary) 52%, var(--reading-accent)); --near:.32em; --far:.64em; }
  .reading .current .plain { color:var(--word); }
  .reading .current .timed { color:transparent; -webkit-text-fill-color:transparent; -webkit-background-clip:text; background-clip:text;
    --ink:color-mix(in srgb, var(--word) var(--ink-from,100%), var(--reading-primary));
    background-image:linear-gradient(90deg, var(--ink) 0%, color-mix(in srgb, var(--ink) var(--ink-dim,100%), var(--base)) calc(var(--p,0%) + (var(--pn,0) - 1) * var(--soft)), var(--base) calc(var(--p,0%) + var(--pn,0) * var(--soft))); }
  .reading .current .timed.glow { filter:drop-shadow(0 0 var(--near) color-mix(in srgb, var(--word) var(--g1,0%), transparent)) drop-shadow(0 0 var(--far) color-mix(in srgb, var(--word) var(--g2,0%), transparent)); }
  .reading .near { font-size:calc(var(--size) * .72); line-height:1.3; }
  /* a second voice coming in over the line being sung: smaller, close under it, without rows of its own */
  .reading .current.voice { font-size:calc(var(--size) * .6); line-height:1.6; }
  .reading .current { transition:opacity .3s ease-out; }
  .reading .current.done { opacity:.45; }
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

  /* --fit, --pad and --lift are set in paint() from the card's size */
  .reading.poster { --size:var(--fit,clamp(24px,7cqw,56px)); padding:0 var(--pad,12px) var(--lift,0px); text-align:left;
    -webkit-mask-image:linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent), linear-gradient(to right, transparent, #000 4%, #000 96%, transparent); -webkit-mask-composite:source-in; mask-composite:intersect; }
  .reading.poster .current { line-height:1.7; }
  .reading.poster .current.voice { line-height:1.6; padding-left:.7em; border-left:2px solid color-mix(in srgb, var(--reading-primary) 30%, transparent); }
  .reading.poster .near { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
  .reading.poster .near > div { display:inline; }
  /* the rows under the line (romanization, translation): half size, at most two lines each */
  .reading.poster .secondary, .reading.poster .romaji { font-size:.5em; font-weight:var(--sub-weight,500); line-height:1.35; margin-top:.3em; letter-spacing:normal;
    display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }

  /* The caption does not follow the host's subtitle settings: it is always opaque, one size, and
     uses nothing but the theme's colours. Words to come are in the secondary colour, sung words in
     the lyric colour, the unit being sung in the accent colour; no sweep, no glow. */
  .reading.strip { --size:clamp(18px,2.3vw,34px); --weight:500; height:auto; position:absolute; left:0; right:0; padding:0 clamp(16px,6vw,96px); gap:0; pointer-events:none; align-items:center; overflow:visible; }
  .reading.strip .current { color:var(--reading-primary); }
  .reading.strip .current.voice { font-size:.72em; margin-top:0; }
  .reading.strip .current .timed { background-image:none; -webkit-text-fill-color:currentColor; color:var(--reading-secondary); }
  .reading.strip .current .timed.sung { color:var(--reading-primary); }
  .reading.strip .current .timed.now { color:var(--reading-accent); }
  /* A soft shadow in the theme's background colour keeps it readable over whatever the display
     mode draws. Over a see-through player page (see seeThrough) what is behind the text is not
     the theme's background and a wide shadow reads as a smudge, so the text gets a hard shadow
     instead: the glyphs again in that colour, set down and to the right with no blur, in three
     steps, so that the shadow is one solid slab: 3px each way at the caption's full size
     (.088em). As a filter, so that the readings above the text get the same edge. */
  .reading.strip .current { filter:drop-shadow(0 1px 3px color-mix(in srgb, var(--reading-bg,#000) 55%, transparent)) drop-shadow(0 0 14px color-mix(in srgb, var(--reading-bg,#000) 35%, transparent)); }
  .reading.strip.clear .current { filter:drop-shadow(max(.5px,.0295em) max(.5px,.0295em) 0 var(--reading-bg,#000)) drop-shadow(max(.5px,.0295em) max(.5px,.0295em) 0 var(--reading-bg,#000)) drop-shadow(max(.5px,.0295em) max(.5px,.0295em) 0 var(--reading-bg,#000)); }
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

// A few host settings are not handed to mods. They are read where Folia stores them, each at most
// once a second.
const stored = new Map();
const hostSetting = key => {
  const now = Date.now(), known = stored.get(key);
  if (known && now - known.at < 1000) return known.value;
  let value = null;
  try { value = globalThis.localStorage?.getItem(key) ?? null; } catch { /* no storage here */ }
  stored.set(key, { at: now, value });
  return value;
};

// Which rows go with the lyrics is the host's to say, with its subtitle setting: the translation,
// the romanization, both, or neither. This mod has no switch of its own for them.
// Folia reports its two-row setting (romanization above translation) to mods as 'translation';
// the stored setting says which it is.
const hostRows = display => {
  if (display.showSubtitleTranslation === false) return { translation: false, romaji: false };
  const mode = display.subtitleContentMode ?? 'translation';
  if (mode === 'romanization') return { translation: false, romaji: true };
  if (mode !== 'translation') return { translation: false, romaji: false };
  return { translation: true, romaji: hostSetting('subtitle_content_mode') === 'both' };
};

// The user has hidden Folia's bottom subtitle layer on the player page. A stage layer is not told
// (the host computes it outside its stores), so the stored setting is read.
const hostLayerHidden = display => display.hideTranslationSubtitle === true || hostSetting('hide_player_translation_subtitle') === 'true';

// Where Folia's own subtitle rows sit on the page: how far the top of the first row is above the
// bottom edge of their box, and where that edge is. Read from the layout (not from on-screen
// rectangles, which move while the rows animate in). Null while no row is shown. The rows are
// found by the same marker the stylesheet below goes by.
function hostSubtitleBox(doc) {
  const row = doc.querySelector('[data-subtitle-track]'), box = row?.parentElement?.parentElement?.parentElement;
  if (!box?.offsetParent) return null;
  let top = 0;
  for (let node = row; node && node !== box; node = node.offsetParent) { if (!box.contains(node)) return null; top += node.offsetTop; }
  const bottom = parseFloat(doc.defaultView.getComputedStyle(box).bottom);
  if (!Number.isFinite(bottom)) return null;
  return { height: box.offsetHeight - top, bottom, edge: box.offsetParent.getBoundingClientRect().bottom };
}

// The player page shows what is behind the window (transparent background, or the system's blur)
// instead of the theme's background. A shadow in the theme's background colour then has nothing
// to blend into.
const seeThrough = () => hostSetting('transparent_player_background') === 'true' || hostSetting('enable_player_page_native_blur') === 'true';

// The caption's shadow, for text: soft, in the theme's background colour; hard and offset over a
// see-through player page.
const captionShadow = theme => seeThrough()
  ? [1, 2, 3].map(step => `max(${step * .5}px,${step * .0295}em) max(${step * .5}px,${step * .0295}em) 0 ${theme.backgroundColor}`).join(', ')
  : `0 1px 3px color-mix(in srgb, ${theme.backgroundColor} 55%, transparent), 0 0 14px color-mix(in srgb, ${theme.backgroundColor} 35%, transparent)`;

// A stylesheet that gives Folia's own subtitle rows (the romanization and the translation under
// its display modes) the look of the caption they sit next to: opaque, the caption's shadow, and
// no blurred plate behind them. Folia offers mods no styling hook for these rows, so the rules
// go by the markers its subtitle layer happens to carry (data-subtitle-track and the layout
// around it, the same from 0.7.12 to 0.7.22). If a later Folia changes them the rules simply stop
// matching and its subtitles look as they always did.
function hostSubtitleCss(theme) {
  const shadow = captionShadow(theme);
  return `
    div:has(> div > div > [data-subtitle-track]) { opacity:1 !important; }
    div:has(> div > [data-subtitle-track]) > div[aria-hidden="true"] { display:none !important; }
    [data-subtitle-track] { opacity:1 !important; text-shadow:${shadow} !important; }`;
}

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

// Distance, in px, between the caption's box and the top of Folia's first subtitle row. The
// caption's line box already leaves a third of an em under its text, a little more than the rows
// leave between themselves; it is taken in slightly so that the three lines read as one group.
const STRIP_GAP = -4;

// The poster's size, as Folia sizes its own poster lyrics: the largest from 64px down to 24px at
// which a fixed budget fits the card's height (three rows of the line being sung and two of each
// line beside it at .72, with the gaps between them and the room around, plus two half-size rows
// under the line when one is shown) and three widths of "国Agyp" fit across it. The budget is
// fixed so that the size does not change from line to line.
function fitPoster(doc, width, height, font, weight, subFont, subWeight, withSub) {
  const pen = doc.createElement('canvas').getContext('2d');
  if (!pen) return null;
  const measure = style => {
    pen.font = style;
    const m = pen.measureText('国Agyp');
    return { width: m.width, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
  };
  for (let size = 64; size > 24; size--) {
    const main = measure(`${weight} ${size}px ${font}`), row = Math.max(size * 1.18, main.height + 2);
    const sub = withSub ? Math.max(size * .675, measure(`${subWeight} ${size / 2}px ${subFont}`).height + 2) * 2 + size * .3 : 0;
    if (row * 4.44 + size * 2.18 + sub <= height && main.width * 3 <= width - size * 1.2) return size;
  }
  return 24;
}

// How a line changes place, after Folia's: it glides to its new place and size (the host uses a
// spring that settles in about half a second, without overshoot), and fades and sharpens or blurs
// in about a third of a second. A line coming in starts small, clear and blurred a little below or
// above its place; one going out fades while it moves on.
const MOVE = { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' };
const FADE = { duration: 300, easing: 'cubic-bezier(.32,.72,0,1)' };

// strip: only the line being sung, with its readings, as a caption over another display mode
function mountReading(container, ctx, folium, params, { poster = false, strip = null } = {}) {
  const style = document.createElement('style'); style.textContent = CSS;
  const root = document.createElement('div'); root.className = strip ? 'reading strip ' + strip : poster ? 'reading poster' : 'reading';
  container.append(style, root);
  const view = root.ownerDocument.defaultView;
  // the poster card's size, kept by an observer so that paint() does not ask for layout each frame
  let box = null, fitted = '';
  const resize = poster && typeof view?.ResizeObserver === 'function'
    ? new view.ResizeObserver(() => { box = { width: root.offsetWidth, height: root.offsetHeight }; paint(); }) : null;
  resize?.observe(root);
  // Where the rows are before the lines change, in the layer's own pixels (the poster card is
  // drawn scaled down), so that they can be moved from there.
  const snapshot = () => {
    const origin = root.getBoundingClientRect(), k = origin.width / (root.offsetWidth || 1) || 1, rows = new Map();
    for (const row of root.children) {
      if (!row.dataset?.line) continue;
      const r = row.getBoundingClientRect(), cs = view.getComputedStyle(row);
      rows.set(row.dataset.line, { row, x: (r.left - origin.left) / k, y: (r.top - origin.top) / k, width: r.width / k,
        font: parseFloat(cs.fontSize) || 1, opacity: cs.opacity, filter: cs.filter, passed: row.classList.contains('passed') });
    }
    return { rows, k };
  };
  const settle = ({ rows, k }) => {
    const origin = root.getBoundingClientRect(), center = !poster, seen = new Set();
    for (const row of root.children) {
      const line = row.dataset?.line;
      if (!line) continue;
      const r = row.getBoundingClientRect(), cs = view.getComputedStyle(row), old = rows.get(line);
      row.style.transformOrigin = center ? 'center top' : 'left top';
      if (old) {
        seen.add(line);
        const x = (r.left - origin.left) / k, y = (r.top - origin.top) / k, width = r.width / k;
        const dx = center ? old.x + old.width / 2 - (x + width / 2) : old.x - x;
        row.animate([{ transform: `translate(${dx}px, ${old.y - y}px) scale(${old.font / (parseFloat(cs.fontSize) || 1)})` }, { transform: 'none' }], MOVE);
        row.animate([{ opacity: old.opacity, filter: old.filter }, { opacity: cs.opacity, filter: cs.filter }], FADE);
      } else {
        const below = !row.classList.contains('passed');
        row.animate([{ transform: `translateY(${below ? 34 : -34}px) scale(.7)` }, { transform: 'none' }], MOVE);
        row.animate([{ opacity: 0, filter: 'blur(5px)' }, { opacity: cs.opacity, filter: cs.filter }], FADE);
      }
    }
    for (const [line, old] of rows) {
      if (seen.has(line)) continue;
      const ghost = old.row;
      delete ghost.dataset.line;  // not taken for a line again if the next change comes before it is gone
      Object.assign(ghost.style, { position: 'absolute', left: old.x + 'px', top: old.y + 'px', width: old.width + 'px', margin: '0', pointerEvents: 'none' });
      root.append(ghost);
      const away = ghost.animate([{ transform: 'none', opacity: old.opacity }, { transform: `translateY(${old.passed ? -38 : 38}px)`, opacity: 0 }], { ...FADE, fill: 'forwards' });
      away.onfinish = away.oncancel = () => ghost.remove();
    }
  };
  const lines = pairBilingual(ctx.lines);
  let previousIndex = -2, optionsKey = '', timed = [], rows = [];
  // the caption's place above Folia's subtitle rows, as last measured (see paint)
  let measured = null, measuredAt = 0;
  // where a line's last unit is sung, as the host would keep it on the screen
  const endOf = line => {
    try { return Math.max(line.endTime, folium.lyrics?.getLineRenderEndTime?.(line) ?? line.endTime); } catch { return line.endTime; }
  };
  // Lines sung over each other (亡国のネメシス: a second voice comes in while the first is still going;
  // the host keeps one line at a time, so the first stopped lighting up). The lines on the screen are
  // the last one started and those still being sung when it started: they change only as a line
  // starts, never as one ends (a line that ends dims where it is), and stay in the order they started.
  const groupOf = index => {
    if (index < 0 || ctx.staticMode) return index < 0 ? [] : [index];
    const at = lines[index].startTime, group = [];
    for (let i = Math.max(0, index - 4); i < index; i++) if (lines[i].startTime <= at && at < endOf(lines[i])) group.push(i);
    return [...group, index];
  };
  // A line's part is settled as it starts and kept: one that starts while a leading line still has
  // half a second or more to go is a second voice (drawn small); otherwise it leads, also when only a second voice is
  // still going (the next line of the first voice). Lines starting together are a duet: both lead.
  const voice = [];
  lines.forEach((line, i) => {
    voice[i] = false;
    for (let j = Math.max(0, i - 4); j < i; j++) {
      // (a line that starts as the one before is just ending is the next line, not a second voice)
      if (!voice[j] && lines[j].startTime < line.startTime - .05 && line.startTime < endOf(lines[j]) - .5) voice[i] = true;
    }
  });
  const indexAt = time => {
    if (ctx.staticMode) return Math.min(lines.length - 1, Math.max(0, ctx.staticLineIndex ?? 0));
    let selected = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startTime <= time) selected = i;
      else break;
    }
    if (selected >= 0 && time > Math.max(...groupOf(selected).map(i => lines[i].endTime)) + 1) return -1;
    return selected;
  };
  // Keyword colours: those of the theme, as Folia's poster lyrics use them. (The switch Folia keeps
  // for them in its Monet settings is not something a mod can read.)
  const paint = () => {
    const theme = ctx.getTheme(), display = ctx.getDisplay(), settings = params.get();
    let shown = hostRows(display);
    // The poster shows no row under the line while the player's subtitle layer is hidden. With both
    // rows on it shows both, romanization above the translation: Folia's own poster shows only the
    // translation then, for now (its source says a second row is to come).
    if (poster && display.hideTranslationSubtitle === true) shown = { translation: false, romaji: false };
    root.style.setProperty('--reading-primary', theme.primaryColor);
    root.style.setProperty('--reading-secondary', theme.secondaryColor);
    root.style.setProperty('--reading-accent', theme.accentColor);
    if (strip) {
      root.style.setProperty('--reading-bg', theme.backgroundColor);
      root.classList.toggle('clear', seeThrough());
    }
    const font = folium.theme.resolveFontStack(theme), weight = folium.theme.resolveFontWeight?.(theme, 600) ?? 600;
    root.style.fontFamily = font;
    if (!strip) root.style.setProperty('--weight', String(weight));
    // Translations and the romanization row follow the host's subtitles: their theme (0.7.17 on;
    // before that the lyric theme), their font and weight.
    let subtitle = theme;
    try { subtitle = ctx.getSubtitleTheme?.() ?? theme; } catch { /* keep the lyric theme */ }
    root.style.setProperty('--reading-sub', subtitle.primaryColor);
    const subFont = folium.theme.resolveTranslationFontStack?.(subtitle) ?? folium.theme.resolveFontStack(subtitle);
    const subWeight = folium.theme.resolveFontWeight?.(subtitle, 500) ?? 500;
    root.style.setProperty('--sub-font', subFont);
    root.style.setProperty('--sub-weight', String(subWeight));
    if (poster && box) {
      const withSub = shown.translation || shown.romaji;
      const fitKey = JSON.stringify([box.width, box.height, font, weight, subFont, subWeight, withSub]);
      if (fitted !== fitKey) {
        fitted = fitKey;
        const size = fitPoster(root.ownerDocument, box.width, box.height, font, weight, subFont, subWeight, withSub);
        if (size) {
          // the margin left and right is .6 of the size; the line being sung sits around 46% of the
          // card's height, a little above the middle
          root.style.setProperty('--fit', size + 'px');
          root.style.setProperty('--pad', Math.ceil(size * .6) + 'px');
          root.style.setProperty('--lift', Math.round(box.height * .08) + 'px');
        }
      }
    }
    // Sizes follow the host's multipliers: the lyric size for the display mode, the subtitle size
    // for its translation. The host fits its poster lyrics to the card and has no multiplier
    // there, so the poster has none either; the caption keeps its own size.
    root.style.setProperty('--scale', String(poster || strip ? 1 : display.lyricsFontScale || 1));
    root.style.setProperty('--sub-scale', String(poster || strip ? 1 : display.subtitleFontScale || 1));
    // The wall remains visible outside the player; showText belongs to the player stage.
    root.style.opacity = String(poster ? 1 : display.showText === false ? 0 : strip ? 1 : display.visualizerOpacity ?? 1);
    if (strip === 'bottom') {
      // Sit just above Folia's own subtitle rows: none when subtitles are off or the bottom
      // subtitle layer is hidden, else one, or two when romanization and translation are both shown.
      const rows = hostLayerHidden(display) ? 0 : Number(shown.translation) + Number(shown.romaji);
      const view = root.ownerDocument.defaultView, width = view?.innerWidth || 1280, scale = display.subtitleFontScale || 1;
      // Where the rows really are is measured on the page, a few times a second. The tallest box
      // seen for the current settings is kept, so that the caption does not bob when a line has
      // one row fewer, and the last measurement serves while no row is shown.
      const now = Date.now();
      if (rows && now - measuredAt > 250) {
        measuredAt = now;
        let box = null;
        try { box = hostSubtitleBox(root.ownerDocument); } catch { /* fall back to the estimate */ }
        if (box) {
          const same = measured && measured.rows === rows && measured.width === width && measured.scale === scale;
          const mine = (root.offsetParent || container.host)?.getBoundingClientRect?.().bottom ?? box.edge;
          measured = { rows, width, scale, height: Math.max(box.height, same ? measured.height : 0), bottom: box.bottom + mine - box.edge };
        }
      }
      let bottom;
      if (rows && measured && measured.rows === rows && measured.width === width && measured.scale === scale) {
        // the caption's line box has about a third of an em of empty room under the text, which is the gap
        bottom = measured.bottom + measured.height + STRIP_GAP;
      } else {
        // not measured yet: the rows start 112px up (32px while the player controls are hidden),
        // a row is the subtitle font at 1.5 line height
        const font = Math.min(20, Math.max(18, .026 * width)) * scale;
        bottom = (display.isPlayerChromeHidden ? 32 : 112) + rows * (font * 1.5 + 4) + Math.max(0, rows - 1) * 8 - (rows ? 12 : 0);
      }
      root.style.bottom = Math.round(bottom) + 'px';
    }
    const time = ctx.lyricTime.get(), index = indexAt(time), singing = groupOf(index);
    // keyword colours are for the display mode and the poster; the caption has the theme's three colours only
    const keywords = !strip && theme.wordColors?.length ? theme.wordColors : null;
    const key = JSON.stringify([settings.primary, settings.ruby, shown, keywords]);
    if (previousIndex !== index || optionsKey !== key) {
      // lines move to their new places only as the song goes on to the next line, not on a seek
      const moving = !strip && !ctx.staticMode && optionsKey === key && previousIndex !== -2
        && (index === previousIndex + 1 || previousIndex === -1 || index === -1)
        && typeof root.animate === 'function' && !view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const before = moving ? snapshot() : null;
      previousIndex = index; optionsKey = key; timed = []; rows = []; root.replaceChildren();
      const options = strip
        ? { primary: 'original', bilingual: false, ruby: true, romaji: false }
        : { primary: settings.primary === 'translation' ? 'translation' : 'original', bilingual: shown.translation, ruby: settings.ruby !== false, romaji: shown.romaji };
      const coloursOf = line => {
        if (!keywords) return [];
        try { return folium.lyrics?.buildWordColorRanges?.(line.fullText, keywords) || []; } catch { return []; }
      };
      // where: 'passed' for the line before the current one, 'waiting' for the one after
      // voice: a line that came in while another is still being sung (a second voice), drawn small
      const addLine = (line, current, where = '', voice = false) => {
        if (!line) return;
        const row = document.createElement(!poster && !strip && !ctx.isPreview && folium.env.context === 'main' ? 'button' : 'div');
        row.dataset.line = String(lines.indexOf(line));
        row.className = current ? 'line current' + (line.isChorus ? ' chorus' : '') + (voice ? ' voice' : '') : 'line near ' + where;
        // the glow of a line's last units lasts until the host would take that line off the screen
        const end = current ? endOf(line) : 0, first = timed.length;
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
        const romaji = current && !voice && options.romaji && line.romanization ? document.createElement('div') : null;
        if (romaji) { romaji.className = 'romaji'; romaji.textContent = line.romanization; }
        if (romaji && !translated) row.append(romaji);
        if (current && !voice && options.bilingual && line.translation) {
          const secondary = document.createElement('div'); secondary.className = 'secondary';
          if (translated) appendOriginal(secondary, line, options.ruby, timed, coloursOf(line));
          else { secondary.textContent = line.translation; secondary.classList.add('translation'); }
          row.append(secondary);
          if (romaji && translated) row.append(romaji);
        }
        for (let k = first; k < timed.length; k++) timed[k].lineEnd = end;
        if (current) rows.push({ row, end: line.endTime });
        root.append(row);
      };
      if (strip) for (const i of singing) addLine(lines[i], true, '', voice[i]);
      else if (!lines.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '这首歌暂无歌词'; root.append(empty); }
      else if (index < 0) {
        const next = lines.find(line => line.startTime > time);
        if (next) addLine(next, true);
      } else {
        // while two are sung the line before them gives up its row, and on the poster the next one too
        const together = singing.length > 1;
        if (!together) addLine(lines[index - 1], false, 'passed');
        for (const i of singing) addLine(lines[i], true, '', voice[i]);
        if (!together || !poster) addLine(lines[index + 1], false, 'waiting');
      }
      if (before) settle(before);
    }
    // of several lines on the screen, one already sung dims where it is
    if (rows.length > 1) for (const { row, end } of rows) row.classList.toggle('done', time >= end);
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
      // (with the "step" setting a unit is filled whole the moment it starts, as in the caption,
      // instead of being swept; its glow rises as before)
      const filled = sung ? 1 : now ? (settings.step === true ? 1 : (time - unit.start) / Math.max(.001, unit.end - unit.start)) : 0;
      if (unit.filled !== filled) {
        unit.filled = filled;
        unit.element.style.setProperty('--pn', filled.toFixed(3));
        unit.element.style.setProperty('--p', (filled * 100).toFixed(1) + '%');
        // as the host's: while a unit is being swept, its lit part turns from the lyric colour to
        // its own as it goes, and is a little dimmer towards its end (.92 at two thirds of the way,
        // .72 at the end); once sung it is its own colour throughout
        const swept = now && settings.step !== true;
        const dim = !swept ? 1 : filled < .68 ? 1 - .08 * filled / .68 : .92 - .2 * (filled - .68) / .32;
        unit.element.style.setProperty('--ink-from', ((swept ? filled : 1) * 100).toFixed(1) + '%');
        unit.element.style.setProperty('--ink-dim', (dim * 100).toFixed(1) + '%');
      }
      // the glow, in steps of 1/40 so that the filter is not rebuilt for changes nobody can see
      const glow = unit.main && !ctx.staticMode ? Math.round(glowAt(time, unit.start, unit.end, unit.lineEnd) * 40) / 40 : 0;
      if (unit.glow !== glow) {
        unit.glow = glow;
        unit.element.classList.toggle('glow', glow > 0);
        unit.element.style.setProperty('--g1', (glow * 60).toFixed(1) + '%');
        unit.element.style.setProperty('--g2', (glow * 88).toFixed(1) + '%');
      }
    }
  };
  paint();
  const unsubscribeClock = ctx.onLyricTime(paint);
  const unsubscribeContext = ctx.onChange(paint);
  const unsubscribeParams = params.onChange(paint);
  return () => { resize?.disconnect(); unsubscribeClock(); unsubscribeContext(); unsubscribeParams(); root.remove(); style.remove(); };
}
return { hostSubtitleCss, mountReading };
})();

// ---- poster.mjs
const __poster = (() => {
const { mountReading } = __renderer;

// Opt-in ("海报歌词" in the settings, off by default). Folia 0.7.12 has no registry for the
// lyrics drawn on the expanded poster card, so this adapter reaches into the host page: it adds
// one <style>, one child element and one marker attribute per poster, and watches the page for
// posters appearing. The manifest sets no "folia" range (that would switch the whole mod off on
// the next host release): if the host changes this markup, the selector finds no poster, nothing is
// hidden or added, and the host's own poster lyrics stay as they are. It removes everything it
// added when disposed.
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
        <span id="lyrics-step-label">逐字跳亮</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-step-label" aria-checked="false" data-switch="step"></button>
      </div>
      <div class="row">
        <span id="lyrics-poster-label">海报歌词（实验性）</span>
        <button class="switch" type="button" role="switch" aria-labelledby="lyrics-poster-label" aria-checked="false" data-switch="poster"></button>
      </div>
    </section>`;

  // ruby is on unless turned off; the poster override and the step fill are off unless turned on
  const isOn = (values, key) => key === 'poster' || key === 'step' ? values[key] === true : values[key] !== false;
  const refresh = () => {
    const values = params.get();
    const primary = values.primary === 'translation' ? 'translation' : 'original';
    for (const button of root.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === primary));
    const strip = values.strip === 'top' || values.strip === 'bottom' ? values.strip : 'off';
    for (const button of root.querySelectorAll('[data-strip]')) button.setAttribute('aria-pressed', String(button.dataset.strip === strip));
    for (const button of root.querySelectorAll('[data-switch]')) button.setAttribute('aria-checked', String(isOn(values, button.dataset.switch)));
  };
  for (const button of root.querySelectorAll('[data-language]')) button.addEventListener('click', () => params.set({ primary: button.dataset.language }));
  for (const button of root.querySelectorAll('[data-strip]')) button.addEventListener('click', () => params.set({ strip: button.dataset.strip }));
  for (const button of root.querySelectorAll('[data-switch]')) button.addEventListener('click', () => params.set({ [button.dataset.switch]: !isOn(params.get(), button.dataset.switch) }));
  container.append(style, root);
  refresh();
  const unsubscribe = params.onChange(refresh);
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
//   ID3v2            MP3, AAC, TTA; inside a chunk in WAV, AIFF and     USLT frames
//                    DSDIFF (.dff); at the end of a DSF file
//   Vorbis comments  FLAC, Ogg Vorbis, Opus                             LYRICS, RUBY_LYRICS
//   MP4 atoms        M4A, ALAC                                          ©lyr, ----:com.apple.iTunes:RUBY_LYRICS
//   APEv2            APE, WavPack, TTA                                  Lyrics, RUBY_LYRICS
//   ASF attributes   WMA                                                WM/Lyrics, RUBY_LYRICS
//
// `read(offset, length)` returns that part of the file (shorter at the end of the file); only
// headers and tag areas are asked for, never the audio. Nothing here writes to a file.
const { id3Header, parseId3 } = __id3;

const RUBY_TAG = 'RUBY_LYRICS';
/** The extensions Folia 0.7.22 accepts as local music. */
const AUDIO_FILE = /\.(mp3|flac|m4a|wav|ogg|opus|aac|alac|ape|wv|tta|wma|aif|aiff|caf|dsf|dff)$/i;
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

// DSF: the 28-byte "DSD " chunk ends with where the file's ID3v2 tag starts (0: none), little-endian.
async function dsf(read, position) {
  const header = await read(position, 28);
  if (header.length < 28) return [];
  const pointer = little(header.subarray(20, 28));
  return pointer ? (await id3At(read, pointer)).lyrics : [];
}

// DSDIFF (.dff): a FRM8 form of big-endian chunks with 64-bit sizes; the tag is an "ID3 " chunk.
async function dff(read, position, size) {
  position += 16;
  for (let guard = 0; guard < 4096 && position + 12 <= size; guard++) {
    const header = await read(position, 12);
    if (header.length < 12) break;
    const length = big(header.subarray(4, 12));
    if (ascii(header.subarray(0, 4)).toUpperCase() === 'ID3 ') return (await id3At(read, position + 12)).lyrics;
    position += 12 + length + (length & 1);
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
  else if (magic === 'DSD ') found.push(...await dsf(read, start));
  else if (magic === 'FRM8') found.push(...await dff(read, start, size));
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
async function findLocalRecords(song, seconds = 0, fresh = false) {
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
return { findLocalRecords, isAbsoluteAudioPath, readLocalEmbedded };
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
  // TimeTag/NicoKara: the @Ruby footer, or (a song without readings) lines timed with [MM:SS:CC]
  const nico = /^@Ruby\d+=/m.test(text) || /^\[\d+:\d{2}:\d{2,3}\]/m.test(text);
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

// ---- cyrillic.mjs
const __cyrillic = (() => {
// Latin letters for lyrics written in Cyrillic, worked out from the spelling alone: these lyrics
// carry no readings to follow. Russian is spelled the way it is sung wherever the spelling gives
// that away (его = yevo, что = shto, -ться = -tsa); stress is not written, so an unstressed о
// stays o. Ukrainian, Belarusian, Kazakh, Serbian and Macedonian, told apart by their own letters,
// get their usual Latin spelling letter for letter.

const CYRILLIC = /[Ѐ-ӿ]/u;
const WORD = /[Ѐ-ӿ]+/gu;

const RUSSIAN = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',
  р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
};
const LETTERS = {
  ru: RUSSIAN,
  uk: { ...RUSSIAN, г:'h', ґ:'g', и:'y', і:'i', ї:'yi', є:'ye' },
  be: { ...RUSSIAN, г:'h', ў:'w', і:'i' },
  kk: { ...RUSSIAN, ә:'ä', ғ:'ğ', ж:'j', й:'i', қ:'q', ң:'ñ', ө:'ö', ұ:'ū', ү:'ü', х:'h', һ:'h', і:'ı' },
  sr: { ...RUSSIAN, ђ:'đ', ж:'ž', ј:'j', љ:'lj', њ:'nj', ћ:'ć', х:'h', ц:'c', ч:'č', џ:'dž', ш:'š', ѓ:'gj', ќ:'kj', ѕ:'dz' },
};
// the letters each language has and Russian does not; checked in this order, since Kazakh and
// Belarusian also write і
const OWN_LETTERS = [['sr', /[јљњћђџѓќѕ]/iu], ['kk', /[әғқңөұүһ]/iu], ['be', /ў/iu], ['uk', /[іїєґ]/iu]];

// Russian words not said the way they are written
const SAID = { что:'shto', чтобы:'shtoby', ничто:'nishto', конечно:'koneshno', скучно:'skushno', нарочно:'naroshno', сегодня:'sevodnya' };
// words where -ого is part of the word, not the ending said -ovo
const OGO_IN_THE_WORD = new Set(['много','немного','строго','нестрого','дорого','недорого','убого','полого','отлого','ого']);
const AFTER_VOWEL = /[аеёиоуыэюяъь]/u;

function russianWord(word) {
  const lower = word.toLowerCase();
  if (SAID[lower]) return SAID[lower];
  let spelled = OGO_IN_THE_WORD.has(lower) ? lower : lower.replace(/([ое])го$/u, '$1во');
  spelled = spelled.replace(/ть?ся$/u, 'ца');
  const chars = [...spelled];
  return chars.map((char, index) => {
    const before = chars[index - 1];
    // е starts with a y sound at the start of a word and after a vowel; ё has none after ж ш ч щ ц
    if (char === 'е' && (index === 0 || AFTER_VOWEL.test(before))) return 'ye';
    if (char === 'ё' && /[жшчщц]/u.test(before ?? '')) return 'o';
    return RUSSIAN[char] ?? char;
  }).join('');
}

/** The language of some Cyrillic text, from the letters only that language has. */
function cyrillicLanguage(text) {
  return OWN_LETTERS.find(([, letters]) => letters.test(text))?.[0] ?? 'ru';
}

/** The Cyrillic words of a text in Latin letters, lower case; everything else is left as it is. */
function cyrillicToLatin(text, language = cyrillicLanguage(text)) {
  const letters = LETTERS[language] ?? RUSSIAN;
  return text.replace(WORD, word => language === 'ru'
    ? russianWord(word)
    : [...word.toLowerCase()].map(char => letters[char] ?? char).join(''));
}
return { CYRILLIC, cyrillicLanguage, cyrillicToLatin };
})();

// ---- romaji.mjs
const __romaji = (() => {
// Romanization of a line, built from the readings already on it: kana are spelled out as they
// are, and anything with a ruby annotation is spelled from its reading. Nothing is looked up, so
// the result is exactly as right as the embedded readings. Lines in Cyrillic, which come without
// readings, are spelled from their letters (cyrillic.mjs).
const { CYRILLIC, cyrillicLanguage, cyrillicToLatin } = __cyrillic;

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

// Full-width punctuation as it is written among Latin letters.
const latinPunctuation = text => text.replace(/[，、]/gu, ', ').replace(/。/gu, '. ').replace(/！/gu, '! ').replace(/？/gu, '? ').replace(/：/gu, ': ').replace(/；/gu, '; ');

/**
 * The line in Latin letters, or undefined when it has nothing to spell out (no kana, no readings,
 * no Cyrillic). `language` is the Cyrillic language of the whole song, when known.
 */
function romanizeLine(line, language) {
  const cells = sungCharacters(line);
  const text = typeof line?.fullText === 'string' ? line.fullText : '';
  // the words must add up to the line, or the positions below mean nothing
  if (!cells.length || cells.length !== [...text].length || !cells.some(cell => cell.read || isKana(cell.text))) {
    // a line in Cyrillic without readings is spelled out as it is written
    if (!CYRILLIC.test(text)) return undefined;
    const result = latinPunctuation(cyrillicToLatin(text, language)).replace(/\s+/g, ' ').replace(/\s+([,.!?:;])/g, '$1').trim();
    return result || undefined;
  }
  // the splitter counts in UTF-16 units, the cells in characters
  const offsets = new Map();
  { let units = 0, count = 0; for (const char of text) { offsets.set(units, count++); units += char.length; } }
  const spell = sung => cyrillicToLatin(kanaToLatin(sung), language).replace(/[^\p{L}\p{N}'’\-]+/gu, ' ');
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
const withRomanization = lines => {
  // the language is told from the whole song: a single line may have none of its own letters
  const language = cyrillicLanguage(lines.map(line => line?.fullText ?? '').join('\n'));
  return lines.map(line => {
    if (line?.romanization) return line;
    const romanization = romanizeLine(line, language);
    return romanization ? { ...line, romanization } : line;
  });
};
return { romanizeLine, withRomanization };
})();

// ---- integration.mjs
const __integration = (() => {
const { pairBilingual } = __lyrics;
const { findLocalRecords, readLocalEmbedded } = __local_song;
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
// The file's TimeTag/NicoKara version (beside the plain LRC every player reads) is worth taking when it
// has readings, or, for a song without readings (English, Chinese), the time of each word.
const TIMETAG = /^\[\d+:\d{2}:\d{2,3}\]/m;
const isTimeTag = text => /@Ruby\d*\s*=/.test(text) || TIMETAG.test(text);
const wordTimed = lines => lines?.some(line => line.words?.length > 1);
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
function createIntegration(folium, {readEmbedded = record => readLocalEmbedded(record,folium.rpc), findRecords = findLocalRecords} = {}) {
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
      // The length helps tell apart files with the same title, artists and album, but only when it
      // is this song's: during an automix blend the incoming track is asked for while the one it
      // leaves is still the player's song.
      const playing=folium.playback?.getState?.();
      const seconds=keyOf(playing?.song)===key ? playing.duration || 0 : 0;
      const readAll = async records => {
        const found=[];
        for (const record of records.slice(0,8)) {
          for (const source of await readEmbedded(record)) {
            // Ordinary embedded lyrics are already Folia's.
            if (!isTimeTag(source.text)) continue;
            try {
              const lyrics=parseFaKara(source.text);
              if (hasRuby(lyrics?.lines) || wordTimed(lyrics?.lines)) {found.push(lyrics);break;}
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
  // Lyrics already on the player when the mod starts (Folia restores the last song before it
  // loads its mods, and a mod can be switched on mid-song) went past the hook before it was there:
  // have Folia run it again for them.
  try {folium.lyrics.refresh();} catch { /* nothing on the player yet */ }
  return {
    get:()=>({...state}),
    dispose() {
      disposed=true;stop?.();stopSong?.();known.clear();
      // Folia runs the hook again without this handler: its own lyrics come back.
      try {folium.lyrics.refresh();} catch { /* the host is going away */ }
    },
  };
}
return { createIntegration };
})();

// ---- client.mjs
const __client = (() => {
const { mountReading, hostSubtitleCss } = __renderer;
const { mountPoster } = __poster;
const { mountPanel } = __panel;
const { createIntegration } = __integration;

const label = (zh, en) => ({ 'zh-CN': zh, en: en || zh });

function activate(folium) {
  if (folium.host.folium.minor < 7) throw new Error('本模组需要 Folium 1.7 / Folia 0.7.22 或更新的版本');

  const section = folium.registries.settingsSections.register({
    id: 'display',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    settings: [
      {
        key: 'primary',
        type: 'select',
        label: label('主要显示', 'Primary language'),
        description: label('另一种语言和罗马音显示与否，跟随 Folia 自己的字幕设置（翻译、罗马音、两者、隐藏）。', 'Whether the other language and the romanization are shown follows Folia\'s own subtitle setting (translation, romanization, both, hidden).'),
        defaultValue: 'original',
        options: [
          { value: 'original', label: label('原文', 'Original') },
          { value: 'translation', label: label('译文', 'Translation') },
        ],
      },
      { key: 'ruby', type: 'boolean', label: label('显示注音', 'Show ruby annotations'), defaultValue: true },
      {
        key: 'strip',
        type: 'select',
        label: label('注音字幕条', 'Ruby caption'),
        description: label('使用 Folia 自带的显示模式时，在画面上加一条带注音的当前歌词。只对有内嵌注音的歌生效。底部是指 Folia 自己的字幕上方。', 'While one of the display modes built into Folia is in use, adds the line being sung with its readings as a caption. Only for songs with embedded readings. Bottom means just above the subtitles of Folia.'),
        defaultValue: 'off',
        options: [
          { value: 'off', label: label('关', 'Off') },
          { value: 'bottom', label: label('底部', 'Bottom') },
          { value: 'top', label: label('顶部', 'Top') },
        ],
      },
      {
        key: 'step',
        type: 'boolean',
        label: label('逐字跳亮', 'Light each character at once'),
        description: label('显示模式和海报歌词里，每个字到点时整个亮起（和注音字幕条一样一字一跳），而不是从左到右扫过。光晕、颜色等其余效果不变。', 'In the display mode and the poster lyrics, each character lights up whole when its time comes (one by one, as in the ruby caption) instead of being swept from left to right. The glow, the colours and everything else stay the same.'),
        defaultValue: false,
      },
      {
        key: 'poster',
        type: 'boolean',
        label: label('海报歌词（实验性）', 'Poster lyrics (experimental)'),
        description: label('在展开的海报卡片上也用本模组的歌词。Folia 没有为此提供接口，开启后模组会直接修改 Folia 页面里的海报卡片；Folia 更新后可能失效。', 'Also draw these lyrics on the expanded poster card. Folia has no interface for this, so the mod edits the poster card in the host page directly; it may stop working after a Folia update.'),
        defaultValue: false,
      },
    ],
  });
  const params = section.settings;

  // The caption below is for Folia's own display modes: while this mode is on the player it already
  // shows the readings, and the caption stays away. The mode says when it is on screen.
  let ownModeShown = 0;
  const ownModeListeners = new Set();
  const ownMode = delta => { ownModeShown += delta; for (const listener of ownModeListeners) listener(); };
  folium.registries.visualizers.register({
    id: 'reading',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    order: 510,
    hostLayers: { background: true, subtitles: false },
    mount: (container, ctx) => {
      const dispose = mountReading(container, ctx, folium, params);
      if (ctx.isPreview || ctx.staticMode) return dispose;
      ownMode(1);
      return () => { dispose(); ownMode(-1); };
    },
  });

  if (folium.env.context !== 'main') return undefined;

  // Reads the Ruby lyrics embedded in the playing file and hands them to Folia through its lyrics hook.
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
      const unsubscribe = params.onChange(sync);
      return () => { unsubscribe(); dispose?.(); dispose = null; };
    },
  });
  // The display modes built into Folia do not draw readings; this caption does, on top of them.
  const hasReadings = lines => lines.some(line => line.words?.some(word => word.syllables?.some(unit => unit.ruby?.length)));
  folium.registries.stageLayers.register({
    id: 'ruby-caption',
    slot: 'player.stage.front',
    interactive: false,
    mount: (container, ctx) => {
      // While the caption is switched on, Folia's own subtitle rows take the caption's look, for
      // every song, so that the two do not sit side by side in different styles. The stylesheet is
      // made from the theme, and made again when the theme or the see-through state changes.
      let sheet = null, css = '';
      const restyle = () => {
        const position = params.get().strip, on = position === 'top' || position === 'bottom';
        const wanted = on ? hostSubtitleCss(ctx.getTheme()) : '';
        if (wanted === css) return;
        sheet?.unregister?.(); sheet = null; css = wanted;
        if (wanted) sheet = folium.registries.styles?.register({ id: 'subtitles', css: wanted }) || null;
      };
      restyle();
      const stops = [params.onChange(restyle), ctx.onChange(restyle)], timer = setInterval(restyle, 1000);
      const stopRestyle = () => { clearInterval(timer); for (const stop of stops) stop?.(); sheet?.unregister?.(); sheet = null; css = ''; };
      if (!hasReadings(ctx.lines)) return stopRestyle;
      let dispose = null, shown = null;
      const sync = () => {
        const position = params.get().strip;
        const wanted = (position === 'top' || position === 'bottom') && !ownModeShown ? position : null;
        if (wanted === shown) return;
        dispose?.(); dispose = null; shown = wanted;
        if (wanted) dispose = mountReading(container, ctx, folium, params, { strip: wanted });
      };
      sync();
      const unsubscribe = params.onChange(sync);
      ownModeListeners.add(sync);
      return () => { stopRestyle(); unsubscribe(); ownModeListeners.delete(sync); dispose?.(); dispose = null; };
    },
  });
  folium.registries.playerPanelTabs.register({
    id: 'lyrics',
    label: label('双语 · 注音歌词', 'Bilingual & ruby lyrics'),
    order: 510,
    mount: container => mountPanel(container, params),
  });
  // A command's return value is only kept in the mods panel; from the command palette or a
  // shortcut nothing would show, so each command also says what it did.
  const say = message => { folium.ui?.toast?.(message, { type: 'info', durationMs: 1800 }); return message; };
  const toggle = (key, id, zh, en, keywords, fallback) => folium.registries.commands.register({
    id,
    label: label('切换' + zh + '与否', 'Toggle ' + en),
    keywords,
    run: () => {
      const enabled = !(params.get()[key] ?? fallback);
      params.set({ [key]: enabled });
      return say(zh + '：' + (enabled ? '开' : '关'));
    },
  });
  toggle('ruby', 'toggle-ruby', '注音显示', 'ruby annotations', ['ruby', 'furigana', '假名', '注音'], true);
  // one command for the caption: bottom, top, off, and round again
  folium.registries.commands.register({
    id: 'caption',
    label: label('切换注音字幕条（底部 → 顶部 → 关）', 'Ruby caption: bottom, top, off'),
    keywords: ['caption', 'ruby', 'furigana', '字幕条', '注音', '底部', '顶部'],
    run: () => {
      const position = { bottom: 'top', top: 'off' }[params.get().strip] || 'bottom';
      params.set({ strip: position });
      return say('注音字幕条：' + { off: '关', bottom: '底部', top: '顶部' }[position]);
    },
  });

  return () => integration.dispose();
}
return { activate };
})();

export default __client.activate;
