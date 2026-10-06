import {useHere,useOrigin} from '../../components/origin';
import {SubjectCard} from '../dashboard/Dashboards';
import {useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,send,errorText,type Account} from '../../app/api';
import {queryClient,useAuth} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import type {MySubject,OfferingSummary,RosterRow} from './types';

const labels:Record<string,string>={enrolled:'Enrolled',withdrawn:'Withdrawn',excluded:'Excluded'};

/** Roster for one offering: read-only for the assigned faculty, manageable by admin. */
export function OfferingRoster({embedded=false}:{embedded?:boolean}){
  const {offeringId}=useParams();
  const {session}=useAuth();
  const isAdmin=session?.user?.role==='admin';
  const here=useHere();
  const offering=useQuery({queryKey:['offering',offeringId],queryFn:()=>api<OfferingSummary>(`/offerings/${offeringId}`)});
  const [history,setHistory]=useState(false);
  const roster=useQuery({queryKey:['roster',offeringId,history],queryFn:()=>api<RosterRow[]>(`/offerings/${offeringId}/students${history?'?history=true':''}`)});
  const [dialog,setDialog]=useState(false);
  const [message,setMessage]=useState('');
  const refresh=()=>queryClient.invalidateQueries({queryKey:['roster',offeringId]});
  const parent=useOrigin(isAdmin?'/admin/academics':'/faculty/subjects',isAdmin?'School years':'My subjects');
  const back=parent.to;

  async function clear(r:RosterRow){
    try{await send('DELETE',`/offerings/${offeringId}/exceptions/${r.student_id}`);setMessage('Exception removed.');refresh()}
    catch(err){setMessage(errorText(err))}
  }
  return <>
    {!embedded&&<p className="back"><Link to={back}>← Back to {parent.label}</Link></p>}
    {!embedded&&<div className="page-heading"><div><p className="eyebrow">{offering.data?.term}</p><h1>{offering.data?`${offering.data.subject.code} roster`:'Student roster'}</h1>{offering.data&&<p className="muted">{offering.data.subject.title} · {offering.data.faculty.display_name}</p>}</div>
      {isAdmin&&offering.data?.term_status==='open'&&<button className="primary" onClick={()=>{setMessage('');setDialog(true)}}>Add exception</button>}</div>}
    {!isAdmin&&<label className="inline"><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/> Show withdrawn students</label>}
    {message&&<p role="status">{message}</p>}
    {roster.isPending?<p>Loading…</p>:roster.error?<p role="alert">{roster.error.message}</p>:
      roster.data.length===0?<section className="panel"><p>No students are enrolled in this subject yet.</p></section>:
      <section className="panel"><div className="table-wrap" tabIndex={0} role="region" aria-label="Students"><table>
        <thead><tr><th>Student</th><th>Number</th><th>Section</th><th>Status</th>{isAdmin&&<th>Note</th>}{isAdmin&&<th><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{roster.data.map(r=><tr key={r.student_id}>
          <td>{isAdmin?r.display_name:<Link state={here} to={`/faculty/offerings/${offeringId}/students/${r.student_id}`}>{r.display_name}</Link>}</td><td>{r.student_number}</td><td>{r.section??'—'}</td>
          <td><span className="badge">{labels[r.status]}{r.source==='exception'&&r.status==='enrolled'?' · irregular':''}</span></td>
          {isAdmin&&<td>{r.exception_reason??''}</td>}
          {isAdmin&&<td>{r.exception_reason&&<button onClick={()=>clear(r)}>Remove exception</button>}</td>}
        </tr>)}</tbody></table></div></section>}
    {dialog&&<ExceptionDialog offeringId={offeringId!} onClose={()=>setDialog(false)} onDone={()=>{setDialog(false);setMessage('Exception saved.');refresh()}}/>}
  </>;
}

function ExceptionDialog({offeringId,onClose,onDone}:{offeringId:string;onClose:()=>void;onDone:()=>void}){
  const [search,setSearch]=useState('');
  const [student,setStudent]=useState<Account|null>(null);
  const [error,setError]=useState('');
  const results=useQuery({queryKey:['student-search',search],enabled:search.length>=2&&!student,
    queryFn:()=>api<Account[]>(`/accounts?role=student&page_size=10&search=${encodeURIComponent(search)}`)});
  const offering=useQuery({queryKey:['offering',offeringId],queryFn:()=>api<OfferingSummary>(`/offerings/${offeringId}`)});
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!student){setError('Choose a student first.');return}
    const f=new FormData(e.currentTarget);const action=f.get('action');
    try{await send('PUT',`/offerings/${offeringId}/exceptions/${student.id}`,{action,section_id:action==='include'?f.get('section_id'):null,reason:f.get('reason')});onDone()}
    catch(err){setError(errorText(err))}
  }
  return <Dialog title="Enrollment exception" onClose={onClose}><form onSubmit={submit}>
    <p className="muted">Include an irregular student who belongs to another section, or exclude a regular student (for example credited subjects).</p>
    {student?<p><strong>{student.display_name}</strong> <button type="button" onClick={()=>setStudent(null)}>Change</button></p>:<>
      <label>Student<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or email"/></label>
      {results.data?.map(a=><div className="member-row" key={a.id}><span>{a.display_name} <span className="muted">{a.student_number}</span></span><button type="button" onClick={()=>setStudent(a)}>Choose</button></div>)}</>}
    <label>Action<select name="action" defaultValue="include"><option value="include">Include in this subject</option><option value="exclude">Exclude from this subject</option></select></label>
    <label>Teaching section (for include)<select name="section_id" defaultValue="">{offering.data?.sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Reason<textarea name="reason" required minLength={3} maxLength={1000}/></label>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save exception</button></div>
  </form></Dialog>;
}

export function FacultySubjects(){
  const query=useQuery({queryKey:['my-offerings'],queryFn:()=>api<OfferingSummary[]>('/me/offerings')});
  return <>
    <h1>My subjects</h1><p className="muted">Subjects assigned to you, with their sections and enrolled students.</p>
    {query.isPending?<p>Loading…</p>:query.error?<p role="alert">{query.error.message}</p>:
      query.data.length===0?<section className="panel"><h2>Nothing assigned yet</h2><p>When an administrator assigns you a subject, it appears here.</p></section>:
      <div className="cards">{query.data.map(o=><SubjectCard key={o.id} code={o.subject.code} title={o.subject.title} meta={o.term_status==='closed'?`${o.term} · closed`:o.term}
        detail={`${o.sections.map(x=>x.name).join(', ')||'No sections'} · ${o.enrolled} student${o.enrolled===1?'':'s'}`} to={`/faculty/offerings/${o.id}`} action="Open"
        links={[['Content',`/faculty/offerings/${o.id}/content`],['Assessments',`/faculty/offerings/${o.id}/assessments`],['Gradebook',`/faculty/offerings/${o.id}/gradebook`]]}/>)}</div>}
  </>;
}

export function StudentSubjects(){
  const query=useQuery({queryKey:['my-subjects'],queryFn:()=>api<MySubject[]>('/me/subjects')});
  return <>
    <h1>My subjects</h1><p className="muted">Subjects you are enrolled in, including past terms.</p>
    {query.isPending?<p>Loading…</p>:query.error?<p role="alert">{query.error.message}</p>:
      query.data.length===0?<section className="panel"><h2>No subjects yet</h2><p>Your subjects appear here once you are enrolled in a section.</p></section>:
      <div className="cards">{query.data.map(s=>{const o=`/student/offerings/${s.offering_id}`;const active=s.enrollment_status==='enrolled';
        return <SubjectCard key={s.offering_id} code={s.subject.code} title={s.subject.title}
          meta={s.enrollment_status==='withdrawn'?'Withdrawn':s.term_status==='closed'?`${s.term} · past term`:s.term}
          detail={`${s.subject.units} units · ${s.faculty.display_name}${active?'':' · course content is no longer available, but you can still see your own results'}`}
          to={active?`${o}/lessons`:`${o}/results`} action={active?'Open':'View results'}
          links={active?[['Progress',`${o}/progress`],['Grades & results',`${o}/results`],['Study help',`${o}/study`]]:[]}/>})}</div>}
  </>;
}
