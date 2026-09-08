import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as publicApi from '@/api/public';
import { VideoCard } from '@/components/VideoCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { SectionHeader } from '@/components/SectionHeader';
import { useI18n } from '@/lib/i18n';
import { font } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import type { VideoRail } from '@/api/types';

/**
 * Video hub (§15) — the app twin of the web page.
 *
 * A tab strip of the categories that actually have video, then a horizontal
 * rail per category. Choosing a tab filters to that rail instead of navigating,
 * so comparing sections costs nothing.
 */

function Rail({ rail }: { rail: VideoRail }) {
  const styles = useStyles();
  const { pick } = useI18n();
  return (
    <View style={styles.rail}>
      <SectionHeader title={pick(rail.title_te, rail.title_en)} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railTrack}
      >
        {rail.videos.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
      </ScrollView>
    </View>
  );
}

export default function VideosScreen() {
  const styles = useStyles();
  const { t, pick, isTelugu } = useI18n();
  const [active, setActive] = useState('');

  const hub = useQuery({
    queryKey: ['video-rails'],
    queryFn: publicApi.fetchVideoRails,
    staleTime: 120_000,
  });

  const rails = (hub.data?.rails ?? []).filter((r) => !active || r.key === active);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>▶ {t('videos.title')}</Text>
      </View>

      {hub.data && hub.data.tabs.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          <Pressable
            onPress={() => setActive('')}
            accessibilityRole="button"
            accessibilityState={{ selected: active === '' }}
            style={[styles.tab, active === '' && styles.tabActive]}
          >
            <Text style={[styles.tabText, active === '' && styles.tabTextActive]}>
              {isTelugu ? 'అన్నీ' : 'All'}
            </Text>
          </Pressable>
          {hub.data.tabs.map((tab) => {
            const selected = active === tab.slug;
            return (
              <Pressable
                key={tab.slug}
                onPress={() => setActive(selected ? '' : tab.slug)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.tab, selected && styles.tabActive]}
              >
                <Text style={[styles.tabText, selected && styles.tabTextActive]}>
                  {pick(tab.name_te, tab.name_en)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {hub.isLoading ? <LoadingState /> : null}
      {hub.isError ? <ErrorState onRetry={() => hub.refetch()} /> : null}
      {hub.data && rails.length === 0 ? <EmptyState message={t('videos.empty')} /> : null}

      {rails.length ? (
        <FlatList
          data={rails}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <Rail rail={item} />}
          showsVerticalScrollIndicator={false}
        />
      ) : null}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((color) => ({
  safe: { flex: 1, backgroundColor: color.canvas },
  header: {
    backgroundColor: color.paper,
    borderBottomWidth: 2,
    borderBottomColor: color.brand,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontFamily: font.headline, fontSize: 21, color: color.brand },
  tabs: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: {
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.paper,
    borderRadius: 17,
    paddingHorizontal: 14,
  },
  tabActive: { backgroundColor: color.brand, borderColor: color.brand },
  tabText: { fontFamily: font.teluguSemiBold, fontSize: 12.5, color: color.ink },
  tabTextActive: { color: color.onBrand },
  list: { paddingBottom: 28 },
  rail: { marginTop: 6, paddingHorizontal: 16 },
  railTrack: { paddingTop: 4, paddingBottom: 6 },
}));
