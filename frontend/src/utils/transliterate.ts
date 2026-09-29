/**
 * Phonetic Latin → Telugu, RTS-style (the Lekhini / Google scheme editors
 * already know): `telugu` → తెలుగు, `aandhra` → ఆంధ్ర is `aaMdhra`.
 * Capitals are the retroflex / long forms: T D N L Sh, A I U E O.
 *
 * ponytail: fixed rule table, no dictionary — it spells what you type and
 * never guesses. A suggestion list needs a word list or a service.
 */

const CONSONANTS: Record<string, string> = {
  ksh: 'క్ష', x: 'క్ష',
  kh: 'ఖ', k: 'క', q: 'క', gh: 'ఘ', g: 'గ',
  chh: 'ఛ', Ch: 'ఛ', ch: 'చ', c: 'చ', jh: 'ఝ', j: 'జ', z: 'జ',
  Th: 'ఠ', T: 'ట', Dh: 'ఢ', D: 'డ', N: 'ణ',
  th: 'థ', t: 'త', dh: 'ధ', d: 'ద', n: 'న',
  ph: 'ఫ', f: 'ఫ', p: 'ప', bh: 'భ', b: 'బ', m: 'మ',
  y: 'య', r: 'ర', l: 'ల', L: 'ళ', v: 'వ', w: 'వ',
  Sh: 'ష', sh: 'శ', S: 'శ', s: 'స', h: 'హ',
};

/** [independent letter, sign after a consonant]; `a` is the inherent vowel. */
const VOWELS: Record<string, [string, string]> = {
  aa: ['ఆ', 'ా'], A: ['ఆ', 'ా'], ai: ['ఐ', 'ై'], au: ['ఔ', 'ౌ'], ou: ['ఔ', 'ౌ'], a: ['అ', ''],
  ii: ['ఈ', 'ీ'], ee: ['ఈ', 'ీ'], I: ['ఈ', 'ీ'], i: ['ఇ', 'ి'],
  uu: ['ఊ', 'ూ'], oo: ['ఊ', 'ూ'], U: ['ఊ', 'ూ'], u: ['ఉ', 'ు'],
  Ru: ['ఋ', 'ృ'], ae: ['ఏ', 'ే'], E: ['ఏ', 'ే'], e: ['ఎ', 'ె'], O: ['ఓ', 'ో'], o: ['ఒ', 'ొ'],
};

const SIGNS: Record<string, string> = { M: 'ం', H: 'ః' };
const VIRAMA = '్';

/** Longest key of `table` that starts `word` at `i` (keys are at most 3 long). */
function match<T>(table: Record<string, T>, word: string, i: number): string | undefined {
  for (let len = 3; len > 0; len--) {
    const key = word.slice(i, i + len);
    if (key.length === len && key in table) return key;
  }
  return undefined;
}

export function transliterate(word: string): string {
  let out = '';
  let i = 0;
  while (i < word.length) {
    const c = match(CONSONANTS, word, i);
    if (c) {
      out += CONSONANTS[c];
      i += c.length;
      const v = match(VOWELS, word, i);
      if (v) {
        out += VOWELS[v]![1];
        i += v.length;
      } else {
        out += VIRAMA; // a conjunct with the next consonant, or a word-final half letter
      }
      continue;
    }
    const v = match(VOWELS, word, i);
    const key = v ?? word.charAt(i);
    out += v ? VOWELS[v]![0] : (SIGNS[key] ?? key);
    i += key.length;
  }
  return out;
}

const cache = new Map<string, string>();

/**
 * Google Input Tools' best Telugu spelling for one word — it knows real words,
 * so plain `namaskaram` / `hyderabad` come out right. Falls back to the rule
 * table above when offline or blocked.
 *
 * ponytail: unofficial public endpoint (the one Google's own demo page uses);
 * if Google ever closes it, every word silently takes the rule-table path.
 */
export async function toTelugu(word: string): Promise<string> {
  const hit = cache.get(word);
  if (hit) return hit;
  try {
    const url = `https://inputtools.google.com/request?itc=te-t-i0-und&num=1&text=${encodeURIComponent(word)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as [string, [string, string[]][]];
    const te = data[0] === 'SUCCESS' ? data[1]?.[0]?.[1]?.[0] : undefined;
    if (te) {
      cache.set(word, te);
      return te;
    }
  } catch {
    // Offline / blocked / timed out: the rule table below.
  }
  return transliterate(word);
}
