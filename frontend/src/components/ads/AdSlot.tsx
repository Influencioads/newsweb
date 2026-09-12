import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * House-ad slot (updated doc §26). Fetches one campaign for the placement.
 *
 * Layout contract: the slot occupies no space at all until a campaign has
 * actually resolved. Most requests answer "no campaign", so painting a reserved
 * box first and collapsing it afterwards moved the story under the reader on
 * the common path — the opposite of what reserving space is for (CLS, §10.3).
 * Once a campaign is in hand the box carries its reserved aspect ratio, so the
 * image itself never shifts as it decodes.
 *
 * The "ప్రకటన" label always renders — clear commercial labeling is not
 * optional, and it is ours, not the advertiser's copy (the campaign's own label
 * is the image `alt`).
 *
 * Frequency control v1: one pick per placement per 5 minutes per client
 * (react-query staleTime), so a reader is not shown a new creative on every
 * navigation.
 */

export type AdPlacement = 'top_banner' | 'in_feed' | 'article' | 'category';

/** Reserved aspect per placement. Wide banners, boxier in-feed units. */
const RESERVED: Record<AdPlacement, string> = {
  top_banner: '6/1',
  in_feed: '3/1',
  article: '3/1',
  category: '6/1',
};

interface AdPayload {
  id: number;
  placement: AdPlacement;
  image_url: string;
  target_url: string;
  label_te: string;
  label_en: string;
}

async function fetchAd(placement: AdPlacement, category?: string, district?: string) {
  const { data } = await api.get<AdPayload | null>('/public/ads', {
    params: { placement, category, district },
  });
  return data;
}

export function AdSlot({
  placement,
  category,
  district,
  className,
}: {
  placement: AdPlacement;
  category?: string;
  district?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const s = useScript();
  const { data, isPending } = useQuery({
    queryKey: ['public', 'ad', placement, category ?? '', district ?? ''],
    queryFn: () => fetchAd(placement, category, district),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Nothing is painted until the campaign has actually answered. Reserving the
  // box up front and then collapsing it shifted everything below by up to 200px
  // on the *common* path (no campaign matches); waiting means the only layout
  // move left is the rare one where an ad really does arrive.
  if (isPending || !data) return null;

  const label = s.te ? data.label_te : data.label_en;
  const id = data.id;

  // Fire-and-forget click counter; never block the navigation on it.
  const onClick = () => void api.post(`/public/ads/${id}/click`).catch(() => undefined);

  return (
    <aside className={className} aria-label={t('home.advertisement')}>
      {/* text-eyebrow is uppercase Latin with tracking — never applied to Telugu (§4.1). */}
      <p className={cn('mb-1 text-muted', s.te ? 'te text-meta font-semibold' : 'font-sans text-eyebrow uppercase')}>
        {t('home.advertisement')}
      </p>
      <div
        className="overflow-hidden rounded-xl border border-rule-soft bg-paper-sub"
        style={{ aspectRatio: RESERVED[placement] }}
      >
        <a
          href={data.target_url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={onClick}
          className="block h-full w-full"
        >
          <img src={data.image_url} alt={label} loading="lazy" className="h-full w-full object-contain" />
        </a>
      </div>
    </aside>
  );
}
