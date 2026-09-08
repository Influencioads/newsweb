import { api } from '@/api/client';
import type { AiDraft, AiSuggestion, AudioState, CmsArticle, CmsArticleList, CmsEditorOptions, CmsMediaRef, CmsOption, DashboardStats, SettingsPayload } from '@/types/cms';
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
export const fetchCampaigns=async<T>()=>(await api.get<T>('/cms/notifications')).data;
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
export const generateArticleAudio=async(id:number,force=false)=>(await api.post<AudioState&{usage:Record<string,number>}>(`/cms/articles/${id}/generate-audio`,null,{params:{force}})).data;
