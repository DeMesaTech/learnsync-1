import {useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useHere} from '../../components/origin';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,errorText,ApiError,type Account} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {useConfirm} from '../../components/confirm';
import {yearLabel,type Member,type OfferingSummary,type SchoolYear,type Section,type Subject} from './types';

export function TermWorkspace(){
  const {termId}=useParams();
  const here=useHere();
  const years=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const sections=useQuery({queryKey:['sections',termId],queryFn:()=>api<Section[]>(`/terms/${termId}/sections`)});
  const offerings=useQuery({queryKey:['offerings',termId],queryFn:()=>api<OfferingSummary[]>(`/terms/${termId}/offerings`)});
  const [dialog,setDialog]=useState<'section'|'offering'|null>(null);
  const [managing,setManaging]=useState<Section|null>(null);
  const [editing,setEditing]=useState<OfferingSummary|null>(null);
  const year=years.data?.find(y=>y.terms.some(t=>t.id===termId));
  const term=year?.terms.find(t=>t.id===termId);
  const closed=term?.status==='closed';
  const refresh=()=>{queryClient.invalidateQueries({queryKey:['sections',termId]});queryClient.invalidateQueries({queryKey:['offerings',termId]})};

  if(years.isPending)return <p>Loading…</p>;
  if(!term)return <section className="panel"><h1>Term not found</h1><Link to="/admin/academics">Back to school years</Link></section>;
  return <>
    <p className="back"><Link to="/admin/academics">← School years</Link></p>
    <div className="page-heading">
      <div><p className="eyebrow">{year?.label}</p><h1>{term.name}</h1>
        <span className={`badge ${term.status}`}>{term.status}</span></div>
      <Link className={offerings.data?.length&&offerings.data.every(o=>o.enrolled===0)?'button primary':'button'} to={`/admin/terms/${termId}/import-students`}>Import students</Link>
    </div>
    {closed&&<p className="warn" role="status">This term is closed. Reopen it from School years to make changes.</p>}

    <section className="panel">
      <div className="page-heading"><h2>Sections</h2><button className={sections.data?.length===0?'primary':''} disabled={closed} onClick={()=>setDialog('section')}>Add section</button></div>
      {sections.isPending?<p>Loading…</p>:sections.error?<p role="alert">{sections.error.message}</p>:
        sections.data.length===0?<p className="muted">No sections yet. Add one, or copy structure when creating the school year.</p>:
        <div className="cards">{sections.data.map(s=><article className="subpanel" key={s.id}>
          <div><h3>{s.name}</h3><p className="muted">{yearLabel(s.year_level)} · {s.member_count} student{s.member_count===1?'':'s'}</p></div>
          <button onClick={()=>setManaging(s)}>{closed?'View students':'Manage students'}</button></article>)}</div>}
    </section>

    <section className="panel">
      <div className="page-heading"><h2>Offerings</h2><button className={sections.data?.length&&offerings.data?.length===0?'primary':''} disabled={closed||!sections.data} onClick={()=>setDialog('offering')}>Assign a subject</button></div>
      {offerings.isPending?<p>Loading…</p>:offerings.error?<p role="alert">{offerings.error.message}</p>:
        offerings.data.length===0?<p className="muted">No subjects are assigned yet.</p>:
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Offerings"><table><thead><tr><th>Subject</th><th>Teacher</th><th>Sections</th><th>Enrolled</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{offerings.data.map(o=><tr key={o.id}>
            <td><strong>{o.subject.code}</strong> {o.subject.title}</td><td>{o.faculty.display_name}</td>
            <td>{o.sections.map(s=>s.name).join(', ')||'—'}</td><td>{o.enrolled}</td>
            <td className="actions"><Link className="button" state={here} to={`/admin/offerings/${o.id}`}>Roster</Link>
              <button disabled={closed} onClick={()=>setEditing(o)}>Edit</button></td></tr>)}</tbody></table></div>}
    </section>

    {dialog==='section'&&<SectionDialog termId={term.id} onClose={()=>setDialog(null)} onDone={()=>{setDialog(null);refresh()}}/>}
    {(dialog==='offering'||editing)&&<OfferingDialog termId={term.id} sections={sections.data??[]} offering={editing}
      onClose={()=>{setDialog(null);setEditing(null)}} onDone={()=>{setDialog(null);setEditing(null);refresh()}}/>}
    {managing&&<MembersDialog section={managing} closed={!!closed} onClose={()=>{setManaging(null);refresh()}}/>}
  </>;
}

function SectionDialog({termId,onClose,onDone}:{termId:string;onClose:()=>void;onDone:()=>void}){
  const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await post(`/terms/${termId}/sections`,{name:f.get('name'),year_level:Number(f.get('year_level'))});onDone()}
    catch(err){setError(errorText(err))}
  }
  return <Dialog title="Add section" onClose={onClose}><form onSubmit={submit}>
    <label>Section name<input name="name" required maxLength={60} placeholder="BSE 1-A"/></label>
    <label>Year level<select name="year_level" defaultValue="1">{[1,2,3,4,5,6].map(n=><option key={n} value={n}>{yearLabel(n)}</option>)}</select></label>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Add section</button></div>
  </form></Dialog>;
}

function OfferingDialog({termId,sections,offering,onClose,onDone}:{termId:string;sections:Section[];offering:OfferingSummary|null;onClose:()=>void;onDone:()=>void}){
  const subjects=useQuery({queryKey:['subjects',false],queryFn:()=>api<Subject[]>('/subjects')});
  const faculty=useQuery({queryKey:['faculty-list'],queryFn:()=>api<Account[]>('/accounts?role=faculty&page_size=100')});
  const [chosen,setChosen]=useState<string[]>(offering?.sections.map(s=>s.id)??[]);
  const [facultyId,setFacultyId]=useState(offering?.faculty.id??'');
  const [error,setError]=useState('');
  const [needsOverride,setNeedsOverride]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    const override=needsOverride?String(f.get('override_reason')||'').trim()||undefined:undefined;
    try{
      if(offering)await send('PATCH',`/offerings/${offering.id}`,{faculty_id:f.get('faculty_id'),section_ids:chosen,placement_override_reason:override});
      else await post(`/terms/${termId}/offerings`,{subject_id:f.get('subject_id'),faculty_id:f.get('faculty_id'),section_ids:chosen,placement_override_reason:override});
      onDone();
    }catch(err){
      setNeedsOverride(err instanceof ApiError&&err.code==='placement_mismatch');
      setError(errorText(err));
    }
  }
  return <Dialog title={offering?`Edit ${offering.subject.code}`:'Assign a subject'} onClose={onClose}><form onSubmit={submit}>
    {offering?<p><strong>{offering.subject.code}</strong> {offering.subject.title}</p>:
      <label>Subject<select name="subject_id" required defaultValue=""><option value="" disabled>Choose a subject</option>
        {subjects.data?.map(s=><option key={s.id} value={s.id}>{s.code} · {s.title} ({s.year_level?`Y${s.year_level} S${s.semester}`:'unplaced'})</option>)}</select></label>}
    <label>Teacher<select name="faculty_id" required value={facultyId} onChange={e=>setFacultyId(e.target.value)}><option value="" disabled>Choose a teacher</option>
      {faculty.data?.filter(f=>f.status!=='inactive').map(f=><option key={f.id} value={f.id}>{f.display_name}</option>)}</select></label>
    <fieldset><legend>Sections taking this subject</legend>
      {sections.length===0&&<p className="muted">Add sections first.</p>}
      {sections.map(s=><label className="inline" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)}
        onChange={e=>setChosen(e.target.checked?[...chosen,s.id]:chosen.filter(x=>x!==s.id))}/> {s.name} ({s.member_count})</label>)}
    </fieldset>
    <p className="muted">A subject placed in a year and semester only accepts matching sections. Use an enrollment exception for irregular students.</p>
    {error&&<p role="alert">{error}</p>}
    {needsOverride&&<label>Reason for an off-semester placement (kept in the audit history)<textarea name="override_reason" minLength={3} maxLength={1000}/></label>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">{offering?'Save changes':'Assign subject'}</button></div>
  </form></Dialog>;
}

function MembersDialog({section,closed,onClose}:{section:Section;closed:boolean;onClose:()=>void}){
  const ask=useConfirm();
  const members=useQuery({queryKey:['members',section.id],queryFn:()=>api<Member[]>(`/sections/${section.id}/members`)});
  const [search,setSearch]=useState('');
  const results=useQuery({queryKey:['student-search',search],enabled:search.length>=2&&!closed,
    queryFn:()=>api<Account[]>(`/accounts?role=student&page_size=10&search=${encodeURIComponent(search)}`)});
  const [message,setMessage]=useState('');
  const refresh=()=>queryClient.invalidateQueries({queryKey:['members',section.id]});
  async function add(a:Account){try{await post(`/sections/${section.id}/members`,{student_id:a.id});setMessage(`${a.display_name} added.`);setSearch('');refresh()}catch(e){setMessage(errorText(e))}}
  async function withdraw(m:Member){if(!await ask({title:`Withdraw ${m.display_name}?`,message:`They leave ${section.name}. Their enrollment history is kept.`,yes:'Withdraw',danger:true}))return;
    try{await send('DELETE',`/sections/${section.id}/members/${m.student_id}`);setMessage(`${m.display_name} withdrawn.`);refresh()}catch(e){setMessage(errorText(e))}}
  return <Dialog title={`${section.name} students`} onClose={onClose}>
    {!closed&&<><label>Add a student<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or email"/></label>
      {results.data?.map(a=><div className="member-row" key={a.id}><span>{a.display_name} <span className="muted">{a.student_number}</span></span><button onClick={()=>add(a)}>Add</button></div>)}
      {results.data?.length===0&&<p className="muted">No matching students.</p>}</>}
    {message&&<p role="status">{message}</p>}
    <h3>Current students</h3>
    {members.isPending?<p>Loading…</p>:members.data?.length===0?<p className="muted">No students in this section.</p>:
      members.data?.map(m=><div className="member-row" key={m.student_id}><span>{m.display_name} <span className="muted">{m.student_number}</span></span>
        {!closed&&<button onClick={()=>withdraw(m)}>Withdraw</button>}</div>)}
    <div className="actions"><button className="primary" onClick={onClose}>Done</button></div>
  </Dialog>;
}
