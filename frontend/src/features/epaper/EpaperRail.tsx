import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { useI18n } from '@/i18n';
import type { EpaperArticle, EpaperEdition, EpaperPage, EpaperSlotSize } from '@/types/epaper';
import { cn } from '@/utils/cn';

import { EpaperSheet } from './EpaperSheet';

/**
 * The reader's left rail: "Pages" (every page as a thumbnail of the real
 * sheet) and "Page clips" (the open page's stories as cards into their clips).
 * A vertical column from md; a horizontal scroller above the sheet under it.
 */

const SIZE_LABEL: Record<EpaperSlotSize, { te: string; en: string }> = {
  lead: { te: 'ప్రధాన', en: 'Lead' },
  standard: { te: 'సాధారణ', en: 'Standard' },
  brief: { te: 'సంక్షిప్త', en: 'Brief' },
};

export interface EpaperRailProps {
  edition: EpaperEdition;
  /** Page numbers currently open (two in a spread). */
  open: number[];
  /** The page whose stories the clips tab lists. */
  page: EpaperPage;
  href: (pageNumber: number) => string;
  clipHref: (article: EpaperArticle) => string;
  className?: string;
}

export function EpaperRail({ edition, open, page, href, clipHref, className }: EpaperRailProps) {
  const { t, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [tab, setTab] = useState<'pages' | 'clips'>('pages');
  const scroller = 'flex gap-3 overflow-x-auto no-scrollbar scroll-touch p-1 md:min-h-0 md:flex-1 md:flex-col md:overflow-x-visible md:overflow-y-auto';

  return (
    <aside aria-label={t('epaper.page')} className={cn('min-w-0', className)}>
      <Tabs
        size="sm"
        ariaLabel={t('epaper.page')}
        value={tab}
        onChange={(key) => setTab(key as 'pages' | 'clips')}
        items={[
          { key: 'pages', label: L('పేజీలు', 'Pages'), count: edition.page_count },
          { key: 'clips', label: L('పేజీ క్లిప్‌లు', 'Page clips'), count: page.articles.length },
        ]}
      />
      {tab === 'pages' ? (
        <div role="tabpanel" aria-label={L('పేజీలు', 'Pages')} className={cn(scroller, 'mt-2')}>
          {edition.pages.map((p) => {
            const current = open.includes(p.page_number);
            return (
              <Link
                key={p.id}
                to={href(p.page_number)}
                aria-current={current ? 'page' : undefined}
                className="flex shrink-0 flex-col items-center gap-1 rounded-xl p-1 transition-[colors,transform,box-shadow] duration-base ease-standard hover:bg-paper-sub"
              >
                <span className={cn('ep-thumb block border bg-paper', current ? 'border-brand ring-2 ring-brand/30' : 'border-rule')}>
                  <EpaperSheet page={p} edition={edition} mode="thumbnail" />
                </span>
                <span className={cn('font-sans text-meta tabular-nums', current ? 'font-bold text-brand' : 'text-muted')}>{p.page_number}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div role="tabpanel" aria-label={L('పేజీ క్లిప్‌లు', 'Page clips')} className={cn(scroller, 'mt-2')}>
          {page.articles.map((a) => (
            <Link
              key={a.id}
              to={clipHref(a)}
              className="block w-[200px] shrink-0 rounded-xl border border-rule bg-surface p-3 transition-[colors,transform,box-shadow] duration-base ease-standard hover:border-brand md:w-auto"
            >
              {a.category_name_te ? (
                <p lang="te" className="te text-meta font-semibold text-brand">
                  {a.category_name_te}
                </p>
              ) : null}
              <p lang="te" className="th text-headline-xs font-bold text-ink te-clamp-2">
                {a.title_te}
              </p>
              <Badge tone="muted" size="xs" lang={language} className="mt-2">
                {SIZE_LABEL[a.size][language]}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
