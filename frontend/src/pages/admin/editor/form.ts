import type { LocationValue } from '@/components/admin/LocationSelector';
import type { CmsArticle, CmsMediaRef } from '@/types/cms';

/**
 * Article form model — the whole §1 field list as one object, so dirty
 * tracking is a snapshot comparison and sub-components take `form` + `set`.
 *
 * `bodyDoc` / `extract` convert between the textarea and the Tiptap JSON the
 * API stores, so swapping the body control later changes only this file.
 */
export interface ArticleForm {
  title: string;
  titleEn: string;
  subTitle: string;
  summary: string;
  body: string;
  categoryId: number | null;
  subcategoryId: number | null;
  location: LocationValue;
  hero: CmsMediaRef | null;
  gallery: CmsMediaRef[];
  videoUrl: string;
  videoId: number | null;
  tags: string[];
  byline: string;
  authorId: number | null;
  sourceType: string;
  sourceCredit: string;
  isBreaking: boolean;
  isExclusive: boolean;
  isFeatured: boolean;
  voiceEnabled: boolean;
  pinHome: number | null;
  pinTrending: number | null;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  scheduledAt: string;
}

export const EMPTY_FORM: ArticleForm = {
  title: '',
  titleEn: '',
  subTitle: '',
  summary: '',
  body: '',
  categoryId: null,
  subcategoryId: null,
  location: { state: '', districtId: null, mandalId: null, localityId: null },
  hero: null,
  gallery: [],
  videoUrl: '',
  videoId: null,
  tags: [],
  byline: '',
  authorId: null,
  sourceType: 'own',
  sourceCredit: '',
  isBreaking: false,
  isExclusive: false,
  isFeatured: false,
  voiceEnabled: true,
  pinHome: null,
  pinTrending: null,
  slug: '',
  seoTitle: '',
  seoDescription: '',
  scheduledAt: '',
};

export const bodyDoc = (text: string) => ({
  type: 'doc',
  content: text
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.trim() }] })),
});

export const extract = (body: Record<string, unknown> | null): string => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const x = node as { text?: string; content?: unknown[] };
    if (x.text) out.push(x.text);
    x.content?.forEach(walk);
  };
  walk(body);
  return out.join('\n\n');
};

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in *local* time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

export function fromArticle(a: CmsArticle): ArticleForm {
  return {
    title: a.title_te,
    titleEn: a.title_en ?? '',
    subTitle: a.sub_title_te ?? '',
    summary: a.summary_te ?? '',
    body: extract(a.body),
    categoryId: a.category_id,
    subcategoryId: a.subcategory_id,
    location: { state: '', districtId: a.district_id, mandalId: a.mandal_id, localityId: a.locality_id },
    hero: a.hero_media,
    gallery: a.gallery ?? [],
    videoId: a.video_id,
    videoUrl: a.video ? `https://www.youtube.com/watch?v=${a.video.youtube_id}` : '',
    tags: (a.tags ?? []).map((t) => t.name_te),
    byline: a.byline_te ?? '',
    authorId: a.author_id,
    sourceType: a.source_type,
    sourceCredit: a.source_credit ?? '',
    isBreaking: a.is_breaking,
    isExclusive: a.is_exclusive,
    isFeatured: a.is_featured,
    voiceEnabled: a.voice_enabled,
    pinHome: a.pin_home_minutes,
    pinTrending: a.pin_trending_minutes,
    slug: a.slug,
    seoTitle: a.seo_title ?? '',
    seoDescription: a.seo_description ?? '',
    scheduledAt: toLocalInput(a.scheduled_at),
  };
}

export function toPayload(f: ArticleForm, canPin: boolean): Record<string, unknown> {
  return {
    title_te: f.title,
    title_en: f.titleEn || null,
    sub_title_te: f.subTitle || null,
    summary_te: f.summary || null,
    body: bodyDoc(f.body),
    category_id: f.categoryId,
    subcategory_id: f.subcategoryId,
    district_id: f.location.districtId,
    mandal_id: f.location.mandalId,
    locality_id: f.location.localityId,
    hero_media_id: f.hero?.id ?? null,
    gallery_media_ids: f.gallery.map((g) => g.id),
    // A cleared box must clear the video, so send null rather than omitting.
    video_youtube_url: f.videoUrl.trim() || null,
    video_id: f.videoUrl.trim() ? f.videoId : null,
    tags: f.tags,
    byline_te: f.byline || null,
    author_id: f.authorId,
    source_type: f.sourceType,
    source_credit: f.sourceCredit || null,
    is_breaking: f.isBreaking,
    is_exclusive: f.isExclusive,
    is_featured: f.isFeatured,
    voice_enabled: f.voiceEnabled,
    slug: f.slug || null,
    seo_title: f.seoTitle || null,
    seo_description: f.seoDescription || null,
    scheduled_at: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
    pin_home_minutes: canPin ? f.pinHome : undefined,
    pin_trending_minutes: canPin ? f.pinTrending : undefined,
  };
}

/** First message of an `ApiError.details` entry (`{ field: 'msg' }` or `{ field: ['msg'] }`). */
export function fieldError(details: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = details?.[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}
