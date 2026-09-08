import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError } from '@/api/client';
import * as authApi from '@/features/auth/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';

/**
 * §4 — reader signup, forgotten password, reset, and email verification.
 *
 * These sit alongside the existing phone-OTP flow rather than replacing it:
 * a reader may hold either credential, or both. The OTP path is unchanged and
 * still the fastest way in, so the signup page links to it rather than hiding
 * it behind this longer form.
 */

const input =
  'w-full rounded-control border border-rule-input bg-white px-3 py-2.5 text-[15px] text-ink ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 dark:bg-surface';

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="th text-[26px] font-extrabold leading-tight text-ink">{title}</h1>
      <p className="te mt-1.5 text-[13px] leading-telugu text-muted">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </main>
  );
}

function Problem({ error }: { error: unknown }) {
  const { language } = useI18n();
  if (!error) return null;
  const api = error as ApiError;
  const message = api?.messageTe
    ? (language === 'te' ? api.messageTe : api.messageEn)
    : language === 'te' ? 'ఏదో తప్పు జరిగింది.' : 'Something went wrong.';
  return (
    <p role="alert" className="te mb-3 rounded-control border border-breaking-border bg-breaking-tint p-3 text-[13px] text-breaking">
      {message}
    </p>
  );
}

// --------------------------------------------------------------------------- //
// Register
// --------------------------------------------------------------------------- //
export function RegisterPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const nav = useNavigate();
  const setMe = useAuth((s) => s.setMe);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mismatch = confirm.length > 0 && password !== confirm;

  const register = useMutation({
    mutationFn: () => authApi.registerReader({
      name, email, password, confirm_password: confirm, phone: phone || undefined,
    }),
    onSuccess: (data) => { setMe(data.me); nav("/profile"); },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    register.mutate();
  }

  return (
    <Shell
      title={en ? 'Create your account' : 'ఖాతా సృష్టించండి'}
      subtitle={en
        ? 'Save stories, follow your district, and submit news of your own.'
        : 'కథనాలు సేవ్ చేసుకోండి, మీ జిల్లాను ఫాలో అవ్వండి, మీ వార్తలు పంపండి.'}
    >
      <Problem error={register.error} />
      <form onSubmit={submit} className="space-y-3.5">
        <label className="block">
          <span className="te mb-1 block text-[12.5px] font-bold text-ink">{en ? 'Name' : 'పేరు'}</span>
          <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)}
            className={`te ${input}`} autoComplete="name" />
        </label>
        <label className="block">
          <span className="te mb-1 block text-[12.5px] font-bold text-ink">{en ? 'Email' : 'ఇమెయిల్'}</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className={input} autoComplete="email" />
        </label>
        <label className="block">
          <span className="te mb-1 block text-[12.5px] font-bold text-ink">
            {en ? 'Phone' : 'ఫోన్'} <span className="font-normal text-muted">({en ? 'optional' : 'ఐచ్ఛికం'})</span>
          </span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel"
            placeholder="98480 12345" className={input} autoComplete="tel" />
          <span className="te mt-1 block text-[11.5px] text-muted">
            {en ? 'Lets you sign in with an OTP as well.' : 'OTP ద్వారా కూడా లాగిన్ అవ్వొచ్చు.'}
          </span>
        </label>
        <label className="block">
          <span className="te mb-1 block text-[12.5px] font-bold text-ink">{en ? 'Password' : 'పాస్‌వర్డ్'}</span>
          <input required type="password" minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="te mb-1 block text-[12.5px] font-bold text-ink">
            {en ? 'Confirm password' : 'పాస్‌వర్డ్ మళ్లీ'}
          </span>
          <input required type="password" minLength={8} value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className={input} autoComplete="new-password" />
          {mismatch ? (
            <span className="te mt-1 block text-[12px] text-breaking">
              {en ? 'Passwords do not match.' : 'పాస్‌వర్డ్‌లు సరిపోలలేదు.'}
            </span>
          ) : null}
        </label>
        <button disabled={register.isPending || mismatch}
          className="te min-h-tap w-full rounded-control bg-brand px-5 font-bold text-white disabled:opacity-60">
          {register.isPending ? (en ? 'Creating…' : 'సృష్టిస్తోంది…') : (en ? 'Create account' : 'ఖాతా సృష్టించండి')}
        </button>
      </form>

      <p className="te mt-5 text-center text-[13px] text-muted">
        {en ? 'Already have an account?' : 'ఇప్పటికే ఖాతా ఉందా?'}{' '}
        <Link to="/login" className="font-bold text-brand underline">{en ? 'Sign in' : 'లాగిన్'}</Link>
      </p>
    </Shell>
  );
}

// --------------------------------------------------------------------------- //
// Forgot password
// --------------------------------------------------------------------------- //
export function ForgotPasswordPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const [email, setEmail] = useState('');
  const request = useMutation({ mutationFn: () => authApi.requestPasswordReset(email) });

  return (
    <Shell
      title={en ? 'Reset your password' : 'పాస్‌వర్డ్ రీసెట్'}
      subtitle={en
        ? 'We will email you a link. It works once and expires in 15 minutes.'
        : 'మీ ఇమెయిల్‌కు లింక్ పంపుతాం. అది ఒకసారే పనిచేస్తుంది, 15 నిమిషాల్లో గడువు ముగుస్తుంది.'}
    >
      {request.isSuccess ? (
        <p className="te rounded-control border border-success/40 bg-success/10 p-3 text-[13px] text-success">
          {en
            ? 'If that address is registered, a reset link is on its way.'
            : 'ఆ చిరునామా నమోదై ఉంటే, రీసెట్ లింక్ పంపబడింది.'}
        </p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); request.mutate(); }} className="space-y-3.5">
          <label className="block">
            <span className="te mb-1 block text-[12.5px] font-bold text-ink">{en ? 'Email' : 'ఇమెయిల్'}</span>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className={input} autoComplete="email" />
          </label>
          <button disabled={request.isPending}
            className="te min-h-tap w-full rounded-control bg-brand px-5 font-bold text-white disabled:opacity-60">
            {request.isPending ? '…' : (en ? 'Send reset link' : 'లింక్ పంపండి')}
          </button>
        </form>
      )}
      <p className="te mt-5 text-center text-[13px] text-muted">
        <Link to="/login" className="font-bold text-brand underline">{en ? 'Back to sign in' : 'లాగిన్‌కు తిరిగి'}</Link>
      </p>
    </Shell>
  );
}

// --------------------------------------------------------------------------- //
// Reset password (from the emailed link)
// --------------------------------------------------------------------------- //
export function ResetPasswordPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && password !== confirm;

  const reset = useMutation({
    mutationFn: () => authApi.confirmPasswordReset(token, password),
    onSuccess: () => nav('/login'),
  });

  if (!token) {
    return (
      <Shell title={en ? 'Link not valid' : 'లింక్ చెల్లదు'}
        subtitle={en ? 'Request a new reset link.' : 'కొత్త రీసెట్ లింక్ అడగండి.'}>
        <Link to="/forgot-password" className="te font-bold text-brand underline">
          {en ? 'Request a link' : 'లింక్ అడగండి'}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title={en ? 'Choose a new password' : 'కొత్త పాస్‌వర్డ్'}
      subtitle={en
        ? 'Setting a new password signs you out of every other device.'
        : 'కొత్త పాస్‌వర్డ్ పెడితే మిగతా అన్ని పరికరాల నుంచి లాగ్ అవుట్ అవుతారు.'}>
      <Problem error={reset.error} />
      <form onSubmit={(e) => { e.preventDefault(); if (!mismatch) reset.mutate(); }} className="space-y-3.5">
        <label className="block">
          <span className="te mb-1 block text-[12.5px] font-bold text-ink">{en ? 'New password' : 'కొత్త పాస్‌వర్డ్'}</span>
          <input required type="password" minLength={10} value={password}
            onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="te mb-1 block text-[12.5px] font-bold text-ink">{en ? 'Confirm' : 'మళ్లీ టైప్ చేయండి'}</span>
          <input required type="password" minLength={10} value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className={input} autoComplete="new-password" />
          {mismatch ? (
            <span className="te mt-1 block text-[12px] text-breaking">
              {en ? 'Passwords do not match.' : 'పాస్‌వర్డ్‌లు సరిపోలలేదు.'}
            </span>
          ) : null}
        </label>
        <button disabled={reset.isPending || mismatch}
          className="te min-h-tap w-full rounded-control bg-brand px-5 font-bold text-white disabled:opacity-60">
          {reset.isPending ? '…' : (en ? 'Set password' : 'పాస్‌వర్డ్ మార్చండి')}
        </button>
      </form>
    </Shell>
  );
}

// --------------------------------------------------------------------------- //
// Email verification (from the emailed link)
// --------------------------------------------------------------------------- //
export function VerifyEmailPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);

  const verify = useMutation({
    mutationFn: () => authApi.verifyEmail(token),
    onSuccess: () => setDone(true),
  });

  // Verification is a one-click confirmation rather than an automatic call on
  // mount: link scanners in mail clients would otherwise burn the token before
  // the reader ever sees the page.
  return (
    <Shell title={en ? 'Verify your email' : 'ఇమెయిల్ ధృవీకరణ'}
      subtitle={en ? 'One tap confirms this address is yours.' : 'ఒక క్లిక్‌తో ఈ చిరునామా మీదని నిర్ధారించండి.'}>
      {!token ? (
        <p className="te text-[13px] text-breaking">{en ? 'This link is not valid.' : 'ఈ లింక్ చెల్లదు.'}</p>
      ) : done ? (
        <div className="space-y-3">
          <p className="te rounded-control border border-success/40 bg-success/10 p-3 text-[13px] text-success">
            {en ? 'Email verified. Thank you.' : 'ఇమెయిల్ ధృవీకరించబడింది. ధన్యవాదాలు.'}
          </p>
          <Link to="/profile" className="te font-bold text-brand underline">
            {en ? 'Go to your profile' : 'మీ ప్రొఫైల్‌కు వెళ్లండి'}
          </Link>
        </div>
      ) : (
        <>
          <Problem error={verify.error} />
          <button type="button" disabled={verify.isPending} onClick={() => verify.mutate()}
            className="te min-h-tap w-full rounded-control bg-brand px-5 font-bold text-white disabled:opacity-60">
            {verify.isPending ? '…' : (en ? 'Verify my email' : 'నా ఇమెయిల్ ధృవీకరించండి')}
          </button>
        </>
      )}
    </Shell>
  );
}
