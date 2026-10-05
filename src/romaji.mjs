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
export function romanizeLine(line) {
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
export const withRomanization = lines => lines.map(line => {
  if (line?.romanization) return line;
  const romanization = romanizeLine(line);
  return romanization ? { ...line, romanization } : line;
});
