import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as publicApi from '@/api/public';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { font } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';

/** Search (§10): full-text with offset paging and popular/recent chips. */
export default function SearchScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');

  const meta = useQuery({
    queryKey: ['search-meta'],
    queryFn: publicApi.fetchSearchMeta,
    staleTime: 300_000,
  });

  const results = useInfiniteQuery({
    queryKey: ['search', query],
    queryFn: ({ pageParam }) =>
      publicApi.fetchSearch({ q: query, offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: query.length >= 2,
  });

  const articles = results.data?.pages.flatMap((p) => p.articles) ?? [];
  const total = results.data?.pages[0]?.total ?? 0;
  const suggestions = meta.data?.recent.length ? meta.data.recent : meta.data?.popular ?? [];

  function submit(next?: string) {
    const q = (next ?? value).trim();
    if (next !== undefined) setValue(next);
    if (q.length >= 2) setQuery(q);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>⌕ {t('search.title')}</Text>
        <View style={styles.inputRow}>
          <TextInput
            value={value}
            onChangeText={setValue}
            onSubmitEditing={() => submit()}
            placeholder={t('search.placeholder')}
            placeholderTextColor={color.mutedLight}
            returnKeyType="search"
            style={styles.input}
            accessibilityLabel={t('search.title')}
          />
          <Pressable onPress={() => submit()} accessibilityRole="button" style={styles.button}>
            <Text style={styles.buttonText}>⌕</Text>
          </Pressable>
        </View>
      </View>

      {query.length < 2 ? (
        <View style={styles.suggestBox}>
          <Text style={styles.hint}>{t('search.minChars')}</Text>
          {suggestions.length ? (
            <>
              <Text style={styles.suggestLabel}>
                {meta.data?.recent.length ? t('search.recent') : t('search.popular')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {suggestions.slice(0, 10).map((s) => (
                  <Pressable key={s} onPress={() => submit(s)} accessibilityRole="button" style={styles.chip}>
                    <Text style={styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
      ) : results.isLoading ? (
        <LoadingState />
      ) : results.isError ? (
        <ErrorState onRetry={() => results.refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState message={`“${query}” — ${t('search.noResults')}`} />
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => item.short_id}
          ListHeaderComponent={
            <Text style={styles.resultCount}>
              “{query}” · {total}
            </Text>
          }
          renderItem={({ item }) => <RowCard article={item} />}
          onEndReached={() => {
            if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
        />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((color) => ({
  safe: { flex: 1, backgroundColor: color.canvas },
  header: {
    backgroundColor: color.paper,
    borderBottomWidth: 2,
    borderBottomColor: color.brand,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  title: { fontFamily: font.headline, fontSize: 20, lineHeight: 30, color: color.brand },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: color.ruleStrong,
    borderRadius: 8,
    backgroundColor: color.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: font.telugu,
    fontSize: 15,
    color: color.ink,
  },
  button: {
    backgroundColor: color.brand,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: color.white, fontSize: 18 },
  suggestBox: { padding: 14, gap: 10 },
  hint: { fontFamily: font.telugu, fontSize: 12.5, lineHeight: 20, color: color.muted },
  suggestLabel: {
    fontFamily: font.teluguSemiBold,
    fontSize: 12,
    lineHeight: 18,
    color: color.mutedLight,
    textTransform: 'uppercase',
  },
  chipRow: { gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: color.paper,
  },
  chipText: { fontFamily: font.telugu, fontSize: 13, lineHeight: 20, color: color.ink },
  resultCount: {
    fontFamily: font.teluguSemiBold,
    fontSize: 14,
    lineHeight: 22,
    color: color.ink,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
}));
