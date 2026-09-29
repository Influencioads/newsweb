/** E-paper API types — mirror `backend/app/schemas/epaper.py`. */

/** Story size budget of a slot (`epaper_layouts.Slot.size`). */
export type EpaperSlotSize = 'lead' | 'standard' | 'brief';

/** One cell of the 6×6 page grid; geometry is served, never derived here. */
export interface EpaperSlot { index:number; x:number; y:number; w:number; h:number; size:EpaperSlotSize }

export interface EpaperArticle {
  id:number; short_id:string; url:string; title_te:string; title_en:string|null;
  summary_te:string|null; hero_url:string|null; category_slug:string|null; category_name_te:string|null;
  is_breaking:boolean; audio_url:string|null; position:number; display_type:string;
  /** Slot index on the page (`position - 1`). */
  slot:number; size:EpaperSlotSize; word_count:number;
  byline_te:string|null; dateline_te:string|null;
  /** Body paragraphs, typeset on the sheet. May be empty or absent — treat absent as `[]`. */
  body?:string[];
  hero_caption_te:string|null; hero_credit:string|null;
}
export interface EpaperPage {
  id:number; page_number:number; title:string; layout_type:string; template_id:number|null; share_url:string;
  grid:{ cols:number; rows:number }; slots:EpaperSlot[]; articles:EpaperArticle[]; poll_id:number|null;
}
export type PdfStatus = 'PENDING'|'READY'|'FAILED';
export interface EpaperEdition {
  id:number; title:string; edition_date:string; edition_type:string; status:string; revision:number; page_count:number;
  pages:EpaperPage[];
  /** The public never gets a PDF: public payloads carry these as null; admin payloads keep them. */
  pdf_url:string|null; pdf_status:PdfStatus|null; pdf_error:string|null; audio_enabled:boolean; published_at:string|null;
}
/** `POST /admin/epaper/{id}/pdf` — the asset row after queueing. */
export interface PdfJob { status:string; url:string|null; error:string|null }
/** A published story that could still go on a page (`GET /admin/epaper/{id}/candidates`). */
export interface EpaperCandidate {
  id:number; short_id:string; title_te:string; title_en:string|null; category_slug:string|null; category_name_te:string|null;
  word_count:number; has_hero:boolean; hero_url:string|null; size:EpaperSlotSize; is_breaking:boolean; is_featured:boolean;
  published_at:string|null;
  /** The story belongs to the categories of the page being filled. */
  in_section:boolean;
}
export interface EpaperPlanTemplate { slug:string; title_te:string; layout_type:string; slot_count:number; available:number }
/** `GET /admin/epaper/plan` — what a generate would have to work with. */
export interface EpaperPlan { edition_date:string; candidates:number; default_page_count:number; suggested_page_count:number; per_template:EpaperPlanTemplate[] }
export interface PageTemplate {
  id:number; slug:string; title_te:string; title_en:string; sort:number; category_ids:number[]; layout_type:string;
  /** Derived from the layout on the server. */
  slot_count:number; is_visible:boolean;
}
export interface EpaperArchive { items:EpaperEdition[] }
export interface AudioTrack { article_id:number; short_id:string; title_te:string; url:string; page_number:number }
export interface EpaperAudio { enabled:boolean; tracks:AudioTrack[] }
export interface UserEditionPreference { preference_type:'category'|'district'|'mandal'|'tag'; target_id:number; priority:number }
export interface UserEdition { id:number; name:string; auto_generate:boolean; generation_time:string; is_active:boolean; preferences:UserEditionPreference[] }
export interface PollOption { id:number; option_text_te:string; option_text_en:string|null; votes:number; percentage:number }
export interface Poll { id:number; question_te:string; question_en:string|null; status:string; is_big_question:boolean; start_time:string; end_time:string; category_id:number|null; district_id:number|null; article_id:number|null; total_votes:number; has_voted:boolean; selected_option_id:number|null; options:PollOption[] }
export interface TrendingTopic { slug:string; title_te:string; title_en:string|null; score:number; is_override:boolean }
