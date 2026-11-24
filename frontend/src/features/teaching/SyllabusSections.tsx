import {useRef,useState} from 'react';
import {Pager} from '../../components/Pager';
import {useUndo} from '../../components/undo';
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
  const undo=useUndo();const latestSet=useRef<(c:Chapter[])=>void>(()=>{});
  const [page,setPage]=useState(1);
  const pageSize=5;
  const set=(chapters:Chapter[])=>onChange({...outline,chapters});
  latestSet.current=set;
  const patch=(i:number,change:Partial<Chapter>)=>set(replace(outline.chapters,i,{...outline.chapters[i],...change}));
  const hasIntro=outline.chapters.some(chapter=>chapter.is_intro);
  const pageCount=Math.max(1,Math.ceil(outline.chapters.length/pageSize));
  const currentPage=Math.min(page,pageCount);
  const pageStart=(currentPage-1)*pageSize;
  const visibleChapters=outline.chapters.map((chapter,index)=>({chapter,index})).slice(pageStart,pageStart+pageSize);
  return <section><h2>Course coverage</h2>
    <p className="muted">Chapters and topics keep a stable identity when you rename or reorder them, so lessons attached to a topic stay attached.</p>
    {outline.chapters.length===0&&<p className="panel">No chapters yet. Add the first one below.</p>}
    {visibleChapters.map(({chapter:c,index:i})=><article className="panel" key={c.id}>
      <div className="page-heading"><h3>{c.is_intro?'Subject introduction':`Chapter ${outline.chapters.slice(0,i).filter(chapter=>!chapter.is_intro).length+1}`}</h3>
        <div className="actions"><button type="button" aria-label={`Move chapter ${i+1} up`} disabled={i===0||outline.chapters[i-1]?.is_intro===true} onClick={()=>set(move(outline.chapters,i,-1))}>↑</button>
          <button type="button" aria-label={`Move chapter ${i+1} down`} disabled={i===outline.chapters.length-1||c.is_intro===true} onClick={()=>set(move(outline.chapters,i,1))}>↓</button>
          <button type="button" onClick={()=>{const before=outline.chapters;set(remove(outline.chapters,i));undo(`Chapter ${i+1} removed (its topics too). Lessons attached to them must be re-attached or archived before publishing.`,()=>latestSet.current(before))}}>Remove</button></div></div>
      <div className="grid-2"><label>Title<input value={c.title} maxLength={300} onChange={e=>patch(i,{title:e.target.value})}/></label>
        <label>Time allotment<input value={c.weeks} maxLength={60} placeholder="Week 2" onChange={e=>patch(i,{weeks:e.target.value})}/></label></div>
      <fieldset><legend>Topics</legend>
        {c.topics.map((t,j)=><div className="topic-row" key={t.id}>
          <input aria-label={`Topic ${j+1} of chapter ${i+1}`} value={t.title} maxLength={300} onChange={e=>patch(i,{topics:replace(c.topics,j,{...t,title:e.target.value})})}/>
          <button type="button" aria-label="Move topic up" disabled={j===0} onClick={()=>patch(i,{topics:move(c.topics,j,-1)})}>↑</button>
          <button type="button" aria-label="Move topic down" disabled={j===c.topics.length-1} onClick={()=>patch(i,{topics:move(c.topics,j,1)})}>↓</button>
          <button type="button" aria-label="Remove topic" onClick={()=>patch(i,{topics:remove(c.topics,j)})}>✕</button></div>)}
        <button type="button" onClick={()=>patch(i,{topics:[...c.topics,{id:newId(),title:''}]})}>Add topic</button></fieldset>
    </article>)}
    {outline.chapters.length>0&&<Pager page={currentPage} pageSize={pageSize} total={outline.chapters.length} onPage={setPage}/>}
    <div className="actions"><button type="button" onClick={()=>{set([...outline.chapters,emptyChapter()]);setPage(Math.ceil((outline.chapters.length+1)/pageSize))}}>Add chapter</button>
      <button type="button" disabled={hasIntro} onClick={()=>set([{...emptyChapter(),title:'Subject Introduction',is_intro:true},...outline.chapters])}>Add subject introduction</button></div>
  </section>;
}

const PRESETS=[['attendance','Attendance'],['quiz','Quizzes'],['activity','Activities'],['exam','Examinations']];
export function GradingStep({policy,onChange}:{policy:GradingPolicy|null;onChange:Change<GradingPolicy|null>}){
  const undo=useUndo();const latestChange=useRef(onChange);latestChange.current=onChange;
  if(!policy)return <section className="panel"><h2>Grading policy</h2>
    <p>No grading policy yet. You must confirm one before grades can be calculated. LearnSync does not guess percentages for you.</p>
    <button type="button" className="primary" onClick={()=>onChange({categories:[],periods:[{key:'midterm',label:'Midterm',share:50},{key:'finals',label:'Finals',share:50}],online_quiz_categories:[],activity_categories:[],transmutation:'raw',passing:75,late_attendance_fraction:0.5})}>Set up grading policy</button></section>;
  const total=policy.categories.reduce((a,c)=>a+Number(c.weight||0),0);
  const shares=policy.periods.reduce((a,p)=>a+Number(p.share||0),0);
  const set=(patch:Partial<GradingPolicy>)=>onChange({...policy,...patch});
  const selectableCategories=policy.categories.filter(category=>category.key!=='attendance');
  const allowed=(keys:string[]|null|undefined)=>keys??selectableCategories.map(category=>category.key);
  const updateCategories=(categories:GradingPolicy['categories'])=>{
    const keep=(keys:string[]|null|undefined)=>keys==null?keys:keys.filter(key=>categories.some(category=>category.key===key));
    set({categories,online_quiz_categories:keep(policy.online_quiz_categories),activity_categories:keep(policy.activity_categories)});
  };
  const categoryChoices=(kind:'online_quiz_categories'|'activity_categories',label:string)=>{
    const selected=allowed(policy[kind]);
    return <fieldset className="grading-category-allowlist"><legend>{label}</legend>
      {selectableCategories.length===0?<p className="muted">Add a non-attendance grading category first.</p>:selectableCategories.map(category=><label className="inline" key={category.key}>
        <input type="checkbox" checked={selected.includes(category.key)} onChange={event=>{
          const next=event.target.checked?[...selected,category.key]:selected.filter(key=>key!==category.key);
          set({[kind]:next});
        }}/> {category.label||'Unnamed category'} ({category.weight}%)
      </label>)}
      <p className="muted">Select every category this type of assessment may use.</p>
    </fieldset>;
  };
  return <section className="panel"><h2>Grading policy</h2>
    <fieldset><legend>Category weights</legend>
      {policy.categories.map((c,i)=><div className="topic-row" key={i}>
        <input aria-label="Category name" value={c.label} maxLength={80} onChange={e=>set({categories:replace(policy.categories,i,{...c,label:e.target.value})})}/>
        <input aria-label={`${c.label||'Category'} weight (%)`} type="number" min={0} max={100} step="any" value={c.weight===0?'':c.weight} onChange={e=>set({categories:replace(policy.categories,i,{...c,weight:Number(e.target.value)||0})})}/>
        <button type="button" className="icon-button" aria-label={`Remove ${c.label||'category'}`} title={`Remove ${c.label||'category'}`} onClick={()=>updateCategories(remove(policy.categories,i))}>×</button></div>)}
      <div className="actions">{PRESETS.filter(([k])=>!policy.categories.some(c=>c.key===k)).map(([k,l])=><button type="button" key={k} onClick={()=>set({categories:[...policy.categories,{key:k,label:l,weight:0}]})}>Add {l.toLowerCase()}</button>)}
        <button type="button" className="primary" onClick={()=>set({categories:[...policy.categories,{key:`custom-${newId().slice(0,8)}`,label:'Other',weight:0}]})}>＋ Add another category</button></div>
      <p className={`grading-total ${Math.abs(total-100)>0.01?'error':'muted'}`} role="status">Total: {total}% {Math.abs(total-100)>0.01?'(must equal 100%)':'✓'}</p></fieldset>
    {categoryChoices('online_quiz_categories','Categories allowed for online quizzes')}
    {categoryChoices('activity_categories','Categories allowed for activities')}
    <fieldset><legend>Period shares</legend>
      {policy.periods.map((p,i)=><label key={p.key}>{p.label} share (%)<input type="number" min={0} max={100} step="any" value={p.share} onChange={e=>set({periods:replace(policy.periods,i,{...p,share:Number(e.target.value)})})}/></label>)}
      <p className={`grading-total ${Math.abs(shares-100)>0.01?'error':'muted'}`} role="status">Total: {shares}% {Math.abs(shares-100)>0.01?'(must equal 100%)':'✓'}</p></fieldset>
    <div className="grid-2"><label>Scores are<select value={policy.transmutation} onChange={e=>set({transmutation:e.target.value as GradingPolicy['transmutation']})}><option value="raw">Raw percentage</option><option value="transmuted">Transmuted (50 + raw ÷ 2)</option></select></label>
      <label>Passing grade<input type="number" min={0} max={100} value={policy.passing} onChange={e=>set({passing:Number(e.target.value)})}/></label>
      <label>Late attendance counts as<input type="number" min={0} max={1} step="0.05" value={policy.late_attendance_fraction} onChange={e=>set({late_attendance_fraction:Number(e.target.value)})}/></label></div>
    <button type="button" onClick={()=>{const before=policy;onChange(null);undo('Grading policy removed.',()=>latestChange.current(before))}}>Remove grading policy</button></section>;
}
