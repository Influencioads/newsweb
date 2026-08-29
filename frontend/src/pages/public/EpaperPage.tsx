import { Newspaper } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useI18n } from '@/i18n';

export default function EpaperPage() {
  const { language } = useI18n();
  const te = language === 'te';
  return (
    <main className="mx-auto flex min-h-[58vh] max-w-[720px] items-center px-4 py-12 text-center">
      <section className="w-full rounded-[6px] border border-rule bg-white px-6 py-12 shadow-sm sm:px-12">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-tint text-brand">
          <Newspaper className="h-7 w-7" aria-hidden />
        </span>
        <p className="mt-5 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">E-PAPER</p>
        <h1 className={`${te ? 'th' : 'font-sans'} mt-2 text-[26px] font-extrabold text-ink`}>
          {te ? 'ఈ-పేపర్ త్వరలో అందుబాటులోకి వస్తుంది' : 'The e-paper is coming soon'}
        </h1>
        <p className={`${te ? 'te' : 'font-sans'} mx-auto mt-3 max-w-[520px] text-[14px] text-muted`}>
          {te ? 'రోజువారీ పూర్తి పత్రికను మొబైల్ మరియు డెస్క్‌టాప్‌లో చదివే సదుపాయాన్ని సిద్ధం చేస్తున్నాం.' : 'We are preparing a complete daily edition optimized for mobile and desktop reading.'}
        </p>
        <Link to="/" className={`${te ? 'te' : 'font-sans'} mt-6 inline-flex min-h-tap items-center rounded-control bg-brand px-6 font-bold text-white hover:bg-brand-dark`}>
          {te ? 'తాజా వార్తలు చూడండి' : 'Browse latest news'}
        </Link>
      </section>
    </main>
  );
}
