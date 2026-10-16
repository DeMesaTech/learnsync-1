import {useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {post,upload,errorText} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import type {StudentPreview} from './types';

export function StudentImport({termId:providedTermId,onClose,onDone}:{termId?:string;onClose?:()=>void;onDone?:()=>void}){
  const {termId:routeTermId}=useParams();
  const termId=providedTermId??routeTermId;
  const [preview,setPreview]=useState<StudentPreview|null>(null);
  const [result,setResult]=useState<{created:number;existing:number;skipped:number;email_failed:string[]}|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');setResult(null);
    const form=new FormData(e.currentTarget);
    if(termId)form.set('term_id',termId);
    try{setPreview(await upload<StudentPreview>('/student-imports',form))}
    catch(err){setError(errorText(err));setPreview(null)}finally{setBusy(false)}
  }
  async function commit(){
    if(!preview)return;setBusy(true);setError('');
    try{
      setResult(await post<{created:number;existing:number;skipped:number;email_failed:string[]}>(`/student-imports/${preview.id}/commit`,{}));setPreview(null);
      queryClient.invalidateQueries({queryKey:['sections',termId]});queryClient.invalidateQueries({queryKey:['offerings',termId]});
      queryClient.invalidateQueries({queryKey:['section-roster']});
      queryClient.invalidateQueries({queryKey:['accounts']});
      onDone?.();
    }catch(err){setError(errorText(err))}finally{setBusy(false)}
  }
  const content=<>
    <p className="muted">Upload a CSV or Excel file with <code>student_number</code> and <code>email</code>, plus either <code>display_name</code> or <code>firstName</code>, <code>Middle Initial</code> and <code>lastName</code>. Split names are combined as first, middle, last; the middle part is optional. Excel imports read each worksheet with student columns; CSV imports read the file as one table. You may also include <code>section</code> (an existing section name in this term). Review the result before anything is created. New students receive an invitation email.</p>
    <section className="panel"><form onSubmit={submit}>
      <label>Student list<input name="file" type="file" required accept=".csv,.xlsx" disabled={busy}/></label>
      <button className="primary" disabled={busy}>{busy?'Checking…':'Preview import'}</button>
    </form></section>
    {!termId&&<p className="muted">Students can be imported without assigning them to a term section.</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<section className="panel" role="status"><h2>Import complete</h2>
      <p>{result.created} student{result.created===1?'':'s'} invited, {result.existing} already existed, {result.skipped} error row{result.skipped===1?'':'s'} skipped.</p>
      {result.email_failed.length>0&&<p className="warn">Invitation emails could not be sent to: {result.email_failed.join(', ')}. Use the resend action in the related account list.</p>}
      {onClose&&<button type="button" className="primary" onClick={onClose}>Done</button>}</section>}
    {preview&&<section className="panel">
      <h2>Preview</h2>
      <p>{preview.summary.new} new · {preview.summary.existing} existing · <span className={preview.summary.errors?'error':''}>{preview.summary.errors} with errors</span></p>
      {preview.summary.errors>0&&<p className="warn" role="status">Rows with errors will be skipped. Valid rows can still be imported.</p>}
      {preview.summary.errors>0&&<ul className="rows" aria-label="Rows to skip">{preview.rows.filter(r=>r.status==='error').flatMap(r=>r.errors.map(m=><li key={`${r.row}-${m}`} className="error">{r.source_sheet?`${r.source_sheet}, row ${r.source_row}`:`Row ${r.row}`}: {m}</li>))}</ul>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Import preview"><table><thead><tr><th>Row</th><th>Student no.</th><th>Name</th><th>Email</th><th>Section</th><th>Result</th></tr></thead>
        <tbody>{preview.rows.map(r=><tr key={r.row} className={r.status==='error'?'row-error':''}>
          <td>{r.source_sheet ? `${r.source_sheet}, row ${r.source_row}` : r.row}</td><td>{r.student_number}</td><td>{r.display_name}</td><td>{r.email}</td><td>{r.section||'—'}</td>
          <td>{r.status==='error'?r.errors.map(m=><div className="error" key={m}>{m}</div>):r.status}</td></tr>)}</tbody></table></div>
      <div className="actions"><button className="primary" disabled={busy||preview.summary.new+preview.summary.existing===0} onClick={commit}>{preview.summary.new+preview.summary.existing===0?'No valid rows to import':`Import ${preview.summary.new+preview.summary.existing} valid student${preview.summary.new+preview.summary.existing===1?'':'s'}${preview.summary.errors?`, skip ${preview.summary.errors} error row${preview.summary.errors===1?'':'s'}`:''}`}</button></div>
    </section>}
  </>;
  if(onClose)return <Dialog title="Import students" onClose={()=>busy?false:onClose()} className="import-dialog">{content}</Dialog>;
  return <><p className="back"><Link to="/admin/students">← Student management</Link></p><h1>Import students</h1>{content}</>;
}
