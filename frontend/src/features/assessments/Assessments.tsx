import {useState,type FormEvent} from 'react';
import {Link,useNavigate,useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,post,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {GenerateDialog} from '../study/Generate';
import type {OfferingSummary} from '../academics/types';
import {nodeLabels,type SyllabusState} from '../teaching/types';
import {KIND_LABEL,PERIOD_LABEL,type Assessment,type Kind} from './types';

export function usePolicy(offeringId:string){
  const query=useQuery({queryKey:['syllabus',offeringId],queryFn:()=>api<SyllabusState>(`/teach/offerings/${offeringId}/syllabus`)});
  return {policy:query.data?.published?.grading_policy??null,loading:query.isPending};
}

const title=(a:Assessment)=>a.draft?.title||a.published?.title||'Untitled';
const status=(a:Assessment)=>a.archived?'Archived':a.published?(a.draft?`Published v${a.published.version} with newer draft`:`Published v${a.published.version}`):'Draft · not in the gradebook yet';
const resultsLabel=(k:Kind)=>k==='online_quiz'?'Attempts & scores':k==='activity'?'Submissions & scores':'Enter scores';

export function AssessmentsPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const closed=offering.term_status==='closed';
  const navigate=useNavigate();
  const [dialog,setDialog]=useState(false);
  const [generating,setGenerating]=useState(false);
  const [archived,setArchived]=useState(false);const [search,setSearch]=useState('');const [kind,setKind]=useState('');const [state,setState]=useState('');
  const syllabus=useQuery({queryKey:['syllabus',offering.id],queryFn:()=>api<SyllabusState>(`/teach/offerings/${offering.id}/syllabus`)});
  const outline=syllabus.data?.draft?.outline??syllabus.data?.published?.outline;const nodes=outline?nodeLabels(outline):[];
  const query=useQuery({queryKey:['assessments',offering.id],queryFn:()=>api<Assessment[]>(`/teach/offerings/${offering.id}/assessments`)});
  const {policy,loading}=usePolicy(offering.id);
  const base=`/faculty/offerings/${offering.id}/assessments`;
  const list=query.data?.filter(a=>(archived||!a.archived)&&(!kind||a.kind===kind)&&(!state||(state==='published')===!!a.published)&&title(a).toLowerCase().includes(search.trim().toLowerCase()))??[];
  return <>
    <div className="page-heading"><div><h2>Quizzes, activities and exams</h2><p className="muted">Everything that can earn a score. Students only see an assessment once you publish it, and only the results you release.</p></div>
      <div className="actions"><button disabled={closed} onClick={()=>setGenerating(true)}>Draft a quiz with AI</button><button className="primary" disabled={closed} onClick={()=>setDialog(true)}>New assessment</button></div></div>
    {!loading&&!policy&&<p className="warn" role="status">There is no confirmed grading policy yet. Graded work needs one: set the category weights in the <Link to={`/faculty/offerings/${offering.id}/syllabus`}>Syllabus</Link> and publish it. You can still create practice work that does not count toward the grade.</p>}
    <div className="actions"><label>Search<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title"/></label>
      <label>Type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">All types</option>{Object.entries(KIND_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>Status<select value={state} onChange={e=>setState(e.target.value)}><option value="">All</option><option value="draft">Not published</option><option value="published">Published</option></select></label>
      <label className="inline"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/> Show archived</label></div>
    {query.isPending?<p>Loading…</p>:query.error?<p role="alert">{query.error.message}</p>:list.length===0?<section className="panel"><h2>{query.data.length===0?'Nothing here yet':'No assessments match'}</h2><p>{query.data.length===0?'Create a quiz, an activity, an exam or a teacher-evaluated item.':'Change the search or filters.'}</p></section>:
      <ul className="seq" aria-label="Assessments">{list.map(a=>{const rev=a.draft??a.published;const live=a.published;const place=rev?.anchor_node_id?nodes.find(n=>n.id===rev.anchor_node_id)?.label:null;
        return <li key={a.id}>
          <span className="grow"><Link to={`${base}/${a.id}/edit`}>{title(a)}</Link>
            <span className="muted">{KIND_LABEL[a.kind]}{rev?.ai_generated?` · AI draft${rev.reviewed?' reviewed':' needs review'}`:''} · {place??'Not placed in the syllabus'} · {a.section_ids.length===0?'All sections':`${a.section_ids.length} section${a.section_ids.length===1?'':'s'}`}</span>
            <span className="muted">{rev?.include_in_grade?`${policy?.categories.find(c=>c.key===rev.category_key)?.label??rev.category_key??'No category'} · ${rev.period?PERIOD_LABEL[rev.period]:'No period'}`:'Not counted toward the grade'} · {rev?.max_points??0} pts{live?.available_from?` · opens ${new Date(live.available_from).toLocaleString()}`:''}{live?.deadline?` · due ${new Date(live.deadline).toLocaleString()}`:''}</span></span>
          <span className={a.published&&!a.archived?'badge done':'badge'}>{status(a)}</span>
          <span className="actions"><Link className="button" to={`${base}/${a.id}/edit`}>{closed?'View':'Edit'}</Link>{a.published&&<Link className="button" to={`${base}/${a.id}/scores`}>{resultsLabel(a.kind)}</Link>}</span></li>})}</ul>}
    {generating&&<GenerateDialog offering={offering} onClose={()=>setGenerating(false)} onCreated={a=>{setGenerating(false);queryClient.invalidateQueries({queryKey:['assessments',offering.id]});navigate(`${base}/${a.id}/edit`)}}/>}
    {dialog&&<NewDialog offering={offering} onClose={()=>setDialog(false)} onCreated={a=>{setDialog(false);queryClient.invalidateQueries({queryKey:['assessments',offering.id]});navigate(`${base}/${a.id}/edit`)}}/>}
  </>;
}

function NewDialog({offering,onClose,onCreated}:{offering:OfferingSummary;onClose:()=>void;onCreated:(a:Assessment)=>void}){
  const [chosen,setChosen]=useState<string[]>([]);const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);   // read before awaiting
    try{onCreated(await post<Assessment>(`/teach/offerings/${offering.id}/assessments`,{kind:f.get('kind'),title:f.get('title'),section_ids:chosen}))}
    catch(err){setError(errorText(err))}
  }
  return <Dialog title="New assessment" onClose={onClose}><form onSubmit={submit}>
    <label>Type<select name="kind" defaultValue="online_quiz">
      <option value="online_quiz">Online quiz (students answer here, scored automatically)</option>
      <option value="offline_quiz">Paper quiz (you enter the scores)</option>
      <option value="activity">Activity (students upload a PDF, you grade it)</option>
      <option value="exam">Examination (you enter the scores)</option>
      <option value="manual">Teacher-evaluated (participation, recitation, projects…)</option></select></label>
    <label>Title<input name="title" required maxLength={200}/></label>
    <fieldset><legend>Applies to</legend><p className="muted">Leave all unchecked for every section.</p>
      {offering.sections.map(s=><label className="inline" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={e=>setChosen(e.target.checked?[...chosen,s.id]:chosen.filter(x=>x!==s.id))}/> {s.name}</label>)}</fieldset>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Create and set up</button></div>
  </form></Dialog>;
}

