import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { openSection, VillageCard } from '@/components/wow/MyVillageBlock';
import { Wash, WowButton } from '@/components/wow/NominateCta';
import { useI18n } from '@/lib/i18n';
import {
  fetchVillageStories,
  MY_VILLAGE_IMAGE,
  MY_VILLAGE_INTRO,
  MY_VILLAGE_SLUG,
  MY_VILLAGE_TITLE,
  MY_VILLAGE_WELCOME,
  PUBLISH_STAGES,
  SPECIALITIES,
} from '@/lib/myVillage';
import { alpha, radius, shadow, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';

/**
 * `/my-village` — the My Village screen (website: features/wow/MyVillagePage.tsx):
 * the welcome message and the two ways in — Explore Villages (the village
 * stories' section) and Share Your Village (the step-by-step form) — then
 * what a village story can be about, how a shared story gets published, and
 * the newest village stories.
 */
export default function MyVillageScreen() {
  const styles = useStyles();
  const color = useColors();
  const { pick, language } = useI18n();
  const te = language === 'te';
  const title = pick('మై విలేజ్', 'My Village');
  const stories = useQuery({ queryKey: ['wow', 'my-village-stories', 8], queryFn: () => fetchVillageStories(8), staleTime: 120_000 });
  const data = stories.data;
  const exploreSlug = data?.slug ?? MY_VILLAGE_SLUG;

  return (
    <Screen edges={['bottom']} scroll contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title }} />

      {/* Welcome, over the village-at-sunset picture */}
      <View style={styles.welcome}>
        <Image source={MY_VILLAGE_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={{ top: '40%' }} accessible={false} />
        <Wash strength={0.4} middle={0.85} />
        <View style={styles.welcomeCopy}>
          <View style={styles.pill}>
            <Icon name="home" size={16} color={color.onWow} />
            <T variant="meta" weight="bold" color="onWow">
              {title}
            </T>
          </View>
          <T variant="headlineLg" weight="bold" color="onOverlay" accessibilityRole="header">
            {te ? MY_VILLAGE_TITLE.te : MY_VILLAGE_TITLE.en}
          </T>
          {(te ? MY_VILLAGE_WELCOME.te : MY_VILLAGE_WELCOME.en).map((line) => (
            <T key={line} variant="body" weight="semibold" color="onOverlay">
              {line}
            </T>
          ))}
          <T variant="bodySmall" color="onOverlay" style={styles.soft}>
            {te ? MY_VILLAGE_INTRO.te[0] : MY_VILLAGE_INTRO.en[0]}
          </T>
        </View>

        {/* The two ways in */}
        <View style={styles.ways}>
          <PressableScale onPress={() => openSection(exploreSlug)} accessibilityRole="link" style={[styles.way, styles.wayExplore]}>
            <View style={[styles.wayIcon, { backgroundColor: color.brand }]}>
              <Icon name="globe" size={20} color={color.onOverlay} />
            </View>
            <View style={styles.wayText}>
              <T variant="headlineSm" weight="bold" color="onOverlay">
                {pick('గ్రామాలను చూడండి', 'Explore Villages')}
              </T>
              <T variant="meta" color="onOverlay" style={styles.soft}>
                {pick('ఇతర గ్రామాల కథలను తెలుసుకోండి.', 'Read the stories of other villages.')}
              </T>
            </View>
          </PressableScale>
          <PressableScale onPress={() => router.push('/share-village')} accessibilityRole="link" style={[styles.way, styles.wayShare]}>
            <View style={[styles.wayIcon, styles.wayIconShare]}>
              <Icon name="pencil" size={20} color={color.onWow} />
            </View>
            <View style={styles.wayText}>
              <T variant="headlineSm" weight="bold" color="onWow">
                {pick('మీ ఊరి కథ పంపండి', 'Share Your Village')}
              </T>
              <T variant="meta" color="onWow">
                {pick('మీ గ్రామం గురించి వివరాలు పంపండి.', 'Send us the details of your village.')}
              </T>
            </View>
          </PressableScale>
        </View>
      </View>

      {/* What a village story can be about */}
      <View style={styles.section}>
        <Heading title={pick('మీ ఊరి ప్రత్యేకత ఏమిటి?', 'What makes your village special?')} />
        <View style={styles.grid}>
          {SPECIALITIES.map((sp) => (
            <View key={sp.value} style={styles.tile}>
              <View style={styles.tileIcon}>
                <Icon name={sp.icon} size={20} color={color.wowDeep} />
              </View>
              <T variant="ui" weight="semibold" style={styles.tileText}>
                {pick(sp.te, sp.en)}
              </T>
            </View>
          ))}
        </View>
      </View>

      {/* How a shared story is published */}
      <View style={[styles.section, styles.process]}>
        <Heading title={pick('ప్రచురణ ప్రక్రియ', 'How your story gets published')} />
        {PUBLISH_STAGES.map((stage, i) => (
          <View key={stage.en} style={styles.stage}>
            <View style={styles.stageIcon}>
              <Icon name={stage.icon} size={20} color={color.onWow} />
            </View>
            <View style={styles.wayText}>
              <T variant="meta" weight="bold" color="muted" lang="en">
                {String(i + 1)}
              </T>
              <T variant="ui" weight="semibold">
                {pick(stage.te, stage.en)}
              </T>
            </View>
          </View>
        ))}
        <WowButton label={pick('మీ ఊరి కథ పంపండి', 'Share Your Village')} icon="pencil" iconRight="arrowRight" onPress={() => router.push('/share-village')} style={styles.cta} />
      </View>

      {/* Explore Villages */}
      <View style={styles.section}>
        <Heading title={pick('గ్రామాల కథలు', 'Explore Villages')} />
        {data?.articles.length ? (
          <View style={styles.cards}>
            {data.articles.map((article, i) => (
              <VillageCard key={article.short_id} article={article} index={i} />
            ))}
          </View>
        ) : stories.isPending ? null : (
          <T variant="ui" color="inkSoft">
            {pick('త్వరలో గ్రామాల కథలు ఇక్కడ. మీ ఊరి కథతో మొదలుపెట్టండి!', 'Village stories are coming soon. Start with yours!')}
          </T>
        )}
      </View>
    </Screen>
  );
}

/** A section title with the brand rule, as SectionHeader draws it, without its own side padding. */
function Heading({ title }: { title: string }) {
  const styles = useStyles();
  return (
    <View style={styles.heading}>
      <T variant="headlineMd" weight="bold" color="brand" accessibilityRole="header">
        {title}
      </T>
      <View style={styles.headingRule} aria-hidden />
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  heading: { gap: space.xs },
  headingRule: { width: 40, height: 3, borderRadius: radius.pill, backgroundColor: color.brand },
  body: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  welcome: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: color.wow,
    backgroundColor: color.brandDeep,
    padding: space.lg,
    paddingTop: space.xxl * 2,
    gap: space.lg,
    ...shadow('raised', color),
  },
  welcomeCopy: { gap: space.sm },
  soft: { opacity: 0.85 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.wowDeep,
  },
  ways: { gap: space.md },
  way: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radius.md },
  wayExplore: { borderWidth: 1, borderColor: alpha(color.onOverlay, 0.2), backgroundColor: alpha(color.onOverlay, 0.1) },
  wayShare: { backgroundColor: color.wowDeep },
  wayIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  wayIconShare: { backgroundColor: alpha(color.onOverlay, 0.2) },
  wayText: { flex: 1, minWidth: 0, gap: 2 },
  section: { gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.surface,
  },
  tileIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: color.wowTint },
  tileText: { flex: 1, minWidth: 0 },
  process: { padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: color.rule, backgroundColor: color.surface },
  stage: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stageIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.wowDeep },
  cta: { alignSelf: 'flex-start', marginTop: space.sm },
  cards: { gap: space.lg },
}));
