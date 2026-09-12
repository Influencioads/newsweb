import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { PageContainer } from '@/components/ui/Layout';
import { useI18n, useScript, type StringKey } from '@/i18n';
import { cn } from '@/utils/cn';

import { FOOTER_LINKS, useSiteConfig } from './NavDrawer';

/**
 * PolicyFooter — constant-dark footer: sections / product / compliance link
 * columns (one `nav` landmark, three headed lists), then the wordmark and the
 * copyright line. Nothing here goes below `text-meta`.
 */

const PRODUCT_LINKS: readonly (readonly [string, StringKey])[] = [
  ['/live-blog', 'ui.liveBlog'],
  ['/photos', 'ui.photos'],
  ['/videos', 'ui.videos'],
  ['/web-stories', 'ui.webStories'],
  ['/epaper', 'nav.epaper'],
  ['/short-news', 'page.shortNews'],
  ['/my-epaper', 'page.myEpaper'],
];

const LINK =
  'flex min-h-tap items-center py-2 text-ui-sm text-muted-inverse ' +
  'transition-[colors,transform,box-shadow] duration-base ease-standard hover:text-on-ink';

function Column({ title, children }: { title: string; children: ReactNode }) {
  const s = useScript();
  return (
    <div>
      <h2 className={cn(s.head, 'mb-2 text-headline-xs font-bold text-on-ink')}>{title}</h2>
      <ul>{children}</ul>
    </div>
  );
}

export function PolicyFooter() {
  const { t, pick } = useI18n();
  const s = useScript();
  const { data: config } = useSiteConfig();
  const categories = config?.categories.filter((c) => c.show_in_nav) ?? [];

  return (
    <footer className="mt-10 bg-ink text-on-ink">
      <PageContainer width="site">
        {/* `ui.more`, not `ui.explore` — the header rail already owns that name. */}
        <nav aria-label={t('ui.more')} className="grid gap-8 py-10 md:grid-cols-3">
          <Column title={t('ui.sections')}>
            {categories.map((c) => {
              const f = s.forText(c.name_te, c.name_en);
              return (
                <li key={c.slug}>
                  <Link to={`/section/${c.slug}`} lang={f.lang} className={cn(f.cls, LINK)}>
                    {pick(c.name_te, c.name_en)}
                  </Link>
                </li>
              );
            })}
          </Column>
          <Column title={t('ui.product')}>
            {PRODUCT_LINKS.map(([to, key]) => (
              <li key={to}>
                <Link to={to} className={cn(s.body, LINK)}>
                  {t(key)}
                </Link>
              </li>
            ))}
          </Column>
          <Column title={t('ui.compliance')}>
            {FOOTER_LINKS.map(([to, key]) => (
              <li key={to}>
                <Link to={to} className={cn(s.body, LINK)}>
                  {t(key)}
                </Link>
              </li>
            ))}
          </Column>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-on-ink/10 py-6">
          <span lang="te" className="th text-headline-xs font-bold text-on-ink">
            టాప్ తెలుగు న్యూస్
          </span>
          <p lang="en" className="font-sans text-meta text-muted-inverse">
            © {new Date().getFullYear()} Top Telugu News
          </p>
        </div>
      </PageContainer>
    </footer>
  );
}
