import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { ButtonLink, Button } from '@/components/ui/Button';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { useDocumentTitle } from '@/utils/motion';

interface HealthResponse {
  status: 'ok' | 'degraded';
  app: string;
  env: string;
  version: string;
  dependencies: { mysql: boolean; redis: boolean };
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
        subtitle="Phase 1 · live readiness probe. Values come from the API, none are hardcoded."
      />

      {isError && (
        <div role="alert" className="mb-4 rounded-xl border border-breaking-border bg-breaking-tint p-4">
          <p className="text-ui-sm font-semibold text-breaking">API unreachable</p>
          <p className="mt-1 text-meta text-ink-soft">
            {error instanceof Error ? error.message : 'Unknown error'} — is the backend running on
            port 8000?
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map(([label, ok, detail]) => (
          <li
            key={label}
            className="flex items-center justify-between gap-4 rounded-xl border border-rule bg-surface p-4 shadow-card"
          >
            <div className="min-w-0">
              <p className="text-ui-sm font-medium text-ink">{label}</p>
              <p className="truncate font-mono text-meta text-muted">{detail}</p>
            </div>
            <span
              className={[
                'shrink-0 rounded-pill px-3 py-1 text-meta font-bold',
                ok === true
                  ? 'bg-success-tint text-success'
                  : ok === false
                    ? 'bg-breaking-tint text-breaking'
                    : 'bg-rule-soft text-muted',
              ].join(' ')}
            >
              {isLoading && ok === undefined ? 'checking…' : ok === true ? 'up' : ok === false ? 'down' : '—'}
            </span>
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
