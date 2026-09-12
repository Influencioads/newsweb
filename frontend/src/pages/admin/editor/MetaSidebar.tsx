import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText, Globe, Image as ImageIcon, MapPin, Music, Pin, SlidersHorizontal, Sparkles, Volume2 } from 'lucide-react';

import { AudioAttachment } from '@/components/admin/AudioAttachment';
import { CategoryPicker } from '@/components/admin/CategoryPicker';
import { LocationSelector } from '@/components/admin/LocationSelector';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { PlacementPicker } from '@/components/admin/PlacementPicker';
import { TagInput } from '@/components/admin/TagInput';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { Field, Input, Switch } from '@/components/ui/Field';
import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { ErrorState, type QueryStateQuery } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { WORKFLOW_STATUS } from '@/features/cms/status';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { CmsActivePin, CmsArticle, CmsAudioRef, CmsEditorOptions } from '@/types/cms';
import { cn } from '@/utils/cn';
import { prefersReducedMotion } from '@/utils/motion';

import type { ArticleForm } from './form';

/**
 * Sticky meta sidebar of the article editor: in-page anchors, workflow status,
 * flags, schedule, category / location / tags, front-page placement, media and
 * audio. Placement and audio generation have their own write paths (a
 * published article cannot be PATCHed), so those mutations live here.
 */

type Anchor = 'story' | 'media' | 'meta' | 'seo';

const ANCHORS: Array<{ key: Anchor; icon: LucideIcon }> = [
  { key: 'story', icon: FileText },
  { key: 'media', icon: ImageIcon },
  { key: 'meta', icon: SlidersHorizontal },
  { key: 'seo', icon: Globe },
];

function jump(key: Anchor): void {
  document.getElementById(key)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

function GroupTitle({ icon, children }: { icon: LucideIcon; children: string }) {
  const s = useScript();
  return (
    <h3 className={cn(s.head, 'flex items-center gap-2 text-headline-xs font-bold text-ink')}>
      <Icon icon={icon} size="sm" className="text-brand" />
      {children}
    </h3>
  );
}

const GROUP = 'space-y-4 border-t border-rule pt-5 scroll-mt-20';

export interface MetaSidebarProps {
  form: ArticleForm;
  set: (patch: Partial<ArticleForm>) => void;
  /** Field-level message from the last failed save, by API field name. */
  errors: (key: string) => string | undefined;
  options: QueryStateQuery<CmsEditorOptions>;
  /** The saved article when editing; null on the new-article form. */
  article: CmsArticle | null;
  canPin: boolean;
}

export function MetaSidebar({ form, set, errors, options, article, canPin }: MetaSidebarProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const can = useAuth((st) => st.can);
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [current, setCurrent] = useState<Anchor>('story');
  const [activePins, setActivePins] = useState<CmsActivePin[]>(article?.active_pins ?? []);
  const [audio, setAudio] = useState<CmsAudioRef | null>(article?.audio ?? null);
  const id = article?.id ?? null;

  // Placement has its own write path: a published article cannot be PATCHed,
  // and repositioning it on the front page is exactly the decision an editor
  // revisits after publication.
  const placement = useMutation({
    mutationFn: () => cmsApi.setArticlePlacement(id!, { pin_home_minutes: form.pinHome, pin_trending_minutes: form.pinTrending }),
    onSuccess: (a) => {
      setActivePins(a.active_pins ?? []);
      toast.success(t('state.updated'));
    },
    onError: (e) => toast.error(e),
  });

  const generateAudio = useMutation({
    mutationFn: () => cmsApi.generateArticleAudio(id!, false),
    onSuccess: (r) => (r.available ? toast.success : toast.info)(r.available ? L('ఆడియో సిద్ధం', 'Audio ready') : L('ఆడియో తయారు కాలేదు', 'Audio was not generated')),
    onError: (e) => toast.error(e),
  });

  const anchorLabel: Record<Anchor, string> = {
    story: L('కథనం', 'Story'),
    media: t('admin.page.media'),
    meta: L('వివరాలు', 'Details'),
    seo: 'SEO',
  };

  return (
    <Card as="aside" aria-label={L('కథన వివరాలు', 'Story details')} className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
      <ChipRail ariaLabel={t('ui.sections')}>
        {ANCHORS.map((a) => (
          <Chip
            key={a.key}
            as="button"
            icon={a.icon}
            selected={current === a.key}
            onClick={() => {
              setCurrent(a.key);
              jump(a.key);
            }}
          >
            {anchorLabel[a.key]}
          </Chip>
        ))}
      </ChipRail>

      {options.isError ? (
        <ErrorState compact error={options.error} onRetry={() => void options.refetch()} className="mt-4" />
      ) : null}

      {/* ------------------------------------------------ status & flags -- */}
      <section id="meta" className="mt-5 scroll-mt-20 space-y-4">
        <GroupTitle icon={SlidersHorizontal}>{L('స్థితి & ప్రచురణ', 'Status & publishing')}</GroupTitle>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={article?.workflow_state ?? 'draft'} registry={WORKFLOW_STATUS} size="sm" />
          {article?.ai_generated ? (
            <Badge tone="ai" icon={Sparkles}>
              {t('ui.aiAssisted')}
            </Badge>
          ) : null}
          {article ? (
            <span className="font-mono text-meta text-muted">
              #{article.id} · {article.short_id}
            </span>
          ) : null}
        </div>
        <div className="divide-y divide-rule-soft">
          <Switch
            checked={form.isBreaking}
            onChange={(v) => set({ isBreaking: v })}
            disabled={!can('article.breaking')}
            label={L('బ్రేకింగ్ న్యూస్', 'Breaking news')}
            hint={can('article.breaking') ? L('టికర్‌లో కనిపిస్తుంది', 'Shows in the ticker') : L('సీనియర్ ఎడిటర్ మాత్రమే', 'Senior editors only')}
          />
          <Switch checked={form.isExclusive} onChange={(v) => set({ isExclusive: v })} label={L('ఎక్స్‌క్లూజివ్', 'Exclusive')} />
          <Switch
            checked={form.isFeatured}
            onChange={(v) => set({ isFeatured: v })}
            label={L('ఫీచర్డ్', 'Featured')}
            hint={L('ఎడిటర్ ఎంపిక రైలులో చూపుతుంది', 'Shows in the editor-selected rail')}
          />
        </div>
        <Field
          label={L('ప్రచురణ తేదీ & సమయం', 'Publish at')}
          hint={L('ఖాళీగా ఉంచితే వెంటనే ప్రచురిస్తుంది', 'Leave empty to publish immediately')}
          error={errors('scheduled_at')}
        >
          <Input type="datetime-local" script="en" value={form.scheduledAt} onChange={(e) => set({ scheduledAt: e.target.value })} />
        </Field>
      </section>

      {/* -------------------------------------------- category & location -- */}
      <section className={GROUP}>
        <GroupTitle icon={MapPin}>{L('విభాగం & ప్రాంతం', 'Category & location')}</GroupTitle>
        <CategoryPicker
          categories={options.data?.categories ?? []}
          categoryId={form.categoryId}
          subcategoryId={form.subcategoryId}
          onChange={(c, sub) => set({ categoryId: c, subcategoryId: sub })}
          error={errors('category_id')}
        />
        <LocationSelector
          value={form.location}
          onChange={(location) => set({ location })}
          states={options.data?.states ?? []}
          districts={options.data?.districts ?? []}
          mandalError={errors('mandal_id')}
        />
        <Field label={L('ట్యాగ్‌లు', 'Tags')} optionalLabel error={errors('tags')}>
          <TagInput value={form.tags} onChange={(tags) => set({ tags })} suggestions={options.data?.tags ?? []} />
        </Field>
      </section>

      {/* ---------------------------------------------------- placement -- */}
      <section className={GROUP}>
        <GroupTitle icon={Pin}>{L('మొదటి పేజీ స్థానం', 'Front-page placement')}</GroupTitle>
        <p className={cn(s.body, 'text-meta text-muted')}>
          {L('§8, §9 — ప్రచురణ అయ్యాక వీటిని దానంతట అదే వర్తింపజేస్తుంది', '§8, §9 — applied automatically once the story is live')}
        </p>
        <PlacementPicker
          homeMinutes={form.pinHome}
          trendingMinutes={form.pinTrending}
          activePins={activePins}
          onChange={(home, trending) => set({ pinHome: home, pinTrending: trending })}
          onApply={id != null ? () => placement.mutate() : undefined}
          applying={placement.isPending}
          applied={placement.isSuccess}
          disabled={!canPin}
        />
      </section>

      {/* -------------------------------------------------------- media -- */}
      <section id="media" className={GROUP}>
        <GroupTitle icon={ImageIcon}>{L('చిత్రాలు & వీడియో', 'Images & video')}</GroupTitle>
        <MediaPicker
          heroId={form.hero?.id ?? null}
          hero={form.hero}
          gallery={form.gallery}
          onHeroChange={(hero) => set({ hero })}
          onGalleryChange={(gallery) => set({ gallery })}
        />
        <Field label={L('YouTube వీడియో లింక్', 'YouTube video link')} optionalLabel error={errors('url')}>
          <Input
            script="en"
            value={form.videoUrl}
            onChange={(e) => set({ videoUrl: e.target.value })}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </Field>
      </section>

      {/* -------------------------------------------------------- audio -- */}
      <section className={GROUP}>
        <GroupTitle icon={Music}>{L('ఆడియో', 'Audio')}</GroupTitle>
        {/* Both halves of the §20 switch sit together: whether this story may
            be read aloud at all, and the button that does it. */}
        <Switch
          checked={form.voiceEnabled}
          onChange={(v) => set({ voiceEnabled: v })}
          label={L('వాయిస్ (వినండి)', 'Voice (listen)')}
          hint={L('సైట్ సెట్టింగ్‌లో వాయిస్ ఆన్ ఉంటేనే పనిచేస్తుంది', 'Works only when voice is on in site settings')}
        />
        <AudioAttachment
          articleId={id}
          shortId={article?.short_id ?? null}
          published={article?.status === 'published'}
          audio={audio}
          onChange={setAudio}
        />
        {id != null && form.voiceEnabled ? (
          <div className="space-y-2 border-t border-rule-soft pt-3">
            <Button variant="secondary" size="sm" icon={Volume2} pending={generateAudio.isPending} onClick={() => generateAudio.mutate()}>
              {L('ఇప్పుడే తయారు చేయండి', 'Generate now')}
            </Button>
            {generateAudio.data ? (
              <p className={cn(s.body, 'text-meta text-muted')}>
                {generateAudio.data.available
                  ? `${L('సిద్ధం', 'Ready')} · ${generateAudio.data.duration_sec}s · ${generateAudio.data.provider ?? ''}`
                  : L(
                      'తయారు కాలేదు — సెట్టింగ్‌లలో వాయిస్, ప్రొవైడర్, నెలవారీ పరిమితి చూడండి.',
                      'Not generated — check voice, provider and the monthly limit in settings.',
                    )}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </Card>
  );
}
