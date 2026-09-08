import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import * as publicApi from '@/api/public';
import * as readerApi from '@/api/reader';
import { LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { font, FONT_STEPS } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { usePrefs } from '@/stores/prefs';

/**
 * Profile tab: reader OTP sign-in (§11 — a new number registers itself), then
 * language / location / interests / notification preferences, mirrored to the
 * server and to the local prefs store so Home and Local follow immediately.
 */

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  const color = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// --------------------------------------------------------------- sign-in ---
function SignIn() {
  const styles = useStyles();
  const color = useColors();
  const { t, isTelugu } = useI18n();
  const setMe = useAuth((s) => s.setMe);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  // §4 — OTP stays the default because it is the fastest path; the email form
  // is a second mode on the same card rather than a separate screen.
  const [mode, setMode] = useState<'otp' | 'email'>('otp');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [emailStep, setEmailStep] = useState<'signin' | 'register'>('signin');
  const [busy, setBusy] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp() {
    if (phone.replace(/\D/g, '').length < 10) return;
    setBusy(true);
    setError(null);
    try {
      const res = await readerApi.requestOtp(phone);
      setDevOtp(res.dev_otp);
      setOtp('');
      setStep('otp');
    } catch (e) {
      setError(e instanceof ApiError ? (isTelugu ? e.messageTe : e.messageEn) : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (otp.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await readerApi.verifyReaderOtp(phone, otp);
      setMe(res.me);
    } catch (e) {
      setError(e instanceof ApiError ? (isTelugu ? e.messageTe : e.messageEn) : String(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail() {
    setBusy(true);
    setError(null);
    try {
      const res = emailStep === 'register'
        ? await readerApi.registerReader({
            name, email, password, confirm_password: confirm, phone: phone || undefined,
          })
        : await readerApi.loginWithPassword(email, password);
      setMe(res.me);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? isTelugu ? err.messageTe : err.messageEn
          : isTelugu ? 'ఏదో తప్పు జరిగింది.' : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  const emailInvalid =
    !email.trim() ||
    password.length < 8 ||
    (emailStep === 'register' && (name.trim().length < 2 || password !== confirm));

  if (mode === 'email') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {emailStep === 'register'
            ? isTelugu ? 'ఖాతా సృష్టించండి' : 'Create your account'
            : isTelugu ? 'ఇమెయిల్‌తో లాగిన్' : 'Sign in with email'}
        </Text>

        {emailStep === 'register' ? (
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={isTelugu ? 'పేరు' : 'Name'}
            placeholderTextColor={color.mutedLight}
            style={styles.phoneInput}
            accessibilityLabel={isTelugu ? 'పేరు' : 'Name'}
          />
        ) : null}
        <TextInput
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder={isTelugu ? 'ఇమెయిల్' : 'Email'}
          placeholderTextColor={color.mutedLight}
          style={styles.phoneInput}
          accessibilityLabel={isTelugu ? 'ఇమెయిల్' : 'Email'}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={emailStep === 'register' ? 'new-password' : 'current-password'}
          placeholder={isTelugu ? 'పాస్‌వర్డ్' : 'Password'}
          placeholderTextColor={color.mutedLight}
          style={styles.phoneInput}
          accessibilityLabel={isTelugu ? 'పాస్‌వర్డ్' : 'Password'}
        />
        {emailStep === 'register' ? (
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholder={isTelugu ? 'పాస్‌వర్డ్ మళ్లీ' : 'Confirm password'}
            placeholderTextColor={color.mutedLight}
            style={styles.phoneInput}
            accessibilityLabel={isTelugu ? 'పాస్‌వర్డ్ మళ్లీ' : 'Confirm password'}
          />
        ) : null}

        <Pressable
          onPress={submitEmail}
          disabled={busy || emailInvalid}
          accessibilityRole="button"
          style={[styles.primaryButton, (busy || emailInvalid) && styles.disabled]}
        >
          <Text style={styles.primaryButtonText}>
            {busy
              ? isTelugu ? 'ఆగండి…' : 'Please wait…'
              : emailStep === 'register'
                ? isTelugu ? 'ఖాతా సృష్టించండి' : 'Create account'
                : isTelugu ? 'లాగిన్' : 'Sign in'}
          </Text>
        </Pressable>

        <View style={styles.otpActions}>
          <Pressable
            onPress={() => setEmailStep(emailStep === 'register' ? 'signin' : 'register')}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>
              {emailStep === 'register'
                ? isTelugu ? 'ఖాతా ఉందా? లాగిన్' : 'Have an account? Sign in'
                : isTelugu ? 'కొత్త ఖాతా' : 'Create an account'}
            </Text>
          </Pressable>
          <Pressable onPress={() => setMode('otp')} accessibilityRole="button">
            <Text style={styles.linkText}>{isTelugu ? 'OTP ద్వారా' : 'Use OTP instead'}</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {step === 'phone' ? t('auth.signIn') : t('auth.enterOtp')}
      </Text>
      <Text style={styles.cardHint}>{t('auth.phoneHint')}</Text>

      {step === 'phone' ? (
        <>
          <View style={styles.phoneRow}>
            <Text style={styles.phonePrefix}>+91</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="98480 12345"
              placeholderTextColor={color.mutedLight}
              style={styles.phoneInput}
              accessibilityLabel={t('auth.phone')}
            />
          </View>
          <Pressable
            onPress={sendOtp}
            disabled={busy}
            accessibilityRole="button"
            style={[styles.primaryButton, busy && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>
              {busy ? t('auth.sending') : t('auth.sendOtp')}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            placeholder="••••••"
            placeholderTextColor={color.mutedLight}
            style={[styles.phoneInput, styles.otpInput]}
            accessibilityLabel={t('auth.enterOtp')}
          />
          {devOtp ? <Text style={styles.devOtp}>DEV OTP: {devOtp}</Text> : null}
          <Pressable
            onPress={verify}
            disabled={busy || otp.length < 6}
            accessibilityRole="button"
            style={[styles.primaryButton, (busy || otp.length < 6) && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>
              {busy ? t('auth.verifying') : t('auth.verify')}
            </Text>
          </Pressable>
          <View style={styles.otpActions}>
            <Pressable onPress={() => setStep('phone')} accessibilityRole="button">
              <Text style={styles.linkText}>{t('auth.changeNumber')}</Text>
            </Pressable>
            <Pressable onPress={sendOtp} disabled={busy} accessibilityRole="button">
              <Text style={styles.linkText}>{t('auth.resend')}</Text>
            </Pressable>
          </View>
        </>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable onPress={() => setMode('email')} accessibilityRole="button">
        <Text style={[styles.linkText, styles.altAuthLink]}>
          {isTelugu ? 'ఇమెయిల్ / పాస్‌వర్డ్‌తో లాగిన్' : 'Sign in with email and password'}
        </Text>
      </Pressable>
    </View>
  );
}

// ----------------------------------------------------------- preferences ---
function Preferences() {
  const styles = useStyles();
  const color = useColors();
  const { t, pick, language, setLanguage } = useI18n();
  const isTelugu = language === 'te';
  const { me, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { fontStep, setFontStep, setEdition, setMandal, theme, setTheme } = usePrefs();
  const [isTeluguUi, setTeluguUi] = useState(language === 'te');

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: readerApi.fetchPreferences });

  const [stateCode, setStateCode] = useState('');
  const [districtSlug, setDistrictSlug] = useState('');
  const [mandalSlug, setMandalSlug] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [notify, setNotify] = useState({ breaking: true, local: true, topics: true });
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);

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
    queryKey: ['mandals', districtSlug],
    queryFn: () => publicApi.fetchDistrictMandals(districtSlug),
    enabled: Boolean(districtSlug),
    staleTime: 3_600_000,
  });

  const save = useMutation({
    mutationFn: () =>
      readerApi.updatePreferences({
        language: isTeluguUi ? 'te' : 'en',
        state_code: stateCode || null,
        district_slug: districtSlug || null,
        mandal_slug: districtSlug ? mandalSlug || null : null,
        category_slugs: interests,
        notify_breaking: notify.breaking,
        notify_local: notify.local,
        notify_topics: notify.topics,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['preferences'], data);
      setLanguage(data.language);
      setEdition(data.district?.slug ?? null);
      setMandal(data.mandal?.slug ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (prefs.isLoading || !me) return <LoadingState />;

  const categories = (config.data?.categories ?? []).filter((c) => c.show_in_nav);

  return (
    <ScrollView contentContainerStyle={styles.prefsScroll}>
      <View style={styles.profileHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{pick(me.user.name_te, me.user.name_en)}</Text>
          {me.user.phone ? <Text style={styles.profilePhone}>+{me.user.phone}</Text> : null}
        </View>
        <Pressable onPress={() => void signOut()} accessibilityRole="button" style={styles.signOut}>
          <Text style={styles.signOutText}>{t('auth.signOut')}</Text>
        </Pressable>
      </View>

      {/* my library ----------------------------------------------------- */}
      <View style={styles.libraryRow}>
        {(
          [
            ['/library/following', `◈ ${t('library.following')}`],
            ['/library/bookmarks', `⚑ ${t('library.bookmarks')}`],
            ['/library/history', `↺ ${t('library.history')}`],
            ['/submit', `✍ ${t('submit.title')}`],
          ] as const
        ).map(([href, label]) => (
          <Pressable
            key={href}
            onPress={() => router.push(href)}
            accessibilityRole="button"
            style={styles.libraryButton}
          >
            <Text style={styles.libraryText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* language ------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>{t('profile.language')}</Text>
      <View style={styles.chipRow}>
        <Chip label="తెలుగు" active={isTeluguUi} onPress={() => setTeluguUi(true)} />
        <Chip label="English" active={!isTeluguUi} onPress={() => setTeluguUi(false)} />
      </View>

      {/* theme — parity with the web app's dark mode -------------------- */}
      <Text style={styles.sectionTitle}>{isTelugu ? 'థీమ్' : 'Theme'}</Text>
      <View style={styles.chipRow}>
        {([
          ['system', isTelugu ? 'ఫోన్ సెట్టింగ్' : 'System'],
          ['light', isTelugu ? 'లైట్' : 'Light'],
          ['dark', isTelugu ? 'డార్క్' : 'Dark'],
        ] as const).map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            active={theme === value}
            onPress={() => setTheme(value)}
          />
        ))}
      </View>

      {/* font size (§4.1 — required) ------------------------------------ */}
      <Text style={styles.sectionTitle}>{t('profile.fontSize')}</Text>
      <View style={styles.chipRow}>
        {FONT_STEPS.map((step) => (
          <Chip key={step} label={step} active={fontStep === step} onPress={() => setFontStep(step)} />
        ))}
      </View>

      {/* location ------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>◉ {t('profile.location')}</Text>
      <Text style={styles.sectionHint}>{t('profile.locationHint')}</Text>
      <View style={styles.chipRow}>
        {config.data?.states.map((s) => (
          <Chip
            key={s.code}
            label={pick(s.name_te, s.name_en)}
            active={stateCode === s.code}
            onPress={() => {
              setStateCode(s.code);
              setDistrictSlug('');
              setMandalSlug('');
            }}
          />
        ))}
      </View>
      {stateCode ? (
        <View style={styles.chipWrap}>
          {districts.map((d) => (
            <Chip
              key={d.slug}
              label={pick(d.name_te, d.name_en)}
              active={districtSlug === d.slug}
              onPress={() => {
                setDistrictSlug(districtSlug === d.slug ? '' : d.slug);
                setMandalSlug('');
              }}
            />
          ))}
        </View>
      ) : null}
      {districtSlug && mandals.data?.length ? (
        <View style={styles.chipWrap}>
          {mandals.data.map((m) => (
            <Chip
              key={m.slug}
              label={pick(m.name_te, m.name_en)}
              active={mandalSlug === m.slug}
              onPress={() => setMandalSlug(mandalSlug === m.slug ? '' : m.slug)}
            />
          ))}
        </View>
      ) : null}

      {/* interests ------------------------------------------------------ */}
      <Text style={styles.sectionTitle}>{t('profile.interests')}</Text>
      <Text style={styles.sectionHint}>{t('profile.interestsHint')}</Text>
      <View style={styles.chipWrap}>
        {categories.map((c) => {
          const active = interests.includes(c.slug);
          return (
            <Chip
              key={c.slug}
              label={`${active ? '✓ ' : ''}${pick(c.name_te, c.name_en)}`}
              active={active}
              onPress={() =>
                setInterests((current) =>
                  active ? current.filter((s) => s !== c.slug) : [...current, c.slug],
                )
              }
            />
          );
        })}
      </View>

      {/* notifications -------------------------------------------------- */}
      <Text style={styles.sectionTitle}>{t('profile.notifications')}</Text>
      {(
        [
          ['breaking', t('profile.notifyBreaking')],
          ['local', t('profile.notifyLocal')],
          ['topics', t('profile.notifyTopics')],
        ] as const
      ).map(([key, label]) => (
        <View key={key} style={styles.switchRow}>
          <Text style={styles.switchLabel}>{label}</Text>
          <Switch
            value={notify[key]}
            onValueChange={(v) => setNotify((n) => ({ ...n, [key]: v }))}
            trackColor={{ true: color.brand, false: color.ruleStrong }}
            thumbColor={color.white}
          />
        </View>
      ))}

      <Pressable
        onPress={() => save.mutate()}
        disabled={save.isPending || !hydrated}
        accessibilityRole="button"
        style={[styles.primaryButton, styles.saveButton, save.isPending && styles.disabled]}
      >
        <Text style={styles.primaryButtonText}>
          {save.isPending ? t('profile.saving') : saved ? `✓ ${t('profile.saved')}` : t('profile.save')}
        </Text>
      </Pressable>
      {save.isError ? (
        <Text style={styles.errorText}>
          {save.error instanceof ApiError ? save.error.messageTe : String(save.error)}
        </Text>
      ) : null}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

export default function ProfileScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const status = useAuth((s) => s.status);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('profile.title')}</Text>
      </View>
      {status === 'idle' || status === 'loading' ? (
        <LoadingState />
      ) : status === 'anonymous' ? (
        <ScrollView contentContainerStyle={styles.signInScroll}>
          <SignIn />
        </ScrollView>
      ) : (
        <Preferences />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((color) => ({
  safe: { flex: 1, backgroundColor: color.canvas },
  header: {
    backgroundColor: color.paper,
    borderBottomWidth: 2,
    borderBottomColor: color.brand,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  title: { fontFamily: font.headline, fontSize: 20, lineHeight: 30, color: color.brand },
  signInScroll: { padding: 16 },
  card: {
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 10,
    padding: 18,
    gap: 12,
  },
  cardTitle: { fontFamily: font.teluguBold, fontSize: 20, lineHeight: 31, color: color.ink },
  cardHint: { fontFamily: font.telugu, fontSize: 13, lineHeight: 22, color: color.muted },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: color.ruleStrong,
    borderRadius: 8,
    backgroundColor: color.white,
    paddingHorizontal: 12,
  },
  phonePrefix: { fontFamily: font.telugu, fontSize: 15, color: color.muted, marginRight: 6 },
  phoneInput: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: font.telugu,
    fontSize: 16,
    color: color.ink,
  },
  otpInput: {
    borderWidth: 1.5,
    borderColor: color.ruleStrong,
    borderRadius: 8,
    backgroundColor: color.white,
    paddingHorizontal: 12,
    textAlign: 'center',
    letterSpacing: 8,
    fontSize: 20,
  },
  devOtp: {
    fontFamily: font.telugu,
    fontSize: 12,
    color: color.exclusive,
    backgroundColor: color.exclusiveTint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  primaryButton: {
    backgroundColor: color.brand,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButtonText: { fontFamily: font.teluguBold, fontSize: 15, lineHeight: 23, color: color.white },
  disabled: { opacity: 0.6 },
  otpActions: { flexDirection: 'row', justifyContent: 'space-between' },
  altAuthLink: { marginTop: 14, textAlign: 'center' },
  linkText: { fontFamily: font.teluguSemiBold, fontSize: 12.5, lineHeight: 19, color: color.info },
  errorText: {
    fontFamily: font.telugu,
    fontSize: 13,
    lineHeight: 21,
    color: color.breaking,
    backgroundColor: '#FDECEC',
    padding: 8,
    borderRadius: 6,
  },

  prefsScroll: { padding: 14 },
  libraryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  libraryButton: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 8,
    backgroundColor: color.paper,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  libraryText: { fontFamily: font.teluguSemiBold, fontSize: 13, lineHeight: 20, color: color.ink },
  profileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: color.ink,
    marginBottom: 4,
  },
  profileName: { fontFamily: font.teluguBold, fontSize: 20, lineHeight: 31, color: color.ink },
  profilePhone: { fontFamily: font.telugu, fontSize: 13, lineHeight: 20, color: color.muted },
  signOut: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  signOutText: { fontFamily: font.teluguSemiBold, fontSize: 12.5, lineHeight: 19, color: color.muted },
  sectionTitle: {
    fontFamily: font.teluguBold,
    fontSize: 16,
    lineHeight: 25,
    color: color.ink,
    marginTop: 18,
    marginBottom: 6,
  },
  sectionHint: {
    fontFamily: font.telugu,
    fontSize: 12.5,
    lineHeight: 20,
    color: color.muted,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: color.paper,
  },
  chipActive: { borderColor: color.brand, backgroundColor: color.brandTint },
  chipText: { fontFamily: font.telugu, fontSize: 13.5, lineHeight: 21, color: color.muted },
  chipTextActive: { color: color.brand, fontFamily: font.teluguSemiBold },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  switchLabel: { fontFamily: font.telugu, fontSize: 15, lineHeight: 24, color: color.ink },
  saveButton: { marginTop: 22 },
}));
