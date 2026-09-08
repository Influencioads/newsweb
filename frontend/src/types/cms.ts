export interface CmsMediaRef { id:number; url:string; alt_te:string|null; credit:string|null; width:number|null; height:number|null }
export interface CmsVideoRef { id:number; youtube_id:string; title_te:string; thumbnail_url:string }
export interface CmsTagRef { id:number; slug:string; name_te:string; name_en:string }

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
  hero_media:CmsMediaRef|null; gallery:CmsMediaRef[]; video:CmsVideoRef|null; tags:CmsTagRef[];
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
