import { api } from "@/api/client";
import type { EpaperEdition, Poll } from "@/types/epaper";
export const fetchAdminEditions = async () =>
  (await api.get<{ items: EpaperEdition[] }>("/admin/epaper")).data;
export const fetchAdminEdition = async (date: string) =>
  (await api.get<EpaperEdition>(`/admin/epaper/by-date/${date}`)).data;
export interface PageTemplate {
  id: number;
  slug: string;
  title_te: string;
  title_en: string;
  sort: number;
  category_ids: number[];
  layout_type: string;
  story_count: number;
  is_visible: boolean;
}
export const fetchTemplates = async () =>
  (await api.get<{ items: PageTemplate[] }>("/admin/epaper/templates")).data;
export const generateEdition = async () =>
  (await api.post<EpaperEdition>("/admin/epaper/generate", {})).data;
export async function editionAction(
  id: number,
  kind: "regenerate" | "approve" | "publish" | "pdf",
) {
  return (
    await api.post<EpaperEdition | { status: string; url: string | null }>(
      `/admin/epaper/${id}/${kind}`,
    )
  ).data;
}
export const updatePage = (edition: number, page: number, payload: unknown) =>
  api.patch(`/admin/epaper/${edition}/pages/${page}`, payload);
export const addPage = (edition: number, payload: unknown) =>
  api.post(`/admin/epaper/${edition}/pages`, payload);
export const deletePage = (edition: number, page: number) =>
  api.delete(`/admin/epaper/${edition}/pages/${page}`);
export const orderPages = (edition: number, page_ids: number[]) =>
  api.put(`/admin/epaper/${edition}/pages/order`, { page_ids });
export const createTemplate = (payload: Omit<PageTemplate, "id">) =>
  api.post("/admin/epaper/templates", payload);
export const updateTemplate = (row: PageTemplate) =>
  api.patch(
    `/admin/epaper/templates/${row.id}`,
    (({ id, ...payload }) => payload)(row),
  );
export const hideTemplate = (id: number) =>
  api.delete(`/admin/epaper/templates/${id}`);
export const fetchAdminPolls = async () =>
  (await api.get<{ items: Poll[] }>("/admin/polls")).data;
export const createPoll = async (payload: unknown) =>
  (await api.post<Poll>("/admin/polls", payload)).data;
export const patchPoll = async (id: number, payload: unknown) =>
  (await api.patch<Poll>(`/admin/polls/${id}`, payload)).data;
export async function downloadPollExport(id: number) {
  const { data } = await api.get<Blob>(`/admin/polls/${id}/export`, { responseType: "blob" });
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `poll-${id}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
