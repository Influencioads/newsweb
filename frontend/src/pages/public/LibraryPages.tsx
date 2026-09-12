import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkX, History, Home, Rss, X, type LucideIcon } from 'lucide-react';

import { RowCard } from '@/components/article/ArticleCard';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/Dialog';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as engagementApi from '@/features/engagement/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle, useReveal } from '@/utils/motion';
import { relativeTime } from '@/utils/time';

/**
 * The reader's library (§2, §11, §12): saved articles, reading history with
 * progress, and the Following feed with follow management.
 *
 * The three pages are one surface — a shared header plus a Tabs strip that
 * navigates between them — so switching lists never feels like leaving.
 * Every list is an offset infinite query; removing a bookmark or dropping a
 * follow goes through ConfirmDialog and reports with a toast.
 */

type LibraryTab = 'bookmarks' | 'history' | 'following';

const TAB_PATH: Record<LibraryTab, string> = {
  bookmarks: '/bookmarks',
  history: '/history',
  following: '/following',
};

/** Page copy with no strings.ts key yet (see neededStrings). */
function useL(): (te: string, en: string) => string {
  const { language } = useI18n();
  return (te, en) => (language === 'te' ? te : en);
}

/** Library pages are reader-private: anonymous visitors bounce to sign-in. */
function useRequireLogin(from: string): boolean {
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  useEffect(() => {
    if (status === 'anonymous') navigate('/login', { replace: true, state: { from } });
  }, [status, navigate, from]);
  return status === 'authenticated';
}

/** Offset-paged infinite query — the shape all three library endpoints share. */
function useOffsetFeed<T extends { next_offset: number | null }>(
  key: LibraryTab,
  fetchPage: (offset: number) => Promise<T>,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ['engagement', key],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last: T) => last.next_offset ?? undefined,
    enabled,
  });
}

interface LoadMoreQuery {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

function LoadMore({ query }: { query: LoadMoreQuery }) {
  const { t } = useI18n();
  if (!query.hasNextPage) return null;
  return (
    <div className="mt-6">
      <Button
        variant="secondary"
        full
        pending={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      >
        {t('ui.loadMore')}
      </Button>
    </div>
  );
}

/** Shared chrome: one header, one tab strip, one rhythm. */
function LibraryShell({
  tab,
  icon,
  title,
  children,
}: {
  tab: LibraryTab;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const L = useL();
  const navigate = useNavigate();
  useDocumentTitle(title);

  return (
    <PageContainer width="page" className="py-7 md:py-10">
      <PageHeader eyebrow={L('నా లైబ్రరీ', 'My library')} title={title} icon={icon} spacing="tight" />
      <Tabs
        ariaLabel={L('నా లైబ్రరీ', 'My library')}
        items={[
          { key: 'bookmarks', label: t('page.bookmarks'), icon: Bookmark },
          { key: 'history', label: t('page.history'), icon: History },
          { key: 'following', label: t('page.following'), icon: Rss },
        ]}
        value={tab}
        onChange={(key) => {
          if (key !== tab) navigate(TAB_PATH[key as LibraryTab]);
        }}
        scrollable
      />
      <div className="mt-7 space-y-7 md:space-y-10">{children}</div>
    </PageContainer>
  );
}

/** Empty list with a way out — a dead end is never the last word. */
function LibraryEmpty({ icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={icon}
      title={title}
      body={body}
      action={
        <ButtonLink to="/" icon={Home}>
          {t('state.goHome')}
        </ButtonLink>
      }
    />
  );
}

// --------------------------------------------------------------------------- #
export function BookmarksPage() {
  const { t, pick } = useI18n();
  const L = useL();
  const ready = useRequireLogin('/bookmarks');
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const reveal = useReveal<HTMLLIElement>();

  const feed = useOffsetFeed('bookmarks', engagementApi.fetchBookmarks, ready);

  const remove = useMutation({
    mutationFn: (shortId: string) => engagementApi.setBookmark(shortId, false),
    onSuccess: () => {
      toast.success(L('సేవ్ చేసినవాటి నుంచి తీసివేశాం', 'Removed from your saved stories'));
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'bookmarks'] });
    },
    onError: (error) => toast.error(error),
  });

  const askRemove = (shortId: string, headline: string) => {
    void (async () => {
      const ok = await confirm({
        title: L('సేవ్ నుంచి తీసివేయాలా?', 'Remove from saved?'),
        body: headline,
        confirmLabel: t('ui.remove'),
        tone: 'danger',
      });
      if (ok) remove.mutate(shortId);
    })();
  };

  if (!ready) return null;
  return (
    <LibraryShell tab="bookmarks" icon={Bookmark} title={t('page.bookmarks')}>
      <QueryState
        query={feed}
        isEmpty={(data) => !data.pages.some((page) => page.articles.length)}
        empty={
          <LibraryEmpty
            icon={Bookmark}
            title={L('ఇంకా ఏమీ సేవ్ చేయలేదు', 'Nothing saved yet')}
            body={L(
              'కథనంలో “సేవ్” నొక్కితే అది ఇక్కడ చేరుతుంది.',
              'Tap “Save” on a story and it shows up here.',
            )}
          />
        }
      >
        {(data) => (
          <>
            <ul className="flex flex-col gap-4">
              {data.pages
                .flatMap((page) => page.articles)
                .map((article) => (
                  <li key={article.short_id} ref={reveal} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <RowCard article={article} />
                    </div>
                    <IconButton
                      icon={BookmarkX}
                      label={L('సేవ్ నుంచి తీసివేయండి', 'Remove from saved')}
                      disabled={remove.isPending}
                      onClick={() => askRemove(article.short_id, pick(article.title_te, article.title_en))}
                    />
                  </li>
                ))}
            </ul>
            <LoadMore query={feed} />
          </>
        )}
      </QueryState>
      {dialog}
    </LibraryShell>
  );
}

// --------------------------------------------------------------------------- #
export function HistoryPage() {
  const { t, language } = useI18n();
  const L = useL();
  const s = useScript();
  const ready = useRequireLogin('/history');
  const reveal = useReveal<HTMLLIElement>();

  const feed = useOffsetFeed('history', engagementApi.fetchHistory, ready);

  if (!ready) return null;
  return (
    <LibraryShell tab="history" icon={History} title={t('page.history')}>
      <QueryState
        query={feed}
        isEmpty={(data) => !data.pages.some((page) => page.items.length)}
        empty={
          <LibraryEmpty
            icon={History}
            title={L('ఇంకా చదివిన కథనాలు లేవు', 'No reading history yet')}
            body={L(
              'మీరు చదివిన కథనాలు, ఎంత వరకు చదివారో ఇక్కడ కనిపిస్తాయి.',
              'Stories you read — and how far you got — appear here.',
            )}
          />
        }
      >
        {(data) => (
          <>
            <ul className="flex flex-col gap-4">
              {data.pages
                .flatMap((page) => page.items)
                .map(({ article, max_scroll_pct, last_read_at }) => (
                  <li key={article.short_id} ref={reveal}>
                    <RowCard article={article} />
                    <div className="mt-1.5 flex items-center gap-2 px-1">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-rule-soft">
                        <div
                          aria-hidden
                          className="h-full rounded-pill bg-brand"
                          style={{ width: `${Math.max(max_scroll_pct, 2)}%` }}
                        />
                      </div>
                      <span
                        lang={language}
                        className={cn(s.body, 'whitespace-nowrap text-meta text-muted')}
                      >
                        {max_scroll_pct}% · {relativeTime(last_read_at, language)}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
            <LoadMore query={feed} />
          </>
        )}
      </QueryState>
    </LibraryShell>
  );
}

// --------------------------------------------------------------------------- #
export function FollowingPage() {
  const { t, pick } = useI18n();
  const L = useL();
  const s = useScript();
  const ready = useRequireLogin('/following');
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const reveal = useReveal<HTMLLIElement>();

  const follows = useQuery({
    queryKey: ['engagement', 'my-follows'],
    queryFn: engagementApi.fetchMyFollows,
    enabled: ready,
  });

  const feed = useOffsetFeed('following', engagementApi.fetchFollowingFeed, ready);

  const unfollow = useMutation({
    mutationFn: (f: engagementApi.FollowItem) =>
      engagementApi.setFollow(f.target_type, f.slug, false),
    onSuccess: () => {
      toast.success(L('అన్‌ఫాలో చేశారు', 'Unfollowed'));
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'my-follows'] });
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'following'] });
    },
    onError: (error) => toast.error(error),
  });

  const askUnfollow = (f: engagementApi.FollowItem) => {
    void (async () => {
      const ok = await confirm({
        title: L('అన్‌ఫాలో చేయాలా?', 'Unfollow?'),
        body: pick(f.name_te, f.name_en),
        confirmLabel: L('అన్‌ఫాలో', 'Unfollow'),
        tone: 'danger',
      });
      if (ok) unfollow.mutate(f);
    })();
  };

  if (!ready) return null;
  return (
    <LibraryShell tab="following" icon={Rss} title={t('page.following')}>
      <QueryState
        query={follows}
        compact
        skeleton={<Skeleton variant="text" lines={1} />}
        isEmpty={(items) => items.length === 0}
        empty={<></>}
      >
        {(items) => (
          <section>
            <SectionHeader
              level={3}
              title={L('మీరు ఫాలో అవుతున్నవి', 'You follow')}
              action={
                <span className={cn(s.body, 'text-meta text-muted')}>
                  {L('తీసివేయడానికి నొక్కండి', 'Tap to unfollow')}
                </span>
              }
            />
            <ul className="flex flex-wrap gap-2">
              {items.map((f) => {
                const label = s.text(f.name_te, f.name_en);
                return (
                  <li key={`${f.target_type}:${f.slug}`}>
                    <Chip
                      selected
                      icon={X}
                      disabled={unfollow.isPending}
                      onClick={() => askUnfollow(f)}
                      lang={label.lang}
                      textClass={label.telugu ? 'text-te-body-xs' : 'text-ui-sm'}
                      // The X is decorative; the chip has to say what it does.
                      ariaLabel={L(`${label.text} — అన్‌ఫాలో`, `Unfollow ${label.text}`)}
                    >
                      {label.text}
                    </Chip>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </QueryState>

      <QueryState
        query={feed}
        isEmpty={(data) => !data.pages.some((page) => page.articles.length)}
        empty={
          <LibraryEmpty
            icon={Rss}
            title={L('మీ ఫీడ్ ఇంకా ఖాళీగా ఉంది', 'Your feed is empty')}
            body={L(
              'విభాగాలు, ప్రాంతాలు లేదా రచయితలను ఫాలో అయితే వారి వార్తలు ఇక్కడ కనిపిస్తాయి.',
              'Follow sections, places or authors and their stories appear here.',
            )}
          />
        }
      >
        {(data) => (
          <>
            <ul className="flex flex-col gap-4">
              {data.pages
                .flatMap((page) => page.articles)
                .map((article) => (
                  <li key={article.short_id} ref={reveal}>
                    <RowCard article={article} />
                  </li>
                ))}
            </ul>
            <LoadMore query={feed} />
          </>
        )}
      </QueryState>
      {dialog}
    </LibraryShell>
  );
}
