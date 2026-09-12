import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Newspaper } from 'lucide-react';

import { ApiError } from '@/api/client';
import { ButtonLink } from '@/components/ui/Button';
import { PageContainer } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import * as epaperApi from '@/features/epaper/api';
import { useI18n } from '@/i18n';
import type { EpaperEdition } from '@/types/epaper';
import { useDocumentTitle } from '@/utils/motion';
import { formatDate } from '@/utils/time';

import { EditionReader } from './epaper/EditionReader';

/**
 * E-paper route — today's edition, a dated one from the archive, or a reader's
 * own generated edition (`/my-epaper/edition/:personalId`). This file resolves
 * which edition to load and owns the loading / empty / error surfaces;
 * `epaper/EditionReader` draws it.
 */

export default function EpaperPage() {
  const { t, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const params = useParams();
  const personalId = params.personalId ? Number(params.personalId) : null;
  const query = useQuery({
    queryKey: ['epaper', personalId ? `personal-${personalId}` : params.date || 'today'],
    queryFn: async (): Promise<EpaperEdition | null> => {
      try {
        if (personalId) return await epaperApi.fetchMyGeneratedEdition(personalId);
        return await (params.date ? epaperApi.fetchEpaper(params.date) : epaperApi.fetchTodayEpaper());
      } catch (error) {
        // No edition for that day is the empty state, not a failure to retry.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  const editionDate = query.data?.edition_date;
  useDocumentTitle(editionDate ? `${t('page.epaper')} · ${formatDate(editionDate, language)}` : t('page.epaper'));

  return (
    <PageContainer width="page" className="pb-12">
      <QueryState
        query={query}
        skeleton={
          <div className="py-4">
            <SkeletonCard variant="lead" />
          </div>
        }
        isEmpty={(edition) => !edition?.pages.length}
        empty={
          <EmptyState
            icon={Newspaper}
            headingLevel={1}
            className="py-8 md:py-12"
            title={L('ప్రచురించిన ఎడిషన్ ఇంకా అందుబాటులో లేదు.', 'No published edition is available yet.')}
            action={
              <ButtonLink to="/" variant="secondary" icon={ArrowLeft}>
                {L('వార్తలకు తిరిగి వెళ్లండి', 'Back to news')}
              </ButtonLink>
            }
          />
        }
      >
        {(edition) => edition && <EditionReader edition={edition} personalId={personalId} requestedPage={params.page} />}
      </QueryState>
    </PageContainer>
  );
}
