import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { Field, Select } from '@/components/ui/Field';
import * as publicApi from '@/features/public/api';
import * as readerApi from '@/features/reader/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { useReaderPrefs } from '@/stores/readerPrefs';
import type { LocalityOut } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * LocationPicker — the one state → district → mandal → locality cascade.
 *
 * Replaces the hand-rolled `<select>` trees that LocalPage, ProfilePage and
 * SubmitPage each carried. Same endpoints, same cache keys as before, so an
 * adopting page shares the warm cache:
 *
 * - `['public', 'config']`            states + districts (staleTime 5m)
 * - `['public', 'mandals', <slug>]`   mandals of a district (staleTime 1h)
 * - `['public', 'localities', <id>]`  localities of a mandal (staleTime 1h)
 *
 * Values are **slugs** (what `readerPrefs` persists and `/public/local` takes),
 * except `state`, which is the state code. Every change emits a complete value:
 * picking a parent clears its children, and picking a district fills in the
 * state it belongs to, so a caller that never stores a state (the Local page)
 * still shows the right one.
 *
 *     <LocationPicker
 *       levels="mandal"
 *       value={{ state, district: edition, mandal }}
 *       onChange={(next) => …}
 *     />
 *
 * `levels` caps the depth: `district` = state + district, `mandal` adds the
 * mandal, `locality` adds the locality. `required` marks the two anchors (state,
 * district) required; mandal and locality stay optional "— all —" filters.
 * `labels={false}` drops the `Field` labels and moves them to `aria-label`.
 */

export interface LocationValue {
  /** State **code** (`AP`, `TG`), not a slug. */
  state?: string | null;
  district?: string | null;
  mandal?: string | null;
  locality?: string | null;
}

/** Deepest level the picker offers. */
export type LocationLevel = 'district' | 'mandal' | 'locality';

export interface LocationPickerProps {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  levels?: LocationLevel;
  /** `row` lays the controls out side by side from `sm`; `stack` keeps one column. */
  layout?: 'row' | 'stack';
  labels?: boolean;
  required?: boolean;
  className?: string;
}

const DEPTH: Record<LocationLevel, number> = { district: 2, mandal: 3, locality: 4 };

const COLUMNS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

/**
 * ponytail: this belongs next to `fetchDistrictMandals` in
 * `src/features/public/api.ts` — that file is owned by another agent this wave,
 * so the one call lives here until it can be moved.
 */
async function fetchMandalLocalities(mandalId: number): Promise<LocalityOut[]> {
  const { data } = await api.get<LocalityOut[]>(`/public/locations/mandals/${mandalId}/localities`);
  return data;
}

interface LevelSpec {
  key: string;
  label: string;
  value: string;
  placeholder: string;
  loading: boolean;
  disabled: boolean;
  required: boolean;
  options: Array<{ value: string; label: string }>;
  onSelect: (next: string) => void;
}

/** One level of the cascade: a Select, wrapped in a Field unless `labels` is off. */
function LevelControl({ spec, labels, loadingText }: { spec: LevelSpec; labels: boolean; loadingText: string }) {
  const control = (
    <Select
      value={spec.value}
      disabled={spec.disabled}
      aria-label={labels ? undefined : spec.label}
      onChange={(event) => spec.onSelect(event.target.value)}
    >
      <option value="">{spec.loading ? loadingText : spec.placeholder}</option>
      {spec.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
  if (!labels) return control;
  return (
    <Field label={spec.label} required={spec.required}>
      {control}
    </Field>
  );
}

export function LocationPicker({
  value,
  onChange,
  levels = 'mandal',
  layout = 'row',
  labels = true,
  required = false,
  className,
}: LocationPickerProps) {
  const { t, pick, language } = useI18n();
  // Level names have no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const depth = DEPTH[levels];

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const districts = useMemo(() => config.data?.districts ?? [], [config.data]);
  // A district implies its state, so the first control is never blank while the
  // second one shows a choice.
  const stateCode = value.state || districts.find((d) => d.slug === value.district)?.state || '';
  const districtOptions = useMemo(
    () => districts.filter((d) => !stateCode || d.state === stateCode),
    [districts, stateCode],
  );

  const mandals = useQuery({
    queryKey: ['public', 'mandals', value.district],
    queryFn: () => publicApi.fetchDistrictMandals(value.district as string),
    enabled: depth >= 3 && Boolean(value.district),
    staleTime: 3_600_000,
  });

  const mandalId = mandals.data?.find((m) => m.slug === value.mandal)?.id ?? null;

  const localities = useQuery({
    queryKey: ['public', 'localities', mandalId],
    queryFn: () => fetchMandalLocalities(mandalId as number),
    enabled: depth >= 4 && mandalId != null,
    staleTime: 3_600_000,
  });

  const choose = L('— ఎంచుకోండి —', '— choose —');
  const all = L('— అన్నీ —', '— all —');

  const specs: LevelSpec[] = [
    {
      key: 'state',
      label: L('రాష్ట్రం', 'State'),
      value: stateCode,
      placeholder: choose,
      loading: config.isLoading,
      disabled: config.isLoading,
      required,
      options: (config.data?.states ?? []).map((s) => ({ value: s.code, label: pick(s.name_te, s.name_en) })),
      onSelect: (next) => onChange({ state: next || null, district: null, mandal: null, locality: null }),
    },
    {
      key: 'district',
      label: t('page.district'),
      value: value.district ?? '',
      placeholder: choose,
      loading: config.isLoading,
      disabled: config.isLoading || districtOptions.length === 0,
      required,
      options: districtOptions.map((d) => ({ value: d.slug, label: pick(d.name_te, d.name_en) })),
      onSelect: (next) =>
        onChange({
          state: districts.find((d) => d.slug === next)?.state || stateCode || null,
          district: next || null,
          mandal: null,
          locality: null,
        }),
    },
    {
      key: 'mandal',
      label: t('page.mandal'),
      value: value.mandal ?? '',
      placeholder: all,
      loading: mandals.isLoading,
      disabled: !value.district || mandals.isLoading || !mandals.data?.length,
      required: false,
      options: (mandals.data ?? []).map((m) => ({ value: m.slug, label: pick(m.name_te, m.name_en) })),
      onSelect: (next) =>
        onChange({
          state: stateCode || null,
          district: value.district ?? null,
          mandal: next || null,
          locality: null,
        }),
    },
    {
      key: 'locality',
      label: L('ఊరు / పట్టణం', 'Village / town'),
      value: value.locality ?? '',
      placeholder: all,
      loading: localities.isLoading,
      disabled: !value.mandal || localities.isLoading || !localities.data?.length,
      required: false,
      options: (localities.data ?? []).map((l) => ({ value: l.slug, label: pick(l.name_te, l.name_en) })),
      onSelect: (next) =>
        onChange({
          state: stateCode || null,
          district: value.district ?? null,
          mandal: value.mandal ?? null,
          locality: next || null,
        }),
    },
  ];

  return (
    <div className={cn('grid gap-3', layout === 'row' && (COLUMNS[depth] ?? ''), className)}>
      {specs.slice(0, depth).map((spec) => (
        <LevelControl key={spec.key} spec={spec} labels={labels} loadingText={t('state.loading')} />
      ))}
    </div>
  );
}

/**
 * The reader's own place, bound to `readerPrefs` — the `value`/`onChange` pair
 * the masthead dialog, reader settings and the Local page hand to
 * `<LocationPicker>`. Every choice applies at once. A signed-in reader's is
 * also mirrored to their server preferences (fire and forget), because local
 * push targets the district stored there. Nothing here ever guesses a place.
 *
 * The state is hook-local: `readerPrefs` stores the district and below, and the
 * picker derives the state from the district. The local state only counts while
 * no district is chosen — another picker may have moved the district since.
 */
export function useReaderPlace(): Pick<LocationPickerProps, 'value' | 'onChange'> {
  const queryClient = useQueryClient();
  const authed = useAuth((a) => a.status === 'authenticated');
  const { edition, mandal, locality, setEdition, setLocalLevels } = useReaderPrefs();
  const [state, setState] = useState<string | null>(null);

  return {
    value: { state: edition ? null : state, district: edition, mandal, locality },
    onChange: (next) => {
      setState(next.state ?? null);
      // Changing the district resets the levels beneath it (readerPrefs does
      // that itself); otherwise only the mandal or locality moved.
      if ((next.district ?? null) !== edition) setEdition(next.district ?? null);
      else setLocalLevels(next.mandal ?? null, next.locality ?? null);

      const p = useReaderPrefs.getState();
      if (!authed || (p.edition === edition && p.mandal === mandal && p.locality === locality)) return;
      readerApi
        .updatePreferences({ district_slug: p.edition, mandal_slug: p.mandal, locality_slug: p.locality })
        .then((data) => queryClient.setQueryData(['reader', 'preferences'], data))
        .catch(() => undefined);
    },
  };
}

/** The finest place the reader has chosen, in the interface language, or null.
 *  Same cache keys as the picker; the mandal and village lists are only asked
 *  for when those levels are set. */
export function useReaderPlaceName(): string | null {
  const { pick } = useI18n();
  const edition = useReaderPrefs((p) => p.edition);
  const mandal = useReaderPrefs((p) => p.mandal);
  const locality = useReaderPrefs((p) => p.locality);

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });
  const mandals = useQuery({
    queryKey: ['public', 'mandals', edition],
    queryFn: () => publicApi.fetchDistrictMandals(edition as string),
    enabled: Boolean(edition && mandal),
    staleTime: 3_600_000,
  });
  const mandalRow = mandals.data?.find((m) => m.slug === mandal);
  const localities = useQuery({
    queryKey: ['public', 'localities', mandalRow?.id ?? null],
    queryFn: () => fetchMandalLocalities(mandalRow!.id),
    enabled: Boolean(mandalRow && locality),
    staleTime: 3_600_000,
  });

  const place =
    localities.data?.find((l) => l.slug === locality) ??
    mandalRow ??
    config.data?.districts.find((d) => d.slug === edition);
  return place ? pick(place.name_te, place.name_en) : null;
}
