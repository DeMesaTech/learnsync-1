import {useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import {studentHomeQuery} from '../dashboard/Dashboards';
import {StudyChat,type ChatState} from './StudyChat';
import {Owl} from './Owl';
import type {AllConversationsPage} from './types';

interface Open{offeringId:string;id:string|null;canAsk:boolean;note:string}
const NOTE='You can read and delete earlier chats here, but this subject is no longer open for new questions (the term is closed or you are no longer enrolled).';

/** Every Study buddy conversation across the student's subjects: a list on the left, the chat on the right. */
export function StudyBuddyPage(){
  const [params,setParams]=useSearchParams();
  const filter=params.get('subject')??'';
  const current=useQuery(studentHomeQuery).data?.subjects??[];
  const list=useInfiniteQuery({queryKey:['study-all',filter],initialPageParam:'',
    queryFn:({pageParam})=>api<AllConversationsPage>(`/learn/study/conversations?limit=25${filter?`&offering_id=${filter}`:''}${pageParam?`&cursor=${encodeURIComponent(pageParam)}`:''}`),
    getNextPageParam:p=>p.next_cursor??undefined});
  const chats=list.data?.pages.flatMap(p=>p.items)??[];
  // subjects to filter by: the current ones plus any past subject that still has chats
  const options=[...current.map(s=>({id:s.offering_id,label:`${s.code} · ${s.title}`})),
    ...chats.filter(c=>!current.some(s=>s.offering_id===c.offering_id)).map(c=>({id:c.offering_id,label:`${c.subject_code} · ${c.subject_title} (past)`}))]
    .filter((o,i,all)=>all.findIndex(x=>x.id===o.id)===i);
  const [open,setOpen]=useState<Open|null>(null);
  const [pet,setPet]=useState<ChatState>('idle');
  const [newIn,setNewIn]=useState('');
  const target=newIn||filter&&current.find(s=>s.offering_id===filter)?.offering_id||current[0]?.offering_id||'';
  const startNew=()=>{if(target)setOpen({offeringId:target,id:null,canAsk:true,note:''})};
  const petState=pet==='thinking'||pet==='happy'||pet==='paused'?pet:'idle';
  return <>
    <div className="page-heading buddy-page-head"><Owl state={petState} size={64}/><div><p className="eyebrow">Study buddy</p><h1>Your conversations</h1>
      <p className="muted">Everything you have asked your Study buddy, across all your subjects. Private to you: teachers cannot read these chats. Answers use only the lessons your teacher published.</p></div></div>
    <div className={`study2 buddy-page${open?' has-open':''}`}>
      <aside className="chats" aria-label="Your conversations">
        <label>Subject<select value={filter} onChange={e=>{const v=e.target.value;setParams(v?{subject:v}:{});setOpen(null)}}><option value="">All subjects</option>{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        {current.length>1&&<label>New conversation about<select value={target} onChange={e=>setNewIn(e.target.value)}>{current.map(s=><option key={s.offering_id} value={s.offering_id}>{s.code} · {s.title}</option>)}</select></label>}
        <button className="primary wide" disabled={!target} onClick={startNew}><span aria-hidden="true">＋</span> New conversation</button>
        {list.isPending?<p>Loading…</p>:list.error?<p role="alert">{list.error.message}</p>:chats.length===0?<p className="muted">No conversations yet. Start one and ask about a lesson.</p>:
          <ul className="chat-list">{chats.map(c=><li key={c.id}>
            <button className={`chat-item${open?.id===c.id?' on':''}`} aria-current={open?.id===c.id} onClick={()=>setOpen({offeringId:c.offering_id,id:c.id,canAsk:c.can_ask,note:c.can_ask?'':NOTE})}>
              <span className="t">{c.title}</span><span className="muted">{c.subject_code} · {new Date(c.updated_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}{c.can_ask?'':' · read only'}</span></button></li>)}</ul>}
        {list.hasNextPage&&<button className="wide" disabled={list.isFetchingNextPage} onClick={()=>list.fetchNextPage()}>{list.isFetchingNextPage?'Loading…':'Load more conversations'}</button>}
      </aside>
      <div className="buddy-main">
        {open?<>
          <button type="button" className="buddy-back" onClick={()=>setOpen(null)}>← All conversations</button>
          <StudyChat key={open.offeringId} offeringId={open.offeringId} canAsk={open.canAsk} closedNote={open.note} active={open.id}
            onActive={id=>setOpen(o=>o?{...o,id}:o)} onState={setPet}/></>
          :<section className="panel buddy-empty"><Owl size={72}/><h2>Pick a conversation, or start a new one</h2><p className="muted">Your chats are listed on the left. You can also ask quick questions from the Study buddy button in the corner of any page.</p></section>}
      </div>
    </div>
  </>;
}
