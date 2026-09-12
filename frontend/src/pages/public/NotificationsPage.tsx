import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck, MapPin, Megaphone, Tag, Zap, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as notificationsApi from '@/features/engagement/notificationsApi';
import { useI18n, useScript, type StringKey } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle, useReveal } from '@/utils/motion';
import { relativeTime } from '@/utils/time';

/**
 * The reader's inbox (§13): alerts grouped by day, newest first.
 *
 * Opening the page still clears the masthead badge once per visit — the rows
 * keep the `read_at` they arrived with, so the unread dots stay readable — and
 * "mark all as read" is the explicit control that clears the dots too.
 */

interface KindStyle {
  icon: LucideIcon;
  tone: string;
}

const KIND: Record<notificationsApi.NotificationKind, KindStyle> = {
  breaking: { icon: Zap, tone: 'bg-breaking-tint text-breaking' },
  local: { icon: MapPin, tone: 'bg-brand-tint text-brand' },
  topic: { icon: Tag, tone: 'bg-info-tint text-info' },
  system: { icon: Megaphone, tone: 'bg-exclusive-tint text-exclusive-text' },
};

const GROUPS = ['today', 'yesterday', 'earlier'] as const;
type DayGroup = (typeof GROUPS)[number];

const GROUP_LABEL: Record<DayGroup, StringKey> = {
  today: 'ui.today',
  yesterday: 'ui.yesterday',
  earlier: 'ui.earlier',
};

const DAY_MS = 86_400_000;

/** Which day bucket a timestamp falls into, in the reader's own timezone. */
function dayGroup(iso: string, now: Date): DayGroup {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 'earlier';
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= midnight) return 'today';
  if (at >= midnight - DAY_MS) return 'yesterday';
  return 'earlier';
}

function NotificationRow({
  item,
  reveal,
}: {
  item: notificationsApi.NotificationItem;
  reveal: (el: HTMLElement | null) => void;
}) {
  const { t, language } = useI18n();
  const s = useScript();
  const kind = KIND[item.kind];
  const unread = item.read_at === null;

  const body = (
    <div className="flex min-h-tap w-full items-start gap-3">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-pill', kind.tone)}>
        <Icon icon={kind.icon} size="sm" />
      </span>
      <div className="min-w-0 flex-1">
        <p lang="te" className="te text-te-body-sm font-semibold text-ink">
          {item.title_te}
        </p>
        {item.body_te ? (
          <p lang="te" className="te mt-0.5 text-te-body-xs text-ink-soft">
            {item.body_te}
          </p>
        ) : null}
        <p lang={language} className={cn(s.body, 'mt-1 text-meta text-muted')}>
          {relativeTime(item.created_at, language)}
        </p>
      </div>
      {unread ? (
        <>
          <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-pill bg-brand" />
          <span className="sr-only">{t('ui.unread')}</span>
        </>
      ) : null}
    </div>
  );

  return (
    <Card
      as="li"
      ref={reveal}
      padding="sm"
      interactive={item.article_url !== null}
      className={cn(!unread && 'opacity-80')}
    >
      {item.article_url ? (
        <Link to={item.article_url} className="flex rounded-xl">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

/** The reader's inbox (§13). */
export default function NotificationsPage() {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const reveal = useReveal<HTMLElement>();
  useDocumentTitle(t('page.notifications'));

  useEffect(() => {
    if (status === 'anonymous') {
      navigate('/login', { replace: true, state: { from: '/notifications' } });
    }
  }, [status, navigate]);

  const inbox = useInfiniteQuery({
    queryKey: ['notifications', 'inbox'],
    queryFn: ({ pageParam }) => notificationsApi.fetchInbox(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: status === 'authenticated',
  });

  const serverUnread = inbox.data?.pages[0]?.unread ?? 0;

  // Opening the inbox clears the badge — the §13 flow readers expect. Once per
  // visit, and the inbox itself is NOT refetched, so the dots survive the call.
  const cleared = useRef(false);
  useEffect(() => {
    if (cleared.current || serverUnread === 0) return;
    cleared.current = true;
    void notificationsApi.markRead().then(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    });
  }, [serverUnread, queryClient]);

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markRead(),
    onSuccess: () => {
      toast.success(L('అన్నీ చదివినట్లు గుర్తించాం', 'All notifications marked as read'));
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => toast.error(error),
  });

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  const hasUnread = items.some((n) => n.read_at === null);
  const now = new Date();

  if (status !== 'authenticated') return null;
  return (
    <PageContainer width="wrap" className="py-7 md:py-10">
      <PageHeader
        eyebrow={t('ui.notifications')}
        title={t('page.notifications')}
        icon={Bell}
        actions={
          <Button
            variant="secondary"
            icon={CheckCheck}
            disabled={!hasUnread}
            pending={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {t('ui.markAllRead')}
          </Button>
        }
      />

      <QueryState
        query={inbox}
        isEmpty={(data) => !data.pages.some((page) => page.items.length)}
        empty={
          <EmptyState
            icon={BellOff}
            title={L('ఇంకా నోటిఫికేషన్లు లేవు', 'No notifications yet')}
            body={L(
              'ప్రాంతాలు, విభాగాలను ఫాలో అయితే ముఖ్య వార్తలు ఇక్కడ చేరతాయి.',
              'Follow places and sections to get important stories here.',
            )}
          />
        }
      >
        {() => (
          <div className="space-y-7 md:space-y-10">
            {GROUPS.map((group) => {
              const rows = items.filter((n) => dayGroup(n.created_at, now) === group);
              if (rows.length === 0) return null;
              return (
                <section key={group}>
                  <SectionHeader level={3} tone="ink" title={t(GROUP_LABEL[group])} />
                  <ul className="flex flex-col gap-3">
                    {rows.map((n) => (
                      <NotificationRow key={n.id} item={n} reveal={reveal} />
                    ))}
                  </ul>
                </section>
              );
            })}

            {inbox.hasNextPage ? (
              <Button
                variant="secondary"
                full
                pending={inbox.isFetchingNextPage}
                onClick={() => void inbox.fetchNextPage()}
              >
                {t('ui.loadMore')}
              </Button>
            ) : null}
          </div>
        )}
      </QueryState>
    </PageContainer>
  );
}
