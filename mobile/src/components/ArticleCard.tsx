import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { absoluteMediaUrl } from '@/api/client';
import type { ArticleCard as ArticleCardType } from '@/api/types';
import { timeAgo, useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { alpha, radius, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Card } from '@/ui/Card';
import { T } from '@/ui/Text';

/**
 * Card variants for feeds. Same information architecture as the web cards
 * (frontend ArticleCard.tsx) with DailyHunt-benchmarked meta: category kicker,
 * flags (breaking / exclusive / AI), district and relative time on every card.
 *
 * Pass `index` from a list to stagger the first six rows in (`m.entering`).
 */
export interface ArticleCardProps {
  article: ArticleCardType;
  index?: number;
}

const STAGGER_MAX = 6;

function openArticle(article: ArticleCardType) {
  router.push({ pathname: '/article/[shortId]', params: { shortId: article.short_id } });
}

function hasFlags(article: ArticleCardType): boolean {
  return article.is_breaking || article.is_exclusive || article.ai_generated;
}

/**
 * Entering animation for the first rows of a list. Always the same wrapper
 * element, so a row whose `index` flips to undefined after the first scroll
 * updates in place instead of remounting (entering only fires on mount).
 */
function Stagger({ index, children }: { index?: number; children: ReactNode }) {
  const m = useMotion();
  const entering = index === undefined || index >= STAGGER_MAX ? undefined : m.entering(index);
  return <Animated.View entering={entering}>{children}</Animated.View>;
}

/** Breaking / exclusive / AI pills, the same on every variant. */
function Flags({ article }: { article: ArticleCardType }) {
  const { t } = useI18n();
  return (
    <>
      {article.is_breaking ? <Badge tone="breaking" label={t('home.breaking')} icon="zap" size="xs" /> : null}
      {article.is_exclusive ? <Badge tone="exclusive" label={t('ui.exclusive')} size="xs" /> : null}
      {article.ai_generated ? <Badge tone="ai" label={t('ui.ai')} icon="sparkles" size="xs" /> : null}
    </>
  );
}

function Kicker({ article }: { article: ArticleCardType }) {
  const { pick } = useI18n();
  if (!article.category) return null;
  return (
    <T variant="meta" weight="semibold" color="brand" numberOfLines={1}>
      {pick(article.category.name_te, article.category.name_en)}
    </T>
  );
}

/**
 * Flags + kicker on one wrapping line; nothing when the article has neither.
 * Decorative for assistive tech: the card label (useCardLabel) already speaks
 * every flag and the kicker, and Android TalkBack would otherwise stop on
 * each badge a second time.
 */
function Topline({ article }: { article: ArticleCardType }) {
  const styles = useStyles();
  if (!hasFlags(article) && !article.category) return null;
  return (
    <View style={styles.topline} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Flags article={article} />
      <Kicker article={article} />
    </View>
  );
}

function MetaLine({ article }: { article: ArticleCardType }) {
  const { language, pick } = useI18n();
  const parts = [
    article.district ? pick(article.district.name_te, article.district.name_en) : null,
    timeAgo(article.published_at, language),
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <T variant="meta" color="muted" numberOfLines={1}>
      {parts.join(' · ')}
    </T>
  );
}

/**
 * Everything the card shows, in reading order, for the one accessible element
 * `Card onPress` collapses it into: flags, kicker, headline, district, time.
 */
function useCardLabel(article: ArticleCardType): string {
  const { t, pick, language } = useI18n();
  return [
    article.is_breaking && t('home.breaking'),
    article.is_exclusive && t('ui.exclusive'),
    article.ai_generated && t('ui.ai'),
    article.category && pick(article.category.name_te, article.category.name_en),
    pick(article.title_te, article.title_en),
    article.district && pick(article.district.name_te, article.district.name_en),
    timeAgo(article.published_at, language),
  ]
    .filter(Boolean)
    .join(', ');
}

function Thumb({ article, style }: { article: ArticleCardType; style: object }) {
  const styles = useStyles();
  const m = useMotion();
  const uri = absoluteMediaUrl(article.hero?.url ?? null);
  if (!uri) return <View style={[style, styles.fallback]} />;
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
      placeholder={article.hero?.blurhash ? { blurhash: article.hero.blurhash } : undefined}
      transition={m.imageTransition}
      recyclingKey={article.short_id}
      accessibilityLabel={article.hero?.alt_te ?? ''}
    />
  );
}

/** Big image-led card: home lead and section leads. */
export const LeadCard = memo(function LeadCard({ article, index }: ArticleCardProps) {
  const styles = useStyles();
  const { pick } = useI18n();
  const title = pick(article.title_te, article.title_en);
  const a11y = useCardLabel(article);
  return (
    <Stagger index={index}>
      <Card padding="none" elevated onPress={() => openArticle(article)} accessibilityLabel={a11y} style={styles.card}>
        <View>
          <Thumb article={article} style={styles.leadImage} />
          {hasFlags(article) ? (
            <View style={styles.strip} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Flags article={article} />
            </View>
          ) : null}
        </View>
        <View style={styles.leadBody}>
          <Kicker article={article} />
          <T variant="headlineLg" weight="bold">
            {title}
          </T>
          {article.summary_te ? (
            <T variant="body" color="muted" numberOfLines={2}>
              {article.summary_te}
            </T>
          ) : null}
          <MetaLine article={article} />
        </View>
      </Card>
    </Stagger>
  );
});

/** Thumb + headline row: lists and section blocks. */
export const RowCard = memo(function RowCard({ article, index }: ArticleCardProps) {
  const styles = useStyles();
  const { pick } = useI18n();
  const title = pick(article.title_te, article.title_en);
  const a11y = useCardLabel(article);
  const hasThumb = !!absoluteMediaUrl(article.hero?.url ?? null);
  return (
    <Stagger index={index}>
      <Card elevated onPress={() => openArticle(article)} accessibilityLabel={a11y} style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Topline article={article} />
            <T variant="headlineSm" weight="bold" numberOfLines={3}>
              {title}
            </T>
            <MetaLine article={article} />
          </View>
          {hasThumb ? <Thumb article={article} style={styles.rowImage} /> : null}
        </View>
      </Card>
    </Stagger>
  );
});

/** Headline-only compact row for the latest rail. */
export const CompactCard = memo(function CompactCard({ article, index }: ArticleCardProps) {
  const styles = useStyles();
  const { pick } = useI18n();
  const title = pick(article.title_te, article.title_en);
  const a11y = useCardLabel(article);
  return (
    <Stagger index={index}>
      <Card elevated onPress={() => openArticle(article)} accessibilityLabel={a11y} style={styles.card}>
        <View style={styles.compact}>
          <Topline article={article} />
          <T variant="bodySmall" weight="semibold" numberOfLines={2}>
            {title}
          </T>
          <MetaLine article={article} />
        </View>
      </Card>
    </Stagger>
  );
});

const useStyles = makeStyles((color) => ({
  card: { marginHorizontal: space.lg, marginTop: space.md },
  topline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  fallback: { backgroundColor: color.placeholder },

  leadImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    backgroundColor: color.placeholder,
  },
  /* Scrim strip behind the flags at the foot of the hero (no gradient dep). */
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: alpha(color.overlay, 0.45),
  },
  leadBody: { padding: space.lg, gap: space.xs },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  rowText: { flex: 1, minWidth: 0, gap: space.xs },
  rowImage: { width: 96, height: 72, borderRadius: radius.sm, backgroundColor: color.placeholder },

  compact: { gap: space.xs },
}));
