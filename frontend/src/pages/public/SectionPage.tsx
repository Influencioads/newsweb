import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Clock3, Newspaper } from 'lucide-react';

import { LeadCard, RowCard, SecondaryCard } from '@/components/article/ArticleCard';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { VideoStrip } from '@/components/video/VideoStrip';
import { FollowButton } from '@/features/engagement/components/FollowButton';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * One news section (§5): lead + two top stories, then the latest list, with
 * the section's video shelf above and a follow toggle in the header.
 */

const DESCRIPTIONS: Record<string, { te: string; en: string }> = {
  'andhra-pradesh': {
    te: 'ఆంధ్రప్రదేశ్‌లోని తాజా రాజకీయాలు, పాలన మరియు జిల్లాల వార్తలు',
    en: 'Politics, governance and district news from Andhra Pradesh',
  },
  telangana: {
    te: 'తెలంగాణ రాష్ట్రం మరియు జిల్లాల నుంచి తాజా సమాచారం',
    en: 'Latest developments from Telangana and its districts',
  },
  national: {
    te: 'దేశవ్యాప్తంగా ముఖ్యమైన వార్తలు మరియు విశ్లేషణ',
    en: 'Essential news and analysis from across India',
  },
  cinema: {
    te: 'సినిమా, ఓటీటీ, ప్రముఖులు మరియు వినోద వార్తలు',
    en: 'Cinema, streaming, celebrity and entertainment news',
  },
  sports: {
    te: 'క్రికెట్ మరియు ఇతర క్రీడల తాజా అప్‌డేట్లు',
    en: 'Latest cricket and sports updates, scores and stories',
  },
  business: {
    te: 'మార్కెట్లు, వ్యాపారం, టెక్నాలజీ మరియు వ్యక్తిగత ఆర్థికం',
    en: 'Markets, business, technology and personal finance',
  },
};

/**
 * Syndicated feeds can return the same story under a new ID. Keep the section
 * page visually clean by de-duplicating on the headline.
 */
function dedupe(articles: ArticleCard[] | undefined): ArticleCard[] {
  if (!articles) return [];
  return Array.from(
    new Map(
      articles.map((article) => [(article.title_en || article.title_te).trim().toLocaleLowerCase(), article]),
    ).values(),
  );
}

export default function SectionPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t, pick, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reveal = useReveal<HTMLDivElement>();

  const feed = useQuery({
    queryKey: ['public', 'feed', 'category', slug],
    queryFn: () => publicApi.fetchFeed({ category: slug, limit: 30 }),
    enabled: Boolean(slug),
  });

  const articles = dedupe(feed.data?.articles);
  // The category name is DB content: a Telugu-only name keeps lang="te" and the
  // Telugu face even on an English page.
  const cat = feed.data?.category;
  const heading = cat ? s.forText(cat.name_te, cat.name_en) : null;
  const title = cat ? pick(cat.name_te, cat.name_en) : '';
  const description = DESCRIPTIONS[slug]?.[language];
  useDocumentTitle(title);

  const [lead, ...rest] = articles;
  const topStories = rest.slice(0, 2);
  const latest = rest.slice(2);

  return (
    <PageContainer className="pb-10 pt-5 md:pt-7">
      <PageHeader
        eyebrow={L('వార్తల విభాగం', 'News section')}
        title={title || '…'}
        titleLang={heading?.lang}
        subtitle={description}
        back={{ to: '/', label: t('page.home') }}
        actions={
          <>
            <FollowButton targetType="category" slug={slug} />
            {articles.length ? (
              <Badge tone="muted" icon={Clock3} lang={language}>
                {L(`${articles.length} తాజా కథనాలు`, `${articles.length} latest stories`)}
              </Badge>
            ) : null}
          </>
        }
      />

      <div className="space-y-7 md:space-y-10">
        {/* §15 — videos for this section (renders only when the category has any). */}
        <VideoStrip category={slug} limit={4} />

        <QueryState
          query={feed}
          skeleton={
            <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr] lg:gap-8">
              <SkeletonCard variant="lead" />
              <div className="flex flex-col gap-4">
                <SkeletonCard variant="row" />
                <SkeletonCard variant="row" />
                <SkeletonCard variant="row" />
              </div>
            </div>
          }
          isEmpty={() => !lead}
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
          {() => (
            <div className="space-y-7 md:space-y-10">
              <section
                aria-label={L('ముఖ్య కథనాలు', 'Top stories')}
                className="grid gap-6 border-b border-rule pb-7 lg:grid-cols-[1.45fr_1fr] lg:gap-8"
              >
                {lead ? <LeadCard article={lead} /> : null}
                <div className="flex flex-col gap-4 lg:border-l lg:border-rule lg:pl-8">
                  <SectionHeader title={L('ముఖ్య కథనాలు', 'Top stories')} level={3} />
                  {topStories.map((article) => (
                    <SecondaryCard key={article.short_id} article={article} />
                  ))}
                </div>
              </section>

              {latest.length ? (
                <section>
                  <SectionHeader title={L('తాజా వార్తలు', 'Latest news')} tone="ink" />
                  <div className="grid gap-x-8 lg:grid-cols-2">
                    {latest.map((article) => (
                      <div key={article.short_id} ref={reveal}>
                        <RowCard article={article} />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </QueryState>
      </div>
    </PageContainer>
  );
}
