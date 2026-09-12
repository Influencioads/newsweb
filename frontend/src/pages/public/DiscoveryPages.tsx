import { useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Hash, MapPin, UserRound, type LucideIcon } from 'lucide-react';

import { RowCard } from '@/components/article/ArticleCard';
import { Button, ButtonLink } from '@/components/ui/Button';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * Discovery surfaces (§5, §9).
 *
 * The district, mandal, author and tag archives are the same page with a
 * different filter, so they share one `FeedPage` shell rather than four
 * near-identical copies. Paging is a cursor-based infinite query with an
 * IntersectionObserver on the "load more" button; the button stays the
 * accessible path to the same call, exactly as the trending feed does.
 *
 * The photo gallery and Web Stories shelves are the sibling `DiscoveryShelves`
 * (see the re-export at the foot of this file).
 */

// ---------------------------------------------------------------------------
// Filtered archives
// ---------------------------------------------------------------------------

type FeedKind = 'district' | 'mandal' | 'author' | 'tag';

/** "guntur-west" → "Guntur West" — the fallback name before the feed answers. */
function titleCase(value: string): string {
  return value
    .split('-')
    .map((part) => (part ? (part[0]?.toUpperCase() ?? '') + part.slice(1) : ''))
    .join(' ');
}

interface FeedPageProps {
  kind: FeedKind;
  slug: string;
  icon: LucideIcon;
  eyebrow: string;
  subtitle: string;
}

function FeedPage({ kind, slug, icon, eyebrow, subtitle }: FeedPageProps) {
  const { t } = useI18n();
  const s = useScript();
  const reveal = useReveal<HTMLLIElement>();
  const sentinel = useRef<HTMLDivElement | null>(null);

  const feed = useInfiniteQuery({
    queryKey: ['public', 'feed', kind, slug],
    queryFn: ({ pageParam }) =>
      publicApi.fetchFeed({ [kind]: slug, cursor: pageParam || undefined, limit: 20 }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(slug),
  });

  // Only the district feed echoes its subject back; the rest name themselves
  // from the slug. Either way the heading carries the script of what it shows.
  const district = kind === 'district' ? feed.data?.pages[0]?.district : null;
  const heading = district ? s.text(district.name_te, district.name_en) : null;
  const title = heading?.text || titleCase(slug);
  useDocumentTitle(title);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <PageContainer width="page" className="py-7 md:py-10">
      <PageHeader
        eyebrow={eyebrow}
        icon={icon}
        title={title}
        // The `titleCase(slug)` fallback is always Latin, so the lang follows
        // the text actually rendered rather than the interface.
        titleLang={heading?.lang ?? 'en'}
        subtitle={subtitle}
        back={{ to: '/', label: t('page.home') }}
      />

      <div className="space-y-7 md:space-y-10">
        <QueryState
          query={feed}
          skeleton={
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonCard key={i} variant="row" />
              ))}
            </div>
          }
          isEmpty={(data) => !data.pages.some((page) => page.articles.length)}
          empty={
            <EmptyState
              icon={icon}
              title={t('state.empty')}
              action={
                <ButtonLink to="/" variant="secondary">
                  {t('page.home')}
                </ButtonLink>
              }
            />
          }
        >
          {(data) => (
            <>
              <ul className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                {data.pages
                  .flatMap((page) => page.articles)
                  .map((article) => (
                    <li key={article.short_id} ref={reveal}>
                      <RowCard article={article} />
                    </li>
                  ))}
              </ul>

              {isFetchingNextPage ? (
                <div className="mt-4">
                  <SkeletonCard variant="row" />
                </div>
              ) : null}

              {hasNextPage ? (
                <div ref={sentinel} className="mt-6">
                  <Button
                    variant="secondary"
                    full
                    pending={isFetchingNextPage}
                    onClick={() => void fetchNextPage()}
                  >
                    {t('ui.loadMore')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </QueryState>
      </div>
    </PageContainer>
  );
}

export function DistrictPage() {
  const { slug = '' } = useParams();
  const { t, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  return (
    <FeedPage
      kind="district"
      slug={slug}
      icon={MapPin}
      eyebrow={t('page.district')}
      subtitle={L('జిల్లా నుంచి తాజా స్థానిక వార్తలు', 'Latest verified local news from the district')}
    />
  );
}

export function MandalPage() {
  const { slug = '' } = useParams();
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  return (
    <FeedPage
      kind="mandal"
      slug={slug}
      icon={MapPin}
      eyebrow={t('page.mandal')}
      subtitle={L('మండలం నుంచి తాజా వార్తలు', 'The latest reporting from this mandal')}
    />
  );
}

export function AuthorPage() {
  const { slug = '' } = useParams();
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  return (
    <FeedPage
      kind="author"
      slug={slug}
      icon={UserRound}
      eyebrow={t('page.author')}
      subtitle={L('ఈ విలేకరి రాసిన కథనాలు', 'Stories filed by this journalist')}
    />
  );
}

export function TagPage() {
  const { slug = '' } = useParams();
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  return (
    <FeedPage
      kind="tag"
      slug={slug}
      icon={Hash}
      eyebrow={t('page.tag')}
      subtitle={L('ఈ అంశంపై ప్రచురించిన కథనాలు', 'Everything published under this tag')}
    />
  );
}
// ---------------------------------------------------------------------------
// Home-payload shelves
// ---------------------------------------------------------------------------

// The photo gallery and Web Stories live in a sibling file (this one would
// otherwise run past the 500-line ceiling) and are re-exported here, so the
// route table keeps importing every discovery page from one module.
export { PhotoGalleryPage, WebStoriesPage } from './DiscoveryShelves';
