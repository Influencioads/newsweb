import { useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { API_BASE, API_ORIGIN } from "@/api/client";
import { trackShare } from "@/lib/beacon";
import { font } from "@/lib/theme";
import { useColors } from "@/lib/useTheme";

/**
 * Sharing one story from the app.
 *
 * Two paths, because they are genuinely different acts:
 *
 *  - **Share link** hands WhatsApp a URL. The preview on the other side now
 *    carries a rendered Telugu headline card, because nginx routes link-preview
 *    crawlers to the API's Open Graph stub.
 *  - **Share card** downloads the PNG and shares the *file*. That is what gets
 *    posted to a WhatsApp Status or a family group, where a link preview does
 *    not exist at all — and it is the thing readers actually ask for.
 *
 * The card button only appears when the server says a card exists. A host that
 * cannot shape Telugu reports `card.available: false`, and offering a button
 * that produces an unreadable image would be worse than not offering it.
 */

export function ShareSheet({
  shortId,
  url,
  title,
  cardAvailable,
}: {
  shortId: string;
  url: string;
  title: string;
  cardAvailable: boolean;
}) {
  const c = useColors();
  const [busy, setBusy] = useState(false);

  async function shareLink() {
    trackShare(shortId);
    try {
      await Share.share({ message: `${title}\n${API_ORIGIN}${url}` });
    } catch {
      // Reader dismissed the sheet — nothing to do.
    }
  }

  async function shareCard() {
    setBusy(true);
    try {
      const directory = new Directory(Paths.cache, "cards");
      directory.create({ idempotent: true });
      const destination = new File(directory, `${shortId}.png`);
      const file = await File.downloadFileAsync(
        `${API_BASE}/public/articles/${shortId}/card.png`,
        destination,
        { idempotent: true },
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "image/png",
          dialogTitle: title,
        });
        trackShare(shortId);
      }
    } catch {
      Alert.alert("షేర్ కాలేదు", "కార్డ్ డౌన్‌లోడ్ కాలేదు. లింక్‌ను షేర్ చేయండి.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.row}>
      <Pressable
        accessibilityRole="button"
        onPress={shareLink}
        style={[s.button, { borderColor: c.rule }]}
      >
        <Text style={[s.label, { color: c.ink }]}>షేర్ చేయండి</Text>
      </Pressable>

      {cardAvailable ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={shareCard}
          style={[s.button, { borderColor: c.brand, opacity: busy ? 0.5 : 1 }]}
        >
          <Text style={[s.label, { color: c.brand }]}>
            {busy ? "సిద్ధమవుతోంది…" : "కార్డ్‌గా షేర్"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  button: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  label: { fontFamily: font.teluguSemiBold, fontSize: 13.5 },
});
