import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import {fmt,when,type AttemptDetail} from './types';

type Q=AttemptDetail['questions'][number];
export interface AttemptRef{id:string;attempt_number:number;state:string;score:number|null;max_score:number|null;submitted_at:string|null}

/** What happened on one question, in words as well as colour: right, wrong, partly right or not answered. */
export function verdict(q:Q):{key:'correct'|'partial'|'wrong'|'none';label:string}{
  const empty=q.response===null||q.response===undefined||q.response===''||(Array.isArray(q.response)&&q.response.length===0);
  const got=Number(q.awarded??0),worth=Number(q.points);
  if(empty&&got===0)return {key:'none',label:'— No answer'};
  if(got>=worth&&worth>0)return {key:'correct',label:'✓ Correct'};
  if(got>0)return {key:'partial',label:'◐ Partly correct'};
  return {key:'wrong',label:'✗ Wrong'};
}
export const VerdictBadge=({q}:{q:Q})=>{const v=verdict(q);return <span className={`verdict ${v.key}`}>{v.label}</span>};
export const answerText=(q:Q,v:unknown)=>v===null||v===undefined||v===''?'(no answer)':Array.isArray(v)?v.join(' / '):typeof v==='boolean'?(v?'True':'False'):String(q.choices.find(c=>c.id===v)?.text??v);

/** Read-only review of a student's attempt: the answer given beside the accepted answer, marked right or wrong. */
export function AttemptReview({base,attempts,studentName}:{base:string;attempts:AttemptRef[];studentName:string}){
  const reviewable=attempts.filter(a=>a.state==='submitted');
  const [chosen,setChosen]=useState(reviewable.length?reviewable[reviewable.length-1].id:'');
  const detail=useQuery({queryKey:['attempt-detail',chosen],enabled:!!chosen,queryFn:()=>api<AttemptDetail>(`${base}/attempts/${chosen}`)});
  if(reviewable.length===0)return <p className="muted">{studentName} has not submitted this quiz yet{attempts.length>0?' (an attempt is still in progress)':''}.</p>;
  const qs=detail.data?.questions??[];
  const right=qs.filter(q=>verdict(q).key==='correct').length;
  const current=reviewable.find(a=>a.id===chosen);
  return <>
    {reviewable.length>1&&<label>Attempt<select value={chosen} onChange={e=>setChosen(e.target.value)}>{reviewable.map(a=><option key={a.id} value={a.id}>Attempt {a.attempt_number}{a.submitted_at?` · ${when(a.submitted_at)}`:''} · {fmt(a.score)} / {fmt(a.max_score)}</option>)}</select></label>}
    {detail.isPending?<p>Loading…</p>:detail.error?<p role="alert">{detail.error.message}</p>:<>
      <p role="status"><strong>{right} of {qs.length} correct</strong>{current&&<> · score {fmt(current.score)} / {fmt(current.max_score)}</>}</p>
      {qs.map((q,i)=><article className={`subpanel review ${verdict(q).key}`} key={q.key}>
        <p><strong>{i+1}. {q.prompt}</strong> <span className="muted">({q.points} pt{q.points===1?'':'s'})</span></p>
        <p><VerdictBadge q={q}/> Answered: <strong>{answerText(q,q.response)}</strong> <span className="muted">· {fmt(q.awarded)} of {q.points} awarded</span></p>
        {verdict(q).key!=='correct'&&<p className="muted">Accepted answer: {answerText(q,q.correct)}</p>}
        {q.correction_reason&&<p className="muted">Your correction: {q.correction_reason}</p>}</article>)}</>}
  </>;
}
