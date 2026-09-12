import { useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mic, RefreshCw, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AudioPlayer } from '@/components/article/AudioPlayer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useTts } from '@/features/reader/tts';
import { useI18n, useScript } from '@/i18n';
import type { CmsAudioRef } from '@/types/cms';
import { cn } from '@/utils/cn';

/**
 * §19 — attach your own audio instead of a synthesised reading.
 *
 * For a recorded bulletin, an interview clip, or a presenter reading the story
 * properly. An attached file wins over generated audio, costs nothing at a TTS
 * provider, and therefore plays whether or not site-wide voice is switched on.
 *
 * The duration is read from the file in the browser before upload, so the
 * player shows a real length immediately rather than waiting on server-side
 * probing. Playback uses the reader's AudioPlayer against the public audio
 * route once the story is live; that route refuses unpublished stories, so a
 * draft previews through a plain `<audio>` element instead.
 */

const ACCEPT = 'audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/webm';
const MAX_BYTES = 50 * 1024 * 1024;

function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) ? probe.duration : 0);
    // A container the browser cannot decode is still a valid upload; the
    // player will report its own duration once it plays.
    probe.onerror = () => done(0);
    probe.src = url;
  });
}

function format(seconds: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface AudioAttachmentProps {
  /** Null for an article that has not been saved yet. */
  articleId: number | null;
  shortId: string | null;
  /** The public audio route only serves live stories. */
  published: boolean;
  audio: CmsAudioRef | null;
  onChange: (audio: CmsAudioRef | null) => void;
}

export function AudioAttachment({ articleId, shortId, published, audio, onChange }: AudioAttachmentProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');

  // AudioPlayer needs the device-voice hook; an editor's file always exists
  // when the player renders, so the fallback never speaks. Memoised because
  // the player stops the voice whenever the object identity changes.
  const { state, toggle, stop } = useTts('');
  const deviceTts = useMemo(
    () => ({ state, toggle, stop: () => ('speechSynthesis' in window ? stop() : undefined) }),
    [state, toggle, stop],
  );
  const endpoint = published && shortId ? `/public/articles/${shortId}/audio` : null;
  const refreshPlayer = () => {
    if (endpoint) void qc.invalidateQueries({ queryKey: ['audio', endpoint] });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const duration = await readDuration(file);
      return cmsApi.uploadArticleAudio(articleId!, file, duration);
    },
    onSuccess: (result) => {
      onChange({
        id: result.id,
        url: result.url,
        mime: result.mime,
        duration_sec: result.duration_sec,
        provider: result.provider,
        status: result.status,
      });
      refreshPlayer();
      toast.success(L('ఆడియో జోడించారు', 'Audio attached'));
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 415 ? L('ఆ ఫైల్ రకం అనుమతించబడదు — MP3, M4A, WAV లేదా OGG వాడండి.', 'That file type is not allowed — use MP3, M4A, WAV or OGG.') : e,
      ),
  });

  const remove = useMutation({
    mutationFn: () => cmsApi.deleteArticleAudio(articleId!),
    onSuccess: () => {
      onChange(null);
      refreshPlayer();
      toast.success(t('state.deleted'));
    },
    onError: (e) => toast.error(e),
  });

  if (articleId == null) {
    return (
      <Card padding="sm" tone="paper">
        <p className={cn(bodyCls, 'text-muted')}>{L('ఆడియో జోడించడానికి ముందు కథనాన్ని ఒకసారి సేవ్ చేయండి.', 'Save the story once before attaching audio.')}</p>
      </Card>
    );
  }

  const uploaded = audio?.provider === 'upload';

  return (
    <div className="space-y-3">
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > MAX_BYTES) {
            toast.error(L('ఫైల్ 50MB కంటే పెద్దది.', 'The file is larger than 50MB.'));
            return;
          }
          upload.mutate(file);
        }}
      />

      {uploaded ? (
        <Card padding="sm" tone="paper" className="space-y-3">
          {endpoint && shortId ? (
            <AudioPlayer shortId={shortId} readingLabel="" deviceTts={deviceTts} endpoint={endpoint} />
          ) : audio!.url ? (
            <audio src={audio!.url} controls preload="metadata" className="min-h-tap w-full" />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-sans text-meta tabular-nums text-muted">{format(audio!.duration_sec)}</span>
            <Button variant="secondary" size="sm" icon={RefreshCw} pending={upload.isPending} onClick={() => fileInput.current?.click()}>
              {L('మార్చండి', 'Replace')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={Trash2}
              pending={remove.isPending}
              onClick={async () => {
                if (await confirm({ title: t('state.confirmDelete'), confirmLabel: t('ui.remove'), tone: 'danger' })) remove.mutate();
              }}
            >
              {t('ui.remove')}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" icon={Mic} pending={upload.isPending} onClick={() => fileInput.current?.click()}>
            {upload.isPending ? t('ui.uploading') : L('ఆడియో ఫైల్ జోడించండి', 'Attach an audio file')}
          </Button>
          {audio && !uploaded ? (
            <span className={cn(s.body, 'text-meta text-muted')}>
              {L(`ప్రస్తుతం ${audio.provider} ద్వారా తయారైన ఆడియో వాడుతోంది.`, `Currently using audio generated by ${audio.provider}.`)}
            </span>
          ) : null}
        </div>
      )}

      <p className={cn(s.body, 'text-meta text-muted')}>
        {L(
          'MP3, M4A, WAV, OGG — 50MB లోపు. జోడించిన ఫైల్‌కు ప్రాధాన్యం ఉంటుంది; సైట్ వాయిస్ ఆఫ్‌లో ఉన్నా ఇది వినిపిస్తుంది.',
          'MP3, M4A, WAV or OGG, under 50MB. An attached file takes priority and plays even when site voice is off.',
        )}
      </p>
      {dialog}
    </div>
  );
}
