import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import * as publicApi from '@/api/public';
import type { ArticleCard as ArticleCardType } from '@/api/types';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';
import { Chip, ChipRail } from '@/ui/Chip';
import { Divider } from '@/ui/Divider';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { T } from '@/ui/Text';

/**
 * Local feed (§1.4/§4): state → district → mandal rails; exact-location
 * stories rank above district-wide ones. The choice persists through `prefs`
 * and also drives the home edition, so picking a district here is the one
 * place a reader ever has to say where they are.
 */
const STAGGER_MAX = 6;
const PAGE = 20;

const keyOf = (article: ArticleCardType) => article.short_id;

/** One labelled single-select rail. */
function Picker({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <T variant="meta" color="muted" style={styles.label}>
        {label}
      </T>
      <ChipRail snap>{children}</ChipRail>
    </View>
  );
}

export default function LocalScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t, pick } = useI18n();
  const edition = usePrefs((s) => s.edition);
  const mandal = usePrefs((s) => s.mandal);
  const setEdition = usePrefs((s) => s.setEdition);
  const setMandal = usePrefs((s) => s.setMandal);
  const [stateCode, setStateCode] = useState('');

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const effectiveState = useMemo(() => {
    if (stateCode) return stateCode;
    return config.data?.districts.find((d) => d.slug === edition)?.state ?? 'AP';
  }, [stateCode, config.data, edition]);

  const districts = useMemo(
    () => (config.data?.districts ?? []).filter((d) => d.state === effectiveState),
    [config.data, effectiveState],
  );

  const mandals = useQuery({
    queryKey: ['mandals', edition],
    queryFn: () => publicApi.fetchDistrictMandals(edition!),
    enabled: Boolean(edition),
    staleTime: 3_600_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['local', edition, mandal],
    queryFn: ({ pageParam }) =>
      publicApi.fetchLocalFeed({
        district: edition!,
        mandal: mandal ?? undefined,
        offset: pageParam,
        limit: PAGE,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: Boolean(edition),
  });

  const articles = feed.data?.pages.flatMap((page) => page.articles) ?? [];
  const district = districts.find((d) => d.slug === edition);

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

      <View style={styles.pickers}>
        <Picker label={t('local.state')}>
          {(config.data?.states ?? []).map((s) => (
            <Chip
              key={s.code}
              role="radio"
              label={pick(s.name_te, s.name_en)}
              selected={effectiveState === s.code}
              // A mandal belongs to one district: keeping it across a change
              // would query a pair that cannot match, and no chip would look
              // selected.
              onPress={() => {
                setStateCode(s.code);
                setEdition(null);
                setMandal(null);
              }}
            />
          ))}
        </Picker>

        {districts.length ? (
          <Picker label={t('local.district')}>
            {districts.map((d) => (
              <Chip
                key={d.slug}
                role="radio"
                label={pick(d.name_te, d.name_en)}
                selected={edition === d.slug}
                onPress={() => {
                  setEdition(edition === d.slug ? null : d.slug);
                  setMandal(null);
                }}
              />
            ))}
          </Picker>
        ) : null}

        {edition && mandals.data?.length ? (
          <Picker label={t('local.mandal')}>
            <Chip role="radio" label={t('local.all')} selected={!mandal} onPress={() => setMandal(null)} />
            {mandals.data.map((m) => (
              <Chip
                key={m.slug}
                role="radio"
                label={pick(m.name_te, m.name_en)}
                selected={mandal === m.slug}
                onPress={() => setMandal(mandal === m.slug ? null : m.slug)}
              />
            ))}
          </Picker>
        ) : null}
      </View>
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

const useStyles = makeStyles((color) => ({
  pickers: { backgroundColor: color.paper, paddingBottom: space.md, gap: space.sm },
  picker: { gap: space.xs },
  label: { paddingHorizontal: space.lg },
  list: { paddingBottom: space.xl },
}));
