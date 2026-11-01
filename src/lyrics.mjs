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
export function shiftLines(lines, leadMs) {
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
export function pairBilingual(lines, primary = "original") {
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

/**
 * Which lines are a second voice, and over which line each came in: for every line the index of its
 * leading line, or -1 for a line that leads. A line's part is settled as it starts: one that starts
 * while a leading line has 1.5 seconds or more to go is a second voice, and so is one with a second
 * or more to go and words of it yet to start. Otherwise it leads, also when only a second voice is
 * still going (the next line of the first voice). Lines starting together are a duet: both lead.
 * Lines of a song often overlap by up to a second with one simply following the other, or the last
 * word of one held over the start of the next (over the whole library, most overlaps under a second
 * are such lines); a second voice sung for real goes on longer. `endOf` says how long a line lasts.
 * A background vocal already taken out of its line (`vocal`, see unfoldVocals) is a second voice
 * whatever the times say.
 */
export function secondVoiceOf(lines, endOf = line => line.endTime) {
  const lead = [];
  lines.forEach((line, i) => {
    lead[i] = line.vocal ? Math.max(0, i - 1) : -1;
    if (line.vocal) return;
    for (let j = Math.max(0, i - 4); j < i; j++) {
      if (lead[j] >= 0 || lines[j].startTime >= line.startTime - .05) continue;
      const left = endOf(lines[j]) - line.startTime;
      const wordsToCome = lines[j].words?.some(word => word.startTime >= line.startTime + .1);
      if (left >= 1.5 || (left >= 1 && wordsToCome)) lead[i] = j;
    }
  });
  return lead;
}

/**
 * Folia keeps one current line, so a second voice taken for a line of its own stops the first voice
 * lighting up. Its place in the lyric data is `backgroundVocals` of the line it came in over (what
 * TTML background vocals become): the first voice is then sung to the end, and Folia's harmony layer
 * shows the second one, with its translation and romanization.
 */
export function foldSecondVoices(lines, endOf) {
  const lead = secondVoiceOf(lines, endOf);
  if (lead.every(index => index < 0)) return lines;
  const kept = lines.map(line => ({ ...line }));
  lines.forEach((line, i) => {
    if (lead[i] < 0) return;
    const { fullText, startTime, endTime, words, translation, romanization, alternateTexts } = line;
    const vocal = { text: fullText, startTime, endTime, words: words || [] };
    if (translation) vocal.translation = translation;
    if (romanization) vocal.romanization = romanization;
    if (alternateTexts?.length) vocal.alternateTexts = alternateTexts;
    kept[lead[i]].backgroundVocals = [...(kept[lead[i]].backgroundVocals || []), vocal];
  });
  return kept.filter((line, i) => lead[i] < 0);
}

/** The lines with their background vocals among them as lines of their own, in time order. */
export function unfoldVocals(lines) {
  return lines.flatMap(line => [line, ...(line.backgroundVocals || []).map(({ text, ...vocal }) => ({ ...vocal, fullText: text, vocal: true }))])
    .sort((a, b) => a.startTime - b.startTime);
}

function metadataText(metadata, key) {
  const candidates = [metadata?.[key], metadata?.song?.[key], metadata?.lyrics?.[key]];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
    if (Array.isArray(candidate) && typeof candidate[0] === "string") return candidate[0];
  }
  return undefined;
}
