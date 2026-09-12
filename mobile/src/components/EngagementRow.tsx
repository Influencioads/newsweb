import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';

import * as engagementApi from '@/api/engagement';
import type { MyArticleFlags } from '@/api/engagement';
import type { ArticleDetail } from '@/api/types';
import { useI18n } from '@/lib/i18n';
import { SPRING, useMotion } from '@/lib/motion';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { ShareOptionsSheet } from '@/components/ShareSheet';
import { SignInSheet } from '@/components/SignInSheet';
import { ConfirmSheet } from '@/ui/BottomSheet';
import { IconButton } from '@/ui/Button';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * Like · save · share · report (§5).
 *
 * The like and bookmark states are *derived*, never copied into component
 * state: the server flags live in the `['flags', shortId]` query, and while a
 * toggle is in flight the pending variables stand in for the answer — an
 * optimistic paint that rolls back by itself when the mutation settles.
 * An anonymous tap opens the sign-in sheet instead of silently doing nothing.
 */

// ponytail: no i18n keys yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

const useStyles = makeStyles((color) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.rule,
    paddingVertical: space.sm,
    marginTop: space.lg,
  },
  action: { alignItems: 'center', gap: space.xs, flex: 1 },
}));

function Action({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.action}>
      {children}
      {/* Four captions split ~328dp, and 'నివేదించండి' does not fit one line
          there. They are hidden from assistive tech, so wrapping costs nothing. */}
      <T
        variant="meta"
        color="muted"
        align="center"
        numberOfLines={2}
        aria-hidden
      >
        {label}
      </T>
    </View>
  );
}

export function EngagementRow({
  article,
  onComment,
  cardAvailable = false,
}: {
  article: ArticleDetail;
  /** Jump to the comment thread. The button only renders when a screen wires it. */
  onComment?: () => void;
  /** §19 — the server says a shareable card exists, so offer that row. */
  cardAvailable?: boolean;
}) {
  const styles = useStyles();
  const { t, isTelugu } = useI18n();
  const m = useMotion();
  const toast = useToast();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const [signIn, setSignIn] = useState(false);
  const [confirmReport, setConfirmReport] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const flagsKey = ['flags', article.short_id];
  const flags = useQuery({
    queryKey: flagsKey,
    queryFn: () => engagementApi.fetchMyFlags(article.short_id),
    enabled: authed,
  });

  const like = useMutation({
    mutationFn: (v: { id: string; next: boolean }) => engagementApi.setLike(v.id, v.next),
    onSuccess: (counts, v) => {
      queryClient.setQueryData<MyArticleFlags>(['flags', v.id], (old) => ({
        liked: v.next,
        bookmarked: old?.bookmarked ?? false,
      }));
    },
    onError: (error) => toast.error(error),
  });

  const bookmark = useMutation({
    mutationFn: (v: { id: string; next: boolean }) => engagementApi.setBookmark(v.id, v.next),
    onSuccess: (data, v) => queryClient.setQueryData<MyArticleFlags>(['flags', v.id], data),
    onError: (error) => toast.error(error),
  });

  const report = useMutation({
    mutationFn: (id: string) => engagementApi.reportArticle(id, 'other'),
    onSuccess: () => {
      setConfirmReport(false);
      toast.success(t('state.reported'));
    },
    onError: (error) => {
      setConfirmReport(false);
      toast.error(error);
    },
  });

  // Derived, not stored: the pending variables win while a toggle is in flight,
  // and the server flags take back over the moment it settles.
  const mine = (id: string | undefined) => id === article.short_id;
  const liked =
    like.isPending && mine(like.variables?.id) ? like.variables.next : (flags.data?.liked ?? false);
  const bookmarked =
    bookmark.isPending && mine(bookmark.variables?.id)
      ? bookmark.variables.next
      : (flags.data?.bookmarked ?? false);
  const likeCount =
    like.data && mine(like.variables?.id) ? like.data.like_count : article.like_count;
  const reported = report.isSuccess && mine(report.variables);

  function gate(run: () => void): void {
    if (!authed) {
      setSignIn(true);
      return;
    }
    run();
  }

  return (
    <View style={styles.row}>
      <Action label={t('engage.like')}>
        <Animated.View style={popStyle}>
          <IconButton
            name="heart"
            label={`${t('engage.like')} ${likeCount}`}
            active={liked}
            badge={likeCount > 0 ? likeCount : null}
            disabled={like.isPending}
            haptic={liked ? 'light' : 'success'}
            onPress={() =>
              gate(() => {
                if (!liked) pop.value = withSequence(m.spring(1.25, SPRING.press), m.spring(1, SPRING.press));
                like.mutate({ id: article.short_id, next: !liked });
              })
            }
          />
        </Animated.View>
      </Action>

      <Action label={bookmarked ? t('engage.saved') : t('engage.save')}>
        <IconButton
          name={bookmarked ? 'bookmarkCheck' : 'bookmark'}
          label={bookmarked ? t('engage.saved') : t('engage.save')}
          active={bookmarked}
          disabled={bookmark.isPending}
          onPress={() => gate(() => bookmark.mutate({ id: article.short_id, next: !bookmarked }))}
        />
      </Action>

      {onComment ? (
        <Action label={t('ui.comments')}>
          <IconButton
            name="messageCircle"
            label={`${t('ui.comments')} ${article.comment_count}`}
            badge={article.comment_count > 0 ? article.comment_count : null}
            onPress={onComment}
          />
        </Action>
      ) : null}

      <Action label={t('article.share')}>
        <IconButton name="share2" label={t('article.share')} onPress={() => setShareOpen(true)} />
      </Action>

      <Action label={reported ? t('engage.reported') : t('engage.report')}>
        <IconButton
          name="flag"
          label={reported ? t('engage.reported') : t('engage.report')}
          active={reported}
          disabled={reported || report.isPending}
          onPress={() => gate(() => setConfirmReport(true))}
        />
      </Action>

      <ShareOptionsSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shortId={article.short_id}
        url={article.url}
        title={article.title_te}
        cardAvailable={cardAvailable}
      />

      <ConfirmSheet
        open={confirmReport}
        onClose={() => setConfirmReport(false)}
        title={t('engage.report')}
        body={L(
          'ఈ కథనాన్ని సమీక్ష కోసం నివేదిస్తారా?',
          'Report this story for review?',
          isTelugu,
        )}
        confirmLabel={t('engage.report')}
        tone="danger"
        pending={report.isPending}
        onConfirm={() => report.mutate(article.short_id)}
      />

      <SignInSheet open={signIn} onClose={() => setSignIn(false)} />
    </View>
  );
}
