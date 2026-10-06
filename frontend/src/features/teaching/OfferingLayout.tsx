import {Link,NavLink,Outlet,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import type {OfferingSummary} from '../academics/types';

/** Shared header + tabs for one subject. role selects the route prefix and tab set. */
export function OfferingLayout({role}:{role:'faculty'|'student'}){
  const {offeringId}=useParams();
  const base=`/${role}/offerings/${offeringId}`;
  const query=useQuery({queryKey:['offering',offeringId],queryFn:()=>api<OfferingSummary&{enrollment_status?:string}>(role==='faculty'?`/offerings/${offeringId}`:`/learn/offerings/${offeringId}`)});
  return <>
    <p className="back"><Link to={`/${role}/subjects`}>← My subjects</Link></p>
    {query.isPending?<p>Loading…</p>:query.error?<section className="panel"><h1>Subject unavailable</h1><p role="alert">{query.error.message}</p></section>:<>
      <div className="page-heading"><div>
        <p className="eyebrow">{query.data.term}{query.data.term_status==='closed'?' · closed (read-only)':''}</p>
        <h1>{query.data.subject.code} · {query.data.subject.title}</h1>
        <p className="muted">{role==='faculty'?query.data.sections.map(s=>s.name).join(', ')||'No sections':query.data.faculty.display_name}</p>
      </div></div>
      {role==='student'&&query.data.enrollment_status==='withdrawn'?<>
        <p className="warn" role="status">You are no longer enrolled in this subject. Course content is not available, but you can still see your own results and your earlier study chats.</p>
        <nav className="tabs" aria-label="Subject sections"><NavLink to={`${base}/study`}>Study help history</NavLink><NavLink to={`${base}/results`}>Grades & results</NavLink></nav></>:
      <nav className="tabs" aria-label="Subject sections">
        {role==='faculty'&&<NavLink end to={base}>Students</NavLink>}
        <NavLink to={`${base}/syllabus`}>Syllabus</NavLink>
        <NavLink to={`${base}/${role==='faculty'?'content':'lessons'}`}>{role==='faculty'?'Content':'Lessons & materials'}</NavLink>
        {role==='faculty'?<><NavLink to={`${base}/assessments`}>Assessments</NavLink><NavLink to={`${base}/attendance`}>Attendance</NavLink><NavLink to={`${base}/gradebook`}>Gradebook</NavLink><NavLink to={`${base}/class-standing`}>Class standing</NavLink><NavLink to={`${base}/progress`}>Progress</NavLink></>
          :<><NavLink to={`${base}/study`}>Study help</NavLink><NavLink to={`${base}/work`}>My work</NavLink><NavLink to={`${base}/progress`}>My progress</NavLink><NavLink to={`${base}/results`}>Grades & results</NavLink></>}
        <NavLink to={`${base}/announcements`}>Announcements</NavLink>
      </nav>}
      <Outlet context={{offering:query.data}}/>
    </>}
  </>;
}
