import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';

import * as api from '@/api/epaper';
import { EpaperReader } from '@/components/EpaperReader';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';

/** The published edition for one date. The reader draws its own toolbar. */
export default function EpaperDateScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const { t } = useI18n();

  const edition = useQuery({
    queryKey: ['epaper', date],
    queryFn: () => api.fetchEdition(date!),
    enabled: Boolean(date),
  });

  return (
    <Screen edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      {edition.data ? (
        <EpaperReader edition={edition.data} />
      ) : (
        <>
          <ScreenHeader title={t('epaper.title')} />
          {edition.isLoading ? (
            <LoadingState variant="article" />
          ) : (
            <ErrorState
              error={edition.error}
              kind={edition.isError ? undefined : 'notFound'}
              onRetry={() => void edition.refetch()}
            />
          )}
        </>
      )}
    </Screen>
  );
}
