import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { API_ORIGIN } from '@/api/client';
import * as publicApi from '@/api/public';
import * as readerApi from '@/api/reader';
import type { Me } from '@/api/types';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { LocationSheet, usePlaceName } from '@/components/LocationSheet';
import { Group, NavRow, RowDivider, SwitchRow } from '@/components/profile/SettingsRows';
import { useI18n } from '@/lib/i18n';
import { radius, space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { usePrefs } from '@/stores/prefs';
import { ConfirmSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { FontSizeSheet } from '@/ui/FontSizeSheet';
import { Icon } from '@/ui/Icon';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * Reader preferences (§4) — language, theme, text size, location, interests
 * and notifications, grouped into Cards and mirrored to the server. Location
 * is the shared `LocationSheet` (down to the village), which applies each tap
 * at once and syncs it itself, so it is not part of this form's save.
 *
 * The form is *derived*, not hydrated: `edit` holds only what the reader
 * touched and falls through to the server document underneath it. That keeps
 * the server the single source of truth (no `setState` in an effect, no
 * `hydrated` flag) and makes "discard my edits" a reset to `{}`.
 */
type Notify = { breaking: boolean; local: boolean; topics: boolean };

interface Edit {
  language?: 'te' | 'en';
  interests?: string[];
  notify?: Notify;
}

const LIBRARY: { href: Href; icon: 'users' | 'bookmark' | 'history' | 'pencil'; key: 'library.following' | 'library.bookmarks' | 'library.history' | 'submit.title' }[] = [
  { href: '/library/following', icon: 'users', key: 'library.following' },
  { href: '/library/bookmarks', icon: 'bookmark', key: 'library.bookmarks' },
  { href: '/library/history', icon: 'history', key: 'library.history' },
  { href: '/submit', icon: 'pencil', key: 'submit.title' },
];

const THEMES = [
  { value: 'system', icon: 'monitor', key: 'ui.themeSystem' },
  { value: 'light', icon: 'sun', key: 'ui.themeLight' },
  { value: 'dark', icon: 'moon', key: 'ui.themeDark' },
] as const;

export function ReaderPreferences({ me }: { me: Me }) {
  const styles = useStyles();
  const color = useColors();
  const { t, pick, isTelugu, setLanguage } = useI18n();
  const L = (te: string, en: string) => (isTelugu ? te : en);
  const toast = useToast();
  const queryClient = useQueryClient();
  const signOut = useAuth((s) => s.signOut);
  const { fontStep, theme, setTheme } = usePrefs();
  const placeName = usePlaceName();

  const [edit, setEdit] = useState<Edit>({});
  const [sheet, setSheet] = useState<'none' | 'font' | 'location' | 'signOut'>('none');

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: readerApi.fetchPreferences });

  const server = prefs.data;
  const language = edit.language ?? server?.language ?? (isTelugu ? 'te' : 'en');
  const interests = edit.interests ?? server?.category_slugs ?? [];
  const notify: Notify = edit.notify ?? {
    breaking: server?.notify_breaking ?? true,
    local: server?.notify_local ?? true,
    topics: server?.notify_topics ?? true,
  };

  const save = useMutation({
    mutationFn: () =>
      readerApi.updatePreferences({
        language,
        category_slugs: interests,
        notify_breaking: notify.breaking,
        notify_local: notify.local,
        notify_topics: notify.topics,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['preferences'], data);
      setLanguage(data.language);
      // The server document is now the reader's own choice: drop the overlay.
      setEdit({});
      toast.success(t('profile.saved'));
    },
    onError: (error) => toast.error(error),
  });

  if (prefs.isLoading) return <LoadingState />;
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />;

  const categories = (config.data?.categories ?? []).filter((c) => c.show_in_nav);
  const dirty = Object.keys(edit).length > 0;
  const open = (path: string) => Linking.openURL(`${API_ORIGIN}${path}`).catch(() => undefined);

  return (
    <>
      {/* account ------------------------------------------------------- */}
      <Card padding="md" style={styles.account}>
        <View style={styles.avatar}>
          <Icon name="user" size={24} color={color.brand} />
        </View>
        <View style={styles.accountText}>
          <T variant="headlineSm" weight="bold" numberOfLines={1}>
            {pick(me.user.name_te, me.user.name_en)}
          </T>
          <T variant="meta" color="muted" numberOfLines={1} lang="en">
            {me.user.email ?? (me.user.phone ? `+${me.user.phone}` : '')}
          </T>
        </View>
      </Card>

      {/* my library ---------------------------------------------------- */}
      <Group title={L('నా లైబ్రరీ', 'My library')}>
        {LIBRARY.map((item, i) => (
          <View key={item.key}>
            {i > 0 ? <RowDivider /> : null}
            <NavRow label={t(item.key)} icon={item.icon} onPress={() => router.push(item.href)} />
          </View>
        ))}
      </Group>

      {/* reading ------------------------------------------------------- */}
      <Group title={L('చదవడం', 'Reading')}>
        <View style={styles.block} accessibilityRole="radiogroup">
          <T variant="ui" weight="semibold" color="muted">
            {t('profile.language')}
          </T>
          <View style={styles.chips}>
            <Chip
              label="తెలుగు"
              lang="te"
              role="radio"
              selected={language === 'te'}
              onPress={() => setEdit((e) => ({ ...e, language: 'te' }))}
            />
            <Chip
              label="English"
              lang="en"
              role="radio"
              selected={language === 'en'}
              onPress={() => setEdit((e) => ({ ...e, language: 'en' }))}
            />
          </View>
        </View>
        <RowDivider />
        <NavRow
          label={t('profile.fontSize')}
          icon="type"
          value={fontStep}
          onPress={() => setSheet('font')}
        />
      </Group>

      {/* theme --------------------------------------------------------- */}
      <Group title={t('ui.theme')} padding="md">
        <View style={styles.chips} accessibilityRole="radiogroup">
          {THEMES.map((option) => (
            <Chip
              key={option.value}
              label={t(option.key)}
              icon={option.icon}
              role="radio"
              selected={theme === option.value}
              onPress={() => setTheme(option.value)}
            />
          ))}
        </View>
      </Group>

      {/* location ------------------------------------------------------ */}
      <Group title={t('profile.location')} hint={t('profile.locationHint')}>
        <NavRow
          label={t('local.change')}
          icon="mapPin"
          value={placeName ?? t('local.choosePlace')}
          onPress={() => setSheet('location')}
        />
      </Group>

      {/* interests ----------------------------------------------------- */}
      <Group title={t('profile.interests')} hint={t('profile.interestsHint')} padding="md">
        <View style={styles.chips}>
          {categories.map((c) => {
            const on = interests.includes(c.slug);
            return (
              <Chip
                key={c.slug}
                label={pick(c.name_te, c.name_en)}
                icon={on ? 'check' : 'plus'}
                selected={on}
                onPress={() =>
                  setEdit((e) => ({
                    ...e,
                    interests: on ? interests.filter((s) => s !== c.slug) : [...interests, c.slug],
                  }))
                }
              />
            );
          })}
        </View>
      </Group>

      {/* notifications ------------------------------------------------- */}
      <Group title={t('profile.notifications')}>
        <SwitchRow
          label={t('profile.notifyBreaking')}
          icon="zap"
          value={notify.breaking}
          onChange={(v) => setEdit((e) => ({ ...e, notify: { ...notify, breaking: v } }))}
        />
        <RowDivider />
        <SwitchRow
          label={t('profile.notifyLocal')}
          icon="mapPin"
          value={notify.local}
          onChange={(v) => setEdit((e) => ({ ...e, notify: { ...notify, local: v } }))}
        />
        <RowDivider />
        <SwitchRow
          label={t('profile.notifyTopics')}
          icon="bell"
          value={notify.topics}
          onChange={(v) => setEdit((e) => ({ ...e, notify: { ...notify, topics: v } }))}
        />
      </Group>

      <Button
        label={save.isPending ? t('profile.saving') : t('profile.save')}
        icon="check"
        pending={save.isPending}
        disabled={!dirty}
        onPress={() => save.mutate()}
        haptic="success"
        full
        style={styles.save}
      />

      {/* legal / sign out ---------------------------------------------- */}
      <Group title={L('చట్టపరమైన', 'Legal')}>
        <NavRow
          label={L('గోప్యతా విధానం', 'Privacy policy')}
          icon="shield"
          chevron="externalLink"
          onPress={() => void open('/privacy')}
        />
        <RowDivider />
        <NavRow
          label={L('నిబంధనలు', 'Terms of use')}
          icon="fileText"
          chevron="externalLink"
          onPress={() => void open('/terms')}
        />
        <RowDivider />
        <NavRow
          label={t('auth.signOut')}
          icon="logOut"
          danger
          chevron="chevronRight"
          onPress={() => setSheet('signOut')}
        />
      </Group>

      <T variant="meta" color="muted" align="center" lang="en" style={styles.version}>
        {`${t('site.name')} ${Constants.expoConfig?.version ?? ''}`.trim()}
      </T>

      <FontSizeSheet open={sheet === 'font'} onClose={() => setSheet('none')} />
      <LocationSheet open={sheet === 'location'} onClose={() => setSheet('none')} />
      <ConfirmSheet
        open={sheet === 'signOut'}
        onClose={() => setSheet('none')}
        title={t('auth.signOut')}
        body={L(
          'మీ ఖాతా నుంచి బయటకు రావాలా? సేవ్ చేసిన వార్తలు ఖాతాలోనే ఉంటాయి.',
          'Sign out of your account? Your saved stories stay on your account.',
        )}
        confirmLabel={t('auth.signOut')}
        tone="danger"
        onConfirm={() => {
          setSheet('none');
          void signOut();
        }}
      />
    </>
  );
}

const useStyles = makeStyles((color) => ({
  account: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: TAP_LG,
    height: TAP_LG,
    borderRadius: radius.pill,
    backgroundColor: color.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountText: { flex: 1, gap: space.xs },
  block: { padding: space.lg, gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  save: { marginTop: space.xl },
  version: { marginTop: space.xl },
}));
