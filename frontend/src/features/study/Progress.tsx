import {Link,useOutletContext} from 'react-router-dom';
import {useHere} from '../../components/origin';
import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {api} from '../../app/api';
import type {OfferingSummary} from '../academics/types';
import {stepLabel,type ClassProgress,type Progress} from './types';

const day=(iso:string)=>new Date(iso+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
const ago=(iso:string|null)=>iso?new Date(iso).toLocaleDateString():'No activity yet';

function Bars({data,label}:{data:{key:string;label:string;count:number}[];label:string}){
  const max=Math.max(1,...data.map(d=>d.count));
  return <div><div className="bars" role="img" aria-label={`${label}: ${data.map(d=>`${d.label} ${d.count}`).join(', ')}`}>
    {data.map(d=><div key={d.key} className="bar" title={`${d.label}: ${d.count}`}><span style={{height:`${Math.round(100*d.count/max)}%`}} data-empty={d.count===0}/></div>)}</div>
    <p className="muted bars-axis"><span>{data[0]?.label}</span><span>{data[data.length-1]?.label}</span></p></div>;
}

export function StudentProgress(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const query=useQuery({queryKey:['progress',offering.id],queryFn:()=>api<Progress>(`/learn/offerings/${offering.id}/progress`)});
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  const p=query.data;
  return <>
    <div className="page-heading"><div><h2>My progress</h2><p className="muted">Counts only things you did on purpose: lessons you marked complete, quizzes you submitted and activities you uploaded. Opening a lesson, downloading a file or chatting does not count. This is separate from your grades.</p></div></div>
    <section className="panel">
      {p.percent===null?<><h3>Nothing to complete yet</h3><p className="muted">Your teacher has not published any lessons, quizzes or activities for you.</p></>:
        <><p className="big">{p.percent}%</p><p>{p.done} of {p.total} steps done</p><progress max={p.total} value={p.done} aria-label="Steps completed" style={{width:'100%'}}/></>}
      {p.note&&<p className="warn" role="status">{p.note} The percentage only covers what applies to you now.</p>}
    </section>
    <div className="grid-2">
      <section className="panel"><h3>Last 14 days</h3><p className="muted">Bars count lessons you marked complete, quizzes you submitted, and activities you uploaded.</p><Bars label="Activity per day" data={p.days.map(d=>({key:d.date,label:day(d.date),count:d.count}))}/></section>
      <section className="panel"><h3>Last 8 weeks</h3><p className="muted">Bars count lessons you marked complete, quizzes you submitted, and activities you uploaded.</p><Bars label="Activity per week" data={p.weeks.map(w=>({key:w.week_start,label:`Wk ${day(w.week_start)}`,count:w.count}))}/><p className="muted">Weeks start on Monday (Philippine time).</p></section></div>
    {p.steps.length>0&&<section className="panel"><h3>Steps</h3><ul className="plain">{p.steps.map(s=><li key={s.type+s.id} className="member-row"><span>{s.done?'✓':'○'} {s.title} <span className="badge">{stepLabel(s)}</span></span><span className={s.done?'badge covered':'muted'}>{s.done?'Done':'To do'}</span></li>)}</ul></section>}
  </>;
}

export function FacultyProgress(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const here=useHere();
  const [selection,setSelection]=useState({offeringId:offering.id,sectionId:''});
  const sectionId=selection.offeringId===offering.id?selection.sectionId:'';
  const query=useQuery({queryKey:['class-progress',offering.id],queryFn:()=>api<ClassProgress>(`/teach/offerings/${offering.id}/progress`)});
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  const c=query.data;
  const selectedSection=offering.sections.find(section=>section.id===sectionId);
  const belongsToSection=(student:ClassProgress['students'][number],section:{id:string;name:string})=>
    student.section_id===section.id||student.section===section.name;
  const students=c.students.filter(s=>!selectedSection||belongsToSection(s,selectedSection));
  const percentages=students.map(s=>s.percent).filter((n):n is number=>n!==null);
  const average=percentages.length?Math.round(percentages.reduce((sum,n)=>sum+n,0)/percentages.length):null;
  const inactive=students.filter(s=>s.inactive).length;
  return <>
    <div className="page-heading"><div><h2>Learning progress</h2><p className="muted">Completion of the published lessons, quizzes and activities that apply to each student. It shows what has been completed and submitted, so you can see who has no recorded activity yet. It is not a grade, and student chats are never shown here.</p></div></div>
    {offering.sections.length>0&&<label>Section<select aria-label="Filter progress by section" value={sectionId} onChange={e=>setSelection({offeringId:offering.id,sectionId:e.target.value})}>
      <option value="">All sections ({c.students.length})</option>{offering.sections.map(s=><option key={s.id} value={s.id}>
      {s.name} ({c.students.filter(student=>belongsToSection(student,s)).length})
      </option>)}
    </select></label>}
    <section className="panel"><p>Average completion: <strong>{average===null?'—':`${average}%`}</strong> (the mean of each student’s completed steps out of the steps that apply to them) · {inactive} enrolled student{inactive===1?'':'s'} with no recorded learning activity in the last 7 days.</p>
      <p className="muted">“No recorded activity” counts lesson completions and submissions only. It is not attendance, effort or risk, and it is not a grade.</p>
      {students.length===0?<p className="muted">{sectionId?'No enrolled students in this section.':'No enrolled students yet.'} <Link to={`/faculty/offerings/${offering.id}`}>See the roster</Link>.</p>:
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Student progress"><table><thead><tr><th>Student</th><th>Done</th><th>Progress</th><th>Last activity</th><th>Past 7 days</th></tr></thead><tbody>
          {students.map(s=><tr key={s.student_id}><td><Link state={here} to={`/faculty/offerings/${offering.id}/students/${s.student_id}`}>{s.student}</Link><br/><span className="muted">{s.student_number}</span></td><td>{s.done}/{s.total}</td><td>{s.percent===null?'—':`${s.percent}%`}</td><td>{ago(s.last_activity_at)}{s.inactive&&<> <span className="badge">No recorded activity</span></>}</td><td>{s.recent_events}</td></tr>)}</tbody></table></div>}
    </section></>;
}
