import { ScrollView } from 'react-native';

import { LoadingState } from '@/components/Feedback';
import { ReaderPreferences } from '@/components/profile/ReaderPreferences';
import { SignInCard } from '@/components/profile/SignInCard';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';

/**
 * Profile tab — the reader's account and everything they can tune.
 *
 * Three states behind one header: the session is still resolving, nobody is
 * signed in (the OTP / email card), or a reader is (the grouped settings).
 * The scroll lives here rather than in either body so the header stays put
 * and the keyboard handling is set once, for both forms.
 */
export default function ProfileScreen() {
  const styles = useStyles();
  const { t } = useI18n();
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.me);

  return (
    <Screen keyboard>
      <ScreenHeader title={t('profile.title')} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {status === 'idle' || status === 'loading' ? (
          <LoadingState />
        ) : status === 'authenticated' && me ? (
          <ReaderPreferences me={me} />
        ) : (
          <SignInCard />
        )}
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxl },
}));
