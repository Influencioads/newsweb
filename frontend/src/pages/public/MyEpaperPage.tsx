import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Newspaper, Pencil, Play, Search, Trash2 } from 'lucide-react';

import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as api from '@/features/epaper/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { UserEdition, UserEditionPreference } from '@/types/epaper';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * "My E-Paper" — the reader picks sections, topics, districts and mandals once
 * and the server assembles a personal edition every morning.
 *
 * Every picker is a Chip list with its own search box and a live "n selected"
 * count; renaming and deleting a saved edition go through PromptDialog /
 * ConfirmDialog, never a browser dialog.
 */

type PrefType = UserEditionPreference['preference_type'];
interface Option {
  id: number;
  name_te: string;
  name_en: string;
  slug: string;
}

function matches(option: Option, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  return option.name_te.includes(q) || option.name_en.toLowerCase().includes(q) || option.slug.includes(q);
}

interface PickerProps {
  title: string;
  type: PrefType;
  options: Option[];
  selected: UserEditionPreference[];
  onToggle: (type: PrefType, id: number) => void;
}

/** One preference group: search box, chips, and the count of what is chosen. */
function Picker({ title, type, options, selected, onToggle }: PickerProps) {
  const { t } = useI18n();
  const s = useScript();
  const [query, setQuery] = useState('');
  const chosen = new Set(selected.filter((x) => x.preference_type === type).map((x) => x.target_id));
  const list = options.filter((o) => matches(o, query));

  return (
    <section className="mt-7">
      <SectionHeader
        level={3}
        title={title}
        action={
          <span className={cn(s.body, 'shrink-0 text-meta text-muted')}>
            <span className="font-sans tabular-nums">{chosen.size}</span> {t('ui.selected')}
          </span>
        }
      />
      <Input
        leading={Search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('ui.search')}
        aria-label={`${t('ui.search')} · ${title}`}
      />
      {list.length ? (
        <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto p-1">
          {list.map((o) => {
            const label = s.text(o.name_te, o.name_en);
            return (
              <Chip
                key={o.id}
                lang={label.lang}
                textClass={label.telugu ? 'text-te-body-xs' : 'text-ui-sm'}
                selected={chosen.has(o.id)}
                onClick={() => onToggle(type, o.id)}
              >
                {label.text}
              </Chip>
            );
          })}
        </div>
      ) : (
        <EmptyState compact title={t('state.noResults')} />
      )}
    </section>
  );
}

export default function MyEpaperPage() {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const me = useAuth((x) => x.me);
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  useDocumentTitle(t('page.myEpaper'));

  const [name, setName] = useState('');
  const [time, setTime] = useState('06:00');
  const [preferences, setPreferences] = useState<UserEditionPreference[]>([]);
  const [renaming, setRenaming] = useState<UserEdition | null>(null);
  const [deleting, setDeleting] = useState<UserEdition | null>(null);

  const options = useQuery({ queryKey: ['epaper-options'], queryFn: api.fetchEpaperOptions });
  const saved = useQuery({ queryKey: ['my-epapers'], queryFn: api.fetchMyEditions, enabled: Boolean(me) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-epapers'] });

  const create = useMutation({
    mutationFn: () =>
      api.createMyEdition({
        name,
        auto_generate: true,
        generation_time: `${time}:00`,
        preferences: preferences.map((x, i) => ({ ...x, priority: i })),
      }),
    onSuccess: () => {
      setName('');
      setPreferences([]);
      toast.success(t('state.saved'));
      return invalidate();
    },
    onError: (error) => toast.error(error),
  });

  const generate = useMutation({
    mutationFn: api.generateMyEdition,
    onSuccess: (e) => nav(`/my-epaper/edition/${e.id}`),
    onError: (error) => toast.error(error),
  });

  const update = useMutation({
    mutationFn: ({ row, next }: { row: UserEdition; next: string }) =>
      api.updateMyEdition(row.id, {
        name: next,
        auto_generate: row.auto_generate,
        generation_time: row.generation_time,
        preferences: row.preferences,
      }),
    onSuccess: () => {
      toast.success(t('state.updated'));
      return invalidate();
    },
    onError: (error) => toast.error(error),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteMyEdition(id),
    onSuccess: () => {
      setDeleting(null);
      toast.success(t('state.deleted'));
      return invalidate();
    },
    onError: (error) => toast.error(error),
  });

  const toggle = (type: PrefType, target_id: number) =>
    setPreferences((current) =>
      current.some((x) => x.preference_type === type && x.target_id === target_id)
        ? current.filter((x) => !(x.preference_type === type && x.target_id === target_id))
        : [...current, { preference_type: type, target_id, priority: current.length }],
    );

  if (!me) {
    return (
      <PageContainer width="form" className="pb-12">
        <EmptyState
          icon={Newspaper}
          headingLevel={1}
          title={L('మీ ఈ-పేపర్ సృష్టించడానికి సైన్ ఇన్ చేయండి', 'Sign in to create your E-Paper')}
          body={t('ui.signInBody')}
          action={<ButtonLink to="/login">{t('page.login')}</ButtonLink>}
        />
      </PageContainer>
    );
  }

  const editions = saved.data?.items.filter((x) => x.is_active) ?? [];

  return (
    <PageContainer width="page" className="pb-12">
      <PageHeader
        icon={Newspaper}
        title={t('epaper.createMine')}
        subtitle={L(
          'విభాగాలు, ప్రాంతాలను ఒకసారి ఎంచుకోండి. ప్రతి ఉదయం తాజా ప్రచురిత వార్తలతో ఎడిషన్ సిద్ధమవుతుంది.',
          'Choose categories and places once. Fresh published news is prepared automatically every morning.',
        )}
      />

      <div className="space-y-7 md:space-y-10">
        <Card as="section" padding="lg">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field
              label={L('ఎడిషన్ పేరు', 'Edition name')}
              required
              hint={L('కనీసం 2 అక్షరాలు.', 'At least 2 characters.')}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={L('అజయ్ మార్నింగ్ ఎడిషన్', "Ajay's Morning Edition")}
              />
            </Field>
            <Field label={L('రోజువారీ సమయం', 'Daily time')}>
              <Input type="time" script="en" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>

          <QueryState
            query={options}
            compact
            skeleton={<SkeletonCard variant="compact" />}
            isEmpty={(d) => !d.categories.length && !d.tags.length && !d.districts.length && !d.mandals.length}
          >
            {(d) => (
              <>
                <Picker
                  title={L('విభాగాలు & ఆసక్తులు', 'Categories & interests')}
                  type="category"
                  options={d.categories}
                  selected={preferences}
                  onToggle={toggle}
                />
                <Picker
                  title={L('అంశాలు', 'Topics')}
                  type="tag"
                  options={d.tags}
                  selected={preferences}
                  onToggle={toggle}
                />
                <Picker
                  title={L('జిల్లాలు / ప్రాంతాలు', 'Districts / locations')}
                  type="district"
                  options={d.districts}
                  selected={preferences}
                  onToggle={toggle}
                />
                <Picker
                  title={L('మండలాలు', 'Mandals')}
                  type="mandal"
                  options={d.mandals}
                  selected={preferences}
                  onToggle={toggle}
                />
              </>
            )}
          </QueryState>

          <Button
            className="mt-7"
            size="lg"
            pending={create.isPending}
            disabled={name.trim().length < 2 || !preferences.length}
            onClick={() => create.mutate()}
          >
            {L('రోజువారీ ఎడిషన్ సేవ్ చేయండి', 'Save daily edition')}
          </Button>
          {/* Why the button is off, said out loud rather than left to guess. */}
          {!preferences.length ? (
            <p className={cn(s.body, 'mt-2 text-meta text-muted')}>
              {L('కనీసం ఒక అభిరుచి ఎంచుకోండి.', 'Choose at least one preference above.')}
            </p>
          ) : null}
        </Card>

        <section>
          <SectionHeader title={L('నా ఎడిషన్లు', 'My Editions')} />
          <QueryState
            query={saved}
            skeleton={<SkeletonCard variant="row" />}
            isEmpty={() => !editions.length}
            empty={
              <EmptyState
                compact
                icon={Newspaper}
                title={L('ఇంకా ఎడిషన్లు లేవు.', 'No editions yet.')}
                body={L('పైన ఒకటి సృష్టించండి.', 'Create one above.')}
              />
            }
          >
            {() => (
              <div className="grid gap-3 md:grid-cols-2">
                {editions.map((row) => (
                  <Card key={row.id} as="article">
                    <h3 className={cn(s.head, 'text-headline-sm font-extrabold')}>{row.name}</h3>
                    <p className={cn(s.body, 'mt-1 text-meta text-muted')}>
                      <span className="font-sans tabular-nums">{row.preferences.length}</span>{' '}
                      {L('అభిరుచులు · ప్రతిరోజూ', 'preferences · daily at')}{' '}
                      <span className="font-sans tabular-nums">{row.generation_time}</span>
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        icon={Play}
                        pending={generate.isPending && generate.variables === row.id}
                        onClick={() => generate.mutate(row.id)}
                      >
                        {L('ఈ రోజు రూపొందించి చదవండి', 'Generate / read today')}
                      </Button>
                      <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setRenaming(row)}>
                        {t('ui.edit')}
                      </Button>
                      <Button size="sm" variant="secondary" icon={Trash2} onClick={() => setDeleting(row)}>
                        {t('ui.delete')}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </QueryState>
        </section>
      </div>

      {renaming && (
        <PromptDialog
          open
          onClose={() => setRenaming(null)}
          title={L('ఎడిషన్ పేరు మార్చండి', 'Rename edition')}
          pending={update.isPending}
          fields={[
            {
              name: 'name',
              label: L('ఎడిషన్ పేరు', 'Edition name'),
              required: true,
              defaultValue: renaming.name,
            },
          ]}
          onSubmit={async (values) => {
            const next = (values.name ?? '').trim();
            if (!next) return;
            try {
              await update.mutateAsync({ row: renaming, next });
              setRenaming(null);
            } catch {
              // onError has already raised the toast; the dialog stays open.
            }
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={L('ఈ ఎడిషన్‌ను తొలగించాలా?', 'Delete this edition?')}
        body={t('state.confirmDelete')}
        confirmLabel={t('ui.delete')}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </PageContainer>
  );
}
