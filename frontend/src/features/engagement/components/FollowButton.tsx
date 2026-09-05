import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Plus } from 'lucide-react';

import * as engagementApi from '@/features/engagement/api';
import type { FollowTargetType } from '@/features/engagement/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';

/**
 * Follow toggle (§12) for a category, tag, place or author. One shared
 * `my-follows` query backs every instance, so all buttons stay in sync.
 */
export function FollowButton({
  targetType,
  slug,
  name,
  compact = false,
}: {
  targetType: FollowTargetType;
  slug: string;
  /** Entity name shown inside the chip (e.g. "సినిమా"); omit for the bare verb. */
  name?: string;
  compact?: boolean;
}) {
  const { language } = useI18n();
  const te = language === 'te';
  const navigate = useNavigate();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();

  const follows = useQuery({
    queryKey: ['engagement', 'my-follows'],
    queryFn: engagementApi.fetchMyFollows,
    enabled: authed,
    staleTime: 60_000,
  });

  const following =
    follows.data?.some((f) => f.target_type === targetType && f.slug === slug) ?? false;

  const toggle = useMutation({
    mutationFn: (next: boolean) => engagementApi.setFollow(targetType, slug, next),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['engagement', 'my-follows'] }),
  });

  function onPress() {
    if (!authed) {
      navigate('/login');
      return;
    }
    toggle.mutate(!following);
  }

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={toggle.isPending}
      aria-pressed={following}
      className={[
        'flex items-center gap-1 rounded-chip border font-semibold transition-colors',
        te ? 'te' : 'font-sans',
        compact ? 'px-2.5 py-1 text-[11px]' : 'min-h-[34px] px-3.5 text-[12.5px]',
        following
          ? 'border-brand bg-brand-tint text-brand'
          : 'border-rule bg-paper text-muted hover:border-brand hover:text-brand',
      ].join(' ')}
    >
      {following ? (
        <BellRing className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Plus className="h-3.5 w-3.5" aria-hidden />
      )}
      {name ? (
        <span lang={te ? 'te' : 'en'} className={te ? 'te' : 'font-sans'}>{name}</span>
      ) : following ? (
        te ? 'ఫాలో అవుతున్నారు' : 'Following'
      ) : te ? (
        'ఫాలో అవ్వండి'
      ) : (
        'Follow'
      )}
    </button>
  );
}
