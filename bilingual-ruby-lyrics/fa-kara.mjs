import { shiftLines } from './lyrics.mjs';

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
export function parseFaKara(text) {
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
