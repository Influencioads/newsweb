import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { PageContainer } from '@/components/ui/Layout';
import { exchangeGoogleTicket, GoogleSignInButton, googleErrorText } from '@/features/auth/google';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * `/auth/google/done?ticket=…&next=…` (or `?error=…`): where Google sign-in
 * lands. Swaps the one-use ticket for tokens, then goes to `next` — the CMS
 * for staff, the page the reader came from otherwise.
 */
export default function GoogleDonePage() {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setMe = useAuth((st) => st.setMe);
  const next = params.get('next') || '/';
  const cms = next.startsWith('/admin');
  const [error, setError] = useState<string | null>(params.get('error'));
  const started = useRef(false);
  useDocumentTitle(te ? 'సైన్ ఇన్' : 'Sign in');

  useEffect(() => {
    const ticket = params.get('ticket');
    // Strict mode runs effects twice; a ticket only works once.
    if (!ticket || started.current) return;
    started.current = true;
    exchangeGoogleTicket(ticket)
      .then((data) => {
        setMe(data.me);
        navigate(next, { replace: true });
      })
      .catch(() => setError('expired'));
  }, [params, next, navigate, setMe]);

  return (
    <PageContainer width="form" className="py-16">
      <Card padding="lg" className="space-y-5 text-center">
        {error ? (
          <>
            <p role="alert" className={cn(s.body, 'text-ui text-ink')}>
              {googleErrorText(error, te)}
            </p>
            <GoogleSignInButton target={cms ? 'cms' : 'web'} next={next} />
            <Link to={cms ? '/admin/login' : '/'} className={cn(s.body, 'inline-block text-ui-sm text-muted underline')}>
              {cms ? (te ? 'CMS సైన్ ఇన్‌కు తిరిగి' : 'Back to CMS sign-in') : te ? 'హోమ్‌కు తిరిగి' : 'Back to home'}
            </Link>
          </>
        ) : (
          <p role="status" className={cn(s.body, 'text-ui text-muted')}>
            {te ? 'సైన్ ఇన్ అవుతోంది…' : 'Signing you in…'}
          </p>
        )}
      </Card>
    </PageContainer>
  );
}
