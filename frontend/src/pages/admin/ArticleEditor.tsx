import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { AudioAttachment } from '@/components/admin/AudioAttachment';
import { CategoryPicker } from '@/components/admin/CategoryPicker';
import { Field, Section, Toggle, inputClass } from '@/components/admin/FormControls';
import { LocationSelector, type LocationValue } from '@/components/admin/LocationSelector';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { PlacementPicker } from '@/components/admin/PlacementPicker';
import { TagInput } from '@/components/admin/TagInput';
import * as cmsApi from '@/features/cms/api';
import { useAuth } from '@/stores/auth';
import type { ApiError } from '@/api/client';
import type { CmsActivePin, CmsAudioRef, CmsMediaRef } from '@/types/cms';

/**
 * §1 — the full article form.
 *
 * The whole of §1's field list lives here: headline, sub-headline, standfirst,
 * body, image, gallery, video, category and subcategory, the §2 location
 * cascade, tags, byline, source, SEO, schedule, and the four flags. Previously
 * this form carried five of them.
 *
 * The body is still a plain textarea rather than a rich-text canvas: the API
 * stores Tiptap JSON and this converts to and from it, so swapping the control
 * later changes this file and nothing else.
 */

const bodyDoc = (text: string) => ({
  type: 'doc',
  content: text.split(/\n\s*\n/).filter(Boolean).map((p) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: p.trim() }],
  })),
});

const extract = (body: Record<string, unknown> | null) => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const x = node as { text?: string; content?: unknown[] };
    if (x.text) out.push(x.text);
    x.content?.forEach(walk);
  };
  walk(body);
  return out.join('\n\n');
};

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in *local* time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Assist = {
  engine: string;
  duplicates: Array<{ short_id: string; title_te: string; similarity_percent: number }>;
  suggested_tags: Array<{ slug: string; name_te: string; exists: boolean }>;
  suggested_category: { slug: string; name_te: string; name_en: string } | null;
  summary_te: string;
  seo: { seo_title: string; seo_description: string };
};

/** §18 assist — suggestions the editor applies or ignores; nothing is automatic. */
function AssistPanel({
  title, body, onSummary, onCategorySlug, onTags, onSeo,
}: {
  title: string; body: string;
  onSummary: (s: string) => void;
  onCategorySlug: (slug: string) => void;
  onTags: (names: string[]) => void;
  onSeo: (seo: { seo_title: string; seo_description: string }) => void;
}) {
  const assist = useMutation({
    mutationFn: () => cmsApi.aiAssist<Assist>({ title_te: title, body_plain: body }),
  });
  const a = assist.data;
  return (
    <section className="rounded-card border border-ai-border bg-ai-tint p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-sans text-[11px] font-bold uppercase tracking-wide text-ai-text">
          ◆ AI సహాయం · {a ? `engine: ${a.engine}` : 'సూచనలు మాత్రమే — నిర్ణయం మీదే'}
        </p>
        <button
          type="button"
          disabled={!title.trim() || !body.trim() || assist.isPending}
          onClick={() => assist.mutate()}
          className="min-h-[34px] rounded-control border border-ai px-3 font-sans text-[11.5px] font-bold text-ai disabled:opacity-50"
        >
          {assist.isPending ? '…' : 'సూచనలు తెప్పించండి'}
        </button>
      </div>
      {assist.isError ? <p className="mt-2 font-sans text-[11px] text-breaking">అనుమతి లేదా నెట్‌వర్క్ లోపం.</p> : null}
      {a ? (
        <div className="mt-3 space-y-3">
          {a.duplicates.length ? (
            <div className="rounded border border-breaking-border bg-breaking-tint p-2.5">
              <p className="te text-[12px] font-bold text-breaking">⚠ ఇలాంటి కథనాలు ఇప్పటికే ఉన్నాయి:</p>
              <ul className="mt-1 space-y-0.5">
                {a.duplicates.map((d) => (
                  <li key={d.short_id} className="te text-[12.5px] text-ink">
                    {d.title_te} <span className="font-sans font-bold text-breaking">{d.similarity_percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="te text-[12px] text-success">✓ ఇటీవలి ఆర్కైవ్‌లో ఇలాంటి కథనం లేదు.</p>
          )}
          {a.suggested_category ? (
            <p className="te text-[12.5px]">
              విభాగ సూచన: <b>{a.suggested_category.name_te}</b>
              <button type="button" onClick={() => onCategorySlug(a.suggested_category!.slug)}
                className="ml-1 rounded border border-ai px-2 py-0.5 font-sans text-[10.5px] font-bold text-ai">
                వర్తించండి
              </button>
            </p>
          ) : null}
          {a.suggested_tags.length ? (
            <p className="te text-[12.5px]">
              ట్యాగ్ సూచనలు:{' '}
              {a.suggested_tags.map((t) => (
                <span key={t.slug} className="mr-1 inline-block rounded-chip border border-ai-border bg-white px-2 py-0.5 text-[11.5px]">
                  {t.name_te}
                </span>
              ))}
              <button type="button" onClick={() => onTags(a.suggested_tags.map((t) => t.name_te))}
                className="ml-1 rounded border border-ai px-2 py-0.5 font-sans text-[10.5px] font-bold text-ai">
                అన్నీ జోడించండి
              </button>
            </p>
          ) : null}
          {a.summary_te ? (
            <div>
              <p className="te text-[12px] font-bold">సారాంశ సూచన:</p>
              <p className="te mt-0.5 rounded bg-white p-2 text-[12.5px] leading-telugu text-ink-soft">{a.summary_te}</p>
              <button type="button" onClick={() => onSummary(a.summary_te)}
                className="mt-1 rounded border border-ai px-2 py-0.5 font-sans text-[10.5px] font-bold text-ai">
                సారాంశంలో పెట్టండి
              </button>
            </div>
          ) : null}
          {a.seo?.seo_title ? (
            <button type="button" onClick={() => onSeo(a.seo)}
              className="rounded border border-ai px-2 py-0.5 font-sans text-[10.5px] font-bold text-ai">
              SEO సూచనలు వర్తించండి
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function ArticleEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const can = useAuth((s) => s.can);
  // Choosing what leads the home page is publish authority, not edit authority.
  const canPin = can('article.publish');

  const existing = useQuery({
    queryKey: ['cms', 'article', id],
    queryFn: () => cmsApi.fetchArticle(Number(id)),
    enabled: editing,
  });
  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions });

  // --- copy ---------------------------------------------------------------
  const [title, setTitle] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [subTitle, setSubTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');

  // --- placement ----------------------------------------------------------
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [location, setLocation] = useState<LocationValue>({ state: '', districtId: null, mandalId: null, localityId: null });

  // --- media --------------------------------------------------------------
  const [hero, setHero] = useState<CmsMediaRef | null>(null);
  const [gallery, setGallery] = useState<CmsMediaRef[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoId, setVideoId] = useState<number | null>(null);

  // --- taxonomy & byline --------------------------------------------------
  const [tags, setTags] = useState<string[]>([]);
  const [byline, setByline] = useState('');
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [sourceType, setSourceType] = useState('own');
  const [sourceCredit, setSourceCredit] = useState('');

  // --- flags --------------------------------------------------------------
  const [isBreaking, setIsBreaking] = useState(false);
  const [isExclusive, setIsExclusive] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  // --- placement & audio (§8, §9, §19) ------------------------------------
  const [pinHome, setPinHome] = useState<number | null>(null);
  const [pinTrending, setPinTrending] = useState<number | null>(null);
  const [activePins, setActivePins] = useState<CmsActivePin[]>([]);
  const [audio, setAudio] = useState<CmsAudioRef | null>(null);

  // --- SEO & schedule -----------------------------------------------------
  const [slug, setSlug] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  useEffect(() => {
    const a = existing.data;
    if (!a) return;
    setTitle(a.title_te);
    setTitleEn(a.title_en ?? '');
    setSubTitle(a.sub_title_te ?? '');
    setSummary(a.summary_te ?? '');
    setBody(extract(a.body));
    setCategoryId(a.category_id);
    setSubcategoryId(a.subcategory_id);
    setLocation({ state: '', districtId: a.district_id, mandalId: a.mandal_id, localityId: a.locality_id });
    setHero(a.hero_media);
    setGallery(a.gallery ?? []);
    setVideoId(a.video_id);
    setVideoUrl(a.video ? `https://www.youtube.com/watch?v=${a.video.youtube_id}` : '');
    setTags((a.tags ?? []).map((t) => t.name_te));
    setByline(a.byline_te ?? '');
    setAuthorId(a.author_id);
    setSourceType(a.source_type);
    setSourceCredit(a.source_credit ?? '');
    setIsBreaking(a.is_breaking);
    setIsExclusive(a.is_exclusive);
    setIsFeatured(a.is_featured);
    setVoiceEnabled(a.voice_enabled);
    setSlug(a.slug);
    setSeoTitle(a.seo_title ?? '');
    setSeoDescription(a.seo_description ?? '');
    setScheduledAt(toLocalInput(a.scheduled_at));
    setPinHome(a.pin_home_minutes);
    setPinTrending(a.pin_trending_minutes);
    setActivePins(a.active_pins ?? []);
    setAudio(a.audio);
  }, [existing.data]);

  // Placement has its own write path: a published article cannot be PATCHed,
  // and repositioning it on the front page is exactly the decision an editor
  // revisits after publication.
  const placement = useMutation({
    mutationFn: () => cmsApi.setArticlePlacement(Number(id), {
      pin_home_minutes: pinHome, pin_trending_minutes: pinTrending,
    }),
    onSuccess: (article) => setActivePins(article.active_pins ?? []),
  });

  const save = useMutation({
    mutationFn: (p: Record<string, unknown>) =>
      editing ? cmsApi.updateArticle(Number(id), p) : cmsApi.createArticle(p),
    onSuccess: () => nav('/admin/articles'),
  });

  const fieldErrors = (save.error as ApiError | undefined)?.details as Record<string, string> | undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({
      title_te: title,
      title_en: titleEn || null,
      sub_title_te: subTitle || null,
      summary_te: summary || null,
      body: bodyDoc(body),
      category_id: categoryId,
      subcategory_id: subcategoryId,
      district_id: location.districtId,
      mandal_id: location.mandalId,
      locality_id: location.localityId,
      hero_media_id: hero?.id ?? null,
      gallery_media_ids: gallery.map((g) => g.id),
      // A cleared box must clear the video, so send null rather than omitting.
      video_youtube_url: videoUrl.trim() || null,
      video_id: videoUrl.trim() ? videoId : null,
      tags,
      byline_te: byline || null,
      author_id: authorId,
      source_type: sourceType,
      source_credit: sourceCredit || null,
      is_breaking: isBreaking,
      is_exclusive: isExclusive,
      is_featured: isFeatured,
      voice_enabled: voiceEnabled,
      slug: slug || null,
      seo_title: seoTitle || null,
      seo_description: seoDescription || null,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      pin_home_minutes: canPin ? pinHome : undefined,
      pin_trending_minutes: canPin ? pinTrending : undefined,
    });
  }

  const categories = options.data?.categories ?? [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="th mb-5 text-[24px] font-extrabold text-ink">
        {editing ? 'కథనం సవరించండి' : 'కొత్త కథనం'}
      </h1>

      <form onSubmit={submit} className="space-y-5">
        <Section title="కథనం · The story">
          <Field label="శీర్షిక · Headline" required error={fieldErrors?.title_te}>
            <input required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)}
              className={`th ${inputClass} text-[19px]`} />
          </Field>
          <Field label="ఆంగ్ల శీర్షిక · English headline" hint="శోధనకు ఉపయోగపడుతుంది">
            <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className={inputClass} />
          </Field>
          <Field label="ఉప శీర్షిక · Sub-headline">
            <input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} className={`te ${inputClass}`} />
          </Field>
          <Field label="సారాంశం · Standfirst" hint="సుమారు 40 పదాలు">
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)}
              className={`te ${inputClass} min-h-24 leading-telugu`} />
          </Field>
          <Field label="కథనం · Body" required>
            <textarea required value={body} onChange={(e) => setBody(e.target.value)}
              className={`te ${inputClass} min-h-[320px] text-[17px] leading-telugu`} />
          </Field>
        </Section>

        <AssistPanel
          title={title} body={body}
          onSummary={setSummary}
          onCategorySlug={(s) => { const m = categories.find((c) => c.slug === s); if (m) { setCategoryId(m.id); setSubcategoryId(null); } }}
          onTags={(names) => setTags(Array.from(new Set([...tags, ...names])))}
          onSeo={(seo) => { setSeoTitle(seo.seo_title); setSeoDescription(seo.seo_description); }}
        />

        <Section title="చిత్రాలు & వీడియో · Media">
          <MediaPicker
            heroId={hero?.id ?? null} hero={hero} gallery={gallery}
            onHeroChange={setHero} onGalleryChange={setGallery}
          />
          <Field label="YouTube వీడియో లింక్" hint="ఐచ్ఛికం" error={fieldErrors?.url}>
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…" className={inputClass} />
          </Field>
        </Section>

        <Section title="విభాగం & ప్రాంతం · Category and location" subtitle="§2 — రాష్ట్రం నుంచి ఊరు వరకు">
          <CategoryPicker
            categories={categories} categoryId={categoryId} subcategoryId={subcategoryId}
            onChange={(c, s) => { setCategoryId(c); setSubcategoryId(s); }}
          />
          <LocationSelector
            value={location} onChange={setLocation}
            states={options.data?.states ?? []} districts={options.data?.districts ?? []}
          />
          {fieldErrors?.mandal_id ? <p className="te text-[12px] text-breaking">{fieldErrors.mandal_id}</p> : null}
          <Field label="ట్యాగ్‌లు · Tags">
            <TagInput value={tags} onChange={setTags} suggestions={options.data?.tags ?? []} />
          </Field>
        </Section>

        <Section title="రచయిత & మూలం · Byline and source">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="బైలైన్ · Byline">
              <input value={byline} onChange={(e) => setByline(e.target.value)}
                placeholder="మా ప్రతినిధి" className={`te ${inputClass}`} />
            </Field>
            <Field label="రచయిత · Author" hint={can('article.approve') ? undefined : 'మార్చడానికి అనుమతి లేదు'}>
              <select value={authorId ?? ''} disabled={!can('article.approve')}
                onChange={(e) => setAuthorId(e.target.value ? Number(e.target.value) : null)}
                className={inputClass}>
                <option value="">నేను</option>
                {(options.data?.authors ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name_te} — {a.name_en}</option>
                ))}
              </select>
            </Field>
            <Field label="మూలం రకం · Source">
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className={inputClass}>
                <option value="own">సొంతం · Own</option>
                <option value="agency">ఏజెన్సీ · Agency</option>
                <option value="contributed">పాఠకుల రచన · Contributed</option>
                <option value="syndicated">సిండికేట్ · Syndicated</option>
              </select>
            </Field>
            <Field
              label="మూలం క్రెడిట్ · Source credit"
              required={sourceType !== 'own'}
              hint={sourceType !== 'own' ? 'ప్రచురణకు తప్పనిసరి' : undefined}
            >
              <input value={sourceCredit} onChange={(e) => setSourceCredit(e.target.value)}
                placeholder="PTI / IANS / ANI" className={inputClass} />
            </Field>
          </div>
        </Section>

        <Section title="ప్రచురణ · Publishing">
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              checked={isBreaking} onChange={setIsBreaking}
              disabled={!can('article.breaking')}
              label="బ్రేకింగ్ న్యూస్"
              hint={can('article.breaking') ? 'టికర్‌లో కనిపిస్తుంది' : 'సీనియర్ ఎడిటర్ మాత్రమే'}
            />
            <Toggle checked={isExclusive} onChange={setIsExclusive} label="ఎక్స్‌క్లూజివ్" />
            <Toggle checked={isFeatured} onChange={setIsFeatured}
              label="ఫీచర్డ్" hint="ఎడిటర్ ఎంపిక రైలులో చూపుతుంది" />
            <Toggle checked={voiceEnabled} onChange={setVoiceEnabled}
              label="వాయిస్ (వినండి)" hint="సైట్ సెట్టింగ్‌లో వాయిస్ ఆన్ ఉంటేనే పనిచేస్తుంది" />
          </div>
          <Field label="ప్రచురణ తేదీ & సమయం · Publish at" hint="ఖాళీగా ఉంచితే వెంటనే ప్రచురిస్తుంది">
            <input type="datetime-local" value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)} className={inputClass} />
          </Field>
        </Section>

        <Section
          title="స్థానం · Front-page placement"
          subtitle="§8, §9 — ప్రచురణ అయ్యాక వీటిని దానంతట అదే వర్తింపజేస్తుంది"
        >
          <PlacementPicker
            homeMinutes={pinHome}
            trendingMinutes={pinTrending}
            activePins={activePins}
            onChange={(home, trending) => { setPinHome(home); setPinTrending(trending); }}
            onApply={editing ? () => placement.mutate() : undefined}
            applying={placement.isPending}
            applied={placement.isSuccess}
            disabled={!canPin}
          />
        </Section>

        <Section
          title="ఆడియో · Audio"
          subtitle="§19 — సొంత రికార్డింగ్ జోడించండి, లేదా వదిలేస్తే వాయిస్ దానంతట చదువుతుంది"
        >
          <AudioAttachment
            articleId={editing ? Number(id) : null}
            audio={audio}
            onChange={setAudio}
          />
        </Section>

        <Section title="SEO">
          <Field label="URL స్లగ్" hint="ఆంగ్ల అక్షరాలు, హైఫన్లు మాత్రమే" error={fieldErrors?.slug}>
            <input value={slug} onChange={(e) => setSlug(e.target.value)}
              pattern="[a-z0-9][a-z0-9-]*" className={`font-sans ${inputClass}`} />
          </Field>
          <Field label="SEO శీర్షిక">
            <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} className={inputClass} />
          </Field>
          <Field label="SEO వివరణ">
            <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)}
              className={`${inputClass} min-h-16`} />
          </Field>
        </Section>

        {save.isError ? (
          <p className="te rounded-control border border-breaking-border bg-breaking-tint p-3 text-[13px] text-breaking">
            {(save.error as ApiError)?.messageTe ?? 'సేవ్ కాలేదు. వివరాలను తనిఖీ చేయండి.'}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-rule bg-canvas/95 px-4 py-3 backdrop-blur">
          <button disabled={save.isPending}
            className="te min-h-tap rounded-control bg-brand px-6 font-bold text-white disabled:opacity-60">
            {save.isPending ? 'సేవ్ అవుతోంది…' : 'డ్రాఫ్ట్ సేవ్ చేయండి'}
          </button>
          <button type="button" onClick={() => nav('/admin/articles')}
            className="te min-h-tap rounded-control border border-rule px-4 font-semibold text-ink">
            రద్దు
          </button>
        </div>
      </form>
    </main>
  );
}
