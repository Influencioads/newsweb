import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import * as epaperApi from "@/api/epaper";
import type { Poll } from "@/api/epaper";
import { font } from "@/lib/theme";
import { useColors } from "@/lib/useTheme";

export function PollCard({ poll }: { poll: Poll }) {
  const c = useColors();
  const [current, setCurrent] = useState(poll);
  const vote = useMutation({
    mutationFn: (id: number) => epaperApi.vote(current.id, id),
    onSuccess: setCurrent,
  });
  const show = current.has_voted || current.status !== "ACTIVE";
  return (
    <View style={[s.card, { backgroundColor: c.paper, borderColor: c.brand }]}>
      <Text style={[s.kicker, { color: c.brand }]}>
        ❓ {current.is_big_question ? "బిగ్ క్వశ్చన్" : "పోల్"}
      </Text>
      <Text style={[s.question, { color: c.ink }]}>{current.question_te}</Text>
      {current.options.map((o) => (
        <Pressable
          key={o.id}
          disabled={show || vote.isPending}
          onPress={() => vote.mutate(o.id)}
          style={[
            s.option,
            {
              borderColor:
                current.selected_option_id === o.id ? c.brand : c.rule,
            },
          ]}
        >
          <View
            style={[
              s.fill,
              {
                backgroundColor: c.brandTint,
                width: show ? `${o.percentage}%` : "0%",
              },
            ]}
          />
          <Text style={[s.label, { color: c.ink }]}>{o.option_text_te}</Text>
          {show ? (
            <Text style={[s.percent, { color: c.brand }]}>{o.percentage}%</Text>
          ) : null}
        </Pressable>
      ))}
      <View style={s.footer}>
        <Text style={{ color: c.muted }}>{current.total_votes} ఓట్లు</Text>
        <Pressable
          onPress={() =>
            Share.share({
              message: `${current.question_te}\nhttps://telugunews.influencioweb.com/polls/${current.id}`,
            })
          }
        >
          <Text style={[s.share, { color: c.brand }]}>షేర్</Text>
        </Pressable>
      </View>
      {vote.isError ? (
        <Text style={{ color: c.breaking }}>మీ ఓటు నమోదు కాలేదు.</Text>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  card: { margin: 14, padding: 18, borderWidth: 2, borderRadius: 10 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  question: {
    fontFamily: font.headlineHeavy,
    fontSize: 23,
    lineHeight: 35,
    marginVertical: 10,
  },
  option: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 7,
    marginTop: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  label: { fontFamily: font.teluguSemiBold, fontSize: 14, zIndex: 1 },
  percent: { marginLeft: "auto", fontWeight: "800", zIndex: 1 },
  footer: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  share: { fontWeight: "800" },
});
