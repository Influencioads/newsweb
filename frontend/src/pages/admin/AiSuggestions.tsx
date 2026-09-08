import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import type { ApiError } from '@/api/client';
import type { AiDraft, AiSuggestion } from '@/types/cms';

/**
 * §16 "Today's AI suggestions" and §15 drafts.
 *
 * The screen is built around the decision an editor actually makes: is this
 * worth covering? So each card leads with the topic and the reason, shows the
 * sources §17 requires for verification, and offers exactly two actions.
 *
 * Converting a draft does not publish it — the banner says so, and the button
 * label says "send for review" rather than anything stronger, because that is
 * literally what the endpoint does.
 */

function ScoreDot({ score }: { score: number }) {
  const tone = score >= 0.66 ? 'bg-breaking' : score >= 0.4 ? 'bg-partial' : 'bg-muted';
  return (
    <span className="inline-flex items-center gap-1" title={`score ${score}`}>
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden />
      <span className="font-sans text-[11px] font-bold text-muted">{Math.round(score * 100)}</span>
    </span>
  );
}

function SuggestionCard({
  suggestion, onDraft, onReject, busy,
}: { suggestion: AiSuggestion; onDraft: (notes: string) => void; onReject: () => void; busy: boolean }) {
  const { language } = useI18n();
  const en = language === 'en';
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <article className="rounded-card border border-ai-border bg-white p-4 shadow-card dark:bg-surface">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="te text-[15.5px] font-bold leading-telugu text-ink">{suggestion.topic_te}</h3>
          {suggestion.topic_en ? <p className="font-sans text-[12px] text-muted">{suggestion.topic_en}</p> : null}
        </div>
        <ScoreDot score={suggestion.score} />
      </div>

      {suggestion.rationale_te ? (
        <p className="te mt-2 text-[13px] leading-telugu text-ink-soft">{suggestion.rationale_te}</p>
      ) : null}

      {suggestion.sources.length ? (
        <div className="mt-3 rounded border border-rule bg-canvas p-2.5">
          <p className="font-sans text-[10px] font-bold uppercase tracking-wide text-muted">
            {en ? 'Sources — verify before writing' : 'మూలాలు — రాయకముందు ధృవీకరించండి'}
          </p>
          <ul className="mt-1 space-y-1">
            {suggestion.sources.map((s) => (
              <li key={s.url} className="font-sans text-[12px]">
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-ai underline">{s.publisher}</a>
                <span className="ml-1.5 rounded bg-white px-1 py-0.5 text-[10px] uppercase text-muted">{s.licence}</span>
                {s.title ? <span className="ml-1 text-ink-soft">{s.title}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="te mt-2 text-[11.5px] text-muted">
          {en ? 'Derived from our own coverage — no external source.' : 'మన సొంత కవరేజ్ నుంచి — బాహ్య మూలం లేదు.'}
        </p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <span className="font-sans text-[10.5px] uppercase tracking-wide text-muted">{suggestion.engine}</span>
        {open ? (
          <>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={en ? 'Angle or notes for the writer' : 'రచయితకు గమనికలు'}
              className="te min-w-[200px] flex-1 rounded-control border border-rule-input px-2.5 py-1.5 text-[12.5px]" />
            <button type="button" disabled={busy} onClick={() => onDraft(notes)}
              className="te min-h-[32px] rounded-control bg-ai px-3 text-[12px] font-bold text-white disabled:opacity-50">
              {busy ? '…' : (en ? 'Write draft' : 'డ్రాఫ్ట్ రాయండి')}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setOpen(true)}
            className="te ml-auto min-h-[32px] rounded-control border border-ai px-3 text-[12px] font-bold text-ai">
            {en ? 'Accept & draft' : 'ఆమోదించి డ్రాఫ్ట్'}
          </button>
        )}
        <button type="button" disabled={busy} onClick={onReject}
          className="te min-h-[32px] rounded-control border border-rule px-3 text-[12px] font-semibold text-muted">
          {en ? 'Reject' : 'తిరస్కరించండి'}
        </button>
      </footer>
    </article>
  );
}

function DraftCard({ draft, onConvert, onDiscard, busy }: {
  draft: AiDraft; onConvert: () => void; onDiscard: () => void; busy: boolean;
}) {
  const { language } = useI18n();
  const en = language === 'en';
  return (
    <article className="rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface">
      <div className="flex items-start justify-between gap-3">
        <h3 className="te text-[15px] font-bold leading-telugu text-ink">{draft.title_te}</h3>
        <span className="shrink-0 rounded-chip bg-ai-tint px-2 py-0.5 font-sans text-[10px] font-bold uppercase text-ai">
          {draft.engine}
        </span>
      </div>
      {draft.summary_te ? <p className="te mt-1.5 text-[13px] leading-telugu text-ink-soft">{draft.summary_te}</p> : null}
      {draft.body_plain ? (
        <p className="te mt-2 max-h-32 overflow-y-auto rounded border border-rule bg-canvas p-2.5 text-[12.5px] leading-telugu text-ink-soft">
          {draft.body_plain}
        </p>
      ) : null}
      <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <span className="font-sans text-[11px] text-muted">
          {draft.word_count} {en ? 'words' : 'పదాలు'}
          {draft.confidence != null ? ` · ${Math.round(draft.confidence * 100)}%` : ''}
        </span>
        {draft.status === 'converted' ? (
          <span className="te ml-auto text-[12px] font-bold text-success">
            {en ? 'Sent for review' : 'సమీక్షకు పంపబడింది'}
          </span>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={onConvert}
              className="te ml-auto min-h-[32px] rounded-control bg-brand px-3 text-[12px] font-bold text-white disabled:opacity-50">
              {en ? 'Send for review' : 'సమీక్షకు పంపండి'}
            </button>
            <button type="button" disabled={busy} onClick={onDiscard}
              className="te min-h-[32px] rounded-control border border-rule px-3 text-[12px] font-semibold text-muted">
              {en ? 'Discard' : 'తొలగించండి'}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

export default function AiSuggestionsPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'suggestions' | 'drafts'>('suggestions');

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

  const generate = useMutation({ mutationFn: () => cmsApi.generateAiSuggestions(), onSuccess: refresh });
  const draft = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => cmsApi.draftFromSuggestion(id, notes),
    onSuccess: () => { refresh(); setTab('drafts'); },
  });
  const reject = useMutation({ mutationFn: (id: number) => cmsApi.rejectAiSuggestion(id), onSuccess: refresh });
  const convert = useMutation({
    mutationFn: (id: number) => cmsApi.convertAiDraft(id),
    onSuccess: (result) => { refresh(); nav(`/admin/articles/${result.article_id}/edit`); },
  });
  const discard = useMutation({ mutationFn: (id: number) => cmsApi.discardAiDraft(id), onSuccess: refresh });

  const generateError = generate.error as ApiError | undefined;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4">
        <h1 className="th text-[25px] font-extrabold text-ink">
          {en ? "Today's AI suggestions" : 'నేటి AI సూచనలు'}
        </h1>
        <p className="te mt-1 text-[12px] text-muted">
          {en
            ? 'Ideas and drafts. Nothing here reaches readers without an editor approving it and a second editor publishing it.'
            : 'ఆలోచనలు, డ్రాఫ్ట్‌లు. ఎడిటర్ ఆమోదం, మరో ఎడిటర్ ప్రచురణ లేకుండా ఇవి పాఠకులకు చేరవు.'}
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['suggestions', 'drafts'] as const).map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`te min-h-[34px] rounded-chip border px-3.5 text-[12.5px] font-semibold ${
              tab === key ? 'border-brand bg-brand text-white' : 'border-rule bg-white text-ink dark:bg-surface'
            }`}>
            {key === 'suggestions'
              ? `${en ? 'Suggestions' : 'సూచనలు'} (${suggestions.data?.total ?? 0})`
              : `${en ? 'Drafts' : 'డ్రాఫ్ట్‌లు'} (${drafts.data?.total ?? 0})`}
          </button>
        ))}
        <button type="button" disabled={generate.isPending} onClick={() => generate.mutate()}
          className="te ml-auto min-h-[34px] rounded-control border border-ai px-3.5 text-[12.5px] font-bold text-ai disabled:opacity-50">
          {generate.isPending ? (en ? 'Working…' : 'పని జరుగుతోంది…') : (en ? 'Generate suggestions' : 'సూచనలు తయారు చేయండి')}
        </button>
      </div>

      {generateError ? (
        <p role="alert" className="te mb-4 rounded-control border border-breaking-border bg-breaking-tint p-3 text-[13px] text-breaking">
          {generateError.status === 409
            ? (en
              ? 'AI is switched off, or today’s limit is reached. Both are in Settings.'
              : 'AI ఆఫ్‌లో ఉంది లేదా నేటి పరిమితి ముగిసింది. రెండూ సెట్టింగ్‌లలో ఉన్నాయి.')
            : (en ? generateError.messageEn : generateError.messageTe)}
        </p>
      ) : null}

      {tab === 'suggestions' ? (
        <div className="space-y-3">
          {suggestions.data?.items.map((s) => (
            <SuggestionCard key={s.id} suggestion={s}
              busy={draft.isPending || reject.isPending}
              onDraft={(notes) => draft.mutate({ id: s.id, notes })}
              onReject={() => reject.mutate(s.id)} />
          ))}
          {suggestions.data && suggestions.data.items.length === 0 ? (
            <p className="te rounded-card border border-rule bg-white p-6 text-center text-[13px] text-muted dark:bg-surface">
              {en ? 'No open suggestions. Generate a new batch above.' : 'పెండింగ్ సూచనలు లేవు. పైన కొత్తవి తయారు చేయండి.'}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.data?.items.map((d) => (
            <DraftCard key={d.id} draft={d}
              busy={convert.isPending || discard.isPending}
              onConvert={() => convert.mutate(d.id)}
              onDiscard={() => discard.mutate(d.id)} />
          ))}
          {drafts.data && drafts.data.items.length === 0 ? (
            <p className="te rounded-card border border-rule bg-white p-6 text-center text-[13px] text-muted dark:bg-surface">
              {en ? 'No drafts waiting.' : 'డ్రాఫ్ట్‌లు లేవు.'}
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}
