import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text } from "react-native";
import * as api from "@/api/epaper";
import { RowCard } from "@/components/ArticleCard";
import { VideoStrip } from "@/components/VideoStrip";
import { font } from "@/lib/theme";
import { usePrefs } from "@/stores/prefs";
export default function Screen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const district = usePrefs((state) => state.edition);
  const q = useQuery({
    queryKey: ["topic", slug, district],
    queryFn: () => api.fetchTopic(slug!, district),
  });
  if (q.isLoading) return <ActivityIndicator style={{ margin: 40 }} />;
  return (
    <ScrollView>
      <Text
        style={{
          fontFamily: font.headlineHeavy,
          fontSize: 28,
          lineHeight: 42,
          padding: 14,
        }}
      >
        {q.data?.topic.title_te || slug}
      </Text>
      {q.data?.articles.map((a) => (
        <RowCard key={a.short_id} article={a} />
      ))}
      <VideoStrip category={slug} />
    </ScrollView>
  );
}
