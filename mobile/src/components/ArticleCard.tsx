import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { absoluteMediaUrl } from '@/api/client';
import type { ArticleCard as ArticleCardType } from '@/api/types';
import { ArticleActions } from '@/components/ArticleActions';
import { EditorialGradient } from '@/components/home/EditorialGradient';
import { timeAgo, useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { alpha, radius, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Card } from '@/ui/Card';
import { Divider } from '@/ui/Divider';
import { PressableScale } from '@/ui/PressableScale';
import { T, type PaletteKey } from '@/ui/Text';

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
  const entering = Platform.OS === 'web' || index === undefined || index >= STAGGER_MAX ? undefined : m.entering(index);
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

/**
 * The category, as a tinted chip rather than coloured text.
 *
 * A chip is what makes a feed scannable at arm's length — it gives the eye
 * something to sort by before it reads a word. Deliberately one tone for every
 * category: a hue per section would mean a dozen new colours in `theme.ts`,
 * which the linter would allow and the identity would not survive.
 */
function Kicker({ article }: { article: ArticleCardType }) {
  const { pick } = useI18n();
  if (!article.category) return null;
  return (
    <Badge
      tone="brand"
      size="xs"
      label={pick(article.category.name_te, article.category.name_en)}
    />
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
    <View style={styles.topline} aria-hidden>
      <Flags article={article} />
      <Kicker article={article} />
    </View>
  );
}

function MetaLine({ article, color = 'muted' }: { article: ArticleCardType; color?: PaletteKey }) {
  const { language, pick } = useI18n();
  const parts = [
    article.district ? pick(article.district.name_te, article.district.name_en) : null,
    timeAgo(article.published_at, language),
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <T variant="meta" color={color} numberOfLines={1}>
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
    // The alt text deliberately leaves this out, so the card says it once.
    article.hero?.ai_generated && t('article.aiImage'),
    article.district && pick(article.district.name_te, article.district.name_en),
    timeAgo(article.published_at, language),
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The picture, and — §7.4, non-optional — the label when it was drawn by a
 * model. That flag lives on the media, not on the article: a human-written
 * story illustrated by AI has `article.ai_generated === false`, so the badge
 * in `Flags` never speaks for it. The label is decorative here because
 * `useCardLabel` already says it once for the whole card.
 */
function Thumb({ article, style }: { article: ArticleCardType; style: object }) {
  const styles = useStyles();
  const m = useMotion();
  const { t } = useI18n();
  const uri = absoluteMediaUrl(article.hero?.url ?? null);
  if (!uri) return <View style={[style, styles.fallback]} />;
  return (
    <View style={[style, styles.thumbBox]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        placeholder={article.hero?.blurhash ? { blurhash: article.hero.blurhash } : undefined}
        transition={m.imageTransition}
        recyclingKey={article.short_id}
        accessibilityLabel={article.hero?.alt_te ?? ''}
      />
      {article.hero?.ai_generated ? (
        <View style={styles.aiTag} aria-hidden>
          <Badge tone="ai" icon="sparkles" size="xs" label={t('article.aiImage')} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Card chrome shared by the lead and row variants.
 *
 * The content is the press target and the action strip sits *outside* it, as
 * a sibling. That restructure is not cosmetic: the whole card used to be one
 * `<Card onPress>`, and buttons nested inside a pressable collapse into it for
 * TalkBack and double-fire on Android. Two siblings give the reader one focus
 * stop for "open the story" and one per action.
 */
function CardShell({
  article,
  a11y,
  style,
  actions = true,
  elevated = true,
  children,
}: {
  article: ArticleCardType;
  a11y: string;
  style?: StyleProp<ViewStyle>;
  actions?: boolean;
  elevated?: boolean;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <Card padding="none" elevated={elevated} style={style}>
      <PressableScale onPress={() => openArticle(article)} accessibilityLabel={a11y}>
        {children}
      </PressableScale>
      {actions ? (
        <View style={styles.actionSurface}>
          <Divider />
          {/* `flags="cache"` — a mounted row must never issue its own request,
              or a 20-card page costs 20 of them on every scroll. */}
          <ArticleActions article={article} size="card" flags="cache" />
        </View>
      ) : null}
    </Card>
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
      <CardShell article={article} a11y={a11y} style={styles.card}>
        <View>
          <Thumb article={article} style={styles.leadImage} />
          {hasFlags(article) ? (
            <View style={styles.strip} aria-hidden>
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
      </CardShell>
    </Stagger>
  );
});

/** The home page's first story gets the strongest editorial hierarchy. */
export const FeaturedHomeCard = memo(function FeaturedHomeCard({ article, index }: ArticleCardProps) {
  const styles = useStyles();
  const { pick, t } = useI18n();
  const title = pick(article.title_te, article.title_en);
  const a11y = `${t('home.topStory')}, ${useCardLabel(article)}`;
  const hasImage = !!absoluteMediaUrl(article.hero?.url ?? null);

  return (
    <Stagger index={index}>
      <CardShell article={article} a11y={a11y} elevated={false} style={[styles.card, styles.featuredCard]}>
        <View style={styles.featuredBody}>
          <EditorialGradient tone="featured" />
          <View style={styles.featuredEyebrow} aria-hidden>
            <View style={styles.featuredRule} />
            <T variant="ui" weight="bold" color="onOverlay">
              {t('home.topStory')}
            </T>
          </View>
          <View style={styles.featuredTopline} aria-hidden>
            <Flags article={article} />
            <Kicker article={article} />
          </View>
          <T variant="display" weight="heavy" color="onOverlay" scaled>
            {title}
          </T>
          {article.summary_te ? (
            <T variant="body" color="onOverlay" numberOfLines={2} style={styles.featuredSummary}>
              {article.summary_te}
            </T>
          ) : null}
          <MetaLine article={article} color="onOverlay" />
        </View>
        {hasImage ? <Thumb article={article} style={styles.featuredImage} /> : null}
      </CardShell>
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
      <CardShell article={article} a11y={a11y} style={styles.card}>
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
      </CardShell>
    </Stagger>
  );
});

/** Compact row for the latest rail: headline beside a small thumbnail. */
export const CompactCard = memo(function CompactCard({ article, index }: ArticleCardProps) {
  const styles = useStyles();
  const { pick } = useI18n();
  const title = pick(article.title_te, article.title_en);
  const a11y = useCardLabel(article);
  return (
    <Stagger index={index}>
      <Card elevated onPress={() => openArticle(article)} accessibilityLabel={a11y} style={styles.card}>
        <View style={styles.compactRow}>
          <View style={[styles.rowText, styles.compact]}>
            <Topline article={article} />
            <T variant="bodySmall" weight="semibold" numberOfLines={2}>
              {title}
            </T>
            <MetaLine article={article} />
          </View>
          <Thumb article={article} style={styles.compactImage} />
        </View>
      </Card>
    </Stagger>
  );
});

const useStyles = makeStyles((color) => ({
  card: { marginHorizontal: space.lg, marginTop: space.md },
  featuredCard: {
    overflow: 'hidden',
    borderColor: color.brandDeep,
    backgroundColor: color.inkDeep,
  },
  featuredBody: {
    position: 'relative',
    gap: space.sm,
    padding: space.lg,
    backgroundColor: color.inkDeep,
  },
  featuredEyebrow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  featuredRule: { width: 24, height: 3, backgroundColor: color.onOverlay, borderRadius: radius.pill },
  featuredTopline: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  featuredSummary: { opacity: 0.88 },
  featuredImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: color.placeholder },
  actionSurface: { backgroundColor: color.surface },
  topline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  fallback: { backgroundColor: color.placeholder },
  /* The image fills this box absolutely so the AI label can sit on top of it. */
  thumbBox: { overflow: 'hidden' },
  /* Top of the frame: the foot of the lead image already carries the flag
     strip. Both insets are set so a narrow row thumb ellipsizes the label
     instead of clipping it mid-word. */
  aiTag: { position: 'absolute', top: space.xs, left: space.xs, right: space.xs },

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

  /* CardShell is padding="none" for the lead's edge-to-edge image, so the
     row brings its own — same inset as leadBody. */
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.lg },
  rowText: { flex: 1, minWidth: 0, gap: space.xs },
  // 112x80 rather than 96x72: a denser-reading strip for the same row height,
  // and it is two numbers.
  rowImage: { width: 112, height: 80, borderRadius: radius.sm, backgroundColor: color.placeholder },

  compact: { gap: space.xs },
  compactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  compactImage: { width: 80, height: 60, borderRadius: radius.sm, backgroundColor: color.placeholder },
}));
