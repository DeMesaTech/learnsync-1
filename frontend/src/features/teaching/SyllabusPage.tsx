import {useState,type FormEvent} from 'react';
import {useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,upload,errorText} from '../../app/api';
import {queryClient,useAuth} from '../../app/providers';
import type {OfferingSummary} from '../academics/types';
import {SaveIndicator,draftKey,useAutosave,useFlushOnLeave} from './autosave';
import {OutlineView} from './OutlineView';
import {ChaptersStep,CourseStep,GradingStep,OutcomesStep} from './SyllabusSections';
import type {Coverage,SyllabusDraftContent,SyllabusRev,SyllabusState} from './types';

const STEPS=[['course','Course'],['outcomes','Outcomes'],['chapters','Coverage'],['grading','Grading'],['review','Review & publish']] as const;
type Step=typeof STEPS[number][0];

export function SyllabusPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const closed=offering.term_status==='closed';
  const url=`/teach/offerings/${offering.id}/syllabus`;
  const query=useQuery({queryKey:['syllabus',offering.id],queryFn:()=>api<SyllabusState>(url)});
  const [message,setMessage]=useState('');
  const [warnings,setWarnings]=useState<string[]>([]);
  const refresh=()=>queryClient.invalidateQueries({queryKey:['syllabus',offering.id]});

  async function start(){setMessage('');try{await post(`${url}/draft`,{});refresh()}catch(e){setMessage(errorText(e))}}
  async function importFile(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage('');
    try{const result=await upload<{warnings:string[]}>(`${url}/import`,new FormData(e.currentTarget));setWarnings(result.warnings);refresh()}
    catch(err){setMessage(errorText(err))}
  }
  if(query.isPending)return <p>Loading syllabus…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  const {published,draft}=query.data;
  if(draft)return <><DraftEditor key={draft.id} offering={offering} draft={draft} published={published} warnings={warnings} onChanged={refresh}/>{published&&<CoveragePanel offering={offering} published={published} closed={closed}/>}</>;
  return <>
    {message&&<p role="alert">{message}</p>}
    {published?<>
      <section className="panel"><div className="page-heading"><div><h2>Published syllabus · version {published.version}</h2>
        <p className="muted">Students see this version. Editing creates a separate draft; students keep seeing this version until you publish.</p></div>
        <button className="primary" disabled={closed} onClick={start}>Edit syllabus</button></div></section>
      <CoveragePanel offering={offering} published={published} closed={closed}/>
      <OutlineView outline={published.outline} policy={published.grading_policy}/>
    </>:<section className="panel"><h2>No syllabus yet</h2>
      <p>Build your syllabus here or import your existing DOCX/PDF to start from it. Nothing is visible to students until you publish.</p>
      <div className="actions"><button className="primary" disabled={closed} onClick={start}>Start from scratch</button></div>
      {!closed&&<form onSubmit={importFile}><label>Import from a syllabus file (DOCX or PDF)<input name="file" type="file" required accept=".docx,.pdf"/></label><button>Import into a draft</button></form>}
    </section>}
    {published&&!closed&&<section className="panel"><h3>Start a new draft from a file</h3>
      <form onSubmit={importFile}><label>Syllabus file (DOCX or PDF)<input name="file" type="file" required accept=".docx,.pdf"/></label><button>Import into a draft</button></form></section>}
  </>;
}

function CoveragePanel({offering,published,closed}:{offering:OfferingSummary;published:SyllabusRev;closed:boolean}){
  const [sectionId,setSectionId]=useState(offering.sections[0]?.id??'');
  const [date,setDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [message,setMessage]=useState('');
  const query=useQuery({queryKey:['coverage',offering.id],queryFn:()=>api<Coverage[]>(`/teach/offerings/${offering.id}/coverage`)});
  const covered=new Map(query.data?.filter(c=>c.section_id===sectionId).map(c=>[c.node_id,c.covered_on]));
  const refresh=()=>queryClient.invalidateQueries({queryKey:['coverage',offering.id]});
  async function toggle(nodeId:string){
    try{
      if(covered.has(nodeId))await send('DELETE',`/teach/offerings/${offering.id}/coverage?section_id=${sectionId}&node_id=${nodeId}`);
      else await send('PUT',`/teach/offerings/${offering.id}/coverage`,{section_id:sectionId,node_id:nodeId,covered_on:date});
      setMessage('');refresh();
    }catch(e){setMessage(errorText(e))}
  }
  if(offering.sections.length===0)return null;
  return <details className="panel"><summary><strong>Record what you have covered in class</strong></summary>
    <p className="muted">Your own teaching record per section. It is separate from students marking lessons complete.</p>
    <div className="grid-2"><label>Section<select value={sectionId} onChange={e=>setSectionId(e.target.value)}>{offering.sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Date covered<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>
    {message&&<p role="alert">{message}</p>}
    <OutlineView outline={{...published.outline,outcomes:[]}} coveredOn={covered}
      extra={id=><button type="button" disabled={closed||!sectionId} onClick={()=>toggle(id)}>{covered.has(id)?'Unmark':'Mark covered'}</button>}/>
  </details>;
}

function DraftEditor({offering,draft,published,warnings,onChanged}:{offering:OfferingSummary;draft:SyllabusRev;published:SyllabusRev|null;warnings:string[];onChanged:()=>void}){
  const {session}=useAuth();
  const url=`/teach/offerings/${offering.id}/syllabus`;
  const key=draftKey(session?.user?.id,offering.id,'syllabus');
  const [step,setStep]=useState<Step>('course');
  const [message,setMessage]=useState('');
  const auto=useAutosave<SyllabusDraftContent>({storageKey:key,counter:draft.counter,
    initial:{outline:draft.outline,grading_policy:draft.grading_policy},
    save:(v,counter)=>send<{counter:number}>('PUT',`${url}/draft`,{expected_counter:counter,outline:v.outline,grading_policy:v.grading_policy})});
  useFlushOnLeave(auto.status,auto.flush);
  const {outline,grading_policy}=auto.value;

  async function fresh(){const state=await api<SyllabusState>(url);if(!state.draft){onChanged();throw new Error('The draft no longer exists.')}return state.draft}
  async function publish(){
    setMessage('');
    if(!await auto.flush()){setMessage('Resolve the save problem above before publishing.');return}
    try{await post(`${url}/draft/publish`,{expected_counter:auto.counter()});auto.discardRecovered();onChanged()}
    catch(e){setMessage(errorText(e))}
  }
  async function discard(){
    if(!confirm(published?'Discard this draft? The published syllabus stays as it is.':'Discard this draft and start over?'))return;
    await auto.flush();
    try{await send('DELETE',`${url}/draft?expected_counter=${auto.counter()}`);auto.discardRecovered();onChanged()}
    catch(e){setMessage(errorText(e))}
  }
  const go=async(next:Step)=>{await auto.flush();setStep(next)};

  return <>
    <div className="page-heading"><div><h2>Editing draft · version {draft.version}</h2>
      <p className="muted">{published?'Students still see the published version until you publish this draft.':'Not visible to students until you publish.'}</p></div>
      <SaveIndicator status={auto.status} message={auto.message} storageFailed={auto.storageFailed} onRetry={auto.retry}/></div>
    {warnings.map(w=><p className="warn" role="status" key={w}>{w}</p>)}
    {draft.source_file&&<p className="muted">Imported from <a href={`/api/files/${draft.source_file.id}/download`}>{draft.source_file.name}</a></p>}
    {auto.recovered&&<div className="warn" role="alert"><p>Unsaved changes from this browser were found ({new Date(auto.recovered.at).toLocaleString()}). They are not on the server.</p>
      <div className="actions"><button className="primary" onClick={auto.restoreRecovered}>Restore my changes</button><button onClick={auto.discardRecovered}>Discard them</button></div></div>}
    {auto.status==='conflict'&&<div className="warn" role="alert"><p><strong>This draft was changed somewhere else</strong> (another tab or device). Nothing has been overwritten. Choose which version to continue with.</p>
      <div className="actions"><button onClick={async()=>{try{const d=await fresh();auto.useServer({outline:d.outline,grading_policy:d.grading_policy},d.counter)}catch(e){setMessage(errorText(e))}}}>Load the newer version (drops my unsaved edits)</button>
        <button className="primary" onClick={async()=>{try{const d=await fresh();auto.overwrite(d.counter)}catch(e){setMessage(errorText(e))}}}>Keep my version (overwrites the newer one)</button></div></div>}
    <nav className="tabs" aria-label="Syllabus steps">{STEPS.map(([id,label])=><button key={id} type="button" className={step===id?'active':''} aria-current={step===id?'step':undefined} onClick={()=>go(id)}>{label}</button>)}</nav>
    {step==='course'&&<CourseStep outline={outline} onChange={o=>auto.setValue({outline:o,grading_policy})}/>}
    {step==='outcomes'&&<OutcomesStep outline={outline} onChange={o=>auto.setValue({outline:o,grading_policy})}/>}
    {step==='chapters'&&<ChaptersStep outline={outline} onChange={o=>auto.setValue({outline:o,grading_policy})}/>}
    {step==='grading'&&<GradingStep policy={grading_policy} onChange={p=>auto.setValue({outline,grading_policy:p})}/>}
    {step==='review'&&<><OutlineView outline={outline} policy={grading_policy}/>
      <section className="panel"><h2>Ready to publish?</h2><p>Publishing makes this version visible to your students. You can keep editing afterwards in a new draft.</p>
        {message&&<p role="alert">{message}</p>}
        <div className="actions"><button className="primary" onClick={publish}>Publish syllabus</button><button onClick={discard}>Discard draft</button></div></section></>}
    {step!=='review'&&message&&<p role="alert">{message}</p>}
    {step!=='review'&&<div className="actions"><button onClick={()=>go('review')}>Review & publish</button><button onClick={discard}>Discard draft</button></div>}
  </>;
}
