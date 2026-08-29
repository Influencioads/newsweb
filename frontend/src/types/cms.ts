export interface CmsArticle { id:number; short_id:string; slug:string; title_te:string; title_en:string|null; summary_te:string|null; body:Record<string,unknown>|null; category_id:number|null; district_id:number|null; mandal_id:number|null; author_id:number|null; byline_te:string|null; source_type:string; source_credit:string|null; status:string; workflow_state:string; is_breaking:boolean; is_exclusive:boolean; ai_generated:boolean; approved_by:number|null; approved_at:string|null; published_at:string|null; updated_at:string }
export interface CmsArticleList { articles:CmsArticle[]; total:number }
export interface DashboardStats { total_articles:number; drafts:number; pending_review:number; approved:number; published_today:number; breaking_live:number; returned_for_changes:number }
export interface CmsOption { id:number; slug:string; name_te:string; name_en:string }
export interface CmsEditorOptions { categories:CmsOption[]; districts:CmsOption[] }
