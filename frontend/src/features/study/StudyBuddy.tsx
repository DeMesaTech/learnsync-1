import {useEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../app/api';
import {studentHomeQuery} from '../dashboard/Dashboards';
import {StudyChat,type ChatState} from './StudyChat';
import {Owl} from './Owl';
import type {AllConversationsPage} from './types';

const NONE:never[]=[];
const SUBJECT_KEY=(uid:string)=>`learnsync:buddy-subject:${uid}`;
const readSubject=(uid:string)=>{try{return localStorage.getItem(SUBJECT_KEY(uid))??''}catch{return ''}};

/** The floating Study buddy (students only). It lives in the app shell, so an open panel, the chosen subject and a
 *  half-typed question survive moving between pages. It is hidden on the Study buddy page itself and on a quiz attempt. */
export function StudyBuddy({userId}:{userId:string}){
  const {pathname}=useLocation();
  const subjects=useQuery(studentHomeQuery).data?.subjects??NONE;
  const routeSubject=pathname.match(/^\/student\/offerings\/([^/]+)/)?.[1]??'';
  const [open,setOpen]=useState(false);
  const [subject,setSubject]=useState(()=>readSubject(userId));
  // per subject: undefined = not decided yet (load the latest), null = the student chose a new chat, string = that conversation
  const [active,setActive]=useState<Record<string,string|null|undefined>>({});
  const [state,setState]=useState<ChatState>('idle');
  const launcher=useRef<HTMLButtonElement>(null);
  // on a subject's pages the buddy follows that subject; elsewhere it keeps the last one used
  useEffect(()=>{if(routeSubject&&subjects.some(s=>s.offering_id===routeSubject))setSubject(routeSubject)},[routeSubject,subjects]);
  const current=subjects.find(s=>s.offering_id===subject)??subjects[0];
  useEffect(()=>setState('idle'),[current?.offering_id]);
  const currentId=current?.offering_id;
  const undecided=!!currentId&&active[currentId]===undefined;
  const latest=useQuery({queryKey:['study-all','latest',currentId],enabled:open&&undecided,
    queryFn:()=>api<AllConversationsPage>(`/learn/study/conversations?limit=1&offering_id=${currentId}`)});
  // opening the buddy resumes the last conversation of this subject; a new chat is only ever started on request
  useEffect(()=>{if(currentId&&undecided&&latest.data)setActive(a=>a[currentId]===undefined?{...a,[currentId]:latest.data.items[0]?.id??null}:a)},[currentId,undecided,latest.data]);
  useEffect(()=>{if(current)try{localStorage.setItem(SUBJECT_KEY(userId),current.offering_id)}catch{/* not remembered in a private window */}},[current,userId]);
  useEffect(()=>{if(!open)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);launcher.current?.focus()}};
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[open]);
  useEffect(()=>{if(open)window.setTimeout(()=>document.getElementById('study-q')?.focus(),50)},[open,current?.offering_id]);

  const hidden=pathname.startsWith('/student/study-buddy')||/\/work\/[^/]+\/attempts\//.test(pathname);
  if(hidden)return null;
  const pet=state==='thinking'||state==='happy'||state==='paused'?state:'idle';
  return <div className="buddy">
    {open&&<section className="buddy-panel" role="dialog" aria-modal="false" aria-labelledby="buddy-title" id="buddy-panel">
      <header className="buddy-head">
        <Owl state={pet} size={40}/>
        <div className="buddy-title"><h2 id="buddy-title">Study buddy</h2>
          {subjects.length>1?<label className="sr-only" htmlFor="buddy-subject">Subject</label>:null}
          {subjects.length>1?<select id="buddy-subject" value={current?.offering_id} onChange={e=>setSubject(e.target.value)}>{subjects.map(s=><option key={s.offering_id} value={s.offering_id}>{s.code} · {s.title}</option>)}</select>
            :current?<p className="muted">{current.code} · {current.title}</p>:null}</div>
        <div className="buddy-actions">
          {current&&<button type="button" onClick={()=>setActive(a=>({...a,[current.offering_id]:null}))}>New chat</button>}
          <button type="button" className="icon" aria-label="Close Study buddy" onClick={()=>{setOpen(false);launcher.current?.focus()}}>×</button></div>
      </header>
      <div className="buddy-body">
        {current?(undecided&&!latest.error?<p className="muted" role="status">Loading your last conversation…</p>
          :<StudyChat key={current.offering_id} offeringId={current.offering_id} canAsk active={active[current.offering_id]??null}
            onActive={id=>setActive(a=>({...a,[current.offering_id]:id}))} onState={setState} compact/>)
          :<p className="muted">You are not enrolled in a current subject yet, so there is nothing to ask about.</p>}
      </div>
      <footer className="buddy-foot"><Link to={current?`/student/study-buddy?subject=${current.offering_id}`:'/student/study-buddy'} onClick={()=>setOpen(false)}>All conversations</Link></footer>
    </section>}
    {!(open&&window.matchMedia('(max-width:639px)').matches)&&
      <button ref={launcher} type="button" className="buddy-launch" aria-expanded={open} aria-controls="buddy-panel" onClick={()=>setOpen(!open)}>
        <Owl state={pet}/><span className="buddy-label">Study buddy</span><span className="sr-only">{open?'Close':'Open'} Study buddy chat</span></button>}
  </div>;
}
