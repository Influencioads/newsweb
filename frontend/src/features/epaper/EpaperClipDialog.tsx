import { useState } from 'react';
import { ArrowRight, Share2 } from 'lucide-react';

import { ShareSheet } from '@/components/article/ShareSheet';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useI18n } from '@/i18n';
import type { EpaperArticle } from '@/types/epaper';
import { cn } from '@/utils/cn';

/**
 * One story lifted off the sheet — the "clip": the same typesetting at
 * reading size, a link to the full article, and a share sheet whose URL is
 * the reader page with `?clip=` so the recipient lands on this very clip.
 */
export interface EpaperClipDialogProps {
  open: boolean;
  onClose: () => void;
  article: EpaperArticle | null;
  pageNumber: number;
  /** The reader page URL including `?clip=<short_id>` — what gets shared. */
  url: string;
}

export function EpaperClipDialog({ open, onClose, article, pageNumber, url }: EpaperClipDialogProps) {
  const { t, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [shareOpen, setShareOpen] = useState(false);
  if (!article) return null;

  const byline = [article.byline_te, article.dateline_te].filter(Boolean).join(' · ');
  const paragraphs = article.body ?? [];

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="lg"
        title={
          <span lang="te" className="th">
            {article.title_te}
          </span>
        }
        footer={
          <>
            <span className={cn(language === 'te' ? 'te' : 'font-sans', 'mr-auto self-center text-meta text-muted')}>
              {t('epaper.page')} <span className="font-sans tabular-nums">{pageNumber}</span>
            </span>
            <Button variant="secondary" icon={Share2} onClick={() => setShareOpen(true)}>
              {t('ui.share')}
            </Button>
            <ButtonLink to={article.url} iconRight={ArrowRight}>
              {L('పూర్తి కథనం చదవండి', 'Read the full story')}
            </ButtonLink>
          </>
        }
      >
        <div lang="te" className="te text-ink">
          {article.category_name_te ? <p className="text-meta font-bold text-brand">{article.category_name_te}</p> : null}
          {byline ? <p className="mt-1 text-meta text-muted">{byline}</p> : null}
          {article.hero_url ? (
            <figure className="mt-3">
              <div className="overflow-hidden rounded-xl bg-placeholder" style={{ aspectRatio: '16/9' }}>
                <img src={article.hero_url} alt={article.hero_caption_te ?? ''} className="h-full w-full object-cover" />
              </div>
              {article.hero_caption_te || article.hero_credit ? (
                <figcaption className="mt-1.5 text-meta text-muted">
                  {article.hero_caption_te}
                  {article.hero_credit ? <span className={cn(article.hero_caption_te && 'ml-1')}>{article.hero_credit}</span> : null}
                </figcaption>
              ) : null}
            </figure>
          ) : null}
          {article.summary_te ? <p className="mt-3 text-te-body-sm font-semibold text-ink-soft">{article.summary_te}</p> : null}
          {paragraphs.length ? (
            <div className="mt-3 text-justify text-te-body-sm md:columns-2 md:gap-6">
              {paragraphs.map((text, i) => (
                <p key={i} className="indent-3">
                  {text}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </Dialog>
      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shortId={article.short_id}
        url={url}
        title={article.title_te}
        track
        cardAvailable={false}
      />
    </>
  );
}
