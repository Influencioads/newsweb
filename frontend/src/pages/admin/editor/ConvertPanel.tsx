import { useMutation } from '@tanstack/react-query';
import { Copy, ExternalLink, Image as ImageIcon, RefreshCw, Volume2 } from 'lucide-react';

import { Section } from '@/components/admin/FormControls';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { useL } from '../useL';

/**
 * "ఈ కథనాన్ని మార్చండి" — the same story as a voice and as a picture.
 *
 * Both assets are read by the public reader through
 * `/public/articles/{short_id}/formats`, so filling them here is what lights
 * up the controls a reader already has. Nothing else has to be switched on.
 *
 * Neither failure is an error toast. Voice can be off for this story or for
 * the whole site; a card cannot be drawn at all on a host whose Pillow lacks
 * Raqm — which is every Windows desk. Those are states to read, not mistakes
 * to retry, so they render inline next to the button that reported them.
 */

function Note({ children }: { children: string }) {
  const s = useScript();
  return <p className={cn(s.body, 'text-meta text-muted')}>{children}</p>;
}

export interface ConvertPanelProps {
  articleId: number;
  /** §20's per-story switch, live from the form — the sidebar owns it. */
  voiceEnabled: boolean;
}

export function ConvertPanel({ articleId, voiceEnabled }: ConvertPanelProps) {
  const { t } = useI18n();
  const s = useScript();
  const L = useL();
  const toast = useToast();

  const voice = useMutation({
    mutationFn: (force: boolean) => cmsApi.generateArticleAudio(articleId, force),
    onError: (e) => toast.error(e),
  });
  const card = useMutation({
    mutationFn: (force: boolean) => cmsApi.generateArticleCard(articleId, force),
    onError: (e) => toast.error(e),
  });

  const usage = voice.data?.usage;
  const cardUrl = card.data?.url;

  async function copyCardLink(url: string) {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
      toast.success(t('ui.copied'));
    } catch (error) {
      toast.error(error);
    }
  }

  return (
    <Section
      title={L('ఈ కథనాన్ని మార్చండి', 'Convert this story')}
      subtitle={L(
        'తయారైన వెంటనే పాఠకుల పేజీలో వినడం, షేర్ చేయడం వాటంతట అవే కనిపిస్తాయి',
        'Once made, the reader page shows listen and share on its own',
      )}
    >
      {/* ------------------------------------------------------- voice -- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={Volume2} pending={voice.isPending} onClick={() => voice.mutate(false)}>
            {L('గాత్రంగా మార్చండి', 'Convert to voice')}
          </Button>
          {voice.data?.available ? (
            <>
              <Badge tone="success">{`${L('సిద్ధం', 'Ready')} · ${voice.data.duration_sec}s`}</Badge>
              <Button variant="ghost" size="sm" icon={RefreshCw} pending={voice.isPending} onClick={() => voice.mutate(true)}>
                {L('మళ్లీ తయారు చేయండి', 'Regenerate')}
              </Button>
            </>
          ) : null}
        </div>

        {voice.data?.available && voice.data.url ? (
          <audio src={voice.data.url} controls preload="metadata" className="min-h-tap w-full" />
        ) : null}

        {voice.data && !voice.data.available ? (
          <Note>
            {voice.data.global_voice_enabled === false
              ? L(
                  'సైట్ సెట్టింగ్‌లలో వాయిస్ ఆఫ్‌లో ఉంది — అడ్మిన్ సెట్టింగ్‌లలో ఆన్ చేయాలి.',
                  'Voice is off in site settings — an admin has to switch it on.',
                )
              : voice.data.voice_enabled === false
                ? L(
                    'ఈ కథనానికి వాయిస్ ఆఫ్‌లో ఉంది — పక్క ప్యానెల్‌లోని "వాయిస్ (వినండి)" స్విచ్ ఆన్ చేసి సేవ్ చేయండి.',
                    'Voice is off for this story — turn on the "Voice (listen)" switch in the side panel and save.',
                  )
                : L(
                    'తయారు కాలేదు — ప్రొవైడర్, నెలవారీ పరిమితి సెట్టింగ్‌లలో చూడండి.',
                    'Not generated — check the provider and the monthly limit in settings.',
                  )}
          </Note>
        ) : null}

        {!voiceEnabled && !voice.data ? (
          <Note>
            {L(
              'పక్క ప్యానెల్‌లో "వాయిస్ (వినండి)" ఆఫ్‌లో ఉంది.',
              'The "Voice (listen)" switch in the side panel is off.',
            )}
          </Note>
        ) : null}

        {usage ? (
          <p className={cn(s.body, 'text-meta tabular-nums text-muted')}>
            {L('ఈ నెల వాడిన అక్షరాలు', 'Characters used this month')}: {usage.chars_this_month?.toLocaleString() ?? 0}
            {usage.monthly_budget ? ` / ${usage.monthly_budget.toLocaleString()}` : ''}
          </p>
        ) : null}
      </div>

      {/* -------------------------------------------------------- card -- */}
      <div className="space-y-2 border-t border-rule-soft pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={ImageIcon} pending={card.isPending} onClick={() => card.mutate(false)}>
            {L('చిత్రంగా మార్చండి', 'Convert to image')}
          </Button>
          {card.data?.available && cardUrl ? (
            <>
              <Button variant="ghost" size="sm" icon={Copy} onClick={() => void copyCardLink(cardUrl)}>
                {L('లింక్ కాపీ చేయండి', 'Copy link')}
              </Button>
              <ButtonLink external to={cardUrl} variant="ghost" size="sm" icon={ExternalLink}>
                {L('తెరవండి', 'Open')}
              </ButtonLink>
              <Button variant="ghost" size="sm" icon={RefreshCw} pending={card.isPending} onClick={() => card.mutate(true)}>
                {L('మళ్లీ తయారు చేయండి', 'Regenerate')}
              </Button>
            </>
          ) : null}
        </div>

        {card.data?.available && cardUrl ? (
          <img
            src={cardUrl}
            alt={L('షేర్ చిత్రం', 'Share image')}
            width={240}
            height={126}
            className="rounded-xl border border-rule"
          />
        ) : null}

        {card.data && !card.data.available ? <Note>{card.data.reason ?? L('చిత్రం తయారు కాలేదు.', 'No image was made.')}</Note> : null}
      </div>
    </Section>
  );
}
