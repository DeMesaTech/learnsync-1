import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,errorText} from '../../app/api';
import type {SnapshotState} from './types';

/** A link on its own is never study material: faculty fetch or paste the text, read it, and approve it. */
export function ReferenceText({base,disabled,beforeFetch}:{base:string;disabled:boolean;beforeFetch:()=>Promise<boolean>}){
  const query=useQuery({queryKey:['snapshot',base],queryFn:()=>api<SnapshotState>(`${base}/reference/snapshot`)});
  const [text,setText]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const snap=query.data?.snapshot;
  useEffect(()=>{setText(snap?.text??'')},[snap?.id,snap?.text]);
  async function run(task:()=>Promise<unknown>,done:string){
    setBusy(true);setMessage('');
    try{await task();await query.refetch();setMessage(done)}catch(e){setMessage(errorText(e))}finally{setBusy(false)}
  }
  const fetchText=()=>run(async()=>{if(!await beforeFetch())throw new Error('Resolve the save problem above first.');await post(`${base}/reference/extract`,{})},'Text fetched. Read it, fix anything wrong, then approve it.');
  const save=(approve:boolean)=>run(()=>send('PUT',`${base}/reference/snapshot`,{text,approve}),approve?'Approved. It becomes searchable for study help when you publish this link.':'Text saved as a draft. Students cannot use it until you approve it.');
  return <section className="panel"><h3>Text for study help</h3>
    <p className="muted">Study help never reads a link by itself. Fetch the page text or paste your own, check it, and approve it. Approved text is used only after you publish, and changing the link address clears it.</p>
    {query.isPending?<p>Loading…</p>:<>
      <p>Status: <strong>{!snap?'No text yet':snap.status==='approved'?'Approved':'Fetched, not approved'}</strong>{snap&&<span className="muted"> · {snap.method==='manual'?'pasted by you':'fetched from the link'}</span>}</p>
      <div className="actions"><button type="button" disabled={disabled||busy} onClick={fetchText}>Fetch text from the link</button></div>
      <label>Reviewed text (up to 40,000 characters)<textarea rows={8} value={text} maxLength={40000} disabled={disabled||busy} onChange={e=>setText(e.target.value)}/></label>
      <div className="actions"><button type="button" disabled={disabled||busy||text.trim().length<40} onClick={()=>save(false)}>Save as draft</button>
        <button type="button" className="primary" disabled={disabled||busy||text.trim().length<40} onClick={()=>save(true)}>Approve for study help</button></div>
      {text.trim().length<40&&text.length>0&&<p className="muted">Write at least 40 characters.</p>}</>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
