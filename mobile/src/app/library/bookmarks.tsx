import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList } from 'react-native';

import * as engagementApi from '@/api/engagement';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';

export default function BookmarksScreen() {
  const { t } = useI18n();
  const feed = useInfiniteQuery({
    queryKey: ['bookmarks'],
    queryFn: ({ pageParam }) => engagementApi.fetchBookmarks(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
  const articles = feed.data?.pages.flatMap((p) => p.articles) ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t('library.bookmarks') }} />
      {feed.isLoading ? <LoadingState /> : null}
      {feed.isError ? <ErrorState onRetry={() => feed.refetch()} /> : null}
      {feed.data ? (
        articles.length === 0 ? (
          <EmptyState message={t('library.bookmarksEmpty')} />
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
