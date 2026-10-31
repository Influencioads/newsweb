import { View } from 'react-native';

import type { ArticleCard } from '@/api/types';
import { LeadSlider } from '@/components/home/LeadSlider';
import { radius, space } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';
import { useSiteContent } from '@/lib/siteContent';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon } from '@/ui/Icon';
import { T } from '@/ui/Text';

/**
 * Home's top story banner (website: features/wow/HeroBanner.tsx): up to ten
 * top stories that rotate — the desk's own picks from CMS → Home hero slides
 * first, in their order — under the orange "Every Story Has a WOW!" tag. The
 * rotation, swipe, dots and reduced-motion handling are the app's existing
 * LeadSlider; this adds the WOW framing above it.
 */
/** Slides in the banner, as on the website (frontend features/wow/HeroBanner.tsx). */
export const HERO_SLIDES = 10;

export function HeroBanner({ stories, index }: { stories: ArticleCard[]; index?: number }) {
  const styles = useStyles();
  const color = useColors();
  const { pick } = useI18n();
  // The tagline and the orange tag as the desk set them in CMS → Site content.
  const { brand, home } = useSiteContent();
  const slides = stories.slice(0, HERO_SLIDES);
  if (!slides.length) return null;
  return (
    <View>
      {/* Brand line under the masthead on the website; here it leads the page,
          where it has the full width (beside the logo it crowds the header). */}
      <T variant="eyebrow" weight="bold" color="ink" lang="auto" numberOfLines={1} style={styles.caption}>
        {pick(brand.tagline_te, brand.tagline_en)}
      </T>
      <View style={styles.tagRow}>
        <View style={styles.tag}>
          <Icon name="sparkles" size={16} color={color.onWow} />
          <T variant="meta" weight="bold" color="onWow">
            {pick(home.banner_tag_te, home.banner_tag_en)}
          </T>
        </View>
      </View>
      <LeadSlider articles={slides} index={index} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  caption: { paddingHorizontal: space.lg, paddingTop: space.md },
  tagRow: { flexDirection: 'row', paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: c.wowDeep,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
}));
