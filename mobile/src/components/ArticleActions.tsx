import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';

import * as engagementApi from '@/api/engagement';
import type { MyArticleFlags } from '@/api/engagement';
import type { ArticleCard } from '@/api/types';
import { ShareOptionsSheet, useShareActions } from '@/components/ShareSheet';
import { SignInSheet } from '@/components/SignInSheet';
import { useI18n } from '@/lib/i18n';
import { SPRING, useMotion } from '@/lib/motion';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { ConfirmSheet } from '@/ui/BottomSheet';
import { Button, IconButton } from '@/ui/Button';
import { useToast } from '@/ui/Toast';

/**
 * The one action row: like · comment · share · report, then WhatsApp.
 *
 * **Why one component.** The article screen used to mount two of these — an
 * inline `EngagementRow` and the pinned `ArticleActionBar` — so bookmark and
 * share each rendered twice on the same screen and there were two comment
 * buttons, one of them dead code. The web had already hit this and written the
 * resolution down in `EngagementBar.tsx`; this is that resolution, rotated to
 * a header/footer axis. Reading controls (text size, listen, save) live in
 * `ArticleHeader`; engagement lives here. Nothing appears in both places.
 *
 * **Why WhatsApp is a button and not a row in a sheet.** It is how this
 * product is actually distributed, and two taps to reach it is one too many.
 * It is the only *filled* control in the row, which is a stronger prominence
 * signal than colour and costs no new token — and deliberately not WhatsApp
 * green: a third hue in a two-hue identity, and a hex outside `theme.ts` is an
 * audit failure anyway. The glyph is the real brand mark (`ui/glyphs.tsx`),
 * because lucide ships none and this button lives or dies on recognition.
 *
 * **Flags are derived, never stored.** The server answer lives in the
 * `['flags', shortId]` query; while a toggle is in flight the pending
 * variables stand in for it. A failure rolls back by itself. An anonymous tap
 * opens the sign-in sheet rather than silently doing nothing.
 *
 * **`flags="cache"` is what keeps feeds cheap.** Twenty mounted rows each
 * firing their own `/me` request is twenty requests per scroll page, so a card
 * subscribes to the cache without ever fetching. Liking from a card writes
 * that cache through, so the heart fills instantly; a story never opened just
 * shows an unfilled one.
 *
 * ponytail: cards read flags from cache only — there is no batch endpoint. Add
 * GET /articles/flags?ids= if unfilled hearts on a cold feed become a complaint.
 */

export interface ArticleActionsProps {
  /** `ArticleCard` is enough — every feed card carries the counts and the url. */
  article: ArticleCard;
  /** `article` adds the report button and the captions; `card` is the strip. */
  size?: 'card' | 'article';
  /** §19 — the server says a shareable card image exists for this story. */
  cardAvailable?: boolean;
  /** Jump to the thread. Omitted on a card, where the whole card opens it. */
  onComment?: () => void;
  /** 'fetch' issues the flags query; 'cache' subscribes without requesting. */
  flags?: 'fetch' | 'cache';
}

const useStyles = makeStyles((color) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  article: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.rule,
    paddingVertical: space.sm,
    marginTop: space.lg,
  },
  card: {
    paddingHorizontal: space.sm,
    paddingBottom: space.xs,
  },
  slot: { flex: 1, alignItems: 'center' },
  whatsapp: { flexShrink: 0 },
}));

export function ArticleActions({
  article,
  size = 'card',
  cardAvailable = false,
  onComment,
  flags: flagsMode = 'fetch',
}: ArticleActionsProps) {
  const styles = useStyles();
  const { t } = useI18n();
  const m = useMotion();
  const toast = useToast();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const [signIn, setSignIn] = useState(false);
  const [confirmReport, setConfirmReport] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const isArticle = size === 'article';
  const { whatsapp } = useShareActions({
    shortId: article.short_id,
    url: article.url,
    title: article.title_te,
  });

  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const flags = useQuery({
    queryKey: ['flags', article.short_id],
    queryFn: () => engagementApi.fetchMyFlags(article.short_id),
    // A card never fetches — it only reads whatever the cache already holds.
    enabled: authed && flagsMode === 'fetch',
  });

  const like = useMutation({
    mutationFn: (v: { id: string; next: boolean }) => engagementApi.setLike(v.id, v.next),
    onSuccess: (_counts, v) => {
      queryClient.setQueryData<MyArticleFlags>(['flags', v.id], (old) => ({
        liked: v.next,
        bookmarked: old?.bookmarked ?? false,
      }));
    },
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

  const mine = (id: string | undefined) => id === article.short_id;
  const liked =
    like.isPending && mine(like.variables?.id) ? like.variables.next : (flags.data?.liked ?? false);
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
    <View style={[styles.row, isArticle ? styles.article : styles.card]}>
      <View style={styles.slot}>
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
                if (!liked) {
                  pop.value = withSequence(
                    m.spring(1.25, SPRING.press),
                    m.spring(1, SPRING.press),
                  );
                }
                like.mutate({ id: article.short_id, next: !liked });
              })
            }
          />
        </Animated.View>
      </View>

      <View style={styles.slot}>
        <IconButton
          name="comment"
          label={`${t('ui.comments')} ${article.comment_count}`}
          badge={article.comment_count > 99 ? '99+' : article.comment_count || null}
          // On a card there is nowhere to scroll to, so the tap opens the
          // story — the card's own press target already does that.
          disabled={!onComment}
          onPress={onComment}
        />
      </View>

      <View style={styles.slot}>
        <IconButton name="share" label={t('article.share')} onPress={() => setShareOpen(true)} />
      </View>

      {isArticle ? (
        <View style={styles.slot}>
          <IconButton
            name="flag"
            label={reported ? t('engage.reported') : t('engage.report')}
            active={reported}
            disabled={reported || report.isPending}
            onPress={() => gate(() => setConfirmReport(true))}
          />
        </View>
      ) : null}

      <Button
        variant="primary"
        icon="whatsapp"
        label={t('ui.whatsapp')}
        onPress={() => void whatsapp()}
        style={styles.whatsapp}
      />

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
        body={t('engage.reportConfirm')}
        confirmLabel={t('engage.report')}
        tone="danger"
        pending={report.isPending}
        onConfirm={() => report.mutate(article.short_id)}
      />

      <SignInSheet open={signIn} onClose={() => setSignIn(false)} />
    </View>
  );
}
