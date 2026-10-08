import {useCallback,useEffect,useRef,useState} from 'react';
import {useConfirm} from '../../components/confirm';
import {useBlocker} from 'react-router-dom';
import {ApiError} from '../../app/api';

export type SaveStatus='saved'|'dirty'|'saving'|'offline'|'failed'|'conflict';
interface Stored<T>{value:T;counter:number;at:string}

/** localStorage is a convenience copy on this device only; every access is guarded. */
function readStored<T>(key:string):Stored<T>|null{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null}catch{return null}}
function removeStored(key:string){try{localStorage.removeItem(key)}catch{/* optional */}}

/**
 * Debounced server autosave with a compare-and-swap counter, an immediate browser recovery copy,
 * explicit offline/failed/conflict states and a flush for navigation. The recovery key must
 * include the account, offering and entity: it starts with `learnsync:draft:` so logout clears it.
 */
export function useAutosave<T>({storageKey,initial,counter,save,delay=1000}:{
  storageKey:string;initial:T;counter:number;delay?:number;
  save:(value:T,counter:number)=>Promise<{counter:number}>;
}){
  const [value,setValueState]=useState<T>(initial);
  const [status,setStatus]=useState<SaveStatus>('saved');
  const [message,setMessage]=useState('');
  const [storageFailed,setStorageFailed]=useState(false);
  const [recovered,setRecovered]=useState<Stored<T>|null>(()=>{
    const stored=readStored<T>(storageKey);
    return stored&&JSON.stringify(stored.value)!==JSON.stringify(initial)?stored:null;
  });
  const latest=useRef(initial);const counterRef=useRef(counter);const dirty=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>>(undefined);const retryTimer=useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight=useRef<Promise<boolean>|null>(null);
  const failed=useRef(false);
  const saveRef=useRef(save);
  const conflict=useRef(false);
  useEffect(()=>{saveRef.current=save});

  const persist=useCallback((v:T)=>{
    try{localStorage.setItem(storageKey,JSON.stringify({value:v,counter:counterRef.current,at:new Date().toISOString()}));setStorageFailed(false)}
    catch{setStorageFailed(true)}
  },[storageKey]);

  /** Save now. A save that is already running is joined, never duplicated. */
  const run=useCallback(():Promise<boolean>=>{
    if(inflight.current)return inflight.current;
    if(!dirty.current)return Promise.resolve(true);
    failed.current=false;setStatus('saving');setMessage('');
    const sent=latest.current;
    const attempt=(async():Promise<boolean>=>{
      try{
        const result=await saveRef.current(sent,counterRef.current);
        counterRef.current=result.counter;
        if(latest.current===sent){dirty.current=false;removeStored(storageKey);setStatus('saved');return true}
        setStatus('dirty');timer.current=setTimeout(()=>void run(),delay);return false;   // typed more while saving
      }catch(e){
        failed.current=true;
        if(e instanceof ApiError&&e.code==='draft_revision_conflict'){conflict.current=true;setStatus('conflict');setMessage(e.message)}
        else if(e instanceof ApiError){setStatus('failed');setMessage(e.message)}
        else{setStatus('offline');setMessage('You appear to be offline. Your changes are kept in this browser and will retry.');
          retryTimer.current=setTimeout(()=>void run(),5000)}
        return false;
      }finally{inflight.current=null}
    })();
    inflight.current=attempt;
    return attempt;
  },[storageKey,delay]);

  const setValue=useCallback((next:T|((prev:T)=>T))=>{
    const v=typeof next==='function'?(next as (p:T)=>T)(latest.current):next;
    latest.current=v;dirty.current=true;setValueState(v);setStatus(s=>s==='conflict'?'conflict':'dirty');persist(v);
    clearTimeout(timer.current);
    if(conflict.current)return;
    timer.current=setTimeout(()=>void run(),delay);
  },[persist,run,delay]);

  /** Resolves true only when everything typed so far is on the server. Waits for a running save. */
  const flush=useCallback(async():Promise<boolean>=>{
    clearTimeout(timer.current);clearTimeout(retryTimer.current);
    for(let i=0;i<4;i++){
      if(inflight.current)await inflight.current;
      if(!dirty.current)return true;
      if(conflict.current)return false;
      if(await run())return true;
      if(failed.current)return false;
    }
    return !dirty.current;
  },[run]);

  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{if(dirty.current)e.preventDefault()};
    const online=()=>{if(dirty.current&&!conflict.current)void run()};
    addEventListener('beforeunload',warn);addEventListener('online',online);
    return()=>{removeEventListener('beforeunload',warn);removeEventListener('online',online);clearTimeout(timer.current);clearTimeout(retryTimer.current)};
  },[run]);

  return {
    value,setValue,status,message,storageFailed,flush,recovered,
    counter:()=>counterRef.current,
    /** After a change made outside autosave (e.g. a file upload) bumped the server counter. */
    adoptCounter:(n:number)=>{counterRef.current=n},
    retry:()=>{setStatus('dirty');void run()},
    /** Restore against the revision the copy was made from, so newer server work still raises a conflict. */
    restoreRecovered:()=>{if(recovered){counterRef.current=recovered.counter;setValue(recovered.value);setRecovered(null)}},
    discardRecovered:()=>{removeStored(storageKey);setRecovered(null)},
    /** Conflict: keep this version and overwrite the newer server draft on purpose. */
    overwrite:(serverCounter:number)=>{conflict.current=false;counterRef.current=serverCounter;setStatus('dirty');void run()},
    /** Conflict: take the server's version and drop local edits. */
    useServer:(serverValue:T,serverCounter:number)=>{
      conflict.current=false;clearTimeout(timer.current);latest.current=serverValue;counterRef.current=serverCounter;dirty.current=false;
      removeStored(storageKey);setValueState(serverValue);setStatus('saved');setMessage('');
    },
  };
}

export const draftKey=(userId:string|undefined,offeringId:string|undefined,entity:string)=>`learnsync:draft:${userId}:${offeringId}:${entity}`;

const labels:Record<SaveStatus,string>={saved:'Saved',dirty:'Unsaved changes…',saving:'Saving…',offline:'Offline',failed:'Save failed',conflict:'Conflict'};
export function SaveIndicator({status,message,storageFailed,onRetry}:{status:SaveStatus;message:string;storageFailed:boolean;onRetry:()=>void}){
  return <div className="save-indicator" role="status" aria-live="polite">
    <span className={`badge save-${status}`}>{labels[status]}</span>
    {(status==='failed'||status==='offline')&&<> <span>{message}</span> <button type="button" onClick={onRetry}>Retry now</button></>}
    {storageFailed&&<p className="warn" role="alert">This browser could not keep a recovery copy (storage is full or blocked). Keep this tab open until it says Saved.</p>}
  </div>;
}

/** Navigation guard: try to save first; if that fails, ask before leaving (the browser copy is kept). */
export function useFlushOnLeave(status:SaveStatus,flush:()=>Promise<boolean>){
  const ask=useConfirm();
  const blocker=useBlocker(()=>status!=='saved');
  useEffect(()=>{
    if(blocker.state!=='blocked')return;
    void flush().then(async ok=>{
      if(ok||await ask({title:'Leave without saving?',message:'Your latest changes could not be saved to the server. They are kept in this browser, but leaving now may lose them if the page is cleared.',yes:'Leave anyway',no:'Stay',danger:true}))blocker.proceed();
      else blocker.reset();
    });
  },[blocker,flush,ask]);
}

/** Recovery and conflict notices shared by editors. `reload` fetches the server's current draft. */
export function DraftNotices<T>({auto,reload,onError}:{auto:ReturnType<typeof useAutosave<T>>;reload:()=>Promise<{value:T;counter:number}>;onError:(message:string)=>void}){
  const fail=(e:unknown)=>onError(e instanceof Error?e.message:'Something went wrong. Try again.');
  return <>
    {auto.recovered&&<div className="warn" role="alert"><p>Unsaved changes from this browser were found ({new Date(auto.recovered.at).toLocaleString()}). They are not on the server.</p>
      <div className="actions"><button className="primary" onClick={auto.restoreRecovered}>Restore my changes</button><button onClick={auto.discardRecovered}>Discard them</button></div></div>}
    {auto.status==='conflict'&&<div className="warn" role="alert"><p><strong>This draft was changed somewhere else</strong> (another tab or device). Nothing has been overwritten. Choose which version to continue with.</p>
      <div className="actions"><button onClick={()=>{reload().then(s=>auto.useServer(s.value,s.counter)).catch(fail)}}>Load the newer version (drops my unsaved edits)</button>
        <button className="primary" onClick={()=>{reload().then(s=>auto.overwrite(s.counter)).catch(fail)}}>Keep my version (overwrites the newer one)</button></div></div>}
  </>;
}
