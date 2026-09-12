import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';

import * as api from '@/api/epaper';
import { EpaperReader } from '@/components/EpaperReader';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';

/** A generated personal edition — same reader, personal share/PDF routes. */
export default function MyEpaperEditionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();

  const edition = useQuery({
    queryKey: ['personal-epaper', id],
    queryFn: () => api.fetchPersonal(Number(id)),
    enabled: Boolean(id),
  });

  return (
    <Screen edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      {edition.data ? (
        <EpaperReader edition={edition.data} personal />
      ) : (
        <>
          <ScreenHeader title={t('screen.myEpaperEdition')} />
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
