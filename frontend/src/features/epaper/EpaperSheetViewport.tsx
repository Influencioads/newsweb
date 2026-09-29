import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { cn } from '@/utils/cn';

import { GUTTER, SHEET_H, SHEET_W } from './print';

/**
 * Fits the fixed 1200 × 1860 sheet into whatever box it is given.
 *
 * At rest the WHOLE page is visible (fit = the smaller of the width and height
 * ratios, like the reference viewer), centred horizontally; `zoom` multiplies
 * that fit (1 = fitted, up to 4× — a phone needs 3–4× to read the 11px body)
 * and the box becomes the pan surface (`overflow-auto`). The sheet keeps its
 * own layout: the scale is one `transform` on a wrapper sized to the scaled
 * canvas, so the page flows and scrolls correctly around it.
 *
 * `--ep-scale` carries the effective scale down to the children; the CMS
 * builder counter-zooms its slot chrome with it so buttons stay 44px on screen.
 */

export const ZOOM = { min: 1, max: 4, step: 0.25 } as const;

export interface EpaperSheetViewportProps {
  /** Multiplier over the fitted scale: 1 = fit, up to 4. Controlled by the parent. */
  zoom: number;
  /** Sheets side by side (the two-page spread); the fit is computed against the doubled canvas. */
  columns?: 1 | 2;
  /**
   * `page` (default) fits the whole sheet into a fixed-height box; `width` fits
   * the width only and lets the box grow with the sheet — the CMS builder,
   * where the page scrolls and a readable sheet matters more than seeing it whole.
   */
  fit?: 'page' | 'width';
  children: ReactNode;
  className?: string;
}

export function EpaperSheetViewport({ zoom, columns = 1, fit: fitMode = 'page', children, className }: EpaperSheetViewportProps) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const canvasW = columns * SHEET_W + (columns - 1) * GUTTER;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      // jsdom and a not-yet-laid-out box report 0: keep the sheet at 1 rather than collapsing it.
      if (width <= 0 || (fitMode === 'page' && height <= 0)) return;
      const ratio = fitMode === 'page' ? Math.min(width / canvasW, height / SHEET_H) : width / canvasW;
      // Floor to 1/10000 so the fitted sheet never overshoots the box by a rounding hair (and grows a scrollbar).
      setFit(Math.floor(ratio * 10_000) / 10_000);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasW, fitMode]);

  const s = fit * zoom;
  const style = { '--ep-scale': s } as CSSProperties;

  return (
    <div ref={box} className={cn('overflow-auto', className)}>
      <div className="mx-auto" style={{ width: canvasW * s, height: SHEET_H * s, ...style }}>
        <div className="flex origin-top-left" style={{ width: canvasW, height: SHEET_H, gap: GUTTER, transform: `scale(${s})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
