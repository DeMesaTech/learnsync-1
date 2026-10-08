import {createContext,useCallback,useContext,useRef,useState,type ReactNode} from 'react';

/** Undo instead of "are you sure?" for edits that can simply be put back. The region is always present so screen
 *  readers announce the message when it appears. */
type OfferFn=(message:string,undo:()=>void)=>void;
const UndoContext=createContext<OfferFn>(()=>{});
export const useUndo=()=>useContext(UndoContext);

const SHOWN_MS=10000;

export function UndoProvider({children}:{children:ReactNode}){
  const [toast,setToast]=useState<{id:number;message:string;undo:()=>void}|null>(null);
  const timer=useRef(0);
  const offer=useCallback<OfferFn>((message,undo)=>{
    window.clearTimeout(timer.current);
    const id=Date.now();setToast({id,message,undo});
    timer.current=window.setTimeout(()=>setToast(t=>t&&t.id===id?null:t),SHOWN_MS);
  },[]);
  return <UndoContext.Provider value={offer}>{children}
    <div className="toast-region" role="status" aria-live="polite">{toast&&<div className="toast"><span>{toast.message}</span>
      <button type="button" onClick={()=>{toast.undo();setToast(null)}}>Undo</button>
      <button type="button" aria-label="Dismiss" onClick={()=>setToast(null)}>×</button></div>}</div></UndoContext.Provider>;
}
