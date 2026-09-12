import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { FlatList, RefreshControl, type ListRenderItem } from 'react-native';

import * as engagementApi from '@/api/engagement';
import type { ArticleCard } from '@/api/types';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Button } from '@/ui/Button';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';

/**
 * Saved articles (§12) — the library list shape shared with `following` and
 * `history`: own ScreenHeader, skeleton / error / empty through Feedback, a
 * ListFooter tail on the offset-paged list and pull-to-refresh.
 */
const keyOf = (article: ArticleCard) => article.short_id;
const renderItem: ListRenderItem<ArticleCard> = ({ item }) => <RowCard article={item} />;

export default function BookmarksScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();

  const feed = useInfiniteQuery({
    queryKey: ['bookmarks'],
    queryFn: ({ pageParam }) => engagementApi.fetchBookmarks(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
  const articles = feed.data?.pages.flatMap((p) => p.articles) ?? [];

  return (
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title: t('library.bookmarks') }} />
      <ScreenHeader title={t('library.bookmarks')} />

      {feed.isLoading ? (
        <SkeletonFeed lead={false} />
      ) : feed.isError && !feed.data ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState
          icon="bookmark"
          message={t('library.bookmarksEmpty')}
          action={<Button label={t('home.latest')} icon="newspaper" onPress={() => router.push('/')} />}
        />
      ) : (
        <FlatList
          data={articles}
          keyExtractor={keyOf}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
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
              onRefresh={() => feed.refetch()}
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
}));
