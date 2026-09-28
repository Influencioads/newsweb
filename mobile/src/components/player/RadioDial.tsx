import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useI18n } from '@/lib/i18n';
import { SPRING, useMotion } from '@/lib/motion';
import { alpha, radius, space, TAP } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * RadioDial — the bulletin day drawn as a tuner: a frequency scale from 07:00
 * to 21:00 with a tick every half hour, the seven bulletin slots as stations,
 * and a gold needle that glides to the one playing (or, when nothing plays,
 * the latest one on air).
 *
 * On-air slots tune in — they start the day's queue there; slots not on air
 * yet are dimmed and inert. The stations alternate between two rows, so a
 * button only ever sits beside the station two slots away. "Play all" runs
 * the whole day from 07:00. The scale and the needle are decoration; the slot
 * buttons carry the meaning.
 */
export const BULLETIN_SLOTS = [7, 9, 13, 15, 17, 19, 21] as const;

const FIRST = BULLETIN_SLOTS[0];
const SPAN = BULLETIN_SLOTS[BULLETIN_SLOTS.length - 1] - FIRST;
/** Half-hour ticks across the span. */
const TICKS = Array.from({ length: SPAN * 2 + 1 }, (_, i) => FIRST + i / 2);
/** Hours between the closest two stations in one row (every other slot); the slots are not evenly spaced. */
const ROW_GAP = Math.min(...BULLETIN_SLOTS.slice(2).map((slot, i) => slot - BULLETIN_SLOTS[i]));
const EDGE = 24;
const NEEDLE = 2;
const BUTTON_TOP = 44;

export function RadioDial({
  live,
  names = {},
  active,
  onSelect,
  onPlayAll,
}: {
  /** Slots on air today. */
  live: number[];
  /** Each on-air slot's name, for the screen-reader label. */
  names?: Record<number, string | null>;
  /** Where the needle rests: the slot playing, else the latest on air. */
  active: number | null;
  onSelect: (slot: number) => void;
  onPlayAll?: () => void;
}) {
  const styles = useStyles();
  const m = useMotion();
  const { t } = useI18n();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const settled = useRef(false);

  const span = Math.max(0, width - EDGE * 2);
  const at = (hour: number) => EDGE + ((hour - FIRST) / SPAN) * span;
  // Slots 2h apart are only ~39dp apart on a 375dp phone (dial 375 − 32 screen
  // − 24 card = 319dp, span 271dp), under the 44dp tap target. Staggered, a
  // button's row neighbour is ROW_GAP (4h, ~77dp) away, so 56dp never overlaps.
  const button = Math.min(56, (ROW_GAP / SPAN) * span);

  useEffect(() => {
    if (!width || active == null) return;
    const target = EDGE + ((active - FIRST) / SPAN) * Math.max(0, width - EDGE * 2) - NEEDLE / 2;
    // First measurement parks the needle; later changes glide.
    x.value = settled.current ? m.spring(target, SPRING.sheet) : target;
    settled.current = true;
  }, [active, width, m, x]);

  const needle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <Card tone="ink" padding="sm" style={styles.card}>
      <View style={styles.head}>
        <T variant="headlineSm" weight="bold" color="onOverlay" accessibilityRole="header" style={styles.title}>
          {t('player.dial')}
        </T>
        {onPlayAll ? <Button variant="inverse" icon="play" label={t('player.playAll')} onPress={onPlayAll} /> : null}
      </View>

      <View style={styles.dial} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width ? (
          <>
            <View aria-hidden pointerEvents="none" style={styles.baseline} />
            {TICKS.map((hour) => {
              const major = (BULLETIN_SLOTS as readonly number[]).includes(hour);
              return (
                <View
                  key={hour}
                  aria-hidden
                  pointerEvents="none"
                  style={[styles.tick, major ? styles.major : styles.minor, { left: at(hour) - 0.5 }]}
                />
              );
            })}
            <Animated.View
              aria-hidden
              pointerEvents="none"
              style={[styles.needle, { opacity: active == null ? 0 : 1 }, needle]}
            >
              <View style={styles.knob} />
            </Animated.View>
            {BULLETIN_SLOTS.map((slot, i) => {
              const onAir = live.includes(slot);
              const on = slot === active;
              const clock = `${String(slot).padStart(2, '0')}:00`;
              return (
                <PressableScale
                  key={slot}
                  haptic="select"
                  disabled={!onAir}
                  accessibilityLabel={[clock, names[slot], onAir ? t('player.onAir') : t('player.offAir')]
                    .filter(Boolean)
                    .join(', ')}
                  accessibilityState={{ selected: on, disabled: !onAir }}
                  onPress={() => onSelect(slot)}
                  style={[styles.slot, { top: BUTTON_TOP + (i % 2) * TAP, left: at(slot) - button / 2, width: button }]}
                >
                  <T
                    variant="meta"
                    weight={on ? 'bold' : 'semibold'}
                    lang="en"
                    color={on ? 'exclusive' : onAir ? 'onOverlay' : 'mutedLight'}
                    align="center"
                    numberOfLines={1}
                  >
                    {clock}
                  </T>
                </PressableScale>
              );
            })}
          </>
        ) : null}
      </View>

      <T variant="meta" color="mutedLight">
        {`${t('player.onAir')}: ${live.length}/${BULLETIN_SLOTS.length}`}
      </T>
    </Card>
  );
}

const useStyles = makeStyles((color) => ({
  card: { marginBottom: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1 },
  dial: { height: BUTTON_TOP + TAP * 2 },
  baseline: {
    position: 'absolute',
    top: 28,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: alpha(color.onOverlay, 0.18),
  },
  tick: { position: 'absolute', width: 1 },
  minor: { top: 20, height: 8, backgroundColor: alpha(color.onOverlay, 0.25) },
  major: { top: 10, height: 18, backgroundColor: alpha(color.onOverlay, 0.6) },
  needle: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: NEEDLE,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: color.exclusive,
    alignItems: 'center',
  },
  knob: {
    width: 10,
    height: 10,
    marginTop: -2,
    borderRadius: radius.pill,
    backgroundColor: color.exclusive,
  },
  slot: { position: 'absolute', alignItems: 'center', borderRadius: radius.sm },
}));
