import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/stores/auth';
import type { PermissionKey } from '@/types/auth';

/**
 * Route guard.
 *
 * This controls *navigation*, not authorization. Every protected API call is
 * independently checked by the FastAPI permission guard — a user who edits their
 * way past this component gains nothing, because the server rejects the request
 * (brief §6: "Backend security is authoritative").
 */
export function RequireAuth({ permission }: { permission?: PermissionKey }) {
  const location = useLocation();
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  const can = useAuth((s) => s.can);

  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="te text-[13px] text-muted" role="status">
          లోడ్ అవుతోంది…
        </p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  if (permission && !can(permission)) {
    return <PermissionDenied permission={permission} />;
  }

  return <Outlet />;
}

function PermissionDenied({ permission }: { permission: PermissionKey }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-md rounded-card border border-rule bg-white p-6 text-center shadow-card">
        <h1 className="th text-[20px] font-bold text-ink">ఈ పేజీకి మీకు అనుమతి లేదు</h1>
        <p className="te mt-2 text-[13px] text-muted">
          ఈ విభాగాన్ని చూడటానికి అవసరమైన అనుమతి మీ ఖాతాకు లేదు. మీ ఎడిటర్‌ను సంప్రదించండి.
        </p>
        <p className="mt-3 font-mono text-[11px] text-muted-light">required: {permission}</p>
      </div>
    </main>
  );
}
