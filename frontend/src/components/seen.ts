import {useEffect,useState} from 'react';

// Per-browser "seen" marker for course updates: a convenience, not a record (it does not follow the student to another device).
const key=(uid:string)=>`learnsync:updates-seen:${uid}`;
const EVENT='learnsync:seen';
export const readSeen=(uid:string):number=>{try{return Number(localStorage.getItem(key(uid)))||0}catch{return 0}};
export function markSeen(uid:string,latest:string){
  const at=Date.parse(latest);if(!Number.isFinite(at))return;
  // never move backwards: older cached data must not bring the dot back
  try{localStorage.setItem(key(uid),String(Math.max(readSeen(uid),at)))}catch{/* private window: the dot just stays */}
  window.dispatchEvent(new Event(EVENT));
}
/** True while the newest update is later than what this browser last showed on the dashboard (new since you last viewed it HERE, not proof it was read). */
export function useUnread(uid:string,latest?:string){
  const [,tick]=useState(0);
  useEffect(()=>{const on=()=>tick(n=>n+1);window.addEventListener(EVENT,on);window.addEventListener('storage',on);return()=>{window.removeEventListener(EVENT,on);window.removeEventListener('storage',on)}},[]);
  return !!latest&&Date.parse(latest)>readSeen(uid);
}
