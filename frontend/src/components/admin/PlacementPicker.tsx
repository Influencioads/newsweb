import { useEffect, useState } from 'react';
import { Check, Pin } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, Select } from '@/components/ui/Field';
import { useI18n, useScript } from '@/i18n';
import type { CmsActivePin } from '@/types/cms';
import { cn } from '@/utils/cn';

/**
 * §8 / §9 — "pin to home page" and "show in Top trending", from the form the
 * story is written in.
 *
 * A pin cannot exist before the article is live, but the person deciding what
 * leads the front page is writing it, not watching the pin screen. So the
 * choice is held on the article and becomes a real pin at publication; on an
 * already-published story it applies immediately.
 *
 * §8 forbids editor overrides from inflating a trending score, so "Top
 * trending" is a pin too — it leads the rail, expires by itself, and leaves an
 * audit row. The computed scores underneath stay honest.
 */

/** [minutes, Telugu label, English label] */
export const PIN_PRESETS: Array<[number, string, string]> = [
  [5, '5 నిమిషాలు', '5 min'],
  [10, '10 నిమిషాలు', '10 min'],
  [15, '15 నిమిషాలు', '15 min'],
  [30, '30 నిమిషాలు', '30 min'],
  [60, '1 గంట', '1 hour'],
  [180, '3 గంటలు', '3 hours'],
  [360, '6 గంటలు', '6 hours'],
  [720, '12 గంటలు', '12 hours'],
  [1440, '24 గంటలు', '24 hours'],
  [4320, '3 రోజులు', '3 days'],
];

function Countdown({ seconds }: { seconds: number }) {
  const { language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [left, setLeft] = useState(seconds);
  useEffect(() => setLeft(seconds), [seconds]);
  const running = left > 0;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (left <= 0) return <span className="font-sans text-meta font-bold text-muted">{L('ముగిసింది', 'Expired')}</span>;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  return (
    <span className="font-sans text-meta font-bold tabular-nums text-success">
      {h ? `${h}${L('గం', 'h')} ` : ''}
      {String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')} {L('మిగిలింది', 'left')}
    </span>
  );
}

function Slot({
  label,
  hint,
  minutes,
  onChange,
  live,
}: {
  label: string;
  hint: string;
  minutes: number | null;
  onChange: (v: number | null) => void;
  live?: CmsActivePin;
}) {
  const { language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  return (
    <Card padding="sm" tone="paper">
      <Checkbox checked={minutes != null} onChange={(checked) => onChange(checked ? 60 : null)} label={label} hint={hint} />
      {minutes != null ? (
        <div className="mt-2 space-y-2 pl-8">
          <Select value={minutes} onChange={(e) => onChange(Number(e.target.value))} aria-label={`${label} — ${L('వ్యవధి', 'Duration')}`}>
            {PIN_PRESETS.map(([value, te, en]) => (
              <option key={value} value={value}>
                {L(te, en)}
              </option>
            ))}
          </Select>
          {live ? <Countdown seconds={live.seconds_remaining} /> : <p className={cn(s.body, 'text-meta text-muted')}>{L('ప్రచురణ తర్వాత అమలవుతుంది', 'Takes effect after publication')}</p>}
        </div>
      ) : live ? (
        <p className={cn(s.body, 'mt-2 pl-8 text-meta text-partial')}>
          {L('ప్రస్తుతం పిన్ చేయబడి ఉంది', 'Currently pinned')} — <Countdown seconds={live.seconds_remaining} />.{' '}
          {L('తీసివేయడానికి పిన్‌ల పేజీని వాడండి.', 'Use the pins page to remove it.')}
        </p>
      ) : null}
    </Card>
  );
}

export interface PlacementPickerProps {
  homeMinutes: number | null;
  trendingMinutes: number | null;
  activePins: CmsActivePin[];
  onChange: (home: number | null, trending: number | null) => void;
  /** Present only for a saved article: placement has its own write path. */
  onApply?: () => void;
  applying?: boolean;
  applied?: boolean;
  disabled?: boolean;
}

export function PlacementPicker({ homeMinutes, trendingMinutes, activePins, onChange, onApply, applying, applied, disabled }: PlacementPickerProps) {
  const { language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);

  if (disabled) {
    return (
      <Card padding="sm" tone="paper">
        <p className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui', 'text-muted')}>
          {L('హోమ్ పేజీ, ట్రెండింగ్ స్థానాలను నిర్ణయించడానికి ప్రచురణ అనుమతి కావాలి.', 'Deciding home-page and trending placement needs publish permission.')}
        </p>
      </Card>
    );
  }
  const live = (placement: CmsActivePin['placement']) => activePins.find((p) => p.placement === placement);

  return (
    <div className="space-y-3">
      <Slot
        label={L('హోమ్ పేజీలో పిన్ చేయండి', 'Pin on the home page')}
        hint={L('మొదటి పేజీ పైన కనిపిస్తుంది. వ్యవధి ముగిసాక దానంతట అదే తొలగుతుంది.', 'Leads the front page and unpins itself when the time is up.')}
        minutes={homeMinutes}
        onChange={(v) => onChange(v, trendingMinutes)}
        live={live('home')}
      />
      <Slot
        label={L('టాప్ ట్రెండింగ్‌లో చూపండి', 'Show in Top trending')}
        hint={L('ట్రెండింగ్ జాబితాలో ముందుంటుంది. స్కోరును మార్చదు — ఆడియన్స్ లెక్కలు నిజాయితీగా ఉంటాయి.', 'Leads the trending rail without touching the score — audience numbers stay honest.')}
        minutes={trendingMinutes}
        onChange={(v) => onChange(homeMinutes, v)}
        live={live('trending')}
      />
      {onApply ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={Pin} pending={applying} onClick={onApply}>
            {L('స్థానాన్ని వర్తించండి', 'Apply placement')}
          </Button>
          {applied ? (
            <Badge tone="success" icon={Check}>
              {L('వర్తించింది', 'Applied')}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
