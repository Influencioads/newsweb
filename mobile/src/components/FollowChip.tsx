import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import * as engagementApi from '@/api/engagement';
import type { FollowTargetType } from '@/api/engagement';
import { color, font } from '@/lib/theme';
import { useAuth } from '@/stores/auth';

/** Follow toggle chip (§12). One shared my-follows query keeps chips in sync. */
export function FollowChip({
  targetType,
  slug,
  name,
}: {
  targetType: FollowTargetType;
  slug: string;
  name: string;
}) {
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();

  const follows = useQuery({
    queryKey: ['my-follows'],
    queryFn: engagementApi.fetchMyFollows,
    enabled: authed,
    staleTime: 60_000,
  });

  const following =
    follows.data?.some((f) => f.target_type === targetType && f.slug === slug) ?? false;

  const toggle = useMutation({
    mutationFn: (next: boolean) => engagementApi.setFollow(targetType, slug, next),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-follows'] }),
  });

  return (
    <Pressable
      onPress={() => {
        if (!authed) {
          router.push('/profile');
          return;
        }
        toggle.mutate(!following);
      }}
      disabled={toggle.isPending}
      accessibilityRole="button"
      accessibilityState={{ selected: following }}
      style={[styles.chip, following && styles.chipActive]}
    >
      <Text style={[styles.text, following && styles.textActive]}>
        {following ? '✓ ' : '+ '}
        {name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: color.paper,
  },
  chipActive: { borderColor: color.brand, backgroundColor: color.brandTint },
  text: { fontFamily: font.telugu, fontSize: 12.5, lineHeight: 19, color: color.muted },
  textActive: { color: color.brand, fontFamily: font.teluguSemiBold },
});
