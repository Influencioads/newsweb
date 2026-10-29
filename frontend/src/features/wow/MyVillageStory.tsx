import { useQuery } from '@tanstack/react-query';

import { GridCard } from '@/components/article/ArticleCard';
import { SectionHeader } from '@/components/ui/Layout';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * My Village Story (మై విలేజ్ స్టోరీ): the home page's village shelf, straight
 * under WOW Radio. Four stories from the my-village-story section, falling back
 * to the local sections while that one fills up.
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
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const stories = useQuery({ queryKey: ['wow', 'my-village-story'], queryFn: fetchVillageStories, staleTime: 120_000 });
  const data = stories.data;

  return (
    <section aria-labelledby="my-village-story">
      <SectionHeader
        className="!mb-1"
        title={<span id="my-village-story">{te ? 'మై విలేజ్ స్టోరీ' : 'My Village Story'}</span>}
        to={data?.articles.length ? `/section/${data.slug}` : undefined}
      />
      <p className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui', 'mb-4 max-w-prose text-ink-soft')}>
        {te
          ? 'మన ఊళ్ల సంప్రదాయాలు, మార్పులు, అక్కడి మనుషుల స్ఫూర్తి కథలు.'
          : 'Traditions, change and the inspiring people of our villages.'}
      </p>

      {data?.articles.length ? (
        <div
          className={cn(
            'grid grid-cols-1 gap-4 md:grid-cols-2',
            data.articles.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
          )}
        >
          {data.articles.map((article) => (
            <GridCard key={article.short_id} article={article} />
          ))}
        </div>
      ) : stories.isPending ? null : (
        <p className={cn(s.body, 'text-ui text-ink-soft')}>
          {te ? 'త్వరలో మీ ఊరి కథలు ఇక్కడ.' : 'Village stories are coming soon.'}
        </p>
      )}
    </section>
  );
}
