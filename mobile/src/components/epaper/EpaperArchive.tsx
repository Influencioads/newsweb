import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';

import * as epaperApi from '@/api/epaper';
import type { EpaperEdition } from '@/api/epaper';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Chip, ChipRail } from '@/ui/Chip';
import { T } from '@/ui/Text';

// ponytail: no i18n key for the empty archive yet — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

/** EpaperArchive — earlier editions as a rail of dated chips. */
export function EpaperArchive({ current }: { current: number }) {
  const styles = useStyles();
  const { t, language, isTelugu } = useI18n();
  // The reader gets a date, not the ISO key the API files editions under.
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(language === 'te' ? 'te-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const archive = useQuery({
    queryKey: ['epaper-archive'],
    queryFn: epaperApi.fetchArchive,
  });

  const items = (archive.data?.items ?? []).filter((e: EpaperEdition) => e.id !== current);

  return (
    <View style={styles.block}>
      <T variant="headlineSm" weight="bold" style={styles.title} accessibilityRole="header">
        {t('epaper.archive')}
      </T>
      {archive.isError ? (
        <ErrorState error={archive.error} fill={false} onRetry={() => void archive.refetch()} />
      ) : archive.isLoading ? (
        <LoadingState variant="list" rows={1} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="newspaper"
          body={L('ఇతర ఎడిషన్లు ఇంకా లేవు.', 'No other editions yet.', isTelugu)}
        />
      ) : (
        <ChipRail>
          {items.map((e: EpaperEdition) => (
            <Chip
              key={e.id}
              label={dateLabel(e.edition_date)}
              count={e.page_count}
              accessibilityLabel={`${dateLabel(e.edition_date)}, ${e.page_count} ${t('ui.pages')}`}
              onPress={() =>
                router.replace({ pathname: '/epaper/[date]', params: { date: e.edition_date } })
              }
            />
          ))}
        </ChipRail>
      )}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  block: { paddingVertical: space.lg, gap: space.sm },
  title: { paddingHorizontal: space.lg },
}));
