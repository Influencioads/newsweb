import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

import { RouteFallback } from '@/components/app/RouteFallback';
import { PageContainer } from '@/components/ui/Layout';
import { EmptyState } from '@/components/ui/State';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { PermissionKey } from '@/types/auth';

/**
 * Route guard.
 *
 * This controls *navigation*, not authorization. Every protected API call is
 * independently checked by the FastAPI permission guard — a user who edits their
 * way past this component gains nothing, because the server rejects the request
 * (brief §6: "Backend security is authoritative").
 *
 * The guard sits outside AdminLayout, so the denied branch owns the one
 * `<main id="main">` landmark for that render.
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
    return <RouteFallback />;
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
  const { language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  return (
    <PageContainer as="main" id="main" tabIndex={-1} width="form" className="py-10 outline-none">
      <EmptyState
        icon={ShieldAlert}
        headingLevel={1}
        title={L('ఈ పేజీకి మీకు అనుమతి లేదు', 'You do not have access to this page')}
        body={L(
          'ఈ విభాగాన్ని చూడటానికి అవసరమైన అనుమతి మీ ఖాతాకు లేదు. మీ ఎడిటర్‌ను సంప్రదించండి.',
          'Your account does not hold the permission this section needs. Contact your editor.',
        )}
      />
      <p className="text-center font-mono text-meta text-muted">required: {permission}</p>
    </PageContainer>
  );
}
