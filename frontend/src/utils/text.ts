/**
 * Text helpers that have to be script-aware.
 *
 * `name[0]` is one UTF-16 code unit, which is the wrong unit for both of the
 * scripts this site renders: it splits a Telugu akshara from its matra or vattu
 * (శ్రీనివాస్ -> శ, losing the ్ర) and can emit a lone surrogate half for an
 * emoji. `Intl.Segmenter` is the platform's own answer; the slice is the
 * fallback for the handful of engines that still lack it.
 */

let segmenter: Intl.Segmenter | null | undefined;

/** First user-perceived character of a name, for an avatar initial. */
export function firstGrapheme(name: string, fallback = '·'): string {
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null;
  }
  if (!segmenter) return trimmed.slice(0, 1);
  return segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? trimmed.slice(0, 1);
}
