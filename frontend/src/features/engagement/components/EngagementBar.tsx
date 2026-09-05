import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Flag, Heart, MessageCircle, Share2 } from 'lucide-react';

import * as engagementApi from '@/features/engagement/api';
import { trackShare } from '@/features/engagement/beacon';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { ArticleDetail } from '@/types/public';

/**
 * Like · comment · bookmark · share · report — the §5 article actions.
 * Anonymous taps on stateful actions route to /login with a return path;
 * counts render for everyone.
 */
export function EngagementBar({ article }: { article: ArticleDetail }) {
  const { language } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const navigate = useNavigate();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();

  const [likeCount, setLikeCount] = useState(article.like_count);
  const [shareCount, setShareCount] = useState(article.share_count);
  const [reported, setReported] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    setLikeCount(article.like_count);
    setShareCount(article.share_count);
    setReported(false);
    setReportOpen(false);
  }, [article.short_id, article.like_count, article.share_count]);

  const flags = useQuery({
    queryKey: ['engagement', 'flags', article.short_id],
    queryFn: () => engagementApi.fetchMyFlags(article.short_id),
    enabled: authed,
  });

  function requireLogin(): boolean {
    if (authed) return false;
    navigate('/login', { state: { from: article.url } });
    return true;
  }

  const like = useMutation({
    mutationFn: (next: boolean) => engagementApi.setLike(article.short_id, next),
    onSuccess: (counts, next) => {
      setLikeCount(counts.like_count);
      queryClient.setQueryData(['engagement', 'flags', article.short_id], {
        liked: next,
        bookmarked: flags.data?.bookmarked ?? false,
      });
    },
  });

  const bookmark = useMutation({
    mutationFn: (next: boolean) => engagementApi.setBookmark(article.short_id, next),
    onSuccess: (data) =>
      queryClient.setQueryData(['engagement', 'flags', article.short_id], data),
  });

  async function share() {
    const url = `${window.location.origin}${article.url}`;
    trackShare(article.short_id);
    setShareCount((n: number) => n + 1);
    try {
      if (navigator.share) {
        await navigator.share({ title: article.title_te, url });
        return;
      }
    } catch {
      /* dismissed */
    }
    const text = encodeURIComponent(`${article.title_te}\n${url}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  }

  const report = useMutation({
    mutationFn: (reason: string) => engagementApi.reportArticle(article.short_id, reason),
    onSuccess: () => {
      setReported(true);
      setReportOpen(false);
    },
  });

  const liked = flags.data?.liked ?? false;
  const bookmarked = flags.data?.bookmarked ?? false;

  const buttonCls = (active: boolean) =>
    [
      'flex min-h-tap items-center gap-1.5 rounded-control border px-3 text-[12.5px] font-semibold transition-colors',
      teCls,
      active
        ? 'border-brand bg-brand-tint text-brand'
        : 'border-rule text-muted hover:border-brand hover:text-brand',
    ].join(' ');

  return (
    <div className="mt-5 border-y border-rule py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (requireLogin()) return;
            like.mutate(!liked);
          }}
          aria-pressed={liked}
          className={buttonCls(liked)}
        >
          <Heart className={`h-4 w-4 ${liked ? 'fill-brand' : ''}`} aria-hidden />
          {likeCount > 0 ? likeCount : ''} {te ? 'ఇష్టం' : 'Like'}
        </button>

        <a href="#comments" className={buttonCls(false)}>
          <MessageCircle className="h-4 w-4" aria-hidden />
          {article.comment_count > 0 ? article.comment_count : ''} {te ? 'వ్యాఖ్యలు' : 'Comments'}
        </a>

        <button
          type="button"
          onClick={() => {
            if (requireLogin()) return;
            bookmark.mutate(!bookmarked);
          }}
          aria-pressed={bookmarked}
          className={buttonCls(bookmarked)}
        >
          <Bookmark className={`h-4 w-4 ${bookmarked ? 'fill-brand' : ''}`} aria-hidden />
          {bookmarked ? (te ? 'సేవ్ అయింది' : 'Saved') : te ? 'సేవ్' : 'Save'}
        </button>

        <button type="button" onClick={() => void share()} className={buttonCls(false)}>
          <Share2 className="h-4 w-4" aria-hidden />
          {shareCount > 0 ? shareCount : ''} {te ? 'షేర్' : 'Share'}
        </button>

        <button
          type="button"
          onClick={() => setReportOpen((v) => !v)}
          disabled={reported}
          className={`${teCls} ml-auto flex min-h-tap items-center gap-1 px-2 text-[11.5px] text-muted-light hover:text-breaking disabled:text-success`}
        >
          <Flag className="h-3.5 w-3.5" aria-hidden />
          {reported ? (te ? 'నివేదించారు' : 'Reported') : te ? 'నివేదించండి' : 'Report'}
        </button>
      </div>

      {reportOpen && !reported ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control border border-rule bg-paper-sub p-2.5">
          <span className={`${teCls} text-[12px] font-semibold text-ink`}>
            {te ? 'కారణం:' : 'Reason:'}
          </span>
          {(
            [
              ['misinformation', te ? 'తప్పుడు సమాచారం' : 'Misinformation'],
              ['abuse', te ? 'అభ్యంతరకరం' : 'Abusive'],
              ['spam', te ? 'స్పామ్' : 'Spam'],
              ['copyright', te ? 'కాపీరైట్' : 'Copyright'],
              ['other', te ? 'ఇతరం' : 'Other'],
            ] as const
          ).map(([reason, label]) => (
            <button
              key={reason}
              type="button"
              disabled={report.isPending}
              onClick={() => report.mutate(reason)}
              className={`${teCls} rounded-chip border border-rule bg-white px-3 py-1 text-[12px] text-muted hover:border-breaking hover:text-breaking`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
