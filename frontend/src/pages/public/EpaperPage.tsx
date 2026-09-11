import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Headphones,
  Maximize,
  Minus,
  Newspaper,
  Plus,
  Share2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import * as epaperApi from "@/features/epaper/api";
import { useI18n } from "@/i18n";
import type { EpaperArticle, EpaperPage as Page } from "@/types/epaper";

function Story({
  article,
  lead = false,
}: {
  article: EpaperArticle;
  lead?: boolean;
}) {
  return (
    <article
      className={`${lead ? "md:col-span-2 md:row-span-2" : "break-inside-avoid"} border-b border-ink/20 pb-3`}
    >
      {article.hero_url ? (
        <img
          src={article.hero_url}
          alt=""
          className={`mb-2 w-full object-cover grayscale-[20%] ${lead ? "h-64" : "h-32"}`}
        />
      ) : null}
      {article.is_breaking ? (
        <p className="font-sans text-[10px] font-bold uppercase text-breaking">
          Breaking
        </p>
      ) : null}
      <Link
        to={article.url}
        className={`th block font-extrabold leading-telugu hover:text-brand ${lead ? "text-[28px]" : "text-[18px]"}`}
      >
        {article.title_te}
      </Link>
      {article.summary_te ? (
        <p className="te mt-1 text-[12px] leading-telugu text-ink-soft">
          {article.summary_te}
        </p>
      ) : null}
    </article>
  );
}

function NewspaperPage({ page, zoom }: { page: Page; zoom: number }) {
  const columns =
    page.layout_type === "three_column"
      ? "md:grid-cols-3"
      : page.layout_type === "two_column"
        ? "md:grid-cols-2"
        : "md:grid-cols-2";
  return (
    <article
      className="mx-auto min-h-[78vh] w-full max-w-[960px] origin-top bg-[#fffdf7] p-5 shadow-xl sm:p-8"
      style={{
        transform: `scale(${zoom})`,
        marginBottom: `${(zoom - 1) * 78}vh`,
      }}
    >
      <header className="mb-5 border-y-[3px] border-ink py-3 text-center">
        <p className="font-sans text-[10px] font-bold uppercase tracking-[.2em]">
          Top Telugu News · Digital Edition
        </p>
        <h1 className="th text-[32px] font-extrabold leading-telugu">
          {page.title}
        </h1>
        <p className="font-sans text-[11px]">Page {page.page_number}</p>
      </header>
      <div className={`grid grid-cols-1 gap-5 ${columns}`}>
        {page.articles.map((a, i) => (
          <Story key={a.id} article={a} lead={i === 0} />
        ))}
      </div>
      {!page.articles.length ? (
        <p className="te py-20 text-center text-muted">ఈ పేజీలో కథనాలు లేవు.</p>
      ) : null}
      {page.poll_id ? (
        <Link
          to={`/polls/${page.poll_id}`}
          className="th mt-6 block rounded border-2 border-brand bg-brand-tint p-5 text-center text-xl font-extrabold text-brand"
        >
          ❓ బిగ్ క్వశ్చన్ · Vote now →
        </Link>
      ) : null}
    </article>
  );
}

export default function EpaperPage() {
  const { language } = useI18n();
  const en = language === "en";
  const params = useParams();
  const nav = useNavigate();
  const personalId = params.personalId ? Number(params.personalId) : null;
  const query = useQuery({
    queryKey: [
      "epaper",
      personalId ? `personal-${personalId}` : params.date || "today",
    ],
    queryFn: () =>
      personalId
        ? epaperApi.fetchMyGeneratedEdition(personalId)
        : params.date
          ? epaperApi.fetchEpaper(params.date)
          : epaperApi.fetchTodayEpaper(),
  });
  const edition = query.data;
  const requested = Math.max(1, Number(params.page || 1));
  const current = Math.min(requested, edition?.page_count || 1);
  const page =
    edition?.pages.find((p) => p.page_number === current) || edition?.pages[0];
  const [zoom, setZoom] = useState(1);
  const startX = useRef<number | null>(null);
  const audio = useQuery({
    queryKey: ["epaper-audio", edition?.edition_date],
    queryFn: () => epaperApi.fetchEpaperAudio(edition!.edition_date),
    enabled: Boolean(edition?.audio_enabled),
  });
  const [track, setTrack] = useState(0);
  const player = useRef<HTMLAudioElement>(null);
  const go = (number: number) =>
    nav(
      personalId
        ? `/my-epaper/edition/${personalId}/page/${number}`
        : `/epaper/${edition?.edition_date}/page/${number}`,
    );
  useEffect(() => setZoom(1), [current]);
  const share = async (channel = "native") => {
    if (!edition || !page) return;
    const url = personalId
      ? `${location.origin}/my-epaper/edition/${personalId}/page/${page.page_number}`
      : page.share_url;
    const text = `${edition.title} – Page ${page.page_number}`;
    if (!personalId)
      void epaperApi.recordPageShare(
        edition.edition_date,
        page.page_number,
        channel,
      );
    if (channel === "native" && navigator.share) {
      await navigator.share({ title: text, text, url });
      return;
    }
    if (channel === "copy") {
      await navigator.clipboard.writeText(url);
      return;
    }
    const targets: Record<string, string> = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    };
    window.open(targets[channel], "_blank", "noopener,noreferrer");
  };
  if (query.isLoading)
    return (
      <main className="p-12 text-center">
        {en ? "Loading edition…" : "ఎడిషన్ లోడ్ అవుతోంది…"}
      </main>
    );
  if (query.isError || !edition || !page)
    return (
      <main className="mx-auto max-w-xl p-12 text-center">
        <Newspaper className="mx-auto h-12 w-12 text-brand" />
        <h1 className="th mt-4 text-2xl font-bold">
          {en
            ? "No published edition is available yet."
            : "ప్రచురించిన ఎడిషన్ ఇంకా అందుబాటులో లేదు."}
        </h1>
        <Link to="/" className="mt-5 inline-block text-brand underline">
          {en ? "Back to news" : "వార్తలకు తిరిగి వెళ్లండి"}
        </Link>
      </main>
    );
  const tracks = audio.data?.tracks || [];
  return (
    <main
      className="min-h-screen bg-[#e8e3d9] pb-12"
      onPointerDown={(e) => (startX.current = e.clientX)}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const d = e.clientX - startX.current;
        if (Math.abs(d) > 70) {
          if (d < 0 && current < edition.page_count) go(current + 1);
          if (d > 0 && current > 1) go(current - 1);
        }
        startX.current = null;
      }}
    >
      <header className="sticky top-0 z-30 border-b border-rule bg-white/95 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-2">
          <Link to="/" className="rounded-control px-2 py-2 text-brand">
            ←
          </Link>
          <div className="mr-auto">
            <h1 className="th text-[16px] font-extrabold">{edition.title}</h1>
            <p className="font-sans text-[10px] text-muted">
              {edition.edition_date}
            </p>
          </div>
          <button
            onClick={() => setZoom((z) => Math.max(0.75, z - 0.1))}
            className="rounded-control border p-2"
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="text-xs">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
            className="rounded-control border p-2"
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => document.documentElement.requestFullscreen?.()}
            className="rounded-control border p-2"
            aria-label="Full screen"
          >
            <Maximize className="h-4 w-4" />
          </button>
          <button
            onClick={() => void share()}
            className="flex items-center gap-1 rounded-control border px-3 py-2 text-xs font-bold"
          >
            <Share2 className="h-4 w-4" />
            {en ? "Share" : "షేర్"}
          </button>
          {personalId ? (
            <button
              onClick={() =>
                void epaperApi.downloadMyEditionPdf(
                  personalId,
                  edition.edition_date,
                )
              }
              className="flex items-center gap-1 rounded-control bg-brand px-3 py-2 text-xs font-bold text-white"
            >
              <Download className="h-4 w-4" />
              {en ? "PDF" : "పీడీఎఫ్"}
            </button>
          ) : (
            <a
              href={`/api/v1/epaper/${edition.edition_date}/pdf`}
              className="flex items-center gap-1 rounded-control bg-brand px-3 py-2 text-xs font-bold text-white"
            >
              <Download className="h-4 w-4" />
              {en ? "PDF" : "పీడీఎఫ్"}
            </a>
          )}
        </div>
      </header>
      <div className="mx-auto my-3 flex max-w-[960px] items-center justify-between gap-3 px-3">
        <button
          disabled={current === 1}
          onClick={() => go(current - 1)}
          className="rounded-full bg-white p-3 shadow disabled:opacity-30"
        >
          <ChevronLeft />
        </button>
        <label className="text-xs font-bold">
          {en ? "Page" : "పేజీ"}{" "}
          <select
            value={current}
            onChange={(e) => go(Number(e.target.value))}
            className="rounded border bg-white px-2 py-1"
          >
            {edition.pages.map((p) => (
              <option key={p.id} value={p.page_number}>
                {p.page_number} · {p.title}
              </option>
            ))}
          </select>{" "}
          / {edition.page_count}
        </label>
        <button
          disabled={current === edition.page_count}
          onClick={() => go(current + 1)}
          className="rounded-full bg-white p-3 shadow disabled:opacity-30"
        >
          <ChevronRight />
        </button>
      </div>
      <div className="overflow-auto px-3">
        <NewspaperPage page={page} zoom={zoom} />
      </div>
      <section className="mx-auto mt-5 max-w-[960px] rounded-card bg-white p-4">
        <h2 className="flex items-center gap-2 font-bold">
          <Headphones className="h-4 w-4" />
          {en ? "Listen like radio" : "రేడియోలా వినండి"}
        </h2>
        {tracks.length ? (
          <>
            <audio
              ref={player}
              controls
              className="mt-3 w-full"
              src={tracks[track]?.url}
              onEnded={() =>
                setTrack((i) => Math.min(tracks.length - 1, i + 1))
              }
            />
            <p className="te mt-2 font-bold">
              {en ? "Now playing" : "ఇప్పుడు వినిపిస్తోంది"}:{" "}
              {tracks[track]?.title_te}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => setTrack((i) => Math.max(0, i - 1))}>
                ⏮
              </button>
              <button
                onClick={() => {
                  if (player.current)
                    player.current.currentTime = Math.max(
                      0,
                      player.current.currentTime - 10,
                    );
                }}
              >
                ⏪ 10
              </button>
              <button
                onClick={() => {
                  if (player.current) player.current.currentTime += 10;
                }}
              >
                10 ⏩
              </button>
              <button
                onClick={() =>
                  setTrack((i) => Math.min(tracks.length - 1, i + 1))
                }
              >
                ⏭
              </button>
              {[1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  onClick={() => {
                    if (player.current) player.current.playbackRate = rate;
                  }}
                  className="rounded border px-2"
                >
                  {rate}x
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="te mt-2 text-sm text-muted">
            {en
              ? "Audio is unavailable for this edition."
              : "ఈ ఎడిషన్‌కు ఆడియో అందుబాటులో లేదు."}
          </p>
        )}
      </section>
      <section className="mx-auto mt-5 flex max-w-[960px] flex-wrap gap-2 px-3">
        <button
          onClick={() => void share("whatsapp")}
          className="rounded-control bg-[#25D366] px-3 py-2 text-sm font-bold text-white"
        >
          WhatsApp
        </button>
        <button
          onClick={() => void share("facebook")}
          className="rounded-control border px-3 py-2 text-sm"
        >
          Facebook
        </button>
        <button
          onClick={() => void share("x")}
          className="rounded-control border px-3 py-2 text-sm"
        >
          X
        </button>
        <button
          onClick={() => void share("telegram")}
          className="rounded-control border px-3 py-2 text-sm"
        >
          Telegram
        </button>
        <button
          onClick={() => void share("copy")}
          className="rounded-control border px-3 py-2 text-sm"
        >
          {en ? "Copy link" : "లింక్ కాపీ"}
        </button>
      </section>
      {!personalId ? <Archive /> : null}
    </main>
  );
}

function Archive() {
  const { data } = useQuery({
    queryKey: ["epaper-archive"],
    queryFn: epaperApi.fetchEpaperArchive,
  });
  return (
    <section className="mx-auto mt-8 max-w-[960px] px-3">
      <h2 className="th text-2xl font-bold">Previous Editions</h2>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {data?.items.map((e) => (
          <Link
            key={e.id}
            to={`/epaper/${e.edition_date}`}
            className="shrink-0 rounded-control border bg-white px-4 py-3 font-bold"
          >
            {e.edition_date} · {e.page_count} pages
          </Link>
        ))}
      </div>
    </section>
  );
}
