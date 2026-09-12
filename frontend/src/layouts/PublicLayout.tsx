import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import { RouteFallback, SkipLink } from '@/components/app';
import { BreakingTicker } from '@/components/layout/BreakingTicker';
import { CategoryNav } from '@/components/layout/CategoryNav';
import { Masthead } from '@/components/layout/Masthead';
import { PolicyFooter } from '@/components/layout/PolicyFooter';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';

/**
 * Public reader shell: masthead (scrolls away) · category nav (sticky) ·
 * breaking ticker · <main id="main"> · footer.
 *
 * Bilingual (§16 open item 3, decided in favour of both): chrome switches
 * between Telugu and English, while article headlines fall back to Telugu when
 * no English version exists (`useI18n().pick`). Category names come from the
 * database in both languages, so the nav translates without a hardcoded map.
 *
 * The shell owns the one <main> landmark; pages render PageContainer roots.
 */
export default function PublicLayout() {
  const { language } = useI18n();
  const authStatus = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  // Keep <html lang> correct on first paint as well as after a switch.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Resolve the reader's session so the masthead shows profile vs sign-in.
  useEffect(() => {
    if (authStatus === 'idle') void bootstrap();
  }, [authStatus, bootstrap]);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SkipLink />
      {/* Only the masthead is the banner. The sticky nav sits directly in the
          root column so its containing block is the full page, not a boxed
          header that would scroll away with the masthead. */}
      <header>
        <Masthead />
      </header>
      <CategoryNav />
      <BreakingTicker />

      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>

      <PolicyFooter />
    </div>
  );
}
