import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ImageOff, Plus, Search, SearchX } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';
import type { EpaperCandidate, EpaperPage } from '@/types/epaper';
import { cn } from '@/utils/cn';

import { SIZE_LABEL, SIZE_TONE, useL } from './shared';

/**
 * The stories that could still go on the selected page — the server's ranked
 * pool minus everything already placed in the edition, the page's own
 * categories first. One click puts a story in the targeted slot, or the first
 * slot it fits.
 */
export interface EpaperCandidatesProps {
  editionId: number;
  page: EpaperPage;
  /** Slot the next add goes to; `null` = first fit. */
  targetSlot: number | null;
  /** Ids already on this page — a stale list must not offer them twice. */
  placedIds: (number | null)[];
  placing: boolean;
  onAdd: (candidate: EpaperCandidate) => void;
}

export function EpaperCandidates({ editionId, page, targetSlot, placedIds, placing, onAdd }: EpaperCandidatesProps) {
  const { t, language } = useI18n();
  const L = useL();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  // Debounce typing into the query; the previous list stays up while the next one loads.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const candidates = useQuery({
    queryKey: ['admin-epaper', editionId, 'candidates', { page_id: page.id, q }],
    queryFn: () => api.fetchCandidates(editionId, { page_id: page.id, q: q || undefined, limit: 50 }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card as="section" aria-label={L('సరిపోయే కథనాలు', 'Stories that fit')} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 lang={language} className={cn(language === 'te' ? 'th' : 'font-serif', 'text-headline-xs font-bold text-ink')}>
          {L('సరిపోయే కథనాలు', 'Stories that fit')}
        </h2>
        <Badge tone={targetSlot == null ? 'muted' : 'brand'} size="xs" lang={language}>
          {targetSlot == null ? L('మొదటి ఖాళీ స్లాట్', 'First fit') : `→ ${L('స్లాట్', 'slot')} ${targetSlot + 1}`}
        </Badge>
      </div>
      <Input
        leading={Search}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('ui.search')}
        aria-label={t('ui.search')}
      />
      <QueryState
        query={candidates}
        isEmpty={(d) => d.items.length === 0}
        skeleton={
          <div className="flex flex-col gap-3">
            <SkeletonCard variant="row" />
            <SkeletonCard variant="row" />
            <SkeletonCard variant="row" />
          </div>
        }
        empty={
          <EmptyState
            compact
            icon={SearchX}
            title={q ? t('state.noResults') : L('ఉంచడానికి కథనాలు మిగల్లేదు', 'No unplaced stories left')}
          />
        }
      >
        {(data) => (
          <ul className="flex flex-col divide-y divide-rule-soft">
            {data.items.map((c) => {
              const onPage = placedIds.includes(c.id);
              return (
                <li key={c.id} className="flex items-start gap-3 py-3">
                  {c.hero_url ? (
                    <img src={c.hero_url} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl bg-placeholder object-cover" />
                  ) : (
                    <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-placeholder text-placeholder-text">
                      <Icon icon={ImageOff} size="sm" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p lang="te" className="th text-headline-xs font-bold text-ink te-clamp-2">
                      {c.title_te}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {c.category_name_te ? (
                        <Badge tone="district" size="xs" lang="te">
                          {c.category_name_te}
                        </Badge>
                      ) : null}
                      <Badge tone={SIZE_TONE[c.size]} size="xs" lang={language}>
                        {SIZE_LABEL[c.size][language]}
                      </Badge>
                      <span className="font-sans text-meta tabular-nums text-muted">
                        {c.word_count} {L('పదాలు', 'words')}
                      </span>
                      {c.is_breaking ? (
                        <Badge tone="breaking" size="xs">
                          {t('ui.breaking')}
                        </Badge>
                      ) : null}
                      {c.in_section ? (
                        <Badge tone="success" size="xs" lang={language}>
                          {L('ఈ విభాగం', 'This section')}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <IconButton
                    icon={Plus}
                    label={onPage ? L('ఇప్పటికే ఈ పేజీలో ఉంది', 'Already on this page') : `${t('ui.add')}: ${c.title_te}`}
                    variant="secondary"
                    disabled={placing || onPage}
                    onClick={() => onAdd(c)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}
