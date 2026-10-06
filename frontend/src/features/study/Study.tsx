import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,useOutletContext} from 'react-router-dom';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import {Dialog} from '../../components/Dialog';
import {queryClient} from '../../app/providers';
import type {OfferingSummary} from '../academics/types';
import type {LearnItem} from '../teaching/types';
import type {AiStatus,Conversation,ConversationPage,ConversationSummary,StudyMessage} from './types';

export function SimulatorNotice({status}:{status?:AiStatus}){
  return status?.simulated?<p className="warn" role="status"><strong>Development simulator.</strong> Replies are canned excerpts from your materials, not a real AI. Do not judge answer quality, language or safety from them.</p>:null;
}

type Action='simplify'|'summary'|'example'|'analogy';
const ACTIONS:{key:Action;label:string}[]=[{key:'simplify',label:'Explain simply'},{key:'summary',label:'Summarize'},{key:'example',label:'Give an example'},{key:'analogy',label:'Everyday analogy'}];

export function StudentStudy(){
  const {offering}=useOutletContext<{offering:OfferingSummary}>();
  const withdrawn=(offering as OfferingSummary&{enrollment_status?:string}).enrollment_status==='withdrawn';
  const closed=offering.term_status==='closed'||withdrawn;   // history stays readable and deletable; asking does not
  const [confirmDelete,setConfirmDelete]=useState(false);
  const base=`/learn/offerings/${offering.id}/study/conversations`;
  const [active,setActive]=useState<string|null>(null);
  const [text,setText]=useState('');const [focus,setFocus]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [waiting,setWaiting]=useState('');
  const attempt=useRef<{id:string;text:string}|null>(null);   // a retry of the same question reuses its id, so it is never stored or answered twice
  const status=useQuery({queryKey:['ai-status'],queryFn:()=>api<AiStatus>('/ai/status')});
  const list=useInfiniteQuery({queryKey:['study-list',offering.id],initialPageParam:'',
    queryFn:({pageParam})=>api<ConversationPage>(`${base}?limit=25${pageParam?`&cursor=${encodeURIComponent(pageParam)}`:''}`),
    getNextPageParam:p=>p.next_cursor??undefined});
  const items=useQuery({queryKey:['learn-items',offering.id],queryFn:()=>api<LearnItem[]>(`/learn/offerings/${offering.id}/items`)});
  const conversation=useInfiniteQuery({queryKey:['study-conv',active],enabled:!!active,initialPageParam:'',
    queryFn:({pageParam})=>api<Conversation>(`${base}/${active}?limit=50${pageParam?`&cursor=${encodeURIComponent(pageParam)}`:''}`),
    getNextPageParam:p=>p.next_cursor??undefined});
  async function removeConversation(){
    try{await send('DELETE',`${base}/${active}`);setConfirmDelete(false);setActive(null);setError('');await queryClient.invalidateQueries({queryKey:['study-list',offering.id]})}
    catch(err){setError(errorText(err));setConfirmDelete(false)}
  }
  const ready=status.data?.configured!==false;

  const ask=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();void submit({text:text.trim(),selected_item_id:focus||null},text.trim())};
  async function submit(body:{text:string;selected_item_id:string|null;action?:Action},shown:string){
    if(!shown||busy)return;
    const key=body.action?`${body.action}:${body.selected_item_id}`:shown;   // a retry of the same thing reuses its id
    const sending={id:attempt.current?.text===key?attempt.current.id:crypto.randomUUID(),text:key};attempt.current=sending;
    setBusy(true);setError('');setWaiting(shown);
    try{
      let id=active;
      if(!id){const c=await post<ConversationSummary>(base,{});id=c.id;setActive(id)}
      await post(`${base}/${id}/messages`,{...body,client_message_id:sending.id});
      attempt.current=null;if(!body.action)setText('');
      await Promise.all([queryClient.invalidateQueries({queryKey:['study-conv',id]}),queryClient.invalidateQueries({queryKey:['study-list',offering.id]})]);
    }catch(err){setError(errorText(err))}   // the question stays in the box, so Send again retries it
    finally{setBusy(false);setWaiting('')}
  }

  const messages:StudyMessage[]=[...(conversation.data?.pages??[])].reverse().flatMap(p=>p.messages);   // pages arrive newest first
  const log=useRef<HTMLDivElement>(null);const box=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{const el=log.current;if(el)el.scrollTop=el.scrollHeight},[messages.length,busy,active]);   // keep the newest message in view
  const chats=list.data?.pages.flatMap(p=>p.items)??[];
  const title=chats.find(c=>c.id===active)?.title??'New conversation';
  const newChat=()=>{setActive(null);setError('');setText('');attempt.current=null;box.current?.focus()};
  // one-tap helpers act on ONE lesson: the one chosen under "Focus on", else the student's next lesson
  const target=items.data?.find(i=>i.id===focus)??items.data?.find(i=>i.up_next)??items.data?.find(i=>i.kind==='lesson');
  const doAction=(a:Action)=>{if(target)void submit({text:'',selected_item_id:target.id,action:a},`${ACTIONS.find(x=>x.key===a)!.label}: ${target.title}`)};
  const helper=<div className="helper" role="group" aria-label="Lesson helper">
    {target?<p className="muted">Help with <strong>{target.title}</strong>{focus?'':' (your next lesson; change it under “Focus on”)'}:</p>:<p className="muted">Lessons appear here once your teacher publishes them.</p>}
    <div className="chips">{ACTIONS.map(a=><button key={a.key} type="button" disabled={!target||busy||closed||!ready} onClick={()=>doAction(a.key)}>{a.label}</button>)}</div></div>;
  return <>
    <div className="page-heading"><div><h2>Study help</h2><p className="muted">Ask about this subject. Answers use only the lessons and materials your teacher published, and show where they came from.</p></div></div>
    <SimulatorNotice status={status.data}/>
    {status.data&&!status.data.configured&&<p className="warn" role="status">Study help is not set up on this server yet. Ask your teacher or administrator.</p>}
    {closed&&<p className="warn" role="status">{withdrawn?'You are no longer enrolled in this subject':'This term is closed'}, so you can read and delete earlier chats but not ask new questions.</p>}
    <details className="privacy"><summary><span aria-hidden="true">🔒</span> Private to you: teachers cannot read your chats <span className="muted">· how chats are handled</span></summary><p>Chats are private within LearnSync: teachers and administrators cannot open them. To answer, the text of your question and the lesson passages it needs are sent to the AI provider. Answers can be wrong, so check them against the lesson. Chats never change your progress or grades. Deleting a conversation removes it from LearnSync; copies may stay in backups until those expire.</p></details>
    <div className="study2">
      <aside className="chats" aria-label="Your conversations">
        <button className="primary wide" disabled={busy||closed} onClick={newChat}><span aria-hidden="true">＋</span> New conversation</button>
        {list.isPending?<p>Loading…</p>:chats.length===0?<p className="muted">No earlier chats yet.</p>:<ul className="chat-list">{chats.map(c=><li key={c.id}>
          <button className={`chat-item${c.id===active?' on':''}`} aria-current={c.id===active} disabled={busy} onClick={()=>{setActive(c.id);setError('')}}><span className="t">{c.title}</span><span className="muted">{new Date(c.updated_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></button></li>)}</ul>}
        {list.hasNextPage&&<button className="wide" disabled={list.isFetchingNextPage} onClick={()=>list.fetchNextPage()}>{list.isFetchingNextPage?'Loading…':'Load more chats'}</button>}</aside>
      <section className="panel convo" aria-label="Conversation">
        <header className="convo-head"><h3>{active?title:'New conversation'}</h3>
          {active&&<button type="button" className="danger" disabled={busy} onClick={()=>setConfirmDelete(true)}><span aria-hidden="true">🗑</span> Delete conversation</button>}</header>
        <div className="chat" role="log" aria-live="polite" ref={log}>
          {!active&&!waiting&&<div className="empty"><p><strong>What would you like to understand?</strong></p><p className="muted">English, Filipino and Taglish are all fine. Type a question, or let me help with a lesson:</p>{helper}</div>}
          {conversation.error&&<p role="alert">{conversation.error.message}</p>}
          {conversation.hasNextPage&&<button disabled={conversation.isFetchingNextPage} onClick={()=>conversation.fetchNextPage()}>{conversation.isFetchingNextPage?'Loading…':'Load earlier messages'}</button>}
          {messages.map(m=><div key={m.id} className={`msg ${m.role}`}><p className="eyebrow">{m.role==='user'?'You':'Study helper'}</p><p className="pre">{m.content}</p>
            {m.role==='assistant'&&m.analogy&&<aside className="analogy" aria-label="Everyday analogy"><p><strong>Everyday analogy: illustrative, not from the lesson.</strong></p><p className="pre">{m.analogy}</p>
              <p className="muted">This comparison simplifies the idea and may not fit every detail. Use the verified explanation and the lesson as your reference.</p></aside>}
            {m.role==='assistant'&&m.sources.length>0&&<p className="muted">Sources: {m.sources.map((s,i)=><span key={s.item_id}>{i>0&&' · '}<Link to={s.link}>{s.title}{s.locator?` (${s.locator})`:''}</Link>{s.cited?'':' (related)'}</span>)}</p>}
            {m.role==='assistant'&&m.sources.some(s=>s.quotes?.length)&&<details className="evidence"><summary>Where this came from</summary>
              {m.sources.filter(s=>s.quotes?.length).map(s=>s.quotes!.map((q,i)=><blockquote key={s.item_id+i}>“{q}” <span className="muted">— {s.title}</span></blockquote>))}
              <p className="muted">These words are copied from your teacher’s material. The explanation around them is the assistant’s and can be wrong, so check it against the lesson.</p></details>}
            {m.role==='assistant'&&m.suggestions?.length>0&&(['related','sequence'] as const).map(kind=>{const group=m.suggestions.filter(s=>s.kind===kind);
              return group.length>0&&<div className="suggest" key={kind}><p className="muted">{kind==='related'?'Related lessons you could explore':'Your next published lessons'}</p>
                <div className="chips">{group.map(s=><Link className="button" key={s.item_id} to={s.link} title={s.why}>{s.title}</Link>)}</div></div>})}</div>)}
          {waiting&&!messages.some(m=>m.role==='user'&&m.content===waiting)&&<div className="msg user"><p className="eyebrow">You</p><p className="pre">{waiting}</p></div>}
          {busy&&<div className="msg assistant thinking" role="status"><span className="dots" aria-hidden="true"><i/><i/><i/></span> Thinking…</div>}
        </div>
        {error&&<div className="warn" role="alert"><p>{error}</p><p>Your question is still in the box. Press Send again to retry; it will not be asked twice.</p></div>}
        {active&&helper}
        <form className="composer" onSubmit={ask}>
          <label className="sr-only" htmlFor="study-q">Your question</label>
          <textarea id="study-q" ref={box} rows={2} value={text} maxLength={1500} placeholder={closed?'Asking is closed for this subject.':'Ask about a lesson…  (Enter to send, Shift+Enter for a new line)'} disabled={busy||closed||!ready}
            onChange={e=>{setText(e.target.value);e.target.style.height='auto';e.target.style.height=`${Math.min(e.target.scrollHeight,200)}px`}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}/>
          <div className="composer-row">
            <label className="focus">Focus on<select value={focus} disabled={busy||closed||!ready} onChange={e=>setFocus(e.target.value)}><option value="">Whole subject</option>{items.data?.map(i=><option key={i.id} value={i.id}>{i.title}{i.kind==='lesson'?'':i.kind==='file'?' (file)':' (link)'}</option>)}</select></label>
            <span className="muted">{text.length}/1500</span>
            <button className="primary" disabled={busy||closed||!ready||!text.trim()}>{error?'Send again':'Send'}</button></div>
        </form>
      </section></div>
    {confirmDelete&&<Dialog title="Delete this conversation?" onClose={()=>setConfirmDelete(false)}>
      <p><strong>{title}</strong></p>
      <p>All of its messages will be removed from LearnSync. This cannot be undone, and it does not change your progress or grades. Copies may remain in backups until those expire.</p>
      <div className="actions"><button type="button" onClick={()=>setConfirmDelete(false)}>Keep it</button><button type="button" className="danger solid" onClick={removeConversation}>Delete conversation</button></div></Dialog>}
  </>;
}
