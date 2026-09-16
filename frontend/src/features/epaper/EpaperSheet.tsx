import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight, Newspaper, Vote } from 'lucide-react';
import { Link } from 'react-router-dom';

import { NewsImage } from '@/components/media/NewsImage';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/State';
import { useI18n } from '@/i18n';
import type { EpaperArticle, EpaperPage, EpaperSlot, EpaperSlotSize } from '@/types/epaper';
import type { MediaOut } from '@/types/public';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

/**
 * The printed sheet — one e-paper page drawn as a newspaper front: masthead
 * rule, page title, then the page's stories on the 6×6 slot grid the API
 * serves (`page.slots`), one column below `md`. The whole sheet is Telugu
 * (`lang="te"`); publicly every headline is a hotspot into the full article,
 * and the page's "big question" poll is one at the foot.
 *
 * The CMS builder renders the same sheet with `editable`: headlines stop being
 * links and `renderSlot` wraps every slot (empty ones included) in its chrome.
 * Zoom and paging live in `EditionReader`; this component only draws a page.
 */

/** The story hero as the one media primitive — the API gives a bare URL. */
function heroMedia(url: string): MediaOut {
  return {
    id: 0,
    url,
    srcset: null,
    alt_te: null,
    caption_te: null,
    credit: null,
    license_label: null,
    source_url: null,
    width: null,
    height: null,
    blurhash: null,
    ai_generated: false,
  };
}

/** Text budgets per size — the same lines the PDF renderer draws (`epaper_pdf`). */
const STORY: Record<EpaperSlotSize, { ratio: string; sizes: string; title: string; summary: string | null }> = {
  lead: {
    ratio: '16/9',
    sizes: '(min-width: 768px) 620px, 100vw',
    title: 'text-headline-lg te-clamp-3',
    summary: 'te-clamp-5',
  },
  standard: {
    ratio: '4/3',
    sizes: '(min-width: 768px) 300px, 100vw',
    title: 'text-headline-sm te-clamp-3',
    summary: 'te-clamp-2',
  },
  brief: { ratio: '4/3', sizes: '100vw', title: 'text-headline-xs te-clamp-2', summary: null },
};

function Story({ article, size, editable }: { article: EpaperArticle; size: EpaperSlotSize; editable: boolean }) {
  const { t } = useI18n();
  const reveal = useReveal<HTMLElement>();
  const look = STORY[size];
  const headline = 'block min-h-tap';
  return (
    <article ref={reveal} className="border-b border-rule pb-3">
      {size !== 'brief' && article.hero_url && (
        <NewsImage media={heroMedia(article.hero_url)} ratio={look.ratio} sizes={look.sizes} className="mb-2 grayscale-[20%]" />
      )}
      {article.is_breaking && (
        <Badge tone="breaking" size="xs" className="mb-1">
          {t('ui.breaking')}
        </Badge>
      )}
      <h3 lang="te" className={cn('th font-extrabold', look.title)}>
        {editable ? (
          <span className={headline}>{article.title_te}</span>
        ) : (
          <Link
            to={article.url}
            className={cn(headline, 'transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand')}
          >
            {article.title_te}
          </Link>
        )}
      </h3>
      {look.summary && article.summary_te && (
        <p lang="te" className={cn('te mt-1 text-te-body-xs text-ink-soft', look.summary)}>
          {article.summary_te}
        </p>
      )}
    </article>
  );
}

export interface EpaperSheetProps {
  page: EpaperPage;
  /** CMS builder: no links, and `renderSlot` decorates every slot. */
  editable?: boolean;
  /** Chrome around one slot; `story` is the drawn card, `null` for an empty slot. */
  renderSlot?: (slot: EpaperSlot, article: EpaperArticle | null, story: ReactNode) => ReactNode;
}

/** `grid-area` for a slot: row-start / col-start / row-span / col-span. */
export const slotArea = (s: EpaperSlot) => `${s.y + 1} / ${s.x + 1} / span ${s.h} / span ${s.w}`;

export function EpaperSheet({ page, editable = false, renderSlot }: EpaperSheetProps) {
  const { t, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const bySlot = new Map(page.articles.map((a) => [a.slot, a]));

  const cells = page.slots.length
    ? page.slots.map((slot) => {
        const article = bySlot.get(slot.index) ?? null;
        const story = article ? <Story article={article} size={slot.size} editable={editable} /> : null;
        const content = editable && renderSlot ? renderSlot(slot, article, story) : story;
        if (content == null) return null;
        // `--slot` only takes effect from md, where the 6-column grid exists; phones keep one column.
        return (
          <div key={slot.index} className="md:[grid-area:var(--slot)]" style={{ '--slot': slotArea(slot) } as CSSProperties}>
            {content}
          </div>
        );
      })
    : // Editions from before the slot grid (and personal ones) carry no geometry: full-width rows, first = lead.
      page.articles.map((a, i) => (
        <div key={a.id} className="md:col-span-6">
          <Story article={a} size={i === 0 ? 'lead' : 'standard'} editable={editable} />
        </div>
      ));

  return (
    <Card
      as="article"
      tone="paper"
      padding="none"
      lang="te"
      radius="2xl"
      className="mx-auto min-h-[78vh] w-full max-w-page p-5 shadow-raised sm:p-8"
    >
      <header className="mb-5 border-y-2 border-ink py-3 text-center">
        <p lang="en" className="font-sans text-eyebrow font-bold uppercase text-muted">
          Top Telugu News · Digital Edition
        </p>
        <h2 className="th text-headline-xl font-extrabold">{page.title}</h2>
        <p className="font-sans text-meta text-muted">
          {t('epaper.page')} {page.page_number}
        </p>
      </header>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-6">{cells}</div>
      {!editable && !page.articles.length && (
        <EmptyState compact icon={Newspaper} title={L('ఈ పేజీలో కథనాలు లేవు.', 'No stories on this page.')} />
      )}
      {page.poll_id &&
        (editable ? (
          <Badge tone="brand" icon={Vote} className="mt-6">
            {L('బిగ్ క్వశ్చన్ జోడించబడింది', 'Big question attached')}
          </Badge>
        ) : (
          <ButtonLink
            to={`/polls/${page.poll_id}`}
            variant="primary"
            size="lg"
            full
            icon={Vote}
            iconRight={ChevronRight}
            className="mt-6"
          >
            {L('బిగ్ క్వశ్చన్ · ఇప్పుడే ఓటు వేయండి', 'Big question · Vote now')}
          </ButtonLink>
        ))}
    </Card>
  );
}
