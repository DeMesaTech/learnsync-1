import {Link,useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import type {OfferingSummary} from '../academics/types';
import {FacultyAnnouncements} from './Announcements';
import {itemTitle} from './Content';
import {assessmentTitle} from '../assessments/Assessments';
import type {Assessment} from '../assessments/types';
import type {Progress} from '../study/types';
import type {Item,LearnItem} from './types';

const uploadedAt=(iso:string)=>new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const KIND:Record<string,string>={lesson:'Lesson',file:'File',reference:'Link',online_quiz:'Quiz',offline_quiz:'Paper quiz',activity:'Activity',exam:'Examination',manual:'Teacher-scored item'};
const ICON:Record<string,string>={lesson:'▱',file:'▣',reference:'↗',online_quiz:'☷',offline_quiz:'▤',activity:'▧',exam:'▤',manual:'✎'};

/** Teachers: published materials, assessments, and section announcements in one subject stream. */
export function FacultyStream(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const items=useQuery({queryKey:['items',offering.id],queryFn:()=>api<Item[]>(`/teach/offerings/${offering.id}/items`)});
  const assessments=useQuery({queryKey:['assessments',offering.id],queryFn:()=>api<Assessment[]>(`/teach/offerings/${offering.id}/assessments`)});
  const base=`/faculty/offerings/${offering.id}`;
  const classwork=[
    ...(items.data??[]).filter(i=>i.published&&!i.archived).map(i=>({key:'i'+i.id,title:itemTitle(i),kind:KIND[i.kind],icon:i.kind,at:i.published!.published_at!,to:`${base}/content/${i.id}/edit`})),
    ...(assessments.data??[]).filter(a=>a.published&&!a.archived).map(a=>({key:'a'+a.id,title:assessmentTitle(a),kind:KIND[a.kind],icon:a.kind,at:a.published!.published_at!,to:`${base}/assessments/${a.id}/scores`})),
  ].filter(r=>r.at).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.key.localeCompare(b.key));
  return <>
    <section className="panel stream-classwork-panel" aria-labelledby="published-content-heading"><h3 id="published-content-heading">Published materials and assessments</h3>
      {classwork.length===0&&<p className="muted">Nothing published yet. Lessons, files, links and assessments you publish appear here.</p>}
      <FacultyAnnouncements embedded>
        {classwork.map(r=><li className="manager-material-row" key={r.key}>
          <span className={`material-kind-icon kind-${r.icon}`} aria-hidden="true">{ICON[r.icon]??'▣'}</span>
          <span className="grow"><Link to={r.to}>{r.title}</Link><span className="muted">{r.kind} · <time dateTime={r.at}>{uploadedAt(r.at)}</time></span></span>
        </li>)}
      </FacultyAnnouncements>
    </section>
  </>;
}

interface Post{id:string;title:string;body:string;published_at:string|null}
interface Results{results:{assessment_id:string;title:string;released_at:string}[];grades:{period:string;published_at:string}[]}
interface Entry{key:string;type:string;title:string;at:string;icon:string;to:string}
type Week={days:{label:string;date:string;count:number;today:boolean;future:boolean}[];lessons_today:number;work_today:number};

function activityWeek(progress:Progress):Week{
  if(progress.week)return progress.week;
  const latest=progress.days.reduce((date,day)=>day.date>date?day.date:date,'');
  if(!latest)return {days:[],lessons_today:0,work_today:0};
  const today=new Date(`${latest}T00:00:00Z`);
  const monday=new Date(today);
  monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
  const counts=new Map(progress.days.map(day=>[day.date,day.count]));
  const labels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const days=labels.map((label,index)=>{
    const date=new Date(monday);
    date.setUTCDate(date.getUTCDate()+index);
    const key=date.toISOString().slice(0,10);
    return {label,date:key,count:counts.get(key)??0,today:key===latest,future:key>latest};
  });
  return {days,lessons_today:0,work_today:counts.get(latest)??0};
}

/** Students: one feed of announcements, new materials, released results and published grades, newest first. */
export function StudentStream(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const base=`/student/offerings/${offering.id}`;
  const posts=useQuery({queryKey:['learn-stream-posts',offering.id],queryFn:()=>api<{items:Post[]}>(`/learn/offerings/${offering.id}/announcements?limit=25&offset=0`)});
  const items=useQuery({queryKey:['learn-items',offering.id],queryFn:()=>api<LearnItem[]>(`/learn/offerings/${offering.id}/items`)});
  const results=useQuery({queryKey:['learn-stream-results',offering.id],queryFn:()=>api<Results>(`/learn/offerings/${offering.id}/results`)});
  const progress=useQuery({queryKey:['progress',offering.id],queryFn:()=>api<Progress>(`/learn/offerings/${offering.id}/progress`)});
  const error=posts.error??items.error??results.error??progress.error;
  if(error)return <p role="alert">{error.message}</p>;
  if(!posts.data||!items.data||!results.data||!progress.data)return <p>Loading…</p>;
  const feed:Entry[]=[
    ...items.data.map(i=>({key:'i'+i.id,type:i.kind==='lesson'?'New lesson':i.kind==='file'?'New file':'New link',title:i.title,at:i.published_at,icon:i.kind,to:`${base}/lessons/${i.id}`})),
    ...results.data.results.map(r=>({key:'r'+r.assessment_id,type:'Result released',title:r.title,at:r.released_at,icon:'result',to:`${base}/results`})),
    ...results.data.grades.map(g=>({key:'g'+g.period,type:'Grade published',title:`${g.period.charAt(0).toUpperCase()+g.period.slice(1)} grade`,at:g.published_at,icon:'manual',to:`${base}/results`})),
  ].sort((a,b)=>a.at<b.at?1:-1).slice(0,30);
  const week=activityWeek(progress.data);
  return <>
    <section className="panel" aria-labelledby="learning-activity-heading">
      <h2 id="learning-activity-heading">Learning activity this week</h2>
      <p className="muted">Lessons, files and links you marked complete and quizzes or activities you submitted. Opening or reading something does not count.</p>
      <ol className="week" aria-label="Activity by day this week">{week.days.map(day=>
        <li key={day.date} className={`${day.count>0?'done':''} ${day.today?'today':''} ${day.future?'future':''}`}>
          <span>{day.today?'Today':day.label}</span><b aria-hidden="true">{day.count>0?'✓':day.today?'○':''}</b>
          <span className="sr-only">{day.count>0?`${day.count} ${day.count===1?'step':'steps'} completed`:day.future?'upcoming':'nothing completed'}</span></li>)}</ol>
      {progress.data.week?<section className="stats" aria-label="Activity today">
        <div><strong>{week.lessons_today}</strong><span>Lessons completed today</span></div>
        <div><strong>{week.work_today}</strong><span>Quizzes and activities submitted today</span></div>
      </section>:<><p className="muted">Daily totals are shown until the activity breakdown is updated.</p>
        <section className="stats" aria-label="Activity today"><div><strong>{week.work_today}</strong><span>Learning steps completed or submitted today</span></div></section></>}
      <Link className="button" to={`${base}/progress`}>View my progress</Link>
    </section>
    <section className="panel student-stream-announcements" aria-labelledby="stream-announcements-heading">
      <h2 id="stream-announcements-heading">Announcements</h2>
      {posts.data.items.length===0?<p className="muted">No announcements for this subject yet.</p>:
        <ul className="seq compact manager-material-list">{posts.data.items.filter(p=>p.published_at).map(p=><li className="manager-material-row" key={p.id}>
          <span className="material-kind-icon kind-announcement" aria-hidden="true">▤</span>
          <span className="grow"><strong>{p.title}</strong><span className="muted"><time dateTime={p.published_at!}>{uploadedAt(p.published_at!)}</time></span>
            <span className="pre stream-announcement-body">{p.body}</span></span>
        </li>)}</ul>}
    </section>
    <section className="panel student-stream-updates" aria-labelledby="stream-updates-heading">
      <h2 id="stream-updates-heading">Published materials and results</h2>
      {feed.length===0?<p className="muted">Published lessons, files, links, released results and grades appear here.</p>:
        <ul className="seq compact manager-material-list">{feed.map(e=><li className="manager-material-row" key={e.key}>
          <span className={`material-kind-icon kind-${e.icon}`} aria-hidden="true">{ICON[e.icon]??'▣'}</span>
          <span className="grow"><Link to={e.to}>{e.title}</Link><span className="muted">{e.type} · <time dateTime={e.at}>{uploadedAt(e.at)}</time></span></span>
        </li>)}</ul>}
    </section>
  </>;
}
