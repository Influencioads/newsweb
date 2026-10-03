import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, MapPin, Newspaper, SlidersHorizontal, UserRound } from 'lucide-react';

import { LocationPicker, useReaderPlace, useReaderPlaceName } from '@/components/location/LocationPicker';
import { Button, ButtonLink, IconButton, IconButtonLink } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dialog } from '@/components/ui/Dialog';
import { PageContainer } from '@/components/ui/Layout';
import * as notificationsApi from '@/features/engagement/notificationsApi';
import { EPAPER_PUBLIC } from '@/features/epaper/api';
import { LANGUAGE_LABELS, useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { formatFullDate } from '@/utils/time';

import { LanguageToggle } from './LanguageToggle';
import { ReaderSettings } from './ReaderSettings';

/**
 * Masthead — row 1 of the reader shell; scrolls away.
 *
 * Language + date (xl+) · wordmark · e-paper (md+), location, reader settings,
 * notifications (signed in), account. Every control is 44px and present at
 * every width — only text labels collapse to icons under md (the e-paper label
 * under lg, the location name under 1200px) so the md row fits its third of the
 * grid. The language
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
function LocationButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const place = useReaderPlace();
  const name = useReaderPlaceName();
  const label = name ? `${t('reader.location')}: ${name}` : t('reader.chooseLocation');
  return (
    <>
      <Button variant="ghost" size="sm" icon={MapPin} aria-label={label} title={label} onClick={() => setOpen(true)}>
        <span className="hidden max-w-[9rem] truncate min-[1200px]:block">{name ?? t('reader.chooseLocation')}</span>
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
        className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 py-2 md:grid-cols-3 md:py-3"
      >
        <div className="flex items-center gap-3">
          <LanguageToggle className="hidden md:inline-flex" />
          <Chip as="button" lang={other} className="md:hidden" onClick={() => setLanguage(other)}>
            {LANGUAGE_LABELS[other]}
          </Chip>
          <p className={cn(s.body, 'hidden text-meta text-muted xl:block')}>{formatFullDate(new Date(), language)}</p>
        </div>

        <Link to="/" className="order-first col-span-2 flex min-w-0 justify-center rounded-xl md:order-none md:col-span-1">
          <img src="/logo.webp" alt="టాప్ తెలుగు న్యూస్ · Top Telugu News" width={720} height={205} className="h-12 w-auto md:h-16" />
        </Link>

        <div className="flex shrink-0 items-center justify-end gap-1">
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
          <LocationButton />
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
