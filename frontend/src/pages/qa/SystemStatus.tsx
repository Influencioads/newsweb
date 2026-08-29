import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Link } from 'react-router-dom';

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
 */
export default function SystemStatus() {
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
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-6">
        <h1 className="font-headline text-headline-lg font-bold text-brand">System status</h1>
        <p className="mt-1 font-sans text-[12px] text-muted">
          Phase 1 · live readiness probe. Values come from the API, none are hardcoded.
        </p>
      </header>

      {isError && (
        <div
          role="alert"
          className="mb-4 rounded-control border border-breaking-border bg-breaking-tint p-4"
        >
          <p className="font-sans text-[13px] font-semibold text-breaking">API unreachable</p>
          <p className="mt-1 font-sans text-[12px] text-ink-soft">
            {error instanceof Error ? error.message : 'Unknown error'} — is the backend running on
            port 8000?
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map(([label, ok, detail]) => (
          <li
            key={label}
            className="flex items-center justify-between gap-4 rounded-card border border-rule bg-white p-4 shadow-card"
          >
            <div className="min-w-0">
              <p className="font-sans text-[13px] font-medium text-ink">{label}</p>
              <p className="truncate font-mono text-[11px] text-muted-light">{detail}</p>
            </div>
            <span
              className={[
                'shrink-0 rounded-chip px-3 py-1 font-sans text-[11px] font-bold',
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
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="min-h-tap rounded-control bg-ink px-5 font-sans text-[13px] font-semibold text-white disabled:opacity-60"
        >
          {isFetching ? 'Checking…' : 'Re-check'}
        </button>
        <Link
          to="/qa/telugu-render"
          className="min-h-tap rounded-control border border-ink px-5 py-2.5 font-sans text-[13px] font-semibold text-ink"
        >
          Telugu render test →
        </Link>
        <a
          href="/docs"
          className="font-sans text-[12px] font-medium text-info underline"
          target="_blank"
          rel="noreferrer"
        >
          OpenAPI docs
        </a>
      </div>
    </main>
  );
}
