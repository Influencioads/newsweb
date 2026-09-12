import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Phone } from 'lucide-react';

import { Button, linkClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { ErrorState } from '@/components/ui/State';
import * as authApi from '@/features/auth/api';
import { OtpInput } from '@/features/auth/components/OtpInput';
import * as readerApi from '@/features/reader/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * Reader sign-in (updated doc §11): phone → OTP → signed in.
 *
 * There is no separate registration form — a verified OTP for a new number
 * creates the subscriber account (`is_new_account` in the response), after
 * which the reader lands on their profile to pick location and interests.
 * Staff continue to use /admin/login; this page never grants CMS access.
 *
 * Same auth card as the four AccountPages: form-width container, one `lg` Card,
 * 48px controls, errors above the form, full-width primary action.
 */
const RESEND_SECONDS = 30;

/** `98480 12345` → `+91 ••••• 12345` — enough to recognise, not enough to leak. */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 5) return phone;
  return `+91 ${'•'.repeat(Math.max(0, digits.length - 5))} ${digits.slice(-5)}`;
}

export default function LoginPage() {
  const { language, t } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const setMe = useAuth((st) => st.setMe);
  const status = useAuth((st) => st.status);
  useDocumentTitle(t('page.login'));

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'authenticated') navigate(location.state?.from ?? '/', { replace: true });
  }, [status, navigate, location.state?.from]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  function startResendTimer() {
    setResendIn(RESEND_SECONDS);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setResendIn((left) => {
        if (left <= 1 && timerRef.current) window.clearInterval(timerRef.current);
        return Math.max(0, left - 1);
      });
    }, 1000);
  }

  const request = useMutation({
    mutationFn: () => authApi.requestOtp(phone),
    onSuccess: (res) => {
      setDevOtp(res.dev_otp);
      setStep('otp');
      setOtp('');
      startResendTimer();
    },
  });

  const verify = useMutation({
    mutationFn: () => readerApi.verifyReaderOtp(phone, otp),
    onSuccess: (res) => {
      setMe(res.me);
      if (res.is_new_account) navigate('/profile', { replace: true, state: { welcome: true } });
      else navigate(location.state?.from ?? '/', { replace: true });
    },
    // A wrong code clears the boxes so the reader retypes rather than edits.
    onError: () => setOtp(''),
  });

  function submitPhone(event?: FormEvent) {
    event?.preventDefault();
    if (phone.replace(/\D/g, '').length < 10) {
      setPhoneError(L('సరైన ఫోన్ నంబర్ నమోదు చేయండి.', 'Enter a valid phone number.'));
      return;
    }
    setPhoneError(null);
    request.mutate();
  }

  function submitOtp(event?: FormEvent) {
    event?.preventDefault();
    if (otp.length === 6 && !verify.isPending) verify.mutate();
  }

  const onPhoneStep = step === 'phone';
  const error = onPhoneStep ? request.error : (verify.error ?? request.error);
  const bodyText = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');

  return (
    <PageContainer width="form" className="py-8 md:py-12">
      <Card padding="lg" radius="2xl">
        <p lang="te" className="th text-headline-lg font-extrabold text-brand">
          టాప్ తెలుగు
        </p>
        <PageHeader
          eyebrow={L('పాఠకుల ఖాతా', 'Reader account')}
          title={onPhoneStep ? L('సైన్ ఇన్ / నమోదు', 'Sign in or register') : L('OTP నమోదు చేయండి', 'Enter the OTP')}
          subtitle={
            onPhoneStep
              ? L(
                  'మీ ఫోన్ నంబర్‌కు OTP పంపుతాం. కొత్త నంబర్ అయితే ఖాతా దానంతట అదే సృష్టించబడుతుంది.',
                  'We will send an OTP to your phone. A new number gets an account automatically.',
                )
              : L('పంపిన 6 అంకెల కోడ్ నమోదు చేయండి:', 'Enter the 6-digit code we sent to:')
          }
        />

        {!onPhoneStep ? (
          // The dots are decoration; what is spoken is the part that identifies the number.
          <p
            lang={language}
            aria-label={L(
              `${phone.replace(/\D/g, '').slice(-5)}తో ముగిసే నంబర్`,
              `Number ending ${phone.replace(/\D/g, '').slice(-5)}`,
            )}
            className="mb-5 font-sans text-headline-sm font-bold tabular-nums text-ink"
          >
            <span aria-hidden>{maskPhone(phone)}</span>
          </p>
        ) : null}

        {error ? <ErrorState compact error={error} className="mb-2" /> : null}

        {onPhoneStep ? (
          <form onSubmit={submitPhone} className="space-y-5">
            <Field label={L('ఫోన్ నంబర్', 'Phone number')} htmlFor="reader-phone" error={phoneError}>
              <div className="flex items-center gap-2">
                <span className="font-sans text-ui text-muted">+91</span>
                <Input
                  id="reader-phone"
                  size="lg"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  script="en"
                  leading={Phone}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="98480 12345"
                />
              </div>
            </Field>
            <Button type="submit" size="lg" full pending={request.isPending}>
              {L('OTP పంపండి', 'Send OTP')}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="space-y-5">
            <Field label={L('OTP కోడ్', 'OTP code')} htmlFor="reader-otp">
              <OtpInput
                id="reader-otp"
                label={L('OTP కోడ్', 'OTP code')}
                value={otp}
                onChange={setOtp}
                onComplete={() => submitOtp()}
                autoFocus
                disabled={verify.isPending}
              />
            </Field>

            {devOtp ? (
              <p className="rounded-xl border border-exclusive-border bg-exclusive-tint px-3 py-2 font-mono text-meta text-exclusive-text">
                dev only · OTP {devOtp}
              </p>
            ) : null}

            <Button type="submit" size="lg" full pending={verify.isPending} disabled={otp.length < 6}>
              {L('నిర్ధారించండి', 'Verify')}
            </Button>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="link"
                size="sm"
                icon={ArrowLeft}
                onClick={() => {
                  setStep('phone');
                  verify.reset();
                  request.reset();
                }}
              >
                {L('నంబర్ మార్చండి', 'Change number')}
              </Button>
              {resendIn > 0 ? (
                <span className={cn(s.body, 'text-meta tabular-nums text-muted')}>
                  {L(`మళ్లీ పంపడానికి ${resendIn}s`, `Resend in ${resendIn}s`)}
                </span>
              ) : (
                <Button variant="link" size="sm" pending={request.isPending} onClick={() => submitPhone()}>
                  {L('మళ్లీ పంపండి', 'Resend OTP')}
                </Button>
              )}
            </div>
          </form>
        )}
      </Card>

      {/* §4 — OTP stays the fastest way in, so the email path is offered
          alongside it rather than replacing it. */}
      <p className={cn(bodyText, 'mt-7 text-center text-muted')}>
        {L('ఇమెయిల్‌తో లాగిన్ కావాలా? ', 'Prefer email and password? ')}
        <Link to="/register" className={linkClass}>
          {L('ఖాతా సృష్టించండి', 'Create an account')}
        </Link>
        {' · '}
        <Link to="/forgot-password" className={linkClass}>
          {L('పాస్‌వర్డ్ మర్చిపోయారా?', 'Forgot password?')}
        </Link>
      </p>

      <p className={cn(s.body, 'mt-3 text-center text-meta text-muted')}>
        {L('సిబ్బంది లాగిన్ ', 'Newsroom staff sign in ')}
        <Link to="/admin/login" className={linkClass}>
          {L('ఇక్కడ', 'here')}
        </Link>
      </p>
    </PageContainer>
  );
}
