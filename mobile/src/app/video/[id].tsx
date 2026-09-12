import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Share, View } from 'react-native';
import { WebView } from 'react-native-webview';

import * as engagementApi from '@/api/engagement';
import * as publicApi from '@/api/public';
import type { ReactionKind, VideoComment } from '@/api/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { SectionHeader } from '@/components/SectionHeader';
import { VideoCard, formatCount } from '@/components/VideoCard';
import { anonId } from '@/lib/beacon';
import { timeAgo, useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { radius, space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Divider } from '@/ui/Divider';
import { Icon, type IconName } from '@/ui/Icon';
import { Input } from '@/ui/Input';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * Video screen (§15) — the app twin of the web video page.
 *
 * Player, title, hashtags, counts, then the publisher we are required to
 * credit and that a reader can follow, the sentiment bar, comments, and what
 * to watch next. The embed is `youtube-nocookie`; autoplay is fine because the
 * reader tapped a card to get here — §15's "no aggressive autoplay" is about
 * feeds, not a screen someone opened on purpose.
 */
const REACTIONS: { kind: ReactionKind; icon: IconName; te: string; en: string }[] = [
  { kind: 'happy', icon: 'smile', te: 'సంతోషం', en: 'Happy' },
  { kind: 'sad', icon: 'frown', te: 'బాధ', en: 'Sad' },
  { kind: 'angry', icon: 'angry', te: 'కోపం', en: 'Angry' },
];

const COMMENT_MAX = 1000;

// YouTube error 153 is returned when an embedded player has no HTTP Referer
// or equivalent client identity. Native WebViews do not reliably add one, so
// identify this app with the same public origin that serves its API and web UI.
const PLAYER_ORIGIN = 'https://telugunews.influencioweb.com';

function CommentRow({ comment }: { comment: VideoComment }) {
  const styles = useStyles();
  const { pick, language } = useI18n();
  return (
    <View style={styles.comment}>
      <View style={styles.commentHead}>
        <T variant="meta" weight="bold" numberOfLines={1} style={styles.commentAuthor}>
          {pick(comment.author_name_te, comment.author_name_en)}
        </T>
        <T variant="meta" color="muted">
          {timeAgo(comment.created_at, language)}
        </T>
      </View>
      <T variant="bodySmall" color="inkSoft" scaled>
        {comment.body}
      </T>
    </View>
  );
}

export default function VideoScreen() {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { id } = useLocalSearchParams<{ id: string }>();
  const videoId = Number(id);
  const { t, pick, isTelugu, language } = useI18n();
  const L = (te: string, en: string) => (isTelugu ? te : en);
  const toast = useToast();
  const queryClient = useQueryClient();
  const authed = useAuth((s) => s.status === 'authenticated');

  const [anon, setAnon] = useState<string | null>(null);
  useEffect(() => {
    void anonId().then(setAnon);
  }, []);

  const video = useQuery({
    queryKey: ['video', videoId, anon],
    queryFn: () => publicApi.fetchVideo(videoId, anon),
    enabled: Number.isFinite(videoId) && anon !== null,
  });

  // One view per arrival, not per re-render.
  useEffect(() => {
    if (Number.isFinite(videoId)) void publicApi.countVideoView(videoId);
  }, [videoId]);

  const react = useMutation({
    mutationFn: (kind: ReactionKind | null) => publicApi.setVideoReaction(videoId, kind, anon),
    onSuccess: (summary) =>
      queryClient.setQueryData(['video', videoId, anon], (old: unknown) =>
        old ? { ...(old as object), reactions: summary } : old),
    onError: (error) => toast.error(error),
  });

  const follow = useMutation({
    mutationFn: (next: boolean) =>
      engagementApi.setFollow('channel', video.data!.channel!.key, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', videoId, anon] }),
    onError: (error) => toast.error(error),
  });

  const comments = useQuery({
    queryKey: ['video-comments', videoId],
    queryFn: () => publicApi.fetchVideoComments(videoId),
    enabled: Number.isFinite(videoId),
  });

  const [draft, setDraft] = useState('');
  const addComment = useMutation({
    mutationFn: () => publicApi.addVideoComment(videoId, draft, null),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['video-comments', videoId] });
      void queryClient.invalidateQueries({ queryKey: ['video', videoId, anon] });
    },
    // The draft is only cleared on success, so a failed post keeps the text.
    onError: (error) => toast.error(error),
  });

  async function share() {
    const data = video.data;
    if (!data) return;
    void publicApi.countVideoShare(data.id);
    await Share.share({ message: `${pick(data.title_te, data.title_en)}\n${data.watch_url}` });
  }

  // The route draws its own ScreenHeader (the title still names it in the
  // navigator): a native header would sit outside the KeyboardAvoidingView's
  // frame and under-lift the comment composer by its own height.
  const chrome = (
    <>
      <Stack.Screen options={{ headerShown: false, title: t('screen.video') }} />
      <ScreenHeader title={t('screen.video')} />
    </>
  );

  if (video.isLoading || anon === null) {
    return (
      <Screen edges={['top']}>
        {chrome}
        <LoadingState />
      </Screen>
    );
  }
  if (video.isError || !video.data) {
    return (
      <Screen edges={['top']}>
        {chrome}
        <ErrorState error={video.error} onRetry={() => void video.refetch()} />
      </Screen>
    );
  }

  const data = video.data;
  const channel = data.channel;
  const threads = (comments.data?.comments ?? []).filter((c) => c.parent_id == null);
  const playerUrl = `${data.embed_url}?autoplay=1&rel=0&playsinline=1&origin=${encodeURIComponent(
    PLAYER_ORIGIN,
  )}&widget_referrer=${encodeURIComponent(PLAYER_ORIGIN)}`;
  const draftText = draft.trim();

  return (
    <Screen edges={['top']} keyboard bottomInset>
      {chrome}
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ------------------------------------------------------ player -- */}
        <View
          style={styles.player}
          accessible
          accessibilityLabel={pick(data.title_te, data.title_en)}
        >
          <WebView
            source={{ uri: playerUrl, headers: { Referer: `${PLAYER_ORIGIN}/` } }}
            style={styles.webview}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
          />
        </View>

        <View style={styles.body}>
          <T variant="headlineMd" weight="bold" scaled accessibilityRole="header">
            {pick(data.title_te, data.title_en)}
          </T>

          <T variant="meta" color="muted">
            {[
              `${formatCount(data.view_count, isTelugu)} ${L('వ్యూస్', 'views')}`,
              timeAgo(data.published_at, language),
            ]
              .filter(Boolean)
              .join(' · ')}
          </T>

          {data.tags.length ? (
            <View style={styles.chips}>
              {data.tags.map((tag) => (
                <Chip
                  key={tag.slug}
                  label={`#${pick(tag.name_te, tag.name_en)}`}
                  onPress={() =>
                    router.push({ pathname: '/section/[slug]', params: { slug: tag.slug } })
                  }
                />
              ))}
            </View>
          ) : null}

          {/* --------------------------------------------- publisher row -- */}
          <Card padding="md" style={styles.channel}>
            <View style={styles.avatar}>
              {channel?.avatar_url ? (
                <Image
                  source={{ uri: channel.avatar_url }}
                  style={styles.avatarImage}
                  contentFit="cover"
                  transition={m.imageTransition}
                />
              ) : (
                <Icon name="video" size={20} color={color.brand} />
              )}
            </View>
            <View style={styles.channelText}>
              <T variant="headlineSm" weight="bold" scaled numberOfLines={1}>
                {channel?.name ?? L('YouTube నుంచి', 'From YouTube')}
              </T>
              {channel ? (
                <T variant="meta" color="muted" numberOfLines={1}>
                  {channel.follower_count > 0
                    ? `${formatCount(channel.follower_count, isTelugu)} ${L('ఫాలోయర్లు', 'followers')}`
                    : L('YouTube ఛానెల్', 'YouTube channel')}
                </T>
              ) : null}
            </View>
            {channel?.is_verified ? (
              <Badge tone="info" size="xs" icon="checkCircle2" label={L('ధృవీకరించినది', 'Verified')} />
            ) : null}
            {channel ? (
              <Chip
                label={data.following_channel ? t('ui.following') : t('ui.follow')}
                icon={data.following_channel ? 'check' : 'plus'}
                selected={data.following_channel}
                disabled={follow.isPending}
                accessibilityLabel={`${data.following_channel ? t('ui.following') : t('ui.follow')}: ${channel.name}`}
                onPress={() =>
                  authed ? follow.mutate(!data.following_channel) : router.push('/profile')
                }
              />
            ) : null}
          </Card>

          <View style={styles.actions}>
            <Button label={t('ui.share')} icon="share2" variant="secondary" onPress={() => void share()} />
            <Button
              label="YouTube"
              icon="externalLink"
              variant="secondary"
              lang="en"
              onPress={() => void Linking.openURL(data.watch_url).catch(() => undefined)}
            />
          </View>

          <T variant="meta" color="muted" scaled>
            {L(
              'ఈ వీడియో YouTubeలో ప్రచురితమైంది. హక్కులు సంబంధిత ఛానెల్‌వి.',
              'This video is published on YouTube. Rights belong to the channel.',
            )}
          </T>

          {/* ------------------------------------------------- reactions -- */}
          <Divider style={styles.rule} />
          <T variant="headlineSm" weight="bold" accessibilityRole="header">
            {L('మీ స్పందన ఏంటి?', 'How do you feel about this?')}
          </T>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {REACTIONS.map((choice) => {
              const mine = data.reactions.mine === choice.kind;
              return (
                <Chip
                  key={choice.kind}
                  label={L(choice.te, choice.en)}
                  icon={choice.icon}
                  role="radio"
                  selected={mine}
                  count={data.reactions.counts[choice.kind]}
                  disabled={react.isPending}
                  // Tapping the chosen one again clears it — a reaction you
                  // cannot take back is a trap, not a control.
                  onPress={() => react.mutate(mine ? null : choice.kind)}
                />
              );
            })}
          </View>

          {/* -------------------------------------------------- comments -- */}
          <Divider style={styles.rule} />
          <View style={styles.commentsHead}>
            <T variant="headlineSm" weight="bold" accessibilityRole="header">
              {t('comments.title')}
            </T>
            {data.comment_count > 0 ? (
              <T variant="meta" color="muted" lang="en">
                {String(data.comment_count)}
              </T>
            ) : null}
          </View>

          {authed ? (
            <View style={styles.composer}>
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder={t('comments.placeholder')}
                multiline
                counter={COMMENT_MAX}
                accessibilityLabel={t('comments.placeholder')}
              />
              <Button
                label={addComment.isPending ? t('comments.posting') : t('comments.post')}
                icon="send"
                pending={addComment.isPending}
                disabled={draftText.length === 0}
                onPress={() => addComment.mutate()}
                style={styles.send}
              />
            </View>
          ) : (
            <Card padding="sm" tone="paper" onPress={() => router.push('/profile')} accessibilityLabel={t('comments.signIn')}>
              <T variant="bodySmall" color="muted">
                {t('comments.signIn')}
              </T>
            </Card>
          )}

          {comments.isLoading ? <LoadingState /> : null}
          {comments.isError ? (
            <ErrorState error={comments.error} onRetry={() => void comments.refetch()} fill={false} />
          ) : null}
          {comments.data && threads.length === 0 ? (
            <EmptyState icon="messageCircle" body={t('comments.first')} />
          ) : (
            threads.map((comment, i) => (
              <View key={comment.id}>
                {i > 0 ? <Divider /> : null}
                <CommentRow comment={comment} />
              </View>
            ))
          )}
        </View>

        {/* --------------------------------------------------- related -- */}
        {data.related.length ? (
          <>
            <SectionHeader title={L('సిఫారసు చేసిన వీడియోలు', 'Recommended videos')} />
            <View style={styles.related}>
              {data.related.map((item) => (
                <VideoCard key={item.id} video={item} wide />
              ))}
            </View>
            <ListFooter end />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles((color) => ({
  scroll: { flex: 1 },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: color.inkDeep },
  webview: { flex: 1, backgroundColor: color.inkDeep },
  body: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rule: { marginTop: space.md },

  channel: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  avatar: {
    width: TAP_LG,
    height: TAP_LG,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: color.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  channelText: { flex: 1, minWidth: 0, gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },

  commentsHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  composer: { gap: space.sm },
  send: { alignSelf: 'flex-end' },
  comment: { paddingVertical: space.sm, gap: space.xs },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  commentAuthor: { flex: 1 },

  related: { paddingHorizontal: space.lg, paddingBottom: space.lg },
}));
