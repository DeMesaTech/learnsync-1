import {useEffect,useState} from 'react';
import {Link,useNavigate,useOutletContext,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import {queryClient,useAuth} from '../../app/providers';
import type {OfferingSummary} from '../academics/types';
import {DraftNotices,SaveIndicator,draftKey,useAutosave,useFlushOnLeave} from '../teaching/autosave';
import {nodeLabels,type SyllabusState} from '../teaching/types';
import {usePolicy} from './Assessments';
import {QuestionList} from './QuestionEditor';
import {KIND_LABEL,toIso,toLocal,type Assessment,type AssessmentRev,type DraftContent} from './types';

const toContent=(r:AssessmentRev):DraftContent=>({title:r.title,instructions:r.instructions,category_key:r.category_key??'',period:r.period??'',max_points:String(r.max_points??0),available_from:toLocal(r.available_from),deadline:toLocal(r.deadline),allow_late:r.allow_late,max_attempts:r.max_attempts,score_rule:r.score_rule,include_in_grade:r.include_in_grade,anchor_node_id:r.anchor_node_id,questions:r.questions});
const toPayload=(v:DraftContent,counter:number)=>({expected_counter:counter,title:v.title,instructions:v.instructions,category_key:v.category_key||null,period:v.period||null,max_points:v.max_points||'0',available_from:toIso(v.available_from),deadline:toIso(v.deadline),allow_late:v.allow_late,max_attempts:v.max_attempts,score_rule:v.score_rule,include_in_grade:v.include_in_grade,anchor_node_id:v.anchor_node_id,questions:v.questions.map(q=>({...q,points:String(q.points||0)}))});

export function AssessmentEditorPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const {assessmentId}=useParams();
  const closed=offering.term_status==='closed';
  const base=`/teach/offerings/${offering.id}/assessments/${assessmentId}`;
  const back=`/faculty/offerings/${offering.id}/assessments`;
  const query=useQuery({queryKey:['assessment',assessmentId],queryFn:()=>api<Assessment>(base)});
  const [starting,setStarting]=useState(false);
  const item=query.data;
  const needsDraft=!!item&&!item.draft&&!closed;
  useEffect(()=>{
    if(!needsDraft||starting)return;
    setStarting(true);
    post(`${base}/draft`,{}).then(()=>query.refetch()).finally(()=>setStarting(false));
  },[needsDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  if(query.isPending)return <p>Loading…</p>;
  if(query.error||!item)return <section className="panel"><h2>Assessment unavailable</h2><p role="alert">{query.error?.message}</p><Link to={back}>Back to assessments</Link></section>;
  if(!item.draft)return closed?<section className="panel"><p className="back"><Link to={back}>← Assessments</Link></p><h2>{item.published?.title}</h2><p className="muted">This term is closed, so it cannot be edited.</p></section>:<p>Preparing a draft…</p>;
  return <Editor key={item.draft.version} offering={offering} assessment={item} refetch={()=>query.refetch()}/>;
}

function Editor({offering,assessment,refetch}:{offering:OfferingSummary;assessment:Assessment;refetch:()=>void}){
  const draft=assessment.draft!;
  const {session}=useAuth();
  const navigate=useNavigate();
  const {policy}=usePolicy(offering.id);
  const syllabus=useQuery({queryKey:['syllabus',offering.id],queryFn:()=>api<SyllabusState>(`/teach/offerings/${offering.id}/syllabus`)});
  const outline=syllabus.data?.published?.outline??syllabus.data?.draft?.outline;
  const nodes=outline?nodeLabels(outline):[];
  const base=`/teach/offerings/${offering.id}/assessments/${assessment.id}`;
  const back=`/faculty/offerings/${offering.id}/assessments`;
  const quiz=assessment.kind==='online_quiz';
  const locked=quiz&&assessment.has_attempts&&!!assessment.published;
  const [message,setMessage]=useState('');
  const [sections,setSections]=useState(assessment.section_ids);
  const [reviewedAt,setReviewedAt]=useState<number|null>(draft.reviewed?draft.counter:null);
  const auto=useAutosave<DraftContent>({storageKey:draftKey(session?.user?.id,offering.id,`assessment-${assessment.id}`),counter:draft.counter,initial:toContent(draft),
    save:(v,counter)=>send<{counter:number}>('PUT',`${base}/draft`,toPayload(v,counter))});
  useFlushOnLeave(auto.status,auto.flush);
  const v=auto.value;const set=(patch:Partial<DraftContent>)=>auto.setValue({...v,...patch});
  const needsReview=!!draft.ai_generated;
  const reviewed=!needsReview||(reviewedAt!==null&&reviewedAt===auto.counter()&&auto.status==='saved');   // any later edit cancels it
  const total=v.questions.reduce((a,q)=>a+(Number(q.points)||0),0);

  async function serverDraft(){const fresh=await api<Assessment>(base);if(!fresh.draft)throw new Error('The draft no longer exists.');return {value:toContent(fresh.draft),counter:fresh.draft.counter}}
  async function publish(){
    setMessage('');
    if(!await auto.flush()){setMessage('Resolve the save problem above before publishing.');return}
    try{await post(`${base}/draft/publish`,{expected_counter:auto.counter()});auto.discardRecovered();queryClient.invalidateQueries({queryKey:['assessments',offering.id]});navigate(back)}
    catch(e){setMessage(errorText(e))}
  }
  async function markReviewed(){
    setMessage('');
    if(!await auto.flush()){setMessage('Resolve the save problem above first.');return}
    try{await post(`${base}/draft/review`,{expected_counter:auto.counter()});setReviewedAt(auto.counter())}catch(e){setMessage(errorText(e))}
  }
  async function discard(){
    const published=!!assessment.published;
    if(!confirm(published?'Discard this draft? The published version stays as it is.':'Delete this assessment? It was never published.'))return;
    await auto.flush();
    try{
      if(published)await send('DELETE',`${base}/draft?expected_counter=${auto.counter()}`);else await send('DELETE',base);
      auto.discardRecovered();queryClient.invalidateQueries({queryKey:['assessments',offering.id]});navigate(back);
    }catch(e){setMessage(errorText(e))}
  }
  async function settings(patch:{section_ids?:string[];archived?:boolean}){
    try{await send('PATCH',base,patch);queryClient.invalidateQueries({queryKey:['assessments',offering.id]});refetch()}catch(e){setMessage(errorText(e))}
  }
  const categories=policy?.categories.filter(c=>c.key!=='attendance')??[];

  return <>
    <p className="back"><Link to={back}>← Assessments</Link></p>
    <div className="page-heading"><div><p className="eyebrow">{KIND_LABEL[assessment.kind]}</p><h2>{v.title||'Untitled'}</h2>
      <p className="muted">{assessment.published?`Students see version ${assessment.published.version} until you publish this draft.`:'Not visible to students or the gradebook until you publish.'}</p></div>
      <SaveIndicator status={auto.status} message={auto.message} storageFailed={auto.storageFailed} onRetry={auto.retry}/></div>
    <DraftNotices auto={auto} reload={serverDraft} onError={setMessage}/>
    {needsReview&&<section className="warn" role="status"><p><strong>Drafted by AI{draft.ai_language?` in ${({same:'the language of your materials',english:'English',filipino:'Filipino',taglish:'Taglish'} as Record<string,string>)[draft.ai_language]??draft.ai_language}`:''}.</strong> AI can be wrong. Read every question, check each answer against the source shown under it, check the language as well as the content, and fix anything off. If the language is wrong, discard this draft and draft again. Students cannot see this quiz until you mark it reviewed and publish. Changing anything afterwards means reviewing again.</p>
      <div className="actions"><button type="button" className={reviewed?'':'primary'} disabled={reviewed||(auto.status!=='saved'&&auto.status!=='dirty')} onClick={markReviewed}>{reviewed?'✓ Reviewed':'I have read and checked every question'}</button></div></section>}
    <section className="panel">
      <label>Title<input value={v.title} maxLength={200} onChange={e=>set({title:e.target.value})}/></label>
      <label>Instructions for students<textarea value={v.instructions} maxLength={10000} onChange={e=>set({instructions:e.target.value})}/></label>
      <label className="inline"><input type="checkbox" checked={v.include_in_grade} onChange={e=>set({include_in_grade:e.target.checked})}/> Counts toward the grade</label>
      {v.include_in_grade&&<div className="grid-2">
        <label>Grading category<select value={v.category_key} onChange={e=>set({category_key:e.target.value})}><option value="">Choose…</option>{categories.map(c=><option key={c.key} value={c.key}>{c.label} ({c.weight}%)</option>)}</select></label>
        <label>Grading period<select value={v.period} onChange={e=>set({period:e.target.value})}><option value="">Choose…</option>{(policy?.periods??[]).map(p=><option key={p.key} value={p.key}>{p.label}</option>)}</select></label></div>}
      {v.include_in_grade&&!policy&&<p className="warn" role="status">No confirmed grading policy yet. Publish a syllabus with one first, or turn off “Counts toward the grade”.</p>}
      {quiz?<p>Total points: <strong>{total}</strong> (the sum of your questions)</p>
        :<label>Maximum points<input type="number" min="0" step="0.5" value={v.max_points} onChange={e=>set({max_points:e.target.value})}/></label>}
      {(quiz||assessment.kind==='activity')&&<div className="grid-2">
        <label>Opens<input type="datetime-local" value={v.available_from} onChange={e=>set({available_from:e.target.value})}/></label>
        <label>Due<input type="datetime-local" value={v.deadline} onChange={e=>set({deadline:e.target.value})}/></label></div>}
      {(quiz||assessment.kind==='activity')&&<label className="inline"><input type="checkbox" checked={v.allow_late} onChange={e=>set({allow_late:e.target.checked})}/> Accept late work after the deadline{assessment.kind==='activity'?' (first submission only; replacing work later needs your permission)':''}</label>}
      {quiz&&<div className="grid-2">
        <label>Attempts allowed<select value={v.max_attempts} disabled={locked} onChange={e=>set({max_attempts:Number(e.target.value)})}>{[1,2,3,4,5,10].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        {v.max_attempts>1&&<label>Score used<select value={v.score_rule} disabled={locked} onChange={e=>set({score_rule:e.target.value as DraftContent['score_rule']})}><option value="highest">Highest attempt</option><option value="latest">Latest attempt</option></select></label>}</div>}
      <label>Attached syllabus topic (optional)<select value={v.anchor_node_id??''} onChange={e=>set({anchor_node_id:e.target.value||null})}><option value="">Not attached</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
    </section>
    {quiz&&<QuestionList questions={v.questions} locked={locked} onChange={q=>set({questions:q})}/>}
    <section className="panel"><h3>Audience and status</h3>
      <fieldset><legend>Applies to</legend><p className="muted">Leave all unchecked for every section.</p>
        {offering.sections.map(s=><label className="inline" key={s.id}><input type="checkbox" checked={sections.includes(s.id)} onChange={e=>{const ids=e.target.checked?[...sections,s.id]:sections.filter(x=>x!==s.id);setSections(ids);void settings({section_ids:ids})}}/> {s.name}</label>)}</fieldset>
      <button type="button" onClick={()=>settings({archived:!assessment.archived})}>{assessment.archived?'Restore assessment':'Archive assessment'}</button>
      <p className="muted">Archiving removes it from students and from grade calculations; records are kept.</p></section>
    {message&&<p role="alert">{message}</p>}
    {needsReview&&<section className={reviewed?'panel':'warn'} role="status" aria-label="AI draft review"><p>{reviewed?<strong>✓ You have reviewed this AI draft. You can publish it.</strong>:<><strong>This is an AI draft.</strong> Confirm you have read every question, its answer and the language before you publish.</>}</p>
      {!reviewed&&<div className="actions"><button type="button" className="primary" disabled={auto.status!=='saved'&&auto.status!=='dirty'} onClick={markReviewed}>I have read and checked every question</button></div>}</section>}
    <div className="actions"><button className="primary" disabled={needsReview&&!reviewed} title={needsReview&&!reviewed?'Mark the quiz as reviewed first':undefined} onClick={publish}>Publish</button><button onClick={discard}>{assessment.published?'Discard draft':'Delete assessment'}</button></div>
  </>;
}
