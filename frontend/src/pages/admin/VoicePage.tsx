import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Section, inputClass } from '@/components/admin/FormControls';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import type { AudioAssetRow, AudioStatus } from '@/types/cms';

/**
 * §19–21 — every rendition the platform has paid for, and why the failed ones
 * failed.
 *
 * Turning voice on for a single story lives in the article editor, with
 * whoever owns the story. What lives here is the spending: a backfill makes
 * many provider calls at once, and a retry is a deliberate decision to pay
 * again for something that already failed. Both need `voice.manage`.
 *
 * The month's character budget is at the top because it is the number that
 * silently causes everything else to stop working.
 */

const STATUS_TONE: Record<AudioStatus, string> = {
  ready: 'bg-success/12 text-success',
  generating: 'bg-canvas text-muted',
  pending: 'bg-canvas text-muted',
  failed: 'bg-breaking-tint text-breaking',
};

const SCOPES = [
  { value: 'missing', te: 'ఆడియో లేని కథనాలు', en: 'Published stories with no audio' },
  { value: 'failed', te: 'విఫలమైనవి', en: 'Previously failed' },
] as const;

function UsageMeter({ usage }: { usage: Record<string, number> | undefined }) {
  const { language } = useI18n();
  const en = language === 'en';
  if (!usage) return null;
  const percent = Number(usage.percent_used ?? 0);
  return (
    <div className="rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface">
      <p className="font-sans text-[12px] text-muted">
        {en ? 'Characters synthesised this month' : 'ఈ నెలలో తయారైన అక్షరాలు'}
      </p>
      <p className="font-sans text-[26px] font-extrabold tabular-nums text-ink">
        {Number(usage.chars_this_month ?? 0).toLocaleString('en-IN')}
        <span className="text-[15px] font-semibold text-muted">
          {' / '}{Number(usage.monthly_budget ?? 0).toLocaleString('en-IN')}
        </span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
        <div
          className={`h-full ${percent >= 100 ? 'bg-breaking' : percent >= 80 ? 'bg-partial' : 'bg-success'}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <p className="te mt-2 text-[11.5px] text-muted">
        {en
          ? `${usage.assets_ready ?? 0} ready · ${usage.assets_failed ?? 0} failed. Generation stops at the budget — it does not queue.`
          : `${usage.assets_ready ?? 0} సిద్ధం · ${usage.assets_failed ?? 0} విఫలం. పరిమితి చేరాక తయారీ ఆగిపోతుంది.`}
      </p>
    </div>
  );
}

export default function VoicePage() {
  const { language } = useI18n();
  const en = language === 'en';
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AudioStatus | ''>('');
  const [scope, setScope] = useState<'missing' | 'failed'>('missing');
  const [limit, setLimit] = useState(20);

  const assets = useQuery({
    queryKey: ['cms', 'audio-assets', status],
    queryFn: () => cmsApi.fetchAudioAssets(status ? { status } : {}),
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['cms', 'audio-assets'] });

  const retry = useMutation({
    mutationFn: (id: number) => cmsApi.retryAudioAsset(id),
    onSuccess: refresh,
  });
  const backfill = useMutation({
    mutationFn: () => cmsApi.runAudioBackfill({ scope, limit }),
    onSuccess: refresh,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4">
        <h1 className="th text-[25px] font-extrabold text-ink">
          {en ? 'Voice' : 'వాయిస్'}
        </h1>
        <p className="te mt-1 max-w-[70ch] text-[12px] leading-telugu text-muted">
          {en
            ? 'Generated readings, the monthly budget, and a way to fill in the stories that have none. Whether a single story may be read aloud is set in that story’s editor.'
            : 'తయారైన ఆడియో, నెలవారీ పరిమితి, ఆడియో లేని కథనాలకు తయారీ. ఒక కథనానికి వాయిస్ ఆన్/ఆఫ్ ఆ కథనం ఎడిటర్‌లో ఉంటుంది.'}
        </p>
      </header>

      <div className="mb-4">
        <UsageMeter usage={assets.data?.usage} />
      </div>

      <Section
        title={en ? 'Generate in bulk' : 'గుంపుగా తయారు చేయండి'}
        subtitle={en
          ? 'Runs immediately, capped at 50 stories. The overnight job picks up the rest and stops at 90% of the budget.'
          : 'వెంటనే నడుస్తుంది, గరిష్ఠం 50 కథనాలు. మిగిలినవి రాత్రి పని చూసుకుంటుంది, 90% వద్ద ఆగుతుంది.'}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="te mb-1 block text-[12px] font-bold text-ink">
              {en ? 'Which stories' : 'ఏ కథనాలు'}
            </span>
            <select className={inputClass} value={scope}
              onChange={(e) => setScope(e.target.value as 'missing' | 'failed')}>
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>{en ? s.en : s.te}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="te mb-1 block text-[12px] font-bold text-ink">
              {en ? 'How many' : 'ఎన్ని'}
            </span>
            <input type="number" min={1} max={50} value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className={`${inputClass} max-w-[110px]`} />
          </label>
          <button type="button" disabled={backfill.isPending} onClick={() => backfill.mutate()}
            className="te min-h-tap rounded-control bg-brand px-5 font-bold text-white disabled:opacity-60">
            {backfill.isPending ? (en ? 'Generating…' : 'తయారవుతోంది…') : (en ? 'Run' : 'నడపండి')}
          </button>
        </div>

        {backfill.data ? (
          <p className="te mt-3 rounded-control border border-rule bg-canvas p-2.5 text-[12.5px] leading-telugu text-ink-soft">
            {en
              ? `${backfill.data.candidates} considered · ${backfill.data.generated} generated · ${backfill.data.skipped} skipped.`
              : `${backfill.data.candidates} పరిశీలించాం · ${backfill.data.generated} తయారయ్యాయి · ${backfill.data.skipped} వదిలేశాం.`}
            {backfill.data.skipped > 0 ? (
              <span className="block text-muted">
                {en
                  ? 'Skipped means not possible: voice off for that story, no provider, or the monthly budget is spent.'
                  : 'వదిలేసినవి: ఆ కథనానికి వాయిస్ ఆఫ్, ప్రొవైడర్ లేదు, లేదా నెలవారీ పరిమితి అయిపోయింది.'}
              </span>
            ) : null}
          </p>
        ) : null}
      </Section>

      <div className="mt-5">
        <div className="mb-3 flex flex-wrap gap-2">
          {([''] as Array<AudioStatus | ''>).concat(['ready', 'failed', 'pending']).map((key) => (
            <button key={key || 'all'} type="button" onClick={() => setStatus(key)}
              aria-pressed={status === key}
              className={`te min-h-[32px] rounded-chip border px-3 text-[12px] font-semibold ${
                status === key ? 'border-brand bg-brand text-white' : 'border-rule bg-white text-ink dark:bg-surface'
              }`}>
              {key === '' ? (en ? 'All' : 'అన్నీ') : key}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-card border border-rule bg-white shadow-card dark:bg-surface">
          <table className="w-full min-w-[820px] text-left">
            <thead className="bg-paper font-sans text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2.5">{en ? 'Story' : 'కథనం'}</th>
                <th className="px-3 py-2.5">{en ? 'Status' : 'స్థితి'}</th>
                <th className="px-3 py-2.5">{en ? 'Provider' : 'ప్రొవైడర్'}</th>
                <th className="px-3 py-2.5">{en ? 'Length' : 'నిడివి'}</th>
                <th className="px-3 py-2.5">{en ? 'Chars' : 'అక్షరాలు'}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(assets.data?.items ?? []).map((row: AudioAssetRow) => (
                <tr key={row.id} className="border-t border-rule-soft align-top">
                  <td className="px-3 py-3">
                    <span className="te block max-w-[36ch] truncate text-[13px] font-semibold text-ink">
                      {row.title_te ?? `#${row.article_id}`}
                    </span>
                    <span className="font-mono text-[10.5px] text-muted">{row.short_id}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-block rounded-chip px-2 py-0.5 font-sans text-[10.5px] font-bold ${STATUS_TONE[row.status]}`}>
                      {row.status}
                    </span>
                    {row.error ? (
                      <span className="mt-1 block max-w-[30ch] font-sans text-[10.5px] text-breaking">
                        {row.error}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 font-sans text-[11.5px] text-ink-soft">
                    {row.provider}
                    {row.segment_count > 1 ? (
                      <span className="block text-muted" title={en
                        ? 'Long copy is synthesised in pieces and joined — normal, not a fault.'
                        : 'పొడవైన కథనం ముక్కలుగా తయారై కలుపుతారు — ఇది సాధారణం.'}>
                        {row.segment_count} {en ? 'parts' : 'ముక్కలు'}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 font-sans text-[12px] tabular-nums text-ink-soft">
                    {row.duration_sec ? `${row.duration_sec}s` : '—'}
                  </td>
                  <td className="px-3 py-3 font-sans text-[12px] tabular-nums text-muted">
                    {row.char_count.toLocaleString('en-IN')}
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" disabled={retry.isPending}
                      onClick={() => retry.mutate(row.id)}
                      className="te min-h-[30px] rounded-control border border-rule px-2.5 text-[11.5px] font-semibold text-brand disabled:opacity-50">
                      {en ? 'Regenerate' : 'మళ్లీ తయారు చేయండి'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {assets.data && assets.data.items.length === 0 ? (
            <p className="te p-8 text-center text-[13px] text-muted">
              {en ? 'No audio has been generated yet.' : 'ఇంకా ఆడియో ఏదీ తయారు కాలేదు.'}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
