import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import * as publicApi from '@/api/public';
import type { ArticleCard } from '@/api/types';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';
import { T } from '@/ui/Text';

/** Trending (§8) with rank numbers, paged by offset via next_cursor. */
const keyOf = (article: ArticleCard) => article.short_id;
/** The podium: 1–3 carry the brand rank, the rest a quiet rule-coloured one. */
const PODIUM = 3;

export default function TrendingScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();

  const feed = useInfiniteQuery({
    queryKey: ['trending-screen'],
    queryFn: ({ pageParam }) =>
      publicApi.fetchTrending({ offset: pageParam || undefined, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_cursor ? Number(last.next_cursor) : undefined),
  });
  const articles = feed.data?.pages.flatMap((p) => p.articles) ?? [];

  const renderItem: ListRenderItem<ArticleCard> = ({ item, index }) => (
    <View style={styles.row}>
      <T
        variant="headlineLg"
        weight="heavy"
        lang="en"
        align="right"
        color={index < PODIUM ? 'brand' : 'ruleStrong'}
        numberOfLines={1}
        style={styles.rank}
      >
        {String(index + 1)}
      </T>
      <View style={styles.card}>
        <RowCard article={item} />
      </View>
    </View>
  );

  return (
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title: t('trending.title') }} />
      <ScreenHeader title={t('trending.title')} />

      {feed.isLoading ? (
        <SkeletonFeed lead={false} />
      ) : feed.isError && !feed.data ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState icon="zap" />
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
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: space.sm },
  // Sits against the card's own top margin + padding so the figure lines up
  // with the headline rather than the card's top edge.
  // minWidth, not width: rank 100 and the 1.3 OS multiplier both need the room.
  rank: { minWidth: 40, paddingTop: space.xl },
  card: { flex: 1, minWidth: 0 },
}));
