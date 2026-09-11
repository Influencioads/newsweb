import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import type { EpaperEdition } from "@/api/epaper";
import * as epaperApi from "@/api/epaper";
import { API_BASE, getAccessToken } from "@/api/client";
import { font } from "@/lib/theme";
import { useColors } from "@/lib/useTheme";

export function EpaperReader({
  edition,
  personal = false,
}: {
  edition: EpaperEdition;
  personal?: boolean;
}) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const page = edition.pages[index];
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(3, Math.max(0.8, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
    });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onEnd((e) => {
      if (Math.abs(e.translationX) > 70 && scale.value <= 1.05)
        setIndex((i) =>
          Math.max(
            0,
            Math.min(
              edition.pages.length - 1,
              i + (e.translationX < 0 ? 1 : -1),
            ),
          ),
        );
    });
  const gesture = Gesture.Simultaneous(pinch, pan);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const audio = epaperApi.fetchAudio;
  const { data: playlist } = useQuery({
    queryKey: ["epaper-audio", edition.edition_date],
    queryFn: () => audio(edition.edition_date),
    enabled: edition.audio_enabled && !personal,
  });
  const [track, setTrack] = useState(0);
  const player = useAudioPlayer(playlist?.tracks?.[track]?.url ?? null);
  const status = useAudioPlayerStatus(player);
  const share = () =>
    page &&
    Share.share({
      message: `${edition.title} – Page ${page.page_number}\n${personal ? `https://telugunews.influencioweb.com/my-epaper/edition/${edition.id}/page/${page.page_number}` : page.share_url}`,
    });
  const pdf = `${API_BASE}${personal ? `/my-epaper/editions/${edition.id}/pdf` : `/epaper/${edition.edition_date}/pdf`}`;
  const downloadPdf = async () => {
    try {
      const directory = new Directory(Paths.cache, "epaper");
      directory.create({ idempotent: true });
      const destination = new File(directory, `${edition.edition_date}-${edition.id}.pdf`);
      const token = getAccessToken();
      const file = await File.downloadFileAsync(pdf, destination, {
        idempotent: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: edition.title });
      }
    } catch {
      Alert.alert("Download failed", "The E-Paper PDF could not be downloaded.");
    }
  };
  const cols =
    width > 650 && page?.layout_type === "three_column"
      ? 3
      : width > 650
        ? 2
        : 1;
  const go = (delta: number) => {
    setIndex((i) => Math.max(0, Math.min(edition.pages.length - 1, i + delta)));
    scale.value = 1;
    saved.value = 1;
  };
  if (!page) return <Text>No pages</Text>;
  return (
    <ScrollView style={{ backgroundColor: c.canvas }} stickyHeaderIndices={[0]}>
      <View
        style={[s.toolbar, { backgroundColor: c.paper, borderColor: c.rule }]}
      >
        <Pressable onPress={() => router.back()}>
          <Text style={[s.tool, { color: c.brand }]}>←</Text>
        </Pressable>
        <Text numberOfLines={1} style={[s.title, { color: c.ink }]}>
          {edition.title}
        </Text>
        <Pressable
          onPress={() => {
            scale.value = Math.max(0.8, scale.value - 0.2);
            saved.value = scale.value;
          }}
        >
          <Text style={[s.tool, { color: c.brand }]}>−</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            scale.value = Math.min(3, scale.value + 0.2);
            saved.value = scale.value;
          }}
        >
          <Text style={[s.tool, { color: c.brand }]}>＋</Text>
        </Pressable>
        <Pressable onPress={share}>
          <Text style={[s.tool, { color: c.brand }]}>↗</Text>
        </Pressable>
        <Pressable onPress={() => void downloadPdf()}>
          <Text style={[s.tool, { color: c.brand }]}>PDF</Text>
        </Pressable>
      </View>
      <View style={s.nav}>
        <Pressable disabled={index === 0} onPress={() => go(-1)}>
          <Text
            style={[s.navButton, { color: index === 0 ? c.muted : c.brand }]}
          >
            ‹ Previous
          </Text>
        </Pressable>
        <Text style={{ color: c.ink }}>
          Page {page.page_number} / {edition.page_count}
        </Text>
        <Pressable
          disabled={index === edition.pages.length - 1}
          onPress={() => go(1)}
        >
          <Text
            style={[
              s.navButton,
              { color: index === edition.pages.length - 1 ? c.muted : c.brand },
            ]}
          >
            Next ›
          </Text>
        </Pressable>
      </View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            s.sheet,
            { backgroundColor: c.paper, width: Math.min(width - 20, 900) },
            animated,
          ]}
        >
          <View style={[s.mast, { borderColor: c.ink }]}>
            <Text style={[s.paperName, { color: c.ink }]}>
              టాప్ తెలుగు న్యూస్
            </Text>
            <Text style={{ color: c.muted }}>
              {edition.edition_date} · PAGE {page.page_number}
            </Text>
            <Text style={[s.pageTitle, { color: c.ink }]}>{page.title}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {page.articles.map((a, i) => (
              <Pressable
                key={a.id}
                onPress={() =>
                  router.push({
                    pathname: "/article/[shortId]",
                    params: { shortId: a.short_id },
                  })
                }
                style={[
                  s.story,
                  { borderColor: c.rule, width: `${100 / cols}%` },
                ]}
              >
                {a.hero_url ? (
                  <Image
                    source={a.hero_url}
                    style={{ width: "100%", height: i === 0 ? 190 : 110 }}
                    contentFit="cover"
                  />
                ) : null}
                {a.is_breaking ? (
                  <Text style={{ color: c.breaking, fontWeight: "800" }}>
                    BREAKING
                  </Text>
                ) : null}
                <Text style={[i === 0 ? s.lead : s.headline, { color: c.ink }]}>
                  {a.title_te}
                </Text>
                {a.summary_te ? (
                  <Text
                    numberOfLines={4}
                    style={[s.summary, { color: c.inkSoft }]}
                  >
                    {a.summary_te}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
          {page.poll_id ? (
            <Pressable
              onPress={() => router.push({ pathname: "/poll/[id]", params: { id: String(page.poll_id) } })}
              style={[s.poll, { borderColor: c.brand, backgroundColor: c.brandTint }]}
            >
              <Text style={[s.pollText, { color: c.brand }]}>❓ బిగ్ క్వశ్చన్ · Vote now →</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </GestureDetector>
      {playlist?.tracks.length ? (
        <View style={[s.radio, { backgroundColor: c.paper }]}>
          <Text style={[s.radioTitle, { color: c.ink }]}>
            🎧 రేడియోలా వినండి
          </Text>
          <Text style={[s.now, { color: c.brand }]}>
            {playlist.tracks[track]?.title_te}
          </Text>
          <View style={s.radioControls}>
            <Pressable onPress={() => setTrack((i) => Math.max(0, i - 1))}>
              <Text>⏮</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                player.seekTo(Math.max(0, status.currentTime - 10))
              }
            >
              <Text>⏪ 10</Text>
            </Pressable>
            <Pressable
              onPress={() => (status.playing ? player.pause() : player.play())}
            >
              <Text style={s.play}>{status.playing ? "⏸" : "▶"}</Text>
            </Pressable>
            <Pressable onPress={() => player.seekTo(status.currentTime + 10)}>
              <Text>10 ⏩</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                setTrack((i) => Math.min(playlist.tracks.length - 1, i + 1))
              }
            >
              <Text>⏭</Text>
            </Pressable>
          </View>
          <View style={s.speeds}>
            {[1, 1.25, 1.5, 2].map((x) => (
              <Pressable key={x} onPress={() => player.setPlaybackRate(x)}>
                <Text style={{ color: c.brand }}>{x}×</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <Archive current={edition.id} />
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
function Archive({ current }: { current: number }) {
  const c = useColors();
  const q = useQuery({
    queryKey: ["epaper-archive"],
    queryFn: epaperApi.fetchArchive,
  });
  return (
    <View style={{ padding: 14 }}>
      <Text style={[s.radioTitle, { color: c.ink }]}>Previous Editions</Text>
      <ScrollView horizontal>
        {q.data?.items
          .filter((e: EpaperEdition) => e.id !== current)
          .map((e: EpaperEdition) => (
            <Pressable
              key={e.id}
              onPress={() =>
                router.replace({
                  pathname: "/epaper/[date]",
                  params: { date: e.edition_date },
                })
              }
              style={[
                s.archive,
                { borderColor: c.rule, backgroundColor: c.paper },
              ]}
            >
              <Text style={{ color: c.ink, fontWeight: "700" }}>
                {e.edition_date}
              </Text>
              <Text style={{ color: c.muted }}>{e.page_count} pages</Text>
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  toolbar: {
    padding: 9,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: { flex: 1, fontFamily: font.teluguBold },
  tool: { fontWeight: "800", fontSize: 16 },
  nav: { padding: 12, flexDirection: "row", justifyContent: "space-between" },
  navButton: { fontWeight: "700" },
  sheet: {
    alignSelf: "center",
    padding: 16,
    minHeight: 620,
    marginVertical: 8,
    elevation: 4,
  },
  mast: {
    borderTopWidth: 3,
    borderBottomWidth: 3,
    paddingVertical: 8,
    alignItems: "center",
    marginBottom: 10,
  },
  paperName: { fontFamily: font.headlineHeavy, fontSize: 29, lineHeight: 42 },
  pageTitle: { fontFamily: font.headlineHeavy, fontSize: 22, lineHeight: 34 },
  story: { padding: 9, borderBottomWidth: 1 },
  lead: {
    fontFamily: font.headlineHeavy,
    fontSize: 24,
    lineHeight: 36,
    marginTop: 5,
  },
  headline: {
    fontFamily: font.headlineHeavy,
    fontSize: 18,
    lineHeight: 28,
    marginTop: 5,
  },
  summary: { fontFamily: font.telugu, fontSize: 13, lineHeight: 22 },
  radio: { margin: 12, padding: 16, borderRadius: 10 },
  radioTitle: { fontFamily: font.headlineHeavy, fontSize: 20, lineHeight: 30 },
  now: { fontFamily: font.teluguBold, marginVertical: 8 },
  radioControls: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  play: { fontSize: 25 },
  speeds: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  archive: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 7,
    marginRight: 8,
    marginTop: 8,
  },
  poll: { marginTop: 14, borderWidth: 2, borderRadius: 8, padding: 14 },
  pollText: { fontFamily: font.teluguBold, textAlign: "center", fontSize: 16 },
});
