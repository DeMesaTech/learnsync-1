import {useState,type FormEvent} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,post,errorText} from '../../app/api';
import {Dialog} from '../../components/Dialog';
import type {OfferingSummary} from '../academics/types';
import type {Assessment} from '../assessments/types';
import type {Item,SyllabusState} from '../teaching/types';
import {SimulatorNotice} from './Study';
import type {AiStatus} from './types';

/** Faculty ask the AI for a DRAFT quiz from their own published materials; nothing is visible to students until they review and publish it. */
export function GenerateDialog({offering,anchorNodeId,contextLabel,onClose,onCreated}:{offering:OfferingSummary;anchorNodeId?:string|null;contextLabel?:string;onClose:()=>void;onCreated:(a:Assessment)=>void}){
  const status=useQuery({queryKey:['ai-status'],queryFn:()=>api<AiStatus>('/ai/status')});
  const items=useQuery({queryKey:['items',offering.id],queryFn:()=>api<Item[]>(`/teach/offerings/${offering.id}/items`)});
  const syllabus=useQuery({queryKey:['syllabus',offering.id],queryFn:()=>api<SyllabusState>(`/teach/offerings/${offering.id}/syllabus`)});
  const sources=(items.data??[]).filter(i=>i.published&&!i.archived&&(i.published.study_chunks??0)>0);
  const [chosen,setChosen]=useState<string[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const chapters=syllabus.data?.published?.outline.chapters??[];
  const chapterGroups=chapters.map((chapter,index)=>{
    const nodeIds=new Set([chapter.id,...chapter.topics.map(topic=>topic.id),
      ...chapter.subsections.flatMap(section=>[section.id,...section.topics.map(topic=>topic.id)])]);
    const chapterSources=sources.filter(item=>nodeIds.has(item.published?.anchor_node_id??''));
    const number=chapters.slice(0,index).filter(item=>!item.is_intro).length+1;
    return {id:chapter.id,label:chapter.is_intro?`Subject introduction · ${chapter.title||'Untitled chapter'}`:
      `Chapter ${number} · ${chapter.title||'Untitled chapter'}`,sources:chapterSources};
  }).filter(group=>group.sources.length>0);
  const groupedIds=new Set(chapterGroups.flatMap(group=>group.sources.map(item=>item.id)));
  const otherSources=sources.filter(item=>!groupedIds.has(item.id));
  function chooseSources(ids:string[],checked:boolean){
    setChosen(current=>checked?[...new Set([...current,...ids])]:current.filter(id=>!ids.includes(id)));
  }
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);   // read before awaiting
    const count=(k:string)=>Number(f.get(k)||0);
    if(chosen.length===0){setError('Choose at least one lesson or material.');return}
    setBusy(true);setError('');
    try{onCreated(await post<Assessment>(`/teach/offerings/${offering.id}/assessments/generate`,{title:f.get('title'),source_item_ids:chosen,anchor_node_id:anchorNodeId??null,multiple_choice:count('mc'),true_false:count('tf'),short_answer:count('sa'),points:String(f.get('points')||1),language:f.get('language')}))}
    catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }
  const unavailable=status.data&&!status.data.configured;
  return <Dialog title="Draft a quiz with AI" onClose={busy?()=>{}:onClose}><form onSubmit={submit}>
    {contextLabel&&<p className="eyebrow material-context-label">{contextLabel}</p>}
    <SimulatorNotice status={status.data}/>
    {unavailable&&<p className="warn" role="status">AI drafting is not set up on this server yet (no provider key). You can still write quizzes yourself.</p>}
    <p className="muted">The text of the materials you choose is sent to the AI provider. No student names, grades or answers are sent. The result is only a <strong>draft</strong>: you must read every question and mark it reviewed before it can be published.</p>
    <label>Quiz title<input name="title" required maxLength={200} defaultValue="Practice quiz"/></label>
    <fieldset className="study-source-picker"><legend>Based on (published lessons and files with readable text)</legend>
      {items.isPending||syllabus.isPending?<p>Loading published materials and chapters…</p>:items.error?<p role="alert">{items.error.message}</p>:syllabus.error?<p role="alert">Could not load the syllabus chapters. Refresh and try again.</p>:sources.length===0?<p className="muted">Publish a lesson or a file with readable text first. Links need approved text, and scanned PDFs cannot be used.</p>:
        <>
          {chapterGroups.map(group=><fieldset className="study-source-chapter" key={group.id}>
            <legend>{group.label}</legend>
            <label className="inline study-source-select-all"><input type="checkbox"
              checked={group.sources.every(item=>chosen.includes(item.id))}
              onChange={e=>chooseSources(group.sources.map(item=>item.id),e.target.checked)}/> Use all materials in this chapter</label>
            {group.sources.map(item=><label className="inline study-source-item" key={item.id}>
              <input type="checkbox" checked={chosen.includes(item.id)}
                onChange={e=>chooseSources([item.id],e.target.checked)}/> {item.published!.title} <span className="muted">({item.kind})</span>
            </label>)}
          </fieldset>)}
          {otherSources.length>0&&<fieldset className="study-source-chapter">
            <legend>Other materials</legend>
            {otherSources.map(item=><label className="inline study-source-item" key={item.id}>
              <input type="checkbox" checked={chosen.includes(item.id)}
                onChange={e=>chooseSources([item.id],e.target.checked)}/> {item.published!.title} <span className="muted">({item.kind})</span>
            </label>)}
          </fieldset>}
        </>}</fieldset>
    <div className="grid-2"><label>Multiple choice<input name="mc" type="number" min="0" max="30" defaultValue="3"/></label><label>True / false<input name="tf" type="number" min="0" max="30" defaultValue="2"/></label>
      <label>Short answer<input name="sa" type="number" min="0" max="30" defaultValue="1"/></label><label>Points per question<input name="points" type="number" min="0.5" step="0.5" defaultValue="1"/></label></div>
    <label>Language of the questions<select name="language" defaultValue="same"><option value="same">Same as the materials</option><option value="english">English</option><option value="filipino">Filipino</option><option value="taglish">Taglish (mixed)</option></select></label>
    {error&&<p role="alert">{error}</p>}
    {busy&&<p className="muted" role="status">Writing the draft… this can take up to a minute.</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy||!!unavailable}>Create draft</button></div>
  </form></Dialog>;
}
