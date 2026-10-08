import {Link,useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import type {OfferingSummary} from '../academics/types';
import {FacultyAnnouncements} from './Announcements';
import {itemTitle} from './Content';
import {assessmentTitle} from '../assessments/Assessments';
import type {Assessment} from '../assessments/types';
import type {Item,LearnItem} from './types';

const day=(iso:string)=>new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const KIND:Record<string,string>={lesson:'Lesson',file:'File',reference:'Link',online_quiz:'Quiz',offline_quiz:'Paper quiz',activity:'Activity',exam:'Examination',manual:'Teacher-scored item'};

/** Teachers: announcements to the sections, then what was published lately. */
export function FacultyStream(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const items=useQuery({queryKey:['items',offering.id],queryFn:()=>api<Item[]>(`/teach/offerings/${offering.id}/items`)});
  const assessments=useQuery({queryKey:['assessments',offering.id],queryFn:()=>api<Assessment[]>(`/teach/offerings/${offering.id}/assessments`)});
  const base=`/faculty/offerings/${offering.id}`;
  const recent=[
    ...(items.data??[]).filter(i=>i.published&&!i.archived).map(i=>({key:'i'+i.id,title:itemTitle(i),kind:KIND[i.kind],at:i.published!.published_at!,to:`${base}/content/${i.id}/edit`})),
    ...(assessments.data??[]).filter(a=>a.published&&!a.archived).map(a=>({key:'a'+a.id,title:assessmentTitle(a),kind:KIND[a.kind],at:a.published!.published_at!,to:`${base}/assessments/${a.id}/scores`})),
  ].filter(r=>r.at).sort((a,b)=>a.at<b.at?1:-1).slice(0,6);
  return <>
    <FacultyAnnouncements/>
    <section className="panel" aria-labelledby="recent-h"><h3 id="recent-h">Recently published</h3>
      {recent.length===0?<p className="muted">Nothing published yet. Lessons, files, links and assessments you publish appear here.</p>
        :<ul className="rows">{recent.map(r=><li key={r.key}><Link to={r.to}>{r.title}</Link><span className="muted">{r.kind} · {day(r.at)}</span></li>)}</ul>}</section>
  </>;
}

interface Post{id:string;title:string;body:string;published_at:string|null}
interface Results{results:{assessment_id:string;title:string;released_at:string}[];grades:{period:string;published_at:string}[]}
interface Entry{key:string;type:string;title:string;at:string;body?:string;to?:string}

/** Students: one feed of announcements, new materials, released results and published grades, newest first. */
export function StudentStream(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const base=`/student/offerings/${offering.id}`;
  const posts=useQuery({queryKey:['learn-stream-posts',offering.id],queryFn:()=>api<{items:Post[]}>(`/learn/offerings/${offering.id}/announcements?limit=25&offset=0`)});
  const items=useQuery({queryKey:['learn-items',offering.id],queryFn:()=>api<LearnItem[]>(`/learn/offerings/${offering.id}/items`)});
  const results=useQuery({queryKey:['learn-stream-results',offering.id],queryFn:()=>api<Results>(`/learn/offerings/${offering.id}/results`)});
  const error=posts.error??items.error??results.error;
  if(error)return <p role="alert">{error.message}</p>;
  if(!posts.data||!items.data||!results.data)return <p>Loading…</p>;
  const feed:Entry[]=[
    ...posts.data.items.filter(p=>p.published_at).map(p=>({key:'p'+p.id,type:'Announcement',title:p.title,at:p.published_at!,body:p.body})),
    ...items.data.map(i=>({key:'i'+i.id,type:i.kind==='lesson'?'New lesson':i.kind==='file'?'New file':'New link',title:i.title,at:i.published_at,to:`${base}/lessons/${i.id}`})),
    ...results.data.results.map(r=>({key:'r'+r.assessment_id,type:'Result released',title:r.title,at:r.released_at,to:`${base}/results`})),
    ...results.data.grades.map(g=>({key:'g'+g.period,type:'Grade published',title:`${g.period.charAt(0).toUpperCase()+g.period.slice(1)} grade`,at:g.published_at,to:`${base}/results`})),
  ].sort((a,b)=>a.at<b.at?1:-1).slice(0,30);
  if(feed.length===0)return <section className="panel"><h2>Nothing yet</h2><p className="muted">Announcements, new lessons and released results from your teacher appear here.</p></section>;
  return <div className="cards">{feed.map(e=><article className="panel" key={e.key}>
    <p className="eyebrow">{e.type} · {day(e.at)}</p>
    <h3>{e.to?<Link className="touch" to={e.to}>{e.title}</Link>:e.title}</h3>{e.body&&<p className="pre">{e.body}</p>}</article>)}</div>;
}
