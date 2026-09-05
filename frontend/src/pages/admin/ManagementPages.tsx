import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

type Row = Record<string, unknown>;
type ListPayload = { items: Row[]; total: number };
type TaxonomyPayload = { categories: Row[]; districts: Row[]; tags: Row[] };

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <main className="mx-auto max-w-7xl px-4 py-6"><header className="mb-5"><h1 className="th text-[25px] font-extrabold">{title}</h1><p className="te mt-1 text-[12px] text-muted">{subtitle}</p></header>{children}</main>;
}

function State({ loading, error }: { loading: boolean; error: boolean }) {
  const { language } = useI18n();
  if (loading) return <p className="te rounded-card border border-rule bg-white p-5">{language==='te'?'లోడ్ అవుతోంది…':'Loading…'}</p>;
  if (error) return <p role="alert" className="te rounded-card border border-breaking-border bg-breaking-tint p-5 text-breaking">{language==='te'?'సమాచారం లోడ్ కాలేదు. మీ అనుమతులను తనిఖీ చేయండి.':'Could not load data. Check your permissions.'}</p>;
  return null;
}

function value(row: Row, key: string, english = false) {
  const item = row[key];
  if (item == null || item === '') return '—';
  if (typeof item === 'boolean') return item ? 'అవును' : 'కాదు';
  if (Array.isArray(item)) return item.map(x => typeof x === 'object' && x ? String((english ? (x as Row).label_en : (x as Row).label_te) ?? (x as Row).key ?? '') : String(x)).join(', ') || '—';
  const text = String(item);
  return key.endsWith('_at') ? new Date(text).toLocaleString('en-IN') : text;
}

function DataTable({ rows, columns }: { rows: Row[]; columns: Array<[string, string]> }) {
  const { language }=useI18n(); const en=language==='en';
  return <div className="overflow-x-auto rounded-card border border-rule bg-white shadow-card"><table className="w-full min-w-[720px] text-left"><thead className="bg-paper font-sans text-[10px] uppercase tracking-wide text-muted"><tr>{columns.map(([key, label]) => <th key={key} className="px-3 py-2.5">{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)} className="border-t border-rule-soft">{columns.map(([key]) => <td key={key} className="max-w-[360px] px-3 py-3 font-sans text-[12px] text-ink"><span className={key.includes('name_te') ? 'te font-semibold' : ''}>{value(row, key,en)}</span></td>)}</tr>)}</tbody></table>{rows.length === 0 ? <p className="p-6 text-center text-muted">{en?'No data.':'సమాచారం లేదు.'}</p> : null}</div>;
}

export function TaxonomyPage() {
  const { language } = useI18n();
  const q = useQuery({ queryKey: ['cms','taxonomy'], queryFn: () => cmsApi.fetchManagement<TaxonomyPayload>('taxonomy') });
  const en=language==='en';
  const nameColumns:Array<[string,string]>=en?[["name_en","Name"]]:[["name_te","పేరు"]];
  return <Shell title={en?'Taxonomy':'వర్గీకరణ'} subtitle={en?'Central catalogue of sections, districts, and tags':'విభాగాలు, జిల్లాలు మరియు ట్యాగ్‌ల కేంద్ర జాబితా'}><State loading={q.isLoading} error={q.isError}/>{q.data ? <div className="space-y-7"><section><h2 className="te mb-2 font-bold">{en?'Categories':'విభాగాలు'} ({q.data.categories.length})</h2><DataTable rows={q.data.categories} columns={[...nameColumns,["slug","Slug"],["in_nav",en?'Navigation':'నావిగేషన్'],["active",en?'Active':'క్రియాశీలం']]}/></section><section><h2 className="te mb-2 font-bold">{en?'Districts':'జిల్లాలు'} ({q.data.districts.length})</h2><DataTable rows={q.data.districts} columns={[...nameColumns,["state",en?'State':'రాష్ట్రం'],["slug","Slug"],["active",en?'Active':'క్రియాశీలం']]}/></section><section><h2 className="te mb-2 font-bold">{en?'Tags':'ట్యాగ్‌లు'} ({q.data.tags.length})</h2><DataTable rows={q.data.tags} columns={[...nameColumns,["type",en?'Type':'రకం'],["usage_count",en?'Usage':'వినియోగం'],["active",en?'Active':'క్రియాశీలం']]}/></section></div> : null}</Shell>;
}

export function MediaPage() {
  const { language }=useI18n(); const en=language==='en';
  const q=useQuery({queryKey:['cms','media'],queryFn:()=>cmsApi.fetchManagement<ListPayload>('media')});
  return <Shell title={en?'Media library':'మీడియా లైబ్రరీ'} subtitle={en?'Publishing assets with licence, credit, and AI provenance':'లైసెన్స్, క్రెడిట్ మరియు AI మూలంతో ప్రచురణ ఆస్తులు'}><State loading={q.isLoading} error={q.isError}/>{q.data?<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{q.data.items.map(x=><article key={String(x.id)} className="overflow-hidden rounded-card border border-rule bg-white shadow-card">{String(x.mime).startsWith('image/')?<img src={String(x.url)} alt={String(x.alt_te??'')} className="aspect-video w-full bg-placeholder object-cover"/>:<div className="flex aspect-video items-center justify-center bg-ink text-white">{String(x.type)}</div>}<div className="p-3"><p className="truncate font-sans text-[12px] font-bold">{String(x.filename)}</p><p className="mt-1 font-sans text-[10px] text-muted">{String(x.credit??(en?'Credit not set':'క్రెడిట్ లేదు'))}</p></div></article>)}</div>:null}</Shell>;
}

function ListPage({section,title,subtitle,columns}:{section:string;title:string;subtitle:string;columns:Array<[string,string]>}){const q=useQuery({queryKey:['cms',section],queryFn:()=>cmsApi.fetchManagement<ListPayload>(section)});return <Shell title={title} subtitle={subtitle}><State loading={q.isLoading} error={q.isError}/>{q.data?<><p className="mb-2 font-sans text-[11px] text-muted">{q.data.total} records</p><DataTable rows={q.data.items} columns={columns}/></>:null}</Shell>}
export function UsersPage(){const {language}=useI18n();const en=language==='en';return <ListPage section="users" title={en?'Users':'వినియోగదారులు'} subtitle={en?'Staff accounts, status, roles, and security':'సిబ్బంది ఖాతాలు, స్థితి, పాత్రలు మరియు భద్రత'} columns={[[en?'name_en':'name_te',en?'Name':'పేరు'],["email","Email"],["phone","Phone"],["status",en?'Status':'స్థితి'],["roles",en?'Roles':'పాత్రలు'],["two_factor_enabled","2FA"],["last_login_at",en?'Last login':'చివరి లాగిన్']]}/>}
export function RolesPage(){const {language}=useI18n();const en=language==='en';return <ListPage section="roles" title={en?'Roles and permissions':'పాత్రలు మరియు అనుమతులు'} subtitle={en?'Access is controlled by permission keys, not role names':'పాత్ర పేరుకు బదులుగా permission key ఆధారంగా నియంత్రణ'} columns={[[en?'label_en':'label_te',en?'Role':'పాత్ర'],["key","Key"],["level",en?'Level':'స్థాయి'],["scope",en?'Default scope':'డిఫాల్ట్ పరిధి'],["permissions",en?'Permissions':'అనుమతులు']]}/>}
export function AuditPage(){const {language}=useI18n();const en=language==='en';return <ListPage section="audit" title={en?'Audit log':'ఆడిట్ లాగ్'} subtitle={en?'Immutable history of editorial and security actions':'మార్చలేని సంపాదకీయ మరియు భద్రతా చర్యల చరిత్ర'} columns={[["created_at","Time"],["actor","Actor"],["action","Action"],["entity_type","Entity"],["entity_id","ID"],["ip","IP"],["request_id","Request ID"]]}/>}

type ReportRow={id:number;reason:string;note:string|null;status:string;created_at:string;resolution_note:string|null;target:{kind:string;id:number;title_te?:string|null;short_id?:string|null;url?:string|null;body?:string|null;status?:string|null;author?:string|null}};
type CommentRow={id:number;body:string;status:string;author:string|null;article_title_te:string|null;article_short_id:string|null;created_at:string};
type SubmissionRow={id:number;title_te:string;body_te:string;creator_name_te:string|null;creator_phone:string|null;category_slug:string|null;district_slug:string|null;status:string;created_at:string};

/** §19 Moderation — the report queue and comment control room. */
export function ModerationPage(){
  const {language}=useI18n();const en=language==='en';
  const [tab,setTab]=useState<'reports'|'comments'|'submissions'>('reports');
  const queryClient=useQueryClient();
  const reports=useQuery({queryKey:['cms','moderation','reports'],queryFn:()=>cmsApi.fetchModeration<{items:ReportRow[];total:number}>('reports','open')});
  const comments=useQuery({queryKey:['cms','moderation','comments'],queryFn:()=>cmsApi.fetchModeration<{items:CommentRow[];total:number}>('comments'),enabled:tab==='comments'});
  const submissions=useQuery({queryKey:['cms','moderation','submissions'],queryFn:()=>cmsApi.fetchSubmissions<{items:SubmissionRow[]}>()});
  const invalidate=()=>{void queryClient.invalidateQueries({queryKey:['cms','moderation']});};
  const close=useMutation({mutationFn:({id,dismiss}:{id:number;dismiss:boolean})=>cmsApi.closeReport(id,dismiss),onSuccess:invalidate});
  const moderate=useMutation({mutationFn:({id,hide}:{id:number;hide:boolean})=>cmsApi.moderateComment(id,hide),onSuccess:invalidate});
  const approveSub=useMutation({mutationFn:(id:number)=>cmsApi.approveSubmission(id),onSuccess:invalidate});
  const rejectSub=useMutation({mutationFn:(id:number)=>{const note=window.prompt(en?'Note to the creator (optional):':'రచయితకు గమనిక (ఐచ్ఛికం):')??'';return cmsApi.rejectSubmission(id,note.trim()||null);},onSuccess:invalidate});
  const tabCls=(active:boolean)=>`min-h-[38px] rounded-control border px-4 font-sans text-[12.5px] font-bold ${active?'border-brand bg-brand-tint text-brand':'border-rule bg-white text-muted hover:text-brand'}`;
  return <Shell title={en?'Moderation':'మోడరేషన్'} subtitle={en?'Reader reports and comment control':'పాఠకుల నివేదికలు మరియు వ్యాఖ్యల నియంత్రణ'}>
    <div className="mb-4 flex gap-2">
      <button type="button" className={tabCls(tab==='reports')} onClick={()=>setTab('reports')}>{en?'Reports':'నివేదికలు'}{reports.data?` (${reports.data.total})`:''}</button>
      <button type="button" className={tabCls(tab==='comments')} onClick={()=>setTab('comments')}>{en?'Comments':'వ్యాఖ్యలు'}</button>
      <button type="button" className={tabCls(tab==='submissions')} onClick={()=>setTab('submissions')}>{en?'Submissions':'సమర్పణలు'}{submissions.data?.items.length?` (${submissions.data.items.length})`:''}</button>
    </div>
    {tab==='submissions'?<>
      <State loading={submissions.isLoading} error={submissions.isError}/>
      {submissions.data?<div className="space-y-3">
        {submissions.data.items.length===0?<p className="te rounded-card border border-rule bg-white p-6 text-center text-muted">{en?'No submissions awaiting review.':'సమీక్ష కోసం సమర్పణలు లేవు.'}</p>:null}
        {submissions.data.items.map(s=><article key={s.id} className="rounded-card border border-rule bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="te text-[15px] font-bold text-ink">{s.title_te}</p>
              <p className="mt-1 font-sans text-[11px] text-muted">{s.creator_name_te??'?'}{s.creator_phone?` · +${s.creator_phone}`:''}{s.category_slug?` · ${s.category_slug}`:''}{s.district_slug?` · ${s.district_slug}`:''} · {new Date(s.created_at).toLocaleString('en-IN')}</p>
              <p className="te mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-paper-sub p-3 text-[13.5px] leading-telugu text-ink-soft">{s.body_te}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button type="button" onClick={()=>approveSub.mutate(s.id)} disabled={approveSub.isPending} className="min-h-[34px] rounded-control bg-success px-3 font-sans text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">{en?'Approve → review queue':'ఆమోదించి సమీక్షకు'}</button>
              <button type="button" onClick={()=>rejectSub.mutate(s.id)} disabled={rejectSub.isPending} className="min-h-[34px] rounded-control border border-breaking px-3 font-sans text-[11.5px] font-bold text-breaking hover:bg-breaking-tint disabled:opacity-50">{en?'Reject':'తిరస్కరించండి'}</button>
            </div>
          </div>
        </article>)}
      </div>:null}
    </>:tab==='reports'?<>
      <State loading={reports.isLoading} error={reports.isError}/>
      {reports.data?<div className="space-y-3">
        {reports.data.items.length===0?<p className="te rounded-card border border-rule bg-white p-6 text-center text-muted">{en?'No open reports. All clear.':'తెరిచిన నివేదికలు లేవు.'}</p>:null}
        {reports.data.items.map(r=><article key={r.id} className="rounded-card border border-rule bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-sans text-[10px] font-bold uppercase tracking-wide text-breaking">{r.reason}{r.target.kind==='comment'?(en?' · comment':' · వ్యాఖ్య'):(en?' · article':' · కథనం')}</p>
              {r.target.kind==='article'?<a href={r.target.url??'#'} target="_blank" rel="noreferrer" className="te mt-1 block text-[15px] font-bold text-ink hover:text-brand">{r.target.title_te??'—'}</a>
                :<p className="te mt-1 text-[14px] text-ink">“{r.target.body??'—'}” <span className="font-sans text-[11px] text-muted">— {r.target.author??'?'}</span></p>}
              {r.note?<p className="te mt-1 text-[12.5px] text-muted">{en?'Reporter note':'నివేదిక గమనిక'}: {r.note}</p>:null}
              <p className="mt-1 font-sans text-[10.5px] text-muted-light">{new Date(r.created_at).toLocaleString('en-IN')}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {r.target.kind==='comment'&&r.target.status!=='hidden'?<button type="button" onClick={()=>moderate.mutate({id:r.target.id,hide:true})} className="min-h-[34px] rounded-control border border-breaking px-3 font-sans text-[11.5px] font-bold text-breaking hover:bg-breaking-tint">{en?'Hide comment':'వ్యాఖ్య దాచండి'}</button>:null}
              <button type="button" onClick={()=>close.mutate({id:r.id,dismiss:false})} className="min-h-[34px] rounded-control bg-success px-3 font-sans text-[11.5px] font-bold text-white hover:opacity-90">{en?'Resolve':'పరిష్కరించండి'}</button>
              <button type="button" onClick={()=>close.mutate({id:r.id,dismiss:true})} className="min-h-[34px] rounded-control border border-rule px-3 font-sans text-[11.5px] font-bold text-muted hover:text-ink">{en?'Dismiss':'తోసిపుచ్చండి'}</button>
            </div>
          </div>
        </article>)}
      </div>:null}
    </>:<>
      <State loading={comments.isLoading} error={comments.isError}/>
      {comments.data?<div className="space-y-3">
        {comments.data.items.map(c=><article key={c.id} className="rounded-card border border-rule bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="te text-[14px] text-ink">“{c.body}”</p>
              <p className="mt-1 font-sans text-[11px] text-muted">{c.author??'?'} · <span className="te">{c.article_title_te??''}</span> · {new Date(c.created_at).toLocaleString('en-IN')} · <span className={c.status==='visible'?'text-success':'text-breaking'}>{c.status}</span></p>
            </div>
            <div className="flex shrink-0 gap-2">
              {c.status==='visible'?<button type="button" onClick={()=>moderate.mutate({id:c.id,hide:true})} className="min-h-[34px] rounded-control border border-breaking px-3 font-sans text-[11.5px] font-bold text-breaking hover:bg-breaking-tint">{en?'Hide':'దాచండి'}</button>
                :c.status==='hidden'?<button type="button" onClick={()=>moderate.mutate({id:c.id,hide:false})} className="min-h-[34px] rounded-control border border-success px-3 font-sans text-[11.5px] font-bold text-success">{en?'Restore':'పునరుద్ధరించండి'}</button>:null}
            </div>
          </div>
        </article>)}
        {comments.data.items.length===0?<p className="te rounded-card border border-rule bg-white p-6 text-center text-muted">{en?'No comments yet.':'ఇంకా వ్యాఖ్యలు లేవు.'}</p>:null}
      </div>:null}
    </>}
  </Shell>;
}

export function SettingsPage(){const {language}=useI18n();const en=language==='en';const q=useQuery({queryKey:['cms','settings'],queryFn:()=>cmsApi.fetchManagement<Row>('settings')});return <Shell title={en?'System settings':'సిస్టమ్ సెట్టింగ్స్'} subtitle={en?'Current runtime configuration with secrets excluded':'రహస్య విలువలను వెల్లడించని ప్రస్తుత రన్‌టైమ్ కాన్ఫిగరేషన్'}><State loading={q.isLoading} error={q.isError}/>{q.data?<dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(q.data).map(([key,val])=><div key={key} className="rounded-card border border-rule bg-white p-4"><dt className="font-mono text-[10px] uppercase text-muted">{key.replaceAll('_',' ')}</dt><dd className="mt-1 break-words font-sans text-[14px] font-semibold text-ink">{typeof val==='boolean'?(val?(en?'Enabled':'ప్రారంభం'):(en?'Disabled':'నిలిపివేయబడింది')):String(val)}</dd></div>)}</dl>:null}</Shell>}
