import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Check, Sparkles } from 'lucide-react';

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
 * The API returns Telugu content (duplicates, tags, summary), so those lines
 * carry `lang="te"` regardless of the interface language.
 */

type Assist = {
  engine: string;
  duplicates: Array<{ short_id: string; title_te: string; similarity_percent: number }>;
  suggested_tags: Array<{ slug: string; name_te: string; exists: boolean }>;
  suggested_category: { slug: string; name_te: string; name_en: string } | null;
  summary_te: string;
  seo: { seo_title: string; seo_description: string };
};

export interface AssistPanelProps {
  title: string;
  body: string;
  onSummary: (s: string) => void;
  onCategorySlug: (slug: string) => void;
  onTags: (names: string[]) => void;
  onSeo: (seo: { seo_title: string; seo_description: string }) => void;
}

export function AssistPanel({ title, body, onSummary, onCategorySlug, onTags, onSeo }: AssistPanelProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');

  const assist = useMutation({
    mutationFn: () => cmsApi.aiAssist<Assist>({ title_te: title, body_plain: body }),
    onError: (e) => toast.error(e),
  });
  const a = assist.data;

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
