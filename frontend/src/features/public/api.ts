import { api } from '@/api/client';
import type {
  ArticleDetail,
  BreakingItem,
  CategoryFeed,
  HomePayload,
  LocalFeedPayload,
  LocationsPayload,
  MandalOut,
  SearchMeta,
  SearchResults,
  ReactionKind,
  ReactionSummary,
  SiteConfig,
  VideoDetail,
  VideoList,
  VideoRails,
} from '@/types/public';

/** Reader-facing API. No auth header is required for any of these. */

export async function fetchSiteConfig(): Promise<SiteConfig> {
  const { data } = await api.get<SiteConfig>('/public/config');
  return data;
}

export async function fetchHome(
  edition?: string | null,
  mandal?: string | null,
): Promise<HomePayload> {
  // §3 — the mandal block only appears once the reader has chosen one, and the
  // mandal is only meaningful inside its district edition.
  const params: Record<string, string> = {};
  if (edition) params.edition = edition;
  if (edition && mandal) params.mandal = mandal;
  const { data } = await api.get<HomePayload>('/public/home', {
    params: Object.keys(params).length ? params : undefined,
  });
  return data;
}

export async function fetchBreaking(): Promise<BreakingItem[]> {
  const { data } = await api.get<BreakingItem[]>('/public/breaking');
  return data;
}

export async function fetchArticle(shortId: string): Promise<ArticleDetail> {
  const { data } = await api.get<ArticleDetail>(`/public/articles/${shortId}`);
  return data;
}

export async function fetchFeed(params: {
  q?: string;
  category?: string;
  district?: string;
  mandal?: string;
  author?: string;
  tag?: string;
  cursor?: string;
  limit?: number;
}): Promise<CategoryFeed> {
  const { data } = await api.get<CategoryFeed>('/public/articles', { params });
  return data;
}

export async function fetchVideos(params?: {
  category?: string;
  offset?: number;
  limit?: number;
}): Promise<VideoList> {
  const { data } = await api.get<VideoList>('/public/videos', { params });
  return data;
}

export async function fetchShortNews(params?: {
  category?: string;
  offset?: number;
  limit?: number;
}): Promise<CategoryFeed> {
  const { data } = await api.get<CategoryFeed>('/public/short-news', { params });
  return data;
}

export async function fetchTrending(params?: {
  category?: string;
  district?: string;
  offset?: number;
  limit?: number;
}): Promise<CategoryFeed> {
  const { data } = await api.get<CategoryFeed>('/public/trending', { params });
  return data;
}

export async function fetchSearch(params: {
  q: string;
  category?: string;
  district?: string;
  author?: string;
  tag?: string;
  offset?: number;
  limit?: number;
}): Promise<SearchResults> {
  const { data } = await api.get<SearchResults>('/public/search', { params });
  return data;
}

export async function fetchSearchMeta(): Promise<SearchMeta> {
  const { data } = await api.get<SearchMeta>('/public/search/meta');
  return data;
}

export async function fetchLocations(): Promise<LocationsPayload> {
  const { data } = await api.get<LocationsPayload>('/public/locations');
  return data;
}

export async function fetchDistrictMandals(districtSlug: string): Promise<MandalOut[]> {
  const { data } = await api.get<MandalOut[]>(`/public/locations/${districtSlug}/mandals`);
  return data;
}

export async function fetchLocalFeed(params: {
  district: string;
  mandal?: string;
  locality?: string;
  offset?: number;
  limit?: number;
}): Promise<LocalFeedPayload> {
  const { data } = await api.get<LocalFeedPayload>('/public/local', { params });
  return data;
}


// --- §15 video hub ---------------------------------------------------------
export const fetchVideoRails = async (): Promise<VideoRails> =>
  (await api.get<VideoRails>('/public/videos/rails')).data;

export const fetchVideo = async (id: number, anonId?: string | null): Promise<VideoDetail> =>
  (await api.get<VideoDetail>(`/public/videos/${id}`, {
    params: anonId ? { anon_id: anonId } : undefined,
  })).data;

/** Fire-and-forget: a failed count must never interrupt playback. */
export const countVideoView = (id: number) =>
  api.post(`/public/videos/${id}/view`).catch(() => undefined);
export const countVideoShare = (id: number) =>
  api.post(`/public/videos/${id}/share`).catch(() => undefined);

export const setVideoReaction = async (
  id: number,
  kind: ReactionKind | null,
  anonId?: string | null,
): Promise<ReactionSummary> =>
  (await api.post<ReactionSummary>(`/public/videos/${id}/reaction`, { kind, anon_id: anonId ?? null })).data;

export const setArticleReaction = async (
  shortId: string,
  kind: ReactionKind | null,
  anonId?: string | null,
): Promise<ReactionSummary> =>
  (await api.post<ReactionSummary>(`/public/articles/${shortId}/reaction`, { kind, anon_id: anonId ?? null })).data;

export interface VideoComment {
  id: number; parent_id: number | null; body: string;
  author_name_te: string; author_name_en: string; is_mine: boolean; created_at: string;
}
export const fetchVideoComments = async (id: number) =>
  (await api.get<{ total_visible: number; comments: VideoComment[] }>(`/public/videos/${id}/comments`)).data;
export const addVideoComment = async (id: number, body: string, parentId: number | null) =>
  (await api.post<VideoComment>(`/videos/${id}/comments`, { body, parent_id: parentId })).data;
