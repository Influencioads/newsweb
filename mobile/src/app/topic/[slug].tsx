import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import * as api from '@/api/epaper';
import type { ArticleCard } from '@/api/types';
import { LeadCard, RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { VideoStrip } from '@/components/VideoStrip';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';

/**
 * A trending topic (§8): every story filed under it, ranked for the reader's
 * district edition, with the topic's video rail at the foot. `/topics/{slug}`
 * returns the whole set in one response — the footer says so rather than
 * pretending there is another page.
 */
const keyOf = (article: ArticleCard) => article.short_id;

export default function TopicScreen() {
  const styles = useStyles();
  const color = useColors();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, pick } = useI18n();
  const district = usePrefs((state) => state.edition);

  const topic = useQuery({
    queryKey: ['topic', slug, district],
    queryFn: () => api.fetchTopic(slug, district),
    enabled: Boolean(slug),
  });

  const articles = topic.data?.articles ?? [];
  const title = topic.data ? pick(topic.data.topic.title_te, topic.data.topic.title_en) || slug : t('screen.topic');

  const renderItem: ListRenderItem<ArticleCard> = ({ item, index }) =>
    index === 0 ? <LeadCard article={item} /> : <RowCard article={item} />;

  return (
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title }} />
      <ScreenHeader title={title} />

      {topic.isLoading ? (
        <SkeletonFeed />
      ) : topic.isError && !topic.data ? (
        <ErrorState error={topic.error} onRetry={() => topic.refetch()} />
      ) : (
        <FlatList
          data={articles}
          keyExtractor={keyOf}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState icon="newspaper" />}
          ListFooterComponent={
            <View>
              <VideoStrip category={slug} />
              <ListFooter end />
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={topic.isRefetching}
              onRefresh={() => topic.refetch()}
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
