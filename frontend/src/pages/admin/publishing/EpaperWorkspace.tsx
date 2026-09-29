import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ExternalLink, FileDown, Plus, Printer, RefreshCw, Send, Sparkles, Undo2, X } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/Dialog';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import { EpaperSheet } from '@/features/epaper/EpaperSheet';
import { EpaperSheetViewport } from '@/features/epaper/EpaperSheetViewport';
import * as api from '@/features/epaper/adminApi';
import { firstEmptySlot, placeAt, slotIds, swapSlots } from '@/features/epaper/slots';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { EpaperArticle, EpaperCandidate, EpaperEdition, EpaperSlot } from '@/types/epaper';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/time';

import { EpaperCandidates } from './EpaperCandidates';
import { EpaperGenerateDialog } from './EpaperGenerateDialog';
import { EpaperPageEditor } from './EpaperPageEditor';
import { SIZE_LABEL, SIZE_TONE, layoutOptions, useL } from './shared';

/**
 * The e-paper builder — one edition, one page at a time: the page's toolbar
 * and its sheet on the left, the stories that still fit on the right. Every
 * click is one request against the page JSON; nothing is held locally.
 *
 * Workflow: GENERATED → (submit) UNDER_REVIEW → (approve) APPROVED →
 * (publish) PUBLISHED, and withdraw back to GENERATED. A published edition is
 * read-only here until it is withdrawn.
 */

const REVIEWABLE = ['GENERATED', 'UNDER_REVIEW'];

function Workspace({ edition }: { edition: EpaperEdition }) {
  const { t, language } = useI18n();
  const L = useL();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const { confirm, dialog } = useConfirm();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const templates = useQuery({ queryKey: ['epaper-templates'], queryFn: api.fetchTemplates, enabled: adding });

  const page = edition.pages.find((p) => p.id === selectedId) ?? edition.pages[0] ?? null;
  const status = edition.status;
  const locked = status === 'PUBLISHED';
  const canEdit = can('epaper.hotspot') && !locked;
  const canPublish = can('epaper.publish');
  const canUpload = can('epaper.upload');

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-epaper'] });
  const updated = () => {
    invalidate();
    toast.success(t('state.updated'));
  };
  const place = useMutation({
    mutationFn: ({ pageId, ids }: { pageId: number; ids: (number | null)[] }) =>
      api.updatePage(edition.id, pageId, { article_ids: ids }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e),
  });
  const act = useMutation({
    mutationFn: (kind: api.EditionActionKind) => api.editionAction(edition.id, kind),
    onSuccess: updated,
    onError: (e) => toast.error(e),
  });
  const fillAll = useMutation({
    mutationFn: () => api.fillEdition(edition.id),
    onSuccess: updated,
    onError: (e) => toast.error(e),
  });
  const pdf = useMutation({
    mutationFn: () => api.renderPdf(edition.id),
    onSuccess: () => {
      invalidate();
      toast.success(L('PDF తయారవుతోంది…', 'Rendering the PDF…'));
    },
    onError: (e) => toast.error(e),
  });
  const addPage = useMutation({
    mutationFn: (v: Record<string, string>) =>
      api.addPage(edition.id, {
        title: v.title?.trim() || undefined,
        layout_type: v.layout_type || undefined,
        template_id: v.template_id ? Number(v.template_id) : undefined,
      }),
    onSuccess: (created) => {
      setAdding(false);
      setSelectedId(created.id);
      invalidate();
      toast.success(t('state.saved'));
    },
    onError: (e) => toast.error(e),
  });
  const busy = (kind: api.EditionActionKind) => act.isPending && act.variables === kind;

  // ---------------------------------------------------------------- placing
  const add = (c: EpaperCandidate) => {
    if (!page) return;
    const ids = slotIds(page);
    const slot = targetSlot ?? firstEmptySlot(page.slots, ids, c.size);
    if (slot == null) {
      toast.error(L('ఈ పేజీలో ఖాళీ స్లాట్ లేదు.', 'No empty slot on this page.'));
      return;
    }
    setTargetSlot(null);
    place.mutate({ pageId: page.id, ids: placeAt(ids, slot, c.id) });
  };
  const remove = (slot: number) => {
    if (page) place.mutate({ pageId: page.id, ids: slotIds(page).map((x, i) => (i === slot ? null : x)) });
  };
  const shift = (slot: number, delta: number) => {
    const to = slot + delta;
    if (!page || to < 0 || to >= page.slots.length) return;
    place.mutate({ pageId: page.id, ids: swapSlots(slotIds(page), slot, to) });
  };
  const slotCount = page?.slots.length ?? 0;

  // The sheet is drawn at canvas scale and fitted to the column, which would
  // shrink 44px buttons to ~25px; the chrome zooms back by the viewport's
  // scale so every control keeps its real tap size on screen.
  const chrome = { zoom: 'calc(1 / var(--ep-scale, 1))' } as const;

  const renderSlot = (slot: EpaperSlot, article: EpaperArticle | null, story: ReactNode) => {
    const targeted = targetSlot === slot.index;
    return (
      <div
        className={cn(
          'flex h-full flex-col gap-2 rounded-xl border-2 border-dashed p-2',
          targeted ? 'border-brand bg-brand-tint' : 'border-rule',
        )}
      >
        <div className="flex items-center justify-between gap-2" style={chrome}>
          <Badge tone={SIZE_TONE[slot.size]} size="xs" lang={language}>
            {slot.index + 1} · {SIZE_LABEL[slot.size][language]}
          </Badge>
          {article ? (
            <div className="flex items-center">
              <IconButton
                icon={ArrowLeft}
                label={L('ముందు స్లాట్‌కు జరపండి', 'Move to the previous slot')}
                disabled={place.isPending || slot.index === 0}
                onClick={() => shift(slot.index, -1)}
              />
              <IconButton
                icon={ArrowRight}
                label={L('తదుపరి స్లాట్‌కు జరపండి', 'Move to the next slot')}
                disabled={place.isPending || slot.index >= slotCount - 1}
                onClick={() => shift(slot.index, 1)}
              />
              <IconButton
                icon={X}
                label={`${t('ui.remove')}: ${article.title_te}`}
                disabled={place.isPending}
                onClick={() => remove(slot.index)}
              />
            </div>
          ) : null}
        </div>
        {article ? (
          story
        ) : (
          <div style={chrome}>
            <Button
              variant={targeted ? 'primary' : 'secondary'}
              size="sm"
              icon={Plus}
              aria-pressed={targeted}
              onClick={() => setTargetSlot(targeted ? null : slot.index)}
            >
              {L('కథనం జోడించండి', 'Add story')}
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------- workflow
  const askPublish = () =>
    void confirm({
      title: L('ఈ ఎడిషన్‌ను ప్రచురించాలా?', 'Publish this edition?'),
      body: L('పాఠకులకు వెంటనే కనిపిస్తుంది; PDF నేపథ్యంలో తయారవుతుంది.', 'Readers see it immediately; the PDF renders in the background.'),
      confirmLabel: L('ప్రచురించండి', 'Publish'),
    }).then((ok) => ok && act.mutate('publish'));
  const askWithdraw = () =>
    void confirm({
      title: L('ఎడిషన్‌ను వెనక్కి తీసుకోవాలా?', 'Withdraw this edition?'),
      body: L('పబ్లిక్ సైట్ నుంచి తొలగించి, మళ్లీ సవరణకు తెరుస్తుంది.', 'Takes it off the public site and reopens it for editing.'),
      confirmLabel: L('వెనక్కి తీసుకోండి', 'Withdraw'),
      tone: 'danger',
    }).then((ok) => ok && act.mutate('withdraw'));

  const pdfControl = () => {
    if (!canUpload || !['APPROVED', 'PUBLISHED'].includes(status)) return null;
    const pill = edition.pdf_status ? (
      <span className="inline-flex items-center gap-1 font-sans text-meta text-muted" title={edition.pdf_error ?? undefined}>
        PDF <StatusPill status={edition.pdf_status} />
      </span>
    ) : null;
    if (edition.pdf_status === 'READY' && edition.pdf_url) {
      return (
        <>
          {pill}
          <ButtonLink size="sm" variant="secondary" icon={FileDown} to={edition.pdf_url} external>
            {L('PDF తెరవండి', 'Open PDF')}
          </ButtonLink>
        </>
      );
    }
    if (edition.pdf_status === 'PENDING') return pill;
    return (
      <>
        {pill}
        <Button size="sm" variant="secondary" icon={FileDown} pending={pdf.isPending} onClick={() => pdf.mutate()}>
          {edition.pdf_status === 'FAILED' ? L('మళ్లీ రెండర్ చేయండి', 'Render again') : L('PDF రెండర్ చేయండి', 'Render PDF')}
        </Button>
      </>
    );
  };

  const actions = (
    <>
      <ButtonLink to="/admin/epaper" size="sm" variant="ghost" icon={ArrowLeft}>
        {L('అన్ని ఎడిషన్‌లు', 'All editions')}
      </ButtonLink>
      {canEdit ? (
        <Button size="sm" variant="secondary" icon={Sparkles} pending={fillAll.isPending} onClick={() => fillAll.mutate()}>
          {L('అన్ని ఖాళీ స్లాట్‌లు నింపండి', 'Fill all empty slots')}
        </Button>
      ) : null}
      {canEdit && status === 'GENERATED' ? (
        <Button size="sm" variant="secondary" icon={Send} pending={busy('submit')} onClick={() => act.mutate('submit')}>
          {L('సమీక్షకు పంపండి', 'Submit for review')}
        </Button>
      ) : null}
      {canPublish && REVIEWABLE.includes(status) ? (
        <Button size="sm" variant="secondary" icon={Check} pending={busy('approve')} onClick={() => act.mutate('approve')}>
          {L('ఆమోదించండి', 'Approve')}
        </Button>
      ) : null}
      {canPublish && status === 'APPROVED' ? (
        <Button size="sm" icon={Send} pending={busy('publish')} onClick={askPublish}>
          {L('ప్రచురించండి', 'Publish')}
        </Button>
      ) : null}
      {canPublish && ['APPROVED', 'PUBLISHED'].includes(status) ? (
        <Button size="sm" variant="secondary" icon={Undo2} pending={busy('withdraw')} onClick={askWithdraw}>
          {L('వెనక్కి తీసుకోండి', 'Withdraw')}
        </Button>
      ) : null}
      {pdfControl()}
      {/* The browser's print-to-PDF of every sheet — how staff get a PDF today. */}
      <ButtonLink size="sm" variant="secondary" icon={Printer} to={`/admin/epaper/${edition.edition_date}/print`} external>
        {L('ప్రింట్ / PDF', 'Print / PDF')}
      </ButtonLink>
      {status === 'PUBLISHED' ? (
        <ButtonLink size="sm" variant="secondary" iconRight={ExternalLink} to={`/epaper/${edition.edition_date}`} external>
          {L('పబ్లిక్ రీడర్ తెరవండి', 'Open public reader')}
        </ButtonLink>
      ) : null}
      {canEdit ? (
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
          {L('పేజీ జోడించండి', 'Add page')}
        </Button>
      ) : null}
      {canUpload && !locked ? (
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setRegenerating(true)}>
          {L('మళ్లీ జనరేట్', 'Regenerate')}
        </Button>
      ) : null}
    </>
  );

  return (
    <AdminPage
      title={edition.title}
      titleLang="te"
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-sans tabular-nums">{formatDate(edition.edition_date, language)}</span>
          <span aria-hidden>·</span>
          <span className="font-sans tabular-nums">
            {edition.page_count} {t('ui.pages')} · r{edition.revision}
          </span>
          <StatusPill status={status} />
        </span>
      }
    >
      {/* Below the title, not beside it: seven buttons in the header slot would crush the title on a laptop. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">{actions}</div>
      {page ? (
        <>
          <ChipRail ariaLabel={t('epaper.page')}>
            {edition.pages.map((p) => (
              <Chip
                key={p.id}
                as="button"
                lang="te"
                selected={p.id === page.id}
                onClick={() => {
                  setSelectedId(p.id);
                  setTargetSlot(null);
                }}
              >
                {p.page_number} · {p.title}{' '}
                <span className="font-sans text-meta tabular-nums">
                  {p.articles.length}/{p.slots.length || p.articles.length}
                </span>
              </Chip>
            ))}
          </ChipRail>
          <div className={cn('grid gap-6 lg:items-start', canEdit && 'lg:grid-cols-[minmax(0,1fr)_22rem]')}>
            <div className="min-w-0 space-y-4">
              <EpaperPageEditor key={page.id} edition={edition} page={page} locked={!canEdit} />
              {/* View-only staff get the print layout (no hotspots): the public reader is one button away. */}
              <EpaperSheetViewport zoom={1} fit="width">
                <EpaperSheet page={page} edition={edition} mode="print" editable={canEdit} renderSlot={renderSlot} />
              </EpaperSheetViewport>
            </div>
            {canEdit ? (
              <EpaperCandidates
                editionId={edition.id}
                page={page}
                targetSlot={targetSlot}
                placedIds={slotIds(page)}
                placing={place.isPending}
                onAdd={add}
              />
            ) : null}
          </div>
        </>
      ) : (
        <EmptyState
          compact
          title={L('ఈ ఎడిషన్‌లో పేజీలు లేవు', 'No pages in this edition')}
          action={
            canEdit ? (
              <Button icon={Plus} onClick={() => setAdding(true)}>
                {L('పేజీ జోడించండి', 'Add page')}
              </Button>
            ) : undefined
          }
        />
      )}

      <PromptDialog
        open={adding}
        onClose={() => setAdding(false)}
        title={L('కొత్త పేజీ', 'New page')}
        description={L('టెంప్లేట్ ఎంచుకుంటే పేరు, లేఅవుట్ దాని నుంచి వస్తాయి.', 'Pick a template and the name and layout come from it.')}
        fields={[
          { name: 'title', label: L('పేజీ పేరు', 'Page name') },
          {
            name: 'template_id',
            label: L('టెంప్లేట్', 'Template'),
            type: 'select',
            options: [
              { value: '', label: L('టెంప్లేట్ లేదు', 'No template') },
              ...(templates.data?.items ?? []).map((x) => ({ value: String(x.id), label: x.title_te })),
            ],
          },
          {
            name: 'layout_type',
            label: L('లేఅవుట్', 'Layout'),
            type: 'select',
            options: [{ value: '', label: L('టెంప్లేట్ ప్రకారం', 'As the template') }, ...layoutOptions(L)],
          },
        ]}
        submitLabel={t('ui.add')}
        pending={addPage.isPending}
        onSubmit={(v) => {
          if (!v.title?.trim() && !v.template_id) {
            toast.error(L('పేజీ పేరు ఇవ్వండి లేదా టెంప్లేట్ ఎంచుకోండి.', 'Give the page a name or pick a template.'));
            return;
          }
          addPage.mutate(v);
        }}
      />
      <EpaperGenerateDialog open={regenerating} onClose={() => setRegenerating(false)} edition={edition} />
      {dialog}
    </AdminPage>
  );
}

export function EpaperWorkspace() {
  const { t } = useI18n();
  const { date = '' } = useParams();
  const edition = useQuery({
    queryKey: ['admin-epaper', date],
    queryFn: () => api.fetchAdminEdition(date),
    // A queued PDF render is watched until it settles.
    refetchInterval: (q) => (q.state.data?.pdf_status === 'PENDING' ? 5000 : false),
  });
  if (!edition.data) {
    return (
      <AdminPage title={t('admin.page.epaper')}>
        <QueryState query={edition} skeleton={<SkeletonCard variant="lead" />}>
          {() => null}
        </QueryState>
      </AdminPage>
    );
  }
  return <Workspace key={edition.data.id} edition={edition.data} />;
}
