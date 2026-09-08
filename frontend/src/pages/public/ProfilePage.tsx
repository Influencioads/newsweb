import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Check, History, LogOut, MapPin, PenLine, Rss } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AccountIdentity } from '@/features/auth/components/AccountIdentity';
import * as publicApi from '@/features/public/api';
import * as readerApi from '@/features/reader/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { useReaderPrefs } from '@/stores/readerPrefs';

/**
 * Reader profile & preferences (updated doc §11, onboarding of §32).
 *
 * Saving the location here also updates the local `readerPrefs` store so the
 * edition selector, the Local tab and the personalized feed all follow the
 * same choice immediately — server for durability, store for reactivity.
 */
export default function ProfilePage() {
  const { language, setLanguage, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const navigate = useNavigate();
  const routeState = (useLocation().state ?? {}) as { welcome?: boolean };
  const { me, status, signOut } = useAuth();
  const queryClient = useQueryClient();
  const setEdition = useReaderPrefs((s) => s.setEdition);
  const setLocalLevels = useReaderPrefs((s) => s.setLocalLevels);

  useEffect(() => {
    if (status === 'anonymous') navigate('/login', { replace: true, state: { from: '/profile' } });
  }, [status, navigate]);

  const config = useQuery({ queryKey: ['public', 'config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
  const prefs = useQuery({
    queryKey: ['reader', 'preferences'],
    queryFn: readerApi.fetchPreferences,
    enabled: status === 'authenticated',
  });

  const [stateCode, setStateCode] = useState<string>('');
  const [districtSlug, setDistrictSlug] = useState<string>('');
  const [mandalSlug, setMandalSlug] = useState<string>('');
  const [interests, setInterests] = useState<string[]>([]);
  const [notify, setNotify] = useState({ breaking: true, local: true, topics: true });
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefs.data && !hydrated) {
      setStateCode(prefs.data.state?.code ?? '');
      setDistrictSlug(prefs.data.district?.slug ?? '');
      setMandalSlug(prefs.data.mandal?.slug ?? '');
      setInterests(prefs.data.category_slugs);
      setNotify({
        breaking: prefs.data.notify_breaking,
        local: prefs.data.notify_local,
        topics: prefs.data.notify_topics,
      });
      setHydrated(true);
    }
  }, [prefs.data, hydrated]);

  const districts = useMemo(
    () => (config.data?.districts ?? []).filter((d) => !stateCode || d.state === stateCode),
    [config.data, stateCode],
  );

  const mandals = useQuery({
    queryKey: ['public', 'mandals', districtSlug],
    queryFn: () => publicApi.fetchDistrictMandals(districtSlug),
    enabled: Boolean(districtSlug),
    staleTime: 3_600_000,
  });

  const save = useMutation({
    mutationFn: () =>
      readerApi.updatePreferences({
        language,
        state_code: stateCode || null,
        district_slug: districtSlug || null,
        mandal_slug: districtSlug ? mandalSlug || null : null,
        category_slugs: interests,
        notify_breaking: notify.breaking,
        notify_local: notify.local,
        notify_topics: notify.topics,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['reader', 'preferences'], data);
      setEdition(data.district?.slug ?? null);
      setLocalLevels(data.mandal?.slug ?? null, data.locality?.slug ?? null);
      setSaved(true);
      setError(null);
      window.setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setError(e instanceof ApiError ? (te ? e.messageTe : e.messageEn) : String(e)),
  });

  if (status !== 'authenticated' || !me) return null;

  function toggleInterest(slug: string) {
    setInterests((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    );
  }

  const categories = (config.data?.categories ?? []).filter((c) => c.show_in_nav);

  return (
    <main className="mx-auto max-w-[760px] px-4 py-7 sm:py-10">
      {routeState.welcome ? (
        <div className={`${teCls} mb-5 border-l-4 border-success bg-success-tint px-4 py-3 text-[14px] text-ink`}>
          {te
            ? 'స్వాగతం! మీ ప్రాంతం, ఆసక్తులు ఎంచుకుంటే వార్తలు మీకు తగ్గట్టుగా కనిపిస్తాయి.'
            : 'Welcome! Pick your location and interests to shape your news feed.'}
        </div>
      ) : null}

      <div className="mb-6 flex items-start justify-between gap-3 border-b-2 border-ink pb-4">
        <div>
          <p className="font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
            {te ? 'నా ఖాతా' : 'MY ACCOUNT'}
          </p>
          <h1 className={`${te ? 'th' : 'font-sans'} mt-1 text-[26px] font-extrabold text-ink`}>
            {pick(me.user.name_te, me.user.name_en)}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => signOut().then(() => navigate('/'))}
          className={`${teCls} flex min-h-tap items-center gap-1.5 border border-rule px-3 text-[12.5px] font-semibold text-muted hover:border-brand hover:text-brand`}
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          {te ? 'సైన్ అవుట్' : 'Sign out'}
        </button>
      </div>

      {/* §5 — profile picture, email and verification state. */}
      <AccountIdentity me={me} />

      {/* ------------------------------------------------ my library -------- */}
      <section className="mb-7">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['/following', <Rss key="i" className="h-4 w-4" aria-hidden />, te ? 'ఫాలోయింగ్ ఫీడ్' : 'Following feed'],
              ['/bookmarks', <Bookmark key="i" className="h-4 w-4" aria-hidden />, te ? 'సేవ్ చేసినవి' : 'Saved articles'],
              ['/history', <History key="i" className="h-4 w-4" aria-hidden />, te ? 'చదివినవి' : 'Reading history'],
              ['/submit', <PenLine key="i" className="h-4 w-4" aria-hidden />, te ? 'కథనం పంపండి' : 'Submit a story'],
            ] as const
          ).map(([to, icon, label]) => (
            <Link
              key={to}
              to={to}
              className={`${teCls} flex min-h-tap items-center gap-2 border border-rule bg-paper px-4 text-[13.5px] font-semibold text-ink hover:border-brand hover:text-brand`}
            >
              {icon}
              {label}
            </Link>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ language ---------- */}
      <section className="mb-7">
        <h2 className={`${te ? 'th' : 'font-sans'} mb-2 text-[16px] font-bold text-ink`}>
          {te ? 'భాష' : 'Language'}
        </h2>
        <div className="flex gap-2">
          {(['te', 'en'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setLanguage(lang)}
              aria-pressed={language === lang}
              className={[
                'min-h-tap rounded-chip border px-4 text-[13.5px] font-semibold',
                lang === 'te' ? 'te' : 'font-sans',
                language === lang
                  ? 'border-brand bg-brand-tint text-brand'
                  : 'border-rule bg-paper text-muted hover:border-brand',
              ].join(' ')}
            >
              {lang === 'te' ? 'తెలుగు' : 'English'}
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ location ---------- */}
      <section className="mb-7">
        <h2 className={`${te ? 'th' : 'font-sans'} mb-1 flex items-center gap-1.5 text-[16px] font-bold text-ink`}>
          <MapPin className="h-4 w-4 text-brand" aria-hidden />
          {te ? 'నా ప్రాంతం' : 'My location'}
        </h2>
        <p className={`${teCls} mb-3 text-[12.5px] text-muted`}>
          {te
            ? 'లోకల్ వార్తలు ఈ ఎంపిక ప్రకారం కనిపిస్తాయి — గ్రామం/మండలం వార్తలు ముందుగా.'
            : 'The Local feed follows this choice — village/mandal stories rank first.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={`${teCls} mb-1 block text-[12px] font-semibold text-muted`}>
              {te ? 'రాష్ట్రం' : 'State'}
            </span>
            <select
              value={stateCode}
              onChange={(e) => { setStateCode(e.target.value); setDistrictSlug(''); setMandalSlug(''); }}
              className={`${teCls} w-full rounded-control border border-rule-input bg-white px-2 py-2.5 text-[14px] text-ink`}
            >
              <option value="">{te ? '— ఎంచుకోండి —' : '— choose —'}</option>
              {config.data?.states.map((s) => (
                <option key={s.code} value={s.code}>{pick(s.name_te, s.name_en)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={`${teCls} mb-1 block text-[12px] font-semibold text-muted`}>
              {te ? 'జిల్లా' : 'District'}
            </span>
            <select
              value={districtSlug}
              onChange={(e) => { setDistrictSlug(e.target.value); setMandalSlug(''); }}
              disabled={!stateCode}
              className={`${teCls} w-full rounded-control border border-rule-input bg-white px-2 py-2.5 text-[14px] text-ink disabled:bg-paper-sub`}
            >
              <option value="">{te ? '— ఎంచుకోండి —' : '— choose —'}</option>
              {districts.map((d) => (
                <option key={d.slug} value={d.slug}>{pick(d.name_te, d.name_en)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={`${teCls} mb-1 block text-[12px] font-semibold text-muted`}>
              {te ? 'మండలం' : 'Mandal'}
            </span>
            <select
              value={mandalSlug}
              onChange={(e) => setMandalSlug(e.target.value)}
              disabled={!districtSlug || !mandals.data?.length}
              className={`${teCls} w-full rounded-control border border-rule-input bg-white px-2 py-2.5 text-[14px] text-ink disabled:bg-paper-sub`}
            >
              <option value="">{te ? '— అన్నీ —' : '— all —'}</option>
              {mandals.data?.map((m) => (
                <option key={m.slug} value={m.slug}>{pick(m.name_te, m.name_en)}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ------------------------------------------------ interests --------- */}
      <section className="mb-7">
        <h2 className={`${te ? 'th' : 'font-sans'} mb-1 text-[16px] font-bold text-ink`}>
          {te ? 'ఆసక్తులు' : 'Interests'}
        </h2>
        <p className={`${teCls} mb-3 text-[12.5px] text-muted`}>
          {te ? 'ఎంచుకున్న విభాగాలు మీ ఫీడ్‌లో ప్రాధాన్యం పొందుతాయి.' : 'Chosen sections get priority in your feed.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const active = interests.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => toggleInterest(c.slug)}
                aria-pressed={active}
                className={[
                  'flex min-h-[36px] items-center gap-1 rounded-chip border px-3 text-[13px] font-semibold',
                  te ? 'te' : 'font-sans',
                  active
                    ? 'border-brand bg-brand-tint text-brand'
                    : 'border-rule bg-paper text-muted hover:border-brand',
                ].join(' ')}
              >
                {active ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                {pick(c.name_te, c.name_en)}
              </button>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------ notifications ----- */}
      <section className="mb-8">
        <h2 className={`${te ? 'th' : 'font-sans'} mb-3 text-[16px] font-bold text-ink`}>
          {te ? 'నోటిఫికేషన్లు' : 'Notifications'}
        </h2>
        <div className="flex flex-col gap-2">
          {([
            ['breaking', te ? 'బ్రేకింగ్ న్యూస్' : 'Breaking news'],
            ['local', te ? 'లోకల్ వార్తలు' : 'Local news'],
            ['topics', te ? 'నా అంశాల అప్‌డేట్లు' : 'My topics'],
          ] as const).map(([key, label]) => (
            <label key={key} className={`${teCls} flex min-h-tap cursor-pointer items-center gap-3 text-[14px] text-ink`}>
              <input
                type="checkbox"
                checked={notify[key]}
                onChange={(e) => setNotify((n) => ({ ...n, [key]: e.target.checked }))}
                className="h-4 w-4 accent-brand"
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !hydrated}
          className={`${teCls} rounded-control bg-brand px-6 py-3 text-[15px] font-bold text-white hover:bg-brand-dark disabled:opacity-60`}
        >
          {save.isPending ? (te ? 'సేవ్ అవుతోంది…' : 'Saving…') : te ? 'సేవ్ చేయండి' : 'Save preferences'}
        </button>
        {saved ? (
          <span className={`${teCls} flex items-center gap-1 text-[13px] font-semibold text-success`}>
            <Check className="h-4 w-4" aria-hidden /> {te ? 'సేవ్ అయింది' : 'Saved'}
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={`${teCls} mt-3 rounded bg-breaking-tint px-3 py-2 text-[13px] text-breaking`}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
