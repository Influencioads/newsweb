export interface CmsMediaRef { id:number; url:string; alt_te:string|null; credit:string|null; width:number|null; height:number|null }
export interface CmsVideoRef { id:number; youtube_id:string; title_te:string; thumbnail_url:string }
export interface CmsTagRef { id:number; slug:string; name_te:string; name_en:string }
/** §19 — the rendition the article uses. `provider:'upload'` is an editor's own file. */
export interface CmsAudioRef { id:number; url:string|null; mime:string; duration_sec:number; provider:string; status:string }
/** §8/§9 — a pin that is live right now, with its own countdown. */
export interface CmsActivePin { placement:'home'|'category'|'local'|'breaking'|'trending'; ends_at:string; seconds_remaining:number }

/** §23 — where the article came from, distinct from `source_type`'s copyright origin. */
export type ArticleType = 'NORMAL'|'REPORTER'|'USER_SUBMITTED'|'AI_SUGGESTED'|'AI_DRAFT'|'BREAKING_NEWS';

export interface CmsArticle {
  id:number; short_id:string; slug:string;
  title_te:string; title_en:string|null; sub_title_te:string|null; summary_te:string|null;
  body:Record<string,unknown>|null;
  category_id:number|null; subcategory_id:number|null;
  district_id:number|null; mandal_id:number|null; locality_id:number|null;
  author_id:number|null; byline_te:string|null;
  source_type:string; source_credit:string|null; article_type:ArticleType;
  status:string; workflow_state:string;
  is_breaking:boolean; is_exclusive:boolean; is_featured:boolean; voice_enabled:boolean;
  ai_generated:boolean;
  hero_media_id:number|null; video_id:number|null; audio_asset_id:number|null;
  seo_title:string|null; seo_description:string|null; canonical_url:string|null;
  approved_by:number|null; approved_at:string|null;
  published_at:string|null; scheduled_at:string|null; expires_at:string|null;
  breaking_until:string|null; updated_at:string;
  // §8/§9 placement chosen on the form; applied when the story goes live.
  pin_home_minutes:number|null; pin_trending_minutes:number|null;
  hero_media:CmsMediaRef|null; gallery:CmsMediaRef[]; video:CmsVideoRef|null; tags:CmsTagRef[];
  audio:CmsAudioRef|null; active_pins:CmsActivePin[];
}
export interface CmsArticleList { articles:CmsArticle[]; total:number }

/** §24 — fourteen cards plus the three "top" breakdowns. */
export interface DashboardStats {
  total_articles:number; drafts:number; pending_review:number; approved:number;
  published_today:number; breaking_live:number; returned_for_changes:number;
  scheduled:number; total_users:number; active_users_7d:number; views_today:number;
  submissions_pending:number; ai_suggestions_new:number; ai_drafts_pending:number;
  top_categories:Array<{id:number;count:number;name_te:string;name_en:string}>;
  top_districts:Array<{id:number;count:number;name_te:string;name_en:string}>;
  top_mandals:Array<{id:number;count:number;name_te:string;name_en:string}>;
}

export interface CmsOption { id:number; slug:string; name_te:string; name_en:string }
export interface CmsCategoryOption extends CmsOption { parent_id:number|null }
export interface CmsDistrictOption extends CmsOption { state:string }
export interface CmsEditorOptions {
  categories:CmsCategoryOption[]; districts:CmsDistrictOption[]; states:CmsOption[];
  authors:Array<{id:number;name_te:string;name_en:string}>; tags:CmsTagRef[];
}

/** §18 / §20 / §35 — the editable half of the settings screen. */
export interface SettingSpec { key:string; kind:string; default:unknown; description:string }
export interface SettingsPayload {
  environment:Record<string,unknown>;
  values:Record<string,unknown>;
  specs:SettingSpec[];
  voice_usage:{chars_this_month:number;monthly_budget:number;percent_used:number;assets_ready:number;assets_failed:number};
}

/** §16 / §17 — an AI story idea with its attribution. */
export interface AiSource { publisher:string; title:string|null; url:string; licence:string; excerpt:string|null }
export interface AiSuggestion {
  id:number; topic_te:string; topic_en:string|null; rationale_te:string|null;
  category_id:number|null; district_id:number|null; status:'new'|'accepted'|'rejected'|'used';
  score:number; engine:string; model:string|null; created_at:string;
  review_note:string|null; sources:AiSource[];
}
export interface AiDraft {
  id:number; suggestion_id:number|null; title_te:string; summary_te:string|null;
  body:Record<string,unknown>|null; body_plain:string|null;
  category_id:number|null; district_id:number|null;
  status:'draft'|'converted'|'discarded'; engine:string; model:string|null;
  confidence:number|null; word_count:number; article_id:number|null; created_at:string;
}

/** §19 — what the article page should do about voice. */
export interface AudioState {
  available:boolean; url:string|null; mime:string|null; duration_sec:number;
  voice:string|null; provider:string|null;
  /** 'device' means fall back to the browser voice; null means hide the player. */
  fallback:'device'|null; voice_enabled:boolean;
}

/** §17 — what right we hold over a source's words. */
export type SourceLicence =
  | 'agency_contract' | 'publisher_partner' | 'press_release'
  | 'government' | 'creative_commons' | 'own_network' | 'rss_public';
export type ContentPolicy = 'link_only' | 'excerpt_only' | 'full_text';
export type IngestStatus = 'new' | 'imported' | 'rejected' | 'duplicate';

export interface ContentSource {
  id: number; slug: string; name: string; name_te: string | null;
  feed_url: string; feed_kind: string;
  homepage_url: string | null; logo_url: string | null;
  licence: SourceLicence; content_policy: ContentPolicy;
  licence_note: string | null;
  /** The server's own verdict — never recompute it in the UI. */
  may_store_full_text: boolean;
  attribution_required: boolean; auto_publish: boolean;
  default_category_id: number | null; default_district_id: number | null;
  language: string; fetch_interval_minutes: number; is_active: boolean;
  last_fetched_at: string | null; last_status: string | null;
  consecutive_failures: number; items_ingested: number; pending_items: number;
  /** Hourly crawl configuration. */
  beat: SourceBeat;
  default_mandal_id: number | null;
  max_items_per_hour: number;
  allow_html_fallback: boolean;
  rewrite_enabled: boolean;
  mandal_autotag: boolean;
}

export type SourceBeat =
  | 'general' | 'national' | 'state' | 'district_local'
  | 'breaking' | 'sports' | 'film' | 'govt_jobs';

export type RewriteStatus =
  | 'none' | 'pending' | 'ready' | 'refused' | 'human_only' | 'skipped' | 'failed';

export type MandalMatchMethod =
  | 'none' | 'source_default' | 'keyword' | 'ambiguous' | 'editor';

export interface IngestedRewrite {
  id: number;
  status: RewriteStatus;
  title_te: string | null;
  summary_te: string | null;
  body_plain: string | null;
  attribution_te: string | null;
  word_count: number;
  engine: string;
  model: string | null;
  confidence: number;
  unverified: boolean;
  similarity_percent: number;
  refusal_reason: string | null;
  created_at: string;
}

/** Never an assignment — a guess, with its working shown. */
export interface MandalGuess {
  mandal_id: number | null;
  district_id: number | null;
  method: MandalMatchMethod;
  confidence: number;
}

export interface CrawlBeatStatus {
  beat: SourceBeat; quota: number; used: number; sources: number;
}

export interface CrawlStatus {
  enabled: boolean;
  rewrite_enabled: boolean;
  hourly_cap: number;
  used_this_hour: number;
  beats: CrawlBeatStatus[];
  last_fetch_at: string | null;
  /** No successful fetch for over two hours — usually a missing worker-ingest. */
  stale: boolean;
  queue: IngestQueueCounts;
}

export interface IngestedItem {
  id: number; title: string; summary: string | null;
  url: string | null; canonical_url: string | null;
  image_url: string | null; author: string | null;
  published_at: string | null; fetched_at: string;
  word_count: number; status: IngestStatus;
  article_id: number | null; review_note: string | null;
  source: { id: number; slug: string; name: string; licence: SourceLicence;
            content_policy: ContentPolicy; full_text: boolean } | null;
  has_full_text: boolean;
  mandal: MandalGuess;
  requires_human: boolean;
  rewrite_status: RewriteStatus;
  rewrite: IngestedRewrite | null;
}

export type IngestQueueCounts = Record<IngestStatus, number>;

export type AudioStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface AudioAssetRow {
  id: number;
  article_id: number;
  short_id: string | null;
  title_te: string | null;
  status: AudioStatus;
  provider: string;
  voice: string | null;
  language: string;
  duration_sec: number;
  char_count: number;
  bytes: number;
  /** Above 1 means long copy was synthesised in pieces and joined. */
  segment_count: number;
  error: string | null;
  generated_at: string | null;
  url: string | null;
}

export type BulletinStatus =
  | 'pending' | 'scripted' | 'ready' | 'published' | 'failed' | 'skipped';

export interface BulletinItemRef {
  position: number;
  article_id: number;
  short_id: string | null;
  /** The canonical reader path, built server-side. */
  url: string | null;
  headline_te: string;
}

export interface BulletinRow {
  id: number;
  date: string;
  slot: number;
  slot_label_te: string;
  status: BulletinStatus;
  revision: number;
  attempts: number;
  script_te: string | null;
  char_count: number;
  target_chars: number;
  duration_sec: number;
  segment_count: number;
  provider: string;
  voice: string | null;
  url: string | null;
  error: string | null;
  generated_at: string | null;
  published_at: string | null;
  items: BulletinItemRef[];
}

export interface BulletinList {
  date: string;
  enabled: boolean;
  requires_approval: boolean;
  items: BulletinRow[];
  /** Slots not yet produced, so the desk can offer "Run now". */
  missing_slots: number[];
}

export type KycStatus =
  | 'not_started' | 'draft' | 'submitted' | 'in_review'
  | 'more_info' | 'approved' | 'rejected' | 'expired';

export type ContributorType = 'citizen' | 'freelance' | 'student';

/** Metadata only. There is no url here, and there is none on the server. */
export interface KycDocumentRow {
  id: number;
  kind: string;
  mime: string;
  bytes: number;
  number_masked: string | null;
  uploaded_at: string | null;
  raw_path: string;
}

export interface KycProfileRow {
  id: number;
  user_id: number;
  name_te: string | null;
  phone: string | null;
  phone_verified: boolean;
  contributor_type: ContributorType | null;
  status: KycStatus;
  display_name_te: string;
  organisation: string | null;
  portfolio_url: string | null;
  course_year: number | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  verified_badge: boolean;
  expires_at: string | null;
  provider: string;
  document_count: number;
  bio_te?: string | null;
  internal_note?: string | null;
  documents?: KycDocumentRow[];
  missing?: string[][];
}
