import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text } from "react-native";
import * as api from "@/api/epaper";
import { EpaperReader } from "@/components/EpaperReader";
export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["personal-epaper", id],
    queryFn: () => api.fetchPersonal(Number(id)),
    enabled: Boolean(id),
  });
  if (q.isLoading) return <ActivityIndicator style={{ margin: 40 }} />;
  return q.data ? (
    <EpaperReader edition={q.data} personal />
  ) : (
    <Text>Edition not found.</Text>
  );
}
