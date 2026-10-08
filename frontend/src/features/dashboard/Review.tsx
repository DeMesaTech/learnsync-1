import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import {useHere} from '../../components/origin';

interface Waiting{offering_id:string;assessment_id:string;title:string;subject:string;student_id:string;student:string;submitted_at:string;late:boolean;resubmitted:boolean;link:string}
const when=(iso:string)=>new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

/** Faculty: every activity submission waiting for a grade, across all of your subjects, oldest first. */
export function FacultyReview(){
  const here=useHere();
  const query=useQuery({queryKey:['review','faculty'],queryFn:()=>api<{items:Waiting[];total:number}>('/dashboard/faculty/review')});
  if(query.isPending)return <p role="status">Loading…</p>;
  if(query.error)return <section className="panel"><h2>The queue could not be loaded</h2><p role="alert">{query.error.message}</p></section>;
  const {items,total}=query.data;
  // group by subject then by assessment, keeping the oldest-first order inside each
  const groups=new Map<string,{title:string;subject:string;link:string;rows:Waiting[]}>();
  for(const w of items){const g=groups.get(w.assessment_id)??{title:w.title,subject:w.subject,link:w.link,rows:[]};g.rows.push(w);groups.set(w.assessment_id,g)}
  return <>
    <div className="page-heading"><div><p className="eyebrow">All subjects</p><h1>To review</h1>
      <p className="muted">Activity submissions waiting for a grade, oldest first. Quizzes score themselves and teacher-scored items are entered in the gradebook.</p></div></div>
    {total===0?<section className="panel"><h2>Nothing is waiting</h2><p className="muted">New submissions appear here as soon as students hand them in.</p></section>
      :<><p role="status" className="muted">{total} submission{total===1?'':'s'} waiting.</p>
        {[...groups.values()].map(g=><section className="panel" key={g.link}><div className="page-heading"><div><h2>{g.title}</h2><p className="muted">{g.subject} · {g.rows.length} waiting</p></div>
          <Link state={here} className="button primary" to={g.link}>Open and grade</Link></div>
          <ul className="rows">{g.rows.map(w=><li key={w.student_id}><Link state={here} to={w.link}>{w.student}</Link>
            <span className="muted">submitted {when(w.submitted_at)}{w.late?' · late':''}{w.resubmitted?' · new version since grading':''}</span></li>)}</ul></section>)}</>}
  </>;
}
