import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { Button, ButtonLink } from '@/components/ui/Button';
import { QueryState, SkeletonCard } from '@/components/ui/State';
import { EpaperSheet } from '@/features/epaper/EpaperSheet';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';
import { formatDate } from '@/utils/time';

import { useL } from './shared';

/**
 * Every sheet of an edition at canvas scale, one per printed page — the
 * browser's "Save as PDF" is how staff get a PDF today. The route sits
 * outside the CMS shell so nothing but the sheets reaches the printer; the
 * top bar hides itself when printing. `@page` is injected here rather than
 * in the global stylesheet so it cannot leak into printing any other page.
 */

const PRINT_CSS = `@page { size: 1200px 1860px; margin: 0; }
@media print { html, body { margin: 0; background: none; } }`;

export function EpaperPrintPage() {
  const { t, language } = useI18n();
  const L = useL();
  const { date = '' } = useParams();
  const edition = useQuery({ queryKey: ['admin-epaper', date], queryFn: () => api.fetchAdminEdition(date) });
  useDocumentTitle(edition.data ? `${edition.data.title} · ${L('ప్రింట్', 'Print')}` : t('admin.page.epaper'));

  return (
    <div className="min-h-screen bg-canvas-cms print:bg-transparent">
      <style>{PRINT_CSS}</style>
      <header className="glass sticky top-0 z-header flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2 md:px-6 print:hidden">
        <ButtonLink to={`/admin/epaper/${date}`} variant="ghost" size="sm" icon={ArrowLeft}>
          {L('వర్క్‌స్పేస్', 'Workspace')}
        </ButtonLink>
        <div className="mr-auto min-w-0">
          <h1 lang="te" className="th text-headline-sm font-extrabold te-clamp-1">
            {edition.data?.title ?? t('admin.page.epaper')}
          </h1>
          <p className="font-sans text-meta text-muted">{formatDate(date, language)}</p>
        </div>
        <Button icon={Printer} onClick={() => window.print()}>
          {L('ప్రింట్ / PDFగా సేవ్ చేయండి', 'Print / Save as PDF')}
        </Button>
      </header>
      <main id="main" tabIndex={-1} className="overflow-x-auto outline-none print:overflow-visible">
        <QueryState
          query={edition}
          skeleton={
            <div className="p-6">
              <SkeletonCard variant="lead" />
            </div>
          }
          isEmpty={(e) => !e.pages.length}
        >
          {(e) => (
            <>
              {e.pages.map((p, i) => (
                <div
                  key={p.id}
                  className={cn('mx-auto my-4 w-[1200px] print:my-0', i < e.pages.length - 1 && 'break-after-page')}
                >
                  <EpaperSheet page={p} edition={e} mode="print" />
                </div>
              ))}
            </>
          )}
        </QueryState>
      </main>
    </div>
  );
}
