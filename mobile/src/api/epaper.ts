import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, absoluteMediaUrl } from "./client";
import type { ArticleCard } from "./types";

export interface EpaperArticle {
  id: number;
  short_id: string;
  url: string;
  title_te: string;
  title_en: string | null;
  summary_te: string | null;
  hero_url: string | null;
  category_slug: string | null;
  is_breaking: boolean;
  audio_url: string | null;
  position: number;
  display_type: string;
}
export interface EpaperPage {
  id: number;
  page_number: number;
  title: string;
  layout_type: string;
  share_url: string;
  articles: EpaperArticle[];
  poll_id: number | null;
}
export interface EpaperEdition {
  id: number;
  title: string;
  edition_date: string;
  edition_type: string;
  status: string;
  revision: number;
  page_count: number;
  pages: EpaperPage[];
  pdf_url: string | null;
  audio_enabled: boolean;
  published_at: string | null;
}
export interface AudioTrack {
  article_id: number;
  short_id: string;
  title_te: string;
  url: string;
  page_number: number;
}
export interface PollOption {
  id: number;
  option_text_te: string;
  option_text_en: string | null;
  votes: number;
  percentage: number;
}
export interface Poll {
  id: number;
  question_te: string;
  question_en: string | null;
  status: string;
  is_big_question: boolean;
  total_votes: number;
  has_voted: boolean;
  selected_option_id: number | null;
  options: PollOption[];
}
export interface Topic {
  slug: string;
  title_te: string;
  title_en: string | null;
  score: number;
  is_override: boolean;
}
export interface UserEdition {
  id: number;
  name: string;
  auto_generate: boolean;
  generation_time: string;
  is_active: boolean;
  preferences: Array<{
    preference_type: "category" | "district" | "mandal" | "tag";
    target_id: number;
    priority: number;
  }>;
}

function normalize(e: EpaperEdition): EpaperEdition {
  return {
    ...e,
    pdf_url: absoluteMediaUrl(e.pdf_url),
    pages: e.pages.map((p) => ({
      ...p,
      articles: p.articles.map((a) => ({
        ...a,
        hero_url: absoluteMediaUrl(a.hero_url),
        audio_url: absoluteMediaUrl(a.audio_url),
      })),
    })),
  };
}
export const fetchToday = async () =>
  normalize((await api.get<EpaperEdition>("/epaper/today")).data);
export const fetchEdition = async (date: string) =>
  normalize((await api.get<EpaperEdition>(`/epaper/${date}`)).data);
export const fetchArchive = async () =>
  (await api.get<{ items: EpaperEdition[] }>("/epaper/archive")).data;
export const fetchAudio = async (date: string) => {
  const data = (
    await api.get<{ enabled: boolean; tracks: AudioTrack[] }>(
      `/epaper/${date}/audio`,
    )
  ).data;
  return {
    ...data,
    tracks: data.tracks.map((t) => ({ ...t, url: absoluteMediaUrl(t.url)! })),
  };
};
export const fetchOptions = async () =>
  (
    await api.get<{
      categories: Array<{
        id: number;
        name_te: string;
        name_en: string;
        slug: string;
      }>;
      districts: Array<{
        id: number;
        name_te: string;
        name_en: string;
        slug: string;
      }>;
      mandals: Array<{
        id: number;
        district_id: number;
        name_te: string;
        name_en: string;
        slug: string;
      }>;
      tags: Array<{ id: number; name_te: string; name_en: string; slug: string }>;
    }>("/epaper/options")
  ).data;
export const fetchMine = async () =>
  (await api.get<{ items: UserEdition[] }>("/my-epaper")).data;
export const createMine = async (payload: unknown) =>
  (await api.post<UserEdition>("/my-epaper", payload)).data;
export const updateMine = async (id: number, payload: unknown) =>
  (await api.patch<UserEdition>(`/my-epaper/${id}`, payload)).data;
export const generateMine = async (id: number) =>
  normalize((await api.post<EpaperEdition>(`/my-epaper/${id}/generate`)).data);
export const deleteMine = (id: number) => api.delete(`/my-epaper/${id}`);
export const fetchPersonal = async (id: number) =>
  normalize((await api.get<EpaperEdition>(`/my-epaper/editions/${id}`)).data);
async function anonId() {
  let id = await AsyncStorage.getItem("tn.poll.anon");
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem("tn.poll.anon", id);
  }
  return id;
}
export const fetchPolls = async (big = true) =>
  (
    await api.get<Poll[]>("/polls", {
      params: { big_question: big, anonymous_id: await anonId() },
    })
  ).data;
export const fetchPoll = async (id: number) =>
  (
    await api.get<Poll>(`/polls/${id}`, {
      params: { anonymous_id: await anonId() },
    })
  ).data;
export const vote = async (id: number, option_id: number) =>
  (
    await api.post<Poll>(`/polls/${id}/vote`, {
      option_id,
      anonymous_id: await anonId(),
    })
  ).data;
export const fetchTopics = async () =>
  (await api.get<{ items: Topic[] }>("/topics/top")).data;
export const fetchTopic = async (slug: string, district?: string | null) =>
  (await api.get<{ topic: Topic; articles: ArticleCard[] }>(`/topics/${slug}`, { params: district ? { district } : undefined })).data;
