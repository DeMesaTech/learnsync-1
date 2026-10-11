import {useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {post,upload,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';

interface ImportRow{
  row:number;
  display_name:string;
  email:string;
  status:'new'|'existing'|'error';
  errors:string[];
}
interface FacultyPreview{
  id:string;
  summary:{new:number;existing:number;errors:number;total:number};
  rows:ImportRow[];
}
interface ImportResult{created:number;existing:number;email_failed:string[]}

export function TeacherImport(){
  const [preview,setPreview]=useState<FacultyPreview|null>(null);
  const [result,setResult]=useState<ImportResult|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setBusy(true);setError('');setResult(null);
    try{setPreview(await upload<FacultyPreview>('/faculty-imports',new FormData(e.currentTarget)))}
    catch(err){setError(errorText(err));setPreview(null)}
    finally{setBusy(false)}
  }

  async function commit(){
    if(!preview)return;
    setBusy(true);setError('');
    try{
      setResult(await post<ImportResult>(`/faculty-imports/${preview.id}/commit`,{}));
      setPreview(null);
      queryClient.invalidateQueries({queryKey:['accounts']});
      queryClient.invalidateQueries({queryKey:['faculty-list']});
    }catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }

  return <>
    <p className="back"><Link to="/admin/teachers">← Teacher management</Link></p>
    <h1>Import teachers</h1>
    <p className="muted">Upload a CSV or Excel file with <code>email</code> and <code>display_name</code> columns. Review the preview before any accounts are created. New teachers receive an invitation link to set their password.</p>
    <section className="panel"><form onSubmit={submit}>
      <label>Teacher list<input name="file" type="file" required accept=".csv,.xlsx"/></label>
      <button className="primary" disabled={busy}>{busy?'Checking…':'Preview import'}</button>
    </form></section>
    {error&&<p role="alert">{error}</p>}
    {result&&<section className="panel" role="status">
      <h2>Import complete</h2>
      <p>{result.created} teacher{result.created===1?'':'s'} invited, {result.existing} already existed.</p>
      {result.email_failed.length>0&&<p className="warn">Invitation emails could not be sent to: {result.email_failed.join(', ')}. Use “Send invitation” in Teacher management to retry.</p>}
      <Link className="button primary" to="/admin/teachers">Manage teachers</Link>
    </section>}
    {preview&&<section className="panel">
      <h2>Preview</h2>
      <p>{preview.summary.new} new · {preview.summary.existing} existing · <span className={preview.summary.errors?'error':''}>{preview.summary.errors} with errors</span></p>
      {preview.summary.errors>0&&<p className="warn" role="alert">Nothing can be imported while rows have errors. Fix the file and upload it again.</p>}
      {preview.summary.errors>0&&<ul className="rows" aria-label="Rows to fix">{preview.rows.filter(row=>row.status==='error').flatMap(row=>row.errors.map(message=><li key={`${row.row}-${message}`} className="error">Row {row.row}: {message}</li>))}</ul>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Teacher import preview">
        <table><thead><tr><th>Row</th><th>Name</th><th>Email</th><th>Result</th></tr></thead>
          <tbody>{preview.rows.map(row=><tr key={row.row} className={row.status==='error'?'row-error':''}>
            <td>{row.row}</td><td>{row.display_name}</td><td>{row.email}</td>
            <td>{row.status==='error'?row.errors.map(message=><div className="error" key={message}>{message}</div>):row.status}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="actions"><button className="primary" disabled={busy||preview.summary.errors>0} onClick={commit}>
        {preview.summary.errors>0?`Fix ${preview.summary.errors} ${preview.summary.errors===1?'row':'rows'} to import`:`Import ${preview.summary.total} teachers`}
      </button></div>
    </section>}
  </>;
}
