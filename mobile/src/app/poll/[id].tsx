import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';

import * as api from '@/api/epaper';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { PollCard } from '@/components/PollCard';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';

/**
 * One poll on its own page — the destination of a shared poll link (§17).
 *
 * `Screen` owns the scroll and the branded pull-to-refresh; the page is one
 * card, so the header riding along with it costs nothing.
 */
export default function PollScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();

  const poll = useQuery({
    queryKey: ['poll', id],
    queryFn: () => api.fetchPoll(Number(id)),
    enabled: Boolean(id),
  });

  return (
    <Screen
      edges={['top']}
      bottomInset
      scroll
      refreshing={poll.isRefetching}
      onRefresh={() => void poll.refetch()}
      contentContainerStyle={styles.body}
    >
      <Stack.Screen options={{ headerShown: false, title: t('screen.poll') }} />
      <ScreenHeader title={t('screen.poll')} />

      {poll.isLoading ? (
        <LoadingState />
      ) : poll.isError || !poll.data ? (
        <ErrorState
          error={poll.error}
          fill={false}
          kind={poll.isError ? undefined : 'notFound'}
          onRetry={() => void poll.refetch()}
        />
      ) : (
        <PollCard poll={poll.data} />
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  body: { paddingBottom: space.xl },
}));
