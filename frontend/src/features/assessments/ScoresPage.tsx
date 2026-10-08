import {useToast} from '../../components/undo';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,useOutletContext,useParams} from 'react-router-dom';
import {useQuery,type UseQueryResult} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {catOfKind} from '../../components/ClassworkTypes';
import {useConfirm} from '../../components/confirm';
import {useOrigin} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {VerdictBadge} from './AnswerReview';
import {KIND_LABEL,fmt,when,type Assessment,type AttemptDetail,type AttemptRow,type ScoreRow} from './types';

export function ScoresPage(){
  const ask=useConfirm();const toast=useToast();
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const {assessmentId}=useParams();
  const closed=offering.term_status==='closed';
  const base=`/teach/offerings/${offering.id}/assessments/${assessmentId}`;
  const a=useQuery({queryKey:['assessment',assessmentId],queryFn:()=>api<Assessment>(base)});
  const origin=useOrigin(`/faculty/offerings/${offering.id}/classwork${a.data?`?type=${catOfKind(a.data.kind)}`:''}`,'Classwork');
  const rows=useQuery({queryKey:['scores',assessmentId],queryFn:()=>api<ScoreRow[]>(`${base}/scores`)});
  const attempts=useQuery({queryKey:['attempts',assessmentId],queryFn:()=>api<AttemptRow[]>(`${base}/attempts`),enabled:a.data?.kind==='online_quiz'});
  const [message,setMessage]=useState('');
  const refresh=()=>Promise.all([queryClient.invalidateQueries({queryKey:['scores',assessmentId]}),queryClient.invalidateQueries({queryKey:['attempts',assessmentId]}),queryClient.invalidateQueries({queryKey:['gradebook',offering.id]})]).then(()=>undefined);
  // the table's rows as of right now (after a save has refreshed them), so a feedback-only save with a blank score still counts as ungraded
  const current=():ScoreRow[]=>{const d=queryClient.getQueryData<ScoreRow[]>(['scores',assessmentId])??[];const at=queryClient.getQueryData<AttemptRow[]>(['attempts',assessmentId]);return a.data?.kind==='online_quiz'?d.filter(r=>!at?.some(x=>x.student_id===r.student_id)):d};
  if(a.isPending)return <p>Loading…</p>;
  if(a.error||!a.data?.published)return <section className="panel"><h2>Not available</h2><p role="alert">{a.error?.message??'Publish this assessment first.'}</p><Link to={`/faculty/offerings/${offering.id}/classwork`}>Back to classwork</Link></section>;
  const rev=a.data.published;const kind=a.data.kind;
  const toReturn=rows.data?.filter(r=>r.to_return).length??0;

  async function release(){
    if(!await ask({title:`Return ${toReturn} graded result${toReturn===1?'':'s'}?`,message:'Students will see the scores and feedback straight away.',yes:`Return ${toReturn}`}))return;
    try{const r=await post<{released:number}>(`${base}/release`,{student_ids:null});{const text=r.released===0?'Nothing new to return.':`Returned ${r.released} result${r.released===1?'':'s'}.`;setMessage(text);toast(text)};refresh()}
    catch(e){setMessage(errorText(e))}
  }
  return <>
    <p className="back"><Link to={origin.to}>← Back to {origin.label}</Link></p>
    <div className="page-heading"><div><p className="eyebrow">{KIND_LABEL[kind]} · out of {fmt(rev.max_points)}</p><h2>{rev.title}</h2>
      <p className="muted">Students only see a result after you return it. Online quiz totals are returned automatically when a student submits.</p></div>
      <div className="actions"><Link className="button" to={`/faculty/offerings/${offering.id}/assessments/${assessmentId}/edit`}>{closed?'View settings':'Edit settings'}</Link>
      <button className={toReturn>0?'primary':''} disabled={closed||toReturn===0} onClick={release}>{toReturn>0?`Return ${toReturn} graded result${toReturn===1?'':'s'}`:'All graded results returned'}</button></div></div>
    {message&&<p role="status">{message}</p>}
    {kind==='online_quiz'&&<Attempts base={base} attempts={attempts} closed={closed} onChanged={refresh} setMessage={setMessage}/>}
    {rows.isPending||(kind==='online_quiz'&&attempts.isPending)?<p>Loading students…</p>:rows.error?<p role="alert">{rows.error.message}</p>:kind==='online_quiz'&&attempts.error?<p role="alert">{attempts.error.message}</p>:
      <ScoreTable key={assessmentId} rows={kind==='online_quiz'?rows.data.filter(r=>!attempts.data?.some(x=>x.student_id===r.student_id)):rows.data}
        kind={kind} base={base} max={rev.max_points} closed={closed} onSaved={refresh} setMessage={setMessage} current={current}
        heading={kind==='online_quiz'?'Students with no attempts':'Scores'}/>}
  </>;
}

function ScoreTable({rows,kind,base,max,closed,onSaved,setMessage,current,heading}:{rows:ScoreRow[];kind:Assessment['kind'];base:string;max:number;closed:boolean;onSaved:()=>Promise<void>;setMessage:(m:string)=>void;current:()=>ScoreRow[];heading:string}){
  const [permission,setPermission]=useState<ScoreRow|null>(null);
  const [ungradedOnly,setUngradedOnly]=useState(false);
  const [saved,setSaved]=useState<Set<string>>(new Set());   // rows remount after a save, so the mark lives here
  const focusNext=useRef<string|null>(null);
  useEffect(()=>{if(focusNext.current){document.getElementById(focusNext.current)?.focus();focusNext.current=null}});
  const ungraded=(r:ScoreRow)=>r.score===null||r.new_version_since_grading;
  const shown=ungradedOnly?rows.filter(ungraded):rows;
  const mark=(id:string,on:boolean)=>setSaved(prev=>{const n=new Set(prev);if(on)n.add(id);else n.delete(id);return n});
  if(rows.length===0)return <section className="panel"><h3>{heading}</h3><p className="muted">No students to show.</p></section>;
  return <section className="panel"><h3>{heading}</h3>
    {kind==='online_quiz'&&<p className="muted">A student who never attempted this quiz has no score yet. Record one (zero is a real score) so their grade can be calculated.</p>}
    <label className="inline"><input id="ungraded-only" type="checkbox" checked={ungradedOnly} onChange={e=>setUngradedOnly(e.target.checked)}/> Show ungraded only</label>
    <p className="muted">{rows.filter(ungraded).length} of {rows.length} still ungraded. Press Enter in a score box to save and move to the next student.</p>
    {shown.length===0&&<p className="muted">Everyone listed has a score.</p>}
    <div className="table-wrap" role="region" aria-label={heading} tabIndex={0}><table className="stack" role="table">
      <thead role="rowgroup"><tr role="row"><th role="columnheader">Student</th>{kind==='activity'&&<th role="columnheader">Submission</th>}<th role="columnheader">Score (of {fmt(max)})</th><th role="columnheader">Feedback</th><th role="columnheader"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody role="rowgroup">{shown.map((r,i)=><ScoreRowEditor key={r.student_id+r.score_revision} row={r} kind={kind} base={base} max={max} closed={closed} onSaved={onSaved} setMessage={setMessage} onPermission={()=>setPermission(r)}
        saved={saved.has(r.student_id)&&!r.new_version_since_grading} onEdit={()=>mark(r.student_id,false)} onDone={advance=>{mark(r.student_id,true);const now=current();setMessage(`Saved ${r.student}. ${now.filter(ungraded).length} of ${now.length} still need grading.`);focusNext.current=advance?(shown[i+1]?`s-${shown[i+1].student_id}`:'ungraded-only'):null}}/>)}</tbody></table></div>
    {permission&&<PermissionDialog base={base} row={permission} onClose={()=>setPermission(null)} onDone={()=>{setPermission(null);setMessage('Permission granted. The student can submit once more.');onSaved()}}/>}
  </section>;
}

function ScoreRowEditor({row,kind,base,max,closed,onSaved,setMessage,onPermission,saved,onEdit,onDone}:{row:ScoreRow;kind:Assessment['kind'];base:string;max:number;closed:boolean;onSaved:()=>Promise<void>;setMessage:(m:string)=>void;onPermission:()=>void;saved:boolean;onEdit:()=>void;onDone:(advance:boolean)=>void}){
  const [score,setScore]=useState(row.score===null?'':String(row.score));
  const [feedback,setFeedback]=useState(row.feedback);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const busy=useRef(false);   // synchronous: a second Enter must not send a second request
  async function save(advance=false){
    if(busy.current)return;busy.current=true;setSaving(true);setError('');
    try{await send('PUT',`${base}/scores/${row.student_id}`,{score:score.trim()===''?null:score.trim(),feedback,expected_revision:row.score_revision});setMessage(`Saved ${row.student}.`);await onSaved();onDone(advance)}
    catch(e){setError(errorText(e))}
    finally{busy.current=false;setSaving(false)}
  }
  const sub=row.latest;
  return <tr role="row">
    <td role="cell" data-label="Student">{row.student}<br/><span className="muted">{row.student_number}</span></td>
    {kind==='activity'&&<td role="cell" data-label="Submission">{sub?<>
      <a className="touch" href={`/api/files/${sub.file.id}/download`}>{sub.file.name}</a><br/>
      <span className="muted">Version {sub.version} of {row.versions} · {when(sub.submitted_at)}</span>{sub.is_late&&<> <span className="badge">Late</span></>}
      {sub.note&&<p className="pre">{sub.note}</p>}
      {row.new_version_since_grading&&<p className="warn" role="status">New version since you graded. Review it and save the score again.</p>}</>:<span className="muted">Nothing submitted</span>}
      {row.permission_open&&<p className="muted">A resubmission permission is open.</p>}</td>}
    <td role="cell" data-label={`Score (of ${fmt(max)})`}><label className="sr-only" htmlFor={`s-${row.student_id}`}>Score for {row.student}</label>
      <input id={`s-${row.student_id}`} inputMode="decimal" value={score} placeholder="Not scored" disabled={closed} readOnly={saving} aria-invalid={!!error} onChange={e=>{setScore(e.target.value);onEdit()}} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void save(true)}}} aria-describedby={error?`max-${row.student_id} err-${row.student_id}`:`max-${row.student_id}`}/>
      <span id={`max-${row.student_id}`} className="muted">{score===''?'Pending':Number(score)===0?'Recorded zero':`of ${fmt(max)}`}</span></td>
    <td role="cell" data-label="Feedback"><label className="sr-only" htmlFor={`f-${row.student_id}`}>Feedback for {row.student}</label><textarea id={`f-${row.student_id}`} value={feedback} maxLength={5000} disabled={closed} readOnly={saving} onChange={e=>{setFeedback(e.target.value);onEdit()}}/></td>
    <td role="cell"><div className="actions"><button className="primary" disabled={closed||saving} onClick={()=>void save()}>{saving?'Saving…':'Save'}</button>{saved&&<span className="badge done">Saved</span>}
      {kind==='activity'&&!closed&&<button onClick={onPermission}>Allow resubmission</button>}</div>{error&&<p id={`err-${row.student_id}`} role="alert" className="error">{error}</p>}</td>
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
  const ask=useConfirm();
  const [review,setReview]=useState<string|null>(null);
  const open=attempts.data?.filter(x=>x.state==='in_progress').length??0;
  async function closeOpen(){
    if(!await ask({title:'Close all open attempts?',message:'Whatever each student saved is scored as their submission.',yes:'Close attempts',danger:true}))return;
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
