import { api } from '@/api/client';
import type {
  ArticleDetail,
  BreakingItem,
  CategoryFeed,
  HomePayload,
  SiteConfig,
} from '@/types/public';

/** Reader-facing API. No auth header is required for any of these. */

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
