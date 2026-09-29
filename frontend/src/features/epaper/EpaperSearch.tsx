import { useEffect, useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/Field';
import { useI18n } from '@/i18n';
import type { EpaperArticle, EpaperEdition, EpaperPage } from '@/types/epaper';
import { cn } from '@/utils/cn';

/**
 * Search inside the open edition — client-side over the edition JSON the
 * reader already holds (headline, deck and body of every story on every
 * page); no request is made. Choosing a hit is the caller's: the reader goes
 * to that page and opens the story's clip.
 */

export interface SearchHit {
  article: EpaperArticle;
  page: EpaperPage;
  /** The matching text around the query. */
  snippet: string;
}

const SNIPPET_SPAN = 40;

function snippet(text: string, q: string): string {
  const at = text.toLowerCase().indexOf(q);
  const start = Math.max(0, at - SNIPPET_SPAN);
  const end = Math.min(text.length, at + q.length + SNIPPET_SPAN);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Stories whose headline, deck or body contains `query` (case-insensitive), in page order. */
export function searchEdition(edition: EpaperEdition, query: string, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const page of edition.pages) {
    for (const article of page.articles) {
      const field = [article.title_te, article.summary_te ?? '', ...(article.body ?? [])].find((f) => f.toLowerCase().includes(q));
      if (field === undefined) continue;
      hits.push({ article, page, snippet: snippet(field, q) });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

export interface EpaperSearchProps {
  edition: EpaperEdition;
  onPick: (hit: SearchHit) => void;
  /** Results in the flow (inside a sheet) instead of a popover under the box. */
  inline?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function EpaperSearch({ edition, onPick, inline = false, autoFocus, className }: EpaperSearchProps) {
  const { t, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [value, setValue] = useState('');
  const [q, setQ] = useState('');
  const listId = useId();

  // Debounced: the list follows the typing a beat behind, never per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(value.trim()), 250);
    return () => window.clearTimeout(id);
  }, [value]);

  const hits = useMemo(() => searchEdition(edition, q), [edition, q]);
  const label = L('ఎడిషన్‌లో వెతకండి', 'Search this edition');

  return (
    <div role="search" className={cn('relative', className)}>
      <Input
        type="search"
        leading={Search}
        script="te"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={label}
        aria-label={label}
        aria-controls={q ? listId : undefined}
        aria-expanded={q ? true : undefined}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {q ? (
        <div
          id={listId}
          className={cn(
            'mt-1 max-h-80 overflow-y-auto rounded-xl border border-rule bg-surface',
            !inline && 'absolute left-0 right-0 top-full z-30 min-w-80 shadow-raised',
          )}
        >
          {hits.length ? (
            <ul>
              {hits.map((hit) => (
                <li key={hit.article.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setValue('');
                      onPick(hit);
                    }}
                    className="flex min-h-tap w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors duration-base ease-standard hover:bg-paper-sub"
                  >
                    <span lang="te" className="th text-headline-xs font-bold text-ink te-clamp-2">
                      {hit.article.title_te}
                    </span>
                    <span className={cn(language === 'te' ? 'te' : 'font-sans', 'text-meta text-muted')}>
                      {hit.article.category_name_te ? (
                        <span lang="te" className="te">
                          {hit.article.category_name_te} ·{' '}
                        </span>
                      ) : null}
                      {t('epaper.page')} <span className="font-sans tabular-nums">{hit.page.page_number}</span>
                    </span>
                    <span lang="te" className="te text-meta text-ink-soft te-clamp-2">
                      {hit.snippet}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={cn(language === 'te' ? 'te' : 'font-sans', 'px-3 py-3 text-meta text-muted')}>{t('state.noResults')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
