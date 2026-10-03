import { router } from 'expo-router';
import { Share, View } from 'react-native';

import type { Topic } from '@/api/epaper';
import type { BreakingItem, HomePayload } from '@/api/types';
import { SectionHeader } from '@/components/SectionHeader';
import { EditorialGradient } from '@/components/home/EditorialGradient';
import { useI18n } from '@/lib/i18n';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Button, IconButton } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ChipRail } from '@/ui/Chip';
import { Icon } from '@/ui/Icon';
import { T } from '@/ui/Text';

/**
 * The urgent rail stays above the lead story. E-paper and topics are rendered
 * after the lead so readers encounter the main headline immediately.
 */
export interface HomeListHeaderProps {
  breaking: BreakingItem[];
}

function openArticle(shortId: string) {
  router.push({ pathname: '/article/[shortId]', params: { shortId } });
}

export function HomeListHeader({ breaking }: HomeListHeaderProps) {
  const styles = useStyles();
  const color = useColors();
  const { t, pick } = useI18n();

  if (!breaking.length) return null;

  return (
    <View style={styles.breakingBand}>
      <EditorialGradient tone="breaking" />
      <View style={styles.breakingRow}>
        <View style={styles.breakingLabel} aria-hidden>
          <Icon name="zap" size={16} color={color.onOverlay} />
          <T variant="ui" weight="bold" color="onOverlay">{t('home.breaking')}</T>
        </View>
        <ChipRail style={styles.rail} contentContainerStyle={styles.railContent}>
          {breaking.map((item) => {
            const title = pick(item.title_te, item.title_en);
            return (
              <Card
                key={item.short_id}
                elevated
                padding="sm"
                accessibilityLabel={`${t('home.breaking')}: ${title}`}
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
      </View>
    </View>
  );
}

export interface HomePromosProps {
  epaper: HomePayload['epaper'];
  topics: Topic[];
}

export function HomePromos({ epaper, topics }: HomePromosProps) {
  const styles = useStyles();
  const color = useColors();
  const { t, pick } = useI18n();

  return (
    <View>

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
              name="listen"
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

const useStyles = makeStyles((color) => ({
  breakingBand: {
    position: 'relative',
    overflow: 'hidden',
    marginHorizontal: space.lg,
    marginTop: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.inkDeep,
  },
  breakingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  breakingLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.md },
  rail: { flex: 1, minWidth: 0 },
  railContent: { paddingLeft: space.md, paddingRight: space.md },
  breakingItem: { maxWidth: 280 },
  epaper: { marginHorizontal: space.lg, marginTop: space.md, gap: space.xs },
  soft: { opacity: 0.8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.md },
  topic: { marginHorizontal: space.lg, marginTop: space.sm },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  topicNumber: { minWidth: 24, textAlign: 'center' },
  topicTitle: { flex: 1 },
}));
