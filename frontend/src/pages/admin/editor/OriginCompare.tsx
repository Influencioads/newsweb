import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ExternalLink } from 'lucide-react';

import { Section } from '@/components/admin/FormControls';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { QueryState, Skeleton } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useScript } from '@/i18n';
import type { AiFiling, AiTagType, ArticleOrigin, PhotoCheck, PhotoVerdict } from '@/types/cms';
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

      {data.ai ? <AiFilingPanel ai={data.ai} /> : null}
      {data.photos ? <PhotosChecked photos={data.photos} /> : null}
    </div>
  );
}

const TAG_TYPE: Record<AiTagType, [string, string]> = {
  person: ['వ్యక్తి', 'person'],
  place: ['ప్రదేశం', 'place'],
  org: ['సంస్థ', 'organisation'],
  topic: ['అంశం', 'topic'],
  event: ['ఘటన', 'event'],
};

/** Where the AI put the story. What the article carries now may differ — the desk can refile it. */
function AiFilingPanel({ ai }: { ai: AiFiling }) {
  const L = useL();
  const s = useScript();
  const rows: Array<[string, AiFiling['category']]> = [
    [L('విభాగం', 'Section'), ai.category],
    [L('ఉప విభాగం', 'Sub-section'), ai.subcategory],
    [L('జిల్లా', 'District'), ai.district],
    [L('మండలం', 'Mandal'), ai.mandal],
  ];
  return (
    <section className="mt-4 border-t border-rule pt-3">
      <ColumnHead>{L('AI ఇలా వర్గీకరించింది', 'AI filed it as')}</ColumnHead>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ui-sm">
        {rows.map(([label, row]) => {
          const name = row ? s.text(row.name_te, row.name_en) : null;
          return (
            <Fragment key={label}>
              <dt lang={s.language} className={cn(s.body, 'text-muted')}>{label}</dt>
              <dd className="min-w-0 text-ink">
                {name ? <span lang={name.lang} className={name.cls}>{name.text}</span> : '—'}
              </dd>
            </Fragment>
          );
        })}
      </dl>
      {ai.tags.length || ai.breaking || ai.glyph_warning ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          {ai.tags.map((tag) => (
            <Badge key={`${tag.type}:${tag.name}`} tone="district" size="xs" lang="te">
              {tag.name}
              <span lang={s.language} className={cn(s.body, 'text-muted')}>
                {L(TAG_TYPE[tag.type]?.[0] ?? tag.type, TAG_TYPE[tag.type]?.[1] ?? tag.type)}
              </span>
            </Badge>
          ))}
          {ai.breaking ? (
            <Badge tone="exclusive" size="xs">{L('AI: బ్రేకింగ్ కావచ్చు', 'AI suggests breaking')}</Badge>
          ) : null}
          {ai.glyph_warning ? (
            <Badge tone="partial" size="xs">{L('పాఠ్యంలో వేరే లిపి అక్షరాలు', 'stray foreign letters in the text')}</Badge>
          ) : null}
        </p>
      ) : null}
      <StyleCheck ai={ai} />
    </section>
  );
}

/** Copy-checker codes worth a reviewer's eye, by name; any other code shows as itself. */
const STYLE_CODE: Record<string, [BadgeTone, string, string]> = {
  copied: ['breaking', 'మూల వాక్యాలు యథాతథంగా', 'copies source wording'],
  outlet_named: ['breaking', 'వేరే సంస్థ పేరు', 'names another outlet'],
  placeholder: ['breaking', '[ ] ఖాళీ మిగిలింది', 'unfilled [ ] slot'],
  death_headline_mark: ['breaking', 'మరణ వార్తకు ?/!', '?/! on a death headline'],
  headline_too_long: ['partial', 'శీర్షిక పొడవు', 'headline too long'],
  avoid_phrase: ['partial', 'నిషేధిత పదం', 'banned phrase'],
  lede_too_long: ['muted', 'మొదటి పేరా పొడవు', 'long lede'],
  latin_heavy: ['muted', 'ఇంగ్లిష్ పదాలు ఎక్కువ', 'much English'],
};

/** The house-style pass: the story type the writer followed, its note to the desk, what the checker still flags. */
function StyleCheck({ ai }: { ai: AiFiling }) {
  const L = useL();
  const s = useScript();
  const type = ai.story_type ? s.text(ai.story_type.name_te, ai.story_type.name_en) : null;
  const warnings = ai.style_warnings ?? [];
  if (!type && !ai.editor_note && !warnings.length && !ai.refuse_screen) return null;
  return (
    <div className="mt-3 space-y-2">
      {type ? (
        <p className={cn(s.body, 'text-ui-sm text-muted')}>
          {L('కథన రకం:', 'Story type:')}{' '}
          <span lang={type.lang} className={cn(type.cls, 'text-ink')}>{type.text}</span>
        </p>
      ) : null}
      {ai.refuse_screen ? (
        <Badge tone="breaking" size="xs">
          {L('సున్నిత అంశం — సంపాదకుడే నిర్ణయించాలి', 'sensitive subject — an editor must decide')}
        </Badge>
      ) : null}
      {ai.editor_note ? (
        <p className="rounded-lg border border-rule bg-surface p-2 text-ui-sm">
          <span lang={s.language} className={cn(s.body, 'font-bold text-ink')}>{L('రచయిత సూచన: ', 'Writer’s note: ')}</span>
          <span lang="te" className="te text-te-body-xs text-ink-soft">{ai.editor_note}</span>
        </p>
      ) : null}
      {warnings.length ? (
        <p className="flex flex-wrap items-center gap-1.5">
          {warnings.map((code) => {
            const [tone, te, en] = STYLE_CODE[code] ?? ['muted', code, code];
            return (
              <Badge key={code} tone={tone} size="xs">
                {L(te, en)}
              </Badge>
            );
          })}
        </p>
      ) : null}
    </div>
  );
}

const VERDICT: Record<PhotoVerdict, [BadgeTone, string, string]> = {
  clean: ['success', 'బ్రాండింగ్ లేదు', 'clean'],
  watermark: ['breaking', 'వాటర్‌మార్క్', 'watermark'],
  logo: ['breaking', 'ఛానల్ లోగో', 'logo'],
  text: ['breaking', 'అక్షరాలు ముద్రించారు', 'burned-in text'],
  graphic: ['partial', 'గ్రాఫిక్ / అనుచితం', 'graphic / unfit'],
  unchecked: ['muted', 'స్కాన్ చేయలేదు', 'not scanned'],
};

const HERO_FROM: Record<PhotoCheck['hero'], [string, string]> = {
  crawled: ['ప్రచురణకర్త ఫోటోల్లో ఒకటి', 'one of the publisher’s photos'],
  open_licence: ['ఉచిత లైసెన్స్ ఫోటో', 'a free-licence photo'],
  ai_illustration: ['ప్రతీకాత్మక AI చిత్రం', 'a representative AI picture'],
  none: ['ఏదీ లేదు — డెస్క్ ఫోటో జోడించాలి', 'nothing — the desk must add a photo'],
};

/** Every candidate the vision scan looked at. Rejected ones were never used, and never cleaned. */
function PhotosChecked({ photos }: { photos: PhotoCheck }) {
  const L = useL();
  const s = useScript();
  const from = HERO_FROM[photos.hero];
  return (
    <section className="mt-4 border-t border-rule pt-3">
      <ColumnHead>{L('తనిఖీ చేసిన ఫోటోలు', 'Photos checked')}</ColumnHead>
      <p lang={s.language} className={cn(s.body, 'mt-1 text-meta text-muted')}>
        {`${L('హీరో ఫోటో', 'Hero photo')}: ${from ? L(from[0], from[1]) : photos.hero}`}
        {photos.model ? ` · ${photos.model}` : ''}
      </p>
      {photos.candidates.length ? (
        <ul className="mt-2 space-y-2">
          {photos.candidates.map((c, i) => {
            const v = VERDICT[c.verdict] ?? VERDICT.unchecked;
            return (
              <li key={`${i}:${c.url}`} className="flex items-center gap-3">
                <a href={c.url} target="_blank" rel="noopener noreferrer" aria-label={L('ఫోటో తెరవండి', 'Open photo')} className="shrink-0">
                  <img src={c.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-12 w-16 rounded-lg bg-rule-soft object-cover" />
                </a>
                <Badge tone={v[0]} size="xs">{L(v[1], v[2])}</Badge>
                {c.reason ? <span lang="en" className="min-w-0 font-sans text-meta text-muted">{c.reason}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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
