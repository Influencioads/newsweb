import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CornerDownRight, Flag, MessageCircle, Send, Trash2, X } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Field';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as engagementApi from '@/features/engagement/api';
import type { CommentList, CommentOut } from '@/features/engagement/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { firstGrapheme } from '@/utils/text';
import { relativeTime } from '@/utils/time';

/**
 * Comments (§5): one reply level, post-moderation. Signed-in readers write;
 * everyone reads. An author can delete their own, anyone can report.
 *
 * Posting is optimistic — the row appears under a temporary negative id and
 * the refetch swaps in the server's copy (or removes it again when moderation
 * holds it back). A failed post restores the words to the composer.
 */

const MAX_LENGTH = 2000;

interface CommentRowProps {
  comment: CommentOut;
  isReply?: boolean;
  /** Replies are one level deep and need an account. */
  canReply: boolean;
  onReply: (comment: CommentOut) => void;
  onDelete: (comment: CommentOut) => void;
  onReport: (comment: CommentOut) => void;
  /** The optimistic row is not addressable yet — its controls stay quiet. */
  pending?: boolean;
  /** A report is in flight; the flag must not fire twice. */
  reporting?: boolean;
}

/**
 * One comment. Hoisted out of CommentsSection deliberately: declared inside the
 * parent it was a new component type on every keystroke, so React remounted
 * every row (and dropped focus) as the composer was typed into.
 */
function CommentRow({
  comment,
  isReply,
  canReply,
  onReply,
  onDelete,
  onReport,
  pending,
  reporting,
}: CommentRowProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const author = s.text(comment.author_name_te, comment.author_name_en);

  return (
    <Card
      as="li"
      padding="sm"
      className={cn('flex gap-3', pending && 'opacity-60', isReply && 'ml-6 md:ml-12')}
    >
      <span
        aria-hidden
        lang={author.lang}
        className={cn(
          author.cls,
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-brand-tint text-ui font-semibold text-brand',
        )}
      >
        {firstGrapheme(author.text)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          {/* Indentation carries the thread visually; this carries it to a screen reader. */}
          {isReply ? <span className="sr-only">{L('ప్రత్యుత్తరం', 'Reply')}</span> : null}
          <span lang={author.lang} className={cn(author.cls, 'text-ui font-semibold text-ink')}>
            {author.text}
          </span>
          {/* relativeTime speaks Telugu in te mode; it needs the matching voice. */}
          <time dateTime={comment.created_at} lang={language} className={cn(s.body, 'text-meta text-muted')}>
            {relativeTime(comment.created_at, language)}
          </time>
          <span className="ml-auto flex items-center">
            {comment.is_mine ? (
              <IconButton
                icon={Trash2}
                label={t('ui.delete')}
                disabled={pending}
                onClick={() => onDelete(comment)}
              />
            ) : (
              <IconButton
                icon={Flag}
                label={L('నివేదించండి', 'Report')}
                disabled={reporting}
                onClick={() => onReport(comment)}
              />
            )}
          </span>
        </div>

        <p lang="te" className="te mt-0.5 text-te-body-sm text-ink-soft">
          {comment.body}
        </p>

        {!isReply && canReply ? (
          <Button
            variant="link"
            size="sm"
            icon={CornerDownRight}
            className="-ml-1 mt-1"
            disabled={pending}
            onClick={() => onReply(comment)}
          >
            {L('ప్రత్యుత్తరం', 'Reply')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export function CommentsSection({ shortId }: { shortId: string }) {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const authed = useAuth((state) => state.status === 'authenticated');
  const me = useAuth((state) => state.me?.user);
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<CommentOut | null>(null);

  const queryKey = ['engagement', 'comments', shortId];

  const list = useQuery({
    queryKey,
    queryFn: () => engagementApi.fetchComments(shortId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const post = useMutation({
    mutationFn: (vars: { body: string; parentId: number | null }) =>
      engagementApi.addComment(shortId, vars.body, vars.parentId),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CommentList>(queryKey);
      const optimistic: CommentOut = {
        // Negative so it can never collide with a server id.
        id: -Date.now(),
        parent_id: vars.parentId,
        body: vars.body,
        author_name_te: me?.name_te ?? '',
        author_name_en: me?.name_en ?? '',
        is_mine: true,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<CommentList>(queryKey, (prev) => ({
        total_visible: (prev?.total_visible ?? 0) + 1,
        comments: [...(prev?.comments ?? []), optimistic],
      }));
      setBody('');
      setReplyTo(null);
      return { previous, text: vars.body };
    },
    onError: (error, _vars, context) => {
      if (context) {
        queryClient.setQueryData(queryKey, context.previous);
        // Never swallow what the reader typed.
        setBody(context.text);
      }
      toast.error(error);
    },
    onSettled: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: number) => engagementApi.deleteComment(id),
    onSuccess: () => {
      toast.success(t('state.deleted'));
      void invalidate();
    },
    onError: (error) => toast.error(error),
  });

  const report = useMutation({
    mutationFn: (id: number) => engagementApi.reportComment(id, 'abuse'),
    onSuccess: () => toast.success(t('state.reported')),
    onError: (error) => toast.error(error),
  });

  const threads = useMemo(() => {
    const comments = list.data?.comments ?? [];
    const replies = new Map<number, CommentOut[]>();
    for (const comment of comments) {
      if (comment.parent_id != null) {
        replies.set(comment.parent_id, [...(replies.get(comment.parent_id) ?? []), comment]);
      }
    }
    return comments
      .filter((comment) => comment.parent_id == null)
      .map((comment) => ({ comment, replies: replies.get(comment.id) ?? [] }));
  }, [list.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (text.length > 0) post.mutate({ body: text, parentId: replyTo?.id ?? null });
  }

  async function onDelete(comment: CommentOut) {
    const ok = await confirm({
      title: t('state.confirmDelete'),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    });
    if (ok) remove.mutate(comment.id);
  }

  const replyName = replyTo ? s.text(replyTo.author_name_te, replyTo.author_name_en) : null;
  const total = list.data?.total_visible ?? 0;

  return (
    <section id="comments" className="mt-7 md:mt-10">
      <SectionHeader
        title={t('ui.comments')}
        tone="ink"
        action={total > 0 ? <Badge tone="muted">{total}</Badge> : null}
      />

      {authed ? (
        <form onSubmit={submit} className="mb-5">
          {replyTo && replyName ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={cn(s.body, 'text-ui-sm text-muted')}>
                {L('ప్రత్యుత్తరం:', 'Replying to:')}
              </span>
              <span lang={replyName.lang} className={cn(replyName.cls, 'text-ui-sm font-semibold text-ink')}>
                {replyName.text}
              </span>
              <IconButton icon={X} label={t('ui.cancel')} onClick={() => setReplyTo(null)} />
            </div>
          ) : null}

          <Textarea
            script="te"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            counter={MAX_LENGTH}
            rows={3}
            placeholder={L('మీ అభిప్రాయం రాయండి…', 'Write your comment…')}
            aria-label={t('ui.comments')}
          />

          <div className="mt-2 flex justify-end">
            {/* aria-disabled, not disabled: the real attribute would fire mid-submit
                (onMutate clears the body) and drop focus off the button to <body>. */}
            <Button type="submit" icon={Send} pending={post.isPending} aria-disabled={!body.trim() || undefined}>
              {L('పోస్ట్ చేయండి', 'Post')}
            </Button>
          </div>
        </form>
      ) : (
        <Card tone="paper" padding="md" className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={cn(s.head, 'text-headline-xs font-bold text-ink')}>{t('ui.signInToContinue')}</p>
            <p className={cn(s.body, s.te ? 'text-te-body-sm' : 'text-ui', 'mt-1 text-muted')}>
              {t('ui.signInBody')}
            </p>
          </div>
          <ButtonLink to="/login" variant="secondary">
            {L('సైన్ ఇన్ చేయండి', 'Sign in')}
          </ButtonLink>
        </Card>
      )}

      <QueryState
        query={list}
        isEmpty={() => threads.length === 0}
        skeleton={
          <div className="flex flex-col gap-3">
            <Skeleton variant="block" />
            <Skeleton variant="block" />
          </div>
        }
        empty={
          <EmptyState
            compact
            icon={MessageCircle}
            title={L('ఇంకా వ్యాఖ్యలు లేవు', 'No comments yet')}
            body={L('మొదటి వ్యాఖ్య మీదే కావచ్చు.', 'Be the first to comment.')}
          />
        }
      >
        {() => (
          <ul className="flex flex-col gap-3">
            {threads.map(({ comment, replies }) => (
              <Fragment key={comment.id}>
                <CommentRow
                  comment={comment}
                  canReply={authed}
                  pending={comment.id < 0}
                  reporting={report.isPending}
                  onReply={setReplyTo}
                  onDelete={onDelete}
                  onReport={(target) => report.mutate(target.id)}
                />
                {replies.map((reply) => (
                  <CommentRow
                    key={reply.id}
                    comment={reply}
                    isReply
                    canReply={authed}
                    pending={reply.id < 0}
                    reporting={report.isPending}
                    onReply={setReplyTo}
                    onDelete={onDelete}
                    onReport={(target) => report.mutate(target.id)}
                  />
                ))}
              </Fragment>
            ))}
          </ul>
        )}
      </QueryState>

      {dialog}
    </section>
  );
}
