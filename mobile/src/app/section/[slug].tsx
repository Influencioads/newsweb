import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import * as publicApi from '@/api/public';
import type { ArticleCard } from '@/api/types';
import { LeadCard, RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { useSiteConfig } from '@/lib/siteContent';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';
import { T } from '@/ui/Text';

/** Category feed with cursor pagination — `/public/articles?category=` (§13). */
const keyOf = (article: ArticleCard) => article.short_id;

export default function SectionScreen() {
  const styles = useStyles();
  const color = useColors();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, pick } = useI18n();

  const feed = useInfiniteQuery({
    queryKey: ['section', slug],
    queryFn: ({ pageParam }) =>
      publicApi.fetchFeed({ category: slug, cursor: pageParam || undefined, limit: 20 }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(slug),
  });

  const articles = feed.data?.pages.flatMap((page) => page.articles) ?? [];
  const category = feed.data?.pages[0]?.category ?? null;
  // The section name only exists once the first page lands; until then the
  // navigator's generic title stands in rather than an empty bar.
  const title = category ? pick(category.name_te, category.name_en) : t('screen.section');
  // The WOW category's one line, as the desk set it on the CMS Taxonomy page.
  const card = useSiteConfig().data?.categories.find((c) => c.slug === slug);
  const tagline = card ? pick(card.tagline_te ?? '', card.tagline_en ?? card.tagline_te ?? '') : '';

  // The first story leads the section the way the web section page does.
  const renderItem: ListRenderItem<ArticleCard> = ({ item, index }) =>
    index === 0 ? <LeadCard article={item} /> : <RowCard article={item} />;

  return (
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title }} />
      <ScreenHeader title={title} />

      {feed.isLoading ? (
        <SkeletonFeed />
      ) : feed.isError && !feed.data ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState icon="newspaper" />
      ) : (
        <FlatList
          data={articles}
          keyExtractor={keyOf}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            // The website's section heading: the "News section" label, the name, its one line.
            <View style={styles.intro}>
              <T variant="meta" weight="semibold" color="brand">
                {pick('వార్తల విభాగం', 'News section')}
              </T>
              <T variant="headlineLg" weight="bold" accessibilityRole="header">
                {title}
              </T>
              {tagline ? (
                <T variant="bodySmall" color="inkSoft">
                  {tagline}
                </T>
              ) : null}
            </View>
          }
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            <ListFooter
              loading={feed.isFetchingNextPage}
              end={!feed.hasNextPage}
              error={feed.isError}
              onRetry={() => void feed.fetchNextPage()}
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching && !feed.isFetchingNextPage}
              onRefresh={() => void feed.refetch()}
              tintColor={color.brand}
              colors={[color.brand]}
              progressBackgroundColor={color.surface}
            />
          }
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  list: { paddingBottom: space.xl },
  intro: { gap: space.xs, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
}));
