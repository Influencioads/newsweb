import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Camera, MapPin, PlayCircle, Sparkles, UserRound } from 'lucide-react';

import { RowCard } from '@/components/article/ArticleCard';
import { NewsImage } from '@/components/media/NewsImage';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import type { ArticleCard } from '@/types/public';

function titleCase(value: string) {
  return value.split('-').map((part) => part ? (part[0]?.toUpperCase() ?? '') + part.slice(1) : '').join(' ');
}

function FeedShell({ title, subtitle, icon, articles, loading }: { title: string; subtitle: string; icon: React.ReactNode; articles: ArticleCard[]; loading: boolean }) {
  const { language } = useI18n();
  const te = language === 'te';
  return <main className="mx-auto min-h-[60vh] max-w-[1040px] px-4 py-7">
    <header className="mb-6 border-b-2 border-ink pb-4">
      <div className="mb-2 flex items-center gap-2 text-brand">{icon}<span className="font-sans text-[10px] font-extrabold uppercase tracking-[.16em]">Top Telugu News</span></div>
      <h1 className={`${te ? 'th' : 'font-sans'} text-[30px] font-extrabold text-ink sm:text-[38px]`}>{title}</h1>
      <p className={`${te ? 'te' : 'font-sans'} mt-2 text-[13px] text-muted`}>{subtitle}</p>
    </header>
    {loading ? <div className="space-y-4">{[1,2,3].map(i=><div key={i} className="h-24 animate-pulse rounded bg-placeholder" />)}</div>
      : articles.length ? <div className="grid gap-x-8 md:grid-cols-2">{articles.map(a=><RowCard key={a.short_id} article={a}/>)}</div>
      : <div className="rounded border border-dashed border-rule bg-paper px-6 py-14 text-center"><p className={`${te ? 'te' : 'font-sans'} text-muted`}>{te ? 'ఈ విభాగంలో కథనాలు ఇంకా ప్రచురించలేదు.' : 'No published stories are available here yet.'}</p><Link to="/" className="mt-3 inline-block font-semibold text-brand hover:underline">{te ? 'హోమ్‌కు వెళ్లండి' : 'Return home'}</Link></div>}
  </main>;
}

export function DistrictPage() {
  const { slug='' }=useParams(); const {language}=useI18n(); const te=language==='te';
  const q=useQuery({queryKey:['public','district',slug],queryFn:()=>publicApi.fetchFeed({district:slug,limit:30})});
  const name=q.data?.district ? (te?q.data.district.name_te:q.data.district.name_en) : titleCase(slug);
  return <FeedShell title={name} subtitle={te?'జిల్లా నుంచి తాజా స్థానిక వార్తలు':'Latest verified local news from the district'} icon={<MapPin className="h-5 w-5"/>} articles={q.data?.articles??[]} loading={q.isLoading}/>;
}

function SearchFeedPage({kind}:{kind:'mandal'|'author'|'tag'}) {
  const {slug=''}=useParams(); const {language}=useI18n(); const te=language==='te'; const name=titleCase(slug);
  const q=useQuery({queryKey:['public',kind,slug],queryFn:()=>publicApi.fetchFeed({[kind]:slug,limit:30})});
  const labels={mandal:te?'మండల వార్తలు':'Mandal news',author:te?'రచయిత':'Author',tag:te?'అంశం':'Topic'};
  return <FeedShell title={name} subtitle={labels[kind]} icon={kind==='author'?<UserRound className="h-5 w-5"/>:<MapPin className="h-5 w-5"/>} articles={q.data?.articles??[]} loading={q.isLoading}/>;
}
export const MandalPage=()=> <SearchFeedPage kind="mandal"/>;
export const AuthorPage=()=> <SearchFeedPage kind="author"/>;
export const TagPage=()=> <SearchFeedPage kind="tag"/>;

export function PhotoGalleryPage() {
  const {data,isLoading}=useQuery({queryKey:['public','home'],queryFn:()=>publicApi.fetchHome()});
  const {language,pick}=useI18n(); const te=language==='te';
  const items=data ? [data.lead,...data.secondary,...data.mid_column,...data.latest,...data.sections.flatMap(s=>s.articles)].filter((a):a is ArticleCard=>Boolean(a?.hero)).filter((a,i,all)=>all.findIndex(x=>x.short_id===a.short_id)===i) : [];
  return <main className="mx-auto min-h-[60vh] max-w-[1200px] px-4 py-7"><header className="mb-6 border-b-2 border-ink pb-4"><Camera className="mb-2 h-6 w-6 text-brand"/><h1 className={`${te?'th':'font-sans'} text-[32px] font-extrabold`}>{te?'ఫోటో గ్యాలరీ':'Photo gallery'}</h1></header>{isLoading?<div className="h-64 animate-pulse bg-placeholder"/>:<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map(a=><Link key={a.short_id} to={a.url} className="group"><NewsImage media={a.hero} ratio="4/3" sizes="(max-width:640px) 100vw, 33vw" className="w-full rounded-card"/><h2 className={`${te?'th':'font-sans'} mt-2 text-[17px] font-bold group-hover:text-brand`}>{pick(a.title_te,a.title_en)}</h2></Link>)}</div>}</main>;
}

export function WebStoriesPage() {
  const {data,isLoading}=useQuery({queryKey:['public','home'],queryFn:()=>publicApi.fetchHome()});
  const {language,pick}=useI18n(); const te=language==='te'; const items=data?[data.lead,...data.secondary,...data.mid_column,...data.latest].filter((a):a is ArticleCard=>Boolean(a)).filter((a,i,all)=>all.findIndex(x=>x.short_id===a.short_id)===i).slice(0,10):[];
  return <main className="mx-auto min-h-[60vh] max-w-[1200px] px-4 py-7"><header className="mb-6 border-b-2 border-ink pb-4"><Sparkles className="mb-2 h-6 w-6 text-brand"/><h1 className={`${te?'th':'font-sans'} text-[32px] font-extrabold`}>{te?'వెబ్ స్టోరీస్':'Web Stories'}</h1></header>{isLoading?<div className="h-72 animate-pulse bg-placeholder"/>:<div className="flex snap-x gap-4 overflow-x-auto pb-4">{items.map(a=><Link key={a.short_id} to={a.url} className="group relative aspect-[9/16] w-[230px] shrink-0 snap-start overflow-hidden rounded-card bg-ink shadow-card"><NewsImage media={a.hero} ratio="9/16" sizes="230px" className="h-full w-full opacity-70"/><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 pt-14"><h2 className={`${te?'th':'font-sans'} text-[18px] font-bold text-white`}>{pick(a.title_te,a.title_en)}</h2></div></Link>)}</div>}</main>;
}

export function VideoHubPage() {
  const {language}=useI18n(); const te=language==='te';
  return <FeedShell title={te?'వీడియోలు':'Video hub'} subtitle={te?'యూట్యూబ్, బన్నీ స్ట్రీమ్, జాటా మరియు స్వంత వీడియోలు':'YouTube, Bunny Stream, Zata and newsroom-hosted video'} icon={<PlayCircle className="h-5 w-5"/>} articles={[]} loading={false}/>;
}
