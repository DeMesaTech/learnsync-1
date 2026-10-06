import {useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import type {OfferingSummary} from '../academics/types';
import {PERIOD_LABEL,fmt,when,type Results} from './types';

export function ResultsPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const query=useQuery({queryKey:['learn-results',offering.id],queryFn:()=>api<Results>(`/learn/offerings/${offering.id}/results`)});
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  const {results,grades}=query.data;
  return <>
    <h2>Grades & results</h2>
    <h3>Published grades</h3>
    {grades.length===0?<section className="panel"><p>No grades have been published yet. Your teacher publishes each period when it is ready.</p></section>:
      <div className="cards">{grades.map(g=><article className="panel" key={g.period}><p className="eyebrow">{PERIOD_LABEL[g.period]??g.period} grade</p>
        <p className="big">{fmt(g.grade)}</p><p><span className="badge">{g.remark==='passed'?'Passed':'Below passing'}</span></p>
        <p className="muted">Published {when(g.published_at)}{g.release_number>1?` · updated (version ${g.release_number})`:''}</p></article>)}</div>}
    <h3>Released assessment results</h3>
    {results.length===0?<section className="panel"><p>Nothing has been released yet. Quiz totals appear here as soon as you submit; other results appear when your teacher releases them.</p></section>:
      <section className="panel"><div className="table-wrap" role="region" aria-label="Released results" tabIndex={0}><table>
        <thead><tr><th>Assessment</th><th>Score</th><th>Feedback</th><th>Released</th></tr></thead>
        <tbody>{results.map(r=><tr key={r.assessment_id}><td>{r.title}</td><td>{fmt(r.score)} / {fmt(r.max_points)}</td><td className="pre">{r.feedback}</td><td>{when(r.released_at)}{r.release_number>1?' (updated)':''}</td></tr>)}</tbody></table></div></section>}
    <p className="muted">Grades are calculated by your teacher from your released and unreleased work, so a grade can include scores you have not seen yet.</p>
  </>;
}
