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

export async function fetchMySubmissions(): Promise<Submission[]> {
  const { data } = await api.get<Submission[]>('/users/me/submissions');
  return data;
}
