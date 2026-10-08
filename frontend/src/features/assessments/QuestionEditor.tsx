import {useRef} from 'react';
import {useUndo} from '../../components/undo';
import {newId} from '../teaching/types';
import type {Question,QType} from './types';

const move=<T,>(list:T[],i:number,by:number)=>{const j=i+by;if(j<0||j>=list.length)return list;const c=[...list];[c[i],c[j]]=[c[j],c[i]];return c};

export function blankQuestion(type:QType='multiple_choice'):Question{
  if(type==='true_false')return {key:newId(),type,prompt:'',choices:[],correct:true,explanation:'',points:1};
  if(type==='short_answer')return {key:newId(),type,prompt:'',choices:[],correct:[''],explanation:'',points:1};
  const choices=[1,2,3,4].map(()=>({id:newId(),text:''}));
  return {key:newId(),type,prompt:'',choices,correct:choices[0].id,explanation:'',points:1};
}

/** locked: students already started attempts, so keys, points and question identity cannot change. */
export function QuestionList({questions,onChange,locked}:{questions:Question[];onChange:(q:Question[])=>void;locked:boolean}){
  const undo=useUndo();const latest=useRef(onChange);latest.current=onChange;   // undo must reach the CURRENT draft, not the one at removal time
  const set=(i:number,q:Question)=>onChange(questions.map((x,j)=>j===i?q:x));
  return <section>
    <h2>Questions</h2>
    {locked&&<p className="warn" role="status">Students have already started this quiz, so the questions, answer keys, points, attempt limit and score rule are locked. You can still fix wording and explanations, the instructions and the deadline.</p>}
    {questions.length===0&&<p className="panel">No questions yet. Add the first one below.</p>}
    {questions.map((q,i)=><article className="panel" key={q.key}>
      <div className="page-heading"><h3>Question {i+1} · {Number(q.points)||0} pt{Number(q.points)===1?'':'s'}</h3>
        {!locked&&<div className="actions">
          <button type="button" aria-label={`Move question ${i+1} up`} disabled={i===0} onClick={()=>onChange(move(questions,i,-1))}>↑</button>
          <button type="button" aria-label={`Move question ${i+1} down`} disabled={i===questions.length-1} onClick={()=>onChange(move(questions,i,1))}>↓</button>
          <button type="button" onClick={()=>{const before=questions;onChange(questions.filter((_,j)=>j!==i));undo(`Question ${i+1} removed.`,()=>latest.current(before))}}>Remove</button></div>}</div>
      {q.source&&<p className="muted">Drafted from: <strong>{q.source.title}</strong>. Check the answer against that material.</p>}
      <div className="grid-2">
        <label>Type<select value={q.type} disabled={locked} onChange={e=>set(i,{...blankQuestion(e.target.value as QType),key:q.key,prompt:q.prompt,points:q.points,explanation:q.explanation,source:q.source})}>
          <option value="multiple_choice">Multiple choice</option><option value="true_false">True / False</option><option value="short_answer">Short answer</option></select></label>
        <label>Points<input type="number" min="0" step="0.5" value={q.points} disabled={locked} onChange={e=>set(i,{...q,points:e.target.value})}/></label></div>
      <label>Question<textarea value={q.prompt} maxLength={5000} onChange={e=>set(i,{...q,prompt:e.target.value})}/></label>
      {q.type==='multiple_choice'&&<fieldset><legend>Choices (select the correct one)</legend>
        {q.choices.map((c,j)=><div className="topic-row" key={c.id}>
          <input type="radio" aria-label={`Choice ${j+1} is correct`} name={`correct-${q.key}`} checked={q.correct===c.id} disabled={locked} onChange={()=>set(i,{...q,correct:c.id})}/>
          <input aria-label={`Choice ${j+1} text`} value={c.text} maxLength={500} onChange={e=>set(i,{...q,choices:q.choices.map((x,k)=>k===j?{...x,text:e.target.value}:x)})}/>
          {!locked&&q.choices.length>2&&<button type="button" aria-label={`Remove choice ${j+1}`} onClick={()=>set(i,{...q,choices:q.choices.filter((_,k)=>k!==j),correct:q.correct===c.id?q.choices.find((_,k)=>k!==j)!.id:q.correct})}>✕</button>}</div>)}
        {!locked&&q.choices.length<6&&<button type="button" onClick={()=>set(i,{...q,choices:[...q.choices,{id:newId(),text:''}]})}>Add choice</button>}</fieldset>}
      {q.type==='true_false'&&<fieldset><legend>Correct answer</legend>
        {[true,false].map(v=><label className="inline" key={String(v)}><input type="radio" name={`tf-${q.key}`} checked={q.correct===v} disabled={locked} onChange={()=>set(i,{...q,correct:v})}/> {v?'True':'False'}</label>)}</fieldset>}
      {q.type==='short_answer'&&<fieldset><legend>Accepted answers</legend>
        <p className="muted">Matching ignores capital letters and extra spaces. It is not fuzzy: list every wording you accept. You can correct individual answers later.</p>
        {(Array.isArray(q.correct)?q.correct:[]).map((ans,j,all)=><div className="topic-row" key={j}>
          <input aria-label={`Accepted answer ${j+1}`} value={ans} maxLength={500} disabled={locked} onChange={e=>set(i,{...q,correct:all.map((x,k)=>k===j?e.target.value:x)})}/>
          {!locked&&all.length>1&&<button type="button" aria-label={`Remove accepted answer ${j+1}`} onClick={()=>set(i,{...q,correct:all.filter((_,k)=>k!==j)})}>✕</button>}</div>)}
        {!locked&&<button type="button" onClick={()=>set(i,{...q,correct:[...(Array.isArray(q.correct)?q.correct:[]),'']})}>Add accepted answer</button>}</fieldset>}
      <label>Explanation (private: students never see it)<textarea value={q.explanation} maxLength={5000} onChange={e=>set(i,{...q,explanation:e.target.value})}/></label>
    </article>)}
    {!locked&&<div className="actions"><button type="button" onClick={()=>onChange([...questions,blankQuestion('multiple_choice')])}>Add multiple choice</button>
      <button type="button" onClick={()=>onChange([...questions,blankQuestion('true_false')])}>Add true / false</button>
      <button type="button" onClick={()=>onChange([...questions,blankQuestion('short_answer')])}>Add short answer</button></div>}
  </section>;
}
