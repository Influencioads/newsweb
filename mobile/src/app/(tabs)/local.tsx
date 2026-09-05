import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as publicApi from '@/api/public';
import { RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { usePrefs } from '@/stores/prefs';

/**
 * Local feed (§1.4/§4): state → district → mandal chips; exact-location
 * stories rank above district-wide ones. The choice persists and also drives
 * the home edition.
 */

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function LocalScreen() {
  const { t, pick } = useI18n();
  const { edition, mandal, setEdition, setMandal } = usePrefs();
  const [stateCode, setStateCode] = useState<string>('');

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
        limit: 20,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: Boolean(edition),
  });

  const articles = feed.data?.pages.flatMap((page) => page.articles) ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>◉ {t('local.title')}</Text>
      </View>

      {/* ---------------------------------------------- selectors ----------- */}
      <View style={styles.selectors}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {config.data?.states.map((s) => (
            <Chip
              key={s.code}
              label={pick(s.name_te, s.name_en)}
              active={effectiveState === s.code}
              onPress={() => {
                setStateCode(s.code);
                setEdition(null);
              }}
            />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {districts.map((d) => (
            <Chip
              key={d.slug}
              label={pick(d.name_te, d.name_en)}
              active={edition === d.slug}
              onPress={() => setEdition(edition === d.slug ? null : d.slug)}
            />
          ))}
        </ScrollView>
        {edition && mandals.data?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label={t('local.all')} active={!mandal} onPress={() => setMandal(null)} />
            {mandals.data.map((m) => (
              <Chip
                key={m.slug}
                label={pick(m.name_te, m.name_en)}
                active={mandal === m.slug}
                onPress={() => setMandal(mandal === m.slug ? null : m.slug)}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>

      {/* ---------------------------------------------- feed ---------------- */}
      {!edition ? (
        <EmptyState message={t('local.chooseDistrict')} />
      ) : feed.isLoading ? (
        <LoadingState />
      ) : feed.isError ? (
        <ErrorState onRetry={() => feed.refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState />
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
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  header: {
    backgroundColor: color.paper,
    borderBottomWidth: 2,
    borderBottomColor: color.brand,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  title: { fontFamily: font.headline, fontSize: 20, lineHeight: 30, color: color.brand },
  selectors: {
    backgroundColor: color.paper,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
    paddingVertical: 6,
    gap: 6,
  },
  chipRow: { paddingHorizontal: 10, gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: color.paper,
  },
  chipActive: { borderColor: color.brand, backgroundColor: color.brandTint },
  chipText: { fontFamily: font.telugu, fontSize: 13, lineHeight: 20, color: color.muted },
  chipTextActive: { color: color.brand, fontFamily: font.teluguSemiBold },
});
