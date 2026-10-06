import {useState} from 'react';
import {Link,useLocation,useOutletContext,useParams} from 'react-router-dom';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {api,post,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {useHere,useOrigin} from '../../components/origin';
import type {OfferingSummary} from '../academics/types';
import {OutlineView} from './OutlineView';
import {groupByNode,nodeLabels,type LearnItem,type LearnSyllabus,type Announcement} from './types';

const when=(iso:string)=>new Date(iso).toLocaleDateString();

export function StudentSyllabus(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const query=useQuery({queryKey:['learn-syllabus',offering.id],queryFn:()=>api<LearnSyllabus>(`/learn/offerings/${offering.id}/syllabus`)});
  const items=useQuery({queryKey:['learn-items',offering.id],queryFn:()=>api<LearnItem[]>(`/learn/offerings/${offering.id}/items`)});
  const here=useHere();
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  const {published,covered}=query.data;
  // published lessons and materials attached to a chapter or topic of the outline, shown beside it
  const linked=new Map<string,LearnItem[]>();
  for(const i of items.data??[])if(i.anchor_node_id)linked.set(i.anchor_node_id,[...(linked.get(i.anchor_node_id)??[]),i]);
  const materials=(nodeId:string)=>{const list=linked.get(nodeId);if(!list)return null;
    return <span className="linked" aria-label="Lessons and materials for this part">{list.map(i=>i.kind==='file'&&i.file?
      <a key={i.id} href={`/api/files/${i.file.id}/download`}>▤ {i.title}</a>:
      <Link key={i.id} state={here} to={`/student/offerings/${offering.id}/lessons/${i.id}`}>▤ {i.title}</Link>)}</span>};
  if(!published)return <section className="panel"><h2>The syllabus is not published yet</h2><p>Your teacher will publish it here.</p></section>;
  return <><p className="muted">Version {published.version} · published {when(published.published_at)}. “Covered in class” is your teacher’s record, not your own progress.</p>
    <OutlineView outline={published.outline} policy={published.grading_policy} coveredOn={new Map(covered.map(c=>[c.node_id,c.covered_on]))} extra={materials}/></>;
}

export function StudentLessons(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const query=useQuery({queryKey:['learn-items',offering.id],queryFn:()=>api<LearnItem[]>(`/learn/offerings/${offering.id}/items`)});
  const syllabus=useQuery({queryKey:['learn-syllabus',offering.id],queryFn:()=>api<LearnSyllabus>(`/learn/offerings/${offering.id}/syllabus`)});
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  if(query.data.length===0)return <section className="panel"><h2>No lessons or materials yet</h2><p>Published lessons, files and links appear here.</p></section>;
  const outline=syllabus.data?.published?.outline;
  const groups=groupByNode(query.data,outline?nodeLabels(outline):[],i=>i.anchor_node_id);
  const base=`/student/offerings/${offering.id}`;
  const lessons=query.data.filter(i=>i.kind==='lesson');const finished=lessons.filter(i=>i.completed).length;
  const next=query.data.find(i=>i.up_next);
  return <>
    {lessons.length>0&&<div className="seq-head"><p><strong>{finished} of {lessons.length}</strong> lessons marked complete.</p>
      {next?<Link className="button primary" to={`${base}/lessons/${next.id}`}>Continue: {next.title}</Link>
        :<><p role="status">All published lessons completed.</p><Link className="button" to={`${base}/work`}>Go to my work</Link></>}</div>}
    {groups.map(g=><section key={g.id??'other'} aria-labelledby={`g-${g.id??'other'}`}><h3 id={`g-${g.id??'other'}`}>{g.label}</h3>
      <ul className="seq">{g.items.map(i=><li key={i.id} className={i.up_next?'next':undefined}>
        <span className="grow">{i.kind==='file'&&i.file?<a href={`/api/files/${i.file.id}/download`}>{i.title}</a>:<Link to={`${base}/lessons/${i.id}`}>{i.title}</Link>}
          <span className="muted">{({lesson:'Lesson',file:`File · ${i.file?.name??''}`,reference:'Link'})[i.kind]}</span></span>
        {i.up_next&&<span className="badge next">Up next</span>}
        {i.kind==='lesson'&&(i.completed?<span className="badge done">✓ Completed</span>:<span className="badge">Not marked complete</span>)}</li>)}</ul></section>)}
  </>;
}

export function StudentLesson(){
  const {offeringId,itemId}=useParams();
  const query=useQuery({queryKey:['learn-item',offeringId,itemId],queryFn:()=>api<LearnItem>(`/learn/offerings/${offeringId}/items/${itemId}`)});
  const parent=`/student/offerings/${offeringId}/lessons`;
  const origin=useOrigin(parent,'Lessons & materials');const back=origin.to;
  const carried=useLocation().state;
  const [marking,setMarking]=useState(false);const [problem,setProblem]=useState('');
  async function complete(){setMarking(true);setProblem('');try{await post(`/learn/offerings/${offeringId}/lessons/${itemId}/complete`,{});await Promise.all(['progress','learn-item','learn-items'].map(k=>queryClient.invalidateQueries({queryKey:[k,offeringId]})))}catch(e){setProblem(errorText(e))}finally{setMarking(false)}}
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <section className="panel"><h2>Not available</h2><p role="alert">{query.error.message}</p><Link to={back}>Back to lessons</Link></section>;
  const i=query.data;
  return <article className="panel"><p className="back"><Link to={back}>← Back to {origin.label}</Link></p><h2>{i.title}</h2>
    {i.kind==='lesson'&&<div className="rich-content" dangerouslySetInnerHTML={{__html:i.body_html??''}}/>}
    {i.kind==='lesson'&&<div className="actions">{i.completed?<span className="badge covered">✓ You marked this lesson complete</span>:<button className="primary" disabled={marking} onClick={complete}>Mark lesson as complete</button>}<Link className="button" to={`/student/offerings/${offeringId}/study`}>Ask study help</Link></div>}
    {i.kind==='lesson'&&i.completed&&<p role="status" className="seq-head">{i.next_lesson?<Link className="button primary" state={carried} to={`${parent}/${i.next_lesson.id}`}>Next lesson: {i.next_lesson.title}</Link>
      :i.all_completed?<><span>All published lessons completed.</span><Link className="button" to={`/student/offerings/${offeringId}/work`}>Go to my work</Link></>
      :<><span>End of the lesson sequence. Some earlier lessons are not marked complete yet.</span>{i.first_incomplete&&<Link className="button" state={carried} to={`${parent}/${i.first_incomplete.id}`}>Go to: {i.first_incomplete.title}</Link>}</>}</p>}
    {i.kind==='lesson'&&i.lesson_number&&<p className="muted">Lesson {i.lesson_number} of {i.lesson_total}</p>}
    {problem&&<p role="alert">{problem}</p>}
    {i.kind==='reference'&&<><p><a href={i.reference_url??'#'} target="_blank" rel="noopener noreferrer">{i.reference_url}</a></p>{i.reference_note&&<p className="pre">{i.reference_note}</p>}</>}
    {i.kind==='file'&&i.file&&<p><a className="button primary" href={`/api/files/${i.file.id}/download`}>Download {i.file.name}</a></p>}</article>;
}

export function StudentAnnouncements(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  type Row=Pick<Announcement,'id'|'title'|'body'|'published_at'>;
  const query=useInfiniteQuery({queryKey:['learn-announcements',offering.id],initialPageParam:0,queryFn:({pageParam})=>api<{items:Row[];has_more:boolean}>(`/learn/offerings/${offering.id}/announcements?limit=25&offset=${pageParam}`),getNextPageParam:(p,all)=>p.has_more?all.length*25:undefined});
  const rows=query.data?.pages.flatMap(p=>p.items)??[];
  if(query.isPending)return <p>Loading…</p>;
  if(query.error)return <p role="alert">{query.error.message}</p>;
  if(rows.length===0)return <section className="panel"><h2>No announcements</h2></section>;
  return <div className="cards">{rows.map(a=><article className="panel" key={a.id}><p className="eyebrow">{a.published_at?when(a.published_at):''}</p><h3>{a.title}</h3><p className="pre">{a.body}</p></article>)}{query.hasNextPage&&<button disabled={query.isFetchingNextPage} onClick={()=>query.fetchNextPage()}>{query.isFetchingNextPage?'Loading…':'Load more announcements'}</button>}</div>;
}
