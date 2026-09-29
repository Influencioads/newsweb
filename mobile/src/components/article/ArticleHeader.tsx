import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import * as engagementApi from '@/api/engagement';
import { SignInSheet } from '@/components/SignInSheet';
import { useI18n } from '@/lib/i18n';
import { radius, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { IconButton } from '@/ui/Button';
import { FontSizeSheet } from '@/ui/FontSizeSheet';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useToast } from '@/ui/Toast';

/**
 * The article screen's header: the standard ScreenHeader (collapsing against
 * the reader's scroll) with the reading-progress rule welded to its bottom
 * edge, so the bar that says "where am I in this story" is part of the chrome
 * rather than a floating overlay.
 *
 * It also owns the three **reading** controls — text size, listen, save.
 * They used to sit in the pinned bottom bar beside share and comments, which
 * put two different kinds of thing in one strip and left save and share
 * rendered twice on the same screen. Engagement (like, comment, share, report,
 * WhatsApp) is now the bottom bar's only job; changing how the story reads is
 * the header's. The web makes the same split along a different axis.
 *
 * `progress` is 0 → 1, derived from contentOffset / (contentSize - viewport)
 * on the UI thread; the fill is a full-width bar scaled on X from its left
 * edge, which keeps the whole thing off the JS thread.
 */
export interface ArticleHeaderProps {
  title: string;
  subtitle?: string;
  scrollY: SharedValue<number>;
  progress: SharedValue<number>;
  /** Short id of the story, for the save toggle. */
  shortId: string;
  /** Device-voice state from `useTts` on the screen. */
  speaking: boolean;
  onToggleSpeech: () => void;
  /** Scroll the story to the inline player. */
  onListen: () => void;
}

const TRACK = 3;

export function ArticleHeader({
  title,
  subtitle,
  scrollY,
  progress,
  shortId,
  speaking,
  onToggleSpeech,
  onListen,
}: ArticleHeaderProps) {
  const styles = useStyles();
  const { t } = useI18n();
  const toast = useToast();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<'font' | 'signIn' | null>(null);

  const flags = useQuery({
    queryKey: ['flags', shortId],
    queryFn: () => engagementApi.fetchMyFlags(shortId),
    enabled: authed,
  });

  const bookmark = useMutation({
    mutationFn: (next: boolean) => engagementApi.setBookmark(shortId, next),
    onSuccess: (data) => queryClient.setQueryData(['flags', shortId], data),
    onError: (error) => toast.error(error),
  });

  // Derived, not stored: the in-flight value paints and the server flags take
  // back over the moment it settles, so a failure never sticks.
  const bookmarked = bookmark.isPending ? bookmark.variables : (flags.data?.bookmarked ?? false);

  // Deliberately not gated on `m.reduce`: this is a scrollbar, not motion. It
  // has no duration, no easing and no life of its own — it only reports where
  // the finger already is, and hiding it would take a position readout away
  // from the reader who most needs one.
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        collapsible={{ scrollY }}
        showRule={false}
        right={
          <View style={styles.controls}>
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
          </View>
        }
      />
      <View style={styles.track} aria-hidden>
        <Animated.View style={[styles.fill, fill]} />
      </View>

      <FontSizeSheet open={sheet === 'font'} onClose={() => setSheet(null)} />
      <SignInSheet open={sheet === 'signIn'} onClose={() => setSheet(null)} />
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  root: { backgroundColor: color.paper },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  track: { height: TRACK, backgroundColor: color.ruleSoft },
  fill: {
    width: '100%',
    height: TRACK,
    borderTopRightRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
    backgroundColor: color.brand,
    transformOrigin: 'left center',
  },
}));
