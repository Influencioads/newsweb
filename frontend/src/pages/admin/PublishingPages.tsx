import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "@/features/epaper/adminApi";
import type { EpaperEdition } from "@/types/epaper";

const button =
  "min-h-tap rounded-control border border-rule bg-white px-3 py-2 text-sm font-bold disabled:opacity-40";

export function AdminEpaperPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<EpaperEdition | null>(null);
  const editions = useQuery({
    queryKey: ["admin-epaper"],
    queryFn: api.fetchAdminEditions,
  });
  const templates = useQuery({
    queryKey: ["epaper-templates"],
    queryFn: api.fetchTemplates,
  });
  const act = useMutation({
    mutationFn: ({
      kind,
      id,
    }: {
      kind: "generate" | "regenerate" | "approve" | "publish" | "pdf";
      id?: number;
    }) =>
      kind === "generate"
        ? api.generateEdition()
        : api.editionAction(id!, kind),
    onSuccess: (data) => {
      if ("pages" in data) setSelected(data as EpaperEdition);
      void qc.invalidateQueries({ queryKey: ["admin-epaper"] });
    },
  });
  const open = async (e: EpaperEdition) =>
    setSelected(await api.fetchAdminEdition(e.edition_date));
  const addPage = async () => {
    if (!selected) return;
    const title = window.prompt("New page name");
    if (!title?.trim()) return;
    await api.addPage(selected.id, {
      title: title.trim(),
      layout_type: "lead_grid",
      article_ids: [],
      poll_id: null,
    });
    await open(selected);
  };
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="th text-3xl font-extrabold">E-Paper control panel</h1>
          <p className="mt-1 text-sm text-muted">
            Generate → preview/edit → approve → publish. Only published articles
            are eligible.
          </p>
        </div>
        <button
          className="rounded-control bg-brand px-5 py-3 font-bold text-white"
          disabled={act.isPending}
          onClick={() => act.mutate({ kind: "generate" })}
        >
          Generate today’s E-Paper
        </button>
      </div>
      {act.isError ? (
        <p
          role="alert"
          className="mt-4 rounded bg-breaking-tint p-3 text-breaking"
        >
          Action failed. Confirm the edition has published articles and the
          required approval state.
        </p>
      ) : null}
      <section className="mt-6 overflow-x-auto rounded-card border bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-paper">
              <th className="p-3">Date</th>
              <th>Status</th>
              <th>Pages</th>
              <th>Revision</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {editions.data?.items.map((e) => (
              <tr key={e.id} className="border-b">
                <td className="p-3 font-bold">{e.edition_date}</td>
                <td>{e.status}</td>
                <td>{e.page_count}</td>
                <td>{e.revision}</td>
                <td className="flex flex-wrap gap-2 py-2">
                  <button className={button} onClick={() => void open(e)}>
                    Preview/edit
                  </button>
                  <button
                    className={button}
                    disabled={e.status === "PUBLISHED"}
                    onClick={() => act.mutate({ kind: "regenerate", id: e.id })}
                  >
                    Regenerate
                  </button>
                  <button
                    className={button}
                    disabled={!["GENERATED", "UNDER_REVIEW"].includes(e.status)}
                    onClick={() => act.mutate({ kind: "approve", id: e.id })}
                  >
                    Approve
                  </button>
                  <button
                    className={button}
                    disabled={e.status !== "APPROVED"}
                    onClick={() => act.mutate({ kind: "publish", id: e.id })}
                  >
                    Publish
                  </button>
                  <button
                    className={button}
                    onClick={() => act.mutate({ kind: "pdf", id: e.id })}
                  >
                    PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {selected ? (
        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="th text-2xl font-bold">
              {selected.title} · {selected.status}
            </h2>
            <div>
              {selected.status !== "PUBLISHED" ? (
                <button className={button} onClick={() => void addPage()}>
                  Add page
                </button>
              ) : null}
              {selected.status === "PUBLISHED" ? (
                <Link
                  className="ml-2 font-bold text-brand"
                  to={`/epaper/${selected.edition_date}`}
                >
                  Open public reader →
                </Link>
              ) : null}
            </div>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {selected.pages.map((p, index) => (
              <PageEditor
                key={p.id}
                edition={selected}
                page={p}
                onSaved={() => void open(selected)}
                onMove={async (delta) => {
                  const ids = selected.pages.map((page) => page.id);
                  const target = index + delta;
                  if (target < 0 || target >= ids.length) return;
                  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
                  await api.orderPages(selected.id, ids);
                  await open(selected);
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="th text-2xl font-bold">Page templates</h2>
            <p className="text-sm text-muted">
              Names, order, category IDs, story count, layout and visibility are
              persisted in the database.
            </p>
          </div>
          <button
            className={button}
            onClick={async () => {
              const title = window.prompt("Template page name");
              if (!title) return;
              const slug =
                title
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "") || `page-${Date.now()}`;
              await api.createTemplate({
                slug,
                title_te: title,
                title_en: title,
                sort: (templates.data?.items.length || 0) + 1,
                category_ids: [],
                story_count: 6,
                layout_type: "lead_grid",
                is_visible: true,
              });
              void qc.invalidateQueries({ queryKey: ["epaper-templates"] });
            }}
          >
            Add template
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {templates.data?.items.map((t) => (
            <div key={t.id} className="rounded-card border bg-white p-4">
              <b>
                {t.sort}. {t.title_te}
              </b>
              <p className="text-xs text-muted">
                {t.title_en} · {t.layout_type} · {t.story_count} stories ·{" "}
                {t.is_visible ? "Visible" : "Hidden"}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  className={button}
                  onClick={async () => {
                    const title = window.prompt("Page name", t.title_te);
                    if (!title) return;
                    const order = Number(window.prompt("Page order", String(t.sort)) ?? t.sort);
                    const storyCount = Number(window.prompt("Number of stories", String(t.story_count)) ?? t.story_count);
                    const categoryIds = (window.prompt("Category IDs, comma separated", t.category_ids.join(",")) ?? "")
                      .split(",").map(Number).filter(Boolean);
                    const layout = window.prompt("Layout: lead_grid / two_column / three_column / image_lead / briefs / breaking", t.layout_type) ?? t.layout_type;
                    await api.updateTemplate({ ...t, title_te: title, sort: order, story_count: storyCount, category_ids: categoryIds, layout_type: layout });
                    void qc.invalidateQueries({
                      queryKey: ["epaper-templates"],
                    });
                  }}
                >
                  Configure
                </button>
                <button
                  className={`${button} text-breaking`}
                  onClick={async () => {
                    await api.hideTemplate(t.id);
                    void qc.invalidateQueries({
                      queryKey: ["epaper-templates"],
                    });
                  }}
                >
                  Hide
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function PageEditor({
  edition,
  page,
  onSaved,
  onMove,
}: {
  edition: EpaperEdition;
  page: EpaperEdition["pages"][number];
  onSaved: () => void;
  onMove: (delta: number) => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [layout, setLayout] = useState(page.layout_type);
  const [ids, setIds] = useState(page.articles.map((a) => a.id).join(", "));
  const save = useMutation({
    mutationFn: () =>
      api.updatePage(edition.id, page.id, {
        title,
        layout_type: layout,
        article_ids: ids.split(",").map(Number).filter(Boolean),
        poll_id: page.poll_id,
      }),
    onSuccess: onSaved,
  });
  const remove = useMutation({
    mutationFn: () => api.deletePage(edition.id, page.id),
    onSuccess: onSaved,
  });
  const locked = edition.status === "PUBLISHED";
  return (
    <article className="rounded-card border bg-white p-4">
      <p className="text-xs font-bold text-brand">PAGE {page.page_number}</p>
      {!locked ? <div className="float-right flex gap-1"><button className={button} onClick={() => onMove(-1)} aria-label="Move page up">↑</button><button className={button} onClick={() => onMove(1)} aria-label="Move page down">↓</button></div> : null}
      <input
        className="mt-2 w-full rounded border p-2 font-bold"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={locked}
      />
      <select
        className="mt-2 w-full rounded border p-2"
        value={layout}
        onChange={(e) => setLayout(e.target.value)}
        disabled={locked}
      >
        {[
          "lead_grid",
          "two_column",
          "three_column",
          "image_lead",
          "briefs",
          "breaking",
        ].map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <label className="mt-2 block text-xs">
        Published article IDs, in display order
        <input
          className="mt-1 w-full rounded border p-2"
          value={ids}
          onChange={(e) => setIds(e.target.value)}
          disabled={locked}
        />
      </label>
      <ul className="mt-2 text-sm">
        {page.articles.map((a) => (
          <li key={a.id}>
            {a.position}. {a.title_te}{" "}
            <span className="text-muted">#{a.id}</span>
          </li>
        ))}
      </ul>
      {!locked ? (
        <div className="mt-3 flex gap-2">
          <button
            className={button}
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            Save page
          </button>
          <button
            className={`${button} text-breaking`}
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            Delete page
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function AdminPollsPage() {
  const qc = useQueryClient();
  const polls = useQuery({
    queryKey: ["admin-polls"],
    queryFn: api.fetchAdminPolls,
  });
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("అవును\nకాదు");
  const [big, setBig] = useState(true);
  const create = useMutation({
    mutationFn: () =>
      api.createPoll({
        question_te: question,
        question_en: null,
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + 7 * 864e5).toISOString(),
        category_id: null,
        district_id: null,
        article_id: null,
        is_big_question: big,
        options: options
          .split("\n")
          .filter(Boolean)
          .map((x) => ({ option_text_te: x, option_text_en: null })),
      }),
    onSuccess: () => {
      setQuestion("");
      void qc.invalidateQueries({ queryKey: ["admin-polls"] });
    },
  });
  const status = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patchPoll(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-polls"] }),
  });
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="th text-3xl font-extrabold">Polls & Big Question</h1>
      <section className="mt-5 grid gap-3 rounded-card border bg-white p-5">
        <input
          className="rounded border p-3"
          placeholder="Question in Telugu"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <textarea
          className="min-h-28 rounded border p-3"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          aria-label="One option per line"
        />
        <label>
          <input
            type="checkbox"
            checked={big}
            onChange={(e) => setBig(e.target.checked)}
          />{" "}
          Big Question
        </label>
        <button
          className="w-fit rounded bg-brand px-5 py-3 font-bold text-white"
          disabled={
            question.length < 3 ||
            options.split("\n").filter(Boolean).length < 2 ||
            create.isPending
          }
          onClick={() => create.mutate()}
        >
          Create draft
        </button>
      </section>
      <div className="mt-6 space-y-3">
        {polls.data?.items.map((p) => (
          <article key={p.id} className="rounded-card border bg-white p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="th text-xl font-bold">{p.question_te}</h2>
                <p className="text-xs text-muted">
                  {p.status} · {p.total_votes} votes · ends{" "}
                  {new Date(p.end_time).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className={button}
                  onClick={() => status.mutate({ id: p.id, status: "ACTIVE" })}
                >
                  Start
                </button>
                <button
                  className={button}
                  onClick={() => status.mutate({ id: p.id, status: "STOPPED" })}
                >
                  Stop
                </button>
                <button className={button} onClick={() => void api.downloadPollExport(p.id)}>
                  Export
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
