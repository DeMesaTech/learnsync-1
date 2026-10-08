import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';

/** One consistent confirmation for what cannot be undone or what students will see at once. Reversible edits use Undo
 *  instead (see undo.tsx). Cancel comes first in the DOM, so it is the focused default. */
export interface Ask{title?:string;message:ReactNode;yes?:string;no?:string;danger?:boolean}
type AskFn=(ask:string|Ask)=>Promise<boolean>;

const ConfirmContext=createContext<AskFn>(async()=>true);
export const useConfirm=()=>useContext(ConfirmContext);

export function ConfirmProvider({children}:{children:ReactNode}){
  const [open,setOpen]=useState<{ask:Ask;resolve:(answer:boolean)=>void}|null>(null);
  const ask=useCallback<AskFn>(a=>new Promise<boolean>(resolve=>setOpen({ask:typeof a==='string'?{message:a}:a,resolve})),[]);
  const answer=(value:boolean)=>{open?.resolve(value);setOpen(null)};
  return <ConfirmContext.Provider value={ask}>{children}{open&&<ConfirmDialog ask={open.ask} onAnswer={answer}/>}</ConfirmContext.Provider>;
}

function ConfirmDialog({ask,onAnswer}:{ask:Ask;onAnswer:(answer:boolean)=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;const origin=document.activeElement as HTMLElement|null;d?.showModal();return()=>{d?.close();origin?.focus()}},[]);
  return <dialog ref={ref} data-confirm aria-labelledby="confirm-title" aria-describedby="confirm-body" onCancel={e=>{e.preventDefault();onAnswer(false)}}>
    <h2 id="confirm-title">{ask.title??'Are you sure?'}</h2>
    <div id="confirm-body">{typeof ask.message==='string'?<p>{ask.message}</p>:ask.message}</div>
    <div className="actions"><button type="button" data-confirm-no onClick={()=>onAnswer(false)}>{ask.no??'Cancel'}</button>
      <button type="button" data-confirm-yes className={ask.danger?'danger solid':'primary'} onClick={()=>onAnswer(true)}>{ask.yes??'Continue'}</button></div></dialog>;
}
