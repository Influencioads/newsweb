import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { absoluteMediaUrl } from '@/api/client';
import type { ArticleCard } from '@/api/types';
import { Wash, WowButton } from '@/components/wow/NominateCta';
import { useI18n } from '@/lib/i18n';
import { fetchVillageStories, MY_VILLAGE_IMAGE, MY_VILLAGE_INTRO, MY_VILLAGE_TITLE } from '@/lib/myVillage';
import { radius, shadow, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Button } from '@/ui/Button';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * My Village (మై విలేజ్) — the home block (website: features/wow/MyVillageStory.tsx):
 * the village-at-sunset picture with the "మన ఊరు.. మన గొప్పతనం!" introduction
 * and "Click to know more" to the My Village screen, then two village stories
 * from the my-village-story section (topped up from the local sections while
 * that one fills up).
 */

export function openArticle(article: ArticleCard) {
  router.push({ pathname: '/article/[shortId]', params: { shortId: article.short_id } });
}

export function openSection(slug: string) {
  router.push({ pathname: '/section/[slug]', params: { slug } });
}

/** A full-bleed photo card: tinted wash, big headline, standfirst, Read the story. */
export function VillageCard({ article, index }: { article: ArticleCard; index: number }) {
  const styles = useStyles();
  const { pick } = useI18n();
  const uri = absoluteMediaUrl(article.hero?.url ?? null);
  const head = pick(article.title_te, article.title_en);
  return (
    <PressableScale onPress={() => openArticle(article)} accessibilityRole="link" accessibilityLabel={head} style={styles.card}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          placeholder={article.hero?.blurhash ? { blurhash: article.hero.blurhash } : undefined}
          accessible={false}
        />
      ) : null}
      <Wash top={index % 2 ? 'success' : 'wow'} strength={0.45} middle={0.55} />
      <View style={styles.cardCopy}>
        <T variant="headlineMd" weight="bold" color="onOverlay" numberOfLines={3}>
          {head}
        </T>
        {article.summary_te ? (
          <T variant="bodySmall" color="onOverlay" lang="te" numberOfLines={3}>
            {article.summary_te}
          </T>
        ) : null}
        <WowButton label={pick('కథ చదవండి', 'Read the story')} iconRight="arrowRight" onPress={() => openArticle(article)} style={styles.cardButton} />
      </View>
    </PressableScale>
  );
}

export function MyVillageBlock() {
  const styles = useStyles();
  const { pick, language } = useI18n();
  const te = language === 'te';
  const stories = useQuery({ queryKey: ['wow', 'my-village-story'], queryFn: () => fetchVillageStories(), staleTime: 120_000 });
  const data = stories.data;

  return (
    <View style={styles.block}>
      <View style={styles.banner}>
        <Image
          source={MY_VILLAGE_IMAGE}
          style={styles.picture}
          contentFit="cover"
          contentPosition={{ top: '45%' }}
          accessibilityLabel={pick('సూర్యాస్తమయంలో ఓ గ్రామం, ఆలయం', 'A village and its temple at sunset')}
        />
        <View style={styles.bannerCopy}>
          <T variant="headlineMd" weight="bold" color="onOverlay" accessibilityRole="header">
            {te ? MY_VILLAGE_TITLE.te : MY_VILLAGE_TITLE.en}
          </T>
          {(te ? MY_VILLAGE_INTRO.te : MY_VILLAGE_INTRO.en).map((para) => (
            <T key={para} variant="bodySmall" color="onOverlay" style={styles.soft}>
              {para}
            </T>
          ))}
          <View style={styles.actions}>
            <WowButton label={pick('మరింత తెలుసుకోండి', 'Click to know more')} iconRight="arrowRight" onPress={() => router.push('/my-village')} />
            {data?.articles.length ? (
              <Button label={pick('అన్నీ చూడండి', 'See all')} variant="inverse" onPress={() => openSection(data.slug)} />
            ) : null}
          </View>
        </View>
      </View>

      {data?.articles.length ? (
        <View style={styles.cards}>
          {data.articles.map((article, i) => (
            <VillageCard key={article.short_id} article={article} index={i} />
          ))}
        </View>
      ) : stories.isPending ? null : (
        <T variant="ui" color="inkSoft">
          {pick('త్వరలో మీ ఊరి కథలు ఇక్కడ.', 'Village stories are coming soon.')}
        </T>
      )}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  block: { gap: space.lg },
  banner: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.brandDeep, ...shadow('raised', color) },
  picture: { width: '100%', aspectRatio: 16 / 10 },
  bannerCopy: { gap: space.md, padding: space.lg },
  soft: { opacity: 0.88 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
  cards: { gap: space.lg },
  card: {
    aspectRatio: 4 / 5,
    justifyContent: 'flex-end',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: color.brandDeep,
    ...shadow('raised', color),
  },
  cardCopy: { gap: space.sm, padding: space.lg },
  cardButton: { alignSelf: 'flex-start', marginTop: space.xs },
}));
