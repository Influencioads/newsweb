import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause, ShieldAlert, Sparkles } from 'lucide-react';

import { api } from '@/api/client';
import { AdSlot } from '@/components/ads/AdSlot';
import { ArticleGallery } from '@/components/article/ArticleGallery';
import { ArticleRenderer } from '@/components/article/ArticleRenderer';
import { ArticleVideo } from '@/components/article/ArticleVideo';
import {
  AudioPlayer,
  audioQuery,
  LABEL,
  PILL,
  SUBLABEL,
  TAGLINE,
  type TrackMeta,
} from '@/components/article/AudioPlayer';
import { ReaderToolbar, ReadingProgress } from '@/components/article/ReaderToolbar';
import { ShareSheet, ShareStrip } from '@/components/article/ShareSheet';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ListenIcon } from '@/components/ui/glyphs';
import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import { QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as engagementApi from '@/features/engagement/api';
import { useReadingBeacon } from '@/features/engagement/beacon';
import { CommentsSection } from '@/features/engagement/components/CommentsSection';
import { EngagementBar } from '@/features/engagement/components/EngagementBar';
import { FollowButton } from '@/features/engagement/components/FollowButton';
import { PollCard } from '@/features/epaper/PollCard';
import * as publicApi from '@/features/public/api';
import { extractPlainText, useTts } from '@/features/reader/tts';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { selectTrack, usePlayer, type Track } from '@/stores/player';
import type { AudioState } from '@/types/cms';
import type { ArticleDetail, StoryFormats } from '@/types/public';
import { cn } from '@/utils/cn';
import { prefersReducedMotion, useDocumentTitle } from '@/utils/motion';
import { readingTime } from '@/utils/time';

import { ArticleBreadcrumb, ArticleHead, ArticleHero } from './article/ArticleHead';
import { useNewsArticleJsonLd } from './article/jsonLd';
import { ReadNext } from './article/ReadNext';

/**
 * Article reader.
 *
 * The page owns the story's data and its controls; everything visual is a
 * design-system part. Three things the spec makes non-negotiable live here:
 * the §7.2 AI disclosure, the §12.5 correction note, and the §3.1 reading
 * beacon. The reader controls (font size, listen, save, share, comments) are
 * `ReaderToolbar` — rendered ONCE: a sticky bottom bar under md, an inline row
 * from md up. Hence `pb-20 md:pb-0` on the page, so the bar never covers the
 * last paragraph.
 *
 * Listen: the pill sits directly under the photo. When the story has a server
 * rendition, it and the toolbar's headphones both drive the global player
 * (stores/player) — it keeps playing in the dock after the reader moves on.
 * Voice on but no file yet: the first listen renders one. Otherwise the
 * headphones speak on-device.
 */

/**
 * Fraction of the story column scrolled, for `ReadingProgress`.
 *
 * rAF-throttled, and measured for everyone: the bar is a reading-position
 * affordance, not decoration, so withholding it from readers who asked for less
 * motion would take information away from exactly the cohort that wants it. The
 * bar's own transition is already flattened by the reduced-motion block in
 * assets/index.css.
 */
function useReadingProgress(ref: RefObject<HTMLElement>): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const span = el.offsetHeight - window.innerHeight;
      const read = window.scrollY - el.offsetTop;
      setProgress(span <= 0 ? (read > 0 ? 1 : 0) : Math.min(1, Math.max(0, read / span)));
    };
    const onScroll = () => {
      frame ||= window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ref]);

  return progress;
}

function ArticleSkeleton() {
  return (
    <div className="mx-auto flex max-w-article flex-col gap-4">
      <Skeleton variant="headline" lines={2} />
      <Skeleton variant="text" lines={2} />
      <Skeleton variant="image" ratio="16/9" />
      <Skeleton variant="text" lines={6} />
    </div>
  );
}

export default function ArticlePage() {
  const { slugAndId } = useParams<{ slugAndId: string }>();
  // §4.5 URL pattern: /{category}/{slug}-{shortId}. The short id is a 6-char
  // nanoid whose alphabet includes '-', so take the last six, not the last
  // hyphen-separated segment (that broke ~9% of stories).
  const shortId = slugAndId?.slice(-6) ?? '';

  const { t, pick, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authed = useAuth((a) => a.status === 'authenticated');

  const query = useQuery({
    queryKey: ['public', 'article', shortId],
    queryFn: () => publicApi.fetchArticle(shortId),
    enabled: Boolean(shortId),
  });
  const article = query.data;

  // Which of the four formats this story actually has. A host that cannot
  // shape Telugu reports `card.available: false`, and the card download simply
  // is not offered rather than handing out an unreadable image.
  const formats = useQuery({
    queryKey: ['formats', shortId],
    queryFn: async () => (await api.get<StoryFormats>(`/public/articles/${shortId}/formats`)).data,
    enabled: Boolean(shortId),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const serverAudio = formats.data?.audio.available === true;

  // §16 audio news, v1: on-device Telugu speech. The headline leads so a
  // listener knows immediately which story started.
  const tts = useTts(article ? `${article.title_te}. ${extractPlainText(article.body)}` : '');

  // How this story shows in the dock, Now Playing and on the lock screen.
  const trackMeta: TrackMeta | undefined = article
    ? {
        kind: 'article',
        title: article.title_te,
        subtitle: pick(article.category?.name_te, article.category?.name_en),
        href: article.url,
        artwork: article.hero?.url,
      }
    : undefined;
  // The same id AudioPlayer derives from its default route, so both controls agree on what is on air.
  const audioId = `/public/articles/${shortId}/audio`;
  // The toolbar's file comes from the same query the inline pill runs (one
  // request) — the §20-gated route, never `/formats` alone. Fetched only once
  // `/formats` reports a file: this route generates one on first request.
  const audio = useQuery({ ...audioQuery(audioId), enabled: serverAudio });
  const audioUrl = audio.data?.voice_enabled && audio.data.available ? audio.data.url : null;
  // §20: voice switched off for this story or site-wide offers no voice at all, device or server.
  const voiceOff = formats.data?.audio.voice_enabled === false || audio.data?.voice_enabled === false;
  const serverTrack: Track | null =
    trackMeta && audioUrl ? { ...trackMeta, id: audioId, url: audioUrl, durationSec: audio.data?.duration_sec } : null;
  const onAir = usePlayer((p) => {
    const current = selectTrack(p);
    return current?.id === audioId && current.url === audioUrl;
  });
  const serverPlaying = usePlayer((p) => onAir && p.playing);

  function listenServer(): void {
    const player = usePlayer.getState();
    if (onAir) player.toggle();
    else if (serverTrack) player.playTrack(serverTrack);
  }

  // Voice on but no file yet: the reader's first listen asks /audio, which
  // renders the story once server-side and hands every later reader the cached
  // file — never on page view (§21: most stories are never listened to). No
  // file back, or no answer, and the device voice takes over.
  const preparing = !serverAudio && audio.isFetching;
  const noFile = audio.isError || (audio.isSuccess && !audioUrl);
  const renderable = formats.data?.audio.voice_enabled === true && !serverAudio && !voiceOff && !noFile;
  const deviceListen = voiceOff || serverAudio || tts.state === 'unavailable' ? undefined : tts.toggle;

  // The pill a keyboard reader pressed becomes the player once the file is
  // back (a new element), so its play button takes the focus rather than
  // <body> — unless the reader has moved on while it rendered.
  const listenRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const onFile = Boolean(serverTrack);
  useEffect(() => {
    const lost = !document.activeElement || document.activeElement === document.body;
    if (onFile && refocus.current && lost) listenRef.current?.querySelector('button')?.focus();
    refocus.current = false;
  }, [onFile]);

  async function prepareAndListen(): Promise<void> {
    if (preparing) return;
    refocus.current = listenRef.current?.contains(document.activeElement) ?? false;
    const file = await queryClient
      .fetchQuery({
        ...audioQuery(audioId),
        // Rendering a long story can outlast the client's 20 s default.
        queryFn: async () => (await api.get<AudioState>(audioId, { timeout: 90_000 })).data,
      })
      .catch(() => null);
    if (file?.voice_enabled && file.available && file.url && trackMeta) {
      usePlayer.getState().playTrack({ ...trackMeta, id: audioId, url: file.url, durationSec: file.duration_sec });
      return;
    }
    refocus.current = false;
    if (file?.voice_enabled !== false) {
      if (deviceListen) deviceListen();
      else toast.info(L('ఈ కథనానికి ఇప్పుడు ఆడియో లేదు', 'No audio for this story right now'));
    }
  }

  const listen = serverTrack ? listenServer : renderable ? prepareAndListen : deviceListen;
  const speaking = tts.state === 'speaking';
  // The tagline invites; once anything is happening, the status speaks alone.
  const idleListen = !preparing && tts.state === 'idle';

  useNewsArticleJsonLd(article);
  useDocumentTitle(article ? pick(article.title_te, article.title_en) : t('state.loadingArticle'));
  // §3.1 behaviour tracking: view on open, read-time heartbeats, scroll depth.
  useReadingBeacon(article ? shortId : undefined);

  const columnRef = useRef<HTMLDivElement>(null);
  const progress = useReadingProgress(columnRef);

  const [shareOpen, setShareOpen] = useState(false);

  // Bookmarks share one query key with EngagementBar, so the toolbar and the
  // bar can never disagree about whether this story is saved.
  const flags = useQuery({
    queryKey: ['engagement', 'flags', shortId],
    queryFn: () => engagementApi.fetchMyFlags(shortId),
    enabled: authed && Boolean(shortId),
  });
  const saved = flags.data?.bookmarked ?? false;
  const bookmark = useMutation({
    mutationFn: (next: boolean) => engagementApi.setBookmark(shortId, next),
    onSuccess: (data) => {
      queryClient.setQueryData(['engagement', 'flags', shortId], data);
      toast.success(t(data.bookmarked ? 'state.saved' : 'ui.done'));
    },
    onError: (error) => toast.error(error),
  });

  function toggleSave(): void {
    if (!authed) {
      navigate('/login', { state: { from: article?.url } });
      return;
    }
    bookmark.mutate(!saved);
  }

  /** Move the reader to the one report control, which lives in EngagementBar. */
  function openReport(): void {
    const el = document.getElementById('report-article');
    el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    el?.focus();
  }

  function openComments(): void {
    document
      .getElementById('comments')
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  const shareTitle = article
    ? language === 'en' && article.title_en
      ? article.title_en
      : article.title_te
    : '';

  return (
    <>
      {article ? <ReadingProgress progress={progress} /> : null}

      <PageContainer width="wrap" className="py-5 pb-20 md:pb-8">
        <QueryState query={query} skeleton={<ArticleSkeleton />} errorTitle={t('state.articleFailed')}>
          {(data: ArticleDetail) => (
            <div className="space-y-7 md:space-y-10">
              <article className="reader-column mx-auto max-w-article">
                {/* Only the story column is measured: the ad, follow row, gallery,
                    tags and comments below would otherwise report the reader as
                    nowhere near done at the moment they finish reading. */}
                <div ref={columnRef}>
                  <ArticleBreadcrumb article={data} />
                  <div className="mt-4">
                    <ArticleHead article={data} />
                  </div>

                  {/* The one toolbar: sticky bottom bar under md, inline row from md up. */}
                  <div className="mt-3">
                    <ReaderToolbar
                      article={data}
                      formats={serverAudio ? null : formats.data}
                      onListen={listen}
                      listenPending={preparing}
                      listening={serverTrack ? serverPlaying : speaking}
                      onShare={() => setShareOpen(true)}
                      onComments={openComments}
                      saved={saved}
                      onSave={toggleSave}
                      commentCount={data.comment_count}
                    />
                  </div>

                  <ArticleHero article={data} />

                  {/* §19 listen, directly under the photo (under the toolbar when
                      there is none). A file plays in the global player (seek,
                      speed and queue in Now Playing); voice on without one
                      renders it on the first tap; otherwise the device voice.
                      Nothing until /formats answers, so no fallback flashes. */}
                  {serverAudio || serverTrack ? (
                    <div ref={listenRef} className="mt-3">
                      <AudioPlayer
                        shortId={data.short_id}
                        readingLabel={readingTime(data.reading_time_sec, language)}
                        deviceTts={tts}
                        track={trackMeta}
                        idleIcon={ListenIcon}
                        tagline={t('reader.listenTagline')}
                      />
                    </div>
                  ) : listen && formats.isFetched ? (
                    <div ref={listenRef} className={cn(PILL, 'mt-3')}>
                      {/* Busy, never disabled, while the file renders: a
                          disabled button drops the focus it just took (a
                          repeat press is ignored in prepareAndListen). */}
                      <IconButton
                        icon={preparing ? Loader2 : speaking ? Pause : ListenIcon}
                        label={speaking ? t('ui.pause') : t('reader.listen')}
                        variant="primary"
                        round
                        aria-busy={preparing || undefined}
                        className={cn(preparing && '[&>svg]:animate-spin')}
                        aria-describedby="article-listen-status"
                        onClick={listen}
                      />
                      <span className="flex flex-col pr-2">
                        {idleListen ? (
                          <span className={cn(s.body, TAGLINE)}>{t('reader.listenTagline')}</span>
                        ) : null}
                        <span
                          id="article-listen-status"
                          aria-live="polite"
                          className={cn(s.body, idleListen ? SUBLABEL : LABEL)}
                        >
                          {preparing
                            ? L('ఆడియో సిద్ధమవుతోంది…', 'Preparing audio…')
                            : speaking
                              ? t('ui.pause')
                              : tts.state === 'paused'
                                ? L('కొనసాగించండి', 'Resume')
                                : `${t('reader.listen')} · ${readingTime(data.reading_time_sec, language)}`}
                        </span>
                      </span>
                    </div>
                  ) : null}

                  {/* §12.5 — the editor's note on a material correction. */}
                  {data.correction_note_te ? (
                    <Card tone="warm" padding="md" as="aside" className="mt-5 border-l-4 border-l-exclusive">
                      <p className={cn(s.body, 'text-meta font-bold text-exclusive-text')}>
                        {t('article.editorNote')}
                      </p>
                      <p lang="te" className="te reader-caption mt-1 text-ink-soft">
                        {data.correction_note_te}
                      </p>
                    </Card>
                  ) : null}

                  {/* The desk's own reading of the story. Deliberately styled
                      apart from the correction note above: a correction says we
                      got something wrong, a critic note does not. */}
                  {data.critic_note_te ? (
                    <Card
                      tone="warm"
                      padding="md"
                      as="aside"
                      className="mt-5 border-l-4 border-l-brand"
                    >
                      <p className={cn(s.body, 'text-meta font-bold text-brand')}>
                        {t('article.criticNote')}
                      </p>
                      <p lang="te" className="te reader-caption mt-1 text-ink-soft">
                        {data.critic_note_te}
                      </p>
                    </Card>
                  ) : null}

                  {/* §0 / IT Rules — derived from the byline badge, never a
                      column of its own: a disclaimer that depends on somebody
                      remembering to tick a box is a disclaimer that goes
                      missing on the one story that needed it. */}
                  {data.byline_badge === 'panchayat' ? (
                    <Card tone="warm" padding="md" as="aside" className="mt-5 border-l-4 border-l-breaking">
                      <p className={cn(s.body, 'flex items-center gap-2 text-meta font-bold text-breaking')}>
                        <Icon icon={ShieldAlert} size="xs" />
                        {L('ఇది ముందుగా సమీక్షించలేదు', 'Not pre-reviewed')}
                      </p>
                      <p lang="te" className="te reader-caption mt-1 text-ink-soft">
                        {L(
                          'ఈ కథనాన్ని పంచాయతీ కార్యదర్శి నేరుగా ప్రచురించారు; మా ఎడిటర్ దీన్ని ముందుగా చదవలేదు. ఇందులోని విషయానికి రచయితే బాధ్యులు.',
                          'A panchayat secretary published this directly; no editor of ours read it first. The writer is responsible for what it says.',
                        )}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4">
                        <ButtonLink to="/ugc-terms" variant="link" size="sm">
                          {L('పాఠకుల కథనాల నిబంధనలు', 'Reader content terms')}
                        </ButtonLink>
                        <Button variant="link" size="sm" onClick={openReport}>
                          {L('ఈ కథనాన్ని నివేదించండి', 'Report this story')}
                        </Button>
                      </div>
                    </Card>
                  ) : null}

                  <div className="mt-6">
                    {/* A body-less short item: its short text is the story. */}
                    <ArticleRenderer
                      doc={
                        data.reading_time_sec === 0 && data.summary_te
                          ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: data.summary_te }] }] }
                          : data.body
                      }
                    />
                    {/* Renders nothing when the story has no video — no placeholder. */}
                    <ArticleVideo video={data.video} />
                    {data.poll ? <PollCard poll={data.poll} className="mt-6" /> : null}
                  </div>
                </div>

                {/* §7.2 — non-optional when AI assisted the draft. */}
                {data.ai_generated ? (
                  <Card tone="warm" padding="md" as="aside" className="mt-6 flex items-start gap-3">
                    <Badge tone="ai" icon={Sparkles}>
                      {t('ui.aiAssisted')}
                    </Badge>
                    <p lang="te" className="te reader-caption min-w-0 text-ink-soft">
                      {t('article.aiDisclosure')}
                    </p>
                  </Card>
                ) : null}

                {/* §12.5 source credit */}
                {data.source_credit ? (
                  <p className={cn(s.body, 'mt-4 text-meta text-muted')}>
                    {t('article.source')}: {data.source_credit}
                  </p>
                ) : null}

                {/* Where the story ends: the four share paths, always in view. */}
                <ShareStrip shortId={data.short_id} url={data.url} title={shareTitle} className="mt-7" />

                {/* Like · comment · save · share · report (§5) */}
                <EngagementBar article={data} />

                {/* §26 article-page ad, category-targeted; collapses when unfilled. */}
                <AdSlot placement="article" category={data.category?.slug} className="mt-6" />

                {/* Follow the threads this story belongs to (§12) */}
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <span className={cn(s.body, 'text-ui-sm font-semibold text-muted')}>
                    {t('ui.follow')}
                  </span>
                  {data.category ? (
                    <FollowButton
                      targetType="category"
                      slug={data.category.slug}
                      name={pick(data.category.name_te, data.category.name_en)}
                      compact
                    />
                  ) : null}
                  {data.district ? (
                    <FollowButton
                      targetType="district"
                      slug={data.district.slug}
                      name={pick(data.district.name_te, data.district.name_en)}
                      compact
                    />
                  ) : null}
                  {data.tags.slice(0, 3).map((tag) => (
                    <FollowButton
                      key={tag.slug}
                      targetType="tag"
                      slug={tag.slug}
                      name={tag.name_te}
                      compact
                    />
                  ))}
                </div>

                {/* The rest of the desk's take on this story. */}
                <ArticleGallery images={data.gallery} />

                {data.tags.length > 0 ? (
                  <div className="mt-6 flex flex-wrap gap-2">
                    {data.tags.map((tag) => (
                      <Chip key={tag.slug} as="link" to={`/tag/${tag.slug}`} lang="te">
                        {`#${tag.name_te}`}
                      </Chip>
                    ))}
                  </div>
                ) : null}

                <CommentsSection shortId={data.short_id} />
              </article>

              <ReadNext article={data} />

              {/* One share implementation for the whole app. */}
              <ShareSheet
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                shortId={data.short_id}
                url={data.url}
                title={shareTitle}
                cardAvailable={formats.data?.card.available ?? false}
              />
            </div>
          )}
        </QueryState>
      </PageContainer>
    </>
  );
}
