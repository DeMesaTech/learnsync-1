import {useToast} from '../../components/undo';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import {Link,useNavigate,useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {ApiError,api,post,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {useConfirm} from '../../components/confirm';
import {Pager} from '../../components/Pager';
import {useHere,type Origin} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {ExportPanel} from '../exports/ExportPanel';
import {PERIOD_LABEL,fmt,type AssessmentGradebookColumn,type Cell,type Gradebook,type GradebookCell,type GradeRow} from './types';

interface Publication{published:number;unchanged:number;pending:{student_id:string;student:string;reasons:string[]}[]}
interface Stats{ready:number;changes:number;unchanged:number;review:number;notReady:string[]}
const ATTENDANCE_LABEL={present:'Present',absent:'Absent',late:'Late',excused:'Excused'} as const;
function localDate(value:string){
  const [year,month,day]=value.split('-').map(Number);
  return new Date(year,month-1,day);
}
function attendanceDateLabel(value:string){
  const [year,month,day]=value.split('-');
  return `${month}/${day}/${year.slice(-2)}`;
}
function attendanceDateTooltip(value:string){
  return `${value} · ${localDate(value).toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'})}`;
}

/** What publishing a period would do, from the working values the page already has. */
export function periodStats(book:Gradebook,period:string):Stats{
  const ready=book.rows.filter(r=>r.grades[period]?.grade!=null);
  const changes=ready.filter(r=>{const p=r.published[period];return !p||p.needs_review||Number(p.grade)!==Number(r.grades[period]!.grade)});
  return {ready:ready.length,changes:changes.length,unchanged:ready.length-changes.length,
    review:book.rows.filter(r=>r.published[period]?.needs_review).length,
    notReady:book.rows.filter(r=>r.grades[period]?.grade==null).map(r=>r.display_name)};
}
const cellKey=(columnId:string,studentId:string)=>`${columnId}:${studentId}`;

export function GradebookPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const navigate=useNavigate();
  const closed=offering.term_status!=='active';
  const here=useHere();const toast=useToast();const ask=useConfirm();
  const query=useQuery({queryKey:['gradebook',offering.id],queryFn:()=>api<Gradebook>(`/teach/offerings/${offering.id}/gradebook`)});
  const [detail,setDetail]=useState<GradeRow|null>(null);
  const [publishing,setPublishing]=useState<string|null>(null);
  const [showPublishing,setShowPublishing]=useState(false);
  const [showExport,setShowExport]=useState(false);
  const publishPopover=useRef<HTMLDivElement>(null);
  const exportPopover=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!showPublishing&&!showExport)return;
    const closeOutside=(event:MouseEvent)=>{
      if(!publishPopover.current?.contains(event.target as Node)&&!exportPopover.current?.contains(event.target as Node)){
        setShowPublishing(false);
        setShowExport(false);
      }
    };
    const closeEscape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        setShowPublishing(false);
        setShowExport(false);
      }
    };
    document.addEventListener('mousedown',closeOutside);
    document.addEventListener('keydown',closeEscape);
    return ()=>{
      document.removeEventListener('mousedown',closeOutside);
      document.removeEventListener('keydown',closeEscape);
    };
  },[showPublishing,showExport]);
  const [message,setMessage]=useState('');
  const [find,setFind]=useState('');const [section,setSection]=useState('');const [only,setOnly]=useState('');   // view filters: they never change what Publish acts on
  const [showSection,setShowSection]=useState(false);
  const [showStudentNumber,setShowStudentNumber]=useState(false);
  const [page,setPage]=useState(1);const [pageSize,setPageSize]=useState(25);
  const [editing,setEditing]=useState(false);
  const [edits,setEdits]=useState<Record<string,string>>({});          // cellKey -> typed score, only for cells that differ
  const [rejected,setRejected]=useState<Record<string,string>>({});    // cellKey -> why the server refused it
  const [saving,setSaving]=useState(false);
  const [releasing,setReleasing]=useState<string|null>(null);
  const refresh=()=>queryClient.invalidateQueries({queryKey:['gradebook',offering.id]});

  if(query.isPending)return <p>Loading gradebook…</p>;
  if(query.error){
    const code=query.error instanceof ApiError?query.error.code:'';
    return <section className="panel"><h2>The gradebook is not ready</h2><p role="alert">{query.error.message}</p>
      {(code==='policy_missing'||code==='policy_incomplete')&&<Link className="button primary" to={`/faculty/offerings/${offering.id}/setup`}>Set up this subject</Link>}</section>;
  }
  const book=query.data;
  const periods=[...book.policy.periods.map(p=>p.key),'course'];
  const shown=periods.filter(p=>!only||p==='course'||p===only);
  const rows=book.rows.filter(r=>(!section||r.section===section)&&`${r.display_name} ${r.student_number}`.toLowerCase().includes(find.trim().toLowerCase()));
  const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
  const currentPage=Math.min(page,pageCount);
  const pageRows=rows.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const byPeriod=(period:string)=>book.columns.filter(c=>c.period===period);
  const stats=Object.fromEntries(periods.map(p=>[p,periodStats(book,p)])) as Record<string,Stats>;
  const next=periods.find(p=>stats[p].changes>0);
  const courseUnlocked=book.policy.periods.every(p=>book.rows.some(r=>r.published[p.key]));
  const flaggedRows=book.rows.filter(r=>Object.values(r.published).some(p=>p.needs_review));
  const changed=Object.keys(edits).length;
  const studentDetailColumnCount=1+(showSection?1:0)+(showStudentNumber?1:0);

  const editScoresButton=!editing&&<button className="icon-button" type="button" aria-label="Edit scores"
    title={closed?'This term is closed, so scores are read-only.':'Type scores straight into the table below.'}
    disabled={closed} onClick={()=>{setEditing(true);setMessage('')}}>✎</button>;
  const gradebookHeaderActions=!editing&&<div className="gradebook-sticky-actions">
    {editScoresButton}
    <ManualColumnAction offeringId={offering.id} policy={book.policy} disabled={closed}
      onCreated={async period=>{setOnly(period);setPage(1);await refresh()}}/>
  </div>;
  const studentDetailHeaders=<>
    {showSection&&<th scope="col" className="sticky sticky-section" rowSpan={editing?2:3}>
      <div className="gradebook-sticky-heading">{gradebookHeaderActions}<span>Section</span></div>
    </th>}
    <th scope="col" className={`sticky-number${showStudentNumber?'':' hidden-column'}`} rowSpan={editing?2:3}>Student number</th>
    <th scope="col" className="sticky-student" rowSpan={editing?2:3}>
      <div className="gradebook-sticky-heading">{!showSection&&gradebookHeaderActions}<span>Student</span></div>
    </th>
  </>;
  const categoryColumns=(period:string)=>{
    const columns=byPeriod(period);
    const groups=new Map<string,{label:string;columns:Gradebook['columns']}>();
    for(const category of book.policy.categories)groups.set(category.key,{label:category.label,columns:[]});
    for(const column of columns){
      const key=column.category_key??'uncategorized';
      const label=book.policy.categories.find(c=>c.key===key)?.label??(key==='uncategorized'?'Uncategorized':key);
      const group=groups.get(key)??{label,columns:[]};
      group.columns.push(column);
      groups.set(key,group);
    }
    return [...groups.entries()].map(([key,group])=>({key,...group}));
  };

  const editable=(kind:string,cell?:GradebookCell)=>!!cell&&'score' in cell&&kind!=='online_quiz';
  function typeScore(column:string,student:string,original:Cell,value:string){
    const key=cellKey(column,student);const before=original.score===null?'':String(original.score);
    setEdits(prev=>{const n={...prev};if(value.trim()===before.trim())delete n[key];else n[key]=value;return n});
    setRejected(prev=>{if(!prev[key])return prev;const n={...prev};delete n[key];return n});
  }
  async function saveAll(){
    setMessage('');setRejected({});setSaving(true);
    try{
      const cells=Object.entries(edits).map(([key,value])=>{const [assessment_id,student_id]=key.split(':');
        const cell=book.rows.find(r=>r.student_id===student_id)?.cells[assessment_id];
        if(!cell||!('score' in cell))throw new Error('An edited score cell is no longer available. Reload the gradebook and try again.');
        return {assessment_id,student_id,score:value.trim()===''?null:value.trim(),feedback:cell.feedback,expected_revision:cell.revision}});
      await send('PUT',`/teach/offerings/${offering.id}/gradebook/scores`,{cells});
      toast(`Saved ${cells.length} score${cells.length===1?'':'s'}.`);setEditing(false);setEdits({});setMessage(`Saved ${cells.length} score${cells.length===1?'':'s'}. Students see changes only after you return the results.`);await refresh()}
    catch(e){
      if(e instanceof ApiError&&e.code==='batch_rejected'){setRejected(e.fields);setMessage(`${e.message} Fix the marked cells, or reload if someone else changed them.`)}
      else setMessage(errorText(e));
    }finally{setSaving(false)}
  }
  const leaveEditing=()=>{setEditing(false);setEdits({});setRejected({});setMessage('')};
  const editActions=editing&&<div className="actions sticky-bar">
    <button className="primary" disabled={changed===0||saving} onClick={saveAll}>{saving?'Saving…':changed===0?'Save scores':`Save ${changed} changed score${changed===1?'':'s'}`}</button>
    <button disabled={saving} onClick={leaveEditing}>Cancel</button>
    <span className="muted">{changed===0?'No changes yet.':'Nothing is saved until you press Save.'}</span>
  </div>;
  async function returnResults(column:AssessmentGradebookColumn,count:number){
    const label=`Return ${count} graded result${count===1?'':'s'}`;
    if(!await ask({title:`${label}?`,message:'Students will see the scores and feedback straight away.',yes:`Return ${count}`}))return;
    setReleasing(column.id);setMessage('');
    try{
      const result=await post<{released:number}>(`/teach/offerings/${offering.id}/assessments/${column.id}/release`,{student_ids:null});
      const text=result.released===0?'Nothing new to return.':`Returned ${result.released} result${result.released===1?'':'s'}.`;
      setMessage(text);toast(text);await refresh();
    }catch(error){setMessage(errorText(error))}
    finally{setReleasing(null)}
  }

  const periodRow=(p:string)=><li key={p}><span className="grow"><strong>{PERIOD_LABEL[p]??p}</strong>
    <span className="muted">{stats[p].changes>0?`${stats[p].changes} ready to publish`:stats[p].ready>0?'Nothing new to publish':'No grades are ready yet'}{stats[p].review>0?` · ${stats[p].review} need review`:''}{stats[p].notReady.length>0&&stats[p].ready>0?` · ${stats[p].notReady.length} not ready`:''}</span></span>
    <button className={p===next?'primary':''} disabled={closed||stats[p].ready===0||(p==='course'&&!courseUnlocked)} title={p==='course'&&!courseUnlocked?'Publish Midterm and Finals first':undefined} onClick={()=>{setShowPublishing(false);setPublishing(p)}}>Publish {PERIOD_LABEL[p]??p}…</button></li>;

  return <>
    <div className="page-heading gradebook-heading"><div><h2>Gradebook</h2>
      </div></div>
    {message&&<p role="status">{message}</p>}

    <div className="gradebook-toolbar" role="group" aria-label="Gradebook actions">
      <div className="gradebook-publish-anchor" ref={publishPopover}>
        <button type="button" className="gradebook-publish-trigger" aria-haspopup="dialog" aria-expanded={showPublishing} aria-controls="gradebook-publish-popover" onClick={()=>{setShowPublishing(value=>!value);setShowExport(false)}}>
          <span>Ready to publish{next?` · ${PERIOD_LABEL[next]??next}`:''}{flaggedRows.length>0?` · ${flaggedRows.length} need review`:''}</span>
          <span className={`gradebook-publish-chevron${showPublishing?' open':''}`} aria-hidden="true">▾</span>
        </button>
        {showPublishing&&<section id="gradebook-publish-popover" className="gradebook-publish-popover" role="dialog" aria-label="Ready to publish">
        <h3>Ready to publish</h3>
        <ul className="rows">{periods.map(periodRow)}</ul>
        {periods.includes('course')&&!courseUnlocked&&<p className="muted">The Course grade unlocks once Midterm and Finals have each been published.</p>}
        {flaggedRows.length>0&&<><p className="warn" role="status">{flaggedRows.length} student{flaggedRows.length===1?' has':'s have'} a published grade that needs review because working data changed. Students keep seeing the last published grade until you republish.</p>
          <ul className="rows" aria-label="Grades needing review">{flaggedRows.map(r=><li key={r.student_id}><span className="grow"><strong>{r.display_name}</strong><span className="muted">{Object.entries(r.published).filter(([,p])=>p.needs_review).map(([k,p])=>`${PERIOD_LABEL[k]??k}: ${p.review_reason??'working data changed'}`).join(' · ')}</span></span><button onClick={()=>{setShowPublishing(false);setDetail(r)}}>Review</button></li>)}</ul></>}
        </section>}
      </div>
      <div className="gradebook-export-anchor" ref={exportPopover}>
        <button type="button" className="gradebook-export-trigger" aria-haspopup="dialog" aria-expanded={showExport} aria-controls="gradebook-export-popover" onClick={()=>{setShowExport(value=>!value);setShowPublishing(false)}}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 16v4h14v-4"/>
          </svg>
          <span>Export grades</span>
        </button>
        <div id="gradebook-export-popover" className="gradebook-publish-popover gradebook-export-popover" role="dialog" aria-label="Export grades" hidden={!showExport}>
          <ExportPanel offering={offering} periods={periods}/>
        </div>
      </div>
      <button type="button" className="gradebook-export-trigger" disabled={closed||(editing&&changed>0)||saving}
        title={closed?'This term is closed, so grading categories cannot be edited.':
          editing&&changed>0?'Save or cancel score edits before editing grading categories.':undefined}
        onClick={()=>navigate(`/faculty/offerings/${offering.id}/setup?step=grading`)}>
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m14 5 5 5M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z"/>
        </svg>
        <span>Edit grading categories</span>
      </button>
    </div>

    <section className="panel"><h3>Scores and grades</h3>
      <div className="gradebook-controls-row">
        <div className="gradebook-filters" aria-label="Filter students">
          <label>Find a student<input type="search" value={find} onChange={e=>{setFind(e.target.value);setPage(1)}} placeholder="Name or student number"/></label>
          <label>Section<select aria-label="Filter scores and grades by section" value={section} onChange={e=>{setSection(e.target.value);setPage(1)}}><option value="">All sections ({book.rows.length})</option>{offering.sections.map(s=><option key={s.id} value={s.name}>{s.name} ({s.enrolled})</option>)}</select></label>
          <label>Period<select value={only} onChange={e=>setOnly(e.target.value)}><option value="">All periods</option>{book.policy.periods.map(p=><option key={p.key} value={p.key}>{PERIOD_LABEL[p.key]??p.key}</option>)}</select></label>
        </div>
        <div className="gradebook-column-toggles" role="group" aria-label="Table columns">
          <label className="inline"><input type="checkbox" checked={showSection} onChange={e=>setShowSection(e.target.checked)}/> Section</label>
          <label className="inline"><input type="checkbox" checked={showStudentNumber} onChange={e=>setShowStudentNumber(e.target.checked)}/> Student number</label>
        </div>
        <p className="muted gradebook-student-count" role="status">Showing {rows.length} of {book.rows.length} students.{editing?' Editing: type a score in any cell, then save once.':''}</p>
      </div>
      <div className={`table-wrap gradebook${showSection?'':' hide-section'}${showStudentNumber?'':' hide-student-number'}`} role="region" aria-label="Gradebook; section and student details stay fixed while scores scroll horizontally" tabIndex={0}><table>
        <thead>
          <tr>
            {editing?<th className="sticky gradebook-edit-header" colSpan={studentDetailColumnCount} aria-label="Score editing actions">{editActions}</th>:studentDetailHeaders}
            {shown.filter(p=>p!=='course').map(p=>{
            const groups=categoryColumns(p);
            return <th key={p} colSpan={groups.reduce((sum,group)=>sum+Math.max(1,group.columns.length),0)+1}>{PERIOD_LABEL[p]??p}</th>;
          })}{shown.includes('course')&&<th rowSpan={3}>Course</th>}</tr>
          <tr>{editing&&studentDetailHeaders}{shown.filter(p=>p!=='course').flatMap(p=>[
            ...categoryColumns(p).map(group=>{
              const category=book.policy.categories.find(c=>c.key===group.key);
              return <th key={`${p}-${group.key}`} className="gradebook-category-header" colSpan={Math.max(1,group.columns.length)}>
                {group.label}{category&&<small>{fmt(category.weight)}%</small>}
              </th>;
            }),
            <th key={`${p}-grade`} className="gradebook-period-grade-header">{PERIOD_LABEL[p]??p} grade</th>
          ])}</tr>
          <tr>
            {shown.filter(p=>p!=='course').flatMap(p=>[...categoryColumns(p).flatMap(group=>group.columns.length?group.columns.map((c,index)=>{
              const edgeStart=index===0?' gradebook-category-edge-start':'';
              const edgeEnd=index===group.columns.length-1?' gradebook-category-edge-end':'';
              if(c.kind==='attendance'){
                const tip=`Attendance on ${attendanceDateTooltip(c.attendance_date)} · ${PERIOD_LABEL[c.period]??c.period}`;
                return <th key={c.id} scope="col" className={`gradebook-assessment-header${edgeStart}${edgeEnd}`}
                  title={tip} aria-label={tip}>{attendanceDateLabel(c.attendance_date)}</th>;
              }
              const releaseCount=book.rows.reduce((count,row)=>{
                const cell=row.cells[c.id];
                return count+(cell&&'unreleased_change' in cell&&cell.unreleased_change?1:0);
              },0);
              const releaseLabel=`Return ${releaseCount} graded result${releaseCount===1?'':'s'} for ${c.title}`;
              return <th key={c.id} scope="col" className={`gradebook-assessment-header${edgeStart}${edgeEnd}`}
                title={c.title} aria-label={`${c.title}, maximum ${fmt(c.max_points)} points`}>
                <div className="gradebook-assessment-header-content"><span className="muted">/{fmt(c.max_points)}</span>
                  {releaseCount>0&&<button type="button" className="icon-button gradebook-release-button"
                    aria-label={releaseLabel} title={closed?'This term is closed, so results cannot be returned.':releaseLabel}
                    disabled={closed||releasing!==null} onClick={()=>void returnResults(c,releaseCount)}>
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 14v5h16v-5"/>
                    </svg>
                  </button>}
                </div>
              </th>;
            }):[<th key={`${p}-${group.key}-empty`} scope="col" className="gradebook-assessment-header gradebook-category-edge-start gradebook-category-edge-end" aria-label={`${group.label}: no items`}/>]),<th key={`${p}-grade-value`} className="gradebook-period-grade-header">Grade</th>])}
            {shown.includes('course')&&<th>Grade</th>}</tr></thead>
        <tbody>{pageRows.map(r=><tr key={r.student_id}>
          {showSection&&<td className="sticky sticky-section">{r.section??'—'}</td>}<td className={`student-number sticky-number${showStudentNumber?'':' hidden-column'}`}>{r.student_number}</td><th className="student-name sticky-student" scope="row"><button className="linklike" onClick={()=>setDetail(r)}>{r.display_name}</button></th>
          {shown.filter(p=>p!=='course').flatMap(p=>[...categoryColumns(p).flatMap(group=>group.columns.length?group.columns.map((c,index)=>{
            const cell=r.cells[c.id];
            return <td key={c.id} className={`gradebook-category-cell${index===0?' gradebook-category-edge-start':''}${index===group.columns.length-1?' gradebook-category-edge-end':''}`}>
              <CellView cell={cell} kind={c.kind} column={c.title} student={r.display_name} editing={editing&&editable(c.kind,cell)} value={edits[cellKey(c.id,r.student_id)]} problem={rejected[cellKey(c.id,r.student_id)]}
                onType={value=>{if(cell&&'score' in cell)typeScore(c.id,r.student_id,cell,value)}}/>
            </td>;
          }):[<td key={`${p}-${group.key}-empty-cell`} className="gradebook-category-cell gradebook-category-edge-start gradebook-category-edge-end" aria-label={`${group.label}: no items`}/>]),
            <td key={p+'g'}><GradeCell row={r} period={p} onReview={setDetail}/></td>])}
          <td><GradeCell row={r} period="course" onReview={setDetail}/></td></tr>)}</tbody></table></div>
      <Pager page={currentPage} pageSize={pageSize} total={rows.length} onPage={setPage} onSize={size=>{setPageSize(size);setPage(1)}} iconOnly/>
    </section>

    {detail&&<DetailDialog row={detail} here={here} base={`/faculty/offerings/${offering.id}`} onClose={()=>setDetail(null)}/>}
    {publishing&&<PublishDialog offeringId={offering.id} period={publishing} stats={stats[publishing]} onClose={()=>setPublishing(null)} onPublished={refresh}/>}
  </>;
}

function PublishDialog({offeringId,period,stats,onClose,onPublished}:{offeringId:string;period:string;stats:Stats;onClose:()=>void;onPublished:()=>void}){
  const [result,setResult]=useState<Publication|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const name=PERIOD_LABEL[period]??period;const toast=useToast();
  async function go(){setBusy(true);setError('');
    try{setResult(await post<Publication>(`/teach/offerings/${offeringId}/grades/publish`,{period}));toast(`${name} grades published.`);onPublished()}
    catch(e){setError(errorText(e))}finally{setBusy(false)}}
  if(result)return <Dialog title={`${name} grades published`} onClose={onClose}>
    <p role="status">{result.published} published · {result.unchanged} unchanged · {result.pending.length} not ready.</p>
    {result.pending.length>0&&<><h3>Not ready</h3><ul>{result.pending.map(p=><li key={p.student_id}><strong>{p.student}</strong>: {p.reasons.join('; ')}</li>)}</ul></>}
    <div className="actions"><button className="primary" onClick={onClose}>Done</button></div></Dialog>;
  return <Dialog title={`Review and publish ${name}`} onClose={onClose}>
    <p>Students see these grades <strong>immediately</strong>. The table filters do not limit this: it covers every ready student in this subject, across all sections.</p>
    <ul className="rows"><li><strong>{stats.changes}</strong><span className="muted">grade{stats.changes===1?'':'s'} will be published or updated</span></li>
      <li><strong>{stats.unchanged}</strong><span className="muted">already published and unchanged</span></li>
      <li><strong>{stats.notReady.length}</strong><span className="muted">not ready, so skipped{stats.notReady.length>0?`: ${stats.notReady.slice(0,5).join(', ')}${stats.notReady.length>5?', …':''}`:''}</span></li></ul>
    <p className="muted">Publishing never changes results you already returned for individual assessments.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy||stats.changes===0} onClick={go}>{busy?'Publishing…':stats.changes===0?'Nothing new to publish':`Publish ${stats.changes} grade${stats.changes===1?'':'s'}`}</button></div></Dialog>;
}

function CellView({cell,kind,column,student,editing,value,problem,onType}:{cell?:GradebookCell;kind:string;column:string;student:string;editing:boolean;value?:string;problem?:string;onType:(v:string)=>void}){
  if(kind==='attendance'){
    if(!cell)return <span className="muted" title="No attendance session is recorded for this student's section on this date">n/a</span>;
    const status='attendance_status' in cell?cell.attendance_status:null;
    const points='attendance_points' in cell?cell.attendance_points:null;
    const label=status==='excused'?'Excused; excluded from attendance points':
      status?`${ATTENDANCE_LABEL[status]} · ${fmt(points)} points`:'Not marked';
    return <div className="cell"><span title={label}>{fmt(points)}</span></div>;
  }
  if(!cell||!('score' in cell))return <span className="muted" title="Does not apply to this student's section">n/a</span>;
  const state=kind==='online_quiz'&&cell.score===null?(cell.attempt_state==='in_progress'?'In progress':'Not attempted'):null;
  const shownValue=value??(cell.score===null?'':String(cell.score));
  return <div className="cell">
    {editing?<input className="score-input" inputMode="decimal" aria-label={`${column}, score for ${student}`} aria-invalid={!!problem} value={shownValue} placeholder="—" onChange={e=>onType(e.target.value)}/>
      :<span>{cell.score===null?'—':fmt(cell.score)}</span>}
    {problem&&<span className="error" role="alert"> {problem}</span>}
    {state&&<span className="muted" title={state==='Not attempted'?'No submitted attempt exists, so this online quiz has no automatically calculated score.':'The student has an active attempt that has not yet been submitted.'}> {state}</span>}
    {cell.unreleased_change&&<span className="badge"> Unreleased change</span>}</div>;
}

function ManualColumnAction({offeringId,policy,disabled,onCreated}:{offeringId:string;policy:Gradebook['policy'];disabled:boolean;onCreated:(period:string)=>Promise<void>}){
  const toast=useToast();
  const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [title,setTitle]=useState('');const [maxPoints,setMaxPoints]=useState('');
  const [categoryKey,setCategoryKey]=useState('');const [period,setPeriod]=useState('');
  const [position,setPosition]=useState<{top:number;left:number}|null>(null);
  const trigger=useRef<HTMLButtonElement>(null);const popover=useRef<HTMLDivElement>(null);
  const categories=policy.categories.filter(category=>category.key!=='attendance');
  const selectedCategory=categories.some(category=>category.key===categoryKey)?categoryKey:categories[0]?.key??'';
  const selectedPeriod=policy.periods.some(item=>item.key===period)?period:policy.periods[0]?.key??'';

  useEffect(()=>{
    if(!open)return;
    const closeOutside=(event:MouseEvent)=>{
      const target=event.target as Node;
      if(!popover.current?.contains(target)&&!trigger.current?.contains(target))setOpen(false);
    };
    const closeEscape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}
    };
    const closeOnScroll=(event:Event)=>{
      if(!(event.target instanceof Node)||!popover.current?.contains(event.target))setOpen(false);
    };
    document.addEventListener('mousedown',closeOutside);
    document.addEventListener('keydown',closeEscape);
    window.addEventListener('scroll',closeOnScroll,true);
    window.addEventListener('resize',closeOnScroll);
    return ()=>{
      document.removeEventListener('mousedown',closeOutside);
      document.removeEventListener('keydown',closeEscape);
      window.removeEventListener('scroll',closeOnScroll,true);
      window.removeEventListener('resize',closeOnScroll);
    };
  },[open]);

  function dismiss(){
    setOpen(false);
    trigger.current?.focus();
  }

  function toggle(){
    if(open){dismiss();return}
    const bounds=trigger.current?.getBoundingClientRect();
    if(!bounds)return;
    const width=Math.min(380,window.innerWidth-24);
    const height=Math.min(520,window.innerHeight*.8);
    const below=bounds.bottom+8;
    setPosition({
      top:below+height<=window.innerHeight-12?below:Math.max(12,bounds.top-height-8),
      left:Math.max(12,Math.min(bounds.left,window.innerWidth-width-12))
    });
    setError('');
    setOpen(true);
  }

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');setBusy(true);
    try{
      await post(`/teach/offerings/${offeringId}/gradebook/manual-columns`,{
        title:title.trim(),max_points:maxPoints,category_key:selectedCategory,period:selectedPeriod
      });
      setOpen(false);setTitle('');setMaxPoints('');
      await onCreated(selectedPeriod);
      toast('Manual grading column added. Use Edit scores to enter grades.');
      trigger.current?.focus();
    }catch(e){setError(errorText(e))}
    finally{setBusy(false)}
  }

  return <>
    <button ref={trigger} className="icon-button" type="button" aria-label="Add manual grade column"
      title={disabled?'This term is closed, so grade columns cannot be added.':'Add a manual grade column'}
      aria-haspopup="dialog" aria-expanded={open} aria-controls="manual-grade-column-popover"
      disabled={disabled} onClick={toggle}>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    </button>
    {open&&position&&createPortal(<div ref={popover} id="manual-grade-column-popover"
      className="gradebook-manual-column-popover" role="dialog" aria-labelledby="manual-grade-column-title"
      style={{top:position.top,left:position.left}}>
      <h3 id="manual-grade-column-title">Add manual grade column</h3>
      <form onSubmit={submit}>
        <label>Title<input autoFocus required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)}/></label>
        <label>Total score<input type="number" required min="0.01" max="100000" step="0.01" value={maxPoints} onChange={event=>setMaxPoints(event.target.value)}/></label>
        <label>Grading category<select required value={selectedCategory} onChange={event=>setCategoryKey(event.target.value)}>
          {categories.map(category=><option key={category.key} value={category.key}>{category.label}</option>)}
        </select></label>
        <label>Period<select required value={selectedPeriod} onChange={event=>setPeriod(event.target.value)}>
          {policy.periods.map(item=><option key={item.key} value={item.key}>{PERIOD_LABEL[item.key]??item.label}</option>)}
        </select></label>
        {categories.length===0&&<p className="muted">Add a non-attendance grading category to the syllabus policy first.</p>}
        {error&&<p role="alert">{error}</p>}
        <div className="actions"><button type="button" disabled={busy} onClick={dismiss}>Cancel</button>
          <button className="primary" disabled={busy||categories.length===0||policy.periods.length===0}>{busy?'Adding…':'Add column'}</button>
        </div>
      </form>
    </div>,document.body)}
  </>;
}

function GradeCell({row,period,onReview}:{row:GradeRow;period:string;onReview:(r:GradeRow)=>void}){
  const g=row.grades[period];const p=row.published[period];
  return <div className="cell">
    <strong>{g?.grade===null||g?.grade===undefined?'Pending':fmt(g.grade)}</strong>
    {p&&<><br/><span className="muted">Published {fmt(p.grade)} (v{p.release_number})</span>{p.needs_review&&<button className="badge linklike" onClick={()=>onReview(row)} aria-label={`Needs review: ${row.display_name}, open details`}>Needs review</button>}</>}</div>;
}

function DetailDialog({row,base,here,onClose}:{row:GradeRow;base:string;here:Origin;onClose:()=>void}){
  const flagged=Object.entries(row.published).filter(([,p])=>p.needs_review);
  return <Dialog title={`${row.display_name}: how the grade is calculated`} onClose={onClose} className="gradebook-detail-dialog">
    {flagged.length>0&&<div className="warn" role="status">{flagged.map(([k,p])=><p key={k}><strong>{PERIOD_LABEL[k]??k} needs review.</strong> Students see {fmt(p.grade)} (v{p.release_number}); the working grade is now {row.grades[k]?.grade==null?'pending':fmt(row.grades[k]?.grade)}. {p.review_reason??'Working data changed.'}</p>)}<p>Fix anything pending below (links beside each item), then close this and publish that period. Nothing changes for the student until you do.</p></div>}
    {Object.entries(row.grades).filter(([k])=>k!=='course').map(([period,g])=><section key={period}>
      <h3>{PERIOD_LABEL[period]??period}: {g.grade===null?'Pending':fmt(g.grade)}</h3>
      <ul>{g.categories.map(c=><li key={c.key}><strong>{c.label}</strong> ({c.weight}%): {c.status==='ok'?`${fmt(c.percent)}% (${fmt(c.earned)} of ${fmt(c.possible)})`:c.status==='pending'?`Pending: ${c.missing.join('; ')}`:c.missing.join('; ')}{c.status!=='ok'&&<> <Link to={c.key==='attendance'?`${base}/attendance`:`${base}/assessments`}>{c.key==='attendance'?'Open attendance':'Open assessments'}</Link></>}</li>)}</ul>
      {g.grade===null&&<p className="muted">The {PERIOD_LABEL[period]??period} grade cannot be republished until the pending items above are done.</p>}</section>)}
    <p className="muted">Course grade: {row.grades.course?.grade===null?'Pending (both periods must be ready)':fmt(row.grades.course?.grade)}</p>
    <div className="actions gradebook-detail-actions"><Link className="button" state={here} to={`${base}/students/${row.student_id}`}>Open full standing</Link><button className="primary" onClick={onClose}>Close</button></div></Dialog>;
}
