import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import { EPAPER_PUBLIC } from '@/features/epaper/api';
import { VIDEOS_PUBLIC } from '@/features/public/api';
import { useI18n, useScript, type StringKey } from '@/i18n';
import { WOW_FEATURES } from '@/features/wow/categories';
import { cn } from '@/utils/cn';

import { ABOUT_LINK_COUNT, FOOTER_LINKS } from './NavDrawer';

/**
 * PolicyFooter — constant-dark footer: categories / product / compliance link
 * (one `nav` landmark: the twelve WOW categories as a band of icon chips, then
 * product, company and policies columns), then the wordmark and the
 * copyright line. Nothing here goes below `text-meta`.
 */

const PRODUCT_LINKS: readonly (readonly [string, StringKey])[] = ([
  ['/live-blog', 'ui.liveBlog'],
  ['/photos', 'ui.photos'],
  ['/videos', 'ui.videos'],
  ['/epaper', 'nav.epaper'],
  ['/my-epaper', 'page.myEpaper'],
] satisfies (readonly [string, StringKey])[]).filter(
  ([to]) => (EPAPER_PUBLIC || !to.includes('epaper')) && (VIDEOS_PUBLIC || to !== '/videos'),
);

const LINK =
  'flex min-h-tap items-center py-2 text-ui-sm text-muted-inverse ' +
  'transition-[colors,transform,box-shadow] duration-base ease-standard hover:text-on-ink';

function Column({
  title,
  children,
  className,
  listClassName,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  listClassName?: string;
}) {
  const s = useScript();
  return (
    <div className={cn('min-w-0', className)}>
      <h2 className={cn(s.head, 'mb-2 text-headline-xs font-bold text-on-ink')}>{title}</h2>
      <ul className={listClassName}>{children}</ul>
    </div>
  );
}

export function PolicyFooter() {
  const { t, pick } = useI18n();
  const s = useScript();

  return (
    <footer className="mt-10 bg-ink text-on-ink">
      <PageContainer width="site">
        {/* `ui.more`, not `ui.explore` — the header rail already owns that name. */}
        <nav aria-label={t('ui.more')} className="space-y-9 py-10">
          {/* All twelve WOW categories as a band of icon chips across the top. */}
          <section aria-labelledby="footer-sections">
            <h2 id="footer-sections" className={cn(s.head, 'mb-3 text-headline-xs font-bold text-on-ink')}>
              {t('ui.categories')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {WOW_FEATURES.map((f) => {
                const label = s.forText(f.te, f.en);
                return (
                  <li key={f.slug}>
                    <Link
                      to={f.to}
                      lang={label.lang}
                      className={cn(
                        label.cls,
                        'inline-flex min-h-tap items-center gap-2 rounded-pill border border-on-ink/15 bg-on-ink/5 py-1.5 pl-2 pr-3.5 text-ui-sm font-semibold text-on-ink/90',
                        'transition-colors duration-base ease-standard hover:border-hero hover:bg-hero hover:text-on-ink',
                      )}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-on-ink/10">
                        <Icon icon={f.icon} size="xs" />
                      </span>
                      {pick(f.te, f.en)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3">
            <Column title={t('ui.product')}>
              {PRODUCT_LINKS.map(([to, key]) => (
                <li key={to}>
                  <Link to={to} className={cn(s.body, LINK)}>
                    {t(key)}
                  </Link>
                </li>
              ))}
            </Column>
            <Column title={t('ui.aboutUs')}>
              {FOOTER_LINKS.slice(0, ABOUT_LINK_COUNT).map(([to, key]) => (
                <li key={to}>
                  <Link to={to} className={cn(s.body, LINK)}>
                    {t(key)}
                  </Link>
                </li>
              ))}
            </Column>
            <Column title={t('ui.compliance')}>
              {FOOTER_LINKS.slice(ABOUT_LINK_COUNT).map(([to, key]) => (
                <li key={to}>
                  <Link to={to} className={cn(s.body, LINK)}>
                    {t(key)}
                  </Link>
                </li>
              ))}
            </Column>
          </div>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-on-ink/10 py-6">
          <div className="flex flex-wrap items-center gap-3">
            <img
              src="/wow-indian-logo.webp"
              alt="వావ్ ఇండియన్"
              width={960}
              height={260}
              loading="lazy"
              className="h-10 w-auto"
            />
            <p lang="en" className="font-sans text-ui font-bold tracking-wide text-on-ink">
              Ordinary People. Extraordinary Stories.
            </p>
          </div>
          <p lang="en" className="font-sans text-meta text-muted-inverse">
            © {new Date().getFullYear()} WowIndian
          </p>
        </div>
      </PageContainer>
    </footer>
  );
}
