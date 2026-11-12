import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import * as publicApi from '@/api/public';
import type { NavCategoryOut } from '@/api/types';
import { useI18n } from '@/lib/i18n';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors, useThemeName } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';
import { Chip, ChipRail } from '@/ui/Chip';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T, type TLang } from '@/ui/Text';

/**
 * The top of Home: the reader's quick switches and the category pick.
 *
 * - తెలుగు / English and Light / Dark, the same choices as Profile → reader
 *   preferences, one tap away (the website keeps its language switch in the
 *   masthead too).
 * - A row of category chips. Picking one, two or more makes Home show only
 *   stories from those categories; "All" clears the pick. The pick is saved
 *   with the other preferences, so Home opens the same way next time.
 */

interface Option<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
  lang?: TLang;
}

/** Two-way pill switch (a radio group): the chosen half is filled. */
function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly Option<V>[];
  onChange: (value: V) => void;
}) {
  const styles = useStyles();
  const color = useColors();
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <PressableScale
            key={o.value}
            onPress={() => onChange(o.value)}
            haptic="select"
            minHeight={TAP}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: on }}
            style={[styles.segment, on && styles.segmentOn]}
          >
            {o.icon ? <Icon name={o.icon} size={16} color={on ? color.onBrand : color.ink} /> : null}
            <T variant="ui" weight="semibold" color={on ? 'onBrand' : 'ink'} lang={o.lang} numberOfLines={1}>
              {o.label}
            </T>
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Nav categories first (the WOW menu), then the rest; one chip per name. */
function pickable(categories: NavCategoryOut[]) {
  const seen = new Set<string>();
  return [...categories]
    .sort((a, b) => Number(b.show_in_nav) - Number(a.show_in_nav))
    .filter((c) => {
      const key = c.name_en.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function HomeControls() {
  const styles = useStyles();
  const { t, pick, language, setLanguage } = useI18n();
  const theme = useThemeName();
  const setTheme = usePrefs((s) => s.setTheme);
  const picked = usePrefs((s) => s.homeCategories);
  const toggle = usePrefs((s) => s.toggleHomeCategory);
  const clear = usePrefs((s) => s.clearHomeCategories);

  const config = useQuery({ queryKey: ['config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
  const categories = pickable(config.data?.categories ?? []);

  return (
    <View style={styles.wrap}>
      <View style={styles.switches}>
        <Segmented
          label={t('profile.language')}
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'te', label: 'తెలుగు', lang: 'te' },
            { value: 'en', label: 'English', lang: 'en' },
          ]}
        />
        <Segmented
          label={t('ui.theme')}
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: t('ui.themeLight'), icon: 'sun' },
            { value: 'dark', label: t('ui.themeDark'), icon: 'moon' },
          ]}
        />
      </View>

      {categories.length ? (
        <View style={styles.pick}>
          <View style={styles.pickHead}>
            <T variant="ui" weight="bold" numberOfLines={1} style={styles.pickTitle}>
              {picked.length
                ? pick(`${picked.length} విభాగాలు ఎంచుకున్నారు`, `${picked.length} selected`)
                : pick('మీకు నచ్చిన విభాగాలు ఎంచుకోండి', 'Pick the categories you want')}
            </T>
            {picked.length ? (
              <PressableScale onPress={clear} minHeight={TAP} accessibilityRole="button" style={styles.clear}>
                <T variant="ui" weight="semibold" color="info">
                  {t('ui.clear')}
                </T>
              </PressableScale>
            ) : null}
          </View>
          <ChipRail>
            <Chip label={pick('అన్నీ', 'All')} selected={!picked.length} onPress={clear} />
            {categories.map((c) => {
              const on = picked.includes(c.slug);
              return (
                <Chip
                  key={c.slug}
                  label={pick(c.name_te, c.name_en)}
                  icon={on ? 'check' : undefined}
                  selected={on}
                  onPress={() => toggle(c.slug)}
                />
              );
            })}
          </ChipRail>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  wrap: { paddingTop: space.md, gap: space.md },
  switches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  segmented: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.surface,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  segmentOn: { backgroundColor: color.brand },
  pick: { gap: space.xs },
  pickHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  pickTitle: { flex: 1 },
  clear: { justifyContent: 'center', paddingLeft: space.sm },
}));
