import { api } from "@/api/client";
import type {
  EpaperArchive,
  EpaperAudio,
  EpaperEdition,
  Poll,
  TrendingTopic,
  UserEdition,
  UserEditionPreference,
} from "@/types/epaper";
import type { ArticleCard } from "@/types/public";

export const fetchTodayEpaper = async () =>
  (await api.get<EpaperEdition>("/epaper/today")).data;
export const fetchEpaper = async (date: string) =>
  (await api.get<EpaperEdition>(`/epaper/${date}`)).data;
export const fetchEpaperArchive = async () =>
  (await api.get<EpaperArchive>("/epaper/archive")).data;
export const fetchEpaperAudio = async (date: string) =>
  (await api.get<EpaperAudio>(`/epaper/${date}/audio`)).data;
export const fetchEpaperOptions = async () =>
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
export const recordPageShare = (date: string, page: number, channel: string) =>
  api.post(`/epaper/${date}/pages/${page}/share`, null, {
    params: { channel },
  });
export const fetchMyEditions = async () =>
  (await api.get<{ items: UserEdition[] }>("/my-epaper")).data;
export const createMyEdition = async (payload: {
  name: string;
  auto_generate: boolean;
  generation_time: string;
  preferences: UserEditionPreference[];
}) => (await api.post<UserEdition>("/my-epaper", payload)).data;
export const updateMyEdition = async (
  id: number,
  payload: {
    name: string;
    auto_generate: boolean;
    generation_time: string;
    preferences: UserEditionPreference[];
  },
) => (await api.patch<UserEdition>(`/my-epaper/${id}`, payload)).data;
export const deleteMyEdition = (id: number) => api.delete(`/my-epaper/${id}`);
export const generateMyEdition = async (id: number) =>
  (await api.post<EpaperEdition>(`/my-epaper/${id}/generate`)).data;
export const fetchMyGeneratedEdition = async (id: number) =>
  (await api.get<EpaperEdition>(`/my-epaper/editions/${id}`)).data;
export async function downloadMyEditionPdf(id: number, date: string) {
  const { data } = await api.get<Blob>(`/my-epaper/editions/${id}/pdf`, {
    responseType: "blob",
  });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-epaper-${date}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function anonId(): string {
  const key = "tn.poll.anonymous-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID().replaceAll("-", "");
    localStorage.setItem(key, value);
  }
  return value;
}
export const fetchPolls = async (params?: {
  article_id?: number;
  big_question?: boolean;
}) =>
  (
    await api.get<Poll[]>("/polls", {
      params: { ...params, anonymous_id: anonId() },
    })
  ).data;
export const fetchPoll = async (id: number) =>
  (await api.get<Poll>(`/polls/${id}`, { params: { anonymous_id: anonId() } }))
    .data;
export const votePoll = async (id: number, option_id: number) =>
  (
    await api.post<Poll>(`/polls/${id}/vote`, {
      option_id,
      anonymous_id: anonId(),
    })
  ).data;
export const fetchTopTopics = async () =>
  (await api.get<{ items: TrendingTopic[] }>("/topics/top")).data;
export const fetchTopic = async (slug: string, district?: string | null) =>
  (
    await api.get<{ topic: TrendingTopic | null; articles: ArticleCard[] }>(
      `/topics/${slug}`,
      { params: district ? { district } : undefined },
    )
  ).data;
