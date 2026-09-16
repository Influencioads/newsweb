import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight, Newspaper, Vote } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/State';
import { useI18n } from '@/i18n';
import type { EpaperArticle, EpaperEdition, EpaperPage, EpaperSlot, EpaperSlotSize } from '@/types/epaper';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/time';

import { COLS, CONTENT_W, FOLIO_H, MARGIN, MASTHEAD_H, ROWS, contentTop, legacySlots, slotRect, type Rect } from './print';

/**
 * The printed sheet — one e-paper page as a fixed 1200 × 1860 broadsheet:
 * folio, masthead on page 1, and the page's stories typeset in real newspaper
 * columns inside the slots the API serves (`page.slots`, placed by
 * `print.ts`). The whole sheet is Telugu (`lang="te"`); it never scales
 * itself — `EpaperSheetViewport` and the rail thumbnails do that.
 *
 * Modes: `reader` (every story is a hotspot into its clip), `thumbnail`
 * (line texture instead of text, no links, aria-hidden) and `print` (the
 * reader layout with no hotspots). The CMS builder passes `editable`: no
 * links, and `renderSlot` wraps every slot, empty ones included.
 */

export type EpaperSheetMode = 'reader' | 'thumbnail' | 'print';

export interface EpaperSheetProps {
  page: EpaperPage;
  /** Date and page count for the folio and the page-1 masthead. */
  edition: Pick<EpaperEdition, 'edition_date' | 'page_count'>;
  mode?: EpaperSheetMode;
  /** Reader mode: where a story's hotspot leads. Defaults to `?clip=<short_id>` on the current URL. */
  clipHref?: (article: EpaperArticle) => string;
  /** Reader mode: outline every hotspot at rest (the reference viewer's "Show clips"). */
  showClips?: boolean;
  /** CMS builder: no links, and `renderSlot` decorates every slot. */
  editable?: boolean;
  /** Chrome around one slot; `story` is the drawn story, `null` for an empty slot. */
  renderSlot?: (slot: EpaperSlot, article: EpaperArticle | null, story: ReactNode) => ReactNode;
}

/** `grid-area` for a slot: row-start / col-start / row-span / col-span. */
export const slotArea = (s: EpaperSlot) => `${s.y + 1} / ${s.x + 1} / span ${s.h} / span ${s.w}`;

const HEAD: Record<EpaperSlotSize, string> = {
  lead: 'ep-head-lead',
  standard: 'ep-head-standard',
  brief: 'ep-head-brief',
};

const rectStyle = ({ left, top, width, height }: Rect): CSSProperties => ({ left, top, width, height });

const WORDMARK = 'టాప్ తెలుగు న్యూస్';

interface StoryProps {
  article: EpaperArticle;
  slot: EpaperSlot;
  mode: EpaperSheetMode;
  /** The 18px fade to paper at the foot — reader mode only. */
  fade: boolean;
}

function Story({ article, slot, mode, fade }: StoryProps) {
  const thumb = mode === 'thumbnail';
  const size = slot.size;
  const wide = size === 'lead' && slot.w >= COLS;
  const byline = [article.byline_te, article.dateline_te].filter(Boolean).join(' · ');
  const paragraphs = article.body ?? [];
  const ratio = size === 'lead' ? '16/9' : '3/2';

  const heading = (
    <div className="min-w-0">
      {article.category_name_te ? <p className="ep-kicker te">{article.category_name_te}</p> : null}
      {article.is_breaking ? (
        <Badge tone="breaking" size="xs" lang="te" className="mb-1">
          బ్రేకింగ్
        </Badge>
      ) : null}
      <h3 className={cn('th font-extrabold text-ink', HEAD[size])}>{article.title_te}</h3>
      {size !== 'brief' && article.summary_te ? <p className="ep-deck te mt-1 text-ink-soft">{article.summary_te}</p> : null}
      {byline ? <p className="ep-byline te mt-1">{byline}</p> : null}
    </div>
  );

  const figure =
    size !== 'brief' && article.hero_url ? (
      <figure className="shrink-0">
        {thumb ? (
          <div className="bg-rule/60" style={{ aspectRatio: ratio }} />
        ) : (
          <div className="overflow-hidden bg-placeholder" style={{ aspectRatio: ratio }}>
            <img
              src={article.hero_url}
              alt={article.hero_caption_te ?? ''}
              draggable={false}
              // The print page stacks every sheet at scale 1; a lazy hero far down the stack must not miss the print.
              loading={mode === 'print' ? 'eager' : 'lazy'}
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
        )}
        {!thumb && (article.hero_caption_te || article.hero_credit) ? (
          <figcaption className="ep-caption te mt-1 text-ink">
            {article.hero_caption_te}
            {article.hero_credit ? <span className={cn('ep-credit', article.hero_caption_te && 'ml-1')}>{article.hero_credit}</span> : null}
          </figcaption>
        ) : null}
      </figure>
    ) : null;

  const body = !paragraphs.length ? null : thumb ? (
    <div aria-hidden className="ep-lines mt-2" />
  ) : (
    <div className="ep-body te mt-2 text-ink" style={{ columnCount: slot.w }}>
      {paragraphs.map((text, i) => (
        <p key={i}>{text}</p>
      ))}
    </div>
  );

  return (
    <article className={cn('ep-story', fade && 'ep-fade')}>
      {wide ? (
        <div className="flex" style={{ gap: 18 }}>
          <div className="w-[55%] shrink-0">{figure}</div>
          {heading}
        </div>
      ) : (
        <>
          {heading}
          {figure ? <div className="mt-2">{figure}</div> : null}
        </>
      )}
      {body}
    </article>
  );
}

export function EpaperSheet({
  page,
  edition,
  mode = 'reader',
  clipHref = (a) => `?clip=${a.short_id}`,
  showClips = true,
  editable = false,
  renderSlot,
}: EpaperSheetProps) {
  const { language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reader = mode === 'reader' && !editable;
  const thumb = mode === 'thumbnail' && !editable;
  const n = page.page_number;
  const date = formatDate(edition.edition_date, 'te');
  const host = typeof window === 'undefined' ? '' : window.location.host;

  // Pages without geometry (pre-grid editions, personal ones): full-width rows, first = lead.
  const { slots, rows } = page.slots.length ? { slots: page.slots, rows: ROWS } : legacySlots(page.articles, page.poll_id ? 1 : 0);
  const bySlot = new Map(page.articles.map((a) => [a.slot, a]));
  const articleAt = (slot: EpaperSlot) => (page.slots.length ? bySlot.get(slot.index) : page.articles[slot.index]) ?? null;
  const lastRowFree = !slots.some((s) => s.y + s.h >= rows);

  const cells = slots.map((slot) => {
    const article = articleAt(slot);
    const story = article ? <Story article={article} slot={slot} mode={mode} fade={reader} /> : null;
    const content = editable && renderSlot ? renderSlot(slot, article, story) : story;
    if (content == null) return null;
    return (
      <div
        key={slot.index}
        className={cn('ep-cell', slot.x + slot.w < COLS && 'ep-rule-r', slot.y + slot.h < rows && 'ep-rule-b')}
        style={rectStyle(slotRect(slot, n, rows))}
      >
        {content}
        {reader && article ? (
          <Link to={clipHref(article)} className={cn('ep-hotspot absolute inset-0 z-10', showClips && 'ep-hotspot-rest')}>
            <span className="sr-only">{article.title_te} · క్లిప్ తెరవండి</span>
          </Link>
        ) : null}
      </div>
    );
  });

  const pollBox = 'flex h-full items-center justify-between gap-4 border-2 border-ink px-6 text-ink';
  const poll = page.poll_id && lastRowFree && (
    <div className="ep-cell" style={rectStyle(slotRect({ x: 0, y: rows - 1, w: COLS, h: 1 }, n, rows))}>
      {reader ? (
        <Link to={`/polls/${page.poll_id}`} className={cn(pollBox, 'transition-colors duration-base ease-standard hover:bg-brand-tint')}>
          <PollLabel />
          <Icon icon={ChevronRight} size="lg" />
        </Link>
      ) : (
        <div className={pollBox}>
          <PollLabel />
        </div>
      )}
    </div>
  );

  return (
    // The publisher asked that readers cannot save or copy the paper: no text
    // selection, no image drag, no context menu. A deterrent, not security.
    <article
      lang="te"
      aria-hidden={thumb || undefined}
      onContextMenu={reader ? (e) => e.preventDefault() : undefined}
      className={cn('ep-sheet shadow-raised print:shadow-none', reader && 'select-none')}
    >
      <div
        className="ep-folio absolute flex items-center gap-3 border-b border-rule font-sans text-muted"
        style={{ left: MARGIN, top: MARGIN, width: CONTENT_W, height: FOLIO_H }}
      >
        <span className="ep-folio-num border border-ink px-1.5 font-bold tabular-nums text-ink">{n}</span>
        <span className="te text-ink">{date}</span>
        <span lang="en">{host}</span>
        <span className="th ml-auto font-bold text-ink">{page.title}</span>
      </div>

      {n === 1 ? (
        <div
          className="absolute flex flex-col text-center"
          style={{ left: MARGIN, top: MARGIN + FOLIO_H, width: CONTENT_W, height: MASTHEAD_H }}
        >
          <div className="mt-2 flex-1 border-t-2 border-ink pt-1">
            <p className="ep-wordmark th font-extrabold text-brand">{WORDMARK}</p>
            <p lang="en" className="font-sans text-eyebrow font-semibold uppercase tracking-wordmark text-exclusive-text">
              Top Telugu News
            </p>
          </div>
          <div className="te flex items-center justify-between border-t-2 border-ink py-1 text-meta text-ink">
            <span>{date}</span>
            <span>
              <span className="font-sans tabular-nums">{edition.page_count}</span> పేజీలు · ఈ-పేపర్
            </span>
          </div>
        </div>
      ) : null}

      {cells}
      {poll}

      {!editable && !thumb && !page.articles.length ? (
        <div className="absolute inset-x-0 flex items-center justify-center" style={{ top: contentTop(n), bottom: MARGIN }}>
          <EmptyState compact icon={Newspaper} title={L('ఈ పేజీలో కథనాలు లేవు.', 'No stories on this page.')} />
        </div>
      ) : null}
    </article>
  );
}

function PollLabel() {
  return (
    <span className="flex items-center gap-3">
      <Icon icon={Vote} size="lg" className="text-brand" />
      <span className="th ep-head-standard font-extrabold">బిగ్ క్వశ్చన్</span>
      <span className="te ep-deck text-ink-soft">ఇప్పుడే ఓటు వేయండి</span>
    </span>
  );
}
