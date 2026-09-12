import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import * as publicApi from '@/api/public';
import type { ArticleCard as ArticleCardType } from '@/api/types';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { IconButton } from '@/ui/Button';
import { Chip, ChipRail } from '@/ui/Chip';
import { Divider } from '@/ui/Divider';
import { Input } from '@/ui/Input';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { T } from '@/ui/Text';

/**
 * Search (§10) — full-text with offset paging.
 *
 * The box searches as the reader types (debounced, so a Telugu word being
 * composed does not fire a request per keystroke); Return searches at once.
 * Below two characters the screen shows the ask plus the reader's recent
 * searches, falling back to what everyone else is searching for.
 */
const MIN_CHARS = 2;
const DEBOUNCE_MS = 320;
const STAGGER_MAX = 6;
const PAGE = 20;

const keyOf = (article: ArticleCardType) => article.short_id;

export default function SearchScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');

  // Debounce the typed box into the query that actually hits the API.
  useEffect(() => {
    const q = value.trim();
    const id = setTimeout(() => setQuery(q.length >= MIN_CHARS ? q : ''), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [value]);

  const meta = useQuery({
    queryKey: ['search-meta'],
    queryFn: publicApi.fetchSearchMeta,
    staleTime: 300_000,
  });

  const results = useInfiniteQuery({
    queryKey: ['search', query],
    queryFn: ({ pageParam }) => publicApi.fetchSearch({ q: query, offset: pageParam, limit: PAGE }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: query.length >= MIN_CHARS,
  });

  const articles = results.data?.pages.flatMap((p) => p.articles) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;
  const suggestions = meta.data?.recent.length ? meta.data.recent : (meta.data?.popular ?? []);

  /** Return key, or a suggestion chip — search now, skipping the debounce. */
  function submit(next?: string) {
    const q = (next ?? value).trim();
    if (next !== undefined) setValue(next);
    if (q.length >= MIN_CHARS) setQuery(q);
  }

  const renderItem: ListRenderItem<ArticleCardType> = ({ item, index }) => (
    <RowCard article={item} index={index < STAGGER_MAX ? index : undefined} />
  );

  return (
    <Screen keyboard>
      <ScreenHeader title={t('search.title')} showRule={false} />
      <View style={styles.searchRow}>
        <Input
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => submit()}
          placeholder={t('search.placeholder')}
          leading="search"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={t('search.title')}
          trailing={
            value.length ? (
              <IconButton
                name="x"
                label={t('ui.clear')}
                onPress={() => {
                  setValue('');
                  setQuery('');
                }}
              />
            ) : undefined
          }
        />
      </View>
      <Divider />

      {query.length < MIN_CHARS ? (
        <View style={styles.suggest}>
          <EmptyState icon="search" title={t('ui.search')} body={t('search.minChars')} />
          {suggestions.length ? (
            <View style={styles.suggestBlock}>
              <T variant="meta" color="muted" style={styles.suggestLabel}>
                {meta.data?.recent.length ? t('search.recent') : t('search.popular')}
              </T>
              <ChipRail>
                {suggestions.slice(0, 10).map((s) => (
                  <Chip key={s} label={s} onPress={() => submit(s)} />
                ))}
              </ChipRail>
            </View>
          ) : null}
        </View>
      ) : results.isLoading ? (
        <LoadingState variant="list" />
      ) : results.isError && !results.data ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState icon="search" title={t('search.noResults')} body={query} />
      ) : (
        <FlatList
          data={articles}
          keyExtractor={keyOf}
          renderItem={renderItem}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            // Announced when results replace the suggestion chips — it is the
            // only signal that the search returned anything.
            <View style={styles.count} accessibilityLiveRegion="polite">
              <T
                variant="meta"
                color="muted"
                numberOfLines={1}
                accessibilityLabel={`${total} ${t('search.title')}`}
              >
                {`${query} · ${total}`}
              </T>
            </View>
          }
          ListFooterComponent={
            <ListFooter
              loading={results.isFetchingNextPage}
              end={!results.hasNextPage}
              error={results.isError}
              onRetry={() => void results.fetchNextPage()}
            />
          }
          onEndReached={() => {
            if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={results.isRefetching && !results.isFetchingNextPage}
              onRefresh={() => results.refetch()}
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
  searchRow: { backgroundColor: color.paper, paddingHorizontal: space.lg, paddingBottom: space.md },
  suggest: { paddingBottom: space.xl },
  suggestBlock: { gap: space.sm },
  suggestLabel: { paddingHorizontal: space.lg },
  count: { paddingHorizontal: space.lg, paddingVertical: space.md },
  list: { paddingBottom: space.xl },
}));
