import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LinkIcon, MailCheck } from 'lucide-react';

import { Button, ButtonLink, linkClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as authApi from '@/features/auth/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * §4 — reader signup, forgotten password, reset, and email verification.
 *
 * These sit alongside the existing phone-OTP flow rather than replacing it:
 * a reader may hold either credential, or both. The OTP path is unchanged and
 * still the fastest way in, so the signup page links to it rather than hiding
 * it behind this longer form.
 *
 * All four share `Shell` — the same auth card as /login: form-width container,
 * one `lg` Card, 48px controls, errors above the form, full-width action.
 */

/** Inline bilingual copy for the strings these pages do not have keys for. */
function useL() {
  const { language } = useI18n();
  return (te: string, en: string) => (language === 'te' ? te : en);
}

interface ShellProps {
  /** `page.*` string for the browser tab. */
  docTitle: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Trailing link row under the card. */
  footer?: ReactNode;
}

function Shell({ docTitle, title, subtitle, children, footer }: ShellProps) {
  useDocumentTitle(docTitle);
  const s = useScript();
  return (
    <PageContainer width="form" className="py-8 md:py-12">
      <Card padding="lg" radius="2xl">
        <p lang="te" className="th text-headline-lg font-extrabold text-brand">
          టాప్ తెలుగు
        </p>
        <PageHeader title={title} subtitle={subtitle} />
        {children}
      </Card>
      {footer ? (
        <p className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui', 'mt-7 text-center text-muted')}>{footer}</p>
      ) : null}
    </PageContainer>
  );
}

/** Success panel — the form's replacement once the one-shot action has landed. */
function Done({ children }: { children: ReactNode }) {
  const s = useScript();
  return (
    <div
      role="status"
      className={cn(
        s.body,
        'flex items-start gap-2 rounded-xl border border-success bg-success-tint p-4 text-success',
        s.te ? 'text-te-body-xs' : 'text-ui',
      )}
    >
      <Icon icon={CheckCircle2} className="mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Register
// --------------------------------------------------------------------------- //
export function RegisterPage() {
  const { t } = useI18n();
  const L = useL();
  const nav = useNavigate();
  const setMe = useAuth((st) => st.setMe);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mismatch = confirm.length > 0 && password !== confirm;

  const register = useMutation({
    mutationFn: () =>
      authApi.registerReader({ name, email, password, confirm_password: confirm, phone: phone || undefined }),
    onSuccess: (data) => {
      setMe(data.me);
      nav('/profile');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    register.mutate();
  }

  return (
    <Shell
      docTitle={t('page.register')}
      title={L('ఖాతా సృష్టించండి', 'Create your account')}
      subtitle={L(
        'కథనాలు సేవ్ చేసుకోండి, మీ జిల్లాను ఫాలో అవ్వండి, మీ వార్తలు పంపండి.',
        'Save stories, follow your district, and submit news of your own.',
      )}
      footer={
        <>
          {L('ఇప్పటికే ఖాతా ఉందా?', 'Already have an account?')}{' '}
          <Link to="/login" className={linkClass}>
            {L('లాగిన్', 'Sign in')}
          </Link>
        </>
      }
    >
      {register.error ? <ErrorState compact error={register.error} className="mb-2" /> : null}
      <form onSubmit={submit} className="space-y-5">
        <Field label={L('పేరు', 'Name')} required>
          <Input size="lg" required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={L('ఇమెయిల్', 'Email')} required>
          <Input
            size="lg"
            required
            type="email"
            script="en"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label={L('ఫోన్', 'Phone')}
          optionalLabel
          hint={L('OTP ద్వారా కూడా లాగిన్ అవ్వొచ్చు.', 'Lets you sign in with an OTP as well.')}
        >
          <Input
            size="lg"
            inputMode="tel"
            script="en"
            autoComplete="tel"
            placeholder="98480 12345"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label={L('పాస్‌వర్డ్', 'Password')} required>
          <Input
            size="lg"
            required
            type="password"
            minLength={8}
            script="en"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field
          label={L('పాస్‌వర్డ్ మళ్లీ', 'Confirm password')}
          required
          error={mismatch ? L('పాస్‌వర్డ్‌లు సరిపోలలేదు.', 'Passwords do not match.') : null}
        >
          <Input
            size="lg"
            required
            type="password"
            minLength={8}
            script="en"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" full pending={register.isPending} disabled={mismatch}>
          {L('ఖాతా సృష్టించండి', 'Create account')}
        </Button>
      </form>
    </Shell>
  );
}

// --------------------------------------------------------------------------- //
// Forgot password
// --------------------------------------------------------------------------- //
export function ForgotPasswordPage() {
  const { t } = useI18n();
  const L = useL();
  const [email, setEmail] = useState('');
  const request = useMutation({ mutationFn: () => authApi.requestPasswordReset(email) });

  return (
    <Shell
      docTitle={t('page.forgotPassword')}
      title={L('పాస్‌వర్డ్ రీసెట్', 'Reset your password')}
      subtitle={L(
        'మీ ఇమెయిల్‌కు లింక్ పంపుతాం. అది ఒకసారే పనిచేస్తుంది, 15 నిమిషాల్లో గడువు ముగుస్తుంది.',
        'We will email you a link. It works once and expires in 15 minutes.',
      )}
      footer={
        <Link to="/login" className={linkClass}>
          {L('లాగిన్‌కు తిరిగి', 'Back to sign in')}
        </Link>
      }
    >
      {request.isSuccess ? (
        <Done>
          {L(
            'ఆ చిరునామా నమోదై ఉంటే, రీసెట్ లింక్ పంపబడింది.',
            'If that address is registered, a reset link is on its way.',
          )}
        </Done>
      ) : (
        <>
          {request.error ? <ErrorState compact error={request.error} className="mb-2" /> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate();
            }}
            className="space-y-5"
          >
            <Field label={L('ఇమెయిల్', 'Email')} required>
              <Input
                size="lg"
                required
                type="email"
                script="en"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Button type="submit" size="lg" full icon={LinkIcon} pending={request.isPending}>
              {L('లింక్ పంపండి', 'Send reset link')}
            </Button>
          </form>
        </>
      )}
    </Shell>
  );
}

// --------------------------------------------------------------------------- //
// Reset password (from the emailed link)
// --------------------------------------------------------------------------- //
export function ResetPasswordPage() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && password !== confirm;

  const reset = useMutation({
    mutationFn: () => authApi.confirmPasswordReset(token, password),
    onSuccess: () => {
      toast.success(L('పాస్‌వర్డ్ మార్చాం. ఇప్పుడు లాగిన్ అవ్వండి.', 'Password changed. Sign in with it now.'));
      nav('/login');
    },
    onError: (error) => toast.error(error),
  });

  if (!token) {
    return (
      <Shell
        docTitle={t('page.resetPassword')}
        title={L('లింక్ చెల్లదు', 'Link not valid')}
        subtitle={L('కొత్త రీసెట్ లింక్ అడగండి.', 'Request a new reset link.')}
      >
        <EmptyState
          compact
          icon={LinkIcon}
          title={L('ఈ లింక్ గడువు ముగిసింది', 'This link has expired')}
          body={L(
            'రీసెట్ లింక్ ఒకసారే పనిచేస్తుంది. కొత్తది అడగండి.',
            'A reset link works only once. Ask for a fresh one.',
          )}
          action={<ButtonLink to="/forgot-password">{L('లింక్ అడగండి', 'Request a link')}</ButtonLink>}
        />
      </Shell>
    );
  }

  return (
    <Shell
      docTitle={t('page.resetPassword')}
      title={L('కొత్త పాస్‌వర్డ్', 'Choose a new password')}
      subtitle={L(
        'కొత్త పాస్‌వర్డ్ పెడితే మిగతా అన్ని పరికరాల నుంచి లాగ్ అవుట్ అవుతారు.',
        'Setting a new password signs you out of every other device.',
      )}
    >
      {reset.error ? <ErrorState compact error={reset.error} className="mb-2" /> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) reset.mutate();
        }}
        className="space-y-5"
      >
        <Field label={L('కొత్త పాస్‌వర్డ్', 'New password')} required>
          <Input
            size="lg"
            required
            type="password"
            minLength={10}
            script="en"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field
          label={L('మళ్లీ టైప్ చేయండి', 'Confirm')}
          required
          error={mismatch ? L('పాస్‌వర్డ్‌లు సరిపోలలేదు.', 'Passwords do not match.') : null}
        >
          <Input
            size="lg"
            required
            type="password"
            minLength={10}
            script="en"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" full pending={reset.isPending} disabled={mismatch}>
          {L('పాస్‌వర్డ్ మార్చండి', 'Set password')}
        </Button>
      </form>
    </Shell>
  );
}

// --------------------------------------------------------------------------- //
// Email verification (from the emailed link)
// --------------------------------------------------------------------------- //
export function VerifyEmailPage() {
  const { t } = useI18n();
  const L = useL();
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
    <Shell
      docTitle={t('page.verifyEmail')}
      title={L('ఇమెయిల్ ధృవీకరణ', 'Verify your email')}
      subtitle={L('ఒక క్లిక్‌తో ఈ చిరునామా మీదని నిర్ధారించండి.', 'One tap confirms this address is yours.')}
    >
      {!token ? (
        <EmptyState
          compact
          icon={LinkIcon}
          title={L('ఈ లింక్ చెల్లదు', 'This link is not valid')}
          body={L(
            'మీ ప్రొఫైల్ నుంచి కొత్త ధృవీకరణ లింక్ పంపుకోవచ్చు.',
            'You can send yourself a fresh verification link from your profile.',
          )}
          action={<ButtonLink to="/profile">{t('page.profile')}</ButtonLink>}
        />
      ) : done ? (
        <div className="space-y-5">
          <Done>{L('ఇమెయిల్ ధృవీకరించబడింది. ధన్యవాదాలు.', 'Email verified. Thank you.')}</Done>
          <ButtonLink to="/profile" size="lg" full>
            {L('మీ ప్రొఫైల్‌కు వెళ్లండి', 'Go to your profile')}
          </ButtonLink>
        </div>
      ) : (
        <>
          {verify.error ? <ErrorState compact error={verify.error} className="mb-2" /> : null}
          <Button size="lg" full icon={MailCheck} pending={verify.isPending} onClick={() => verify.mutate()}>
            {L('నా ఇమెయిల్ ధృవీకరించండి', 'Verify my email')}
          </Button>
        </>
      )}
    </Shell>
  );
}
