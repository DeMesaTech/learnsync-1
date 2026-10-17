import type React from 'react';
import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useOutletContext,useSearchParams} from 'react-router-dom';
import {ClassworkTypes,catOf,CATS} from '../../components/ClassworkTypes';
import {useHere} from '../../components/origin';
import {useQuery} from '@tanstack/react-query';
import {api,send,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import type {OfferingSummary} from '../academics/types';
import {useUndo} from '../../components/undo';
import {GenerateDialog} from '../study/Generate';
import {NewDialog,assessmentStatus,assessmentTitle} from '../assessments/Assessments';
import {AssessmentEditorDialog} from '../assessments/AssessmentEditor';
import {detail as workDetail} from '../assessments/Work';
import {KIND_LABEL,fmt,type Assessment,type Kind,type LearnItem as Work} from '../assessments/types';
import {ItemEditorDialog,KIND,NewItemDialog,itemTitle,stateLabel,useNodes} from './Content';
import {type Chapter,type Item,type LearnItem,type LearnSyllabus,type Outline,type SyllabusState} from './types';

type Create={type:'item';kind:Item['kind']}|{type:'item-editor';itemId:string}|{type:'assessment';kind:Kind}|{type:'assessment-editor';assessmentId:string}|{type:'ai'}|null;
interface Row{canUnpublish:boolean;pending:boolean;key:string;type:'item'|'assessment';kind:string;sectionIds:string[];id:string;title:string;label:string;anchor:string|null;archived:boolean;status:string;published:boolean;to:string;meta:string}
type MaterialFilter='all'|'lesson'|'module'|'activity'|'online_quiz'|'other';

const CREATE:[string,Create|'stream'][]=[['Lesson',{type:'item',kind:'lesson'}],['File',{type:'item',kind:'file'}],['Link',{type:'item',kind:'reference'}],
  ['Quiz',{type:'assessment',kind:'online_quiz'}],['Paper quiz',{type:'assessment',kind:'offline_quiz'}],['Activity',{type:'assessment',kind:'activity'}],['Examination',{type:'assessment',kind:'exam'}],
  ['Teacher-scored item',{type:'assessment',kind:'manual'}],['Quiz drafted by AI',{type:'ai'}],['Announcement','stream']];

/** Teachers: everything you teach and assign in one place, grouped by syllabus topic, with one Create menu. */
export function FacultyClasswork(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const closed=offering.term_status!=='active';
  const navigate=useNavigate();
  const base=`/faculty/offerings/${offering.id}`;
  const items=useQuery({queryKey:['items',offering.id],queryFn:()=>api<Item[]>(`/teach/offerings/${offering.id}/items`)});
  const assessments=useQuery({queryKey:['assessments',offering.id],queryFn:()=>api<Assessment[]>(`/teach/offerings/${offering.id}/assessments`)});
  const syllabus=useQuery({queryKey:['syllabus',offering.id],queryFn:()=>api<SyllabusState>(`/teach/offerings/${offering.id}/syllabus`)});
  const offerings=useQuery({queryKey:['my-offerings'],queryFn:()=>api<OfferingSummary[]>('/me/offerings')});
  const nodes=useNodes(offering.id);
  const offer=useUndo();
  const [create,setCreate]=useState<Create>(null);
  const [search,setSearch]=useState('');const [archived,setArchived]=useState(false);
  const [materialFilter,setMaterialFilter]=useState<MaterialFilter>('all');
  const [sectionId,setSectionId]=useState(offering.sections[0]?.id??'all');
  const [activeChapter,setActiveChapter]=useState('');
  const [reorder,setReorder]=useState<string|null>(null);const [moved,setMoved]=useState('');
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    setSectionId(offering.sections[0]?.id??'all');
    setActiveChapter('');
  },[offering.id,offering.sections]);
  useEffect(()=>{
    const outside=(e:Event)=>{const d=menu.current;if(d?.open&&!(e.target instanceof Node&&d.contains(e.target)))d.open=false};
    const escape=(e:KeyboardEvent)=>{const d=menu.current;if(e.key==='Escape'&&d?.open){d.open=false;d.querySelector('summary')?.focus()}};
    document.addEventListener('click',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('click',outside);document.removeEventListener('keydown',escape)};
  },[]);
  const choose=(c:Create|'stream')=>{if(menu.current)menu.current.open=false;if(c==='stream')navigate(`${base}/stream`);else setCreate(c)};

  const rows:Row[]=[
    ...(items.data??[]).map(i=>({canUnpublish:false,pending:!!i.draft,key:'i'+i.id,type:'item' as const,kind:i.kind,sectionIds:i.section_ids,id:i.id,title:itemTitle(i),label:KIND[i.kind],anchor:(i.published??i.draft)?.anchor_node_id??null,archived:i.archived,
      status:stateLabel(i),published:!!i.published,to:`${base}/content/${i.id}/edit`,meta:`${KIND[i.kind]}${i.section_ids.length>0?` · ${i.section_ids.length} section${i.section_ids.length===1?'':'s'}`:''}`})),
    ...(assessments.data??[]).map(a=>{const rev=a.draft??a.published;
      return {canUnpublish:a.can_unpublish,pending:!!a.draft,key:'a'+a.id,type:'assessment' as const,kind:a.kind,sectionIds:a.section_ids,id:a.id,title:assessmentTitle(a),label:KIND_LABEL[a.kind],anchor:rev?.anchor_node_id??null,archived:a.archived,status:assessmentStatus(a),published:!!a.published,
        to:a.published?`${base}/assessments/${a.id}/scores`:`${base}/assessments/${a.id}/edit`,
        meta:`${KIND_LABEL[a.kind]}${rev?.ai_generated?` · AI draft${rev.reviewed?' reviewed':' needs review'}`:''}${rev?.include_in_grade?` · ${fmt(rev.max_points??0)} pts`:' · not graded'}${a.published?.deadline?` · due ${new Date(a.published.deadline).toLocaleDateString()}`:''}`}})];
  const selectedSection=offering.sections.find(section=>section.id===sectionId);
  const isVisibleToSection=(r:Row)=>!selectedSection||!r.sectionIds.length||r.sectionIds.includes(selectedSection.id);
  const matchesFilter=(r:Row)=>materialFilter==='all'||(materialFilter==='lesson'&&r.kind==='lesson')||
    (materialFilter==='module'&&r.kind==='file')||(materialFilter==='activity'&&r.kind==='activity')||
    (materialFilter==='online_quiz'&&r.kind==='online_quiz')||
    (materialFilter==='other'&&!['lesson','file','activity','online_quiz'].includes(r.kind));
  const match=(r:Row)=>r.title.toLowerCase().includes(search.trim().toLowerCase());
  const shown=(r:Row)=>isVisibleToSection(r)&&(archived||!r.archived)&&match(r)&&matchesFilter(r);
  const outline=syllabus.data?.draft?.outline??syllabus.data?.published?.outline;
  const known=new Set(nodes.map(n=>n.id));
  const visibleRows=rows.filter(shown);
  const tree=buildTree(outline,visibleRows);
  const chapters=outline?.chapters??[];
  const selectedChapter=chapters.find(chapter=>chapter.id===activeChapter)??chapters[0];
  const selectedChapterId=selectedChapter?.id??'other';
  const selectedTree=tree.find(node=>node.id===selectedChapterId);
  const published=syllabus.data?.published;const draft=syllabus.data?.draft;

  const inNode=(n:TNode<Row>,r:Row)=>n.id==='other'?(!r.anchor||!known.has(r.anchor)):r.anchor===n.id;
  async function move(n:TNode<Row>,visible:Row[],row:Row,step:number){
    const other=visible[visible.indexOf(row)+step];if(!other)return;
    const everyone=rows.filter(r=>r.type==='item'&&inNode(n,r)).map(r=>r.id);const all=[...everyone];const a=all.indexOf(row.id),b=all.indexOf(other.id);[all[a],all[b]]=[all[b],all[a]];
    try{await send('PUT',`/teach/offerings/${offering.id}/items-order`,{anchor_node_id:n.id==='other'?null:n.id,expected_ids:everyone,item_ids:all});
      await queryClient.invalidateQueries({queryKey:['items',offering.id]});setMoved(`Moved “${row.title}” ${step<0?'up':'down'} to position ${visible.indexOf(row)+step+1} of ${visible.length}.`)}
    catch(e){setMoved(errorText(e));queryClient.invalidateQueries({queryKey:['items',offering.id]})}
  }
  async function unpublish(r:Row){
    try{
      const view=await send<Assessment>('POST',`/teach/offerings/${offering.id}/assessments/${r.id}/unpublish`,{});
      await Promise.all([queryClient.invalidateQueries({queryKey:['assessments',offering.id]}),queryClient.invalidateQueries({queryKey:['assessment',r.id]})]);
      offer(`“${r.title}” is unpublished. Students no longer see it.`,async()=>{
        try{await send('POST',`/teach/offerings/${offering.id}/assessments/${r.id}/draft/publish`,{expected_counter:view.draft!.counter});
          await queryClient.invalidateQueries({queryKey:['assessments',offering.id]})}
        catch(e){setMoved(errorText(e))}})}
    catch(e){setMoved(errorText(e))}
  }
  const assessmentCreated=(assessment:Assessment)=>{queryClient.invalidateQueries({queryKey:['assessments',offering.id]});setCreate({type:'assessment-editor',assessmentId:assessment.id})};

  const stranded=rows.find(r=>r.type==='item'&&r.anchor&&!known.has(r.anchor));   // its topic left the syllabus: fix it before reordering
  const activeRows=rows.filter(row=>!row.archived);
  const publishedCount=activeRows.filter(row=>row.published&&!row.pending).length;
  const draftCount=activeRows.filter(row=>!row.published||row.pending).length;
  const branch=(n:TNode<Row>,depth:number,bare=false):React.ReactElement=>{
    const Heading=(['h3','h4','h5'] as const)[Math.min(depth,2)];
    const items=n.rows.filter(r=>r.type==='item');
    return <section key={n.id} className={`tree d${Math.min(depth,2)}`} aria-labelledby={`c-${n.id}`}>
      {bare?<Heading id={`c-${n.id}`} className="sr-only">{n.title}</Heading>:<header><Heading id={`c-${n.id}`}>{n.title}</Heading><span className="count">{total(n)}</span>
        {items.length>1&&!closed&&!stranded&&<button type="button" className="linklike" aria-pressed={reorder===n.id} onClick={()=>setReorder(reorder===n.id?null:n.id)}>{reorder===n.id?'Done reordering':'Reorder'}</button>}</header>}
      {n.rows.length>0&&<ul className="seq compact manager-material-list">{n.rows.map(r=><li className="manager-material-row" key={r.key}>
        <span className={`material-kind-icon kind-${r.kind}`} aria-hidden="true">{materialIcon(r.kind)}</span>
        <span className="grow"><Link to={r.to}>{r.title}</Link><span className="muted">{r.label}{r.meta?` · ${r.meta}`:''}</span>
          <span className={r.published&&!r.pending&&!r.archived?'badge done':'badge'}>{r.status}</span></span>
        <span className="manager-material-actions">
          {r.canUnpublish&&!closed&&<button type="button" className="linklike" onClick={()=>unpublish(r)}>Unpublish</button>}
          {reorder===n.id&&r.type==='item'&&<span className="actions"><button type="button" aria-label={`Move ${r.title} up`} disabled={closed||items.indexOf(r)===0} onClick={()=>move(n,items,r,-1)}>↑</button>
            <button type="button" aria-label={`Move ${r.title} down`} disabled={closed||items.indexOf(r)===items.length-1} onClick={()=>move(n,items,r,1)}>↓</button></span>}
        </span></li>)}</ul>}
      {n.kids.map(k=>branch(k,depth+1))}</section>};
  return <>
    <section className="content-manager-header">
      <div><p className="eyebrow">SUBJECT CONTENT</p><h2>Subject Content Manager</h2>
        <p className="muted">Manage chapters, lessons, assessments, and learning resources in one place.</p></div>
    </section>
    <div className="content-manager-context">
      <label>Assigned subject<select aria-label="Assigned subject" value={offering.id} onChange={event=>navigate(`/faculty/offerings/${event.target.value}/classwork`)}>
        {(offerings.data??[offering]).map(subject=><option key={subject.id} value={subject.id}>{subject.subject.code} · {subject.subject.title}</option>)}
      </select></label>
      <label>Section<select aria-label="Section" value={selectedSection?.id??'all'} onChange={event=>setSectionId(event.target.value)}>
        <option value="all">All sections</option>{offering.sections.map(section=><option key={section.id} value={section.id}>{section.name}</option>)}
      </select></label>
    </div>
    {offerings.error&&<p role="alert">Could not load assigned subjects: {offerings.error.message}</p>}
    <section className="content-manager-overview" aria-label="Content overview">
      <article><span aria-hidden="true">▤</span><div><strong>{chapters.length}</strong><small>Chapters</small></div></article>
      <article><span aria-hidden="true">▣</span><div><strong>{activeRows.length}</strong><small>Resources</small></div></article>
      <article><span aria-hidden="true">✓</span><div><strong>{publishedCount}</strong><small>Published</small></div></article>
      <article><span aria-hidden="true">✎</span><div><strong>{draftCount}</strong><small>Drafts</small></div></article>
    </section>
    {!published&&!draft&&!closed&&<section className="panel" aria-labelledby="syl-h"><h3 id="syl-h">Set up this subject</h3><p className="muted">Not set up yet. A guided setup creates the syllabus, grading policy and first topics in a few steps.</p>
      <Link className="button primary" to={`${base}/setup`}>Set up this subject</Link></section>}
    {moved&&<p role="status" className="muted">{moved}</p>}
    {(items.isPending||assessments.isPending)?<p>Loading…</p>:items.error||assessments.error?<p role="alert">{(items.error??assessments.error)!.message}</p>:
      <div className="chapter-workspace">
        <ChapterNavigation outline={outline} rows={visibleRows} selected={selectedChapterId} onSelect={setActiveChapter} editHref={`${base}/syllabus`}/>
        <section className="chapter-detail panel">
          <header className="chapter-detail-heading">
            <div><p className="eyebrow">{selectedChapter?`CHAPTER ${chapters.indexOf(selectedChapter)+1}`:'OTHER MATERIALS'}</p>
              <h2>{selectedChapter?`Chapter ${chapters.indexOf(selectedChapter)+1}: ${selectedChapter.title||'Untitled'}`:'Other materials'}</h2>
              <p className="muted">Manage learning resources for this chapter.</p></div>
            {!closed&&<details className="dropdown" ref={menu}><summary className="button primary" aria-disabled={closed}>＋ Add material</summary>
              <div className="menu-list" role="group" aria-label="Add material">{CREATE.map(([label,target],index)=><span key={label} className="menu-item">{(index===3||index===8)&&<hr/>}
                <button type="button" onClick={()=>choose(target)}>{label}</button></span>)}</div></details>}
          </header>
          {stranded&&<p className="warn" role="status">Items cannot be reordered because some are attached to a topic that is no longer in the syllabus. <Link to={stranded.to}>Open “{stranded.title}”</Link> and choose a current topic.</p>}
          <div className="chapter-materials">
            <div className="section-head"><h3>Learning materials</h3><span className="muted">{selectedTree?total(selectedTree):0} items</span></div>
            <div className="chapter-material-tools">
              <label className="chapter-material-search">Search chapter materials<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search chapter materials…"/></label>
              <div className="chapter-material-filters" role="group" aria-label="Filter chapter materials">
                {([['all','All'],['lesson','Lesson'],['module','Module'],['activity','Activity'],['online_quiz','Online quiz'],['other','Other']] as const).map(([key,label])=>
                  <button key={key} type="button" className={materialFilter===key?'active':''} aria-pressed={materialFilter===key} onClick={()=>setMaterialFilter(key)}>{label}</button>)}
              </div>
              <label className="inline chapter-archived"><input type="checkbox" checked={archived} onChange={event=>setArchived(event.target.checked)}/> Show archived</label>
            </div>
            {selectedTree?branch(selectedTree,0,true):<p className="muted">{search||materialFilter!=='all'||archived?'Nothing matches the current filters.':'No learning materials in this chapter yet.'}</p>}
          </div>
        </section>
      </div>}
    {create?.type==='item'&&<NewItemDialog offering={offering} nodes={nodes} kind={create.kind} anchorNodeId={selectedChapter?.id} onClose={()=>setCreate(null)} onCreated={i=>{setCreate({type:'item-editor',itemId:i.id});queryClient.invalidateQueries({queryKey:['items',offering.id]})}}/>}
    {create?.type==='item-editor'&&<ItemEditorDialog itemId={create.itemId} onClose={()=>{setCreate(null);queryClient.invalidateQueries({queryKey:['items',offering.id]})}}/>}
    {create?.type==='assessment'&&<NewDialog offering={offering} kind={create.kind} onClose={()=>setCreate(null)} onCreated={assessmentCreated}/>}
    {create?.type==='assessment-editor'&&<AssessmentEditorDialog offering={offering} assessmentId={create.assessmentId} onClose={()=>{setCreate(null);queryClient.invalidateQueries({queryKey:['assessments',offering.id]})}}/>}
    {create?.type==='ai'&&<GenerateDialog offering={offering} onClose={()=>setCreate(null)} onCreated={assessmentCreated}/>}
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

function chapterNodeIds(chapter:Chapter){
  const ids=new Set([chapter.id]);
  chapter.topics.forEach(topic=>ids.add(topic.id));
  chapter.subsections.forEach(section=>{
    ids.add(section.id);
    section.topics.forEach(topic=>ids.add(topic.id));
  });
  return ids;
}

const materialIcon=(kind:string)=>kind==='lesson'?'▱':kind==='file'?'▣':kind==='reference'?'↗':kind==='online_quiz'?'☷':kind==='activity'?'▧':'✎';

function ChapterNavigation({outline,rows,selected,onSelect,editHref}:{outline:Outline|undefined;rows:{anchor:string|null}[];selected:string;onSelect:(id:string)=>void;editHref?:string}){
  const chapters=outline?.chapters??[];
  const known=new Set(chapters.flatMap(chapter=>[...chapterNodeIds(chapter)]));
  const otherCount=rows.filter(row=>!row.anchor||!known.has(row.anchor)).length;
  return <aside className="chapter-navigation" aria-label="Chapter navigation">
    <div className="chapter-navigation-heading"><div><p className="eyebrow">COURSE CONTENT</p><h2>Chapters</h2></div>
      {editHref&&<Link className="chapter-add-link" to={editHref} aria-label="Add or edit chapters" title="Add or edit chapters">＋</Link>}</div>
    <nav className="chapter-navigation-list" aria-label="Chapters">
      {chapters.map((chapter,index)=>{
        const ids=chapterNodeIds(chapter);
        const count=rows.filter(row=>row.anchor!==null&&ids.has(row.anchor)).length;
        const title=chapter.title||'Untitled chapter';
        return <button key={chapter.id} type="button" className={`chapter-choice${selected===chapter.id?' active':''}`}
          aria-pressed={selected===chapter.id} onClick={()=>onSelect(chapter.id)}>
          <span className="chapter-index">{index+1}</span><span className="chapter-choice-copy">
            <strong>Chapter {index+1}: {title}</strong>
            <small>{count} learning {count===1?'item':'items'}</small>
          </span>
        </button>;
      })}
      {(otherCount>0||chapters.length===0)&&<button type="button" className={`chapter-choice${selected==='other'?' active':''}`}
        aria-pressed={selected==='other'} onClick={()=>onSelect('other')}>
        <span className="chapter-index" aria-hidden="true">···</span><span className="chapter-choice-copy"><strong>Other materials</strong><small>{otherCount} learning {otherCount===1?'item':'items'}</small></span>
      </button>}
    </nav>
    {chapters.length===0&&<p className="muted">No chapters have been published yet.</p>}
  </aside>;
}
const rank=(r:SRow)=>r.todo?0:r.done?2:1;      // inside one topic: what needs you first, then the rest, then what is finished

function Branch({node,depth,here,bare=false}:{node:TNode;depth:number;here:{from:string;label:string};bare?:boolean}){
  const Heading=(['h3','h4','h5'] as const)[Math.min(depth,2)];
  return <section className={`tree d${Math.min(depth,2)}`} aria-labelledby={`t-${node.id}`}>
    {bare?<h3 id={`t-${node.id}`} className="sr-only">{node.title}</h3>:<header><Heading id={`t-${node.id}`}>{node.title}</Heading><span className="count">{total(node)}</span></header>}
    {node.rows.length>0&&<ul className="seq compact">{[...node.rows].sort((a,b)=>rank(a)-rank(b)).map(r=><li key={r.key} className={r.chips.some(c=>c.cls==='next')?'next':undefined}>
      <span className="grow"><Link state={here} to={r.to}>{r.title}</Link>{(r.detail||r.result)&&<span className="muted">{r.detail}{r.detail&&r.result?' · ':''}{r.result&&<strong>{r.result}</strong>}</span>}</span>
      {r.chips.map(c=><span key={c.text} className={`badge ${c.cls??''}`}>{c.text}</span>)}
      {r.kind==='item'&&r.todo&&<Link state={here} className="start" to={r.to} title="Open this" aria-hidden="true" tabIndex={-1}>▶</Link>}</li>)}</ul>}
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
  const [activeChapter,setActiveChapter]=useState('');
  const setFilter=(f:Filter)=>setFilters({...filters,[cat]:f});
  const error=items.error??work.error??syllabus.error;if(error)return <p role="alert">{error.message}</p>;
  if(!items.data||!work.data||!syllabus.data)return <p>Loading…</p>;
  const nearest=work.data.find(w=>w.bucket==='todo');                // sorted by deadline, so this is the nearest
  const lessons=items.data;const finished=lessons.filter(i=>i.completed).length;      // lessons, files and links are one sequence
  const next=items.data.find(i=>i.up_next);
  const KIND_NAME={lesson:'Lesson',file:'File',reference:'Link'} as const;
  const rows:SRow[]=[
    ...items.data.map(i=>({key:'i'+i.id,kind:'item' as const,cat:'lesson' as const,title:i.title,anchor:i.anchor_node_id,to:`${base}/lessons/${i.id}`,label:KIND_NAME[i.kind],
      detail:i.kind==='file'?(i.file?.name??''):'',chips:[...(i.up_next?[{text:'Up next',cls:'next'}]:[]),...[i.completed?{text:'✓ Completed',cls:'done'}:{text:'Not marked complete'}]],
      todo:!i.completed,done:!!i.completed})),
    ...work.data.map(w=>({key:'w'+w.id,kind:'work' as const,cat:(w.kind==='online_quiz'?'quiz':'activity') as 'quiz'|'activity',title:w.title,anchor:w.anchor_node_id??null,to:`${base}/work/${w.id}`,label:w.kind==='online_quiz'?'Quiz':'Activity',
      detail:workDetail(w),
      chips:[...(w===nearest?[{text:'Up next',cls:'next'}]:[]),...(w.state==='in_progress'?[{text:'In progress'}]:[]),...(w.late_allowed?[{text:'Late submission allowed',cls:'warn'}]:[])],
      todo:w.bucket==='todo'||w.bucket==='again',done:w.bucket==='done'||w.bucket==='awaiting',
      result:w.result?`Your result: ${fmt(w.result.score)} / ${fmt(w.result.max_points)}`:undefined}))];
  const want=(r:SRow)=>r.cat===cat&&(filter==='all'||(filter==='todo'?r.todo:r.done));
  const outline=syllabus.data?.published?.outline;
  const shownRows=rows.filter(want);
  const tree=buildTree(outline,shownRows);
  const chapters=outline?.chapters??[];
  const selectedChapter=chapters.find(chapter=>chapter.id===activeChapter)??chapters[0];
  const selectedChapterId=selectedChapter?.id??'other';
  const selectedTree=tree.find(node=>node.id===selectedChapterId);
  const count=(k:Filter)=>rows.filter(r=>r.cat===cat&&(k==='all'||(k==='todo'?r.todo:r.done))).length;
  return <>
    <div className="type-row"><ClassworkTypes base={base} current={cat} counts={Object.fromEntries(CATS.map(([k])=>[k,rows.filter(r=>r.cat===k).length]))}/></div>
    <div className="cw-bar">
      {cat==='lesson'&&lessons.length>0&&<div className="seq-head"><p><strong>{finished} of {lessons.length}</strong> complete</p>
        {next&&<Link className="button primary" to={`${base}/lessons/${next.id}`}>Continue: {next.title}</Link>}</div>}
      <div className="segmented" role="group" aria-label="Show">{([['all','Everything'],['todo',cat==='lesson'?'Not completed':'To do'],['done',cat==='lesson'?'Completed':'Done']] as const).map(([k,l])=>
        <button key={k} type="button" className={filter===k?'on':''} aria-pressed={filter===k} onClick={()=>setFilter(k)}>{l} <span className="muted">{count(k)}</span></button>)}</div>
    </div>
    <div className="chapter-workspace">
      <ChapterNavigation outline={outline} rows={shownRows} selected={selectedChapterId} onSelect={setActiveChapter}/>
      <section className="chapter-detail panel">
        <header className="chapter-detail-heading">
          <div><p className="eyebrow">{selectedChapter?`CHAPTER ${chapters.indexOf(selectedChapter)+1}`:'OTHER MATERIALS'}</p>
            <h2>{selectedChapter?`Chapter ${chapters.indexOf(selectedChapter)+1}: ${selectedChapter.title||'Untitled'}`:'Other materials'}</h2>
            <p className="muted">Learning resources published for this chapter.</p></div>
        </header>
        <div className="chapter-materials">
          <div className="section-head"><h3>Learning materials</h3><span className="muted">{selectedTree?total(selectedTree):0} items</span></div>
          {selectedTree?<Branch node={selectedTree} depth={0} here={here} bare/>:
            <p className="muted">{filter==='todo'?'You are up to date.':filter==='done'?'Completed lessons and finished work appear here.':'No published learning materials or activities in this chapter yet.'}</p>}
        </div>
      </section>
    </div>
  </>;
}
