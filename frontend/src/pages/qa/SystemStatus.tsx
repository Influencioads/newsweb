import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { StatusPill } from '@/components/ui/Badge';
import { ButtonLink, Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { ErrorState } from '@/components/ui/State';
import { useDocumentTitle } from '@/utils/motion';

interface HealthResponse {
  status: 'ok' | 'degraded';
  app: string;
  env: string;
  version: string;
  dependencies: { mysql: boolean; redis: boolean };
}

/** Registry key for a dependency probe: up, down, or still being checked. */
function probeStatus(ok: boolean | undefined, isLoading: boolean): string {
  if (ok === true) return 'ok';
  if (ok === false) return 'error';
  return isLoading ? 'pending' : 'none';
}

/**
 * Phase 1 system status.
 *
 * This exists so "does the stack actually run end to end" is answerable without
 * a terminal. It reads the real `/health` endpoint — nothing on this page is
 * hardcoded (brief §40).
 *
 * A standalone route with no layout around it, so it owns the one
 * `<main id="main">` landmark itself.
 */
export default function SystemStatus() {
  useDocumentTitle('System status');
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data } = await axios.get<HealthResponse>('/health');
      return data;
    },
    refetchInterval: 15_000,
    retry: false,
  });

  const rows: Array<[string, boolean | undefined, string]> = [
    ['Frontend — React + Vite + TypeScript', true, 'rendering this page'],
    ['API — FastAPI', data ? true : undefined, data ? `${data.app} · ${data.env}` : 'GET /health'],
    ['MySQL 8', data?.dependencies.mysql, 'SELECT 1'],
    ['Redis 7', data?.dependencies.redis, 'PING'],
  ];

  return (
    <PageContainer as="main" id="main" tabIndex={-1} width="wrap" className="py-10 outline-none">
      <PageHeader
        titleLang="en"
        title="System status"
        subtitle={
          // The page is English-only; the subtitle says so itself rather than
          // inheriting the reader's interface language from PageHeader.
          <span lang="en" className="font-sans">
            Phase 1 · live readiness probe. Values come from the API, none are hardcoded.
          </span>
        }
      />

      {isError && (
        <div className="mb-6">
          <ErrorState error={error} onRetry={() => void refetch()} title="API unreachable" compact />
          <p className="mt-2 text-center font-mono text-meta text-muted">
            {error instanceof Error ? error.message : 'Unknown error'} — is the backend running on port 8000?
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map(([label, ok, detail]) => (
          <li key={label}>
            <Card className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-ui-sm font-medium text-ink">{label}</p>
                <p className="truncate font-mono text-meta text-muted">{detail}</p>
              </div>
              <StatusPill status={probeStatus(ok, isLoading)} size="sm" className="shrink-0" />
            </Card>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={() => void refetch()} pending={isFetching}>
          {isFetching ? 'Checking…' : 'Re-check'}
        </Button>
        <ButtonLink to="/qa/telugu-render" variant="secondary">
          Telugu render test
        </ButtonLink>
        <ButtonLink to="/docs" external variant="link">
          OpenAPI docs
        </ButtonLink>
      </div>
    </PageContainer>
  );
}
