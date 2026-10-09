import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, post, send, upload, errorText } from '../../app/api';
import { queryClient } from '../../app/providers';
import { Dialog } from '../../components/Dialog';
import { yearLabel, type DraftRow, type ProspectusDraft, type Subject } from './types';

const intOrNull = (v: FormDataEntryValue | null) => v ? Number(v) : null;
const semesterLabel = (n: number | null) => n ? `${['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] ?? `${n}th`} semester` : 'No semester';

export function Subjects() {
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const [message, setMessage] = useState(''); const [search, setSearch] = useState('');
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const query = useQuery({ queryKey: ['subjects', archived], queryFn: () => api<Subject[]>('/subjects?include_archived=' + archived) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['subjects'] });
  const yearTabs = Array.from(new Set((query.data ?? []).map(s => s.year_level).filter((n): n is number => n !== null))).sort((a, b) => a - b);
  useEffect(() => { if (!query.data) return; if (!yearTabs.length) { setActiveYear(null); return; } if (activeYear === null || !yearTabs.includes(activeYear)) setActiveYear(yearTabs[0]); }, [query.data, activeYear, yearTabs]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const body = { title: f.get('title'), units: f.get('units'), year_level: intOrNull(f.get('year_level')), semester: intOrNull(f.get('semester')), description: f.get('description') || '' };
    try {
      if (editing === 'new') await post('/subjects', { ...body, code: f.get('code') });
      else if (editing) await send('PATCH', `/subjects/${editing.id}`, body);
      setEditing(null); setMessage('Subject saved.'); refresh();
    } catch (err) { setMessage(errorText(err)) }
  }
  const grouped = new Map<string, Subject[]>();
  const filtered = query.data?.filter(s => `${s.code} ${s.title}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const visibleYear = activeYear === null && yearTabs.length ? yearTabs[0] : activeYear;
  filtered.filter(s => visibleYear === null ? s.year_level === null : s.year_level === visibleYear).forEach(s => {
    const k = semesterLabel(s.semester);
    grouped.set(k, [...(grouped.get(k) ?? []), s]);
  });

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Administration</p><h1>Prospectus</h1>
        <p className="muted">Subjects are placed by year level and semester. Teaching assignments use these.</p></div>
      <div className="actions"><Link className="button" to="/admin/subjects/import">Import prospectus</Link>
        <button className="primary" onClick={() => { setMessage(''); setEditing('new') }}>Add subject</button></div>
    </div>
    <div className="actions"><label>Search subjects<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Code or title" /></label>
      <label className="inline"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived subjects</label></div>
    {message && <p role="status">{message}</p>}
    {query.isPending ? <p>Loading…</p> : query.error ? <p role="alert">{query.error.message}</p> :
      query.data.length === 0 ? <section className="panel"><h2>No subjects yet</h2><p>Import the prospectus or add subjects manually.</p></section> :
      <>
        {yearTabs.length > 0 && <nav className="tabs" role="tablist" aria-label="Year levels">
          {yearTabs.map(year => <button key={year} type="button" className={activeYear === year ? 'active' : ''} aria-pressed={activeYear === year} onClick={() => setActiveYear(year)}>{yearLabel(year)}</button>)}
        </nav>}
        {grouped.size === 0 ? <section className="panel"><h2>No subjects match</h2><p>Change the search.</p></section> :
          [...grouped].map(([group, items]) => <section className="panel" key={group}><h2>{group}</h2>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Subjects"><table><thead><tr><th>Code</th><th>Title</th><th>Units</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{items.map(s => <tr key={s.id}><td>{s.code}</td><td>{s.title}{s.status === 'archived' && <span className="badge"> archived</span>}</td><td>{s.units}</td>
                <td><button onClick={() => { setMessage(''); setEditing(s) }}>Edit</button></td></tr>)}</tbody></table></div></section>)}
      </>}
    {editing && <Dialog title={editing === 'new' ? 'Add subject' : `Edit ${editing.code}`} onClose={() => setEditing(null)}>
      <form onSubmit={submit}>
        {editing === 'new' && <label>Code<input name="code" required maxLength={30} placeholder="ENT 101" /></label>}
        <label>Title<input name="title" required maxLength={200} defaultValue={editing === 'new' ? '' : editing.title} /></label>
        <label>Units<input name="units" required type="number" step="0.5" min="0" max="99" defaultValue={editing === 'new' ? '3' : editing.units} /></label>
        <div className="grid-2">
          <label>Year level<select name="year_level" defaultValue={editing === 'new' ? '' : editing.year_level ?? ''}><option value="">Unplaced</option>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{yearLabel(n)}</option>)}</select></label>
          <label>Semester<select name="semester" defaultValue={editing === 'new' ? '' : editing.semester ?? ''}><option value="">None</option>{[1, 2, 3].map(n => <option key={n} value={n}>{semesterLabel(n)}</option>)}</select></label>
        </div>
        {editing !== 'new' && <button type="button" onClick={async () => { try { await send('PATCH', `/subjects/${editing.id}`, { status: editing.status === 'active' ? 'archived' : 'active' }); setEditing(null); refresh() } catch (err) { setMessage(errorText(err)) } }}>{editing.status === 'active' ? 'Archive subject' : 'Restore subject'}</button>}
        {message && <p role="alert">{message}</p>}
        <div className="actions"><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary">Save subject</button></div>
      </form>
    </Dialog>}
  </>;
}

export function ProspectusStart() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try { const draft = await upload<ProspectusDraft>('/prospectus-imports', new FormData(e.currentTarget)); navigate(`/admin/subjects/import/${draft.id}`) }
    catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  async function manual() {
    try { const draft = await upload<ProspectusDraft>('/prospectus-imports', new FormData()); navigate(`/admin/subjects/import/${draft.id}`) }
    catch (err) { setError(errorText(err)) }
  }
  return <>
    <p className="back"><Link to="/admin/subjects">← Prospectus</Link></p>
    <h1>Import prospectus</h1>
    <p className="muted">Upload the prospectus (PDF, Word, Excel or CSV). Subjects are read into a draft you review before anything is created. Scanned images are not supported.</p>
    <section className="panel"><form onSubmit={submit}>
      <label>Prospectus file<input name="file" type="file" required accept=".pdf,.docx,.xlsx,.csv" /></label>
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Reading file…' : 'Read prospectus'}</button><button type="button" onClick={manual}>Enter subjects manually</button></div>
    </form></section>
  </>;
}

export function ProspectusReview() {
  const { importId } = useParams();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['prospectus', importId], queryFn: () => api<ProspectusDraft>(`/prospectus-imports/${importId}`) });
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (query.data && !dirty) setRows(query.data.subjects) }, [query.data, dirty]);
  useEffect(() => {
    if (!dirty) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn); return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (query.isPending) return <p>Loading draft…</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  const draft = query.data; const list = rows ?? draft.subjects;
  const locked = draft.status !== 'draft';
  const edit = (i: number, change: Partial<DraftRow>) => { setRows(list.map((r, j) => j === i ? { ...r, ...change } : r)); setDirty(true) };
  const payload = () => ({ expected_revision: draft.revision, subjects: list.map(r => ({ code: r.code, title: r.title, units: r.units, year_level: r.year_level, semester: r.semester })) });

  async function save() {
    try { await send('PUT', `/prospectus-imports/${draft.id}`, payload()); setDirty(false); setMessage('Draft saved.'); await query.refetch() }
    catch (err) { setMessage(errorText(err)) }
  }
  async function commit() {
    try {
      if (dirty) { await send('PUT', `/prospectus-imports/${draft.id}`, payload()); setDirty(false) }
      const fresh = await api<ProspectusDraft>(`/prospectus-imports/${draft.id}`);
      const done = await post<{ created: number; skipped_existing: number }>(`/prospectus-imports/${draft.id}/commit`, { expected_revision: fresh.revision });
      setDirty(false); queryClient.invalidateQueries({ queryKey: ['subjects'] });
      navigate('/admin/subjects', { state: { created: done.created } });
    } catch (err) { setMessage(errorText(err)); await query.refetch() }
  }
  return <>
    <p className="back"><Link to="/admin/subjects">← Prospectus</Link></p>
    <h1>Review prospectus</h1>
    {draft.warnings.map(w => <p className="warn" role="status" key={w}>{w}</p>)}
    {locked && <p role="status">This prospectus was already committed.</p>}
    <section className="panel">
      {list.length === 0 && <p>No subjects yet. Add them below.</p>}
      {list.map((r, i) => <div className="edit-row" key={i}>
        <label>Code<input value={r.code} onChange={e => edit(i, { code: e.target.value })} disabled={locked} /></label>
        <label>Title<input value={r.title} onChange={e => edit(i, { title: e.target.value })} disabled={locked} /></label>
        <label>Units<input value={r.units ?? ''} inputMode="decimal" onChange={e => edit(i, { units: e.target.value })} disabled={locked} /></label>
        <label>Year<select value={r.year_level ?? ''} onChange={e => edit(i, { year_level: e.target.value ? Number(e.target.value) : null })} disabled={locked}><option value="">—</option>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Semester<select value={r.semester ?? ''} onChange={e => edit(i, { semester: e.target.value ? Number(e.target.value) : null })} disabled={locked}><option value="">—</option>{[1, 2, 3].map(n => <option key={n} value={n}>{semesterLabel(n)}</option>)}</select></label>
        {!locked && <button type="button" aria-label={`Remove ${r.code || 'row'}`} onClick={() => { setRows(list.filter((_, j) => j !== i)); setDirty(true) }}>Remove</button>}
        <div className="edit-notes">
          {r.exists && <span className="badge">Already in catalog; will be skipped</span>}
          {r.errors?.map(e => <span className="error" role="alert" key={e}>{e}</span>)}
        </div>
      </div>)}
      {!locked && <button type="button" onClick={() => { setRows([...list, { code: '', title: '', units: '3', year_level: null, semester: null }]); setDirty(true) }}>Add subject row</button>}
    </section>
    {message && <p role="status">{message}</p>}
    {!locked && <div className="actions">
      <button onClick={save} disabled={!dirty}>Save draft</button>
      <button className="primary" onClick={commit} disabled={list.length === 0}>Create subjects</button>
      {dirty && <span className="muted">Unsaved changes</span>}
    </div>}
  </>;
}
