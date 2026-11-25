import {FacultyAnnouncements} from './Announcements';
import {Link,useOutletContext} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import type {OfferingSummary} from '../academics/types';
import type {Progress} from '../study/types';

const uploadedAt=(iso:string)=>new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const ANNOUNCEMENT_ICON='▤';

/** Teachers: section announcements. Published learning materials are managed in Classwork. */
export function FacultyStream(){
  return <div className="faculty-stream-announcements"><FacultyAnnouncements/></div>;
}

interface Post{id:string;title:string;body:string;published_at:string|null}
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

/** Students: published announcements, with weekly activity kept in its own panel. */
export function StudentStream(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const base=`/student/offerings/${offering.id}`;
  const posts=useQuery({queryKey:['learn-stream-posts',offering.id],queryFn:()=>api<{items:Post[]}>(`/learn/offerings/${offering.id}/announcements?limit=25&offset=0`)});
  const progress=useQuery({queryKey:['progress',offering.id],queryFn:()=>api<Progress>(`/learn/offerings/${offering.id}/progress`)});
  const error=posts.error??progress.error;
  if(error)return <p role="alert">{error.message}</p>;
  if(!posts.data||!progress.data)return <p>Loading…</p>;
  const announcements=posts.data.items.filter(post=>post.published_at)
    .sort((a,b)=>Date.parse(b.published_at!)-Date.parse(a.published_at!));
  const week=activityWeek(progress.data);
  return <>
    <section className="panel student-stream-updates" aria-labelledby="stream-updates-heading">
      <h2 id="stream-updates-heading">Announcements</h2>
      {announcements.length===0?<p className="muted">No announcements have been published yet.</p>:
        <ul className="seq compact manager-material-list">{announcements.map(post=><li className="manager-material-row" key={post.id}>
          <span className="material-kind-icon kind-announcement" aria-hidden="true">{ANNOUNCEMENT_ICON}</span>
          <span className="grow"><strong>{post.title}</strong><span className="muted">Announcement</span>
            <time className="muted" dateTime={post.published_at!}>{uploadedAt(post.published_at!)}</time>
            <span className="pre stream-announcement-body">{post.body}</span></span>
        </li>)}</ul>}
    </section>
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
  </>;
}
