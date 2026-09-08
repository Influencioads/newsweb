import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, Camera } from 'lucide-react';

import * as authApi from '@/features/auth/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { Me } from '@/types/auth';

/**
 * §5 identity block: profile picture, email, and what still needs verifying.
 *
 * Verification is shown as a state, not a gate. An unverified reader keeps
 * full use of the site — the badge is information, and the only thing it
 * unlocks is receiving email.
 */
export function AccountIdentity({ me }: { me: Me }) {
  const { language } = useI18n();
  const te = language === 'te';
  const bootstrap = useAuth((s) => s.bootstrap);

  const fileInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(me.user.email ?? '');
  const [editingEmail, setEditingEmail] = useState(false);

  const avatar = useMutation({
    mutationFn: (file: File) => authApi.uploadAvatar(file),
    onSuccess: () => void bootstrap(),
  });
  const saveEmail = useMutation({
    mutationFn: () => authApi.updateProfile({ email }),
    onSuccess: () => { setEditingEmail(false); void bootstrap(); },
  });
  const resend = useMutation({ mutationFn: () => authApi.resendVerification() });

  // The server resolves the media row and returns a site-relative URL, which
  // the web app serves through the same origin.
  const avatarUrl = me.user.avatar_url;
  const initials = (me.user.name_en || me.user.name_te || '?').trim().charAt(0).toUpperCase();

  return (
    <section className="mb-7 rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface">
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-tint font-sans text-[24px] font-extrabold text-brand">
              {initials}
            </span>
          )}
          <button
            type="button"
            aria-label={te ? 'ప్రొఫైల్ ఫోటో మార్చండి' : 'Change profile picture'}
            onClick={() => fileInput.current?.click()}
            disabled={avatar.isPending}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-rule bg-white text-brand shadow-card disabled:opacity-50 dark:bg-surface"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) avatar.mutate(f); e.target.value = ''; }}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {/* ------------------------------------------------------ email -- */}
          {editingEmail ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-w-[200px] flex-1 rounded-control border border-rule-input bg-white px-2.5 py-1.5 text-[13.5px] dark:bg-surface"
              />
              <button type="button" disabled={saveEmail.isPending} onClick={() => saveEmail.mutate()}
                className="te min-h-[32px] rounded-control bg-brand px-3 text-[12.5px] font-bold text-white disabled:opacity-50">
                {te ? 'సేవ్' : 'Save'}
              </button>
              <button type="button" onClick={() => { setEmail(me.user.email ?? ''); setEditingEmail(false); }}
                className="te min-h-[32px] rounded-control border border-rule px-3 text-[12.5px] text-muted">
                {te ? 'రద్దు' : 'Cancel'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-sans text-[13.5px] text-ink">
                {me.user.email ?? (te ? 'ఇమెయిల్ లేదు' : 'No email')}
              </span>
              {me.user.email && me.user.email_verified_at ? (
                <span className="inline-flex items-center gap-1 rounded-chip bg-success/10 px-2 py-0.5 font-sans text-[10.5px] font-bold text-success">
                  <BadgeCheck className="h-3 w-3" aria-hidden />
                  {te ? 'ధృవీకరించబడింది' : 'Verified'}
                </span>
              ) : me.user.email ? (
                <button type="button" disabled={resend.isPending} onClick={() => resend.mutate()}
                  className="te rounded-chip border border-partial px-2 py-0.5 text-[11px] font-bold text-partial disabled:opacity-50">
                  {resend.isSuccess
                    ? (te ? 'లింక్ పంపాం' : 'Link sent')
                    : (te ? 'ధృవీకరించండి' : 'Verify')}
                </button>
              ) : null}
              <button type="button" onClick={() => setEditingEmail(true)}
                className="te text-[12px] font-semibold text-brand underline">
                {me.user.email ? (te ? 'మార్చండి' : 'Change') : (te ? 'జోడించండి' : 'Add')}
              </button>
            </div>
          )}

          {/* ------------------------------------------------------ phone -- */}
          {me.user.phone ? (
            <div className="flex items-center gap-2">
              <span className="font-sans text-[13px] text-muted">+{me.user.phone}</span>
              {me.user.phone_verified_at ? (
                <span className="inline-flex items-center gap-1 rounded-chip bg-success/10 px-2 py-0.5 font-sans text-[10.5px] font-bold text-success">
                  <BadgeCheck className="h-3 w-3" aria-hidden />
                  {te ? 'ధృవీకరించబడింది' : 'Verified'}
                </span>
              ) : null}
            </div>
          ) : null}

          {avatar.isError ? (
            <p className="te text-[12px] text-breaking">
              {te ? 'ఫోటో అప్‌లోడ్ కాలేదు — JPEG/PNG/WebP, 4MB లోపు.' : 'Upload failed — JPEG/PNG/WebP under 4MB.'}
            </p>
          ) : null}
          {saveEmail.isError ? (
            <p className="te text-[12px] text-breaking">
              {te ? 'ఇమెయిల్ సేవ్ కాలేదు. వేరే చిరునామా ప్రయత్నించండి.' : 'Could not save that email. Try a different address.'}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
