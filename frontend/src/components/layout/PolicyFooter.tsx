import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import { EPAPER_PUBLIC } from '@/features/epaper/api';
import { VIDEOS_PUBLIC } from '@/features/public/api';
import { useI18n, useScript, type StringKey } from '@/i18n';
import { scriptOf, useLogoUrl, useSiteContent, useWowFeatures } from '@/features/wow/siteContent';
import { cn } from '@/utils/cn';

import { ABOUT_LINK_COUNT, FOOTER_LINKS } from './NavDrawer';

/**
 * PolicyFooter — the navy footer: categories / product / compliance links
 * (one `nav` landmark: the twelve WOW categories as an even grid of icon
 * chips, then product, company and policies columns on the same grid, so each
 * column starts under a chip column), then the wordmark and the copyright
 * line. Nothing here goes below `text-meta`.
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
  /** Blank: no heading. From md a same-height spacer keeps the links level with the other columns. */
  title?: string;
  children: ReactNode;
  className?: string;
  listClassName?: string;
}) {
  const s = useScript();
  return (
    <div className={cn('min-w-0', className)}>
      {title ? (
        <h2 className={cn(s.head, 'mb-2 text-headline-xs font-bold text-on-ink')}>{title}</h2>
      ) : (
        <span aria-hidden className={cn(s.head, 'mb-2 hidden text-headline-xs font-bold md:block')}>
          &nbsp;
        </span>
      )}
      <ul className={listClassName}>{children}</ul>
    </div>
  );
}

export function PolicyFooter() {
  const { t, pick } = useI18n();
  const s = useScript();
  const features = useWowFeatures().all;
  const logo = useLogoUrl();
  const { brand } = useSiteContent();
  const tagline = pick(brand.tagline_te, brand.tagline_en);
  const taglineScript = scriptOf(tagline);

  return (
    <footer className="relative isolate mt-10 overflow-hidden bg-footer text-on-ink">
      {/* The WOW Radio panel's look: deep blue with soft orange glows. */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 -z-10 h-80 w-80 rounded-full bg-wow/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 -z-10 h-80 w-80 rounded-full bg-wow/15 blur-3xl" />
      <PageContainer width="site">
        {/* `ui.more`, not `ui.explore` — the header rail already owns that name. */}
        <nav aria-label={t('ui.more')} className="space-y-9 py-10">
          {/* The WOW categories (Taxonomy → "WOW category") as an even grid of icon chips: 2, 4, then 7 across. */}
          <section aria-labelledby="footer-sections">
            <h2 id="footer-sections" className={cn(s.head, 'mb-3 text-headline-xs font-bold text-on-ink')}>
              {t('ui.categories')}
            </h2>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
              {features.map((f) => {
                const label = s.forText(f.te, f.en);
                return (
                  <li key={f.slug}>
                    <Link
                      to={f.to}
                      lang={label.lang}
                      className={cn(
                        label.cls,
                        'flex min-h-tap w-full min-w-0 items-center gap-2 rounded-pill border border-on-ink/20 bg-on-ink/10 py-1.5 pl-2 pr-3.5 text-ui-sm font-semibold text-on-ink',
                        'transition-colors duration-base ease-standard hover:border-wow-deep hover:bg-gradient-to-br hover:from-wow hover:to-wow-deep hover:text-on-wow',
                      )}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-on-ink/10">
                        <Icon icon={f.icon} size="xs" />
                      </span>
                      <span className="te-clamp-1 min-w-0">{pick(f.te, f.en)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Phones: one column, all on the left. From md: three columns, same gap as the chip grid. */}
          <div className="grid grid-cols-1 gap-x-3 gap-y-8 md:grid-cols-3">
            <Column title={t('ui.product')}>
              {PRODUCT_LINKS.map(([to, key]) => (
                <li key={to}>
                  <Link to={to} className={cn(s.body, LINK)}>
                    {t(key)}
                  </Link>
                </li>
              ))}
            </Column>
            {/* The About / Contact / policy links, without a "Company" heading. */}
            <Column className="-mt-6 md:mt-0">
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-on-ink/15 py-6">
          <div className="flex flex-wrap items-center gap-3">
            <img
              src={logo}
              alt="వావ్ ఇండియన్"
              width={960}
              height={260}
              loading="lazy"
              className="h-10 w-auto"
            />
            <p lang={taglineScript.lang} className={cn(taglineScript.cls, 'text-ui font-bold tracking-wide text-on-ink')}>
              {tagline}
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
