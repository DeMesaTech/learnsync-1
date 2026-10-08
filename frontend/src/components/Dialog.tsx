import {useEffect,useRef,type ReactNode} from 'react';
import {useConfirm} from './confirm';
/** Native modal dialog. Escape and × ask before throwing away anything typed; the Cancel button inside a form is an explicit choice and does not. */
export function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ask=useConfirm();
 const ref=useRef<HTMLDialogElement>(null);const dirty=useRef(false);
 useEffect(()=>{const d=ref.current;const origin=document.activeElement as HTMLElement|null;d?.showModal();return()=>{d?.close();origin?.focus()}},[]);
 const dismiss=async()=>{if(dirty.current&&!await ask({title:'Close without saving?',message:'What you typed here will be lost.',yes:'Close and discard',no:'Keep editing',danger:true}))return;onClose()};
 return <dialog ref={ref} aria-labelledby="dialog-title" onInput={()=>{dirty.current=true}} onCancel={e=>{e.preventDefault();dismiss()}}><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" aria-label="Close dialog" onClick={dismiss}>×</button></div>{children}</dialog>
}
