/** Public reader API types — mirrors `backend/app/schemas/public.py`. */

export interface MediaOut {
  id: number;
  url: string | null;
  /** Responsive candidates at the §7.4 widths (400/800/1200/1600w). */
  srcset: string | null;
  alt_te: string | null;
  caption_te: string | null;
  /** Attribution line, e.g. "Creator / Wikimedia Commons (CC BY 4.0)" (§12.5). */
  credit: string | null;
  license_label: string | null;
  /** Original landing page — CC-BY requires a link back where practical. */
  source_url: string | null;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  ai_generated: boolean;
}

export interface CategoryOut {
  slug: string;
  name_te: string;
  name_en: string;
}

export interface NavCategoryOut extends CategoryOut {
  show_in_nav: boolean;
}

export interface DistrictOut {
  slug: string;
  name_te: string;
  name_en: string;
  state: string;
}

export interface TagOut {
  slug: string;
  name_te: string;
  type: string;
}

export interface AuthorOut {
  name_te: string;
  name_en: string;
  author_slug: string | null;
  designation_te: string | null;
}

export interface ArticleCard {
  short_id: string;
  slug: string;
  url: string;
  title_te: string;
  /** English headline; null while a story is Telugu-only. UI falls back to Telugu. */
  title_en: string | null;
  summary_te: string | null;
  category: CategoryOut | null;
  district: DistrictOut | null;
  hero: MediaOut | null;
  byline_te: string | null;
  is_breaking: boolean;
  is_exclusive: boolean;
  ai_generated: boolean;
  published_at: string | null;
  reading_time_sec: number;
}

/** Tiptap/ProseMirror node. The body is the source of truth (§1). */
export interface TiptapNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: TiptapNode[];
}

export interface ArticleDetail extends ArticleCard {
  like_count: number;
  comment_count: number;
  share_count: number;
  sub_title_te: string | null;
  body: TiptapNode | null;
  author: AuthorOut | null;
  tags: TagOut[];
  source_credit: string | null;
  word_count: number;
  updated_at: string | null;
  corrected_at: string | null;
  correction_note_te: string | null;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  /** Additional photographs (article_media.role = 'gallery'), editorial order. */
  gallery: MediaOut[];
  related: ArticleCard[];
}

export interface BreakingItem {
  short_id: string;
  title_te: string;
  title_en: string | null;
  url: string;
  published_at: string | null;
}

export interface HomeSection {
  key: string;
  title_te: string;
  title_en: string | null;
  articles: ArticleCard[];
}

export interface EpaperTeaser {
  edition_slug: string;
  pub_date: string;
  thumb_url: string | null;
  page_count: number;
}

export interface HomePayload {
  edition: DistrictOut | null;
  /** §3 — present only when the reader has saved a mandal. */
  mandal_block: HomeSection | null;
  lead: ArticleCard | null;
  secondary: ArticleCard[];
  mid_column: ArticleCard[];
  briefs: ArticleCard[];
  latest: ArticleCard[];
  breaking: BreakingItem[];
  sections: HomeSection[];
  epaper: EpaperTeaser | null;
  generated_at: string;
}

export interface CategoryFeed {
  category: CategoryOut | null;
  district: DistrictOut | null;
  articles: ArticleCard[];
  next_cursor: string | null;
}

export interface StateOut {
  code: string;
  slug: string;
  name_te: string;
  name_en: string;
}

export interface MandalOut {
  id: number;
  slug: string;
  name_te: string;
  name_en: string;
}

export interface LocalityOut {
  id: number;
  slug: string;
  name_te: string;
  name_en: string;
  kind: string;
}

export interface LocationState extends StateOut {
  districts: DistrictOut[];
}

export interface LocationsPayload {
  states: LocationState[];
}

export interface SearchResults {
  query: string;
  total: number;
  articles: ArticleCard[];
  next_offset: number | null;
}

export interface SearchMeta {
  popular: string[];
  recent: string[];
}

export interface LocalFeedPayload {
  state: StateOut | null;
  district: DistrictOut | null;
  mandal: MandalOut | null;
  locality: LocalityOut | null;
  articles: ArticleCard[];
  next_offset: number | null;
}

export interface VideoOut {
  id: number;
  youtube_id: string;
  thumbnail_url: string;
  embed_url: string;
  watch_url: string;
  title_te: string;
  title_en: string | null;
  description_te: string | null;
  category: CategoryOut | null;
  published_at: string | null;
}

export interface VideoList {
  videos: VideoOut[];
  next_offset: number | null;
}

export interface SiteConfig {
  site_name_te: string;
  site_name_en: string;
  categories: NavCategoryOut[];
  states: StateOut[];
  districts: DistrictOut[];
}
