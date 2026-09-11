import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { api, absoluteMediaUrl } from "@/api/client";
import { font } from "@/lib/theme";
import { useColors } from "@/lib/useTheme";

/**
 * The latest three-hourly audio bulletin, at the top of the home feed.
 *
 * Not a sixth tab — the bar is already at five, which is as many as a bottom
 * bar carries, and six items a day does not earn a permanent slot.
 *
 * Renders nothing when nothing is on air. That covers the ordinary case (the
 * next slot has not arrived) and the kill switch (an admin turned bulletins
 * off), which both arrive here as `available: false`.
 */

interface BulletinSummary {
  available: boolean;
  url: string | null;
  duration_sec: number;
  slot_label_te: string | null;
  items: Array<{ position: number; headline_te: string }>;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

export function BulletinCard() {
  const c = useColors();

  const bulletin = useQuery({
    queryKey: ["bulletin", "latest"],
    queryFn: async () =>
      (await api.get<BulletinSummary>("/public/bulletins/latest")).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const data = bulletin.data;
  // The hook must run unconditionally, so it is created with a null source and
  // only given one once the server says a bulletin exists.
  const player = useAudioPlayer(
    data?.available && data.url ? absoluteMediaUrl(data.url) : null,
  );
  const status = useAudioPlayerStatus(player);

  if (!data?.available || !data.url) return null;

  const playing = status?.playing ?? false;

  return (
    <View style={[s.card, { backgroundColor: c.paper, borderColor: c.rule }]}>
      <View style={s.head}>
        <Text style={[s.kicker, { color: c.brand }]}>🎧 ఆడియో వార్తలు</Text>
        <Text style={[s.time, { color: c.muted }]}>
          {clock(data.duration_sec)}
        </Text>
      </View>

      <Text style={[s.title, { color: c.ink }]}>{data.slot_label_te}</Text>

      <View style={s.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "ఆపండి" : "వినండి"}
          onPress={() => (playing ? player.pause() : player.play())}
          style={[s.play, { backgroundColor: c.brand }]}
        >
          <Text style={s.playLabel}>{playing ? "⏸  ఆపండి" : "▶  వినండి"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/bulletin")}
          style={[s.more, { borderColor: c.rule }]}
        >
          <Text style={[s.moreLabel, { color: c.ink }]}>అన్నీ</Text>
        </Pressable>
      </View>

      {data.items.slice(0, 3).map((item) => (
        <Text key={item.position} style={[s.item, { color: c.inkSoft }]}>
          • {item.headline_te}
        </Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: {
    fontFamily: font.teluguSemiBold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  time: { fontFamily: font.teluguSemiBold, fontSize: 11.5, marginLeft: "auto" },
  title: {
    fontFamily: font.teluguBold,
    fontSize: 16,
    // Telugu stacks marks above and below the baseline; 1.65x is the floor.
    lineHeight: 27,
    marginTop: 4,
  },
  row: { flexDirection: "row", gap: 8, marginTop: 10 },
  play: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  playLabel: {
    fontFamily: font.teluguBold,
    fontSize: 14,
    color: "#fff",
  },
  more: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  moreLabel: { fontFamily: font.telugu, fontSize: 13.5 },
  item: {
    fontFamily: font.telugu,
    fontSize: 13.5,
    lineHeight: 23,
    marginTop: 6,
  },
});
