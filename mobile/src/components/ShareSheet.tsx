import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Linking, Share, View } from 'react-native';

import { API_BASE, API_ORIGIN } from '@/api/client';
import { trackShare } from '@/lib/beacon';
import { useI18n } from '@/lib/i18n';
import { radius, space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { BottomSheet } from '@/ui/BottomSheet';
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
 * There is no "copy link" row: no clipboard module is installed (expo-clipboard
 * is absent and RN's own `Clipboard` is deprecated and warns on every access),
 * so the OS sheet carries that job. Every path reports to the share beacon.
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
export function ShareOptionsSheet({
  open,
  onClose,
  shortId,
  url,
  title,
  cardAvailable = false,
}: ShareTarget & { open: boolean; onClose: () => void }) {
  const styles = useStyles();
  const { t, isTelugu } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const link = `${API_ORIGIN}${url}`;
  const message = `${title}\n${link}`;

  async function whatsapp() {
    onClose();
    trackShare(shortId);
    try {
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
    } catch {
      toast.error(L('వాట్సాప్ తెరవలేకపోయాం.', 'Could not open WhatsApp.', isTelugu));
    }
  }

  async function native() {
    onClose();
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
      const destination = new File(directory, `${shortId}.png`);
      const file = await File.downloadFileAsync(
        `${API_BASE}/public/articles/${shortId}/card.png`,
        destination,
        { idempotent: true },
      );
      if (await Sharing.isAvailableAsync()) {
        onClose();
        await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: title });
        trackShare(shortId);
      } else {
        // No share provider on the device: say so instead of ending the tap in
        // a spinner that quietly stops.
        onClose();
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

  return (
    <BottomSheet open={open} onClose={onClose} title={t('ui.share')}>
      <View style={styles.list}>
        <ShareRow
          icon="messageCircle"
          label={t('ui.whatsapp')}
          hint={L('లింక్‌తో పంపండి', 'Send with a link', isTelugu)}
          onPress={() => void whatsapp()}
        />
        {cardAvailable ? (
          <ShareRow
            icon="image"
            label={t('ui.shareCard')}
            hint={L('స్టేటస్, గ్రూపుల కోసం', 'For Status and groups', isTelugu)}
            pending={busy}
            onPress={() => void card()}
          />
        ) : null}
        <ShareRow icon="share2" label={t('ui.shareNative')} onPress={() => void native()} />
      </View>
    </BottomSheet>
  );
}
