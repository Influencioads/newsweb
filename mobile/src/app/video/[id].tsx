import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';

import * as engagementApi from '@/api/engagement';
import * as publicApi from '@/api/public';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { VideoCard, formatCount } from '@/components/VideoCard';
import { anonId } from '@/lib/beacon';
import { useI18n } from '@/lib/i18n';
import { font } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import type { ReactionKind } from '@/api/types';

/**
 * Video screen (§15) — the app twin of the web video page.
 *
 * Player, title, hashtags, counts, then the publisher we are required to
 * credit and that a reader can follow, the sentiment bar, comments, and what
 * to watch next. The embed is `youtube-nocookie`; autoplay is fine because the
 * reader tapped a card to get here — §15's "no aggressive autoplay" is about
 * feeds, not a screen someone opened on purpose.
 */

const REACTIONS: Array<{ kind: ReactionKind; glyph: string; te: string; en: string }> = [
  { kind: 'happy', glyph: '☺', te: 'సంతోషం', en: 'Happy' },
  { kind: 'sad', glyph: '☹', te: 'బాధ', en: 'Sad' },
  { kind: 'angry', glyph: '😠', te: 'కోపం', en: 'Angry' },
];

// YouTube error 153 is returned when an embedded player has no HTTP Referer
// or equivalent client identity. Native WebViews do not reliably add one, so
// identify this app with the same public origin that serves its API and web UI.
const PLAYER_ORIGIN = 'https://telugunews.influencioweb.com';

function relative(iso: string | null, te: boolean): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return te ? 'ఇప్పుడే' : 'just now';
  if (minutes < 60) return `${minutes}${te ? ' ని' : 'm'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${te ? ' గం' : 'h'}`;
  return `${Math.floor(hours / 24)}${te ? ' రో' : 'd'}`;
}

export default function VideoScreen() {
  const styles = useStyles();
  const color = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const videoId = Number(id);
  const { pick, isTelugu } = useI18n();
  const queryClient = useQueryClient();
  const authed = useAuth((s) => s.status === 'authenticated');

  const [anon, setAnon] = useState<string | null>(null);
  useEffect(() => { void anonId().then(setAnon); }, []);

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
  });

  const follow = useMutation({
    mutationFn: (next: boolean) =>
      engagementApi.setFollow('channel', video.data!.channel!.key, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', videoId, anon] }),
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
  });

  async function share() {
    const data = video.data;
    if (!data) return;
    void publicApi.countVideoShare(data.id);
    await Share.share({ message: `${pick(data.title_te, data.title_en)}\n${data.watch_url}` });
  }

  if (video.isLoading || anon === null) {
    return <View style={styles.page}><LoadingState /></View>;
  }
  if (video.isError || !video.data) {
    return <View style={styles.page}><ErrorState onRetry={() => video.refetch()} /></View>;
  }

  const data = video.data;
  const threads = (comments.data?.comments ?? []).filter((c) => c.parent_id == null);
  const playerUrl = `${data.embed_url}?autoplay=1&rel=0&playsinline=1&origin=${encodeURIComponent(
    PLAYER_ORIGIN,
  )}&widget_referrer=${encodeURIComponent(PLAYER_ORIGIN)}`;

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        {/* ------------------------------------------------------ player -- */}
        <View style={styles.player}>
          <WebView
            source={{
              uri: playerUrl,
              headers: { Referer: `${PLAYER_ORIGIN}/` },
            }}
            style={styles.webview}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
          />
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{pick(data.title_te, data.title_en)}</Text>

          {data.tags.length ? (
            <View style={styles.tagRow}>
              {data.tags.map((tag) => (
                <Pressable
                  key={tag.slug}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/section/[slug]', params: { slug: tag.slug } })}
                  style={styles.tag}
                >
                  <Text style={styles.tagText}>#{pick(tag.name_te, tag.name_en)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={styles.meta}>
            {[
              `${formatCount(data.view_count, isTelugu)} ${isTelugu ? 'వ్యూస్' : 'views'}`,
              data.published_at
                ? new Date(data.published_at).toLocaleString('en-IN',
                    { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })
                : null,
            ].filter(Boolean).join(' · ')}
          </Text>

          {/* ------------------------------------------- publisher row -- */}
          <View style={styles.channelRow}>
            {data.channel ? (
              <>
                <View style={styles.avatar}>
                  {data.channel.avatar_url ? (
                    <Image source={{ uri: data.channel.avatar_url }} style={styles.avatarImage}
                           contentFit="cover" />
                  ) : (
                    <Text style={styles.avatarLetter}>
                      {data.channel.name.trim().charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={styles.channelText}>
                  <Text style={styles.channelName} numberOfLines={1}>
                    {data.channel.name}{data.channel.is_verified ? ' ✓' : ''}
                  </Text>
                  <Text style={styles.channelMeta} numberOfLines={1}>
                    {data.channel.follower_count > 0
                      ? `${formatCount(data.channel.follower_count, isTelugu)} ${isTelugu ? 'ఫాలోయర్లు' : 'followers'}`
                      : (isTelugu ? 'YouTube ఛానెల్' : 'YouTube channel')}
                    {data.published_at ? ` · ${relative(data.published_at, isTelugu)}` : ''}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={follow.isPending}
                  onPress={() => (authed ? follow.mutate(!data.following_channel) : router.push('/profile'))}
                  style={[styles.followButton, data.following_channel && styles.followingButton]}
                >
                  <Text style={[styles.followText, data.following_channel && styles.followingText]}>
                    {data.following_channel
                      ? (isTelugu ? 'ఫాలో అవుతున్నారు' : 'Following')
                      : (isTelugu ? 'ఫాలో' : 'Follow')}
                  </Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.channelMeta}>{isTelugu ? 'YouTube నుంచి' : 'From YouTube'}</Text>
            )}
          </View>

          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" onPress={share} style={styles.actionButton}>
              <Text style={styles.actionText}>↗ {isTelugu ? 'షేర్' : 'Share'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openURL(data.watch_url).catch(() => undefined)}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>YouTube</Text>
            </Pressable>
          </View>

          <Text style={styles.disclaimer}>
            {isTelugu
              ? 'ఈ వీడియో YouTubeలో ప్రచురితమైంది. హక్కులు సంబంధిత ఛానెల్‌వి.'
              : 'This video is published on YouTube. Rights belong to the channel.'}
          </Text>

          {/* ----------------------------------------------- reactions -- */}
          <Text style={styles.sectionTitle}>
            {isTelugu ? 'మీ స్పందన ఏంటి?' : 'How do you feel about this?'}
          </Text>
          <View style={styles.reactionRow}>
            {REACTIONS.map((choice) => {
              const mine = data.reactions.mine === choice.kind;
              return (
                <Pressable
                  key={choice.kind}
                  accessibilityRole="button"
                  accessibilityLabel={isTelugu ? choice.te : choice.en}
                  accessibilityState={{ selected: mine }}
                  disabled={react.isPending}
                  // Tapping the chosen one again clears it — a reaction you
                  // cannot take back is a trap, not a control.
                  onPress={() => react.mutate(mine ? null : choice.kind)}
                  style={[styles.reaction, mine && styles.reactionActive]}
                >
                  <Text style={styles.reactionGlyph}>{choice.glyph}</Text>
                  <Text style={[styles.reactionText, mine && styles.reactionTextActive]}>
                    {data.reactions.percent[choice.kind]}%
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ------------------------------------------------ comments -- */}
          <Text style={styles.sectionTitle}>
            {isTelugu ? 'కామెంట్స్' : 'Comments'} {data.comment_count}
          </Text>

          {authed ? (
            <View style={styles.commentForm}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                maxLength={1000}
                placeholder={isTelugu ? 'కామెంట్ వ్రాయండి' : 'Write a comment'}
                placeholderTextColor={color.mutedLight}
                style={styles.commentInput}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!draft.trim() || addComment.isPending}
                onPress={() => addComment.mutate()}
                style={[styles.postButton, (!draft.trim() || addComment.isPending) && styles.disabled]}
              >
                <Text style={styles.postText}>{isTelugu ? 'పంపండి' : 'Post'}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => router.push('/profile')}>
              <Text style={styles.signInPrompt}>
                {isTelugu ? 'కామెంట్ చేయడానికి లాగిన్ అవ్వండి' : 'Sign in to comment'}
              </Text>
            </Pressable>
          )}

          {threads.length === 0 ? (
            <Text style={styles.channelMeta}>
              {isTelugu ? 'ఇంకా కామెంట్లు లేవు.' : 'No comments yet.'}
            </Text>
          ) : (
            threads.map((comment) => (
              <View key={comment.id} style={styles.comment}>
                <View style={styles.commentAvatar}>
                  <Text style={styles.avatarLetter}>
                    {(comment.author_name_en || '?').trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.commentBody}>
                  <Text style={styles.commentAuthor}>
                    {pick(comment.author_name_te, comment.author_name_en)}
                    {'  '}
                    <Text style={styles.channelMeta}>{relative(comment.created_at, isTelugu)}</Text>
                  </Text>
                  <Text style={styles.commentText}>{comment.body}</Text>
                </View>
              </View>
            ))
          )}

          {/* ------------------------------------------------- related -- */}
          {data.related.length ? (
            <>
              <Text style={styles.sectionTitle}>
                {isTelugu ? 'సిఫారసు చేసిన వీడియోలు' : 'Recommended videos'}
              </Text>
              {data.related.map((item) => (
                <VideoCard key={item.id} video={item} wide />
              ))}
            </>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

const useStyles = makeStyles((color) => ({
  page: { flex: 1, backgroundColor: color.canvas },
  content: { paddingBottom: 32 },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  webview: { flex: 1, backgroundColor: '#000' },
  body: { paddingHorizontal: 16, paddingTop: 12 },
  title: { fontFamily: font.headline, fontSize: 19, lineHeight: 29, color: color.ink },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: {
    borderWidth: 1, borderColor: color.rule, borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  tagText: { fontFamily: font.telugu, fontSize: 12, color: color.inkSoft },
  meta: { fontFamily: font.telugu, fontSize: 12, color: color.mutedLight, marginTop: 8 },

  channelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12,
    borderWidth: 1, borderColor: color.rule, backgroundColor: color.paper,
    borderRadius: 8, padding: 10,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, overflow: 'hidden',
    backgroundColor: color.brandTint, alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarLetter: { fontFamily: font.headline, fontSize: 15, color: color.brand },
  channelText: { flex: 1, minWidth: 0 },
  channelName: { fontFamily: font.teluguBold, fontSize: 13.5, color: color.ink },
  channelMeta: { fontFamily: font.telugu, fontSize: 11.5, lineHeight: 18, color: color.mutedLight },
  followButton: {
    minHeight: 34, justifyContent: 'center', borderRadius: 6,
    backgroundColor: color.brand, paddingHorizontal: 14,
  },
  followingButton: { backgroundColor: color.canvas, borderWidth: 1, borderColor: color.rule },
  followText: { fontFamily: font.teluguBold, fontSize: 12.5, color: color.onBrand },
  followingText: { color: color.muted },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionButton: {
    minHeight: 36, justifyContent: 'center', borderWidth: 1, borderColor: color.rule,
    borderRadius: 6, paddingHorizontal: 14,
  },
  actionText: { fontFamily: font.teluguSemiBold, fontSize: 12.5, color: color.brand },
  disclaimer: { fontFamily: font.telugu, fontSize: 11, lineHeight: 18, color: color.mutedLight, marginTop: 10 },

  sectionTitle: {
    fontFamily: font.headline, fontSize: 15, color: color.ink,
    marginTop: 22, marginBottom: 10,
    borderTopWidth: 1, borderTopColor: color.rule, paddingTop: 16,
  },
  reactionRow: { flexDirection: 'row', gap: 10 },
  reaction: {
    flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: color.rule, backgroundColor: color.paper, borderRadius: 6,
  },
  reactionActive: { borderColor: color.brand, backgroundColor: color.brandTint },
  reactionGlyph: { fontSize: 16, color: color.inkSoft },
  reactionText: { fontFamily: font.teluguSemiBold, fontSize: 13, color: color.inkSoft },
  reactionTextActive: { color: color.brand },

  commentForm: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  commentInput: {
    flex: 1, minHeight: 44, borderWidth: 1, borderColor: color.ruleStrong,
    borderRadius: 6, paddingHorizontal: 12, backgroundColor: color.paper,
    fontFamily: font.telugu, fontSize: 13.5, color: color.ink,
  },
  postButton: {
    minHeight: 44, justifyContent: 'center', borderRadius: 6,
    backgroundColor: color.brand, paddingHorizontal: 16,
  },
  postText: { fontFamily: font.teluguBold, fontSize: 13, color: color.onBrand },
  disabled: { opacity: 0.5 },
  signInPrompt: {
    fontFamily: font.teluguSemiBold, fontSize: 12.5, color: color.brand,
    borderWidth: 1, borderColor: color.rule, borderRadius: 6,
    padding: 12, marginBottom: 14, textAlign: 'center',
  },
  comment: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  commentAvatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: color.canvas,
    alignItems: 'center', justifyContent: 'center',
  },
  commentBody: { flex: 1, minWidth: 0 },
  commentAuthor: { fontFamily: font.teluguSemiBold, fontSize: 12, color: color.ink },
  commentText: { fontFamily: font.telugu, fontSize: 13.5, lineHeight: 22, color: color.inkSoft, marginTop: 2 },
}));
