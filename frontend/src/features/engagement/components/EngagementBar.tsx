import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, Heart } from 'lucide-react';

import { ButtonLink, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as engagementApi from '@/features/engagement/api';
import type { MyArticleFlags } from '@/features/engagement/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { ArticleDetail } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * Like · report — the §5 article actions that are *not* already on the reader
 * toolbar. Share, bookmark and comments live there (a sticky bar under md, an
 * inline row from md up); duplicating them here showed every one of them twice
 * from md up and mounted a second ShareSheet, so this bar owns only what the
 * toolbar does not.
 *
 * The like count rides on the button as a badge and renders for everyone. Both
 * actions need an account: an anonymous tap opens a sign-in Sheet instead of
 * yanking the reader off the story mid-sentence, and the sheet's button carries
 * the return path so signing in lands back here.
 *
 * Like is optimistic (the heart fills and pulses before the round trip) and
 * rolls back with a toast on failure, then invalidates the article query so the
 * server's counter wins.
 */

/** §5 report reasons, as the backend enum spells them. */
const REPORT_REASONS = {
  misinformation: { te: 'తప్పుడు సమాచారం', en: 'Misinformation' },
  abuse: { te: 'అభ్యంతరకరం', en: 'Abusive' },
  spam: { te: 'స్పామ్', en: 'Spam' },
  copyright: { te: 'కాపీరైట్', en: 'Copyright' },
  other: { te: 'ఇతరం', en: 'Other' },
} as const;

type ReportReason = keyof typeof REPORT_REASONS;

export function EngagementBar({ article }: { article: ArticleDetail }) {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const navigate = useNavigate();
  const toast = useToast();
  const authed = useAuth((state) => state.status === 'authenticated');
  const queryClient = useQueryClient();

  const flagsKey = ['engagement', 'flags', article.short_id];
  const [likeCount, setLikeCount] = useState(article.like_count);
  const [popping, setPopping] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [reason, setReason] = useState<ReportReason>('misinformation');

  // The server's count wins whenever the article query refreshes…
  useEffect(() => setLikeCount(article.like_count), [article.like_count]);
  // …but "already reported" is per story, and a refreshed count must not clear it.
  useEffect(() => {
    setReported(false);
    setReportOpen(false);
  }, [article.short_id]);

  const flags = useQuery({
    queryKey: flagsKey,
    queryFn: () => engagementApi.fetchMyFlags(article.short_id),
    enabled: authed,
  });

  const liked = flags.data?.liked ?? false;

  /** The like moves the article's counters; the page query must not keep the stale ones. */
  const refreshArticle = () =>
    void queryClient.invalidateQueries({ queryKey: ['public', 'article', article.short_id] });

  const patchFlags = (next: Partial<MyArticleFlags>) =>
    queryClient.setQueryData<MyArticleFlags>(flagsKey, (prev) => ({
      liked: prev?.liked ?? false,
      bookmarked: prev?.bookmarked ?? false,
      ...next,
    }));

  const like = useMutation({
    mutationFn: (next: boolean) => engagementApi.setLike(article.short_id, next),
    onMutate: (next) => {
      const previous = { liked, count: likeCount };
      patchFlags({ liked: next });
      setLikeCount((n) => Math.max(0, n + (next ? 1 : -1)));
      if (next) setPopping(true);
      return previous;
    },
    onError: (error, _next, previous) => {
      if (previous) {
        patchFlags({ liked: previous.liked });
        setLikeCount(previous.count);
      }
      toast.error(error);
    },
    onSuccess: (counts) => {
      setLikeCount(counts.like_count);
      refreshArticle();
    },
  });

  const report = useMutation({
    mutationFn: () => engagementApi.reportArticle(article.short_id, reason),
    onSuccess: () => {
      setReported(true);
      setReportOpen(false);
      toast.success(t('state.reported'));
    },
    onError: (error) => toast.error(error),
  });

  /** True when the action needs an account the reader does not have (the sheet is now open). */
  function needsAccount(): boolean {
    if (authed) return false;
    setSignInOpen(true);
    return true;
  }

  return (
    <div className="mt-7 border-y border-rule py-2">
      <div className="flex flex-wrap items-center gap-1">
        <IconButton
          icon={Heart}
          label={liked ? t('ui.liked') : t('ui.like')}
          badge={likeCount}
          pressed={liked}
          disabled={like.isPending}
          onClick={() => {
            if (needsAccount()) return;
            like.mutate(!liked);
          }}
          // The class is removed on animationend, so the next like replays it
          // without remounting the button and stealing keyboard focus.
          onAnimationEnd={() => setPopping(false)}
          className={cn(liked && '[&>svg]:fill-current', popping && 'animate-pop')}
        />

        <IconButton
          icon={Flag}
          label={reported ? t('state.reported') : L('నివేదించండి', 'Report')}
          disabled={reported || report.isPending}
          className="ml-auto"
          onClick={() => {
            if (needsAccount()) return;
            setReportOpen(true);
          }}
        />
      </div>

      <Sheet open={signInOpen} onClose={() => setSignInOpen(false)} title={t('ui.signInToContinue')}>
        <p className={cn(s.body, s.te ? 'text-te-body-sm' : 'text-ui', 'text-muted')}>
          {t('ui.signInBody')}
        </p>
        <ButtonLink
          to="/login"
          size="lg"
          full
          className="mt-4"
          onClick={(event) => {
            // LoginPage reads the return path from the router location state,
            // which a plain anchor cannot carry.
            event.preventDefault();
            navigate('/login', { state: { from: article.url } });
          }}
        >
          {L('సైన్ ఇన్ చేయండి', 'Sign in')}
        </ButtonLink>
      </Sheet>

      <ConfirmDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onConfirm={() => report.mutate()}
        pending={report.isPending}
        tone="danger"
        title={L('ఈ కథనాన్ని నివేదించాలా?', 'Report this story?')}
        confirmLabel={L('నివేదించండి', 'Report')}
        body={
          <Select
            value={reason}
            onChange={(event) => setReason(event.target.value as ReportReason)}
            aria-label={L('కారణం', 'Reason')}
          >
            {Object.entries(REPORT_REASONS).map(([key, label]) => (
              <option key={key} value={key}>
                {label[language]}
              </option>
            ))}
          </Select>
        }
      />
    </div>
  );
}
