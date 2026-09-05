/** API types — mirrors backend/app/schemas (public.py, auth.py, reader.py). */

export interface MediaOut {
  id: number;
  url: string | null;
  srcset: string | null;
  alt_te: string | null;
  caption_te: string | null;
  credit: string | null;
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

export interface HomePayload {
  edition: DistrictOut | null;
  lead: ArticleCard | null;
  secondary: ArticleCard[];
  mid_column: ArticleCard[];
  briefs: ArticleCard[];
  latest: ArticleCard[];
  breaking: BreakingItem[];
  sections: HomeSection[];
  generated_at: string;
}

export interface CategoryFeed {
  category: CategoryOut | null;
  district: DistrictOut | null;
  articles: ArticleCard[];
  next_cursor: string | null;
}

export interface SiteConfig {
  site_name_te: string;
  site_name_en: string;
  categories: NavCategoryOut[];
  states: StateOut[];
  districts: DistrictOut[];
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

export interface LocalityOut {
  id: number;
  slug: string;
  name_te: string;
  name_en: string;
  kind: string;
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

// ---------------------------------------------------------------- auth ----
export interface AuthUser {
  id: number;
  name_te: string;
  name_en: string;
  email: string | null;
  phone: string | null;
}

export interface Me {
  user: AuthUser;
  roles: Array<{ role_key: string; level: number }>;
  permissions: string[];
  level: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export interface ReaderLoginResponse {
  tokens: TokenPair;
  me: Me;
  is_new_account: boolean;
}

export interface OtpRequestResponse {
  sent: boolean;
  expires_in_seconds: number;
  dev_otp: string | null;
}

export interface Preferences {
  language: 'te' | 'en';
  state: StateOut | null;
  district: DistrictOut | null;
  mandal: MandalOut | null;
  locality: LocalityOut | null;
  category_slugs: string[];
  notify_breaking: boolean;
  notify_local: boolean;
  notify_topics: boolean;
}

export interface PreferencesPatch {
  language?: 'te' | 'en';
  state_code?: string | null;
  district_slug?: string | null;
  mandal_slug?: string | null;
  locality_slug?: string | null;
  category_slugs?: string[];
  notify_breaking?: boolean;
  notify_local?: boolean;
  notify_topics?: boolean;
}
