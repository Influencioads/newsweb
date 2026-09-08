import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { API_ORIGIN } from '@/api/client';
import * as engagementApi from '@/api/engagement';
import type { ArticleDetail } from '@/api/types';
import { trackShare } from '@/lib/beacon';
import { useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';

/** Like · save · share · report (§5). Anonymous taps route to the Profile tab. */
export function EngagementRow({ article }: { article: ArticleDetail }) {
  const styles = useStyles();
  const { t } = useI18n();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const [likeCount, setLikeCount] = useState(article.like_count);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    setLikeCount(article.like_count);
    setReported(false);
  }, [article.short_id, article.like_count]);

  const flags = useQuery({
    queryKey: ['flags', article.short_id],
    queryFn: () => engagementApi.fetchMyFlags(article.short_id),
    enabled: authed,
  });

  function requireLogin(): boolean {
    if (authed) return false;
    router.push('/profile');
    return true;
  }

  const like = useMutation({
    mutationFn: (next: boolean) => engagementApi.setLike(article.short_id, next),
    onSuccess: (counts, next) => {
      setLikeCount(counts.like_count);
      queryClient.setQueryData(['flags', article.short_id], {
        liked: next,
        bookmarked: flags.data?.bookmarked ?? false,
      });
    },
  });

  const bookmark = useMutation({
    mutationFn: (next: boolean) => engagementApi.setBookmark(article.short_id, next),
    onSuccess: (data) => queryClient.setQueryData(['flags', article.short_id], data),
  });

  const report = useMutation({
    mutationFn: () => engagementApi.reportArticle(article.short_id, 'other'),
    onSuccess: () => setReported(true),
  });

  async function share() {
    trackShare(article.short_id);
    try {
      await Share.share({ message: `${article.title_te}\n${API_ORIGIN}${article.url}` });
    } catch {
      /* sheet dismissed */
    }
  }

  const liked = flags.data?.liked ?? false;
  const bookmarked = flags.data?.bookmarked ?? false;

  function Btn({
    label,
    active,
    onPress,
    disabled,
  }: {
    label: string;
    active?: boolean;
    onPress: () => void;
    disabled?: boolean;
  }) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ selected: Boolean(active) }}
        style={[styles.button, active && styles.buttonActive, disabled && { opacity: 0.6 }]}
      >
        <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.row}>
      <Btn
        label={`♥ ${likeCount > 0 ? `${likeCount} ` : ''}${t('engage.like')}`}
        active={liked}
        onPress={() => {
          if (requireLogin()) return;
          like.mutate(!liked);
        }}
      />
      <Btn
        label={bookmarked ? `✓ ${t('engage.saved')}` : `⚑ ${t('engage.save')}`}
        active={bookmarked}
        onPress={() => {
          if (requireLogin()) return;
          bookmark.mutate(!bookmarked);
        }}
      />
      <Btn label={`↗ ${t('article.share')}`} onPress={() => void share()} />
      <Btn
        label={reported ? t('engage.reported') : `⚐ ${t('engage.report')}`}
        disabled={reported}
        onPress={() => {
          if (requireLogin()) return;
          report.mutate();
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.rule,
    paddingVertical: 10,
    marginTop: 16,
  },
  button: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: color.paper,
  },
  buttonActive: { borderColor: color.brand, backgroundColor: color.brandTint },
  buttonText: { fontFamily: font.teluguSemiBold, fontSize: 12.5, lineHeight: 19, color: color.muted },
  buttonTextActive: { color: color.brand },
}));
