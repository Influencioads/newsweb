import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { BadgeCheck, Hash, MessageSquare, Play, Send, Share2 } from 'lucide-react';

import { NewsImage } from '@/components/media/NewsImage';
import { ShareSheet } from '@/components/article/ShareSheet';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { Sheet } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { QueryState, Skeleton, SkeletonCard } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import { ReactionBar, optimisticReaction } from '@/components/video/ReactionBar';
import { VideoCard, formatCount } from '@/components/video/VideoCard';
import * as engagementApi from '@/features/engagement/api';
import { anonId } from '@/features/engagement/beacon';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { MediaOut, ReactionKind, VideoDetail } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';
import { formatDate, formatTime, relativeTime } from '@/utils/time';

/**
 * Video page (§15) — the shape a reader expects from a video app.
 *
 * Player, then everything a decision about the story needs: title, the tags
 * that lead to more of the same, the counts, and the publisher we are legally
 * required to credit and that a reader can follow. Reactions and comments sit
 * below, sharing the article implementations rather than forking them.
 *
 * The embed is `youtube-nocookie` and loads only when the reader presses play:
 * the poster fills the reserved 16/9 box until then, so the page costs no
 * third-party frame on arrival and §15's "no aggressive autoplay" holds by
 * construction rather than by promise. Autoplay in the embed URL therefore
 * starts the video the reader just asked for.
 */

const COMMENT_MAX = 1000;

type CommentPage = Awaited<ReturnType<typeof publicApi.fetchVideoComments>>;

/**
 * YouTube gives a bare thumbnail URL, not a MediaOut row. Wrapping it keeps the
 * poster going through NewsImage (reserved box, placeholder on a dead thumb).
 */
function poster(video: VideoDetail): MediaOut {
  return {
    id: video.id,
    url: video.thumbnail_url,
    srcset: null,
    alt_te: null,
    caption_te: null,
    credit: null,
    license_label: null,
    source_url: null,
    width: null,
    height: null,
    blurhash: null,
    ai_generated: false,
  };
}

/** 16/9 box that reserves its height; the iframe replaces the poster on play. */
function Player({ video, title, playing, onPlay }: { video: VideoDetail; title: string; playing: boolean; onPlay: () => void }) {
  const { t } = useI18n();
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-ink">
      {playing ? (
        <iframe
          src={`${video.embed_url}?autoplay=1&rel=0&playsinline=1`}
          title={title}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <>
          <NewsImage
            media={poster(video)}
            ratio="16/9"
            radius="2xl"
            priority
            sizes="(min-width: 880px) 880px, 100vw"
            placeholderLabel={t('ui.video')}
            className="absolute inset-0 h-full w-full"
          />
          <button
            type="button"
            onClick={onPlay}
            aria-label={`${t('ui.play')}: ${title}`}
            className="group absolute inset-0 flex items-center justify-center rounded-2xl transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:bg-overlay/20 active:scale-[.98]"
          >
            <span className="flex h-tap-lg w-tap-lg items-center justify-center rounded-pill bg-overlay/60 text-on-ink shadow-raised transition-[colors,transform,box-shadow,opacity] duration-base ease-standard group-hover:bg-brand">
              <Icon icon={Play} size="lg" />
            </span>
          </button>
        </>
      )}
    </div>
  );
}

/** Loading stand-in with the page's geometry, so nothing jumps on arrival. */
function DetailSkeleton() {
  return (
    <div aria-hidden className="space-y-7">
      <Skeleton variant="headline" lines={2} />
      <Skeleton variant="image" ratio="16/9" className="rounded-2xl" />
      <Skeleton variant="text" lines={3} />
    </div>
  );
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const videoId = Number(id);
  const { t, language, pick } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const te = language === 'te';
  const queryClient = useQueryClient();
  const toast = useToast();
  const authed = useAuth((state) => state.status === 'authenticated');
  const me = useAuth((state) => state.me);

  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const videoKey = ['public', 'video', videoId];
  const commentsKey = ['public', 'video-comments', videoId];

  const video = useQuery({
    queryKey: videoKey,
    queryFn: () => publicApi.fetchVideo(videoId, anonId()),
    enabled: Number.isFinite(videoId),
  });

  const comments = useQuery({
    queryKey: commentsKey,
    queryFn: () => publicApi.fetchVideoComments(videoId),
    enabled: Number.isFinite(videoId),
  });

  const data = video.data;
  const title = pick(data?.title_te, data?.title_en);
  useDocumentTitle(title || t('ui.video'));

  // One view per arrival, not per re-render — the id in the dependency list is
  // what makes navigating between videos count each of them exactly once, and
  // what puts the next video back behind its poster.
  useEffect(() => {
    setPlaying(false);
    setDraft('');
    if (Number.isFinite(videoId)) void publicApi.countVideoView(videoId);
  }, [videoId]);

  const react = useMutation({
    mutationFn: (kind: ReactionKind | null) => publicApi.setVideoReaction(videoId, kind, anonId()),
    // The bar redraws before the request leaves; a refused vote rolls the cache
    // back to exactly what the server last said rather than to a guess.
    onMutate: async (kind) => {
      await queryClient.cancelQueries({ queryKey: videoKey });
      const previous = queryClient.getQueryData<VideoDetail>(videoKey);
      if (previous) {
        queryClient.setQueryData<VideoDetail>(videoKey, {
          ...previous,
          reactions: optimisticReaction(previous.reactions, kind),
        });
      }
      return { previous };
    },
    onError: (error, _kind, context) => {
      if (context?.previous) queryClient.setQueryData(videoKey, context.previous);
      toast.error(error);
    },
    onSuccess: (summary) => {
      queryClient.setQueryData<VideoDetail>(videoKey, (old) => (old ? { ...old, reactions: summary } : old));
    },
  });

  const follow = useMutation({
    mutationFn: (next: boolean) => engagementApi.setFollow('channel', data?.channel?.key ?? '', next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: videoKey }),
    onError: (error) => toast.error(error),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => publicApi.addVideoComment(videoId, body, null),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: commentsKey });
      const previous = queryClient.getQueryData<CommentPage>(commentsKey);
      // Negative id: the server's ids are positive, so the placeholder cannot
      // collide with a real row while the request is in flight.
      const pendingComment = {
        id: -Date.now(),
        parent_id: null,
        body,
        author_name_te: me?.user.name_te ?? '',
        author_name_en: me?.user.name_en ?? '',
        is_mine: true,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<CommentPage>(commentsKey, (old) =>
        old
          ? { ...old, total_visible: old.total_visible + 1, comments: [...old.comments, pendingComment] }
          : { total_visible: 1, comments: [pendingComment] },
      );
      setDraft('');
      return { previous };
    },
    onError: (error, body, context) => {
      queryClient.setQueryData(commentsKey, context?.previous);
      // Typing is not disposable: hand the text back rather than making the
      // reader write it again.
      setDraft(body);
      toast.error(error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: commentsKey });
      void queryClient.invalidateQueries({ queryKey: videoKey });
    },
  });

  function submitComment(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (body) addComment.mutate(body);
  }

  function openShare() {
    if (data) void publicApi.countVideoShare(data.id);
    setShareOpen(true);
  }

  return (
    <PageContainer width="wrap" className="py-7 md:py-10">
      <QueryState query={video} skeleton={<DetailSkeleton />}>
        {(item) => {
          const heading = s.forText(item.title_te, item.title_en);
          const channel = item.channel;
          return (
            <>
              <PageHeader
                back={{ to: '/videos', label: t('ui.videos') }}
                title={pick(item.title_te, item.title_en)}
                titleLang={heading.lang}
              />

              <div className="space-y-7 md:space-y-10">
                <div className="space-y-4">
                  <Player
                    video={item}
                    title={pick(item.title_te, item.title_en)}
                    playing={playing}
                    onPlay={() => setPlaying(true)}
                  />

                  <p className="flex flex-wrap items-center gap-x-1.5 font-sans text-meta text-muted">
                    <span lang={language} className={cn(s.body, 'tabular-nums')}>
                      {formatCount(item.view_count, te)}
                    </span>
                    <span lang={language} className={s.body}>
                      {te ? 'వ్యూస్' : 'views'}
                    </span>
                    {item.published_at ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{formatTime(item.published_at)}</span>
                        <span aria-hidden>·</span>
                        <span>{formatDate(item.published_at, language)}</span>
                      </>
                    ) : null}
                  </p>

                  {item.tags.length ? (
                    <ChipRail ariaLabel={L('ట్యాగ్‌లు', 'Tags')}>
                      {item.tags.map((tag) => {
                        const label = s.text(tag.name_te, tag.name_en);
                        return (
                          <Chip
                            key={tag.slug}
                            as="link"
                            to={`/tag/${tag.slug}`}
                            icon={Hash}
                            lang={label.lang}
                            textClass={label.telugu ? 'text-te-body-xs' : 'text-ui-sm'}
                          >
                            {label.text}
                          </Chip>
                        );
                      })}
                    </ChipRail>
                  ) : null}
                </div>

                {/* ------------------------------------------- publisher -- */}
                <div className="space-y-2">
                  <Card padding="sm" className="flex flex-wrap items-center gap-3">
                    {channel ? (
                      <>
                        <span className="relative flex h-tap w-tap shrink-0 items-center justify-center overflow-hidden rounded-pill bg-brand-tint font-sans text-headline-xs font-extrabold text-brand">
                          {channel.name.trim().charAt(0).toUpperCase()}
                          {channel.avatar_url ? (
                            // A dead YouTube thumbnail uncovers the initial underneath.
                            <img
                              src={channel.avatar_url}
                              alt=""
                              loading="lazy"
                              width={44}
                              height={44}
                              onError={(event) => (event.currentTarget.style.display = 'none')}
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1">
                            <span lang={language} className={cn(s.body, 'min-w-0 text-ui font-bold text-ink')}>
                              {channel.name}
                            </span>
                            {channel.is_verified ? (
                              <Icon icon={BadgeCheck} size="sm" className="text-info" />
                            ) : null}
                          </span>
                          <span lang={language} className={cn(s.body, 'block text-meta text-muted')}>
                            {channel.follower_count > 0
                              ? `${formatCount(channel.follower_count, te)} ${te ? 'ఫాలోయర్లు' : 'followers'}`
                              : L('YouTube ఛానెల్', 'YouTube channel')}
                            {item.published_at ? ` · ${relativeTime(item.published_at, language)}` : ''}
                          </span>
                        </span>
                        <Button
                          variant={item.following_channel ? 'secondary' : 'primary'}
                          pending={follow.isPending}
                          onClick={() =>
                            authed ? follow.mutate(!item.following_channel) : setSignInOpen(true)
                          }
                        >
                          {t(item.following_channel ? 'ui.following' : 'ui.follow')}
                        </Button>
                      </>
                    ) : (
                      <span lang={language} className={cn(s.body, 'flex-1 text-meta text-muted')}>
                        {L('YouTube నుంచి', 'From YouTube')}
                      </span>
                    )}
                    <Button variant="secondary" icon={Share2} onClick={openShare}>
                      {t('ui.share')}
                    </Button>
                  </Card>

                  <p lang={language} className={cn(s.body, 'text-meta text-muted')}>
                    {L(
                      'ఈ వీడియో YouTubeలో ప్రచురితమైంది. హక్కులు సంబంధిత ఛానెల్‌వి.',
                      'This video is published on YouTube. Rights belong to the channel.',
                    )}
                  </p>
                </div>

                <ReactionBar
                  summary={item.reactions}
                  pending={react.isPending}
                  onChange={(kind) => react.mutate(kind)}
                />

                {/* -------------------------------------------- comments -- */}
                <section className="border-t border-rule pt-6">
                  <h2 className={cn(s.head, 'mb-4 flex items-center gap-2 text-headline-xs font-bold text-ink')}>
                    <Icon icon={MessageSquare} size="sm" className="text-muted" />
                    {t('ui.comments')}
                    <Badge tone="muted" size="xs" lang="en" className="tabular-nums">
                      {item.comment_count}
                    </Badge>
                  </h2>

                  {authed ? (
                    <form onSubmit={submitComment} className="mb-6">
                      <Field label={L('మీ కామెంట్', 'Your comment')}>
                        <Textarea
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          counter={COMMENT_MAX}
                          autoGrow
                          rows={3}
                          placeholder={L('కామెంట్ వ్రాయండి', 'Write a comment')}
                        />
                      </Field>
                      <Button
                        type="submit"
                        icon={Send}
                        pending={addComment.isPending}
                        disabled={draft.trim().length === 0}
                      >
                        {L('పంపండి', 'Post')}
                      </Button>
                    </form>
                  ) : (
                    <Card padding="sm" className="mb-6 flex flex-wrap items-center justify-between gap-3">
                      <p lang={language} className={cn(s.body, 'min-w-0 flex-1 text-meta text-ink-soft')}>
                        {t('ui.signInBody')}
                      </p>
                      <Button variant="secondary" onClick={() => setSignInOpen(true)}>
                        {t('nav.signIn')}
                      </Button>
                    </Card>
                  )}

                  <QueryState
                    query={comments}
                    compact
                    skeleton={<SkeletonCard variant="compact" />}
                    isEmpty={(page) => !page.comments.some((comment) => comment.parent_id == null)}
                    empty={
                      <p lang={language} className={cn(s.body, 'text-meta text-muted')}>
                        {L('ఇంకా కామెంట్లు లేవు. మొదటిది మీరే వ్రాయండి.', 'No comments yet. Be the first.')}
                      </p>
                    }
                  >
                    {(page) => (
                      <ul className="space-y-4">
                        {page.comments
                          .filter((comment) => comment.parent_id == null)
                          .map((comment) => (
                            <li key={comment.id} className="flex gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-rule-soft font-sans text-ui-sm font-bold text-muted">
                                {(comment.author_name_en || comment.author_name_te || '?').trim().charAt(0).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="font-sans text-meta font-semibold text-ink">
                                  {pick(comment.author_name_te, comment.author_name_en)}
                                  <span className="ml-1.5 font-normal text-muted">
                                    {relativeTime(comment.created_at, language)}
                                  </span>
                                </p>
                                {/* Free text: the Telugu-capable face, without claiming the script. */}
                                <p className="te mt-1 text-te-body-xs text-ink-soft">{comment.body}</p>
                              </div>
                            </li>
                          ))}
                      </ul>
                    )}
                  </QueryState>
                </section>

                {/* --------------------------------------------- related -- */}
                {item.related.length ? (
                  <section className="border-t border-rule pt-6">
                    <SectionHeader title={L('సిఫారసు చేసిన వీడియోలు', 'Recommended videos')} />
                    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {item.related.map((related) => (
                        <li key={related.id}>
                          <VideoCard video={related} wide />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>

              <ShareSheet
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                shortId={String(item.id)}
                track={false}
                url={`/videos/${item.id}`}
                title={pick(item.title_te, item.title_en)}
                // The card renderer is an article endpoint; a video has no card.
                cardAvailable={false}
              />
            </>
          );
        }}
      </QueryState>

      <Sheet open={signInOpen} onClose={() => setSignInOpen(false)} title={t('ui.signInToContinue')}>
        <p lang={language} className={cn(s.body, te ? 'text-te-body-xs' : 'text-ui', 'text-ink-soft')}>
          {t('ui.signInBody')}
        </p>
        <ButtonLink to="/login" size="lg" full className="mt-5">
          {t('nav.signIn')}
        </ButtonLink>
      </Sheet>
    </PageContainer>
  );
}
