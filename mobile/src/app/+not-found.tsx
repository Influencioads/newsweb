import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { EmptyState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { makeStyles } from '@/lib/useTheme';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';

/** Catch-all for unknown routes — bad deep links, removed screens. */
export default function NotFoundScreen() {
  const styles = useStyles();
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen bottomInset>
      <ScreenHeader title={t('state.notFound')} />
      <View style={styles.centre}>
        <EmptyState
          icon="inbox"
          title={t('state.notFound')}
          body={t('state.notFoundBody')}
          action={<Button label={t('state.goHome')} icon="home" onPress={() => router.replace('/')} />}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  centre: { flex: 1, justifyContent: 'center' },
}));
