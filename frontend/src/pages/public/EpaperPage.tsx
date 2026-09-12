import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FastForward,
  Link2,
  Maximize,
  MessageCircle,
  Minus,
  Newspaper,
  Plus,
  Rewind,
  Send,
  Share2,
  SkipBack,
  SkipForward,
  Vote,
} from 'lucide-react';

import { ApiError } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink, IconButton, IconButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { Select } from '@/components/ui/Field';
import { PageContainer, SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, Skeleton, SkeletonCard } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as epaperApi from '@/features/epaper/api';
import { useI18n, useScript } from '@/i18n';
import type { EpaperArticle, EpaperEdition, EpaperPage as Page } from '@/types/epaper';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';
import { formatDate } from '@/utils/time';

/**
 * E-paper reader — a dated (or personal) edition laid out as a newspaper
 * sheet: sticky tool row (back · title · zoom · full screen · share · PDF),
 * page pager, the sheet itself (a horizontal swipe on it flips pages), the
 * "radio" player for the edition's audio tracks, share targets and the
 * archive rail. The sheet is always Telugu (`lang="te"`); the chrome follows
 * the interface language.
 */

const RATES = [1, 1.25, 1.5, 2] as const;
const ZOOM = { min: 0.75, max: 1.6, step: 0.1 } as const;

function Story({ article, lead = false }: { article: EpaperArticle; lead?: boolean }) {
  const { t } = useI18n();
  return (
    <article className={cn(lead ? 'md:col-span-2 md:row-span-2' : 'break-inside-avoid', 'border-b border-rule pb-3')}>
      {article.hero_url && (
        <img
          src={article.hero_url}
          alt=""
          className={cn('mb-2 w-full object-cover grayscale-[20%]', lead ? 'h-64' : 'h-32')}
        />
      )}
      {article.is_breaking && (
        <Badge tone="breaking" size="xs" className="mb-1">
          {t('ui.breaking')}
        </Badge>
      )}
      <h3 lang="te" className={cn('th font-extrabold', lead ? 'text-headline-lg' : 'text-headline-sm')}>
        <Link to={article.url} className="block min-h-tap hover:text-brand">
          {article.title_te}
        </Link>
      </h3>
      {article.summary_te && (
        <p lang="te" className="te mt-1 text-te-body-xs text-ink-soft">
          {article.summary_te}
        </p>
      )}
    </article>
  );
}

function Sheet({ page, zoom }: { page: Page; zoom: number }) {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const columns = page.layout_type === 'three_column' ? 'md:grid-cols-3' : 'md:grid-cols-2';
  return (
    <article
      lang="te"
      className="mx-auto min-h-[78vh] w-full max-w-page origin-top rounded-xl bg-paper p-5 shadow-raised sm:p-8"
      style={{ transform: `scale(${zoom})`, marginBottom: `${(zoom - 1) * 78}vh` }}
    >
      <header className="mb-5 border-y-[3px] border-ink py-3 text-center">
        <p lang="en" className="font-sans text-eyebrow font-bold uppercase text-muted">
          Top Telugu News · Digital Edition
        </p>
        <h2 className="th text-headline-xl font-extrabold">{page.title}</h2>
        <p className="font-sans text-meta text-muted">
          {t('epaper.page')} {page.page_number}
        </p>
      </header>
      <div className={cn('grid grid-cols-1 gap-5', columns)}>
        {page.articles.map((a, i) => (
          <Story key={a.id} article={a} lead={i === 0} />
        ))}
      </div>
      {!page.articles.length && (
        <EmptyState compact icon={Newspaper} title={L('ఈ పేజీలో కథనాలు లేవు.', 'No stories on this page.')} />
      )}
      {page.poll_id && (
        <ButtonLink
          to={`/polls/${page.poll_id}`}
          variant="secondary"
          size="lg"
          full
          icon={Vote}
          iconRight={ChevronRight}
          className="mt-6 border-brand bg-brand-tint text-brand"
        >
          {L('బిగ్ క్వశ్చన్ · ఇప్పుడే ఓటు వేయండి', 'Big question · Vote now')}
        </ButtonLink>
      )}
    </article>
  );
}

/** The edition's audio tracks played back to back, with skip / seek / speed. */
function Radio({ edition }: { edition: EpaperEdition }) {
  const { t, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const audio = useQuery({
    queryKey: ['epaper-audio', edition.edition_date],
    queryFn: () => epaperApi.fetchEpaperAudio(edition.edition_date),
    enabled: edition.audio_enabled,
  });
  const [track, setTrack] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const player = useRef<HTMLAudioElement>(null);
  const tracks = audio.data?.tracks ?? [];
  const now = tracks[track];

  // A new src resets nothing on the element, but keep the rate authoritative.
  useEffect(() => {
    if (player.current) player.current.playbackRate = rate;
  }, [rate, track]);

  const seek = (delta: number) => {
    const el = player.current;
    if (el) el.currentTime = Math.max(0, el.currentTime + delta);
  };

  return (
    <Card as="section" className="mt-7 md:mt-10">
      <SectionHeader title={t('epaper.listen')} />
      {edition.audio_enabled && audio.isLoading ? (
        <Skeleton variant="block" />
      ) : now ? (
        <>
          <audio
            ref={player}
            controls
            className="w-full"
            src={now.url}
            onEnded={() => setTrack((i) => Math.min(tracks.length - 1, i + 1))}
          />
          <p className={cn(s.body, 'mt-2 text-ui-sm text-muted')}>
            {L('ఇప్పుడు వినిపిస్తోంది', 'Now playing')}:{' '}
            <span lang="te" className="te font-semibold text-ink">
              {now.title_te}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <IconButton
              icon={SkipBack}
              label={t('ui.previous')}
              variant="secondary"
              disabled={track === 0}
              onClick={() => setTrack((i) => Math.max(0, i - 1))}
            />
            <IconButton
              icon={Rewind}
              label={L('10 సెకన్లు వెనక్కి', 'Back 10 seconds')}
              variant="secondary"
              onClick={() => seek(-10)}
            />
            <IconButton
              icon={FastForward}
              label={L('10 సెకన్లు ముందుకు', 'Forward 10 seconds')}
              variant="secondary"
              onClick={() => seek(10)}
            />
            <IconButton
              icon={SkipForward}
              label={t('ui.next')}
              variant="secondary"
              disabled={track === tracks.length - 1}
              onClick={() => setTrack((i) => Math.min(tracks.length - 1, i + 1))}
            />
            <div role="group" aria-label={t('ui.speed')} className="ml-auto flex items-center gap-1">
              {RATES.map((r) => (
                <Chip key={r} as="button" lang="en" selected={rate === r} onClick={() => setRate(r)} className="tabular-nums">
                  {r}×
                </Chip>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className={cn(s.body, 'text-ui-sm text-muted')}>
          {L('ఈ ఎడిషన్‌కు ఆడియో అందుబాటులో లేదు.', 'Audio is unavailable for this edition.')}
        </p>
      )}
    </Card>
  );
}

function Archive() {
  const { t } = useI18n();
  const archive = useQuery({ queryKey: ['epaper-archive'], queryFn: epaperApi.fetchEpaperArchive });
  return (
    <section className="mt-7 md:mt-10">
      <SectionHeader title={t('epaper.archive')} />
      <QueryState query={archive} compact skeleton={<SkeletonCard variant="row" />} isEmpty={(d) => !d.items.length}>
        {(d) => (
          <ChipRail ariaLabel={t('epaper.archive')}>
            {d.items.map((e) => (
              <Chip key={e.id} as="link" to={`/epaper/${e.edition_date}`} className="tabular-nums">
                {e.edition_date} · {e.page_count} {t('ui.pages')}
              </Chip>
            ))}
          </ChipRail>
        )}
      </QueryState>
    </section>
  );
}

interface EditionProps {
  edition: EpaperEdition;
  personalId: number | null;
  /** `:page` route param, unparsed. */
  requestedPage: string | undefined;
}

function Edition({ edition, personalId, requestedPage }: EditionProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const nav = useNavigate();
  const toast = useToast();
  const [zoom, setZoom] = useState(1);
  const [pdfPending, setPdfPending] = useState(false);
  const startX = useRef<number | null>(null);

  const requested = Math.max(1, Number(requestedPage || 1));
  const current = Math.min(requested, edition.page_count || 1);
  const page = edition.pages.find((p) => p.page_number === current) ?? edition.pages[0];

  useEffect(() => setZoom(1), [current]);

  if (!page) return null;

  const go = (number: number) =>
    nav(personalId ? `/my-epaper/edition/${personalId}/page/${number}` : `/epaper/${edition.edition_date}/page/${number}`);

  const share = async (channel = 'native') => {
    const url = personalId
      ? `${location.origin}/my-epaper/edition/${personalId}/page/${page.page_number}`
      : page.share_url;
    const text = `${edition.title} – ${t('epaper.page')} ${page.page_number}`;
    if (!personalId) void epaperApi.recordPageShare(edition.edition_date, page.page_number, channel);
    try {
      if (channel === 'native' && navigator.share) {
        await navigator.share({ title: text, text, url });
        return;
      }
      if (channel === 'copy') {
        await navigator.clipboard.writeText(url);
        toast.success(t('ui.copied'));
        return;
      }
    } catch (error) {
      // A dismissed native sheet throws AbortError; that is not a failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error(error);
      return;
    }
    const targets: Record<string, string> = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    };
    window.open(targets[channel], '_blank', 'noopener,noreferrer');
  };

  const downloadPdf = async () => {
    if (!personalId) return;
    setPdfPending(true);
    try {
      await epaperApi.downloadMyEditionPdf(personalId, edition.edition_date);
    } catch (error) {
      toast.error(error);
    } finally {
      setPdfPending(false);
    }
  };

  return (
    <>
      {/* Tool row bleeds across the container gutters so the sheet never scrolls past its edges. */}
      <header className="glass sticky top-header z-30 -mx-4 flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2 md:-mx-6 md:px-6">
        <IconButtonLink icon={ArrowLeft} label={t('ui.back')} to="/" />
        <div className="mr-auto min-w-0">
          <h1 lang="te" className="th text-headline-sm font-extrabold te-clamp-1">
            {edition.title}
          </h1>
          <p className="font-sans text-meta text-muted">{formatDate(edition.edition_date, language)}</p>
        </div>
        <IconButton
          icon={Minus}
          label={t('epaper.zoomOut')}
          variant="secondary"
          disabled={zoom <= ZOOM.min}
          onClick={() => setZoom((z) => Math.max(ZOOM.min, z - ZOOM.step))}
        />
        <span aria-live="polite" className="min-w-10 text-center font-sans text-meta tabular-nums text-muted">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          icon={Plus}
          label={t('epaper.zoomIn')}
          variant="secondary"
          disabled={zoom >= ZOOM.max}
          onClick={() => setZoom((z) => Math.min(ZOOM.max, z + ZOOM.step))}
        />
        <IconButton
          icon={Maximize}
          label={L('పూర్తి స్క్రీన్', 'Full screen')}
          variant="secondary"
          onClick={() => void document.documentElement.requestFullscreen?.()}
        />
        <Button variant="secondary" size="sm" icon={Share2} onClick={() => void share()}>
          {t('epaper.sharePage')}
        </Button>
        {personalId ? (
          <Button size="sm" icon={Download} pending={pdfPending} onClick={() => void downloadPdf()}>
            {L('పీడీఎఫ్', 'PDF')}
          </Button>
        ) : (
          <ButtonLink size="sm" icon={Download} to={`/api/v1/epaper/${edition.edition_date}/pdf`} external download>
            {L('పీడీఎఫ్', 'PDF')}
          </ButtonLink>
        )}
      </header>

      <nav aria-label={t('epaper.page')} className="my-3 flex items-center justify-between gap-3">
        <IconButton
          icon={ChevronLeft}
          label={t('ui.previous')}
          variant="secondary"
          disabled={current === 1}
          onClick={() => go(current - 1)}
        />
        <div className="flex items-center gap-2 text-ui-sm font-semibold">
          <span className={s.body}>{t('epaper.page')}</span>
          {/* Select fills its parent; the span gives it a width inside the flex row. */}
          <span className="w-44">
            <Select aria-label={t('epaper.page')} value={current} onChange={(e) => go(Number(e.target.value))}>
              {edition.pages.map((p) => (
                <option key={p.id} value={p.page_number}>
                  {p.page_number} · {p.title}
                </option>
              ))}
            </Select>
          </span>
          <span className="font-sans tabular-nums">/ {edition.page_count}</span>
        </div>
        <IconButton
          icon={ChevronRight}
          label={t('ui.next')}
          variant="secondary"
          disabled={current === edition.page_count}
          onClick={() => go(current + 1)}
        />
      </nav>

      {/* Swipe on the sheet flips pages; the handlers stay off the chrome around it. */}
      <div
        className="overflow-auto"
        onPointerDown={(e) => (startX.current = e.clientX)}
        onPointerUp={(e) => {
          if (startX.current === null) return;
          const d = e.clientX - startX.current;
          if (Math.abs(d) > 70) {
            if (d < 0 && current < edition.page_count) go(current + 1);
            if (d > 0 && current > 1) go(current - 1);
          }
          startX.current = null;
        }}
      >
        <Sheet page={page} zoom={zoom} />
      </div>

      <Radio edition={edition} />

      <div role="group" aria-label={t('epaper.sharePage')} className="mt-7 flex flex-wrap gap-2 md:mt-10">
        <Button variant="secondary" icon={MessageCircle} onClick={() => void share('whatsapp')}>
          {t('ui.whatsapp')}
        </Button>
        <Button variant="secondary" onClick={() => void share('facebook')}>
          Facebook
        </Button>
        <Button variant="secondary" onClick={() => void share('x')}>
          X
        </Button>
        <Button variant="secondary" icon={Send} onClick={() => void share('telegram')}>
          Telegram
        </Button>
        <Button variant="secondary" icon={Link2} onClick={() => void share('copy')}>
          {t('ui.copyLink')}
        </Button>
      </div>

      {!personalId && <Archive />}
    </>
  );
}

export default function EpaperPage() {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const params = useParams();
  const personalId = params.personalId ? Number(params.personalId) : null;
  const query = useQuery({
    queryKey: ['epaper', personalId ? `personal-${personalId}` : params.date || 'today'],
    queryFn: async (): Promise<EpaperEdition | null> => {
      try {
        if (personalId) return await epaperApi.fetchMyGeneratedEdition(personalId);
        return await (params.date ? epaperApi.fetchEpaper(params.date) : epaperApi.fetchTodayEpaper());
      } catch (error) {
        // No edition for that day is the empty state, not a failure to retry.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  useDocumentTitle(query.data?.title ?? t('page.epaper'));

  return (
    <PageContainer width="page" className="pb-12">
      <QueryState
        query={query}
        skeleton={
          <div className="py-4">
            <SkeletonCard variant="lead" />
          </div>
        }
        isEmpty={(edition) => !edition?.pages.length}
        empty={
          <EmptyState
            icon={Newspaper}
            headingLevel={1}
            className="py-8 md:py-12"
            title={L('ప్రచురించిన ఎడిషన్ ఇంకా అందుబాటులో లేదు.', 'No published edition is available yet.')}
            action={
              <ButtonLink to="/" variant="secondary" icon={ArrowLeft}>
                {L('వార్తలకు తిరిగి వెళ్లండి', 'Back to news')}
              </ButtonLink>
            }
          />
        }
      >
        {(edition) => edition && <Edition edition={edition} personalId={personalId} requestedPage={params.page} />}
      </QueryState>
    </PageContainer>
  );
}
