import type { ReactNode } from 'react';
import { ChevronDown, ExternalLink, FileInput, Sparkles, X } from 'lucide-react';

import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { REWRITE_STATUS } from '@/features/cms/status';
import type { ContentPolicy, IngestedItem, SourceLicence } from '@/types/cms';
import { cn } from '@/utils/cn';

import { MANDAL_LABEL } from './labels';
import { useL } from '../useL';

/**
 * One fetched item in the ingest queue, with its rewrite (if any) and the
 * decision an editor makes about it: import as a draft, or reject.
 *
 * Importing never publishes — the item becomes a DRAFT in the review queue,
 * the same rule reader submissions and AI drafts follow.
 */

/** What the licence lets us keep of this source's words. */
export function LicenceBadge({ source }: { source: { licence: SourceLicence; content_policy: ContentPolicy } }) {
  const licensed = source.licence !== 'rss_public';
  const full = source.content_policy === 'full_text';
  return (
    <Badge tone={full ? 'success' : licensed ? 'partial' : 'muted'} size="xs" lang="en">
      {full ? 'FULL TEXT' : source.content_policy === 'link_only' ? 'LINK' : 'EXCERPT'}
    </Badge>
  );
}

/** Heading for one side of the comparison. */
function ColumnHead({ children }: { children: ReactNode }) {
  return <h4 className="font-sans text-meta font-bold uppercase tracking-wide text-muted">{children}</h4>;
}

/** The rewrite, the refusal, or nothing — whichever actually happened.
 *
 * A refusal is shown rather than hidden. "The model declined because the
 * source had three sentences" is something an editor acts on; hiding it would
 * make the queue look like nothing had been tried.
 *
 * When a rewrite is ready, opening the row puts the original beside our words.
 * Two columns and the similarity percentage rather than a word-level diff: the
 * reviewer's question is "is this our reporting or theirs", and a highlighted-
 * word view answers that worse than reading both. Collapsed by default because
 * the queue lists fifty of these.
 *
 * `source_text` is kept only while the item is undecided, and only when the
 * page was actually fetched, so for most rows the left column is a pointer at
 * the publisher rather than their text. That is the licence working, not a gap.
 */
function RewritePanel({ item, onRewrite, busy }: { item: IngestedItem; onRewrite: () => void; busy: boolean }) {
  const L = useL();
  const rewrite = item.rewrite;
  const ready = rewrite !== null && item.rewrite_status === 'ready';
  const sourceLink = item.canonical_url ?? item.url;

  return (
    <div className="mt-3 rounded-xl border border-rule-soft bg-paper-sub p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={item.rewrite_status} registry={REWRITE_STATUS} />
        {rewrite?.refusal_reason ? <span className="font-sans text-meta text-muted">{rewrite.refusal_reason}</span> : null}
        {item.rewrite_status !== 'ready' && item.rewrite_status !== 'human_only' ? (
          <Button variant="secondary" size="sm" icon={Sparkles} disabled={busy} onClick={onRewrite} className="ml-auto text-ai-text">
            {L('ఇప్పుడే రాయించండి', 'Rewrite now')}
          </Button>
        ) : null}
      </div>

      {ready ? (
        <details className="group mt-1">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 rounded-xl transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand">
            <span lang="te" className="th min-w-0 flex-1 text-headline-xs font-bold text-ai-text">
              {rewrite.title_te}
            </span>
            <Icon icon={ChevronDown} size="sm" className="text-muted transition-transform duration-base ease-standard group-open:rotate-180" />
          </summary>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <section className="min-w-0">
              <ColumnHead>{L('మూలం', 'Original')}</ColumnHead>
              {rewrite.source_text ? (
                <>
                  <p lang="te" className="th mt-1 text-ui-sm font-bold text-ink">{item.title}</p>
                  {item.summary ? (
                    <p lang="te" className="te mt-1 text-te-body-xs text-ink-soft">{item.summary}</p>
                  ) : null}
                  <p lang="te" className="te mt-2 whitespace-pre-line text-te-body-xs text-ink-soft">
                    {rewrite.source_text}
                  </p>
                </>
              ) : (
                <>
                  {sourceLink ? (
                    <ButtonLink to={sourceLink} external variant="link" size="sm" iconRight={ExternalLink} className="-ml-1 text-info">
                      {L('అసలు కథనం తెరవండి', 'Open the original')}
                    </ButtonLink>
                  ) : null}
                  <p className="mt-1">
                    <Badge tone="partial" size="xs">{L('సారాంశం మాత్రమే', 'excerpt only')}</Badge>
                  </p>
                  <p className="mt-1 font-sans text-meta text-muted">
                    {L(
                      'ఈ ప్రచురణకర్త పూర్తి పాఠ్యం మా దగ్గర లేదు. పోల్చే ముందు అసలు కథనాన్ని తెరిచి చదవండి.',
                      'We do not hold this publisher\u2019s full text. Open the original and read it before you compare.',
                    )}
                  </p>
                  <p lang="te" className="th mt-2 text-ui-sm font-bold text-ink">{item.title}</p>
                  {item.summary ? (
                    <p lang="te" className="te mt-1 text-te-body-xs text-ink-soft">{item.summary}</p>
                  ) : null}
                </>
              )}
            </section>

            <section className="min-w-0 sm:border-l sm:border-rule sm:pl-4">
              <ColumnHead>{L('మా పాఠ్యం', 'Our rewrite')}</ColumnHead>
              <p lang="te" className="th mt-1 text-ui-sm font-bold text-ai-text">{rewrite.title_te}</p>
              {rewrite.summary_te ? (
                <p lang="te" className="te mt-1 text-te-body-xs text-ink-soft">{rewrite.summary_te}</p>
              ) : null}
              <p lang="te" className="te mt-2 whitespace-pre-line text-te-body-xs text-ink-soft">
                {rewrite.body_plain}
              </p>
              {rewrite.attribution_te ? (
                <p lang="te" className="te mt-2 text-te-body-xs text-muted">{rewrite.attribution_te}</p>
              ) : null}
              <p className="mt-2 flex flex-wrap items-center gap-2 font-sans text-meta text-muted">
                <span>
                  {rewrite.engine}
                  {rewrite.model ? ` · ${rewrite.model}` : ''}
                  {` · ${Math.round(rewrite.confidence * 100)}%`}
                  {` · ${L('పోలిక', 'similarity')} ${rewrite.similarity_percent}%`}
                </span>
                {rewrite.unverified ? (
                  <Badge tone="partial" size="xs">{L('ధృవీకరించని అంశాలు', 'unverified claims')}</Badge>
                ) : null}
              </p>
            </section>
          </div>
        </details>
      ) : null}
    </div>
  );
}

export interface QueueItemProps {
  item: IngestedItem;
  onImport: (useRewrite: boolean) => void;
  onReject: () => void;
  onRewrite: () => void;
  busy: boolean;
}

export function QueueItem({ item, onImport, onReject, onRewrite, busy }: QueueItemProps) {
  const L = useL();
  const hasRewrite = item.rewrite_status === 'ready';
  const mandal = MANDAL_LABEL[item.mandal.method];

  return (
    <Card as="article" padding="sm" className="flex gap-4">
      {item.image_url ? (
        <img src={item.image_url} alt="" loading="lazy" className="hidden h-20 w-32 shrink-0 rounded-xl object-cover sm:block" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {item.source ? (
            <>
              <span className="font-sans text-ui-sm font-bold text-ink">{item.source.name}</span>
              <LicenceBadge source={item.source} />
            </>
          ) : null}
          {item.published_at ? (
            <span className="font-sans text-meta text-muted">{new Date(item.published_at).toLocaleString('en-IN')}</span>
          ) : null}
        </div>

        <h3 lang="te" className="th mt-2 text-headline-xs font-bold text-ink">
          {item.title}
        </h3>
        {item.summary ? (
          <p lang="te" className="te te-clamp-2 mt-1 text-te-body-xs text-ink-soft">
            {item.summary}
          </p>
        ) : null}

        <p className="mt-2 flex flex-wrap items-center gap-x-2 font-sans text-meta text-muted">
          <span>
            {item.has_full_text
              ? `${L('పూర్తి పాఠ్యం ఉంది', 'Full text stored')} · ${item.word_count} ${L('పదాలు', 'words')}`
              : L('సారాంశం, లింక్ మాత్రమే — పూర్తి పాఠ్యం లేదు', 'Excerpt and link only — no body stored')}
          </span>
          {item.canonical_url ? (
            <ButtonLink to={item.canonical_url} external variant="link" size="sm" iconRight={ExternalLink} className="text-info">
              {L('మూలం తెరవండి', 'open source')}
            </ButtonLink>
          ) : null}
        </p>

        <p className="mt-1 font-sans text-meta text-muted">
          {L(mandal.te, mandal.en)}
          {item.mandal.confidence > 0 ? ` · ${Math.round(item.mandal.confidence * 100)}%` : ''}
          {item.mandal.method === 'keyword' ? (
            <span className="ml-1 text-partial">{L('(ఇది ఊహ — సరిచూడండి)', '(a guess — check it)')}</span>
          ) : null}
        </p>

        <RewritePanel item={item} onRewrite={onRewrite} busy={busy} />

        {item.status === 'new' ? (
          <div className={cn('mt-3 flex flex-wrap gap-2 border-t border-rule pt-3')}>
            <Button size="sm" icon={FileInput} disabled={busy} onClick={() => onImport(hasRewrite)}>
              {hasRewrite ? L('పునర్లేఖనాన్ని సమీక్షకు పంపండి', 'Send rewrite to review') : L('డ్రాఫ్ట్‌గా తీసుకోండి', 'Import as draft')}
            </Button>
            {hasRewrite ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => onImport(false)}>
                {L('బదులుగా సారాంశాన్ని తీసుకోండి', 'Import the excerpt instead')}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" icon={X} disabled={busy} onClick={onReject} className="text-muted">
              {L('తిరస్కరించండి', 'Reject')}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
