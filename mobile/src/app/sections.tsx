import { router, Stack, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Fragment } from 'react';
import { View } from 'react-native';

import { SHORTCUTS } from '@/components/home/SectionRail';
import { Group, NavRow, RowDivider } from '@/components/profile/SettingsRows';
import { useI18n } from '@/lib/i18n';
import { useSiteConfig, useWowFeatures } from '@/lib/siteContent';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import type { IconName } from '@/ui/Icon';
import { Screen } from '@/ui/Screen';

/**
 * `/sections` — the website's Sections menu (frontend components/layout/NavDrawer.tsx)
 * as an app screen: the WOW features, the main categories and the other WOW
 * categories as the desk set them in the CMS, the reader's own pages, and the
 * About / policy pages (opened from the website, where the desk edits them in
 * CMS → Footer pages).
 */

const SITE = 'https://wowindia.influencioweb.com';

interface Row {
  label: string;
  icon: IconName;
  onPress: () => void;
}

const go = (href: Href) => () => router.push(href);
const section = (slug: string): Href => ({ pathname: '/section/[slug]', params: { slug } });

/** The website's footer pages (FOOTER_LINKS), in its order. */
const PAGES: readonly { path: string; te: string; en: string }[] = [
  { path: '/about', te: 'మా గురించి', en: 'About us' },
  { path: '/contact', te: 'సంప్రదించండి', en: 'Contact' },
  { path: '/editorial-policy', te: 'ఎడిటోరియల్ పాలసీ', en: 'Editorial policy' },
  { path: '/corrections', te: 'సవరణల విధానం', en: 'Corrections policy' },
  { path: '/grievance', te: 'గ్రీవెన్స్ అధికారి', en: 'Grievance officer' },
  { path: '/privacy', te: 'ప్రైవసీ', en: 'Privacy' },
  { path: '/terms', te: 'నిబంధనలు', en: 'Terms' },
  { path: '/ai-disclosure', te: 'AI వినియోగ ప్రకటన', en: 'AI usage disclosure' },
  { path: '/ugc-terms', te: 'పాఠకుల కథనాల నిబంధనలు', en: 'Reader content terms' },
];

function Rows({ rows }: { rows: Row[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <Fragment key={r.label}>
          {i ? <RowDivider /> : null}
          <NavRow label={r.label} icon={r.icon} onPress={r.onPress} />
        </Fragment>
      ))}
    </>
  );
}

export default function SectionsScreen() {
  const styles = useStyles();
  const { pick, t } = useI18n();
  const authed = useAuth((s) => s.status === 'authenticated');
  const categories = (useSiteConfig().data?.categories ?? []).filter((c) => c.show_in_nav);
  const more = useWowFeatures().more.filter((f) => f.slug !== 'story-shots');
  const title = pick('విభాగాలు', 'Sections');

  const explore: Row[] = [
    ...SHORTCUTS.filter((sc) => sc.en !== 'WOW News').map((sc) => ({ label: pick(sc.te, sc.en), icon: sc.icon, onPress: go(sc.href) })),
    { label: pick('లోకల్ హీరోను నామినేట్ చేయండి', 'Nominate Your Local Hero'), icon: 'award', onPress: go('/nominate') },
    { label: pick('అన్ని కేటగిరీలు', 'All categories'), icon: 'layoutGrid', onPress: go('/explore') },
    { label: t('tab.local'), icon: 'mapPin', onPress: go('/local') },
    { label: t('tab.videos'), icon: 'play', onPress: go('/videos') },
    { label: t('tab.shorts'), icon: 'zap', onPress: go('/short-news') },
    { label: pick('ట్రెండింగ్', 'Trending'), icon: 'trendingUp', onPress: go('/trending') },
  ];
  const mine: Row[] = [
    authed
      ? { label: t('tab.profile'), icon: 'user', onPress: go('/profile') }
      : { label: pick('సైన్ ఇన్', 'Sign in'), icon: 'logIn', onPress: go('/profile') },
    { label: t('library.bookmarks'), icon: 'bookmark', onPress: go('/library/bookmarks') },
    { label: t('library.history'), icon: 'history', onPress: go('/library/history') },
    { label: t('submit.title'), icon: 'pencil', onPress: go('/submit') },
  ];

  return (
    <Screen edges={['bottom']} scroll contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title }} />
      <Group title={pick('ఎక్స్‌ప్లోర్', 'Explore')}>
        <Rows rows={explore} />
      </Group>
      {categories.length ? (
        <Group title={pick('విభాగాలు', 'Sections')}>
          <Rows rows={categories.map((c) => ({ label: pick(c.name_te, c.name_en), icon: 'newspaper', onPress: go(section(c.slug)) }))} />
        </Group>
      ) : null}
      {more.length ? (
        <Group title={pick('మరిన్ని కేటగిరీలు', 'More categories')}>
          <Rows rows={more.map((f) => ({ label: pick(f.te, f.en), icon: f.icon, onPress: go(f.href) }))} />
        </Group>
      ) : null}
      <Group title={pick('నా పేజీలు', 'My pages')}>
        <Rows rows={mine} />
      </Group>
      <Group title={pick('మా గురించి, విధానాలు', 'About & policies')}>
        <Rows
          rows={PAGES.map((p) => ({
            label: pick(p.te, p.en),
            icon: 'fileText',
            onPress: () => void WebBrowser.openBrowserAsync(`${SITE}${p.path}`),
          }))}
        />
      </Group>
      <View style={styles.end} />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  body: { padding: space.lg, gap: space.xl },
  end: { height: space.lg },
}));
