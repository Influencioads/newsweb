import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';

import * as publicApi from '@/api/public';
import type { ArticleCard } from '@/api/types';
import { RowCard } from '@/components/ArticleCard';
import { SectionHeader } from '@/components/SectionHeader';
import { useI18n } from '@/lib/i18n';

/**
 * Our Heroes — the website's FeaturedHeroes (frontend/src/features/wow/
 * LocalHeroes.tsx): four hero stories from Local Hero first, falling back to
 * the older inspiration sections while that one fills up. Renders nothing
 * until one of them has stories.
 */
const HERO_SOURCES = ['local-hero', 'real-heroes', 'zero-to-hero', 'inspiring'] as const;
const HERO_COUNT = 4;

async function fetchHeroes(): Promise<{ slug: string; articles: ArticleCard[] }> {
  for (const slug of HERO_SOURCES) {
    try {
      const feed = await publicApi.fetchFeed({ category: slug, limit: HERO_COUNT });
      if (feed.articles.length) return { slug, articles: feed.articles.slice(0, HERO_COUNT) };
    } catch {
      // Section not created yet — try the next one.
    }
  }
  return { slug: HERO_SOURCES[0], articles: [] };
}

export function FeaturedHeroes() {
  const { pick } = useI18n();
  const heroes = useQuery({ queryKey: ['wow', 'featured-heroes'], queryFn: fetchHeroes, staleTime: 120_000 });
  const data = heroes.data;
  if (!data?.articles.length) return null;

  return (
    <View>
      <SectionHeader
        title={pick('మన హీరోలు', 'Our Heroes')}
        onSeeAll={() => router.push({ pathname: '/section/[slug]', params: { slug: data.slug } })}
      />
      {data.articles.map((article, index) => (
        <RowCard key={article.short_id} article={article} index={index} />
      ))}
    </View>
  );
}
