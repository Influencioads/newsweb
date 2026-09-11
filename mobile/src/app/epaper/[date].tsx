import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import * as api from "@/api/epaper";
import { EpaperReader } from "@/components/EpaperReader";
export default function Screen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const q = useQuery({
    queryKey: ["epaper", date],
    queryFn: () => api.fetchEdition(date!),
    enabled: Boolean(date),
  });
  if (q.isLoading) return <ActivityIndicator style={{ margin: 40 }} />;
  if (!q.data)
    return (
      <View style={{ padding: 30 }}>
        <Text>Published E-Paper not found.</Text>
      </View>
    );
  return <EpaperReader edition={q.data} />;
}
