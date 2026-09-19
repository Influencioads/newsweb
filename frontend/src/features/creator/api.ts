import { api } from '@/api/client';

/** Creator submissions (updated doc §17). */

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface Submission {
  id: number;
  title_te: string;
  status: SubmissionStatus;
  review_note: string | null;
  article_url: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export async function submitArticle(payload: {
  title_te: string;
  body_te: string;
  category_slug?: string | null;
  district_slug?: string | null;
  accept_guidelines: boolean;
}): Promise<Submission> {
  const { data } = await api.post<Submission>('/users/me/submissions', payload);
  return data;
}

export interface SubmissionMedia {
  id: number;
  url: string | null;
  alt_te: string | null;
}

/**
 * One photograph onto one pending submission.
 *
 * Scoped to `/users/me` like the avatar route rather than the CMS media API:
 * a verified contributor may add a picture to their own story, which is not
 * the same thing as write access to the newsroom's media library.
 */
export async function attachSubmissionPhoto(
  submissionId: number,
  file: File,
): Promise<{ media_ids: number[] }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<{ media_ids: number[] }>(
    `/users/me/submissions/${submissionId}/media`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function fetchMySubmissions(): Promise<Submission[]> {
  const { data } = await api.get<Submission[]>('/users/me/submissions');
  return data;
}
