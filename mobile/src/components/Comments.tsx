import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import * as engagementApi from '@/api/engagement';
import type { CommentOut } from '@/api/engagement';
import { ErrorState, LoadingState, EmptyState } from '@/components/Feedback';
import { timeAgo, useI18n } from '@/lib/i18n';
import { space, TAP } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { ConfirmSheet } from '@/ui/BottomSheet';
import { Button, IconButton } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Divider } from '@/ui/Divider';
import { Input } from '@/ui/Input';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * Comments (§5): visible threads + a composer for signed-in readers.
 *
 * A posted comment lands in the list before the server answers (the cache is
 * written in `onMutate` and restored on failure, with the reader's text handed
 * back to the box), so a slow network never looks like a lost comment.
 */
type CommentList = { total_visible: number; comments: CommentOut[] };

const MAX = 2000;

const useStyles = makeStyles((color) => ({
  section: { marginTop: space.xl, borderTopWidth: 2, borderTopColor: color.rule, paddingTop: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  composer: { gap: space.sm, marginBottom: space.md },
  send: { alignSelf: 'flex-end' },
  signIn: { marginBottom: space.md },
  comment: { paddingVertical: space.sm, gap: space.xs },
  reply: { marginLeft: space.xl, borderLeftWidth: 2, borderLeftColor: color.rule, paddingLeft: space.md },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TAP },
  author: { flex: 1 },
}));

function CommentRow({
  comment,
  onDelete,
}: {
  comment: CommentOut;
  onDelete: (comment: CommentOut) => void;
}) {
  const styles = useStyles();
  const { t, pick, language } = useI18n();
  const pending = comment.id < 0;

  return (
    <View
      style={[styles.comment, comment.parent_id != null && styles.reply, pending && { opacity: 0.6 }]}
    >
      <View style={styles.commentHead}>
        <T variant="meta" weight="bold" numberOfLines={1} style={styles.author}>
          {pick(comment.author_name_te, comment.author_name_en)}
        </T>
        <T variant="meta" color="muted">
          {pending ? t('comments.posting') : timeAgo(comment.created_at, language)}
        </T>
        {comment.is_mine && !pending ? (
          <IconButton name="trash2" label={t('ui.delete')} onPress={() => onDelete(comment)} />
        ) : null}
      </View>
      <T variant="bodySmall" color="inkSoft" scaled>
        {comment.body}
      </T>
    </View>
  );
}

export function Comments({ shortId }: { shortId: string }) {
  const styles = useStyles();
  const { t } = useI18n();
  const toast = useToast();
  const authed = useAuth((s) => s.status === 'authenticated');
  const me = useAuth((s) => s.me);
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [pendingDelete, setPendingDelete] = useState<CommentOut | null>(null);

  const key = ['comments', shortId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => engagementApi.fetchComments(shortId),
  });

  const post = useMutation({
    mutationFn: (text: string) => engagementApi.addComment(shortId, text),
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentList>(key);
      // Negative id = not yet on the server; CommentRow paints it as pending.
      const optimistic: CommentOut = {
        id: -Date.now(),
        parent_id: null,
        body: text,
        author_name_te: me?.user.name_te ?? '',
        author_name_en: me?.user.name_en ?? '',
        is_mine: true,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<CommentList>(key, (old) => ({
        total_visible: (old?.total_visible ?? 0) + 1,
        comments: [...(old?.comments ?? []), optimistic],
      }));
      setBody('');
      return { previous, text };
    },
    onError: (error, _text, context) => {
      queryClient.setQueryData(key, context?.previous);
      setBody(context?.text ?? '');
      toast.error(error);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => engagementApi.deleteComment(id),
    onSuccess: () => {
      setPendingDelete(null);
      toast.success(t('state.deleted'));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      setPendingDelete(null);
      toast.error(error);
    },
  });

  const comments = list.data?.comments ?? [];
  const text = body.trim();

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <T variant="headlineMd" weight="bold" color="brand" accessibilityRole="header">
          {t('comments.title')}
        </T>
        {list.data?.total_visible ? (
          <T variant="meta" color="muted" lang="en">
            {list.data.total_visible}
          </T>
        ) : null}
      </View>

      {/* No KeyboardAvoidingView here: the host screen's <Screen keyboard>
          owns that, and a second one inside a ScrollView measures nothing. */}
      {authed ? (
        <View style={styles.composer}>
          <Input
            value={body}
            onChangeText={setBody}
            placeholder={t('comments.placeholder')}
            multiline
            counter={MAX}
            accessibilityLabel={t('comments.placeholder')}
          />
          <Button
            label={post.isPending ? t('comments.posting') : t('comments.post')}
            icon="send"
            pending={post.isPending}
            disabled={text.length === 0}
            onPress={() => post.mutate(text)}
            style={styles.send}
          />
        </View>
      ) : (
        <Card
          padding="sm"
          tone="paper"
          style={styles.signIn}
          onPress={() => router.push('/profile')}
          accessibilityLabel={t('comments.signIn')}
        >
          <T variant="bodySmall" color="muted">
            {t('comments.signIn')}
          </T>
        </Card>
      )}

      {list.isLoading ? <LoadingState /> : null}
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} fill={false} />
      ) : null}

      {list.data && comments.length === 0 ? (
        <EmptyState icon="messageCircle" body={t('comments.first')} />
      ) : (
        comments.map((comment, i) => (
          <View key={comment.id}>
            {i > 0 ? <Divider /> : null}
            <CommentRow comment={comment} onDelete={setPendingDelete} />
          </View>
        ))
      )}

      <ConfirmSheet
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('ui.delete')}
        body={t('state.confirmDelete')}
        confirmLabel={t('ui.delete')}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </View>
  );
}
