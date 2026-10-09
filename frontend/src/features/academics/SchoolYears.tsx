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

  async function close(term:Term){
    if(!await ask({title:`Close ${term.name}?`,message:'Teaching records become read-only until it is reopened.',yes:'Close term',danger:true}))return;
    try{await post(`/terms/${term.id}/close`,{});setMessage('Term closed.');queryClient.invalidateQueries({queryKey:['school-years']})}
    catch(e){setMessage(errorText(e))}
  }
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Administration</p><h1>School years and terms</h1>
        <p className="muted">Open a term to set up sections, offerings and enrollment. A term marked “open” can be edited; its dates show the academic period, so you can prepare the next semester ahead.</p></div>
      <button className="primary" onClick={()=>{setMessage('');setCreating(true)}}>New school year</button>
    </div>
    {message&&<p role="status">{message}</p>}
    {years.isPending?<p>Loading…</p>:years.error?<p role="alert">{years.error.message}</p>:
      years.data.length===0?<section className="panel"><h2>No school year yet</h2><p>Create the first school year to begin.</p></section>:
      years.data.map(year=><section className="panel" key={year.id}>
        <h2>{year.label}</h2><p className="muted">{year.start_date} to {year.end_date}</p>
        <div className="cards">{year.terms.map(term=><article className="subpanel" key={term.id}>
          <div><h3>{term.name}</h3>
            <p className="muted">{term.start_date} to {term.end_date}</p>
            <span className={`badge ${term.status}`}>{term.status}</span></div>
          <div className="actions">
            <Link className="button primary" to={`/admin/terms/${term.id}`}>Open workspace</Link>
            {term.status==='open'
              ?<button onClick={()=>close(term)}>Close term</button>
              :<button onClick={()=>{setMessage('');setReopening(term)}}>Reopen</button>}
          </div>
        </article>)}</div>
      </section>)}
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
