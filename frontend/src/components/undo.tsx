import {createContext,useCallback,useContext,useRef,useState,type ReactNode} from 'react';

/** One toast at a time, bottom-left. With an undo function it offers Undo (instead of "are you sure?" for edits that can
 *  simply be put back); without one it is plain feedback that an action worked. The region is always present so screen
 *  readers announce the message when it appears. */
type OfferFn=(message:string,undo?:()=>void)=>void;
const UndoContext=createContext<OfferFn>(()=>{});
export const useUndo=()=>useContext(UndoContext);
/** Short confirmation of an action result: `toast('Attendance saved.')`. */
export const useToast=()=>useContext(UndoContext);

const UNDO_MS=10000,PLAIN_MS=5000;

export function UndoProvider({children}:{children:ReactNode}){
  const [toast,setToast]=useState<{id:number;message:string;undo?:()=>void}|null>(null);
  const timer=useRef(0);
  const offer=useCallback<OfferFn>((message,undo)=>{
    window.clearTimeout(timer.current);
    const id=Date.now();setToast({id,message,undo});
    timer.current=window.setTimeout(()=>setToast(t=>t&&t.id===id?null:t),undo?UNDO_MS:PLAIN_MS);
  },[]);
  return <UndoContext.Provider value={offer}>{children}
    <div className="toast-region" role="status" aria-live="polite">{toast&&<div className="toast"><span aria-hidden="true">✓</span><span>{toast.message}</span>
      {toast.undo&&<button type="button" onClick={()=>{toast.undo!();setToast(null)}}>Undo</button>}
      <button type="button" aria-label="Dismiss" onClick={()=>setToast(null)}>×</button></div>}</div></UndoContext.Provider>;
}
