import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import type {OfferingSummary} from '../academics/types';
import {PERIOD_LABEL,type AttendanceSessionRow} from './types';

interface Roster{student_id:string;display_name:string;student_number:string}
const STATUS=[['present','Present'],['late','Late'],['absent','Absent'],['excused','Excused']] as const;
const iso=(d:Date)=>{const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`};
const parse=(v:string)=>{const [y,m,d]=v.split('-').map(Number);return new Date(y,m-1,d)};
const shift=(v:string,days:number)=>{const d=parse(v);d.setDate(d.getDate()+days);return iso(d)};
const addMonths=(v:string,n:number)=>{const d=parse(v);return iso(new Date(d.getFullYear(),d.getMonth()+n,1))};
const monday=(v:string)=>shift(v,-((parse(v).getDay()+6)%7));
const DAY=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const today=()=>{const d=new Date();const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`};

export function AttendancePage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const [sectionId,setSectionId]=useState(offering.sections[0]?.id??'');
  const [date,setDate]=useState(today());
  const [period,setPeriod]=useState<'midterm'|'finals'>('midterm');
  const [message,setMessage]=useState('');   // lives here: the register remounts after every save
  const [view,setView]=useState<'week'|'month'>('week');
  const register=useRef<HTMLDivElement>(null);
  const unsaved=useRef(false);   // the register reports here, so leaving a day with unsaved marks asks first
  const go=(change:()=>void)=>{if(unsaved.current&&!confirm('Discard the attendance marks you have not saved?'))return;unsaved.current=false;change()};
  const openDay=(d:string)=>go(()=>{setDate(d);setMessage('');requestAnimationFrame(()=>{register.current?.scrollIntoView({behavior:'smooth',block:'start'});register.current?.focus({preventScroll:true})})});
  const query=useQuery({queryKey:['attendance',offering.id,sectionId],enabled:!!sectionId,
    queryFn:()=>api<{sessions:AttendanceSessionRow[];roster:Roster[]}>(`/teach/offerings/${offering.id}/attendance?section_id=${sectionId}`)});
  if(offering.sections.length===0)return <section className="panel"><h2>No sections</h2><p>This subject has no sections yet.</p></section>;
  const sessions=query.data?.sessions??[];
  const existing=sessions.find(s=>s.date===date);
  const byDate=new Map(sessions.map(s=>[s.date,s]));
  const week=Array.from({length:7},(_,i)=>shift(monday(date),i));
  const monthStart=monday(iso(new Date(parse(date).getFullYear(),parse(date).getMonth(),1)));
  const monthCells=Array.from({length:42},(_,i)=>shift(monthStart,i)).filter((d,i)=>i<35||parse(d).getMonth()===parse(date).getMonth());
  const cells=view==='week'?week:monthCells;
  const total=query.data?.roster.length??0;
  return <>
    <div className="page-heading"><div><h2>Attendance</h2><p className="muted">Present counts fully, late counts as part of a day (set in your grading policy), absent counts zero, excused days are left out. A student you have not marked is pending, not absent.</p></div></div>
    <section className="panel"><div className="grid-2">
      <label>Section<select value={sectionId} onChange={e=>go(()=>setSectionId(e.target.value))}>{offering.sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Date<input type="date" value={date} onChange={e=>go(()=>setDate(e.target.value))}/></label></div>
      <label>Grading period<select value={existing?existing.period:period} disabled={!!existing} onChange={e=>setPeriod(e.target.value as 'midterm'|'finals')}><option value="midterm">Midterm</option><option value="finals">Finals</option></select></label>
      {existing&&<p className="muted">This day is already recorded under {PERIOD_LABEL[existing.period]}. Changing marks updates it.</p>}
    </section>
    <section className="panel" aria-labelledby="week-h"><div className="page-heading"><h3 id="week-h">{view==='week'?`Week of ${parse(week[0]).toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${parse(week[6]).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`:parse(date).toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h3>
      <div className="actions"><div className="tabs" role="group" aria-label="Calendar view">{(['week','month'] as const).map(v=><button key={v} className={view===v?'active':''} aria-pressed={view===v} onClick={()=>setView(v)}>{v==='week'?'Week':'Month'}</button>)}</div>
        <button onClick={()=>go(()=>setDate(view==='week'?shift(date,-7):addMonths(date,-1)))}>← Previous {view}</button><button onClick={()=>go(()=>setDate(today()))}>Today</button><button onClick={()=>go(()=>setDate(view==='week'?shift(date,7):addMonths(date,1)))}>Next {view} →</button></div></div>
      {view==='month'&&<div className="cal head" aria-hidden="true">{DAY.map(d=><span key={d}>{d}</span>)}</div>}
      <ul className={`cal${view==='month'?' month':''}`} aria-label={view==='week'?'Days of the week':'Days of the month'}>{cells.map(d=>{const rec=byDate.get(d);const marked=rec?Object.keys(rec.marks).length:0;const dow=(parse(d).getDay()+6)%7;
        return <li key={d} className={view==='month'&&parse(d).getMonth()!==parse(date).getMonth()?'other':undefined}><button aria-pressed={d===date} aria-label={`${DAY[dow]} ${parse(d).toLocaleDateString(undefined,{month:'long',day:'numeric'})}: ${rec?`recorded, ${marked} of ${total} marked`:'not recorded'}`} className={`${d===date?'on ':''}${d===today()?'today ':''}${rec?(marked<total?'partial':'full'):''}`} onClick={()=>openDay(d)}>
          {view==='week'&&<span>{DAY[dow]}</span>}<strong>{parse(d).getDate()}</strong><span className="muted">{rec?`${marked}/${total}`:'—'}</span></button></li>})}</ul>
      <p className="muted">Green underline: everyone marked. Amber: some students still not marked. Dashed outline: today.</p></section>
    {query.isPending?<p>Loading…</p>:query.error?<p role="alert">{query.error.message}</p>:
      <div ref={register} tabIndex={-1} aria-label="Attendance register" style={{outline:'none',scrollMarginTop:96}}><Register key={`${sectionId}|${date}|${existing?.id??'new'}|${query.dataUpdatedAt}`} offering={offering} sectionId={sectionId} date={date} period={existing?existing.period:period} roster={query.data.roster} initial={existing?.marks??{}} closed={offering.term_status==='closed'} setMessage={setMessage} unsaved={unsaved} sessionId={existing?.id}/></div>}
    {message&&<p role="status">{message}</p>}
  </>;
}

function Register({offering,sectionId,date,period,roster,initial,closed,setMessage,unsaved,sessionId}:{offering:OfferingSummary;sectionId:string;date:string;period:'midterm'|'finals';roster:Roster[];initial:Record<string,string>;closed:boolean;setMessage:(m:string)=>void;unsaved:MutableRefObject<boolean>;sessionId?:string}){
  const [marks,setMarks]=useState<Record<string,string>>(initial);
  async function save(){
    const cleared=Object.keys(initial).filter(id=>!marks[id]);          // a mark returned to "not marked"
    const body={section_id:sectionId,session_date:date,period,marks:{...Object.fromEntries(Object.entries(marks).filter(([,v])=>v)),...Object.fromEntries(cleared.map(id=>[id,null]))}};
    try{await send('PUT',`/teach/offerings/${offering.id}/attendance`,body);setMessage('Attendance saved.');queryClient.invalidateQueries({queryKey:['attendance',offering.id]});queryClient.invalidateQueries({queryKey:['gradebook',offering.id]})}
    catch(e){setMessage(errorText(e))}
  }
  async function remove(){
    if(!sessionId||!confirm(`Remove the attendance record for ${date}? Every mark for that day is deleted and the grade is recalculated.`))return;
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
