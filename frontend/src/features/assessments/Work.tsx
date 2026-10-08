import {ClassworkTypes} from '../../components/ClassworkTypes';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,useLocation,useNavigate,useOutletContext,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {ApiError,api,post,send,upload,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {celebrate} from '../../components/celebrate';
import {useConfirm} from '../../components/confirm';
import {useToast} from '../../components/undo';
import {useOrigin} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {fmt,when,type AttemptView,type LearnItem} from './types';

const STATE_LABEL:Record<string,string>={available:'Ready',in_progress:'In progress',not_open:'Not open yet',done:'Finished',closed:'Closed',submitted:'Submitted',resubmit:'Submitted · you can replace it'};

function useWork(offeringId:string){
  return useQuery({queryKey:['learn-work',offeringId],queryFn:()=>api<LearnItem[]>(`/learn/offerings/${offeringId}/assessments`)});
}

export function WorkList(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const query=useWork(offering.id);
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  if(query.data.length===0)return <section className="panel"><h2>No quizzes or activities yet</h2><p>Published quizzes and activities appear here.</p></section>;
  const first=query.data.find(i=>i.bucket==='todo');   // sorted by deadline, so this is the nearest
  return <>{SECTIONS.map(([bucket,heading,hint])=>{
    const list=query.data.filter(i=>i.bucket===bucket);if(list.length===0)return null;
    return <section key={bucket} aria-labelledby={`w-${bucket}`}><h3 id={`w-${bucket}`}>{heading} <span className="muted">({list.length})</span></h3>{hint&&<p className="muted">{hint}</p>}
      <ul className="seq">{list.map(i=><li key={i.id} className={i===first?'next':undefined}>
        <span className="grow"><Link to={`/student/offerings/${offering.id}/work/${i.id}`}>{i.title}</Link><span className="muted">{i.kind==='online_quiz'?'Quiz':'Activity'} · {detail(i)}</span>
          {i.result&&<span className="muted"><strong>Your result: {fmt(i.result.score)} / {fmt(i.result.max_points)}</strong></span>}</span>
        {i===first&&<span className="badge next">Up next</span>}
        {i.state==='in_progress'&&<span className="badge">In progress</span>}
        {i.late_allowed&&<span className="badge warn">Late submission allowed</span>}</li>)}</ul></section>})}</>;
}

const SECTIONS:[string,string,string][]=[['todo','To do','Earliest deadline first.'],['again','Another attempt available',''],['upcoming','Upcoming','Not open yet.'],['awaiting','Submitted · awaiting feedback',''],['done','Completed',''],['closed','Closed','No longer open and nothing was submitted.']];

export function detail(i:LearnItem){
  const due=i.deadline?`${i.late_allowed?'was due':'due'} ${when(i.deadline)}`:'no deadline';
  const left=i.max_attempts!==undefined?Math.max(i.max_attempts-(i.attempts_used??0),0):0;
  switch(i.bucket){
    case 'upcoming':return `opens ${when(i.available_from)}${i.deadline?` · due ${when(i.deadline)}`:''}`;
    case 'again':return `${i.attempts_used} of ${i.max_attempts} attempts used · ${left} left`;
    case 'awaiting':return i.state==='resubmit'?'submitted · you can replace it':'submitted';
    case 'done':return i.kind==='online_quiz'?`finished · ${i.attempts_used} of ${i.max_attempts} attempt${i.max_attempts===1?'':'s'} used`:'submitted';
    case 'closed':return `closed · ${due}`;
    default:return i.kind==='online_quiz'&&i.max_attempts!==undefined?`${due} · attempt ${Math.min((i.attempts_used??0)+(i.state==='in_progress'?0:1),i.max_attempts)} of ${i.max_attempts}`:due;
  }
}

export function WorkDetail(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const {assessmentId}=useParams();
  const query=useWork(offering.id);
  const navigate=useNavigate();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const base=`/student/offerings/${offering.id}/work`;
  const origin=useOrigin(`/student/offerings/${offering.id}/classwork`,'Classwork');const carried=useLocation().state;const toast=useToast();
  if(query.isPending)return <p>Loading…</p>;
  const item=query.data?.find(i=>i.id===assessmentId);
  if(!item)return <section className="panel"><h2>Not available</h2><Link to={`/student/offerings/${offering.id}/classwork`}>Back to classwork</Link></section>;

  async function startQuiz(){
    setBusy(true);setMessage('');
    try{const attempt=await post<AttemptView>(`/learn/offerings/${offering.id}/assessments/${item!.id}/attempts`,{});navigate(`${base}/${item!.id}/attempts/${attempt.id}`,{state:carried})}
    catch(e){setMessage(errorText(e));query.refetch()}finally{setBusy(false)}
  }
  async function submitFile(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage('');
    const form=new FormData(e.currentTarget);   // read before awaiting
    setBusy(true);
    try{await upload(`/learn/offerings/${offering.id}/assessments/${item!.id}/submissions`,form);setMessage('Submitted. Your teacher can see it now.');toast('Submitted. Your teacher can see it now.');await query.refetch()}
    catch(err){setMessage(errorText(err))}finally{setBusy(false)}
  }
  return <>
    <ClassworkTypes base={`/student/offerings/${offering.id}`} current={item.kind==='online_quiz'?'quiz':'activity'}/>
    <p className="back"><Link to={origin.to}>← Back to {origin.label}</Link></p>
    <section className="panel"><p className="eyebrow">{item.kind==='online_quiz'?'Quiz':'Activity'} · {STATE_LABEL[item.state]??item.state}</p><h2>{item.title}</h2>
      {item.instructions&&<p className="pre">{item.instructions}</p>}
      <p className="muted">{item.available_from?`Opens ${when(item.available_from)}. `:''}{item.deadline?`Due ${when(item.deadline)}.${item.allow_late?' Late work is accepted.':''}`:'No deadline.'} Worth {fmt(item.max_points)} points.</p>
      {item.result&&<p role="status"><strong>Released result: {fmt(item.result.score)} / {fmt(item.result.max_points)}</strong>{item.result.feedback&&<><br/>{item.result.feedback}</>}</p>}
      {message&&<p role="status">{message}</p>}
      {item.kind==='online_quiz'&&<>
        <p className="muted">Attempts used: {item.attempts_used??0} of {item.max_attempts}. Your answers are saved as you go.</p>
        {(item.state==='available'||item.state==='in_progress')&&<button className="primary" disabled={busy} onClick={startQuiz}>{item.state==='in_progress'?'Continue your attempt':'Start the quiz'}</button>}
        {item.state==='not_open'&&<p>This quiz has not opened yet.</p>}{item.state==='closed'&&<p>The deadline has passed.</p>}{item.state==='done'&&<p>You have used all your attempts.</p>}</>}
      {item.kind==='activity'&&<>
        {item.state==='not_open'&&<p>This activity has not opened yet.</p>}
        {item.can_submit?<form onSubmit={submitFile}><label>{item.submissions?.length?'Replace your submission with a new PDF':'Upload your work as a PDF'} (up to 20 MB)<input name="file" type="file" accept=".pdf,application/pdf" required/></label>
          <label>Note for your teacher (optional)<textarea name="note" maxLength={2000}/></label>
          {item.would_be_late&&<p className="warn" role="status">The deadline has passed. This will be marked late.</p>}
          <button className="primary" disabled={busy}>{busy?'Uploading…':'Submit'}</button></form>
          :item.state!=='not_open'&&<p className="warn" role="status">{item.submissions?.length?'The deadline has passed, so your submission can no longer be replaced. Ask your teacher if you need to change it.':'The deadline has passed. Ask your teacher if you still need to submit.'}</p>}
        {item.submissions&&item.submissions.length>0&&<><h3>Your submissions</h3>
          <ul>{[...item.submissions].reverse().map(s=><li key={s.version}>Version {s.version} · {when(s.submitted_at)}{s.is_late?' · late':''} · <a className="touch" href={`/api/files/${s.file.id}/download`}>{s.file.name}</a>{s.note&&<span className="muted"> — {s.note}</span>}</li>)}</ul></>}</>}
    </section></>;
}

const keyFor=(attemptId:string)=>{
  try{const k=`learnsync:submit-key:${attemptId}`;const found=sessionStorage.getItem(k);if(found)return found;const fresh=crypto.randomUUID();sessionStorage.setItem(k,fresh);return fresh}
  catch{return crypto.randomUUID()}
};

export function AttemptPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const {assessmentId,attemptId}=useParams();
  const base=`/student/offerings/${offering.id}/work`;
  const url=`/learn/offerings/${offering.id}/attempts/${attemptId}`;
  const query=useQuery({queryKey:['attempt',attemptId],queryFn:()=>api<AttemptView>(url),staleTime:Infinity});
  if(query.isPending)return <p>Loading your attempt…</p>;
  if(query.error||!query.data)return <section className="panel"><h2>Attempt not available</h2><p role="alert">{query.error?.message}</p><Link to={`${base}/${assessmentId}`}>Back to the quiz</Link></section>;
  if(query.data.state==='submitted')return <Finished attempt={query.data} back={`${base}/${assessmentId}`}/>;
  return <Taking offering={offering} attempt={query.data} url={url} back={`${base}/${assessmentId}`}/>;
}

function Finished({attempt,back}:{attempt:AttemptView;back:string}){
  const carried=useLocation().state;
  return <section className="panel"><h2>Quiz submitted</h2>
    <p role="status"><strong>Your score for attempt {attempt.attempt_number}: {fmt(attempt.score)} / {fmt(attempt.max_score)}</strong></p>
    {attempt.answers_ignored&&<p className="warn" role="status">The deadline had passed when you submitted, so only the answers you had already saved before it were scored.</p>}
    <p className="muted">The correct answers are not shown.</p><Link className="button primary" to={back} state={carried}>Back to the quiz</Link></section>;
}

type SaveState='saved'|'saving'|'unsaved'|'failed';

function Taking({offering,attempt,url,back}:{offering:OfferingSummary;attempt:AttemptView;url:string;back:string}){
  const ask=useConfirm();const toast=useToast();
  const carriedState=useLocation().state;
  const [answers,setAnswers]=useState<Record<string,unknown>>(attempt.answers);
  const [state,setState]=useState<SaveState>('saved');
  const [message,setMessage]=useState('');
  const [done,setDone]=useState<AttemptView|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const latest=useRef(answers);const dirty=useRef(false);const timer=useRef<ReturnType<typeof setTimeout>>(undefined);const running=useRef<Promise<boolean>|null>(null);
  const submitKey=useRef(keyFor(attempt.id));

  const save=async():Promise<boolean>=>{
    if(running.current)return running.current;
    if(!dirty.current)return true;
    setState('saving');
    const sent=latest.current;
    const attemptSave=(async()=>{
      try{
        await send('PUT',`${url}/answers`,{answers:sent});
        if(latest.current===sent)dirty.current=false;
        setState(dirty.current?'unsaved':'saved');
        if(dirty.current){clearTimeout(timer.current);timer.current=setTimeout(()=>void save(),300)}   // typed while saving
        return !dirty.current;
      }
      catch(e){
        if(e instanceof ApiError&&['attempt_closed','term_closed','closed'].includes(e.code)){setMessage(e.message);setState('failed');dirty.current=false;return true}
        setState('failed');return false;
      }finally{running.current=null}
    })();
    running.current=attemptSave;return attemptSave;
  };
  const change=(key:string,value:unknown)=>{
    const next={...latest.current,[key]:value};latest.current=next;dirty.current=true;setAnswers(next);setState('unsaved');
    clearTimeout(timer.current);timer.current=setTimeout(()=>void save(),1200);
  };
  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{if(dirty.current)e.preventDefault()};
    addEventListener('beforeunload',warn);
    return()=>{removeEventListener('beforeunload',warn);clearTimeout(timer.current)};
  },[]);

  async function submit(){
    if(!await ask({title:'Submit your answers?',message:'You cannot change them afterwards.',yes:'Submit answers'}))return;
    setSubmitting(true);setMessage('');clearTimeout(timer.current);
    if(running.current)await running.current;
    try{
      const result=await post<AttemptView>(`${url}/submit`,{idempotency_key:submitKey.current,answers:latest.current});
      dirty.current=false;queryClient.setQueryData(['attempt',attempt.id],result);queryClient.invalidateQueries({queryKey:['learn-work',offering.id]});queryClient.invalidateQueries({queryKey:['learn-results',offering.id]});setDone(result);celebrate();toast('Quiz submitted.');
    }catch(e){
      setMessage(e instanceof ApiError&&['term_closed','closed','attempt_closed'].includes(e.code)?`${e.message} Your saved answers were kept.`:`${errorText(e)} Your answers are still here. Try submitting again.`);
    }finally{setSubmitting(false)}
  }
  if(done)return <Finished attempt={done} back={back}/>;
  const saveText={saved:'All answers saved',saving:'Saving…',unsaved:'Saving soon…',failed:'Could not save. Check your connection; your answers are still on this page.'}[state];
  return <>
    <p className="back"><Link to={back} state={carriedState}>← Back to the quiz</Link></p>
    <div className="page-heading"><h2>Attempt {attempt.attempt_number}</h2><span className={`badge save-${state==='saved'?'saved':state==='failed'?'failed':'dirty'}`} role="status" aria-live="polite">{saveText}</span></div>
    {message&&<p className="warn" role="alert">{message}</p>}
    {state==='failed'&&<button onClick={()=>void save()}>Retry saving</button>}
    <form onSubmit={e=>{e.preventDefault();void submit()}}>
      {attempt.questions.map((q,i)=><fieldset className="panel" key={q.key}>
        <legend>Question {i+1} · {q.points} point{q.points===1?'':'s'}</legend>
        <p className="pre">{q.prompt}</p>
        {q.type==='multiple_choice'&&q.choices.map(c=><label className="inline" key={c.id}><input type="radio" name={q.key} checked={answers[q.key]===c.id} onChange={()=>change(q.key,c.id)}/> {c.text}</label>)}
        {q.type==='true_false'&&[true,false].map(v=><label className="inline" key={String(v)}><input type="radio" name={q.key} checked={answers[q.key]===v} onChange={()=>change(q.key,v)}/> {v?'True':'False'}</label>)}
        {q.type==='short_answer'&&<label>Your answer<input value={typeof answers[q.key]==='string'?String(answers[q.key]):''} maxLength={1000} onChange={e=>change(q.key,e.target.value)}/></label>}
      </fieldset>)}
      <div className="actions"><button className="primary" disabled={submitting}>{submitting?'Submitting…':'Submit answers'}</button></div></form>
  </>;
}
