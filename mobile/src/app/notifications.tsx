import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import * as notificationsApi from '@/api/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { timeAgo, useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';

const KIND_GLYPH: Record<notificationsApi.NotificationKind, string> = {
  breaking: '⚡',
  local: '◉',
  topic: '#',
  system: '📣',
};

/** The reader's inbox (§13). Opening it clears the badge. */
export default function NotificationsScreen() {
  const styles = useStyles();
  const { t, language } = useI18n();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: ['inbox'],
    queryFn: () => notificationsApi.fetchInbox(),
    enabled: authed,
  });

  useEffect(() => {
    if (inbox.data && inbox.data.unread > 0) {
      void notificationsApi.markRead().then(() => {
        void queryClient.invalidateQueries({ queryKey: ['inbox-unread'] });
      });
    }
  }, [inbox.data, queryClient]);

  return (
    <>
      <Stack.Screen options={{ title: t('notify.title') }} />
      {!authed ? (
        <EmptyState message={t('comments.signIn')} />
      ) : inbox.isLoading ? (
        <LoadingState />
      ) : inbox.isError ? (
        <ErrorState onRetry={() => inbox.refetch()} />
      ) : !inbox.data?.items.length ? (
        <EmptyState message={t('notify.empty')} />
      ) : (
        <FlatList
          data={inbox.data.items}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => {
            const shortId = item.article_url?.split('-').pop();
            const row = (
              <View style={[styles.row, item.read_at != null && styles.read]}>
                <Text style={styles.glyph}>{KIND_GLYPH[item.kind]}</Text>
                <View style={styles.body}>
                  <Text style={styles.title}>{item.title_te}</Text>
                  {item.body_te ? <Text style={styles.subtitle}>{item.body_te}</Text> : null}
                  <Text style={styles.time}>{timeAgo(item.created_at, language)}</Text>
                </View>
                {item.read_at == null ? <View style={styles.dot} /> : null}
              </View>
            );
            return shortId ? (
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/article/[shortId]', params: { shortId } })
                }
                accessibilityRole="button"
              >
                {row}
              </Pressable>
            ) : (
              row
            );
          }}
          refreshing={inbox.isRefetching}
          onRefresh={() => inbox.refetch()}
        />
      )}
    </>
  );
}

const useStyles = makeStyles((color) => ({
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: color.paper,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
    alignItems: 'flex-start',
  },
  read: { opacity: 0.65 },
  glyph: { fontSize: 16, marginTop: 2 },
  body: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.teluguSemiBold, fontSize: 14.5, lineHeight: 24, color: color.ink },
  subtitle: { fontFamily: font.telugu, fontSize: 13, lineHeight: 21, color: color.muted, marginTop: 2 },
  time: { fontFamily: font.telugu, fontSize: 10.5, lineHeight: 16, color: color.mutedLight, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.brand, marginTop: 6 },
}));
