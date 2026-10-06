import {useState,type FormEvent} from 'react';
import {useOutletContext} from 'react-router-dom';
import {useInfiniteQuery} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import type {OfferingSummary} from '../academics/types';
import type {Announcement} from './types';

const PAGE=25;   // newest first; "Load more" asks the server for the next page
interface Page{items:Announcement[];has_more:boolean}
export function FacultyAnnouncements(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const closed=offering.term_status==='closed';
  const base=`/teach/offerings/${offering.id}/announcements`;
  const query=useInfiniteQuery({queryKey:['announcements',offering.id],initialPageParam:0,queryFn:({pageParam})=>api<Page>(`${base}?limit=${PAGE}&offset=${pageParam}`),getNextPageParam:(p,all)=>p.has_more?all.length*PAGE:undefined});
  const rows=query.data?.pages.flatMap(p=>p.items)??[];
  const [editing,setEditing]=useState<Announcement|'new'|null>(null);
  const [message,setMessage]=useState('');
  const refresh=()=>queryClient.invalidateQueries({queryKey:['announcements',offering.id]});
  async function act(a:Announcement,action:'publish'|'archive'){
    if(action==='publish'&&!confirm('Publish this announcement? Students in the chosen sections will see it.'))return;
    try{await post(`${base}/${a.id}/${action}`,{});setMessage('');refresh()}catch(e){setMessage(errorText(e))}
  }
  const names=(ids:string[])=>ids.length===0?'All sections':ids.map(id=>offering.sections.find(s=>s.id===id)?.name??'').join(', ');
  return <>
    <div className="page-heading"><div><h2>Announcements</h2><p className="muted">Short notices for your sections. Save a draft, then publish when ready.</p></div>
      <button className="primary" disabled={closed} onClick={()=>{setMessage('');setEditing('new')}}>New announcement</button></div>
    {message&&<p role="alert">{message}</p>}
    {query.isPending?<p>Loading…</p>:query.error?<p role="alert">{query.error.message}</p>:
      rows.length===0?<section className="panel"><h2>No announcements yet</h2></section>:
      <div className="cards">{rows.map(a=><article className="panel" key={a.id}>
        <p className="eyebrow">{a.state} · {names(a.section_ids)}</p><h3>{a.title}</h3><p className="pre">{a.body}</p>
        <div className="actions">
          {a.state==='draft'&&<><button disabled={closed} onClick={()=>setEditing(a)}>Edit</button><button className="primary" disabled={closed} onClick={()=>act(a,'publish')}>Publish</button></>}
          {a.state==='published'&&<button disabled={closed} onClick={()=>act(a,'archive')}>Archive</button>}</div></article>)}</div>}
    {query.hasNextPage&&<button disabled={query.isFetchingNextPage} onClick={()=>query.fetchNextPage()}>{query.isFetchingNextPage?'Loading…':'Load more announcements'}</button>}
    {editing&&<Editor offering={offering} existing={editing==='new'?null:editing} onClose={()=>setEditing(null)} onDone={()=>{setEditing(null);refresh()}}/>}
  </>;
}

function Editor({offering,existing,onClose,onDone}:{offering:OfferingSummary;existing:Announcement|null;onClose:()=>void;onDone:()=>void}){
  const [chosen,setChosen]=useState<string[]>(existing?.section_ids??[]);const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);const body={title:f.get('title'),body:f.get('body'),section_ids:chosen};
    try{if(existing)await send('PUT',`/teach/offerings/${offering.id}/announcements/${existing.id}`,body);else await post(`/teach/offerings/${offering.id}/announcements`,body);onDone()}
    catch(err){setError(errorText(err))}
  }
  return <Dialog title={existing?'Edit announcement':'New announcement'} onClose={onClose}><form onSubmit={submit}>
    <label>Title<input name="title" required maxLength={200} defaultValue={existing?.title}/></label>
    <label>Message<textarea name="body" required maxLength={5000} defaultValue={existing?.body}/></label>
    <fieldset><legend>Send to</legend><p className="muted">Leave all unchecked to send to every section.</p>
      {offering.sections.map(s=><label className="inline" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={e=>setChosen(e.target.checked?[...chosen,s.id]:chosen.filter(x=>x!==s.id))}/> {s.name}</label>)}</fieldset>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save draft</button></div>
  </form></Dialog>;
}
