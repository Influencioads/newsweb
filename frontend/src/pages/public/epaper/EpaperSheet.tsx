import { ChevronRight, Newspaper, Vote } from 'lucide-react';
import { Link } from 'react-router-dom';

import { NewsImage } from '@/components/media/NewsImage';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/State';
import { useI18n } from '@/i18n';
import type { EpaperArticle, EpaperPage } from '@/types/epaper';
import type { MediaOut } from '@/types/public';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

/**
 * The printed sheet — one e-paper page drawn as a newspaper front: masthead
 * rule, page title, then the page's stories in two or three columns. The whole
 * sheet is Telugu (`lang="te"`); every story headline is a hotspot into the
 * full article, and the page's "big question" poll is one at the foot.
 *
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

function Story({ article, lead = false }: { article: EpaperArticle; lead?: boolean }) {
  const { t } = useI18n();
  const reveal = useReveal<HTMLElement>();
  return (
    <article
      ref={reveal}
      className={cn(lead ? 'md:col-span-2 md:row-span-2' : 'break-inside-avoid', 'border-b border-rule pb-3')}
    >
      {article.hero_url && (
        <NewsImage
          media={heroMedia(article.hero_url)}
          ratio={lead ? '16/9' : '4/3'}
          sizes={lead ? '(min-width: 768px) 620px, 100vw' : '(min-width: 768px) 300px, 100vw'}
          className="mb-2 grayscale-[20%]"
        />
      )}
      {article.is_breaking && (
        <Badge tone="breaking" size="xs" className="mb-1">
          {t('ui.breaking')}
        </Badge>
      )}
      <h3 lang="te" className={cn('th font-extrabold', lead ? 'text-headline-lg' : 'text-headline-sm')}>
        <Link
          to={article.url}
          className="block min-h-tap transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand"
        >
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

export function EpaperSheet({ page }: { page: EpaperPage }) {
  const { t, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const columns = page.layout_type === 'three_column' ? 'md:grid-cols-3' : 'md:grid-cols-2';
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
          variant="primary"
          size="lg"
          full
          icon={Vote}
          iconRight={ChevronRight}
          className="mt-6"
        >
          {L('బిగ్ క్వశ్చన్ · ఇప్పుడే ఓటు వేయండి', 'Big question · Vote now')}
        </ButtonLink>
      )}
    </Card>
  );
}
