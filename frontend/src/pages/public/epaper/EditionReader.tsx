import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Maximize, Minimize, Minus, Plus, Share2 } from 'lucide-react';

import { ShareSheet } from '@/components/article/ShareSheet';
import { IconButton, IconButtonLink } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { useToast } from '@/components/ui/Toast';
import * as epaperApi from '@/features/epaper/api';
import { useI18n, useScript } from '@/i18n';
import type { EpaperEdition } from '@/types/epaper';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/time';

import { EpaperArchive } from './EpaperArchive';
import { EpaperRadio } from './EpaperRadio';
import { EpaperSheet } from './EpaperSheet';

/**
 * One edition, open at one page.
 *
 * The toolbar sticks under the site header (`top-header`) and owns everything
 * that acts on the sheet: back, paging, zoom, full screen, the PDF and the
 * share sheet. Zoom is a CSS `transform: scale()` on the sheet wrapper, so the
 * sheet keeps its own layout and the enclosing `overflow-auto` box becomes the
 * pan surface once it is bigger than the viewport. The horizontal swipe is
 * bound to that wrapper alone — never to the page — and it stands down while
 * the reader is zoomed in, where a drag means panning.
 */

const ZOOM = { min: 0.75, max: 1.6, step: 0.1 } as const;
const SWIPE_PX = 70;

export interface EditionReaderProps {
  edition: EpaperEdition;
  /** Set for a reader's own generated edition; changes routes, share and PDF. */
  personalId: number | null;
  /** `:page` route param, unparsed. */
  requestedPage: string | undefined;
}

export function EditionReader({ edition, personalId, requestedPage }: EditionReaderProps) {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const nav = useNavigate();
  const toast = useToast();
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pdfPending, setPdfPending] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const startX = useRef<number | null>(null);

  const requested = Math.max(1, Number(requestedPage || 1));
  const current = Math.min(requested, edition.page_count || 1);
  const page = edition.pages.find((p) => p.page_number === current) ?? edition.pages[0];

  useEffect(() => setZoom(1), [current]);

  // Esc and the browser's own control leave full screen too, so the button's
  // state comes from the document rather than from what it last did.
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    // iOS Safari and a restrictive permissions policy reject this; a refused
    // full screen is not worth an unhandled rejection.
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.();
    void request?.catch(() => {});
  };

  if (!page) return null;

  const href = (number: number) =>
    personalId ? `/my-epaper/edition/${personalId}/page/${number}` : `/epaper/${edition.edition_date}/page/${number}`;
  const go = (number: number) => nav(href(number));

  const shareTitle = `${edition.title} – ${t('epaper.page')} ${page.page_number}`;

  const openShare = () => {
    // The edition counts its own page shares; a personal edition is not public.
    if (!personalId) {
      void epaperApi.recordPageShare(edition.edition_date, page.page_number, 'sheet').catch(() => {});
    }
    setShareOpen(true);
  };

  const downloadPdf = async () => {
    if (!personalId) return;
    setPdfPending(true);
    try {
      await epaperApi.downloadMyEditionPdf(personalId, edition.edition_date);
      toast.success(t('ui.done'));
    } catch (error) {
      toast.error(error);
    } finally {
      setPdfPending(false);
    }
  };

  const pdfLabel = L('పీడీఎఫ్ డౌన్‌లోడ్', 'Download PDF');

  return (
    <>
      {/* The row bleeds across the container gutters so the sheet never scrolls past its edges. */}
      <header className="glass sticky top-header z-30 -mx-4 flex flex-wrap items-center gap-1 border-b border-rule px-4 py-2 md:-mx-6 md:px-6">
        <IconButtonLink icon={ArrowLeft} label={t('ui.back')} to="/" />
        <div className="mr-auto min-w-0">
          <h1 lang="te" className="th text-headline-sm font-extrabold te-clamp-1">
            {edition.title}
          </h1>
          <p className="font-sans text-meta text-muted">{formatDate(edition.edition_date, language)}</p>
        </div>

        <IconButton
          icon={ChevronLeft}
          label={L('మునుపటి పేజీ', 'Previous page')}
          disabled={current === 1}
          onClick={() => go(current - 1)}
        />
        <span aria-live="polite" className={cn(s.body, 'whitespace-nowrap px-1 text-center text-meta text-muted')}>
          {t('epaper.page')} <span className="font-sans tabular-nums">{current}</span> /{' '}
          <span className="font-sans tabular-nums">{edition.page_count}</span>
        </span>
        <IconButton
          icon={ChevronRight}
          label={L('తదుపరి పేజీ', 'Next page')}
          disabled={current === edition.page_count}
          onClick={() => go(current + 1)}
        />

        <IconButton
          icon={Minus}
          label={t('epaper.zoomOut')}
          disabled={zoom <= ZOOM.min}
          onClick={() => setZoom((z) => Math.max(ZOOM.min, z - ZOOM.step))}
        />
        <span aria-live="polite" className="min-w-10 text-center font-sans text-meta tabular-nums text-muted">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          icon={Plus}
          label={t('epaper.zoomIn')}
          disabled={zoom >= ZOOM.max}
          onClick={() => setZoom((z) => Math.min(ZOOM.max, z + ZOOM.step))}
        />

        {/* Full screen is a desktop affordance; phone browsers largely refuse it. */}
        <IconButton
          icon={fullscreen ? Minimize : Maximize}
          label={fullscreen ? L('పూర్తి స్క్రీన్ నుంచి బయటకు', 'Exit full screen') : L('పూర్తి స్క్రీన్', 'Full screen')}
          pressed={fullscreen}
          className="hidden sm:inline-flex"
          onClick={toggleFullscreen}
        />
        {personalId ? (
          <IconButton icon={Download} label={pdfLabel} pending={pdfPending} onClick={() => void downloadPdf()} />
        ) : (
          <IconButtonLink
            icon={Download}
            label={pdfLabel}
            to={`/api/v1/epaper/${edition.edition_date}/pdf`}
            external
            download
          />
        )}
        <IconButton icon={Share2} label={t('epaper.sharePage')} onClick={openShare} />
      </header>

      <ChipRail ariaLabel={t('epaper.page')} className="mt-3">
        {edition.pages.map((p) => (
          <Chip
            key={p.id}
            as="link"
            lang="en"
            to={href(p.page_number)}
            selected={p.page_number === current}
            className="tabular-nums"
          >
            {p.page_number}
          </Chip>
        ))}
      </ChipRail>

      {/* The scaled sheet overflows this box; `overflow-auto` turns that into panning. */}
      <div className="mt-4 overflow-auto py-1">
        <div
          className="origin-top-left transition-transform duration-base ease-standard"
          style={{ transform: `scale(${zoom})` }}
          onPointerDown={(e) => (startX.current = zoom === 1 ? e.clientX : null)}
          onPointerCancel={() => (startX.current = null)}
          onPointerUp={(e) => {
            if (startX.current === null) return;
            const d = e.clientX - startX.current;
            startX.current = null;
            if (Math.abs(d) <= SWIPE_PX) return;
            if (d < 0 && current < edition.page_count) go(current + 1);
            if (d > 0 && current > 1) go(current - 1);
          }}
        >
          <EpaperSheet page={page} />
        </div>
      </div>

      <EpaperRadio edition={edition} />

      {!personalId && <EpaperArchive current={edition.edition_date} />}

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shortId={page.articles[0]?.short_id ?? ''}
        // recordPageShare already counts this; the article beacon must not fire
        // for whichever story happens to sit first on the page.
        track={false}
        url={href(page.page_number)}
        title={shareTitle}
        cardAvailable={false}
      />
    </>
  );
}
