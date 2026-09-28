import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import * as publicApi from '@/api/public';
import * as readerApi from '@/api/reader';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { usePrefs } from '@/stores/prefs';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Chip, ChipRail } from '@/ui/Chip';
import { T } from '@/ui/Text';

/**
 * Where the reader wants their news from: state → district → mandal → village.
 *
 * **One cascade, every place.** The local tab mounts the rails inline; the
 * home header, the article bar and the profile screen open them in a sheet.
 * There is no second copy to keep in step.
 *
 * **The reader chooses; nothing is guessed.** There is no GPS path and no
 * geocoding — every level is a chip the reader tapped. A signed-in reader's
 * choice is also written to their server preferences, because local push
 * targets the district stored there.
 */

export type LocationLevels = 'district' | 'mandal' | 'locality';

export interface LocationRailsProps {
  /** How deep to go. The local feed wants all four; a district edition stops early. */
  levels?: LocationLevels;
}

const useStyles = makeStyles(() => ({
  pickers: { gap: space.md, paddingVertical: space.sm },
  picker: { gap: space.xs },
  label: { paddingHorizontal: space.lg },
  done: { paddingHorizontal: space.lg, paddingTop: space.sm },
}));

/** One labelled single-select rail. */
function Picker({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <T variant="meta" color="muted" style={styles.label}>
        {label}
      </T>
      <ChipRail snap>{children}</ChipRail>
    </View>
  );
}

export function LocationRails({ levels = 'locality' }: LocationRailsProps) {
  const styles = useStyles();
  const { t, pick } = useI18n();
  const authed = useAuth((s) => s.status === 'authenticated');
  const edition = usePrefs((s) => s.edition);
  const mandal = usePrefs((s) => s.mandal);
  const locality = usePrefs((s) => s.locality);
  const setEdition = usePrefs((s) => s.setEdition);
  const setMandal = usePrefs((s) => s.setMandal);
  const setLocality = usePrefs((s) => s.setLocality);
  const [stateCode, setStateCode] = useState('');

  // Apply locally first (the feeds follow at once), then mirror a signed-in
  // reader's place to the server. Fire and forget: a failed write only costs
  // local push until the next choice.
  function choose(change: () => void) {
    change();
    if (!authed) return;
    const p = usePrefs.getState();
    readerApi
      .updatePreferences({ district_slug: p.edition, mandal_slug: p.mandal, locality_slug: p.locality })
      .catch(() => undefined);
  }

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  // A chosen district's state wins over the tapped one: another rail (the home
  // sheet, the local tab) may have moved the district since this one's tap.
  const effectiveState = useMemo(
    () => config.data?.districts.find((d) => d.slug === edition)?.state || stateCode || 'AP',
    [stateCode, config.data, edition],
  );

  const districts = useMemo(
    () => (config.data?.districts ?? []).filter((d) => d.state === effectiveState),
    [config.data, effectiveState],
  );

  const mandals = useQuery({
    queryKey: ['mandals', edition],
    queryFn: () => publicApi.fetchDistrictMandals(edition!),
    enabled: Boolean(edition) && levels !== 'district',
    staleTime: 3_600_000,
  });

  const mandalId = mandals.data?.find((m) => m.slug === mandal)?.id;
  const localities = useQuery({
    queryKey: ['localities', mandalId],
    queryFn: () => publicApi.fetchMandalLocalities(mandalId!),
    enabled: Boolean(mandalId) && levels === 'locality',
    staleTime: 3_600_000,
  });

  return (
    <View style={styles.pickers}>
      <Picker label={t('local.state')}>
        {(config.data?.states ?? []).map((s) => (
          <Chip
            key={s.code}
            role="radio"
            label={pick(s.name_te, s.name_en)}
            selected={effectiveState === s.code}
            onPress={() => {
              setStateCode(s.code);
              // Re-tapping the district's own state keeps the place.
              if (edition && effectiveState !== s.code) choose(() => setEdition(null));
            }}
          />
        ))}
      </Picker>

      {districts.length ? (
        <Picker label={t('local.district')}>
          {districts.map((d) => (
            <Chip
              key={d.slug}
              role="radio"
              label={pick(d.name_te, d.name_en)}
              selected={edition === d.slug}
              onPress={() => choose(() => setEdition(edition === d.slug ? null : d.slug))}
            />
          ))}
        </Picker>
      ) : null}

      {levels !== 'district' && edition && mandals.data?.length ? (
        <Picker label={t('local.mandal')}>
          <Chip
            role="radio"
            label={t('local.all')}
            selected={!mandal}
            onPress={() => choose(() => setMandal(null))}
          />
          {mandals.data.map((m) => (
            <Chip
              key={m.slug}
              role="radio"
              label={pick(m.name_te, m.name_en)}
              selected={mandal === m.slug}
              onPress={() => choose(() => setMandal(mandal === m.slug ? null : m.slug))}
            />
          ))}
        </Picker>
      ) : null}

      {levels === 'locality' && mandal && localities.data?.length ? (
        <Picker label={t('local.locality')}>
          <Chip
            role="radio"
            label={t('local.all')}
            selected={!locality}
            onPress={() => choose(() => setLocality(null))}
          />
          {localities.data.map((l) => (
            <Chip
              key={l.slug}
              role="radio"
              label={pick(l.name_te, l.name_en)}
              selected={locality === l.slug}
              onPress={() => choose(() => setLocality(locality === l.slug ? null : l.slug))}
            />
          ))}
        </Picker>
      ) : null}
    </View>
  );
}

export function LocationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('local.choosePlace')}>
      <LocationRails levels="locality" />
      <View style={styles.done}>
        <Button label={t('ui.done')} icon="check" full onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

/**
 * The finest place the reader has chosen, in their language — what a button
 * that opens the sheet says. Shares the rails' query keys, and only asks for
 * the mandal/village lists when those levels are actually set.
 */
export function usePlaceName(): string | null {
  const { pick } = useI18n();
  const edition = usePrefs((s) => s.edition);
  const mandal = usePrefs((s) => s.mandal);
  const locality = usePrefs((s) => s.locality);

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });
  const mandals = useQuery({
    queryKey: ['mandals', edition],
    queryFn: () => publicApi.fetchDistrictMandals(edition!),
    enabled: Boolean(edition && mandal),
    staleTime: 3_600_000,
  });
  const mandalRow = mandals.data?.find((m) => m.slug === mandal);
  const localities = useQuery({
    queryKey: ['localities', mandalRow?.id],
    queryFn: () => publicApi.fetchMandalLocalities(mandalRow!.id),
    enabled: Boolean(mandalRow && locality),
    staleTime: 3_600_000,
  });

  const place =
    localities.data?.find((l) => l.slug === locality) ??
    mandalRow ??
    config.data?.districts.find((d) => d.slug === edition);
  return place ? pick(place.name_te, place.name_en) : null;
}
