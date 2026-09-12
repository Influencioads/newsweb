import { useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';

import { IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Field';
import { useI18n, useScript } from '@/i18n';
import type { CmsTagRef } from '@/types/cms';
import { cn } from '@/utils/cn';

/**
 * §1 tags. Type a name and press Enter (or the add button), or pick a
 * suggestion. Each chosen tag is a chip that removes itself when pressed.
 *
 * Names that do not exist yet are created server-side as topic tags — an
 * editor naming a new person or scheme mid-story should not have to leave the
 * form and visit taxonomy admin first. Wrap in a `Field` for the label.
 */
export interface TagInputProps {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: CmsTagRef[];
}

export function TagInput({ value, onChange, suggestions }: TagInputProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [draft, setDraft] = useState('');

  function add(name: string) {
    const clean = name.trim();
    if (!clean || value.includes(clean)) {
      setDraft('');
      return;
    }
    onChange([...value, clean]);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && !draft && value.length) {
      // Backspace on an empty box removes the last chip — the behaviour every
      // tag field has, and its absence reads as broken.
      onChange(value.slice(0, -1));
    }
  }

  const unused = suggestions.filter((sg) => !value.includes(sg.name_te)).slice(0, 8);

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul aria-label={L('ఎంచుకున్న ట్యాగ్‌లు', 'Selected tags')} className="flex flex-wrap gap-2">
          {value.map((tag) => (
            <li key={tag}>
              <Chip as="button" selected lang="te" icon={X} onClick={() => onChange(value.filter((v) => v !== tag))}>
                {tag}
                <span className="sr-only">, {t('ui.remove')}</span>
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        script="te"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={L('ట్యాగ్ టైప్ చేసి Enter నొక్కండి', 'Type a tag and press Enter')}
        trailing={<IconButton icon={Plus} label={t('ui.add')} disabled={!draft.trim()} onClick={() => add(draft)} />}
      />
      {unused.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(s.body, 'text-meta text-muted')}>{L('సూచనలు:', 'Suggestions:')}</span>
          {unused.map((sg) => (
            <Chip key={sg.id} as="button" lang="te" icon={Plus} onClick={() => add(sg.name_te)}>
              {sg.name_te}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}
