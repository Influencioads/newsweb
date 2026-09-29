import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ExternalLink } from 'lucide-react';

import { Section } from '@/components/admin/FormControls';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { QueryState, Skeleton } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useScript } from '@/i18n';
import type { ArticleOrigin } from '@/types/cms';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/time';

import { wordCount } from './form';
import { ColumnHead, LicenceBadge } from '../sources/QueueItem';
import { useL } from '../useL';

/**
 * §17 — the publisher's original beside our words, where the story is approved.
 *
 * The ingest queue has had this comparison since the rewrite shipped
 * (sources/QueueItem → RewritePanel), but it lives one screen earlier and is
 * gone by the time the story is an article awaiting approval. The editor who
 * presses approve sees only our words and takes "this really is our reporting"
 * on trust. Same two columns, same disclosure, moved to where the decision is.
 *
 * Collapsed and not fetched until opened: the endpoint may read the publisher's
 * page live, which is not something to do on every editor page load.
 *
 * The right-hand column is the editor's CURRENT TEXT — the unsaved form as it
 * stands, not the last save and not the rewrite as the model first wrote it.
 * An editor who has already touched the copy must be comparing their own latest
 * version, or the check is theatre. The rewrite's numbers (similarity, model,
 * confidence) still describe how the words started out.
 */

/** Which of the three things the left column is holding — an empty column reads as a bug. */
function OriginState({ original, sourceUrl }: { original: ArticleOrigin['original']; sourceUrl: string | null }) {
  const L = useL();
  const s = useScript();
  const note = (text: string) => (
    <span lang={s.language} className={cn(s.body, 'text-meta text-muted')}>{text}</span>
  );
  if (original.held) {
    return (
      <>
        <Badge tone="muted" size="xs">{L('మనం ఉంచిన ప్రతి', 'held copy')}</Badge>
        {note(L('పునర్లేఖన సమయంలో తీసుకున్నది — మోడల్ చూసినది ఇదే.', 'Taken when we rewrote it — this is what the model saw.'))}
      </>
    );
  }
  if (original.fetched_live) {
    return (
      <>
        <Badge tone="partial" size="xs">{L('ఇప్పుడే చదివినది', 'read just now')}</Badge>
        {note(L(
          'ప్రచురణకర్త పేజీ ఇప్పుడు ఇలా ఉంది — మనం రాసిన తర్వాత వాళ్లు మార్చి ఉండవచ్చు.',
          'The publisher’s page as it reads right now — they may have edited it since we rewrote it.',
        ))}
      </>
    );
  }
  return (
    <>
      <Badge tone="partial" size="xs">{L('మా దగ్గర లేదు', 'not held')}</Badge>
      {/* Only send them to the page when there is a link to send them to: with
          no source URL the backend could not fetch either, so this branch is
          exactly where "open it yourself" would be an instruction they cannot
          follow. */}
      {note(sourceUrl
        ? L(
          'అసలు పాఠ్యం మా దగ్గర లేదు, ఆ పేజీని ఇప్పుడు చదవలేకపోయాం. మీరే తెరిచి చదవాలి.',
          'We hold no copy and could not read the page — you will have to open it and read it yourself.',
        )
        : L(
          'అసలు పాఠ్యం మా దగ్గర లేదు, మూలం లింక్ కూడా లేదు — ఇంగెస్ట్ క్యూలో ఈ అంశాన్ని చూడండి.',
          'We hold no copy and have no source link — check this item in the ingest queue.',
        ))}
    </>
  );
}

function Compare({ data, ours }: { data: ArticleOrigin; ours: LiveText }) {
  const L = useL();
  const s = useScript();
  const { source, original, rewrite } = data;
  // Source name and author come from the publisher's feed, so their script is
  // the text's own, not the interface's.
  const name = s.forText(source.name, null);
  const author = s.forText(original.author, null);
  const published = formatDate(original.published_at, s.language);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {source.name ? (
          <span lang={name.lang} className={cn(name.cls, 'text-ui-sm font-bold text-ink')}>{source.name}</span>
        ) : null}
        {source.licence && source.content_policy ? (
          <LicenceBadge source={{ licence: source.licence, content_policy: source.content_policy }} />
        ) : null}
        {source.url ? (
          <ButtonLink to={source.url} external variant="link" size="sm" iconRight={ExternalLink} className="text-info">
            {L('అసలు కథనం తెరవండి', 'Open the original')}
          </ButtonLink>
        ) : null}
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <section className="min-w-0">
          <ColumnHead>{L('మూలం', 'Original')}</ColumnHead>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <OriginState original={original} sourceUrl={source.url} />
          </p>
          <p lang="te" className="th mt-2 text-ui-sm font-bold text-ink">{original.title}</p>
          <p lang={s.language} className={cn(s.body, 'mt-0.5 text-meta text-muted')}>
            {original.author ? <span lang={author.lang} className={author.cls}>{original.author}</span> : null}
            {original.author && published ? ' · ' : ''}
            {published}
          </p>
          {original.summary ? (
            <p lang="te" className="te mt-1 text-te-body-xs text-ink-soft">{original.summary}</p>
          ) : null}
          {original.text ? (
            <p lang="te" className="te mt-2 whitespace-pre-line text-te-body-xs text-ink-soft">{original.text}</p>
          ) : null}
        </section>

        <section className="min-w-0 sm:border-l sm:border-rule sm:pl-4">
          <ColumnHead>{L('మా పాఠ్యం', 'Our text')}</ColumnHead>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            {rewrite ? (
              <Badge tone="ai" size="xs">{`${L('పోలిక', 'similarity')} ${rewrite.similarity_percent}%`}</Badge>
            ) : (
              <Badge tone="muted" size="xs">{L('పునర్లేఖన రికార్డు లేదు', 'no rewrite on record')}</Badge>
            )}
            {data.ours.edited_since_import ? (
              <Badge tone="info" size="xs">{L('డెస్క్ మార్చింది', 'edited on the desk')}</Badge>
            ) : null}
            {rewrite?.unverified ? (
              <Badge tone="partial" size="xs">{L('ధృవీకరించని అంశాలు', 'unverified claims')}</Badge>
            ) : null}
          </p>
          <p lang="te" className="th mt-2 text-ui-sm font-bold text-ai-text">{ours.title}</p>
          {ours.summary ? (
            <p lang="te" className="te mt-1 text-te-body-xs text-ink-soft">{ours.summary}</p>
          ) : null}
          {ours.body ? (
            <p lang="te" className="te mt-2 whitespace-pre-line text-te-body-xs text-ink-soft">{ours.body}</p>
          ) : (
            <p className="mt-2">
              <Badge tone="muted" size="xs">{L('మా పాఠ్యం ఖాళీగా ఉంది', 'our text is empty')}</Badge>
            </p>
          )}
          {rewrite?.attribution_te ? (
            <p lang="te" className="te mt-2 text-te-body-xs text-muted">{rewrite.attribution_te}</p>
          ) : null}
          <p lang={s.language} className={cn(s.body, 'mt-2 text-meta tabular-nums text-muted')}>
            {`${wordCount(ours.body)} ${L('పదాలు', 'words')}`}
            {rewrite
              ? ` · ${rewrite.engine}${rewrite.model ? ` · ${rewrite.model}` : ''} · ${Math.round(rewrite.confidence * 100)}%`
              : ''}
          </p>
        </section>
      </div>
    </div>
  );
}

/** The editor's live form text — what the reader would get if this went out now. */
export interface LiveText {
  title: string;
  summary: string;
  body: string;
}

export interface OriginCompareProps {
  articleId: number;
  ours: LiveText;
}

export function OriginCompare({ articleId, ours }: OriginCompareProps) {
  const L = useL();
  const s = useScript();
  // Opened once, kept mounted: react-query holds the answer, and re-closing the
  // disclosure should not throw away a live fetch of the publisher's page.
  const [opened, setOpened] = useState(false);

  const origin = useQuery({
    queryKey: ['cms', 'article', articleId, 'origin'],
    queryFn: () => cmsApi.fetchArticleOrigin(articleId),
    enabled: opened,
    // The one query in the app that may read a third party's page live. A slow
    // publisher is not a transient failure, and the global rule would retry it
    // twice — three live fetches and a minute of skeleton before the reviewer
    // is told their connection is at fault.
    retry: false,
  });

  return (
    <Section
      title={L('మూలం పక్కన మా పాఠ్యం', 'The original beside ours')}
      subtitle={L(
        'ఆమోదించే ముందు — ఇది నిజంగా మన సొంత రచనేనా అని సరిచూసుకోండి.',
        'Before you approve — check that this really is our own writing.',
      )}
    >
      <details className="group" onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}>
        <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 rounded-xl transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand">
          <span lang={s.language} className={cn(s.body, 'min-w-0 flex-1 text-ui-sm font-bold text-ink')}>
            {L('రెండింటినీ పక్కపక్కన చూడండి', 'Show both side by side')}
          </span>
          <Icon icon={ChevronDown} size="sm" className="text-muted transition-transform duration-base ease-standard group-open:rotate-180" />
        </summary>

        {opened ? (
          <QueryState
            query={origin}
            compact
            skeleton={(
              <div className="mt-3">
                {/* The wait can be half a minute when the publisher's page is
                    being read live — say so, or it reads as a hang. */}
                <p lang={s.language} className={cn(s.body, 'text-meta text-muted')}>
                  {L(
                    'ప్రచురణకర్త పేజీని ఇప్పుడు చదువుతున్నాం — కొన్ని సెకన్లు పట్టవచ్చు.',
                    'Reading the publisher’s page — this can take a few seconds.',
                  )}
                </p>
                <Skeleton variant="text" lines={6} className="mt-2" />
              </div>
            )}
          >
            {(data) => <Compare data={data} ours={ours} />}
          </QueryState>
        ) : null}
      </details>
    </Section>
  );
}
