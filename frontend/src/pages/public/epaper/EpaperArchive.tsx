import { useQuery } from '@tanstack/react-query';

import { Chip, ChipRail } from '@/components/ui/Chip';
import { SectionHeader } from '@/components/ui/Layout';
import { QueryState, SkeletonCard } from '@/components/ui/State';
import * as epaperApi from '@/features/epaper/api';
import { useI18n } from '@/i18n';

/** Published back issues as one date rail; the open edition carries aria-current. */
export function EpaperArchive({ current }: { current: string }) {
  const { t } = useI18n();
  const archive = useQuery({ queryKey: ['epaper-archive'], queryFn: epaperApi.fetchEpaperArchive });
  return (
    <section className="mt-7 md:mt-10">
      <SectionHeader title={t('epaper.archive')} />
      <QueryState query={archive} compact skeleton={<SkeletonCard variant="row" />} isEmpty={(d) => !d.items.length}>
        {(d) => (
          <ChipRail ariaLabel={t('epaper.archive')}>
            {d.items.map((e) => (
              <Chip
                key={e.id}
                as="link"
                to={`/epaper/${e.edition_date}`}
                selected={e.edition_date === current}
                className="tabular-nums"
              >
                {e.edition_date} · {e.page_count} {t('ui.pages')}
              </Chip>
            ))}
          </ChipRail>
        )}
      </QueryState>
    </section>
  );
}
