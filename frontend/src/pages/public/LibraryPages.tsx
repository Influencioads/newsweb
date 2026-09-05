import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, History, Rss, X } from 'lucide-react';

import { RowCard } from '@/components/article/ArticleCard';
import * as engagementApi from '@/features/engagement/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { ArticleCard as ArticleCardType } from '@/types/public';
import { relativeTime } from '@/utils/time';

/**
 * The reader's library (§2, §11, §12): saved articles, reading history with
 * progress, and the Following feed with follow management.
 */

function useRequireLogin(from: string) {
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  useEffect(() => {
    if (status === 'anonymous') navigate('/login', { replace: true, state: { from } });
  }, [status, navigate, from]);
  return status === 'authenticated';
}

function PageShell({
  eyebrow,
  title,
  icon,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-[55vh] max-w-[900px] px-4 py-7 sm:py-10">
      <div className="mb-6 border-b-2 border-ink pb-4">
        <p className="flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
          {icon}
          {eyebrow}
        </p>
        <h1 className="th mt-1 text-[27px] font-extrabold text-ink sm:text-[32px]">{title}</h1>
      </div>
      {children}
    </main>
  );
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="te rounded border border-rule bg-paper px-4 py-6 text-center text-[14.5px] text-muted">
      {children}
    </p>
  );
}

// --------------------------------------------------------------------------- #
export function BookmarksPage() {
  const { language } = useI18n();
  const te = language === 'te';
  const ready = useRequireLogin('/bookmarks');
  const [extra, setExtra] = useState<ArticleCardType[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ['engagement', 'bookmarks'],
    queryFn: async () => {
      const data = await engagementApi.fetchBookmarks();
      setExtra([]);
      setNextOffset(data.next_offset);
      return data;
    },
    enabled: ready,
  });

  const articles = [...(query.data?.articles ?? []), ...extra];

  if (!ready) return null;
  return (
    <PageShell
      eyebrow={te ? 'నా లైబ్రరీ' : 'MY LIBRARY'}
      title={te ? 'సేవ్ చేసిన వార్తలు' : 'Saved articles'}
      icon={<Bookmark className="h-3.5 w-3.5" aria-hidden />}
    >
      {query.isLoading ? (
        <p className="te text-muted">{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>
      ) : articles.length === 0 ? (
        <EmptyBox>
          {te
            ? 'ఇంకా ఏమీ సేవ్ చేయలేదు. కథనంలో “సేవ్” నొక్కితే ఇక్కడ కనిపిస్తుంది.'
            : 'Nothing saved yet. Tap “Save” on an article and it shows up here.'}
        </EmptyBox>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {articles.map((article) => (
              <RowCard key={article.short_id} article={article} />
            ))}
          </div>
          {nextOffset != null ? (
            <button
              type="button"
              onClick={async () => {
                const page = await engagementApi.fetchBookmarks(nextOffset);
                setExtra((cur) => [...cur, ...page.articles]);
                setNextOffset(page.next_offset);
              }}
              className="te mt-6 w-full border border-rule bg-paper py-3 text-[13.5px] font-bold text-ink hover:border-brand hover:text-brand"
            >
              {te ? 'మరిన్ని' : 'Load more'}
            </button>
          ) : null}
        </>
      )}
    </PageShell>
  );
}

// --------------------------------------------------------------------------- #
export function HistoryPage() {
  const { language } = useI18n();
  const te = language === 'te';
  const ready = useRequireLogin('/history');

  const query = useQuery({
    queryKey: ['engagement', 'history'],
    queryFn: () => engagementApi.fetchHistory(),
    enabled: ready,
  });

  if (!ready) return null;
  return (
    <PageShell
      eyebrow={te ? 'నా లైబ్రరీ' : 'MY LIBRARY'}
      title={te ? 'చదివిన వార్తలు' : 'Reading history'}
      icon={<History className="h-3.5 w-3.5" aria-hidden />}
    >
      {query.isLoading ? (
        <p className="te text-muted">{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>
      ) : !query.data?.items.length ? (
        <EmptyBox>
          {te ? 'చదివిన కథనాలు ఇక్కడ కనిపిస్తాయి.' : 'Articles you read will appear here.'}
        </EmptyBox>
      ) : (
        <div className="flex flex-col gap-4">
          {query.data.items.map(({ article, max_scroll_pct, last_read_at }) => (
            <div key={article.short_id}>
              <RowCard article={article} />
              <div className="mt-1 flex items-center gap-2 px-1">
                <div className="h-1 flex-1 overflow-hidden rounded bg-rule">
                  <div
                    className="h-full bg-brand"
                    style={{ width: `${Math.max(max_scroll_pct, 2)}%` }}
                    aria-hidden
                  />
                </div>
                <span className="whitespace-nowrap font-sans text-[10.5px] text-muted-light">
                  {max_scroll_pct}% · {relativeTime(last_read_at, language)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

// --------------------------------------------------------------------------- #
export function FollowingPage() {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const ready = useRequireLogin('/following');
  const queryClient = useQueryClient();
  const [extra, setExtra] = useState<ArticleCardType[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  const follows = useQuery({
    queryKey: ['engagement', 'my-follows'],
    queryFn: engagementApi.fetchMyFollows,
    enabled: ready,
  });

  const feed = useQuery({
    queryKey: ['engagement', 'following-feed'],
    queryFn: async () => {
      const data = await engagementApi.fetchFollowingFeed();
      setExtra([]);
      setNextOffset(data.next_offset);
      return data;
    },
    enabled: ready,
  });

  const unfollow = useMutation({
    mutationFn: (f: engagementApi.FollowItem) =>
      engagementApi.setFollow(f.target_type, f.slug, false),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'my-follows'] });
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'following-feed'] });
    },
  });

  const articles = [...(feed.data?.articles ?? []), ...extra];

  if (!ready) return null;
  return (
    <PageShell
      eyebrow={te ? 'నా ఫీడ్' : 'MY FEED'}
      title={te ? 'ఫాలోయింగ్' : 'Following'}
      icon={<Rss className="h-3.5 w-3.5" aria-hidden />}
    >
      {follows.data?.length ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {follows.data.map((f) => (
            <span
              key={`${f.target_type}:${f.slug}`}
              className="te flex items-center gap-1.5 rounded-chip border border-brand bg-brand-tint px-3 py-1 text-[12px] font-semibold text-brand"
            >
              {pick(f.name_te, f.name_en)}
              <button
                type="button"
                onClick={() => unfollow.mutate(f)}
                aria-label={te ? 'అన్‌ఫాలో' : 'Unfollow'}
                className="hover:text-brand-dark"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {feed.isLoading ? (
        <p className="te text-muted">{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>
      ) : articles.length === 0 ? (
        <EmptyBox>
          {te ? (
            <>
              విభాగాలు, ప్రాంతాలు లేదా రచయితలను ఫాలో అయితే వారి వార్తలు ఇక్కడ కనిపిస్తాయి.{' '}
              <Link to="/" className="font-semibold text-info hover:underline">
                హోమ్‌కు వెళ్లండి
              </Link>
            </>
          ) : (
            <>
              Follow sections, places or authors and their stories appear here.{' '}
              <Link to="/" className="font-semibold text-info hover:underline">
                Go home
              </Link>
            </>
          )}
        </EmptyBox>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {articles.map((article) => (
              <RowCard key={article.short_id} article={article} />
            ))}
          </div>
          {nextOffset != null ? (
            <button
              type="button"
              onClick={async () => {
                const page = await engagementApi.fetchFollowingFeed(nextOffset);
                setExtra((cur) => [...cur, ...page.articles]);
                setNextOffset(page.next_offset);
              }}
              className="te mt-6 w-full border border-rule bg-paper py-3 text-[13.5px] font-bold text-ink hover:border-brand hover:text-brand"
            >
              {te ? 'మరిన్ని' : 'Load more'}
            </button>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
