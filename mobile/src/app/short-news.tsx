import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { absoluteMediaUrl } from '@/api/client';
import * as publicApi from '@/api/public';
import type { ArticleCard } from '@/api/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { timeAgo, useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';

/**
 * Short news (§14): the InShorts/DailyHunt swipe — one full-screen card per
 * story, vertical paging. Headline + image + the 2–5 line standfirst; a tap
 * opens the full article.
 */
export default function ShortNewsScreen() {
  const styles = useStyles();
  const { t, pick, language } = useI18n();
  const { height } = useWindowDimensions();
  // Card height = viewport minus the stack header (~56) — paging stays exact.
  const cardHeight = height - 56;

  const feed = useInfiniteQuery({
    queryKey: ['short-news'],
    queryFn: ({ pageParam }) => publicApi.fetchShortNews({ offset: pageParam, limit: 10 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_cursor ? Number(last.next_cursor) : undefined),
  });

  const articles = feed.data?.pages.flatMap((page) => page.articles) ?? [];

  function Card({ article }: { article: ArticleCard }) {
    const heroUrl = absoluteMediaUrl(article.hero?.url ?? null);
    return (
      <View style={[styles.card, { height: cardHeight }]}>
        {heroUrl ? (
          <Image
            source={{ uri: heroUrl }}
            style={styles.hero}
            contentFit="cover"
            placeholder={article.hero?.blurhash ?? undefined}
            transition={150}
          />
        ) : null}
        <View style={styles.body}>
          <View style={styles.metaRow}>
            {article.category ? (
              <Text style={styles.kicker}>
                {pick(article.category.name_te, article.category.name_en)}
              </Text>
            ) : null}
            <Text style={styles.time}>{timeAgo(article.published_at, language)}</Text>
          </View>
          <Text style={styles.headline}>{article.title_te}</Text>
          {article.summary_te ? <Text style={styles.summary}>{article.summary_te}</Text> : null}
          <Pressable
            onPress={() =>
              router.push({ pathname: '/article/[shortId]', params: { shortId: article.short_id } })
            }
            accessibilityRole="button"
            style={styles.readMore}
          >
            <Text style={styles.readMoreText}>{t('shorts.readFull')}</Text>
          </Pressable>
          <Text style={styles.swipeHint}>↑ {t('shorts.hint')}</Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `⚡ ${t('shorts.title')}` }} />
      {feed.isLoading ? <LoadingState /> : null}
      {feed.isError ? <ErrorState onRetry={() => feed.refetch()} /> : null}
      {feed.data ? (
        articles.length === 0 ? (
          <EmptyState />
        ) : (
          <FlatList
            data={articles}
            keyExtractor={(item) => item.short_id}
            renderItem={({ item }) => <Card article={item} />}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            snapToInterval={cardHeight}
            decelerationRate="fast"
            getItemLayout={(_data, index) => ({
              length: cardHeight,
              offset: cardHeight * index,
              index,
            })}
            onEndReached={() => {
              if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
            }}
            onEndReachedThreshold={2}
          />
        )
      ) : null}
    </>
  );
}

const useStyles = makeStyles((color) => ({
  card: { backgroundColor: color.paper, borderBottomWidth: 1, borderBottomColor: color.rule },
  hero: { width: '100%', height: '38%', backgroundColor: color.placeholder },
  body: { flex: 1, padding: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kicker: {
    fontFamily: font.teluguSemiBold,
    fontSize: 11.5,
    lineHeight: 18,
    color: color.brand,
    textTransform: 'uppercase',
  },
  time: { fontFamily: font.telugu, fontSize: 11, lineHeight: 17, color: color.mutedLight },
  headline: {
    fontFamily: font.teluguBold,
    fontSize: 21,
    lineHeight: 33,
    color: color.ink,
    marginTop: 8,
  },
  summary: {
    fontFamily: font.telugu,
    fontSize: 15.5,
    lineHeight: 27,
    color: color.inkSoft,
    marginTop: 10,
    flexShrink: 1,
  },
  readMore: {
    marginTop: 'auto',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: color.brand,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  readMoreText: { fontFamily: font.teluguBold, fontSize: 13.5, lineHeight: 21, color: color.brand },
  swipeHint: {
    fontFamily: font.telugu,
    fontSize: 11,
    lineHeight: 17,
    color: color.mutedLight,
    textAlign: 'center',
    marginTop: 10,
  },
}));
