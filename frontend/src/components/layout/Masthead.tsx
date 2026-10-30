import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, Bell, MapPin, Newspaper, SlidersHorizontal, UserRound } from 'lucide-react';

import { LocationPicker, useReaderPlace, useReaderPlaceName } from '@/components/location/LocationPicker';
import { Button, ButtonLink, IconButton, IconButtonLink } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import * as notificationsApi from '@/features/engagement/notificationsApi';
import { EPAPER_PUBLIC } from '@/features/epaper/api';
import { scriptOf, useSiteContent } from '@/features/wow/siteContent';
import { LANGUAGE_LABELS, useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { formatFullDate } from '@/utils/time';

import { LanguageToggle } from './LanguageToggle';
import { ReaderSettings } from './ReaderSettings';
import { Wordmark } from './Wordmark';

/**
 * Masthead — row 1 of the reader shell; scrolls away.
 *
 * A newspaper masthead, the wordmark centred between two stacked columns.
 * From md: left — the reader's area (bold), today's date, the language switch;
 * right — sign in / account on top, then e-paper, reader settings and
 * notifications. Under md: wordmark first, then the language chip and one row
 * of icon actions. Every control is 44px and present at every width. The language
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

/**
 * The reader's area, always in the chrome. The name shows from 1200px, where the
 * site container stops growing; below that only the pin, because a signed-in
 * reader's actions column has no room for a label. Opens the one cascade, down
 * to the village; every choice applies at once. Nothing is ever detected — the
 * reader picks.
 */
function LocationButton({ named = false, className }: { named?: boolean; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const place = useReaderPlace();
  const name = useReaderPlaceName();
  const label = name ? `${t('reader.location')}: ${name}` : t('reader.chooseLocation');
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={MapPin}
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className={cn(named && '-ml-2 font-bold text-ink', className)}
      >
        <span className={cn('max-w-[11rem] truncate', named ? 'block' : 'hidden min-[1200px]:block')}>
          {name ?? t('reader.chooseLocation')}
        </span>
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('reader.chooseLocation')}
        size="sm"
        sheetOnMobile
        footer={<Button onClick={() => setOpen(false)}>{t('ui.done')}</Button>}
      >
        <LocationPicker levels="locality" layout="stack" {...place} />
      </Dialog>
    </>
  );
}

export function Masthead() {
  const { t, pick, language, setLanguage } = useI18n();
  const s = useScript();
  const { brand } = useSiteContent();
  const tagline = pick(brand.tagline_te, brand.tagline_en);
  const taglineScript = scriptOf(tagline);
  const [settings, setSettings] = useState(false);
  const authStatus = useAuth((a) => a.status);
  const me = useAuth((a) => a.me);
  const authed = authStatus === 'authenticated';
  const other = language === 'te' ? 'en' : 'te';

  return (
    <div className="bg-paper">
      {/* Under md the 28px wordmark (~205px) plus 44px controls cannot share
          one row at 360–412px, so the wordmark takes the first row on its own
          (a newspaper masthead) and the two control groups share the second,
          the language chip taking only its own width so the four actions fit.
          From md it is the original three-column row. */}
      <PageContainer
        width="site"
        className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 py-2 md:grid-cols-[1fr_auto_1fr] md:gap-x-6 md:py-4"
      >
        {/* Left column (md+): area, date, language — stacked like a paper's dateline. */}
        <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-0.5">
          <LocationButton named className="hidden md:inline-flex" />
          <p className={cn(s.body, 'hidden text-meta text-ink-soft md:block')}>{formatFullDate(new Date(), language)}</p>
          <LanguageToggle className="hidden md:mt-1 md:inline-flex" />
          <Chip as="button" lang={other} className="md:hidden" onClick={() => setLanguage(other)}>
            {LANGUAGE_LABELS[other]}
          </Chip>
        </div>

        <Link
          to="/"
          aria-label="WowIndian · వావ్ ఇండియన్"
          className="order-first col-span-2 flex min-w-0 flex-col items-center gap-1 rounded-xl py-1 md:order-none md:col-span-1"
        >
          <Wordmark />
          {/* Brand line (CMS → Site content), e.g. "Ordinary People. Extraordinary Stories." */}
          <span
            lang={taglineScript.lang}
            className={cn(taglineScript.cls, 'mt-0.5 hidden whitespace-nowrap text-center text-meta font-bold tracking-wide text-ink md:block lg:text-ui-sm')}
          >
            {tagline}
          </span>
        </Link>

        {/* Phone: one line — the brand line small on the left, a small Nominate
            Your Local Hero pill on the right. */}
        <div className="order-first col-span-2 flex items-center justify-between gap-1.5 md:hidden">
          <p lang={taglineScript.lang} className={cn(taglineScript.cls, 'min-w-0 text-eyebrow font-bold leading-snug tracking-normal text-ink')}>
            {tagline}
          </p>
          <Link
            to="/nominate"
            aria-label={t('ui.nominate')}
            className="flex min-h-tap shrink-0 items-center rounded-pill"
          >
            <span
              className={cn(
                s.body,
                'inline-flex h-7 items-center gap-0.5 whitespace-nowrap rounded-pill bg-gradient-to-br from-wow to-wow-deep px-2 text-meta font-bold leading-none text-on-wow shadow-card',
              )}
            >
              <Icon icon={Award} size="xs" />
              {language === 'te' ? 'లోకల్ హీరో ని నామినేట్ చేయండి' : 'Nominate a Local Hero'}
            </span>
          </Link>
        </div>

        {/* Right column: one row under md; from md account on top, the rest beneath. */}
        <div className="flex shrink-0 items-center justify-end gap-1 md:flex-col md:items-end md:gap-1">
          <div className="flex items-center gap-1">
          {EPAPER_PUBLIC && (
          <ButtonLink
            to="/epaper"
            variant="secondary"
            size="sm"
            icon={Newspaper}
            aria-label={t('nav.epaper')}
            className="hidden md:inline-flex"
          >
            <span className="hidden lg:inline">{t('nav.epaper')}</span>
          </ButtonLink>
          )}
          <LocationButton className="md:hidden" />
          <IconButton icon={SlidersHorizontal} label={t('ui.readerSettings')} onClick={() => setSettings(true)} />
          {authed && <NotificationBell />}
          </div>
          <ButtonLink to="/nominate" variant="wow" size="sm" icon={Award} className="hidden md:inline-flex">
            {t('ui.nominate')}
          </ButtonLink>
          {/* Signed-in readers keep their profile here; there is no sign-in button in the header. */}
          {authed && me ? (
            <div className="md:order-first">
              <IconButtonLink
                icon={UserRound}
                label={`${t('page.profile')} · ${pick(me.user.name_te, me.user.name_en)}`}
                to="/profile"
              />
            </div>
          ) : null}
        </div>
      </PageContainer>

      <ReaderSettings open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
