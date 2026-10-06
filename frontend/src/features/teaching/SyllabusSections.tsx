import {emptyChapter,newId,type Chapter,type Course,type GradingPolicy,type Outline} from './types';

type Change<T>=(next:T)=>void;
const move=<T,>(list:T[],i:number,by:number)=>{const j=i+by;if(j<0||j>=list.length)return list;const copy=[...list];[copy[i],copy[j]]=[copy[j],copy[i]];return copy};
const replace=<T,>(list:T[],i:number,item:T)=>list.map((x,j)=>j===i?item:x);
const remove=<T,>(list:T[],i:number)=>list.filter((_,j)=>j!==i);

export function CourseStep({outline,onChange}:{outline:Outline;onChange:Change<Outline>}){
  const c=outline.course;const set=(patch:Partial<Course>)=>onChange({...outline,course:{...c,...patch}});
  const text=(k:keyof Course,label:string,max:number)=><label>{label}<textarea value={c[k]} maxLength={max} onChange={e=>set({[k]:e.target.value})}/></label>;
  return <section className="panel"><h2>Course information</h2>
    <div className="grid-2"><label>Course code<input value={c.code} maxLength={60} onChange={e=>set({code:e.target.value})}/></label>
      <label>Course name<input value={c.name} maxLength={300} onChange={e=>set({name:e.target.value})} required/></label>
      <label>Credit units<input value={c.units} maxLength={10} onChange={e=>set({units:e.target.value})}/></label>
      <label>Contact hours<input value={c.contact_hours} maxLength={60} onChange={e=>set({contact_hours:e.target.value})}/></label></div>
    <label>Pre-requisite<input value={c.prerequisite} maxLength={300} onChange={e=>set({prerequisite:e.target.value})}/></label>
    {text('description','Course description',5000)}{text('values','Values integration',1000)}
    {text('requirements','Classroom requirements',5000)}{text('references','References',10000)}
    {text('evaluation_note','Course evaluation (as written in your syllabus)',3000)}
    <p className="muted">The evaluation text is informational. Set the weights used for grading in the Grading step.</p>
  </section>;
}

export function OutcomesStep({outline,onChange}:{outline:Outline;onChange:Change<Outline>}){
  const set=(outcomes:Outline['outcomes'])=>onChange({...outline,outcomes});
  return <section className="panel"><h2>Course learning outcomes</h2>
    {outline.outcomes.length===0&&<p className="muted">No outcomes yet.</p>}
    {outline.outcomes.map((o,i)=><div className="edit-line" key={o.id}>
      <label>Outcome {i+1}<textarea value={o.text} maxLength={1000} onChange={e=>set(replace(outline.outcomes,i,{...o,text:e.target.value}))}/></label>
      <div className="actions"><button type="button" aria-label={`Move outcome ${i+1} up`} disabled={i===0} onClick={()=>set(move(outline.outcomes,i,-1))}>↑</button>
        <button type="button" aria-label={`Move outcome ${i+1} down`} disabled={i===outline.outcomes.length-1} onClick={()=>set(move(outline.outcomes,i,1))}>↓</button>
        <button type="button" onClick={()=>set(remove(outline.outcomes,i))}>Remove</button></div></div>)}
    <button type="button" onClick={()=>set([...outline.outcomes,{id:newId(),text:''}])}>Add outcome</button></section>;
}

export function ChaptersStep({outline,onChange}:{outline:Outline;onChange:Change<Outline>}){
  const set=(chapters:Chapter[])=>onChange({...outline,chapters});
  const patch=(i:number,change:Partial<Chapter>)=>set(replace(outline.chapters,i,{...outline.chapters[i],...change}));
  return <section><h2>Course coverage</h2>
    <p className="muted">Chapters and topics keep a stable identity when you rename or reorder them, so lessons attached to a topic stay attached.</p>
    {outline.chapters.length===0&&<p className="panel">No chapters yet. Add the first one below.</p>}
    {outline.chapters.map((c,i)=><article className="panel" key={c.id}>
      <div className="page-heading"><h3>{c.kind==='exam'?'Examination':'Chapter'} {i+1}</h3>
        <div className="actions"><button type="button" aria-label={`Move chapter ${i+1} up`} disabled={i===0} onClick={()=>set(move(outline.chapters,i,-1))}>↑</button>
          <button type="button" aria-label={`Move chapter ${i+1} down`} disabled={i===outline.chapters.length-1} onClick={()=>set(move(outline.chapters,i,1))}>↓</button>
          <button type="button" onClick={()=>{if(confirm('Remove this chapter and its topics? Lessons attached to them must be re-attached or archived before publishing.'))set(remove(outline.chapters,i))}}>Remove</button></div></div>
      <div className="grid-2"><label>Title<input value={c.title} maxLength={300} onChange={e=>patch(i,{title:e.target.value})}/></label>
        <label>Time allotment<input value={c.weeks} maxLength={60} placeholder="Week 2" onChange={e=>patch(i,{weeks:e.target.value})}/></label>
        <label>Type<select value={c.kind} onChange={e=>patch(i,{kind:e.target.value as Chapter['kind']})}><option value="chapter">Chapter</option><option value="exam">Examination</option></select></label></div>
      <label>Intended learning outcomes<textarea value={c.ilo} maxLength={3000} onChange={e=>patch(i,{ilo:e.target.value})}/></label>
      <label>Teaching and learning activities<textarea value={c.activities} maxLength={3000} onChange={e=>patch(i,{activities:e.target.value})}/></label>
      <label>Assessment tasks<textarea value={c.assessment} maxLength={3000} onChange={e=>patch(i,{assessment:e.target.value})}/></label>
      <fieldset><legend>Topics</legend>
        {c.topics.map((t,j)=><div className="topic-row" key={t.id}>
          <input aria-label={`Topic ${j+1} of chapter ${i+1}`} value={t.title} maxLength={300} onChange={e=>patch(i,{topics:replace(c.topics,j,{...t,title:e.target.value})})}/>
          <button type="button" aria-label="Move topic up" disabled={j===0} onClick={()=>patch(i,{topics:move(c.topics,j,-1)})}>↑</button>
          <button type="button" aria-label="Move topic down" disabled={j===c.topics.length-1} onClick={()=>patch(i,{topics:move(c.topics,j,1)})}>↓</button>
          <button type="button" aria-label="Remove topic" onClick={()=>patch(i,{topics:remove(c.topics,j)})}>✕</button></div>)}
        <button type="button" onClick={()=>patch(i,{topics:[...c.topics,{id:newId(),title:''}]})}>Add topic</button></fieldset>
    </article>)}
    <div className="actions"><button type="button" onClick={()=>set([...outline.chapters,emptyChapter()])}>Add chapter</button>
      <button type="button" onClick={()=>set([...outline.chapters,{...emptyChapter(),kind:'exam',title:'Examination'}])}>Add examination</button></div>
  </section>;
}

const PRESETS=[['attendance','Attendance'],['quiz','Quizzes'],['activity','Activities'],['exam','Examinations']];
export function GradingStep({policy,onChange}:{policy:GradingPolicy|null;onChange:Change<GradingPolicy|null>}){
  if(!policy)return <section className="panel"><h2>Grading policy</h2>
    <p>No grading policy yet. You must confirm one before grades can be calculated. LearnSync does not guess percentages for you.</p>
    <button type="button" className="primary" onClick={()=>onChange({categories:[],periods:[{key:'midterm',label:'Midterm',share:50},{key:'finals',label:'Finals',share:50}],transmutation:'raw',passing:75,late_attendance_fraction:0.5})}>Set up grading policy</button></section>;
  const total=policy.categories.reduce((a,c)=>a+Number(c.weight||0),0);
  const shares=policy.periods.reduce((a,p)=>a+Number(p.share||0),0);
  const set=(patch:Partial<GradingPolicy>)=>onChange({...policy,...patch});
  return <section className="panel"><h2>Grading policy</h2>
    <fieldset><legend>Category weights</legend>
      {policy.categories.map((c,i)=><div className="topic-row" key={i}>
        <input aria-label="Category name" value={c.label} maxLength={80} onChange={e=>set({categories:replace(policy.categories,i,{...c,label:e.target.value})})}/>
        <input aria-label={`${c.label||'Category'} weight (%)`} type="number" min={0} max={100} step="any" value={c.weight} onChange={e=>set({categories:replace(policy.categories,i,{...c,weight:Number(e.target.value)})})}/>
        <button type="button" onClick={()=>set({categories:remove(policy.categories,i)})}>Remove</button></div>)}
      <div className="actions">{PRESETS.filter(([k])=>!policy.categories.some(c=>c.key===k)).map(([k,l])=><button type="button" key={k} onClick={()=>set({categories:[...policy.categories,{key:k,label:l,weight:0}]})}>Add {l.toLowerCase()}</button>)}
        <button type="button" onClick={()=>set({categories:[...policy.categories,{key:`custom-${newId().slice(0,8)}`,label:'Other',weight:0}]})}>Add another category</button></div>
      <p className={Math.abs(total-100)>0.01?'error':'muted'} role="status">Total: {total}% {Math.abs(total-100)>0.01?'(must equal 100%)':'✓'}</p></fieldset>
    <fieldset><legend>Period shares</legend>
      {policy.periods.map((p,i)=><label key={p.key}>{p.label} share (%)<input type="number" min={0} max={100} step="any" value={p.share} onChange={e=>set({periods:replace(policy.periods,i,{...p,share:Number(e.target.value)})})}/></label>)}
      <p className={Math.abs(shares-100)>0.01?'error':'muted'} role="status">Total: {shares}% {Math.abs(shares-100)>0.01?'(must equal 100%)':'✓'}</p></fieldset>
    <div className="grid-2"><label>Scores are<select value={policy.transmutation} onChange={e=>set({transmutation:e.target.value as GradingPolicy['transmutation']})}><option value="raw">Raw percentage</option><option value="transmuted">Transmuted (50 + raw ÷ 2)</option></select></label>
      <label>Passing grade<input type="number" min={0} max={100} value={policy.passing} onChange={e=>set({passing:Number(e.target.value)})}/></label>
      <label>Late attendance counts as<input type="number" min={0} max={1} step="0.05" value={policy.late_attendance_fraction} onChange={e=>set({late_attendance_fraction:Number(e.target.value)})}/></label></div>
    <button type="button" onClick={()=>{if(confirm('Remove the grading policy from this draft?'))onChange(null)}}>Remove grading policy</button></section>;
}
