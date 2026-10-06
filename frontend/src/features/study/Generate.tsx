import {useState,type FormEvent} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,post,errorText} from '../../app/api';
import {Dialog} from '../../components/Dialog';
import type {OfferingSummary} from '../academics/types';
import type {Assessment} from '../assessments/types';
import type {Item} from '../teaching/types';
import {SimulatorNotice} from './Study';
import type {AiStatus} from './types';

/** Faculty ask the AI for a DRAFT quiz from their own published materials; nothing is visible to students until they review and publish it. */
export function GenerateDialog({offering,onClose,onCreated}:{offering:OfferingSummary;onClose:()=>void;onCreated:(a:Assessment)=>void}){
  const status=useQuery({queryKey:['ai-status'],queryFn:()=>api<AiStatus>('/ai/status')});
  const items=useQuery({queryKey:['items',offering.id],queryFn:()=>api<Item[]>(`/teach/offerings/${offering.id}/items`)});
  const sources=(items.data??[]).filter(i=>i.published&&!i.archived&&(i.published.study_chunks??0)>0);
  const [chosen,setChosen]=useState<string[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);   // read before awaiting
    const count=(k:string)=>Number(f.get(k)||0);
    if(chosen.length===0){setError('Choose at least one lesson or material.');return}
    setBusy(true);setError('');
    try{onCreated(await post<Assessment>(`/teach/offerings/${offering.id}/assessments/generate`,{title:f.get('title'),source_item_ids:chosen,multiple_choice:count('mc'),true_false:count('tf'),short_answer:count('sa'),points:String(f.get('points')||1),language:f.get('language')}))}
    catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }
  const unavailable=status.data&&!status.data.configured;
  return <Dialog title="Draft a quiz with AI" onClose={busy?()=>{}:onClose}><form onSubmit={submit}>
    <SimulatorNotice status={status.data}/>
    {unavailable&&<p className="warn" role="status">AI drafting is not set up on this server yet (no provider key). You can still write quizzes yourself.</p>}
    <p className="muted">The text of the materials you choose is sent to the AI provider. No student names, grades or answers are sent. The result is only a <strong>draft</strong>: you must read every question and mark it reviewed before it can be published.</p>
    <label>Quiz title<input name="title" required maxLength={200} defaultValue="Practice quiz"/></label>
    <fieldset><legend>Based on (published lessons and files with readable text)</legend>
      {items.isPending?<p>Loading…</p>:sources.length===0?<p className="muted">Publish a lesson or a file with readable text first. Links need approved text, and scanned PDFs cannot be used.</p>:
        sources.map(i=><label className="inline" key={i.id}><input type="checkbox" checked={chosen.includes(i.id)} onChange={e=>setChosen(e.target.checked?[...chosen,i.id]:chosen.filter(x=>x!==i.id))}/> {i.published!.title} <span className="muted">({i.kind})</span></label>)}</fieldset>
    <div className="grid-2"><label>Multiple choice<input name="mc" type="number" min="0" max="30" defaultValue="3"/></label><label>True / false<input name="tf" type="number" min="0" max="30" defaultValue="2"/></label>
      <label>Short answer<input name="sa" type="number" min="0" max="30" defaultValue="1"/></label><label>Points per question<input name="points" type="number" min="0.5" step="0.5" defaultValue="1"/></label></div>
    <label>Language of the questions<select name="language" defaultValue="same"><option value="same">Same as the materials</option><option value="english">English</option><option value="filipino">Filipino</option><option value="taglish">Taglish (mixed)</option></select></label>
    {error&&<p role="alert">{error}</p>}
    {busy&&<p className="muted" role="status">Writing the draft… this can take up to a minute.</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy||!!unavailable}>Create draft</button></div>
  </form></Dialog>;
}
