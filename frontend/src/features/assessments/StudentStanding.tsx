import {stepLabel} from '../study/types';
import {useEffect,useRef,useState} from 'react';
import {Link,useOutletContext,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import {useHere,useOrigin} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {Dialog} from '../../components/Dialog';
import {AttemptReview,type AttemptRef} from './AnswerReview';
import {KIND_LABEL,PERIOD_LABEL,fmt,type CategoryInfo,type Kind} from './types';

interface Period{grade:number|null;pending:string[];categories:CategoryInfo[]}
interface Standing{
  student:{id:string;name:string;student_number:string;section:string|null;enrollment_status:'enrolled'|'withdrawn'};
  calculation:{policy_version:number;passing:number;grades:Record<string,Period>;published_flags:Record<string,{needs_review:boolean;review_reason:string|null}>}|null;
  calculation_note:string;
  published:Record<string,{grade:number;remark:string;release_number:number;published_at:string}>;
  assessments:{id:string;title:string;kind:Kind;period:string|null;category:string|null;max_points:number;counts_toward_grade:boolean;deadline:string|null;submission:string;scored:boolean;working_score:number|null;feedback:string;released:boolean;released_score:number|null;unreleased_change:boolean;attempts:AttemptRef[]}[];
  historical:{id:string;title:string;kind:Kind;archived:boolean;working_score:number|null;released_score:number|null}[];
  attendance:{days:{date:string;period:string;status:string|null}[];counts:Record<string,Record<string,number>>};
  progress:{total:number;done:number;percent:number|null;steps:{id:string;type:'lesson_completed'|'quiz_submitted'|'activity_submitted';title:string;done:boolean;kind?:string}[];outside_count:number;note:string;days:{date:string;count:number}[];last_activity_at:string|null}|null;
}
const SUBMISSION:Record<string,string>={not_attempted:'Not attempted',in_progress:'In progress',submitted:'Submitted',submitted_late:'Submitted late',not_submitted:'Not submitted',teacher_entered:'Entered by teacher'};
const MARK:Record<string,string>={present:'Present',late:'Late',absent:'Absent',excused:'Excused'};
const day=(iso:string)=>new Date(iso+'T00:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
const stamp=(iso:string|null)=>iso?new Date(iso).toLocaleString():'No recorded activity yet';

/** A printed page cannot expand things, so every fold is opened for the print and put back afterwards. */
function usePrintOpensFolds(root:React.RefObject<HTMLElement|null>){
  useEffect(()=>{
    let closed:HTMLDetailsElement[]=[];
    const before=()=>{closed=[...(root.current?.querySelectorAll('details')??[])].filter(d=>!d.open);closed.forEach(d=>{d.open=true})};
    const after=()=>{closed.forEach(d=>{d.open=false});closed=[]};
    window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);
    return()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after)};
  },[root]);
}

export function StudentStanding(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const {studentId}=useParams();
  const base=`/faculty/offerings/${offering.id}`;
  const origin=useOrigin(base,'Students');const here=useHere();
  const [reviewing,setReviewing]=useState<string|null>(null);   // the quiz whose answers are open
  const query=useQuery({queryKey:['standing',offering.id,studentId],queryFn:()=>api<Standing>(`/teach/offerings/${offering.id}/students/${studentId}/standing`)});
  const page=useRef<HTMLDivElement>(null);usePrintOpensFolds(page);
  const [busy,setBusy]=useState('');const [note,setNote]=useState('');
  async function download(basis:'published'|'working'){
    setBusy(basis);setNote('');
    try{
      const response=await fetch(`/api/teach/offerings/${offering.id}/students/${studentId}/standing.pdf?basis=${basis}`,{credentials:'same-origin'});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error?.message||'The PDF could not be created.')}
      const name=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')??'')?.[1]??'standing.pdf';
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),10000);setNote(`Downloaded ${name}.`);
    }catch(e){setNote(e instanceof Error?e.message:'The PDF could not be created.')}
    finally{setBusy('')}
  }
  const back=<p className="back no-print"><Link to={origin.to}>← Back to {origin.label}</Link></p>;
  if(query.isPending)return <>{back}<p>Loading…</p></>;
  if(query.error)return <>{back}<section className="panel"><h2>Student unavailable</h2><p role="alert">{query.error.message}</p></section></>;
  const d=query.data;const withdrawn=d.student.enrollment_status==='withdrawn';
  const periods=Object.keys(d.calculation?.grades??d.published).filter(k=>k!=='course').concat('course');
  const counts=d.attendance.counts;
  return <div ref={page}>
    {back}
    <p className="print-only warn"><strong>Faculty record.</strong> Includes working values the student cannot see yet. Do not hand this page to the student; use the student PDF instead.</p>
    <div className="page-heading"><div><p className="eyebrow">{d.student.student_number} · {d.student.section??'No section'}</p><h2>{d.student.name}</h2>
      <p className="muted">Standing in {offering.subject.code} · {offering.subject.title}. Read-only: it uses the same calculations as the gradebook and attendance register.</p></div>
      <div className="actions no-print"><Link className="button" state={here} to={`${base}/gradebook`}>Gradebook</Link><Link className="button" state={here} to={`${base}/attendance`}>Attendance</Link><Link className="button" state={here} to={`${base}/assessments`}>Assessments</Link></div></div>
    <section className="panel no-print" aria-labelledby="share-h"><h3 id="share-h">Print or export</h3>
      <div className="actions"><button disabled={!!busy} onClick={()=>download('published')}>{busy==='published'?'Preparing…':'Download PDF for the student'}</button><button disabled={!!busy} onClick={()=>download('working')}>{busy==='working'?'Preparing…':'Download faculty copy (PDF)'}</button><button onClick={()=>window.print()}>Print this page</button></div>
      <p className="muted"><strong>PDF for the student</strong> has only what the student can already see (released results and published grades) plus attendance and progress, so it is safe to hand over. The <strong>faculty copy</strong> and <strong>Print</strong> include working values and unreleased scores: the faculty copy is marked on every page, and a printed page carries a faculty-record notice.</p>
      {note&&<p role="status">{note}</p>}</section>
    {withdrawn&&<p className="warn" role="status"><strong>Withdrawn.</strong> {d.calculation_note}</p>}
    {offering.term_status==='closed'&&<p className="warn" role="status">This term is closed, so records here are final.</p>}
    {!withdrawn&&d.calculation_note&&<p className="warn" role="status">{d.calculation_note}</p>}

    <section className="panel"><h3>Grades</h3>
      <p className="muted"><strong>Current calculation</strong> is what the gradebook works out today and may use scores you have not released yet. <strong>Visible to student</strong> is the last grade you published.{d.calculation&&` Passing ${d.calculation.passing}.`}</p>
      <div className="cards">{periods.map(k=>{const calc=d.calculation?.grades[k];const pub=d.published[k];const flag=d.calculation?.published_flags[k];
        return <article className="panel" key={k}><p className="eyebrow">{PERIOD_LABEL[k]??k}</p>
          <p><span className="muted">Current calculation</span><br/><strong>{!d.calculation?'Not calculated':calc?.grade===null||calc?.grade===undefined?'Pending':fmt(calc.grade)}</strong></p>
          {calc&&calc.pending.length>0&&<ul className="muted">{calc.pending.map(p=><li key={p}>{p}</li>)}</ul>}
          <p><span className="muted">Visible to student</span><br/><strong>{pub?`${fmt(pub.grade)} · ${pub.remark}`:'Not published yet'}</strong>{pub&&<span className="muted"> (release {pub.release_number})</span>}</p>
          {flag?.needs_review&&<p className="warn" role="status">Needs review: {flag.review_reason??'working data changed'}</p>}</article>})}</div>
      {d.calculation&&periods.filter(k=>k!=='course').map(k=><details className="fold inner" key={k}><summary>{PERIOD_LABEL[k]??k}: how it is calculated</summary>
        <div className="table-wrap" role="region" tabIndex={0} aria-label={`${PERIOD_LABEL[k]??k} categories`}><table><thead><tr><th>Category</th><th>Weight</th><th>Result</th><th>Points</th><th>Still missing</th></tr></thead>
          <tbody>{d.calculation!.grades[k].categories.map(c=><tr key={c.key}><td>{c.label}</td><td>{c.weight}%</td><td>{c.status==='ok'?`${fmt(c.percent)}%`:'Pending'}</td><td>{c.status==='ok'?`${fmt(c.earned)} of ${fmt(c.possible)}`:'—'}</td><td>{c.missing.join('; ')||'—'}</td></tr>)}</tbody></table></div></details>)}
    </section>

    <details className="panel fold"><summary><h3>Quizzes, activities and exams</h3></summary>
      {d.assessments.length===0?<p className="muted">{withdrawn?'No current work is shown for a withdrawn student; see Historical work below.':'No published assessments apply to this student yet.'}</p>:
      <div className="table-wrap" role="region" tabIndex={0} aria-label="Assessments for this student"><table><thead><tr><th>Assessment</th><th>Due</th><th>Handed in</th><th>Working score</th><th>Visible to student</th></tr></thead>
        <tbody>{d.assessments.map(a=><tr key={a.id}>
          <td><Link state={here} to={`${base}/assessments/${a.id}/scores`}>{a.title}</Link><br/><span className="muted">{KIND_LABEL[a.kind]} · {a.period?PERIOD_LABEL[a.period]:'No period'} · {a.category??'No category'}</span>{!a.counts_toward_grade&&<> <span className="badge">Not counted toward grade</span></>}</td>
          <td>{a.deadline?new Date(a.deadline).toLocaleString():'—'}</td>
          <td>{SUBMISSION[a.submission]??a.submission}{a.kind==='online_quiz'&&a.attempts.length>0&&<><br/><button type="button" onClick={()=>setReviewing(a.id)}>View answers</button></>}</td>
          <td>{a.scored?`${fmt(a.working_score)} / ${fmt(a.max_points)}`:'Not scored yet'}</td>
          <td>{a.released?`${fmt(a.released_score)} / ${fmt(a.max_points)}`:'Not released'}{a.unreleased_change&&<> <span className="badge">Differs from working score</span></>}</td></tr>)}</tbody></table></div>}
      {d.historical.length>0&&<details className="fold inner"><summary>Historical work ({d.historical.length})</summary><p className="muted">Archived or no longer shown to this student, kept because it has a score or a release.</p>
        <ul>{d.historical.map(h=><li key={h.id}>{h.title} <span className="muted">· {KIND_LABEL[h.kind]}{h.archived?' · archived':''} · working score {h.working_score===null?'none':fmt(h.working_score)} · visible to student {h.released_score===null?'not released':fmt(h.released_score)}</span></li>)}</ul></details>}
    </details>

    <details className="panel fold"><summary><h3>Attendance</h3></summary>
      {d.attendance.days.length===0?<p className="muted">No attendance has been recorded for this student’s section yet.</p>:<>
        <div className="table-wrap" role="region" tabIndex={0} aria-label="Attendance totals"><table><thead><tr><th>Period</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Not marked</th></tr></thead>
          <tbody>{Object.entries(counts).map(([p,c])=><tr key={p}><td>{PERIOD_LABEL[p]??p}</td><td>{c.present}</td><td>{c.late}</td><td>{c.absent}</td><td>{c.excused}</td><td>{c.not_marked}</td></tr>)}</tbody></table></div>
        <details className="fold inner"><summary>Day by day ({d.attendance.days.length})</summary><ul className="seq">{[...d.attendance.days].reverse().map(x=><li key={x.date}><span className="grow">{day(x.date)}<span className="muted">{PERIOD_LABEL[x.period]}</span></span><span className="badge">{x.status?MARK[x.status]:'Not marked'}</span></li>)}</ul></details></>}
      <p className="muted">A day you have not marked is pending, not absent. Excused days are left out of the percentage.</p>
    </details>

    {d.progress&&<details className="panel fold"><summary><h3>Learning progress</h3></summary>
      <p><strong>{d.progress.percent===null?'—':`${d.progress.percent}%`}</strong> · {d.progress.done} of {d.progress.total} steps done · last recorded activity: {stamp(d.progress.last_activity_at)}</p>
      <p className="muted">Lessons count when the student marks them complete; quizzes and activities count when they submit. Opening a lesson or using study help is not progress, and chats are never shown here.</p>
      {d.progress.note&&<p className="muted">{d.progress.note}</p>}
      <details className="fold inner"><summary>Steps ({d.progress.steps.length})</summary><ul className="seq">{d.progress.steps.map(s=><li key={s.type+s.id}><span className="grow">{s.title}<span className="muted">{stepLabel(s)}</span></span><span className={s.done?'badge done':'badge'}>{s.done?'✓ Done':'Not done'}</span></li>)}</ul></details></details>}
    {reviewing&&(()=>{const a=d.assessments.find(x=>x.id===reviewing)!;return <Dialog title={`${a.title}: ${d.student.name}'s answers`} onClose={()=>setReviewing(null)}>
      <AttemptReview base={`/teach/offerings/${offering.id}/assessments/${a.id}`} attempts={a.attempts} studentName={d.student.name}/>
      <div className="actions"><Link className="button" state={here} to={`${base}/assessments/${a.id}/scores`}>Open Attempts &amp; scores to correct a score</Link><button type="button" className="primary" onClick={()=>setReviewing(null)}>Close</button></div></Dialog>})()}
  </div>;
}
