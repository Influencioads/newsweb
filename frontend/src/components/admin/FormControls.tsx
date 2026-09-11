import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Legacy admin form chrome — a thin shim over the ui primitives so the existing
 * admin pages compile unchanged. New code imports from '@/components/ui/Field'.
 */
export { Field, inputClass, Switch as Toggle } from '@/components/ui/Field';

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  // Callers pass English literals and language-switched strings alike, so the
  // script follows the interface language rather than a hard-coded te/th.
  const s = useScript();
  return (
    <Card as="section">
      <div className="mb-4 border-b border-rule pb-3">
        <h2 lang={s.language} className={cn(s.head, 'text-headline-xs font-bold text-ink')}>
          {title}
        </h2>
        {subtitle ? (
          <p lang={s.language} className={cn(s.body, 'mt-0.5 text-meta text-muted')}>
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}
