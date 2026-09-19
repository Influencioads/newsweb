import { useMutation } from '@tanstack/react-query';
import { Heart, MessageSquarePlus, Quote } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';

import { Section } from '@/components/admin/FormControls';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { useL } from '../useL';

/**
 * The desk's note on a story, and the seeded-engagement controls.
 *
 * **The note** is its own route rather than a field on the form, because
 * `workflow_service.update` refuses any article that is not DRAFT or
 * CHANGES_REQUESTED — and a critic note is by definition something you add to
 * a story that is already live. Saving it does not touch the rest of the form.
 *
 * **The seeding controls** are shown only to whoever holds `engagement.seed`,
 * which in practice is the owner: it sits in its own permission group so it
 * never arrives through the editorial bundle, and an editor-in-chief does not
 * get it. Every use writes an audit row carrying the actor, their IP and the
 * exact content.
 *
 * Two things the UI says out loud rather than hiding, because a control that
 * fabricates readers should not feel like an ordinary one: the like field
 * *sets* the offset (so 0 un-seeds, and there is no "remove" to get wrong),
 * and the comment name is chosen from a fixed pool of Telugu given names on
 * the server — this form cannot send a name at all.
 */

export interface EngagementPanelProps {
  articleId: number;
  /** Current note, from the loaded article. */
  criticNote: string | null;
  /** Current offset, so the field shows what is actually set. */
  seedLikeCount: number;
  /** Holder of `engagement.seed`. False hides the seeding half entirely. */
  canSeed: boolean;
}

export function EngagementPanel({
  articleId,
  criticNote,
  seedLikeCount,
  canSeed,
}: EngagementPanelProps) {
  const L = useL();
  const s = useScript();
  const toast = useToast();
  const [note, setNote] = useState(criticNote ?? '');
  const [likes, setLikes] = useState(String(seedLikeCount || 0));
  const [comment, setComment] = useState('');

  const saveNote = useMutation({
    mutationFn: () => cmsApi.setCriticNote(articleId, note.trim() || null),
    onSuccess: () =>
      toast.success(note.trim() ? L('వ్యాఖ్య సేవ్ అయ్యింది', 'Note saved') : L('వ్యాఖ్య తీసేశారు', 'Note cleared')),
    onError: (error) => toast.error(error),
  });

  const applyLikes = useMutation({
    mutationFn: () => cmsApi.seedLikes(articleId, Math.max(0, Number(likes) || 0)),
    onSuccess: () => toast.success(L('లైక్‌లు నవీకరించారు', 'Likes updated')),
    onError: (error) => toast.error(error),
  });

  const addComment = useMutation({
    mutationFn: () =>
      // The server picks the display name from its own pool; the index only
      // varies which one, so a caller can never supply a person's name.
      cmsApi.seedComment(articleId, comment.trim(), Math.floor(Math.random() * 40)),
    onSuccess: () => {
      setComment('');
      toast.success(L('వ్యాఖ్య జోడించారు', 'Comment added'));
    },
    onError: (error) => toast.error(error),
  });

  return (
    <Section title={L('సంపాదకీయ వ్యాఖ్య & ఎంగేజ్‌మెంట్', 'Editor’s note and engagement')}>
      <Field
        label={L('సంపాదకుల వ్యాఖ్య', 'Editor’s note')}
        optionalLabel
        hint={L(
          'కథనం పక్కన పాఠకులకు కనిపిస్తుంది. ఇది సవరణ కాదు.',
          'Shown to readers beside the story. This is not a correction.',
        )}
      >
        <Textarea
          rows={3}
          script="te"
          autoGrow
          value={note}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
          maxLength={4000}
        />
      </Field>
      <Button
        variant="secondary"
        size="sm"
        icon={Quote}
        pending={saveNote.isPending}
        onClick={() => saveNote.mutate()}
      >
        {L('వ్యాఖ్యను సేవ్ చేయండి', 'Save note')}
      </Button>

      {canSeed ? (
        <div className="mt-6 border-t border-rule pt-4">
          <p className={cn(s.body, 'text-meta font-bold text-partial')}>
            {L(
              'సీడ్ చేసిన ఎంగేజ్‌మెంట్ — ప్రతి చర్యా ఆడిట్ అవుతుంది',
              'Seeded engagement — every action is audit-logged',
            )}
          </p>

          <Field
            label={L('సీడ్ లైక్‌లు', 'Seeded likes')}
            hint={L(
              'ఇది మొత్తాన్ని సెట్ చేస్తుంది, కలపదు. 0 అంటే తీసేయడం. ర్యాంకింగ్‌కు వెళ్లదు.',
              'This sets the number, it does not add. 0 removes it. Never reaches ranking.',
            )}
            className="mt-3"
          >
            <Input
              type="number"
              min={0}
              max={100000}
              value={likes}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setLikes(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            size="sm"
            icon={Heart}
            pending={applyLikes.isPending}
            onClick={() => applyLikes.mutate()}
          >
            {L('వర్తింపజేయండి', 'Apply')}
          </Button>

          <Field
            label={L('సీడ్ వ్యాఖ్య', 'Seeded comment')}
            optionalLabel
            hint={L(
              'పేరును సర్వర్ తన జాబితా నుంచి ఎంచుకుంటుంది — ఇక్కడ పేరు ఇవ్వలేరు.',
              'The server picks the name from its own pool — you cannot supply one.',
            )}
            className="mt-4"
          >
            <Textarea
              rows={2}
              script="te"
              autoGrow
              value={comment}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
              maxLength={2000}
            />
          </Field>
          <Button
            variant="secondary"
            size="sm"
            icon={MessageSquarePlus}
            disabled={!comment.trim()}
            pending={addComment.isPending}
            onClick={() => addComment.mutate()}
          >
            {L('వ్యాఖ్యను జోడించండి', 'Add comment')}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
