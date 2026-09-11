import { ActivityIndicator, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Button } from '@/ui/Button';
import { T } from '@/ui/Text';

/**
 * ListFooter — the tail of an infinite list: a brand spinner while the next
 * page loads, "that's all" once exhausted, a ghost retry when a page failed.
 * Error wins over loading wins over end. Always at least 56 tall so the list
 * does not jump between states.
 */
export interface ListFooterProps {
  loading?: boolean;
  end?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

export function ListFooter({ loading = false, end = false, error = false, onRetry }: ListFooterProps) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();

  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      {error ? (
        <Button label={t('state.retry')} icon="refreshCw" variant="ghost" onPress={onRetry} />
      ) : loading ? (
        <ActivityIndicator color={color.brand} accessibilityLabel={t('state.loading')} />
      ) : end ? (
        <T variant="meta" color="muted" align="center">
          {t('state.endOfList')}
        </T>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  box: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
}));
