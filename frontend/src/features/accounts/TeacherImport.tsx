import {useState,type FormEvent} from 'react';
import {post,send,upload,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {useConfirm} from '../../components/confirm';

interface ImportRow{
  row:number;
  display_name:string;
  email:string;
  status:'new'|'existing'|'error';
  errors:string[];
}
interface FacultyPreview{
  id:string;
  status:string;
  summary:{new:number;existing:number;errors:number;total:number};
  rows:ImportRow[];
}
interface ImportResult{created:number;existing:number;email_failed:string[]}

export function TeacherImport({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){
  const ask=useConfirm();
  const [preview,setPreview]=useState<FacultyPreview|null>(null);
  const [result,setResult]=useState<ImportResult|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);

  async function requestClose(){
    if(dirty&&!await ask({title:'Discard unsaved preview edits?',message:'Your edited names and email addresses have not been rechecked or saved yet.',yes:'Discard edits',danger:true}))return false;
    if(preview&&!dirty&&!await ask({title:'Close teacher import?',message:'This preview has not been imported. Closing now will leave these staged rows behind without adding any teacher accounts.',yes:'Close preview',danger:true}))return false;
    onClose();
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setBusy(true);setError('');setResult(null);setDirty(false);
    try{setPreview(await upload<FacultyPreview>('/faculty-imports',new FormData(e.currentTarget)))}
    catch(err){setError(errorText(err));setPreview(null)}
    finally{setBusy(false)}
  }

  function editRow(rowNumber:number,field:'display_name'|'email',value:string){
    setPreview(current=>current?{...current,rows:current.rows.map(row=>
      row.row===rowNumber?{...row,[field]:value}:row)}:current);
    setDirty(true);
  }

  async function saveEdits(){
    if(!preview)return;
    setBusy(true);setError('');
    try{
      const next=await send<FacultyPreview>('PUT',`/faculty-imports/${preview.id}`,{
        rows:preview.rows.map(({row,display_name,email})=>({row,display_name,email})),
      });
      setPreview(next);
      setDirty(false);
    }catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }

  async function commit(){
    if(!preview||dirty)return;
    setBusy(true);setError('');
    try{
      setResult(await post<ImportResult>(`/faculty-imports/${preview.id}/commit`,{}));
      setPreview(null);
      queryClient.invalidateQueries({queryKey:['accounts']});
      queryClient.invalidateQueries({queryKey:['faculty-list']});
      onDone();
    }catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }

  return <Dialog title="Import teachers" onClose={()=>busy?false:requestClose()} className="import-dialog" confirmOnClose={false}>
    <p className="muted">Upload a CSV or Excel file with <code>email</code> and <code>display_name</code> columns. Edit the preview and save your changes to recheck validation before inviting anyone. New teachers receive an invitation link to set their password.</p>
    <section className="panel"><form onSubmit={submit}>
      <label>Teacher list<input name="file" type="file" required accept=".csv,.xlsx" disabled={busy||!!preview}/></label>
      <button className="primary" disabled={busy||!!preview}>{busy?'Checking…':'Preview import'}</button>
    </form></section>
    {error&&<p role="alert">{error}</p>}
    {result&&<section className="panel" role="status">
      <h3>Import complete</h3>
      <p>{result.created} teacher{result.created===1?'':'s'} invited, {result.existing} already existed.</p>
      {result.email_failed.length>0&&<p className="warn">Invitation emails could not be sent to: {result.email_failed.join(', ')}. Use the Send invitation action in Faculty Management to retry.</p>}
      <button type="button" className="primary" onClick={onClose}>Done</button>
    </section>}
    {preview&&<section className="panel">
      <h3>Preview</h3>
      <p>{preview.summary.new} new · {preview.summary.existing} existing · <span className={preview.summary.errors?'error':''}>{preview.summary.errors} with errors</span></p>
      {dirty&&<p className="muted" role="status">Preview edits are not saved yet. Save changes to revalidate them before importing.</p>}
      {preview.summary.errors>0&&<ul className="rows" aria-label="Rows to fix">{preview.rows.filter(row=>row.status==='error').flatMap(row=>row.errors.map(message=><li key={`${row.row}-${message}`} className="error">Row {row.row}: {message}</li>))}</ul>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Editable teacher import preview">
        <table><thead><tr><th>Row</th><th>Name</th><th>Email</th><th>Result</th></tr></thead>
          <tbody>{preview.rows.map(row=><tr key={row.row} className={row.status==='error'?'row-error':''}>
            <td>{row.row}</td>
            <td><label className="sr-only" htmlFor={`teacher-name-${row.row}`}>Name for row {row.row}</label>
              <input id={`teacher-name-${row.row}`} value={row.display_name} maxLength={150} disabled={busy}
                onChange={event=>editRow(row.row,'display_name',event.target.value)}/></td>
            <td><label className="sr-only" htmlFor={`teacher-email-${row.row}`}>Email for row {row.row}</label>
              <input id={`teacher-email-${row.row}`} type="email" value={row.email} maxLength={254} disabled={busy}
                onChange={event=>editRow(row.row,'email',event.target.value)}/></td>
            <td>{row.status==='error'?row.errors.map(message=><div className="error" key={message}>{message}</div>):row.status}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="actions">
        {dirty&&<button type="button" disabled={busy} onClick={saveEdits}>{busy?'Checking…':'Save changes & recheck'}</button>}
        <button type="button" className="primary" disabled={busy||dirty||preview.summary.errors>0} onClick={commit}>
          {dirty?'Save edits before importing':preview.summary.errors>0?`Fix ${preview.summary.errors} ${preview.summary.errors===1?'row':'rows'} to import`:`Import ${preview.summary.total} teachers`}
        </button>
      </div>
    </section>}
  </Dialog>;
}
