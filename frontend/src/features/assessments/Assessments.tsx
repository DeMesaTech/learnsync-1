import {useState,type FormEvent} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,post,errorText} from '../../app/api';
import {Dialog} from '../../components/Dialog';
import type {OfferingSummary} from '../academics/types';
import type {SyllabusState} from '../teaching/types';
import {KIND_LABEL,type Assessment,type Kind} from './types';

export function usePolicy(offeringId:string){
  const query=useQuery({queryKey:['syllabus',offeringId],queryFn:()=>api<SyllabusState>(`/teach/offerings/${offeringId}/syllabus`)});
  return {policy:query.data?.published?.grading_policy??null,loading:query.isPending};
}

export const assessmentTitle=(a:Assessment)=>a.draft?.title||a.published?.title||'Untitled';
export const assessmentStatus=(a:Assessment)=>a.archived?'Archived':a.published?(a.draft?`Published v${a.published.version} with newer draft`:`Published v${a.published.version}`):'Draft · not in the gradebook yet';
export const resultsLabel=(k:Kind)=>k==='online_quiz'?'Attempts & scores':k==='activity'?'Submissions & scores':'Enter scores';

export function NewDialog({offering,kind,onClose,onCreated}:{offering:OfferingSummary;kind?:Kind;onClose:()=>void;onCreated:(a:Assessment)=>void}){
  const [chosen,setChosen]=useState<string[]>([]);const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);   // read before awaiting
    try{onCreated(await post<Assessment>(`/teach/offerings/${offering.id}/assessments`,{kind:kind??f.get('kind'),title:f.get('title'),section_ids:chosen}))}
    catch(err){setError(errorText(err))}
  }
  return <Dialog title={kind?`New ${KIND_LABEL[kind].toLowerCase()}`:'New assessment'} onClose={onClose}><form onSubmit={submit}>
    {!kind&&<label>Type<select name="kind" defaultValue="online_quiz">
      <option value="online_quiz">Online quiz (students answer here, scored automatically)</option>
      <option value="offline_quiz">Paper quiz (you enter the scores)</option>
      <option value="activity">Activity (students upload a PDF, you grade it)</option>
      <option value="exam">Examination (you enter the scores)</option>
      <option value="manual">Teacher-evaluated (participation, recitation, projects…)</option></select></label>}
    <label>Title<input name="title" required maxLength={200}/></label>
    <fieldset><legend>Applies to</legend><p className="muted">Leave all unchecked for every section.</p>
      {offering.sections.map(s=><label className="inline" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={e=>setChosen(e.target.checked?[...chosen,s.id]:chosen.filter(x=>x!==s.id))}/> {s.name}</label>)}</fieldset>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Create and set up</button></div>
  </form></Dialog>;
}

