import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Newspaper, SlidersHorizontal, UserRound } from 'lucide-react';

import { ButtonLink, IconButton, IconButtonLink } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { PageContainer } from '@/components/ui/Layout';
import * as notificationsApi from '@/features/engagement/notificationsApi';
import { LANGUAGE_LABELS, useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { formatFullDate } from '@/utils/time';

import { LanguageToggle } from './LanguageToggle';
import { ReaderSettings } from './ReaderSettings';

/**
 * Masthead — row 1 of the reader shell; scrolls away.
 *
 * Language + date (xl+) · wordmark · e-paper (md+), reader settings,
 * notifications (signed in), account. Every control is 44px and present at
 * every width — only text labels collapse to icons under md. The language
 * switch stays in the chrome at every width because a reader who cannot read
 * the interface must be able to leave it: md+ shows both labels, under md a
 * single chip carries the *other* language's label in its own script. It sits
 * in the left column because the actions column is full.
 *
 * The wordmark stays Telugu in both interface languages: a publication does
 * not rename itself when a reader switches language.
 */

function NotificationBell() {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.fetchInbox(0),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return <IconButtonLink icon={Bell} label={t('ui.notifications')} to="/notifications" badge={data?.unread ?? 0} />;
}

export function Masthead() {
  const { t, pick, language, setLanguage } = useI18n();
  const s = useScript();
  const [settings, setSettings] = useState(false);
  const authStatus = useAuth((a) => a.status);
  const me = useAuth((a) => a.me);
  const authed = authStatus === 'authenticated';
  const other = language === 'te' ? 'en' : 'te';

  return (
    <div className="bg-paper">
      {/* Under md the 28px wordmark (~205px) plus 44px controls cannot share
          one row at 360–412px, so the wordmark takes the first row on its own
          (a newspaper masthead) and the two control groups share the second.
          From md it is the original three-column row. */}
      <PageContainer
        width="site"
        className="grid grid-cols-2 items-center gap-x-2 gap-y-1 py-2 md:grid-cols-3 md:py-3"
      >
        <div className="flex items-center gap-3">
          <LanguageToggle className="hidden md:inline-flex" />
          <Chip as="button" lang={other} className="md:hidden" onClick={() => setLanguage(other)}>
            {LANGUAGE_LABELS[other]}
          </Chip>
          <p className={cn(s.body, 'hidden text-meta text-muted xl:block')}>{formatFullDate(new Date(), language)}</p>
        </div>

        <Link to="/" className="order-first col-span-2 min-w-0 rounded-xl text-center md:order-none md:col-span-1">
          <span lang="te" className="th block text-headline-lg font-extrabold text-brand md:text-display">
            టాప్ తెలుగు న్యూస్
          </span>
          <span lang="en" className="block font-sans text-eyebrow font-semibold uppercase tracking-wordmark text-exclusive-text">
            Top Telugu News
          </span>
        </Link>

        <div className="flex shrink-0 items-center justify-end gap-1">
          <ButtonLink to="/epaper" variant="secondary" size="sm" icon={Newspaper} className="hidden md:inline-flex">
            {t('nav.epaper')}
          </ButtonLink>
          <IconButton icon={SlidersHorizontal} label={t('ui.readerSettings')} onClick={() => setSettings(true)} />
          {authed && <NotificationBell />}
          {authed && me ? (
            <IconButtonLink
              icon={UserRound}
              label={`${t('page.profile')} · ${pick(me.user.name_te, me.user.name_en)}`}
              to="/profile"
            />
          ) : (
            <ButtonLink to="/login" variant="ghost" size="sm" icon={UserRound} aria-label={t('nav.signIn')}>
              <span className="hidden md:inline">{t('nav.signIn')}</span>
            </ButtonLink>
          )}
        </div>
      </PageContainer>

      <ReaderSettings open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
