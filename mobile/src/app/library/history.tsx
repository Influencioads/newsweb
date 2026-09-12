import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import * as engagementApi from '@/api/engagement';
import type { HistoryItem } from '@/api/engagement';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { timeAgo, useI18n } from '@/lib/i18n';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Button } from '@/ui/Button';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';
import { T } from '@/ui/Text';

/**
 * Reading history (§12): every article the reader opened with how far they
 * got, so an interrupted read is easy to resume. Same list shape as
 * `bookmarks` / `following`, plus the per-row progress rule.
 */
const keyOf = (item: HistoryItem) => item.article.short_id;

/** Row = the article card with the reader's progress under it. */
function HistoryRow({ item }: { item: HistoryItem }) {
  const styles = useStyles();
  const { language } = useI18n();
  // 2% keeps a just-opened article visible as a tick rather than nothing.
  const width = `${Math.max(item.max_scroll_pct, 2)}%` as const;
  return (
    <View>
      <RowCard article={item.article} />
      <View style={styles.progressRow}>
        <View
          style={styles.track}
          aria-hidden
        >
          <View style={[styles.fill, { width }]} />
        </View>
        <T variant="meta" color="muted" numberOfLines={1}>
          {`${item.max_scroll_pct}% · ${timeAgo(item.last_read_at, language)}`}
        </T>
      </View>
    </View>
  );
}

const renderItem: ListRenderItem<HistoryItem> = ({ item }) => <HistoryRow item={item} />;

export default function HistoryScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();

  const feed = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => engagementApi.fetchHistory(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title: t('library.history') }} />
      <ScreenHeader title={t('library.history')} />

      {feed.isLoading ? (
        <SkeletonFeed lead={false} />
      ) : feed.isError && !feed.data ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="history"
          message={t('library.historyEmpty')}
          action={<Button label={t('home.latest')} icon="newspaper" onPress={() => router.push('/')} />}
        />
      ) : (
        <FlatList
          data={items}
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

const useStyles = makeStyles((color) => ({
  list: { paddingBottom: space.xl },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    paddingTop: space.sm,
  },
  track: { flex: 1, height: 3, borderRadius: radius.pill, backgroundColor: color.rule },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: color.brand },
}));
