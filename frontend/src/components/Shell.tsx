import {useEffect,useRef,useState} from 'react';
import {Link,NavLink,Outlet,Navigate} from 'react-router-dom';
import {useAuth,useTheme,queryClient} from '../app/providers';
import {useQuery} from '@tanstack/react-query';
import {api,post,setCsrf} from '../app/api';
import {studentHomeQuery} from '../features/dashboard/Dashboards';
import {useUnread} from './seen';
import {StudyBuddy} from '../features/study/StudyBuddy';
import {useConfirm} from './confirm';
import type {SchoolYear} from '../features/academics/types';

type NavItem={to:string;label:string;icon:string;end?:boolean;dot?:boolean;children?:NavItem[]};
const ROLE_LABEL={admin:'Academic administrator',faculty:'Teaching faculty',student:'Student'} as const;

/** Grouped navigation. Icons are decoration only (aria-hidden); every entry has a visible text label. */
function navigation(role:'admin'|'faculty'|'student', schoolYears?:SchoolYear[]):{label:string;items:NavItem[]}[]{
  const home='/'+role;
  const account={label:'Account & help',items:[{to:'/account',label:'Account & theme',icon:'○'}]};
  if(role==='admin'){
    const terms=(schoolYears??[]).flatMap(year=>year.terms.map(term=>({to:`${home}/terms/${term.id}`,label:`${year.label} · ${term.name}`,icon:'↳'})));
    return [
      {label:'Your workspace',items:[{to:home,label:'Dashboard',icon:'⌂',end:true},{to:`${home}/accounts`,label:'User accounts',icon:'♙'}]},
      {label:'Academic management',items:[{to:`${home}/academics`,label:'School years',icon:'☰',children:terms.length?terms:undefined},{to:`${home}/subjects`,label:'Prospectus',icon:'▤'}]},
      {label:'Oversight',items:[{to:`${home}/issues`,label:'Reports',icon:'?'},{to:`${home}/audit`,label:'Audit history',icon:'◷'}]},
      account];
  }
  const student=role==='student';
  const review=role==='faculty'?[{to:`${home}/review`,label:'To review',icon:'✎'}]:[];
  return [
    {label:'Your workspace',items:[{to:home,label:'Dashboard',icon:'⌂',end:true,dot:student},...(student?[{to:`${home}/todo`,label:'To do',icon:'☑'},{to:`${home}/study-buddy`,label:'Study buddy',icon:'✦'}]:review),{to:`${home}/subjects`,label:'My subjects',icon:'▤'}]},
    {label:'Account & help',items:[{to:`${home}/issues`,label:'Report a problem',icon:'?'},...account.items]}];
}
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]!.toUpperCase()).join('')||'?';

/** A dot beside Dashboard while there are course updates this browser has not shown yet (students only). */
function UpdatesDot({userId}:{userId:string}){
  const latest=useQuery(studentHomeQuery).data?.updates[0]?.at;
  return useUnread(userId,latest)?<span className="dot" role="img" aria-label="New course updates"/>:null;
}

export function Shell(){
  const ask=useConfirm();
  const {session,loading,error}=useAuth();const {theme,setTheme}=useTheme();
  const schoolYears=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const [open,setOpen]=useState(false);const [failure,setFailure]=useState('');
  const menuButton=useRef<HTMLButtonElement>(null);
  // the phone menu is a disclosure: Escape closes it and gives focus back to the button that opened it
  useEffect(()=>{if(!open)return;const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);menuButton.current?.focus()}};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[open]);
  // the sticky sidebar sits under the header, whose height changes when it wraps
  useEffect(()=>{const h=document.querySelector('.header');if(!h)return;const set=()=>document.documentElement.style.setProperty('--header-h',h.getBoundingClientRect().height+'px');set();const ro=new ResizeObserver(set);ro.observe(h);return()=>ro.disconnect()},[loading,session?.user]);
  if(loading)return <main className="content">Loading your workspace…</main>;
  if(error)return <main className="content"><p role="alert">Cannot reach the server. Please refresh after starting it.</p></main>;
  if(!session?.user)return <Navigate to="/login" replace/>;
  const user=session.user;const home='/'+user.role;
  // the header selector saves to the account too, otherwise a saved preference would undo it on the next load
  async function chooseTheme(value:'system'|'light'|'dark'){
    setTheme(value);
    try{await api('/me/preferences',{method:'PATCH',body:JSON.stringify({theme:value})});await queryClient.invalidateQueries({queryKey:['session']})}
    catch{/* the choice still applies in this browser */}
  }
  async function logout(){
    // A recovery copy exists only while edits are not on the server, so its presence means unsaved work.
    const unsaved=(()=>{try{return Object.keys(localStorage).some(k=>k.startsWith(`learnsync:draft:${user.id}:`))}catch{return false}})();
    if(unsaved&&!await ask({title:'Sign out?',message:'Some of your changes are saved only in this browser, not on the server yet. Signing out deletes them.',yes:'Sign out anyway',danger:true}))return;
    try{await post('/auth/logout',{});for(const key of Object.keys(localStorage)){if(key.startsWith('learnsync:draft:'))localStorage.removeItem(key)}setCsrf('');queryClient.clear();window.location.assign('/login')}
    catch(e){setFailure(e instanceof Error?e.message:'Sign out failed.')}
  }
  return <div className="app-shell">
    <a href="#main" className="skip">Skip to content</a>
    <header className="header">
      <button ref={menuButton} className="menu" aria-label="Toggle navigation" aria-expanded={open} onClick={()=>setOpen(!open)}>☰</button>
      <Link to={home} className="brand"><span className="mark" aria-hidden="true">L</span>LearnSync</Link>
      <span className="school">GMVCC · BS Entrepreneurship</span>
      <div className="identity">
        <div className="who"><strong>{user.display_name}</strong><span>{ROLE_LABEL[user.role]}</span></div>
        <span className="avatar" aria-hidden="true">{initials(user.display_name)}</span>
        <label className="theme-label"><span className="sr-only">Theme</span><select value={theme} onChange={e=>void chooseTheme(e.target.value as 'system'|'light'|'dark')}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <button onClick={logout}>Sign out</button>
      </div>
    </header>
    <aside className={'sidebar '+(open?'open':'')}>
      <nav aria-label="Main" onClick={()=>setOpen(false)}>
        {navigation(user.role, schoolYears.data).map(group=><div className="nav-group" key={group.label}>
          <p className="nav-label">{group.label}</p>
          {group.items.map(i=>i.children?
            <div className="nav-subgroup" key={i.to}>
              <NavLink to={i.to} end={i.end} className={({isActive})=>isActive?'active':undefined}>
                <span className="nav-icon" aria-hidden="true">{i.icon}</span>{i.label}
              </NavLink>
              {i.children.map(child=><NavLink key={child.to} to={child.to} className={({isActive})=>isActive?'active nav-child':'nav-child'}>
                <span className="nav-icon" aria-hidden="true">{child.icon}</span>{child.label}
              </NavLink>)}
            </div> :
            <NavLink key={i.to} to={i.to} end={i.end} className={({isActive})=>isActive?'active':''}>
              <span className="nav-icon" aria-hidden="true">{i.icon}</span>{i.label}{i.dot&&<UpdatesDot userId={user.id}/>}
            </NavLink>) }
        </div>)}
      </nav>
      <p className="sidebar-note">Governor Mariano E. Villafuerte Community College<br/>BS Entrepreneurship</p>
    </aside>
    <main id="main" className="content">{failure&&<p role="alert" className="error">{failure}</p>}<Outlet/></main>
    {user.role==='student'&&<StudyBuddy userId={user.id}/>}
  </div>;
}
