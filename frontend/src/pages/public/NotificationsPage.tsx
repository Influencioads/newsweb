import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, MapPin, Megaphone, Tag, Zap } from 'lucide-react';

import * as notificationsApi from '@/features/engagement/notificationsApi';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { relativeTime } from '@/utils/time';

const KIND_ICON: Record<notificationsApi.NotificationKind, React.ReactNode> = {
  breaking: <Zap className="h-4 w-4 text-breaking" aria-hidden />,
  local: <MapPin className="h-4 w-4 text-brand" aria-hidden />,
  topic: <Tag className="h-4 w-4 text-info" aria-hidden />,
  system: <Megaphone className="h-4 w-4 text-exclusive" aria-hidden />,
};

/** The reader's inbox (§13). Opening the page marks everything read. */
export default function NotificationsPage() {
  const { language } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status === 'anonymous') navigate('/login', { replace: true, state: { from: '/notifications' } });
  }, [status, navigate]);

  const inbox = useQuery({
    queryKey: ['notifications', 'inbox'],
    queryFn: () => notificationsApi.fetchInbox(),
    enabled: status === 'authenticated',
  });

  // Opening the inbox clears the badge — the §13 flow readers expect.
  useEffect(() => {
    if (inbox.data && inbox.data.unread > 0) {
      void notificationsApi.markRead().then(() => {
        void queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] });
      });
    }
  }, [inbox.data, queryClient]);

  if (status !== 'authenticated') return null;

  return (
    <main className="mx-auto min-h-[55vh] max-w-[760px] px-4 py-7 sm:py-10">
      <div className="mb-6 border-b-2 border-ink pb-4">
        <p className="flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
          <Bell className="h-3.5 w-3.5" aria-hidden />
          {te ? 'హెచ్చరికలు' : 'ALERTS'}
        </p>
        <h1 className={`${te ? 'th' : 'font-sans'} mt-1 text-[27px] font-extrabold text-ink sm:text-[32px]`}>
          {te ? 'నోటిఫికేషన్లు' : 'Notifications'}
        </h1>
      </div>

      {inbox.isLoading ? (
        <p className={`${teCls} text-muted`}>{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>
      ) : !inbox.data?.items.length ? (
        <p className={`${teCls} rounded border border-rule bg-paper px-4 py-6 text-center text-[14.5px] text-muted`}>
          {te
            ? 'ఇంకా నోటిఫికేషన్లు లేవు. ప్రాంతాలు, విభాగాలను ఫాలో అయితే ముఖ్య వార్తలు ఇక్కడ చేరతాయి.'
            : 'No notifications yet. Follow places and sections to get important stories here.'}
        </p>
      ) : (
        <div className="divide-y divide-rule">
          {inbox.data.items.map((n) => {
            const inner = (
              <div className={`flex items-start gap-3 py-3 ${n.read_at ? 'opacity-70' : ''}`}>
                <span className="mt-1 shrink-0">{KIND_ICON[n.kind]}</span>
                <div className="min-w-0 flex-1">
                  <p lang="te" className="te text-[14.5px] font-semibold leading-telugu text-ink">
                    {n.title_te}
                  </p>
                  {n.body_te ? (
                    <p lang="te" className="te mt-0.5 text-[13px] leading-telugu text-muted">
                      {n.body_te}
                    </p>
                  ) : null}
                  <p className="mt-1 font-sans text-[10.5px] text-muted-light">
                    {relativeTime(n.created_at, language)}
                  </p>
                </div>
                {!n.read_at ? (
                  <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" />
                ) : null}
              </div>
            );
            return n.article_url ? (
              <Link key={n.id} to={n.article_url} className="block hover:bg-paper">
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </main>
  );
}
