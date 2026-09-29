import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RotateCcw, Sparkles, Trash2 } from 'lucide-react';

import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';
import type { EpaperEdition, EpaperPage } from '@/types/epaper';

import { layoutOptions, useL } from './shared';

/**
 * Toolbar for the page selected in the builder: name, layout, poll, fill,
 * reorder and delete. Every change is one PATCH/POST and a refetch; the
 * sheet under it redraws from the page JSON. Mount with `key={page.id}` so
 * the name box follows the selection.
 */
export interface EpaperPageEditorProps {
  edition: EpaperEdition;
  page: EpaperPage;
  /** A published edition, or a viewer without `epaper.hotspot`: every control is disabled. */
  locked: boolean;
}

export function EpaperPageEditor({ edition, page, locked }: EpaperPageEditorProps) {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [title, setTitle] = useState(page.title);
  const savedTitle = useRef(page.title);
  const polls = useQuery({ queryKey: ['admin-polls'], queryFn: api.fetchAdminPolls, enabled: !locked });
  const index = edition.pages.findIndex((p) => p.id === page.id);

  const done = (message: string) => {
    void qc.invalidateQueries({ queryKey: ['admin-epaper'] });
    toast.success(message);
  };
  const patch = useMutation({
    mutationFn: (changes: api.PagePatch) => api.updatePage(edition.id, page.id, changes),
    onSuccess: () => done(t('state.saved')),
    onError: (e) => toast.error(e),
  });
  const fill = useMutation({
    mutationFn: (reset: boolean) => api.fillPage(edition.id, page.id, reset),
    onSuccess: () => done(t('state.updated')),
    onError: (e) => toast.error(e),
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.orderPages(edition.id, ids),
    onSuccess: () => done(t('state.updated')),
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePage(edition.id, page.id),
    onSuccess: () => done(t('state.deleted')),
    onError: (e) => toast.error(e),
  });
  const busy = patch.isPending || fill.isPending || reorder.isPending || remove.isPending;

  const saveTitle = () => {
    const next = title.trim();
    if (!next || next === savedTitle.current) return;
    savedTitle.current = next;
    patch.mutate({ title: next });
  };
  const move = (delta: number) => {
    const ids = edition.pages.map((p) => p.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };
  const askReset = () =>
    void confirm({
      title: L('పేజీని ఖాళీ చేసి మళ్లీ నింపాలా?', 'Reset and refill this page?'),
      body: L('ఇప్పుడు ఉన్న కథనాలు తీసివేసి, సరిపోయే వాటితో మళ్లీ నింపుతుంది.', 'Removes every story on the page and fills it again with the best fits.'),
      confirmLabel: L('మళ్లీ నింపండి', 'Refill'),
      tone: 'danger',
    }).then((ok) => ok && fill.mutate(true));
  const askDelete = () =>
    void confirm({
      title: L('ఈ పేజీని తొలగించాలా?', 'Delete this page?'),
      body: t('state.confirmDelete'),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    }).then((ok) => ok && remove.mutate());

  const pollKnown = page.poll_id == null || (polls.data?.items ?? []).some((p) => p.id === page.poll_id);

  return (
    <Card as="section" aria-label={L('పేజీ సెట్టింగ్‌లు', 'Page settings')} className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={L('పేజీ పేరు', 'Page name')}>
          <Input
            script="te"
            value={title}
            disabled={locked}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                saveTitle();
              }
            }}
          />
        </Field>
        <Field label={L('లేఅవుట్', 'Layout')} hint={L('మార్చితే కథనాలు స్థానం ప్రకారం మళ్లీ స్లాట్‌లలోకి వెళ్తాయి.', 'Stories re-slot by position; any past the last slot drop off.')}>
          <Select script="en" value={page.layout_type} disabled={locked || busy} onChange={(e) => patch.mutate({ layout_type: e.target.value })}>
            {layoutOptions(L).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={L('బిగ్ క్వశ్చన్ పోల్', 'Big question poll')}>
          <Select
            script="te"
            value={page.poll_id ?? ''}
            disabled={locked || busy}
            onChange={(e) => patch.mutate({ poll_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{L('ఏదీ లేదు', 'None')}</option>
            {!pollKnown ? <option value={page.poll_id ?? ''}>#{page.poll_id}</option> : null}
            {(polls.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.question_te}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={Sparkles}
          disabled={locked || busy}
          pending={fill.isPending && fill.variables === false}
          onClick={() => fill.mutate(false)}
        >
          {L('ఖాళీ స్లాట్‌లు నింపండి', 'Fill empty slots')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={RotateCcw}
          disabled={locked || busy}
          pending={fill.isPending && fill.variables === true}
          onClick={askReset}
        >
          {L('రీసెట్ & మళ్లీ నింపండి', 'Reset & refill')}
        </Button>
        <IconButton
          icon={ChevronLeft}
          label={L('పేజీని ముందుకు జరపండి', 'Move page earlier')}
          disabled={locked || busy || index <= 0}
          onClick={() => move(-1)}
        />
        <IconButton
          icon={ChevronRight}
          label={L('పేజీని వెనక్కి జరపండి', 'Move page later')}
          disabled={locked || busy || index < 0 || index >= edition.pages.length - 1}
          onClick={() => move(1)}
        />
        <IconButton
          icon={Trash2}
          label={L('పేజీ తొలగించండి', 'Delete page')}
          disabled={locked || busy}
          pending={remove.isPending}
          onClick={askDelete}
          className="ml-auto text-breaking"
        />
      </div>
      {dialog}
    </Card>
  );
}
