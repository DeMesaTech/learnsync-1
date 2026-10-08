import {useState,type FormEvent} from 'react';
import {Link,useNavigate,useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,upload,errorText} from '../../app/api';
import {queryClient,useAuth} from '../../app/providers';
import type {OfferingSummary} from '../academics/types';
import {DraftNotices,SaveIndicator,draftKey,useAutosave,useFlushOnLeave} from './autosave';
import {OutlineView} from './OutlineView';
import {ChaptersStep,GradingStep} from './SyllabusSections';
import {emptyChapter,type GradingPolicy,type Outline,type SyllabusDraftContent,type SyllabusRev,type SyllabusState} from './types';

const STEPS=[['outline','Outline'],['grading','Grading'],['plan','Assessments'],['schedule','Schedule'],['review','Review']] as const;
type Step=typeof STEPS[number][0];
const DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

/** The usual setup, offered as a SUGGESTION: it only takes effect once the teacher ticks the confirmation. */
const USUAL_POLICY:GradingPolicy={categories:[{key:'attendance',label:'Attendance',weight:10},{key:'quiz',label:'Quizzes',weight:25},{key:'activity',label:'Activities',weight:20},{key:'exam',label:'Examinations',weight:45}],
  periods:[{key:'midterm',label:'Midterm',share:50},{key:'finals',label:'Finals',share:50}],transmutation:'raw',passing:75,late_attendance_fraction:0.5};
const STARTER_CHAPTERS=['Chapter 1','Chapter 2','Chapter 3','Chapter 4'];

const KINDS=[['online_quiz','Quizzes','Quiz','quiz'],['activity','Activities','Activity','activity'],['exam','Examinations','Examination','exam']] as const;
type Counts=Record<string,{midterm:number;finals:number}>;
const PERIODS=[['midterm','Midterm'],['finals','Finals']] as const;
const MAX_PLANNED=30;

interface PlanItem{kind:string;title:string;category_key:string|null;period:'midterm'|'finals'}
export function buildPlan(counts:Counts,policy:GradingPolicy|null):PlanItem[]{
  const categories=new Set(policy?.categories.map(c=>c.key));
  const out:PlanItem[]=[];
  for(const [kind,,label,key] of KINDS){
    let n=0;
    for(const [period,name] of PERIODS){
      const count=counts[kind]?.[period]??0;
      for(let i=0;i<count;i++){
        n++;
        const title=kind==='exam'?(count===1?`${name==='Finals'?'Final':name} examination`:`${name} examination ${i+1}`):`${label} ${n}`;
        out.push({kind,title,category_key:categories.has(key)?key:null,period});
      }
    }
  }
  return out;
}

export function SubjectSetup(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const url=`/teach/offerings/${offering.id}/syllabus`;
  const query=useQuery({queryKey:['syllabus',offering.id],queryFn:()=>api<SyllabusState>(url)});
  const [message,setMessage]=useState('');
  const [warnings,setWarnings]=useState<string[]>([]);
  const [finished,setFinished]=useState<number|null>(null);   // lives here: once published the draft is gone and this component re-renders
  const refresh=()=>Promise.all(['syllabus','assessments','items','offering','my-offerings'].map(k=>queryClient.invalidateQueries({queryKey:[k]})));
  if(offering.term_status==='closed')return <section className="panel"><h2>This term is closed</h2><p>A closed term cannot be set up. Ask an administrator to reopen it.</p></section>;
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  const {published,draft}=query.data;
  if(finished!==null)return <Done offering={offering} planned={finished}/>;
  if(draft)return <Flow key={draft.id} offering={offering} draft={draft} published={published} warnings={warnings} onChanged={refresh} onFinished={setFinished}/>;
  return <Start offering={offering} published={published} message={message} setMessage={setMessage} setWarnings={setWarnings} onChanged={refresh}/>;
}

function Start({offering,published,message,setMessage,setWarnings,onChanged}:{offering:OfferingSummary;published:SyllabusRev|null;message:string;setMessage:(m:string)=>void;setWarnings:(w:string[])=>void;onChanged:()=>Promise<unknown>}){
  const url=`/teach/offerings/${offering.id}/syllabus`;
  const mine=useQuery({queryKey:['my-offerings'],queryFn:()=>api<OfferingSummary[]>('/me/offerings')});
  const earlier=(mine.data??[]).filter(o=>o.id!==offering.id);
  const [source,setSource]=useState('');
  const [busy,setBusy]=useState(false);
  async function run(work:()=>Promise<unknown>){setBusy(true);setMessage('');try{await work();await onChanged()}catch(e){setMessage(errorText(e))}finally{setBusy(false)}}
  const blank=()=>run(()=>post(`${url}/draft`,{}));
  const copy=()=>run(async()=>{const r=await post<{items:number;assessments:number;skipped_files:number}>(`/teach/offerings/${offering.id}/copy-from/${source}`,{});
    if(r.skipped_files)setWarnings([`${r.skipped_files} file${r.skipped_files===1?' was':'s were'} not copied because the original could not be found.`])});
  const importFile=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=new FormData(e.currentTarget);
    void run(async()=>{const r=await upload<{warnings:string[]}>(`${url}/import`,form);setWarnings(r.warnings)})};
  return <>
    <div className="page-heading"><div><p className="eyebrow">Set up this subject</p><h2>{offering.subject.code} · {offering.subject.title}</h2>
      <p className="muted">A few minutes now gives you the whole structure: outline, grading, planned quizzes, activities and exams, and class days. Nothing is visible to students until you publish. Details can be filled in later, one item at a time.</p></div></div>
    {message&&<p role="alert">{message}</p>}
    {published&&<section className="panel"><h3>This subject already has a published syllabus</h3><p className="muted">You can still use this guide to change the outline and grading, plan more assessments or set the class days. Students keep seeing the published version until you publish again.</p>
      <button className="primary" disabled={busy} onClick={blank}>Continue with the guide</button></section>}
    {!published&&<div className="cards">
      <section className="panel"><h3>Copy a previous subject</h3><p className="muted">Brings over its outline, grading, lessons, files, links and assessments as drafts. Never students, dates, scores or attempts.</p>
        {mine.isPending?<p>Loading…</p>:earlier.length===0?<p className="muted">You have no other subject to copy from.</p>:<>
          <label>Subject<select value={source} onChange={e=>setSource(e.target.value)}><option value="">Choose one…</option>{earlier.map(o=><option key={o.id} value={o.id}>{o.subject.code} · {o.subject.title} · {o.term}</option>)}</select></label>
          <button className="primary" disabled={!source||busy} onClick={copy}>Copy into this subject</button></>}</section>
      <section className="panel"><h3>Import a syllabus file</h3><p className="muted">A DOCX or PDF. The outline is read from it and you check the result.</p>
        <form onSubmit={importFile}><label>Syllabus file<input name="file" type="file" required accept=".docx,.pdf"/></label><button disabled={busy}>Import</button></form></section>
      <section className="panel"><h3>Start from scratch</h3><p className="muted">A blank outline with the course name already filled in. A starter outline is offered in the next step.</p>
        <button className="primary" disabled={busy} onClick={blank}>Start</button></section></div>}
  </>;
}

function Done({offering,planned}:{offering:OfferingSummary;planned:number}){
  return <section className="panel" aria-live="polite"><h2>Your subject is set up</h2>
    <p>The syllabus is published. {planned>0?`${planned} planned assessment${planned===1?'':'s'} wait${planned===1?'s':''} as drafts: students cannot see them until you finish and assign them.`:'Add lessons and assessments whenever you are ready.'}</p>
    <div className="actions"><Link className="button primary" to={`/faculty/offerings/${offering.id}/classwork`}>Finish the planned assessments</Link>
      <Link className="button" to={`/faculty/offerings/${offering.id}/classwork`}>Add lessons and materials</Link>
      <Link className="button" to={`/faculty/offerings/${offering.id}/attendance`}>Take attendance</Link></div></section>;
}

function Flow({offering,draft,published,warnings,onChanged,onFinished}:{offering:OfferingSummary;draft:SyllabusRev;published:SyllabusRev|null;warnings:string[];onChanged:()=>Promise<unknown>;onFinished:(planned:number)=>void}){
  const {session}=useAuth();const navigate=useNavigate();
  const url=`/teach/offerings/${offering.id}/syllabus`;
  const auto=useAutosave<SyllabusDraftContent>({storageKey:draftKey(session?.user?.id,offering.id,'syllabus'),counter:draft.counter,
    initial:{outline:draft.outline,grading_policy:draft.grading_policy},
    save:(v,counter)=>send<{counter:number}>('PUT',`${url}/draft`,{expected_counter:counter,outline:v.outline,grading_policy:v.grading_policy})});
  useFlushOnLeave(auto.status,auto.flush);
  const {outline,grading_policy}=auto.value;
  const [step,setStep]=useState<Step>('outline');
  const [message,setMessage]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [counts,setCounts]=useState<Counts>({online_quiz:{midterm:2,finals:2},activity:{midterm:1,finals:1},exam:{midterm:1,finals:1}});
  const [planned,setPlanned]=useState(0);
  const [days,setDays]=useState(offering.meeting_days??0);
  const existing=useQuery({queryKey:['assessments',offering.id],queryFn:()=>api<{id:string}[]>(`/teach/offerings/${offering.id}/assessments`)});
  const set=(next:Partial<SyllabusDraftContent>)=>auto.setValue({outline,grading_policy,...next});
  const index=STEPS.findIndex(s=>s[0]===step);
  const plan=buildPlan(counts,grading_policy);

  async function saveDays(){if(days!==(offering.meeting_days??0)){await send('PUT',`/teach/offerings/${offering.id}/schedule`,{meeting_days:days});await queryClient.invalidateQueries({queryKey:['offering']})}}
  async function go(next:Step){
    setMessage('');
    if(step==='schedule'){try{await saveDays()}catch(e){setMessage(errorText(e));return}}
    if(!await auto.flush()){setMessage('Resolve the save problem above first.');return}
    setStep(next);
  }
  async function createDrafts(){
    setMessage('');
    if(plan.length===0||plan.length>MAX_PLANNED){setMessage(plan.length===0?'Choose at least one item to plan.':`Plan at most ${MAX_PLANNED} items at a time.`);return}
    try{const r=await post<{ids:string[]}>(`/teach/offerings/${offering.id}/assessments/plan`,{plan_key:crypto.randomUUID(),items:plan});
      setPlanned(r.ids.length);await queryClient.invalidateQueries({queryKey:['assessments']})}
    catch(e){setMessage(errorText(e))}
  }
  async function publish(){
    setMessage('');
    try{await saveDays()}catch(e){setMessage(errorText(e));return}
    if(!await auto.flush()){setMessage('Resolve the save problem above before publishing.');return}
    try{await post(`${url}/draft/publish`,{expected_counter:auto.counter()});auto.discardRecovered();onFinished(planned);await onChanged()}
    catch(e){setMessage(errorText(e))}
  }
  async function reload(){const s=await api<SyllabusState>(url);if(!s.draft)throw new Error('The draft no longer exists.');return {value:{outline:s.draft.outline,grading_policy:s.draft.grading_policy},counter:s.draft.counter}}
  const starter=()=>set({outline:{...outline,chapters:[...STARTER_CHAPTERS.map(t=>({...emptyChapter(),title:t})),{...emptyChapter(),kind:'exam',title:'Midterm examination'},{...emptyChapter(),kind:'exam',title:'Final examination'}]}});
  const topics=outline.chapters.reduce((n,c)=>n+c.topics.length,0);
  const total=(grading_policy?.categories??[]).reduce((a,c)=>a+Number(c.weight||0),0);
  const policyOk=!grading_policy||grading_policy.categories.length===0||Math.abs(total-100)<=0.01;
  const nextBlocked=step==='grading'&&!!grading_policy&&grading_policy.categories.length>0&&(!confirmed||!policyOk);

  return <>
    <div className="page-heading"><div><p className="eyebrow">Set up this subject</p><h2>{offering.subject.code} · {offering.subject.title}</h2>
      <p className="muted">Step {index+1} of {STEPS.length}. Everything is saved as you go, and nothing reaches students until you publish.</p></div>
      <SaveIndicator status={auto.status} message={auto.message} storageFailed={auto.storageFailed} onRetry={auto.retry}/></div>
    {warnings.map(w=><p className="warn" role="status" key={w}>{w}</p>)}
    <DraftNotices auto={auto} reload={reload} onError={setMessage}/>
    <nav aria-label="Setup steps"><ol className="stepper">{STEPS.map(([id,label],i)=><li key={id} className={i<index?'done':i===index?'current':''}>
      <button type="button" aria-current={id===step?'step':undefined} onClick={()=>void go(id)}><span className="n" aria-hidden="true">{i<index?'✓':i+1}</span> {label}</button></li>)}</ol></nav>

    {step==='outline'&&<>
      {outline.chapters.length===0&&<section className="panel"><h3>Start with a starter outline?</h3><p className="muted">Four chapters plus Midterm and Final examinations that you rename and fill in. You can also add your own below.</p>
        <button className="primary" onClick={starter}>Use the starter outline</button></section>}
      <ChaptersStep outline={outline} onChange={(o:Outline)=>set({outline:o})}/></>}

    {step==='grading'&&<>
      {(!grading_policy||grading_policy.categories.length===0)&&<section className="panel"><h3>The usual setup</h3>
        <p className="muted">Attendance 10%, Quizzes 25%, Activities 20%, Examinations 45%; Midterm and Finals 50/50; passing 75. This is only a suggestion: nothing is final until you confirm it below.</p>
        <button className="primary" onClick={()=>{set({grading_policy:USUAL_POLICY});setConfirmed(false)}}>Use this suggestion</button></section>}
      <GradingStep policy={grading_policy} onChange={(p:GradingPolicy|null)=>{set({grading_policy:p});setConfirmed(false)}}/>
      {grading_policy&&grading_policy.categories.length>0&&<section className="panel"><label className="inline"><input type="checkbox" checked={confirmed} disabled={!policyOk} onChange={e=>setConfirmed(e.target.checked)}/> I have checked these weights and confirm them for this subject</label>
        <p className="muted">LearnSync never guesses percentages: the policy takes effect when you publish.</p></section>}</>}

    {step==='plan'&&<section className="panel"><h3>Plan your assessments</h3>
      <p className="muted">How many of each will you give? They are created as drafts with the right grading category and period, so the subject looks complete now. You fill in the details later.</p>
      {!grading_policy&&<p className="warn" role="status">No grading policy yet, so the drafts will have no category. Set grading up in the previous step for better results.</p>}
      {(existing.data?.length??0)>0&&<p className="muted" role="status">This subject already has {existing.data!.length} assessment{existing.data!.length===1?'':'s'}. New drafts are added to them.</p>}
      <div className="table-wrap"><table><thead><tr><th>Type</th>{PERIODS.map(([,n])=><th key={n}>{n}</th>)}</tr></thead>
        <tbody>{KINDS.map(([kind,label])=><tr key={kind}><td>{label}</td>{PERIODS.map(([period,n])=><td key={period}>
          <label className="sr-only" htmlFor={`${kind}-${period}`}>{label}, {n}</label>
          <input id={`${kind}-${period}`} type="number" min={0} max={10} value={counts[kind][period]} onChange={e=>setCounts({...counts,[kind]:{...counts[kind],[period]:Math.max(0,Math.min(10,Number(e.target.value)||0))}})}/></td>)}</tr>)}</tbody></table></div>
      <p role="status" className={plan.length>MAX_PLANNED?'error':'muted'}>{plan.length===0?'Nothing planned yet.':`${plan.length} draft${plan.length===1?'':'s'} will be created: ${plan.slice(0,4).map(p=>p.title).join(', ')}${plan.length>4?', …':''}`}</p>
      {planned>0&&<p role="status"><strong>✓ {planned} draft{planned===1?'':'s'} created.</strong> Planning again would add more.</p>}
      <button className="primary" disabled={plan.length===0||plan.length>MAX_PLANNED} onClick={createDrafts}>{planned>0?'Create more drafts':`Create ${plan.length} draft${plan.length===1?'':'s'}`}</button></section>}

    {step==='schedule'&&<section className="panel"><h3>When does the class meet?</h3>
      <p className="muted">The attendance register will show these days. You can add or change dates later. Skip this if the schedule varies.</p>
      <fieldset><legend>Class days</legend><div className="chips">{DAYS.map((d,i)=><label className="inline" key={d}><input type="checkbox" checked={(days&(1<<i))!==0} onChange={e=>setDays(e.target.checked?days|(1<<i):days&~(1<<i))}/> {d}</label>)}</div></fieldset></section>}

    {step==='review'&&<>
      <section className="panel"><h3>Review</h3><ul className="rows">
        <li><strong>Outline</strong><span className="muted">{outline.chapters.filter(c=>c.title.trim()).length} chapter{outline.chapters.length===1?'':'s'}, {topics} topic{topics===1?'':'s'}</span></li>
        <li><strong>Grading</strong><span className="muted">{grading_policy&&grading_policy.categories.length>0?grading_policy.categories.map(c=>`${c.label} ${c.weight}%`).join(' · '):'No grading policy yet. Grades cannot be calculated until you add one.'}</span></li>
        <li><strong>Planned assessments</strong><span className="muted">{planned>0?`${planned} created in this guide`:'None created in this guide'}{(existing.data?.length??0)>0?` (${existing.data!.length} in the subject)`:''}</span></li>
        <li><strong>Class days</strong><span className="muted">{days===0?'Not set':DAYS.filter((_,i)=>(days&(1<<i))!==0).join(', ')}</span></li></ul></section>
      <OutlineView outline={outline} policy={grading_policy}/>
      <section className="panel"><h3>Publish the syllabus</h3><p className="muted">Students will see the outline and grading policy{published?' as a new version':''}. Planned assessments stay hidden until you finish and assign each one.</p>
        {grading_policy&&grading_policy.categories.length>0&&!confirmed&&<p className="warn" role="status">Confirm your grading weights in the Grading step before publishing.</p>}
        <button className="primary" disabled={!!grading_policy&&grading_policy.categories.length>0&&!confirmed} onClick={publish}>Publish and finish</button></section></>}

    {message&&<p role="alert">{message}</p>}
    <div className="actions"><button disabled={index===0} onClick={()=>void go(STEPS[index-1][0])}>Back</button>
      {index<STEPS.length-1&&<button className="primary" disabled={nextBlocked} onClick={()=>void go(STEPS[index+1][0])}>Next</button>}
      <button onClick={async()=>{if(await auto.flush())navigate(`/faculty/offerings/${offering.id}`)}}>Save and exit</button>
      {nextBlocked&&<button type="button" className="linklike" onClick={()=>void go(STEPS[index+1][0])}>Skip for now</button>}</div>
  </>;
}
