import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { GridCard } from "@/components/article/ArticleCard";
import { PollCard } from "@/features/epaper/PollCard";
import { VideoStrip } from "@/components/video/VideoStrip";
import * as epaperApi from "@/features/epaper/api";
import { useI18n } from "@/i18n";
import { useReaderPrefs } from "@/stores/readerPrefs";

export function PollPage() {
  const { id } = useParams();
  const poll = useQuery({
    queryKey: ["poll", id],
    queryFn: () => epaperApi.fetchPoll(Number(id)),
    enabled: Boolean(id),
  });
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {poll.isLoading ? (
        <p>Loading…</p>
      ) : poll.data ? (
        <PollCard poll={poll.data} />
      ) : (
        <p role="alert">Poll not found.</p>
      )}
    </main>
  );
}

export function TopicPage() {
  const { slug = "" } = useParams();
  const { language } = useI18n();
  const en = language === "en";
  const district = useReaderPrefs((state) => state.edition);
  const topic = useQuery({
    queryKey: ["topic", slug, district],
    queryFn: () => epaperApi.fetchTopic(slug, district),
  });
  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8">
      <header className="border-b-2 border-brand pb-3">
        <p className="text-xs font-bold uppercase tracking-widest text-brand">
          {en ? "Topic" : "అంశం"}
        </p>
        <h1 className="th text-3xl font-extrabold">
          {topic.data?.topic?.title_te || slug.replaceAll("-", " ")}
        </h1>
      </header>
      {topic.isLoading ? (
        <p className="mt-8">Loading…</p>
      ) : topic.data?.articles.length ? (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {topic.data.articles.map((a) => (
            <GridCard key={a.short_id} article={a} />
          ))}
        </div>
      ) : (
        <p className="mt-8 text-muted">
          {en
            ? "No published stories for this topic yet."
            : "ఈ అంశంలో ప్రచురిత కథనాలు ఇంకా లేవు."}
        </p>
      )}
      <VideoStrip category={slug} limit={6} className="mt-8" />
      <Link to="/" className="mt-8 inline-block font-bold text-brand">
        ← {en ? "Home" : "హోమ్"}
      </Link>
    </main>
  );
}
