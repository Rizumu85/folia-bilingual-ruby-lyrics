// Latin letters for lyrics written in Cyrillic, worked out from the spelling alone: these lyrics
// carry no readings to follow. Russian is spelled the way it is sung wherever the spelling gives
// that away (его = yevo, что = shto, -ться = -tsa); stress is not written, so an unstressed о
// stays o. Ukrainian, Belarusian, Kazakh, Serbian and Macedonian, told apart by their own letters,
// get their usual Latin spelling letter for letter.

export const CYRILLIC = /[Ѐ-ӿ]/u;
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
export function cyrillicLanguage(text) {
  return OWN_LETTERS.find(([, letters]) => letters.test(text))?.[0] ?? 'ru';
}

/** The Cyrillic words of a text in Latin letters, lower case; everything else is left as it is. */
export function cyrillicToLatin(text, language = cyrillicLanguage(text)) {
  const letters = LETTERS[language] ?? RUSSIAN;
  return text.replace(WORD, word => language === 'ru'
    ? russianWord(word)
    : [...word.toLowerCase()].map(char => letters[char] ?? char).join(''));
}
