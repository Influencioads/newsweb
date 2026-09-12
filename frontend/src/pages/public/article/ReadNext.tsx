import { useQuery } from '@tanstack/react-query';

import { GridCard, SecondaryCard } from '@/components/article/ArticleCard';
import { SectionHeader } from '@/components/ui/Layout';
import { VideoStrip } from '@/components/video/VideoStrip';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import type { ArticleCard as Item, ArticleDetail } from '@/types/public';
import { useReveal } from '@/utils/motion';

/**
 * "Read next" — the one tail rail.
 *
 * Replaces the four near-identical rails the page used to end with (related,
 * more-from-category, more-from-district, videos). The desk's own `related`
 * list leads; the category feed tops it up when the desk picked fewer than
 * four. One recommendation is given real weight, three follow in a grid, and
 * the §15 video shelf closes the page.
 */
export function ReadNext({ article }: { article: ArticleDetail }) {
  const { t } = useI18n();
  // One observer for the whole rail, so the 40ms stagger actually batches.
  const reveal = useReveal<HTMLDivElement>();
  const slug = article.category?.slug;

  const feed = useQuery({
    queryKey: ['public', 'more-from', 'category', slug],
    queryFn: () => publicApi.fetchFeed({ category: slug, limit: 8 }),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });

  const pool: Item[] = [];
  for (const candidate of [...article.related, ...(feed.data?.articles ?? [])]) {
    if (candidate.short_id === article.short_id) continue;
    if (pool.some((a) => a.short_id === candidate.short_id)) continue;
    pool.push(candidate);
    if (pool.length === 4) break;
  }

  const lead = pool[0];
  const grid = pool.slice(1);

  return (
    <div className="space-y-7 md:space-y-10">
      {lead ? (
        <section>
          <SectionHeader title={t('ui.readNext')} />
          <div className="space-y-4">
            <div ref={reveal}>
              <SecondaryCard article={lead} />
            </div>
            {grid.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {grid.map((a) => (
                  <div key={a.short_id} ref={reveal} className="min-w-0">
                    <GridCard article={a} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <VideoStrip category={slug} limit={4} />
    </div>
  );
}
