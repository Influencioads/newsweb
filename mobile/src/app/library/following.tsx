import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';

import * as engagementApi from '@/api/engagement';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { FollowChip } from '@/components/FollowChip';
import { useI18n } from '@/lib/i18n';
import { color } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';

export default function FollowingScreen() {
  const styles = useStyles();
  const { t, pick } = useI18n();
  const follows = useQuery({ queryKey: ['my-follows'], queryFn: engagementApi.fetchMyFollows });
  const feed = useInfiniteQuery({
    queryKey: ['following-feed'],
    queryFn: ({ pageParam }) => engagementApi.fetchFollowingFeed(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
  const articles = feed.data?.pages.flatMap((p) => p.articles) ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t('library.following') }} />
      {follows.data?.length ? (
        <View style={styles.chipBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {follows.data.map((f) => (
              <FollowChip
                key={`${f.target_type}:${f.slug}`}
                targetType={f.target_type}
                slug={f.slug}
                name={pick(f.name_te, f.name_en)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      {feed.isLoading ? <LoadingState /> : null}
      {feed.isError ? <ErrorState onRetry={() => feed.refetch()} /> : null}
      {feed.data ? (
        articles.length === 0 ? (
          <EmptyState message={t('library.followingEmpty')} />
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

const useStyles = makeStyles((color) => ({
  chipBar: {
    backgroundColor: color.paper,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
    paddingVertical: 8,
  },
  chipRow: { paddingHorizontal: 12, gap: 6 },
}));
