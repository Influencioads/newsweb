import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, Camera, MailPlus } from 'lucide-react';

import { ApiError } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as authApi from '@/features/auth/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { Me } from '@/types/auth';
import { cn } from '@/utils/cn';

/**
 * §5 identity block: profile picture, email, and what still needs verifying.
 *
 * Verification is shown as a state, not a gate. An unverified reader keeps
 * full use of the site — the badge is information, and the only thing it
 * unlocks is receiving email.
 *
 * Rendered as the identity Card of the profile page; the page owns the rhythm
 * around it.
 */
export function AccountIdentity({ me }: { me: Me }) {
  const { language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const bootstrap = useAuth((st) => st.bootstrap);

  const fileInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(me.user.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState(false);

  const avatar = useMutation({
    mutationFn: (file: File) => authApi.uploadAvatar(file),
    onSuccess: () => {
      toast.success(L('ఫోటో అప్‌డేట్ అయింది.', 'Profile picture updated.'));
      void bootstrap();
    },
    onError: (error) => toast.error(error),
  });

  const saveEmail = useMutation({
    mutationFn: () => authApi.updateProfile({ email }),
    onSuccess: () => {
      setEditingEmail(false);
      setEmailError(null);
      toast.success(L('ఇమెయిల్ సేవ్ అయింది.', 'Email saved.'));
      void bootstrap();
    },
    // The toast can be missed; the form says it too, where the input is.
    onError: (error) => {
      setEmailError(
        error instanceof ApiError
          ? (language === 'te' ? error.messageTe : error.messageEn) || error.displayMessage
          : L('ఇమెయిల్ సేవ్ కాలేదు. వేరే చిరునామా ప్రయత్నించండి.', 'Could not save that email. Try a different address.'),
      );
      toast.error(error);
    },
  });

  const resend = useMutation({
    mutationFn: () => authApi.resendVerification(),
    onSuccess: () => toast.success(L('ధృవీకరణ లింక్ పంపాం.', 'Verification link sent.')),
    onError: (error) => toast.error(error),
  });

  // The server resolves the media row and returns a site-relative URL, which
  // the web app serves through the same origin.
  const avatarUrl = me.user.avatar_url;
  const initials = (me.user.name_en || me.user.name_te || '?').trim().charAt(0).toUpperCase();
  const verified = Boolean(me.user.email && me.user.email_verified_at);

  return (
    <Card as="section" padding="lg">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col items-start gap-2">
          <span
            aria-hidden
            className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-pill bg-brand-tint font-sans text-headline-lg font-extrabold text-brand"
          >
            {initials}
            {avatarUrl ? (
              // A dead avatar URL uncovers the initial underneath.
              <img
                src={avatarUrl}
                alt=""
                loading="lazy"
                width={64}
                height={64}
                onError={(event) => (event.currentTarget.style.display = 'none')}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={Camera}
            pending={avatar.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {L('ఫోటో మార్చండి', 'Change photo')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) avatar.mutate(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          {/* ------------------------------------------------------ email -- */}
          {editingEmail ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveEmail.mutate();
              }}
            >
              <Field label={L('ఇమెయిల్', 'Email')} error={emailError}>
                <Input
                  type="email"
                  script="en"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError(null);
                  }}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" pending={saveEmail.isPending}>
                  {L('సేవ్', 'Save')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEmail(me.user.email ?? '');
                    setEditingEmail(false);
                  }}
                >
                  {L('రద్దు', 'Cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(me.user.email ? 'font-sans' : s.body, 'text-ui text-ink')}>
                {me.user.email ?? L('ఇమెయిల్ లేదు', 'No email')}
              </span>
              {verified ? (
                <Badge tone="success" size="xs" icon={BadgeCheck}>
                  {L('ధృవీకరించబడింది', 'Verified')}
                </Badge>
              ) : null}
              <Button variant="link" size="sm" onClick={() => setEditingEmail(true)}>
                {me.user.email ? L('మార్చండి', 'Change') : L('జోడించండి', 'Add')}
              </Button>
              {me.user.email && !verified ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={MailPlus}
                  pending={resend.isPending}
                  onClick={() => resend.mutate()}
                >
                  {L('ధృవీకరించండి', 'Verify')}
                </Button>
              ) : null}
            </div>
          )}

          {/* ------------------------------------------------------ phone -- */}
          {me.user.phone ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-sans text-ui text-muted">+{me.user.phone}</span>
              {me.user.phone_verified_at ? (
                <Badge tone="success" size="xs" icon={BadgeCheck}>
                  {L('ధృవీకరించబడింది', 'Verified')}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
