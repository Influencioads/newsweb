import { type ReactNode } from 'react';
import { ActivityIndicator, View, type DimensionValue } from 'react-native';

import { ApiError } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { radius, space, type, type Palette } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Skeleton, SkeletonCard, SkeletonFeed } from '@/ui/Skeleton';
import { T } from '@/ui/Text';

/**
 * Loading / error / empty states — every screen ships all three (doc §31).
 *
 * `LoadingState` is a spinner by default; the skeleton variants mirror the
 * feed / list / article geometry so content lands without a jump. `ErrorState`
 * reads an `ApiError` (offline vs 404 vs generic) and speaks the reader's
 * language; `EmptyState` keeps the legacy `message` prop as an alias of `body`.
 */

export type LoadingVariant = 'spinner' | 'feed' | 'article' | 'list';

export interface LoadingStateProps {
  variant?: LoadingVariant;
  /** Skeleton rows for `feed` / `list`. */
  rows?: number;
}

const ARTICLE_LINES: DimensionValue[] = ['100%', '92%', '96%', '70%', '100%', '88%'];

export function LoadingState({ variant = 'spinner', rows }: LoadingStateProps) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();

  if (variant === 'feed') return <SkeletonFeed rows={rows} />;
  if (variant === 'list') return <SkeletonFeed rows={rows ?? 8} lead={false} />;
  if (variant === 'article') {
    return (
      <View accessible accessibilityLabel={t('state.loading')} accessibilityState={{ busy: true }}>
        <SkeletonCard variant="lead" />
        <View style={styles.lines}>
          {ARTICLE_LINES.map((w, i) => (
            <Skeleton key={i} width={w} height={type.body.fontSize} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.box} accessible accessibilityLabel={t('state.loading')} accessibilityState={{ busy: true }}>
      <ActivityIndicator color={color.brand} size="large" />
      <T variant="bodySmall" color="muted" align="center">
        {t('state.loading')}
      </T>
    </View>
  );
}

export type ErrorKind = 'generic' | 'network' | 'notFound';

export interface ErrorStateProps {
  /** The thrown value — an `ApiError` picks the kind and the reader's message. */
  error?: unknown;
  onRetry?: () => void;
  /** Overrides the body copy. */
  message?: string;
  kind?: ErrorKind;
  /** `flex: 1` and centre in the parent (default); false for an inline block. */
  fill?: boolean;
}

const ERROR_LOOK: Record<ErrorKind, { icon: IconName; fg: keyof Palette; bg: keyof Palette }> = {
  generic: { icon: 'alertCircle', fg: 'breaking', bg: 'breakingTint' },
  network: { icon: 'wifiOff', fg: 'partial', bg: 'partialTint' },
  notFound: { icon: 'inbox', fg: 'muted', bg: 'paperSub' },
};

function inferKind(error: unknown): ErrorKind {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK_ERROR') return 'network';
    if (error.status === 404) return 'notFound';
  }
  return 'generic';
}

export function ErrorState({ error, onRetry, message, kind, fill = true }: ErrorStateProps) {
  const styles = useStyles();
  const color = useColors();
  const { t, language } = useI18n();
  const k = kind ?? inferKind(error);
  const look = ERROR_LOOK[k];
  const title = k === 'network' ? t('state.offline') : k === 'notFound' ? t('state.notFound') : t('state.errorTitle');
  const apiMessage =
    error instanceof ApiError ? (language === 'te' ? error.messageTe : error.messageEn) || undefined : undefined;
  const body = message ?? apiMessage ?? (k === 'notFound' ? t('state.notFoundBody') : t('state.error'));

  return (
    <View style={[styles.box, fill && styles.fill]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={[styles.bubble, { backgroundColor: color[look.bg] }]}>
        <Icon name={look.icon} size={28} color={color[look.fg]} />
      </View>
      <T variant="headlineSm" weight="bold" align="center" style={styles.text}>
        {title}
      </T>
      <T variant="body" color="muted" align="center" style={styles.text}>
        {body}
      </T>
      {onRetry ? (
        <View style={styles.action}>
          <Button label={t('state.retry')} icon="refreshCw" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

export interface EmptyStateProps {
  icon?: IconName;
  title?: string;
  body?: string;
  /** Legacy alias of `body`. */
  message?: string;
  /** A Button / link rendered under the copy. */
  action?: ReactNode;
}

export function EmptyState({ icon = 'inbox', title, body, message, action }: EmptyStateProps) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const text = body ?? message;
  // A bare `message` (the legacy call) stands alone; the default title only pairs with the default body.
  const heading = title ?? (text === undefined ? t('state.emptyTitle') : undefined);

  return (
    <View style={styles.box}>
      <View style={styles.bubble}>
        <Icon name={icon} size={28} color={color.muted} />
      </View>
      {heading ? (
        <T variant="headlineSm" weight="bold" align="center" style={styles.text}>
          {heading}
        </T>
      ) : null}
      <T variant="body" color="muted" align="center" style={styles.text}>
        {text ?? t('state.empty')}
      </T>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  fill: { flex: 1 },
  bubble: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: color.paperSub,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  text: { maxWidth: 320 },
  action: { marginTop: space.sm },
  lines: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md },
}));
