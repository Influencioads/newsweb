import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Mail, ScrollText } from 'lucide-react';

import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useSiteContent } from '@/features/wow/siteContent';
import { useI18n, useScript, type Language } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import { LAST_UPDATED, PAGES } from './policyContent';

/**
 * Static compliance pages (§12.5).
 *
 * IT Rules 2021 Part III and Google News trust signals both require these live
 * at launch. Bilingual because a compliance page a reader cannot read is not
 * compliance — the Grievance Officer route in particular has to be legible to
 * whoever needs to use it.
 *
 * The copy is edited in CMS → Footer pages: a saved page replaces the
 * original copy (./policyContent) here, and the grievance address on every
 * page comes from CMS → Site content → Contact.
 *
 * Each route is its own path (`/privacy`, `/terms`, …) rather than one
 * `/:slug`, so the key comes from `pathname`. Reading `useParams().slug` here
 * always returned undefined — every policy page rendered "not found".
 */

/** `2026-01-15` in the reader's language, without pulling in a date library. */
function formatUpdated(iso: string, language: Language): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(language === 'te' ? 'te-IN' : 'en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function PolicyPage() {
  const { pathname } = useLocation();
  const { language, t } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const slug = pathname.replace(/^\/+|\/+$/g, '');
  const entry = PAGES[slug];
  const { contact } = useSiteContent();
  // A page saved in the CMS wins; until it loads (or if there is none) the original copy shows.
  const saved = useQuery({
    queryKey: ['public', 'page', slug],
    queryFn: () => publicApi.fetchSitePage(slug),
    enabled: Boolean(entry),
    staleTime: 60_000,
  });

  useDocumentTitle(entry ? saved.data?.[language].title ?? t(entry.titleKey) : t('page.notFound'));

  if (!entry) {
    return (
      <PageContainer width="article" className="py-7 md:py-10">
        <EmptyState
          icon={ScrollText}
          headingLevel={1}
          title={t('state.notFound')}
          body={t('state.notFoundBody')}
          action={
            <ButtonLink to="/" variant="secondary">
              {t('page.home')}
            </ButtonLink>
          }
        />
      </PageContainer>
    );
  }

  const page = saved.data?.[language] ?? entry[language];
  const updated = saved.data?.updated_at?.slice(0, 10) ?? LAST_UPDATED;
  const telugu = language === 'te';

  return (
    <PageContainer width="article" className="py-7 md:py-10">
      <PageHeader
        eyebrow={t('ui.compliance')}
        icon={ScrollText}
        title={page.title}
        back={{ to: '/', label: t('page.home') }}
      />

      <div className="space-y-7 md:space-y-10">
        {/* The revision date is the trust signal Google News looks for, and the
            first thing a regulator checks. It belongs above the copy. */}
        <p lang={language} className={cn(s.body, '-mt-4 text-meta text-muted')}>
          {L('చివరిగా సవరించినది', 'Last updated')}: {formatUpdated(updated, language)}
        </p>

        {page.sections.length > 1 ? (
          <ChipRail ariaLabel={L('ఈ పేజీలోని విభాగాలు', 'Sections on this page')}>
            {page.sections.map((section) => (
              <Chip key={section.id} as="link" to={`#${section.id}`} lang={language}>
                {section.heading}
              </Chip>
            ))}
          </ChipRail>
        ) : null}

        {page.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-header">
            <h2
              lang={language}
              className={cn(s.head, 'reader-h3 mb-3 font-extrabold text-ink')}
            >
              {section.heading}
            </h2>
            {section.body.map((para, i) => (
              <p key={i} lang={language} className={cn(s.body, 'reader-body mb-4 text-ink')}>
                {para}
              </p>
            ))}
          </section>
        ))}

        {/* §12.5 — every compliance page ends at the same door: a real,
            reachable grievance route with the IT Rules SLA stated next to it. */}
        <Card tone="warm" padding="lg" radius="2xl">
          <h2 lang={language} className={cn(s.head, 'text-headline-md font-extrabold text-ink')}>
            {L('ఫిర్యాదు చేయాలా?', 'Need to raise a complaint?')}
          </h2>
          <p
            lang={language}
            className={cn(s.body, 'mt-2 text-muted', telugu ? 'text-te-body-xs' : 'text-ui')}
          >
            {L(
              'IT Rules 2021 ప్రకారం మీ ఫిర్యాదును 24 గంటల్లో స్వీకరించి, 15 రోజుల్లో పరిష్కరిస్తాం.',
              'Under IT Rules 2021 we acknowledge your complaint within 24 hours and resolve it within 15 days.',
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink to={`mailto:${contact.grievance_email}`} external icon={Mail}>
              {L('గ్రీవెన్స్ అధికారికి రాయండి', 'Email the Grievance Officer')}
            </ButtonLink>
            {slug === 'grievance' ? null : (
              <ButtonLink to="/grievance" variant="secondary">
                {t('page.grievance')}
              </ButtonLink>
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
