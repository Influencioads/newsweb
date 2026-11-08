import { api, API_BASE, setTokens } from '@/api/client';
import { useSiteConfig } from '@/features/wow/siteContent';
import { useI18n } from '@/i18n';
import type { ReaderLoginResponse } from '@/features/reader/api';
import { cn } from '@/utils/cn';

/**
 * Sign in with Google (backend app/services/google_auth_service): the button
 * goes to /auth/google/start, Google sends the browser back to
 * /auth/google/done with a one-use ticket, and that page swaps it for tokens.
 */

export type GoogleTarget = 'cms' | 'web';

export function googleStartUrl(target: GoogleTarget, next?: string): string {
  const q = new URLSearchParams({ target });
  if (next) q.set('next', next);
  return `${API_BASE}/auth/google/start?${q.toString()}`;
}

export async function exchangeGoogleTicket(ticket: string): Promise<ReaderLoginResponse> {
  const { data } = await api.post<ReaderLoginResponse>('/auth/google/exchange', {
    ticket,
    device_label: navigator.userAgent.slice(0, 120),
  });
  setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

/** How this site lets people in (GET /public/config `auth`). */
export function useSignInMethods(): { google: boolean; password: boolean; loading: boolean } {
  const config = useSiteConfig();
  const auth = config.data?.auth;
  // An older API without `auth`: passwords only, as before.
  return { google: auth?.google ?? false, password: auth?.password ?? true, loading: config.isLoading };
}

/** Why Google sign-in was turned back (backend GoogleLoginError reasons). */
export function googleErrorText(reason: string, te: boolean): string {
  const text: Record<string, [string, string]> = {
    not_staff: [
      'ఈ గూగుల్ ఖాతాకు CMS అనుమతి లేదు. అడ్మిన్‌ను మీ జీమెయిల్ చిరునామా జోడించమని అడగండి.',
      'This Google account has no CMS access. Ask an admin to add your Gmail address.',
    ],
    account_disabled: ['ఈ ఖాతా నిలిపివేయబడింది.', 'This account has been switched off.'],
    email_not_verified: ['ఈ గూగుల్ ఖాతా ఇమెయిల్ ధృవీకరించబడలేదు.', 'This Google account’s email is not verified.'],
    cancelled: ['గూగుల్ సైన్-ఇన్ రద్దు చేయబడింది.', 'Google sign-in was cancelled.'],
    expired: ['సైన్-ఇన్ సమయం ముగిసింది. మళ్లీ ప్రయత్నించండి.', 'The sign-in timed out. Please try again.'],
    not_configured: ['గూగుల్ సైన్-ఇన్ ఇంకా ఆన్ చేయలేదు.', 'Google sign-in is not switched on yet.'],
  };
  const [t, e] = text[reason] ?? ['గూగుల్ సైన్-ఇన్ పూర్తి కాలేదు. మళ్లీ ప్రయత్నించండి.', 'Google sign-in did not work. Please try again.'];
  return te ? t : e;
}

/** Google's four-colour "G". */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="h-5 w-5 shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** A full-width "Sign in with Google" link (a plain link: Google needs a real page load). */
export function GoogleSignInButton({ target, next, className }: { target: GoogleTarget; next?: string; className?: string }) {
  const { language } = useI18n();
  const te = language === 'te';
  return (
    <a
      href={googleStartUrl(target, next)}
      className={cn(
        'flex min-h-tap w-full items-center justify-center gap-3 rounded-pill border border-rule-strong bg-surface px-5 py-3',
        'font-sans text-ui font-semibold text-ink shadow-raised transition-colors duration-base hover:bg-paper-sub',
        className,
      )}
    >
      <GoogleMark />
      {te ? 'గూగుల్‌తో సైన్ ఇన్ చేయండి' : 'Sign in with Google'}
    </a>
  );
}
