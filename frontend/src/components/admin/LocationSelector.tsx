import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Field, Select } from '@/components/ui/Field';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import type { CmsDistrictOption, CmsOption } from '@/types/cms';

/**
 * §2 location cascade: State → District → Mandal → City/Village.
 *
 * Each level filters the next and clears everything below it, so an editor
 * cannot leave a mandal from the previous district attached to the story. The
 * server re-checks the same rule — this is guidance, not enforcement.
 *
 * Every level below the first is optional: most stories stop at district.
 */
export interface LocationValue {
  state: string;
  districtId: number | null;
  mandalId: number | null;
  localityId: number | null;
}

export interface LocationSelectorProps {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  states: CmsOption[];
  districts: CmsDistrictOption[];
  /** Server-side `mandal_id` message from a failed save. */
  mandalError?: ReactNode;
}

/** The API keys districts by state code; the states list carries slugs. */
const stateCode = (slug: string) => (slug === 'andhra-pradesh' ? 'AP' : slug === 'telangana' ? 'TS' : slug);

export function LocationSelector({ value, onChange, states, districts, mandalError }: LocationSelectorProps) {
  const { language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const pickLabel = L('ఎంచుకోండి', 'Choose');

  const mandals = useQuery({
    queryKey: ['cms', 'mandals', value.districtId],
    queryFn: () => cmsApi.fetchEditorMandals(value.districtId!),
    enabled: value.districtId != null,
  });
  const localities = useQuery({
    queryKey: ['cms', 'localities', value.mandalId],
    queryFn: () => cmsApi.fetchEditorLocalities(value.mandalId!),
    enabled: value.mandalId != null,
  });

  // A district chosen before the state was set should back-fill the state, so
  // editing an existing article shows the cascade already resolved.
  useEffect(() => {
    if (!value.state && value.districtId != null) {
      const match = districts.find((d) => d.id === value.districtId);
      if (match) onChange({ ...value, state: match.state });
    }
  }, [value, districts, onChange]);

  const visibleDistricts = value.state ? districts.filter((d) => d.state === value.state) : districts;

  return (
    <div className="space-y-4">
      <Field label={L('రాష్ట్రం', 'State')}>
        <Select value={value.state} onChange={(e) => onChange({ state: e.target.value, districtId: null, mandalId: null, localityId: null })}>
          <option value="">{L('జాతీయం', 'National')}</option>
          {states.map((s) => (
            <option key={s.id} value={stateCode(s.slug)}>
              {s.name_te} — {s.name_en}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={L('జిల్లా', 'District')}>
        <Select
          value={value.districtId ?? ''}
          onChange={(e) => onChange({ ...value, districtId: e.target.value ? Number(e.target.value) : null, mandalId: null, localityId: null })}
        >
          <option value="">{pickLabel}</option>
          {visibleDistricts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name_te} — {d.name_en}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={L('మండలం', 'Mandal')} hint={value.districtId ? undefined : L('ముందు జిల్లా ఎంచుకోండి', 'Choose a district first')} error={mandalError}>
        <Select
          disabled={value.districtId == null || mandals.isLoading}
          value={value.mandalId ?? ''}
          onChange={(e) => onChange({ ...value, mandalId: e.target.value ? Number(e.target.value) : null, localityId: null })}
        >
          <option value="">{pickLabel}</option>
          {(mandals.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name_te} — {m.name_en}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={L('ఊరు / పట్టణం', 'Village or town')} hint={value.mandalId ? undefined : L('ముందు మండలం ఎంచుకోండి', 'Choose a mandal first')}>
        <Select
          disabled={value.mandalId == null || localities.isLoading}
          value={value.localityId ?? ''}
          onChange={(e) => onChange({ ...value, localityId: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{pickLabel}</option>
          {(localities.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name_te} — {l.name_en}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
