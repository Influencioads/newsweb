import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text } from "react-native";
import * as api from "@/api/epaper";
import { PollCard } from "@/components/PollCard";
export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["poll", id],
    queryFn: () => api.fetchPoll(Number(id)),
  });
  if (q.isLoading) return <ActivityIndicator style={{ margin: 40 }} />;
  return q.data ? (
    <PollCard poll={q.data} />
  ) : (
    <Text style={{ padding: 30 }}>Poll not found.</Text>
  );
}
