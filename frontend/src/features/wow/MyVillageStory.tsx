import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';

import { NewsImage } from '@/components/media/NewsImage';
import { ButtonLink } from '@/components/ui/Button';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';

import { MY_VILLAGE_IMAGE, MY_VILLAGE_INTRO, MY_VILLAGE_PATH, MY_VILLAGE_TITLE } from './myVillage';

/**
 * My Village (మై విలేజ్): the home page's village shelf, straight under WOW
 * Radio — a banner with the "మన ఊరు.. మన వైభవం.!" introduction and a Click
 * to know more button to /my-village on the left and the village picture
 * (public/my-village.webp) on the right, then two stories from the my-village-story section
 * (topped up from the local sections while that one fills up).
 */

const VILLAGE_SOURCES = ['my-village-story', 'local-hero', 'districts', 'andhra-pradesh', 'telangana'];

/** Stories on the home shelf; the /my-village page asks for more. */
const SHOWN = 2;

/** `count` stories: my-village-story first, topped up from the local sections. */
export async function fetchVillageStories(count = SHOWN): Promise<{ slug: string; articles: ArticleCard[] }> {
  const articles: ArticleCard[] = [];
  let slug: string | null = null;
  for (const source of VILLAGE_SOURCES) {
    if (articles.length >= count) break;
    try {
      const feed = await publicApi.fetchFeed({ category: source, limit: count });
      for (const a of feed.articles) {
        if (articles.length < count && !articles.some((x) => x.short_id === a.short_id)) articles.push(a);
      }
      if (feed.articles.length && !slug) slug = source;
    } catch {
      // Section not created yet — try the next one.
    }
  }
  return { slug: slug ?? 'my-village-story', articles };
}

/** Each card's wash: a colour at the top fading into the deep WOW blue. */
export const TINTS = [
  'from-wow/45 via-brand-deep/55 to-brand-deep',
  'from-hero/45 via-brand-deep/55 to-brand-deep',
] as const;

/** A full-bleed photo card: tinted overlay, big headline, standfirst, button. */
export function VillageCard({ article, tint }: { article: ArticleCard; tint: string }) {
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
  const stories = useQuery({
    queryKey: ['wow', 'my-village-story'],
    queryFn: () => fetchVillageStories(),
    staleTime: 120_000,
  });
  const data = stories.data;

  return (
    <section aria-labelledby="my-village-story">
      {/* The section's own banner: the introduction on the left (deep WOW blue
          with the orange glow), the village-at-sunset picture on the right.
          On a phone the picture comes first and the text under it. */}
      <div className="relative isolate mb-5 grid overflow-hidden rounded-2xl bg-brand-deep text-on-ink shadow-raised md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-16 -z-10 h-64 w-64 rounded-full bg-wow/25 blur-3xl" />
        <div className="order-2 flex flex-col justify-center gap-3 p-5 md:order-1 md:p-10">
          <h2 id="my-village-story" lang={s.language} className={cn(s.head, 'text-headline-sm font-bold md:text-headline-ml')}>
            {te ? MY_VILLAGE_TITLE.te : MY_VILLAGE_TITLE.en}
          </h2>
          {(te ? MY_VILLAGE_INTRO.te : MY_VILLAGE_INTRO.en).map((para) => (
            <p key={para} className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui', 'text-on-ink/85')}>
              {para}
            </p>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <ButtonLink to={MY_VILLAGE_PATH} variant="wow" size="md" iconRight={ArrowRight}>
              {te ? 'మరింత తెలుసుకోండి' : 'Click to know more'}
            </ButtonLink>
            {data?.articles.length ? (
              <ButtonLink to={`/section/${data.slug}`} variant="inverse" size="md">
                {te ? 'అన్నీ చూడండి' : 'See all'}
              </ButtonLink>
            ) : null}
          </div>
        </div>
        <div className="relative order-1 aspect-[16/10] md:order-2 md:aspect-auto md:min-h-[380px]">
          <img
            src={MY_VILLAGE_IMAGE}
            alt={te ? 'సూర్యాస్తమయంలో ఓ గ్రామం, ఆలయం' : 'A village and its temple at sunset'}
            width={1024}
            height={1536}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover object-[center_45%]"
          />
        </div>
      </div>

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
