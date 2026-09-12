import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { RefreshControl, SectionList, View } from 'react-native';

import * as notificationsApi from '@/api/notifications';
import type { NotificationItem, NotificationKind } from '@/api/notifications';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { SectionHeader } from '@/components/SectionHeader';
import { timeAgo, useI18n } from '@/lib/i18n';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Button, IconButton } from '@/ui/Button';
import { Divider } from '@/ui/Divider';
import { Icon, type IconName } from '@/ui/Icon';
import { ListFooter } from '@/ui/ListFooter';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';
import { T, type PaletteKey } from '@/ui/Text';
import { useToast } from '@/ui/Toast';
import { useAuth } from '@/stores/auth';

/**
 * The reader's inbox (§13), grouped into today / yesterday / earlier.
 *
 * Opening the screen still clears the badge; the header's mark-all control is
 * the manual twin of that, for a reader who scrolled in from a push and wants
 * the unread dots gone without waiting for the round trip.
 */

// ponytail: no i18n key for the mark-all confirmation yet — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

const KIND: Record<NotificationKind, { icon: IconName; fg: PaletteKey; bg: PaletteKey }> = {
  breaking: { icon: 'zap', fg: 'breaking', bg: 'breakingTint' },
  local: { icon: 'mapPin', fg: 'info', bg: 'infoTint' },
  topic: { icon: 'star', fg: 'brand', bg: 'brandTint' },
  system: { icon: 'bell', fg: 'muted', bg: 'paperSub' },
};

type BucketKey = 'ui.today' | 'ui.yesterday' | 'ui.earlier';
const BUCKETS: BucketKey[] = ['ui.today', 'ui.yesterday', 'ui.earlier'];
const DAY_MS = 86_400_000;

/** Which day-group a timestamp falls in, measured from local midnight. */
function bucketOf(iso: string): BucketKey {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const age = midnight.getTime() - new Date(iso).getTime();
  if (age <= 0) return 'ui.today';
  return age <= DAY_MS ? 'ui.yesterday' : 'ui.earlier';
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const styles = useStyles();
  const color = useColors();
  const { language, isTelugu } = useI18n();
  const look = KIND[item.kind];
  const read = item.read_at != null;
  // The inbox stores a full article URL; its trailing segment is the short id.
  const shortId = item.article_url?.split('-').pop();
  // Unread belongs in the label: the dot is decorative, and `selected` would
  // announce a selection state the row does not have.
  const label = [
    read ? null : L('చదవనిది', 'Unread', isTelugu),
    item.title_te,
    item.body_te,
    timeAgo(item.created_at, language),
  ]
    .filter(Boolean)
    .join(', ');

  const body = (
    <View style={styles.row}>
      <View style={[styles.bubble, read && styles.read, { backgroundColor: color[look.bg] }]}>
        <Icon name={look.icon} size={20} color={color[look.fg]} />
      </View>
      <View style={styles.text}>
        <T variant="body" weight="semibold" color={read ? 'inkSoft' : 'ink'} scaled>
          {item.title_te}
        </T>
        {item.body_te ? (
          <T variant="bodySmall" color="muted" numberOfLines={3} scaled>
            {item.body_te}
          </T>
        ) : null}
        <T variant="meta" color="muted">
          {timeAgo(item.created_at, language)}
        </T>
      </View>
      {read ? null : <View style={styles.dot} aria-hidden />}
    </View>
  );

  if (!shortId) {
    return (
      <View accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      haptic={false}
      minHeight={TAP}
      accessibilityLabel={label}
      onPress={() => router.push({ pathname: '/article/[shortId]', params: { shortId } })}
    >
      {body}
    </PressableScale>
  );
}

export default function NotificationsScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t, isTelugu } = useI18n();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const toast = useToast();

  const inbox = useInfiniteQuery({
    queryKey: ['inbox'],
    queryFn: ({ pageParam }) => notificationsApi.fetchInbox(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: authed,
  });
  const unread = inbox.data?.pages[0]?.unread ?? 0;

  // Opening the screen clears the badge *and* the rows' own unread dots; the
  // `unread > 0` guard stops the refetch looping once the server returns 0.
  useEffect(() => {
    if (unread > 0) {
      void notificationsApi.markRead().then(() => {
        void queryClient.invalidateQueries({ queryKey: ['inbox-unread'] });
        void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      });
    }
  }, [unread, queryClient]);

  function markAll() {
    notificationsApi
      .markRead()
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['inbox-unread'] });
        void inbox.refetch();
        toast.success(L('అన్నీ చదివినట్లు గుర్తించాం.', 'All marked as read.', isTelugu));
      })
      .catch((error: unknown) => toast.error(error));
  }

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  const sections = BUCKETS.map((key) => ({
    key,
    title: t(key),
    data: items.filter((item) => bucketOf(item.created_at) === key),
  })).filter((section) => section.data.length > 0);

  return (
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title: t('notify.title') }} />
      <ScreenHeader
        title={t('notify.title')}
        right={
          authed ? (
            <IconButton name="checkCircle2" label={t('ui.markAllRead')} onPress={markAll} />
          ) : undefined
        }
      />

      {!authed ? (
        <EmptyState
          icon="user"
          message={t('comments.signIn')}
          action={<Button label={t('auth.signIn')} icon="logIn" onPress={() => router.push('/profile')} />}
        />
      ) : inbox.isLoading ? (
        <SkeletonFeed lead={false} rows={6} />
      ) : inbox.isError && !inbox.data ? (
        <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : sections.length === 0 ? (
        <EmptyState icon="bell" message={t('notify.empty')} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <NotificationRow item={item} />}
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
          ItemSeparatorComponent={Divider}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          onEndReached={() => {
            if (inbox.hasNextPage && !inbox.isFetchingNextPage) void inbox.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            <ListFooter
              loading={inbox.isFetchingNextPage}
              end={!inbox.hasNextPage}
              error={inbox.isError}
              onRetry={() => void inbox.fetchNextPage()}
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={inbox.isRefetching && !inbox.isFetchingNextPage}
              onRefresh={() => inbox.refetch()}
              tintColor={color.brand}
              colors={[color.brand]}
              progressBackgroundColor={color.surface}
            />
          }
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((color) => ({
  list: { paddingBottom: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.paper,
  },
  // Read rows dim the glyph bubble only; text stays on AA tokens (title → inkSoft).
  read: { opacity: 0.7 },
  bubble: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0, gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.brand, marginTop: space.md },
}));
