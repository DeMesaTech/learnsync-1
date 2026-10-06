import {useState,type FormEvent} from 'react';
import {Link,useOutletContext,useParams} from 'react-router-dom';
import {useQuery,type UseQueryResult} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {useOrigin} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {VerdictBadge} from './AnswerReview';
import {KIND_LABEL,fmt,when,type Assessment,type AttemptDetail,type AttemptRow,type ScoreRow} from './types';

export function ScoresPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const {assessmentId}=useParams();
  const closed=offering.term_status==='closed';
  const origin=useOrigin(`/faculty/offerings/${offering.id}/assessments`,'Assessments');
  const base=`/teach/offerings/${offering.id}/assessments/${assessmentId}`;
  const a=useQuery({queryKey:['assessment',assessmentId],queryFn:()=>api<Assessment>(base)});
  const rows=useQuery({queryKey:['scores',assessmentId],queryFn:()=>api<ScoreRow[]>(`${base}/scores`)});
  const attempts=useQuery({queryKey:['attempts',assessmentId],queryFn:()=>api<AttemptRow[]>(`${base}/attempts`),enabled:a.data?.kind==='online_quiz'});
  const [message,setMessage]=useState('');
  const refresh=()=>{queryClient.invalidateQueries({queryKey:['scores',assessmentId]});queryClient.invalidateQueries({queryKey:['attempts',assessmentId]});queryClient.invalidateQueries({queryKey:['gradebook',offering.id]})};
  if(a.isPending)return <p>Loading…</p>;
  if(a.error||!a.data?.published)return <section className="panel"><h2>Not available</h2><p role="alert">{a.error?.message??'Publish this assessment first.'}</p><Link to={`/faculty/offerings/${offering.id}/assessments`}>Back to assessments</Link></section>;
  const rev=a.data.published;const kind=a.data.kind;

  async function release(){
    if(!confirm('Release the current scores and feedback to students? They will see them straight away.'))return;
    try{const r=await post<{released:number}>(`${base}/release`,{student_ids:null});setMessage(r.released===0?'Nothing new to release.':`Released ${r.released} result${r.released===1?'':'s'}.`);refresh()}
    catch(e){setMessage(errorText(e))}
  }
  return <>
    <p className="back"><Link to={origin.to}>← Back to {origin.label}</Link></p>
    <div className="page-heading"><div><p className="eyebrow">{KIND_LABEL[kind]} · out of {fmt(rev.max_points)}</p><h2>{rev.title}</h2>
      <p className="muted">Students only see a result after you release it. Online quiz totals are released automatically when a student submits.</p></div>
      <button className="primary" disabled={closed} onClick={release}>Release results</button></div>
    {message&&<p role="status">{message}</p>}
    {kind==='online_quiz'&&<Attempts base={base} attempts={attempts} closed={closed} onChanged={refresh} setMessage={setMessage}/>}
    {rows.isPending?<p>Loading students…</p>:rows.error?<p role="alert">{rows.error.message}</p>:
      <ScoreTable rows={kind==='online_quiz'?rows.data.filter(r=>!attempts.data?.some(x=>x.student_id===r.student_id)):rows.data}
        kind={kind} base={base} max={rev.max_points} closed={closed} onSaved={refresh} setMessage={setMessage}
        heading={kind==='online_quiz'?'Students without a submitted attempt':'Scores'}/>}
  </>;
}

function ScoreTable({rows,kind,base,max,closed,onSaved,setMessage,heading}:{rows:ScoreRow[];kind:Assessment['kind'];base:string;max:number;closed:boolean;onSaved:()=>void;setMessage:(m:string)=>void;heading:string}){
  const [permission,setPermission]=useState<ScoreRow|null>(null);
  if(rows.length===0)return <section className="panel"><h3>{heading}</h3><p className="muted">No students to show.</p></section>;
  return <section className="panel"><h3>{heading}</h3>
    {kind==='online_quiz'&&<p className="muted">A student who never attempted this quiz has no score yet. Record one (zero is a real score) so their grade can be calculated.</p>}
    <div className="table-wrap" role="region" aria-label={heading} tabIndex={0}><table>
      <thead><tr><th>Student</th>{kind==='activity'&&<th>Submission</th>}<th>Score (of {fmt(max)})</th><th>Feedback</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{rows.map(r=><ScoreRowEditor key={r.student_id+r.score_revision} row={r} kind={kind} base={base} max={max} closed={closed} onSaved={onSaved} setMessage={setMessage} onPermission={()=>setPermission(r)}/>)}</tbody></table></div>
    {permission&&<PermissionDialog base={base} row={permission} onClose={()=>setPermission(null)} onDone={()=>{setPermission(null);setMessage('Permission granted. The student can submit once more.');onSaved()}}/>}
  </section>;
}

function ScoreRowEditor({row,kind,base,max,closed,onSaved,setMessage,onPermission}:{row:ScoreRow;kind:Assessment['kind'];base:string;max:number;closed:boolean;onSaved:()=>void;setMessage:(m:string)=>void;onPermission:()=>void}){
  const [score,setScore]=useState(row.score===null?'':String(row.score));
  const [feedback,setFeedback]=useState(row.feedback);
  const [error,setError]=useState('');
  async function save(){
    setError('');
    try{await send('PUT',`${base}/scores/${row.student_id}`,{score:score.trim()===''?null:score.trim(),feedback,expected_revision:row.score_revision});setMessage(`Saved ${row.student}.`);onSaved()}
    catch(e){setError(errorText(e))}
  }
  const sub=row.latest;
  return <tr>
    <td>{row.student}<br/><span className="muted">{row.student_number}</span></td>
    {kind==='activity'&&<td>{sub?<>
      <a className="touch" href={`/api/files/${sub.file.id}/download`}>{sub.file.name}</a><br/>
      <span className="muted">Version {sub.version} of {row.versions} · {when(sub.submitted_at)}</span>{sub.is_late&&<> <span className="badge">Late</span></>}
      {sub.note&&<p className="pre">{sub.note}</p>}
      {row.new_version_since_grading&&<p className="warn" role="status">New version since you graded. Review it and save the score again.</p>}</>:<span className="muted">Nothing submitted</span>}
      {row.permission_open&&<p className="muted">A resubmission permission is open.</p>}</td>}
    <td><label className="sr-only" htmlFor={`s-${row.student_id}`}>Score for {row.student}</label>
      <input id={`s-${row.student_id}`} inputMode="decimal" value={score} placeholder="Not scored" disabled={closed} onChange={e=>setScore(e.target.value)} aria-describedby={`max-${row.student_id}`}/>
      <span id={`max-${row.student_id}`} className="muted">{score===''?'Pending':Number(score)===0?'Recorded zero':`of ${fmt(max)}`}</span></td>
    <td><label className="sr-only" htmlFor={`f-${row.student_id}`}>Feedback for {row.student}</label><textarea id={`f-${row.student_id}`} value={feedback} maxLength={5000} disabled={closed} onChange={e=>setFeedback(e.target.value)}/></td>
    <td><div className="actions"><button className="primary" disabled={closed} onClick={save}>Save</button>
      {kind==='activity'&&!closed&&<button onClick={onPermission}>Allow resubmission</button>}</div>{error&&<p role="alert" className="error">{error}</p>}</td>
  </tr>;
}

function PermissionDialog({base,row,onClose,onDone}:{base:string;row:ScoreRow;onClose:()=>void;onDone:()=>void}){
  const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await post(`${base}/permissions`,{student_id:row.student_id,reason:f.get('reason'),expires_at:new Date(String(f.get('expires'))).toISOString()});onDone()}
    catch(err){setError(errorText(err))}
  }
  const week=new Date(Date.now()+7*864e5);const p=(n:number)=>String(n).padStart(2,'0');
  const dflt=`${week.getFullYear()}-${p(week.getMonth()+1)}-${p(week.getDate())}T${p(week.getHours())}:${p(week.getMinutes())}`;
  return <Dialog title={`Allow ${row.student} to submit again`} onClose={onClose}><form onSubmit={submit}>
    <p>One extra submission is allowed, even after the deadline. The reason is kept in the audit history.</p>
    <label>Reason<textarea name="reason" required minLength={3} maxLength={1000}/></label>
    <label>Permission expires<input name="expires" type="datetime-local" required defaultValue={dflt}/></label>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Grant permission</button></div></form></Dialog>;
}

function Attempts({base,attempts,closed,onChanged,setMessage}:{base:string;attempts:UseQueryResult<AttemptRow[]>;closed:boolean;onChanged:()=>void;setMessage:(m:string)=>void}){
  const [review,setReview]=useState<string|null>(null);
  const open=attempts.data?.filter(x=>x.state==='in_progress').length??0;
  async function closeOpen(){
    if(!confirm('Close all open attempts? Whatever each student saved is scored as their submission.'))return;
    try{const r=await post<{closed:number}>(`${base}/attempts/close-open`,{});setMessage(`Closed ${r.closed} open attempt${r.closed===1?'':'s'}.`);onChanged()}
    catch(e){setMessage(errorText(e))}
  }
  return <section className="panel"><div className="page-heading"><h3>Attempts</h3>
    {open>0&&<button disabled={closed} onClick={closeOpen}>Close {open} open attempt{open===1?'':'s'}</button>}</div>
    {attempts.isPending?<p>Loading…</p>:attempts.error?<p role="alert">{attempts.error.message}</p>:attempts.data.length===0?<p className="muted">No student has started this quiz yet.</p>:
      <div className="table-wrap" role="region" aria-label="Attempts" tabIndex={0}><table><thead><tr><th>Student</th><th>Attempt</th><th>Status</th><th>Score</th><th>Submitted</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{attempts.data.map(x=><tr key={x.id}><td>{x.student}</td><td>{x.attempt_number}</td><td><span className="badge">{x.state==='submitted'?'Submitted':'In progress'}</span></td>
          <td>{x.state==='submitted'?`${fmt(x.score)} / ${fmt(x.max_score)}`:'—'}</td><td>{when(x.submitted_at)}</td>
          <td>{x.state==='submitted'&&<button onClick={()=>setReview(x.id)}>Review answers</button>}</td></tr>)}</tbody></table></div>}
    {review&&<ReviewDialog base={base} attemptId={review} closed={closed} onClose={()=>setReview(null)} onChanged={()=>{onChanged();queryClient.invalidateQueries({queryKey:['attempt-detail',review]})}}/>}
  </section>;
}

function ReviewDialog({base,attemptId,closed,onClose,onChanged}:{base:string;attemptId:string;closed:boolean;onClose:()=>void;onChanged:()=>void}){
  const detail=useQuery({queryKey:['attempt-detail',attemptId],queryFn:()=>api<AttemptDetail>(`${base}/attempts/${attemptId}`)});
  const [message,setMessage]=useState('');
  async function correct(key:string,awarded:string,reason:string){
    try{await send('PUT',`${base}/attempts/${attemptId}/answers/${key}`,{awarded,reason});setMessage('Correction saved. The student keeps seeing the released score until you release again.');onChanged()}
    catch(e){setMessage(errorText(e))}
  }
  return <Dialog title="Review answers" onClose={onClose}>
    {detail.isPending?<p>Loading…</p>:detail.error?<p role="alert">{detail.error.message}</p>:<>
      <p>Attempt {detail.data.attempt_number}: {fmt(detail.data.score)} / {fmt(detail.data.max_score)}</p>
      {message&&<p role="status">{message}</p>}
      {detail.data.questions.map((q,i)=><Correction key={q.key} n={i+1} q={q} closed={closed} onSave={correct}/>)}</>}
    <div className="actions"><button className="primary" onClick={onClose}>Done</button></div></Dialog>;
}

function Correction({n,q,closed,onSave}:{n:number;q:AttemptDetail['questions'][number];closed:boolean;onSave:(key:string,awarded:string,reason:string)=>void}){
  const [awarded,setAwarded]=useState(String(q.awarded??0));const [reason,setReason]=useState(q.correction_reason??'');
  const answerText=(v:unknown)=>v===null||v===undefined?'(no answer)':Array.isArray(v)?v.join(' / '):typeof v==='boolean'?(v?'True':'False'):String(q.choices.find(c=>c.id===v)?.text??v);
  return <article className="subpanel"><p><strong>{n}. {q.prompt}</strong> <span className="muted">({q.points} pt{q.points===1?'':'s'})</span></p>
    <p><VerdictBadge q={q}/> Student answered: <strong>{answerText(q.response)}</strong></p>
    <p className="muted">Accepted: {answerText(q.correct)} · automatic score {fmt(q.auto_awarded)}</p>
    <div className="grid-2"><label>Points awarded<input inputMode="decimal" value={awarded} disabled={closed} onChange={e=>setAwarded(e.target.value)}/></label>
      <label>Reason for correction<input value={reason} disabled={closed} onChange={e=>setReason(e.target.value)} placeholder="Required to change the score"/></label></div>
    <button disabled={closed||Number(awarded)===Number(q.awarded??0)||reason.trim().length<3} onClick={()=>onSave(q.key,awarded,reason.trim())}>Save correction</button></article>;
}
