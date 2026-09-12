import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ExternalLink, Play, Plus, Radio, RefreshCw, Save, Square, Volume2 } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { BulletinPill } from '@/components/admin/StatusPill';
import { AudioPlayer } from '@/components/article/AudioPlayer';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useTts } from '@/features/reader/tts';
import { useI18n, useScript } from '@/i18n';
import type { BulletinList, BulletinRow } from '@/types/cms';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

/**
 * The bulletin desk — six slots a day, 06:00 to 21:00 IST.
 *
 * Bulletins publish on schedule because everything in them is already
 * published: a human approved each story and a second human put it live. The
 * machine picks an order and writes the joining sentences. So this screen is
 * supervision, not a gate — the editor watches, edits a script when a name is
 * mispronounced, and pulls one if something is wrong.
 *
 * The switch that turns it into a gate is `bulletin.requires_approval` in
 * Settings; when it is on, every card waits at Ready for a Publish.
 *
 * Playback: a live bulletin renders the readers' own `AudioPlayer` against the
 * public bulletin route (the same payload shape as article audio). That route
 * 404s for anything not on air, so a file that exists but is not live yet — a
 * Ready card under the approval gate, or everything while the kill switch is
 * off — gets a plain link to the file instead.
 */

const SLOT_LABEL: Record<number, string> = {
  6: '06:00', 9: '09:00', 12: '12:00', 15: '15:00', 18: '18:00', 21: '21:00',
};
const slotLabel = (slot: number) => SLOT_LABEL[slot] ?? `${slot}:00`;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function ScriptEditor({ bulletin, onSaved }: { bulletin: BulletinRow; onSaved: () => void }) {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const s = useScript();
  const toast = useToast();
  const [text, setText] = useState(bulletin.script_te ?? '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setText(bulletin.script_te ?? '');
    setDirty(false);
  }, [bulletin.script_te, bulletin.id]);

  const save = useMutation({
    mutationFn: () => cmsApi.patchBulletin(bulletin.id, text),
    onSuccess: () => {
      setDirty(false);
      toast.success(t('state.saved'));
      onSaved();
    },
    onError: (e) => toast.error(e),
  });

  // Roughly 12 characters a second — the same constant both TTS adapters use
  // to estimate duration, so this is a real preview of the length.
  const seconds = Math.round(text.length / 12);
  const target = Math.round(bulletin.target_chars / 12);

  return (
    <div className="mt-3 space-y-3">
      <Field label={L('స్క్రిప్ట్', 'Script')}>
        <Textarea
          script="te"
          rows={6}
          autoGrow
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-live="polite"
          className={cn('font-sans text-meta tabular-nums', seconds > target * 1.2 ? 'text-breaking' : 'text-muted')}
        >
          {text.length.toLocaleString('en-IN')} {t('ui.characters')} · ~{seconds}s
          <span className="text-muted"> / {target}s {L('లక్ష్యం', 'target')}</span>
        </span>
        {dirty ? (
          <Button size="sm" icon={Save} pending={save.isPending} onClick={() => save.mutate()}>
            {L('స్క్రిప్ట్ సేవ్', 'Save script')}
          </Button>
        ) : null}
        {dirty ? (
          <span className={cn(s.body, 'text-meta text-muted')}>
            {L(
              'సేవ్ చేస్తే స్క్రిప్ట్ దశకు వస్తుంది — వినిపించడానికి మళ్లీ తయారు చేయండి.',
              'Saving drops it back to Script ready — press Regenerate to speak it.',
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BulletinCard({ bulletin, live, onChanged }: { bulletin: BulletinRow; live: boolean; onChanged: () => void }) {
  const { language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const s = useScript();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const id = useId();
  const tts = useTts(bulletin.script_te ?? '');

  const done = (msg: string) => () => {
    toast.success(msg);
    onChanged();
  };
  const regenerate = useMutation({
    mutationFn: (rescript: boolean) => cmsApi.regenerateBulletin(bulletin.id, rescript),
    onSuccess: done(L('మళ్లీ తయారవుతోంది', 'Regenerating')),
    onError: (e) => toast.error(e),
  });
  const publish = useMutation({
    mutationFn: () => cmsApi.publishBulletin(bulletin.id),
    onSuccess: done(L('ప్రసారంలో ఉంది', 'On air')),
    onError: (e) => toast.error(e),
  });
  const pull = useMutation({
    mutationFn: () => cmsApi.pullBulletin(bulletin.id),
    onSuccess: done(L('ప్రసారం ఆగింది', 'Pulled off air')),
    onError: (e) => toast.error(e),
  });
  const busy = regenerate.isPending || publish.isPending || pull.isPending;
  const scriptedOnly = bulletin.status === 'scripted';
  const duration = bulletin.duration_sec ? clock(bulletin.duration_sec) : null;
  const body = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui-sm');

  const pullOffAir = async () => {
    const ok = await confirm({
      title: L('ప్రసారం ఆపాలా?', 'Pull this bulletin off air?'),
      body: L(
        'పాఠకులకు వెంటనే వినిపించదు. మళ్లీ తయారు చేసి తిరిగి ప్రసారం చేయవచ్చు.',
        'Readers stop hearing it immediately. You can regenerate and put it back on air.',
      ),
      confirmLabel: L('ప్రసారం ఆపండి', 'Pull off air'),
      tone: 'danger',
    });
    if (ok) pull.mutate();
  };

  return (
    <Card as="article" aria-labelledby={`${id}-slot`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${id}-slot`} className="font-sans text-headline-sm font-extrabold tabular-nums text-ink">
          {slotLabel(bulletin.slot)}
        </h2>
        <BulletinPill status={bulletin.status} />
        {duration ? <span className="font-sans text-meta tabular-nums text-muted">{duration}</span> : null}
        <span className={cn(s.body, 'text-meta text-muted')}>
          {bulletin.items.length} {L('వార్తలు', 'stories')}
          {bulletin.revision > 1 ? ` · r${bulletin.revision}` : ''}
        </span>
      </div>

      {bulletin.error ? (
        <p role="alert" className={cn(body, 'mt-3 rounded-xl border border-breaking-border bg-breaking-tint p-3 text-breaking')}>
          {bulletin.error}
          {bulletin.attempts >= 3 ? (
            <span className="block">
              {L('మూడుసార్లు ప్రయత్నించాం — ఈ స్లాట్‌ను వదిలేసింది.', 'Retried three times — the retry job has given up on this slot.')}
            </span>
          ) : null}
        </p>
      ) : null}

      {bulletin.url ? (
        <div className="mt-3">
          {live ? (
            // The headline list below is the transcript.
            <AudioPlayer
              shortId={String(bulletin.id)}
              readingLabel={duration ?? ''}
              deviceTts={tts}
              endpoint={`/public/bulletins/${bulletin.date}/${bulletin.slot}`}
            />
          ) : (
            <ButtonLink to={bulletin.url} external variant="secondary" size="sm" icon={Play} iconRight={ExternalLink}>
              {L('ఆడియో ప్రివ్యూ', 'Preview audio')}
            </ButtonLink>
          )}
        </div>
      ) : null}

      {bulletin.items.length ? (
        <ol lang="te" className="te mt-3 list-decimal space-y-1 pl-6 text-te-body-xs text-ink-soft">
          {bulletin.items.map((item) => (
            <li key={item.position} value={item.position}>
              {item.headline_te}
            </li>
          ))}
        </ol>
      ) : null}

      <Button
        variant="link"
        size="sm"
        iconRight={open ? ChevronUp : ChevronDown}
        aria-expanded={open}
        aria-controls={`${id}-script`}
        onClick={() => setOpen((v) => !v)}
        className="-ml-1 mt-2"
      >
        {open ? L('స్క్రిప్ట్ దాచండి', 'Hide script') : L('స్క్రిప్ట్ చూడండి', 'Show script')}
      </Button>
      {open ? (
        <div id={`${id}-script`}>
          <ScriptEditor bulletin={bulletin} onSaved={onChanged} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
        <Button
          variant="secondary"
          size="sm"
          icon={scriptedOnly ? Volume2 : RefreshCw}
          pending={regenerate.isPending}
          disabled={busy}
          onClick={() => regenerate.mutate(!scriptedOnly)}
        >
          {scriptedOnly ? L('ఈ స్క్రిప్ట్ వినిపించండి', 'Speak this script') : L('మళ్లీ తయారు చేయండి', 'Regenerate')}
        </Button>
        {bulletin.status === 'ready' ? (
          <Button size="sm" icon={Radio} pending={publish.isPending} disabled={busy} onClick={() => publish.mutate()}>
            {L('ప్రసారం చేయండి', 'Put on air')}
          </Button>
        ) : null}
        {bulletin.status === 'published' ? (
          <Button variant="danger" size="sm" icon={Square} pending={pull.isPending} disabled={busy} onClick={() => void pullOffAir()}>
            {L('ప్రసారం ఆపండి', 'Pull off air')}
          </Button>
        ) : null}
      </div>
      {dialog}
    </Card>
  );
}

function Desk({ data, date, onChanged }: { data: BulletinList; date: string; onChanged: () => void }) {
  const { language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const s = useScript();
  const toast = useToast();
  const reveal = useReveal<HTMLLIElement>();
  const body = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');

  const run = useMutation({
    mutationFn: (slot: number) => cmsApi.runBulletin({ slot, date: date || undefined }),
    onSuccess: () => {
      toast.success(L('బులెటిన్ తయారవుతోంది', 'Producing the bulletin'));
      onChanged();
    },
    onError: (e) => toast.error(e),
  });

  return (
    <>
      {!data.enabled ? (
        <Card padding="sm" tone="paper" role="status">
          <p className={cn(body, 'text-ink-soft')}>
            {L(
              'సెట్టింగ్స్‌లో బులెటిన్లు ఆఫ్‌లో ఉన్నాయి. ఏదీ తయారు కాదు, తయారైనవి కూడా పాఠకులకు కనిపించవు.',
              'Bulletins are switched off in Settings. Nothing is produced, and nothing already produced is served to readers.',
            )}
          </p>
        </Card>
      ) : null}

      {data.requires_approval ? (
        <p role="status" className={cn(body, 'rounded-xl border border-info/30 bg-info-tint p-4 text-ink-soft')}>
          {L(
            'ఆమోదం తప్పనిసరి: ప్రతి బులెటిన్ ఎవరైనా ప్రసారం చేసే వరకు వేచి ఉంటుంది.',
            'Approval is required: every bulletin waits at Audio ready until somebody puts it on air.',
          )}
        </p>
      ) : null}

      {data.missing_slots.length ? (
        <div role="group" aria-label={L('ఇప్పుడే తయారు చేయండి', 'Produce now')} className="flex flex-wrap gap-2">
          {data.missing_slots.map((slot) => (
            <Button
              key={slot}
              variant="secondary"
              size="sm"
              icon={Plus}
              pending={run.isPending && run.variables === slot}
              disabled={!data.enabled || run.isPending}
              onClick={() => run.mutate(slot)}
            >
              {slotLabel(slot)}
            </Button>
          ))}
        </div>
      ) : null}

      {data.items.length ? (
        <ul className="space-y-4">
          {data.items.map((bulletin) => (
            <li key={bulletin.id} ref={reveal}>
              <BulletinCard bulletin={bulletin} live={data.enabled && bulletin.status === 'published'} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      ) : (
        <Card padding="none">
          <EmptyState icon={Radio} title={L('ఈ రోజుకు ఇంకా బులెటిన్లు లేవు.', 'No bulletins for this day yet.')} compact />
        </Card>
      )}
    </>
  );
}

export default function BulletinsPage() {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');

  const bulletins = useQuery({
    queryKey: ['cms', 'bulletins', date],
    queryFn: () => cmsApi.fetchBulletins(date || undefined),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'bulletins'] });

  return (
    <AdminPage
      title={t('admin.page.bulletins')}
      width="page"
      subtitle={L(
        'రోజుకు ఆరు, ఉదయం 6 నుంచి రాత్రి 9 వరకు. అన్నీ ఇప్పటికే ప్రచురించిన వార్తలే కాబట్టి దానంతట ప్రసారమవుతాయి — పేరు తప్పు పలికితే స్క్రిప్ట్ మార్చండి, తప్పుంటే ఆపండి.',
        'Six a day, 06:00 to 21:00. Each one reads stories that are already published, so it goes on air automatically — edit a script when a name is mispronounced, or pull one if something is wrong.',
      )}
    >
      <Field label={L('తేదీ', 'Date')} className="max-w-xs">
        <Input type="date" script="en" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <QueryState
        query={bulletins}
        isEmpty={() => false}
        skeleton={
          <div className="space-y-4">
            <SkeletonCard variant="compact" />
            <SkeletonCard variant="compact" />
            <SkeletonCard variant="compact" />
          </div>
        }
      >
        {(data) => <Desk data={data} date={date} onChanged={refresh} />}
      </QueryState>
    </AdminPage>
  );
}
