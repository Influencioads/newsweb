import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { absoluteMediaUrl } from '@/api/client';
import type { ArticleCard as ArticleCardType } from '@/api/types';
import { timeAgo, useI18n } from '@/lib/i18n';
import { color, font, type } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';

/**
 * Card variants for feeds. Same information architecture as the web cards
 * (frontend ArticleCard.tsx) with DailyHunt-benchmarked meta: category kicker,
 * source/byline and relative time on every card.
 */

function openArticle(article: ArticleCardType) {
  router.push({ pathname: '/article/[shortId]', params: { shortId: article.short_id } });
}

function Kicker({ article }: { article: ArticleCardType }) {
  const styles = useStyles();
  const { pick, t } = useI18n();
  if (article.is_breaking) {
    return <Text style={styles.kickerBreaking}>{t('home.breaking')}</Text>;
  }
  if (!article.category) return null;
  return (
    <Text style={styles.kicker}>{pick(article.category.name_te, article.category.name_en)}</Text>
  );
}

function MetaLine({ article }: { article: ArticleCardType }) {
  const styles = useStyles();
  const { language, pick } = useI18n();
  const parts = [
    article.district ? pick(article.district.name_te, article.district.name_en) : null,
    timeAgo(article.published_at, language),
  ].filter(Boolean);
  if (!parts.length) return null;
  return <Text style={styles.meta}>{parts.join(' · ')}</Text>;
}

/** Big image-led card: home lead and section leads. */
export function LeadCard({ article }: { article: ArticleCardType }) {
  const styles = useStyles();
  const { pick } = useI18n();
  const heroUrl = absoluteMediaUrl(article.hero?.url ?? null);
  return (
    <Pressable
      onPress={() => openArticle(article)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.leadCard, pressed && styles.pressed]}
    >
      {heroUrl ? (
        <Image
          source={{ uri: heroUrl }}
          style={styles.leadImage}
          contentFit="cover"
          placeholder={article.hero?.blurhash ?? undefined}
          transition={150}
          accessibilityLabel={article.hero?.alt_te ?? ''}
        />
      ) : (
        <View style={[styles.leadImage, styles.imageFallback]} />
      )}
      <View style={styles.leadBody}>
        <Kicker article={article} />
        <Text style={styles.leadTitle}>{pick(article.title_te, article.title_en)}</Text>
        {article.summary_te ? (
          <Text style={styles.leadSummary} numberOfLines={2}>
            {article.summary_te}
          </Text>
        ) : null}
        <MetaLine article={article} />
      </View>
    </Pressable>
  );
}

/** Thumb + headline row: lists and section blocks. */
export function RowCard({ article }: { article: ArticleCardType }) {
  const styles = useStyles();
  const { pick } = useI18n();
  const heroUrl = absoluteMediaUrl(article.hero?.url ?? null);
  return (
    <Pressable
      onPress={() => openArticle(article)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <Kicker article={article} />
        <Text style={styles.rowTitle} numberOfLines={3}>
          {pick(article.title_te, article.title_en)}
        </Text>
        <MetaLine article={article} />
      </View>
      {heroUrl ? (
        <Image
          source={{ uri: heroUrl }}
          style={styles.rowImage}
          contentFit="cover"
          placeholder={article.hero?.blurhash ?? undefined}
          transition={150}
          accessibilityLabel={article.hero?.alt_te ?? ''}
        />
      ) : null}
    </Pressable>
  );
}

/** Headline-only compact row for the latest rail. */
export function CompactCard({ article }: { article: ArticleCardType }) {
  const styles = useStyles();
  const { pick, language } = useI18n();
  return (
    <Pressable
      onPress={() => openArticle(article)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.compactCard, pressed && styles.pressed]}
    >
      <Text style={styles.compactTime}>{timeAgo(article.published_at, language)}</Text>
      <Text style={styles.compactTitle} numberOfLines={2}>
        {pick(article.title_te, article.title_en)}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((color) => ({
  pressed: { opacity: 0.75 },
  kicker: {
    fontFamily: font.teluguSemiBold,
    fontSize: 11,
    lineHeight: 17,
    color: color.brand,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  kickerBreaking: {
    fontFamily: font.teluguBold,
    fontSize: 11,
    lineHeight: 17,
    color: color.breaking,
    marginBottom: 2,
  },
  meta: {
    fontFamily: font.telugu,
    fontSize: type.meta.fontSize,
    lineHeight: type.meta.lineHeight,
    color: color.mutedLight,
    marginTop: 4,
  },

  leadCard: { backgroundColor: color.paper, borderBottomWidth: 1, borderBottomColor: color.rule },
  leadImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: color.placeholder },
  imageFallback: { backgroundColor: color.placeholder },
  leadBody: { padding: 14 },
  leadTitle: {
    fontFamily: font.teluguBold,
    fontSize: type.headlineLg.fontSize,
    lineHeight: type.headlineLg.lineHeight,
    color: color.ink,
  },
  leadSummary: {
    fontFamily: font.telugu,
    fontSize: type.bodySmall.fontSize,
    lineHeight: type.bodySmall.lineHeight,
    color: color.muted,
    marginTop: 6,
  },

  rowCard: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: color.paper,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: font.teluguSemiBold,
    fontSize: type.headlineSm.fontSize,
    lineHeight: type.headlineSm.lineHeight,
    color: color.ink,
  },
  rowImage: { width: 96, height: 72, borderRadius: 4, backgroundColor: color.placeholder },

  compactCard: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
    backgroundColor: color.paper,
  },
  compactTime: {
    fontFamily: font.telugu,
    fontSize: 11,
    lineHeight: 16,
    color: color.brand,
    marginBottom: 2,
  },
  compactTitle: {
    fontFamily: font.telugu,
    fontSize: 14.5,
    lineHeight: 23,
    color: color.ink,
  },
}));
