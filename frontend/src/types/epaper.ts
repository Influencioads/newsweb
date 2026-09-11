export interface EpaperArticle {
  id:number; short_id:string; url:string; title_te:string; title_en:string|null;
  summary_te:string|null; hero_url:string|null; category_slug:string|null;
  is_breaking:boolean; audio_url:string|null; position:number; display_type:string;
}
export interface EpaperPage { id:number; page_number:number; title:string; layout_type:string; share_url:string; articles:EpaperArticle[]; poll_id:number|null }
export interface EpaperEdition { id:number; title:string; edition_date:string; edition_type:string; status:string; revision:number; page_count:number; pages:EpaperPage[]; pdf_url:string|null; audio_enabled:boolean; published_at:string|null }
export interface EpaperArchive { items:EpaperEdition[] }
export interface AudioTrack { article_id:number; short_id:string; title_te:string; url:string; page_number:number }
export interface EpaperAudio { enabled:boolean; tracks:AudioTrack[] }
export interface UserEditionPreference { preference_type:'category'|'district'|'mandal'|'tag'; target_id:number; priority:number }
export interface UserEdition { id:number; name:string; auto_generate:boolean; generation_time:string; is_active:boolean; preferences:UserEditionPreference[] }
export interface PollOption { id:number; option_text_te:string; option_text_en:string|null; votes:number; percentage:number }
export interface Poll { id:number; question_te:string; question_en:string|null; status:string; is_big_question:boolean; start_time:string; end_time:string; category_id:number|null; district_id:number|null; article_id:number|null; total_votes:number; has_voted:boolean; selected_option_id:number|null; options:PollOption[] }
export interface TrendingTopic { slug:string; title_te:string; title_en:string|null; score:number; is_override:boolean }
