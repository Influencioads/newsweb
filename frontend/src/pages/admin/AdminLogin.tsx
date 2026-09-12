import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';

import { ApiError } from '@/api/client';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { PageContainer } from '@/components/ui/Layout';
import { ErrorState } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import * as authApi from '@/features/auth/api';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * Newsroom CMS sign-in — mockup `1k`.
 *
 * Two routes into the same CMS, exactly as §6.2 specifies:
 *   * field staff (reporters, stringers) — phone + OTP, because "many work from
 *     feature-phone-era habits and passwords get shared"
 *   * desk staff, editors, admins — email + password + mandatory TOTP
 *
 * Both panels stay mounted (a Tabs switch hides the other with `hidden`) so a
 * half-entered OTP countdown survives a peek at the other tab. This page sits
 * outside AdminLayout, so it owns its own `<main id="main">`.
 */

type Panel = 'otp' | 'password';

function PanelIntro({ children }: { children: ReactNode }) {
  const s = useScript();
  return <p className={cn(s.body, 'text-muted', s.te ? 'text-te-body-xs' : 'text-ui')}>{children}</p>;
}

// --------------------------------------------------------------------------- //
// OTP panel — reporters and stringers
// --------------------------------------------------------------------------- //
function OtpPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const { language } = useI18n();
  const s = useScript();
  const en = language === 'en';
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const setMe = useAuth((s) => s.setMe);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  const request = useMutation({
    mutationFn: () => authApi.requestOtp(phone),
    onSuccess: (data) => {
      setSent(true);
      setSecondsLeft(30);
      setDevOtp(data.dev_otp);
      if (data.dev_otp) setOtp(data.dev_otp);
    },
  });

  const verify = useMutation({
    mutationFn: () => authApi.verifyOtp(phone, otp),
    onSuccess: (data) => {
      setMe(data.me);
      onSignedIn();
    },
  });

  const phoneDigits = phone.replace(/\D/g, '');
  const canRequest = phoneDigits.length >= 10 && !request.isPending;
  const error = request.error ?? verify.error;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!sent) request.mutate();
        else if (otp.length === 6) verify.mutate();
      }}
    >
      <PanelIntro>{en ? 'Reporter / stringer sign in' : 'రిపోర్టర్ / స్ట్రింగర్ లాగిన్'}</PanelIntro>

      <Field label={en ? 'Phone number' : 'ఫోన్ నంబర్'} htmlFor="phone">
        <div className="flex items-center gap-2">
          <span className="font-sans text-ui text-muted">+91</span>
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            script="en"
            value={phone}
            disabled={sent}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98480 12345"
          />
        </div>
      </Field>

      {sent ? (
        <>
          <Field label={en ? 'OTP — 6 digits received by SMS' : 'OTP — SMSలో వచ్చిన 6 అంకెలు'} htmlFor="otp-0">
            <OtpInput id="otp-0" label="OTP" value={otp} onChange={setOtp} autoFocus />
          </Field>

          <p className={cn(s.body, 'flex flex-wrap items-center gap-x-2 text-meta text-muted')}>
            {secondsLeft > 0 ? (
              <span>
                {en ? 'Resend' : 'మళ్లీ పంపండి'} — 00:{String(secondsLeft).padStart(2, '0')}
              </span>
            ) : (
              <Button variant="link" size="sm" pending={request.isPending} onClick={() => request.mutate()}>
                {en ? 'Resend' : 'మళ్లీ పంపండి'}
              </Button>
            )}
            <span aria-hidden>·</span>
            <span className="text-breaking">{en ? '5 attempts / 15 min' : '5 ప్రయత్నాలు / 15 నిమి.'}</span>
          </p>

          {devOtp ? (
            <p className="rounded-xl border border-exclusive-border bg-exclusive-tint px-3 py-2 font-mono text-meta text-exclusive-text">
              dev only · OTP {devOtp}
            </p>
          ) : null}
        </>
      ) : null}

      {error ? <ErrorState compact error={error} /> : null}

      <Button
        type="submit"
        size="lg"
        full
        pending={request.isPending || verify.isPending}
        disabled={sent ? otp.length !== 6 || verify.isPending : !canRequest}
      >
        {sent ? (en ? 'Sign in' : 'లాగిన్') : en ? 'Send OTP' : 'OTP పంపండి'}
      </Button>
    </form>
  );
}

// --------------------------------------------------------------------------- //
// Password panel — desk, editors, admins
// --------------------------------------------------------------------------- //
function PasswordPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const { language } = useI18n();
  const s = useScript();
  const en = language === 'en';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);

  const setMe = useAuth((s) => s.setMe);

  const login = useMutation({
    mutationFn: () =>
      authApi.loginWithPassword({
        email,
        password,
        ...(totp ? { totp_code: totp } : {}),
      }),
    onSuccess: (data) => {
      setMe(data.me);
      onSignedIn();
    },
    onError: (error) => {
      // The backend asks for the second factor only when the account has it on.
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_REQUIRED') {
        setNeedsTotp(true);
      }
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        login.mutate();
      }}
    >
      <PanelIntro>{en ? 'Desk / editor / admin sign in' : 'డెస్క్ / ఎడిటర్ / అడ్మిన్ లాగిన్'}</PanelIntro>

      <Field label={en ? 'Email' : 'ఇమెయిల్'} htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="username"
          script="en"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="lakshmi@topten.news"
        />
      </Field>

      <Field label={en ? 'Password' : 'పాస్‌వర్డ్'} htmlFor="password">
        <Input
          id="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          script="en"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          trailing={
            <IconButton
              icon={showPassword ? EyeOff : Eye}
              label={showPassword ? (en ? 'Hide password' : 'పాస్‌వర్డ్ దాచండి') : en ? 'Show password' : 'పాస్‌వర్డ్ చూపించండి'}
              onClick={() => setShowPassword((v) => !v)}
            />
          }
        />
      </Field>

      {needsTotp ? (
        <div className="rounded-xl border border-rule bg-paper-sub p-4">
          <Field
            label={en ? 'Step 2 · TOTP code' : 'దశ 2 · TOTP కోడ్'}
            hint={en ? 'mandatory 2FA for desk staff' : 'డెస్క్ సిబ్బందికి 2FA తప్పనిసరి'}
            htmlFor="totp-0"
          >
            <OtpInput id="totp-0" label={en ? 'TOTP code' : 'TOTP కోడ్'} value={totp} onChange={setTotp} autoFocus />
          </Field>
        </div>
      ) : null}

      {login.error ? <ErrorState compact error={login.error} /> : null}

      <Button
        type="submit"
        size="lg"
        full
        iconRight={ArrowRight}
        pending={login.isPending}
        disabled={!email || !password || (needsTotp && totp.length !== 6)}
      >
        {en ? 'Sign in' : 'సైన్ ఇన్'}
      </Button>

      <p className={cn(s.body, 'text-meta text-muted')}>
        {en ? 'admin / super_admin: + optional IP allowlist' : 'admin / super_admin: + ఐచ్ఛిక IP అనుమతి జాబితా'}
      </p>
    </form>
  );
}

// --------------------------------------------------------------------------- //
export default function AdminLogin() {
  const { language, t } = useI18n();
  const s = useScript();
  const en = language === 'en';
  const navigate = useNavigate();
  const location = useLocation();
  const [panel, setPanel] = useState<Panel>('password');
  useDocumentTitle(t('admin.page.login'));

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/admin/dashboard';

  function handleSignedIn() {
    navigate(redirectTo, { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas-cms">
      <header className="flex items-center justify-end px-4 py-3 md:px-6">
        <LanguageToggle />
      </header>
      <PageContainer as="main" id="main" tabIndex={-1} width="form" className="flex flex-1 flex-col justify-center pb-10 outline-none">
        <Card padding="lg">
          <div className="mb-6">
            <p lang="te" className="th text-headline-lg font-extrabold text-brand">
              టాప్ తెలుగు
            </p>
            <h1 className={cn(s.head, 'text-headline-sm font-bold text-ink')}>{t('admin.page.login')}</h1>
          </div>

          <Tabs
            ariaLabel={t('nav.signIn')}
            className="mb-5"
            items={[
              { key: 'password', label: en ? 'Desk / editor' : 'డెస్క్ / ఎడిటర్' },
              { key: 'otp', label: en ? 'Reporter / stringer' : 'రిపోర్టర్ / స్ట్రింగర్' },
            ]}
            value={panel}
            onChange={(key) => setPanel(key === 'otp' ? 'otp' : 'password')}
          />

          <div role="tabpanel" hidden={panel !== 'password'}>
            <PasswordPanel onSignedIn={handleSignedIn} />
          </div>
          <div role="tabpanel" hidden={panel !== 'otp'}>
            <OtpPanel onSignedIn={handleSignedIn} />
          </div>
        </Card>
      </PageContainer>
    </div>
  );
}
