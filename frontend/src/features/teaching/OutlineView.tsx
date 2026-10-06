import type {ReactNode} from 'react';
import type {GradingPolicy,Outline} from './types';

/** Read-only syllabus. `coveredOn` marks faculty-recorded coverage; `extra` renders per-node actions. */
export function OutlineView({outline,policy,coveredOn,extra}:{outline:Outline;policy?:GradingPolicy|null;coveredOn?:Map<string,string>;extra?:(nodeId:string)=>ReactNode}){
  const c=outline.course;
  const tag=(id:string)=>coveredOn?.has(id)?<span className="badge covered">Covered in class · {coveredOn.get(id)}</span>:null;
  return <div className="outline">
    <section className="panel"><h2>{c.name||'Untitled course'}</h2>
      <p className="muted">{[c.code,c.units&&`${c.units} units`,c.contact_hours,c.prerequisite&&`Pre-requisite: ${c.prerequisite}`].filter(Boolean).join(' · ')}</p>
      {c.description&&<p>{c.description}</p>}
      {c.values&&<><h3>Values integration</h3><p>{c.values}</p></>}</section>
    {outline.outcomes.length>0&&<section className="panel"><h2>Course learning outcomes</h2><ul>{outline.outcomes.map(o=><li key={o.id}>{o.text}</li>)}</ul></section>}
    <section className="panel"><h2>Course coverage</h2>
      {outline.chapters.length===0&&<p className="muted">No chapters yet.</p>}
      {outline.chapters.map(ch=><article className="chapter" key={ch.id}>
        <h3>{ch.title||'Untitled'} {ch.weeks&&<span className="muted">· {ch.weeks}</span>} {tag(ch.id)}</h3>
        {extra?.(ch.id)}
        {ch.ilo&&<p><strong>Learning outcomes:</strong> {ch.ilo}</p>}
        {ch.topics.length>0&&<ul>{ch.topics.map(t=><li key={t.id}>{t.title} {tag(t.id)} {extra?.(t.id)}</li>)}</ul>}
        {ch.activities&&<p><strong>Activities:</strong> {ch.activities}</p>}
        {ch.assessment&&<p><strong>Assessment:</strong> {ch.assessment}</p>}</article>)}</section>
    {(c.references||c.requirements||c.evaluation_note)&&<section className="panel">
      {c.evaluation_note&&<><h2>Course evaluation</h2><p className="pre">{c.evaluation_note}</p></>}
      {c.requirements&&<><h2>Classroom requirements</h2><p className="pre">{c.requirements}</p></>}
      {c.references&&<><h2>References</h2><p className="pre">{c.references}</p></>}</section>}
    {policy&&<section className="panel"><h2>Grading</h2>
      <ul>{policy.categories.map(k=><li key={k.key}>{k.label}: {k.weight}%</li>)}</ul>
      <p className="muted">{policy.periods.map(p=>`${p.label} ${p.share}%`).join(' · ')} · Passing {policy.passing}</p></section>}
  </div>;
}
