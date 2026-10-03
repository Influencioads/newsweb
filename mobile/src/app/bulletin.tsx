import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { api } from '@/api/client';
import { ArticleAudio } from '@/components/ArticleAudio';
import { bulletinArt, bulletinId, bulletinTrack } from '@/components/BulletinCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { RadioDial } from '@/components/player/RadioDial';
import { useI18n } from '@/lib/i18n';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { usePlayer } from '@/stores/player';
import { Badge } from '@/ui/Badge';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';

/**
 * Today's audio bulletins — six a day, 07:00 to 21:00 IST, each with its own
 * name (`slot_label_te`, set on the server) — tuned like a radio.
 *
 * The radio dial up top shows the day's six slots on a frequency scale: the
 * ones on air tune in (they start the day's queue at that bulletin), the rest
 * are inert, and the needle rests on the bulletin playing — or the latest on
 * air. "Play all" runs the day in order through the global player, which
 * auto-advances and keeps going after the reader leaves this screen.
 *
 * Each card keeps its `ArticleAudio` (through its `endpoint` prop: the
 * bulletin route returns the same payload shape as an article's audio), now a
 * trigger and live status for that global player; handed the day's `queue`,
 * its play starts the running order at that bulletin.
 *
 * Only bulletins that are actually on air appear. A reader has no use for the
 * difference between "not produced yet" and "an editor pulled it".
 */
interface BulletinSummary {
  available: boolean;
  url: string | null;
  duration_sec: number;
  date: string | null;
  slot: number | null;
  slot_label_te: string | null;
  items: { position: number; short_id: string | null; headline_te: string }[];
}

// ponytail: no i18n keys yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

export default function BulletinScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t, isTelugu } = useI18n();

  const day = useQuery({
    queryKey: ['bulletin', 'day'],
    queryFn: async () =>
      (await api.get<{ enabled: boolean; items: BulletinSummary[] }>('/public/bulletins')).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const live = (day.data?.items ?? []).filter((b) => b.available);
  // The day's running order, 07:00 first — the list comes back sorted by slot.
  const queue = live.flatMap((b) => bulletinTrack(b, t('player.kindBulletin')) ?? []);
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const { playQueue, toggle } = usePlayer.getState();
  const playingSlot = live.find((b) => b.date && b.slot != null && bulletinId(b.date, b.slot) === currentId)?.slot;
  const latestSlot = live[live.length - 1]?.slot;

  function tuneTo(slot: number) {
    const date = live.find((b) => b.slot === slot)?.date;
    const at = date ? queue.findIndex((q) => q.id === bulletinId(date, slot)) : -1;
    if (at < 0) return;
    // Tuning to the station already on resumes it rather than starting over.
    if (queue[at].id === currentId) {
      if (!usePlayer.getState().playing) toggle();
      return;
    }
    playQueue(queue, at);
  }

  return (
    <Screen edges={['bottom']} scroll contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: t('screen.bulletin') }} />
      <T variant="bodySmall" color="muted" scaled style={styles.intro}>
        {L(
          'రోజుకు ఆరు బులెటిన్లు, ఒక్కొక్కటి మూడు నిమిషాలు — ఉదయం 7 నుంచి రాత్రి 9 వరకు.',
          'Six three-minute bulletins a day, from 7am to 9pm.',
          isTelugu,
        )}
      </T>

      {day.data?.enabled ? (
        <RadioDial
          live={live.flatMap((b) => (b.slot != null ? [b.slot] : []))}
          names={Object.fromEntries(live.map((b) => [b.slot, b.slot_label_te]))}
          active={playingSlot ?? latestSlot ?? null}
          onSelect={tuneTo}
          onPlayAll={queue.length ? () => playQueue(queue, 0) : undefined}
        />
      ) : null}

      {day.isLoading ? <LoadingState /> : null}
      {day.isError ? (
        <ErrorState error={day.error} fill={false} onRetry={() => void day.refetch()} />
      ) : null}

      {live.map((bulletin) => (
        <Card key={`${bulletin.date}-${bulletin.slot}`} style={styles.card}>
          {bulletinArt(bulletin.slot) ? (
            // The art says "Click To Listen", so it tunes in; the player below stays the labelled control.
            <PressableScale
              haptic="select"
              accessibilityLabel={`${t('article.listen')}: ${bulletin.slot_label_te ?? ''}`}
              onPress={() => bulletin.slot != null && tuneTo(bulletin.slot)}
              style={styles.art}
            >
              <Image source={bulletinArt(bulletin.slot)} style={styles.artImage} contentFit="contain" accessible={false} />
            </PressableScale>
          ) : null}
          <View style={styles.head}>
            <Badge
              tone="breaking"
              icon="radio"
              size="xs"
              label={L('ప్రసారంలో', 'On air', isTelugu)}
            />
            <T variant="meta" weight="bold" color="inkSoft" lang="en">
              {`${String(bulletin.slot).padStart(2, '0')}:00`}
            </T>
          </View>
          {bulletin.slot_label_te ? (
            <T variant="headlineSm" weight="bold" lang="te">
              {bulletin.slot_label_te}
            </T>
          ) : null}

          <ArticleAudio
            shortId={`bulletin-${bulletin.date}-${bulletin.slot}`}
            endpoint={`/public/bulletins/${bulletin.date}/${bulletin.slot}`}
            listenLabel={t('article.listen')}
            stopLabel={t('article.stopListening')}
            queue={queue}
          />

          <View style={styles.items}>
            {bulletin.items.map((item) => {
              const shortId = item.short_id;
              return shortId ? (
                <PressableScale
                  key={item.position}
                  haptic="select"
                  accessibilityLabel={item.headline_te}
                  style={styles.item}
                  onPress={() =>
                    router.push({
                      pathname: '/article/[shortId]',
                      params: { shortId },
                    })
                  }
                >
                  <T variant="bodySmall" color="inkSoft" lang="te" scaled style={styles.headline}>
                    {`${item.position}. ${item.headline_te}`}
                  </T>
                  <Icon name="chevronRight" size={16} color={color.mutedLight} />
                </PressableScale>
              ) : (
                <View key={item.position} style={styles.item}>
                  <T variant="bodySmall" color="inkSoft" lang="te" scaled style={styles.headline}>
                    {`${item.position}. ${item.headline_te}`}
                  </T>
                </View>
              );
            })}
          </View>
        </Card>
      ))}

      {day.data && live.length === 0 ? (
        <EmptyState
          icon="radio"
          body={L(
            'ప్రస్తుతం బులెటిన్ ఏదీ లేదు. బులెటిన్లు ఉదయం 7, 9, మధ్యాహ్నం 1, 3, సాయంత్రం 5, రాత్రి 7, 9 గంటలకు వస్తాయి.',
            'No bulletin on air right now — they go out at 7am, 9am, 1pm, 3pm, 5pm, 7pm and 9pm.',
            isTelugu,
          )}
        />
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  body: { padding: space.lg, paddingBottom: space.xxl },
  intro: { marginBottom: space.md },
  card: { marginBottom: space.md, gap: space.sm },
  art: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000000' },
  artImage: { width: '100%', height: 104 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  items: { gap: space.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headline: { flex: 1, minWidth: 0 },
}));
