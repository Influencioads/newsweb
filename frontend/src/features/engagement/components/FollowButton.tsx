import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import * as engagementApi from '@/features/engagement/api';
import type { FollowItem, FollowTargetType } from '@/features/engagement/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';

/**
 * Follow toggle (§12) for a category, tag, place or author.
 *
 * One shared `my-follows` query backs every instance, so all the buttons on a
 * page flip together. The toggle writes that cache optimistically and restores
 * it with a toast if the call fails — following is a small enough promise that
 * waiting a round trip to see it feels broken.
 */
export function FollowButton({
  targetType,
  slug,
  name,
  compact = false,
}: {
  targetType: FollowTargetType;
  slug: string;
  /** Entity name shown inside the button (e.g. "సినిమా"); omit for the bare verb. */
  name?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const s = useScript();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const authed = useAuth((state) => state.status === 'authenticated');
  const queryClient = useQueryClient();

  const queryKey = ['engagement', 'my-follows'];

  const follows = useQuery({
    queryKey,
    queryFn: engagementApi.fetchMyFollows,
    enabled: authed,
    staleTime: 60_000,
  });

  const following =
    follows.data?.some((f) => f.target_type === targetType && f.slug === slug) ?? false;

  const toggle = useMutation({
    mutationFn: (next: boolean) => engagementApi.setFollow(targetType, slug, next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FollowItem[]>(queryKey);
      queryClient.setQueryData<FollowItem[]>(queryKey, (prev) => {
        const rest = (prev ?? []).filter((f) => !(f.target_type === targetType && f.slug === slug));
        // The names only matter to the follows list page, which refetches.
        return next
          ? [...rest, { target_type: targetType, slug, name_te: name ?? slug, name_en: name ?? slug }]
          : rest;
      });
      return previous;
    },
    onError: (error, _next, previous) => {
      queryClient.setQueryData(queryKey, previous);
      toast.error(error);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  });

  function onPress() {
    if (!authed) {
      // Carry the return path, the way the save and sign-in sheet already do —
      // a reader who signs in to follow should land back on the story.
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    toggle.mutate(!following);
  }

  return (
    <Button
      lang={s.language}
      variant={following ? 'primary' : 'secondary'}
      size={compact ? 'sm' : 'md'}
      icon={following ? Check : Plus}
      pending={toggle.isPending}
      aria-pressed={following}
      onClick={onPress}
    >
      {name ?? (following ? t('ui.following') : t('ui.follow'))}
    </Button>
  );
}
