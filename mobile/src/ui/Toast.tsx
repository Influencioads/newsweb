import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { alpha, radius, shadow, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useToastStore, type ToastKind, type ToastOptions } from '@/stores/toast';
import { IconButton } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * Toast — transient notices stacked above the tab bar.
 *
 * Mount `<ToastHost>` once in the root layout (after the navigator, so it
 * paints on top). Screens call `useToast().success(...)` / `.error(err)`:
 * an `ApiError` resolves to its Telugu/English message by the reader's
 * language, anything else falls back to the generic i18n string. Each toast
 * is an ink-deep bar with a kind glyph, the message, an optional action and a
 * 44pt dismiss button, announced politely to assistive tech.
 */
const ICON: Record<ToastKind, IconName> = {
  success: 'checkCircle2',
  error: 'alertCircle',
  info: 'info',
};

/** Distance from the bottom inset: clears the 56pt tab bar plus a gap. */
const ABOVE_TAB_BAR = 72;

const useStyles = makeStyles((color) => ({
  host: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    gap: space.sm,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.inkDeep,
    borderWidth: 1,
    borderColor: alpha(color.onOverlay, 0.16),
    ...shadow('raised', color),
  },
  message: { flex: 1, paddingVertical: space.sm },
  action: { paddingHorizontal: space.md, borderRadius: radius.sm },
}));

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  const m = useMotion();
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const last = toasts[toasts.length - 1];

  useEffect(() => {
    // accessibilityLiveRegion is Android-only; VoiceOver needs an explicit announcement.
    if (last) AccessibilityInfo.announceForAccessibility(last.message);
  }, [last]);

  if (toasts.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + ABOVE_TAB_BAR }]}>
      {toasts.map((toast, i) => (
        <Animated.View
          key={toast.id}
          entering={m.entering(i)}
          exiting={m.exiting()}
          layout={m.layout}
          style={styles.toast}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Icon name={ICON[toast.kind]} size={20} color={color.onOverlay} />
          <T color="onOverlay" style={styles.message}>
            {toast.message}
          </T>
          {toast.action ? (
            <PressableScale
              onPress={() => {
                toast.action?.onPress();
                dismiss(toast.id);
              }}
              accessibilityLabel={toast.action.label}
              style={styles.action}
            >
              <T variant="ui" weight="semibold" color="onOverlay" numberOfLines={1}>
                {toast.action.label}
              </T>
            </PressableScale>
          ) : null}
          <IconButton name="x" label={t('ui.dismiss')} color={color.onOverlay} onPress={() => dismiss(toast.id)} />
        </Animated.View>
      ))}
    </View>
  );
}

export interface ToastApi {
  /** A string, an `ApiError`, or anything — non-strings fall back to the generic message. */
  success: (message: unknown, opts?: ToastOptions) => void;
  error: (error: unknown, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
}

export function useToast(): ToastApi {
  const push = useToastStore((s) => s.push);
  const { t, language } = useI18n();

  const describe = (input: unknown, fallback: string): string => {
    if (typeof input === 'string' && input) return input;
    if (input instanceof ApiError) return language === 'en' ? input.messageEn : input.messageTe;
    return fallback;
  };

  return {
    success: (message, opts) => {
      push('success', describe(message, t('state.saved')), opts);
    },
    error: (error, opts) => {
      push('error', describe(error, t('state.error')), opts);
    },
    info: (message, opts) => {
      push('info', message, opts);
    },
  };
}
