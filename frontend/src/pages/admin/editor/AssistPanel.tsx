import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Check, Lightbulb, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * §18 assist — suggestions the editor applies or ignores; nothing is automatic.
 * The API returns Telugu content (duplicates, tags, summary, headlines), so
 * those lines carry `lang="te"` regardless of the interface language.
 *
 * Two buttons, two costs. "Get suggestions" is free and deterministic: it also
 * runs the house-style lint over the copy as it stands and lists what it finds
 * (block = must fix before it reads like ours, warn = look again). The lint's
 * messages are English by design — they are written for the model's retry and
 * for the desk, not for readers — so they are shown as-is. "Headline ideas" is
 * one billed model call (~20 s) that returns a straight headline plus options
 * built on the curiosity devices that suit the detected story type, each named
 * by its device so the editor sees *why* it hooks, and an SEO title/description
 * pair. When AI is off or has no key the endpoint says so with available:false,
 * which is a setting, not a failure — shown as a plain note, not an alarm.
 */

type StyleIssue = { code: string; severity: 'block' | 'warn'; message: string };

type Assist = {
  engine: string;
  duplicates: Array<{ short_id: string; title_te: string; similarity_percent: number }>;
  suggested_tags: Array<{ slug: string; name_te: string; exists: boolean }>;
  suggested_category: { slug: string; name_te: string; name_en: string } | null;
  summary_te: string;
  seo: { seo_title: string; seo_description: string };
  story_type?: string | null;
  style_issues?: StyleIssue[];
};

export interface AssistPanelProps {
  title: string;
  body: string;
  /** The standfirst as typed: the headline call checks every number an option uses against it too. */
  summary?: string;
  onTitle: (title: string) => void;
  onSummary: (s: string) => void;
  onCategorySlug: (slug: string) => void;
  onTags: (names: string[]) => void;
  onSeo: (seo: { seo_title: string; seo_description: string }) => void;
}

export function AssistPanel({ title, body, summary = '', onTitle, onSummary, onCategorySlug, onTags, onSeo }: AssistPanelProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');

  const assist = useMutation({
    mutationFn: () => cmsApi.aiAssist<Assist>({ title_te: title, body_plain: body, summary_te: summary }),
    onError: (e) => toast.error(e),
  });
  const a = assist.data;

  // The form's text, not the saved article: the editor wants ideas for what is
  // on screen now, and an unsaved story has no id to send.
  const headlines = useMutation({
    mutationFn: () => cmsApi.aiHeadlines({ title_te: title, body_plain: body, summary_te: summary }),
    onError: (e) => toast.error(e),
  });
  const h = headlines.data;

  return (
    <section aria-label={t('ui.aiAssisted')} className="rounded-xl border border-ai-border bg-ai-tint p-4 shadow-card md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="ai" icon={Sparkles}>
            {t('ui.aiAssisted')}
          </Badge>
          <span className={cn(s.body, 'text-meta text-muted')}>
            {a ? `engine: ${a.engine}` : L('సూచనలు మాత్రమే — నిర్ణయం మీదే', 'Suggestions only — the decision is yours')}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={Lightbulb}
            pending={headlines.isPending}
            disabled={!body.trim()}
            onClick={() => headlines.mutate()}
          >
            {L('హెడ్‌లైన్ ఐడియాలు', 'Headline ideas')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Sparkles}
            pending={assist.isPending}
            disabled={!title.trim() || !body.trim()}
            onClick={() => assist.mutate()}
          >
            {L('సూచనలు తెప్పించండి', 'Get suggestions')}
          </Button>
        </div>
      </div>

      {headlines.isPending ? (
        <p role="status" className={cn(bodyCls, 'mt-4 text-muted')}>
          {L('హెడ్‌లైన్లు రాస్తోంది — సుమారు 20 సెకన్లు.', 'Writing headlines — about 20 seconds.')}
        </p>
      ) : h && !h.available ? (
        <p role="status" className={cn(bodyCls, 'mt-4 text-muted')}>
          {h.reason ?? L('హెడ్‌లైన్ ఐడియాలు ఇప్పుడు అందుబాటులో లేవు.', 'Headline ideas are not available right now.')}
        </p>
      ) : h ? (
        <div className="mt-4 space-y-3">
          <p className={cn(bodyCls, 'font-bold text-ink')}>{L('హెడ్‌లైన్ ఐడియాలు:', 'Headline ideas:')}</p>
          {h.options?.length ? (
            <ul className="space-y-2">
              {h.options.map((o, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-3">
                  {o.label_te ? (
                    <Chip as="span" size="sm" lang="te">
                      {o.label_te}
                    </Chip>
                  ) : null}
                  <span lang="te" className="te min-w-0 grow basis-48 text-te-body-xs text-ink">
                    {o.text}
                  </span>
                  <Button variant="link" size="sm" aria-label={`${t('ui.apply')}: ${o.text}`} onClick={() => onTitle(o.text)}>
                    {t('ui.apply')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={cn(bodyCls, 'text-muted')}>
              {L('ఈసారి సరైన హెడ్‌లైన్ ఏదీ రాలేదు — మళ్లీ ప్రయత్నించండి.', 'No headline passed the checks this time — try again.')}
            </p>
          )}
          {h.seo_title || h.seo_description ? (
            <div>
              <p lang="te" className="te rounded-xl bg-surface p-3 text-te-body-xs text-ink-soft">
                <b className="text-ink">{h.seo_title}</b>
                {h.seo_description ? <span className="mt-1 block">{h.seo_description}</span> : null}
              </p>
              <Button
                variant="link"
                size="sm"
                onClick={() => onSeo({ seo_title: h.seo_title ?? '', seo_description: h.seo_description ?? '' })}
              >
                {L('SEO వర్తింపజేయండి', 'Apply SEO')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {a ? (
        <div className="mt-4 space-y-4">
          {a.duplicates.length ? (
            <div className="rounded-xl border border-breaking-border bg-breaking-tint p-3">
              <p className={cn(bodyCls, 'flex items-center gap-2 font-bold text-breaking')}>
                <Icon icon={AlertCircle} size="sm" />
                {L('ఇలాంటి కథనాలు ఇప్పటికే ఉన్నాయి:', 'Similar stories already exist:')}
              </p>
              <ul className="mt-1 space-y-1">
                {a.duplicates.map((d) => (
                  <li key={d.short_id} lang="te" className="te text-te-body-xs text-ink">
                    {d.title_te} <span className="font-sans font-bold text-breaking">{d.similarity_percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={cn(bodyCls, 'flex items-center gap-2 text-success')}>
              <Icon icon={Check} size="sm" />
              {L('ఇటీవలి ఆర్కైవ్‌లో ఇలాంటి కథనం లేదు.', 'No similar story in the recent archive.')}
            </p>
          )}

          {/* Older servers omit style_issues; an empty list is a clean pass. */}
          {a.style_issues?.length ? (
            <div>
              <p className={cn(bodyCls, 'font-bold text-ink')}>{L('శైలి తనిఖీ:', 'Style check:')}</p>
              <ul className="mt-1 space-y-1">
                {a.style_issues.map((issue, i) => (
                  <li key={`${issue.code}-${i}`} className="flex items-start gap-2">
                    <Badge tone={issue.severity === 'block' ? 'breaking' : 'partial'} size="xs">
                      {issue.severity === 'block' ? L('సరిచేయాలి', 'Must fix') : L('చూడండి', 'Check')}
                    </Badge>
                    <span lang="en" className={cn('font-sans text-ui-sm', issue.severity === 'block' ? 'text-breaking' : 'text-partial')}>
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : a.style_issues ? (
            <p className={cn(bodyCls, 'flex items-center gap-2 text-success')}>
              <Icon icon={Check} size="sm" />
              {L('శైలి తనిఖీలో సమస్యలు లేవు.', 'No house-style issues.')}
            </p>
          ) : null}

          {a.suggested_category ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(bodyCls, 'text-ink')}>
                {L('విభాగ సూచన:', 'Suggested category:')}{' '}
                <b lang="te" className="te">
                  {a.suggested_category.name_te}
                </b>
              </span>
              <Button variant="link" size="sm" onClick={() => onCategorySlug(a.suggested_category!.slug)}>
                {t('ui.apply')}
              </Button>
            </div>
          ) : null}

          {a.suggested_tags.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(bodyCls, 'text-ink')}>{L('ట్యాగ్ సూచనలు:', 'Suggested tags:')}</span>
              {a.suggested_tags.map((tag) => (
                <Chip key={tag.slug} as="span" size="sm" lang="te">
                  {tag.name_te}
                </Chip>
              ))}
              <Button variant="link" size="sm" onClick={() => onTags(a.suggested_tags.map((tag) => tag.name_te))}>
                {L('అన్నీ జోడించండి', 'Add all')}
              </Button>
            </div>
          ) : null}

          {a.summary_te ? (
            <div>
              <p className={cn(bodyCls, 'font-bold text-ink')}>{L('సారాంశ సూచన:', 'Suggested standfirst:')}</p>
              <p lang="te" className="te mt-1 rounded-xl bg-surface p-3 text-te-body-xs text-ink-soft">
                {a.summary_te}
              </p>
              <Button variant="link" size="sm" onClick={() => onSummary(a.summary_te)}>
                {L('సారాంశంలో పెట్టండి', 'Use as standfirst')}
              </Button>
            </div>
          ) : null}

          {a.seo?.seo_title ? (
            <Button variant="secondary" size="sm" onClick={() => onSeo(a.seo)}>
              {L('SEO సూచనలు వర్తించండి', 'Apply SEO suggestions')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
