import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import * as publicApi from '@/api/public';
import type { ArticleCard } from '@/api/types';
import { Equalizer } from '@/components/player/PlayerVisuals';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { alpha, radius, shadow, space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { RADIO_PER_SEGMENT, RADIO_SEGMENTS, radioScript, type RadioSegment } from '@/lib/wow';
import { usePlayer } from '@/stores/player';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * WOW Radio — the app twin of the website's features/wow/WowRadio.tsx.
 *
 * Four segments sit as a 2 × 2 grid of tiles; the selected one drives the
 * player underneath. A segment's programme is the newest stories of its
 * categories (tried in order, the first with stories wins), read aloud on the
 * reader's own phone in Telugu through expo-speech — the same device voice the
 * article Listen control uses (lib/tts.ts), with the same manners: one voice
 * at a time (the global audio player pauses), chunked utterances, and silence
 * when the screen goes or the segment changes.
 *
 * `card` is the home-page block (artwork thumb, "Click to listen" link, the first
 * few headlines); `page` is the `/radio` screen's body (the full running
 * order — the screen draws the artwork itself).
 */

const ART = require('../../../assets/images/wow-radio.webp');
const DEFAULT_SEGMENT = RADIO_SEGMENTS[0] as RadioSegment;
/** Headlines listed on the home card; the radio page lists the whole programme. */
const CARD_ITEMS = 3;
/** expo-speech caps an utterance; speak sentence-grouped chunks (as lib/tts.ts). */
const CHUNK_RX = /[\s\S]{1,3500}(?:\.|$)/g;
const TELUGU_VOICE = /^te(?:[-_]|$)/i;

type Tone = 'wow' | 'success' | 'brand' | 'ai';
const TONE: Record<string, Tone> = {
  'morning-mantra': 'wow',
  spoorthi: 'success',
  'wow-news': 'brand',
  mystery: 'ai',
};

async function fetchSegment(segment: RadioSegment): Promise<ArticleCard[]> {
  let failures = 0;
  let lastError: unknown = null;
  for (const category of segment.categories) {
    try {
      const feed = await publicApi.fetchFeed({ category, limit: RADIO_PER_SEGMENT });
      if (feed.articles.length) return feed.articles.slice(0, RADIO_PER_SEGMENT);
    } catch (error) {
      // A category that does not exist yet just falls through to the next.
      failures += 1;
      lastError = error;
    }
  }
  // Every category failed: that is the network, not an empty segment.
  if (failures === segment.categories.length && lastError) throw lastError;
  return [];
}

type VoiceState = 'checking' | 'ready' | 'unknown' | 'unavailable';

/**
 * The device's Telugu voice, speaking one programme at a time.
 *
 * `voice` is 'unavailable' only when the phone lists voices and none is
 * Telugu; an empty list (some engines answer before they load) is 'unknown',
 * and a speak error then marks it unavailable rather than failing silently.
 */
function useRadioVoice(text: string) {
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState<VoiceState>('checking');
  const [voiceId, setVoiceId] = useState<string | undefined>(undefined);
  /** Bumped per run so callbacks from a stopped run cannot touch the state. */
  const run = useRef(0);
  /** True while this player owns the device voice. */
  const owns = useRef(false);

  useEffect(() => {
    let alive = true;
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        if (!alive) return;
        if (!voices.length) return setVoice('unknown');
        const te = voices.find((v) => TELUGU_VOICE.test(v.language));
        setVoiceId(te?.identifier);
        setVoice(te ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (alive) setVoice('unknown');
      });
    return () => {
      alive = false;
    };
  }, []);

  const stop = useCallback(() => {
    run.current += 1;
    setSpeaking(false);
    if (owns.current) {
      owns.current = false;
      void Speech.stop();
    }
  }, []);

  // Leaving the screen must not leave a ghost presenter on air; only this
  // player's own voice is stopped (an article reading elsewhere carries on).
  useEffect(
    () => () => {
      run.current += 1;
      if (owns.current) void Speech.stop();
    },
    [],
  );

  const start = useCallback(async () => {
    if (!text || voice === 'unavailable') return;
    const id = run.current + 1;
    run.current = id;
    usePlayer.getState().pause();
    setSpeaking(true);
    // One voice at a time: whatever else is speaking ends first.
    await Speech.stop();
    if (run.current !== id) return;
    owns.current = true;
    const end = () => {
      if (run.current !== id) return;
      owns.current = false;
      setSpeaking(false);
    };
    const chunks = text.match(CHUNK_RX) ?? [text];
    chunks.forEach((chunk, index) => {
      Speech.speak(chunk, {
        language: 'te-IN',
        voice: voiceId,
        rate: 0.95,
        onDone: index === chunks.length - 1 ? end : undefined,
        onStopped: end,
        onError: () => {
          if (run.current !== id) return;
          end();
          if (voice === 'unknown') setVoice('unavailable');
        },
      });
    });
  }, [text, voice, voiceId]);

  const toggle = useCallback(() => {
    if (speaking) stop();
    else void start();
  }, [speaking, start, stop]);

  return { speaking, toggle, stop, unavailable: voice === 'unavailable' };
}

export function WowRadioCard({ variant = 'card' }: { variant?: 'card' | 'page' }) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { pick } = useI18n();
  const page = variant === 'page';

  const [segmentId, setSegmentId] = useState(DEFAULT_SEGMENT.id);
  const segment = RADIO_SEGMENTS.find((sg) => sg.id === segmentId) ?? DEFAULT_SEGMENT;

  const programme = useQuery({
    queryKey: ['wow-radio', segment.id],
    queryFn: () => fetchSegment(segment),
    staleTime: 120_000,
  });
  const items = programme.data ?? [];
  const { speaking, toggle, stop, unavailable } = useRadioVoice(radioScript(segment, items));

  const tune = (id: string) => {
    if (id === segmentId) return;
    stop();
    setSegmentId(id);
  };

  const tint = (tone: Tone) => ({ wow: color.wowTint, success: color.successTint, brand: color.brandTint, ai: color.aiTint })[tone];
  const fg = (tone: Tone) => color[tone];

  const status = programme.isLoading
    ? pick('ట్యూన్ అవుతోంది…', 'Tuning…')
    : programme.isError
      ? pick('కార్యక్రమం లోడ్ కాలేదు.', 'Could not load the programme.')
      : !items.length
        ? pick('ఈ సెగ్మెంట్ ఎపిసోడ్‌లు త్వరలో', 'Episodes for this segment are coming soon')
        : unavailable
          ? pick(
              'ఈ ఫోన్‌లో తెలుగు వాయిస్ లేదు. సెట్టింగ్స్‌లో తెలుగు టెక్స్ట్-టు-స్పీచ్ వాయిస్‌ను జోడించండి.',
              'This phone has no Telugu voice. Add a Telugu text-to-speech voice in Settings.',
            )
          : speaking
            ? pick('ప్రసారంలో', 'On air')
            : pick('వినడానికి ప్లే నొక్కండి', 'Press play to listen');

  const canPlay = items.length > 0 && !unavailable;
  const listed = page ? items : items.slice(0, CARD_ITEMS);
  const muted = alpha(color.onOverlay, 0.75);

  return (
    <View style={[styles.panel, page ? styles.panelPage : null]}>
      {/* Header */}
      <View style={styles.header}>
        {!page ? (
          <Image source={ART} style={styles.thumb} contentFit="cover" transition={m.imageTransition} accessible={false} />
        ) : null}
        <View style={styles.titles}>
          <View style={styles.onAir}>
            <View style={styles.lamp} />
            <T variant="eyebrow" lang="en" color="wow">
              On air
            </T>
            <T variant="meta" lang="te" color="wow">
              · ప్రసారంలో
            </T>
          </View>
          <View style={styles.titleRow} accessible accessibilityRole="header" accessibilityLabel="WOW Radio · వావ్ రేడియో">
            <T variant="headlineMd" weight="bold" lang="en" color="onOverlay">
              WOW Radio
            </T>
            <T variant="headlineSm" weight="bold" lang="te" style={{ color: muted }}>
              · వావ్ రేడియో
            </T>
          </View>
        </View>
      </View>

      {/* The four segments */}
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={pick('సెగ్మెంట్లు', 'Segments')}>
        {RADIO_SEGMENTS.map((sg) => {
          const active = sg.id === segment.id;
          const tone = TONE[sg.id] ?? 'wow';
          return (
            <PressableScale
              key={sg.id}
              onPress={() => tune(sg.id)}
              haptic="select"
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${pick(sg.te, sg.en)}. ${pick(sg.taglineTe, sg.taglineEn)}`}
              style={[styles.tile, active ? styles.tileActive : null]}
            >
              <View style={styles.tileInner}>
                <View style={[styles.tileIcon, { backgroundColor: tint(tone) }]}>
                  <Icon name={active && speaking ? 'audioLines' : sg.icon} size={20} color={fg(tone)} />
                </View>
                <View style={styles.tileText}>
                  <T variant="ui" weight="bold" color="onOverlay" numberOfLines={1}>
                    {pick(sg.te, sg.en)}
                  </T>
                  <T variant="meta" numberOfLines={2} style={{ color: muted }}>
                    {pick(sg.taglineTe, sg.taglineEn)}
                  </T>
                </View>
              </View>
              {active ? <View style={styles.activeDot} /> : null}
            </PressableScale>
          );
        })}
      </View>

      {/* Player */}
      <View style={styles.player}>
        <PressableScale
          onPress={toggle}
          disabled={!canPlay}
          haptic="medium"
          minHeight={TAP_LG + 8}
          accessibilityLabel={speaking ? pick('ఆపివేయండి', 'Stop') : pick('ప్లే', 'Play')}
          style={styles.play}
        >
          <Icon name={speaking ? 'stop' : 'play'} size={28} color={color.onWow} strokeWidth={2} />
        </PressableScale>
        <View style={styles.nowPlaying}>
          <T variant="meta" style={{ color: muted }} numberOfLines={1}>
            {pick('ఇప్పుడు ప్లే అవుతోంది', 'Now playing')}
          </T>
          <T variant="headlineSm" weight="bold" color="onOverlay" numberOfLines={1}>
            {pick(segment.te, segment.en)}
          </T>
          <View style={styles.statusRow}>
            <Equalizer playing={speaking} color={color.wow} bars={5} height={16} />
            <T
              variant="meta"
              style={[styles.status, { color: muted }]}
              accessibilityLiveRegion="polite"
              numberOfLines={unavailable ? 3 : 2}
            >
              {status}
            </T>
          </View>
          {programme.isError ? (
            <PressableScale
              onPress={() => void programme.refetch()}
              accessibilityLabel={pick('మళ్లీ ప్రయత్నించండి', 'Retry')}
              style={styles.link}
            >
              <T variant="ui" weight="semibold" color="wow">
                {pick('మళ్లీ ప్రయత్నించండి', 'Retry')}
              </T>
            </PressableScale>
          ) : null}
        </View>
      </View>

      {/* Running order */}
      {listed.length ? (
        <View style={styles.programme}>
          <T variant="eyebrow" style={{ color: muted }}>
            {pick('ఈ కార్యక్రమంలో', 'In this programme')}
          </T>
          {listed.map((a, i) => (
            <PressableScale
              key={a.short_id}
              onPress={() => router.push({ pathname: '/article/[shortId]', params: { shortId: a.short_id } })}
              haptic={false}
              scaleTo={0.985}
              accessibilityRole="link"
              accessibilityLabel={pick(a.title_te, a.title_en)}
              style={styles.row}
            >
              <View style={styles.rowInner}>
                <T variant="ui" weight="bold" lang="en" color="wow" style={styles.rowNumber}>
                  {String(i + 1).padStart(2, '0')}
                </T>
                <T variant="bodySmall" color="onOverlay" numberOfLines={2} style={styles.rowTitle}>
                  {pick(a.title_te, a.title_en)}
                </T>
              </View>
            </PressableScale>
          ))}
        </View>
      ) : null}

      {/* Way into the radio screen */}
      {!page ? (
        <PressableScale
          onPress={() => router.push('/radio')}
          accessibilityRole="link"
          accessibilityLabel={pick('వినడానికి క్లిక్ చేయండి', 'Click to listen')}
          style={styles.open}
        >
          <View style={styles.openInner}>
            <Icon name="headphones" size={20} color={color.wow} />
            <T variant="ui" weight="semibold" color="wow">
              {pick('వినడానికి క్లిక్ చేయండి', 'Click to listen')}
            </T>
            <Icon name="arrowRight" size={16} color={color.wow} />
          </View>
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  // brandDeep is the same navy in both themes, so the panel reads as a lit
  // studio either way; its foreground is the constant-light onOverlay.
  panel: {
    backgroundColor: color.brandDeep,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: alpha(color.wow, 0.6),
    padding: space.lg,
    gap: space.lg,
    overflow: 'hidden',
  },
  panelPage: { padding: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: {
    height: 56,
    aspectRatio: 960 / 540,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: alpha(color.onOverlay, 0.2),
  },
  titles: { flex: 1, minWidth: 0 },
  onAir: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  lamp: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.wow },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '45%',
    flexGrow: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: alpha(color.onOverlay, 0.15),
    backgroundColor: alpha(color.onOverlay, 0.05),
    padding: space.sm,
  },
  tileActive: { borderColor: color.wow, backgroundColor: alpha(color.onOverlay, 0.15) },
  tileInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { flex: 1, minWidth: 0 },
  activeDot: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: color.wow,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    backgroundColor: alpha(color.onOverlay, 0.05),
    padding: space.md,
  },
  play: {
    width: TAP_LG + 8,
    height: TAP_LG + 8,
    borderRadius: radius.pill,
    backgroundColor: color.wowDeep,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow('raised', color),
  },
  nowPlaying: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  status: { flex: 1, minWidth: 0 },
  link: { alignSelf: 'flex-start' },
  programme: {
    borderTopWidth: 1,
    borderTopColor: alpha(color.onOverlay, 0.15),
    paddingTop: space.md,
    gap: space.xs,
  },
  row: { borderRadius: radius.sm, paddingHorizontal: space.xs },
  rowInner: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  rowNumber: { minWidth: 22, fontVariant: ['tabular-nums'] },
  rowTitle: { flex: 1, minWidth: 0 },
  open: { alignSelf: 'flex-start' },
  openInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
}));
