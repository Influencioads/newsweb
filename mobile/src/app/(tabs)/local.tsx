import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FlatList, RefreshControl, type ListRenderItem } from 'react-native';

import * as publicApi from '@/api/public';
import type { ArticleCard as ArticleCardType } from '@/api/types';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { LocationRails } from '@/components/LocationSheet';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';
import { Divider } from '@/ui/Divider';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';

/**
 * Local feed (§1.4/§4): the shared state → district → mandal → village
 * cascade over the feed it selects. Exact-location stories rank above
 * district-wide ones.
 *
 * The rails used to be written out here, one level shallower — the village
 * level existed on the server and in the types but had no UI anywhere. They
 * now come from `LocationRails`, which the profile screen and the article bar
 * mount too, so there is one picker to fix rather than three to keep in step.
 */
const STAGGER_MAX = 6;
const PAGE = 20;

const keyOf = (article: ArticleCardType) => article.short_id;

export default function LocalScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t, pick } = useI18n();
  const edition = usePrefs((s) => s.edition);
  const mandal = usePrefs((s) => s.mandal);
  const locality = usePrefs((s) => s.locality);

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['local', edition, mandal, locality],
    queryFn: ({ pageParam }) =>
      publicApi.fetchLocalFeed({
        district: edition!,
        mandal: mandal ?? undefined,
        locality: locality ?? undefined,
        offset: pageParam,
        limit: PAGE,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: Boolean(edition),
  });

  const articles = feed.data?.pages.flatMap((page) => page.articles) ?? [];
  const district = (config.data?.districts ?? []).find((d) => d.slug === edition);

  const renderItem: ListRenderItem<ArticleCardType> = ({ item, index }) => (
    <RowCard article={item} index={index < STAGGER_MAX ? index : undefined} />
  );

  return (
    <Screen>
      <ScreenHeader
        title={t('local.title')}
        subtitle={district ? pick(district.name_te, district.name_en) : undefined}
        showRule={false}
      />

      <LocationRails levels="locality" />
      <Divider />

      {config.isError && !config.data ? (
        <ErrorState error={config.error} onRetry={() => config.refetch()} />
      ) : !edition ? (
        config.isLoading ? (
          <LoadingState variant="list" rows={4} />
        ) : (
          <EmptyState icon="mapPin" message={t('local.chooseDistrict')} />
        )
      ) : feed.isLoading ? (
        <LoadingState variant="list" />
      ) : feed.isError && !feed.data ? (
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={articles}
          keyExtractor={keyOf}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            <ListFooter
              loading={feed.isFetchingNextPage}
              end={!feed.hasNextPage}
              error={feed.isError}
              onRetry={() => void feed.fetchNextPage()}
            />
          }
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
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
