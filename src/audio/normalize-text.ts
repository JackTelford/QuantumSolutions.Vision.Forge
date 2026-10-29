/**
 * Narration text as the voice should read it (ADR 0007): numbers, units,
 * abbreviations and symbols are spelled out in TypeScript before
 * synthesis, because Kokoro reads "500 ml" and "Dr." unevenly and its
 * input is clamped at 509 tokens. The functions are pure and English
 * only; the chunker cuts at sentence ends and never inside a word.
 */

/** The longest sentence handed to the voice at once, in characters: well under the model's token clamp. */
export const maxSentenceCharacters = 400;

const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const scales: readonly (readonly [number, string])[] = [[1_000_000_000, 'billion'], [1_000_000, 'million'], [1_000, 'thousand']];

/** A non-negative integer below a trillion in words, "one hundred and five" style. */
export function integerToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= 1_000_000_000_000) throw new RangeError(`integerToWords takes a non-negative integer below a trillion, not ${String(value)}.`);
  if (value < 20) return ones[value] ?? '';
  if (value < 100) return `${tens[Math.floor(value / 10)] ?? ''}${value % 10 === 0 ? '' : `-${ones[value % 10] ?? ''}`}`;
  if (value < 1000) {
    const rest = value % 100;
    return `${ones[Math.floor(value / 100)] ?? ''} hundred${rest === 0 ? '' : ` and ${integerToWords(rest)}`}`;
  }
  for (const [scale, name] of scales) {
    if (value >= scale) {
      const rest = value % scale;
      return `${integerToWords(Math.floor(value / scale))} ${name}${rest === 0 ? '' : `${rest < 100 ? ' and ' : ' '}${integerToWords(rest)}`}`;
    }
  }
  return '';
}

/** A year between 1100 and 1999 or 2010 and 2099 reads in pairs ("nineteen ninety-nine"); 2000 to 2009 read as numbers. */
export function yearToWords(year: number): string {
  const high = Math.floor(year / 100);
  const low = year % 100;
  if ((year >= 1100 && year <= 1999) || (year >= 2010 && year <= 2099)) return low === 0 ? `${integerToWords(high)} hundred` : `${integerToWords(high)} ${low < 10 ? `oh-${integerToWords(low)}` : integerToWords(low)}`;
  return integerToWords(year);
}

/** A decimal number in words: the integer part, "point", then each digit. */
export function decimalToWords(text: string): string {
  const [whole = '0', fraction] = text.split('.');
  const wholeWords = integerToWords(Number(whole));
  if (fraction === undefined || fraction.length === 0) return wholeWords;
  return `${wholeWords} point ${[...fraction].map((digit) => ones[Number(digit)] ?? '').join(' ')}`;
}

/** An ordinal ("1st", "22nd") in words. */
export function ordinalToWords(value: number): string {
  const words = integerToWords(value);
  const irregular: Readonly<Record<string, string>> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  const parts = words.split(/(\s|-)/);
  const last = parts[parts.length - 1] ?? '';
  const replaced = irregular[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  parts[parts.length - 1] = replaced;
  return parts.join('');
}

/** The units the normalizer expands, singular and plural. */
export const unitWords: Readonly<Record<string, readonly [string, string]>> = {
  ml: ['millilitre', 'millilitres'],
  l: ['litre', 'litres'],
  mm: ['millimetre', 'millimetres'],
  cm: ['centimetre', 'centimetres'],
  m: ['metre', 'metres'],
  km: ['kilometre', 'kilometres'],
  g: ['gram', 'grams'],
  kg: ['kilogram', 'kilograms'],
  mg: ['milligram', 'milligrams'],
  ms: ['millisecond', 'milliseconds'],
  s: ['second', 'seconds'],
  min: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  hz: ['hertz', 'hertz'],
  khz: ['kilohertz', 'kilohertz'],
  mhz: ['megahertz', 'megahertz'],
  ghz: ['gigahertz', 'gigahertz'],
  kb: ['kilobyte', 'kilobytes'],
  mb: ['megabyte', 'megabytes'],
  gb: ['gigabyte', 'gigabytes'],
  tb: ['terabyte', 'terabytes'],
  fps: ['frames per second', 'frames per second'],
  mah: ['milliamp hour', 'milliamp hours'],
  w: ['watt', 'watts'],
  kw: ['kilowatt', 'kilowatts'],
  v: ['volt', 'volts'],
};

/** The abbreviations the normalizer expands; the key is matched as a whole word, case-insensitively, with or without its period. */
export const abbreviationWords: Readonly<Record<string, string>> = {
  dr: 'doctor',
  mr: 'mister',
  mrs: 'missus',
  ms: 'miz',
  prof: 'professor',
  st: 'street',
  vs: 'versus',
  etc: 'et cetera',
  'e.g': 'for example',
  'i.e': 'that is',
  approx: 'approximately',
  no: 'number',
};

/** Symbols read as words. */
const symbolWords: readonly (readonly [RegExp, string])[] = [
  [/&/g, ' and '],
  [/%/g, ' percent'],
  [/°C/g, ' degrees Celsius'],
  [/°F/g, ' degrees Fahrenheit'],
  [/°/g, ' degrees'],
  [/\+/g, ' plus '],
  [/×/g, ' by '],
  [/@/g, ' at '],
];

function numberWords(token: string): string {
  if (/^\d{4}$/.test(token)) return yearToWords(Number(token));
  if (token.includes('.')) return decimalToWords(token);
  return integerToWords(Number(token.replaceAll(',', '')));
}

/**
 * Spells out what the voice would stumble on: currency ("$5" to "five
 * dollars"), numbers with units ("500 ml" to "five hundred millilitres"),
 * ordinals, years, decimals, plain integers, abbreviations and symbols.
 * Whitespace is collapsed; sentence punctuation is kept.
 */
export function normalizeNarrationText(text: string): string {
  let out = text.replaceAll(' ', ' ');
  out = out.replace(/\$(\d[\d,]*(?:\.\d+)?)/g, (_match, amount: string) => {
    const [whole = '0', cents] = amount.replaceAll(',', '').split('.');
    const dollars = `${integerToWords(Number(whole))} ${Number(whole) === 1 ? 'dollar' : 'dollars'}`;
    return cents === undefined || Number(cents) === 0 ? dollars : `${dollars} and ${integerToWords(Number(cents.padEnd(2, '0').slice(0, 2)))} cents`;
  });
  out = out.replace(/(\d[\d,]*(?:\.\d+)?)\s?([A-Za-z]{1,3})\b/g, (match, amount: string, unit: string) => {
    const words = unitWords[unit.toLowerCase()];
    if (words === undefined) return match;
    const value = Number(amount.replaceAll(',', ''));
    return `${numberWords(amount)} ${value === 1 ? words[0] : words[1]}`;
  });
  out = out.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_match, digits: string) => ordinalToWords(Number(digits)));
  for (const [symbol, words] of symbolWords) out = out.replace(symbol, words);
  out = out.replace(/\b\d[\d,]*(?:\.\d+)?\b/g, (token) => numberWords(token));
  out = out.replace(/\b([A-Za-z](?:\.[A-Za-z])+|[A-Za-z]{2,6})\.?(?=\s|$|[,;:)])/g, (match, word: string) => {
    const expansion = abbreviationWords[word.toLowerCase()];
    if (expansion === undefined) return match;
    const trailing = match.endsWith('.') && /^(etc|vs)$/i.test(word) ? '.' : '';
    return `${expansion}${trailing}`;
  });
  return out.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/**
 * The text as sentences the voice reads one at a time: cut at sentence
 * punctuation, then any sentence longer than the cap is cut again at the
 * last comma, semicolon or space before the cap. Empty sentences are
 * dropped.
 */
export function splitSentences(text: string, maxCharacters = maxSentenceCharacters): readonly string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
  const out: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest.length > maxCharacters) {
      const window = rest.slice(0, maxCharacters);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' '));
      const at = cut <= 0 ? maxCharacters : cut + 1;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest.length > 0) out.push(rest);
  }
  return out;
}
