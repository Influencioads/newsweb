import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, FileText, PenLine, Send, Sparkles, Trash2, X } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AdminPage } from '@/components/admin/AdminPage';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { AiDraft, AiSuggestion } from '@/types/cms';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

import { useL } from './useL';

/**
 * §16 "Today's AI suggestions" and §15 drafts.
 *
 * The screen is built around the decision an editor actually makes: is this
 * worth covering? So each card leads with the topic and the reason, shows the
 * sources §17 requires for verification, and offers exactly two actions.
 *
 * Converting a draft does not publish it — the subtitle says so, and the button
 * label says "send for review" rather than anything stronger, because that is
 * literally what the endpoint does. There is no publish control on this screen.
 */

type Tab = 'suggestions' | 'drafts';

function ScoreBadge({ score }: { score: number }) {
  const L = useL();
  const tone = score >= 0.66 ? 'breaking' : score >= 0.4 ? 'partial' : 'muted';
  return (
    <Badge tone={tone} size="xs" lang="en" className="shrink-0 tabular-nums">
      <span className="sr-only">{L('స్కోరు', 'score')} </span>
      {Math.round(score * 100)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Suggestion
// ---------------------------------------------------------------------------

interface SuggestionCardProps {
  suggestion: AiSuggestion;
  busy: boolean;
  pending: boolean;
  onDraft: () => void;
  onReject: () => void;
}

function SuggestionCard({ suggestion, busy, pending, onDraft, onReject }: SuggestionCardProps) {
  const L = useL();
  const s = useScript();

  return (
    <Card as="article" padding="md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 lang="te" className="th text-headline-xs font-bold text-ink">
            {suggestion.topic_te}
          </h3>
          {suggestion.topic_en ? (
            <p lang="en" className="font-sans text-ui-sm text-muted">
              {suggestion.topic_en}
            </p>
          ) : null}
        </div>
        <ScoreBadge score={suggestion.score} />
      </div>

      {suggestion.rationale_te ? (
        <p lang="te" className="te mt-2 text-te-body-xs text-ink-soft">
          {suggestion.rationale_te}
        </p>
      ) : null}

      {suggestion.sources.length ? (
        <div className="mt-3 rounded-xl border border-rule bg-canvas p-3">
          <p className={cn(s.body, 'text-meta font-semibold text-muted')}>
            {L('మూలాలు — రాయకముందు ధృవీకరించండి', 'Sources — verify before writing')}
          </p>
          <ul className="mt-1 flex flex-col">
            {suggestion.sources.map((src) => (
              <li key={src.url} className="flex min-h-tap flex-wrap items-center gap-x-2 gap-y-1">
                <ButtonLink to={src.url} external variant="link" size="sm" iconRight={ExternalLink}>
                  {src.publisher}
                </ButtonLink>
                <Badge size="xs" lang="en">
                  {src.licence}
                </Badge>
                {src.title ? <span className="font-sans text-ui-sm text-ink-soft">{src.title}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={cn(s.body, 'mt-2 text-meta text-muted')}>
          {L('మన సొంత కవరేజ్ నుంచి — బాహ్య మూలం లేదు.', 'Derived from our own coverage — no external source.')}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <Badge tone="ai" size="xs" lang="en">
          {suggestion.engine}
        </Badge>
        <StatusPill status={suggestion.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" icon={PenLine} pending={pending} disabled={busy} onClick={onDraft}>
            {L('ఆమోదించి డ్రాఫ్ట్', 'Accept & draft')}
          </Button>
          <Button size="sm" variant="secondary" icon={X} disabled={busy} onClick={onReject}>
            {L('తిరస్కరించండి', 'Reject')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

interface DraftCardProps {
  draft: AiDraft;
  busy: boolean;
  pending: boolean;
  onConvert: () => void;
  onDiscard: () => void;
}

function DraftCard({ draft, busy, pending, onConvert, onDiscard }: DraftCardProps) {
  const { t } = useI18n();
  const L = useL();
  const s = useScript();

  return (
    <Card as="article" padding="md">
      <div className="flex items-start justify-between gap-3">
        <h3 lang="te" className="th min-w-0 text-headline-xs font-bold text-ink">
          {draft.title_te}
        </h3>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Badge tone="ai" size="xs" lang="en">
            {draft.engine}
          </Badge>
          <StatusPill status={draft.status} />
        </div>
      </div>

      {draft.summary_te ? (
        <p lang="te" className="te mt-2 text-te-body-xs text-ink-soft">
          {draft.summary_te}
        </p>
      ) : null}

      {draft.body_plain ? (
        <details className="mt-2 rounded-xl border border-rule bg-canvas px-3">
          <summary className={cn(s.body, 'min-h-tap cursor-pointer py-3 text-ui-sm font-semibold text-ink')}>
            {L('పూర్తి పాఠం', 'Full text')}
          </summary>
          <p lang="te" className="te whitespace-pre-line pb-3 text-te-body-xs text-ink-soft">
            {draft.body_plain}
          </p>
        </details>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <span className={cn(s.body, 'text-meta text-muted tabular-nums')}>
          {draft.word_count} {t('admin.wordCount')}
          {draft.confidence != null ? ` · ${Math.round(draft.confidence * 100)}%` : ''}
        </span>
        {draft.status === 'converted' ? (
          <Badge tone="success" className="ml-auto">
            {L('సమీక్షకు పంపబడింది', 'Sent for review')}
          </Badge>
        ) : (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" icon={Send} pending={pending} disabled={busy} onClick={onConvert}>
              {L('సమీక్షకు పంపండి', 'Send for review')}
            </Button>
            <Button size="sm" variant="secondary" icon={Trash2} disabled={busy} onClick={onDiscard}>
              {L('తొలగించండి', 'Discard')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <SkeletonCard variant="compact" />
      <SkeletonCard variant="compact" />
      <SkeletonCard variant="compact" />
    </div>
  );
}

export default function AiSuggestionsPage() {
  const { t } = useI18n();
  const L = useL();
  const nav = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const reveal = useReveal<HTMLLIElement>();
  const [tab, setTab] = useState<Tab>('suggestions');
  const [draftFor, setDraftFor] = useState<AiSuggestion | null>(null);

  const suggestions = useQuery({
    queryKey: ['cms', 'ai', 'suggestions'],
    queryFn: () => cmsApi.fetchAiSuggestions('new'),
  });
  const drafts = useQuery({
    queryKey: ['cms', 'ai', 'drafts'],
    queryFn: () => cmsApi.fetchAiDrafts('draft'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cms', 'ai'] });
  };
  const onError = (err: unknown) => toast.error(err);

  const generate = useMutation({
    mutationFn: () => cmsApi.generateAiSuggestions(),
    onSuccess: () => {
      toast.success(t('state.updated'));
      refresh();
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError && err.status === 409
          ? L(
              'AI ఆఫ్‌లో ఉంది లేదా నేటి పరిమితి ముగిసింది. రెండూ సెట్టింగ్‌లలో ఉన్నాయి.',
              'AI is switched off, or today’s limit is reached. Both are in Settings.',
            )
          : err,
      ),
  });
  const draft = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => cmsApi.draftFromSuggestion(id, notes),
    onSuccess: () => {
      toast.success(t('state.success'));
      refresh();
      setTab('drafts');
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: (id: number) => cmsApi.rejectAiSuggestion(id),
    onSuccess: () => {
      toast.success(t('state.updated'));
      refresh();
    },
    onError,
  });
  const convert = useMutation({
    mutationFn: (id: number) => cmsApi.convertAiDraft(id),
    onSuccess: (result) => {
      toast.success(t('state.success'));
      refresh();
      nav(`/admin/articles/${result.article_id}/edit`);
    },
    onError,
  });
  const discard = useMutation({
    mutationFn: (id: number) => cmsApi.discardAiDraft(id),
    onSuccess: () => {
      toast.success(t('state.deleted'));
      refresh();
    },
    onError,
  });

  const askReject = async (sg: AiSuggestion) => {
    const ok = await confirm({
      title: L('ఈ సూచనను తిరస్కరించాలా?', 'Reject this suggestion?'),
      body: (
        <span lang="te" className="te">
          {sg.topic_te}
        </span>
      ),
      tone: 'danger',
      confirmLabel: L('తిరస్కరించండి', 'Reject'),
    });
    if (ok) reject.mutate(sg.id);
  };
  const askConvert = async (d: AiDraft) => {
    const ok = await confirm({
      title: L('సమీక్షకు పంపాలా?', 'Send for review?'),
      body: L(
        'డ్రాఫ్ట్ కథనంగా మారి ఎడిటర్ సమీక్షకు వెళ్తుంది. ఇది ప్రచురణ కాదు.',
        'The draft becomes an article and goes to editor review. This does not publish it.',
      ),
      confirmLabel: L('సమీక్షకు పంపండి', 'Send for review'),
    });
    if (ok) convert.mutate(d.id);
  };
  const askDiscard = async (d: AiDraft) => {
    const ok = await confirm({
      title: L('ఈ డ్రాఫ్ట్‌ను తొలగించాలా?', 'Discard this draft?'),
      body: t('state.confirmDelete'),
      tone: 'danger',
      confirmLabel: L('తొలగించండి', 'Discard'),
    });
    if (ok) discard.mutate(d.id);
  };
  const submitDraft = async (values: Record<string, string>) => {
    if (!draftFor) return;
    try {
      await draft.mutateAsync({ id: draftFor.id, notes: values.notes ?? '' });
      setDraftFor(null);
    } catch {
      // onError already toasted; the dialog stays open so the notes are not lost.
    }
  };

  const suggestionsLabel = L('సూచనలు', 'Suggestions');
  const draftsLabel = L('డ్రాఫ్ట్‌లు', 'Drafts');

  return (
    <AdminPage
      width="page"
      title={t('admin.page.ai')}
      subtitle={L(
        'ఆలోచనలు, డ్రాఫ్ట్‌లు. ఎడిటర్ ఆమోదం, మరో ఎడిటర్ ప్రచురణ లేకుండా ఇవి పాఠకులకు చేరవు.',
        'Ideas and drafts. Nothing here reaches readers without an editor approving it and a second editor publishing it.',
      )}
      actions={
        <Button variant="secondary" icon={Sparkles} pending={generate.isPending} onClick={() => generate.mutate()}>
          {generate.isPending ? L('పని జరుగుతోంది…', 'Working…') : L('సూచనలు తయారు చేయండి', 'Generate suggestions')}
        </Button>
      }
    >
      <Tabs
        ariaLabel={t('ui.sections')}
        value={tab}
        onChange={(key) => setTab(key as Tab)}
        items={[
          { key: 'suggestions', label: suggestionsLabel, icon: Sparkles, count: suggestions.data?.total ?? 0 },
          { key: 'drafts', label: draftsLabel, icon: FileText, count: drafts.data?.total ?? 0 },
        ]}
      />

      {tab === 'suggestions' ? (
        <div role="tabpanel" aria-label={suggestionsLabel}>
          <QueryState
            query={suggestions}
            skeleton={<ListSkeleton />}
            isEmpty={(d) => d.items.length === 0}
            empty={
              <EmptyState
                icon={Sparkles}
                title={L('పెండింగ్ సూచనలు లేవు.', 'No open suggestions.')}
                body={L('పైన కొత్తవి తయారు చేయండి.', 'Generate a new batch above.')}
              />
            }
          >
            {(data) => (
              <ul className="flex flex-col gap-3">
                {data.items.map((sg) => (
                  <li key={sg.id} ref={reveal}>
                    <SuggestionCard
                      suggestion={sg}
                      busy={draft.isPending || reject.isPending}
                      pending={draft.isPending && draft.variables.id === sg.id}
                      onDraft={() => setDraftFor(sg)}
                      onReject={() => void askReject(sg)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </div>
      ) : (
        <div role="tabpanel" aria-label={draftsLabel}>
          <QueryState
            query={drafts}
            skeleton={<ListSkeleton />}
            isEmpty={(d) => d.items.length === 0}
            empty={<EmptyState icon={FileText} title={L('డ్రాఫ్ట్‌లు లేవు.', 'No drafts waiting.')} />}
          >
            {(data) => (
              <ul className="flex flex-col gap-3">
                {data.items.map((d) => (
                  <li key={d.id} ref={reveal}>
                    <DraftCard
                      draft={d}
                      busy={convert.isPending || discard.isPending}
                      pending={convert.isPending && convert.variables === d.id}
                      onConvert={() => void askConvert(d)}
                      onDiscard={() => void askDiscard(d)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </div>
      )}

      <PromptDialog
        open={draftFor !== null}
        onClose={() => setDraftFor(null)}
        title={L('ఆమోదించి డ్రాఫ్ట్', 'Accept & draft')}
        description={
          draftFor ? (
            <span lang="te" className="te">
              {draftFor.topic_te}
            </span>
          ) : undefined
        }
        fields={[{ name: 'notes', label: L('రచయితకు గమనికలు', 'Angle or notes for the writer'), type: 'textarea' }]}
        submitLabel={L('డ్రాఫ్ట్ రాయండి', 'Write draft')}
        pending={draft.isPending}
        onSubmit={submitDraft}
      />
      {dialog}
    </AdminPage>
  );
}
