import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';

import { NewsImage } from '@/components/media/NewsImage';
import { ButtonLink } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Layout';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * My Village (మై విలేజ్): the home page's village shelf, straight
 * under WOW Radio. Two stories from the my-village-story section, falling back
 * to the local sections while that one fills up.
 */

const VILLAGE_SOURCES = ['my-village-story', 'local-hero', 'districts', 'andhra-pradesh', 'telangana'];

/** Two stories: my-village-story first, topped up from the local sections. */
const SHOWN = 2;

async function fetchVillageStories(): Promise<{ slug: string; articles: ArticleCard[] }> {
  const articles: ArticleCard[] = [];
  let slug: string | null = null;
  for (const source of VILLAGE_SOURCES) {
    if (articles.length >= SHOWN) break;
    try {
      const feed = await publicApi.fetchFeed({ category: source, limit: SHOWN });
      for (const a of feed.articles) {
        if (articles.length < SHOWN && !articles.some((x) => x.short_id === a.short_id)) articles.push(a);
      }
      if (feed.articles.length && !slug) slug = source;
    } catch {
      // Section not created yet — try the next one.
    }
  }
  return { slug: slug ?? 'my-village-story', articles };
}

/** Each card's wash: a colour at the top fading into the deep WOW blue. */
const TINTS = [
  'from-wow/45 via-brand-deep/55 to-brand-deep',
  'from-hero/45 via-brand-deep/55 to-brand-deep',
] as const;

/** A full-bleed photo card: tinted overlay, big headline, standfirst, button. */
function VillageCard({ article, tint }: { article: ArticleCard; tint: string }) {
  const { language } = useI18n();
  const s = useScript();
  const head = s.text(article.title_te, article.title_en);
  return (
    <article className="group relative isolate flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-2xl text-on-ink shadow-raised md:aspect-[16/11]">
      <div aria-hidden className="absolute inset-0 -z-20 transition-transform duration-slow group-hover:scale-105 motion-reduce:transform-none">
        <NewsImage media={article.hero} ratio="auto" radius="none" className="h-full w-full" sizes="(min-width: 768px) 50vw, 100vw" />
      </div>
      <div aria-hidden className={cn('absolute inset-0 -z-10 bg-gradient-to-b', tint)} />

      <div className="space-y-3 p-5 md:p-7">
        <h3 lang={head.lang} className={cn(head.head, 'te-clamp-2 text-headline-md font-bold md:text-headline-lg')}>
          <Link to={article.url} className="hover:underline hover:decoration-wow hover:underline-offset-8">
            {head.text}
          </Link>
        </h3>
        {article.summary_te ? (
          <p lang="te" className="te te-clamp-3 text-te-body-xs text-on-ink/85">
            {article.summary_te}
          </p>
        ) : null}
        <ButtonLink to={article.url} variant="wow" size="md" iconRight={ArrowRight} className="mt-1">
          {language === 'te' ? 'కథ చదవండి' : 'Read the story'}
        </ButtonLink>
      </div>
    </article>
  );
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
        title={<span id="my-village-story">{te ? 'మై విలేజ్' : 'My Village'}</span>}
        to={data?.articles.length ? `/section/${data.slug}` : undefined}
      />

      {data?.articles.length ? (
        // Two photo cards: one per row on phones, side by side from tablets up.
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
          {data.articles.map((article, i) => (
            <VillageCard key={article.short_id} article={article} tint={TINTS[i % TINTS.length]!} />
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
