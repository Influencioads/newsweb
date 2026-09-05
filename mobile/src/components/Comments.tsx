import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import * as engagementApi from '@/api/engagement';
import { timeAgo, useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { useAuth } from '@/stores/auth';

/** Comments (§5): visible threads + a composer for signed-in readers. */
export function Comments({ shortId }: { shortId: string }) {
  const { t, pick, language } = useI18n();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const list = useQuery({
    queryKey: ['comments', shortId],
    queryFn: () => engagementApi.fetchComments(shortId),
  });

  const post = useMutation({
    mutationFn: () => engagementApi.addComment(shortId, body.trim()),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['comments', shortId] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => engagementApi.deleteComment(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['comments', shortId] }),
  });

  const comments = list.data?.comments ?? [];

  return (
    <View style={styles.section}>
      <Text style={styles.title}>
        {t('comments.title')}
        {list.data?.total_visible ? ` (${list.data.total_visible})` : ''}
      </Text>

      {authed ? (
        <View style={styles.composer}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={t('comments.placeholder')}
            placeholderTextColor={color.mutedLight}
            multiline
            maxLength={2000}
            style={styles.input}
          />
          <Pressable
            onPress={() => post.mutate()}
            disabled={post.isPending || !body.trim()}
            accessibilityRole="button"
            style={[styles.postButton, (post.isPending || !body.trim()) && { opacity: 0.5 }]}
          >
            <Text style={styles.postButtonText}>
              {post.isPending ? t('comments.posting') : t('comments.post')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.signInHint}>{t('comments.signIn')}</Text>
      )}

      {comments.length === 0 ? (
        <Text style={styles.empty}>{t('comments.first')}</Text>
      ) : (
        comments.map((comment) => (
          <View
            key={comment.id}
            style={[styles.comment, comment.parent_id != null && styles.reply]}
          >
            <View style={styles.commentHead}>
              <Text style={styles.author}>
                {pick(comment.author_name_te, comment.author_name_en)}
              </Text>
              <Text style={styles.time}>{timeAgo(comment.created_at, language)}</Text>
              {comment.is_mine ? (
                <Pressable
                  onPress={() => remove.mutate(comment.id)}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={styles.delete}>✕</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.body}>{comment.body}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 20,
    borderTopWidth: 2,
    borderTopColor: color.ink,
    paddingTop: 10,
  },
  title: { fontFamily: font.headline, fontSize: 18, lineHeight: 28, color: color.brand, marginBottom: 8 },
  composer: { marginBottom: 12 },
  input: {
    borderWidth: 1.5,
    borderColor: color.ruleStrong,
    borderRadius: 8,
    backgroundColor: color.white,
    padding: 10,
    minHeight: 72,
    textAlignVertical: 'top',
    fontFamily: font.telugu,
    fontSize: 15,
    lineHeight: 24,
    color: color.ink,
  },
  postButton: {
    alignSelf: 'flex-end',
    marginTop: 8,
    backgroundColor: color.brand,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  postButtonText: { fontFamily: font.teluguBold, fontSize: 13, lineHeight: 20, color: color.white },
  signInHint: {
    fontFamily: font.telugu,
    fontSize: 13,
    lineHeight: 21,
    color: color.muted,
    backgroundColor: color.paperSub,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  empty: { fontFamily: font.telugu, fontSize: 13, lineHeight: 21, color: color.muted },
  comment: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.rule },
  reply: { marginLeft: 24, borderLeftWidth: 2, borderLeftColor: color.rule, paddingLeft: 10 },
  commentHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  author: { fontFamily: font.teluguBold, fontSize: 12.5, lineHeight: 19, color: color.ink, flex: 1 },
  time: { fontFamily: font.telugu, fontSize: 10.5, lineHeight: 16, color: color.mutedLight },
  delete: { color: color.breaking, fontSize: 13, paddingHorizontal: 4 },
  body: { fontFamily: font.telugu, fontSize: 14.5, lineHeight: 24, color: color.inkSoft, marginTop: 2 },
});
