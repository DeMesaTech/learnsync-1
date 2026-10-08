import {useEffect,useState,type FormEvent} from 'react';
import {Link,useNavigate,useOutletContext,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,upload,errorText} from '../../app/api';
import {queryClient,useAuth} from '../../app/providers';
import {useConfirm} from '../../components/confirm';
import {Dialog} from '../../components/Dialog';
import type {OfferingSummary} from '../academics/types';
import {SaveIndicator,draftKey,useAutosave,useFlushOnLeave} from './autosave';
import {RichEditor} from './RichEditor';
import {ReferenceText} from '../study/ReferenceText';
import {groupByNode,nodeLabels,type Item,type ItemDraftContent,type SyllabusState} from './types';

const KIND={lesson:'Lesson',file:'File',reference:'Link'} as const;
const itemTitle=(i:Item)=>i.draft?.title||i.published?.title||'Untitled';
const stateLabel=(i:Item)=>i.archived?'Archived':i.published?(i.draft?`Published v${i.published.version} with newer draft`:`Published v${i.published.version}`):'Draft · not visible to students';

function useNodes(offeringId:string){
  const query=useQuery({queryKey:['syllabus',offeringId],queryFn:()=>api<SyllabusState>(`/teach/offerings/${offeringId}/syllabus`)});
  const outline=query.data?.draft?.outline??query.data?.published?.outline;
  return outline?nodeLabels(outline):[];
}

function SectionChoice({offering,chosen,onChange}:{offering:OfferingSummary;chosen:string[];onChange:(ids:string[])=>void}){
  return <fieldset><legend>Visible to</legend>
    <p className="muted">Leave all unchecked to show it to every section.</p>
    {offering.sections.map(s=><label className="inline" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={e=>onChange(e.target.checked?[...chosen,s.id]:chosen.filter(x=>x!==s.id))}/> {s.name}</label>)}</fieldset>;
}

export function ContentPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const closed=offering.term_status==='closed';
  const navigate=useNavigate();
  const [dialog,setDialog]=useState(false);
  const [showArchived,setShowArchived]=useState(false);
  const query=useQuery({queryKey:['items',offering.id],queryFn:()=>api<Item[]>(`/teach/offerings/${offering.id}/items`)});
  const nodes=useNodes(offering.id);
  const [moved,setMoved]=useState('');const [search,setSearch]=useState('');
  const matches=(i:Item)=>itemTitle(i).toLowerCase().includes(search.trim().toLowerCase());
  const anchorOf=(i:Item)=>(i.published??i.draft)?.anchor_node_id??null;   // the revision students see, else the draft: never a published "none" replaced by a draft topic
  async function move(group:{id:string|null;items:Item[]},visible:Item[],item:Item,step:number){
    const other=visible[visible.indexOf(item)+step];if(!other)return;
    const ids=group.items.map(i=>i.id);const a=ids.indexOf(item.id),b=ids.indexOf(other.id);[ids[a],ids[b]]=[ids[b],ids[a]];
    try{await send('PUT',`/teach/offerings/${offering.id}/items-order`,{anchor_node_id:group.id,expected_ids:group.items.map(i=>i.id),item_ids:ids});
      await queryClient.invalidateQueries({queryKey:['items',offering.id]});setMoved(`Moved “${itemTitle(item)}” ${step<0?'up':'down'} to position ${visible.indexOf(item)+step+1} of ${visible.length}.`)}
    catch(e){setMoved(errorText(e));queryClient.invalidateQueries({queryKey:['items',offering.id]})}
  }
  return <>
    <div className="page-heading"><div><h2>Lessons, files and links</h2><p className="muted">Students only see what you publish: edits stay drafts until you publish them. Reordering takes effect for students immediately.</p></div>
      <button className="primary" disabled={closed} onClick={()=>setDialog(true)}>New item</button></div>
    <div className="actions"><label>Search<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title"/></label>
      <label className="inline"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Show archived</label></div>
    {query.isPending?<p>Loading…</p>:query.error?<p role="alert">{query.error.message}</p>:
      query.data.filter(i=>(showArchived||!i.archived)&&matches(i)).length===0?<section className="panel"><h2>{search?'No items match':'Nothing here yet'}</h2><p>{search?'Change the search.':'Create a lesson, upload a file or add a reference link.'}</p></section>:
      <>{moved&&<p role="status" className="muted">{moved}</p>}
      {groupByNode(query.data,nodes,anchorOf).map(g=>{
        const visible=g.items.filter(i=>(showArchived||!i.archived)&&matches(i));if(visible.length===0)return null;
        const mixed=g.id===null&&g.items.some(i=>anchorOf(i));   // an item whose topic left the syllabus: reorder after fixing it
        const stuck=mixed?g.items.find(i=>anchorOf(i)):undefined;
        return <section key={g.id??'other'} aria-labelledby={`c-${g.id??'other'}`}><h3 id={`c-${g.id??'other'}`}>{g.label}</h3>
          {stuck&&<p className="warn" role="status">The order here cannot be changed because some items are attached to a topic that is no longer in the syllabus. <Link to={`/faculty/offerings/${offering.id}/content/${stuck.id}/edit`}>Open “{itemTitle(stuck)}”</Link> and choose a current topic.</p>}
          <ul className="seq">{visible.map((i,n)=><li key={i.id}>
            <span className="grow"><Link to={`/faculty/offerings/${offering.id}/content/${i.id}/edit`}>{itemTitle(i)}</Link>
              <span className="muted">{KIND[i.kind]}{i.section_ids.length>0&&` · ${i.section_ids.length} section${i.section_ids.length===1?'':'s'}`}</span></span>
            <span className={i.published&&!i.archived?'badge done':'badge'}>{stateLabel(i)}</span>
            <span className="actions"><button type="button" aria-label={`Move ${itemTitle(i)} up`} disabled={closed||mixed||n===0} onClick={()=>move(g,visible,i,-1)}>↑</button>
              <button type="button" aria-label={`Move ${itemTitle(i)} down`} disabled={closed||mixed||n===visible.length-1} onClick={()=>move(g,visible,i,1)}>↓</button></span></li>)}</ul></section>})}</>}
    {dialog&&<NewItemDialog offering={offering} nodes={nodes} onClose={()=>setDialog(false)} onCreated={item=>{setDialog(false);queryClient.invalidateQueries({queryKey:['items',offering.id]});navigate(`/faculty/offerings/${offering.id}/content/${item.id}/edit`)}}/>}
  </>;
}

function NewItemDialog({offering,nodes,onClose,onCreated}:{offering:OfferingSummary;nodes:{id:string;label:string}[];onClose:()=>void;onCreated:(i:Item)=>void}){
  const [chosen,setChosen]=useState<string[]>([]);const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{onCreated(await post<Item>(`/teach/offerings/${offering.id}/items`,{kind:f.get('kind'),title:f.get('title'),section_ids:chosen,anchor_node_id:f.get('anchor')||null}))}
    catch(err){setError(errorText(err))}
  }
  return <Dialog title="New item" onClose={onClose}><form onSubmit={submit}>
    <label>Type<select name="kind" defaultValue="lesson"><option value="lesson">Lesson (write it here)</option><option value="file">File (PDF, Word, PowerPoint, Excel, image)</option><option value="reference">Reference link</option></select></label>
    <label>Title<input name="title" required maxLength={200}/></label>
    <label>Attach to a syllabus topic (optional)<select name="anchor" defaultValue=""><option value="">Not attached</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
    <SectionChoice offering={offering} chosen={chosen} onChange={setChosen}/>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Create and edit</button></div>
  </form></Dialog>;
}

export function ItemEditorPage(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const {itemId}=useParams();
  const closed=offering.term_status==='closed';
  const base=`/teach/offerings/${offering.id}/items/${itemId}`;
  const query=useQuery({queryKey:['item',itemId],queryFn:()=>api<Item>(base)});
  const [starting,setStarting]=useState(false);
  const item=query.data;
  const needsDraft=!!item&&!item.draft&&!closed;
  useEffect(()=>{
    if(!needsDraft||starting)return;
    setStarting(true);
    post(`${base}/draft`,{}).then(()=>query.refetch()).finally(()=>setStarting(false));
  },[needsDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  if(query.isPending)return <p>Loading…</p>;
  if(query.error||!item)return <section className="panel"><h2>Item unavailable</h2><p role="alert">{query.error?.message}</p><Link to={`/faculty/offerings/${offering.id}/content`}>Back to content</Link></section>;
  if(!item.draft)return closed?<ReadOnlyItem offering={offering} item={item}/>:<p>Preparing a draft…</p>;
  return <ItemEditor key={item.draft.version} offering={offering} item={item} refetch={()=>query.refetch()}/>;
}

function ReadOnlyItem({offering,item}:{offering:OfferingSummary;item:Item}){
  return <section className="panel"><p className="back"><Link to={`/faculty/offerings/${offering.id}/content`}>← Content</Link></p><h2>{itemTitle(item)}</h2>
    <p className="muted">{stateLabel(item)} · This term is closed, so it cannot be edited.</p>
    {item.published?.body_html&&<div className="rich-content" dangerouslySetInnerHTML={{__html:item.published.body_html}}/>}</section>;
}

function ItemEditor({offering,item,refetch}:{offering:OfferingSummary;item:Item;refetch:()=>void}){
  const ask=useConfirm();
  const draft=item.draft!;
  const {session}=useAuth();
  const navigate=useNavigate();
  const nodes=useNodes(offering.id);
  const base=`/teach/offerings/${offering.id}/items/${item.id}`;
  const [message,setMessage]=useState('');
  const [sections,setSections]=useState(item.section_ids);
  const [file,setFile]=useState(draft.file);
  const auto=useAutosave<ItemDraftContent>({storageKey:draftKey(session?.user?.id,offering.id,`item-${item.id}`),counter:draft.counter,
    initial:{title:draft.title,body_html:draft.body_html??'',reference_url:draft.reference_url??'',reference_note:draft.reference_note,anchor_node_id:draft.anchor_node_id},
    save:(v,counter)=>send<{counter:number}>('PUT',`${base}/draft`,{expected_counter:counter,title:v.title,body_html:v.body_html,reference_url:v.reference_url||null,reference_note:v.reference_note,anchor_node_id:v.anchor_node_id||null})});
  useFlushOnLeave(auto.status,auto.flush);
  const v=auto.value;const set=(patch:Partial<ItemDraftContent>)=>auto.setValue({...v,...patch});
  const back=`/faculty/offerings/${offering.id}/content`;

  async function serverDraft(){const fresh=await api<Item>(base);if(!fresh.draft)throw new Error('The draft no longer exists.');return fresh.draft}
  async function publish(){
    setMessage('');
    if(!await auto.flush()){setMessage('Resolve the save problem above before publishing.');return}
    try{await post(`${base}/draft/publish`,{expected_counter:auto.counter()});auto.discardRecovered();queryClient.invalidateQueries({queryKey:['items',offering.id]});navigate(back)}
    catch(e){setMessage(errorText(e))}
  }
  async function discard(){
    const published=!!item.published;
    if(!await ask({title:published?'Discard this draft?':'Delete this item?',message:published?'The published version stays as it is.':'It was never published.',yes:published?'Discard draft':'Delete',danger:true}))return;
    await auto.flush();
    try{
      if(published)await send('DELETE',`${base}/draft?expected_counter=${auto.counter()}`);else await send('DELETE',base);
      auto.discardRecovered();queryClient.invalidateQueries({queryKey:['items',offering.id]});navigate(back);
    }catch(e){setMessage(errorText(e))}
  }
  async function setSettings(patch:{section_ids?:string[];archived?:boolean}){
    try{await send('PATCH',base,patch);queryClient.invalidateQueries({queryKey:['items',offering.id]});refetch()}catch(e){setMessage(errorText(e))}
  }
  async function uploadFile(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage('');
    const form=new FormData(e.currentTarget);   // read before awaiting: React clears currentTarget
    if(!await auto.flush()){setMessage('Resolve the save problem above first.');return}
    form.set('expected_counter',String(auto.counter()));
    try{const r=await upload<{counter:number;file:typeof file}>(`${base}/draft/file`,form);auto.adoptCounter(r.counter);setFile(r.file)}
    catch(err){setMessage(errorText(err))}
  }

  return <>
    <p className="back"><Link to={back}>← Content</Link></p>
    <div className="page-heading"><div><p className="eyebrow">{({lesson:'Lesson',file:'File',reference:'Link'})[item.kind]}</p><h2>{v.title||'Untitled'}</h2>
      <p className="muted">{item.published?`Students see version ${item.published.version} until you publish this draft.`:'Not visible to students until you publish.'}</p></div>
      <SaveIndicator status={auto.status} message={auto.message} storageFailed={auto.storageFailed} onRetry={auto.retry}/></div>
    {auto.recovered&&<div className="warn" role="alert"><p>Unsaved changes from this browser were found ({new Date(auto.recovered.at).toLocaleString()}).</p>
      <div className="actions"><button className="primary" onClick={auto.restoreRecovered}>Restore my changes</button><button onClick={auto.discardRecovered}>Discard them</button></div></div>}
    {auto.status==='conflict'&&<div className="warn" role="alert"><p><strong>This draft was changed somewhere else.</strong> Nothing has been overwritten. Your version:</p>
      {item.kind==='lesson'&&<details><summary>Show my unsaved text</summary><div className="rich-content" dangerouslySetInnerHTML={{__html:v.body_html}}/></details>}
      <div className="actions"><button onClick={async()=>{try{const d=await serverDraft();auto.useServer({title:d.title,body_html:d.body_html??'',reference_url:d.reference_url??'',reference_note:d.reference_note,anchor_node_id:d.anchor_node_id},d.counter)}catch(e){setMessage(errorText(e))}}}>Load the newer version (drops my edits)</button>
        <button className="primary" onClick={async()=>{try{auto.overwrite((await serverDraft()).counter)}catch(e){setMessage(errorText(e))}}}>Keep my version (overwrites the newer one)</button></div></div>}
    <section className="panel">
      <label>Title<input value={v.title} maxLength={200} onChange={e=>set({title:e.target.value})}/></label>
      <label>Attached syllabus topic<select value={v.anchor_node_id??''} onChange={e=>set({anchor_node_id:e.target.value||null})}><option value="">Not attached</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
      {item.kind==='lesson'&&<><p id="lesson-label" className="label">Lesson content</p><RichEditor html={v.body_html} onChange={html=>set({body_html:html})}/></>}
      {item.kind==='file'&&<><p>{file?<>Current file: <strong>{file.name}</strong> ({Math.ceil(file.size/1024)} KB)</>:'No file uploaded yet.'}</p>
        <form onSubmit={uploadFile}><label>{file?'Replace the file':'Upload a file'} (PDF, Word, PowerPoint, Excel, PNG or JPEG, up to 20 MB)<input name="file" type="file" required accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg"/></label><button>Upload</button></form>
        <label>Description (optional)<textarea value={v.reference_note} maxLength={5000} onChange={e=>set({reference_note:e.target.value})}/></label></>}
      {item.kind==='reference'&&<><label>Link address<input type="url" value={v.reference_url} maxLength={2000} placeholder="https://" onChange={e=>set({reference_url:e.target.value})}/></label>
        <label>Note for students (optional)<textarea value={v.reference_note} maxLength={5000} onChange={e=>set({reference_note:e.target.value})}/></label></>}
    </section>
    {item.kind==='reference'&&<ReferenceText base={base} disabled={false} beforeFetch={()=>auto.flush()}/>}
    {item.kind!=='reference'&&item.published&&<p className="muted">{item.published.index_state==='failed'?'Study help could not read this file (it may be corrupt or unsupported), so students cannot ask about it. Upload a fixed file and publish again.':!item.published.study_chunks?'This published version has no readable text (a scanned PDF or an image?), so study help cannot use it.':`Study help can search ${item.published.study_chunks} passage${item.published.study_chunks===1?'':'s'} of the published version.`}</p>}
    <section className="panel"><h3>Audience and status</h3>
      <SectionChoice offering={offering} chosen={sections} onChange={ids=>{setSections(ids);void setSettings({section_ids:ids})}}/>
      <button type="button" onClick={()=>setSettings({archived:!item.archived})}>{item.archived?'Restore item':'Archive item'}</button>
      <p className="muted">Archived items are hidden from students and kept in your records.</p></section>
    {message&&<p role="alert">{message}</p>}
    <div className="actions"><button className="primary" onClick={publish}>Publish</button><button onClick={discard}>{item.published?'Discard draft':'Delete item'}</button></div>
  </>;
}
