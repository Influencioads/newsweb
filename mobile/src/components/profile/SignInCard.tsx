import { useState } from 'react';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import * as readerApi from '@/api/reader';
import { useI18n } from '@/lib/i18n';
import { radius, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Field, Input } from '@/ui/Input';
import { T } from '@/ui/Text';

/**
 * Sign-in card (§11 / §4) — OTP first because it is the fastest path, with
 * the email + password form as a second mode on the same card rather than a
 * separate screen. A phone number that has never been seen registers itself.
 *
 * The dev OTP the backend echoes in development is rendered only behind
 * `__DEV__`: a production bundle drops the branch, so a real one-time code
 * can never be painted on a reader's screen.
 */
const OTP_LENGTH = 6;
const PASSWORD_MIN = 8;

export function SignInCard() {
  const styles = useStyles();
  const { t, isTelugu } = useI18n();
  const L = (te: string, en: string) => (isTelugu ? te : en);
  const setMe = useAuth((s) => s.setMe);

  const [mode, setMode] = useState<'otp' | 'email'>('otp');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const [emailStep, setEmailStep] = useState<'signin' | 'register'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const describe = (e: unknown) =>
    e instanceof ApiError ? (isTelugu ? e.messageTe : e.messageEn) : t('state.errorTitle');

  async function sendOtp() {
    if (phone.replace(/\D/g, '').length < 10) return;
    setBusy(true);
    setError(null);
    try {
      const res = await readerApi.requestOtp(phone);
      // Never hold a live OTP in state outside development.
      setDevOtp(__DEV__ ? res.dev_otp : null);
      setOtp('');
      setStep('otp');
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (otp.length < OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const res = await readerApi.verifyReaderOtp(phone, otp);
      setMe(res.me);
    } catch (e) {
      setError(describe(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail() {
    setBusy(true);
    setError(null);
    try {
      const res =
        emailStep === 'register'
          ? await readerApi.registerReader({
              name,
              email,
              password,
              confirm_password: confirm,
              phone: phone || undefined,
            })
          : await readerApi.loginWithPassword(email, password);
      setMe(res.me);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  const emailInvalid =
    !email.trim() ||
    password.length < PASSWORD_MIN ||
    (emailStep === 'register' && (name.trim().length < 2 || password !== confirm));

  const errorLine = error ? (
    <View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <T variant="bodySmall" color="breaking">
        {error}
      </T>
    </View>
  ) : null;

  if (mode === 'email') {
    const register = emailStep === 'register';
    return (
      <Card padding="lg" style={styles.card}>
        <T variant="headlineMd" weight="bold" accessibilityRole="header">
          {register ? L('ఖాతా సృష్టించండి', 'Create your account') : L('ఇమెయిల్‌తో లాగిన్', 'Sign in with email')}
        </T>

        {register ? (
          <Field label={L('పేరు', 'Name')}>
            <Input value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
          </Field>
        ) : null}
        <Field label={L('ఇమెయిల్', 'Email')}>
          <Input
            value={email}
            onChangeText={setEmail}
            leading="mail"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            lang="en"
          />
        </Field>
        <Field label={L('పాస్‌వర్డ్', 'Password')} hint={L('కనీసం 8 అక్షరాలు', 'At least 8 characters')}>
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={register ? 'new-password' : 'current-password'}
            lang="en"
          />
        </Field>
        {register ? (
          <Field
            label={L('పాస్‌వర్డ్ మళ్లీ', 'Confirm password')}
            error={
              confirm.length > 0 && password !== confirm
                ? L('పాస్‌వర్డ్‌లు సరిపోలలేదు', 'Passwords do not match')
                : undefined
            }
          >
            <Input value={confirm} onChangeText={setConfirm} secureTextEntry lang="en" />
          </Field>
        ) : null}

        <Button
          label={
            busy
              ? L('ఆగండి…', 'Please wait…')
              : register
                ? L('ఖాతా సృష్టించండి', 'Create account')
                : L('లాగిన్', 'Sign in')
          }
          icon="logIn"
          pending={busy}
          disabled={emailInvalid}
          onPress={() => void submitEmail()}
          full
        />

        <View style={styles.links}>
          <Button
            label={
              register ? L('ఖాతా ఉందా? లాగిన్', 'Have an account? Sign in') : L('కొత్త ఖాతా', 'Create an account')
            }
            variant="ghost"
            onPress={() => setEmailStep(register ? 'signin' : 'register')}
          />
          <Button label={L('OTP ద్వారా', 'Use OTP instead')} variant="ghost" onPress={() => setMode('otp')} />
        </View>

        {errorLine}
      </Card>
    );
  }

  return (
    <Card padding="lg" style={styles.card}>
      <T variant="headlineMd" weight="bold" accessibilityRole="header">
        {step === 'phone' ? t('auth.signIn') : t('auth.enterOtp')}
      </T>

      {step === 'phone' ? (
        <>
          <Field label={t('auth.phone')} hint={t('auth.phoneHint')}>
            <Input
              value={phone}
              onChangeText={setPhone}
              leading="phone"
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="+91 98480 12345"
              lang="en"
            />
          </Field>
          <Button
            label={busy ? t('auth.sending') : t('auth.sendOtp')}
            icon="send"
            pending={busy}
            disabled={phone.replace(/\D/g, '').length < 10}
            onPress={() => void sendOtp()}
            full
          />
        </>
      ) : (
        <>
          <Field label={t('auth.enterOtp')} hint={phone}>
            <Input
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={OTP_LENGTH}
              placeholder="000000"
              lang="en"
            />
          </Field>
          {__DEV__ && devOtp ? <Badge tone="exclusive" size="xs" label={`DEV OTP ${devOtp}`} /> : null}
          <Button
            label={busy ? t('auth.verifying') : t('auth.verify')}
            icon="check"
            pending={busy}
            disabled={otp.length < OTP_LENGTH}
            onPress={() => void verify()}
            full
          />
          <View style={styles.links}>
            <Button label={t('auth.changeNumber')} variant="ghost" onPress={() => setStep('phone')} />
            <Button label={t('auth.resend')} variant="ghost" disabled={busy} onPress={() => void sendOtp()} />
          </View>
        </>
      )}

      {errorLine}

      <Button
        label={L('ఇమెయిల్ / పాస్‌వర్డ్‌తో లాగిన్', 'Sign in with email and password')}
        variant="ghost"
        icon="mail"
        onPress={() => setMode('email')}
      />
    </Card>
  );
}

const useStyles = makeStyles((color) => ({
  card: { gap: space.md },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  error: {
    backgroundColor: color.breakingTint,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
}));
