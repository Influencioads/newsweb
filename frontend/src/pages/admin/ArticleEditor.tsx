import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, X } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AdminPage } from '@/components/admin/AdminPage';
import { Section } from '@/components/admin/FormControls';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ErrorState, QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';

import { AssistPanel } from './editor/AssistPanel';
import { MetaSidebar } from './editor/MetaSidebar';
import { EMPTY_FORM, fieldError, fromArticle, toPayload, wordCount, type ArticleForm } from './editor/form';
import { useL } from './useL';

/**
 * §1 — the full article form.
 *
 * Story column: headline, standfirst, body, byline & source, SEO. Sticky
 * sidebar (./editor/MetaSidebar): status, flags, schedule, category, location,
 * tags, placement, media, audio. The form model and API mapping live in
 * ./editor/form.ts; the body is still a plain textarea over Tiptap JSON.
 */

function EditorSkeleton() {
  return (
    <div aria-hidden className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <Skeleton variant="headline" />
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="image" ratio="16/9" />
      </div>
      <Skeleton variant="image" ratio="3/4" />
    </div>
  );
}

export default function ArticleEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const can = useAuth((st) => st.can);
  // Choosing what leads the home page is publish authority, not edit authority.
  const canPin = can('article.publish');

  const existing = useQuery({
    queryKey: ['cms', 'article', id],
    queryFn: () => cmsApi.fetchArticle(Number(id)),
    enabled: editing,
  });
  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions });

  const [form, setForm] = useState<ArticleForm>(EMPTY_FORM);
  const [baseline, setBaseline] = useState<ArticleForm>(EMPTY_FORM);
  const set = (patch: Partial<ArticleForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    const next = existing.data ? fromArticle(existing.data) : EMPTY_FORM;
    setForm(next);
    setBaseline(next);
  }, [existing.data]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (p: Record<string, unknown>) => (editing ? cmsApi.updateArticle(Number(id), p) : cmsApi.createArticle(p)),
    onSuccess: () => {
      toast.success(t('state.saved'));
      nav('/admin/articles');
    },
    onError: (e) => toast.error(e),
  });
  const details = save.error instanceof ApiError ? save.error.details : undefined;
  const errors = (key: string) => fieldError(details, key);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(toPayload(form, canPin));
  }

  async function cancel() {
    if (!dirty || (await confirm({ title: t('state.unsavedChanges'), confirmLabel: t('ui.back'), tone: 'danger' }))) {
      nav('/admin/articles');
    }
  }

  const title = editing ? t('admin.page.editArticle') : t('admin.page.newArticle');
  const categories = options.data?.categories ?? [];
  const words = wordCount(form.body);

  const editor = (
    <form onSubmit={submit} className="space-y-7 md:space-y-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-7 md:space-y-10">
          <div id="story" className="scroll-mt-20">
            <Section title={L('కథనం', 'The story')}>
              <Field label={L('శీర్షిక', 'Headline')} required error={errors('title_te')}>
                <Input script="te" size="lg" required minLength={3} value={form.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label={L('ఆంగ్ల శీర్షిక', 'English headline')} hint={L('శోధనకు ఉపయోగపడుతుంది', 'Helps search')} optionalLabel error={errors('title_en')}>
                <Input script="en" value={form.titleEn} onChange={(e) => set({ titleEn: e.target.value })} />
              </Field>
              <Field label={L('ఉప శీర్షిక', 'Sub-headline')} optionalLabel error={errors('sub_title_te')}>
                <Input script="te" value={form.subTitle} onChange={(e) => set({ subTitle: e.target.value })} />
              </Field>
              <Field label={L('సారాంశం', 'Standfirst')} hint={L('సుమారు 40 పదాలు', 'About 40 words')} error={errors('summary_te')}>
                <Textarea script="te" autoGrow rows={3} value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
              </Field>
              <Field label={L('కథనం', 'Body')} required error={errors('body')}>
                <Textarea script="te" required rows={16} value={form.body} onChange={(e) => set({ body: e.target.value })} />
              </Field>
              <p className="font-sans text-meta tabular-nums text-muted">
                {words} {t('admin.wordCount')}
              </p>
            </Section>
          </div>

          <AssistPanel
            title={form.title}
            body={form.body}
            onSummary={(summary) => set({ summary })}
            onCategorySlug={(slug) => {
              const m = categories.find((c) => c.slug === slug);
              if (m) set({ categoryId: m.id, subcategoryId: null });
            }}
            onTags={(names) => set({ tags: Array.from(new Set([...form.tags, ...names])) })}
            onSeo={(seo) => set({ seoTitle: seo.seo_title, seoDescription: seo.seo_description })}
          />

          <Section title={L('రచయిత & మూలం', 'Byline and source')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={L('బైలైన్', 'Byline')} optionalLabel error={errors('byline_te')}>
                <Input script="te" value={form.byline} onChange={(e) => set({ byline: e.target.value })} placeholder={L('మా ప్రతినిధి', 'Our correspondent')} />
              </Field>
              <Field label={L('రచయిత', 'Author')} hint={can('article.approve') ? undefined : L('మార్చడానికి అనుమతి లేదు', 'No permission to change')} error={errors('author_id')}>
                <Select
                  value={form.authorId ?? ''}
                  disabled={!can('article.approve')}
                  onChange={(e) => set({ authorId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">{L('నేను', 'Me')}</option>
                  {(options.data?.authors ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name_te} — {a.name_en}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={L('మూలం రకం', 'Source')} error={errors('source_type')}>
                <Select value={form.sourceType} onChange={(e) => set({ sourceType: e.target.value })}>
                  <option value="own">సొంతం · Own</option>
                  <option value="agency">ఏజెన్సీ · Agency</option>
                  <option value="contributed">పాఠకుల రచన · Contributed</option>
                  <option value="syndicated">సిండికేట్ · Syndicated</option>
                </Select>
              </Field>
              <Field
                label={L('మూలం క్రెడిట్', 'Source credit')}
                required={form.sourceType !== 'own'}
                hint={form.sourceType !== 'own' ? L('ప్రచురణకు తప్పనిసరి', 'Required to publish') : undefined}
                error={errors('source_credit')}
              >
                <Input script="en" value={form.sourceCredit} onChange={(e) => set({ sourceCredit: e.target.value })} placeholder="PTI / IANS / ANI" />
              </Field>
            </div>
          </Section>

          <div id="seo" className="scroll-mt-20">
            <Section title="SEO">
              <Field label={L('URL స్లగ్', 'URL slug')} hint={L('ఆంగ్ల అక్షరాలు, హైఫన్లు మాత్రమే', 'Lowercase letters, digits and hyphens only')} error={errors('slug')}>
                <Input script="en" value={form.slug} onChange={(e) => set({ slug: e.target.value })} pattern="[a-z0-9][a-z0-9-]*" />
              </Field>
              <Field label={L('SEO శీర్షిక', 'SEO title')} optionalLabel error={errors('seo_title')}>
                <Input value={form.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
              </Field>
              <Field label={L('SEO వివరణ', 'SEO description')} optionalLabel error={errors('seo_description')}>
                <Textarea autoGrow rows={2} value={form.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
              </Field>
            </Section>
          </div>
        </div>

        <MetaSidebar form={form} set={set} errors={errors} options={options} article={existing.data ?? null} canPin={canPin} />
      </div>

      {save.isError ? <ErrorState compact error={save.error} /> : null}

      <div className="glass sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-rule px-4 py-3 md:-mx-6 md:px-6">
        <Button type="submit" icon={Save} pending={save.isPending}>
          {save.isPending ? t('ui.saving') : L('డ్రాఫ్ట్ సేవ్ చేయండి', 'Save draft')}
        </Button>
        <Button variant="secondary" icon={X} onClick={() => void cancel()} disabled={save.isPending}>
          {t('ui.cancel')}
        </Button>
        {dirty ? <Badge tone="partial">{t('admin.unsaved')}</Badge> : null}
        <span className="ml-auto font-sans text-meta tabular-nums text-muted">
          {words} {t('admin.wordCount')}
        </span>
      </div>
    </form>
  );

  return (
    <AdminPage title={title} width="site">
      {editing ? (
        <QueryState query={existing} skeleton={<EditorSkeleton />}>
          {() => editor}
        </QueryState>
      ) : (
        editor
      )}
      {dialog}
    </AdminPage>
  );
}
