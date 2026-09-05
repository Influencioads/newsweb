import { api } from './client';
import type { ArticleCard } from './types';

/** Engagement API (Phase C) — the app twin of the web engagement feature. */

export type FollowTargetType = 'category' | 'tag' | 'district' | 'mandal' | 'author';

export interface EngagementCounts {
  like_count: number;
  comment_count: number;
  share_count: number;
}

export interface MyArticleFlags {
  liked: boolean;
  bookmarked: boolean;
}

export interface CommentOut {
  id: number;
  parent_id: number | null;
  body: string;
  author_name_te: string;
  author_name_en: string;
  is_mine: boolean;
  created_at: string;
}

export interface FollowItem {
  target_type: FollowTargetType;
  slug: string;
  name_te: string;
  name_en: string;
}

export interface HistoryItem {
  article: ArticleCard;
  seconds: number;
  max_scroll_pct: number;
  last_read_at: string;
}

export async function setLike(shortId: string, liked: boolean): Promise<EngagementCounts> {
  const method = liked ? 'post' : 'delete';
  const { data } = await api[method]<EngagementCounts>(`/articles/${shortId}/like`);
  return data;
}

export async function setBookmark(shortId: string, bookmarked: boolean): Promise<MyArticleFlags> {
  const method = bookmarked ? 'post' : 'delete';
  const { data } = await api[method]<MyArticleFlags>(`/articles/${shortId}/bookmark`);
  return data;
}

export async function fetchMyFlags(shortId: string): Promise<MyArticleFlags> {
  const { data } = await api.get<MyArticleFlags>(`/articles/${shortId}/me`);
  return data;
}

export async function fetchComments(
  shortId: string,
): Promise<{ total_visible: number; comments: CommentOut[] }> {
  const { data } = await api.get(`/public/articles/${shortId}/comments`);
  return data;
}

export async function addComment(shortId: string, body: string): Promise<CommentOut> {
  const { data } = await api.post<CommentOut>(`/articles/${shortId}/comments`, {
    body,
    parent_id: null,
  });
  return data;
}

export async function deleteComment(commentId: number): Promise<void> {
  await api.delete(`/comments/${commentId}`);
}

export async function reportArticle(shortId: string, reason: string): Promise<void> {
  await api.post(`/articles/${shortId}/report`, { reason, note: null });
}

export async function setFollow(
  targetType: FollowTargetType,
  slug: string,
  following: boolean,
): Promise<void> {
  if (following) {
    await api.post('/follow', { target_type: targetType, slug });
  } else {
    await api.delete('/follow', { data: { target_type: targetType, slug } });
  }
}

export async function fetchMyFollows(): Promise<FollowItem[]> {
  const { data } = await api.get<{ follows: FollowItem[] }>('/users/me/follows');
  return data.follows;
}

export async function fetchBookmarks(
  offset = 0,
): Promise<{ articles: ArticleCard[]; next_offset: number | null }> {
  const { data } = await api.get('/users/me/bookmarks', { params: { offset, limit: 20 } });
  return data;
}

export async function fetchHistory(
  offset = 0,
): Promise<{ items: HistoryItem[]; next_offset: number | null }> {
  const { data } = await api.get('/users/me/history', { params: { offset, limit: 20 } });
  return data;
}

export async function fetchFollowingFeed(
  offset = 0,
): Promise<{ articles: ArticleCard[]; next_offset: number | null }> {
  const { data } = await api.get('/users/me/following', { params: { offset, limit: 20 } });
  return data;
}

export async function fetchForYou(
  offset = 0,
  limit = 20,
): Promise<{ articles: ArticleCard[]; next_offset: number | null }> {
  const { data } = await api.get('/users/me/for-you', { params: { offset, limit } });
  return data;
}
