import { api } from '@/api/client';
import type { ArticleOrigin, AssistantConversation, AssistantConversationSummary, AssistantJob, AssistantStatus, AudioAssetRow, BulletinList, BulletinRow, ContentSource, KycProfileRow, KycStatus, Vertical, CrawlStatus, IngestQueueCounts, IngestedItem, IngestedRewrite, AiDraft, AiSuggestion, AudioState, CmsArticle, CmsArticleList, CmsAudioRef, CmsEditorOptions, CmsMediaRef, CmsOption, DashboardStats, SettingsPayload } from '@/types/cms';
export const fetchArticles=async(params?:{state?:string;search?:string;offset?:number;limit?:number})=>(await api.get<CmsArticleList>('/cms/articles',{params})).data;
export const fetchArticle=async(id:number)=>(await api.get<CmsArticle>(`/cms/articles/${id}`)).data;
export const createArticle=async(payload:Record<string,unknown>)=>(await api.post<CmsArticle>('/cms/articles',payload)).data;
export const updateArticle=async(id:number,payload:Record<string,unknown>)=>(await api.patch<CmsArticle>(`/cms/articles/${id}`,payload)).data;
export const transitionArticle=async(id:number,action:string,note?:string)=>(await api.post<CmsArticle>(`/cms/articles/${id}/${action}`,{note:note||null})).data;
export const fetchDashboardStats=async()=>(await api.get<DashboardStats>('/cms/dashboard')).data;
export const fetchEditorOptions=async()=>(await api.get<CmsEditorOptions>('/cms/dashboard/editor-options')).data;
export const fetchManagement=async<T>(section:string)=>(await api.get<T>(`/cms/${section}`)).data;
export const fetchModeration=async<T>(kind:'reports'|'comments',status?:string)=>(await api.get<T>(`/cms/moderation/${kind}`,{params:status?{status}:undefined})).data;
export const fetchHomeSections=async<T>()=>(await api.get<T>('/cms/homepage/sections')).data;
export const patchHomeSection=async(id:number,payload:Record<string,unknown>)=>(await api.patch(`/cms/homepage/sections/${id}`,payload)).data;
export const reorderHomeSections=async(orderedIds:number[])=>(await api.put('/cms/homepage/sections/order',{ordered_ids:orderedIds})).data;
export const fetchPins=async<T>(includeExpired=false)=>(await api.get<T>('/cms/pins',{params:{include_expired:includeExpired}})).data;
export const createPin=async(payload:Record<string,unknown>)=>(await api.post('/cms/pins',payload)).data;
export const removePin=async(id:number)=>(await api.delete(`/cms/pins/${id}`)).data;
export const fetchTrendingScores=async<T>()=>(await api.get<T>('/cms/trending')).data;
export const recomputeTrending=async()=>(await api.post('/cms/trending/recompute')).data;
export const fetchAnalytics=async<T>()=>(await api.get<T>('/cms/analytics')).data;
export const fetchCampaigns=async<T>(params?:{source?:'manual'|'auto';offset?:number;limit?:number})=>(await api.get<T>('/cms/notifications',{params})).data;
export const fetchCmsVideos=async<T>()=>(await api.get<T>('/cms/videos')).data;
export const fetchSubmissions=async<T>(status='pending')=>(await api.get<T>('/cms/moderation/submissions',{params:{status}})).data;
export const approveSubmission=async(id:number)=>(await api.post(`/cms/moderation/submissions/${id}/approve`)).data;
export const rejectSubmission=async(id:number,note:string|null)=>(await api.post(`/cms/moderation/submissions/${id}/reject`,{note})).data;
export const aiAssist=async<T>(payload:Record<string,unknown>)=>(await api.post<T>('/cms/ai/assist',payload)).data;
export const fetchAds=async<T>()=>(await api.get<T>('/cms/ads')).data;
export const createAd=async(payload:Record<string,unknown>)=>(await api.post('/cms/ads',payload)).data;
export const patchAd=async(id:number,payload:Record<string,unknown>)=>(await api.patch(`/cms/ads/${id}`,payload)).data;
export const endAd=async(id:number)=>(await api.delete(`/cms/ads/${id}`)).data;
export const addCmsVideo=async(payload:Record<string,unknown>)=>(await api.post('/cms/videos',payload)).data;
export const patchCmsVideo=async(id:number,payload:Record<string,unknown>)=>(await api.patch(`/cms/videos/${id}`,payload)).data;
export const deleteCmsVideo=async(id:number)=>(await api.delete(`/cms/videos/${id}`)).data;
export const sendCampaign=async(payload:Record<string,unknown>)=>(await api.post('/cms/notifications',payload)).data;
export const closeReport=async(id:number,dismiss:boolean,note?:string)=>(await api.post(`/cms/moderation/reports/${id}/close`,{dismiss,note:note||null})).data;
export const moderateComment=async(id:number,hide:boolean)=>(await api.patch(`/cms/moderation/comments/${id}`,{hide})).data;
// Pinning rides the moderation route because promoting the best comment *is*
// moderation — it needs no permission the moderator does not already hold.
export const pinComment=async(id:number,pinned:boolean)=>(await api.patch<{id:number;status:string;is_pinned:boolean}>(`/cms/moderation/comments/${id}`,{hide:false,pinned})).data;

// --- §1 / §2 editor helpers ------------------------------------------------
export const fetchEditorMandals=async(districtId:number)=>(await api.get<{items:CmsOption[]}>('/cms/dashboard/mandals',{params:{district_id:districtId}})).data.items;
export const fetchEditorLocalities=async(mandalId:number)=>(await api.get<{items:Array<CmsOption&{kind:string}>}>('/cms/dashboard/localities',{params:{mandal_id:mandalId}})).data.items;
export const uploadMedia=async(file:File,meta?:{alt_te?:string;credit?:string;source_type?:string})=>{const fd=new FormData();fd.append('file',file);if(meta?.alt_te)fd.append('alt_te',meta.alt_te);if(meta?.credit)fd.append('credit',meta.credit);if(meta?.source_type)fd.append('source_type',meta.source_type);return (await api.post<CmsMediaRef&{blurhash:string|null}>('/cms/media',fd,{headers:{'Content-Type':'multipart/form-data'}})).data};
export const fetchPendingArticles=async(params:Record<string,unknown>)=>(await api.get<CmsArticleList>('/cms/articles/pending',{params})).data;
export const setBreaking=async(id:number,payload:{minutes?:number;clear?:boolean;repush?:boolean})=>(await api.post<CmsArticle>(`/cms/articles/${id}/breaking`,payload)).data;

// --- §18 / §20 / §35 settings ---------------------------------------------
export const fetchSettings=async()=>(await api.get<SettingsPayload>('/cms/settings')).data;
export const patchSettings=async(values:Record<string,unknown>)=>(await api.patch<{values:Record<string,unknown>}>('/cms/settings',{values})).data;

// --- §15–18 AI -------------------------------------------------------------
export const fetchAiSuggestions=async(status?:string)=>(await api.get<{items:AiSuggestion[];total:number}>('/cms/ai/suggestions',{params:status?{status}:undefined})).data;
export const generateAiSuggestions=async(limit?:number)=>(await api.post<{items:AiSuggestion[];total:number}>('/cms/ai/suggestions/generate',{limit:limit??null})).data;
export const rejectAiSuggestion=async(id:number,note?:string)=>(await api.post<AiSuggestion>(`/cms/ai/suggestions/${id}/reject`,{note:note||null})).data;
export const draftFromSuggestion=async(id:number,notes?:string)=>(await api.post<AiDraft>(`/cms/ai/suggestions/${id}/draft`,{notes:notes||null})).data;
export const fetchAiDrafts=async(status?:string)=>(await api.get<{items:AiDraft[];total:number}>('/cms/ai/drafts',{params:status?{status}:undefined})).data;
export const convertAiDraft=async(id:number)=>(await api.post<{article_id:number;short_id:string;workflow_state:string;status:string}>(`/cms/ai/drafts/${id}/convert`)).data;
export const discardAiDraft=async(id:number)=>(await api.post<AiDraft>(`/cms/ai/drafts/${id}/discard`)).data;

// --- §19 voice -------------------------------------------------------------
export const generateArticleAudio=async(id:number,force=false)=>(await api.post<AudioState&{usage:Record<string,number>;global_voice_enabled:boolean}>(`/cms/articles/${id}/generate-audio`,null,{params:{force}})).data;

// --- §K share card: the same story as a picture ----------------------------
// `reason` carries the environment limit (no Raqm, no font, switched off) in
// words, because on a host that cannot shape Telugu no retry will ever work.
export const generateArticleCard=async(id:number,force=false)=>(await api.post<{available:boolean;url:string|null;reason:string|null}>(`/cms/articles/${id}/generate-card`,null,{params:{force}})).data;

// --- the desk's own note on a story ----------------------------------------
// Its own route rather than a field on PATCH: `workflow_service.update` refuses
// anything that is not DRAFT or CHANGES_REQUESTED, and a critic note is for
// stories that are already live. `null` clears it.
export const setCriticNote=async(id:number,note:string|null)=>(await api.post<CmsArticle>(`/cms/articles/${id}/critic-note`,{note_te:note})).data;

// --- seeded engagement ------------------------------------------------------
// Fabricated, audit-logged, and gated on `engagement.seed` — a permission only
// admin and super-admin hold. `count` SETS the offset, so 0 un-seeds.
export const seedLikes=async(id:number,count:number)=>(await api.post<CmsArticle>(`/cms/articles/${id}/seed-likes`,{count})).data;
// The name is an index into a fixed pool on the server, never free text.
export const seedComment=async(id:number,bodyTe:string,nameIndex:number)=>(await api.post<CmsArticle>(`/cms/articles/${id}/seed-comment`,{body_te:bodyTe,name_index:nameIndex})).data;

// --- §8 / §9 placement from the article form -------------------------------
export const setArticlePlacement=async(id:number,payload:{pin_home_minutes?:number|null;pin_trending_minutes?:number|null})=>(await api.post<CmsArticle>(`/cms/articles/${id}/placement`,payload)).data;

// --- §19 audio an editor attaches by hand ----------------------------------
export const uploadArticleAudio=async(id:number,file:File,durationSec=0)=>{const fd=new FormData();fd.append('file',file);fd.append('duration_sec',String(Math.round(durationSec)));return (await api.post<CmsAudioRef&{available:boolean;url:string|null}>(`/cms/articles/${id}/audio`,fd,{headers:{'Content-Type':'multipart/form-data'}})).data};
export const deleteArticleAudio=async(id:number)=>(await api.delete<{removed:boolean}>(`/cms/articles/${id}/audio`)).data;

// --- §17 content ingestion -------------------------------------------------
export const fetchSources=async()=>(await api.get<{items:ContentSource[];total:number;queue:IngestQueueCounts;failure_limit:number}>('/cms/sources')).data;
export const createSource=async(payload:Record<string,unknown>)=>(await api.post<ContentSource>('/cms/sources',payload)).data;
export const patchSource=async(id:number,payload:Record<string,unknown>)=>(await api.patch<ContentSource>(`/cms/sources/${id}`,payload)).data;
export const deleteSource=async(id:number)=>(await api.delete(`/cms/sources/${id}`)).data;
export const fetchSourceNow=async(id:number)=>(await api.post<Record<string,unknown>>(`/cms/sources/${id}/fetch`)).data;
export const runIngestion=async()=>(await api.post<{results:Array<Record<string,unknown>>;queue:IngestQueueCounts}>('/cms/ingestion/run')).data;
export const fetchIngestQueue=async(status:string='new',params:Record<string,unknown>={})=>(await api.get<{items:IngestedItem[];total:number;queue:IngestQueueCounts}>('/cms/ingestion/queue',{params:{status,...params}})).data;
export const importIngestedItem=async(id:number,payload?:Record<string,unknown>)=>(await api.post<{article_id:number;short_id:string;workflow_state:string;ai_generated:boolean;article_type:string}>(`/cms/ingestion/${id}/import`,payload??{})).data;
export const rejectIngestedItem=async(id:number,note?:string)=>(await api.post(`/cms/ingestion/${id}/reject`,{note:note||null})).data;
export const fetchCrawlStatus=async()=>(await api.get<CrawlStatus>('/cms/crawl/status')).data;
export const runCrawl=async(payload:Record<string,unknown>={})=>(await api.post<Record<string,unknown>>('/cms/crawl/run',{fetch:true,rewrite:true,...payload})).data;
// The publisher's original beside ours, at the point of approval. 404s for an
// article that was never crawled, and may fetch the publisher's page live —
// so ask only for AI_REWRITE / SYNDICATED, and only when the panel is opened.
// Its own budget: the global 20s is a client-side timeout on a call whose
// backend hop is itself 20s per redirect, so a slow publisher would abort here
// before the server ever answered.
export const fetchArticleOrigin=async(id:number)=>(await api.get<ArticleOrigin>(`/cms/articles/${id}/origin`,{timeout:45_000})).data;
export const rewriteIngestedItem=async(id:number,force=false)=>(await api.post<{item_id:number;rewrite:IngestedRewrite|null}>(`/cms/ingestion/${id}/rewrite`,null,{params:{force}})).data;
export const fetchAudioAssets=async(params:Record<string,unknown>={})=>(await api.get<{items:AudioAssetRow[];total:number;usage:Record<string,number>}>('/cms/audio/assets',{params})).data;
export const retryAudioAsset=async(id:number)=>(await api.post<{asset:AudioAssetRow;usage:Record<string,number>}>(`/cms/audio/assets/${id}/retry`)).data;
export const runAudioBackfill=async(payload:Record<string,unknown>)=>(await api.post<{candidates:number;generated:number;skipped:number;usage:Record<string,number>}>('/cms/audio/backfill',payload)).data;
export const fetchBulletins=async(date?:string)=>(await api.get<BulletinList>('/cms/bulletins',{params:date?{date}:{}})).data;
export const patchBulletin=async(id:number,script:string)=>(await api.patch<BulletinRow>(`/cms/bulletins/${id}`,{script_te:script})).data;
export const runBulletin=async(payload:{slot?:number;date?:string})=>(await api.post<BulletinRow>('/cms/bulletins/run',payload)).data;
export const regenerateBulletin=async(id:number,rescript=true)=>(await api.post<BulletinRow>(`/cms/bulletins/${id}/regenerate`,null,{params:{rescript}})).data;
export const publishBulletin=async(id:number)=>(await api.post<BulletinRow>(`/cms/bulletins/${id}/publish`)).data;
export const pullBulletin=async(id:number)=>(await api.post<BulletinRow>(`/cms/bulletins/${id}/pull`)).data;
export const fetchKycQueue=async(status:KycStatus,vertical?:Vertical|null)=>(await api.get<{items:KycProfileRow[];total:number}>('/cms/kyc',{params:vertical?{status,vertical}:{status}})).data;
export const fetchKycApplication=async(id:number)=>(await api.get<KycProfileRow>(`/cms/kyc/${id}`)).data;
export const decideKyc=async(id:number,action:'approve'|'reject'|'request-more',payload:Record<string,unknown>)=>(await api.post<KycProfileRow>(`/cms/kyc/${id}/${action}`,payload)).data;
// Level 90, and the revoke takes their live copy down with it — the flag is
// the server's, not a convenience.
export const setPanchayatPublish=async(id:number,granted:boolean)=>(await api.post<{id:number;granted_at:string|null;unpublished_article_ids:number[]}>(`/cms/kyc/${id}/panchayat-publish`,{granted,unpublish_live:true})).data;

// --- §17 an AI picture when no photograph exists ---------------------------
// `available:false` with a `reason` is a normal answer, not a failure: the
// reason is a sentence written for the desk, so the caller shows it verbatim
// rather than inventing its own wording. A refused sensitive topic arrives as
// a 422 ApiError instead, carrying its own Telugu message.
// The AI picture carries no credit — nobody photographed it — so the media
// it returns is a CmsMediaRef minus that field, plus what the desk pressed the
// button to learn: which model made it and whether it became the hero.
type GeneratedImage=Omit<CmsMediaRef,'credit'>&{ai_generated:boolean;ai_model:string|null;is_hero:boolean};
export const generateArticleImage=async(id:number,brief:string,force=false)=>(await api.post<{available:boolean;reason:string|null;media:GeneratedImage|null}>(`/cms/ai/articles/${id}/image`,{brief:brief||null,force})).data;

// --- news card: the story's glimpse as a social image in a chosen size -----
// Both calls cost money, so the dialog only makes them on a button press. With
// photo:"ai" the response's `card.photo.media_id` is the drawn picture; sending
// it back as `photo_media_id` re-renders over the same picture for free.
// `available:false` + `reason` and a 422 refusal behave as generateArticleImage.
export type SocialCardAspect='1:1'|'4:5'|'16:9'|'9:16';
export type SocialCardTemplate='panel'|'overlay'|'frame';
export type SocialCardPhoto='story'|'ai'|'none';
// The creative studio's extras: `width`/`height` replace `aspect`; a design
// backdrop is drawn (`use_ai_backdrop`, paid) or reused (`backdrop_media_id`,
// free — the card's `backdrop.media_id`); `save` also files the card in the
// media library (`card.media_id`).
export interface SocialCardBody{aspect:SocialCardAspect;template:SocialCardTemplate;headline:string;summary:string;tag:string|null;photo:SocialCardPhoto;photo_media_id:number|null;brief:string|null;width?:number;height?:number;use_ai_backdrop?:boolean;reference_media_ids?:number[];backdrop_media_id?:number|null;backdrop_brief?:string|null;save?:boolean}
export interface SocialCard{url:string;width:number;height:number;aspect:string;template:string;filename:string;warnings:string[];photo:{media_id:number;url:string|null;ai_generated:boolean}|null;backdrop?:{media_id:number;url:string|null}|null;media_id?:number|null}
export const socialCardText=async(id:number)=>(await api.post<{headline:string;summary:string;tag:string;engine:'ai'|'heuristic';warnings?:string[]}>(`/cms/ai/articles/${id}/social-card/text`,{},{timeout:45_000})).data; // past the server's 25 s model ceiling: an abort here is a billed call the editor never sees
export const makeSocialCard=async(id:number,body:SocialCardBody)=>(await api.post<{available:boolean;reason:string|null;card:SocialCard|null}>(`/cms/ai/articles/${id}/social-card`,body,{timeout:200_000})).data; // a fresh GPT Image 2.5 drawing is usually ~20 s, but one took 132 s on 2026-09-23 (the server timeout is per read, not total)
// Design references for the creative studio: read for style only, kept out
// of the media library list (`GET /cms/media`) so they are never a story's picture.
export interface CreativeReference{id:number;url:string;width:number|null;height:number|null;filename:string;created_at:string}
export const fetchCreativeRefs=async()=>(await api.get<{items:CreativeReference[]}>('/cms/ai/creative/references')).data.items;
export const uploadCreativeRef=async(file:File)=>{const fd=new FormData();fd.append('file',file);return (await api.post<CreativeReference>('/cms/ai/creative/references',fd,{headers:{'Content-Type':'multipart/form-data'}})).data};
export const deleteCreativeRef=async(id:number)=>(await api.delete<{removed:boolean}>(`/cms/ai/creative/references/${id}`)).data;

// --- categories (Taxonomy page) --------------------------------------------
// A delete of a category that still holds content is a 409 whose
// details.counts says what; retrying with moveTo moves it all there first.
export const createCategory=async(payload:Record<string,unknown>)=>(await api.post<{id:number;slug:string}>('/cms/taxonomy/categories',payload)).data;
export const patchCategory=async(id:number,payload:Record<string,unknown>)=>(await api.patch(`/cms/taxonomy/categories/${id}`,payload)).data;
export const deleteCategory=async(id:number,moveTo?:number)=>(await api.delete(`/cms/taxonomy/categories/${id}`,{params:moveTo==null?{}:{move_to:moveTo}})).data;
export const reorderCategories=async(orderedIds:number[])=>(await api.put('/cms/taxonomy/categories/order',{ordered_ids:orderedIds})).data;

// --- §13 push campaigns ------------------------------------------------------
// Only a `scheduled` campaign cancels; anything already sent is a 409.
export const cancelCampaign=async(id:number)=>(await api.delete<{id:number;status:string}>(`/cms/notifications/${id}`)).data;

// --- Sanjaya, the newsroom assistant ---------------------------------------
// The POST only queues the turn (202) and the page polls the conversation, so
// 30 s is headroom for a slow insert, not for the model: an abort here would
// look like a network failure while the server carries on and bills.
export const fetchAssistantStatus=async()=>(await api.get<AssistantStatus>('/cms/assistant/status')).data;
export const fetchAssistantConversations=async(limit=30)=>(await api.get<{items:AssistantConversationSummary[]}>('/cms/assistant/conversations',{params:{limit}})).data.items;
export const fetchAssistantConversation=async(id:number)=>(await api.get<AssistantConversation>(`/cms/assistant/conversations/${id}`)).data;
export const sendAssistantMessage=async(body:{conversation_id:number|null;text:string})=>(await api.post<AssistantConversation>('/cms/assistant/messages',body,{timeout:30_000})).data;
export const deleteAssistantConversation=async(id:number)=>(await api.delete(`/cms/assistant/conversations/${id}`)).data;
export const fetchAssistantJob=async(id:number)=>(await api.get<AssistantJob>(`/cms/assistant/jobs/${id}`)).data;
