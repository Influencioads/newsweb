import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import * as epaperApi from '@/api/epaper';
import { ArticleAudio } from '@/components/ArticleAudio';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Card } from '@/ui/Card';
import { Chip, ChipRail } from '@/ui/Chip';
import { T } from '@/ui/Text';

/**
 * EpaperRadio — the edition read aloud, one story at a time.
 *
 * The playlist is still `/epaper/{date}/audio`; playback is `ArticleAudio`,
 * handed the track's own `url` so it plays the file the playlist already
 * resolved rather than re-asking the article's audio route (which answers for
 * the article's own voice setting, not the edition's). The rail is the track
 * picker; the scrubber, the four speeds and the 15s skip come with the player.
 */
export function EpaperRadio({ date }: { date: string }) {
  const styles = useStyles();
  const { t } = useI18n();
  const [track, setTrack] = useState(0);

  const playlist = useQuery({
    queryKey: ['epaper-audio', date],
    queryFn: () => epaperApi.fetchAudio(date),
  });

  if (playlist.isLoading) return <LoadingState />;
  if (playlist.isError) {
    return (
      <ErrorState error={playlist.error} fill={false} onRetry={() => void playlist.refetch()} />
    );
  }

  const tracks = playlist.data?.tracks ?? [];
  if (tracks.length === 0) return null;

  const index = Math.min(track, tracks.length - 1);
  const current = tracks[index];

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <T variant="headlineSm" weight="bold" accessibilityRole="header">
          {t('epaper.radio')}
        </T>
        <Badge tone="brand" icon="headphones" size="xs" label={`${tracks.length}`} />
      </View>

      <T variant="body" weight="semibold" color="brand" lang="te" scaled>
        {current.title_te}
      </T>

      <ArticleAudio
        shortId={current.short_id}
        url={current.url}
        listenLabel={t('epaper.listen')}
        stopLabel={t('article.stopListening')}
      />

      <View accessibilityRole="radiogroup" accessibilityLabel={t('epaper.radio')}>
        <ChipRail contentContainerStyle={styles.rail} style={styles.railBox}>
          {tracks.map((x, i) => (
            <Chip
              key={x.article_id}
              role="radio"
              lang="te"
              label={x.title_te}
              selected={i === index}
              accessibilityLabel={`${t('epaper.page')} ${x.page_number}: ${x.title_te}`}
              onPress={() => setTrack(i)}
              style={styles.chip}
            />
          ))}
        </ChipRail>
      </View>
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  card: { margin: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  railBox: { marginHorizontal: -space.lg },
  rail: { paddingHorizontal: space.lg },
  chip: { maxWidth: 240 },
}));
