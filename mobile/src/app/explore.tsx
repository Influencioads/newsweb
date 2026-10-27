import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import * as publicApi from '@/api/public';
import { ErrorState } from '@/components/Feedback';
import { SectionHeader } from '@/components/SectionHeader';
import { ExploreWowGrid } from '@/components/wow/ExploreWowGrid';
import { useI18n } from '@/lib/i18n';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { WOW_FEATURES } from '@/lib/wow';
import { Chip } from '@/ui/Chip';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Skeleton } from '@/ui/Skeleton';
import { T } from '@/ui/Text';

/**
 * /explore — every WOW category on one page (the website's All categories
 * page, frontend/src/features/wow/ExploreWow.tsx), main six first, then every
 * other section the site config lists, each opening its section screen.
 */
const WOW_SLUGS = new Set(WOW_FEATURES.map((f) => f.slug));
const SKELETON_CHIPS = 6;

export default function ExploreScreen() {
  const styles = useStyles();
  const { pick } = useI18n();
  const title = pick('అన్ని కేటగిరీలు', 'All categories');

  const config = useQuery({ queryKey: ['config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
  const others = (config.data?.categories ?? []).filter((c) => !WOW_SLUGS.has(c.slug));

  return (
    <Screen
      edges={['top']}
      bottomInset
      scroll
      refreshing={config.isRefetching}
      onRefresh={() => void config.refetch()}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ headerShown: false, title }} />
      <ScreenHeader title={title} />

      <T variant="bodySmall" color="muted" style={styles.intro}>
        {pick('ప్రతి కథలో ఒక WOW! మీకు నచ్చిన విభాగం ఎంచుకోండి.', 'Every story has a WOW! Pick a section.')}
      </T>

      <ExploreWowGrid show="all" />

      {config.isLoading ? (
        <View style={styles.chips} aria-hidden>
          {Array.from({ length: SKELETON_CHIPS }, (_, i) => (
            <Skeleton key={i} width={96 + (i % 3) * 24} height={TAP} radius={radius.pill} />
          ))}
        </View>
      ) : config.isError && !config.data ? (
        <ErrorState error={config.error} onRetry={() => void config.refetch()} fill={false} />
      ) : others.length ? (
        <>
          <SectionHeader title={pick('మరిన్ని విభాగాలు', 'More sections')} />
          <View style={styles.chips}>
            {others.map((category) => (
              <Chip
                key={category.slug}
                label={pick(category.name_te, category.name_en)}
                haptic="light"
                onPress={() => router.push({ pathname: '/section/[slug]', params: { slug: category.slug } })}
              />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: { paddingBottom: space.xxl },
  intro: { paddingHorizontal: space.lg, paddingTop: space.md },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
}));
