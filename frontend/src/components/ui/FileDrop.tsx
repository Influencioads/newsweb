import { useRef, useState, type ReactNode } from 'react';
import { UploadCloud, X } from 'lucide-react';

import { Button, IconButton } from './Button';
import { Icon } from './Icon';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * FileDrop — dashed drop zone with a 44px "choose files" button, optional
 * upload progress and removable preview thumbnails.
 *
 *     <FileDrop accept="image/*" multiple onFiles={upload} previews={items} progress={pct} />
 */

export interface FileDropPreview {
  url: string;
  name: string;
  progress?: number;
  onRemove?: () => void;
}

export interface FileDropProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  previews?: FileDropPreview[];
  /** Overall upload progress 0–100; hides the bar when omitted. */
  progress?: number;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  const { t } = useI18n();
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={t('ui.uploading')}
      className={cn('h-1.5 w-full overflow-hidden rounded-pill bg-rule-soft', className)}
    >
      <div className="h-full rounded-pill bg-brand transition-[width] duration-base ease-standard" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function FileDrop({ accept, multiple, onFiles, previews, progress, label, hint, disabled, className }: FileDropProps) {
  const { t } = useI18n();
  const s = useScript();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-rule-strong bg-surface-sub px-4 py-6 text-center',
          'transition-colors duration-base ease-standard',
          over && 'border-brand bg-brand-tint',
          disabled && 'opacity-60',
        )}
      >
        <Icon icon={UploadCloud} size="lg" className="text-muted" />
        <p className={cn(s.body, 'text-ui-sm text-ink-soft')}>{label ?? t('ui.dropFiles')}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>
          {t('ui.chooseFiles')}
        </Button>
        {hint && <p className={cn(s.body, 'text-meta text-muted')}>{hint}</p>}
      </div>
      {progress != null && <ProgressBar value={progress} className="mt-3" />}
      {previews && previews.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-4">
          {previews.map((p) => (
            <li key={p.url} className="relative">
              <img src={p.url} alt={p.name} className="aspect-square w-full rounded-xl border border-rule object-cover" />
              {p.progress != null && p.progress < 100 && (
                <ProgressBar value={p.progress} className="absolute inset-x-2 bottom-2" />
              )}
              {p.onRemove && (
                <IconButton
                  icon={X}
                  label={t('ui.remove')}
                  variant="secondary"
                  iconSize="sm"
                  className="absolute -right-2 -top-2 shadow-card"
                  onClick={p.onRemove}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
