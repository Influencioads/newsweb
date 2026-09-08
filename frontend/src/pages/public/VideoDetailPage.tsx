import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, ChevronLeft, MessageSquare } from 'lucide-react';

import { VideoCard, formatCount } from '@/components/video/VideoCard';
import { ReactionBar } from '@/components/video/ReactionBar';
import * as publicApi from '@/features/public/api';
import * as engagementApi from '@/features/engagement/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { anonId } from '@/features/engagement/beacon';
import { formatDate, formatTime, relativeTime } from '@/utils/time';
import type { ReactionKind } from '@/types/public';

/**
 * Video page (§15) — the shape a reader expects from a video app.
 *
 * Player, then everything a decision about the story needs: title, the tags
 * that lead to more of the same, the counts, and the publisher we are legally
 * required to credit and that a reader can follow. Reactions and comments sit
 * below, sharing the article implementations rather than forking them.
 *
 * The embed is `youtube-nocookie` and only autoplays because the reader
 * navigated here deliberately — §15's "no aggressive autoplay" holds, since
 * nothing plays in a feed.
 */
export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const videoId = Number(id);
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const authed = useAuth((s) => s.status === 'authenticated');

  const video = useQuery({
    queryKey: ['public', 'video', videoId],
    queryFn: () => publicApi.fetchVideo(videoId, anonId()),
    enabled: Number.isFinite(videoId),
  });

  // One view per arrival, not per re-render — the id in the dependency list is
  // what makes navigating between videos count each of them exactly once.
  useEffect(() => {
    if (Number.isFinite(videoId)) void publicApi.countVideoView(videoId);
  }, [videoId]);

  const react = useMutation({
    mutationFn: (kind: ReactionKind | null) => publicApi.setVideoReaction(videoId, kind, anonId()),
    onSuccess: (summary) => {
      queryClient.setQueryData(['public', 'video', videoId], (old: unknown) =>
        old ? { ...(old as object), reactions: summary } : old,
      );
    },
  });

  const follow = useMutation({
    mutationFn: (next: boolean) =>
      engagementApi.setFollow('channel', video.data!.channel!.key, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public', 'video', videoId] }),
  });

  const comments = useQuery({
    queryKey: ['public', 'video-comments', videoId],
    queryFn: () => publicApi.fetchVideoComments(videoId),
    enabled: Number.isFinite(videoId),
  });

  const [draft, setDraft] = useState('');
  const addComment = useMutation({
    mutationFn: () => publicApi.addVideoComment(videoId, draft, null),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['public', 'video-comments', videoId] });
      void queryClient.invalidateQueries({ queryKey: ['public', 'video', videoId] });
    },
  });

  function share() {
    const data = video.data;
    if (!data) return;
    const url = `${window.location.origin}/videos/${data.id}`;
    void publicApi.countVideoShare(data.id);
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${pick(data.title_te, data.title_en)}\n${url}`)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  if (video.isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <p className={`${teCls} text-center text-[13px] text-muted`} role="status">
          {te ? 'లోడ్ అవుతోంది…' : 'Loading…'}
        </p>
      </main>
    );
  }

  if (video.isError || !video.data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <p role="alert" className={`${teCls} rounded-card border border-breaking-border bg-breaking-tint p-5 text-[13px] text-breaking`}>
          {te ? 'ఈ వీడియో అందుబాటులో లేదు.' : 'This video is not available.'}
        </p>
        <Link to="/videos" className={`${teCls} mt-3 inline-block font-bold text-brand underline`}>
          {te ? 'అన్ని వీడియోలు' : 'All videos'}
        </Link>
      </main>
    );
  }

  const data = video.data;
  const threads = comments.data?.comments ?? [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <button
        type="button"
        onClick={() => nav(-1)}
        className={`${teCls} mb-2 inline-flex min-h-tap items-center gap-1 text-[13px] font-semibold text-muted hover:text-brand`}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {te ? 'వెనక్కి' : 'Back'}
      </button>

      {/* ------------------------------------------------------- player -- */}
      <div className="aspect-video w-full overflow-hidden rounded-card bg-black">
        <iframe
          src={`${data.embed_url}?autoplay=1&rel=0&playsinline=1`}
          title={pick(data.title_te, data.title_en)}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>

      {/* -------------------------------------------------------- title -- */}
      <h1 className={`${te ? 'th' : 'font-sans'} mt-3 text-[20px] font-extrabold leading-tight text-ink`}>
        {pick(data.title_te, data.title_en)}
      </h1>

      {data.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {data.tags.map((tag) => (
            <Link
              key={tag.slug}
              to={`/tag/${tag.slug}`}
              className={`${teCls} rounded-chip border border-rule px-2.5 py-0.5 text-[12px] text-ink-soft hover:border-brand hover:text-brand`}
            >
              #{pick(tag.name_te, tag.name_en)}
            </Link>
          ))}
        </div>
      ) : null}

      <p className={`${teCls} mt-2 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted`}>
        <span>{formatCount(data.view_count, te)} {te ? 'వ్యూస్' : 'views'}</span>
        {data.published_at ? (
          <>
            <span aria-hidden>·</span>
            <span>{formatTime(data.published_at, language)}</span>
            <span aria-hidden>·</span>
            <span>{formatDate(data.published_at, language)}</span>
          </>
        ) : null}
      </p>

      {/* ------------------------------------------------ publisher bar -- */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-card border border-rule bg-white p-3 dark:bg-surface">
        {data.channel ? (
          <>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-tint font-sans text-[15px] font-extrabold text-brand">
              {data.channel.avatar_url
                ? <img src={data.channel.avatar_url} alt="" className="h-full w-full object-cover" />
                : data.channel.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate font-sans text-[13.5px] font-bold text-ink">
                  {data.channel.name}
                </span>
                {data.channel.is_verified ? (
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
                ) : null}
              </span>
              <span className={`${teCls} block text-[11.5px] text-muted`}>
                {data.channel.follower_count > 0
                  ? `${formatCount(data.channel.follower_count, te)} ${te ? 'ఫాలోయర్లు' : 'followers'}`
                  : (te ? 'YouTube ఛానెల్' : 'YouTube channel')}
                {data.published_at ? ` · ${relativeTime(data.published_at, language)}` : ''}
              </span>
            </span>
            <button
              type="button"
              disabled={follow.isPending}
              onClick={() => (authed ? follow.mutate(!data.following_channel) : nav('/login'))}
              className={`${teCls} min-h-[34px] shrink-0 rounded-control border px-3.5 text-[12.5px] font-bold disabled:opacity-50 ${
                data.following_channel
                  ? 'border-rule bg-canvas text-muted'
                  : 'border-brand bg-brand text-white'
              }`}
            >
              {data.following_channel ? (te ? 'ఫాలో అవుతున్నారు' : 'Following') : (te ? 'ఫాలో' : 'Follow')}
            </button>
          </>
        ) : (
          <span className={`${teCls} text-[12.5px] text-muted`}>
            {te ? 'YouTube నుంచి' : 'From YouTube'}
          </span>
        )}
        <button
          type="button"
          onClick={share}
          className="min-h-[34px] shrink-0 rounded-control border border-rule px-3 font-sans text-[12px] font-bold text-success"
        >
          WhatsApp
        </button>
      </div>

      <p className={`${teCls} mt-2 text-[11px] text-muted-light`}>
        {te
          ? 'ఈ వీడియో YouTubeలో ప్రచురితమైంది. హక్కులు సంబంధిత ఛానెల్‌వి.'
          : 'This video is published on YouTube. Rights belong to the channel.'}
      </p>

      {/* ----------------------------------------------------- reactions -- */}
      <ReactionBar
        summary={data.reactions}
        pending={react.isPending}
        onChange={(kind) => react.mutate(kind)}
      />

      {/* ------------------------------------------------------ comments -- */}
      <section className="mt-6 border-t border-rule pt-4">
        <h2 className={`${te ? 'th' : 'font-sans'} mb-3 flex items-center gap-2 text-[15px] font-bold text-ink`}>
          <MessageSquare className="h-4 w-4 text-muted" aria-hidden />
          {te ? 'కామెంట్స్' : 'Comments'}
          <span className="rounded bg-canvas px-1.5 font-sans text-[12px] font-bold text-muted">
            {data.comment_count}
          </span>
        </h2>

        {authed ? (
          <form
            onSubmit={(e: FormEvent) => { e.preventDefault(); if (draft.trim()) addComment.mutate(); }}
            className="mb-4 flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              placeholder={te ? 'కామెంట్ వ్రాయండి' : 'Write a comment'}
              className={`${teCls} min-h-tap flex-1 rounded-control border border-rule-input bg-white px-3 text-[13.5px] text-ink dark:bg-surface`}
            />
            <button
              disabled={!draft.trim() || addComment.isPending}
              className={`${teCls} min-h-tap shrink-0 rounded-control bg-brand px-4 text-[13px] font-bold text-white disabled:opacity-50`}
            >
              {te ? 'పంపండి' : 'Post'}
            </button>
          </form>
        ) : (
          <p className={`${teCls} mb-4 rounded-control border border-rule bg-canvas p-3 text-[12.5px] text-muted`}>
            {te ? 'కామెంట్ చేయడానికి ' : 'Sign in to comment — '}
            <Link to="/login" className="font-bold text-brand underline">
              {te ? 'లాగిన్ అవ్వండి' : 'sign in'}
            </Link>
          </p>
        )}

        {threads.length === 0 ? (
          <p className={`${teCls} text-[12.5px] text-muted`}>
            {te ? 'ఇంకా కామెంట్లు లేవు. మొదటిది మీరే వ్రాయండి.' : 'No comments yet. Be the first.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {threads.filter((c) => c.parent_id == null).map((comment) => (
              <li key={comment.id} className="flex gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canvas font-sans text-[12px] font-bold text-muted">
                  {(comment.author_name_en || '?').trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="font-sans text-[12px] font-semibold text-ink">
                    {pick(comment.author_name_te, comment.author_name_en)}
                    <span className="ml-1.5 font-normal text-muted">
                      {relativeTime(comment.created_at, language)}
                    </span>
                  </p>
                  <p className={`${teCls} mt-0.5 text-[13.5px] leading-telugu text-ink-soft`}>
                    {comment.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- related -- */}
      {data.related.length ? (
        <section className="mt-7 border-t border-rule pt-4">
          <h2 className={`${te ? 'th' : 'font-sans'} mb-3 text-[15px] font-bold text-ink`}>
            {te ? 'సిఫారసు చేసిన వీడియోలు' : 'Recommended videos'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.related.map((item) => (
              <VideoCard key={item.id} video={item} wide />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
