import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, Trash2 } from 'lucide-react';

import * as engagementApi from '@/features/engagement/api';
import type { CommentOut } from '@/features/engagement/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { relativeTime } from '@/utils/time';

/**
 * Comments (§5): one reply level, post-moderation. Signed-in readers write;
 * everyone reads. Author can delete their own; anyone can report.
 */
export function CommentsSection({ shortId }: { shortId: string }) {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();

  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<CommentOut | null>(null);

  const list = useQuery({
    queryKey: ['engagement', 'comments', shortId],
    queryFn: () => engagementApi.fetchComments(shortId),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['engagement', 'comments', shortId] });

  const post = useMutation({
    mutationFn: () => engagementApi.addComment(shortId, body, replyTo?.id ?? null),
    onSuccess: () => {
      setBody('');
      setReplyTo(null);
      void invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => engagementApi.deleteComment(id),
    onSuccess: () => void invalidate(),
  });

  const reportComment = useMutation({
    mutationFn: (id: number) => engagementApi.reportComment(id, 'abuse'),
  });

  const threads = useMemo(() => {
    const comments = list.data?.comments ?? [];
    const top = comments.filter((c) => c.parent_id == null);
    const replies = new Map<number, CommentOut[]>();
    for (const c of comments) {
      if (c.parent_id != null) {
        replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c]);
      }
    }
    return top.map((c) => ({ comment: c, replies: replies.get(c.id) ?? [] }));
  }, [list.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (body.trim().length > 0) post.mutate();
  }

  function CommentRow({ comment, isReply }: { comment: CommentOut; isReply?: boolean }) {
    return (
      <div className={`${isReply ? 'ml-8 border-l-2 border-rule pl-3' : ''} py-2.5`}>
        <div className="flex items-baseline gap-2">
          <span lang="te" className="te text-[12.5px] font-bold text-ink">
            {pick(comment.author_name_te, comment.author_name_en)}
          </span>
          <span className="font-sans text-[10.5px] text-muted-light">
            {relativeTime(comment.created_at, language)}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {comment.is_mine ? (
              <button
                type="button"
                onClick={() => remove.mutate(comment.id)}
                aria-label={te ? 'తొలగించండి' : 'Delete'}
                className="p-1 text-muted-light hover:text-breaking"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => reportComment.mutate(comment.id)}
                aria-label={te ? 'నివేదించండి' : 'Report'}
                className="p-1 text-muted-light hover:text-breaking"
              >
                <Flag className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
        </div>
        <p lang="te" className="te mt-0.5 text-[14px] leading-telugu text-ink-soft">
          {comment.body}
        </p>
        {!isReply && authed ? (
          <button
            type="button"
            onClick={() => setReplyTo(comment)}
            className={`${teCls} mt-1 text-[11.5px] font-semibold text-info hover:underline`}
          >
            {te ? 'ప్రత్యుత్తరం' : 'Reply'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section id="comments" className="mt-7 border-t-2 border-ink pt-3">
      <h2 className={`${te ? 'th' : 'font-sans'} mb-3 text-[16px] font-bold text-brand`}>
        {te ? 'వ్యాఖ్యలు' : 'Comments'}
        {list.data?.total_visible ? (
          <span className="ml-1.5 font-sans text-[13px] font-semibold text-muted">
            ({list.data.total_visible})
          </span>
        ) : null}
      </h2>

      {authed ? (
        <form onSubmit={submit} className="mb-4">
          {replyTo ? (
            <p className={`${teCls} mb-1 text-[11.5px] text-muted`}>
              {te ? 'ప్రత్యుత్తరం:' : 'Replying to:'}{' '}
              <span lang="te" className="te font-semibold">
                {pick(replyTo.author_name_te, replyTo.author_name_en)}
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="ml-2 font-sans text-info hover:underline"
              >
                ✕
              </button>
            </p>
          ) : null}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder={te ? 'మీ అభిప్రాయం రాయండి…' : 'Write your comment…'}
            className="te w-full rounded-control border border-rule-input bg-white p-3 text-[14.5px] leading-telugu text-ink outline-none focus:border-brand"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="font-sans text-[10.5px] text-muted-light">{body.length}/2000</span>
            <button
              type="submit"
              disabled={post.isPending || !body.trim()}
              className={`${teCls} rounded-control bg-brand px-5 py-2 text-[13px] font-bold text-white hover:bg-brand-dark disabled:opacity-50`}
            >
              {post.isPending ? (te ? 'పంపుతోంది…' : 'Posting…') : te ? 'పోస్ట్ చేయండి' : 'Post'}
            </button>
          </div>
        </form>
      ) : (
        <p className={`${teCls} mb-4 rounded-control border border-rule bg-paper-sub px-3 py-2.5 text-[13px] text-muted`}>
          {te ? 'వ్యాఖ్యానించడానికి ' : 'To comment, '}
          <Link to="/login" className="font-semibold text-info hover:underline">
            {te ? 'సైన్ ఇన్ చేయండి' : 'sign in'}
          </Link>
        </p>
      )}

      {list.isLoading ? (
        <p className={`${teCls} text-[13px] text-muted`}>{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>
      ) : threads.length === 0 ? (
        <p className={`${teCls} text-[13px] text-muted`}>
          {te ? 'మొదటి వ్యాఖ్య మీదే కావచ్చు.' : 'Be the first to comment.'}
        </p>
      ) : (
        <div className="divide-y divide-rule">
          {threads.map(({ comment, replies }) => (
            <div key={comment.id}>
              <CommentRow comment={comment} />
              {replies.map((reply) => (
                <CommentRow key={reply.id} comment={reply} isReply />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
