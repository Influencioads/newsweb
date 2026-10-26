import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, FlatList, useWindowDimensions, View, type ListRenderItem } from 'react-native';

import type { ArticleCard } from '@/api/types';
import { FeaturedHomeCard } from '@/components/ArticleCard';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { PressableScale } from '@/ui/PressableScale';

const ADVANCE_MS = 6000;

/**
 * Home's first story as a pager of the top stories (lead first), as on the web.
 *
 * Full-width pages, so `pagingEnabled` snaps one story per swipe. It moves on
 * by itself every 6 s — never under reduced motion or a screen reader, and not
 * while the reader's finger is on it. A programmatic scroll sets the dot
 * itself: iOS fires no momentum event for one.
 */
export function LeadSlider({ articles, index }: { articles: ArticleCard[]; index?: number }) {
  const styles = useStyles();
  const { t } = useI18n();
  const m = useMotion();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<ArticleCard>>(null);
  const [shown, setShown] = useState(0);
  const [held, setHeld] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const count = articles.length;

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (held || screenReader || m.reduce || count < 2) return;
    const id = setTimeout(() => {
      const next = (shown + 1) % count;
      list.current?.scrollToOffset({ offset: next * width, animated: true });
      setShown(next);
    }, ADVANCE_MS);
    return () => clearTimeout(id);
  }, [shown, held, screenReader, m.reduce, count, width]);

  if (!articles[0]) return null;
  if (count < 2) return <FeaturedHomeCard article={articles[0]} index={index} />;

  const go = (i: number) => {
    list.current?.scrollToOffset({ offset: i * width, animated: !m.reduce });
    setShown(i);
  };

  const renderItem: ListRenderItem<ArticleCard> = ({ item, index: i }) => (
    <View style={{ width }}>
      <FeaturedHomeCard article={item} index={i === 0 ? index : undefined} />
    </View>
  );

  return (
    <View>
      <FlatList
        ref={list}
        data={articles}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.short_id}
        renderItem={renderItem}
        onScrollBeginDrag={() => setHeld(true)}
        onScrollEndDrag={() => setHeld(false)}
        onMomentumScrollEnd={(e) => setShown(Math.round(e.nativeEvent.contentOffset.x / width))}
      />
      <View style={styles.dots}>
        {articles.map((article, i) => (
          <PressableScale
            key={article.short_id}
            onPress={() => go(i)}
            accessibilityRole="button"
            accessibilityLabel={`${t('home.topStories')} ${i + 1} / ${count}`}
            accessibilityState={{ selected: i === shown }}
            style={styles.dotHit}
          >
            <View style={[styles.dot, i === shown && styles.dotOn]} />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  dots: { flexDirection: 'row', justifyContent: 'center' },
  dotHit: { minWidth: TAP, minHeight: TAP, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.ruleStrong },
  dotOn: { width: space.xl, backgroundColor: color.brand },
}));
