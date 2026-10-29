import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ExternalLink, FileText, Pencil, Plus, RotateCcw, Save } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import { PAGES } from '@/pages/public/policyContent';
import { useAuth } from '@/stores/auth';
import type { SitePage, SitePageLanguage } from '@/types/public';
import { formatDate } from '@/utils/time';

import { moveItem, RowActions, slugify, uniqueSlug } from './siteContentShared';
import { useL } from './useL';

/**
 * CMS → Footer pages: About, Contact and the policies. Each page starts from
 * the copy the site shipped with (pages/public/policyContent); saving stores
 * it in the backend and the site shows the saved version. "Reset" deletes the
 * saved version and the original copy comes back.
 *
 * A section is a heading and its paragraphs; in the box a blank line starts a
 * new paragraph.
 */

type Lang = 'te' | 'en';

/** The editable shape: paragraphs as one block of text. */
interface DraftSection {
  id: string;
  heading: string;
  text: string;
}
interface DraftLanguage {
  title: string;
  sections: DraftSection[];
}
type Draft = Record<Lang, DraftLanguage>;

const toDraft = (page: SitePageLanguage): DraftLanguage => ({
  title: page.title,
  sections: page.sections.map((sec) => ({ id: sec.id, heading: sec.heading, text: sec.body.join('\n\n') })),
});

const fromDraft = (draft: DraftLanguage): SitePageLanguage => {
  const taken = new Set<string>();
  return {
    title: draft.title.trim(),
    sections: draft.sections
      .filter((sec) => sec.heading.trim() || sec.text.trim())
      .map((sec, i) => ({
        // Keep an existing anchor (links may point at it); a new section takes one from its heading.
        id: uniqueSlug(sec.id || slugify(sec.heading), taken, `section-${i + 1}`),
        heading: sec.heading.trim(),
        body: sec.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
      })),
  };
};

/** The page as the site shows it now: saved, else the original copy. */
function current(slug: string, saved: SitePage | undefined): Draft {
  const entry = PAGES[slug];
  return {
    te: toDraft(saved?.te ?? entry?.te ?? { title: slug, sections: [] }),
    en: toDraft(saved?.en ?? entry?.en ?? { title: slug, sections: [] }),
  };
}

function PageEditor({
  slug,
  saved,
  canManage,
  onClose,
}: {
  slug: string;
  saved: SitePage | undefined;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [lang, setLang] = useState<Lang>('te');
  const [draft, setDraft] = useState<Draft>(() => current(slug, saved));
  const page = draft[lang];
  const setPage = (next: DraftLanguage) => setDraft({ ...draft, [lang]: next });
  const setSection = (i: number, change: Partial<DraftSection>) =>
    setPage({ ...page, sections: page.sections.map((sec, j) => (j === i ? { ...sec, ...change } : sec)) });

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['cms', 'site-pages'] });
    void queryClient.invalidateQueries({ queryKey: ['public', 'page', slug] });
  };
  const save = useMutation({
    mutationFn: () => cmsApi.saveSitePage(slug, { te: fromDraft(draft.te), en: fromDraft(draft.en) }),
    onSuccess: () => {
      done();
      toast.success(t('state.saved'));
      onClose();
    },
    onError: (err) => toast.error(err),
  });
  const reset = useMutation({
    mutationFn: () => cmsApi.resetSitePage(slug),
    onSuccess: () => {
      done();
      toast.success(t('state.updated'));
      onClose();
    },
    onError: (err) => toast.error(err),
  });

  return (
    <Card as="section" padding="lg" className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={ChevronLeft} variant="ghost" size="sm" onClick={onClose}>
          {L('అన్ని పేజీలు', 'All pages')}
        </Button>
        <ButtonLink to={`/${slug}`} external variant="ghost" size="sm" iconRight={ExternalLink}>
          {L('సైట్‌లో చూడండి', 'View on the site')} /{slug}
        </ButtonLink>
      </div>

      <Tabs
        ariaLabel={L('భాష', 'Language')}
        value={lang}
        onChange={(k) => setLang(k as Lang)}
        items={[
          { key: 'te', label: 'తెలుగు', lang: 'te' },
          { key: 'en', label: 'English', lang: 'en' },
        ]}
      />

      <Field label={L('పేజీ శీర్షిక', 'Page title')} required>
        <Input script={lang} value={page.title} disabled={!canManage} onChange={(e) => setPage({ ...page, title: e.target.value })} />
      </Field>

      <ol className="space-y-3">
        {page.sections.map((sec, i) => (
          <li key={`${lang}-${i}`}>
            <Card tone="paper" padding="md" className="space-y-3">
              <div className="flex items-end gap-3">
                <Field label={`${i + 1}. ${L('ఉపశీర్షిక', 'Heading')}`} className="min-w-0 flex-1">
                  <Input script={lang} value={sec.heading} disabled={!canManage} onChange={(e) => setSection(i, { heading: e.target.value })} />
                </Field>
                {canManage ? (
                  <RowActions
                    index={i}
                    count={page.sections.length}
                    minCount={0}
                    onMove={(d) => setPage({ ...page, sections: moveItem(page.sections, i, d) })}
                    onRemove={() => setPage({ ...page, sections: page.sections.filter((_, j) => j !== i) })}
                  />
                ) : null}
              </div>
              <Field label={L('పాఠ్యం', 'Text')} hint={L('ఖాళీ లైన్ కొత్త పేరా మొదలుపెడుతుంది', 'A blank line starts a new paragraph')}>
                <Textarea script={lang} rows={5} value={sec.text} disabled={!canManage} onChange={(e) => setSection(i, { text: e.target.value })} />
              </Field>
            </Card>
          </li>
        ))}
      </ol>

      {canManage ? (
        <>
          <Button
            icon={Plus}
            variant="secondary"
            size="sm"
            disabled={page.sections.length >= 40}
            onClick={() => setPage({ ...page, sections: [...page.sections, { id: '', heading: '', text: '' }] })}
          >
            {L('విభాగం జోడించండి', 'Add a section')}
          </Button>
          <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
            <Button
              icon={Save}
              pending={save.isPending}
              disabled={!draft.te.title.trim() || !draft.en.title.trim()}
              onClick={() => save.mutate()}
            >
              {L('రెండు భాషలూ సేవ్ చేయండి', 'Save both languages')}
            </Button>
            {saved ? (
              <Button
                icon={RotateCcw}
                variant="ghost"
                pending={reset.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: L('అసలు పాఠ్యానికి మార్చాలా?', 'Go back to the original text?'),
                    body: L('సేవ్ చేసిన మార్పులు తొలగిపోతాయి.', 'The saved version is removed and the original text comes back.'),
                    confirmLabel: L('అవును, మార్చండి', 'Yes, reset'),
                    tone: 'danger',
                  });
                  if (ok) reset.mutate();
                }}
              >
                {L('అసలు పాఠ్యానికి మార్చండి', 'Reset to original')}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {dialog}
    </Card>
  );
}

export function SitePagesPage() {
  const L = useL();
  const { pick } = useI18n();
  const canManage = useAuth((st) => st.can)('settings.manage');
  const [editing, setEditing] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['cms', 'site-pages'], queryFn: cmsApi.fetchSitePages });

  return (
    <AdminPage
      title={L('ఫుటర్ పేజీలు', 'Footer pages')}
      subtitle={L(
        'మా గురించి, సంప్రదించండి, పాలసీలు. మార్చి సేవ్ చేస్తే సైట్‌లో వెంటనే కనిపిస్తుంది.',
        'About, Contact and the policies. Edit and save; the site shows the new text within a minute.',
      )}
    >
      <QueryState query={q}>
        {(data) =>
          editing ? (
            <PageEditor key={editing} slug={editing} saved={data.pages[editing]} canManage={canManage} onClose={() => setEditing(null)} />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {data.slugs.map((slug) => {
                const saved = data.pages[slug];
                const entry = PAGES[slug];
                const title = pick(saved?.te.title ?? entry?.te.title, saved?.en.title ?? entry?.en.title) || slug;
                return (
                  <li key={slug}>
                    <Card padding="md" className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand">
                        <Icon icon={FileText} size="md" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="te te-clamp-1 font-bold text-ink">{title}</p>
                        <p className="font-sans text-meta text-muted">
                          /{slug} ·{' '}
                          {saved?.updated_at ? (
                            <Badge tone="success" size="xs">
                              {L('మార్చారు', 'Edited')} {formatDate(saved.updated_at, 'en')}
                            </Badge>
                          ) : (
                            <Badge tone="muted" size="xs">
                              {L('అసలు పాఠ్యం', 'Original')}
                            </Badge>
                          )}
                        </p>
                      </div>
                      <Button icon={Pencil} variant="secondary" size="sm" onClick={() => setEditing(slug)}>
                        {canManage ? L('మార్చండి', 'Edit') : L('చూడండి', 'View')}
                      </Button>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )
        }
      </QueryState>
    </AdminPage>
  );
}
