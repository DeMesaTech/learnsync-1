import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, post, send, upload, errorText } from '../../app/api';
import { queryClient } from '../../app/providers';
import { Dialog } from '../../components/Dialog';
import { yearLabel, type College, type ProspectusUploadResult, type Subject } from './types';

const semesterLabel = (n: number | null) => n ? `${['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] ?? `${n}th`} semester` : 'No semester';

export function Subjects() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const uploadedResult = (location.state as {prospectusUploadResult?:ProspectusUploadResult}|null)?.prospectusUploadResult ?? null;
  const [uploadConfirmation, setUploadConfirmation] = useState(uploadedResult);
  const [archived, setArchived] = useState(false);
  const [collegeFilter, setCollegeFilter] = useState<string>(() => searchParams.get('college_id') ?? 'all');
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const [newPlacement, setNewPlacement] = useState<{year:number|null;semester:number|null;collegeId:string}>({year:null,semester:null,collegeId:''});
  const [collegeHint, setCollegeHint] = useState<{id:string} | null>(null);
  const [message, setMessage] = useState(''); const [search, setSearch] = useState('');
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const query = useQuery({ queryKey: ['subjects', archived, collegeFilter], queryFn: () => api<Subject[]>(`/subjects?include_archived=${archived}${collegeFilter === 'all' ? '' : `&college_id=${collegeFilter}`}`) });
  const colleges = useQuery({ queryKey: ['colleges'], queryFn: () => api<College[]>('/colleges') });
  const addCollegeId = collegeFilter !== 'all'
    && colleges.data?.some(college => college.id === collegeFilter && college.status === 'active')
    ? collegeFilter : '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['subjects'] });
  const yearTabs = Array.from(new Set((query.data ?? []).map(s => s.year_level).filter((n): n is number => n !== null))).sort((a, b) => a - b);
  const highestSubjectYear = Math.max(0, ...(query.data ?? []).map(subject => subject.year_level ?? 0),
    typeof editing === 'object' && editing !== null ? editing.year_level ?? 0 : 0);
  const yearLevelOptions = Array.from({ length: Math.min(6, Math.max(1, highestSubjectYear + 1)) }, (_, index) => index + 1);
  useEffect(() => { if (!query.data) return; if (!yearTabs.length) { setActiveYear(null); return; } if (activeYear === null || !yearTabs.includes(activeYear)) setActiveYear(yearTabs[0]); }, [query.data, activeYear, yearTabs]);
  useEffect(() => {
    if (!collegeHint) return;
    const timeout = window.setTimeout(() => setCollegeHint(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [collegeHint]);
  useEffect(() => {
    if (uploadedResult) navigate(`${location.pathname}${location.search}`, {replace:true,state:null});
  }, [uploadedResult, location.pathname, location.search, navigate]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    if (!editing) return;
    const placement = editing === 'new'
      ? { year_level: newPlacement.year, semester: newPlacement.semester, college_id: newPlacement.collegeId || null }
      : {
        year_level: f.get('year_level') ? Number(f.get('year_level')) : null,
        semester: f.get('semester') ? Number(f.get('semester')) : null,
        college_id: f.get('college_id') ? String(f.get('college_id')) : null,
      };
    const body = { title: f.get('title'), units: f.get('units'), ...placement, prerequisite: f.get('prerequisite') || '', description: f.get('description') || '' };
    try {
      if (editing === 'new') await post('/subjects', { ...body, code: f.get('code') });
      else if (editing) await send('PATCH', `/subjects/${editing.id}`, body);
      setEditing(null); setMessage('Subject saved.'); refresh();
    } catch (err) { setMessage(errorText(err)) }
  }
  const grouped = new Map<string, Subject[]>();
  const filtered = (query.data ?? []).filter(s => {
    const matchesSearch = `${s.code} ${s.title}`.toLowerCase().includes(search.trim().toLowerCase());
    const matchesCollege = collegeFilter === 'all' || s.college_id === collegeFilter;
    return matchesSearch && matchesCollege;
  });
  const visibleYear = activeYear === null && yearTabs.length ? yearTabs[0] : activeYear;
  filtered.filter(s => visibleYear === null ? s.year_level === null : s.year_level === visibleYear).forEach(s => {
    const k = semesterLabel(s.semester);
    grouped.set(k, [...(grouped.get(k) ?? []), s]);
  });
  if (visibleYear !== null) {
    for (const semester of [1, 2]) {
      const label = semesterLabel(semester);
      if (!grouped.has(label)) grouped.set(label, []);
    }
  }
  const semesterOrder = (label: string) => {
    if (label === 'No semester') return Number.MAX_SAFE_INTEGER;
    const match = /^(\d+)(?:st|nd|rd|th) semester$/.exec(label);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER - 1;
  };
  const semesterGroups = [...grouped]
    .sort(([a], [b]) => semesterOrder(a) - semesterOrder(b));

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Administration</p><h1>Prospectus</h1>
        <p className="muted">Subjects are placed by year level and semester. Teaching assignments use these.</p></div>
    </div>
    <div className="actions" style={{ alignItems: 'end' }}>
      <label>Search subjects<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Code or title" /></label>
      <label>College<select value={collegeFilter} onChange={e => { setCollegeFilter(e.target.value); setCollegeHint(null); }}>
        <option value="all">All colleges</option>
        {(colleges.data ?? []).filter(c => c.status === 'active').map(college => <option key={college.id} value={college.id}>{college.name}</option>)}
      </select></label>
      <label className="inline"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Show archived subjects</label>
    </div>
    {!addCollegeId}
    <div className="actions">
      <Link className="button" to={`/admin/subjects/import${collegeFilter === 'all' ? '' : `?college_id=${encodeURIComponent(collegeFilter)}`}`}>Import prospectus</Link>
    </div>
    {message && <p role="status">{message}</p>}
    {query.isPending ? <p>Loading…</p> : query.error ? <p role="alert">{query.error.message}</p> :
      query.data.length === 0 ? <section className="panel"><h2>No subjects yet</h2><p>Upload a prospectus to create the subject catalog.</p></section> :
      <>
        {yearTabs.length > 0 && <nav className="tabs" role="tablist" aria-label="Year levels">
          {yearTabs.map(year =>                     <button key={year} type="button" className={activeYear === year ? 'active' : ''} aria-pressed={activeYear === year} onClick={() => { setActiveYear(year); setCollegeHint(null); }}>{yearLabel(year)}</button>)}
        </nav>}
        {grouped.size === 0 ? <section className="panel"><h2>No subjects match</h2><p>Change the search or college filter.</p></section> :
          <div className="prospectus-semesters">{semesterGroups.map(([group, items], sectionIndex) => {
            const hintId = `add-subject-tooltip-${visibleYear ?? 'unplaced'}-${sectionIndex}`;
            return <section className="panel" key={group}>
            <div className="prospectus-semester-heading"><h2>{group}</h2>
              <span className="add-subject-action">
                <button className="primary" type="button" aria-describedby={collegeHint?.id === hintId ? hintId : undefined} onClick={() => {
                if (!addCollegeId) {
                  setCollegeHint({id:hintId});
                  return;
                }
                setCollegeHint(null);
                const match = /^(\d+)(?:st|nd|rd|th) semester$/.exec(group);
                setNewPlacement({year:visibleYear,semester:match ? Number(match[1]) : null,collegeId:addCollegeId});
                setMessage('');
                setEditing('new');
                }}>Add subject</button>
                {!addCollegeId && collegeHint?.id === hintId && <span className="add-subject-tooltip" id={hintId} role="tooltip" aria-live="polite">Please select a college in the College filter above first.</span>}
              </span>
            </div>
            {items.length > 0 ? <div className="table-wrap" tabIndex={0} role="region" aria-label={`${group} subjects`}><table><thead><tr><th>Code</th><th>Title</th><th>College</th><th>Units</th><th>Pre-requisite</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{items.map(s => <tr key={s.id}><td>{s.code}</td><td>{s.title}{s.status === 'archived' && <span className="badge"> archived</span>}</td><td>{s.college ? s.college.name : 'Unassigned'}</td><td>{s.units}</td>
                <td>{s.prerequisite || '—'}</td>
                <td><button onClick={() => { setMessage(''); setEditing(s) }}>Edit</button></td></tr>)}</tbody></table></div>
              : <p className="muted">No subjects are assigned to this semester yet.</p>}
          </section>;
          })}</div>}
      </>}
    {editing && <Dialog title={editing === 'new' ? 'Add subject' : `Edit ${editing.code}`} onClose={() => setEditing(null)}>
      <form onSubmit={submit}>
        {editing === 'new' && <label>Code<input name="code" required maxLength={30} placeholder="ENT 101" /></label>}
        <label>Title<input name="title" required maxLength={200} defaultValue={editing === 'new' ? '' : editing.title} /></label>
        <label>Units<input name="units" required type="number" step="0.5" min="0" max="99" defaultValue={editing === 'new' ? '3' : editing.units} /></label>
        <label>Pre-requisite<input name="prerequisite" maxLength={300} defaultValue={editing === 'new' ? '' : editing.prerequisite} placeholder="e.g. BCA 1" /></label>
        <div className="grid-2">
          <label>Year level<select name="year_level" disabled={editing === 'new'} defaultValue={editing === 'new' ? newPlacement.year ?? '' : editing.year_level ?? ''}><option value="">Unplaced</option>{yearLevelOptions.map(n => <option key={n} value={n}>{yearLabel(n)}</option>)}</select></label>
          <label>Semester<select name="semester" disabled={editing === 'new'} defaultValue={editing === 'new' ? newPlacement.semester ?? '' : editing.semester ?? ''}><option value="">None</option>{editing !== 'new' && editing.semester !== null && ![1, 2].includes(editing.semester) && <option value={editing.semester}>{semesterLabel(editing.semester)}</option>}{[1, 2].map(n => <option key={n} value={n}>{semesterLabel(n)}</option>)}</select></label>
        </div>
        <label>College<select name="college_id" disabled={editing === 'new'} defaultValue={editing === 'new' ? newPlacement.collegeId : editing.college_id ?? ''}><option value="">Unassigned</option>{editing !== 'new' && editing.college_id && !(colleges.data ?? []).some(college => college.id === editing.college_id && college.status === 'active') && <option value={editing.college_id}>{editing.college?.name ?? 'Inactive college'}</option>}{(colleges.data ?? []).filter(c => c.status === 'active').map(college => <option key={college.id} value={college.id}>{college.name}</option>)}</select></label>
        {editing !== 'new' && <button type="button" onClick={async () => { try { await send('PATCH', `/subjects/${editing.id}`, { status: editing.status === 'active' ? 'archived' : 'active' }); setEditing(null); refresh() } catch (err) { setMessage(errorText(err)) } }}>{editing.status === 'active' ? 'Archive subject' : 'Restore subject'}</button>}
        {message && <p role="alert">{message}</p>}
        <div className="actions"><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary">Save subject</button></div>
      </form>
    </Dialog>}
    {uploadConfirmation && <Dialog title="Prospectus uploaded" onClose={() => setUploadConfirmation(null)}>
      <p>{uploadConfirmation.college.name} ({uploadConfirmation.college.code}): {uploadConfirmation.created} subjects added and {uploadConfirmation.skipped_existing} existing subjects left unchanged.</p>
      {uploadConfirmation.warnings.map(warning => <p className="warn" key={warning}>{warning}</p>)}
      <div className="actions"><button className="primary" type="button" onClick={() => setUploadConfirmation(null)}>Done</button></div>
    </Dialog>}
  </>;
}

export function ProspectusStart() {
  const [searchParams] = useSearchParams();
  const colleges = useQuery({ queryKey: ['colleges'], queryFn: () => api<College[]>('/colleges') });
  const [collegeId, setCollegeId] = useState(searchParams.get('college_id') ?? '');
  const [operation, setOperation] = useState<'update'|'add'>('update');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    if (operation === 'update'
        && !colleges.data?.some(college => college.id === collegeId && college.status === 'active')) {
      setError('Select an active college whose prospectus you want to update.');
      return;
    }
    setBusy(true);
    try {
      const saved = await upload<ProspectusUploadResult>('/prospectus-uploads', new FormData(e.currentTarget));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subjects'] }),
        queryClient.invalidateQueries({ queryKey: ['colleges'] }),
      ]);
      navigate(`/admin/subjects?college_id=${encodeURIComponent(saved.college.id)}`, {
        replace:true,
        state:{prospectusUploadResult:saved},
      });
    }
    catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  return <>
    <p className="back"><Link to="/admin/subjects">← Back to Prospectus</Link></p>
    <h1>Upload a prospectus</h1>
    <p className="muted">Choose whether this file updates a college's subject catalog or creates a new college with its prospectus. Extracted subjects are added immediately; matching subject codes already in that college are left unchanged.</p>
    <section className="panel"><form onSubmit={submit}>
        <fieldset>
          <legend>What would you like to do?</legend>
          <label className="inline"><input type="radio" name="operation" value="update" checked={operation === 'update'}
            onChange={() => setOperation('update')} /> Update a college's prospectus</label>
          <label className="inline"><input type="radio" name="operation" value="add" checked={operation === 'add'}
            onChange={() => setOperation('add')} /> Add another college with its prospectus</label>
        </fieldset>
        {operation === 'update' ? <>
          {colleges.isPending ? <p>Loading colleges…</p> : colleges.error ? <p role="alert">{colleges.error.message}</p> :
            <label>College<select name="college_id" value={collegeId} onChange={e => setCollegeId(e.target.value)} required>
              <option value="">Select a college</option>
              {(colleges.data ?? []).filter(college => college.status === 'active').map(college =>
                <option key={college.id} value={college.id}>{college.name} ({college.code})</option>)}
            </select></label>}
          {!colleges.isPending && !colleges.error
            && colleges.data?.every(college => college.status !== 'active')
            && <p className="muted">No active colleges yet. Choose “Add another college” to start a catalog.</p>}
        </> : <>
          <div className="grid-2">
            <label>College code<input name="college_code" required maxLength={30} /></label>
            <label>College name<input name="college_name" required maxLength={150} /></label>
          </div>
          <label>Description (optional)<textarea name="college_description" maxLength={5000} /></label>
        </>}
        <label>Prospectus file<input name="file" type="file" required accept=".pdf,.docx,.xlsx,.csv" /></label>
        {error && <p role="alert">{error}</p>}
        <div className="actions"><button className="primary" disabled={busy || (operation === 'update' && (colleges.isPending || !!colleges.error || !collegeId))}>
          {busy ? 'Uploading and importing…' : 'Upload prospectus'}
        </button></div>
    </form></section>
  </>;
}
