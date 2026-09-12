/**
 * Discovery admin helpers — the page-specific bilingual copy these modules
 * carry inline (no strings.ts keys yet) and the one date format they share.
 */

export { useL } from '../useL';

/** Wall-clock stamp for pins, ads and campaign logs (unchanged en-IN format). */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN');
}
