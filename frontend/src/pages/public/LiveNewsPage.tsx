import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock3, Radio, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle, useReveal } from '@/utils/motion';
import { formatTime, relativeTime } from '@/utils/time';

/**
 * Breaking news, newest first (§6). The feed re-polls every 25 s on its own;
 * the refresh button is for a reader who does not want to wait for the tick.
 * Each entry is a Card carrying a time Badge — the newest one in the breaking
 * tone, the rest muted, so "how old is this" is legible at a glance.
 */
export default function LiveNewsPage() {
  const { t, pick, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reveal = useReveal<HTMLLIElement>();
  useDocumentTitle(t('page.live'));

  const feed = useQuery({
    queryKey: ['public', 'breaking'],
    queryFn: publicApi.fetchBreaking,
    refetchInterval: 25_000,
  });

  return (
    <PageContainer width="wrap" className="py-7 md:py-10">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={Radio} size="sm" className="animate-pulse" />
            {t('ui.live')}
          </span>
        }
        title={L('తాజా వార్తలు — ప్రత్యక్ష అప్‌డేట్లు', 'Breaking news — live updates')}
        subtitle={L(
          'ముఖ్యమైన వార్తలు వచ్చిన వెంటనే ఇక్కడ అప్‌డేట్ అవుతాయి.',
          'Important developments, updated here as they happen.',
        )}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            pending={feed.isFetching}
            onClick={() => void feed.refetch()}
          >
            {L('రిఫ్రెష్', 'Refresh')}
          </Button>
        }
      />

      <div className="space-y-7 md:space-y-10">
        <QueryState
          query={feed}
          empty={
            <EmptyState
              icon={Radio}
              title={L('ఇప్పుడు ప్రత్యక్ష అప్‌డేట్లు లేవు.', 'No live updates right now.')}
              body={L(
                'ముఖ్యమైన వార్త వచ్చిన వెంటనే ఈ పేజీ దానంతట అదే నవీకరించబడుతుంది.',
                'This page refreshes itself the moment something breaks.',
              )}
            />
          }
        >
          {(items) => (
            // The feed re-polls every 25s and prepends; without this a screen
            // reader is never told an update arrived.
            <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-3">
              {items.map((item, index) => {
                const title = s.forText(item.title_te, item.title_en);
                const when = item.published_at
                  ? relativeTime(item.published_at, language)
                  : L('ఇప్పుడే', 'Just now');
                return (
                  <li key={item.short_id} ref={reveal}>
                    <Card as="article" interactive padding="md" className="relative">
                      <Badge
                        tone={index === 0 ? 'breaking' : 'muted'}
                        size="xs"
                        icon={index === 0 ? Radio : Clock3}
                        lang={language}
                      >
                        {when}
                      </Badge>
                      <h2
                        lang={title.lang}
                        className={cn(title.head, 'mt-2 text-headline-sm font-bold text-ink')}
                      >
                        <Link
                          to={item.url}
                          className="rounded-xl transition-[colors,transform,box-shadow] duration-base ease-standard after:absolute after:inset-0 hover:text-brand"
                        >
                          {pick(item.title_te, item.title_en)}
                        </Link>
                      </h2>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </QueryState>

        <p className={cn(s.body, 'text-meta text-muted')}>
          {L('చివరిసారి నవీకరించబడింది', 'Last refreshed')}:{' '}
          {feed.dataUpdatedAt ? formatTime(new Date(feed.dataUpdatedAt).toISOString()) : '—'}
        </p>
      </div>
    </PageContainer>
  );
}
