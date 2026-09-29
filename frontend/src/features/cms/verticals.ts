import type { Vertical } from '@/types/cms';

/**
 * The twelve contributor verticals, bilingual, in the order the backend enum
 * declares them.
 *
 * One list because two screens ask the same question from opposite sides: the
 * applicant picks a vertical on /contributor, the desk reads and filters on it
 * in /admin/kyc. `verticalLabel` also covers `Article.byline_badge`, which the
 * server now fills with a vertical value — without a map a reader would see
 * the raw slug `real_estate` on a byline.
 */
export const VERTICALS: ReadonlyArray<{ value: Vertical; te: string; en: string }> = [
  { value: 'industry', te: 'పరిశ్రమలు', en: 'Industry' },
  { value: 'medical', te: 'వైద్యం', en: 'Medical' },
  { value: 'business', te: 'వాణిజ్యం', en: 'Business' },
  { value: 'tech', te: 'సాంకేతికం', en: 'Technology' },
  { value: 'banking', te: 'బ్యాంకింగ్', en: 'Banking' },
  { value: 'legal', te: 'న్యాయం', en: 'Legal' },
  { value: 'panchayat', te: 'పంచాయతీ', en: 'Panchayat' },
  { value: 'real_estate', te: 'స్థిరాస్తి', en: 'Real estate' },
  { value: 'newsmaker', te: 'వార్తల్లో వ్యక్తులు', en: 'Newsmaker' },
  { value: 'citizen_journalism', te: 'పౌర జర్నలిజం', en: 'Citizen journalism' },
  { value: 'spiritual', te: 'ఆధ్యాత్మికం', en: 'Spiritual' },
  { value: 'sports', te: 'క్రీడలు', en: 'Sports' },
];

/** Bilingual label for a vertical slug; unknown values come back as themselves. */
export function verticalLabel(value: string | null | undefined): { te: string; en: string } | undefined {
  if (!value) return undefined;
  return VERTICALS.find((v) => v.value === value) ?? { te: value, en: value };
}
