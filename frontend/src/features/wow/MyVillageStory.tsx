import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Home as HomeIcon, PenLine, Trees } from 'lucide-react';

import { GridCard } from '@/components/article/ArticleCard';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/Layout';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * My Village Story (మై విలేజ్ స్టోరీ): the home page's village shelf, straight
 * under WOW Radio. Four stories from the my-village-story section, falling back
 * to the local sections while that one fills up, plus a call to send in your
 * own village's story (the reader submission form).
 */

const VILLAGE_SOURCES = ['my-village-story', 'local-hero', 'districts', 'andhra-pradesh', 'telangana'];

async function fetchVillageStories(): Promise<{ slug: string; articles: ArticleCard[] }> {
  for (const slug of VILLAGE_SOURCES) {
    try {
      const feed = await publicApi.fetchFeed({ category: slug, limit: 4 });
      if (feed.articles.length) return { slug, articles: feed.articles.slice(0, 4) };
    } catch {
      // Section not created yet — try the next one.
    }
  }
  return { slug: 'my-village-story', articles: [] };
}

export function MyVillageStory() {
  const { language, t } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const stories = useQuery({ queryKey: ['wow', 'my-village-story'], queryFn: fetchVillageStories, staleTime: 120_000 });
  const data = stories.data;

  return (
    <section
      aria-labelledby="my-village-story"
      className="relative overflow-hidden rounded-2xl border border-hero/30 bg-hero-tint p-4 md:p-6"
    >
      <div aria-hidden className="pointer-events-none absolute -right-6 -top-6 text-hero/10">
        <Trees size={180} strokeWidth={1.25} />
      </div>

      <div className="relative mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <span
            className={cn(
              s.body,
              'inline-flex items-center gap-1.5 rounded-pill bg-hero px-3 py-1 text-meta font-bold text-on-ink',
            )}
          >
            <Icon icon={HomeIcon} size="xs" />
            {te ? 'మన ఊరు · మన కథ' : 'Our village · our story'}
          </span>
          <SectionHeader
            className="!mb-0"
            title={<span id="my-village-story">{te ? 'మై విలేజ్ స్టోరీ' : 'My Village Story'}</span>}
          />
          <p className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui', 'max-w-prose text-ink-soft')}>
            {te
              ? 'మన ఊళ్ల సంప్రదాయాలు, మార్పులు, అక్కడి మనుషుల స్ఫూర్తి కథలు.'
              : 'Traditions, change and the inspiring people of our villages.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.articles.length ? (
            <ButtonLink to={`/section/${data.slug}`} variant="secondary" size="md" iconRight={ChevronRight}>
              {t('home.seeAll')}
            </ButtonLink>
          ) : null}
          <ButtonLink to="/submit" variant="hero" size="md" icon={PenLine}>
            {te ? 'మీ ఊరి కథ పంపండి' : 'Share your village story'}
          </ButtonLink>
        </div>
      </div>

      {data?.articles.length ? (
        <div
          className={cn(
            'relative grid grid-cols-1 gap-4 md:grid-cols-2',
            data.articles.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
          )}
        >
          {data.articles.map((article) => (
            <GridCard key={article.short_id} article={article} />
          ))}
        </div>
      ) : stories.isPending ? null : (
        <p className={cn(s.body, 'relative text-ui text-ink-soft')}>
          {te ? 'త్వరలో మీ ఊరి కథలు ఇక్కడ.' : 'Village stories are coming soon.'}
        </p>
      )}
    </section>
  );
}
