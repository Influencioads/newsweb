import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { inputClass } from '@/components/admin/FormControls';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import type { BulletinRow, BulletinStatus } from '@/types/cms';

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
 */

const STATUS: Record<BulletinStatus, { te: string; en: string; tone: string }> = {
  pending: { te: 'ఇంకా తయారు కాలేదు', en: 'Not produced', tone: 'bg-canvas text-muted' },
  scripted: { te: 'స్క్రిప్ట్ సిద్ధం', en: 'Script ready', tone: 'bg-info/12 text-info' },
  ready: { te: 'ఆడియో సిద్ధం', en: 'Audio ready', tone: 'bg-partial/15 text-partial' },
  published: { te: 'ప్రసారంలో', en: 'On air', tone: 'bg-success/12 text-success' },
  failed: { te: 'విఫలమైంది', en: 'Failed', tone: 'bg-breaking-tint text-breaking' },
  skipped: { te: 'వార్తలు లేవు', en: 'No stories', tone: 'bg-canvas text-muted' },
};

const SLOT_LABEL: Record<number, string> = {
  6: '06:00', 9: '09:00', 12: '12:00', 15: '15:00', 18: '18:00', 21: '21:00',
};

function ScriptEditor({ bulletin, onSaved }: { bulletin: BulletinRow; onSaved: () => void }) {
  const { language } = useI18n();
  const en = language === 'en';
  const [text, setText] = useState(bulletin.script_te ?? '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setText(bulletin.script_te ?? '');
    setDirty(false);
  }, [bulletin.script_te, bulletin.id]);

  const save = useMutation({
    mutationFn: () => cmsApi.patchBulletin(bulletin.id, text),
    onSuccess: () => { setDirty(false); onSaved(); },
  });

  // Roughly 12 characters a second — the same constant both TTS adapters use
  // to estimate duration, so this is a real preview of the length.
  const seconds = Math.round(text.length / 12);
  const target = Math.round(bulletin.target_chars / 12);

  return (
    <div className="mt-2">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setDirty(true); }}
        className={`te ${inputClass} min-h-[140px] leading-telugu`}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <span className={`font-sans text-[11.5px] tabular-nums ${
          seconds > target * 1.2 ? 'text-breaking' : 'text-muted'
        }`}>
          {text.length.toLocaleString('en-IN')} {en ? 'chars' : 'అక్షరాలు'} · ~{seconds}s
          <span className="text-muted"> / {target}s {en ? 'target' : 'లక్ష్యం'}</span>
        </span>
        {dirty ? (
          <button type="button" disabled={save.isPending} onClick={() => save.mutate()}
            className="te min-h-[30px] rounded-control border border-brand px-3 text-[11.5px] font-bold text-brand disabled:opacity-50">
            {save.isPending ? (en ? 'Saving…' : 'సేవ్ అవుతోంది…') : (en ? 'Save script' : 'స్క్రిప్ట్ సేవ్')}
          </button>
        ) : null}
        {dirty ? (
          <span className="te text-[11px] text-muted">
            {en ? 'Saving drops it back to Script ready — press Regenerate to speak it.'
                : 'సేవ్ చేస్తే స్క్రిప్ట్ దశకు వస్తుంది — వినిపించడానికి మళ్లీ తయారు చేయండి.'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BulletinCard({ bulletin, onChanged }: { bulletin: BulletinRow; onChanged: () => void }) {
  const { language } = useI18n();
  const en = language === 'en';
  const [open, setOpen] = useState(false);
  const label = STATUS[bulletin.status];

  const regenerate = useMutation({
    mutationFn: (rescript: boolean) => cmsApi.regenerateBulletin(bulletin.id, rescript),
    onSuccess: onChanged,
  });
  const publish = useMutation({ mutationFn: () => cmsApi.publishBulletin(bulletin.id), onSuccess: onChanged });
  const pull = useMutation({ mutationFn: () => cmsApi.pullBulletin(bulletin.id), onSuccess: onChanged });
  const busy = regenerate.isPending || publish.isPending || pull.isPending;

  return (
    <article className="rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-sans text-[16px] font-extrabold tabular-nums text-ink">
          {SLOT_LABEL[bulletin.slot] ?? `${bulletin.slot}:00`}
        </span>
        <span className={`inline-block rounded-chip px-2 py-0.5 font-sans text-[10.5px] font-bold ${label.tone}`}>
          {en ? label.en : label.te}
        </span>
        {bulletin.duration_sec ? (
          <span className="font-sans text-[11.5px] tabular-nums text-muted">
            {Math.floor(bulletin.duration_sec / 60)}:{String(bulletin.duration_sec % 60).padStart(2, '0')}
          </span>
        ) : null}
        <span className="font-sans text-[11.5px] text-muted">
          {bulletin.items.length} {en ? 'stories' : 'వార్తలు'}
          {bulletin.revision > 1 ? ` · r${bulletin.revision}` : ''}
        </span>
      </div>

      {bulletin.error ? (
        <p role="alert" className="te mt-2 rounded-control border border-breaking-border bg-breaking-tint p-2 text-[12px] leading-telugu text-breaking">
          {bulletin.error}
          {bulletin.attempts >= 3 ? (
            <span className="block">
              {en ? 'Retried three times — the retry job has given up on this slot.'
                  : 'మూడుసార్లు ప్రయత్నించాం — ఈ స్లాట్‌ను వదిలేసింది.'}
            </span>
          ) : null}
        </p>
      ) : null}

      {bulletin.url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- the script below is the transcript
        <audio controls preload="none" src={bulletin.url} className="mt-2.5 w-full" />
      ) : null}

      {bulletin.items.length ? (
        <ol className="mt-2.5 space-y-1">
          {bulletin.items.map((item) => (
            <li key={item.position} className="te text-[12.5px] leading-telugu text-ink-soft">
              {item.position}. {item.headline_te}
            </li>
          ))}
        </ol>
      ) : null}

      <button type="button" onClick={() => setOpen((v) => !v)}
        className="te mt-2 text-[12px] font-semibold text-info underline">
        {open ? (en ? 'Hide script' : 'స్క్రిప్ట్ దాచండి') : (en ? 'Show script' : 'స్క్రిప్ట్ చూడండి')}
      </button>
      {open ? <ScriptEditor bulletin={bulletin} onSaved={onChanged} /> : null}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-rule pt-2.5">
        <button type="button" disabled={busy} onClick={() => regenerate.mutate(bulletin.status === 'scripted' ? false : true)}
          className="te min-h-[32px] rounded-control border border-brand px-3 text-[12px] font-bold text-brand disabled:opacity-50">
          {regenerate.isPending
            ? (en ? 'Working…' : 'తయారవుతోంది…')
            : bulletin.status === 'scripted'
              ? (en ? 'Speak this script' : 'ఈ స్క్రిప్ట్ వినిపించండి')
              : (en ? 'Regenerate' : 'మళ్లీ తయారు చేయండి')}
        </button>
        {bulletin.status === 'ready' ? (
          <button type="button" disabled={busy} onClick={() => publish.mutate()}
            className="te min-h-[32px] rounded-control bg-brand px-3 text-[12px] font-bold text-white disabled:opacity-50">
            {en ? 'Put on air' : 'ప్రసారం చేయండి'}
          </button>
        ) : null}
        {bulletin.status === 'published' ? (
          <button type="button" disabled={busy} onClick={() => pull.mutate()}
            className="te min-h-[32px] rounded-control border border-breaking-border px-3 text-[12px] font-bold text-breaking disabled:opacity-50">
            {en ? 'Pull off air' : 'ప్రసారం ఆపండి'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function BulletinsPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');

  const bulletins = useQuery({
    queryKey: ['cms', 'bulletins', date],
    queryFn: () => cmsApi.fetchBulletins(date || undefined),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'bulletins'] });

  const run = useMutation({
    mutationFn: (slot: number) => cmsApi.runBulletin({ slot, date: date || undefined }),
    onSuccess: refresh,
  });

  const data = bulletins.data;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4">
        <h1 className="th text-[25px] font-extrabold text-ink">
          {en ? 'Audio bulletins' : 'ఆడియో బులెటిన్లు'}
        </h1>
        <p className="te mt-1 max-w-[70ch] text-[12px] leading-telugu text-muted">
          {en
            ? 'Six a day, 06:00 to 21:00. Each one reads stories that are already published, so it goes on air automatically — edit a script when a name is mispronounced, or pull one if something is wrong.'
            : 'రోజుకు ఆరు, ఉదయం 6 నుంచి రాత్రి 9 వరకు. అన్నీ ఇప్పటికే ప్రచురించిన వార్తలే కాబట్టి దానంతట ప్రసారమవుతాయి — పేరు తప్పు పలికితే స్క్రిప్ట్ మార్చండి, తప్పుంటే ఆపండి.'}
        </p>
      </header>

      {data && !data.enabled ? (
        <p className="te mb-4 rounded-control border border-rule bg-canvas p-3 text-[12.5px] leading-telugu text-ink-soft">
          {en
            ? 'Bulletins are switched off in Settings. Nothing is produced, and nothing already produced is served to readers.'
            : 'సెట్టింగ్స్‌లో బులెటిన్లు ఆఫ్‌లో ఉన్నాయి. ఏదీ తయారు కాదు, తయారైనవి కూడా పాఠకులకు కనిపించవు.'}
        </p>
      ) : null}

      {data?.requires_approval ? (
        <p className="te mb-4 rounded-control border border-info/40 bg-info/8 p-3 text-[12.5px] leading-telugu text-ink-soft">
          {en
            ? 'Approval is required: every bulletin waits at Audio ready until somebody puts it on air.'
            : 'ఆమోదం తప్పనిసరి: ప్రతి బులెటిన్ ఎవరైనా ప్రసారం చేసే వరకు వేచి ఉంటుంది.'}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className={`${inputClass} max-w-[180px]`} />
        {(data?.missing_slots ?? []).map((slot) => (
          <button key={slot} type="button" disabled={run.isPending || !data?.enabled}
            onClick={() => run.mutate(slot)}
            className="te min-h-[32px] rounded-control border border-rule px-3 text-[12px] font-semibold text-brand disabled:opacity-40">
            + {SLOT_LABEL[slot] ?? slot}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {(data?.items ?? []).map((bulletin) => (
          <BulletinCard key={bulletin.id} bulletin={bulletin} onChanged={refresh} />
        ))}
        {data && data.items.length === 0 ? (
          <p className="te rounded-card border border-rule bg-white p-8 text-center text-[13px] text-muted dark:bg-surface">
            {en ? 'No bulletins for this day yet.' : 'ఈ రోజుకు ఇంకా బులెటిన్లు లేవు.'}
          </p>
        ) : null}
      </div>
    </main>
  );
}
