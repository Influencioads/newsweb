import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { api } from '@/api/client';
import { ArticleAudio } from '@/components/ArticleAudio';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';

/**
 * Today's audio bulletins — six a day, 06:00 to 21:00 IST.
 *
 * Playback reuses `ArticleAudio` through its `endpoint` prop: the bulletin
 * route returns the same payload shape as an article's audio, so the scrubber,
 * the four speeds and the ±15s skips all work without a second player. One
 * player per card is the reason this screen does not use `BulletinCard`,
 * which is handed a single shared player by the home feed.
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

  return (
    <Screen edges={['bottom']} scroll contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: t('screen.bulletin') }} />
      <T variant="bodySmall" color="muted" scaled style={styles.intro}>
        {L(
          'ప్రతి మూడు గంటలకు మూడు నిమిషాల బులెటిన్ — ఉదయం ఆరు నుంచి రాత్రి తొమ్మిది వరకు.',
          'A three-minute bulletin every three hours, from 6am to 9pm.',
          isTelugu,
        )}
      </T>

      {day.isLoading ? <LoadingState /> : null}
      {day.isError ? (
        <ErrorState error={day.error} fill={false} onRetry={() => void day.refetch()} />
      ) : null}

      {live.map((bulletin) => (
        <Card key={`${bulletin.date}-${bulletin.slot}`} style={styles.card}>
          <View style={styles.head}>
            <Badge
              tone="breaking"
              icon="radio"
              size="xs"
              label={L('ప్రసారంలో', 'On air', isTelugu)}
            />
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
            'ప్రస్తుతం బులెటిన్ ఏదీ లేదు. తదుపరిది మూడు గంటల తర్వాత వస్తుంది.',
            'No bulletin on air right now — the next one lands in about three hours.',
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
  head: { flexDirection: 'row', alignItems: 'center' },
  items: { gap: space.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headline: { flex: 1, minWidth: 0 },
}));
