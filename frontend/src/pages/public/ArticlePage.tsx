import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';

import { api } from '@/api/client';
import { AdSlot } from '@/components/ads/AdSlot';
import { ArticleGallery } from '@/components/article/ArticleGallery';
import { ArticleRenderer } from '@/components/article/ArticleRenderer';
import { ArticleVideo } from '@/components/article/ArticleVideo';
import { AudioPlayer } from '@/components/article/AudioPlayer';
import { ReaderToolbar, ReadingProgress } from '@/components/article/ReaderToolbar';
import { ShareSheet } from '@/components/article/ShareSheet';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
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
  // §4.5 URL pattern: /{category}/{slug}-{shortId}; the short id is the last segment.
  const shortId = slugAndId?.split('-').pop() ?? '';

  const { t, pick, language } = useI18n();
  const s = useScript();
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
                      onListen={serverAudio || tts.state === 'unavailable' ? undefined : tts.toggle}
                      listening={tts.state === 'speaking'}
                      onShare={() => setShareOpen(true)}
                      onComments={openComments}
                      saved={saved}
                      onSave={toggleSave}
                      commentCount={data.comment_count}
                    />
                  </div>

                  {/* §19 — the server-generated file when one exists (seek + speed).
                      Without it the toolbar's listen button speaks on-device. */}
                  {serverAudio ? (
                    <AudioPlayer
                      shortId={data.short_id}
                      readingLabel={readingTime(data.reading_time_sec, language)}
                      deviceTts={tts}
                    />
                  ) : null}

                  <ArticleHero article={data} />

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

                  <div className="mt-6">
                    <ArticleRenderer doc={data.body} />
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
