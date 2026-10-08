import {Link} from 'react-router-dom';

export type Cat='lesson'|'quiz'|'activity'|'exam';
export const CATS:[Cat,string][]=[['lesson','Lessons'],['quiz','Quizzes'],['activity','Activities']];
export const FACULTY_CATS:[Cat,string][]=[...CATS,['exam','Exams']];
/** Which Classwork pill an assessment kind belongs to. */
export const catOfKind=(kind:string):Cat=>kind==='online_quiz'||kind==='offline_quiz'?'quiz':kind==='exam'?'exam':'activity';
export const catOf=(v:string|null,cats:[Cat,string][]=CATS):Cat=>cats.find(c=>c[0]===v)?.[0]??cats[0][0];

/** The Classwork type tabs plus Syllabus. They are links, so lessons, work and the syllabus can keep them in view and Back lands on the same tab. */
export function ClassworkTypes({base,current,counts,cats=CATS}:{base:string;current:Cat|'syllabus';counts?:Record<string,number>;cats?:[Cat,string][]}){
  return <nav className="type-tabs" aria-label="Classwork type">{cats.map(([k,l])=>
    <Link key={k} to={`${base}/classwork?type=${k}`} className={current===k?'active':''} aria-current={current===k?'page':undefined}>{l}{counts&&<span className="muted tab-count">{counts[k]}</span>}</Link>)}
    <Link to={`${base}/syllabus`} className={current==='syllabus'?'active':''} aria-current={current==='syllabus'?'page':undefined}>Syllabus</Link></nav>;
}
