import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, RotateCcw, Save, X } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { Section } from '@/components/admin/FormControls';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { wowIcon } from '@/features/wow/icons';
import { DEFAULT_LOGO, DEFAULT_RADIO_IMAGE, useSiteConfig } from '@/features/wow/siteContent';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { RadioSegment, SiteContent } from '@/types/public';

import { ImageField, moveItem, RowActions, slugify, uniqueSlug } from './siteContentShared';
import { useL } from './useL';

/**
 * CMS → Site content: the parts of the website that are not stories — the
 * logo and the line under it, the home banner tag, WOW Radio, the Nominate
 * form's hero categories and the grievance address. Each card saves on its
 * own; "Reset" puts that card back to how the site shipped. The WOW category
 * cards are edited on the Taxonomy page, the footer pages under Footer pages.
 */

type Block = keyof SiteContent;

/**
 * One card's draft, save and reset. `prepare` finishes the draft on save —
 * rows added in this session get their ids there.
 */
function useBlock<K extends Block>(
  block: K,
  payload: cmsApi.SiteContentPayload,
  prepare: (draft: SiteContent[K]) => SiteContent[K] = (d) => d,
) {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState<SiteContent[K]>(payload.values[block]);
  // A save or reset refetches the payload; take the server's copy.
  useEffect(() => setDraft(payload.values[block]), [payload, block]);
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['cms', 'site-content'] });
    void queryClient.invalidateQueries({ queryKey: ['public', 'config'] });
  };
  const save = useMutation({
    mutationFn: () => cmsApi.saveSiteContent(block, prepare(draft)),
    onSuccess: () => {
      done();
      toast.success(t('state.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const reset = useMutation({
    mutationFn: () => cmsApi.resetSiteContent(block),
    onSuccess: () => {
      done();
      toast.success(t('state.updated'));
    },
    onError: (err) => toast.error(err),
  });
  const askReset = async () => {
    const ok = await confirm({
      title: L('అసలు దానికి మార్చాలా?', 'Go back to the original?'),
      body: L('ఈ భాగంలో మీరు చేసిన మార్పులు పోతాయి.', 'Your changes to this part are removed and the original comes back.'),
      confirmLabel: L('అవును, మార్చండి', 'Yes, reset'),
      tone: 'danger',
    });
    if (ok) reset.mutate();
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(payload.values[block]);
  return { draft, setDraft, save, reset, askReset, dirty, saved: payload.saved.includes(block), dialog };
}

/** What the Save / Reset row needs from `useBlock`, whichever block it is. */
interface BlockActionsState {
  save: { isPending: boolean; mutate: () => void };
  reset: { isPending: boolean };
  askReset: () => Promise<void>;
  dirty: boolean;
  saved: boolean;
  dialog: ReactNode;
}

/** The Save / Reset row under each card. */
function BlockActions({ state, canManage }: { state: BlockActionsState; canManage: boolean }) {
  const { t } = useI18n();
  const L = useL();
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
      <Button icon={Save} pending={state.save.isPending} disabled={!state.dirty} onClick={() => state.save.mutate()}>
        {t('ui.save')}
      </Button>
      {state.saved ? (
        <Button icon={RotateCcw} variant="ghost" pending={state.reset.isPending} onClick={() => void state.askReset()}>
          {L('అసలు దానికి మార్చండి', 'Reset to original')}
        </Button>
      ) : (
        <Badge tone="muted" size="xs">
          {L('అసలు విలువలు', 'Original')}
        </Badge>
      )}
      {state.dialog}
    </div>
  );
}

/** A Telugu / English pair of inputs side by side. */
function PairFields({
  label,
  te,
  en,
  onTe,
  onEn,
  disabled,
  hint,
}: {
  label: string;
  te: string;
  en: string;
  onTe: (v: string) => void;
  onEn: (v: string) => void;
  disabled: boolean;
  hint?: ReactNode;
}) {
  const L = useL();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={`${label} · ${L('తెలుగు', 'Telugu')}`} hint={hint}>
        <Input script="te" value={te} disabled={disabled} onChange={(e) => onTe(e.target.value)} />
      </Field>
      <Field label={`${label} · English`}>
        <Input script="en" value={en} disabled={disabled} onChange={(e) => onEn(e.target.value)} />
      </Field>
    </div>
  );
}

function BrandCard({ payload, canManage }: { payload: cmsApi.SiteContentPayload; canManage: boolean }) {
  const L = useL();
  const state = useBlock('brand', payload);
  const { draft, setDraft } = state;
  return (
    <Section
      title={L('లోగో, ట్యాగ్‌లైన్', 'Logo and tagline')}
      subtitle={L('హెడర్, ఫుటర్, CMS, ఈ-పేపర్‌లో కనిపిస్తాయి', 'Shown in the header, the footer, the CMS and the e-paper')}
    >
      <Field label={L('లోగో', 'Logo')} hint={L('వెడల్పాటి PNG/WebP, పారదర్శక నేపథ్యం ఉత్తమం', 'A wide PNG or WebP; a transparent background works best')}>
        <ImageField
          value={draft.logo_url}
          fallback={DEFAULT_LOGO}
          alt={L('లోగో', 'Logo')}
          disabled={!canManage}
          onChange={(logo_url) => setDraft({ ...draft, logo_url })}
        />
      </Field>
      <PairFields
        label={L('ట్యాగ్‌లైన్', 'Tagline')}
        hint={L('లోగో కింద, ఫుటర్‌లో', 'Under the logo and in the footer')}
        te={draft.tagline_te}
        en={draft.tagline_en}
        onTe={(tagline_te) => setDraft({ ...draft, tagline_te })}
        onEn={(tagline_en) => setDraft({ ...draft, tagline_en })}
        disabled={!canManage}
      />
      <BlockActions state={state} canManage={canManage} />
    </Section>
  );
}

function HomeCard({ payload, canManage }: { payload: cmsApi.SiteContentPayload; canManage: boolean }) {
  const L = useL();
  const state = useBlock('home', payload);
  const { draft, setDraft } = state;
  return (
    <Section
      title={L('హోమ్ బ్యానర్', 'Home banner')}
      subtitle={L('ముఖ్య కథనాల బ్యానర్‌పై నారింజ రంగు ట్యాగ్', 'The orange tag on the top-stories banner')}
    >
      <PairFields
        label={L('ట్యాగ్', 'Tag')}
        te={draft.banner_tag_te}
        en={draft.banner_tag_en}
        onTe={(banner_tag_te) => setDraft({ ...draft, banner_tag_te })}
        onEn={(banner_tag_en) => setDraft({ ...draft, banner_tag_en })}
        disabled={!canManage}
      />
      <BlockActions state={state} canManage={canManage} />
    </Section>
  );
}

/** Pick categories for a segment, in the order they are tried. */
function SegmentCategories({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const L = useL();
  const { pick } = useI18n();
  const categories = useSiteConfig().data?.categories ?? [];
  const name = (slug: string) => {
    const c = categories.find((x) => x.slug === slug);
    return c ? pick(c.name_te, c.name_en) : slug;
  };
  const left = categories.filter((c) => !value.includes(c.slug));
  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap gap-2">
        {value.map((slug, i) => (
          <li key={slug} className="inline-flex min-h-tap items-center gap-1 rounded-pill border border-rule bg-paper pl-3 pr-1 font-sans text-ui-sm">
            <span className="text-muted">{i + 1}.</span>
            <span className="te">{name(slug)}</span>
            <button
              type="button"
              disabled={disabled || value.length <= 1}
              onClick={() => onChange(value.filter((s) => s !== slug))}
              aria-label={`${L('తొలగించండి', 'Remove')} ${name(slug)}`}
              className="flex h-8 w-8 items-center justify-center rounded-pill text-muted hover:bg-rule hover:text-ink disabled:opacity-40"
            >
              <Icon icon={X} size="xs" />
            </button>
          </li>
        ))}
      </ol>
      <Select
        value=""
        disabled={disabled || !left.length}
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        aria-label={L('విభాగం జోడించండి', 'Add a category')}
      >
        <option value="">{L('+ విభాగం జోడించండి', '+ Add a category')}</option>
        {left.map((c) => (
          <option key={c.slug} value={c.slug}>
            {pick(c.name_te, c.name_en)}
          </option>
        ))}
      </Select>
    </div>
  );
}

const TONE_LABEL: Record<string, [string, string]> = {
  orange: ['నారింజ', 'Orange'],
  green: ['ఆకుపచ్చ', 'Green'],
  blue: ['నీలం', 'Blue'],
  purple: ['ఊదా', 'Purple'],
};

function RadioCard({ payload, canManage }: { payload: cmsApi.SiteContentPayload; canManage: boolean }) {
  const L = useL();
  const state = useBlock('radio', payload, withSegmentIds);
  const { draft, setDraft } = state;
  const segments = draft.segments;
  const setSegments = (next: RadioSegment[]) => setDraft({ ...draft, segments: next });
  const patch = (i: number, change: Partial<RadioSegment>) =>
    setSegments(segments.map((sg, j) => (j === i ? { ...sg, ...change } : sg)));
  const add = () =>
    setSegments([
      ...segments,
      { id: '', te: '', en: '', tagline_te: '', tagline_en: '', icon: 'sparkles', tone: 'orange', categories: [segments[0]?.categories[0] ?? 'mystery'] },
    ]);
  return (
    <Section
      title={L('వావ్ రేడియో', 'WOW Radio')}
      subtitle={L(
        'హోమ్ కార్డు చిత్రం, సెగ్మెంట్లు. ప్రతి సెగ్మెంట్ దాని విభాగాల్లోని తాజా కథనాలను చదువుతుంది.',
        'The card picture and the segments. Each segment reads out the newest stories from its categories.',
      )}
    >
      <Field label={L('రేడియో చిత్రం', 'Radio picture')}>
        <ImageField
          wide
          value={draft.image_url}
          fallback={DEFAULT_RADIO_IMAGE}
          alt={L('వావ్ రేడియో', 'WOW Radio')}
          disabled={!canManage}
          onChange={(image_url) => setDraft({ ...draft, image_url })}
        />
      </Field>
      <ol className="space-y-3">
        {segments.map((sg, i) => (
          <li key={sg.id || `new-${i}`}>
            <Card tone="paper" padding="md" className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-wow-tint text-wow-deep">
                  <Icon icon={wowIcon(sg.icon)} size="md" />
                </span>
                <p className="min-w-0 flex-1 font-sans text-ui font-bold text-ink">
                  {sg.en || sg.te || L('కొత్త సెగ్మెంట్', 'New segment')}
                  {sg.id ? <span className="ml-2 font-normal text-muted">/radio/{sg.id}</span> : null}
                </p>
                {canManage ? (
                  <RowActions
                    index={i}
                    count={segments.length}
                    onMove={(d) => setSegments(moveItem(segments, i, d))}
                    onRemove={() => setSegments(segments.filter((_, j) => j !== i))}
                  />
                ) : null}
              </div>
              <PairFields
                label={L('పేరు', 'Name')}
                te={sg.te}
                en={sg.en}
                onTe={(te) => patch(i, { te })}
                onEn={(en) => patch(i, { en })}
                disabled={!canManage}
              />
              <PairFields
                label={L('ఒక్క లైన్', 'One line')}
                te={sg.tagline_te}
                en={sg.tagline_en}
                onTe={(tagline_te) => patch(i, { tagline_te })}
                onEn={(tagline_en) => patch(i, { tagline_en })}
                disabled={!canManage}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={L('ఐకాన్', 'Icon')}>
                  <Select value={sg.icon} disabled={!canManage} onChange={(e) => patch(i, { icon: e.target.value })}>
                    {payload.icons.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={L('రంగు', 'Colour')}>
                  <Select value={sg.tone} disabled={!canManage} onChange={(e) => patch(i, { tone: e.target.value })}>
                    {payload.radio_tones.map((tone) => (
                      <option key={tone} value={tone}>
                        {L(...(TONE_LABEL[tone] ?? [tone, tone]))}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field
                label={L('విభాగాలు', 'Categories')}
                hint={L('వరుసగా ప్రయత్నిస్తుంది; కథనాలు ఉన్న మొదటిది ప్లే అవుతుంది', 'Tried in order; the first with stories is played')}
              >
                <SegmentCategories value={sg.categories} onChange={(categories) => patch(i, { categories })} disabled={!canManage} />
              </Field>
            </Card>
          </li>
        ))}
      </ol>
      {canManage && segments.length < 8 ? (
        <Button icon={Plus} variant="secondary" size="sm" onClick={add}>
          {L('సెగ్మెంట్ జోడించండి', 'Add a segment')}
        </Button>
      ) : null}
      <BlockActions state={state} canManage={canManage} />
    </Section>
  );
}

/** A new segment gets its link (/radio/<id>) from its English name. */
function withSegmentIds(radio: SiteContent['radio']): SiteContent['radio'] {
  const taken = new Set(radio.segments.map((sg) => sg.id).filter(Boolean));
  return {
    ...radio,
    segments: radio.segments.map((sg) => (sg.id ? sg : { ...sg, id: uniqueSlug(slugify(sg.en), taken, 'segment') })),
  };
}

/** A new hero category gets its stored value from its English name. */
function withChoiceValues(nominate: SiteContent['nominate']): SiteContent['nominate'] {
  const taken = new Set(nominate.categories.map((c) => c.value).filter(Boolean));
  return {
    ...nominate,
    categories: nominate.categories.map((c) => (c.value ? c : { ...c, value: uniqueSlug(slugify(c.en), taken, 'category') })),
  };
}

function NominateCard({ payload, canManage }: { payload: cmsApi.SiteContentPayload; canManage: boolean }) {
  const L = useL();
  const state = useBlock('nominate', payload, withChoiceValues);
  const { draft, setDraft } = state;
  const rows = draft.categories;
  const setRows = (categories: typeof rows) => setDraft({ ...draft, categories });
  return (
    <Section
      title={L('నామినేట్ ఫారం', 'Nominate form')}
      subtitle={L('"హీరో విభాగం" జాబితాలో కనిపించే ఎంపికలు', 'The choices in the form’s "Hero category" list')}
    >
      <ol className="space-y-2">
        {rows.map((c, i) => (
          <li key={c.value || `new-${i}`} className="flex flex-wrap items-end gap-3 sm:flex-nowrap">
            <Field label={`${i + 1}. ${L('తెలుగు', 'Telugu')}`} className="min-w-0 flex-1">
              <Input
                script="te"
                value={c.te}
                disabled={!canManage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, te: e.target.value } : r)))}
              />
            </Field>
            <Field label="English" className="min-w-0 flex-1">
              <Input
                script="en"
                value={c.en}
                disabled={!canManage}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, en: e.target.value } : r)))}
              />
            </Field>
            {canManage ? (
              <RowActions
                index={i}
                count={rows.length}
                onMove={(d) => setRows(moveItem(rows, i, d))}
                onRemove={() => setRows(rows.filter((_, j) => j !== i))}
              />
            ) : null}
          </li>
        ))}
      </ol>
      {canManage && rows.length < 20 ? (
        <Button icon={Plus} variant="secondary" size="sm" onClick={() => setRows([...rows, { value: '', te: '', en: '' }])}>
          {L('ఎంపిక జోడించండి', 'Add a choice')}
        </Button>
      ) : null}
      <BlockActions state={state} canManage={canManage} />
    </Section>
  );
}

function ContactCard({ payload, canManage }: { payload: cmsApi.SiteContentPayload; canManage: boolean }) {
  const L = useL();
  const state = useBlock('contact', payload);
  const { draft, setDraft } = state;
  return (
    <Section
      title={L('సంప్రదింపు', 'Contact')}
      subtitle={L(
        'ప్రతి పాలసీ పేజీలోని "గ్రీవెన్స్ అధికారికి రాయండి" బటన్ ఈ చిరునామాకు వెళ్తుంది',
        'The "Email the Grievance Officer" button on every policy page goes to this address',
      )}
    >
      <Field label={L('గ్రీవెన్స్ ఈమెయిల్', 'Grievance email')}>
        <Input
          type="email"
          script="en"
          value={draft.grievance_email}
          disabled={!canManage}
          onChange={(e) => setDraft({ ...draft, grievance_email: e.target.value })}
        />
      </Field>
      <BlockActions state={state} canManage={canManage} />
    </Section>
  );
}

export function SiteContentPage() {
  const L = useL();
  const canManage = useAuth((st) => st.can)('settings.manage');
  const q = useQuery({ queryKey: ['cms', 'site-content'], queryFn: cmsApi.fetchSiteContent });
  return (
    <AdminPage
      title={L('సైట్ కంటెంట్', 'Site content')}
      subtitle={L(
        'కథనాలు కాని వెబ్‌సైట్ భాగాలు. ప్రతి కార్డు విడిగా సేవ్ అవుతుంది; కొన్ని నిమిషాల్లో సైట్‌లో కనిపిస్తుంది.',
        'The parts of the website that are not stories. Each card saves on its own and shows on the site within a few minutes.',
      )}
      actions={
        <ButtonLink to="/admin/taxonomy" variant="secondary" size="sm" iconRight={ExternalLink}>
          {L('వావ్ కేటగిరీ కార్డులు', 'WOW category cards')}
        </ButtonLink>
      }
    >
      <QueryState query={q}>
        {(payload) => (
          <div className="space-y-6">
            <BrandCard payload={payload} canManage={canManage} />
            <HomeCard payload={payload} canManage={canManage} />
            <RadioCard payload={payload} canManage={canManage} />
            <NominateCard payload={payload} canManage={canManage} />
            <ContactCard payload={payload} canManage={canManage} />
          </div>
        )}
      </QueryState>
    </AdminPage>
  );
}
