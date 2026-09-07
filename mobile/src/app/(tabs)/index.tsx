import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as engagementApi from '@/api/engagement';
import * as notificationsApi from '@/api/notifications';
import * as publicApi from '@/api/public';
import { CompactCard, LeadCard, RowCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { SectionHeader } from '@/components/SectionHeader';
import { VideoStrip } from '@/components/VideoStrip';
import { useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { useAuth } from '@/stores/auth';
import { usePrefs } from '@/stores/prefs';

/**
 * Home feed: breaking strip, lead story, secondary rows, latest rail, then the
 * admin-configured section blocks — one `/public/home` request (§23).
 */
export default function HomeScreen() {
  const { t, pick } = useI18n();
  const edition = usePrefs((s) => s.edition);
  const authed = useAuth((s) => s.status === 'authenticated');

  const home = useQuery({
    queryKey: ['home', edition],
    queryFn: () => publicApi.fetchHome(edition),
  });

  const unread = useQuery({
    queryKey: ['inbox-unread'],
    queryFn: () => notificationsApi.fetchInbox(0),
    enabled: authed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // §3.2 personalized rail — fetched separately so the shared home payload
  // stays cacheable; anonymous readers simply never see the block.
  const forYou = useQuery({
    queryKey: ['for-you-home'],
    queryFn: () => engagementApi.fetchForYou(0, 5),
    enabled: authed,
    staleTime: 120_000,
  });

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const editionName = (() => {
    if (!edition) return null;
    const district = config.data?.districts.find((d) => d.slug === edition);
    return district ? pick(district.name_te, district.name_en) : null;
  })();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ------------------------------------------------ masthead ---------- */}
      <View style={styles.masthead}>
        <Text style={styles.mastheadTitle}>టాప్ తెలుగు న్యూస్</Text>
        <View style={styles.mastheadActions}>
          <Pressable
            onPress={() => router.push('/short-news')}
            accessibilityRole="button"
            accessibilityLabel={t('shorts.title')}
            style={styles.editionChip}
          >
            <Text style={styles.editionText}>⚡ {t('shorts.title')}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/local')}
            accessibilityRole="button"
            style={styles.editionChip}
          >
            <Text style={styles.editionText}>
              ◉ {editionName ?? t('local.chooseDistrict')}
            </Text>
          </Pressable>
          {authed ? (
            <Pressable
              onPress={() => router.push('/notifications')}
              accessibilityRole="button"
              accessibilityLabel={t('notify.title')}
              style={styles.bell}
            >
              <Text style={styles.bellGlyph}>🔔</Text>
              {(unread.data?.unread ?? 0) > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unread.data!.unread > 99 ? '99+' : unread.data!.unread}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      </View>

      {home.isLoading ? <LoadingState /> : null}
      {home.isError ? <ErrorState onRetry={() => home.refetch()} /> : null}

      {home.data ? (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={home.isRefetching}
              onRefresh={() => home.refetch()}
              tintColor={color.brand}
              colors={[color.brand]}
            />
          }
        >
          {/* -------------------------------------------- breaking ---------- */}
          {home.data.breaking.length ? (
            <View style={styles.breakingBar}>
              <Text style={styles.breakingLabel}>⚡ {t('home.breaking')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {home.data.breaking.map((item) => (
                  <Pressable
                    key={item.short_id}
                    onPress={() =>
                      router.push({
                        pathname: '/article/[shortId]',
                        params: { shortId: item.short_id },
                      })
                    }
                    accessibilityRole="button"
                    style={styles.breakingItem}
                  >
                    <Text style={styles.breakingText} numberOfLines={1}>
                      {pick(item.title_te, item.title_en)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* -------------------------------------------- top of the page --- */}
          {home.data.lead ? <LeadCard article={home.data.lead} /> : null}
          {home.data.secondary.map((article) => (
            <RowCard key={article.short_id} article={article} />
          ))}
          {home.data.mid_column.map((article) => (
            <RowCard key={article.short_id} article={article} />
          ))}

          {/* -------------------------------------------- for you (§3.2) ---- */}
          {authed && (forYou.data?.articles.length ?? 0) >= 3 ? (
            <>
              <SectionHeader title={t('foryou.title')} />
              {forYou.data!.articles.map((article) => (
                <RowCard key={`fy-${article.short_id}`} article={article} />
              ))}
            </>
          ) : null}

          {/* -------------------------------------------- latest rail ------- */}
          {home.data.latest.length ? (
            <>
              <SectionHeader title={t('home.latest')} />
              {home.data.latest.slice(0, 6).map((article) => (
                <CompactCard key={`latest-${article.short_id}`} article={article} />
              ))}
            </>
          ) : null}

          {/* -------------------------------------------- video strip (§15) - */}
          <VideoStrip />

          {/* -------------------------------------------- sections ---------- */}
          {home.data.sections.map((section) => (
            <View key={section.key}>
              <SectionHeader
                title={pick(section.title_te, section.title_en)}
                onSeeAll={() =>
                  section.key === 'trending'
                    ? router.push('/trending')
                    : router.push({ pathname: '/section/[slug]', params: { slug: section.key } })
                }
              />
              {section.articles[0] ? <LeadCard article={section.articles[0]} /> : null}
              {section.articles.slice(1, 5).map((article) => (
                <RowCard key={article.short_id} article={article} />
              ))}
            </View>
          ))}

          {!home.data.lead && !home.data.sections.length ? <EmptyState /> : null}
          <View style={styles.footerSpace} />
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  masthead: {
    backgroundColor: color.paper,
    borderBottomWidth: 2,
    borderBottomColor: color.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mastheadTitle: {
    fontFamily: font.headlineHeavy,
    fontSize: 22,
    lineHeight: 34,
    color: color.brand,
  },
  mastheadActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editionChip: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 150,
  },
  bell: { padding: 4 },
  bellGlyph: { fontSize: 18 },
  badge: {
    position: 'absolute',
    top: 0,
    right: -2,
    backgroundColor: color.breaking,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: color.white, fontSize: 9, fontWeight: '700', lineHeight: 12 },
  editionText: { fontFamily: font.telugu, fontSize: 11.5, lineHeight: 17, color: color.muted },
  breakingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.breaking,
    paddingVertical: 7,
    paddingLeft: 12,
  },
  breakingLabel: {
    fontFamily: font.teluguBold,
    fontSize: 12.5,
    lineHeight: 19,
    color: color.white,
    marginRight: 10,
  },
  breakingItem: { marginRight: 22, maxWidth: 320 },
  breakingText: { fontFamily: font.telugu, fontSize: 13, lineHeight: 20, color: color.white },
  footerSpace: { height: 24 },
});
