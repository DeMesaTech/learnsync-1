import {useEffect,useRef,useState,type KeyboardEvent,type MutableRefObject} from 'react';
import {useOutletContext} from 'react-router-dom';
import {useQuery,type UseQueryResult} from '@tanstack/react-query';
import {api,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {useConfirm} from '../../components/confirm';
import type {OfferingSummary} from '../academics/types';
import {useFlushOnLeave,type SaveStatus} from '../teaching/autosave';
import {PERIOD_LABEL,type AttendanceSessionRow} from './types';

interface Roster{student_id:string;display_name:string;student_number:string}
type Data={sessions:AttendanceSessionRow[];roster:Roster[]};
type Mode='grid'|'day';
type Status='present'|'late'|'absent'|'excused';
type Period='midterm'|'finals';
const STATUS=[['present','Present'],['late','Late'],['absent','Absent'],['excused','Excused']] as const;
const SHORT:Record<Status,string>={present:'P',late:'L',absent:'A',excused:'E'};
const LABEL:Record<Status,string>={present:'Present',late:'Late',absent:'Absent',excused:'Excused'};
const CYCLE:(Status|null)[]=[null,'present','late','absent','excused'];
const KEYS:Record<string,Status>={p:'present',l:'late',a:'absent',e:'excused'};
const iso=(d:Date)=>{const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`};
const parse=(v:string)=>{const [y,m,d]=v.split('-').map(Number);return new Date(y,m-1,d)};
const shift=(v:string,days:number)=>{const d=parse(v);d.setDate(d.getDate()+days);return iso(d)};
const addMonths=(v:string,n:number)=>{const d=parse(v);return iso(new Date(d.getFullYear(),d.getMonth()+n,1))};
const monday=(v:string)=>shift(v,-((parse(v).getDay()+6)%7));
const DAY=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const today=()=>iso(new Date());
const dayOf=(d:string)=>(parse(d).getDay()+6)%7;                    // Monday = 0
const pretty=(d:string)=>parse(d).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});

function ModeToggle({mode,onChange}:{mode:Mode;onChange:(m:Mode)=>void}){
  return <div className="tabs" role="group" aria-label="Attendance view">{(['grid','day'] as const).map(m=>
    <button key={m} className={mode===m?'active':''} aria-pressed={mode===m} onClick={()=>onChange(m)}>{m==='grid'?'Grid':'One day'}</button>)}</div>;
}

export function AttendancePage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const [sectionId,setSectionId]=useState(offering.sections[0]?.id??'');
  const [mode,setMode]=useState<Mode>(()=>window.matchMedia('(min-width:768px)').matches?'grid':'day');   // a grid needs room; phones start with one day
  const query=useQuery({queryKey:['attendance',offering.id,sectionId],enabled:!!sectionId,
    queryFn:()=>api<Data>(`/teach/offerings/${offering.id}/attendance?section_id=${sectionId}`)});
  if(offering.sections.length===0)return <section className="panel"><h2>No sections</h2><p>This subject has no sections yet.</p></section>;
  const props={offering,sectionId,setSectionId,query,setMode};
  return <>
    <div className="page-heading"><div><h2>Attendance</h2><p className="muted">Present counts fully, late counts as part of a day (set in your grading policy), absent counts zero, excused days are left out. A student you have not marked is pending, not absent.</p></div></div>
    {mode==='grid'?<GridView {...props}/>:<DayView {...props}/>}
  </>;
}

interface ViewProps{offering:OfferingSummary;sectionId:string;setSectionId:(id:string)=>void;query:UseQueryResult<Data>;setMode:(m:Mode)=>void}

/** Students down, dates across. Each change is saved on its own (debounced per date); a failed save is flagged with Retry. */
function GridView({offering,sectionId,setSectionId,query,setMode}:ViewProps){
  const closed=offering.term_status==='closed';
  const [view,setView]=useState<'week'|'month'>('week');
  const [anchor,setAnchor]=useState(today());
  const [added,setAdded]=useState<string[]>([]);
  const [addDate,setAddDate]=useState(today());
  const [edits,setEdits]=useState<Record<string,Record<string,Status|null>>>({});     // typed but not yet confirmed saved
  const [periods,setPeriods]=useState<Record<string,Period>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [saving,setSaving]=useState(0);
  const [active,setActive]=useState({r:0,c:0});
  const [classDays,setClassDays]=useState(offering.meeting_days??0);
  const [note,setNote]=useState('');
  const pending=useRef<Record<string,Record<string,Status|null>>>({});
  const timers=useRef<Record<string,number>>({});
  const table=useRef<HTMLTableElement>(null);

  const sessions=query.data?.sessions??[];const roster=query.data?.roster??[];
  const byDate=new Map(sessions.map(s=>[s.date,s]));
  const first=view==='week'?monday(anchor):iso(new Date(parse(anchor).getFullYear(),parse(anchor).getMonth(),1));
  const last=view==='week'?shift(first,6):iso(new Date(parse(anchor).getFullYear(),parse(anchor).getMonth()+1,0));
  const span:string[]=[];for(let d=first;d<=last;d=shift(d,1))span.push(d);
  const meeting=offering.meeting_days??0;
  const dates=span.filter(d=>byDate.has(d)||(meeting&(1<<dayOf(d)))!==0||added.includes(d));
  const nearest=(d:string):Period=>{
    const before=[...sessions].filter(s=>s.date<d).sort((a,b)=>a.date<b.date?1:-1)[0];
    const after=[...sessions].filter(s=>s.date>d).sort((a,b)=>a.date<b.date?-1:1)[0];
    return (before??after)?.period??'midterm'};
  const periodOf=(d:string):Period=>byDate.get(d)?.period??periods[d]??nearest(d);
  const valueOf=(d:string,s:string):Status|null=>{const e=edits[d]?.[s];return e!==undefined?e:((byDate.get(d)?.marks[s] as Status|undefined)??null)};
  const unsaved=Object.values(edits).reduce((n,e)=>n+Object.keys(e).length,0);
  const status:SaveStatus=unsaved===0?'saved':saving>0?'saving':Object.keys(errors).length>0?'failed':'dirty';

  async function flush(d:string){
    const marks=pending.current[d];
    if(!marks||Object.keys(marks).length===0)return;
    pending.current[d]={};setSaving(n=>n+1);
    try{
      await send('PUT',`/teach/offerings/${offering.id}/attendance`,{section_id:sectionId,session_date:d,period:periodOf(d),marks});
      setErrors(p=>{const n={...p};delete n[d];return n});
      await Promise.all([queryClient.invalidateQueries({queryKey:['attendance',offering.id]}),queryClient.invalidateQueries({queryKey:['gradebook',offering.id]})]);
      setEdits(p=>{const n={...p};const cur={...n[d]};for(const s of Object.keys(marks)){if(cur[s]===marks[s])delete cur[s]}
        if(Object.keys(cur).length>0)n[d]=cur;else delete n[d];return n});
    }catch(e){pending.current[d]={...marks,...pending.current[d]};setErrors(p=>({...p,[d]:errorText(e)}))}
    finally{setSaving(n=>n-1)}
  }
  async function flushAll():Promise<boolean>{
    for(const d of Object.keys(timers.current))window.clearTimeout(timers.current[d]);
    await Promise.all(Object.keys(pending.current).map(flush));
    return Object.values(pending.current).every(m=>Object.keys(m).length===0);
  }
  useFlushOnLeave(status,flushAll);
  useEffect(()=>()=>{for(const d of Object.keys(timers.current))window.clearTimeout(timers.current[d])},[]);

  function setMarks(d:string,changes:Record<string,Status|null>){
    if(closed)return;
    setEdits(p=>({...p,[d]:{...p[d],...changes}}));
    pending.current[d]={...pending.current[d],...changes};
    window.clearTimeout(timers.current[d]);
    timers.current[d]=window.setTimeout(()=>void flush(d),600);
  }
  const markRest=(d:string)=>setMarks(d,Object.fromEntries(roster.filter(r=>valueOf(d,r.student_id)===null).map(r=>[r.student_id,'present' as Status])));

  function move(r:number,c:number){
    const rr=Math.max(0,Math.min(roster.length-1,r)),cc=Math.max(0,Math.min(dates.length-1,c));
    setActive({r:rr,c:cc});
    table.current?.querySelector<HTMLButtonElement>(`[data-r="${rr}"][data-c="${cc}"]`)?.focus();
  }
  function onKey(e:KeyboardEvent<HTMLButtonElement>,r:number,c:number,d:string,s:string){
    const arrows:Record<string,[number,number]>={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
    if(arrows[e.key]){e.preventDefault();move(r+arrows[e.key][0],c+arrows[e.key][1]);return}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const k=KEYS[e.key.toLowerCase()];
    if(k){e.preventDefault();setMarks(d,{[s]:k});move(r+1,c)}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();setMarks(d,{[s]:null});move(r+1,c)}
  }
  const cycle=(d:string,s:string)=>{const now=valueOf(d,s);setMarks(d,{[s]:CYCLE[(CYCLE.indexOf(now)+1)%CYCLE.length]})};
  async function saveDays(){
    setNote('');
    try{await send('PUT',`/teach/offerings/${offering.id}/schedule`,{meeting_days:classDays});await queryClient.invalidateQueries({queryKey:['offering']});setNote('Class days saved.')}
    catch(e){setNote(errorText(e))}
  }
  const go=(change:()=>void)=>{void flushAll().then(change)};
  const title=view==='week'?`Week of ${parse(first).toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${parse(last).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`:parse(anchor).toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const step=(n:number)=>go(()=>setAnchor(view==='week'?shift(anchor,7*n):addMonths(anchor,n)));

  return <>
    <section className="panel"><div className="page-heading"><h3>{title}</h3>
      <div className="actions"><ModeToggle mode="grid" onChange={m=>go(()=>setMode(m))}/>
        <div className="tabs" role="group" aria-label="Grid range">{(['week','month'] as const).map(v=><button key={v} className={view===v?'active':''} aria-pressed={view===v} onClick={()=>go(()=>setView(v))}>{v==='week'?'Week':'Month'}</button>)}</div>
        <button onClick={()=>step(-1)}>← Previous</button><button onClick={()=>go(()=>setAnchor(today()))}>Today</button><button onClick={()=>step(1)}>Next →</button></div></div>
      {offering.sections.length>1&&<label>Section<select value={sectionId} onChange={e=>go(()=>setSectionId(e.target.value))}>{offering.sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <details className="more"><summary>Dates and class days</summary>
        <div className="actions"><label>Add a date<input type="date" value={addDate} onChange={e=>setAddDate(e.target.value)}/></label>
          <button disabled={!addDate} onClick={()=>{setAdded(a=>a.includes(addDate)?a:[...a,addDate]);setAnchor(addDate)}}>Add date</button></div>
        <fieldset><legend>Class days (the grid shows these dates)</legend><div className="chips">{DAY.map((n,i)=><label className="inline" key={n}><input type="checkbox" checked={(classDays&(1<<i))!==0} onChange={e=>setClassDays(e.target.checked?classDays|(1<<i):classDays&~(1<<i))}/> {n}</label>)}</div>
          <button disabled={classDays===(offering.meeting_days??0)} onClick={saveDays}>Save class days</button></fieldset>
        {note&&<p role="status">{note}</p>}</details>
      <p role="status" className="muted">{closed?'This term is closed, so attendance is read-only.':status==='saved'?'All changes saved.':status==='saving'?'Saving…':status==='failed'?`${unsaved} change${unsaved===1?'':'s'} not saved. Use Retry below.`:'Saving in a moment…'}</p>
      {Object.entries(errors).map(([d,m])=><p key={d} role="alert" className="error">{pretty(d)}: {m} <button onClick={()=>void flush(d)}>Retry</button></p>)}
    </section>
    {query.isPending?<p>Loading…</p>:query.error?<p role="alert">{query.error.message}</p>:roster.length===0?<section className="panel"><p className="muted">No students are enrolled through this section.</p></section>:
      dates.length===0?<section className="panel"><h3>No class days in this {view}</h3><p className="muted">Set the class days above, or add a date to start taking attendance.</p></section>:
      <section className="panel"><div className="table-wrap" role="region" aria-label="Attendance grid, scrolls sideways" tabIndex={0}>
        <table className="att-grid" ref={table}><caption className="sr-only">Attendance: students down, dates across. Use the arrow keys to move between cells, then P, L, A or E to mark and Delete to clear. Enter or Space changes the status.</caption>
          <thead><tr><th scope="col" className="sticky">Student</th>{dates.map(d=>{const rec=byDate.get(d);const marked=roster.filter(r=>valueOf(d,r.student_id)!==null).length;
            return <th scope="col" key={d}><div className="att-head"><strong>{DAY[dayOf(d)]} {parse(d).getDate()}</strong>
              {rec?<span className="muted">{PERIOD_LABEL[rec.period]}</span>
                :<select aria-label={`Grading period for ${pretty(d)}`} value={periodOf(d)} disabled={closed} onChange={e=>setPeriods(p=>({...p,[d]:e.target.value as Period}))}><option value="midterm">Midterm</option><option value="finals">Finals</option></select>}
              <span className="muted">{marked}/{roster.length} marked</span>
              <button disabled={closed||marked===roster.length} onClick={()=>markRest(d)}>Mark rest present</button>
              {added.includes(d)&&!rec&&<button className="linklike" onClick={()=>setAdded(a=>a.filter(x=>x!==d))}>Hide</button>}</div></th>})}</tr></thead>
          <tbody>{roster.map((r,ri)=><tr key={r.student_id}><th scope="row" className="sticky">{r.display_name}<br/><span className="muted">{r.student_number}</span></th>
            {dates.map((d,ci)=>{const v=valueOf(d,r.student_id);const failed=!!errors[d]&&edits[d]?.[r.student_id]!==undefined;
              return <td key={d}><button type="button" className={`att-cell ${v??'none'}${failed?' err':''}`} data-r={ri} data-c={ci} tabIndex={active.r===ri&&active.c===ci?0:-1} disabled={closed}
                aria-label={`${r.display_name}, ${pretty(d)}: ${v?LABEL[v]:'not marked'}${failed?' (not saved)':''}`}
                onFocus={()=>setActive({r:ri,c:ci})} onClick={()=>cycle(d,r.student_id)} onKeyDown={e=>onKey(e,ri,ci,d,r.student_id)}>{v?SHORT[v]:'·'}</button></td>})}</tr>)}</tbody></table></div>
        <p className="muted">P present · L late · A absent · E excused · · not marked. Click a cell to cycle, or focus it and type P, L, A, E (Delete clears). Each change is saved by itself.</p></section>}
  </>;
}

/** The original one-day register: quick roll call, and a place to remove a recorded day. */
function DayView({offering,sectionId,setSectionId,query,setMode}:ViewProps){
  const ask=useConfirm();
  const [date,setDate]=useState(today());
  const [period,setPeriod]=useState<Period>('midterm');
  const [message,setMessage]=useState('');   // lives here: the register remounts after every save
  const [view,setView]=useState<'week'|'month'>('week');
  const register=useRef<HTMLDivElement>(null);
  const unsaved=useRef(false);   // the register reports here, so leaving a day with unsaved marks asks first
  const go=async(change:()=>void)=>{if(unsaved.current&&!await ask({title:'Discard unsaved marks?',message:'The attendance marks you have not saved will be lost.',yes:'Discard marks',danger:true}))return;unsaved.current=false;change()};
  const openDay=(d:string)=>go(()=>{setDate(d);setMessage('');requestAnimationFrame(()=>{register.current?.scrollIntoView({behavior:'smooth',block:'start'});register.current?.focus({preventScroll:true})})});
  const sessions=query.data?.sessions??[];
  const existing=sessions.find(s=>s.date===date);
  const byDate=new Map(sessions.map(s=>[s.date,s]));
  const week=Array.from({length:7},(_,i)=>shift(monday(date),i));
  const monthStart=monday(iso(new Date(parse(date).getFullYear(),parse(date).getMonth(),1)));
  const monthCells=Array.from({length:42},(_,i)=>shift(monthStart,i)).filter((d,i)=>i<35||parse(d).getMonth()===parse(date).getMonth());
  const cells=view==='week'?week:monthCells;
  const total=query.data?.roster.length??0;
  return <>
    <section className="panel"><div className="page-heading"><h3>One day</h3><div className="actions"><ModeToggle mode="day" onChange={m=>go(()=>setMode(m))}/></div></div>
      <div className="grid-2">
      <label>Section<select value={sectionId} onChange={e=>go(()=>setSectionId(e.target.value))}>{offering.sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Date<input type="date" value={date} onChange={e=>go(()=>setDate(e.target.value))}/></label></div>
      <label>Grading period<select value={existing?existing.period:period} disabled={!!existing} onChange={e=>setPeriod(e.target.value as Period)}><option value="midterm">Midterm</option><option value="finals">Finals</option></select></label>
      {existing&&<p className="muted">This day is already recorded under {PERIOD_LABEL[existing.period]}. Changing marks updates it.</p>}
    </section>
    <section className="panel" aria-labelledby="week-h"><div className="page-heading"><h3 id="week-h">{view==='week'?`Week of ${parse(week[0]).toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${parse(week[6]).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`:parse(date).toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h3>
      <div className="actions"><div className="tabs" role="group" aria-label="Calendar view">{(['week','month'] as const).map(v=><button key={v} className={view===v?'active':''} aria-pressed={view===v} onClick={()=>setView(v)}>{v==='week'?'Week':'Month'}</button>)}</div>
        <button onClick={()=>go(()=>setDate(view==='week'?shift(date,-7):addMonths(date,-1)))}>← Previous {view}</button><button onClick={()=>go(()=>setDate(today()))}>Today</button><button onClick={()=>go(()=>setDate(view==='week'?shift(date,7):addMonths(date,1)))}>Next {view} →</button></div></div>
      {view==='month'&&<div className="cal head" aria-hidden="true">{DAY.map(d=><span key={d}>{d}</span>)}</div>}
      <ul className={`cal${view==='month'?' month':''}`} aria-label={view==='week'?'Days of the week':'Days of the month'}>{cells.map(d=>{const rec=byDate.get(d);const marked=rec?Object.keys(rec.marks).length:0;const dow=dayOf(d);
        return <li key={d} className={view==='month'&&parse(d).getMonth()!==parse(date).getMonth()?'other':undefined}><button aria-pressed={d===date} aria-label={`${DAY[dow]} ${parse(d).toLocaleDateString(undefined,{month:'long',day:'numeric'})}: ${rec?`recorded, ${marked} of ${total} marked`:'not recorded'}`} className={`${d===date?'on ':''}${d===today()?'today ':''}${rec?(marked<total?'partial':'full'):''}`} onClick={()=>openDay(d)}>
          {view==='week'&&<span>{DAY[dow]}</span>}<strong>{parse(d).getDate()}</strong><span className="muted">{rec?`${marked}/${total}`:'—'}</span></button></li>})}</ul>
      <p className="muted">Green underline: everyone marked. Amber: some students still not marked. Dashed outline: today.</p></section>
    {query.isPending?<p>Loading…</p>:query.error?<p role="alert">{query.error.message}</p>:
      <div ref={register} tabIndex={-1} aria-label="Attendance register" style={{outline:'none',scrollMarginTop:96}}><Register key={`${sectionId}|${date}|${existing?.id??'new'}|${query.dataUpdatedAt}`} offering={offering} sectionId={sectionId} date={date} period={existing?existing.period:period} roster={query.data.roster} initial={existing?.marks??{}} closed={offering.term_status==='closed'} setMessage={setMessage} unsaved={unsaved} sessionId={existing?.id}/></div>}
    {message&&<p role="status">{message}</p>}
  </>;
}

function Register({offering,sectionId,date,period,roster,initial,closed,setMessage,unsaved,sessionId}:{offering:OfferingSummary;sectionId:string;date:string;period:'midterm'|'finals';roster:Roster[];initial:Record<string,string>;closed:boolean;setMessage:(m:string)=>void;unsaved:MutableRefObject<boolean>;sessionId?:string}){
  const ask=useConfirm();
  const [marks,setMarks]=useState<Record<string,string>>(initial);
  async function save(){
    const cleared=Object.keys(initial).filter(id=>!marks[id]);          // a mark returned to "not marked"
    const body={section_id:sectionId,session_date:date,period,marks:{...Object.fromEntries(Object.entries(marks).filter(([,v])=>v)),...Object.fromEntries(cleared.map(id=>[id,null]))}};
    try{await send('PUT',`/teach/offerings/${offering.id}/attendance`,body);setMessage('Attendance saved.');queryClient.invalidateQueries({queryKey:['attendance',offering.id]});queryClient.invalidateQueries({queryKey:['gradebook',offering.id]})}
    catch(e){setMessage(errorText(e))}
  }
  async function remove(){
    if(!sessionId)return;
    if(!await ask({title:`Remove the record for ${date}?`,message:'Every mark for that day is deleted and the grade is recalculated.',yes:'Remove record',danger:true}))return;
    try{await send('DELETE',`/teach/offerings/${offering.id}/attendance/${sessionId}`);setMessage(`The record for ${date} was removed.`);queryClient.invalidateQueries({queryKey:['attendance',offering.id]});queryClient.invalidateQueries({queryKey:['gradebook',offering.id]})}
    catch(e){setMessage(errorText(e))}
  }
  const dirty=JSON.stringify(Object.entries(marks).filter(([,v])=>v).sort())!==JSON.stringify(Object.entries(initial).filter(([,v])=>v).sort());
  useEffect(()=>{unsaved.current=dirty;return()=>{unsaved.current=false}},[dirty,unsaved]);
  if(roster.length===0)return <section className="panel"><p className="muted">No students are enrolled through this section.</p></section>;
  const count=(v:string)=>roster.filter(r=>(marks[r.student_id]??'')===v).length;
  return <section className="panel"><div className="page-heading"><h3>Mark attendance for {date}</h3>
    <div className="actions"><button disabled={closed} onClick={()=>setMarks(Object.fromEntries(roster.map(r=>[r.student_id,'present'])))}>Mark everyone present</button>
      <button disabled={closed} onClick={()=>setMarks({...marks,...Object.fromEntries(roster.filter(r=>!marks[r.student_id]).map(r=>[r.student_id,'present']))})}>Mark unmarked as present</button></div></div>
    <p role="status" className="muted">{count('present')} present · {count('late')} late · {count('absent')} absent · {count('excused')} excused · <strong>{count('')} not marked</strong>{dirty?' · unsaved changes':''}</p>
    <div className="table-wrap" role="region" aria-label="Attendance register" tabIndex={0}><table><thead><tr><th>Student</th><th>Status</th></tr></thead>
      <tbody>{roster.map(r=><tr key={r.student_id}><td>{r.display_name}<br/><span className="muted">{r.student_number}</span></td>
        <td><fieldset className="seg" disabled={closed}><legend className="sr-only">Attendance for {r.display_name}</legend>
          {STATUS.map(([v,l])=><label key={v} className={marks[r.student_id]===v?`on ${v}`:''}><input type="radio" name={`m-${r.student_id}`} checked={marks[r.student_id]===v} onChange={()=>setMarks({...marks,[r.student_id]:v})}/>{l}</label>)}
          {marks[r.student_id]&&!closed&&<button type="button" className="linklike" onClick={()=>setMarks({...marks,[r.student_id]:''})} aria-label={`Clear mark for ${r.display_name}`}>Clear</button>}</fieldset></td></tr>)}</tbody></table></div>
    <div className="actions sticky-bar"><button className="primary" disabled={closed||!dirty} onClick={save}>Save attendance</button>{sessionId&&<button disabled={closed} onClick={remove}>Remove this day’s record</button>}{dirty&&<span className="muted">You have unsaved changes.</span>}</div></section>;
}
