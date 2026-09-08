import { KeyboardEvent, useState } from 'react';

import type { CmsTagRef } from '@/types/cms';

/**
 * §1 tags. Type a name and press Enter, or pick a suggestion.
 *
 * Names that do not exist yet are created server-side as topic tags — an
 * editor naming a new person or scheme mid-story should not have to leave the
 * form and visit taxonomy admin first.
 */
export function TagInput({
  value, onChange, suggestions,
}: { value: string[]; onChange: (v: string[]) => void; suggestions: CmsTagRef[] }) {
  const [draft, setDraft] = useState('');

  function add(name: string) {
    const clean = name.trim();
    if (!clean || value.includes(clean)) { setDraft(''); return; }
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

  const unused = suggestions.filter((s) => !value.includes(s.name_te)).slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-control border border-rule-input bg-white p-2 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 dark:bg-surface">
        {value.map((tag) => (
          <span key={tag} className="te inline-flex items-center gap-1 rounded-chip bg-canvas px-2 py-0.5 text-[12px] text-ink">
            {tag}
            <button type="button" aria-label={`${tag} తీసివేయండి`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="font-sans text-[13px] leading-none text-muted hover:text-breaking">×</button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={value.length ? '' : 'ట్యాగ్ టైప్ చేసి Enter నొక్కండి'}
          className="te min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-[13px] text-ink outline-none"
        />
      </div>
      {unused.length ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="te text-[11px] text-muted">సూచనలు:</span>
          {unused.map((s) => (
            <button key={s.id} type="button" onClick={() => add(s.name_te)}
              className="te rounded-chip border border-rule px-2 py-0.5 text-[11.5px] text-ink-soft hover:border-brand hover:text-brand">
              {s.name_te}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
