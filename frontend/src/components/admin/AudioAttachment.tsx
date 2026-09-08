import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import * as cmsApi from '@/features/cms/api';
import type { ApiError } from '@/api/client';
import type { CmsAudioRef } from '@/types/cms';

/**
 * §19 — attach your own audio instead of a synthesised reading.
 *
 * For a recorded bulletin, an interview clip, or a presenter reading the story
 * properly. An attached file wins over generated audio, costs nothing at a TTS
 * provider, and therefore plays whether or not site-wide voice is switched on.
 *
 * The duration is read from the file in the browser before upload, so the
 * player shows a real length immediately rather than waiting on server-side
 * probing.
 */

const ACCEPT = 'audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/webm';
const MAX_BYTES = 50 * 1024 * 1024;

function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    const done = (value: number) => { URL.revokeObjectURL(url); resolve(value); };
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

export function AudioAttachment({
  articleId, audio, onChange,
}: {
  /** Null for an article that has not been saved yet. */
  articleId: number | null;
  audio: CmsAudioRef | null;
  onChange: (audio: CmsAudioRef | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [tooLarge, setTooLarge] = useState(false);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const duration = await readDuration(file);
      return cmsApi.uploadArticleAudio(articleId!, file, duration);
    },
    onSuccess: (result) => onChange({
      id: result.id, url: result.url, mime: result.mime,
      duration_sec: result.duration_sec, provider: result.provider, status: result.status,
    }),
  });

  const remove = useMutation({
    mutationFn: () => cmsApi.deleteArticleAudio(articleId!),
    onSuccess: () => onChange(null),
  });

  if (articleId == null) {
    return (
      <p className="te rounded-control border border-rule bg-canvas p-3 text-[12.5px] text-muted">
        ఆడియో జోడించడానికి ముందు కథనాన్ని ఒకసారి సేవ్ చేయండి.
      </p>
    );
  }

  const uploaded = audio?.provider === 'upload';
  const error = upload.error as ApiError | undefined;

  return (
    <div className="space-y-2">
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > MAX_BYTES) { setTooLarge(true); return; }
          setTooLarge(false);
          upload.mutate(file);
        }}
      />

      {uploaded ? (
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-rule bg-canvas p-3">
          {audio!.url ? (
            <audio src={audio!.url} controls preload="metadata" className="h-9 min-w-[220px] flex-1" />
          ) : null}
          <span className="font-sans text-[11.5px] text-muted">{format(audio!.duration_sec)}</span>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="te min-h-[32px] rounded-control border border-rule px-3 text-[12px] font-semibold text-breaking disabled:opacity-50"
          >
            {remove.isPending ? '…' : 'తీసివేయండి'}
          </button>
          <button
            type="button"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
            className="te min-h-[32px] rounded-control border border-brand px-3 text-[12px] font-bold text-brand disabled:opacity-50"
          >
            మార్చండి
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
            className="te min-h-[34px] rounded-control border border-brand px-3.5 text-[12.5px] font-bold text-brand disabled:opacity-50"
          >
            {upload.isPending ? 'అప్‌లోడ్ అవుతోంది…' : '🎙 ఆడియో ఫైల్ జోడించండి'}
          </button>
          {audio && !uploaded ? (
            <span className="te text-[11.5px] text-muted">
              ప్రస్తుతం {audio.provider} ద్వారా తయారైన ఆడియో వాడుతోంది.
            </span>
          ) : null}
        </div>
      )}

      <p className="te text-[11.5px] leading-telugu text-muted">
        MP3, M4A, WAV, OGG — 50MB లోపు. జోడించిన ఫైల్‌కు ప్రాధాన్యం ఉంటుంది; సైట్ వాయిస్
        ఆఫ్‌లో ఉన్నా ఇది వినిపిస్తుంది.
      </p>

      {tooLarge ? (
        <p className="te text-[12px] text-breaking">ఫైల్ 50MB కంటే పెద్దది.</p>
      ) : null}
      {error ? (
        <p className="te text-[12px] text-breaking">
          {error.status === 415
            ? 'ఆ ఫైల్ రకం అనుమతించబడదు — MP3, M4A, WAV లేదా OGG వాడండి.'
            : (error.messageTe ?? 'అప్‌లోడ్ విఫలమైంది.')}
        </p>
      ) : null}
    </div>
  );
}
