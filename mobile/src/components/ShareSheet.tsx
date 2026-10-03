import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Linking, Share, View } from 'react-native';

import { API_BASE, API_ORIGIN } from '@/api/client';
import { trackShare } from '@/lib/beacon';
import { useI18n } from '@/lib/i18n';
import { radius, social, space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { BottomSheet } from '@/ui/BottomSheet';
import { TelegramGlyph, WhatsAppGlyph, XGlyph } from '@/ui/glyphs';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * Sharing one story from the app.
 *
 * Three paths, because they are genuinely different acts:
 *
 *  - **WhatsApp** hands wa.me a URL. The preview on the other side carries a
 *    rendered Telugu headline card, because nginx routes link-preview
 *    crawlers to the API's Open Graph stub.
 *  - **Share card** downloads the PNG and shares the *file*. That is what gets
 *    posted to a WhatsApp Status or a family group, where a link preview does
 *    not exist at all — and it is the thing readers actually ask for.
 *  - **Other apps** is the OS sheet, for everything else.
 *
 * The card row only appears when the server says a card exists. A host that
 * cannot shape Telugu reports `card.available: false`, and offering a button
 * that produces an unreadable image would be worse than not offering it.
 *
 * The sheet has no "copy link" row — the OS sheet carries that job there; the
 * end-of-article `ShareStrip` copies via expo-clipboard. Every path reports to
 * the share beacon.
 */

// ponytail: no i18n keys yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

export interface ShareTarget {
  shortId: string;
  url: string;
  title: string;
  /** Server-rendered share card exists for this story. */
  cardAvailable?: boolean;
}

const useStyles = makeStyles((color) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TAP_LG,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  disc: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.paperSub,
  },
  label: { flex: 1 },
  list: { paddingBottom: space.sm },
  strip: {
    marginTop: space.xl,
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.rule,
    borderLeftWidth: 4,
    borderLeftColor: color.brand,
    backgroundColor: color.paperSub,
  },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  pill: {
    flexBasis: '45%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  copyPill: { borderWidth: 1, borderColor: color.ruleStrong, backgroundColor: color.surface },
}));

function ShareRow({
  icon,
  label,
  hint,
  onPress,
  pending = false,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  pending?: boolean;
}) {
  const styles = useStyles();
  const color = useColors();
  return (
    <PressableScale
      onPress={onPress}
      disabled={pending}
      minHeight={TAP_LG}
      accessibilityLabel={label}
      accessibilityState={{ busy: pending }}
      style={styles.row}
    >
      <View style={styles.disc}>
        {pending ? (
          <ActivityIndicator size="small" color={color.brand} />
        ) : (
          <Icon name={icon} size={20} color={color.brand} />
        )}
      </View>
      <View style={styles.label}>
        <T variant="ui" weight="semibold" numberOfLines={1}>
          {label}
        </T>
        {hint ? (
          <T variant="meta" color="muted" numberOfLines={1}>
            {hint}
          </T>
        ) : null}
      </View>
      <Icon name="chevronRight" size={16} color={color.mutedLight} />
    </PressableScale>
  );
}

/**
 * The sheet on its own, for callers that already own a trigger (the
 * engagement row's share button).
 */
/**
 * The three share paths, without the sheet.
 *
 * Extracted so the article action row can put WhatsApp on a button of its own
 * rather than behind two taps — and so there is exactly one implementation of
 * the wa.me link, the card download and the beacon call. Mirrors the web's
 * `useShareActions` in frontend/src/components/article/ShareSheet.tsx.
 *
 * `onDone` is what the sheet passes to close itself. A caller with no sheet
 * omits it.
 */
export function useShareActions(
  { shortId, url, title }: ShareTarget,
  onDone: () => void = () => {},
) {
  const { isTelugu, t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const link = `${API_ORIGIN}${url}`;
  const message = `${title}
${link}`;

  async function whatsapp() {
    onDone();
    trackShare(shortId);
    try {
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
    } catch {
      toast.error(L('వాట్సాప్ తెరవలేకపోయాం.', 'Could not open WhatsApp.', isTelugu));
    }
  }

  /** X and Telegram take the link and the headline as separate params. */
  async function intent(href: string) {
    onDone();
    trackShare(shortId);
    try {
      await Linking.openURL(href);
    } catch {
      toast.error(L('యాప్ తెరవలేకపోయాం.', 'Could not open the app.', isTelugu));
    }
  }
  const query = `url=${encodeURIComponent(link)}&text=${encodeURIComponent(title)}`;
  const x = () => intent(`https://x.com/intent/tweet?${query}`);
  const telegram = () => intent(`https://t.me/share/url?${query}`);

  async function copy() {
    onDone();
    await Clipboard.setStringAsync(link);
    trackShare(shortId);
    toast.success(t('ui.copied'));
  }

  async function native() {
    onDone();
    trackShare(shortId);
    try {
      await Share.share({ message });
    } catch {
      // Reader dismissed the sheet — nothing to do.
    }
  }

  async function card() {
    setBusy(true);
    try {
      const directory = new Directory(Paths.cache, 'cards');
      directory.create({ idempotent: true });
      const destination = new File(directory, `${shortId}.jpg`);
      const file = await File.downloadFileAsync(
        `${API_BASE}/public/articles/${shortId}/card.jpg`,
        destination,
        { idempotent: true },
      );
      if (await Sharing.isAvailableAsync()) {
        onDone();
        await Sharing.shareAsync(file.uri, { mimeType: 'image/jpeg', dialogTitle: title });
        trackShare(shortId);
      } else {
        // No share provider on the device: say so instead of ending the tap in
        // a spinner that quietly stops.
        onDone();
        toast.error(
          L(
            'ఈ ఫోన్‌లో షేర్ చేయలేకపోయాం. లింక్‌ను షేర్ చేయండి.',
            'Sharing is unavailable on this device. Share the link instead.',
            isTelugu,
          ),
        );
      }
    } catch {
      toast.error(
        L(
          'కార్డ్ డౌన్‌లోడ్ కాలేదు. లింక్‌ను షేర్ చేయండి.',
          'Could not download the card. Share the link instead.',
          isTelugu,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return { whatsapp, x, telegram, copy, native, card, busy };
}

/**
 * The sheet on its own, for callers that already own a trigger (the article
 * action row's share button).
 */
export function ShareOptionsSheet({
  open,
  onClose,
  shortId,
  url,
  title,
  cardAvailable = false,
}: ShareTarget & { open: boolean; onClose: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();
  const { whatsapp, native, card, busy } = useShareActions(
    { shortId, url, title },
    onClose,
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={t('ui.share')}>
      <View style={styles.list}>
        <ShareRow
          icon="whatsapp"
          label={t('ui.whatsapp')}
          hint={t('ui.whatsappHint')}
          onPress={() => void whatsapp()}
        />
        {cardAvailable ? (
          <ShareRow
            icon="image"
            label={t('ui.shareCard')}
            hint={t('ui.shareCardHint')}
            pending={busy}
            onPress={() => void card()}
          />
        ) : null}
        <ShareRow icon="share2" label={t('ui.shareNative')} onPress={() => void native()} />
      </View>
    </BottomSheet>
  );
}

/** End-of-article strip: four coloured buttons, always on the page — no sheet to open. */
export function ShareStrip(target: ShareTarget) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const { whatsapp, x, telegram, copy } = useShareActions(target);
  const marks = [
    { label: t('ui.whatsapp'), bg: social.whatsapp, glyph: WhatsAppGlyph, onPress: whatsapp },
    { label: 'X (Twitter)', bg: social.x, glyph: XGlyph, onPress: x },
    { label: 'Telegram', bg: social.telegram, glyph: TelegramGlyph, onPress: telegram },
  ];
  return (
    <View style={styles.strip}>
      <View style={styles.stripHead}>
        <Icon name="megaphone" size={20} color={color.breaking} />
        <T variant="ui" weight="bold" style={styles.label}>
          {t('ui.shareStripTitle')}
        </T>
      </View>
      <View style={styles.grid}>
        {marks.map(({ label, bg, glyph: Glyph, onPress }) => (
          <PressableScale
            key={label}
            onPress={() => void onPress()}
            minHeight={TAP_LG}
            accessibilityLabel={label}
            style={[styles.pill, { backgroundColor: bg }]}
          >
            <Glyph size={18} color={social.onMark} />
            <T variant="ui" weight="semibold" color="onOverlay" numberOfLines={1}>
              {label}
            </T>
          </PressableScale>
        ))}
        <PressableScale
          onPress={() => void copy()}
          minHeight={TAP_LG}
          accessibilityLabel={t('ui.copyLink')}
          style={[styles.pill, styles.copyPill]}
        >
          <Icon name="copy" size={20} color={color.ink} />
          <T variant="ui" weight="semibold" numberOfLines={1}>
            {t('ui.copyLinkShort')}
          </T>
        </PressableScale>
      </View>
    </View>
  );
}
