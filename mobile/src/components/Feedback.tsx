import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { font, type } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';

/** Loading / error / empty states — every screen ships all three (doc §31). */

export function LoadingState() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  return (
    <View style={styles.box}>
      <ActivityIndicator color={color.brand} size="large" />
      <Text style={styles.text}>{t('state.loading')}</Text>
    </View>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  return (
    <View style={styles.box}>
      <Text style={[styles.text, styles.error]}>{message ?? t('state.error')}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>{t('state.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  return (
    <View style={styles.box}>
      <Text style={styles.text}>{message ?? t('state.empty')}</Text>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  box: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
  text: {
    fontFamily: font.telugu,
    fontSize: type.bodySmall.fontSize,
    lineHeight: type.bodySmall.lineHeight,
    color: color.muted,
    textAlign: 'center',
  },
  error: { color: color.breaking },
  retry: {
    borderWidth: 1,
    borderColor: color.brand,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { fontFamily: font.teluguSemiBold, fontSize: 14, lineHeight: 21, color: color.brand },
}));
