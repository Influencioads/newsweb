import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import * as engagementApi from '@/api/engagement';
import type { FollowTargetType } from '@/api/engagement';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import { Chip } from '@/ui/Chip';

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
  const { t } = useI18n();
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
    <Chip
      label={name}
      icon={following ? 'check' : 'plus'}
      selected={following}
      disabled={toggle.isPending}
      accessibilityLabel={`${following ? t('ui.following') : t('ui.follow')}: ${name}`}
      onPress={() => {
        if (!authed) {
          router.push('/profile');
          return;
        }
        toggle.mutate(!following);
      }}
    />
  );
}
