import { useEffect, useState } from 'react';

import type { CmsActivePin } from '@/types/cms';

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

export const PIN_PRESETS: Array<[number, string]> = [
  [5, '5 నిమిషాలు'], [10, '10 నిమిషాలు'], [15, '15 నిమిషాలు'], [30, '30 నిమిషాలు'],
  [60, '1 గంట'], [180, '3 గంటలు'], [360, '6 గంటలు'], [720, '12 గంటలు'],
  [1440, '24 గంటలు'], [4320, '3 రోజులు'],
];

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => setLeft(seconds), [seconds]);
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(id);
  }, [left > 0]);
  if (left <= 0) return <span className="font-sans text-[11px] font-bold text-muted">ముగిసింది</span>;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return (
    <span className="font-sans text-[11px] font-bold tabular-nums text-success">
      {h ? `${h}గం ` : ''}{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')} మిగిలింది
    </span>
  );
}

function Slot({
  label, hint, minutes, onChange, live,
}: {
  label: string;
  hint: string;
  minutes: number | null;
  onChange: (v: number | null) => void;
  live?: CmsActivePin;
}) {
  return (
    <div className="rounded-control border border-rule bg-canvas p-3">
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={minutes != null}
          onChange={(e) => onChange(e.target.checked ? 60 : null)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
        />
        <span className="min-w-0 flex-1">
          <span className="te block text-[13px] font-semibold text-ink">{label}</span>
          <span className="te block text-[11.5px] leading-telugu text-muted">{hint}</span>
        </span>
      </label>

      {minutes != null ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6.5">
          <select
            value={minutes}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={`${label} — వ్యవధి`}
            className="rounded-control border border-rule-input bg-white px-2.5 py-1.5 font-sans text-[12.5px] text-ink dark:bg-surface"
          >
            {PIN_PRESETS.map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
          {live ? <Countdown seconds={live.seconds_remaining} /> : (
            <span className="te text-[11.5px] text-muted">ప్రచురణ తర్వాత అమలవుతుంది</span>
          )}
        </div>
      ) : live ? (
        <p className="te mt-2 pl-6.5 text-[11.5px] text-partial">
          ప్రస్తుతం పిన్ చేయబడి ఉంది — <Countdown seconds={live.seconds_remaining} />.
          తీసివేయడానికి పిన్‌ల పేజీని వాడండి.
        </p>
      ) : null}
    </div>
  );
}

export function PlacementPicker({
  homeMinutes, trendingMinutes, activePins, onChange, onApply, applying, applied, disabled,
}: {
  homeMinutes: number | null;
  trendingMinutes: number | null;
  activePins: CmsActivePin[];
  onChange: (home: number | null, trending: number | null) => void;
  /** Present only for a saved article: placement has its own write path. */
  onApply?: () => void;
  applying?: boolean;
  applied?: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <p className="te rounded-control border border-rule bg-canvas p-3 text-[12.5px] text-muted">
        హోమ్ పేజీ, ట్రెండింగ్ స్థానాలను నిర్ణయించడానికి ప్రచురణ అనుమతి కావాలి.
      </p>
    );
  }
  const live = (placement: CmsActivePin['placement']) =>
    activePins.find((p) => p.placement === placement);

  return (
    <div className="space-y-3">
      <Slot
        label="హోమ్ పేజీలో పిన్ చేయండి"
        hint="మొదటి పేజీ పైన కనిపిస్తుంది. వ్యవధి ముగిసాక దానంతట అదే తొలగుతుంది."
        minutes={homeMinutes}
        onChange={(v) => onChange(v, trendingMinutes)}
        live={live('home')}
      />
      <Slot
        label="టాప్ ట్రెండింగ్‌లో చూపండి"
        hint="ట్రెండింగ్ జాబితాలో ముందుంటుంది. స్కోరును మార్చదు — ఆడియన్స్ లెక్కలు నిజాయితీగా ఉంటాయి."
        minutes={trendingMinutes}
        onChange={(v) => onChange(homeMinutes, v)}
        live={live('trending')}
      />
      {onApply ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="te min-h-[34px] rounded-control border border-brand px-3.5 text-[12.5px] font-bold text-brand disabled:opacity-50"
          >
            {applying ? 'వర్తిస్తోంది…' : 'స్థానాన్ని వర్తించండి'}
          </button>
          {applied ? <span className="te text-[12px] text-success">✓ వర్తించింది</span> : null}
        </div>
      ) : null}
    </div>
  );
}
