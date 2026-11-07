import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImageUp, Trash2, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import type { CmsMediaRef } from '@/types/cms';

import { useL } from '../useL';

/**
 * "Written by" on a My Village story: the writer's name, typed (a villager is
 * not one of the desk's names in Site content → Authors), and their photo.
 * Readers see both on the story and on the My Village cards. A story sent
 * through Share Your Village arrives with the name and selfie the writer gave.
 */
export function WrittenBy({
  name,
  photo,
  onName,
  onPhoto,
  error,
}: {
  name: string;
  photo: CmsMediaRef | null;
  onName: (name: string) => void;
  onPhoto: (photo: CmsMediaRef | null) => void;
  error?: string;
}) {
  const L = useL();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => cmsApi.uploadMedia(file, { alt_te: name || undefined, credit: name || undefined, source_type: 'contributed' }),
    onSuccess: (media) => onPhoto(media),
    onError: (err) => toast.error(err),
  });

  return (
    // Photo row above the name: the story column can be narrow beside the sidebar.
    <div className="flex flex-col gap-4 sm:col-span-2">
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-pill border border-rule bg-paper">
          {photo?.url ? (
            <img src={photo.url} alt={name || L('రచయిత ఫోటో', 'Writer photo')} className="h-full w-full object-cover" />
          ) : (
            <UserRound aria-hidden className="h-8 w-8 text-muted" />
          )}
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <Button icon={ImageUp} variant="secondary" size="sm" pending={upload.isPending} onClick={() => input.current?.click()}>
            {photo ? L('ఫోటో మార్చండి', 'Change photo') : L('ఫోటో అప్‌లోడ్', 'Upload photo')}
          </Button>
          {photo ? (
            <Button icon={Trash2} variant="ghost" size="sm" onClick={() => onPhoto(null)}>
              {L('ఫోటో తీసేయండి', 'Remove photo')}
            </Button>
          ) : null}
        </div>
      </div>
      <Field
        label={L('రాసిన వారు', 'Written by')}
        optionalLabel
        error={error}
        hint={L(
          'మై విలేజ్ కథ రాసిన వారి పేరు. పాఠకులకు ఫోటోతో పాటు కనిపిస్తుంది.',
          'The name of the person who wrote this My Village story. Readers see it with the photo.',
        )}
      >
        <Input value={name} maxLength={200} onChange={(e) => onName(e.target.value)} />
      </Field>
    </div>
  );
}
