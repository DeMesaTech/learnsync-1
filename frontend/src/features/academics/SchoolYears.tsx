import {useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,post,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {useConfirm} from '../../components/confirm';
import type {SchoolYear,Term} from './types';

export function SchoolYears(){
  const ask=useConfirm();
  const years=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const [creating,setCreating]=useState(false);
  const [reopening,setReopening]=useState<Term|null>(null);
  const [message,setMessage]=useState('');
  const allTerms=years.data?.flatMap(y=>y.terms.map(t=>({...t,label:`${y.label} · ${t.name}`})))??[];
  const termCount=years.data?.reduce((count,year)=>count+year.terms.length,0)??0;
  const openTermCount=years.data?.reduce((count,year)=>
    count+year.terms.filter(term=>term.status==='open').length,0)??0;

  async function close(term:Term){
    if(!await ask({title:`Close ${term.name}?`,message:'Teaching records become read-only until it is reopened.',yes:'Close term',danger:true}))return;
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
              <article><span className="settings-overview-icon" aria-hidden="true">●</span><div><strong>{openTermCount}</strong><span>Open for changes</span></div></article>
            </section>
            {years.data.length===0?<section className="settings-empty panel">
              <span className="settings-empty-icon" aria-hidden="true">▦</span>
              <h3>No school years configured</h3>
              <p className="muted">Create a school year to set its dates and prepare the first two semesters.</p>
              <button className="primary" onClick={()=>{setMessage('');setCreating(true)}}>Create school year</button>
            </section>:<div className="settings-years">
              {years.data.map(year=>{
                const openCount=year.terms.filter(term=>term.status==='open').length;
                return <section className="settings-year-card" key={year.id}>
                  <header className="settings-year-header">
                    <span className="settings-year-icon" aria-hidden="true">▦</span>
                    <div className="settings-year-title"><p className="eyebrow">SCHOOL YEAR</p><h3>{year.label}</h3>
                      <p className="muted">{year.start_date} <span aria-hidden="true">→</span> {year.end_date}</p></div>
                    <span className="settings-year-summary">{openCount} of {year.terms.length} semesters open</span>
                  </header>
                  <div className="settings-terms">{year.terms.map(term=><article className="settings-term-card" key={term.id}>
                    <div className="settings-term-top">
                      <div><p className="eyebrow">SEMESTER {term.sequence}</p><h4>{term.name}</h4></div>
                      <span className={`badge ${term.status}`}>{term.status==='open'?'Open':'Closed'}</span>
                    </div>
                    <p className="settings-term-dates">{term.start_date}<span aria-hidden="true">→</span>{term.end_date}</p>
                    <div className="settings-term-links">
                      <Link to="/admin/students">Student management</Link>
                      <Link to="/admin/offerings">Faculty Management</Link>
                    </div>
                    <div className="settings-term-actions">
                      {term.status==='open'
                        ?<button type="button" onClick={()=>close(term)}>Close semester</button>
                        :<button type="button" onClick={()=>{setMessage('');setReopening(term)}}>Reopen semester</button>}
                    </div>
                  </article>)}</div>
                </section>;
              })}
            </div>}
            <p className="settings-calendar-help"><strong>About semester status</strong>
              <span>Open semesters can be edited. Closing one makes its teaching and academic records read-only; reopening requires a reason and is recorded in audit history.</span></p>
          </>}
      </div>
    </div>
    {creating&&<NewYear terms={allTerms} onClose={()=>setCreating(false)} onDone={()=>{setCreating(false);setMessage('School year created.');queryClient.invalidateQueries({queryKey:['school-years']})}}/>}
    {reopening&&<Dialog title={`Reopen ${reopening.name}`} onClose={()=>setReopening(null)}>
      <p>Reopening allows changes to a closed term. The reason is kept in the audit history.</p>
      <form onSubmit={async(e:FormEvent<HTMLFormElement>)=>{
        e.preventDefault();const reason=new FormData(e.currentTarget).get('reason');
        try{await post(`/terms/${reopening.id}/reopen`,{reason});setReopening(null);setMessage('Term reopened.');queryClient.invalidateQueries({queryKey:['school-years']})}
        catch(err){setMessage(errorText(err))}}}>
        <label>Reason<textarea name="reason" required minLength={3} maxLength={1000}/></label>
        {message&&<p role="alert">{message}</p>}
        <div className="actions"><button type="button" onClick={()=>setReopening(null)}>Cancel</button><button className="primary">Reopen term</button></div>
      </form>
    </Dialog>}
  </>;
}

interface TermDraft{name:string;sequence:number;start_date:string;end_date:string;copy_from_term_id:string;copy_offerings:boolean}
const semesterName=(n:number)=>['1st','2nd','3rd','4th','5th','6th'][n-1]??`${n}th`;
const blankTerms:TermDraft[]=[
  {name:`${semesterName(1)} semester`,sequence:1,start_date:'',end_date:'',copy_from_term_id:'',copy_offerings:false},
  {name:`${semesterName(2)} semester`,sequence:2,start_date:'',end_date:'',copy_from_term_id:'',copy_offerings:false},
];

const day=(ms:number)=>new Date(ms).toISOString().slice(0,10);
// ponytail: splits the year at its midpoint; the admin adjusts to the real calendar
function splitYear(start:string,end:string,draft:TermDraft[]){
  const a=Date.parse(start),z=Date.parse(end);if(!(a<z))return draft;
  const mid=a+Math.floor((z-a)/2/864e5)*864e5;
  return draft.map((t,i)=>({...t,start_date:t.start_date||(i?day(mid+864e5):start),end_date:t.end_date||(i?end:day(mid))}));
}

function NewYear({terms,onClose,onDone}:{terms:{id:string;label:string}[];onClose:()=>void;onDone:()=>void}){
  const [draft,setDraft]=useState(blankTerms);
  const [error,setError]=useState('');
  const patch=(i:number,change:Partial<TermDraft>)=>setDraft(draft.map((t,j)=>j===i?{...t,...change}:t));
  const yearDates=(e:React.ChangeEvent<HTMLInputElement>)=>{const f=new FormData(e.currentTarget.form!);
    setDraft(d=>splitYear(String(f.get('start_date')),String(f.get('end_date')),d))};
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{
      await post('/school-years',{label:f.get('label'),start_date:f.get('start_date'),end_date:f.get('end_date'),
        terms:draft.map(t=>({...t,copy_from_term_id:t.copy_from_term_id||null}))});
      onDone();
    }catch(err){setError(errorText(err))}
  }
  return <Dialog title="New school year" onClose={onClose}>
    <form onSubmit={submit}>
      <label>Label<input name="label" required maxLength={30} placeholder="2027-2028"/></label>
      <div className="grid-2"><label>Starts<input name="start_date" type="date" required onChange={yearDates}/></label><label>Ends<input name="end_date" type="date" required onChange={yearDates}/></label></div>
      {draft.map((t,i)=><fieldset key={i}><legend>{t.name}</legend>
        <div className="grid-2">
          <label>Starts<input type="date" required value={t.start_date} onChange={e=>patch(i,{start_date:e.target.value})}/></label>
          <label>Ends<input type="date" required value={t.end_date} onChange={e=>patch(i,{end_date:e.target.value})}/></label>
        </div>
        {terms.length>0&&<label>Copy sections from (optional)
          <select value={t.copy_from_term_id} onChange={e=>patch(i,{copy_from_term_id:e.target.value})}>
            <option value="">Start empty</option>{terms.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
          </select></label>}
        {t.copy_from_term_id&&<label className="inline"><input type="checkbox" checked={t.copy_offerings} onChange={e=>patch(i,{copy_offerings:e.target.checked})}/> Also copy subject assignments (review the teachers afterwards)</label>}
      </fieldset>)}
      <p className="muted">Copying never brings students; enroll them in the new term.</p>
      {error&&<p role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Create school year</button></div>
    </form>
  </Dialog>;
}
