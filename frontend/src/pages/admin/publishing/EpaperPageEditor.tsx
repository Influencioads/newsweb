import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Save, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';
import type { EpaperEdition, EpaperPage } from '@/types/epaper';

import { LAYOUTS, useL } from './shared';

/**
 * One page of an e-paper edition: title, layout and the ordered article IDs.
 * Locked (read-only, no delete / reorder) once the edition is published.
 */
export interface EpaperPageEditorProps {
  edition: EpaperEdition;
  page: EpaperPage;
  onSaved: () => void;
  onMove: (delta: number) => void;
  /** A reorder is in flight — both move buttons wait for it. */
  moving?: boolean;
}

export function EpaperPageEditor({ edition, page, onSaved, onMove, moving = false }: EpaperPageEditorProps) {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [title, setTitle] = useState(page.title);
  const [layout, setLayout] = useState(page.layout_type);
  const [ids, setIds] = useState(page.articles.map((a) => a.id).join(', '));

  const save = useMutation({
    mutationFn: () =>
      api.updatePage(edition.id, page.id, {
        title,
        layout_type: layout,
        article_ids: ids.split(',').map(Number).filter(Boolean),
        poll_id: page.poll_id,
      }),
    onSuccess: () => {
      toast.success(t('state.saved'));
      onSaved();
    },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePage(edition.id, page.id),
    onSuccess: () => {
      toast.success(t('state.deleted'));
      onSaved();
    },
    onError: (e) => toast.error(e),
  });
  const locked = edition.status === 'PUBLISHED';

  const askDelete = () =>
    void confirm({
      title: L('ఈ పేజీని తొలగించాలా?', 'Delete this page?'),
      body: t('state.confirmDelete'),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    }).then((ok) => ok && remove.mutate());

  return (
    <Card as="article" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="brand" size="xs">
          {t('epaper.page')} {page.page_number}
        </Badge>
        {!locked ? (
          <div className="flex gap-1">
            <IconButton icon={ArrowUp} label={L('పేజీని పైకి జరపండి', 'Move page up')} disabled={moving} onClick={() => onMove(-1)} />
            <IconButton icon={ArrowDown} label={L('పేజీని కిందికి జరపండి', 'Move page down')} disabled={moving} onClick={() => onMove(1)} />
          </div>
        ) : null}
      </div>

      <Field label={L('పేజీ పేరు', 'Page name')}>
        <Input script="te" value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} />
      </Field>
      <Field label={L('లేఅవుట్', 'Layout')}>
        <Select script="en" value={layout} onChange={(e) => setLayout(e.target.value)} disabled={locked}>
          {LAYOUTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={L('ప్రచురించిన కథన IDలు, ప్రదర్శన క్రమంలో', 'Published article IDs, in display order')}
        hint={L('కామాలతో వేరు చేయండి', 'Comma separated')}
      >
        <Input script="en" value={ids} onChange={(e) => setIds(e.target.value)} disabled={locked} />
      </Field>

      {page.articles.length > 0 ? (
        <ol className="space-y-1">
          {page.articles.map((a) => (
            <li key={a.id} className="flex items-baseline gap-2">
              <span className="font-sans text-ui-sm tabular-nums text-muted">{a.position}.</span>
              <span lang="te" className="te min-w-0 flex-1 text-te-body-xs text-ink">
                {a.title_te}
              </span>
              <span className="font-sans text-meta text-muted">#{a.id}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {!locked ? (
        <div className="flex flex-wrap gap-2">
          <Button icon={Save} pending={save.isPending} onClick={() => save.mutate()}>
            {L('పేజీ సేవ్ చేయండి', 'Save page')}
          </Button>
          <Button variant="danger" icon={Trash2} pending={remove.isPending} onClick={askDelete}>
            {L('పేజీ తొలగించండి', 'Delete page')}
          </Button>
        </div>
      ) : null}
      {dialog}
    </Card>
  );
}
