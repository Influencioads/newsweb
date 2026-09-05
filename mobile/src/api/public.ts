import { api } from './client';
import type {
  ArticleDetail,
  BreakingItem,
  CategoryFeed,
  HomePayload,
  LocalFeedPayload,
  MandalOut,
  SearchMeta,
  SearchResults,
  SiteConfig,
  VideoList,
} from './types';

export async function fetchSiteConfig(): Promise<SiteConfig> {
  const { data } = await api.get<SiteConfig>('/public/config');
  return data;
}

export async function fetchHome(edition?: string | null): Promise<HomePayload> {
  const { data } = await api.get<HomePayload>('/public/home', {
    params: edition ? { edition } : undefined,
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
  category?: string;
  district?: string;
  cursor?: string;
  limit?: number;
}): Promise<CategoryFeed> {
  const { data } = await api.get<CategoryFeed>('/public/articles', { params });
  return data;
}

export async function fetchTrending(params?: {
  category?: string;
  offset?: number;
  limit?: number;
}): Promise<CategoryFeed> {
  const { data } = await api.get<CategoryFeed>('/public/trending', { params });
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

export async function fetchSearch(params: {
  q: string;
  category?: string;
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

export async function fetchDistrictMandals(districtSlug: string): Promise<MandalOut[]> {
  const { data } = await api.get<MandalOut[]>(`/public/locations/${districtSlug}/mandals`);
  return data;
}

export async function fetchLocalFeed(params: {
  district: string;
  mandal?: string;
  offset?: number;
  limit?: number;
}): Promise<LocalFeedPayload> {
  const { data } = await api.get<LocalFeedPayload>('/public/local', { params });
  return data;
}
