import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {api,post,send,errorText,ApiError} from '../../app/api';
import {Dialog} from '../../components/Dialog';
import {queryClient} from '../../app/providers';
import type {LearnItem} from '../teaching/types';
import type {AiStatus,Conversation,ConversationSummary,StudyMessage} from './types';
import {SimulatorNotice} from './Study';

type Action='simplify'|'summary'|'example'|'analogy';
const ACTIONS:{key:Action;label:string}[]=[{key:'simplify',label:'Explain simply'},{key:'summary',label:'Summarize'},{key:'example',label:'Give an example'},{key:'analogy',label:'Everyday analogy'}];

export type ChatState='idle'|'thinking'|'happy'|'paused';
interface ChatProps{offeringId:string;canAsk:boolean;closedNote?:string;active:string|null;onActive:(id:string|null)=>void;onState?:(s:ChatState)=>void;compact?:boolean}

/** The conversation itself (messages, lesson helpers, composer, delete). The subject comes in as props, so the same
 *  component serves the floating Study buddy and the dedicated page. Which conversation is open is the parent's choice. */
export function StudyChat({offeringId,canAsk,closedNote='',active,onActive,onState,compact=false}:ChatProps){
  const closed=!canAsk;   // history stays readable and deletable; asking does not
  const [confirmDelete,setConfirmDelete]=useState(false);
  const base=`/learn/offerings/${offeringId}/study/conversations`;
  const [text,setText]=useState('');const [focus,setFocus]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [waiting,setWaiting]=useState('');
  const attempt=useRef<{id:string;text:string}|null>(null);   // a retry of the same question reuses its id, so it is never stored or answered twice
  const status=useQuery({queryKey:['ai-status'],queryFn:()=>api<AiStatus>('/ai/status')});
  const items=useQuery({queryKey:['learn-items',offeringId],queryFn:()=>api<LearnItem[]>(`/learn/offerings/${offeringId}/items`)});
  const conversation=useInfiniteQuery({queryKey:['study-conv',active],enabled:!!active,initialPageParam:'',
    queryFn:({pageParam})=>api<Conversation>(`${base}/${active}?limit=50${pageParam?`&cursor=${encodeURIComponent(pageParam)}`:''}`),
    getNextPageParam:p=>p.next_cursor??undefined});
  async function removeConversation(){
    try{await send('DELETE',`${base}/${active}`);setConfirmDelete(false);onActive(null);setError('');await refreshLists()}
    catch(err){setError(errorText(err));setConfirmDelete(false)}
  }
  const ready=status.data?.configured!==false;
  const refreshLists=()=>Promise.all([queryClient.invalidateQueries({queryKey:['study-all']}),queryClient.invalidateQueries({queryKey:['study-list']})]);
  const flash=(s:ChatState)=>{onState?.(s);if(s==='happy')window.setTimeout(()=>onState?.('idle'),2200)};

  const ask=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();void submit({text:text.trim(),selected_item_id:focus||null},text.trim())};
  async function submit(body:{text:string;selected_item_id:string|null;action?:Action},shown:string){
    if(!shown||busy)return;
    const key=body.action?`${body.action}:${body.selected_item_id}`:shown;   // a retry of the same thing reuses its id
    const sending={id:attempt.current?.text===key?attempt.current.id:crypto.randomUUID(),text:key};attempt.current=sending;
    setBusy(true);setError('');setWaiting(shown);onState?.('thinking');
    try{
      let id=active;
      if(!id){const c=await post<ConversationSummary>(base,{});id=c.id;onActive(id)}
      await post(`${base}/${id}/messages`,{...body,client_message_id:sending.id});
      attempt.current=null;if(!body.action)setText('');
      await Promise.all([queryClient.invalidateQueries({queryKey:['study-conv',id]}),refreshLists()]);
      flash('happy')
    }catch(err){setError(errorText(err));flash(err instanceof ApiError&&err.code==='quiz_in_progress'?'paused':'idle')}   // the question stays in the box, so Send again retries it
    finally{setBusy(false);setWaiting('')}
  }

  const messages:StudyMessage[]=[...(conversation.data?.pages??[])].reverse().flatMap(p=>p.messages);   // pages arrive newest first
  const log=useRef<HTMLDivElement>(null);const box=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{const el=log.current;if(el)el.scrollTop=el.scrollHeight},[messages.length,busy,active]);   // keep the newest message in view
  const title=conversation.data?.pages[0]?.title||'New conversation';
  // one-tap helpers act on ONE lesson: the one chosen under "Focus on", else the student's next lesson
  const target=items.data?.find(i=>i.id===focus)??items.data?.find(i=>i.up_next)??items.data?.find(i=>i.kind==='lesson');
  const doAction=(a:Action)=>{if(target)void submit({text:'',selected_item_id:target.id,action:a},`${ACTIONS.find(x=>x.key===a)!.label}: ${target.title}`)};
  const helper=<div className="helper" role="group" aria-label="Lesson helper">
    {target?<p className="muted">Help with <strong>{target.title}</strong>{focus?'':' (your next lesson; change it under “Focus on”)'}:</p>:<p className="muted">Lessons appear here once your teacher publishes them.</p>}
    <div className="chips">{ACTIONS.map(a=><button key={a.key} type="button" disabled={!target||busy||closed||!ready} onClick={()=>doAction(a.key)}>{a.label}</button>)}</div></div>;
  return <>
    <SimulatorNotice status={status.data}/>
    {status.data&&!status.data.configured&&<p className="warn" role="status">Study help is not set up on this server yet. Ask your teacher or administrator.</p>}
    {closed&&closedNote&&<p className="warn" role="status">{closedNote}</p>}
    <details className="privacy"><summary><span aria-hidden="true">🔒</span> Private to you: teachers cannot read your chats <span className="muted">· how chats are handled</span></summary><p>Chats are private within LearnSync: teachers and administrators cannot open them. To answer, the text of your question and the lesson passages it needs are sent to the AI provider. Answers can be wrong, so check them against the lesson. Chats never change your progress or grades. Deleting a conversation removes it from LearnSync; copies may stay in backups until those expire.</p></details>
    <div className={compact?'study-compact':''}>
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
        {active&&(compact?<details className="helper-fold"><summary>Lesson helpers</summary>{helper}</details>:helper)}
        <form className="composer" onSubmit={ask}>
          <label className="sr-only" htmlFor="study-q">Your question</label>
          <textarea id="study-q" ref={box} rows={2} value={text} maxLength={1500} placeholder={closed?'Asking is closed for this subject.':'Ask about a lesson…  (Enter to send, Shift+Enter for a new line)'} disabled={busy||closed||!ready}
            onChange={e=>{setText(e.target.value);e.target.style.height='auto';e.target.style.height=`${Math.min(e.target.scrollHeight,200)}px`}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}/>
          <div className="composer-row">
            <label className="focus">Focus on<select value={focus} disabled={busy||closed||!ready} onChange={e=>setFocus(e.target.value)}><option value="">Whole subject</option>{items.data?.map(i=><option key={i.id} value={i.id}>{i.title}{i.kind==='lesson'?'':i.kind==='file'?' (file)':' (link)'}</option>)}</select></label>
            <span className="muted">{text.length}/1500</span>
            {compact&&active&&<button type="button" className="danger icon" aria-label="Delete conversation" title="Delete conversation" disabled={busy} onClick={()=>setConfirmDelete(true)}><span aria-hidden="true">🗑</span></button>}
            <button className="primary" disabled={busy||closed||!ready||!text.trim()}>{error?'Send again':'Send'}</button></div>
        </form>
      </section>
    </div>
    {confirmDelete&&<Dialog title="Delete this conversation?" onClose={()=>setConfirmDelete(false)}>
      <p><strong>{title}</strong></p>
      <p>All of its messages will be removed from LearnSync. This cannot be undone, and it does not change your progress or grades. Copies may remain in backups until those expire.</p>
      <div className="actions"><button type="button" onClick={()=>setConfirmDelete(false)}>Keep it</button><button type="button" className="danger solid" onClick={removeConversation}>Delete conversation</button></div></Dialog>}
  </>;
}
