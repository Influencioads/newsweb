import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PromptDialog, type PromptField } from '@/components/ui/PromptDialog';
import { useToast } from '@/components/ui/Toast';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';
import type { EpaperEdition } from '@/types/epaper';

import { useL } from './shared';

/**
 * Generate (or regenerate) a daily edition: one prompt for the date and the
 * page count, with the plan preview — eligible stories and the suggested page
 * count — as the hint. Shared by the editions list and the workspace.
 */

/** Today in the browser's zone, as the API's `YYYY-MM-DD`. */
const localDate = () => new Date().toLocaleDateString('en-CA');

export interface EpaperGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Regenerate this edition (page count only) instead of generating a new one. */
  edition?: EpaperEdition | null;
  onDone?: (edition: EpaperEdition) => void;
}

export function EpaperGenerateDialog({ open, onClose, edition, onDone }: EpaperGenerateDialogProps) {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const qc = useQueryClient();
  const date = edition?.edition_date ?? localDate();
  const plan = useQuery({
    queryKey: ['admin-epaper', 'plan', date],
    queryFn: () => api.fetchPlan(date),
    enabled: open,
  });

  const run = useMutation({
    mutationFn: (v: Record<string, string>) => {
      const page_count = Math.min(24, Math.max(1, Number(v.page_count) || 0)) || undefined;
      return edition
        ? api.regenerateEdition(edition.id, page_count)
        : api.generateEdition({ edition_date: v.edition_date || undefined, page_count });
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['admin-epaper'] });
      toast.success(t('state.updated'));
      onClose();
      onDone?.(data);
    },
    onError: (e) => toast.error(e),
  });

  const p = plan.data;
  const fields: PromptField[] = [
    ...(edition
      ? []
      : [{ name: 'edition_date', label: L('ఎడిషన్ తేదీ', 'Edition date'), type: 'date' as const, required: true, defaultValue: date }]),
    {
      name: 'page_count',
      label: L('పేజీల సంఖ్య', 'Number of pages'),
      type: 'number',
      required: true,
      defaultValue: String(edition?.page_count || p?.default_page_count || p?.suggested_page_count || 8),
      hint: p
        ? L(
            `${p.candidates} అర్హ కథనాలు · సూచించిన పేజీలు ${p.suggested_page_count} (1–24)`,
            `${p.candidates} eligible stories · suggested ${p.suggested_page_count} pages (1–24)`,
          )
        : L('1 నుంచి 24 పేజీలు', '1 to 24 pages'),
    },
  ];

  return (
    <PromptDialog
      // The defaults come from the plan, so the form mounts once the plan has answered (or failed).
      open={open && !plan.isLoading}
      onClose={onClose}
      title={edition ? L('ఎడిషన్‌ను మళ్లీ జనరేట్ చేయాలా?', 'Regenerate this edition?') : L('ఈ-పేపర్ జనరేట్ చేయండి', 'Generate the E-Paper')}
      description={
        edition
          ? L(
              'ప్రతి పేజీ మళ్లీ నిర్మించబడుతుంది; చేతితో చేసిన మార్పులు పోతాయి.',
              'Rebuilds every page and discards manual edits.',
            )
          : L(
              'ప్రచురించిన కథనాల నుంచి పేజీలు స్వయంగా నిండుతాయి; తర్వాత సర్దుబాటు చేయవచ్చు.',
              'Pages fill themselves from published stories; adjust them afterwards.',
            )
      }
      fields={fields}
      submitLabel={edition ? L('మళ్లీ జనరేట్', 'Regenerate') : L('జనరేట్ చేయండి', 'Generate')}
      pending={run.isPending}
      onSubmit={(v) => run.mutate(v)}
    />
  );
}
