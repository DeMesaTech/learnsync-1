import {useState} from 'react';
import {Link,useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {ApiError,api} from '../../app/api';
import {useHere} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {ExportPanel} from '../exports/ExportPanel';
import {PERIOD_LABEL,fmt} from './types';

interface Standing{banner:string|null;meta:[string,string][];notes:string[];columns:string[];rows:(string|number|null)[][];student_ids:string[];
  counts:Record<string,number>;ranking:{scope:string;ranked:number;unranked:number;passed:number;average:number|null;highest:number|null;lowest:number|null}}

/** Grades and rank of the enrolled students (faculty only). The rank is computed on the server, once, for both this page and the exports. */
export function ClassStandingPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const here=useHere();
  const [period,setPeriod]=useState('midterm');const [basis,setBasis]=useState<'published'|'working'>('published');
  const [section,setSection]=useState('');const [find,setFind]=useState('');
  const query=useQuery({queryKey:['class-standing',offering.id,period,basis,section],placeholderData:previous=>previous,
    queryFn:()=>api<Standing>(`/teach/offerings/${offering.id}/class-standing?${new URLSearchParams({period,basis,...(section?{section_id:section}:{})})}`)});
  const periods=['midterm','finals','course'];
  const d=query.data;
  const grade=d?d.columns.length-3:0;   // columns: Rank, Student no., Name, Section, criteria…, [Policy version], Grade, Remark, Status
  const rows=d?d.rows.map((r,i)=>({r,id:d.student_ids[i]})).filter(x=>`${x.r[1]} ${x.r[2]}`.toLowerCase().includes(find.trim().toLowerCase())):[];
  const policyProblem=query.error instanceof ApiError&&['policy_missing','policy_incomplete'].includes(query.error.code);
  const mixed=!!d&&d.meta.some(m=>m[0]==='Grading policy'&&m[1].includes(' | '));
  return <>
    <div className="page-heading"><div><h2>Class standing</h2><p className="muted">Grades and rank of the students enrolled in this subject. For you only: students never see ranks. Grades are set and published in the Gradebook.</p></div><Link className="button" to={`/faculty/offerings/${offering.id}/gradebook`}>Open gradebook</Link></div>
    <section className="panel"><div className="grid-2">
      <label>Period<select value={period} onChange={e=>setPeriod(e.target.value)}>{periods.map(p=><option key={p} value={p}>{PERIOD_LABEL[p]??p}</option>)}</select></label>
      <label>Rank within<select value={section} onChange={e=>setSection(e.target.value)}><option value="">All sections of this subject</option>{offering.sections.map(s=><option key={s.id} value={s.id}>Section {s.name}</option>)}</select></label></div>
      <fieldset><legend>Grades to rank</legend>
        <label className="inline"><input type="radio" name="standing-basis" checked={basis==='published'} onChange={()=>setBasis('published')}/> Published grades: the latest release students can see</label>
        <label className="inline"><input type="radio" name="standing-basis" checked={basis==='working'} onChange={()=>setBasis('working')}/> Working preview: today’s calculated values, not released</label></fieldset>
      {basis==='working'&&<p className="warn" role="status">Preview: these values are not published and may still change. Ranks follow them.</p>}</section>
    {query.isPending?<p>Loading…</p>:policyProblem?<section className="panel"><h2>The grading policy is not ready</h2><p role="alert">{query.error!.message}</p><Link className="button primary" to={`/faculty/offerings/${offering.id}/syllabus`}>Open the syllabus</Link></section>:query.error?<p role="alert">{query.error.message}</p>:d&&
      <section className="panel" aria-labelledby="rank-h"><h3 id="rank-h">{PERIOD_LABEL[period]??period}: {d.ranking.scope}</h3>
        <p role="status"><strong>{d.ranking.ranked} ranked</strong> · {d.ranking.unranked} awaiting {basis==='published'?'publication':'calculation'}{d.ranking.ranked>0&&<> · average {fmt(d.ranking.average)} · highest {fmt(d.ranking.highest)} · lowest {fmt(d.ranking.lowest)} · {d.ranking.passed} passed <span className="muted">(of the {d.ranking.ranked} ranked)</span></>}</p>
        <p className="muted">Ties share a rank (1, 2, 2, 4). A student without a {basis==='published'?'published':'complete'} grade is not ranked, which is different from a grade of zero. Search only filters this list; it never changes a rank.{mixed&&' Releases here were made under different grading policy versions and are ranked as recorded.'}</p>
        <label>Find a student<input type="search" value={find} onChange={e=>setFind(e.target.value)} placeholder="Name or student number"/></label>
        {rows.length===0?<p className="muted">No students match.</p>:
        <div className="table-wrap" role="region" tabIndex={0} aria-label="Class standing, scrolls sideways"><table>
          <thead><tr><th scope="col">Rank</th><th scope="col" className="sticky">Student</th><th scope="col">Section</th>{d.columns.slice(4,grade).map(c=><th key={c} scope="col">{c}</th>)}<th scope="col">Grade</th><th scope="col">Remark</th><th scope="col">Status</th></tr></thead>
          <tbody>{rows.map(({r,id})=><tr key={id}>
            <td><strong>{r[0]===null?'—':r[0]}</strong></td>
            <th scope="row" className="sticky"><Link state={here} to={`/faculty/offerings/${offering.id}/students/${id}`}>{r[2]}</Link><br/><span className="muted">{r[1]}</span></th>
            <td>{r[3]}</td>{r.slice(4,grade).map((v,i)=><td key={i}>{typeof v==='number'?fmt(v):v??'—'}</td>)}
            <td><strong>{typeof r[grade]==='number'?fmt(r[grade] as number):'—'}</strong></td><td>{r[grade+1]||'—'}</td><td className="muted">{r[grade+2]}</td></tr>)}</tbody></table></div>}
      </section>}
    <ExportPanel offering={offering} periods={periods} initial={{period,basis,section}} ranked/>
  </>;
}
