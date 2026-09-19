import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import * as publicApi from '@/api/public';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Chip, ChipRail } from '@/ui/Chip';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * Where the reader wants their news from: state → district → mandal → village.
 *
 * **One cascade, three places.** The local tab and the profile screen each had
 * their own copy of these rails, neither of them offering the village level
 * even though the server has stored and served it all along. This is the only
 * one now, and the article bar mounts it too, so a reader can change where
 * their news comes from from any story rather than only from one tab.
 *
 * **The GPS button is a prefill, not a decision.** It resolves a position to
 * our own places and drops them into the rails; the reader still sees what was
 * picked and can change it before anything is saved. That is the honest UX for
 * a guess, and it means a wrong match costs a tap rather than a wrong feed.
 * Nothing about the position is stored or sent anywhere else — the server
 * exchanges it for ids and discards it.
 *
 * Permission refused, no key configured, a point outside the two states, a
 * mandal nobody has seeded yet: every one of those ends with the rails still
 * sitting there, which is why the manual path is the primary one and the
 * button is the shortcut.
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
  locate: { paddingHorizontal: space.lg, paddingTop: space.xs },
  hint: { paddingHorizontal: space.lg },
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
  const toast = useToast();
  const edition = usePrefs((s) => s.edition);
  const mandal = usePrefs((s) => s.mandal);
  const locality = usePrefs((s) => s.locality);
  const setEdition = usePrefs((s) => s.setEdition);
  const setMandal = usePrefs((s) => s.setMandal);
  const setLocality = usePrefs((s) => s.setLocality);
  const setPlace = usePrefs((s) => s.setPlace);
  const [stateCode, setStateCode] = useState('');
  const [locating, setLocating] = useState(false);

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const effectiveState = useMemo(() => {
    if (stateCode) return stateCode;
    return config.data?.districts.find((d) => d.slug === edition)?.state ?? 'AP';
  }, [stateCode, config.data, edition]);

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

  async function locate() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        toast.error(t('local.locationDenied'));
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const place = await publicApi.resolveGeo(
        position.coords.latitude,
        position.coords.longitude,
      );
      if (!place.matched || !place.district) {
        toast.error(t('local.locationFailed'));
        return;
      }
      setStateCode(place.state_code ?? '');
      setPlace({
        edition: place.district.slug,
        mandal: place.mandal?.slug ?? null,
        locality: place.locality?.slug ?? null,
      });
    } catch {
      toast.error(t('local.locationFailed'));
    } finally {
      setLocating(false);
    }
  }

  return (
    <View style={styles.pickers}>
      <View style={styles.locate}>
        <Button
          variant="secondary"
          icon="place"
          label={locating ? t('local.locating') : t('local.useMyLocation')}
          pending={locating}
          full
          onPress={() => void locate()}
        />
      </View>

      <Picker label={t('local.state')}>
        {(config.data?.states ?? []).map((s) => (
          <Chip
            key={s.code}
            role="radio"
            label={pick(s.name_te, s.name_en)}
            selected={effectiveState === s.code}
            onPress={() => {
              setStateCode(s.code);
              setEdition(null);
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
              onPress={() => setEdition(edition === d.slug ? null : d.slug)}
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
            onPress={() => setMandal(null)}
          />
          {mandals.data.map((m) => (
            <Chip
              key={m.slug}
              role="radio"
              label={pick(m.name_te, m.name_en)}
              selected={mandal === m.slug}
              onPress={() => setMandal(mandal === m.slug ? null : m.slug)}
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
            onPress={() => setLocality(null)}
          />
          {localities.data.map((l) => (
            <Chip
              key={l.slug}
              role="radio"
              label={pick(l.name_te, l.name_en)}
              selected={locality === l.slug}
              onPress={() => setLocality(locality === l.slug ? null : l.slug)}
            />
          ))}
        </Picker>
      ) : null}
    </View>
  );
}

export function LocationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('local.choosePlace')}>
      <LocationRails levels="locality" />
    </BottomSheet>
  );
}
