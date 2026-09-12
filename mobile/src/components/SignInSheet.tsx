import { router } from 'expo-router';
import { View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { T } from '@/ui/Text';

/**
 * The one sign-in gate (§5).
 *
 * Every anonymous tap on a save / like / report control opens this, rather
 * than some surfaces explaining themselves and others silently jumping to the
 * Profile tab. Both the engagement row and the article action bar mount it.
 */
export function SignInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();

  return (
    <BottomSheet open={open} onClose={onClose} title={t('ui.signInToContinue')}>
      <View style={styles.prompt}>
        <T color="inkSoft">{t('ui.signInBody')}</T>
        <Button
          label={t('auth.signIn')}
          icon="logIn"
          full
          onPress={() => {
            onClose();
            router.push('/profile');
          }}
        />
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => ({
  prompt: { gap: space.md, paddingBottom: space.sm },
}));
