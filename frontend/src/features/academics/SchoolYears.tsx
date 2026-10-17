import {useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {ApiError,api,post,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {useConfirm} from '../../components/confirm';
import type {SchoolYear,Term} from './types';

export function SchoolYears(){
  const ask=useConfirm();
  const years=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const [creating,setCreating]=useState(false);
  const [message,setMessage]=useState('');
  const termCount=years.data?.reduce((count,year)=>count+year.terms.length,0)??0;
  const activeTermCount=years.data?.reduce((count,year)=>
    count+year.terms.filter(term=>term.status==='active').length,0)??0;

  async function transition(term:Term,action:'schedule'|'activate'){
    try{await post(`/terms/${term.id}/${action}`,{});setMessage(action==='schedule'?'Semester scheduled.':'Semester activated.');queryClient.invalidateQueries({queryKey:['school-years']})}
    catch(e){setMessage(errorText(e))}
  }

  async function close(term:Term){
    if(!await ask({title:`Close ${term.name}?`,message:'Academic records become read-only. Normal reopening is not available.',yes:'Close term',danger:true}))return;
    try{await post(`/terms/${term.id}/close`,{});setMessage('Term closed.');queryClient.invalidateQueries({queryKey:['school-years']})}
    catch(e){setMessage(errorText(e))}
  }
  return <>
    <div className="settings-page-heading">
      <div className="settings-page-mark" aria-hidden="true">⚙</div>
      <div><p className="eyebrow">Administration</p><h1>Settings</h1>
        <p className="muted">Configure the academic year and the structure used across LearnSync.</p></div>
    </div>
    <div className="settings-layout">
      <aside className="settings-navigation">
        <p className="settings-navigation-title">Institution</p>
        <nav aria-label="Settings sections">
          <Link className="settings-nav-link active" to="/admin/settings" aria-current="page">
            <span aria-hidden="true">▦</span><span><strong>Academic calendar</strong><small>School years and semesters</small></span>
          </Link>
          <Link className="settings-nav-link" to="/admin/subjects">
            <span aria-hidden="true">▤</span><span><strong>Prospectus</strong><small>Subjects and placements</small></span>
          </Link>
          <Link className="settings-nav-link" to="/admin/students">
            <span aria-hidden="true">◫</span><span><strong>Students and sections</strong><small>Enrollment and rosters</small></span>
          </Link>
          <Link className="settings-nav-link" to="/admin/offerings">
            <span aria-hidden="true">☷</span><span><strong>Faculty assignments</strong><small>Teacher assignments</small></span>
          </Link>
          <Link className="settings-nav-link" to="/account">
            <span aria-hidden="true">○</span><span><strong>Account and theme</strong><small>Your profile preferences</small></span>
          </Link>
        </nav>
        <div className="settings-navigation-note">
          <strong>Academic setup</strong>
          <p>Changes here affect the terms where students and teachers work.</p>
        </div>
      </aside>
      <div className="settings-main">
        <section className="settings-section-heading">
          <div><p className="eyebrow">ACADEMIC CALENDAR</p><h2>School years and semesters</h2>
            <p className="muted">Create yearly calendars, prepare semesters, and control when academic records can be changed.</p></div>
          <button className="primary" onClick={()=>{setMessage('');setCreating(true)}}>＋ New school year</button>
        </section>
        {message&&<p role="status" className="settings-message">{message}</p>}
        {years.isPending?<section className="panel settings-empty">Loading school-year settings…</section>
          :years.error?<section className="panel settings-empty"><p role="alert">{years.error.message}</p></section>
          :<>
            <section className="settings-overview" aria-label="Academic calendar overview">
              <article><span className="settings-overview-icon" aria-hidden="true">▦</span><div><strong>{years.data.length}</strong><span>School years</span></div></article>
              <article><span className="settings-overview-icon" aria-hidden="true">◷</span><div><strong>{termCount}</strong><span>Semesters</span></div></article>
              <article><span className="settings-overview-icon" aria-hidden="true">●</span><div><strong>{activeTermCount}</strong><span>Active semesters</span></div></article>
            </section>
            {years.data.length===0?<section className="settings-empty panel">
              <span className="settings-empty-icon" aria-hidden="true">▦</span>
              <h3>No school years configured</h3>
              <p className="muted">Create a school year to set its dates and prepare the first two semesters.</p>
              <button className="primary" onClick={()=>{setMessage('');setCreating(true)}}>Create school year</button>
            </section>:<div className="settings-years">
              {years.data.map(year=>{
                const activeCount=year.terms.filter(term=>term.status==='active').length;
                return <section className="settings-year-card" key={year.id}>
                  <header className="settings-year-header">
                    <span className="settings-year-icon" aria-hidden="true">▦</span>
                    <div className="settings-year-title"><p className="eyebrow">SCHOOL YEAR</p><h3>{year.label}</h3>
                      <p className="muted">{year.start_date} <span aria-hidden="true">→</span> {year.end_date}</p></div>
                    <span className="settings-year-summary">{activeCount} of {year.terms.length} semesters active</span>
                  </header>
                  <div className="settings-terms">{year.terms.map(term=><article className="settings-term-card" key={term.id}>
                    <div className="settings-term-top">
                      <div><p className="eyebrow">SEMESTER {term.sequence}</p><h4>{term.name}</h4></div>
                      <span className={`badge ${term.status}`}>{statusLabel(term.status)}</span>
                    </div>
                    <p className="settings-term-dates">{term.start_date}<span aria-hidden="true">→</span>{term.end_date}</p>
                    <div className="settings-term-links">
                      <Link to="/admin/students">Student management</Link>
                      <Link to="/admin/offerings">Faculty Management</Link>
                    </div>
                    <div className="settings-term-actions">
                      {term.status==='draft'&&<button type="button" onClick={()=>transition(term,'schedule')}>Schedule semester</button>}
                      {term.status==='scheduled'&&<button type="button" onClick={()=>transition(term,'activate')}>Activate semester</button>}
                      {term.status==='active'&&<button type="button" onClick={()=>close(term)}>Close semester</button>}
                    </div>
                  </article>)}</div>
                </section>;
              })}
            </div>}
            <p className="settings-calendar-help"><strong>About semester status</strong>
              <span>Drafts are for calendar setup. Scheduled, inactive, and archived semesters are read-only. Only one semester can be active; close it before activating the next one.</span></p>
          </>}
      </div>
    </div>
    {creating&&<NewYear onClose={()=>setCreating(false)} onDone={()=>{setCreating(false);setMessage('School year created.');queryClient.invalidateQueries({queryKey:['school-years']})}}/>}
  </>;
}

interface TermDraft{name:string;sequence:number;start_date:string;end_date:string}
const statusLabel=(status:Term['status'])=>({draft:'Draft',scheduled:'Scheduled',active:'Active',inactive:'Inactive / closed',archived:'Archived'}[status]);
const semesterName=(n:number)=>['1st','2nd','3rd','4th','5th','6th'][n-1]??`${n}th`;
const blankTerms:TermDraft[]=[
  {name:`${semesterName(1)} semester`,sequence:1,start_date:'',end_date:''},
  {name:`${semesterName(2)} semester`,sequence:2,start_date:'',end_date:''},
];

const day=(ms:number)=>new Date(ms).toISOString().slice(0,10);
// ponytail: splits the year at its midpoint; the admin adjusts to the real calendar
function splitYear(start:string,end:string,draft:TermDraft[]){
  const a=Date.parse(start),z=Date.parse(end);if(!(a<z))return draft;
  const mid=a+Math.floor((z-a)/2/864e5)*864e5;
  return draft.map((t,i)=>({...t,start_date:t.start_date||(i?day(mid+864e5):start),end_date:t.end_date||(i?end:day(mid))}));
}

function NewYear({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){
  const [draft,setDraft]=useState(blankTerms);
  const [startYear,setStartYear]=useState(()=>new Date().getFullYear()+1);
  const [error,setError]=useState('');
  const patch=(i:number,change:Partial<TermDraft>)=>setDraft(current=>current.map((term,j)=>j===i?{...term,...change}:term));
  const yearDates=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const form=e.currentTarget.form;
    if(!form)return;
    const values=new FormData(form);
    const start=String(values.get('start_date')??'');
    const end=String(values.get('end_date')??'');
    if(start)setStartYear(Number(start.slice(0,4)));
    setDraft(current=>splitYear(start,end,current));
  };
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const form=new FormData(e.currentTarget);
    try{
      await post('/school-years',{label:`${startYear}-${startYear+1}`,start_date:form.get('start_date'),end_date:form.get('end_date'),
        terms:draft});
      onDone();
    }catch(err){
      const fields=err instanceof ApiError?Object.entries(err.fields).map(([field,text])=>field?`${field}: ${text}`:text).join(' '):'';
      setError(fields||errorText(err));
    }
  }
  return <Dialog title="New school year" onClose={onClose}>
    <form onSubmit={submit}>
      <label>Starting year<input type="number" min={2000} max={9998} step={1} value={startYear}
        onChange={e=>setStartYear(Number(e.target.value)||2000)}/></label>
      <p className="muted">School year: {startYear}–{startYear+1}</p>
      <div className="grid-2"><label>Starts<input name="start_date" type="date" required onChange={yearDates}/></label><label>Ends<input name="end_date" type="date" required onChange={yearDates}/></label></div>
      {draft.map((term,index)=><fieldset key={index}><legend>{term.name}</legend>
        <div className="grid-2">
          <label>Starts<input type="date" required value={term.start_date} onChange={e=>patch(index,{start_date:e.target.value})}/></label>
          <label>Ends<input type="date" required value={term.end_date} onChange={e=>patch(index,{end_date:e.target.value})}/></label>
        </div>
      </fieldset>)}
      {error&&<p role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Create school year</button></div>
    </form>
  </Dialog>;
}
