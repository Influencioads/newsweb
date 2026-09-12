import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Hash, HelpCircle, Newspaper } from 'lucide-react';

import { GridCard } from '@/components/article/ArticleCard';
import { ButtonLink } from '@/components/ui/Button';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { VideoStrip } from '@/components/video/VideoStrip';
import * as epaperApi from '@/features/epaper/api';
import { PollCard } from '@/features/epaper/PollCard';
import { FollowButton } from '@/features/engagement/components/FollowButton';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useReaderPrefs } from '@/stores/readerPrefs';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * Reader-participation pages (§11): a single poll on its own shareable page,
 * and a trending topic's coverage.
 *
 * The poll itself is `PollCard` — the same component the home page and the
 * e-paper render — so voting, the result bars and the share action have one
 * implementation. This page only gives it a title, a measure and something to
 * read afterwards.
 */

/** A grid of loading tiles, shared by both pages. */
function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} variant="grid" />
      ))}
    </div>
  );
}

export function PollPage() {
  const { id = '' } = useParams();
  const { t, language, pick } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reveal = useReveal<HTMLLIElement>();
  const pollId = Number(id);

  const poll = useQuery({
    queryKey: ['poll', id],
    queryFn: () => epaperApi.fetchPoll(pollId),
    enabled: Boolean(id) && Number.isFinite(pollId),
  });

  // No "related to this poll" endpoint exists, so the block below is honestly
  // labelled "read next" rather than pretending to be topically matched.
  const readNext = useQuery({
    queryKey: ['public', 'feed', 'poll-read-next'],
    queryFn: () => publicApi.fetchFeed({ limit: 3 }),
    staleTime: 120_000,
  });

  useDocumentTitle(poll.data ? pick(poll.data.question_te, poll.data.question_en) : t('page.poll'));
  const more = readNext.data?.articles ?? [];

  return (
    <PageContainer width="page" className="py-7 md:py-10">
      <PageHeader
        eyebrow={t('page.poll')}
        icon={HelpCircle}
        title={L('మీ అభిప్రాయం', 'Your say')}
        subtitle={L(
          'ఒక్క ఓటు వేయండి — ఫలితాలు వెంటనే కనిపిస్తాయి.',
          'Cast one vote and the running result appears straight away.',
        )}
        back={{ to: '/', label: t('page.home') }}
      />

      <div className="space-y-7 md:space-y-10">
        <QueryState
          query={poll}
          skeleton={<SkeletonCard variant="lead" />}
          empty={
            <EmptyState
              icon={HelpCircle}
              title={L('ఈ పోల్ కనిపించలేదు', 'That poll is not available')}
              action={
                <ButtonLink to="/" variant="secondary">
                  {t('page.home')}
                </ButtonLink>
              }
            />
          }
        >
          {(data) => <PollCard poll={data} />}
        </QueryState>

        {more.length ? (
          <section>
            <SectionHeader title={t('ui.readNext')} tone="ink" />
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {more.map((article) => (
                <li key={article.short_id} ref={reveal}>
                  <GridCard article={article} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PageContainer>
  );
}

export function TopicPage() {
  const { slug = '' } = useParams();
  const { t, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reveal = useReveal<HTMLLIElement>();
  // §3 — a topic reads differently district by district; the reader's edition
  // narrows it exactly as it narrows the home page.
  const district = useReaderPrefs((state) => state.edition);

  const topic = useQuery({
    queryKey: ['topic', slug, district],
    queryFn: () => epaperApi.fetchTopic(slug, district),
  });

  const meta = topic.data?.topic;
  const heading = meta ? s.text(meta.title_te, meta.title_en) : null;
  const title = heading?.text || slug.replaceAll('-', ' ');
  useDocumentTitle(title);

  return (
    <PageContainer className="py-7 md:py-10">
      <PageHeader
        eyebrow={t('page.topic')}
        icon={Hash}
        title={title}
        titleLang={heading?.lang}
        subtitle={L('ఈ అంశంపై మా కవరేజ్ మొత్తం', 'Everything we have published on this topic')}
        back={{ to: '/', label: t('page.home') }}
        actions={<FollowButton targetType="tag" slug={slug} />}
      />

      <div className="space-y-7 md:space-y-10">
        <QueryState
          query={topic}
          skeleton={<CardGridSkeleton />}
          isEmpty={(data) => data.articles.length === 0}
          empty={
            <EmptyState
              icon={Newspaper}
              title={t('state.emptySection')}
              action={
                <ButtonLink to="/" variant="secondary">
                  {t('page.home')}
                </ButtonLink>
              }
            />
          }
        >
          {(data) => (
            <section>
              <SectionHeader title={L('ఈ అంశంపై కథనాలు', 'Coverage')} tone="ink" />
              <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {data.articles.map((article) => (
                  <li key={article.short_id} ref={reveal}>
                    <GridCard article={article} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </QueryState>

        {/* §15 — renders nothing when the topic has no video. */}
        <VideoStrip category={slug} limit={6} />
      </div>
    </PageContainer>
  );
}
