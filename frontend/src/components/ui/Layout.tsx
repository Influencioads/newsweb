import type { ElementType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, type LucideIcon } from 'lucide-react';

import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { Icon } from './Icon';

/**
 * PageContainer — the one horizontal measure. Centres content at a named width
 * with the site gutter (16px, 24px from md).
 *
 *     <PageContainer as="main" id="main" tabIndex={-1}>…</PageContainer>
 *     <PageContainer width="article">…</PageContainer>
 */
export interface PageContainerProps {
  /** site 1200 / page 960 / wrap 880 / article 680 / form 560. */
  width?: 'site' | 'page' | 'wrap' | 'article' | 'form';
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  id?: string;
  tabIndex?: number;
}

const WIDTH: Record<NonNullable<PageContainerProps['width']>, string> = {
  site: 'max-w-site',
  page: 'max-w-page',
  wrap: 'max-w-wrap',
  article: 'max-w-article',
  form: 'max-w-form',
};

export function PageContainer({
  width = 'site',
  as: Tag = 'div',
  className,
  children,
  id,
  tabIndex,
}: PageContainerProps) {
  return (
    <Tag id={id} tabIndex={tabIndex} className={cn('mx-auto w-full px-4 md:px-6', WIDTH[width], className)}>
      {children}
    </Tag>
  );
}

/**
 * PageHeader — the one page title block: eyebrow / h1 / subtitle, optional
 * icon, actions and a 44px back link. Carries the 40px rhythm below itself.
 *
 *     <PageHeader title={t('page.bookmarks')} icon={Bookmark} />
 *     <PageHeader eyebrow="Admin" title="Articles" titleLang="en" actions={<Button />}
 *                 back={{ to: '/admin', label: t('ui.back') }} />
 */
export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  back?: { to: string; label: string };
  /** Script of the title/eyebrow/subtitle; defaults to the interface language. */
  titleLang?: 'te' | 'en';
  className?: string;
}

export function PageHeader({ eyebrow, title, subtitle, icon, actions, back, titleLang, className }: PageHeaderProps) {
  const s = useScript();
  const lang = titleLang ?? s.language;
  const telugu = lang === 'te';
  return (
    <header className={cn('mb-8 md:mb-10', className)}>
      {back ? (
        <Link
          to={back.to}
          className={cn(
            s.body,
            '-ml-2 mb-2 inline-flex min-h-tap items-center gap-1 rounded-xl px-2 text-ui-sm font-semibold text-muted transition-[colors,transform,box-shadow] duration-base ease-standard hover:text-brand',
          )}
        >
          <Icon icon={ArrowLeft} size="sm" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className="mt-1 flex h-tap w-tap shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand">
              <Icon icon={icon} size="lg" />
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? (
              <p
                lang={lang}
                className={cn('mb-1 font-semibold text-brand', telugu ? 'te text-meta' : 'font-sans text-eyebrow uppercase')}
              >
                {eyebrow}
              </p>
            ) : null}
            <h1 lang={lang} className={cn(telugu ? 'th' : 'font-sans', 'text-headline-lg font-extrabold text-ink')}>
              {title}
            </h1>
            {subtitle ? (
              <p lang={lang} className={cn('mt-1 text-muted', telugu ? 'te text-te-body-sm' : 'font-sans text-ui')}>
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * SectionHeader — the one heading for a block of content on a page: title with
 * a brand rule (or an ink underline) and an optional "see all" link. Sits
 * `mb-4` above its section; the caller separates sections (mt-7 md:mt-10).
 *
 *     <SectionHeader title={pick(sec.title_te, sec.title_en)} to={`/section/${sec.key}`} />
 *     <SectionHeader title={t('ui.trending')} tone="ink" level={3} action={<Chip />} />
 */
export interface SectionHeaderProps {
  title: ReactNode;
  /** Renders a "see all" link (label defaults to `home.seeAll`). */
  to?: string;
  toLabel?: string;
  level?: 2 | 3;
  /** brand: brand-coloured title with a short bar; ink: ink title over an ink underline. */
  tone?: 'brand' | 'ink';
  className?: string;
  titleLang?: 'te' | 'en';
  /** Extra control (a Chip, a Tabs) at the trailing edge; replaces the link when both are given. */
  action?: ReactNode;
}

export function SectionHeader({
  title,
  to,
  toLabel,
  level = 2,
  tone = 'brand',
  className,
  titleLang,
  action,
}: SectionHeaderProps) {
  const { t } = useI18n();
  const s = useScript();
  const lang = titleLang ?? s.language;
  const Heading: ElementType = level === 3 ? 'h3' : 'h2';
  const trailing =
    action ??
    (to ? (
      <Link
        to={to}
        className={cn(
          s.body,
          'inline-flex min-h-tap shrink-0 items-center gap-0.5 rounded-xl text-ui-sm font-semibold text-brand underline-offset-4 hover:underline',
        )}
      >
        {toLabel ?? t('home.seeAll')}
        <Icon icon={ChevronRight} size="sm" />
      </Link>
    ) : null);

  return (
    <div
      className={cn(
        'mb-4 flex min-h-tap items-end justify-between gap-3',
        tone === 'ink' && 'border-b-2 border-ink pb-1',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading
          lang={lang}
          className={cn(
            lang === 'te' ? 'th' : 'font-sans',
            'text-headline-md font-extrabold',
            tone === 'brand' ? 'text-brand' : 'text-ink',
          )}
        >
          {title}
        </Heading>
        {tone === 'brand' ? <span aria-hidden className="mt-1 block h-1 w-10 rounded-pill bg-brand" /> : null}
      </div>
      {trailing}
    </div>
  );
}
