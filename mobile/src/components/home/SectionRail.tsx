import { router, type Href } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { useSiteConfig } from '@/lib/siteContent';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { IconButton } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * The website's section bar (frontend components/layout/CategoryNav.tsx) on
 * the app's Home: ☰ opens the Sections menu; then Home, the WOW shortcuts —
 * WOW Radio and My Village as orange buttons, Story Shots, WOW News — and the
 * main categories from the CMS, each opening its screen.
 */

export interface Shortcut {
  href: Href;
  te: string;
  en: string;
  icon: IconName;
  /** Drawn as an orange button, as on the website. */
  wow?: boolean;
}

/** Reader destinations that are not categories, in the website's order. */
export const SHORTCUTS: readonly Shortcut[] = [
  { href: '/radio', te: 'వావ్ రేడియో', en: 'WOW Radio', icon: 'audioLines', wow: true },
  { href: '/my-village', te: 'మై విలేజ్', en: 'My Village', icon: 'home', wow: true },
  { href: '/story-shots', te: 'స్టోరీ షాట్స్', en: 'Story Shots', icon: 'galleryVertical' },
  { href: { pathname: '/section/[slug]', params: { slug: 'wow-news' } }, te: 'వావ్ న్యూస్', en: 'WOW News', icon: 'newspaper' },
];

export function SectionRail() {
  const styles = useStyles();
  const color = useColors();
  const { pick } = useI18n();
  const categories = (useSiteConfig().data?.categories ?? []).filter((c) => c.show_in_nav && c.slug !== 'wow-news');

  return (
    <View style={styles.bar}>
      <IconButton name="list" label={pick('విభాగాలు', 'Sections')} onPress={() => router.push('/sections')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        <View style={[styles.item, styles.active]} accessibilityRole="tab" accessibilityState={{ selected: true }}>
          <T variant="ui" weight="bold" color="brand">
            {pick('హోమ్', 'Home')}
          </T>
        </View>
        {SHORTCUTS.map((sc) => (
          <PressableScale
            key={sc.en}
            onPress={() => router.push(sc.href)}
            haptic="select"
            minHeight={TAP}
            accessibilityRole="link"
            accessibilityLabel={pick(sc.te, sc.en)}
            style={[styles.item, sc.wow ? styles.wow : null]}
          >
            {sc.wow ? <Icon name={sc.icon} size={16} color={color.onWow} /> : null}
            <T variant="ui" weight="bold" color={sc.wow ? 'onWow' : 'ink'} numberOfLines={1}>
              {pick(sc.te, sc.en)}
            </T>
          </PressableScale>
        ))}
        {categories.map((c) => (
          <PressableScale
            key={c.slug}
            onPress={() => router.push({ pathname: '/section/[slug]', params: { slug: c.slug } })}
            haptic="select"
            minHeight={TAP}
            accessibilityRole="link"
            style={styles.item}
          >
            <T variant="ui" weight="bold" numberOfLines={1}>
              {pick(c.name_te, c.name_en)}
            </T>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },
  rail: { alignItems: 'center', gap: space.xs, paddingRight: space.lg, paddingVertical: space.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  active: { borderBottomWidth: 3, borderBottomColor: color.brand, borderRadius: 0, paddingHorizontal: space.sm },
  wow: { backgroundColor: color.wowDeep },
}));
