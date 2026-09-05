import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { absoluteMediaUrl, API_ORIGIN } from '@/api/client';
import * as publicApi from '@/api/public';
import { RowCard } from '@/components/ArticleCard';
import { BodyRenderer } from '@/components/BodyRenderer';
import { Comments } from '@/components/Comments';
import { EngagementRow } from '@/components/EngagementRow';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FollowChip } from '@/components/FollowChip';
import { trackShare, useReadingBeacon } from '@/lib/beacon';
import { timeAgo, useI18n } from '@/lib/i18n';
import { color, font, FONT_SCALE, FONT_STEPS } from '@/lib/theme';
import { extractPlainText, useTts } from '@/lib/tts';
import { usePrefs } from '@/stores/prefs';

/**
 * Article page (§5): headline, sub-head, hero with credit, byline and times,
 * the Tiptap body rendered natively, share, and related stories. The reader
 * toolbar carries the §4.1 A-/A/A+/A++ switcher.
 */
export default function ArticleScreen() {
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const { t, pick, language } = useI18n();
  const { fontStep, setFontStep } = usePrefs();

  const article = useQuery({
    queryKey: ['article', shortId],
    queryFn: () => publicApi.fetchArticle(shortId!),
    enabled: Boolean(shortId),
  });

  const data = article.data;
  const scale = FONT_SCALE[fontStep];

  // §3.1 behaviour tracking: view, read heartbeats, scroll depth.
  const reportScroll = useReadingBeacon(data ? shortId : undefined);

  // §16 audio news, v1: the platform's Telugu voice. Headline first so a
  // listener knows immediately which story started.
  const tts = useTts(data ? `${data.title_te}. ${extractPlainText(data.body)}` : '');

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollable = contentSize.height - layoutMeasurement.height;
    if (scrollable > 0) reportScroll(((contentOffset.y + 0.5) / scrollable) * 100);
  }

  async function share() {
    if (!data) return;
    trackShare(data.short_id);
    try {
      await Share.share({
        message: `${data.title_te}\n${API_ORIGIN}${data.url}`,
      });
    } catch {
      // Reader dismissed the sheet — nothing to do.
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: data?.category ? pick(data.category.name_te, data.category.name_en) : '',
        }}
      />
      {article.isLoading ? <LoadingState /> : null}
      {article.isError ? <ErrorState onRetry={() => article.refetch()} /> : null}

      {data ? (
        <ScrollView style={styles.scroll} onScroll={onScroll} scrollEventThrottle={400}>
          <View style={styles.head}>
            {data.is_breaking ? <Text style={styles.breaking}>{t('home.breaking')}</Text> : null}
            {data.is_exclusive ? (
              <Text style={styles.exclusive}>★ {t('article.exclusive')}</Text>
            ) : null}
            <Text style={[styles.title, { fontSize: 25 * scale, lineHeight: 38 * scale }]}>
              {data.title_te}
            </Text>
            {data.sub_title_te ? (
              <Text style={[styles.subTitle, { fontSize: 16 * scale, lineHeight: 26 * scale }]}>
                {data.sub_title_te}
              </Text>
            ) : null}

            <View style={styles.metaRow}>
              <View style={{ flex: 1 }}>
                {data.byline_te || data.author ? (
                  <Text style={styles.byline}>
                    {data.byline_te ?? pick(data.author?.name_te, data.author?.name_en)}
                  </Text>
                ) : null}
                <Text style={styles.time}>
                  {[
                    data.district ? pick(data.district.name_te, data.district.name_en) : null,
                    timeAgo(data.published_at, language),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Pressable
                onPress={tts.toggle}
                accessibilityRole="button"
                accessibilityState={{ selected: tts.speaking }}
                style={[styles.shareButton, tts.speaking && styles.listenActive]}
              >
                <Text style={styles.shareText}>
                  {tts.speaking ? `■ ${t('article.stopListening')}` : `🔊 ${t('article.listen')}`}
                </Text>
              </Pressable>
              <Pressable onPress={share} accessibilityRole="button" style={styles.shareButton}>
                <Text style={styles.shareText}>↗ {t('article.share')}</Text>
              </Pressable>
            </View>

            {/* §4.1 font switcher — required on the reading surface. */}
            <View style={styles.fontRow}>
              {FONT_STEPS.map((step) => (
                <Pressable
                  key={step}
                  onPress={() => setFontStep(step)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: fontStep === step }}
                  style={[styles.fontStep, fontStep === step && styles.fontStepActive]}
                >
                  <Text
                    style={[styles.fontStepText, fontStep === step && styles.fontStepTextActive]}
                  >
                    {step}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {data.hero?.url ? (
            <View>
              <Image
                source={{ uri: absoluteMediaUrl(data.hero.url)! }}
                style={styles.hero}
                contentFit="cover"
                placeholder={data.hero.blurhash ?? undefined}
                transition={200}
                accessibilityLabel={data.hero.alt_te ?? ''}
              />
              {data.hero.caption_te || data.hero.credit ? (
                <Text style={styles.heroCaption}>
                  {[data.hero.caption_te, data.hero.credit].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.body}>
            {data.ai_generated ? (
              <Text style={styles.aiLabel}>◆ {t('article.aiLabel')}</Text>
            ) : null}
            {data.correction_note_te ? (
              <View style={styles.correction}>
                <Text style={styles.correctionText}>{data.correction_note_te}</Text>
              </View>
            ) : null}
            <BodyRenderer doc={data.body} />
            {data.source_credit ? (
              <Text style={styles.sourceCredit}>{data.source_credit}</Text>
            ) : null}

            {/* Like · save · share · report (§5) */}
            <EngagementRow article={data} />

            {/* Follow the threads this story belongs to (§12) */}
            <View style={styles.followRow}>
              <Text style={styles.followLabel}>{t('engage.follow')}</Text>
              {data.category ? (
                <FollowChip
                  targetType="category"
                  slug={data.category.slug}
                  name={pick(data.category.name_te, data.category.name_en)}
                />
              ) : null}
              {data.district ? (
                <FollowChip
                  targetType="district"
                  slug={data.district.slug}
                  name={pick(data.district.name_te, data.district.name_en)}
                />
              ) : null}
              {data.author?.author_slug ? (
                <FollowChip
                  targetType="author"
                  slug={data.author.author_slug}
                  name={pick(data.author.name_te, data.author.name_en)}
                />
              ) : null}
            </View>

            {/* Comments (§5) */}
            <Comments shortId={data.short_id} />
          </View>

          {data.related.length ? (
            <View style={styles.related}>
              <Text style={styles.relatedTitle}>{t('article.related')}</Text>
              {data.related.map((item) => (
                <RowCard key={item.short_id} article={item} />
              ))}
            </View>
          ) : null}
          <View style={{ height: 30 }} />
        </ScrollView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.paper },
  head: { padding: 16, paddingBottom: 10 },
  breaking: {
    fontFamily: font.teluguBold,
    fontSize: 12,
    lineHeight: 18,
    color: color.breaking,
    marginBottom: 4,
  },
  exclusive: {
    fontFamily: font.teluguBold,
    fontSize: 12,
    lineHeight: 18,
    color: color.exclusive,
    marginBottom: 4,
  },
  title: { fontFamily: font.teluguBold, color: color.ink },
  subTitle: { fontFamily: font.telugu, color: color.inkSoft, marginTop: 8 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: color.rule,
  },
  byline: { fontFamily: font.teluguSemiBold, fontSize: 13.5, lineHeight: 21, color: color.ink },
  time: { fontFamily: font.telugu, fontSize: 12, lineHeight: 18, color: color.mutedLight },
  shareButton: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shareText: { fontFamily: font.teluguSemiBold, fontSize: 12.5, lineHeight: 19, color: color.brand },
  listenActive: { backgroundColor: color.brandTint, borderColor: color.brand },
  fontRow: { flexDirection: 'row', gap: 4, marginTop: 10 },
  fontStep: {
    minWidth: 40,
    alignItems: 'center',
    borderRadius: 6,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: color.rule,
  },
  fontStepActive: { backgroundColor: color.brandTint, borderColor: color.brand },
  fontStepText: { fontFamily: font.teluguSemiBold, fontSize: 12, color: color.muted },
  fontStepTextActive: { color: color.brand },
  hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: color.placeholder },
  heroCaption: {
    fontFamily: font.telugu,
    fontSize: 12,
    lineHeight: 19,
    color: color.mutedLight,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  body: { padding: 16 },
  aiLabel: {
    fontFamily: font.teluguSemiBold,
    fontSize: 12,
    lineHeight: 18,
    color: '#6D4FC4',
    marginBottom: 10,
  },
  correction: {
    borderLeftWidth: 3,
    borderLeftColor: color.exclusive,
    backgroundColor: color.exclusiveTint,
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  correctionText: { fontFamily: font.telugu, fontSize: 13, lineHeight: 21, color: color.ink },
  sourceCredit: {
    fontFamily: font.telugu,
    fontSize: 12.5,
    lineHeight: 19,
    color: color.mutedLight,
    marginTop: 8,
  },
  followRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  followLabel: { fontFamily: font.teluguSemiBold, fontSize: 12.5, lineHeight: 19, color: color.muted },
  related: { borderTopWidth: 2, borderTopColor: color.ink, backgroundColor: color.canvas },
  relatedTitle: {
    fontFamily: font.headline,
    fontSize: 18,
    lineHeight: 28,
    color: color.brand,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
