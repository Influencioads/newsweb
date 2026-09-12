import { router } from 'expo-router';
import { Linking, Share, View } from 'react-native';

import { API_BASE } from '@/api/client';
import type { Topic } from '@/api/epaper';
import type { BreakingItem, HomePayload } from '@/api/types';
import { SectionHeader } from '@/components/SectionHeader';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Button, IconButton } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ChipRail } from '@/ui/Chip';
import { Icon } from '@/ui/Icon';
import { T } from '@/ui/Text';

/**
 * Everything above the first story on Home: the breaking rail, today's
 * e-paper promo (ink card) and the top-3 topics. Rendered once as the feed's
 * ListHeaderComponent; the masthead itself stays outside the list so it can
 * collapse against the scroll.
 */
export interface HomeListHeaderProps {
  breaking: BreakingItem[];
  epaper: HomePayload['epaper'];
  topics: Topic[];
}

function openArticle(shortId: string) {
  router.push({ pathname: '/article/[shortId]', params: { shortId } });
}

export function HomeListHeader({ breaking, epaper, topics }: HomeListHeaderProps) {
  const styles = useStyles();
  const color = useColors();
  const { t, pick } = useI18n();

  return (
    <View>
      {breaking.length ? (
        <ChipRail style={styles.rail}>
          <Badge tone="breaking" icon="zap" label={t('home.breaking')} style={styles.breakingLabel} />
          {breaking.map((item) => {
            const title = pick(item.title_te, item.title_en);
            return (
              <Card
                key={item.short_id}
                elevated
                padding="sm"
                accessibilityLabel={title}
                onPress={() => openArticle(item.short_id)}
                style={styles.breakingItem}
              >
                <T variant="bodySmall" weight="semibold" numberOfLines={2}>
                  {title}
                </T>
              </Card>
            );
          })}
        </ChipRail>
      ) : null}

      {epaper ? (
        <Card tone="ink" style={styles.epaper}>
          <T variant="meta" weight="semibold" color="onOverlay" style={styles.soft}>
            {t('epaper.promoEyebrow')}
          </T>
          <T variant="headlineMd" weight="heavy" color="onOverlay">
            {t('epaper.promoTitle')}
          </T>
          <T variant="meta" color="onOverlay" style={styles.soft}>
            {epaper.pub_date} · {epaper.page_count} {t('ui.pages')}
          </T>
          <View style={styles.actions}>
            <Button
              label={t('epaper.read')}
              icon="bookOpen"
              variant="inverse"
              onPress={() => router.push({ pathname: '/epaper/[date]', params: { date: epaper.pub_date } })}
            />
            <IconButton
              name="headphones"
              label={t('epaper.listen')}
              color={color.onOverlay}
              onPress={() => router.push({ pathname: '/epaper/[date]', params: { date: epaper.pub_date } })}
            />
            <IconButton
              name="share2"
              label={t('ui.share')}
              color={color.onOverlay}
              onPress={() =>
                Share.share({
                  message: `Today's Telugu News\nhttps://telugunews.influencioweb.com/epaper/${epaper.pub_date}/page/1`,
                })
              }
            />
            <IconButton
              name="download"
              label={t('epaper.download')}
              color={color.onOverlay}
              onPress={() => Linking.openURL(`${API_BASE}/epaper/${epaper.pub_date}/pdf`)}
            />
            <IconButton
              name="newspaper"
              label={t('epaper.myEpaper')}
              color={color.onOverlay}
              onPress={() => router.push('/my-epaper')}
            />
          </View>
        </Card>
      ) : null}

      {topics.length ? (
        <View>
          <SectionHeader title={t('ui.topTopics')} />
          {topics.map((topic, i) => {
            const title = pick(topic.title_te, topic.title_en);
            return (
              <Card
                key={topic.slug}
                elevated
                padding="sm"
                accessibilityLabel={`${i + 1}. ${title}`}
                onPress={() => router.push({ pathname: '/topic/[slug]', params: { slug: topic.slug } })}
                style={styles.topic}
              >
                <View style={styles.topicRow}>
                  <T variant="headlineMd" weight="heavy" color="brand" lang="en" style={styles.topicNumber}>
                    {String(i + 1)}
                  </T>
                  <T variant="headlineSm" weight="bold" numberOfLines={2} style={styles.topicTitle}>
                    {title}
                  </T>
                  <Icon name="chevronRight" size={20} color={color.brand} />
                </View>
              </Card>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  rail: { paddingVertical: space.sm },
  breakingLabel: { alignSelf: 'center' },
  breakingItem: { maxWidth: 280 },
  epaper: { marginHorizontal: space.lg, marginTop: space.md, gap: space.xs },
  soft: { opacity: 0.8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.md },
  topic: { marginHorizontal: space.lg, marginTop: space.sm },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  topicNumber: { minWidth: 24, textAlign: 'center' },
  topicTitle: { flex: 1 },
}));
