import {useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {post,upload,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import type {StudentPreview} from './types';

export function StudentImport(){
  const {termId}=useParams();
  const [preview,setPreview]=useState<StudentPreview|null>(null);
  const [result,setResult]=useState<{created:number;existing:number;email_failed:string[]}|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');setResult(null);
    const form=new FormData(e.currentTarget);form.set('term_id',termId!);
    try{setPreview(await upload<StudentPreview>('/student-imports',form))}
    catch(err){setError(errorText(err));setPreview(null)}finally{setBusy(false)}
  }
  async function commit(){
    if(!preview)return;setBusy(true);setError('');
    try{
      setResult(await post(`/student-imports/${preview.id}/commit`,{}));setPreview(null);
      queryClient.invalidateQueries({queryKey:['sections',termId]});queryClient.invalidateQueries({queryKey:['offerings',termId]});
    }catch(err){setError(errorText(err))}finally{setBusy(false)}
  }
  return <>
    <p className="back"><Link to={`/admin/terms/${termId}`}>← Term workspace</Link></p>
    <h1>Import students</h1>
    <p className="muted">Upload a CSV or Excel file with the columns <code>student_number</code>, <code>email</code>, <code>display_name</code> and optionally <code>section</code> (an existing section name in this term). You review the result before anything is created. New students receive an invitation email.</p>
    <section className="panel"><form onSubmit={submit}>
      <label>Student list<input name="file" type="file" required accept=".csv,.xlsx"/></label>
      <button className="primary" disabled={busy}>{busy?'Checking…':'Preview import'}</button>
    </form></section>
    {error&&<p role="alert">{error}</p>}
    {result&&<section className="panel" role="status"><h2>Import complete</h2>
      <p>{result.created} student{result.created===1?'':'s'} invited, {result.existing} already existed.</p>
      {result.email_failed.length>0&&<p className="warn">Invitation emails could not be sent to: {result.email_failed.join(', ')}. Use “Resend invitation” in User accounts.</p>}
      <Link className="button primary" to={`/admin/terms/${termId}`}>Back to the term</Link></section>}
    {preview&&<section className="panel">
      <h2>Preview</h2>
      <p>{preview.summary.new} new · {preview.summary.existing} existing · <span className={preview.summary.errors?'error':''}>{preview.summary.errors} with errors</span></p>
      {preview.summary.errors>0&&<p className="warn" role="alert">Nothing can be imported while rows have errors. Fix the file and upload it again.</p>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Import preview"><table><thead><tr><th>Row</th><th>Student no.</th><th>Name</th><th>Email</th><th>Section</th><th>Result</th></tr></thead>
        <tbody>{preview.rows.map(r=><tr key={r.row} className={r.status==='error'?'row-error':''}>
          <td>{r.row}</td><td>{r.student_number}</td><td>{r.display_name}</td><td>{r.email}</td><td>{r.section||'—'}</td>
          <td>{r.status==='error'?r.errors.map(m=><div className="error" key={m}>{m}</div>):r.status}</td></tr>)}</tbody></table></div>
      <div className="actions"><button className="primary" disabled={busy||preview.summary.errors>0} onClick={commit}>Import {preview.summary.total} students</button></div>
    </section>}
  </>;
}
