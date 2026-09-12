import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Bookmark,
  History,
  LogOut,
  Monitor,
  Moon,
  PenLine,
  Rss,
  Save,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react';

import { FontSizeGroup } from '@/components/article/ReaderToolbar';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { LocationPicker, type LocationValue } from '@/components/location/LocationPicker';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Switch } from '@/components/ui/Field';
import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import { AccountIdentity } from '@/features/auth/components/AccountIdentity';
import * as publicApi from '@/features/public/api';
import * as readerApi from '@/features/reader/api';
import { useI18n, useScript, type StringKey } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { useReaderPrefs, type Theme } from '@/stores/readerPrefs';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * Reader profile & preferences (updated doc §11, onboarding of §32).
 *
 * Saving the location here also updates the local `readerPrefs` store so the
 * edition selector, the Local tab and the personalized feed all follow the
 * same choice immediately — server for durability, store for reactivity.
 *
 * Grouped into one Card per concern: identity, library, reading, location,
 * interests, notifications — with a single Save at the end for the four
 * server-side groups (reading settings are device-local and save themselves).
 */

const THEMES: { value: Theme; icon: LucideIcon; key: StringKey }[] = [
  { value: 'system', icon: Monitor, key: 'ui.themeSystem' },
  { value: 'light', icon: Sun, key: 'ui.themeLight' },
  { value: 'dark', icon: Moon, key: 'ui.themeDark' },
];

const LIBRARY: { to: string; icon: LucideIcon; key: StringKey }[] = [
  { to: '/following', icon: Rss, key: 'page.following' },
  { to: '/bookmarks', icon: Bookmark, key: 'page.bookmarks' },
  { to: '/history', icon: History, key: 'page.history' },
  { to: '/submit', icon: PenLine, key: 'page.submit' },
];

type NotifyKey = 'breaking' | 'local' | 'topics';

export default function ProfilePage() {
  const { language, t } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const toast = useToast();
  const navigate = useNavigate();
  const routeState = (useLocation().state ?? {}) as { welcome?: boolean };
  const { me, status, signOut } = useAuth();
  const queryClient = useQueryClient();
  const setEdition = useReaderPrefs((p) => p.setEdition);
  const setLocalLevels = useReaderPrefs((p) => p.setLocalLevels);
  const theme = useReaderPrefs((p) => p.theme);
  const setTheme = useReaderPrefs((p) => p.setTheme);
  const fontId = useId();
  const langId = useId();
  const themeId = useId();
  useDocumentTitle(t('page.profile'));

  // A sign-out the reader asked for lands on the home page, not back on /login.
  const leaving = useRef(false);
  useEffect(() => {
    if (status === 'anonymous' && !leaving.current) {
      navigate('/login', { replace: true, state: { from: '/profile' } });
    }
  }, [status, navigate]);

  const config = useQuery({ queryKey: ['public', 'config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
  const prefs = useQuery({
    queryKey: ['reader', 'preferences'],
    queryFn: readerApi.fetchPreferences,
    enabled: status === 'authenticated',
  });

  const [place, setPlace] = useState<LocationValue>({});
  const [interests, setInterests] = useState<string[]>([]);
  const [notify, setNotify] = useState<Record<NotifyKey, boolean>>({ breaking: true, local: true, topics: true });
  const [hydrated, setHydrated] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    if (prefs.data && !hydrated) {
      setPlace({
        state: prefs.data.state?.code ?? null,
        district: prefs.data.district?.slug ?? null,
        mandal: prefs.data.mandal?.slug ?? null,
      });
      setInterests(prefs.data.category_slugs);
      setNotify({
        breaking: prefs.data.notify_breaking,
        local: prefs.data.notify_local,
        topics: prefs.data.notify_topics,
      });
      setHydrated(true);
    }
  }, [prefs.data, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      readerApi.updatePreferences({
        language,
        state_code: place.state || null,
        district_slug: place.district || null,
        mandal_slug: place.district ? place.mandal || null : null,
        category_slugs: interests,
        notify_breaking: notify.breaking,
        notify_local: notify.local,
        notify_topics: notify.topics,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['reader', 'preferences'], data);
      setEdition(data.district?.slug ?? null);
      setLocalLevels(data.mandal?.slug ?? null, data.locality?.slug ?? null);
      toast.success(t('ui.saved'));
    },
    onError: (error) => toast.error(error),
  });

  const signingOut = useMutation({
    mutationFn: () => {
      leaving.current = true;
      return signOut();
    },
    onSuccess: () => navigate('/', { replace: true }),
    onError: (error) => toast.error(error),
  });

  if (status !== 'authenticated' || !me) return null;

  function toggleInterest(slug: string) {
    setInterests((current) => (current.includes(slug) ? current.filter((v) => v !== slug) : [...current, slug]));
  }

  const categories = (config.data?.categories ?? []).filter((c) => c.show_in_nav);
  const name = s.text(me.user.name_te, me.user.name_en);
  const caption = cn(s.body, 'mb-2 text-ui-sm font-semibold text-ink');
  const note = cn(s.body, 'mb-3 text-meta text-muted');

  return (
    <PageContainer width="page" className="py-8 md:py-12">
      <PageHeader
        icon={UserRound}
        title={name.text}
        titleLang={name.lang}
        actions={
          <Button variant="secondary" icon={LogOut} onClick={() => setConfirmSignOut(true)}>
            {L('సైన్ అవుట్', 'Sign out')}
          </Button>
        }
      />

      <div className="space-y-7 md:space-y-10">
        {routeState.welcome ? (
          <Card role="status" tone="warm" padding="md" className="flex items-start gap-2">
            <Icon icon={Sparkles} className="mt-0.5 text-brand" />
            <p className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui', 'text-ink')}>
              {L(
                'స్వాగతం! మీ ప్రాంతం, ఆసక్తులు ఎంచుకుంటే వార్తలు మీకు తగ్గట్టుగా కనిపిస్తాయి.',
                'Welcome! Pick your location and interests to shape your news feed.',
              )}
            </p>
          </Card>
        ) : null}

        {/* §5 — profile picture, email and verification state. */}
        <section>
          <SectionHeader title={L('ఖాతా', 'Account')} />
          <AccountIdentity me={me} />
        </section>

        <section>
          <SectionHeader title={L('నా లైబ్రరీ', 'My library')} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LIBRARY.map((item) => (
              <ButtonLink key={item.to} to={item.to} variant="secondary" icon={item.icon} full>
                {t(item.key)}
              </ButtonLink>
            ))}
          </div>
        </section>

        {/* Device-local reader settings — they apply on change, not on Save. */}
        <section>
          <SectionHeader title={L('చదివే సెట్టింగ్స్', 'Reading settings')} />
          <Card padding="lg" className="space-y-5">
            <div>
              <p id={fontId} className={caption}>
                {t('reader.fontSize')}
              </p>
              <FontSizeGroup aria-labelledby={fontId} className="flex-wrap" />
            </div>
            <div>
              <p id={langId} className={caption}>
                {t('reader.language')}
              </p>
              <LanguageToggle aria-labelledby={langId} />
            </div>
            <div>
              <p id={themeId} className={caption}>
                {t('ui.theme')}
              </p>
              <div role="group" aria-labelledby={themeId} className="flex flex-wrap gap-2">
                {THEMES.map((item) => (
                  <Chip
                    key={item.value}
                    icon={item.icon}
                    selected={theme === item.value}
                    onClick={() => setTheme(item.value)}
                  >
                    {t(item.key)}
                  </Chip>
                ))}
              </div>
            </div>
          </Card>
        </section>

        <QueryState
          query={prefs}
          skeleton={
            <div className="space-y-7 md:space-y-10">
              <Skeleton variant="block" />
              <Skeleton variant="block" />
            </div>
          }
        >
          {() => (
            <div className="space-y-7 md:space-y-10">
              <section>
                <SectionHeader title={L('నా ప్రాంతం', 'My location')} />
                <Card padding="lg">
                  <p className={note}>
                    {L(
                      'లోకల్ వార్తలు ఈ ఎంపిక ప్రకారం కనిపిస్తాయి — గ్రామం/మండలం వార్తలు ముందుగా.',
                      'The Local feed follows this choice — village/mandal stories rank first.',
                    )}
                  </p>
                  <LocationPicker levels="mandal" value={place} onChange={setPlace} />
                </Card>
              </section>

              <section>
                <SectionHeader title={L('ఆసక్తులు', 'Interests')} />
                <Card padding="lg">
                  <p className={note}>
                    {L('ఎంచుకున్న విభాగాలు మీ ఫీడ్‌లో ప్రాధాన్యం పొందుతాయి.', 'Chosen sections get priority in your feed.')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => {
                      const label = s.text(c.name_te, c.name_en);
                      return (
                        <Chip
                          key={c.slug}
                          selected={interests.includes(c.slug)}
                          onClick={() => toggleInterest(c.slug)}
                          lang={label.lang}
                          textClass={label.telugu ? 'text-te-body-xs' : 'text-ui-sm'}
                        >
                          {label.text}
                        </Chip>
                      );
                    })}
                  </div>
                </Card>
              </section>

              <section>
                <SectionHeader title={t('ui.notifications')} />
                <Card padding="lg">
                  <Switch
                    checked={notify.breaking}
                    onChange={(v) => setNotify((n) => ({ ...n, breaking: v }))}
                    label={L('బ్రేకింగ్ న్యూస్', 'Breaking news')}
                    hint={L('అత్యవసర వార్తలు వచ్చిన వెంటనే.', 'Urgent stories the moment they land.')}
                  />
                  <Switch
                    checked={notify.local}
                    onChange={(v) => setNotify((n) => ({ ...n, local: v }))}
                    label={L('లోకల్ వార్తలు', 'Local news')}
                    hint={L('పైన ఎంచుకున్న ప్రాంతం నుంచి.', 'From the location you picked above.')}
                  />
                  <Switch
                    checked={notify.topics}
                    onChange={(v) => setNotify((n) => ({ ...n, topics: v }))}
                    label={L('నా అంశాల అప్‌డేట్లు', 'My topics')}
                    hint={L('ఫాలో అవుతున్న విభాగాలు, ట్యాగ్‌లు.', 'Sections and tags you follow.')}
                  />
                </Card>
              </section>

              <Button
                size="lg"
                icon={Save}
                pending={save.isPending}
                disabled={!hydrated}
                onClick={() => save.mutate()}
                className="w-full sm:w-auto"
              >
                {L('సేవ్ చేయండి', 'Save preferences')}
              </Button>
            </div>
          )}
        </QueryState>

        <p className={cn(s.body, 'flex items-center gap-1.5 text-meta text-muted')}>
          <Icon icon={Bell} size="xs" />
          {L(
            'నోటిఫికేషన్లు, ప్రాంతం, ఆసక్తులు — సేవ్ చేసిన తర్వాతే వర్తిస్తాయి.',
            'Location, interests and notifications apply once you save.',
          )}
        </p>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title={L('సైన్ అవుట్ అవ్వాలా?', 'Sign out?')}
        body={L(
          'ఈ పరికరంలో మీ ఖాతా నుంచి బయటకు వస్తారు. సేవ్ చేసినవి అలాగే ఉంటాయి.',
          'You will be signed out on this device. Your saved stories stay put.',
        )}
        confirmLabel={L('సైన్ అవుట్', 'Sign out')}
        tone="danger"
        pending={signingOut.isPending}
        onConfirm={() => signingOut.mutate()}
      />
    </PageContainer>
  );
}
