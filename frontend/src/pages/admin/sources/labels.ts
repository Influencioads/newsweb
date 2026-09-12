import type { ContentPolicy, MandalMatchMethod, SourceBeat, SourceLicence } from '@/types/cms';

/**
 * Bilingual labels for the content-sources screens (§17). Data only — the
 * page, the form dialog and the queue rows all read from here so a licence is
 * named the same way in the table, the form and the badge.
 */

export const LICENCES: Array<{ value: SourceLicence; te: string; en: string; fullText: boolean }> = [
  { value: 'agency_contract', te: 'వార్తా సంస్థ ఒప్పందం', en: 'Agency contract (PTI/IANS/ANI)', fullText: true },
  { value: 'publisher_partner', te: 'ప్రచురణకర్త భాగస్వామ్యం', en: 'Publisher partnership', fullText: true },
  { value: 'press_release', te: 'పత్రికా ప్రకటన', en: 'Press release', fullText: true },
  { value: 'government', te: 'ప్రభుత్వ బులెటిన్', en: 'Government bulletin', fullText: true },
  { value: 'creative_commons', te: 'Creative Commons', en: 'Creative Commons', fullText: true },
  { value: 'own_network', te: 'మన సొంత నెట్‌వర్క్', en: 'Our own network', fullText: true },
  { value: 'rss_public', te: 'బహిరంగ RSS (ఒప్పందం లేదు)', en: 'Public RSS (no agreement)', fullText: false },
];

export const BEATS: Array<{ value: SourceBeat; te: string; en: string }> = [
  { value: 'general', te: 'సాధారణం', en: 'General (no hourly quota)' },
  { value: 'national', te: 'జాతీయం', en: 'National' },
  { value: 'state', te: 'రాష్ట్రం', en: 'State' },
  { value: 'district_local', te: 'జిల్లా / స్థానికం', en: 'District / local' },
  { value: 'breaking', te: 'బ్రేకింగ్', en: 'Breaking' },
  { value: 'sports', te: 'క్రీడలు', en: 'Sports' },
  { value: 'film', te: 'సినిమా', en: 'Film' },
  { value: 'govt_jobs', te: 'ఉద్యోగాలు', en: 'Government jobs' },
];

export const POLICIES: Array<{ value: ContentPolicy; te: string; en: string }> = [
  { value: 'link_only', te: 'లింక్ మాత్రమే', en: 'Link only' },
  { value: 'excerpt_only', te: 'శీర్షిక + సారాంశం', en: 'Headline + excerpt' },
  { value: 'full_text', te: 'పూర్తి పాఠ్యం', en: 'Full text' },
];

export const MANDAL_LABEL: Record<MandalMatchMethod, { te: string; en: string }> = {
  none: { te: 'మండలం తెలియదు', en: 'No mandal' },
  source_default: { te: 'మూలం నిర్ణయించింది', en: 'Pinned by source' },
  keyword: { te: 'వార్త నుంచి ఊహించాం', en: 'Guessed from the text' },
  ambiguous: { te: 'ఒకటి కంటే ఎక్కువ — ఎంచుకోండి', en: 'Several matched — pick one' },
  editor: { te: 'ఎడిటర్ ఎంచుకున్నారు', en: 'Set by an editor' },
};

/** Whether the server would accept `full_text` for this licence (its own verdict is `may_store_full_text`). */
export const licenceAllowsFullText = (licence: SourceLicence): boolean =>
  LICENCES.find((l) => l.value === licence)?.fullText ?? false;
