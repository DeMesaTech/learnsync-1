import {useToast} from '../../components/undo';
import {useEffect,useState,type FormEvent} from 'react';
import {Link,useNavigate,useOutletContext,useParams} from 'react-router-dom';
import {useQuery,type UseQueryResult} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {catOfKind} from '../../components/ClassworkTypes';
import {useConfirm} from '../../components/confirm';
import {useHere,useOrigin} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {VerdictBadge} from './AnswerReview';
import {KIND_LABEL,fmt,when,type Assessment,type AttemptDetail,type AttemptRow,type ScoreRow} from './types';

export function ScoresPage(){
  const ask=useConfirm();const toast=useToast();
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const {assessmentId}=useParams();
  const navigate=useNavigate();
  const here=useHere();
  const closed=offering.term_status!=='active';
  const base=`/teach/offerings/${offering.id}/assessments/${assessmentId}`;
  const a=useQuery({queryKey:['assessment',assessmentId],queryFn:()=>api<Assessment>(base)});
  const origin=useOrigin(`/faculty/offerings/${offering.id}/classwork${a.data?`?type=${catOfKind(a.data.kind)}`:''}`,'Classwork');
  const rows=useQuery({queryKey:['scores',assessmentId],queryFn:()=>api<ScoreRow[]>(`${base}/scores`)});
  const attempts=useQuery({queryKey:['attempts',assessmentId],queryFn:()=>api<AttemptRow[]>(`${base}/attempts`),enabled:a.data?.kind==='online_quiz'});
  const [sectionId,setSectionId]=useState('');
  const [message,setMessage]=useState('');
  const [scoreEditing,setScoreEditing]=useState(false);
  useEffect(()=>{setScoreEditing(false)},[assessmentId]);
  const refresh=()=>Promise.all([queryClient.invalidateQueries({queryKey:['scores',assessmentId]}),queryClient.invalidateQueries({queryKey:['attempts',assessmentId]}),queryClient.invalidateQueries({queryKey:['gradebook',offering.id]})]).then(()=>undefined);
  if(a.isPending)return <p>Loading…</p>;
  if(a.error||!a.data?.published)return <section className="panel"><h2>Not available</h2><p role="alert">{a.error?.message??'Publish this assessment first.'}</p><Link to={`/faculty/offerings/${offering.id}/classwork`}>Back to classwork</Link></section>;
  const rev=a.data.published;const kind=a.data.kind;
  const toReturn=rows.data?.filter(r=>r.to_return).length??0;
  const visibleRows=rows.data?.filter(r=>!sectionId||r.section_id===sectionId)??[];
  const visibleAttempts=attempts.data?.filter(r=>!sectionId||r.section_id===sectionId)??[];

  async function release(){
    if(!await ask({title:`Return ${toReturn} graded result${toReturn===1?'':'s'}?`,message:'Students will see the scores and feedback straight away.',yes:`Return ${toReturn}`}))return;
    try{const r=await post<{released:number}>(`${base}/release`,{student_ids:null});{const text=r.released===0?'Nothing new to return.':`Returned ${r.released} result${r.released===1?'':'s'}.`;setMessage(text);toast(text)};refresh()}
    catch(e){setMessage(errorText(e))}
  }
  async function editSettings(){
    navigate(`/faculty/offerings/${offering.id}/assessments/${assessmentId}/edit`,{state:here});
  }
  return <>
    <p className="back"><Link to={origin.to}>← Back to {origin.label}</Link></p>
    <div className="page-heading"><div><p className="eyebrow">{KIND_LABEL[kind]} · out of {fmt(rev.max_points)}</p><h2>{rev.title}</h2>
      </div>
      <div className="scores-toolbar">
        {offering.sections.length>0&&<label>Section<select aria-label="Filter scores by section" value={sectionId} disabled={scoreEditing} onChange={e=>setSectionId(e.target.value)}>
          <option value="">All sections ({offering.enrolled})</option>{offering.sections.map(s=><option key={s.id} value={s.id}>{s.name} ({s.enrolled})</option>)}
        </select></label>}
        <div className="actions">{closed?<Link className="button" to={`/faculty/offerings/${offering.id}/assessments/${assessmentId}/edit`}>View settings</Link>
          :kind==='online_quiz'?<button type="button" onClick={editSettings}>Edit settings</button>
            :<Link className="button" state={here} to={`/faculty/offerings/${offering.id}/assessments/${assessmentId}/edit`}>Edit settings</Link>}
        <button className={toReturn>0?'primary':''} disabled={closed||toReturn===0} onClick={release}>{toReturn>0?`Return ${toReturn} graded result${toReturn===1?'':'s'}`:'All graded results returned'}</button></div>
      </div></div>
    {message&&<p role="status">{message}</p>}
    {kind==='online_quiz'&&<Attempts base={base} attempts={attempts} sections={offering.sections} sectionId={sectionId} closed={closed} onChanged={refresh} setMessage={setMessage}/>}
    {rows.isPending||(kind==='online_quiz'&&attempts.isPending)?<p>Loading students…</p>:rows.error?<p role="alert">{rows.error.message}</p>:kind==='online_quiz'&&attempts.error?<p role="alert">{attempts.error.message}</p>:
      kind==='online_quiz'?<NoAttemptStudents rows={visibleRows.filter(r=>!visibleAttempts.some(x=>x.student_id===r.student_id))} sections={offering.sections}/>
        :<ScoreTable key={assessmentId} rows={visibleRows} sections={offering.sections} kind={kind} base={base} max={rev.max_points} closed={closed} onSaved={refresh} setMessage={setMessage} editing={scoreEditing} setEditing={setScoreEditing} heading="Scores"/>}
  </>;
}

function NoAttemptStudents({rows,sections}:{rows:ScoreRow[];sections:OfferingSummary['sections']}){
  return <section className="panel"><h3>Students with no attempts</h3>
    <p className="muted">Online quizzes are auto-scored from submitted attempts. A student with no attempt cannot be assigned a manual score.</p>
    {rows.length===0?<p className="muted">All students in this section have attempted the quiz.</p>:
      <div className="table-wrap" role="region" aria-label="Students with no quiz attempt" tabIndex={0}><table><thead><tr><th>Student</th><th>Section</th><th>Status</th></tr></thead>
        <tbody>{rows.map(row=><tr key={row.student_id}><th scope="row">{row.student}</th>
          <td>{sections.find(section=>section.id===row.section_id)?.name??'—'}</td>
          <td><span className="muted" title="No submission exists, so there is no automatically calculated quiz score.">Not attempted</span></td></tr>)}</tbody></table></div>}
  </section>;
}

type ScoreDraft={score:string;feedback:string};

function draftFrom(row:ScoreRow):ScoreDraft{return {score:row.score===null?'':String(row.score),feedback:row.feedback}}

function ScoreTable({rows,sections,kind,base,max,closed,onSaved,setMessage,editing,setEditing,heading}:{rows:ScoreRow[];sections:OfferingSummary['sections'];kind:Assessment['kind'];base:string;max:number;closed:boolean;onSaved:()=>Promise<void>;setMessage:(m:string)=>void;editing:boolean;setEditing:(editing:boolean)=>void;heading:string}){
  const [permission,setPermission]=useState<ScoreRow|null>(null);
  const [ungradedOnly,setUngradedOnly]=useState(false);
  const [saved,setSaved]=useState<Set<string>>(new Set());
  const [drafts,setDrafts]=useState<Record<string,ScoreDraft>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [saving,setSaving]=useState(false);
  const ungraded=(r:ScoreRow)=>r.score===null||r.new_version_since_grading;
  const shown=ungradedOnly?rows.filter(ungraded):rows;
  const mark=(id:string,on:boolean)=>setSaved(prev=>{const n=new Set(prev);if(on)n.add(id);else n.delete(id);return n});
  const draftFor=(row:ScoreRow)=>drafts[row.student_id]??draftFrom(row);

  async function saveAll(){
    if(saving||closed)return;
    const changed=rows.filter(row=>{
      const draft=drafts[row.student_id];
      if(!draft)return false;
      const original=draftFrom(row);
      return draft.score!==original.score||draft.feedback!==original.feedback;
    });
    if(changed.length===0){setEditing(false);setDrafts({});setErrors({});setMessage('No score changes to save.');return}

    setSaving(true);
    const savedIds:string[]=[];
    const failed:Record<string,string>={};
    for(const row of changed){
      const draft=drafts[row.student_id]??draftFrom(row);
      try{
        await send('PUT',`${base}/scores/${row.student_id}`,{score:draft.score.trim()===''?null:draft.score.trim(),feedback:draft.feedback,expected_revision:row.score_revision});
        savedIds.push(row.student_id);
      }catch(error){failed[row.student_id]=errorText(error)}
    }

    let refreshError='';
    if(savedIds.length>0){
      try{await onSaved()}catch(error){refreshError=errorText(error)}
    }
    setDrafts(previous=>{const next={...previous};savedIds.forEach(id=>delete next[id]);return next});
    setErrors(failed);
    savedIds.forEach(id=>mark(id,true));
    if(Object.keys(failed).length===0){
      setEditing(false);
      setMessage(refreshError?`Saved ${savedIds.length} score${savedIds.length===1?'':'s'}, but could not refresh the table: ${refreshError}`:`Saved ${savedIds.length} score${savedIds.length===1?'':'s'}.`);
    }else{
      setMessage(`Saved ${savedIds.length} score${savedIds.length===1?'':'s'}; ${Object.keys(failed).length} could not be saved. Review the errors and save again.${refreshError?` Refresh error: ${refreshError}`:''}`);
    }
    setSaving(false);
  }

  function activateEditSave(){
    if(editing){void saveAll();return}
    setErrors({});
    setMessage('');
    setEditing(true);
  }

  const editSaveButton=(className='')=><button type="button" className={`${editing?'primary':''} ${className}`.trim()} disabled={closed||saving} onClick={activateEditSave}>{saving?'Saving…':editing?'Save':'Edit'}</button>;
  function updateDraft(row:ScoreRow,draft:ScoreDraft){
    setDrafts(previous=>({...previous,[row.student_id]:draft}));
    setErrors(previous=>{const next={...previous};delete next[row.student_id];return next});
    mark(row.student_id,false);
  }

  if(rows.length===0)return <section className="panel"><h3>{heading}</h3><p className="muted">No students to show.</p></section>;
  return <section className="panel"><h3>{heading}</h3>
    <div className="scores-table-tools">
      <label className="inline"><input id="ungraded-only" type="checkbox" checked={ungradedOnly} onChange={e=>setUngradedOnly(e.target.checked)}/> Show ungraded only</label>
      <p className="muted">{rows.filter(ungraded).length} of {rows.length} still ungraded. Select Edit to change scores, then Save to apply the updates.</p>
    </div>
    <div className="score-mobile-edit">{editSaveButton()}</div>
    {shown.length===0&&<p className="muted">Everyone listed has a score.</p>}
    <div className="table-wrap" role="region" aria-label={heading} tabIndex={0}><table className="stack" role="table">
      <thead role="rowgroup"><tr role="row"><th role="columnheader">Student</th><th role="columnheader">Section</th>{kind==='activity'&&<th role="columnheader">Submission</th>}<th role="columnheader">Score (of {fmt(max)})</th><th role="columnheader">Feedback</th><th role="columnheader" className="score-edit-heading">{editSaveButton()}</th></tr></thead>
      <tbody role="rowgroup">{shown.map(row=><ScoreRowEditor key={row.student_id+row.score_revision} row={row} section={sections.find(section=>section.id===row.section_id)?.name??'—'} kind={kind} max={max} closed={closed} editing={editing} saving={saving} draft={draftFor(row)} error={errors[row.student_id]} saved={saved.has(row.student_id)&&!row.new_version_since_grading} onDraftChange={draft=>updateDraft(row,draft)} onPermission={()=>setPermission(row)}/>)}</tbody></table></div>
    {permission&&<PermissionDialog base={base} row={permission} onClose={()=>setPermission(null)} onDone={()=>{setPermission(null);setMessage('Permission granted. The student can submit once more.');onSaved()}}/>}
  </section>;
}

function ScoreRowEditor({row,section,kind,max,closed,editing,saving,draft,error,saved,onDraftChange,onPermission}:{row:ScoreRow;section:string;kind:Assessment['kind'];max:number;closed:boolean;editing:boolean;saving:boolean;draft:ScoreDraft;error?:string;saved:boolean;onDraftChange:(draft:ScoreDraft)=>void;onPermission:()=>void}){
  const sub=row.latest;
  return <tr role="row">
    <td role="cell" data-label="Student">{row.student}</td>
    <td role="cell" data-label="Section">{section}</td>
    {kind==='activity'&&<td role="cell" data-label="Submission">{sub?<>
      <a className="touch" href={`/api/files/${sub.file.id}/download`}>{sub.file.name}</a><br/>
      <span className="muted">Version {sub.version} of {row.versions} · {when(sub.submitted_at)}</span>{sub.is_late&&<> <span className="badge">Late</span></>}
      {sub.note&&<p className="pre">{sub.note}</p>}
      {row.new_version_since_grading&&<p className="warn" role="status">New version since you graded. Review it and save the score again.</p>}</>:<span className="muted">Nothing submitted</span>}
      {row.permission_open&&<p className="muted">A resubmission permission is open.</p>}</td>}
    <td role="cell" data-label={`Score (of ${fmt(max)})`}><label className="sr-only" htmlFor={`s-${row.student_id}`}>Score for {row.student}</label>
      <input id={`s-${row.student_id}`} inputMode="decimal" value={draft.score} placeholder="Not scored" disabled={closed} readOnly={!editing||saving} aria-invalid={!!error} onChange={e=>onDraftChange({...draft,score:e.target.value})} aria-describedby={error?`max-${row.student_id} err-${row.student_id}`:`max-${row.student_id}`}/>
      <span id={`max-${row.student_id}`} className="muted">{draft.score===''?'Pending':Number(draft.score)===0?'Recorded zero':`of ${fmt(max)}`}</span></td>
    <td role="cell" data-label="Feedback"><label className="sr-only" htmlFor={`f-${row.student_id}`}>Feedback for {row.student}</label><textarea id={`f-${row.student_id}`} value={draft.feedback} maxLength={5000} disabled={closed} readOnly={!editing||saving} aria-invalid={!!error} aria-describedby={error?`err-${row.student_id}`:undefined} onChange={e=>onDraftChange({...draft,feedback:e.target.value})}/></td>
    <td role="cell" data-label="Edit"><div className="score-row-actions">{saved&&<span className="badge done">Saved</span>}
      {kind==='activity'&&!closed&&<button disabled={saving} onClick={onPermission}>Allow resubmission</button>}</div>{error&&<p id={`err-${row.student_id}`} role="alert" className="error">{error}</p>}</td>
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

function Attempts({base,attempts,sections,sectionId,closed,onChanged,setMessage}:{base:string;attempts:UseQueryResult<AttemptRow[]>;sections:OfferingSummary['sections'];sectionId:string;closed:boolean;onChanged:()=>void;setMessage:(m:string)=>void}){
  const ask=useConfirm();
  const [review,setReview]=useState<string|null>(null);
  const open=attempts.data?.filter(x=>x.state==='in_progress').length??0;
  const visible=attempts.data?.filter(x=>!sectionId||x.section_id===sectionId)??[];
  async function closeOpen(){
    if(!await ask({title:'Close all open attempts?',message:'Whatever each student saved is scored as their submission.',yes:'Close attempts',danger:true}))return;
    try{const r=await post<{closed:number}>(`${base}/attempts/close-open`,{});setMessage(`Closed ${r.closed} open attempt${r.closed===1?'':'s'}.`);onChanged()}
    catch(e){setMessage(errorText(e))}
  }
  return <section className="panel"><div className="page-heading"><h3>Attempts</h3>
    {open>0&&<button disabled={closed} onClick={closeOpen}>Close {open} open attempt{open===1?'':'s'}</button>}</div>
    {attempts.isPending?<p>Loading…</p>:attempts.error?<p role="alert">{attempts.error.message}</p>:visible.length===0?<p className="muted">{sectionId?'No attempts in this section.':'No student has started this quiz yet.'}</p>:
      <div className="table-wrap" role="region" aria-label="Attempts" tabIndex={0}><table><thead><tr><th>Student</th><th>Section</th><th>Attempt</th><th>Status</th><th>Score</th><th>Submitted</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{visible.map(x=><tr key={x.id}><td>{x.student}</td><td>{sections.find(s=>s.id===x.section_id)?.name??'—'}</td><td>{x.attempt_number}</td><td><span className="badge">{x.state==='submitted'?'Submitted':'In progress'}</span></td>
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
  return <Dialog title="Review answers" onClose={onClose} className="review-answers-dialog">
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
