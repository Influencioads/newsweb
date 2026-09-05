import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

/** §19 Trending / Pinned News / Notifications / Analytics admin modules. */

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <main className="mx-auto max-w-7xl px-4 py-6"><header className="mb-5"><h1 className="th text-[25px] font-extrabold">{title}</h1><p className="te mt-1 text-[12px] text-muted">{subtitle}</p></header>{children}</main>;
}

function State({ loading, error }: { loading: boolean; error: boolean }) {
  const { language } = useI18n();
  if (loading) return <p className="te rounded-card border border-rule bg-white p-5">{language === 'te' ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>;
  if (error) return <p role="alert" className="te rounded-card border border-breaking-border bg-breaking-tint p-5 text-breaking">{language === 'te' ? 'లోడ్ కాలేదు. అనుమతులు తనిఖీ చేయండి.' : 'Could not load. Check your permissions.'}</p>;
  return null;
}

// --------------------------------------------------------------------------- #
type PinRow = { id: number; article_title_te: string | null; article_short_id: string | null; placement: string; starts_at: string; ends_at: string; active: boolean; note: string | null };
type TrendRow = { rank: number; score: number; article_id: number; short_id: string; title_te: string; view_count: number; like_count: number; comment_count: number; share_count: number; is_pinned: boolean };

export function PinsPage() {
  const { language } = useI18n(); const en = language === 'en';
  const queryClient = useQueryClient();
  const [articleId, setArticleId] = useState('');
  const [placement, setPlacement] = useState('home');
  const [scopeSlug, setScopeSlug] = useState('');
  const [hours, setHours] = useState('24');
  const pins = useQuery({ queryKey: ['cms', 'pins'], queryFn: () => cmsApi.fetchPins<{ items: PinRow[] }>() });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'pins'] });
  const create = useMutation({
    mutationFn: () => cmsApi.createPin({
      article_id: Number(articleId), placement,
      category_slug: placement === 'category' ? scopeSlug : null,
      district_slug: placement === 'local' ? scopeSlug : null,
      duration_hours: Number(hours),
    }),
    onSuccess: () => { setArticleId(''); invalidate(); },
  });
  const remove = useMutation({ mutationFn: (id: number) => cmsApi.removePin(id), onSuccess: invalidate });
  const inputCls = 'rounded-control border border-rule-input bg-white px-2 py-2 font-sans text-[12.5px]';
  return <Shell title={en ? 'Pinned news' : 'పిన్ చేసిన వార్తలు'} subtitle={en ? 'Editorial slots with automatic expiry (§9)' : 'ఆటోమేటిక్ గడువుతో సంపాదకీయ స్లాట్లు'}>
    <div className="mb-5 flex flex-wrap items-end gap-2 rounded-card border border-rule bg-white p-4">
      <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">Article ID
        <input value={articleId} onChange={(e) => setArticleId(e.target.value.replace(/\D/g, ''))} className={`${inputCls} w-28`} placeholder="123" /></label>
      <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Placement' : 'స్థానం'}
        <select value={placement} onChange={(e) => setPlacement(e.target.value)} className={inputCls}>
          <option value="home">Home top</option><option value="category">Category top</option><option value="local">Local top</option>
        </select></label>
      {placement !== 'home' ? (
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">{placement === 'category' ? 'Category slug' : 'District slug'}
          <input value={scopeSlug} onChange={(e) => setScopeSlug(e.target.value)} className={`${inputCls} w-40`} placeholder={placement === 'category' ? 'cinema' : 'guntur'} /></label>
      ) : null}
      <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Duration' : 'వ్యవధి'}
        <select value={hours} onChange={(e) => setHours(e.target.value)} className={inputCls}>
          {['1', '6', '12', '24', '72'].map((h) => <option key={h} value={h}>{h}h</option>)}
        </select></label>
      <button type="button" disabled={!articleId || create.isPending} onClick={() => create.mutate()}
        className="min-h-[38px] rounded-control bg-brand px-4 font-sans text-[12.5px] font-bold text-white disabled:opacity-50">
        {en ? 'Pin it' : 'పిన్ చేయండి'}</button>
      {create.isError ? <p className="w-full font-sans text-[11px] text-breaking">{String(create.error)}</p> : null}
    </div>
    <State loading={pins.isLoading} error={pins.isError} />
    <div className="space-y-2">
      {pins.data?.items.map((p) => (
        <article key={p.id} className="flex flex-wrap items-center gap-3 rounded-card border border-rule bg-white p-3">
          <span className={`rounded-chip px-2 py-0.5 font-sans text-[10px] font-bold uppercase ${p.active ? 'bg-success-tint text-success' : 'bg-paper text-muted'}`}>{p.placement}</span>
          <span className="te min-w-0 flex-1 truncate text-[14px] font-semibold">{p.article_title_te ?? p.article_short_id}</span>
          <span className="font-sans text-[11px] text-muted">{en ? 'ends' : 'ముగింపు'} {new Date(p.ends_at).toLocaleString('en-IN')}</span>
          {p.active ? <button type="button" onClick={() => remove.mutate(p.id)} className="rounded-control border border-breaking px-3 py-1.5 font-sans text-[11px] font-bold text-breaking">{en ? 'Unpin' : 'తీసివేయండి'}</button> : null}
        </article>
      ))}
      {pins.data && pins.data.items.length === 0 ? <p className="te rounded-card border border-rule bg-white p-6 text-center text-muted">{en ? 'No active pins.' : 'పిన్‌లు లేవు.'}</p> : null}
    </div>
  </Shell>;
}

// --------------------------------------------------------------------------- #
export function TrendingAdminPage() {
  const { language } = useI18n(); const en = language === 'en';
  const queryClient = useQueryClient();
  const scores = useQuery({ queryKey: ['cms', 'trending'], queryFn: () => cmsApi.fetchTrendingScores<{ items: TrendRow[] }>() });
  const recompute = useMutation({ mutationFn: cmsApi.recomputeTrending, onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['cms', 'trending'] }) });
  return <Shell title={en ? 'Trending' : 'ట్రెండింగ్'} subtitle={en ? 'Time-decayed engagement scores; feature stories via Pins (§8, §19)' : 'సమయ క్షీణతతో ఎంగేజ్‌మెంట్ స్కోర్లు'}>
    <div className="mb-4">
      <button type="button" onClick={() => recompute.mutate()} disabled={recompute.isPending}
        className="min-h-[38px] rounded-control border border-brand px-4 font-sans text-[12.5px] font-bold text-brand disabled:opacity-50">
        {recompute.isPending ? '…' : en ? 'Recompute now' : 'ఇప్పుడు లెక్కించండి'}</button>
    </div>
    <State loading={scores.isLoading} error={scores.isError} />
    {scores.data ? (
      <div className="overflow-x-auto rounded-card border border-rule bg-white shadow-card">
        <table className="w-full min-w-[760px] text-left">
          <thead className="bg-paper font-sans text-[10px] uppercase tracking-wide text-muted">
            <tr><th className="px-3 py-2.5">#</th><th className="px-3 py-2.5">{en ? 'Story' : 'కథనం'}</th><th className="px-3 py-2.5">Score</th><th className="px-3 py-2.5">{en ? 'Views' : 'వీక్షణలు'}</th><th className="px-3 py-2.5">♥</th><th className="px-3 py-2.5">💬</th><th className="px-3 py-2.5">↗</th><th className="px-3 py-2.5">{en ? 'Pinned' : 'పిన్'}</th></tr>
          </thead>
          <tbody>
            {scores.data.items.map((r) => (
              <tr key={r.short_id} className="border-t border-rule-soft">
                <td className="px-3 py-2.5 font-sans text-[13px] font-extrabold text-brand">{r.rank}</td>
                <td className="max-w-[420px] px-3 py-2.5"><span className="te text-[13.5px] font-semibold">{r.title_te}</span><span className="ml-2 font-mono text-[10px] text-muted">{r.article_id}</span></td>
                <td className="px-3 py-2.5 font-sans text-[12px]">{r.score.toFixed(2)}</td>
                <td className="px-3 py-2.5 font-sans text-[12px]">{r.view_count}</td>
                <td className="px-3 py-2.5 font-sans text-[12px]">{r.like_count}</td>
                <td className="px-3 py-2.5 font-sans text-[12px]">{r.comment_count}</td>
                <td className="px-3 py-2.5 font-sans text-[12px]">{r.share_count}</td>
                <td className="px-3 py-2.5 font-sans text-[12px]">{r.is_pinned ? '📌' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {scores.data.items.length === 0 ? <p className="te p-6 text-center text-muted">{en ? 'No reader activity scored yet.' : 'ఇంకా స్కోర్ చేసిన కార్యకలాపం లేదు.'}</p> : null}
      </div>
    ) : null}
  </Shell>;
}

// --------------------------------------------------------------------------- #
type Analytics = {
  dau: number; wau: number; mau: number; reads_7d: number; avg_read_seconds_7d: number;
  avg_scroll_pct_7d: number; registered_readers: number; likes_total: number;
  bookmarks_total: number; comments_total: number; follows_total: number;
  top_articles_7d: Array<{ title_te: string; short_id: string; reads: number }>;
  top_categories_7d: Array<{ name_te: string; slug: string; reads: number }>;
  top_districts_7d: Array<{ name_te: string; slug: string; reads: number }>;
  top_searches_7d: Array<{ query: string; count: number }>;
};

export function AnalyticsPage() {
  const { language } = useI18n(); const en = language === 'en';
  const q = useQuery({ queryKey: ['cms', 'analytics'], queryFn: () => cmsApi.fetchAnalytics<Analytics>() });
  const stat = (label: string, value: string | number) => (
    <div className="rounded-card border border-rule bg-white p-4"><dt className="font-sans text-[10px] uppercase text-muted">{label}</dt><dd className="mt-1 font-sans text-[22px] font-extrabold text-ink">{value}</dd></div>
  );
  const rankTable = (title: string, rows: Array<{ label: string; n: number }>) => (
    <section className="rounded-card border border-rule bg-white p-4">
      <h2 className="te mb-2 text-[14px] font-bold text-brand">{title}</h2>
      {rows.length === 0 ? <p className="font-sans text-[11px] text-muted">—</p> : (
        <ol className="space-y-1.5">{rows.map((r, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span className="w-4 font-sans text-[11px] font-bold text-muted-light">{i + 1}</span>
            <span className="te min-w-0 flex-1 truncate text-[12.5px]">{r.label}</span>
            <span className="font-sans text-[11px] font-semibold text-muted">{r.n}</span>
          </li>))}
        </ol>)}
    </section>
  );
  return <Shell title={en ? 'Analytics' : 'విశ్లేషణలు'} subtitle={en ? 'Reader behaviour from the event stream (§25)' : 'ఈవెంట్ స్ట్రీమ్ నుంచి పాఠకుల ప్రవర్తన'}>
    <State loading={q.isLoading} error={q.isError} />
    {q.data ? <>
      <dl className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stat('DAU', q.data.dau)}{stat('WAU', q.data.wau)}{stat('MAU', q.data.mau)}
        {stat(en ? 'Reads 7d' : 'పఠనాలు 7రో', q.data.reads_7d)}
        {stat(en ? 'Avg read (s)' : 'సగటు పఠనం (సె)', q.data.avg_read_seconds_7d)}
        {stat(en ? 'Avg scroll %' : 'సగటు స్క్రోల్ %', q.data.avg_scroll_pct_7d)}
      </dl>
      <dl className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stat(en ? 'Readers' : 'పాఠకులు', q.data.registered_readers)}
        {stat(en ? 'Likes' : 'ఇష్టాలు', q.data.likes_total)}
        {stat(en ? 'Bookmarks' : 'సేవ్‌లు', q.data.bookmarks_total)}
        {stat(en ? 'Comments' : 'వ్యాఖ్యలు', q.data.comments_total)}
        {stat(en ? 'Follows' : 'ఫాలోలు', q.data.follows_total)}
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        {rankTable(en ? 'Top stories (7d)' : 'టాప్ కథనాలు (7 రోజులు)', q.data.top_articles_7d.map((a) => ({ label: a.title_te, n: a.reads })))}
        {rankTable(en ? 'Top sections (7d)' : 'టాప్ విభాగాలు', q.data.top_categories_7d.map((c) => ({ label: c.name_te, n: c.reads })))}
        {rankTable(en ? 'Top districts (7d)' : 'టాప్ జిల్లాలు', q.data.top_districts_7d.map((d) => ({ label: d.name_te, n: d.reads })))}
        {rankTable(en ? 'Top searches (7d)' : 'టాప్ శోధనలు', q.data.top_searches_7d.map((s) => ({ label: s.query, n: s.count })))}
      </div>
    </> : null}
  </Shell>;
}

// --------------------------------------------------------------------------- #
type VideoRow = { id: number; youtube_id: string; thumbnail_url: string; watch_url: string; title_te: string; is_published: boolean; published_at: string | null };

export function VideosAdminPage() {
  const { language } = useI18n(); const en = language === 'en';
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const list = useQuery({ queryKey: ['cms', 'videos'], queryFn: () => cmsApi.fetchCmsVideos<{ items: VideoRow[] }>() });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'videos'] });
  const add = useMutation({
    mutationFn: () => cmsApi.addCmsVideo({ youtube_url: url, title_te: title, category_slug: categorySlug || null }),
    onSuccess: () => { setUrl(''); setTitle(''); invalidate(); },
  });
  const toggle = useMutation({
    mutationFn: (video: VideoRow) => cmsApi.patchCmsVideo(video.id, { is_published: !video.is_published }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => cmsApi.deleteCmsVideo(id), onSuccess: invalidate });
  const inputCls = 'w-full rounded-control border border-rule-input bg-white px-3 py-2 text-[13.5px]';
  return <Shell title={en ? 'Videos' : 'వీడియోలు'} subtitle={en ? 'YouTube links only — paste a URL, it joins the hub (§15)' : 'YouTube లింక్ అతికించండి — హబ్‌లో చేరుతుంది'}>
    <div className="mb-5 rounded-card border border-rule bg-white p-4">
      <div className="grid gap-3 md:grid-cols-[2fr_2fr_1fr_auto]">
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">YouTube URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} className={`${inputCls} font-mono`} placeholder="https://youtu.be/…" /></label>
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Title (Telugu)' : 'శీర్షిక'}
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`te ${inputCls}`} placeholder="వీడియో శీర్షిక…" /></label>
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">Category slug
          <input value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={inputCls} placeholder="cinema" /></label>
        <button type="button" disabled={!url.trim() || title.trim().length < 3 || add.isPending} onClick={() => add.mutate()}
          className="min-h-[38px] self-end rounded-control bg-brand px-4 font-sans text-[12.5px] font-bold text-white disabled:opacity-50">
          {add.isPending ? '…' : en ? 'Add' : 'జోడించండి'}</button>
      </div>
      {add.isError ? <p className="mt-2 font-sans text-[11px] text-breaking">{String(add.error)}</p> : null}
    </div>
    <State loading={list.isLoading} error={list.isError} />
    <div className="space-y-2">
      {list.data?.items.map((v) => (
        <article key={v.id} className="flex flex-wrap items-center gap-3 rounded-card border border-rule bg-white p-3">
          <img src={v.thumbnail_url} alt="" className="h-12 w-20 rounded object-cover" loading="lazy" />
          <span className="te min-w-0 flex-1 truncate text-[14px] font-semibold">{v.title_te}</span>
          <a href={v.watch_url} target="_blank" rel="noopener noreferrer" className="font-mono text-[10.5px] text-info hover:underline">{v.youtube_id}</a>
          <span className={`rounded-chip px-2 py-0.5 font-sans text-[10px] font-bold uppercase ${v.is_published ? 'bg-success-tint text-success' : 'bg-paper text-muted'}`}>
            {v.is_published ? (en ? 'Live' : 'ప్రచురితం') : en ? 'Hidden' : 'దాచబడింది'}</span>
          <button type="button" onClick={() => toggle.mutate(v)} className="rounded-control border border-rule px-3 py-1.5 font-sans text-[11px] font-bold text-ink hover:border-brand">
            {v.is_published ? (en ? 'Unpublish' : 'దాచండి') : en ? 'Publish' : 'ప్రచురించండి'}</button>
          <button type="button" onClick={() => remove.mutate(v.id)} className="rounded-control border border-breaking px-3 py-1.5 font-sans text-[11px] font-bold text-breaking">
            {en ? 'Delete' : 'తొలగించండి'}</button>
        </article>
      ))}
      {list.data && list.data.items.length === 0 ? <p className="te rounded-card border border-rule bg-white p-6 text-center text-muted">{en ? 'No videos yet.' : 'వీడియోలు లేవు.'}</p> : null}
    </div>
  </Shell>;
}

// --------------------------------------------------------------------------- #
type AdRow = { id: number; name: string; image_url: string; target_url: string; placement: string; starts_at: string; ends_at: string; is_active: boolean; weight: number; impressions: number; clicks: number; ctr_percent: number };

export function AdsPage() {
  const { language } = useI18n(); const en = language === 'en';
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [placement, setPlacement] = useState('in_feed');
  const [days, setDays] = useState('7');
  const list = useQuery({ queryKey: ['cms', 'ads'], queryFn: () => cmsApi.fetchAds<{ items: AdRow[] }>() });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'ads'] });
  const create = useMutation({
    mutationFn: () => cmsApi.createAd({ name, image_url: imageUrl, target_url: targetUrl, placement, duration_days: Number(days) }),
    onSuccess: () => { setName(''); setImageUrl(''); setTargetUrl(''); invalidate(); },
  });
  const toggle = useMutation({ mutationFn: (ad: AdRow) => cmsApi.patchAd(ad.id, { is_active: !ad.is_active }), onSuccess: invalidate });
  const end = useMutation({ mutationFn: (id: number) => cmsApi.endAd(id), onSuccess: invalidate });
  const inputCls = 'w-full rounded-control border border-rule-input bg-white px-3 py-2 font-sans text-[12.5px]';
  const now = Date.now();
  return <Shell title={en ? 'Ads' : 'ప్రకటనలు'} subtitle={en ? 'House campaigns with §26 impression/click analytics and clear labeling' : 'ఇంప్రెషన్/క్లిక్ గణాంకాలతో సొంత ప్రకటనలు'}>
    <div className="mb-5 rounded-card border border-rule bg-white p-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Name' : 'పేరు'}
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Sankranti sale" /></label>
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">Image URL
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={`${inputCls} font-mono`} placeholder="https://…/banner.png" /></label>
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">Target URL
          <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} className={`${inputCls} font-mono`} placeholder="https://…" /></label>
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Placement' : 'స్థానం'}
          <select value={placement} onChange={(e) => setPlacement(e.target.value)} className={inputCls}>
            <option value="top_banner">Top banner</option><option value="in_feed">In-feed</option>
            <option value="article">Article page</option><option value="category">Category page</option>
          </select></label>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Days' : 'రోజులు'}
            <select value={days} onChange={(e) => setDays(e.target.value)} className={inputCls}>
              {['1', '7', '14', '30'].map((d) => <option key={d} value={d}>{d}</option>)}
            </select></label>
          <button type="button" disabled={!name.trim() || !imageUrl.trim() || !targetUrl.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="min-h-[38px] rounded-control bg-brand px-4 font-sans text-[12.5px] font-bold text-white disabled:opacity-50">
            {create.isPending ? '…' : en ? 'Launch' : 'ప్రారంభించండి'}</button>
        </div>
      </div>
      {create.isError ? <p className="mt-2 font-sans text-[11px] text-breaking">{String(create.error)}</p> : null}
    </div>
    <State loading={list.isLoading} error={list.isError} />
    <div className="space-y-2">
      {list.data?.items.map((ad) => {
        const live = ad.is_active && new Date(ad.ends_at).getTime() > now;
        return (
          <article key={ad.id} className="flex flex-wrap items-center gap-3 rounded-card border border-rule bg-white p-3">
            <img src={ad.image_url} alt="" className="h-10 w-20 rounded border border-rule object-cover" loading="lazy" />
            <span className="min-w-0 flex-1 truncate font-sans text-[13px] font-bold">{ad.name}</span>
            <span className="rounded-chip bg-paper px-2 py-0.5 font-mono text-[10px] text-muted">{ad.placement}</span>
            <span className="font-sans text-[11px] text-muted">{ad.impressions} imp · {ad.clicks} clicks · {ad.ctr_percent}% CTR</span>
            <span className={`rounded-chip px-2 py-0.5 font-sans text-[10px] font-bold uppercase ${live ? 'bg-success-tint text-success' : 'bg-paper text-muted'}`}>{live ? (en ? 'Live' : 'ప్రత్యక్షం') : en ? 'Ended' : 'ముగిసింది'}</span>
            {live ? <>
              <button type="button" onClick={() => toggle.mutate(ad)} className="rounded-control border border-rule px-3 py-1.5 font-sans text-[11px] font-bold text-ink hover:border-brand">{en ? 'Pause' : 'ఆపండి'}</button>
              <button type="button" onClick={() => end.mutate(ad.id)} className="rounded-control border border-breaking px-3 py-1.5 font-sans text-[11px] font-bold text-breaking">{en ? 'End now' : 'ముగించండి'}</button>
            </> : !ad.is_active && new Date(ad.ends_at).getTime() > now ? (
              <button type="button" onClick={() => toggle.mutate(ad)} className="rounded-control border border-success px-3 py-1.5 font-sans text-[11px] font-bold text-success">{en ? 'Resume' : 'కొనసాగించండి'}</button>
            ) : null}
          </article>
        );
      })}
      {list.data && list.data.items.length === 0 ? <p className="te rounded-card border border-rule bg-white p-6 text-center text-muted">{en ? 'No campaigns yet.' : 'ప్రచారాలు లేవు.'}</p> : null}
    </div>
  </Shell>;
}

// --------------------------------------------------------------------------- #
type CampaignRow = { id: number; title_te: string; audience: string; sent_count: number; created_at: string };

export function NotificationsAdminPage() {
  const { language } = useI18n(); const en = language === 'en';
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [audienceSlug, setAudienceSlug] = useState('');
  const log = useQuery({ queryKey: ['cms', 'campaigns'], queryFn: () => cmsApi.fetchCampaigns<{ items: CampaignRow[] }>() });
  const send = useMutation({
    mutationFn: () => cmsApi.sendCampaign({
      title_te: title, body_te: body || null,
      audience: audience === 'all' ? 'all' : `${audience}:${audienceSlug}`,
    }),
    onSuccess: () => { setTitle(''); setBody(''); void queryClient.invalidateQueries({ queryKey: ['cms', 'campaigns'] }); },
  });
  const inputCls = 'w-full rounded-control border border-rule-input bg-white px-3 py-2 text-[14px]';
  return <Shell title={en ? 'Notifications' : 'నోటిఫికేషన్లు'} subtitle={en ? 'Compose and send reader alerts (§13); level-60 approval enforced by the API' : 'పాఠకులకు ప్రకటనలు పంపండి'}>
    <div className="mb-5 rounded-card border border-rule bg-white p-4">
      <label className="mb-1 block font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Title (Telugu)' : 'శీర్షిక'} <span className="text-breaking">*</span></label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={`te ${inputCls}`} placeholder="ముఖ్యమైన ప్రకటన…" />
      <p className="mt-0.5 text-right font-sans text-[10px] text-muted-light">{title.length}/120</p>
      <label className="mb-1 block font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Body (optional)' : 'వివరము'}</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={500} className={`te ${inputCls}`} />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">{en ? 'Audience' : 'శ్రోతలు'}
          <select value={audience} onChange={(e) => setAudience(e.target.value)} className="rounded-control border border-rule-input bg-white px-2 py-2 font-sans text-[12.5px]">
            <option value="all">{en ? 'All readers' : 'అందరు పాఠకులు'}</option>
            <option value="district">{en ? 'District followers' : 'జిల్లా ఫాలోవర్లు'}</option>
            <option value="category">{en ? 'Category followers' : 'విభాగ ఫాలోవర్లు'}</option>
          </select></label>
        {audience !== 'all' ? (
          <label className="flex flex-col gap-1 font-sans text-[10.5px] font-bold uppercase text-muted">Slug
            <input value={audienceSlug} onChange={(e) => setAudienceSlug(e.target.value)} className="w-40 rounded-control border border-rule-input bg-white px-2 py-2 font-sans text-[12.5px]" placeholder={audience === 'district' ? 'guntur' : 'cinema'} /></label>
        ) : null}
        <button type="button" disabled={!title.trim() || send.isPending || (audience !== 'all' && !audienceSlug)} onClick={() => send.mutate()}
          className="min-h-[38px] rounded-control bg-brand px-5 font-sans text-[12.5px] font-bold text-white disabled:opacity-50">
          {send.isPending ? '…' : en ? 'Send now' : 'పంపండి'}</button>
      </div>
      {send.isError ? <p className="mt-2 font-sans text-[11px] text-breaking">{String(send.error)}</p> : null}
      {send.isSuccess ? <p className="mt-2 font-sans text-[11px] font-bold text-success">{en ? 'Sent.' : 'పంపబడింది.'}</p> : null}
    </div>
    <State loading={log.isLoading} error={log.isError} />
    <div className="space-y-2">
      {log.data?.items.map((c) => (
        <article key={c.id} className="flex flex-wrap items-center gap-3 rounded-card border border-rule bg-white p-3">
          <span className="te min-w-0 flex-1 truncate text-[14px] font-semibold">{c.title_te}</span>
          <span className="rounded-chip bg-paper px-2 py-0.5 font-mono text-[10px] text-muted">{c.audience}</span>
          <span className="font-sans text-[11px] font-bold text-success">{c.sent_count} {en ? 'sent' : 'పంపిన'}</span>
          <span className="font-sans text-[10.5px] text-muted-light">{new Date(c.created_at).toLocaleString('en-IN')}</span>
        </article>
      ))}
    </div>
  </Shell>;
}
