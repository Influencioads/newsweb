import { router, useNavigation, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';

import { BroadcastRings, Disc, Equalizer, OnAirPill, Waveform } from '@/components/player/PlayerVisuals';
import { useI18n } from '@/lib/i18n';
import { alpha, radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { formatTime, SKIP_SECONDS, SPEEDS, usePlayer, type Track } from '@/stores/player';
import { Button, IconButton } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';

/**
 * Now Playing — the full-screen face of the global audio player, dressed as a
 * radio studio on a constant-dark ground (inkDeep in both themes).
 *
 * Centre stage is the disc: the story's picture or a teal record with a gold
 * radio label, turning slowly while it plays, with broadcast rings pulsing
 * out from it; bulletins add an ON AIR pill. Under it a waveform strip that
 * doubles as progress (played bars in gold), the Telugu title, a real slider
 * scrubber (drag or tap; screen readers adjust it in 15s steps), the
 * transport, the four speeds, "Read the story" and the queue.
 *
 * Presented as a modal route over whatever was open. The chevron, the back
 * button, iOS's swipe-down and (elsewhere) a downward fling on the header all
 * minimise it back to the dock; playback never stops on the way out.
 */
const DISC_MAX = 232;

function minimise() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Whether a stack route is the page `href` names: the same file route with the same params. */
function isRoute(route: { name: string; params?: object } | undefined, href: Href): boolean {
  if (!route) return false;
  const target = typeof href === 'string' ? { pathname: href, params: {} } : href;
  const params: Record<string, unknown> = { ...route.params };
  return (
    route.name === target.pathname.replace(/^\//, '') &&
    Object.entries(target.params ?? {}).every(([k, v]) => params[k] === v)
  );
}

export default function PlayerScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const elapsed = usePlayer((s) => s.elapsed);
  const duration = usePlayer((s) => s.duration);
  const rate = usePlayer((s) => s.rate);
  const error = usePlayer((s) => s.error);
  const { toggle, next, prev, skip, seek, setRate, retry, close, playQueue } = usePlayer.getState();
  const track: Track | undefined = queue[index];

  // iOS dismisses the modal sheet natively; elsewhere a fling down the
  // header does the same job.
  const fling = Gesture.Fling()
    .direction(Directions.DOWN)
    .enabled(Platform.OS !== 'ios')
    .runOnJS(true)
    .onStart(minimise);

  const disc = Math.min(DISC_MAX, Math.round(width * 0.58));
  const total = duration || track?.durationSec || 0;
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;
  const live = playing && !buffering;

  const header = (
    <GestureDetector gesture={fling}>
      <View style={styles.header}>
        <IconButton name="chevronDown" label={t('player.minimise')} color={color.onOverlay} onPress={minimise} />
        <T variant="ui" weight="semibold" color="mutedLight" align="center" style={styles.headerTitle} numberOfLines={1}>
          {t('player.nowPlaying')}
        </T>
        {track ? (
          <IconButton
            name="x"
            label={t('player.close')}
            color={color.onOverlay}
            onPress={() => {
              minimise();
              close();
            }}
          />
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
    </GestureDetector>
  );

  return (
    <Screen edges={['top', 'bottom']} style={styles.page}>
      <StatusBar style="light" />
      {header}

      {!track ? (
        <View style={styles.empty}>
          <Disc size={disc} />
          <T variant="body" color="onOverlay" align="center">
            {t('player.nothing')}
          </T>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {track.kind === 'bulletin' ? <OnAirPill label={t('player.onAir')} live={live} /> : null}

          <View style={[styles.stage, { height: Math.round(disc * 1.45) }]}>
            <BroadcastRings size={disc} active={live} />
            <Disc size={disc} artwork={track.artwork} spinning={live} buffering={buffering} />
          </View>

          <Waveform playing={live} progress={progress} />

          <View style={styles.titles}>
            <T variant="headlineMd" weight="bold" color="onOverlay" lang="te" align="center" numberOfLines={3}>
              {track.title}
            </T>
            <T variant="meta" color="mutedLight" align="center" numberOfLines={1}>
              {track.subtitle}
            </T>
          </View>

          {error ? (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <Icon name="alertCircle" size={20} color={color.exclusive} />
              <T variant="bodySmall" color="onOverlay" style={styles.errorText}>
                {t('player.error')}
              </T>
              <Button variant="inverse" icon="refreshCw" label={t('state.retry')} onPress={retry} />
            </View>
          ) : null}

          <Scrubber elapsed={elapsed} duration={total} onSeek={seek} onSkip={skip} />

          <View style={styles.transport}>
            <IconButton name="skipBack" label={t('player.previous')} size={48} color={color.onOverlay} onPress={prev} />
            <SkipButton icon="rotateCcw" label={t('player.back15')} onPress={() => skip(-SKIP_SECONDS)} />
            <PressableScale
              haptic="medium"
              minHeight={72}
              accessibilityLabel={error ? t('state.retry') : playing ? t('ui.pause') : t('ui.play')}
              accessibilityState={{ busy: buffering }}
              onPress={toggle}
              style={styles.play}
            >
              {buffering ? (
                <ActivityIndicator color={color.inkDeep} />
              ) : (
                <Icon name={error ? 'refreshCw' : playing ? 'pause' : 'play'} size={32} color={color.inkDeep} strokeWidth={2} />
              )}
            </PressableScale>
            <SkipButton icon="rotateCw" label={t('player.forward15')} onPress={() => skip(SKIP_SECONDS)} />
            <IconButton
              name="skipForward"
              label={t('player.next')}
              size={48}
              color={color.onOverlay}
              disabled={index >= queue.length - 1}
              onPress={next}
            />
          </View>

          <View style={styles.speeds} accessibilityRole="radiogroup" accessibilityLabel={t('ui.speed')}>
            {SPEEDS.map((s) => (
              <PressableScale
                key={s}
                haptic="select"
                accessibilityRole="radio"
                accessibilityLabel={`${t('ui.speed')} ${s}x`}
                accessibilityState={{ checked: rate === s }}
                onPress={() => setRate(s)}
                style={[styles.speed, rate === s && styles.speedOn]}
              >
                <T variant="ui" weight="semibold" lang="en" color={rate === s ? 'inkDeep' : 'onOverlay'}>
                  {`${s}x`}
                </T>
              </PressableScale>
            ))}
          </View>

          {track.href ? (
            <PressableScale
              accessibilityRole="link"
              haptic="select"
              onPress={() => {
                const href = track.href;
                if (!href) return;
                // Not dismissTo: it pops to the nearest screen of that *name*
                // and rewrites its params (another article becomes this one).
                // Reuse only the screen right under Now Playing; else open it.
                const state = navigation.getState();
                const under = state?.routes[state.index - 1];
                minimise();
                if (!isRoute(under, href)) router.push(href);
              }}
              style={styles.story}
            >
              <Icon name="bookOpen" size={20} color={color.onOverlay} />
              <T variant="ui" weight="semibold" color="onOverlay">
                {t('player.readStory')}
              </T>
              <Icon name="chevronRight" size={16} color={color.onOverlay} />
            </PressableScale>
          ) : null}

          {queue.length > 1 ? (
            <View style={styles.queue}>
              <T variant="headlineSm" weight="bold" color="onOverlay" accessibilityRole="header">
                {t('player.upNext')}
              </T>
              {queue.map((item, i) => {
                const on = i === index;
                return (
                  <PressableScale
                    key={item.id}
                    haptic="select"
                    scaleTo={0.99}
                    minHeight={56}
                    accessibilityLabel={`${i + 1}. ${item.title}`}
                    accessibilityState={{ selected: on }}
                    onPress={() => (on ? toggle() : playQueue(queue, i))}
                    style={[styles.row, on && styles.rowOn]}
                  >
                    <View style={styles.rowMark}>
                      {on ? (
                        <Equalizer playing={live} color={color.exclusive} />
                      ) : (
                        <T variant="ui" weight="semibold" color="mutedLight" lang="en">
                          {String(i + 1)}
                        </T>
                      )}
                    </View>
                    <View style={styles.rowText}>
                      <T variant="bodySmall" weight={on ? 'semibold' : 'regular'} color="onOverlay" lang="te" numberOfLines={2}>
                        {item.title}
                      </T>
                      <T variant="meta" color="mutedLight" numberOfLines={1}>
                        {item.subtitle}
                      </T>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

/** A 15-second skip: the curved arrow with the "15" set inside it. */
function SkipButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const styles = useStyles();
  const color = useColors();
  return (
    <PressableScale haptic="light" minHeight={48} accessibilityLabel={label} onPress={onPress} style={styles.skip}>
      <Icon name={icon} size={32} color={color.onOverlay} />
      <T variant="eyebrow" color="onOverlay" lang="en" style={styles.skipText}>
        {String(SKIP_SECONDS)}
      </T>
    </PressableScale>
  );
}

const THUMB = 14;
/** Keyboard steps for the scrubber on web, where react-native-web drops accessibilityActions. */
const KEY_STEP: Record<string, number> = {
  ArrowRight: SKIP_SECONDS,
  ArrowUp: SKIP_SECONDS,
  ArrowLeft: -SKIP_SECONDS,
  ArrowDown: -SKIP_SECONDS,
};

/**
 * The scrubber: a real slider. Drag or tap the track to seek; screen readers
 * get an adjustable control that steps 15 seconds and speaks "1:05 / 3:10".
 * While a finger is down the thumb follows the finger, not the clock.
 */
function Scrubber({
  elapsed,
  duration,
  onSeek,
  onSkip,
}: {
  elapsed: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onSkip: (delta: number) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const at = drag ?? elapsed;
  const pct = duration > 0 ? Math.min(1, Math.max(0, at / duration)) : 0;
  const toTime = (x: number) => (width > 0 && duration > 0 ? Math.min(duration, Math.max(0, (x / width) * duration)) : 0);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onUpdate((e) => setDrag(toTime(e.x)))
    .onEnd((e) => onSeek(toTime(e.x)))
    .onFinalize(() => setDrag(null));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => onSeek(toTime(e.x)));
  // react-native-web gives a slider no tab stop and never fires
  // onAccessibilityAction: make it focusable and step it from the keyboard.
  const web =
    Platform.OS === 'web'
      ? {
          focusable: true,
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            if (KEY_STEP[e.key]) onSkip(KEY_STEP[e.key]);
            else if (e.key === 'Home') onSeek(0);
            else if (e.key === 'End') onSeek(duration);
            else return;
            e.preventDefault();
          },
        }
      : null;

  return (
    <View style={styles.scrubber}>
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('player.position')}
          // aria-value* rather than accessibilityValue: native reads both, react-native-web only these.
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(at)}
          aria-valuetext={`${formatTime(at)} / ${formatTime(duration)}`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onSkip(e.nativeEvent.actionName === 'increment' ? SKIP_SECONDS : -SKIP_SECONDS)}
          {...web}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={styles.scrub}
        >
          <View style={styles.track}>
            <View style={[styles.done, { width: `${pct * 100}%` }]} />
          </View>
          <View style={[styles.thumb, { left: pct * width - THUMB / 2 }, drag !== null && styles.thumbHeld]} />
        </View>
      </GestureDetector>
      <View style={styles.times} aria-hidden>
        <T variant="meta" color="mutedLight" lang="en">
          {formatTime(at)}
        </T>
        <T variant="meta" color="mutedLight" lang="en">
          {`-${formatTime(Math.max(0, duration - at))}`}
        </T>
      </View>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  page: { flex: 1, backgroundColor: color.inkDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    minHeight: 56,
  },
  headerTitle: { flex: 1 },
  headerSpacer: { width: TAP },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, padding: space.xl },
  body: { paddingHorizontal: space.xl, paddingBottom: space.xxl, gap: space.lg },
  stage: { alignItems: 'center', justifyContent: 'center' },
  titles: { gap: space.xs },
  error: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: alpha(color.onOverlay, 0.08),
  },
  errorText: { flex: 1, minWidth: 140 },
  scrubber: { gap: space.xs },
  scrub: { height: TAP, justifyContent: 'center' },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: alpha(color.onOverlay, 0.2), overflow: 'hidden' },
  done: { height: 4, backgroundColor: color.exclusive },
  thumb: {
    position: 'absolute',
    top: (TAP - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: color.onOverlay,
  },
  thumbHeld: { transform: [{ scale: 1.3 }] },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  play: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.onOverlay,
  },
  skip: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  skipText: { position: 'absolute', letterSpacing: 0 },
  speeds: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  speed: {
    minWidth: TAP,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: alpha(color.onOverlay, 0.3),
    alignItems: 'center',
  },
  speedOn: { backgroundColor: color.onOverlay, borderColor: color.onOverlay },
  story: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: alpha(color.onOverlay, 0.3),
  },
  queue: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  rowOn: { backgroundColor: alpha(color.onOverlay, 0.08) },
  rowMark: { width: 24, alignItems: 'center' },
  rowText: { flex: 1, minWidth: 0, paddingVertical: space.xs },
}));
