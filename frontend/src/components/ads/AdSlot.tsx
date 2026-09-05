import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { useI18n } from '@/i18n';

/**
 * House-ad slot (updated doc §26). Fetches one campaign for the placement;
 * renders nothing when no campaign matches, so empty slots collapse instead
 * of showing a grey box. The "ప్రకటన" label always renders — clear commercial
 * labeling is not optional.
 *
 * Frequency control v1: one pick per placement per 5 minutes per client
 * (react-query staleTime), so a reader is not shown a new creative on every
 * navigation.
 */

export type AdPlacement = 'top_banner' | 'in_feed' | 'article' | 'category';

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
  const { language } = useI18n();
  const { data } = useQuery({
    queryKey: ['public', 'ad', placement, category ?? '', district ?? ''],
    queryFn: () => fetchAd(placement, category, district),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!data) return null;

  function onClick() {
    // Fire-and-forget click counter; never block the navigation on it.
    void api.post(`/public/ads/${data!.id}/click`).catch(() => undefined);
  }

  return (
    <aside className={className}>
      <p className={`${language === 'te' ? 'te' : 'font-sans'} mb-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-light`}>
        {language === 'te' ? data.label_te : data.label_en}
      </p>
      <a
        href={data.target_url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={onClick}
        className="block overflow-hidden rounded-[4px] border border-rule"
      >
        <img src={data.image_url} alt={language === 'te' ? data.label_te : data.label_en} className="block w-full" loading="lazy" />
      </a>
    </aside>
  );
}
