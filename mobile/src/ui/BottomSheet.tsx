import { useEffect, useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useI18n } from '@/lib/i18n';
import { DUR, EASE, SPRING, useMotion } from '@/lib/motion';
import { alpha, radius, shadow, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Button, IconButton } from '@/ui/Button';
import { PressableScale } from '@/ui/PressableScale';
import { T, type TLang } from '@/ui/Text';

/**
 * BottomSheet — the app's one modal surface (share, font size, confirms,
 * pickers).
 *
 * An RN `Modal` (so it sits above navigators and the Android back button
 * closes it via `onRequestClose`) with a fading scrim and a sheet that
 * slides up from the bottom edge. The grab handle + header row is a pan
 * area: drag down past 80pt (or flick) to dismiss; the content below scrolls
 * on its own. `ConfirmSheet` is the two-button variant for destructive or
 * important decisions.
 */
export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  /** `auto` fits content (max 85% of the screen); `half` / `full` are fixed. */
  snap?: 'auto' | 'half' | 'full';
  /** Accessibility label for the scrim and close button; defaults to t('ui.close'). */
  closeLabel?: string;
  lang?: TLang;
  testID?: string;
}

const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 800;

const useStyles = makeStyles((color) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: alpha(color.overlay, 0.55) },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow('sheet', color),
  },
  grab: { alignItems: 'center', paddingTop: space.sm },
  handle: { width: 36, height: 4, borderRadius: radius.pill, backgroundColor: color.ruleStrong },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingTop: space.xs,
    paddingBottom: space.sm,
  },
  title: { flex: 1 },
  body: { paddingHorizontal: space.lg, paddingTop: space.xs },
  actions: { flexDirection: 'row', gap: space.md, paddingTop: space.lg },
  action: { flex: 1 },
}));

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  snap = 'auto',
  closeLabel,
  lang = 'auto',
  testID,
}: BottomSheetProps) {
  const styles = useStyles();
  const m = useMotion();
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const { t } = useI18n();
  const close = closeLabel ?? t('ui.close');

  const translateY = useSharedValue(0);

  // Declared before the effect below: the compiler forbids writing a shared
  // value from a callback once an effect has touched it.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        scheduleOnRN(onClose);
      } else {
        translateY.value = withSpring(0, SPRING.sheet);
      }
    });

  // The Modal outlives `open` by one exit animation so SlideOutDown can play:
  // `mounted` trails `open` through a timer (0ms on open / reduced motion).
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) translateY.value = 0;
    const id = setTimeout(() => setMounted(open), open || m.reduce ? 0 : DUR.slow);
    return () => clearTimeout(id);
  }, [open, m.reduce, translateY]);

  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const sizing =
    snap === 'full'
      ? { height: screen - insets.top - space.xl }
      : snap === 'half'
        ? { height: Math.round(screen * 0.5) }
        : { maxHeight: Math.round(screen * 0.85) };

  return (
    <Modal
      visible={open || mounted}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
      testID={testID}
    >
      {/* A Modal's native view sits outside the app's GestureHandlerRootView; it needs its own for the pan. */}
      <GestureHandlerRootView style={styles.root}>
        {open ? (
          <Animated.View entering={m.fadeIn()} exiting={m.exiting()} style={styles.scrim}>
            <PressableScale
              onPress={onClose}
              haptic={false}
              scaleTo={1}
              accessibilityLabel={close}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
        {open ? (
          <Animated.View
            entering={m.reduce ? undefined : SlideInDown.duration(DUR.slow).easing(EASE.emphasized)}
            exiting={m.reduce ? undefined : SlideOutDown.duration(DUR.base).easing(EASE.standard)}
            style={[styles.sheet, sizing, { paddingBottom: Math.max(insets.bottom, space.lg) }, dragStyle]}
            accessibilityViewIsModal
          >
            <GestureDetector gesture={pan}>
              <View>
                <View style={styles.grab}>
                  <View style={styles.handle} />
                </View>
                <View style={styles.header}>
                  <View style={styles.title}>
                    {title ? (
                      <T variant="headlineMd" weight="bold" lang={lang} accessibilityRole="header">
                        {title}
                      </T>
                    ) : null}
                  </View>
                  <IconButton name="x" label={close} onPress={onClose} />
                </View>
              </View>
            </GestureDetector>
            <ScrollView bounces={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </Animated.View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

export interface ConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  /** Defaults to t('ui.confirm'). */
  confirmLabel?: string;
  /** Defaults to t('ui.cancel'). */
  cancelLabel?: string;
  /** `danger` paints the confirm button breaking (amber). */
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  pending?: boolean;
  lang?: TLang;
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  onConfirm,
  pending = false,
  lang = 'auto',
}: ConfirmSheetProps) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <BottomSheet open={open} onClose={onClose} title={title} lang={lang}>
      {body ? (
        <T color="inkSoft" lang={lang}>
          {body}
        </T>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={cancelLabel ?? t('ui.cancel')}
          variant="secondary"
          onPress={onClose}
          disabled={pending}
          lang={lang}
          style={styles.action}
        />
        <Button
          label={confirmLabel ?? t('ui.confirm')}
          variant={tone}
          onPress={onConfirm}
          pending={pending}
          haptic={tone === 'danger' ? 'warning' : 'medium'}
          lang={lang}
          style={styles.action}
        />
      </View>
    </BottomSheet>
  );
}
