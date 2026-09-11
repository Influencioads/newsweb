import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { ArticleAudio } from "@/components/ArticleAudio";
import { EmptyState, LoadingState } from "@/components/Feedback";
import { font } from "@/lib/theme";
import { useColors } from "@/lib/useTheme";

/**
 * Today's audio bulletins — six a day, 06:00 to 21:00 IST.
 *
 * Playback reuses `ArticleAudio` through its `endpoint` prop: the bulletin
 * route returns the same payload shape as an article's audio, so the scrubber,
 * the four speeds and the ±15s skips all work without a second player.
 *
 * Only bulletins that are actually on air appear. A reader has no use for the
 * difference between "not produced yet" and "an editor pulled it".
 */

interface BulletinSummary {
  available: boolean;
  url: string | null;
  duration_sec: number;
  date: string | null;
  slot: number | null;
  slot_label_te: string | null;
  items: Array<{ position: number; short_id: string | null; headline_te: string }>;
}

export default function BulletinScreen() {
  const c = useColors();

  const day = useQuery({
    queryKey: ["bulletin", "day"],
    queryFn: async () =>
      (await api.get<{ enabled: boolean; items: BulletinSummary[] }>(
        "/public/bulletins",
      )).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const live = (day.data?.items ?? []).filter((b) => b.available);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["bottom"]}>
      <Stack.Screen options={{ title: "ఆడియో వార్తలు" }} />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={[s.intro, { color: c.muted }]}>
          ప్రతి మూడు గంటలకు మూడు నిమిషాల బులెటిన్ — ఉదయం ఆరు నుంచి రాత్రి తొమ్మిది వరకు.
        </Text>

        {day.isLoading ? <LoadingState /> : null}

        {live.map((bulletin) => (
          <View
            key={`${bulletin.date}-${bulletin.slot}`}
            style={[s.card, { backgroundColor: c.paper, borderColor: c.rule }]}
          >
            <Text style={[s.title, { color: c.ink }]}>
              {bulletin.slot_label_te}
            </Text>

            <ArticleAudio
              shortId={`bulletin-${bulletin.date}-${bulletin.slot}`}
              endpoint={`/public/bulletins/${bulletin.date}/${bulletin.slot}`}
              deviceSpeaking={false}
              onToggleDevice={() => {}}
              listenLabel="వినండి"
              stopLabel="ఆపండి"
            />

            {bulletin.items.map((item) => (
              <Pressable
                key={item.position}
                disabled={!item.short_id}
                onPress={() =>
                  item.short_id &&
                  router.push({
                    pathname: "/article/[shortId]",
                    params: { shortId: item.short_id },
                  })
                }
                style={s.item}
              >
                <Text style={[s.itemText, { color: c.inkSoft }]}>
                  {item.position}. {item.headline_te}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}

        {!day.isLoading && live.length === 0 ? (
          <EmptyState message="ప్రస్తుతం బులెటిన్ ఏదీ లేదు. తదుపరిది మూడు గంటల తర్వాత వస్తుంది." />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  intro: {
    fontFamily: font.telugu,
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 14,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  title: {
    fontFamily: font.teluguBold,
    fontSize: 16,
    lineHeight: 27,
    marginBottom: 8,
  },
  item: { paddingVertical: 6, minHeight: 44, justifyContent: "center" },
  itemText: { fontFamily: font.telugu, fontSize: 14, lineHeight: 24 },
});
