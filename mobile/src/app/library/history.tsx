import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import * as engagementApi from '@/api/engagement';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { timeAgo, useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';

export default function HistoryScreen() {
  const { t, language } = useI18n();
  const feed = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => engagementApi.fetchHistory(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t('library.history') }} />
      {feed.isLoading ? <LoadingState /> : null}
      {feed.isError ? <ErrorState onRetry={() => feed.refetch()} /> : null}
      {feed.data ? (
        items.length === 0 ? (
          <EmptyState message={t('library.historyEmpty')} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.article.short_id}
            renderItem={({ item }) => (
              <View>
                <RowCard article={item.article} />
                <View style={styles.progressRow}>
                  <View style={styles.track}>
                    <View
                      style={[styles.fill, { width: `${Math.max(item.max_scroll_pct, 2)}%` }]}
                    />
                  </View>
                  <Text style={styles.meta}>
                    {item.max_scroll_pct}% · {timeAgo(item.last_read_at, language)}
                  </Text>
                </View>
              </View>
            )}
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

const styles = StyleSheet.create({
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: color.paper,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
    marginTop: -1,
  },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: color.rule, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: color.brand },
  meta: { fontFamily: font.telugu, fontSize: 10.5, lineHeight: 16, color: color.mutedLight },
});
