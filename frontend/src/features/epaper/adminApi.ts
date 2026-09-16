import { api } from "@/api/client";
import type {
  EpaperCandidate,
  EpaperEdition,
  EpaperPage,
  EpaperPlan,
  PageTemplate,
  PdfJob,
  Poll,
} from "@/types/epaper";
export const fetchAdminEditions = async () =>
  (await api.get<{ items: EpaperEdition[] }>("/admin/epaper")).data;
export const fetchAdminEdition = async (date: string) =>
  (await api.get<EpaperEdition>(`/admin/epaper/by-date/${date}`)).data;
export const fetchPlan = async (date?: string) =>
  (await api.get<EpaperPlan>("/admin/epaper/plan", { params: date ? { edition_date: date } : undefined })).data;
export const generateEdition = async (payload: { edition_date?: string; page_count?: number } = {}) =>
  (await api.post<EpaperEdition>("/admin/epaper/generate", payload)).data;
export const regenerateEdition = async (id: number, page_count?: number) =>
  (await api.post<EpaperEdition>(`/admin/epaper/${id}/regenerate`, page_count ? { page_count } : {})).data;
export type EditionActionKind = "submit" | "approve" | "publish" | "withdraw";
export const editionAction = async (id: number, kind: EditionActionKind) =>
  (await api.post<EpaperEdition>(`/admin/epaper/${id}/${kind}`)).data;
/** Queues the PDF render; poll the edition's `pdf_status` afterwards. */
export const renderPdf = async (id: number) =>
  (await api.post<PdfJob>(`/admin/epaper/${id}/pdf`)).data;
export const fetchCandidates = async (id: number, params: { page_id?: number; q?: string; limit?: number }) =>
  (await api.get<{ items: EpaperCandidate[] }>(`/admin/epaper/${id}/candidates`, { params })).data;
export const fillPage = async (edition: number, page: number, reset = false) =>
  (await api.post<EpaperPage>(`/admin/epaper/${edition}/pages/${page}/fill`, { reset })).data;
export const fillEdition = async (edition: number, reset = false) =>
  (await api.post<EpaperEdition>(`/admin/epaper/${edition}/fill`, { reset })).data;
/** A field left out is left alone; send `poll_id` only when changing it (`null` clears). */
export interface PagePatch {
  title?: string;
  layout_type?: string;
  /** Aligned to the page's slots; `null` is an empty slot. */
  article_ids?: (number | null)[];
  poll_id?: number | null;
}
export const updatePage = async (edition: number, page: number, payload: PagePatch) =>
  (await api.patch<EpaperPage>(`/admin/epaper/${edition}/pages/${page}`, payload)).data;
export interface PageCreate extends PagePatch {
  template_id?: number | null;
}
export const addPage = async (edition: number, payload: PageCreate) =>
  (await api.post<EpaperPage>(`/admin/epaper/${edition}/pages`, payload)).data;
export const deletePage = (edition: number, page: number) =>
  api.delete(`/admin/epaper/${edition}/pages/${page}`);
export const orderPages = (edition: number, page_ids: number[]) =>
  api.put(`/admin/epaper/${edition}/pages/order`, { page_ids });
export const fetchTemplates = async () =>
  (await api.get<{ items: PageTemplate[] }>("/admin/epaper/templates")).data;
/** What the templates endpoints accept — `slot_count` is derived on the server. */
export type PageTemplateIn = Omit<PageTemplate, "id" | "slot_count">;
export const createTemplate = (payload: PageTemplateIn) =>
  api.post("/admin/epaper/templates", payload);
export const updateTemplate = (id: number, payload: PageTemplateIn) =>
  api.patch(`/admin/epaper/templates/${id}`, payload);
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
