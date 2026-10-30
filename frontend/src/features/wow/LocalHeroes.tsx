import { useQuery } from '@tanstack/react-query';
import { Award, HeartHandshake } from 'lucide-react';

import { GridCard } from '@/components/article/ArticleCard';
import { NewsImage } from '@/components/media/NewsImage';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/Layout';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * The homepage's two hero surfaces (pitch §2, §5):
 *   - NominateCta: the always-visible "Nominate Your Local Hero" call.
 *   - FeaturedHeroes: four published hero stories, from Local Hero first and
 *     the older inspiration sections while that one fills up.
 */

const HERO_SOURCES = ['local-hero', 'real-heroes', 'zero-to-hero', 'inspiring'];

async function fetchHeroes(): Promise<{ slug: string; articles: ArticleCard[] }> {
  for (const slug of HERO_SOURCES) {
    try {
      const feed = await publicApi.fetchFeed({ category: slug, limit: 4 });
      if (feed.articles.length) return { slug, articles: feed.articles.slice(0, 4) };
    } catch {
      // Section not created yet — try the next one.
    }
  }
  return { slug: 'local-hero', articles: [] };
}

export function NominateCta({ compact = false }: { compact?: boolean }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  // The backdrop is a real local hero's photo — the same stories Featured Heroes shows.
  const heroes = useQuery({ queryKey: ['wow', 'featured-heroes'], queryFn: fetchHeroes, staleTime: 120_000 });
  const photo = heroes.data?.articles.find((a) => a.hero)?.hero ?? null;
  return (
    <section
      aria-labelledby="nominate-cta"
      className="relative isolate flex h-full min-h-[320px] flex-col justify-end gap-5 overflow-hidden rounded-2xl bg-brand-deep p-5 text-on-ink shadow-raised ring-2 ring-wow/60 md:p-6"
    >
      {photo ? (
        <div aria-hidden className="absolute inset-0 -z-20">
          <NewsImage media={photo} ratio="auto" radius="none" className="h-full w-full" sizes="(min-width: 1024px) 40vw, 100vw" />
        </div>
      ) : null}
      {/* Orange at the top fading into the deep WOW blue, so the copy reads on any photo. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-wow/55 via-brand-deep/75 to-brand-deep" />
      <div aria-hidden className="pointer-events-none absolute -bottom-10 -right-6 -z-10 text-on-ink/10">
        <Award size={compact ? 140 : 180} strokeWidth={1.25} />
      </div>
      <div className="space-y-2">
        <span className={cn(s.body, 'inline-flex items-center gap-1.5 rounded-pill bg-gradient-to-br from-wow to-wow-deep px-3 py-1 text-meta font-bold text-on-wow')}>
          <Icon icon={HeartHandshake} size="xs" />
          {te ? 'మీ లోకల్ హీరోని నామినేట్ చేయండి' : 'Nominate Your Local Hero'}
        </span>
        <h2 id="nominate-cta" lang="te" className="th text-headline-md font-bold text-on-ink md:text-headline-lg">
          మీ లోకల్ హీరోను ప్రపంచానికి పరిచయం చేయండి!
        </h2>
        <p className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui', 'max-w-prose text-on-ink/85')}>
          {te
            ? 'ఉపాధ్యాయులు, రైతులు, ఆవిష్కర్తలు, సామాజిక సేవకులు, విద్యార్థులు, గ్రామ వాలంటీర్లు — మార్పు తెస్తున్న వారి గురించి మాకు చెప్పండి.'
            : 'Teachers, farmers, innovators, social workers, students, village volunteers — tell us about the people making a difference.'}
        </p>
      </div>
      <div>
        <ButtonLink to="/nominate" size="lg" variant="wow" icon={Award}>
          {te ? 'ఇప్పుడే నామినేట్ చేయండి' : 'Nominate now'}
        </ButtonLink>
      </div>
    </section>
  );
}

export function FeaturedHeroes() {
  const { language } = useI18n();
  const te = language === 'te';
  const heroes = useQuery({ queryKey: ['wow', 'featured-heroes'], queryFn: fetchHeroes, staleTime: 120_000 });
  const data = heroes.data;
  if (!data?.articles.length) return null;

  return (
    <section aria-labelledby="featured-heroes">
      <SectionHeader
        title={<span id="featured-heroes">{te ? 'మన హీరోలు' : 'Featured Local Heroes'}</span>}
        to={`/section/${data.slug}`}
      />
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
    </section>
  );
}
