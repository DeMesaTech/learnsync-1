import type React from 'react';
import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useOutletContext,useSearchParams} from 'react-router-dom';
import {ClassworkTypes,FACULTY_CATS,catOf,CATS,type Cat} from '../../components/ClassworkTypes';
import {useHere} from '../../components/origin';
import {useQuery} from '@tanstack/react-query';
import {api,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import type {OfferingSummary} from '../academics/types';
import {GenerateDialog} from '../study/Generate';
import {NewDialog,assessmentStatus,assessmentTitle,usePolicy} from '../assessments/Assessments';
import {detail as workDetail} from '../assessments/Work';
import {KIND_LABEL,fmt,type Assessment,type Kind,type LearnItem as Work} from '../assessments/types';
import {KIND,NewItemDialog,itemTitle,stateLabel,useNodes} from './Content';
import {groupByNode,type Item,type LearnItem,type LearnSyllabus,type Outline,type SyllabusState} from './types';

type Create={type:'item';kind:Item['kind']}|{type:'assessment';kind:Kind}|{type:'ai'}|null;
interface Row{cat:Cat;key:string;type:'item'|'assessment';id:string;title:string;label:string;anchor:string|null;archived:boolean;status:string;published:boolean;to:string;meta:string}

const CREATE:[string,Create|'stream'][]=[['Lesson',{type:'item',kind:'lesson'}],['File',{type:'item',kind:'file'}],['Link',{type:'item',kind:'reference'}],
  ['Quiz',{type:'assessment',kind:'online_quiz'}],['Paper quiz',{type:'assessment',kind:'offline_quiz'}],['Activity',{type:'assessment',kind:'activity'}],['Examination',{type:'assessment',kind:'exam'}],
  ['Teacher-scored item',{type:'assessment',kind:'manual'}],['Quiz drafted by AI',{type:'ai'}],['Announcement','stream']];

/** Teachers: everything you teach and assign in one place, grouped by syllabus topic, with one Create menu. */
export function FacultyClasswork(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const closed=offering.term_status==='closed';
  const navigate=useNavigate();
  const base=`/faculty/offerings/${offering.id}`;
  const items=useQuery({queryKey:['items',offering.id],queryFn:()=>api<Item[]>(`/teach/offerings/${offering.id}/items`)});
  const assessments=useQuery({queryKey:['assessments',offering.id],queryFn:()=>api<Assessment[]>(`/teach/offerings/${offering.id}/assessments`)});
  const syllabus=useQuery({queryKey:['syllabus',offering.id],queryFn:()=>api<SyllabusState>(`/teach/offerings/${offering.id}/syllabus`)});
  const nodes=useNodes(offering.id);
  const {policy}=usePolicy(offering.id);
  const [create,setCreate]=useState<Create>(null);
  const [search,setSearch]=useState('');const [archived,setArchived]=useState(false);
  const cat=catOf(useSearchParams()[0].get('type'),FACULTY_CATS);
  const [statuses,setStatuses]=useState<Record<string,'all'|'published'|'draft'>>({});const status=statuses[cat]??'all';
  const [reorder,setReorder]=useState<string|null>(null);const [moved,setMoved]=useState('');
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const outside=(e:Event)=>{const d=menu.current;if(d?.open&&!(e.target instanceof Node&&d.contains(e.target)))d.open=false};
    const escape=(e:KeyboardEvent)=>{const d=menu.current;if(e.key==='Escape'&&d?.open){d.open=false;d.querySelector('summary')?.focus()}};
    document.addEventListener('click',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('click',outside);document.removeEventListener('keydown',escape)};
  },[]);
  const choose=(c:Create|'stream')=>{if(menu.current)menu.current.open=false;if(c==='stream')navigate(`${base}/stream`);else setCreate(c)};

  const rows:Row[]=[
    ...(items.data??[]).map(i=>({cat:'lesson' as Cat,key:'i'+i.id,type:'item' as const,id:i.id,title:itemTitle(i),label:KIND[i.kind],anchor:(i.published??i.draft)?.anchor_node_id??null,archived:i.archived,
      status:stateLabel(i),published:!!i.published,to:`${base}/content/${i.id}/edit`,meta:`${KIND[i.kind]}${i.section_ids.length>0?` · ${i.section_ids.length} section${i.section_ids.length===1?'':'s'}`:''}`})),
    ...(assessments.data??[]).map(a=>{const rev=a.draft??a.published;
      return {cat:(a.kind==='online_quiz'||a.kind==='offline_quiz'?'quiz':a.kind==='exam'?'exam':'activity') as Cat,key:'a'+a.id,type:'assessment' as const,id:a.id,title:assessmentTitle(a),label:KIND_LABEL[a.kind],anchor:rev?.anchor_node_id??null,archived:a.archived,status:assessmentStatus(a),published:!!a.published,
        to:a.published?`${base}/assessments/${a.id}/scores`:`${base}/assessments/${a.id}/edit`,
        meta:`${KIND_LABEL[a.kind]}${rev?.ai_generated?` · AI draft${rev.reviewed?' reviewed':' needs review'}`:''}${rev?.include_in_grade?` · ${fmt(rev.max_points??0)} pts`:' · not graded'}${a.published?.deadline?` · due ${new Date(a.published.deadline).toLocaleDateString()}`:''}`}})];
  const match=(r:Row)=>r.title.toLowerCase().includes(search.trim().toLowerCase());
  const byStatus=(r:Row,k:'all'|'published'|'draft')=>k==='all'||(k==='published'?r.published:!r.published);
  const shown=(r:Row)=>r.cat===cat&&(archived||!r.archived)&&match(r)&&byStatus(r,status);
  const outline=syllabus.data?.draft?.outline??syllabus.data?.published?.outline;
  const known=new Set(nodes.map(n=>n.id));
  const tree=buildTree(outline,rows.filter(shown));
  const published=syllabus.data?.published;const draft=syllabus.data?.draft;

  const inNode=(n:TNode<Row>,r:Row)=>n.id==='other'?(!r.anchor||!known.has(r.anchor)):r.anchor===n.id;
  async function move(n:TNode<Row>,visible:Row[],row:Row,step:number){
    const other=visible[visible.indexOf(row)+step];if(!other)return;
    const everyone=rows.filter(r=>r.type==='item'&&inNode(n,r)).map(r=>r.id);const all=[...everyone];const a=all.indexOf(row.id),b=all.indexOf(other.id);[all[a],all[b]]=[all[b],all[a]];
    try{await send('PUT',`/teach/offerings/${offering.id}/items-order`,{anchor_node_id:n.id==='other'?null:n.id,expected_ids:everyone,item_ids:all});
      await queryClient.invalidateQueries({queryKey:['items',offering.id]});setMoved(`Moved “${row.title}” ${step<0?'up':'down'} to position ${visible.indexOf(row)+step+1} of ${visible.length}.`)}
    catch(e){setMoved(errorText(e));queryClient.invalidateQueries({queryKey:['items',offering.id]})}
  }
  const created=(to:string)=>{setCreate(null);queryClient.invalidateQueries({queryKey:['items',offering.id]});queryClient.invalidateQueries({queryKey:['assessments',offering.id]});navigate(to)};

  const stranded=rows.find(r=>r.type==='item'&&r.anchor&&!known.has(r.anchor));   // its topic left the syllabus: fix it before reordering
  const count=(k:'all'|'published'|'draft')=>rows.filter(r=>r.cat===cat&&(archived||!r.archived)&&byStatus(r,k)).length;
  const branch=(n:TNode<Row>,depth:number):React.ReactElement=>{
    const Heading=(['h3','h4','h5'] as const)[Math.min(depth,2)];
    const items=n.rows.filter(r=>r.type==='item');
    return <section key={n.id} className={`tree d${Math.min(depth,2)}`} aria-labelledby={`c-${n.id}`}>
      <header><Heading id={`c-${n.id}`}>{n.title}</Heading><span className="count">{total(n)}</span>
        {items.length>1&&!closed&&!stranded&&<button type="button" className="linklike" aria-pressed={reorder===n.id} onClick={()=>setReorder(reorder===n.id?null:n.id)}>{reorder===n.id?'Done reordering':'Reorder'}</button>}</header>
      {n.rows.length>0&&<ul className="seq compact">{n.rows.map(r=><li key={r.key}>
        <span className="grow"><Link to={r.to}>{r.title}</Link><span className="muted">{r.meta}</span></span>
        <span className={r.published&&!r.archived?'badge done':'badge'}>{r.status}</span>
        {reorder===n.id&&r.type==='item'&&<span className="actions"><button type="button" aria-label={`Move ${r.title} up`} disabled={closed||items.indexOf(r)===0} onClick={()=>move(n,items,r,-1)}>↑</button>
          <button type="button" aria-label={`Move ${r.title} down`} disabled={closed||items.indexOf(r)===items.length-1} onClick={()=>move(n,items,r,1)}>↓</button></span>}</li>)}</ul>}
      {n.kids.map(k=>branch(k,depth+1))}</section>};
  const label=FACULTY_CATS.find(c=>c[0]===cat)![1];
  return <>
    <div className="type-row"><ClassworkTypes base={base} cats={FACULTY_CATS} current={cat} counts={Object.fromEntries(FACULTY_CATS.map(([k])=>[k,rows.filter(r=>r.cat===k&&(archived||!r.archived)).length]))}/>
      <details className="dropdown" ref={menu}><summary className={`button primary${closed?' disabled':''}`} aria-disabled={closed} onClick={e=>{if(closed)e.preventDefault()}}>+ Create</summary>
        <div className="menu-list" role="group" aria-label="Create">{CREATE.map(([label,target],i)=><span key={label} className="menu-item">{(i===3||i===8)&&<hr/>}
          <button type="button" onClick={()=>choose(target)}>{label}</button></span>)}</div></details></div>
    {!published&&!draft&&!closed&&<section className="panel" aria-labelledby="syl-h"><h3 id="syl-h">Set up this subject</h3><p className="muted">Not set up yet. A guided setup creates the syllabus, grading policy and first topics in a few steps.</p>
      <Link className="button primary" to={`${base}/setup`}>Set up this subject</Link></section>}
    <div className="cw-bar"><p className="muted">Students only see what you publish: edits stay drafts until you do.</p>
      <div className="segmented" role="group" aria-label="Show">{([['all','Everything'],['published','Published'],['draft','Drafts']] as const).map(([k,l])=>
        <button key={k} type="button" className={status===k?'on':''} aria-pressed={status===k} onClick={()=>setStatuses({...statuses,[cat]:k})}>{l} <span className="muted">{count(k)}</span></button>)}</div></div>
    <details className="more"><summary>Search and archived</summary><div className="actions"><label>Search<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title"/></label>
      <label className="inline"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/> Show archived</label></div></details>
    {(items.isPending||assessments.isPending)?<p>Loading…</p>:items.error||assessments.error?<p role="alert">{(items.error??assessments.error)!.message}</p>:
      tree.length===0?<section className="panel"><h2>{search||status!=='all'?'Nothing matches':`No ${label.toLowerCase()} yet`}</h2><p>{search||status!=='all'?'Change the search or the filter.':'Use Create to add one.'}</p></section>:
      <>{moved&&<p role="status" className="muted">{moved}</p>}
      {stranded&&<p className="warn" role="status">Items cannot be reordered because some are attached to a topic that is no longer in the syllabus. <Link to={stranded.to}>Open “{stranded.title}”</Link> and choose a current topic.</p>}
      {tree.length===1&&tree[0].id==='other'?<ul className="seq compact" aria-label={label}>{tree[0].rows.map(r=><li key={r.key}><span className="grow"><Link to={r.to}>{r.title}</Link><span className="muted">{r.meta}</span></span>
        <span className={r.published&&!r.archived?'badge done':'badge'}>{r.status}</span></li>)}</ul>:tree.map(n=>branch(n,0))}</>}
    {create?.type==='item'&&<NewItemDialog offering={offering} nodes={nodes} kind={create.kind} onClose={()=>setCreate(null)} onCreated={i=>created(`${base}/content/${i.id}/edit`)}/>}
    {create?.type==='assessment'&&<NewDialog offering={offering} kind={create.kind} onClose={()=>setCreate(null)} onCreated={a=>created(`${base}/assessments/${a.id}/edit`)}/>}
    {create?.type==='ai'&&<GenerateDialog offering={offering} onClose={()=>setCreate(null)} onCreated={a=>created(`${base}/assessments/${a.id}/edit`)}/>}
  </>;
}

interface WorkRow extends Work{anchor_node_id?:string|null}
interface SRow{key:string;kind:'item'|'work';cat:'lesson'|'quiz'|'activity';title:string;anchor:string|null;to:string;label:string;detail:string;chips:{text:string;cls?:string}[];todo:boolean;done:boolean;result?:string}
type Filter='all'|'todo'|'done';

interface TNode<T=SRow>{id:string;title:string;rows:T[];kids:TNode<T>[]}
const total=<T,>(n:TNode<T>):number=>n.rows.length+n.kids.reduce((t,k)=>t+total(k),0);

/** The syllabus as a tree (chapter, then topic or section, then topic) holding only the rows given; empty branches are dropped. */
function buildTree<T extends {anchor:string|null}>(outline:Outline|undefined,rows:T[]):TNode<T>[]{
  const known=new Set<string>();
  const leaf=(id:string,title:string,kids:TNode<T>[]=[]):TNode<T>=>{known.add(id);return {id,title,rows:rows.filter(r=>r.anchor===id),kids}};
  const tree=(outline?.chapters??[]).map(c=>leaf(c.id,c.title||'Untitled chapter',[
    ...c.topics.map(t=>leaf(t.id,t.title||'Untitled topic')),
    ...c.subsections.map(x=>leaf(x.id,x.title||'Untitled section',x.topics.map(t=>leaf(t.id,t.title||'Untitled topic'))))]));
  const prune=(n:TNode<T>):TNode<T>=>({...n,kids:n.kids.map(prune).filter(k=>total(k)>0)});
  const out=tree.map(prune).filter(n=>total(n)>0);
  const rest=rows.filter(r=>!r.anchor||!known.has(r.anchor));
  return rest.length?[...out,{id:'other',title:'Not under a topic',rows:rest,kids:[]}]:out;
}
const rank=(r:SRow)=>r.todo?0:r.done?2:1;      // inside one topic: what needs you first, then the rest, then what is finished

function Branch({node,depth,here,bare=false}:{node:TNode;depth:number;here:{from:string;label:string};bare?:boolean}){
  const Heading=(['h3','h4','h5'] as const)[Math.min(depth,2)];
  return <section className={`tree d${Math.min(depth,2)}`} aria-labelledby={`t-${node.id}`}>
    {bare?<h3 id={`t-${node.id}`} className="sr-only">{node.title}</h3>:<header><Heading id={`t-${node.id}`}>{node.title}</Heading><span className="count">{total(node)}</span></header>}
    {node.rows.length>0&&<ul className="seq compact">{[...node.rows].sort((a,b)=>rank(a)-rank(b)).map(r=><li key={r.key} className={r.chips.some(c=>c.cls==='next')?'next':undefined}>
      <span className="grow"><Link state={here} to={r.to}>{r.title}</Link>{(r.detail||r.result)&&<span className="muted">{r.detail}{r.detail&&r.result?' · ':''}{r.result&&<strong>{r.result}</strong>}</span>}</span>
      {r.chips.map(c=><span key={c.text} className={`badge ${c.cls??''}`}>{c.text}</span>)}
      {r.kind==='item'&&r.todo&&<Link state={here} className="start" to={r.to} title="Start this lesson" aria-hidden="true" tabIndex={-1}>▶</Link>}</li>)}</ul>}
    {node.kids.map(k=><Branch key={k.id} node={k} depth={depth+1} here={here}/>)}
  </section>;
}

/** Students: lessons, files, links, quizzes and activities together, by syllabus topic. */
export function StudentClasswork(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const base=`/student/offerings/${offering.id}`;
  const items=useQuery({queryKey:['learn-items',offering.id],queryFn:()=>api<LearnItem[]>(`/learn/offerings/${offering.id}/items`)});
  const work=useQuery({queryKey:['learn-work',offering.id],queryFn:()=>api<WorkRow[]>(`/learn/offerings/${offering.id}/assessments`)});
  const syllabus=useQuery({queryKey:['learn-syllabus',offering.id],queryFn:()=>api<LearnSyllabus>(`/learn/offerings/${offering.id}/syllabus`)});
  const cat=catOf(useSearchParams()[0].get('type'));const here=useHere();
  const [filters,setFilters]=useState<Record<string,Filter>>({});const filter=filters[cat]??'all';      // each tab remembers its own filter
  const setFilter=(f:Filter)=>setFilters({...filters,[cat]:f});
  const error=items.error??work.error;if(error)return <p role="alert">{error.message}</p>;
  if(!items.data||!work.data)return <p>Loading…</p>;
  const nearest=work.data.find(w=>w.bucket==='todo');                // sorted by deadline, so this is the nearest
  const lessons=items.data.filter(i=>i.kind==='lesson');const finished=lessons.filter(i=>i.completed).length;
  const next=items.data.find(i=>i.up_next);
  const KIND_NAME={lesson:'Lesson',file:'File',reference:'Link'} as const;
  const rows:SRow[]=[
    ...items.data.map(i=>({key:'i'+i.id,kind:'item' as const,cat:'lesson' as const,title:i.title,anchor:i.anchor_node_id,to:`${base}/lessons/${i.id}`,label:KIND_NAME[i.kind],
      detail:i.kind==='file'?(i.file?.name??''):'',chips:[...(i.up_next?[{text:'Up next',cls:'next'}]:[]),...(i.kind==='lesson'?[i.completed?{text:'✓ Completed',cls:'done'}:{text:'Not marked complete'}]:[])],
      todo:i.kind==='lesson'&&!i.completed,done:i.kind==='lesson'&&!!i.completed})),
    ...work.data.map(w=>({key:'w'+w.id,kind:'work' as const,cat:(w.kind==='online_quiz'?'quiz':'activity') as 'quiz'|'activity',title:w.title,anchor:w.anchor_node_id??null,to:`${base}/work/${w.id}`,label:w.kind==='online_quiz'?'Quiz':'Activity',
      detail:workDetail(w),
      chips:[...(w===nearest?[{text:'Up next',cls:'next'}]:[]),...(w.state==='in_progress'?[{text:'In progress'}]:[]),...(w.late_allowed?[{text:'Late submission allowed',cls:'warn'}]:[])],
      todo:w.bucket==='todo'||w.bucket==='again',done:w.bucket==='done'||w.bucket==='awaiting',
      result:w.result?`Your result: ${fmt(w.result.score)} / ${fmt(w.result.max_points)}`:undefined}))];
  const want=(r:SRow)=>r.cat===cat&&(filter==='all'||(filter==='todo'?r.todo:r.done));
  const outline=syllabus.data?.published?.outline;
  const shownRows=rows.filter(want);
  const tree=buildTree(outline,shownRows);
  const count=(k:Filter)=>rows.filter(r=>r.cat===cat&&(k==='all'||(k==='todo'?r.todo:r.done))).length;
  return <>
    {rows.length===0?<section className="panel"><h2>Nothing yet</h2><p>Published lessons, files, links, quizzes and activities appear here.</p></section>:<>
      <div className="type-row"><ClassworkTypes base={base} current={cat} counts={Object.fromEntries(CATS.map(([k])=>[k,rows.filter(r=>r.cat===k).length]))}/></div>
      <div className="cw-bar">
        {cat==='lesson'&&lessons.length>0&&<div className="seq-head"><p><strong>{finished} of {lessons.length}</strong> lessons complete</p>
          {next&&<Link className="button primary" to={`${base}/lessons/${next.id}`}>Continue: {next.title}</Link>}</div>}
        <div className="segmented" role="group" aria-label="Show">{([['all','Everything'],['todo',cat==='lesson'?'Not completed':'To do'],['done',cat==='lesson'?'Completed':'Done']] as const).map(([k,l])=>
          <button key={k} type="button" className={filter===k?'on':''} aria-pressed={filter===k} onClick={()=>setFilter(k)}>{l} <span className="muted">{count(k)}</span></button>)}</div></div>
      {shownRows.length===0?<section className="panel"><h2>{filter==='todo'?'Nothing to do':filter==='done'?'Nothing done yet':'Nothing here yet'}</h2><p className="muted">{filter==='todo'?'You are up to date.':filter==='done'?'Completed lessons and finished work appear here.':'Your teacher has not published any yet.'}</p></section>
        :tree.length===1&&tree[0].id==='other'?<Branch node={tree[0]} depth={0} here={here} bare/>:tree.map(n=><Branch key={n.id} node={n} depth={0} here={here}/>)}</>}
  </>;
}
