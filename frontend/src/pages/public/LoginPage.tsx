import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';

import { ApiError } from '@/api/client';
import * as authApi from '@/features/auth/api';
import { OtpInput } from '@/features/auth/components/OtpInput';
import * as readerApi from '@/features/reader/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';

/**
 * Reader sign-in (updated doc §11): phone → OTP → signed in.
 *
 * There is no separate registration form — a verified OTP for a new number
 * creates the subscriber account (`is_new_account` in the response), after
 * which the reader lands on their profile to pick location and interests.
 * Staff continue to use /admin/login; this page never grants CMS access.
 */
export default function LoginPage() {
  const { language } = useI18n();
  const te = language === 'te';
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const setMe = useAuth((s) => s.setMe);
  const status = useAuth((s) => s.status);

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'authenticated') navigate(location.state?.from ?? '/', { replace: true });
  }, [status, navigate, location.state?.from]);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  function startResendTimer() {
    setResendIn(30);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setResendIn((s) => {
        if (s <= 1 && timerRef.current) window.clearInterval(timerRef.current);
        return Math.max(0, s - 1);
      });
    }, 1000);
  }

  async function requestOtp(event?: FormEvent) {
    event?.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setError(te ? 'సరైన ఫోన్ నంబర్ నమోదు చేయండి.' : 'Enter a valid phone number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.requestOtp(phone);
      setDevOtp(res.dev_otp);
      setStep('otp');
      setOtp('');
      startResendTimer();
    } catch (e) {
      setError(e instanceof ApiError ? (te ? e.messageTe : e.messageEn) : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (otp.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await readerApi.verifyReaderOtp(phone, otp);
      setMe(res.me);
      if (res.is_new_account) {
        navigate('/profile', { replace: true, state: { welcome: true } });
      } else {
        navigate(location.state?.from ?? '/', { replace: true });
      }
    } catch (e) {
      setError(e instanceof ApiError ? (te ? e.messageTe : e.messageEn) : String(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  }

  const teCls = te ? 'te' : 'font-sans';

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-[440px] flex-col justify-center px-4 py-10">
      <div className="border border-rule bg-paper p-6 shadow-card sm:p-8">
        <p className="font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
          {te ? 'పాఠకుల ఖాతా' : 'READER ACCOUNT'}
        </p>
        <h1 className={`${te ? 'th' : 'font-sans'} mt-1 text-[24px] font-extrabold leading-[1.4] text-ink`}>
          {step === 'phone'
            ? te ? 'సైన్ ఇన్ / నమోదు' : 'Sign in or register'
            : te ? 'OTP నమోదు చేయండి' : 'Enter the OTP'}
        </h1>
        <p className={`${teCls} mt-2 text-[13.5px] leading-[1.7] text-muted`}>
          {step === 'phone'
            ? te
              ? 'మీ ఫోన్ నంబర్‌కు OTP పంపుతాం. కొత్త నంబర్ అయితే ఖాతా దానంతట అదే సృష్టించబడుతుంది.'
              : 'We will send an OTP to your phone. A new number gets an account automatically.'
            : te
              ? `${phone} నంబర్‌కు పంపిన 6 అంకెల కోడ్ నమోదు చేయండి.`
              : `Enter the 6-digit code sent to ${phone}.`}
        </p>

        {step === 'phone' ? (
          <form onSubmit={requestOtp} className="mt-5">
            <label htmlFor="reader-phone" className={`${teCls} mb-1 block text-[12.5px] font-semibold text-ink`}>
              {te ? 'ఫోన్ నంబర్' : 'Phone number'}
            </label>
            <div className="flex items-center gap-2 rounded-control border-2 border-rule-input bg-white px-3 focus-within:border-brand">
              <Phone className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="font-sans text-[15px] text-muted">+91</span>
              <input
                id="reader-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98480 12345"
                className="min-w-0 flex-1 bg-transparent py-3 font-sans text-[16px] text-ink outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className={`${teCls} mt-4 w-full rounded-control bg-brand py-3 text-[15px] font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60`}
            >
              {busy ? (te ? 'పంపుతోంది…' : 'Sending…') : te ? 'OTP పంపండి' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-5">
            <OtpInput
              id="reader-otp"
              label={te ? 'OTP కోడ్' : 'OTP code'}
              value={otp}
              onChange={setOtp}
              autoFocus
              disabled={busy}
            />
            {devOtp ? (
              <p className="mt-2 rounded bg-exclusive-tint px-2 py-1 font-mono text-[12px] text-exclusive-text">
                DEV OTP: {devOtp}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || otp.length < 6}
              className={`${teCls} mt-4 w-full rounded-control bg-brand py-3 text-[15px] font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60`}
            >
              {busy ? (te ? 'పరిశీలిస్తోంది…' : 'Verifying…') : te ? 'నిర్ధారించండి' : 'Verify'}
            </button>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => { setStep('phone'); setError(null); }}
                className={`${teCls} text-[12.5px] font-semibold text-info hover:underline`}
              >
                {te ? '← నంబర్ మార్చండి' : '← Change number'}
              </button>
              <button
                type="button"
                disabled={resendIn > 0 || busy}
                onClick={() => requestOtp()}
                className={`${teCls} text-[12.5px] font-semibold text-info hover:underline disabled:text-muted disabled:no-underline`}
              >
                {resendIn > 0
                  ? te ? `మళ్లీ పంపడానికి ${resendIn}s` : `Resend in ${resendIn}s`
                  : te ? 'మళ్లీ పంపండి' : 'Resend OTP'}
              </button>
            </div>
          </form>
        )}

        {error ? (
          <p role="alert" className={`${teCls} mt-3 rounded bg-breaking-tint px-3 py-2 text-[13px] text-breaking`}>
            {error}
          </p>
        ) : null}
      </div>

      <p className={`${teCls} mt-4 text-center text-[12px] text-muted`}>
        {te ? 'సిబ్బంది లాగిన్ ' : 'Newsroom staff sign in '}
        <Link to="/admin/login" className="font-semibold text-info hover:underline">
          {te ? 'ఇక్కడ' : 'here'}
        </Link>
      </p>
    </main>
  );
}
