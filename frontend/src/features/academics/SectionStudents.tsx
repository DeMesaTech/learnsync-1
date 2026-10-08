import {useEffect,useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {keepPreviousData,useQuery} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {Pager} from '../../components/Pager';
import {useToast} from '../../components/undo';
import {yearLabel,type SchoolYear,type Section} from './types';

interface Row{student_id:string;display_name:string;email:string;student_number:string;status?:string;account_status?:string}
interface Page{items:Row[];total:number;page:number;page_size:number}
type Tab='current'|'add';

/** Debounced copy of a typed value, so the list asks the server once the typing pauses. */
function useDebounced(value:string,ms=300){
  const [v,setV]=useState(value);
  useEffect(()=>{const t=window.setTimeout(()=>setV(value),ms);return()=>window.clearTimeout(t)},[value,ms]);
  return v;
}

/** The students of one section: who is in it (search, status filter, pages, withdraw with a reason) and who can be added. */
export function SectionStudents(){
  const {termId,sectionId}=useParams();
  const toast=useToast();
  const years=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const sections=useQuery({queryKey:['sections',termId],queryFn:()=>api<Section[]>(`/terms/${termId}/sections`)});
  const section=sections.data?.find(s=>s.id===sectionId);
  const term=years.data?.flatMap(y=>y.terms).find(t=>t.id===termId);
  const closed=term?.status==='closed';
  const [tab,setTab]=useState<Tab>('current');
  const [find,setFind]=useState('');const search=useDebounced(find);
  const [status,setStatus]=useState<'active'|'withdrawn'|'all'>('active');
  const [account,setAccount]=useState<'all'|'active'|'invited'>('all');
  const [page,setPage]=useState(1);const [size,setSize]=useState(25);
  const [picked,setPicked]=useState<Row[]>([]);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const [leaving,setLeaving]=useState<Row|null>(null);

  const query=tab==='current'?`/sections/${sectionId}/roster?page=${page}&page_size=${size}&status=${status}&search=${encodeURIComponent(search)}`
    :`/sections/${sectionId}/candidates?page=${page}&page_size=${size}&account=${account}&search=${encodeURIComponent(search)}`;
  const list=useQuery({queryKey:['section-students',sectionId,tab,page,size,status,account,search],queryFn:()=>api<Page>(query),placeholderData:keepPreviousData,enabled:!!sectionId&&(tab==='current'||!closed)});
  const reset=(fn:()=>void)=>{fn();setPage(1)};
  const refresh=()=>{queryClient.invalidateQueries({queryKey:['section-students',sectionId]});queryClient.invalidateQueries({queryKey:['sections',termId]});queryClient.invalidateQueries({queryKey:['offerings',termId]})};

  const rows=list.data?.items??[];
  const pickedIds=new Set(picked.map(p=>p.student_id));
  const pageAllPicked=rows.length>0&&rows.every(r=>pickedIds.has(r.student_id));
  const toggle=(r:Row,on:boolean)=>setPicked(on?[...picked,r]:picked.filter(p=>p.student_id!==r.student_id));
  const togglePage=(on:boolean)=>setPicked(on?[...picked,...rows.filter(r=>!pickedIds.has(r.student_id))]:picked.filter(p=>!rows.some(r=>r.student_id===p.student_id)));

  async function addPicked(){
    setBusy(true);setMessage('');let added=0;const failed:string[]=[];
    for(const p of picked){
      try{await post(`/sections/${sectionId}/members`,{student_id:p.student_id});added++}
      catch(e){failed.push(`${p.display_name}: ${errorText(e)}`)}
    }
    setBusy(false);setPicked([]);refresh();
    if(added)toast(`${added} student${added===1?'':'s'} added to ${section?.name}.`);
    if(failed.length)setMessage(`${failed.length} could not be added. ${failed.join(' ')}`);
  }

  if(years.isPending||sections.isPending)return <p>Loading…</p>;
  if(!section||!term)return <section className="panel"><h1>Section not found</h1><Link to={`/admin/terms/${termId}`}>Back to the term</Link></section>;
  return <>
    <p className="back"><Link to={`/admin/terms/${termId}`}>← {term.name}</Link></p>
    <div className="page-heading"><div><p className="eyebrow">{yearLabel(section.year_level)}</p><h1>{section.name}: students</h1>
      <p className="muted">{section.member_count} active student{section.member_count===1?'':'s'}{closed?' · this term is closed, so the list is read-only':''}</p></div></div>
    <div className="type-tabs" role="group" aria-label="Students view">{([['current','In this section'],['add','Add students']] as const).filter(([k])=>k==='current'||!closed).map(([k,l])=>
      <button key={k} type="button" className={`pill${tab===k?' active':''}`} aria-pressed={tab===k} onClick={()=>{setTab(k);setPage(1);setFind('');setMessage('')}}>{l}</button>)}</div>
    <section className="panel">
      <div className="list-tools">
        <label>Search<input type="search" value={find} onChange={e=>reset(()=>setFind(e.target.value))} placeholder="Name, email or student number"/></label>
        {tab==='current'
          ?<div className="segmented" role="group" aria-label="Status">{([['active','Active'],['withdrawn','Withdrawn'],['all','All']] as const).map(([k,l])=>
            <button key={k} type="button" className={status===k?'on':''} aria-pressed={status===k} onClick={()=>reset(()=>setStatus(k))}>{l}</button>)}</div>
          :<div className="segmented" role="group" aria-label="Account">{([['all','Everyone'],['active','Active accounts'],['invited','Invited']] as const).map(([k,l])=>
            <button key={k} type="button" className={account===k?'on':''} aria-pressed={account===k} onClick={()=>reset(()=>setAccount(k))}>{l}</button>)}</div>}
        {tab==='add'&&<button className="primary" disabled={picked.length===0||busy} onClick={addPicked}>{busy?'Adding…':picked.length===0?'Add selected':`Add ${picked.length} selected`}</button>}
      </div>
      {message&&<p role="alert" className="error">{message}</p>}
      {list.isPending?<p>Loading…</p>:list.error?<p role="alert">{list.error.message}</p>:rows.length===0
        ?<p className="muted">{search?'No students match that search.':tab==='add'?'No students are available to add.':status==='withdrawn'?'Nobody has been withdrawn from this section.':'No students in this section yet.'}</p>
        :<div className="table-wrap"><table><caption className="sr-only">{tab==='current'?'Students in this section':'Students you can add'}</caption>
          <thead><tr>{tab==='add'&&<th scope="col"><input type="checkbox" aria-label="Select every student on this page" checked={pageAllPicked} onChange={e=>togglePage(e.target.checked)}/></th>}
            <th scope="col">Student</th><th scope="col">Student no.</th><th scope="col">Email</th><th scope="col">{tab==='current'?'Status':'Account'}</th>{tab==='current'&&!closed&&<th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{rows.map(r=><tr key={r.student_id}>
            {tab==='add'&&<td><input type="checkbox" aria-label={`Select ${r.display_name}`} checked={pickedIds.has(r.student_id)} onChange={e=>toggle(r,e.target.checked)}/></td>}
            <td><strong>{r.display_name}</strong></td><td>{r.student_number}</td><td>{r.email}</td>
            <td><span className={`badge ${(r.status??r.account_status)==='active'?'done':''}`}>{tab==='current'?(r.status==='active'?'Active':'Withdrawn'):(r.account_status==='active'?'Active':'Invited')}</span></td>
            {tab==='current'&&!closed&&<td>{r.status==='active'&&<button onClick={()=>setLeaving(r)}>Withdraw</button>}</td>}</tr>)}</tbody></table></div>}
      {list.data&&<Pager page={page} pageSize={size} total={list.data.total} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}}/>}
      {tab==='add'&&picked.length>0&&<p className="muted">{picked.length} selected across all pages. <button type="button" className="linklike" onClick={()=>setPicked([])}>Clear selection</button></p>}
    </section>
    {leaving&&<WithdrawDialog sectionId={sectionId!} sectionName={section.name} student={leaving} onClose={()=>setLeaving(null)}
      onDone={()=>{toast(`${leaving.display_name} withdrawn.`);setLeaving(null);refresh()}}/>}
  </>;
}

function WithdrawDialog({sectionId,sectionName,student,onClose,onDone}:{sectionId:string;sectionName:string;student:Row;onClose:()=>void;onDone:()=>void}){
  const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{await send('DELETE',`/sections/${sectionId}/members/${student.student_id}?reason=${encodeURIComponent(reason.trim())}`);onDone()}
    catch(err){setError(errorText(err))}finally{setBusy(false)}
  }
  return <Dialog title={`Withdraw ${student.display_name}?`} onClose={onClose}><form onSubmit={submit}>
    <p>They leave {sectionName}. Their enrollment history is kept.</p>
    <label>Reason (kept in the audit history)<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={3} maxLength={1000} required autoFocus placeholder="For example: transferred to another program"/></label>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="danger" disabled={busy||reason.trim().length<3}>Withdraw student</button></div>
  </form></Dialog>;
}
