import type { BadgeTone } from '@/components/ui/Badge';

/**
 * Status registry — one place that maps every workflow / pipeline status the
 * backend emits to a Badge tone and a bilingual label.
 *
 *   <StatusPill status={article.workflow_state} />            // default registry
 *   <StatusPill status={row.status} registry={BULLETIN_STATUS} />  // domain labels
 *   statusTone('failed')                                       // 'breaking'
 *
 * Lookups are case-insensitive (`'IN_REVIEW'` and `'in_review'` both hit).
 * `STATUS_TONES` is the merged default; the per-domain registries below keep
 * the more specific wording where the same key means something else
 * (bulletin `pending` = "not produced", rewrite `skipped` = "too little text").
 */

export interface StatusEntry {
  tone: BadgeTone;
  te: string;
  en: string;
}

export type StatusRegistry = Record<string, StatusEntry>;

const entry = (tone: BadgeTone, te: string, en: string): StatusEntry => ({ tone, te, en });

/** Editorial workflow (`CmsArticle.workflow_state`, e-paper editions, reader submissions). */
export const WORKFLOW_STATUS = {
  draft: entry('muted', 'డ్రాఫ్ట్', 'Draft'),
  submitted: entry('info', 'సమర్పించారు', 'Submitted'),
  in_review: entry('info', 'సమీక్షలో', 'In review'),
  under_review: entry('info', 'సమీక్షలో', 'Under review'),
  changes_requested: entry('partial', 'మార్పులు కోరారు', 'Changes requested'),
  approved: entry('success', 'ఆమోదించారు', 'Approved'),
  scheduled: entry('info', 'షెడ్యూల్ అయింది', 'Scheduled'),
  published: entry('success', 'ప్రచురితం', 'Published'),
  unpublished: entry('muted', 'ప్రచురణ ఆగింది', 'Unpublished'),
  rejected: entry('breaking', 'తిరస్కరించారు', 'Rejected'),
  archived: entry('muted', 'ఆర్కైవ్ చేశారు', 'Archived'),
  generated: entry('info', 'తయారైంది', 'Generated'),
} satisfies StatusRegistry;

/** Contributor KYC (`KycStatus`). Labels lifted from the KYC desk page. */
export const KYC_STATUS = {
  not_started: entry('muted', 'ప్రారంభం కాలేదు', 'Not started'),
  draft: WORKFLOW_STATUS.draft,
  submitted: WORKFLOW_STATUS.submitted,
  in_review: WORKFLOW_STATUS.in_review,
  more_info: entry('partial', 'మరింత సమాచారం', 'More info asked'),
  approved: WORKFLOW_STATUS.approved,
  rejected: WORKFLOW_STATUS.rejected,
  expired: entry('muted', 'గడువు ముగిసింది', 'Expired'),
} satisfies StatusRegistry;

/** Voice bulletins (`BulletinStatus`). Labels lifted from the bulletins page. */
export const BULLETIN_STATUS = {
  pending: entry('muted', 'ఇంకా తయారు కాలేదు', 'Not produced'),
  scripted: entry('info', 'స్క్రిప్ట్ సిద్ధం', 'Script ready'),
  ready: entry('partial', 'ఆడియో సిద్ధం', 'Audio ready'),
  published: entry('success', 'ప్రసారంలో', 'On air'),
  failed: entry('breaking', 'విఫలమైంది', 'Failed'),
  skipped: entry('muted', 'వార్తలు లేవు', 'No stories'),
} satisfies StatusRegistry;

/** Feed rewrites (`RewriteStatus`). Labels lifted from the content-sources page. */
export const REWRITE_STATUS = {
  none: entry('muted', 'పునర్లేఖనం లేదు', 'Not rewritten'),
  pending: entry('muted', 'వేచి ఉంది', 'Pending'),
  ready: entry('ai', 'సిద్ధం', 'Rewritten'),
  refused: entry('partial', 'నిరాకరించింది', 'Model declined'),
  human_only: entry('breaking', 'మనిషి చదవాలి', 'Needs a person'),
  skipped: entry('muted', 'సరిపడా సమాచారం లేదు', 'Too little source text'),
  failed: entry('breaking', 'విఫలమైంది', 'Failed'),
} satisfies StatusRegistry;

/** Article audio (`AudioStatus`). */
export const AUDIO_STATUS = {
  pending: REWRITE_STATUS.pending,
  generating: entry('info', 'తయారవుతోంది', 'Generating'),
  ready: entry('success', 'సిద్ధం', 'Ready'),
  failed: REWRITE_STATUS.failed,
} satisfies StatusRegistry;

/**
 * Merged default. Domain registries first, then generic meanings override the
 * colliding keys (`pending`, `ready`, `skipped`, `published`, `none`) so an
 * unqualified `<StatusPill status="ready" />` reads "Ready", not "Audio ready".
 */
export const STATUS_TONES: StatusRegistry = {
  ...BULLETIN_STATUS,
  ...REWRITE_STATUS,
  ...AUDIO_STATUS,
  ...KYC_STATUS,
  ...WORKFLOW_STATUS,
  // Generic pipeline states.
  none: entry('muted', 'ఏమీ లేదు', 'None'),
  pending: entry('muted', 'వేచి ఉంది', 'Pending'),
  ready: entry('success', 'సిద్ధం', 'Ready'),
  skipped: entry('muted', 'దాటవేయబడింది', 'Skipped'),
  completed: entry('success', 'పూర్తయింది', 'Completed'),
  cancelled: entry('muted', 'రద్దు చేశారు', 'Cancelled'),
  ok: entry('success', 'సరిగ్గా ఉంది', 'OK'),
  error: entry('breaking', 'లోపం', 'Error'),
  // AI suggestions / drafts / feed ingest.
  new: entry('info', 'కొత్తది', 'New'),
  accepted: entry('success', 'అంగీకరించారు', 'Accepted'),
  used: entry('muted', 'ఉపయోగించారు', 'Used'),
  converted: entry('success', 'కథనంగా మార్చారు', 'Converted'),
  discarded: entry('muted', 'విస్మరించారు', 'Discarded'),
  imported: entry('success', 'తీసుకున్నారు', 'Imported'),
  duplicate: entry('muted', 'ఇప్పటికే ఉంది', 'Duplicate'),
  // Polls, pins, web stories, homepage blocks.
  active: entry('success', 'క్రియాశీలం', 'Active'),
  inactive: entry('muted', 'నిష్క్రియం', 'Inactive'),
  live: entry('success', 'లైవ్', 'Live'),
  paused: entry('partial', 'పాజ్‌లో ఉంది', 'Paused'),
  stopped: entry('muted', 'ఆగింది', 'Stopped'),
  ended: entry('muted', 'ముగిసింది', 'Ended'),
  closed: entry('muted', 'మూసివేశారు', 'Closed'),
  enabled: entry('success', 'ఆన్‌లో ఉంది', 'Enabled'),
  disabled: entry('muted', 'ఆఫ్‌లో ఉంది', 'Disabled'),
  // Moderation: comments and reports.
  visible: entry('success', 'కనిపిస్తుంది', 'Visible'),
  hidden: entry('muted', 'దాచబడింది', 'Hidden'),
  flagged: entry('partial', 'నివేదించారు', 'Flagged'),
  open: entry('partial', 'తెరిచి ఉంది', 'Open'),
  resolved: entry('success', 'పరిష్కరించారు', 'Resolved'),
  dismissed: entry('muted', 'తోసిపుచ్చారు', 'Dismissed'),
  // Staff accounts (`UserStatus`).
  invited: entry('info', 'ఆహ్వానించారు', 'Invited'),
  suspended: entry('breaking', 'నిలిపివేశారు', 'Suspended'),
};

/** Registry lookup; case-insensitive, `undefined` when the status is unknown. */
export function statusEntry(status: string, registry: StatusRegistry = STATUS_TONES): StatusEntry | undefined {
  return registry[status] ?? registry[status.toLowerCase()];
}

/** Badge tone for a status; unknown statuses fall back to `muted`. */
export function statusTone(status: string, registry: StatusRegistry = STATUS_TONES): BadgeTone {
  return statusEntry(status, registry)?.tone ?? 'muted';
}
