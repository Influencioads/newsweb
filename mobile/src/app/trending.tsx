import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import * as publicApi from '@/api/public';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';

/** Trending (§8) with rank numbers, paged by offset via next_cursor. */
export default function TrendingScreen() {
  const styles = useStyles();
  const { t } = useI18n();
  const feed = useInfiniteQuery({
    queryKey: ['trending-screen'],
    queryFn: ({ pageParam }) =>
      publicApi.fetchTrending({ offset: pageParam || undefined, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_cursor ? Number(last.next_cursor) : undefined),
  });
  const articles = feed.data?.pages.flatMap((p) => p.articles) ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t('trending.title') }} />
      {feed.isLoading ? <LoadingState /> : null}
      {feed.isError ? <ErrorState onRetry={() => feed.refetch()} /> : null}
      {feed.data ? (
        articles.length === 0 ? (
          <EmptyState />
        ) : (
          <FlatList
            data={articles}
            keyExtractor={(item) => item.short_id}
            renderItem={({ item, index }) => (
              <View style={styles.row}>
                <Text style={[styles.rank, index < 3 && styles.rankTop]}>{index + 1}</Text>
                <View style={styles.card}>
                  <RowCard article={item} />
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

const useStyles = makeStyles((color) => ({
  row: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: color.paper },
  rank: {
    width: 34,
    textAlign: 'right',
    paddingTop: 14,
    fontFamily: font.headlineHeavy,
    fontSize: 20,
    color: color.ruleStrong,
  },
  rankTop: { color: color.brand },
  card: { flex: 1, minWidth: 0 },
}));
