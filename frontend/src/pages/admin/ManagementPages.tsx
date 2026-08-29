import { useQuery } from '@tanstack/react-query';
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

export function SettingsPage(){const {language}=useI18n();const en=language==='en';const q=useQuery({queryKey:['cms','settings'],queryFn:()=>cmsApi.fetchManagement<Row>('settings')});return <Shell title={en?'System settings':'సిస్టమ్ సెట్టింగ్స్'} subtitle={en?'Current runtime configuration with secrets excluded':'రహస్య విలువలను వెల్లడించని ప్రస్తుత రన్‌టైమ్ కాన్ఫిగరేషన్'}><State loading={q.isLoading} error={q.isError}/>{q.data?<dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(q.data).map(([key,val])=><div key={key} className="rounded-card border border-rule bg-white p-4"><dt className="font-mono text-[10px] uppercase text-muted">{key.replaceAll('_',' ')}</dt><dd className="mt-1 break-words font-sans text-[14px] font-semibold text-ink">{typeof val==='boolean'?(val?(en?'Enabled':'ప్రారంభం'):(en?'Disabled':'నిలిపివేయబడింది')):String(val)}</dd></div>)}</dl>:null}</Shell>}
