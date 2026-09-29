import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  Download,
  Ellipsis,
  Maximize,
  Minimize,
  Minus,
  Plus,
  Share2,
  SquareDashedMousePointer,
} from 'lucide-react';

import { ShareSheet } from '@/components/article/ShareSheet';
import { Button, IconButton, IconButtonLink } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as epaperApi from '@/features/epaper/api';
import { EpaperClipDialog } from '@/features/epaper/EpaperClipDialog';
import { EpaperDatePicker } from '@/features/epaper/EpaperDatePicker';
import { EpaperRail } from '@/features/epaper/EpaperRail';
import { EpaperSearch, type SearchHit } from '@/features/epaper/EpaperSearch';
import { EpaperSheet } from '@/features/epaper/EpaperSheet';
import { EpaperSheetViewport, ZOOM } from '@/features/epaper/EpaperSheetViewport';
import { useI18n } from '@/i18n';
import type { EpaperArticle, EpaperEdition } from '@/types/epaper';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/time';

import { EpaperRadio } from './EpaperRadio';

/**
 * One edition, open at one page (two side by side in the spread) — the sheet
 * fitted whole into the viewport with the pages / clips rail on its left
 * (above it under md).
 *
 * The toolbar sticks under the site header (`top-header`) and owns everything
 * that acts on the sheet. From xl it is one row; from md the identity block
 * takes the first row and the controls the second (a `basis-full` break);
 * under md the second row is the compact set (prev, page box, next, zoom,
 * more) and the rest lives in the "more" sheet. Zoom multiplies the fitted
 * scale (1 = whole page, 4 = reading size on a phone); the viewport box is
 * the pan surface once the sheet outgrows it. The horizontal swipe is bound
 * to the sheet wrapper alone and stands down while zoomed in.
 *
 * `?clip=<short_id>` opens that story's clip dialog; closing it drops the
 * param with a replace, so Back leaves the reader rather than reopening it.
 * The spread pairs pages (1,2), (3,4)…; the URL keeps the requested page and
 * the view snaps to its pair.
 */

const SWIPE_PX = 70;
const CLIPS_KEY = 'tn.epaper.clips';
const SPREAD_KEY = 'tn.epaper.spread';
const LG = '(min-width: 1024px)';

// The reader's view choices survive paging; a storage exception must not break the reader.
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Private mode / quota: the choice simply does not persist.
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

/** The page-number box: Enter or blur goes to the typed page; out of range clamps and reverts. */
function PageBox({ current, total, onGo, label }: { current: number; total: number; onGo: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(current));
  useEffect(() => setDraft(String(current)), [current]);
  const commit = () => {
    const typed = Number(draft);
    // Blank or not a number reverts; anything else clamps into range (so "0" is page 1, "99" the last).
    const n = draft.trim() === '' || Number.isNaN(typed) ? current : Math.min(total, Math.max(1, Math.round(typed)));
    setDraft(String(n));
    if (n !== current) onGo(n);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    commit();
  };
  return (
    <span className="block w-16 shrink-0">
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={total}
        script="en"
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        className="text-center tabular-nums"
      />
    </span>
  );
}

export interface EditionReaderProps {
  edition: EpaperEdition;
  /** Set for a reader's own generated edition; changes routes, share and PDF. */
  personalId: number | null;
  /** `:page` route param, unparsed. */
  requestedPage: string | undefined;
}

export function EditionReader({ edition, personalId, requestedPage }: EditionReaderProps) {
  const { t, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const lg = useMediaQuery(LG);
  const [zoom, setZoom] = useState(1);
  const [showClips, setShowClips] = useState(() => readFlag(CLIPS_KEY, true));
  const [spread, setSpread] = useState(() => readFlag(SPREAD_KEY, false));
  const [fullscreen, setFullscreen] = useState(false);
  const [pdfPending, setPdfPending] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const startX = useRef<number | null>(null);

  const total = edition.page_count || 1;
  const requested = Math.max(1, Number(requestedPage || 1));
  const current = Math.min(requested, total);
  const page = edition.pages.find((p) => p.page_number === current) ?? edition.pages[0];

  // Two-up from lg only: pages (1,2), (3,4)…; the view snaps to the pair holding the requested page.
  const twoUp = spread && lg;
  const first = twoUp && current % 2 === 0 ? current - 1 : current;
  const openNumbers = twoUp ? [first, first + 1].filter((n) => n <= total) : [current];
  const sheets = openNumbers.map((n) => edition.pages.find((p) => p.page_number === n)).filter((p) => p !== undefined);
  const last = twoUp ? first + 1 : current;

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
  const go = (number: number) => nav(href(Math.min(total, Math.max(1, number))));
  const clipHref = (a: EpaperArticle, pageNumber: number) => `${href(pageNumber)}?clip=${a.short_id}`;

  const clipId = params.get('clip');
  const clip = clipId ? (sheets.flatMap((p) => p.articles.map((a) => ({ a, p }))).find((x) => x.a.short_id === clipId) ?? null) : null;
  const closeClip = () =>
    setParams(
      (next) => {
        next.delete('clip');
        return next;
      },
      { replace: true },
    );

  const toggleClips = () =>
    setShowClips((v) => {
      writeFlag(CLIPS_KEY, !v);
      return !v;
    });
  const toggleSpread = () =>
    setSpread((v) => {
      writeFlag(SPREAD_KEY, !v);
      return !v;
    });

  const pick = (hit: SearchHit) => {
    setMoreOpen(false);
    nav(clipHref(hit.article, hit.page.page_number));
  };

  const shareTitle = `${edition.title} – ${t('epaper.page')} ${page.page_number}`;

  const openShare = () => {
    setMoreOpen(false);
    // The edition counts its own page shares; a personal edition is not public.
    if (!personalId) {
      void epaperApi.recordPageShare(edition.edition_date, page.page_number, 'sheet').catch(() => {});
    }
    setShareOpen(true);
  };

  const downloadPdf = async () => {
    if (!personalId) return;
    setMoreOpen(false);
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
  const clipsLabel = showClips ? L('క్లిప్‌లు దాచండి', 'Hide clips') : L('క్లిప్‌లు చూపండి', 'Show clips');
  const spreadLabel = spread ? L('ఒక పేజీ', 'Single page') : L('రెండు పేజీలు', 'Two pages');
  const fullscreenLabel = fullscreen ? L('పూర్తి స్క్రీన్ నుంచి బయటకు', 'Exit full screen') : L('పూర్తి స్క్రీన్', 'Full screen');
  const fitLabel = L('పేజీ మొత్తం చూపండి', 'Fit the whole page');
  const mdOnly = 'hidden md:inline-flex';
  // What the sticky toolbar (two rows to xl, one from it) and the gaps take off the screen.
  const chrome = 'md:h-[calc(100vh-var(--header-h)-10.5rem)] xl:h-[calc(100vh-var(--header-h)-7.5rem)]';

  return (
    <>
      {/* The row bleeds across the container gutters so the sheet never scrolls past its edges. */}
      <header className="glass sticky top-header z-30 -mx-4 flex flex-wrap items-center gap-1 border-b border-rule px-4 py-2 md:-mx-6 md:px-6">
        <IconButtonLink icon={ArrowLeft} label={t('ui.back')} to="/" />
        {/* flex-1 (basis 0), not mr-auto: flex-wrap breaks lines on the max-content width, and a long title would drop under the back arrow. */}
        <div className="min-w-0 flex-1">
          <h1 lang="te" className="th text-headline-sm font-extrabold te-clamp-1">
            {edition.title}
          </h1>
          {personalId ? (
            <p className="font-sans text-meta text-muted">{formatDate(edition.edition_date, language)}</p>
          ) : (
            <EpaperDatePicker current={edition.edition_date} />
          )}
        </div>
        {/* Under md the overflow button rides beside the title; the compact row is exactly a phone wide without it. */}
        <IconButton icon={Ellipsis} label={L('మరిన్ని', 'More')} className="md:hidden" onClick={() => setMoreOpen(true)} />
        {/* Below xl the controls take their own row: seventeen of them beside the title need ~1150px. */}
        <div aria-hidden className="basis-full xl:hidden" />

        <EpaperSearch edition={edition} onPick={pick} className="hidden md:block md:w-56" />

        <IconButton icon={ChevronsLeft} label={L('మొదటి పేజీ', 'First page')} disabled={first === 1} className={mdOnly} onClick={() => go(1)} />
        <IconButton
          icon={ChevronLeft}
          label={L('మునుపటి పేజీ', 'Previous page')}
          disabled={first === 1}
          onClick={() => go(twoUp ? first - 1 : current - 1)}
        />
        <PageBox current={current} total={total} onGo={go} label={t('epaper.page')} />
        <span className="whitespace-nowrap font-sans text-meta tabular-nums text-muted">/ {total}</span>
        <span aria-live="polite" className="sr-only">
          {t('epaper.page')} {openNumbers.join('–')} / {total}
        </span>
        <IconButton
          icon={ChevronRight}
          label={L('తదుపరి పేజీ', 'Next page')}
          disabled={last >= total}
          onClick={() => go(twoUp ? first + 2 : current + 1)}
        />
        <IconButton icon={ChevronsRight} label={L('చివరి పేజీ', 'Last page')} disabled={last >= total} className={mdOnly} onClick={() => go(total)} />

        <span aria-hidden className="mx-1 hidden h-6 w-px bg-rule md:block" />

        <IconButton
          icon={Minus}
          label={t('epaper.zoomOut')}
          disabled={zoom <= ZOOM.min}
          onClick={() => setZoom((z) => Math.max(ZOOM.min, z - ZOOM.step))}
        />
        {/* The readout doubles as the fit reset. */}
        <Button variant="ghost" size="sm" aria-label={fitLabel} className="min-w-tap px-1 font-sans tabular-nums text-muted" onClick={() => setZoom(1)}>
          {zoom === 1 ? 'fit' : `${zoom}×`}
        </Button>
        <IconButton
          icon={Plus}
          label={t('epaper.zoomIn')}
          disabled={zoom >= ZOOM.max}
          onClick={() => setZoom((z) => Math.min(ZOOM.max, z + ZOOM.step))}
        />

        <IconButton icon={SquareDashedMousePointer} label={clipsLabel} pressed={showClips} className={mdOnly} onClick={toggleClips} />
        <IconButton icon={Columns2} label={spreadLabel} pressed={spread} className="hidden lg:inline-flex" onClick={toggleSpread} />
        {/* Full screen is a desktop affordance; phone browsers largely refuse it. */}
        <IconButton icon={fullscreen ? Minimize : Maximize} label={fullscreenLabel} pressed={fullscreen} className={mdOnly} onClick={toggleFullscreen} />
        {/* The public never gets a PDF; a reader's own edition still downloads as one. */}
        {personalId ? (
          <IconButton icon={Download} label={pdfLabel} pending={pdfPending} className={mdOnly} onClick={() => void downloadPdf()} />
        ) : null}
        <IconButton icon={Share2} label={t('epaper.sharePage')} className={mdOnly} onClick={openShare} />
      </header>

      <div className="mt-3 md:grid md:grid-cols-[208px_minmax(0,1fr)] md:items-start md:gap-4">
        <EpaperRail
          edition={edition}
          open={openNumbers}
          page={page}
          href={href}
          clipHref={(a) => clipHref(a, current)}
          className={cn('md:flex md:flex-col', chrome)}
        />
        <div
          className="mt-3 md:mt-0"
          onPointerDown={(e) => (startX.current = zoom === 1 ? e.clientX : null)}
          onPointerCancel={() => (startX.current = null)}
          onPointerUp={(e) => {
            if (startX.current === null) return;
            const d = e.clientX - startX.current;
            startX.current = null;
            if (Math.abs(d) <= SWIPE_PX) return;
            if (d < 0 && last < total) go(twoUp ? first + 2 : current + 1);
            if (d > 0 && first > 1) go(twoUp ? first - 1 : current - 1);
          }}
        >
          {/* A fixed-height box: the fit is measured from it, so it must not grow with the zoomed sheet. */}
          <EpaperSheetViewport zoom={zoom} columns={twoUp ? 2 : 1} className={cn('h-[65vh]', chrome)}>
            {sheets.map((p) => (
              <EpaperSheet key={p.id} page={p} edition={edition} clipHref={(a) => clipHref(a, p.page_number)} showClips={showClips} />
            ))}
          </EpaperSheetViewport>
        </div>
      </div>

      <EpaperRadio edition={edition} />

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

      <EpaperClipDialog
        open={clip !== null}
        onClose={closeClip}
        article={clip?.a ?? null}
        pageNumber={clip?.p.page_number ?? current}
        url={clip ? clipHref(clip.a, clip.p.page_number) : ''}
      />

      {/* Under md: everything the compact row leaves out. */}
      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title={L('మరిన్ని', 'More')}>
        <div className="flex flex-col gap-3">
          <EpaperSearch edition={edition} onPick={pick} inline autoFocus />
          <Button variant="secondary" size="lg" full icon={SquareDashedMousePointer} aria-pressed={showClips} onClick={toggleClips}>
            {clipsLabel}
          </Button>
          <Button variant="secondary" size="lg" full icon={fullscreen ? Minimize : Maximize} aria-pressed={fullscreen} onClick={toggleFullscreen}>
            {fullscreenLabel}
          </Button>
          {personalId ? (
            <Button variant="secondary" size="lg" full icon={Download} pending={pdfPending} onClick={() => void downloadPdf()}>
              {pdfLabel}
            </Button>
          ) : null}
          <Button variant="secondary" size="lg" full icon={Share2} onClick={openShare}>
            {t('epaper.sharePage')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
