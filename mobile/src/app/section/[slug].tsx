import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList } from 'react-native';

import * as publicApi from '@/api/public';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';

/** Category feed with cursor pagination — `/public/articles?category=` (§13). */
export default function SectionScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { pick } = useI18n();

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

  return (
    <>
      <Stack.Screen
        options={{ title: category ? pick(category.name_te, category.name_en) : '' }}
      />
      {feed.isLoading ? <LoadingState /> : null}
      {feed.isError ? <ErrorState onRetry={() => feed.refetch()} /> : null}
      {feed.data ? (
        articles.length === 0 ? (
          <EmptyState />
        ) : (
          <FlatList
            data={articles}
            keyExtractor={(item) => item.short_id}
            renderItem={({ item }) => <RowCard article={item} />}
            onEndReached={() => {
              if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
            }}
            onEndReachedThreshold={0.6}
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => feed.refetch()}
          />
        )
      ) : null}
    </>
  );
}
