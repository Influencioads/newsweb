import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import * as engagementApi from '@/api/engagement';
import type { ArticleCard } from '@/api/types';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { FollowChip } from '@/components/FollowChip';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Button } from '@/ui/Button';
import { ChipRail } from '@/ui/Chip';
import { Divider } from '@/ui/Divider';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';

/**
 * Following (§12): the reader's follow chips over the merged feed of
 * everything they follow. Same list shape as `bookmarks` / `history`.
 */
const keyOf = (article: ArticleCard) => article.short_id;
const renderItem: ListRenderItem<ArticleCard> = ({ item }) => <RowCard article={item} />;

export default function FollowingScreen() {
  const styles = useStyles();
  const color = useColors();
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
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title: t('library.following') }} />
      <ScreenHeader title={t('library.following')} showRule={!follows.data?.length} />

      {follows.isError ? (
        <ErrorState error={follows.error} fill={false} onRetry={() => void follows.refetch()} />
      ) : follows.data?.length ? (
        <>
          <View style={styles.chipBar}>
            <ChipRail>
              {follows.data.map((f) => (
                <FollowChip
                  key={`${f.target_type}:${f.slug}`}
                  targetType={f.target_type}
                  slug={f.slug}
                  name={pick(f.name_te, f.name_en)}
                />
              ))}
            </ChipRail>
          </View>
          <Divider />
        </>
      ) : null}

      {feed.isLoading ? (
        <SkeletonFeed lead={false} />
      ) : feed.isError && !feed.data ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState
          icon="users"
          message={t('library.followingEmpty')}
          action={<Button label={t('ui.search')} icon="search" onPress={() => router.push('/search')} />}
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

const useStyles = makeStyles((color) => ({
  chipBar: { backgroundColor: color.paper, paddingVertical: space.sm },
  list: { paddingBottom: space.xl },
}));
