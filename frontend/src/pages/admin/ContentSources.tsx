import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Field, Section, inputClass } from '@/components/admin/FormControls';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import type { ApiError } from '@/api/client';
import type {
  ContentPolicy, ContentSource, IngestedItem, MandalMatchMethod,
  RewriteStatus, SourceBeat, SourceLicence,
} from '@/types/cms';

/**
 * §17 — where our content comes from, and what we are allowed to do with it.
 *
 * The licence is not metadata here, it is the control: the server refuses
 * full-text republication unless the source carries an agreement-based licence
 * *and* a note recording which agreement. This screen makes that visible so an
 * editor sees the terms while deciding, rather than discovering them after a
 * takedown notice.
 *
 * Every fetched item lands in a queue and becomes a DRAFT when imported —
 * never a published article. That is the same rule reader submissions and AI
 * drafts follow, for the same reason.
 */

const LICENCES: Array<{ value: SourceLicence; te: string; en: string; fullText: boolean }> = [
  { value: 'agency_contract', te: 'వార్తా సంస్థ ఒప్పందం', en: 'Agency contract (PTI/IANS/ANI)', fullText: true },
  { value: 'publisher_partner', te: 'ప్రచురణకర్త భాగస్వామ్యం', en: 'Publisher partnership', fullText: true },
  { value: 'press_release', te: 'పత్రికా ప్రకటన', en: 'Press release', fullText: true },
  { value: 'government', te: 'ప్రభుత్వ బులెటిన్', en: 'Government bulletin', fullText: true },
  { value: 'creative_commons', te: 'Creative Commons', en: 'Creative Commons', fullText: true },
  { value: 'own_network', te: 'మన సొంత నెట్‌వర్క్', en: 'Our own network', fullText: true },
  { value: 'rss_public', te: 'బహిరంగ RSS (ఒప్పందం లేదు)', en: 'Public RSS (no agreement)', fullText: false },
];

const BEATS: Array<{ value: SourceBeat; te: string; en: string }> = [
  { value: 'general', te: 'సాధారణం', en: 'General (no hourly quota)' },
  { value: 'national', te: 'జాతీయం', en: 'National' },
  { value: 'state', te: 'రాష్ట్రం', en: 'State' },
  { value: 'district_local', te: 'జిల్లా / స్థానికం', en: 'District / local' },
  { value: 'breaking', te: 'బ్రేకింగ్', en: 'Breaking' },
  { value: 'sports', te: 'క్రీడలు', en: 'Sports' },
  { value: 'film', te: 'సినిమా', en: 'Film' },
  { value: 'govt_jobs', te: 'ఉద్యోగాలు', en: 'Government jobs' },
];

const REWRITE_LABEL: Record<RewriteStatus, { te: string; en: string; tone: string }> = {
  none: { te: 'పునర్లేఖనం లేదు', en: 'Not rewritten', tone: 'bg-canvas text-muted' },
  pending: { te: 'వేచి ఉంది', en: 'Pending', tone: 'bg-canvas text-muted' },
  ready: { te: 'సిద్ధం', en: 'Rewritten', tone: 'bg-ai/12 text-ai' },
  refused: { te: 'నిరాకరించింది', en: 'Model declined', tone: 'bg-partial/15 text-partial' },
  human_only: { te: 'మనిషి చదవాలి', en: 'Needs a person', tone: 'bg-breaking-tint text-breaking' },
  skipped: { te: 'సరిపడా సమాచారం లేదు', en: 'Too little source text', tone: 'bg-canvas text-muted' },
  failed: { te: 'విఫలమైంది', en: 'Failed', tone: 'bg-breaking-tint text-breaking' },
};

const MANDAL_LABEL: Record<MandalMatchMethod, { te: string; en: string }> = {
  none: { te: 'మండలం తెలియదు', en: 'No mandal' },
  source_default: { te: 'మూలం నిర్ణయించింది', en: 'Pinned by source' },
  keyword: { te: 'వార్త నుంచి ఊహించాం', en: 'Guessed from the text' },
  ambiguous: { te: 'ఒకటి కంటే ఎక్కువ — ఎంచుకోండి', en: 'Several matched — pick one' },
  editor: { te: 'ఎడిటర్ ఎంచుకున్నారు', en: 'Set by an editor' },
};

const POLICIES: Array<{ value: ContentPolicy; te: string; en: string }> = [
  { value: 'link_only', te: 'లింక్ మాత్రమే', en: 'Link only' },
  { value: 'excerpt_only', te: 'శీర్షిక + సారాంశం', en: 'Headline + excerpt' },
  { value: 'full_text', te: 'పూర్తి పాఠ్యం', en: 'Full text' },
];

function LicenceBadge({ source }: { source: { licence: SourceLicence; content_policy: ContentPolicy } }) {
  const licensed = source.licence !== 'rss_public';
  const full = source.content_policy === 'full_text';
  return (
    <span className={`inline-block rounded-chip px-2 py-0.5 font-sans text-[10.5px] font-bold ${
      full ? 'bg-success/12 text-success' : licensed ? 'bg-partial/15 text-partial' : 'bg-canvas text-muted'
    }`}>
      {full ? 'FULL TEXT' : source.content_policy === 'link_only' ? 'LINK' : 'EXCERPT'}
    </span>
  );
}

function AddSourceForm({ onDone }: { onDone: () => void }) {
  const { language } = useI18n();
  const en = language === 'en';
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [licence, setLicence] = useState<SourceLicence>('rss_public');
  const [policy, setPolicy] = useState<ContentPolicy>('excerpt_only');
  const [note, setNote] = useState('');
  const [interval, setInterval] = useState(30);
  const [beat, setBeat] = useState<SourceBeat>('general');
  const [perHour, setPerHour] = useState(8);
  const [rewrite, setRewrite] = useState(false);
  const [htmlFallback, setHtmlFallback] = useState(false);

  const create = useMutation({
    mutationFn: () => cmsApi.createSource({
      slug, name, feed_url: feedUrl, licence, content_policy: policy,
      licence_note: note || null, fetch_interval_minutes: interval,
      beat, max_items_per_hour: perHour,
      rewrite_enabled: rewrite, allow_html_fallback: htmlFallback,
    }),
    onSuccess: onDone,
  });

  const licenceAllowsFullText = LICENCES.find((l) => l.value === licence)?.fullText ?? false;
  const errors = (create.error as ApiError | undefined)?.details as Record<string, string> | undefined;

  return (
    <Section
      title={en ? 'Add a source' : 'కొత్త మూలం జోడించండి'}
      subtitle={en
        ? 'A public feed lets you show a headline, an excerpt and a link. Republishing the full text needs an agreement.'
        : 'బహిరంగ ఫీడ్ నుంచి శీర్షిక, సారాంశం, లింక్ మాత్రమే. పూర్తి పాఠ్యానికి ఒప్పందం అవసరం.'}
    >
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={en ? 'Publisher name' : 'ప్రచురణకర్త పేరు'} required>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Slug" required hint="a-z, 0-9, -" error={errors?.slug}>
            <input required pattern="[a-z0-9-]+" value={slug}
              onChange={(e) => setSlug(e.target.value)} className={`font-sans ${inputClass}`} />
          </Field>
        </div>

        <Field label={en ? 'Feed URL (RSS or Atom)' : 'ఫీడ్ URL (RSS లేదా Atom)'} required>
          <input required type="url" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="https://publisher.example.com/feed.xml" className={inputClass} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={en ? 'Licence' : 'లైసెన్స్'}>
            <select value={licence} className={inputClass}
              onChange={(e) => {
                const next = e.target.value as SourceLicence;
                setLicence(next);
                // A policy the new licence cannot support is not offered — the
                // server would refuse it anyway, and a form that lets you pick
                // an impossible option is a form that lies.
                if (!LICENCES.find((l) => l.value === next)?.fullText && policy === 'full_text') {
                  setPolicy('excerpt_only');
                }
              }}>
              {LICENCES.map((l) => (
                <option key={l.value} value={l.value}>{en ? l.en : l.te}</option>
              ))}
            </select>
          </Field>
          <Field label={en ? 'How much we keep' : 'ఎంత భద్రపరచాలి'} error={errors?.content_policy}>
            <select value={policy} onChange={(e) => setPolicy(e.target.value as ContentPolicy)}
              className={inputClass}>
              {POLICIES.filter((p) => p.value !== 'full_text' || licenceAllowsFullText).map((p) => (
                <option key={p.value} value={p.value}>{en ? p.en : p.te}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={en ? 'Beat' : 'బీట్'}
            hint={en
              ? 'Decides which hourly quota this source draws from. General has none.'
              : 'ఏ గంటవారీ కోటా నుంచి తీసుకోవాలో నిర్ణయిస్తుంది. సాధారణానికి కోటా లేదు.'}
          >
            <select value={beat} onChange={(e) => setBeat(e.target.value as SourceBeat)} className={inputClass}>
              {BEATS.map((b) => (
                <option key={b.value} value={b.value}>{en ? b.en : b.te}</option>
              ))}
            </select>
          </Field>
          <Field
            label={en ? 'Max stories per hour' : 'గంటకు గరిష్ఠ వార్తలు'}
            hint={en
              ? 'Stops one busy feed consuming the whole beat budget.'
              : 'ఒకే ఫీడ్ మొత్తం కోటాను తినకుండా ఆపుతుంది.'}
          >
            <input type="number" min={0} max={500} value={perHour}
              onChange={(e) => setPerHour(Number(e.target.value))} className={`${inputClass} max-w-[160px]`} />
          </Field>
        </div>

        <label className="te flex items-start gap-2 text-[12.5px] leading-telugu text-ink-soft">
          <input type="checkbox" checked={rewrite} onChange={(e) => setRewrite(e.target.checked)}
            className="mt-0.5 h-4 w-4" />
          <span>
            {en
              ? 'Rewrite this source in our own Telugu, crediting the publisher. The result still goes to an editor.'
              : 'ఈ మూలాన్ని మన సొంత తెలుగులో రాయండి, ప్రచురణకర్తకు క్రెడిట్ ఇస్తూ. ఫలితం ఎడిటర్ వద్దకే వెళ్తుంది.'}
          </span>
        </label>

        <label className="te flex items-start gap-2 text-[12.5px] leading-telugu text-ink-soft">
          <input type="checkbox" checked={htmlFallback}
            onChange={(e) => setHtmlFallback(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>
            {en
              ? 'When the feed carries only a stub, fetch the article page. Needs a written note below saying why that is acceptable for this publisher.'
              : 'ఫీడ్‌లో చిన్న ముక్క మాత్రమే ఉంటే వ్యాసం పేజీని తెండి. ఇది ఈ ప్రచురణకర్తకు ఎందుకు సమ్మతమో కింద రాయాలి.'}
          </span>
        </label>

        {policy === 'full_text' || htmlFallback ? (
          <Field
            label={en ? 'Which agreement permits this?' : 'ఏ ఒప్పందం దీన్ని అనుమతిస్తుంది?'}
            required
            hint={en ? 'Recorded in the audit log' : 'ఆడిట్ లాగ్‌లో నమోదవుతుంది'}
            error={errors?.licence_note}
          >
            <textarea required value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={en ? 'e.g. Signed syndication agreement, 1 Jan 2026' : 'ఉదా: సిండికేషన్ ఒప్పందం, 1 జనవరి 2026'}
              className={`${inputClass} min-h-16`} />
          </Field>
        ) : null}

        <Field label={en ? 'Check every (minutes)' : 'ఎన్ని నిమిషాలకోసారి తనిఖీ'}>
          <input type="number" min={5} max={1440} value={interval}
            onChange={(e) => setInterval(Number(e.target.value))} className={`${inputClass} max-w-[160px]`} />
        </Field>

        {create.isError ? (
          <p role="alert" className="te rounded-control border border-breaking-border bg-breaking-tint p-3 text-[13px] text-breaking">
            {(create.error as ApiError)?.messageTe ?? 'సేవ్ కాలేదు.'}
          </p>
        ) : null}

        <button disabled={create.isPending}
          className="te min-h-tap rounded-control bg-brand px-5 font-bold text-white disabled:opacity-60">
          {create.isPending ? (en ? 'Adding…' : 'జోడిస్తోంది…') : (en ? 'Add source' : 'జోడించండి')}
        </button>
      </form>
    </Section>
  );
}

/** The rewrite, the refusal, or nothing — whichever actually happened.
 *
 * A refusal is shown rather than hidden. "The model declined because the
 * source had three sentences" is something an editor acts on; hiding it would
 * make the queue look like nothing had been tried.
 */
function RewritePanel({ item, onRewrite, busy }: {
  item: IngestedItem;
  onRewrite: () => void;
  busy: boolean;
}) {
  const { language } = useI18n();
  const en = language === 'en';
  const [open, setOpen] = useState(false);
  const rewrite = item.rewrite;
  const label = REWRITE_LABEL[item.rewrite_status];

  return (
    <div className="mt-2 rounded-control border border-rule-soft bg-canvas/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-block rounded-chip px-2 py-0.5 font-sans text-[10.5px] font-bold ${label.tone}`}>
          {en ? label.en : label.te}
        </span>
        {rewrite && item.rewrite_status === 'ready' ? (
          <span className="font-sans text-[11px] text-muted">
            {rewrite.engine}
            {rewrite.model ? ` · ${rewrite.model}` : ''}
            {` · ${Math.round(rewrite.confidence * 100)}%`}
            {rewrite.unverified ? ` · ${en ? 'has unverified claims' : 'ధృవీకరించని అంశాలు'}` : ''}
          </span>
        ) : null}
        {rewrite?.refusal_reason ? (
          <span className="font-sans text-[11px] text-muted">{rewrite.refusal_reason}</span>
        ) : null}
        {item.rewrite_status !== 'ready' && item.rewrite_status !== 'human_only' ? (
          <button type="button" disabled={busy} onClick={onRewrite}
            className="te ml-auto min-h-[28px] rounded-control border border-ai px-2.5 text-[11.5px] font-semibold text-ai disabled:opacity-50">
            {en ? 'Rewrite now' : 'ఇప్పుడే రాయించండి'}
          </button>
        ) : null}
      </div>

      {rewrite && item.rewrite_status === 'ready' ? (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="te mt-1.5 text-left text-[13px] font-bold leading-telugu text-ai underline">
            {rewrite.title_te}
          </button>
          {open ? (
            <p className="te mt-1 whitespace-pre-line text-[12.5px] leading-telugu text-ink-soft">
              {rewrite.body_plain}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function QueueRow({ item, onImport, onReject, onRewrite, busy }: {
  item: IngestedItem;
  onImport: (useRewrite: boolean) => void;
  onReject: () => void;
  onRewrite: () => void;
  busy: boolean;
}) {
  const { language } = useI18n();
  const en = language === 'en';
  const hasRewrite = item.rewrite_status === 'ready';
  return (
    <article className="flex gap-3 rounded-card border border-rule bg-white p-3.5 shadow-card dark:bg-surface">
      {item.image_url ? (
        <img src={item.image_url} alt="" loading="lazy"
          className="hidden h-20 w-32 shrink-0 rounded object-cover sm:block" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {item.source ? (
            <>
              <span className="font-sans text-[11.5px] font-bold text-ink">{item.source.name}</span>
              <LicenceBadge source={item.source} />
            </>
          ) : null}
          {item.published_at ? (
            <span className="font-sans text-[11px] text-muted">
              {new Date(item.published_at).toLocaleString('en-IN')}
            </span>
          ) : null}
        </div>

        <h3 className="te mt-1 text-[14.5px] font-bold leading-telugu text-ink">{item.title}</h3>
        {item.summary ? (
          <p className="te mt-1 line-clamp-2 text-[12.5px] leading-telugu text-ink-soft">{item.summary}</p>
        ) : null}

        <p className="mt-1.5 font-sans text-[11px] text-muted">
          {item.has_full_text
            ? `${en ? 'Full text stored' : 'పూర్తి పాఠ్యం ఉంది'} · ${item.word_count} ${en ? 'words' : 'పదాలు'}`
            : (en ? 'Excerpt and link only — no body stored' : 'సారాంశం, లింక్ మాత్రమే — పూర్తి పాఠ్యం లేదు')}
          {item.canonical_url ? (
            <>
              {' · '}
              <a href={item.canonical_url} target="_blank" rel="noreferrer noopener"
                className="text-info underline">{en ? 'open source' : 'మూలం తెరవండి'}</a>
            </>
          ) : null}
        </p>

        <p className="mt-1.5 font-sans text-[11px] text-muted">
          {en ? MANDAL_LABEL[item.mandal.method].en : MANDAL_LABEL[item.mandal.method].te}
          {item.mandal.confidence > 0 ? ` · ${Math.round(item.mandal.confidence * 100)}%` : ''}
          {item.mandal.method === 'keyword' ? (
            <span className="ml-1 text-partial">
              {en ? '(a guess — check it)' : '(ఇది ఊహ — సరిచూడండి)'}
            </span>
          ) : null}
        </p>

        <RewritePanel item={item} onRewrite={onRewrite} busy={busy} />

        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-rule pt-2.5">
          <button type="button" disabled={busy} onClick={() => onImport(hasRewrite)}
            className="te min-h-[32px] rounded-control bg-brand px-3 text-[12px] font-bold text-white disabled:opacity-50">
            {hasRewrite
              ? (en ? 'Send rewrite to review' : 'పునర్లేఖనాన్ని సమీక్షకు పంపండి')
              : (en ? 'Import as draft' : 'డ్రాఫ్ట్‌గా తీసుకోండి')}
          </button>
          {hasRewrite ? (
            <button type="button" disabled={busy} onClick={() => onImport(false)}
              className="te min-h-[32px] rounded-control border border-rule px-3 text-[12px] font-semibold text-ink-soft disabled:opacity-50">
              {en ? 'Import the excerpt instead' : 'బదులుగా సారాంశాన్ని తీసుకోండి'}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={onReject}
            className="te min-h-[32px] rounded-control border border-rule px-3 text-[12px] font-semibold text-muted disabled:opacity-50">
            {en ? 'Reject' : 'తిరస్కరించండి'}
          </button>
        </div>
      </div>
    </article>
  );
}

/** Quota used this hour, and whether the crawl worker is actually alive.
 *
 * `stale` is the field that matters: crawl tasks route to their own Celery
 * queue, so a deployment missing the `worker-ingest` container queues them in
 * Redis forever and nothing else anywhere reports a failure.
 */
function CoverageTab() {
  const { language } = useI18n();
  const en = language === 'en';
  const status = useQuery({ queryKey: ['cms', 'crawl-status'], queryFn: cmsApi.fetchCrawlStatus });
  const data = status.data;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {!data.enabled ? (
        <p className="te rounded-control border border-rule bg-canvas p-3 text-[12.5px] leading-telugu text-ink-soft">
          {en
            ? 'The hourly crawl is switched off. Turn it on in Settings — nothing is fetched or rewritten on a schedule until you do.'
            : 'గంటవారీ క్రాల్ ఆఫ్‌లో ఉంది. సెట్టింగ్స్‌లో ఆన్ చేయండి — అప్పటివరకు షెడ్యూల్‌లో ఏమీ జరగదు.'}
        </p>
      ) : null}

      {data.enabled && data.stale ? (
        <p role="alert" className="te rounded-control border border-breaking-border bg-breaking-tint p-3 text-[12.5px] leading-telugu text-breaking">
          {en
            ? 'No source has been fetched successfully for over two hours. Check that the worker-ingest container is running — crawl tasks go to their own queue and pile up silently without it.'
            : 'రెండు గంటలుగా ఏ మూలం నుంచీ విజయవంతంగా తేలేదు. worker-ingest కంటైనర్ నడుస్తోందో చూడండి.'}
        </p>
      ) : null}

      <div className="rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface">
        <p className="font-sans text-[12px] text-muted">
          {en ? 'Rewrites this hour' : 'ఈ గంటలో పునర్లేఖనాలు'}
        </p>
        <p className="font-sans text-[26px] font-extrabold tabular-nums text-ink">
          {data.used_this_hour}
          <span className="text-[15px] font-semibold text-muted"> / {data.hourly_cap}</span>
        </p>
        <p className="te mt-1 text-[11.5px] text-muted">
          {data.last_fetch_at
            ? `${en ? 'Last fetch' : 'చివరి ఫెచ్'}: ${new Date(data.last_fetch_at).toLocaleString('en-IN')}`
            : (en ? 'Never fetched' : 'ఎప్పుడూ తేలేదు')}
        </p>
      </div>

      <div className="overflow-x-auto rounded-card border border-rule bg-white shadow-card dark:bg-surface">
        <table className="w-full min-w-[520px] text-left">
          <thead className="bg-paper font-sans text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2.5">{en ? 'Beat' : 'బీట్'}</th>
              <th className="px-3 py-2.5">{en ? 'Sources' : 'మూలాలు'}</th>
              <th className="px-3 py-2.5">{en ? 'Used / quota' : 'వాడినవి / కోటా'}</th>
            </tr>
          </thead>
          <tbody>
            {data.beats.map((row) => (
              <tr key={row.beat} className="border-t border-rule-soft">
                <td className="te px-3 py-2.5 text-[12.5px] text-ink">
                  {BEATS.find((b) => b.value === row.beat)?.[en ? 'en' : 'te'] ?? row.beat}
                </td>
                <td className="px-3 py-2.5 font-sans text-[12px] tabular-nums text-ink-soft">{row.sources}</td>
                <td className="px-3 py-2.5 font-sans text-[12px] tabular-nums text-ink-soft">
                  <span className={row.quota > 0 && row.used >= row.quota ? 'font-bold text-partial' : ''}>
                    {row.used}
                  </span>
                  {' / '}{row.quota}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ContentSourcesPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'queue' | 'sources' | 'coverage'>('queue');
  const [adding, setAdding] = useState(false);

  const sources = useQuery({ queryKey: ['cms', 'sources'], queryFn: cmsApi.fetchSources });
  const queue = useQuery({ queryKey: ['cms', 'ingest-queue'], queryFn: () => cmsApi.fetchIngestQueue('new') });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cms', 'sources'] });
    void queryClient.invalidateQueries({ queryKey: ['cms', 'ingest-queue'] });
    void queryClient.invalidateQueries({ queryKey: ['cms', 'crawl-status'] });
  };

  const run = useMutation({ mutationFn: cmsApi.runIngestion, onSuccess: refresh });
  const rewriteOne = useMutation({
    mutationFn: (id: number) => cmsApi.rewriteIngestedItem(id),
    onSuccess: refresh,
  });
  const importItem = useMutation({
    mutationFn: ({ id, useRewrite }: { id: number; useRewrite: boolean }) =>
      cmsApi.importIngestedItem(id, { use_rewrite: useRewrite }),
    onSuccess: refresh,
  });
  const reject = useMutation({ mutationFn: (id: number) => cmsApi.rejectIngestedItem(id), onSuccess: refresh });
  const fetchOne = useMutation({ mutationFn: (id: number) => cmsApi.fetchSourceNow(id), onSuccess: refresh });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      cmsApi.patchSource(id, { is_active: active }),
    onSuccess: refresh,
  });

  const counts = queue.data?.queue ?? sources.data?.queue;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4">
        <h1 className="th text-[25px] font-extrabold text-ink">
          {en ? 'Content sources' : 'కంటెంట్ మూలాలు'}
        </h1>
        <p className="te mt-1 max-w-[70ch] text-[12px] leading-telugu text-muted">
          {en
            ? 'Feeds we pull from, and what each licence permits. Imported items become drafts — an editor still approves, and a different editor still publishes.'
            : 'మనం తీసుకునే ఫీడ్‌లు, ప్రతి లైసెన్స్ ఏమి అనుమతిస్తుందో. తీసుకున్నవి డ్రాఫ్ట్‌లుగా వస్తాయి — ఎడిటర్ ఆమోదం, మరో ఎడిటర్ ప్రచురణ తప్పనిసరి.'}
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['queue', 'sources', 'coverage'] as const).map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
            className={`te min-h-[34px] rounded-chip border px-3.5 text-[12.5px] font-semibold ${
              tab === key ? 'border-brand bg-brand text-white' : 'border-rule bg-white text-ink dark:bg-surface'
            }`}>
            {key === 'queue'
              ? `${en ? 'Queue' : 'క్యూ'} (${counts?.new ?? 0})`
              : key === 'sources'
                ? `${en ? 'Sources' : 'మూలాలు'} (${sources.data?.total ?? 0})`
                : (en ? 'Coverage' : 'కవరేజ్')}
          </button>
        ))}
        <button type="button" disabled={run.isPending} onClick={() => run.mutate()}
          className="te ml-auto min-h-[34px] rounded-control border border-brand px-3.5 text-[12.5px] font-bold text-brand disabled:opacity-50">
          {run.isPending ? (en ? 'Fetching…' : 'తెస్తోంది…') : (en ? 'Fetch now' : 'ఇప్పుడే తెండి')}
        </button>
      </div>

      {run.data ? (
        <p className="te mb-4 rounded-control border border-rule bg-canvas p-2.5 font-sans text-[12px] text-ink-soft">
          {(run.data.results as Array<Record<string, unknown>>).map((r) =>
            `${r.source}: ${r.status}${r.new != null ? ` (+${r.new})` : ''}`).join(' · ') ||
            (en ? 'No sources were due.' : 'ఏ మూలం కూడా షెడ్యూల్‌లో లేదు.')}
        </p>
      ) : null}

      {tab === 'queue' ? (
        <div className="space-y-3">
          {queue.data?.items.map((item) => (
            <QueueRow key={item.id} item={item}
              busy={importItem.isPending || reject.isPending || rewriteOne.isPending}
              onImport={(useRewrite) => importItem.mutate({ id: item.id, useRewrite })}
              onRewrite={() => rewriteOne.mutate(item.id)}
              onReject={() => reject.mutate(item.id)} />
          ))}
          {queue.data && queue.data.items.length === 0 ? (
            <p className="te rounded-card border border-rule bg-white p-8 text-center text-[13px] text-muted dark:bg-surface">
              {en ? 'Nothing waiting. Add a source and fetch.' : 'ఏమీ లేదు. మూలం జోడించి తెప్పించండి.'}
            </p>
          ) : null}
        </div>
      ) : tab === 'coverage' ? (
        <CoverageTab />
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-card border border-rule bg-white shadow-card dark:bg-surface">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-paper font-sans text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2.5">{en ? 'Publisher' : 'ప్రచురణకర్త'}</th>
                  <th className="px-3 py-2.5">{en ? 'Licence' : 'లైసెన్స్'}</th>
                  <th className="px-3 py-2.5">{en ? 'Keeps' : 'భద్రపరచేది'}</th>
                  <th className="px-3 py-2.5">{en ? 'Last checked' : 'చివరి తనిఖీ'}</th>
                  <th className="px-3 py-2.5">{en ? 'Pending' : 'పెండింగ్'}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(sources.data?.items ?? []).map((source: ContentSource) => (
                  <tr key={source.id} className="border-t border-rule-soft">
                    <td className="px-3 py-3">
                      <span className="font-sans text-[13px] font-semibold text-ink">{source.name}</span>
                      <span className="block truncate font-mono text-[10.5px] text-muted">{source.feed_url}</span>
                    </td>
                    <td className="px-3 py-3 font-sans text-[11.5px] text-ink-soft">
                      {LICENCES.find((l) => l.value === source.licence)?.[en ? 'en' : 'te'] ?? source.licence}
                    </td>
                    <td className="px-3 py-3"><LicenceBadge source={source} /></td>
                    <td className="px-3 py-3 font-sans text-[11.5px] text-muted">
                      {source.last_fetched_at ? new Date(source.last_fetched_at).toLocaleString('en-IN') : '—'}
                      {source.last_status && source.last_status !== 'ok' ? (
                        <span className="block text-breaking">{source.last_status}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-sans text-[12px] font-bold tabular-nums text-brand">
                      {source.pending_items}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1.5">
                        <button type="button" disabled={fetchOne.isPending}
                          onClick={() => fetchOne.mutate(source.id)}
                          className="te min-h-[30px] rounded-control border border-rule px-2.5 text-[11.5px] font-semibold text-brand disabled:opacity-50">
                          {en ? 'Fetch' : 'తెండి'}
                        </button>
                        <button type="button"
                          onClick={() => toggle.mutate({ id: source.id, active: !source.is_active })}
                          className="te min-h-[30px] rounded-control border border-rule px-2.5 text-[11.5px] font-semibold text-muted">
                          {source.is_active ? (en ? 'Pause' : 'ఆపండి') : (en ? 'Resume' : 'కొనసాగించండి')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sources.data && sources.data.items.length === 0 ? (
              <p className="te p-8 text-center text-[13px] text-muted">
                {en ? 'No sources configured yet.' : 'ఇంకా మూలాలు లేవు.'}
              </p>
            ) : null}
          </div>

          {adding ? (
            <AddSourceForm onDone={() => { setAdding(false); refresh(); }} />
          ) : (
            <button type="button" onClick={() => setAdding(true)}
              className="te min-h-tap rounded-control border border-brand px-4 font-bold text-brand">
              + {en ? 'Add a source' : 'కొత్త మూలం'}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
