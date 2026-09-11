import { useEffect, useState } from 'react';

import { PageContainer } from '@/components/ui/Layout';
import { useI18n } from '@/i18n';

/**
 * Suspense fallback for lazy routes: a page-shaped skeleton that only appears
 * after 150ms, so a chunk that arrives quickly never flashes a loader.
 *
 *     <Suspense fallback={<RouteFallback />}>…</Suspense>
 *
 * The status text is announced immediately (sr-only); only the visual delays.
 */
export function RouteFallback() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), 150);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <PageContainer className="py-8">
      <div role="status">
        <span className="sr-only">{t('state.loadingPage')}</span>
        {show ? (
          <div aria-hidden className="animate-fade-in space-y-4">
            <div className="skeleton h-8 w-2/3 rounded-xl" />
            <div className="skeleton aspect-video w-full rounded-2xl" />
            <div className="skeleton h-4 w-full rounded-xl" />
            <div className="skeleton h-4 w-11/12 rounded-xl" />
            <div className="skeleton h-4 w-4/5 rounded-xl" />
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}
