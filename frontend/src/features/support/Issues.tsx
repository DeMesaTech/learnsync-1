import {useState,type FormEvent} from 'react';
import {useLocation} from 'react-router-dom';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';

export interface Issue{id:string;type:'bug'|'account'|'content'|'other';title:string;description:string;page:string;status:'open'|'in_progress'|'resolved';admin_note:string;created_at:string;updated_at:string}
interface AdminIssue extends Issue{reporter:{id:string;name:string;email:string;role:string};reviewed_at:string|null}
const TYPE_LABEL={bug:'Something is broken',account:'Account or sign-in',content:'A lesson, quiz or grade looks wrong',other:'Something else'} as const;
const ISSUE_PRESETS=[
  {label:"I can't sign in",type:'account',title:"I can't sign in to my account",description:"I can't sign in to my account. I expected to be able to access my dashboard with my usual sign-in details."},
  {label:"A class or lesson won't open",type:'content',title:"A class or learning material won't open",description:"I can't open a class, lesson, syllabus, or learning material. I expected it to open normally."},
  {label:"A quiz or assignment isn't working",type:'bug',title:"A quiz or assignment isn't working",description:"A quiz or assignment won't load, save, or submit. I expected to be able to complete it normally."},
  {label:"A grade or attendance entry looks wrong",type:'content',title:"A grade, result, or attendance entry looks wrong",description:"A grade, result, or attendance entry looks incorrect. I expected the information to match my academic record."},
  {label:"A page is slow, frozen, or showing an error",type:'bug',title:"A page is slow, frozen, or showing an error",description:"A page is slow, frozen, or showing an error. I expected the page to load and work normally."},
] as const;
const STATUS_LABEL={open:'Open',in_progress:'Being looked at',resolved:'Resolved'} as const;
const when=(iso:string)=>new Date(iso).toLocaleString();

export function MyIssues(){
  const location=useLocation();
  const [error,setError]=useState('');const [sent,setSent]=useState(false);const [busy,setBusy]=useState(false);const [open,setOpen]=useState(false);
  const [type,setType]=useState<Issue['type']>('bug');const [title,setTitle]=useState('');const [description,setDescription]=useState('');
  const [selectedPreset,setSelectedPreset]=useState<string|null>(null);
  const list=useInfiniteQuery({queryKey:['issues'],initialPageParam:0,queryFn:({pageParam})=>api<{items:Issue[];has_more:boolean}>(`/issues?limit=25&offset=${pageParam}`),getNextPageParam:(p,all)=>p.has_more?all.length*25:undefined});
  const mine=list.data?.pages.flatMap(p=>p.items)??[];
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);   // read before awaiting
    setBusy(true);setError('');
    try{await post('/issues',{type:f.get('type'),title:f.get('title'),description:f.get('description'),page:String(f.get('page')||'')});setOpen(false);setSent(true);await queryClient.invalidateQueries({queryKey:['issues']})}
    catch(err){setError(errorText(err))}   // the dialog stays open with what was typed
    finally{setBusy(false)}
  }
  return <>
    <div className="page-heading"><div><h1>Report a problem</h1><p className="muted">Tell the administrators what went wrong. Please do not include passwords or other private information.</p></div>
      <button className="primary" onClick={()=>{setError('');setSent(false);setType('bug');setTitle('');setDescription('');setSelectedPreset(null);setOpen(true)}}>Report a problem</button></div>
    {sent&&<p role="status">Thank you. Your report was sent.</p>}
    {open&&<Dialog title="Report a problem" onClose={()=>setOpen(false)}><form onSubmit={submit}>
      <label>What kind of problem is it?<select name="type" value={type} onChange={e=>setType(e.target.value as Issue['type'])}>{Object.entries(TYPE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <div className="problem-presets">
        <p id="problem-presets-help" className="muted">Choose a common problem to fill in the report. You can edit the details before sending.</p>
        <div className="problem-preset-list" role="group" aria-label="Common problems" aria-describedby="problem-presets-help">
          {ISSUE_PRESETS.map(preset=><button key={preset.label} type="button" aria-pressed={selectedPreset===preset.label} onClick={()=>{setSelectedPreset(preset.label);setType(preset.type);setTitle(preset.title);setDescription(preset.description)}}>{preset.label}</button>)}
        </div>
      </div>
      <label>Short title<input name="title" value={title} onChange={e=>setTitle(e.target.value)} required minLength={3} maxLength={120}/></label>
      <label>What happened? What did you expect?<textarea name="description" value={description} onChange={e=>setDescription(e.target.value)} required minLength={10} maxLength={4000}/></label>
      <label>Where did it happen? (optional)<input name="page" maxLength={200} defaultValue={location.state&&typeof location.state==='object'&&'from' in location.state?String((location.state as {from:string}).from):''} placeholder="For example: Quiz 1 in ENT 101"/></label>
      {error&&<p role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={()=>setOpen(false)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Sending…':'Send report'}</button></div></form></Dialog>}
    <h2>Your reports</h2>
    {list.isPending?<p>Loading…</p>:list.error?<p role="alert">{list.error.message}</p>:mine.length===0?<section className="panel"><p className="muted">You have not sent any reports.</p></section>:
      <div className="cards">{mine.map(i=><article className="panel" key={i.id}>
        <p className="eyebrow">{TYPE_LABEL[i.type]} · {when(i.created_at)}</p><h3>{i.title}</h3>
        <p><span className="badge">{STATUS_LABEL[i.status]}</span></p>
        <p className="pre">{i.description}</p>
        {i.admin_note&&<div className="warn"><strong>Reply from the administrator</strong><p className="pre">{i.admin_note}</p></div>}</article>)}</div>}
    {list.hasNextPage&&<button disabled={list.isFetchingNextPage} onClick={()=>list.fetchNextPage()}>{list.isFetchingNextPage?'Loading…':'Load more reports'}</button>}
  </>;
}

export function AdminIssues(){
  const [status,setStatus]=useState('');const [message,setMessage]=useState('');
  const [kind,setKind]=useState('');const [search,setSearch]=useState('');const [page,setPage]=useState(1);
  const SIZE=25;
  const list=useQuery({queryKey:['admin-issues',status,kind,search,page],placeholderData:previous=>previous,
    queryFn:()=>api<{counts:Record<string,number>;total:number;issues:AdminIssue[]}>(`/admin/issues?page=${page}&page_size=${SIZE}${status?`&status=${status}`:''}${kind?`&type=${kind}`:''}${search?`&q=${encodeURIComponent(search)}`:''}`)});
  const pages=Math.max(1,Math.ceil((list.data?.total??0)/SIZE));
  const filter=(set:(v:string)=>void)=>(v:string)=>{set(v);setPage(1)};
  async function review(id:string,patch:{status?:string;admin_note?:string}){
    setMessage('');
    try{await send('PATCH',`/admin/issues/${id}`,patch);await queryClient.invalidateQueries({queryKey:['admin-issues']});setMessage('Saved.')}
    catch(e){setMessage(errorText(e))}
  }
  return <>
    <div className="page-heading"><div><h1>Reports</h1><p className="muted">Problems sent by students and teachers. Your note is shown to the person who reported it.</p></div></div>
    <div className="tabs" role="group" aria-label="Filter by status">
      {[['','All'],['open','Open'],['in_progress','Being looked at'],['resolved','Resolved']].map(([k,l])=><button key={k} className={status===k?'active':''} aria-pressed={status===k} onClick={()=>filter(setStatus)(k)}>{l}{list.data&&k?` (${list.data.counts[k]})`:''}</button>)}</div>
    <div className="actions"><label>Type<select value={kind} onChange={e=>filter(setKind)(e.target.value)}><option value="">All types</option>{Object.entries(TYPE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>Search reports<input type="search" value={search} onChange={e=>filter(setSearch)(e.target.value)} placeholder="Title or description"/></label></div>
    {message&&<p role="status">{message}</p>}
    {list.isPending?<p>Loading…</p>:list.error?<p role="alert">{list.error.message}</p>:list.data.issues.length===0?<section className="panel"><p className="muted">No reports here.</p></section>:
      <>{list.data.issues.map(i=><IssueCard key={i.id+i.updated_at} issue={i} onReview={review}/>)}
      <nav className="actions" aria-label="Pages"><button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page} of {pages} · {list.data.total} report{list.data.total===1?'':'s'}</span><button disabled={page>=pages} onClick={()=>setPage(page+1)}>Next</button></nav></>}
  </>;
}

function IssueCard({issue,onReview}:{issue:AdminIssue;onReview:(id:string,patch:{status?:string;admin_note?:string})=>void}){
  const [note,setNote]=useState(issue.admin_note);
  return <article className="panel">
    <p className="eyebrow">{TYPE_LABEL[issue.type]} · {issue.reporter.role} · {when(issue.created_at)}</p>
    <h3>{issue.title}</h3>
    <p className="muted">From {issue.reporter.name} ({issue.reporter.email}){issue.page?` · ${issue.page}`:''}</p>
    <p className="pre">{issue.description}</p>
    <label>Note for the reporter<textarea value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label>
    <div className="actions"><span className="badge">{STATUS_LABEL[issue.status]}</span>
      {issue.status!=='in_progress'&&<button onClick={()=>onReview(issue.id,{status:'in_progress',admin_note:note})}>Mark as being looked at</button>}
      {issue.status!=='resolved'&&<button className="primary" onClick={()=>onReview(issue.id,{status:'resolved',admin_note:note})}>Mark as resolved</button>}
      {issue.status==='resolved'&&<button onClick={()=>onReview(issue.id,{status:'open',admin_note:note})}>Reopen</button>}
      <button disabled={note===issue.admin_note} onClick={()=>onReview(issue.id,{admin_note:note})}>Save note only</button></div>
  </article>;
}
