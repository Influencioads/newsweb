import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as engagementApi from '@/api/engagement';
import type { ArticleDetail } from '@/api/types';
import { ShareOptionsSheet } from '@/components/ShareSheet';
import { SignInSheet } from '@/components/SignInSheet';
import { useI18n } from '@/lib/i18n';
import { space, TAP } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { IconButton } from '@/ui/Button';
import { Divider } from '@/ui/Divider';
import { FontSizeSheet } from '@/ui/FontSizeSheet';
import { useToast } from '@/ui/Toast';

/**
 * The reading action bar — text size, listen, save, share, comments.
 *
 * It is pinned to the bottom edge and slides away on a scroll down / returns
 * on a scroll up (the screen drives `hidden` 0 → 1 with a spring), so the
 * story owns the screen while the controls stay one flick away. Save and
 * share keep the §5 wiring: the same `['flags', shortId]` cache the
 * EngagementRow writes, optimistic while a toggle is in flight, and an
 * anonymous tap opens the same sign-in sheet the row does.
 *
 * The listen button does *not* own a player: the screen keeps `ArticleAudio`
 * mounted in the story so playback survives any sheet, and this only jumps to
 * it (or stops the device voice when that is what is talking).
 */
export interface ArticleActionBarProps {
  article: ArticleDetail;
  /** §19 — the server says whether a shareable card exists for this story. */
  cardAvailable: boolean;
  /** Device-voice state from `useTts` on the screen. */
  speaking: boolean;
  onToggleSpeech: () => void;
  /** Scroll the story to the inline player. */
  onListen: () => void;
  /** 0 = shown, 1 = tucked below the edge. */
  hidden: SharedValue<number>;
  onComments: () => void;
}

/** Bar height above the home-indicator inset — the screen pads its scroll by it. */
export const ACTION_BAR_HEIGHT = TAP + space.sm * 2;

type Sheet = 'font' | 'share' | 'signIn';

export function ArticleActionBar({
  article,
  cardAvailable,
  speaking,
  onToggleSpeech,
  onListen,
  hidden,
  onComments,
}: ArticleActionBarProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const toast = useToast();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const flags = useQuery({
    queryKey: ['flags', article.short_id],
    queryFn: () => engagementApi.fetchMyFlags(article.short_id),
    enabled: authed,
  });

  const bookmark = useMutation({
    mutationFn: (next: boolean) => engagementApi.setBookmark(article.short_id, next),
    onSuccess: (data) => queryClient.setQueryData(['flags', article.short_id], data),
    onError: (error) => toast.error(error),
  });

  // Derived like the EngagementRow's: the in-flight value paints, the server
  // flags take back over the moment it settles — a failure never sticks.
  const bookmarked = bookmark.isPending ? bookmark.variables : (flags.data?.bookmarked ?? false);

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: hidden.value * (ACTION_BAR_HEIGHT + insets.bottom) }],
  }));

  return (
    <>
      <Animated.View style={[styles.bar, { paddingBottom: insets.bottom }, slide]}>
        <Divider />
        <View style={styles.row}>
          <IconButton name="type" label={t('ui.fontSize')} onPress={() => setSheet('font')} />
          <IconButton
            name={speaking ? 'pause' : 'headphones'}
            label={speaking ? t('article.stopListening') : t('article.listen')}
            active={speaking}
            onPress={() => (speaking ? onToggleSpeech() : onListen())}
          />
          <IconButton
            name={bookmarked ? 'bookmarkCheck' : 'bookmark'}
            label={bookmarked ? t('engage.saved') : t('engage.save')}
            active={bookmarked}
            disabled={bookmark.isPending}
            onPress={() => {
              if (!authed) {
                setSheet('signIn');
                return;
              }
              bookmark.mutate(!bookmarked);
            }}
          />
          <IconButton name="share2" label={t('article.share')} onPress={() => setSheet('share')} />
          <IconButton
            name="messageCircle"
            label={t('comments.title')}
            badge={article.comment_count > 99 ? '99+' : article.comment_count}
            onPress={onComments}
          />
        </View>
      </Animated.View>

      <FontSizeSheet open={sheet === 'font'} onClose={() => setSheet(null)} />

      <ShareOptionsSheet
        open={sheet === 'share'}
        onClose={() => setSheet(null)}
        shortId={article.short_id}
        url={article.url}
        title={article.title_te}
        cardAvailable={cardAvailable}
      />

      <SignInSheet open={sheet === 'signIn'} onClose={() => setSheet(null)} />
    </>
  );
}

const useStyles = makeStyles((color) => ({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.paper },
  row: {
    height: ACTION_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: space.sm,
  },
}));
