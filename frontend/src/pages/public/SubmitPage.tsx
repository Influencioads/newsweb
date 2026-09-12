import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Inbox, PenLine, ShieldCheck, Trash2 } from 'lucide-react';

import { StatusPill } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { LocationPicker } from '@/components/location/LocationPicker';
import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import { WORKFLOW_STATUS, type StatusRegistry } from '@/features/cms/status';
import * as creatorApi from '@/features/creator/api';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';
import { relativeTime } from '@/utils/time';

/**
 * Creator submissions (updated doc §17): write → accept guidelines → submit
 * for moderation. The status list below the form is the creator's window into
 * the §17 moderation history — pending, approved (with a link once the
 * newsroom publishes), or rejected with the moderator's note.
 */

const MIN_TITLE = 10;
const MAX_TITLE = 200;
const MIN_BODY = 100;
const MAX_BODY = 20000;

/** A reader submission waiting on a moderator reads as "in review", not "pending". */
const SUBMISSION_STATUS: StatusRegistry = {
  pending: WORKFLOW_STATUS.in_review,
  approved: WORKFLOW_STATUS.approved,
  rejected: WORKFLOW_STATUS.rejected,
};

export default function SubmitPage() {
  const { language, pick, t } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');
  useDocumentTitle(t('page.submit'));

  const navigate = useNavigate();
  const status = useAuth((auth) => auth.status);
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [stateCode, setStateCode] = useState<string | null>(null);
  const [districtSlug, setDistrictSlug] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') navigate('/login', { replace: true, state: { from: '/submit' } });
  }, [status, navigate]);

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });
  const mine = useQuery({
    queryKey: ['reader', 'submissions'],
    queryFn: creatorApi.fetchMySubmissions,
    enabled: status === 'authenticated',
  });

  const submit = useMutation({
    mutationFn: () =>
      creatorApi.submitArticle({
        title_te: title.trim(),
        body_te: body.trim(),
        category_slug: categorySlug || null,
        district_slug: districtSlug || null,
        accept_guidelines: accepted,
      }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setAccepted(false);
      setTried(false);
      toast.success(L('అందింది! సమీక్ష తర్వాత తెలియజేస్తాం.', 'Received. We will update you after review.'));
      void queryClient.invalidateQueries({ queryKey: ['reader', 'submissions'] });
    },
    onError: (e) => toast.error(e),
  });

  if (status !== 'authenticated') return null;

  // Validity is independent of `tried`; `tried` only decides whether the reader
  // is shown the message yet (nobody wants a red form before they have typed).
  const shortTitle = title.trim().length < MIN_TITLE;
  const shortBody = body.trim().length < MIN_BODY;
  const canSubmit = !shortTitle && !shortBody && accepted;
  const titleError =
    tried && shortTitle
      ? L(`శీర్షిక కనీసం ${MIN_TITLE} అక్షరాలు ఉండాలి.`, `The headline needs at least ${MIN_TITLE} characters.`)
      : null;
  const bodyError =
    tried && shortBody
      ? L(`కథనం కనీసం ${MIN_BODY} అక్షరాలు ఉండాలి.`, `The story needs at least ${MIN_BODY} characters.`)
      : null;
  const acceptError =
    tried && !accepted ? L('మార్గదర్శకాలను అంగీకరించాలి.', 'Please accept the guidelines.') : null;

  /** Typing again puts the form back in edit mode and retires the success card. */
  const edit = () => {
    if (submit.isSuccess) submit.reset();
  };

  const clearDraft = async () => {
    const ok = await confirm({
      title: L('డ్రాఫ్ట్ తొలగించాలా?', 'Clear this draft?'),
      body: L('మీరు రాసినది పోతుంది. తిరిగి తేలేము.', 'What you have written will be lost. This cannot be undone.'),
      confirmLabel: L('తొలగించండి', 'Clear it'),
      tone: 'danger',
    });
    if (!ok) return;
    setTitle('');
    setBody('');
    setCategorySlug('');
    setDistrictSlug('');
    setAccepted(false);
    setTried(false);
    submit.reset();
  };

  const categories = (config.data?.categories ?? []).filter((c) => c.show_in_nav);

  return (
    <PageContainer width="form" className="space-y-7 py-7 md:space-y-10 md:py-10">
      <PageHeader
        icon={PenLine}
        eyebrow={L('పాఠక రచయిత', 'Reader contributor')}
        title={L('మీ కథనం పంపండి', 'Submit your story')}
        subtitle={L(
          'మీ ప్రాంత విశేషాలు, విజయగాథలు రాయండి. మోడరేషన్, సంపాదకీయ సమీక్ష తర్వాత మీ పేరుతో ప్రచురిస్తాం.',
          'Write what is happening around you. After moderation and editorial review it publishes with your name.',
        )}
        spacing="none"
      />

      {submit.isSuccess ? (
        <Card tone="paper" padding="lg" className="border-success">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-success-tint text-success">
              <Icon icon={CheckCircle2} size="md" />
            </span>
            <div className="min-w-0">
              <h2 className={cn(s.head, 'text-headline-xs font-bold text-ink')}>
                {L('మీ కథనం అందింది', 'Your story reached us')}
              </h2>
              <p className={cn(bodyCls, 'mt-1 text-muted')}>
                {L(
                  'మోడరేటర్ సమీక్ష తర్వాత తెలియజేస్తాం. స్థితిని కింద చూడవచ్చు.',
                  'A moderator reads it next and you will hear from us. Track it in the list below.',
                )}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card as="section" padding="lg">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (canSubmit && !submit.isPending) submit.mutate();
          }}
        >
          <Field
            label={L('శీర్షిక', 'Headline')}
            required
            error={titleError}
            hint={`${title.length}/${MAX_TITLE}`}
          >
            <Input
              script="te"
              value={title}
              maxLength={MAX_TITLE}
              onChange={(e) => {
                setTitle(e.target.value);
                edit();
              }}
              placeholder={L('ఉదా: మా ఊరి యువత కట్టిన గ్రంథాలయం', 'e.g. The library our village youth built')}
            />
          </Field>

          <Field
            label={L(`కథనం (కనీసం ${MIN_BODY} అక్షరాలు)`, `Story (at least ${MIN_BODY} characters)`)}
            required
            error={bodyError}
          >
            <Textarea
              script="te"
              value={body}
              rows={10}
              counter={MAX_BODY}
              onChange={(e) => {
                setBody(e.target.value);
                edit();
              }}
              placeholder={L(
                'పూర్తి వివరాలతో రాయండి. పేరాల మధ్య ఖాళీ లైన్ వదలండి…',
                'Write in full. Leave a blank line between paragraphs…',
              )}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={L('విభాగం', 'Section')} optionalLabel>
              <Select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)}>
                <option value="">{L('— ఎంచుకోండి —', '— choose —')}</option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {pick(c.name_te, c.name_en)}
                  </option>
                ))}
              </Select>
            </Field>
            <LocationPicker
              levels="district"
              className="sm:col-span-2"
              value={{ state: stateCode, district: districtSlug }}
              onChange={(next) => {
                setStateCode(next.state ?? null);
                setDistrictSlug(next.district ?? '');
              }}
            />
          </div>

          {/* A fieldset, not a Field: Checkbox carries its own label, so a
              Field's htmlFor would point at nothing. */}
          <fieldset className="pt-1">
            <legend className={cn(s.body, 'mb-1.5 text-ui-sm font-semibold text-ink')}>
              {L('ధ్రువీకరణ', 'Your declaration')}
            </legend>
            <Checkbox
              checked={accepted}
              onChange={(v) => {
                setAccepted(v);
                edit();
              }}
              label={L(
                'ఇది నా సొంత రచన; వాస్తవాలు నిర్ధారించుకున్నాను. కంటెంట్ మార్గదర్శకాలను అంగీకరిస్తున్నాను.',
                'This is my own writing, I have verified the facts, and I accept the content guidelines.',
              )}
            />
            {acceptError ? (
              <p role="alert" className={cn(s.body, 'mt-1.5 text-meta text-breaking')}>
                {acceptError}
              </p>
            ) : null}
          </fieldset>
          <ButtonLink to="/editorial-policy" variant="link" size="sm">
            {L('కంటెంట్ మార్గదర్శకాలు చదవండి', 'Read the content guidelines')}
          </ButtonLink>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" pending={submit.isPending} disabled={submit.isPending}>
              {L('మోడరేషన్‌కు పంపండి', 'Send for moderation')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              icon={Trash2}
              onClick={() => void clearDraft()}
              disabled={submit.isPending || (!title && !body)}
            >
              {L('డ్రాఫ్ట్ తొలగించండి', 'Clear draft')}
            </Button>
          </div>
        </form>
      </Card>

      <Card tone="warm" padding="md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-brand-tint text-brand">
              <Icon icon={ShieldCheck} size="md" />
            </span>
            <p className={cn(bodyCls, 'min-w-0 text-ink-soft')}>
              {L(
                'క్రమం తప్పకుండా రాస్తారా? విలేకరిగా ధృవీకరించుకుంటే ఎక్కువ కథనాలు పంపవచ్చు, ఫోటోలు జోడించవచ్చు, మీ పేరుపై ధృవీకరణ గుర్తు వస్తుంది.',
                'Filing regularly? Verified contributors send more stories, attach photographs and carry a verified byline.',
              )}
            </p>
          </div>
          <ButtonLink to="/contributor" variant="secondary" size="sm">
            {L('ధృవీకరించుకోండి', 'Get verified')}
          </ButtonLink>
        </div>
      </Card>

      <section>
        <SectionHeader title={L('నా సమర్పణలు', 'My submissions')} />
        <QueryState
          query={mine}
          skeleton={
            <div className="flex flex-col gap-4">
              <SkeletonCard variant="row" />
              <SkeletonCard variant="row" />
            </div>
          }
          empty={
            <EmptyState
              icon={Inbox}
              compact
              title={L('ఇంకా సమర్పణలు లేవు', 'Nothing submitted yet')}
              body={L('మీ మొదటి కథనం పైన రాయండి.', 'Write your first story in the form above.')}
            />
          }
        >
          {(rows) => (
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <Card padding="md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {row.article_url ? (
                          <Link
                            to={row.article_url}
                            lang="te"
                            className="te flex min-h-tap items-center text-te-body-sm font-semibold text-ink underline-offset-4 hover:text-brand hover:underline"
                          >
                            {row.title_te}
                          </Link>
                        ) : (
                          <p lang="te" className="te text-te-body-sm font-semibold text-ink">
                            {row.title_te}
                          </p>
                        )}
                        {row.review_note ? (
                          <p lang="te" className="te mt-1 text-te-body-xs text-muted">
                            {L('గమనిక: ', 'Note: ')}
                            {row.review_note}
                          </p>
                        ) : null}
                        <p className="mt-1 font-sans text-meta text-muted">{relativeTime(row.created_at, language)}</p>
                      </div>
                      <StatusPill status={row.status} registry={SUBMISSION_STATUS} className="shrink-0" />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </section>

      {dialog}
    </PageContainer>
  );
}
