import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap } from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { CmsArticle } from '@/types/cms';
import { cn } from '@/utils/cn';

/**
 * What the reviewer should know about a story's photo and the AI's breaking
 * guess, on the queue tile rather than three clicks deep.
 *
 * The photo line is the crawl's own account of where the hero came from: the
 * vision scan found no branding, it was never scanned, it is a free-licence
 * file photo of the story's subject, or an AI-made representative picture. A
 * story with no hero cannot be published, so
 * "needs photo" says why approve will not be the last step.
 *
 * "AI suggests breaking" is only a suggestion — nothing sets the flag from it.
 * "Mark breaking" is the existing breaking control, so it needs the same
 * `article.breaking` authority; on an unpublished story the server leaves the
 * window open and publish starts the configured default from the moment it is
 * live, so the minutes sent here only matter for a story that was live before.
 */

/** The out-of-box breaking window, for the rare re-reviewed story that was live before. */
const WINDOW_MINUTES = 24 * 60;

function heroHint(article: CmsArticle, L: (te: string, en: string) => string): [BadgeTone, string] | null {
  const hero = article.hero_media;
  if (!article.hero_media_id) return ['partial', L('ఫోటో కావాలి', 'needs photo')];
  if (!hero) return null;
  if (hero.ai_generated) return ['ai', L('ప్రతీకాత్మక AI చిత్రం', 'representative AI picture')];
  if (hero.source_type === 'public_domain') return ['info', L('ఉచిత లైసెన్స్ ఫోటో', 'free-licence photo')];
  if (hero.checked) return ['success', L('వాటర్‌మార్క్ కనిపించలేదు', 'no watermark found')];
  // A publisher's photo the scan never looked at. Desk photos get no badge.
  if (hero.source_type === 'syndicated') return ['muted', L('స్కాన్ చేయలేదు', 'not scanned')];
  return null;
}

export function AiHintBadges({ article, className }: { article: CmsArticle; className?: string }) {
  const { language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const can = useAuth((st) => st.can);
  const toast = useToast();
  const client = useQueryClient();
  const mark = useMutation({
    mutationFn: () => cmsApi.setBreaking(article.id, { minutes: WINDOW_MINUTES }),
    onSuccess: () => {
      toast.success(L('బ్రేకింగ్‌గా గుర్తించాం.', 'Marked as breaking.'));
      void client.invalidateQueries({ queryKey: ['cms'] });
    },
    onError: (e) => toast.error(e),
  });

  const photo = heroHint(article, L);
  const suggestBreaking = article.breaking_suggested && !article.is_breaking;
  if (!photo && !suggestBreaking) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {photo ? <Badge tone={photo[0]} size="xs">{photo[1]}</Badge> : null}
      {suggestBreaking ? (
        <>
          <Badge tone="exclusive" size="xs" icon={Zap}>{L('AI: బ్రేకింగ్ కావచ్చు', 'AI suggests breaking')}</Badge>
          {can('article.breaking') ? (
            <Button
              size="sm"
              variant="secondary"
              pending={mark.isPending}
              // Rows in the pending list navigate on click; this must not.
              onClick={(e) => { e.stopPropagation(); mark.mutate(); }}
            >
              {L('బ్రేకింగ్‌గా గుర్తించండి', 'Mark breaking')}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
