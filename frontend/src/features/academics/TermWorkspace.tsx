import {useToast} from '../../components/undo';
import {useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useHere} from '../../components/origin';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,errorText,ApiError,type Account} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {yearLabel,type OfferingSummary,type SchoolYear,type Section,type Subject} from './types';

export function TermWorkspace(){
  const {termId}=useParams();
  const here=useHere();
  const years=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const sections=useQuery({queryKey:['sections',termId],queryFn:()=>api<Section[]>(`/terms/${termId}/sections`)});
  const offerings=useQuery({queryKey:['offerings',termId],queryFn:()=>api<OfferingSummary[]>(`/terms/${termId}/offerings`)});
  const [dialog,setDialog]=useState<'section'|'offering'|null>(null);
  const [editing,setEditing]=useState<OfferingSummary|null>(null);
  const [tab,setTab]=useState<'sections'|'offerings'>('sections');
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
    <nav className="tabs" aria-label="Term workspace tabs">
      <button type="button" className={tab==='sections'?'active':''} aria-pressed={tab==='sections'} onClick={()=>setTab('sections')}>Sections</button>
      <button type="button" className={tab==='offerings'?'active':''} aria-pressed={tab==='offerings'} onClick={()=>setTab('offerings')}>Offerings</button>
    </nav>

    {tab==='sections'?
      <section className="panel">
        <div className="page-heading"><h2>Sections</h2><button className={sections.data?.length===0?'primary':''} disabled={closed} onClick={()=>setDialog('section')}>Add section</button></div>
        {sections.isPending?<p>Loading…</p>:sections.error?<p role="alert">{sections.error.message}</p>:
          sections.data.length===0?<p className="muted">No sections yet. Add one, or copy structure when creating the school year.</p>:
          <div className="table-wrap"><table><caption className="sr-only">Sections of this term</caption>
            <thead><tr><th scope="col">Section</th><th scope="col">Year level</th><th scope="col">Students</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{sections.data.map(s=><tr key={s.id}><th scope="row">{s.name}</th><td>{yearLabel(s.year_level)}</td><td>{s.member_count}</td>
              <td><Link className="button" state={here} to={`/admin/terms/${termId}/sections/${s.id}/students`}>{closed?'View students':'Manage students'}</Link></td></tr>)}</tbody></table></div>}
      </section>
      :
      <section className="panel">
        <div className="page-heading"><h2>Offerings</h2><button className={sections.data?.length&&offerings.data?.length===0?'primary':''} disabled={closed||!sections.data} onClick={()=>setDialog('offering')}>Assign subjects</button></div>
        {offerings.isPending?<p>Loading…</p>:offerings.error?<p role="alert">{offerings.error.message}</p>:
          offerings.data.length===0?<p className="muted">No subjects are assigned yet.</p>:
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Offerings"><table><thead><tr><th>Subject</th><th>Teacher</th><th>Sections</th><th>Enrolled</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{offerings.data.map(o=><tr key={o.id}>
              <td><strong>{o.subject.code}</strong> {o.subject.title}</td><td>{o.faculty.display_name}</td>
              <td>{o.sections.map(s=>s.name).join(', ')||'—'}</td><td>{o.enrolled}</td>
              <td className="actions"><Link className="button" state={here} to={`/admin/offerings/${o.id}`}>Roster</Link>
                <button disabled={closed} onClick={()=>setEditing(o)}>Edit</button></td></tr>)}</tbody></table></div>}
      </section>
    }

    {dialog==='section'&&<SectionDialog termId={term.id} onClose={()=>setDialog(null)} onDone={()=>{setDialog(null);refresh()}}/>}
    {dialog==='offering'&&<BulkAssignDialog termId={term.id} termSequence={term.sequence} sections={sections.data??[]} existing={offerings.data??[]}
      onClose={()=>setDialog(null)} onDone={()=>{setDialog(null);refresh()}}/>}
    {editing&&<OfferingDialog sections={sections.data??[]} offering={editing}
      onClose={()=>setEditing(null)} onDone={()=>{setEditing(null);refresh()}}/>}
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

function OfferingDialog({sections,offering,onClose,onDone}:{sections:Section[];offering:OfferingSummary;onClose:()=>void;onDone:()=>void}){
  const faculty=useQuery({queryKey:['faculty-list'],queryFn:()=>api<Account[]>('/accounts?role=faculty&page_size=100')});
  const [chosen,setChosen]=useState<string[]>(offering.sections.map(s=>s.id));
  const [facultyId,setFacultyId]=useState(offering.faculty.id);
  const [error,setError]=useState('');
  const [needsOverride,setNeedsOverride]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    const override=needsOverride?String(f.get('override_reason')||'').trim()||undefined:undefined;
    try{await send('PATCH',`/offerings/${offering.id}`,{faculty_id:f.get('faculty_id'),section_ids:chosen,placement_override_reason:override});onDone()}
    catch(err){setNeedsOverride(err instanceof ApiError&&err.code==='placement_mismatch');setError(errorText(err))}
  }
  return <Dialog title={`Edit ${offering.subject.code}`} onClose={onClose}><form onSubmit={submit}>
    <p><strong>{offering.subject.code}</strong> {offering.subject.title}</p>
    <label>Teacher<select name="faculty_id" required value={facultyId} onChange={e=>setFacultyId(e.target.value)}><option value="" disabled>Choose a teacher</option>
      {faculty.data?.filter(f=>f.status!=='inactive').map(f=><option key={f.id} value={f.id}>{f.display_name}</option>)}</select></label>
    <fieldset><legend>Sections taking this subject</legend>
      {sections.map(s=><label className="inline" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)}
        onChange={e=>setChosen(e.target.checked?[...chosen,s.id]:chosen.filter(x=>x!==s.id))}/> {s.name} ({s.member_count})</label>)}
    </fieldset>
    <p className="muted">A subject placed in a year and semester only accepts matching sections. Use an enrollment exception for irregular students.</p>
    {error&&<p role="alert">{error}</p>}
    {needsOverride&&<label>Reason for an off-semester placement (kept in the audit history)<textarea name="override_reason" minLength={3} maxLength={1000}/></label>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save changes</button></div>
  </form></Dialog>;
}

/** One teacher, several subjects, each with its own sections, saved together (all or nothing). */
function BulkAssignDialog({termId,termSequence,sections,existing,onClose,onDone}:{termId:string;termSequence:number;sections:Section[];existing:OfferingSummary[];onClose:()=>void;onDone:()=>void}){
  const toast=useToast();
  const subjects=useQuery({queryKey:['subjects',false],queryFn:()=>api<Subject[]>('/subjects')});
  const faculty=useQuery({queryKey:['faculty-list'],queryFn:()=>api<Account[]>('/accounts?role=faculty&page_size=100')});
  const [facultyId,setFacultyId]=useState('');
  const [find,setFind]=useState('');
  const [pick,setPick]=useState<Record<string,string[]>>({});          // subject id -> chosen section ids; present = subject selected
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const teacher=faculty.data?.find(f=>f.id===facultyId);
  const taken=new Set(existing.filter(o=>o.faculty.id===facultyId).map(o=>o.subject.id));
  const fits=(sub:Subject,sec:Section)=>sub.year_level===null||sub.semester===null||(sec.year_level===sub.year_level&&termSequence===sub.semester);
  const needle=find.trim().toLowerCase();
  const list=(subjects.data??[]).filter(sub=>sub.status==='active'&&(!needle||`${sub.code} ${sub.title}`.toLowerCase().includes(needle)))
    .sort((a,b)=>Number(pick[b.id]!==undefined)-Number(pick[a.id]!==undefined)||Number(a.semester===termSequence?0:1)-Number(b.semester===termSequence?0:1)||a.code.localeCompare(b.code));
  const chosen=Object.keys(pick);
  const subjectOf=(id:string)=>subjects.data?.find(x=>x.id===id);
  const needsReason=(id:string)=>{const sub=subjectOf(id);return !!sub&&pick[id].some(sid=>{const sec=sections.find(x=>x.id===sid);return !!sec&&!fits(sub,sec)})};   // a section from another year
  const ready=!!facultyId&&chosen.length>0&&chosen.every(id=>pick[id].length>0&&(!needsReason(id)||(reasons[id]??'').trim().length>=3));
  function toggleSubject(sub:Subject,on:boolean){
    if(!on){const rest={...pick};delete rest[sub.id];setPick(rest);return}
    setPick({...pick,[sub.id]:sections.filter(sec=>sub.year_level!==null&&fits(sub,sec)).map(sec=>sec.id)});   // sections that match its year and semester start ticked
  }
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    const items=chosen.map(id=>({subject_id:id,section_ids:pick[id],placement_override_reason:needsReason(id)?(reasons[id]??'').trim():undefined}));
    try{await post(`/terms/${termId}/offerings/bulk`,{faculty_id:facultyId,items});toast(`${items.length} subject${items.length===1?'':'s'} assigned to ${teacher?.display_name}.`);onDone()}
    catch(err){
      setError(errorText(err));
    }finally{setBusy(false)}
  }
  return <Dialog title="Assign subjects" onClose={onClose}><form onSubmit={submit}>
    <label>Teacher<select required value={facultyId} onChange={e=>setFacultyId(e.target.value)}><option value="" disabled>Choose a teacher</option>
      {faculty.data?.filter(f=>f.status!=='inactive').map(f=><option key={f.id} value={f.id}>{f.display_name}</option>)}</select></label>
    <fieldset className="bulk-subjects"><legend>Subjects and the sections taking each</legend>
      {sections.length===0&&<p className="muted">Add sections first.</p>}
      <label>Filter subjects<input type="search" value={find} onChange={e=>setFind(e.target.value)} placeholder="Code or title"/></label>
      {subjects.isPending?<p>Loading subjects…</p>:<ul className="pick-list" aria-label="Subjects">{list.map(sub=>{
        const on=pick[sub.id]!==undefined,done=taken.has(sub.id);
        return <li key={sub.id} className={on?'on':''}>
          <label className="inline"><input type="checkbox" checked={on} disabled={!facultyId||done} onChange={e=>toggleSubject(sub,e.target.checked)}/>
            <span><strong>{sub.code}</strong> {sub.title} <span className="muted">{sub.year_level?`Year ${sub.year_level}, semester ${sub.semester}`:'not placed'}{done?' · already assigned to this teacher':''}</span></span></label>
          {on&&<div className="bulk-sections"><div className="chips" role="group" aria-label={`Sections for ${sub.code}`}>{sections.map(sec=>
            <label className="inline" key={sec.id}><input type="checkbox" checked={pick[sub.id].includes(sec.id)} onChange={e=>setPick({...pick,[sub.id]:e.target.checked?[...pick[sub.id],sec.id]:pick[sub.id].filter(x=>x!==sec.id)})}/> {sec.name} <span className="muted">({sec.member_count}){fits(sub,sec)?'':' · other year'}</span></label>)}</div>
            {pick[sub.id].length===0&&<p className="muted">Choose at least one section.</p>}
            {needsReason(sub.id)&&<label>Reason for placing {sub.code} with a section from another year (kept in the audit history)<textarea value={reasons[sub.id]??''} onChange={e=>setReasons({...reasons,[sub.id]:e.target.value})} minLength={3} maxLength={1000} required/></label>}</div>}</li>})}</ul>}
      {!facultyId&&<p className="muted">Choose a teacher first.</p>}
    </fieldset>
    <p className="muted">A subject placed in a year and semester only accepts matching sections. Choosing a section from another year asks for a reason. Nothing is saved unless every selected subject can be assigned.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={!ready||busy}>{busy?'Assigning…':chosen.length===0?'Assign subjects':`Assign ${chosen.length} subject${chosen.length===1?'':'s'}`}</button></div>
  </form></Dialog>;
}
