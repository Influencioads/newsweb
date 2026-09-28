import { Image } from 'expo-image';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  type SharedValue,
} from 'react-native-reanimated';

import { DUR, useMotion } from '@/lib/motion';
import { alpha, radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon } from '@/ui/Icon';
import { T } from '@/ui/Text';

/**
 * The radio-studio visuals the player surfaces share: the equalizer, the
 * waveform strip, the spinning disc, the broadcast rings and the ON AIR pill.
 *
 * All of it is decoration — hidden from assistive tech, and completely still
 * under reduced motion (the loops never start; what shows is frame zero). Each
 * visual is a periodic function of one looping 0→1 clock, so pausing freezes
 * it on the frame it was showing and resuming carries on from there.
 */
const TAU = Math.PI * 2;

function useLoop(active: boolean, period: number): SharedValue<number> {
  const m = useMotion();
  const clock = useSharedValue(0);
  useEffect(() => {
    if (!active || m.reduce) {
      cancelAnimation(clock);
      return;
    }
    // withRepeat restarts the timing from where it began; every consumer is
    // periodic in 1, so the jump from start + 1 back to start is invisible.
    clock.value = withRepeat(m.timing(clock.value + 1, period, { easing: Easing.linear }), -1, false);
  }, [active, m, period, clock]);
  return clock;
}

// ------------------------------------------------------------- equalizer --
/** Integer frequency pairs: whole cycles per loop keep every bar seamless. */
const EQ_FREQ = [
  [1, 3],
  [2, 1],
  [3, 2],
  [1, 2],
  [2, 3],
] as const;

function eqLevel(t: number, i: number): number {
  'worklet';
  const [a, b] = EQ_FREQ[i % EQ_FREQ.length];
  const v = 0.5 + 0.3 * Math.sin(TAU * a * t + i * 1.9) + 0.2 * Math.sin(TAU * b * t + i * 0.7);
  return 0.2 + 0.8 * v;
}

function EqBar({ clock, index, color, height, width }: { clock: SharedValue<number>; index: number; color: string; height: number; width: number }) {
  const level = useAnimatedStyle(() => ({ transform: [{ scaleY: eqLevel(clock.value, index) }] }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: width / 2, backgroundColor: color, transformOrigin: 'bottom' }, level]}
    />
  );
}

/** 3–5 bouncing bars while `playing`; frozen mid-bounce when paused. */
export function Equalizer({
  playing,
  color,
  bars = 4,
  height = 16,
}: {
  playing: boolean;
  /** A palette value. */
  color: string;
  bars?: 3 | 4 | 5;
  height?: number;
}) {
  const clock = useLoop(playing, 2200);
  return (
    <View aria-hidden pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height }}>
      {Array.from({ length: bars }, (_, i) => (
        <EqBar key={i} clock={clock} index={i} color={color} height={height} width={3} />
      ))}
    </View>
  );
}

// -------------------------------------------------------------- waveform --
const WAVE_BARS = 28;
/** A fixed, speech-like envelope — the same shape every time, not noise. */
const ENVELOPE = Array.from({ length: WAVE_BARS }, (_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)));

function WaveBar({ clock, index, color }: { clock: SharedValue<number>; index: number; color: string }) {
  const env = ENVELOPE[index];
  const level = useAnimatedStyle(() => ({
    transform: [{ scaleY: env * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(TAU * (1 + (index % 3)) * clock.value + index * 0.8))) }],
  }));
  return <Animated.View style={[waveBar.bar, { backgroundColor: color }, level]} />;
}

const waveBar = StyleSheet.create({ bar: { width: 4, height: '100%', borderRadius: radius.pill } });

/** The strip under the disc: the played part in gold, the rest dim. */
export function Waveform({ playing, progress }: { playing: boolean; progress: number }) {
  const color = useColors();
  const clock = useLoop(playing, 2600);
  const played = Math.round(progress * WAVE_BARS);
  return (
    <View aria-hidden pointerEvents="none" style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {ENVELOPE.map((_, i) => (
        <WaveBar key={i} clock={clock} index={i} color={i < played ? color.exclusive : alpha(color.onOverlay, 0.3)} />
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ disc --
const useDiscStyles = makeStyles((color) => ({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: color.brandDeep,
    borderWidth: 1,
    borderColor: alpha(color.onOverlay, 0.14),
  },
  groove: { position: 'absolute', borderWidth: 1, borderColor: alpha(color.onOverlay, 0.08) },
  label: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.exclusive },
  hole: { position: 'absolute', backgroundColor: color.inkDeep, borderWidth: 2, borderColor: alpha(color.onOverlay, 0.2) },
  spinner: { position: 'absolute' },
}));

/**
 * The record: the story's picture when there is one, otherwise a teal disc
 * with grooves and a gold radio label. Turns slowly while `spinning`.
 */
export function Disc({
  size,
  artwork,
  spinning = false,
  buffering = false,
}: {
  size: number;
  artwork?: string | null;
  spinning?: boolean;
  buffering?: boolean;
}) {
  const styles = useDiscStyles();
  const color = useColors();
  const m = useMotion();
  const clock = useLoop(spinning, 24_000);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${clock.value * 360}deg` }] }));
  const small = size < 64;
  const circle = (d: number) => ({ width: d, height: d, borderRadius: d / 2 });
  const label = Math.round(size * (small ? 1 : 0.36));

  return (
    <View aria-hidden pointerEvents="none" style={[circle(size), { alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View style={[styles.disc, circle(size), spin]}>
        {artwork ? (
          <Image source={{ uri: artwork }} style={circle(size)} contentFit="cover" transition={m.imageTransition} />
        ) : small ? (
          <Icon name="radio" size={20} color={color.exclusive} />
        ) : (
          <>
            {[0.9, 0.76, 0.62, 0.5].map((f) => (
              <View key={f} style={[styles.groove, circle(Math.round(size * f))]} />
            ))}
            <View style={[styles.label, circle(label)]}>
              <Icon name="radio" size={32} color={color.inkDeep} />
            </View>
          </>
        )}
        {small ? null : <View style={[styles.hole, circle(Math.round(size * 0.07))]} />}
      </Animated.View>
      {buffering ? <ActivityIndicator style={styles.spinner} color={color.onOverlay} size={small ? 'small' : 'large'} /> : null}
    </View>
  );
}

// ----------------------------------------------------------------- rings --
function Ring({ clock, shown, index, size, color }: { clock: SharedValue<number>; shown: SharedValue<number>; index: number; size: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const p = (clock.value + index / 3) % 1;
    return { opacity: shown.value * 0.5 * (1 - p), transform: [{ scale: 1 + 0.5 * p }] };
  });
  return (
    <Animated.View
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }, style]}
    />
  );
}

/** Three rings travelling outward from the disc while on air; they fade away on pause. */
export function BroadcastRings({ size, active }: { size: number; active: boolean }) {
  const color = useColors();
  const m = useMotion();
  const clock = useLoop(active, 2400);
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = m.timing(active ? 1 : 0, DUR.slow);
  }, [active, m, shown]);
  return (
    <View aria-hidden pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      {[0, 1, 2].map((i) => (
        <Ring key={i} clock={clock} shown={shown} index={i} size={size} color={color.exclusive} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- on air --
const usePillStyles = makeStyles((color) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: alpha(color.onOverlay, 0.12),
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.breaking },
}));

/** "ప్రసారంలో" with a dot that breathes while the bulletin plays. */
export function OnAirPill({ label, live }: { label: string; live: boolean }) {
  const styles = usePillStyles();
  const clock = useLoop(live, 1400);
  const breathe = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(TAU * clock.value)) }));
  return (
    <View style={styles.pill} accessible accessibilityLabel={label}>
      <Animated.View aria-hidden style={[styles.dot, breathe]} />
      <T variant="meta" weight="bold" color="onOverlay">
        {label}
      </T>
    </View>
  );
}
