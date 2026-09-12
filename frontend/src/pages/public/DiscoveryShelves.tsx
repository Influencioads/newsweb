import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Camera, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

import { ImageCaption, NewsImage } from '@/components/media/NewsImage';
import { ButtonLink, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, Skeleton, SkeletonCard } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useReaderPrefs } from '@/stores/readerPrefs';
import type { ArticleCard, HomePayload } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * The two discovery shelves built from the **home payload** — there is no
 * dedicated photo or Web Stories endpoint yet. Both read it under the reader's
 * own edition key, so they share the home page's cache instead of firing a
 * second request for the same JSON.
 *
 * Split out of `DiscoveryPages.tsx` only to keep that file under the 500-line
 * ceiling; it re-exports both pages, and the routes import them from there.
 */

/** The home query, keyed exactly as Home.tsx keys it so the cache is shared. */
function useHome() {
  const edition = useReaderPrefs((state) => state.edition);
  const mandal = useReaderPrefs((state) => state.mandal);
  return useQuery({
    queryKey: ['public', 'home', edition, mandal],
    queryFn: () => publicApi.fetchHome(edition, mandal),
  });
}

/** Flatten the home blocks into one list, first occurrence wins. */
function dedupe(list: Array<ArticleCard | null | undefined>): ArticleCard[] {
  const seen = new Map<string, ArticleCard>();
  for (const article of list) {
    if (article && !seen.has(article.short_id)) seen.set(article.short_id, article);
  }
  return [...seen.values()];
}

function photosOf(home: HomePayload): ArticleCard[] {
  return dedupe([
    home.lead,
    ...home.secondary,
    ...home.mid_column,
    ...home.latest,
    ...home.sections.flatMap((section) => section.articles),
  ]).filter((article) => Boolean(article.hero));
}

function storiesOf(home: HomePayload): ArticleCard[] {
  return dedupe([home.lead, ...home.secondary, ...home.mid_column, ...home.latest]).slice(0, 12);
}

/** Varying the box height is what makes the column flow read as a gallery. */
const PHOTO_RATIOS = ['4/3', '1/1', '3/4'] as const;

function PhotoLightbox({
  items,
  openAt,
  onClose,
  onStep,
}: {
  items: ArticleCard[];
  openAt: number | null;
  onClose: () => void;
  onStep: (delta: number) => void;
}) {
  const { t, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const active = openAt === null ? null : items[openAt];

  // Arrow keys are listened for on the document: focus may sit on the Dialog's
  // own close button, which is outside this subtree.
  useEffect(() => {
    if (openAt === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onStep(1);
      if (e.key === 'ArrowLeft') onStep(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openAt, onStep]);

  const caption = active ? s.text(active.title_te, active.title_en) : null;

  return (
    <Dialog
      open={active !== null}
      onClose={onClose}
      title={t('page.photos')}
      sheetOnMobile={false}
      closeLabel={t('gallery.close')}
      className="md:max-w-4xl"
    >
      {active ? (
        <figure className="flex flex-col items-center">
          <NewsImage
            media={active.hero}
            ratio="16/9"
            sizes="(max-width: 1024px) 100vw, 900px"
            radius="2xl"
            className="w-full"
          />
          <figcaption
            lang={caption?.lang}
            className={cn(caption?.head, 'mt-4 w-full text-headline-sm font-bold text-ink')}
          >
            {caption?.text}
          </figcaption>
          <ImageCaption media={active.hero} />

          <div className="mt-4 flex w-full items-center justify-between gap-3">
            <IconButton
              icon={ChevronLeft}
              label={t('gallery.previous')}
              onClick={() => onStep(-1)}
              disabled={items.length < 2}
            />
            {/* role="status": stepping swaps the photo with no other announcement. */}
            <p role="status" lang={language} className={cn(s.body, 'text-meta tabular-nums text-muted')}>
              {L(
                `ఫోటో ${(openAt ?? 0) + 1} / ${items.length}`,
                `Photo ${(openAt ?? 0) + 1} of ${items.length}`,
              )}
            </p>
            <IconButton
              icon={ChevronRight}
              label={t('gallery.next')}
              onClick={() => onStep(1)}
              disabled={items.length < 2}
            />
          </div>

          <ButtonLink to={active.url} variant="secondary" full className="mt-4">
            {L('కథనం చదవండి', 'Read the story')}
          </ButtonLink>
        </figure>
      ) : null}
    </Dialog>
  );
}

export function PhotoGalleryPage() {
  const { t, pick, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const home = useHome();
  const reveal = useReveal<HTMLLIElement>();
  const [openAt, setOpenAt] = useState<number | null>(null);
  useDocumentTitle(t('page.photos'));

  const items = home.data ? photosOf(home.data) : [];
  const close = useCallback(() => setOpenAt(null), []);
  const step = useCallback(
    (delta: number) =>
      setOpenAt((current) =>
        current === null || items.length === 0 ? null : (current + delta + items.length) % items.length,
      ),
    [items.length],
  );

  return (
    <PageContainer className="py-7 md:py-10">
      <PageHeader
        eyebrow={t('ui.photos')}
        icon={Camera}
        title={t('page.photos')}
        subtitle={L('ఈరోజు వార్తల్లోని చిత్రాలు', 'The pictures in today’s news')}
        back={{ to: '/', label: t('page.home') }}
      />

      <QueryState
        query={home}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonCard key={i} variant="grid" />
            ))}
          </div>
        }
        isEmpty={(data) => photosOf(data).length === 0}
        empty={<EmptyState icon={Camera} title={t('state.empty')} />}
      >
        {() => (
          <>
            <ul className="gap-4 sm:columns-2 lg:columns-3">
              {items.map((article, index) => {
                const headline = s.text(article.title_te, article.title_en);
                return (
                  <li key={article.short_id} ref={reveal} className="mb-4 break-inside-avoid">
                    <button
                      type="button"
                      onClick={() => setOpenAt(index)}
                      aria-label={`${pick(article.title_te, article.title_en)} — ${t('gallery.enlarge')}`}
                      className="group block w-full rounded-xl text-left transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:-translate-y-0.5 active:scale-[.98]"
                    >
                      <NewsImage
                        media={article.hero}
                        ratio={PHOTO_RATIOS[index % PHOTO_RATIOS.length] ?? '4/3'}
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="group-hover:shadow-raised"
                      />
                      <span
                        lang={headline.lang}
                        className={cn(
                          headline.head,
                          'te-clamp-2 mt-2 block text-te-body-xs font-bold text-ink group-hover:text-brand',
                        )}
                      >
                        {headline.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <PhotoLightbox items={items} openAt={openAt} onClose={close} onStep={step} />
          </>
        )}
      </QueryState>
    </PageContainer>
  );
}

export function WebStoriesPage() {
  const { t, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const home = useHome();
  const reveal = useReveal<HTMLLIElement>();
  useDocumentTitle(t('page.webStories'));

  return (
    <PageContainer className="py-7 md:py-10">
      <PageHeader
        eyebrow={t('ui.webStories')}
        icon={Sparkles}
        title={t('page.webStories')}
        subtitle={L('ఒక్క తెరలో ఒక్క కథనం — వేగంగా చదవండి', 'One screen per story — read them in a swipe')}
        back={{ to: '/', label: t('page.home') }}
      />

      <QueryState
        query={home}
        skeleton={
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="image" ratio="9/16" />
            ))}
          </div>
        }
        isEmpty={(data) => storiesOf(data).length === 0}
        empty={<EmptyState icon={Sparkles} title={t('state.empty')} />}
      >
        {(data) => (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {storiesOf(data).map((article) => {
              const headline = s.text(article.title_te, article.title_en);
              return (
                <li key={article.short_id} ref={reveal}>
                  <Card as="article" tone="ink" padding="none" interactive className="overflow-hidden">
                    <Link to={article.url} className="group relative block">
                      <NewsImage
                        media={article.hero}
                        ratio="9/16"
                        sizes="(max-width: 640px) 50vw, 220px"
                        placeholderLabel={t('ui.webStories')}
                        className="opacity-80 transition-opacity duration-base ease-standard group-hover:opacity-100"
                      />
                      <span
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-deep via-ink-deep/70 to-transparent"
                      />
                      <span
                        lang={headline.lang}
                        className={cn(
                          headline.head,
                          'te-clamp-3 absolute inset-x-0 bottom-0 p-3 text-headline-xs font-bold text-on-ink',
                        )}
                      >
                        {headline.text}
                      </span>
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </PageContainer>
  );
}
