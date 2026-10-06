import {useState} from 'react';
import {Link,useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {ApiError,api,post,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {useHere,type Origin} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {PERIOD_LABEL,fmt,type Cell,type Gradebook,type GradeRow} from './types';

interface Publication{published:number;unchanged:number;pending:{student_id:string;student:string;reasons:string[]}[]}

export function GradebookPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const closed=offering.term_status==='closed';
  const here=useHere();
  const query=useQuery({queryKey:['gradebook',offering.id],queryFn:()=>api<Gradebook>(`/teach/offerings/${offering.id}/gradebook`)});
  const [editing,setEditing]=useState<{row:GradeRow;columnId:string}|null>(null);
  const [detail,setDetail]=useState<GradeRow|null>(null);
  const [outcome,setOutcome]=useState<{period:string;result:Publication}|null>(null);
  const [message,setMessage]=useState('');
  const [find,setFind]=useState('');const [section,setSection]=useState('');const [only,setOnly]=useState('');   // view filters: they never change what Publish acts on
  const refresh=()=>queryClient.invalidateQueries({queryKey:['gradebook',offering.id]});

  if(query.isPending)return <p>Loading gradebook…</p>;
  if(query.error){
    const code=query.error instanceof ApiError?query.error.code:'';
    return <section className="panel"><h2>The gradebook is not ready</h2><p role="alert">{query.error.message}</p>
      {(code==='policy_missing'||code==='policy_incomplete')&&<Link className="button primary" to={`/faculty/offerings/${offering.id}/syllabus`}>Open the syllabus</Link>}</section>;
  }
  const book=query.data;
  const periods=[...book.policy.periods.map(p=>p.key),'course'];
  const shown=periods.filter(p=>!only||p==='course'||p===only);
  const sections=[...new Set(book.rows.map(r=>r.section).filter((s):s is string=>!!s))].sort();
  const rows=book.rows.filter(r=>(!section||r.section===section)&&`${r.display_name} ${r.student_number}`.toLowerCase().includes(find.trim().toLowerCase()));
  const byPeriod=(period:string)=>book.columns.filter(c=>c.period===period);
  const label=(key:string|null)=>book.policy.categories.find(c=>c.key===key)?.label??key??'';

  async function publish(period:string){
    const ready=book.rows.filter(r=>r.grades[period]?.grade!==null).length;
    if(!confirm(`Publish ${PERIOD_LABEL[period]} grades for all ${ready} ready student${ready===1?'':'s'} in this subject, across all sections (table filters do not limit this)? Students see them immediately. Anyone who is not ready is skipped.`))return;
    try{const result=await post<Publication>(`/teach/offerings/${offering.id}/grades/publish`,{period});setOutcome({period,result});refresh()}
    catch(e){setMessage(errorText(e))}
  }
  const flaggedRows=book.rows.filter(r=>Object.values(r.published).some(p=>p.needs_review));
  const flagged=flaggedRows.length;

  return <>
    <div className="page-heading"><div><h2>Gradebook</h2>
      <p className="muted">Working values. Students see only the results you release and the grades you publish. Policy version {book.policy_version} · {book.policy.transmutation==='transmuted'?'transmuted':'raw'} scores · passing {book.policy.passing}.</p></div></div>
    {message&&<p role="alert">{message}</p>}
    {flagged>0&&<p className="warn" role="status">{flagged} student{flagged===1?' has':'s have'} a published grade that needs your review because working data changed. Republish when you are ready; students keep seeing the last published grade until then.</p>}
    {flagged>0&&<ul className="seq" aria-label="Grades needing review">{flaggedRows.map(r=><li key={r.student_id}><span className="grow"><strong>{r.display_name}</strong><span className="muted">{Object.entries(r.published).filter(([,p])=>p.needs_review).map(([k,p])=>`${PERIOD_LABEL[k]??k}: ${p.review_reason??'working data changed'}`).join(' · ')}</span></span><button onClick={()=>setDetail(r)}>Review</button></li>)}</ul>}
    <section className="panel"><h3>Publish grades</h3>
      <p className="muted">Grades and ranks to share or download are on the Class standing tab. Each button publishes the current working grade for every ready student in this subject, across all sections; the filters on the table below do not limit publication. It never changes released assessment results.</p>
      <div className="actions">{periods.map(p=><button key={p} disabled={closed} onClick={()=>publish(p)}>Publish {PERIOD_LABEL[p]??p}</button>)}</div></section>

    <section className="panel"><h3>Scores and grades</h3>
      <p className="muted">— means pending (not scored yet). 0.00 is a real recorded zero. “Unreleased change” means the student still sees an older result.</p>
      <div className="actions"><label>Find a student<input type="search" value={find} onChange={e=>setFind(e.target.value)} placeholder="Name or student number"/></label>
        <label>Section<select value={section} onChange={e=>setSection(e.target.value)}><option value="">All sections</option>{sections.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label>Period<select value={only} onChange={e=>setOnly(e.target.value)}><option value="">All periods</option>{book.policy.periods.map(p=><option key={p.key} value={p.key}>{PERIOD_LABEL[p.key]??p.key}</option>)}</select></label></div>
      <p className="muted" role="status">Showing {rows.length} of {book.rows.length} students.</p>
      <div className="table-wrap gradebook" role="region" aria-label="Gradebook, scrolls sideways" tabIndex={0}><table>
        <thead>
          <tr><th className="sticky">Student</th>{shown.filter(p=>p!=='course').map(p=><th key={p} colSpan={byPeriod(p).length+1}>{PERIOD_LABEL[p]??p}</th>)}<th>Course</th></tr>
          <tr><th className="sticky"><span className="sr-only">Student</span></th>
            {shown.filter(p=>p!=='course').flatMap(p=>[...byPeriod(p).map(c=><th key={c.id}><Link state={here} to={`/faculty/offerings/${offering.id}/assessments/${c.id}/scores`} title="Open this assessment's scores and attempts">{c.title}</Link><br/><span className="muted">{label(c.category_key)} · /{fmt(c.max_points)}</span></th>),<th key={p+'g'}>Grade</th>])}
            <th>Grade</th></tr></thead>
        <tbody>{rows.map(r=><tr key={r.student_id}>
          <th className="sticky" scope="row"><button className="linklike" onClick={()=>setDetail(r)}>{r.display_name}</button><br/><span className="muted">{r.section??''}</span></th>
          {shown.filter(p=>p!=='course').flatMap(p=>[...byPeriod(p).map(c=><td key={c.id}><CellView cell={r.cells[c.id]} kind={c.kind} onEdit={()=>setEditing({row:r,columnId:c.id})} disabled={closed}/></td>),
            <td key={p+'g'}><GradeCell row={r} period={p} onReview={setDetail}/></td>])}
          <td><GradeCell row={r} period="course" onReview={setDetail}/></td></tr>)}</tbody></table></div></section>


    {editing&&<ScoreDialog offeringId={offering.id} book={book} editing={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);refresh()}}/>}
    {detail&&<DetailDialog row={detail} here={here} base={`/faculty/offerings/${offering.id}`} onClose={()=>setDetail(null)}/>}
    {outcome&&<Dialog title={`${PERIOD_LABEL[outcome.period]} grades`} onClose={()=>setOutcome(null)}>
      <p>{outcome.result.published} published · {outcome.result.unchanged} unchanged · {outcome.result.pending.length} not ready.</p>
      {outcome.result.pending.length>0&&<><h3>Not ready</h3><ul>{outcome.result.pending.map(p=><li key={p.student_id}><strong>{p.student}</strong>: {p.reasons.join('; ')}</li>)}</ul></>}
      <div className="actions"><button className="primary" onClick={()=>setOutcome(null)}>Done</button></div></Dialog>}
  </>;
}

function CellView({cell,kind,onEdit,disabled}:{cell?:Cell;kind:string;onEdit:()=>void;disabled:boolean}){
  if(!cell)return <span className="muted" title="Does not apply to this student's section">n/a</span>;
  const state=kind==='online_quiz'&&cell.score===null?(cell.attempt_state==='in_progress'?'In progress':'Not attempted'):null;
  return <div className="cell">
    <button className="linklike" disabled={disabled||kind==='online_quiz'&&cell.attempt_state==='submitted'} onClick={onEdit} aria-label={cell.score===null?'Pending, edit score':`Score ${fmt(cell.score)}, edit`}>{cell.score===null?'—':fmt(cell.score)}</button>
    {state&&<span className="muted"> {state}</span>}
    {cell.unreleased_change&&<span className="badge"> Unreleased change</span>}</div>;
}

function GradeCell({row,period,onReview}:{row:GradeRow;period:string;onReview:(r:GradeRow)=>void}){
  const g=row.grades[period];const p=row.published[period];
  return <div className="cell">
    <strong>{g?.grade===null||g?.grade===undefined?'Pending':fmt(g.grade)}</strong>
    {p&&<><br/><span className="muted">Published {fmt(p.grade)} (v{p.release_number})</span>{p.needs_review&&<button className="badge linklike" onClick={()=>onReview(row)} aria-label={`Needs review: ${row.display_name}, open details`}>Needs review</button>}</>}</div>;
}

function ScoreDialog({offeringId,book,editing,onClose,onSaved}:{offeringId:string;book:Gradebook;editing:{row:GradeRow;columnId:string};onClose:()=>void;onSaved:()=>void}){
  const column=book.columns.find(c=>c.id===editing.columnId)!;
  const cell=editing.row.cells[editing.columnId];
  const [score,setScore]=useState(cell?.score===null||cell?.score===undefined?'':String(cell.score));
  const [feedback,setFeedback]=useState(cell?.feedback??'');
  const [error,setError]=useState('');
  async function save(){
    setError('');
    try{await send('PUT',`/teach/offerings/${offeringId}/assessments/${column.id}/scores/${editing.row.student_id}`,{score:score.trim()===''?null:score.trim(),feedback,expected_revision:cell?.revision??0});onSaved()}
    catch(e){setError(errorText(e))}
  }
  return <Dialog title={`${column.title}: ${editing.row.display_name}`} onClose={onClose}>
    <label>Score (out of {fmt(column.max_points)}). Leave empty for pending; 0 is a real score.<input inputMode="decimal" value={score} onChange={e=>setScore(e.target.value)}/></label>
    <label>Feedback for the student<textarea value={feedback} maxLength={5000} onChange={e=>setFeedback(e.target.value)}/></label>
    <p className="muted">Saving changes your working score. The student sees it only after you release the results.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save score</button></div></Dialog>;
}

function DetailDialog({row,base,here,onClose}:{row:GradeRow;base:string;here:Origin;onClose:()=>void}){
  const flagged=Object.entries(row.published).filter(([,p])=>p.needs_review);
  return <Dialog title={`${row.display_name}: how the grade is calculated`} onClose={onClose}>
    {flagged.length>0&&<div className="warn" role="status">{flagged.map(([k,p])=><p key={k}><strong>{PERIOD_LABEL[k]??k} needs review.</strong> Students see {fmt(p.grade)} (v{p.release_number}); the working grade is now {row.grades[k]?.grade==null?'pending':fmt(row.grades[k]?.grade)}. {p.review_reason??'Working data changed.'}</p>)}<p>Fix anything pending below (links beside each item), then close this and press Publish for that period. Nothing changes for the student until you do.</p></div>}
    {Object.entries(row.grades).filter(([k])=>k!=='course').map(([period,g])=><section key={period}>
      <h3>{PERIOD_LABEL[period]??period}: {g.grade===null?'Pending':fmt(g.grade)}</h3>
      <ul>{g.categories.map(c=><li key={c.key}><strong>{c.label}</strong> ({c.weight}%): {c.status==='ok'?`${fmt(c.percent)}% (${fmt(c.earned)} of ${fmt(c.possible)})`:c.status==='pending'?`Pending: ${c.missing.join('; ')}`:c.missing.join('; ')}{c.status!=='ok'&&<> <Link to={c.key==='attendance'?`${base}/attendance`:`${base}/assessments`}>{c.key==='attendance'?'Open attendance':'Open assessments'}</Link></>}</li>)}</ul>
      {g.grade===null&&<p className="muted">The {PERIOD_LABEL[period]??period} grade cannot be republished until the pending items above are done.</p>}</section>)}
    <p className="muted">Course grade: {row.grades.course?.grade===null?'Pending (both periods must be ready)':fmt(row.grades.course?.grade)}</p>
    <div className="actions"><Link className="button" state={here} to={`${base}/students/${row.student_id}`}>Open full standing</Link><button className="primary" onClick={onClose}>Close</button></div></Dialog>;
}
