import { router, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Disc, Equalizer } from '@/components/player/PlayerVisuals';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { alpha, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { usePlayer } from '@/stores/player';
import { IconButton } from '@/ui/Button';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * MiniPlayer — the dock that stays on screen while anything is loaded in the
 * global player, so a reader can leave the bulletin and keep listening.
 *
 * It sits in normal flow, never over content: on tab routes the TabBar
 * renders it above the tab row (placement "tabs"), on stack routes the root
 * layout renders it under the <Stack/> with the home-indicator inset
 * (placement "stack") — exactly one of the two shows for any route, and
 * neither on the Now Playing route itself. Like the tab bar, it steps aside
 * while the keyboard is up.
 *
 * Constant-dark (inkDeep) in both themes, like the Now Playing screen it
 * opens: disc, equalizer, one-line Telugu title, the kind as subtitle, a thin
 * gold progress line, play/pause, next when there is one, close.
 */

/** The dock above the tab row: its progress line plus a row around one 44pt control. Toasts clear it. */
export const DOCK_HEIGHT = 2 + TAP + space.xs * 2;

export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // iOS announces the slide-in ahead of time; Android only has the Did* pair.
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

export function MiniPlayer({ placement }: { placement: 'tabs' | 'stack' }) {
  const root: string | undefined = useSegments()[0];
  const loaded = usePlayer((s) => s.queue.length > 0);
  const keyboard = useKeyboardShown();
  const here = placement === 'tabs' ? root === '(tabs)' : root !== '(tabs)' && root !== 'player';
  if (!loaded || !here || keyboard) return null;
  return <Dock placement={placement} />;
}

function Dock({ placement }: { placement: 'tabs' | 'stack' }) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const track = usePlayer((s) => s.queue[s.index]);
  const hasNext = usePlayer((s) => s.index < s.queue.length - 1);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const failed = usePlayer((s) => s.error !== null);
  const progress = usePlayer((s) => (s.duration > 0 ? Math.min(1, s.elapsed / s.duration) : 0));
  const docked = usePlayer((s) => s.docked);
  const { toggle, next, close } = usePlayer.getState();

  // The slide-up plays once per listening session, not on every hop between
  // the tab dock and the stack dock.
  useEffect(() => {
    if (!docked) usePlayer.setState({ docked: true });
  }, [docked]);

  if (!track) return null;

  return (
    <Animated.View
      entering={docked ? undefined : m.slideUp()}
      style={[styles.dock, placement === 'stack' && { paddingBottom: insets.bottom }]}
    >
      <View aria-hidden style={styles.line}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <View style={styles.row}>
        <PressableScale
          haptic="select"
          scaleTo={0.99}
          accessibilityLabel={`${t('player.open')}: ${track.title}`}
          onPress={() => router.push('/player')}
          style={styles.body}
        >
          <Disc size={44} artwork={track.artwork} buffering={buffering} />
          <View style={styles.text}>
            <View style={styles.titleRow}>
              <Equalizer playing={playing && !buffering} color={color.exclusive} bars={3} height={12} />
              <T variant="bodySmall" weight="semibold" color="onOverlay" lang="te" numberOfLines={1} style={styles.title}>
                {track.title}
              </T>
            </View>
            <T variant="meta" color="mutedLight" numberOfLines={1}>
              {track.subtitle}
            </T>
          </View>
        </PressableScale>
        <IconButton
          name={failed ? 'refreshCw' : playing ? 'pause' : 'play'}
          label={failed ? t('state.retry') : playing ? t('ui.pause') : t('ui.play')}
          variant="inverse"
          haptic="medium"
          onPress={toggle}
        />
        {hasNext ? <IconButton name="skipForward" label={t('player.next')} color={color.onOverlay} onPress={next} /> : null}
        <IconButton name="x" label={t('player.close')} color={color.onOverlay} onPress={close} />
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((color) => ({
  dock: {
    backgroundColor: color.inkDeep,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: alpha(color.onOverlay, 0.18),
  },
  line: { height: 2, backgroundColor: alpha(color.onOverlay, 0.12) },
  fill: { height: 2, backgroundColor: color.exclusive },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.md,
    paddingRight: space.sm,
    paddingVertical: space.xs,
  },
  body: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, minWidth: 0 },
}));
