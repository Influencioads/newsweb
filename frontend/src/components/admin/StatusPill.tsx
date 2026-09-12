import { StatusPill, type BadgeSize } from '@/components/ui/Badge';
import { BULLETIN_STATUS, KYC_STATUS, WORKFLOW_STATUS } from '@/features/cms/status';

/**
 * Admin status pills — `StatusPill` re-exported for the CMS pages, plus
 * registry-bound shorthands so a table cell reads `<WorkflowPill status={…} />`
 * instead of threading the registry through every call site.
 */
export { StatusPill, type StatusPillProps } from '@/components/ui/Badge';

export interface BoundPillProps {
  status: string;
  size?: BadgeSize;
  className?: string;
}

/** Editorial workflow state (`CmsArticle.workflow_state`). */
export function WorkflowPill(props: BoundPillProps) {
  return <StatusPill registry={WORKFLOW_STATUS} {...props} />;
}

/** Contributor KYC state. */
export function KycPill(props: BoundPillProps) {
  return <StatusPill registry={KYC_STATUS} {...props} />;
}

/** Voice bulletin production state. */
export function BulletinPill(props: BoundPillProps) {
  return <StatusPill registry={BULLETIN_STATUS} {...props} />;
}
