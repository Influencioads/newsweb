import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { color, font, HIT_SLOP } from '@/lib/theme';

/** Section rule: bold title on the left, optional "see all →" on the right —
 * the same block header the web home uses. */
export function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={HIT_SLOP} accessibilityRole="button">
          <Text style={styles.seeAll}>{t('home.seeAll')} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: color.ink,
    backgroundColor: color.canvas,
  },
  title: {
    fontFamily: font.headline,
    fontSize: 19,
    lineHeight: 30,
    color: color.brand,
  },
  seeAll: {
    fontFamily: font.telugu,
    fontSize: 12,
    lineHeight: 18,
    color: color.info,
    fontWeight: '600',
  },
});
