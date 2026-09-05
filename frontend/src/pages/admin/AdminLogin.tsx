import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { ApiError } from '@/api/client';
import * as authApi from '@/features/auth/api';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useAuth } from '@/stores/auth';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { useI18n } from '@/i18n';

/**
 * Newsroom CMS sign-in — mockup `1k`.
 *
 * Two routes into the same CMS, exactly as §6.2 specifies:
 *   * field staff (reporters, stringers) — phone + OTP, because "many work from
 *     feature-phone-era habits and passwords get shared"
 *   * desk staff, editors, admins — email + password + mandatory TOTP
 */

type Panel = 'otp' | 'password';

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[330px] rounded-card border border-black/[0.09] bg-white p-[22px] shadow-card">
      {children}
    </div>
  );
}

function CardHeading({ subtitle }: { subtitle: string }) {
  const { language } = useI18n();
  return (
    <>
      <h1 className={`${language === 'te' ? 'th' : 'font-sans'} text-[17px] font-extrabold text-brand`}>
        {language === 'te' ? 'టాప్ తెలుగు · న్యూస్‌రూమ్' : 'Top Telugu · Newsroom'}
      </h1>
      <p className={`${language === 'te' ? 'te' : 'font-sans'} mb-4 mt-0.5 text-[12px] text-muted`}>{subtitle}</p>
    </>
  );
}

function FieldLabel({ htmlFor, children, telugu = true }: {
  htmlFor: string;
  children: React.ReactNode;
  telugu?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={[
        'mb-1.5 block font-semibold text-ink',
        telugu ? 'te text-[11.5px]' : 'text-[11px]',
      ].join(' ')}
    >
      {children}
    </label>
  );
}

function ErrorBanner({ error }: { error: unknown }) {
  const { language } = useI18n();
  if (!error) return null;
  const isApi = error instanceof ApiError;
  return (
    <div
      role="alert"
      className="mt-3 rounded-control border border-breaking-border bg-breaking-tint px-3 py-2"
    >
      <p className={`${language === 'te' ? 'te leading-telugu' : 'font-sans'} text-[12px] text-[#8E2A31]`}>
        {isApi ? (language === 'en' ? error.messageEn : error.messageTe) : (language === 'en' ? 'Something went wrong. Please try again.' : 'ఏదో పొరపాటు జరిగింది. మళ్లీ ప్రయత్నించండి.')}
      </p>
      {isApi && language === 'te' && error.messageEn ? (
        <p className="mt-0.5 font-sans text-[10.5px] text-muted-light">{error.messageEn}</p>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// OTP panel — reporters and stringers
// --------------------------------------------------------------------------- //
function OtpPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const { language } = useI18n();
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

  return (
    <Card>
      <CardHeading subtitle={en ? 'Reporter / stringer sign in' : 'రిపోర్టర్ / స్ట్రింగర్ లాగిన్'} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!sent) request.mutate();
          else if (otp.length === 6) verify.mutate();
        }}
      >
        <FieldLabel htmlFor="phone" telugu={!en}>{en ? 'Phone number' : 'ఫోన్ నంబర్'}</FieldLabel>
        <div className="flex items-center gap-2 rounded-control border border-rule-input px-3 py-2.5 focus-within:border-brand">
          <span className="font-sans text-[14px] text-muted-light">+91</span>
          <input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            disabled={sent}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98480 12345"
            className="w-full bg-transparent font-sans text-[14px] font-medium text-ink outline-none placeholder:text-muted-light/70 disabled:opacity-60"
          />
        </div>

        {sent ? (
          <>
            <div className="mt-3.5">
              <FieldLabel htmlFor="otp-0" telugu={!en}>{en ? 'OTP — 6 digits received by SMS' : 'OTP — SMSలో వచ్చిన 6 అంకెలు'}</FieldLabel>
              <OtpInput id="otp-0" label="OTP" value={otp} onChange={setOtp} autoFocus />
            </div>

            <p className={`${en ? 'font-sans' : 'te'} mt-2 text-[11px] text-muted-light`}>
              {secondsLeft > 0 ? (
                <>{en ? 'Resend' : 'మళ్లీ పంపండి'} — 00:{String(secondsLeft).padStart(2, '0')}</>
              ) : (
                <button
                  type="button"
                  onClick={() => request.mutate()}
                  className="font-semibold text-brand underline"
                >
                  {en ? 'Resend' : 'మళ్లీ పంపండి'}
                </button>
              )}{' '}
              · <span className="text-breaking">{en ? '5 attempts / 15 min' : '5 ప్రయత్నాలు / 15 నిమి.'}</span>
            </p>

            {devOtp ? (
              <p className="mt-2 rounded border border-exclusive-border bg-exclusive-tint px-2 py-1 font-mono text-[10.5px] text-exclusive-text">
                dev only · OTP {devOtp}
              </p>
            ) : null}
          </>
        ) : null}

        <ErrorBanner error={request.error ?? verify.error} />

        <button
          type="submit"
          disabled={sent ? otp.length !== 6 || verify.isPending : !canRequest}
          className="te mt-3.5 flex min-h-tap w-full items-center justify-center gap-2 rounded-control bg-brand px-4 font-bold leading-telugu text-white transition-opacity hover:bg-brand-dark disabled:opacity-50"
        >
          {(request.isPending || verify.isPending) && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          )}
          {sent ? (en ? 'Sign in' : 'లాగిన్') : (en ? 'Send OTP' : 'OTP పంపండి')}
        </button>
      </form>
    </Card>
  );
}

// --------------------------------------------------------------------------- //
// Password panel — desk, editors, admins
// --------------------------------------------------------------------------- //
function PasswordPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const { language } = useI18n();
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
    <Card>
      <CardHeading subtitle={en ? 'Desk / editor / admin sign in' : 'డెస్క్ / ఎడిటర్ / అడ్మిన్ లాగిన్'} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <FieldLabel htmlFor="email" telugu={false}>
          Email
        </FieldLabel>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="lakshmi@topten.news"
          className="w-full rounded-control border border-rule-input px-3 py-2.5 font-sans text-[13px] font-medium text-ink outline-none placeholder:text-muted-light/70 focus:border-brand"
        />

        <div className="mt-3">
          <FieldLabel htmlFor="password" telugu={false}>
            Password
          </FieldLabel>
          <div className="flex items-center gap-2 rounded-control border border-rule-input px-3 py-2.5 focus-within:border-brand">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent font-sans text-[13px] font-medium text-ink outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="shrink-0 font-sans text-[11px] text-muted-light hover:text-ink"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {needsTotp ? (
          <div className="mt-3.5 rounded-control border border-rule bg-paper-sub p-3">
            <p className="mb-1.5 font-sans text-[10px] font-bold uppercase tracking-[0.06em] text-ink-soft">
              Step 2 · TOTP code{' '}
              <span className="font-normal normal-case text-muted-light">
                — mandatory 2FA for desk staff
              </span>
            </p>
            <OtpInput id="totp-0" label="TOTP code" value={totp} onChange={setTotp} size="sm" autoFocus />
          </div>
        ) : null}

        <ErrorBanner error={login.error} />

        <button
          type="submit"
          disabled={login.isPending || !email || !password || (needsTotp && totp.length !== 6)}
          className="te mt-3.5 flex min-h-tap w-full items-center justify-center gap-2 rounded-control bg-ink px-4 font-bold leading-telugu text-white transition-opacity hover:bg-ink-panel disabled:opacity-50"
        >
          {login.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {en ? 'Sign in →' : 'సైన్ ఇన్ →'}
        </button>

        <p className="mt-2 font-sans text-[10px] text-muted-light">
          admin / super_admin: + optional IP allowlist
        </p>
      </form>
    </Card>
  );
}

// --------------------------------------------------------------------------- //
export default function AdminLogin() {
  const { language } = useI18n();
  const en = language === 'en';
  const navigate = useNavigate();
  const location = useLocation();
  const [panel, setPanel] = useState<Panel>('password');

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? '/admin/dashboard';

  function handleSignedIn() {
    navigate(redirectTo, { replace: true });
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="absolute right-4 top-4"><LanguageToggle /></div>
      {/* Below md the two cards would stack into a confusing double form, so the
          panel is chosen with a toggle and only one is shown. */}
      <div className="mb-4 flex gap-1 rounded-control border border-rule bg-white p-1 md:hidden">
        {(
          [
            ['password', en ? 'Desk / editor' : 'డెస్క్ / ఎడిటర్'],
            ['otp', en ? 'Reporter / stringer' : 'రిపోర్టర్ / స్ట్రింగర్'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPanel(key)}
            aria-pressed={panel === key}
            className={[
              'te min-h-[40px] rounded-[6px] px-3 text-[12px] font-semibold transition-colors',
              panel === key ? 'bg-ink text-white' : 'text-muted',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex w-full flex-col items-center gap-4 md:flex-row md:items-start md:justify-center">
        <div className={panel === 'otp' ? 'contents' : 'hidden md:contents'}>
          <OtpPanel onSignedIn={handleSignedIn} />
        </div>
        <div className={panel === 'password' ? 'contents' : 'hidden md:contents'}>
          <PasswordPanel onSignedIn={handleSignedIn} />
        </div>
      </div>
    </main>
  );
}
