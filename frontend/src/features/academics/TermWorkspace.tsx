import {useToast} from '../../components/undo';
import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useHere} from '../../components/origin';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,errorText,ApiError,type Account} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {Pager} from '../../components/Pager';
import {useConfirm} from '../../components/confirm';
import {yearLabel,type OfferingSummary,type SchoolYear,type Section,type Subject} from './types';

interface SectionRosterRow{student_id:string;display_name:string;email:string;student_number:string;account_status:'active'|'invited'|'inactive';status:'active'|'withdrawn'}
interface SectionRosterPage{items:SectionRosterRow[];total:number;page:number;page_size:number}

export function TermWorkspace(){
  const {termId}=useParams();
  const here=useHere();
  const ask=useConfirm();
  const toast=useToast();
  const years=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const sections=useQuery({queryKey:['sections',termId],queryFn:()=>api<Section[]>(`/terms/${termId}/sections`)});
  const offerings=useQuery({queryKey:['offerings',termId],queryFn:()=>api<OfferingSummary[]>(`/terms/${termId}/offerings`)});
  const subjects=useQuery({queryKey:['subjects',false],queryFn:()=>api<Subject[]>('/subjects')});
  const [dialog,setDialog]=useState<'section'|'offering'|null>(null);
  const [editing,setEditing]=useState<OfferingSummary|null>(null);
  const [tab,setTab]=useState<'sections'|'offerings'>('sections');
  const [teacherFilter,setTeacherFilter]=useState('');
  const [sectionError,setSectionError]=useState('');
  const [deletingSection,setDeletingSection]=useState<string|null>(null);
  const [activeYear,setActiveYear]=useState<number|null>(null);
  const [selectedSectionId,setSelectedSectionId]=useState('');
  const [rosterPage,setRosterPage]=useState(1);
  const [rosterPageSize,setRosterPageSize]=useState(25);
  const year=years.data?.find(y=>y.terms.some(t=>t.id===termId));
  const term=year?.terms.find(t=>t.id===termId);
  const closed=term?.status==='closed';
  const highestProgramYear=Math.max(0,...(subjects.data??[]).map(subject=>subject.year_level??0));
  const programYears=Array.from({length:highestProgramYear},(_,index)=>index+1);
  const visibleYear=activeYear??programYears[0]??null;
  const yearSections=useMemo(()=>sections.data?.filter(section=>section.year_level===visibleYear)??[],
    [sections.data,visibleYear]);
  const selectedSection=yearSections.find(section=>section.id===selectedSectionId)??yearSections[0];
  const roster=useQuery({
    queryKey:['section-roster',selectedSection?.id,rosterPage,rosterPageSize],
    queryFn:()=>api<SectionRosterPage>(`/sections/${selectedSection!.id}/roster?page=${rosterPage}&page_size=${rosterPageSize}&status=active`),
    enabled:!!selectedSection,
  });
  useEffect(()=>{
    if(!yearSections.some(section=>section.id===selectedSectionId)){
      setSelectedSectionId(yearSections[0]?.id??'');
      setRosterPage(1);
    }
  },[yearSections,selectedSectionId]);
  const refresh=()=>{queryClient.invalidateQueries({queryKey:['sections',termId]});queryClient.invalidateQueries({queryKey:['offerings',termId]});queryClient.invalidateQueries({queryKey:['section-roster']})};
  async function removeSection(section:Section){
    if(!await ask({title:`Delete ${section.name}?`,message:'Only an unused section can be deleted. Sections with students, assignments, or academic records are protected.',yes:'Delete section',danger:true}))return;
    setDeletingSection(section.id);setSectionError('');
    try{await send('DELETE',`/sections/${section.id}`);refresh();toast(`${section.name} deleted.`)}
    catch(err){setSectionError(errorText(err))}
    finally{setDeletingSection(null)}
  }
  const teacherGroups=offerings.data?.reduce<{id:string;name:string;rows:{offering:OfferingSummary;section:{id:string;name:string;enrolled:number}}[]}[]>((groups,offering)=>{
    let group=groups.find(item=>item.id===offering.faculty.id);
    if(!group){group={id:offering.faculty.id,name:offering.faculty.display_name,rows:[]};groups.push(group)}
    const sections=offering.sections.length?offering.sections:[{id:`${offering.id}-unassigned`,name:'—',enrolled:0}];
    sections.forEach(section=>group.rows.push({offering,section}));
    return groups;
  },[]).sort((a,b)=>a.name.localeCompare(b.name));
  const visibleTeacherGroups=teacherGroups?.filter(group=>!teacherFilter||group.id===teacherFilter);
  const totalSections=sections.data?.length ?? 0;
  const totalStudents=sections.data?.reduce((sum, section) => sum + section.member_count, 0) ?? 0;
  const activeOfferings=offerings.data?.filter(offering => offering.status === 'active').length ?? 0;

  if(years.isPending)return <p>Loading…</p>;
  if(!term)return <section className="panel"><h1>Term not found</h1><Link to="/admin/academics">Back to school years</Link></section>;
  return <>
    <p className="back"><Link to="/admin/academics">← School years</Link></p>
    <div className="page-heading">
      <div><p className="eyebrow">{year?.label}</p><h1>{term.name}</h1>
        <span className={`badge ${term.status}`}>{term.status}</span></div>
    </div>
    {closed&&<p className="warn" role="status">This term is closed. Reopen it from School years to make changes.</p>}
    <div className="stats-grid">
      <div className="stat-card"><span>Sections</span><strong>{totalSections}</strong></div>
      <div className="stat-card"><span>Students</span><strong>{totalStudents}</strong></div>
      <div className="stat-card"><span>Offerings</span><strong>{activeOfferings}</strong></div>
    </div>
    <nav className="tabs" aria-label="Term workspace tabs">
      <button type="button" className={tab==='sections'?'active':''} aria-pressed={tab==='sections'} onClick={()=>setTab('sections')}>Sections</button>
      <button type="button" className={tab==='offerings'?'active':''} aria-pressed={tab==='offerings'} onClick={()=>setTab('offerings')}>Offerings</button>
    </nav>

    {tab==='sections'?
      <section className="panel">
        <div className="page-heading"><div><h2>Sections</h2>
          {!subjects.isError&&subjects.isSuccess&&programYears.length>0&&<p className="muted">Program duration: {highestProgramYear} year{highestProgramYear===1?'':'s'}, based on the active prospectus subjects.</p>}
        </div><div className="actions">
          <Link className="button" to={`/admin/terms/${termId}/import-students`}>Import students</Link>
          <button className={sections.data?.length===0?'primary':''} aria-label="Add section" disabled={closed||subjects.isPending||subjects.isError||programYears.length===0} onClick={()=>setDialog('section')}><span aria-hidden="true">＋</span> Add section</button>
        </div></div>
        {subjects.isError&&<p role="alert">Could not load the prospectus year levels: {subjects.error.message}</p>}
        {!subjects.isError&&subjects.isSuccess&&programYears.length===0&&<p className="muted">No year levels are assigned in the prospectus yet. <Link to="/admin/subjects">Add or place subjects in the prospectus</Link> before creating sections.</p>}
        {sectionError&&<p role="alert">{sectionError}</p>}
        {programYears.length>0&&<nav className="tabs year-tabs" aria-label="Year levels">
          {programYears.map(yearLevel=><button key={yearLevel} type="button" className={visibleYear===yearLevel?'active':''} aria-pressed={visibleYear===yearLevel}
            onClick={()=>{setActiveYear(yearLevel);setSelectedSectionId('');setRosterPage(1)}}>{yearLabel(yearLevel)}</button>)}
        </nav>}
        {sections.isPending?<p>Loading…</p>:sections.error?<p role="alert">{sections.error.message}</p>:
          yearSections.length===0?<p className="muted">No sections for {visibleYear?yearLabel(visibleYear):'this year level'} yet. Add a section to get started.</p>:
          <>
            <div className="section-roster-tools">
              <label>Section<select aria-label="Select section" value={selectedSection?.id??''} onChange={event=>{setSelectedSectionId(event.target.value);setRosterPage(1)}}>
                {yearSections.map(section=><option key={section.id} value={section.id}>{section.name}</option>)}
              </select></label>
              {selectedSection&&<div className="actions">
                <span className="muted">{selectedSection.member_count} active student{selectedSection.member_count===1?'':'s'}</span>
                <Link className="button" state={here} to={`/admin/terms/${termId}/sections/${selectedSection.id}/students`}>{closed?'View students':'Manage students'}</Link>
                {!closed&&<button className="danger" disabled={deletingSection!==null} onClick={()=>removeSection(selectedSection)}>{deletingSection===selectedSection.id?'Deleting…':'Delete section'}</button>}
              </div>}
            </div>
            {roster.isPending?<p>Loading students…</p>:roster.error?<p role="alert">{roster.error.message}</p>:
              roster.data.items.length===0?<p className="muted">No students are enrolled in {selectedSection.name} yet.</p>:
              <div className="table-wrap" tabIndex={0} role="region" aria-label={`Students in ${selectedSection.name}`}>
                <table><caption className="sr-only">Students in {selectedSection.name}</caption>
                  <thead><tr><th scope="col">ID number</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Account status</th></tr></thead>
                  <tbody>{roster.data.items.map(student=><tr key={student.student_id}>
                    <td>{student.student_number||'—'}</td><th scope="row">{student.display_name}</th><td>{student.email}</td>
                    <td><span className={`badge ${student.account_status==='active'?'done':''}`}>{student.account_status==='invited'?'Email sent (invited)':student.account_status}</span></td>
                  </tr>)}</tbody>
                </table>
              </div>}
            {roster.data&&<Pager page={rosterPage} pageSize={rosterPageSize} total={roster.data.total} onPage={setRosterPage} onSize={size=>{setRosterPageSize(size);setRosterPage(1)}}/>}
          </>}
      </section>
      :
      <section className="panel">
        <div className="page-heading"><h2>Offerings</h2><div className="actions">
          <Link className="button" to="/admin/teachers/import">Import teachers</Link>
          <button className={sections.data?.length&&offerings.data?.length===0?'primary':''} disabled={closed||!sections.data} onClick={()=>setDialog('offering')}>Assign subjects</button>
        </div></div>
        {offerings.isPending?<p>Loading…</p>:offerings.error?<p role="alert">{offerings.error.message}</p>:
          offerings.data.length===0?<p className="muted">No subjects are assigned yet.</p>:
          <>
          {teacherGroups&&teacherGroups.length>1&&<label>Filter offerings by teacher<select aria-label="Filter offerings by teacher" value={teacherFilter} onChange={e=>setTeacherFilter(e.target.value)}>
            <option value="">All teachers</option>{teacherGroups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}
          </select></label>}
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Offerings by teacher"><table className="offerings-table">
            <caption className="sr-only">Teachers, assigned subjects and sections, enrollment counts, and actions</caption>
            <thead><tr><th scope="col">Teacher</th><th scope="col">Subject</th><th scope="col">Section</th><th scope="col">Number of enrolled</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            {visibleTeacherGroups?.map(group=><tbody key={group.id}>{group.rows.map(({offering,section},index)=>{
              const offeringStart=index===0||group.rows[index-1].offering.id!==offering.id;
              return <tr key={`${offering.id}:${section.id}`}>
              {index===0&&<th scope="rowgroup" rowSpan={group.rows.length}>{group.name}</th>}
              {offeringStart&&<th scope="row" rowSpan={offering.sections.length||1}><strong>{offering.subject.code}</strong> {offering.subject.title}</th>}
              <td>{section.name}</td><td>{section.enrolled}</td>
              <td><div className="actions"><Link className="button" state={here} to={`/admin/offerings/${offering.id}`}>Roster</Link>
                <button disabled={closed} onClick={()=>setEditing(offering)}>Edit</button></div></td></tr>;
            })}</tbody>)}
          </table></div></>}
      </section>
    }

    {dialog==='section'&&<SectionDialog termId={term.id} yearLevels={programYears} initialYear={visibleYear??programYears[0]??1} sections={sections.data??[]} onClose={()=>setDialog(null)} onDone={()=>{setDialog(null);refresh()}}/>}
    {dialog==='offering'&&<BulkAssignDialog termId={term.id} termSequence={term.sequence} sections={sections.data??[]} existing={offerings.data??[]}
      onClose={()=>setDialog(null)} onDone={()=>{setDialog(null);refresh()}}/>}
    {editing&&<OfferingDialog sections={sections.data??[]} offering={editing}
      onClose={()=>setEditing(null)} onDone={()=>{setEditing(null);refresh()}}/>}
  </>;
}

function SectionDialog({termId,yearLevels,initialYear,sections,onClose,onDone}:{termId:string;yearLevels:number[];initialYear:number;sections:Section[];onClose:()=>void;onDone:()=>void}){
  const [error,setError]=useState('');
  const [yearLevel,setYearLevel]=useState(initialYear);
  const [count,setCount]=useState(1);
  const [busy,setBusy]=useState(false);
  const matchingSections=sections.filter(section=>section.year_level===yearLevel);
  const existingSuffixes=new Set(matchingSections.flatMap(section=>{
    const match=section.name.trim().match(new RegExp(`^(?:BSE\\s*)?${yearLevel}\\s*[- ]?\\s*([A-Z]+)$`,'i'));
    return match?[match[1].toUpperCase()]:[];
  }));
  const generatedNames:string[]=[];
  if(Number.isInteger(count)&&count>=1&&count<=26){
    for(let index=1;generatedNames.length<count;index++){
      let value=index;
      let suffix='';
      while(value){value--;suffix=String.fromCharCode(65+value%26)+suffix;value=Math.floor(value/26)}
      const name=`BSE ${yearLevel}${suffix}`;
      if(!existingSuffixes.has(suffix)&&!sections.some(section=>section.name.toLocaleLowerCase()===name.toLocaleLowerCase())){
        generatedNames.push(name);
        existingSuffixes.add(suffix);
      }
    }
  }
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');
    try{await post(`/terms/${termId}/sections/bulk`,{year_level:yearLevel,count});onDone()}
    catch(err){setError(errorText(err))}finally{setBusy(false)}
  }
  return <Dialog title="Add sections" onClose={()=>busy?false:onClose()}><form onSubmit={submit}>
    <label>Year level<select value={yearLevel} onChange={e=>setYearLevel(Number(e.target.value))}>{yearLevels.map(n=><option key={n} value={n}>{yearLabel(n)}</option>)}</select></label>
    <label>Number of sections<input type="number" min={1} max={26} step={1} value={count} onChange={e=>setCount(Number(e.target.value))} required/></label>
    <p className="muted">Section names are generated alphabetically for this year level. Existing section letters are skipped.</p>
    {generatedNames.length>0&&<p><strong>Will create:</strong> {generatedNames.join(', ')}</p>}
    <p className="muted">The available years follow the program length detected from prospectus subject placements.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy||!Number.isInteger(count)||count<1||count>26||generatedNames.length!==count}>{busy?'Creating…':`Create ${count} section${count===1?'':'s'}`}</button></div>
  </form></Dialog>;
}

function OfferingDialog({sections,offering,onClose,onDone}:{sections:Section[];offering:OfferingSummary;onClose:()=>void;onDone:()=>void}){
  const faculty=useQuery({queryKey:['faculty-list'],queryFn:()=>api<Account[]>('/accounts?role=faculty&page_size=100')});
  const [chosen,setChosen]=useState<string[]>(offering.sections.map(s=>s.id));
  const [facultyId,setFacultyId]=useState(offering.faculty.id);
  const [error,setError]=useState('');
  const [needsOverride,setNeedsOverride]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    const override=needsOverride?String(f.get('override_reason')||'').trim()||undefined:undefined;
    try{await send('PATCH',`/offerings/${offering.id}`,{faculty_id:f.get('faculty_id'),section_ids:chosen,placement_override_reason:override});onDone()}
    catch(err){setNeedsOverride(err instanceof ApiError&&err.code==='placement_mismatch');setError(errorText(err))}
  }
  return <Dialog title={`Edit ${offering.subject.code}`} onClose={onClose}><form onSubmit={submit}>
    <p><strong>{offering.subject.code}</strong> {offering.subject.title}</p>
    <label>Teacher<select name="faculty_id" required value={facultyId} onChange={e=>setFacultyId(e.target.value)}><option value="" disabled>Choose a teacher</option>
      {faculty.data?.filter(f=>f.status!=='inactive').map(f=><option key={f.id} value={f.id}>{f.display_name}</option>)}</select></label>
    <fieldset><legend>Sections taking this subject</legend>
      {sections.map(s=><label className="inline" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)}
        onChange={e=>setChosen(e.target.checked?[...chosen,s.id]:chosen.filter(x=>x!==s.id))}/> {s.name} ({s.member_count})</label>)}
    </fieldset>
    <p className="muted">A subject placed in a year and semester only accepts matching sections. Use an enrollment exception for irregular students.</p>
    {error&&<p role="alert">{error}</p>}
    {needsOverride&&<label>Reason for an off-semester placement (kept in the audit history)<textarea name="override_reason" minLength={3} maxLength={1000}/></label>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save changes</button></div>
  </form></Dialog>;
}

/** One teacher, several subjects, each with its own sections, saved together (all or nothing). */
function BulkAssignDialog({termId,termSequence,sections,existing,onClose,onDone}:{termId:string;termSequence:number;sections:Section[];existing:OfferingSummary[];onClose:()=>void;onDone:()=>void}){
  const toast=useToast();
  const subjects=useQuery({queryKey:['subjects',false],queryFn:()=>api<Subject[]>('/subjects')});
  const faculty=useQuery({queryKey:['faculty-list'],queryFn:()=>api<Account[]>('/accounts?role=faculty&page_size=100')});
  const [facultyId,setFacultyId]=useState('');
  const [find,setFind]=useState('');
  const [semesterFilter,setSemesterFilter]=useState<'current'|'all'>('current');
  const [pick,setPick]=useState<Record<string,string[]>>({});          // subject id -> chosen section ids; present = subject selected
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const teacher=faculty.data?.find(f=>f.id===facultyId);
  const taken=new Set(existing.filter(o=>o.faculty.id===facultyId).map(o=>o.subject.id));
  const matchesYear=(sub:Subject,sec:Section)=>sub.year_level===null||sec.year_level===sub.year_level;
  const fits=(sub:Subject,sec:Section)=>sub.year_level===null||sub.semester===null||(sec.year_level===sub.year_level&&termSequence===sub.semester);
  const needle=find.trim().toLowerCase();
  const list=(subjects.data??[]).filter(sub=>sub.status==='active'&&(semesterFilter==='all'||sub.semester===termSequence)&&(!needle||`${sub.code} ${sub.title}`.toLowerCase().includes(needle)))
    .sort((a,b)=>Number(pick[b.id]!==undefined)-Number(pick[a.id]!==undefined)||Number(a.semester===termSequence?0:1)-Number(b.semester===termSequence?0:1)||a.code.localeCompare(b.code));
  const chosen=Object.keys(pick);
  const subjectOf=(id:string)=>subjects.data?.find(x=>x.id===id);
  const needsReason=(id:string)=>{const sub=subjectOf(id);return !!sub&&pick[id].some(sid=>{const sec=sections.find(x=>x.id===sid);return !!sec&&!fits(sub,sec)})};
  const ready=!!facultyId&&chosen.length>0&&chosen.every(id=>pick[id].length>0&&(!needsReason(id)||(reasons[id]??'').trim().length>=3));
  function toggleSubject(sub:Subject,on:boolean){
    if(!on){const rest={...pick};delete rest[sub.id];setPick(rest);return}
    setPick({...pick,[sub.id]:sections.filter(sec=>sub.year_level!==null&&matchesYear(sub,sec)&&fits(sub,sec)).map(sec=>sec.id)});
  }
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    const items=chosen.map(id=>({subject_id:id,section_ids:pick[id],placement_override_reason:needsReason(id)?(reasons[id]??'').trim():undefined}));
    try{await post(`/terms/${termId}/offerings/bulk`,{faculty_id:facultyId,items});toast(`${items.length} subject${items.length===1?'':'s'} assigned to ${teacher?.display_name}.`);onDone()}
    catch(err){
      setError(errorText(err));
    }finally{setBusy(false)}
  }
  return <Dialog title="Assign subjects" onClose={onClose}><form onSubmit={submit}>
    <label>Teacher<select required value={facultyId} onChange={e=>setFacultyId(e.target.value)}><option value="" disabled>Choose a teacher</option>
      {faculty.data?.filter(f=>f.status!=='inactive').map(f=><option key={f.id} value={f.id}>{f.display_name}</option>)}</select></label>
    <fieldset className="bulk-subjects"><legend>Subjects and the sections taking each</legend>
      {sections.length===0&&<p className="muted">Add sections first.</p>}
      <label>Show subjects<select aria-label="Filter subjects by semester" value={semesterFilter} onChange={e=>setSemesterFilter(e.target.value as 'current'|'all')}>
        <option value="current">Current semester ({termSequence})</option><option value="all">All semesters</option>
      </select></label>
      <label>Filter subjects<input type="search" value={find} onChange={e=>setFind(e.target.value)} placeholder="Code or title"/></label>
      {subjects.isPending?<p>Loading subjects…</p>:list.length===0?<p className="muted">No active subjects match this semester and search.</p>:<ul className="pick-list" aria-label="Subjects">{list.map(sub=>{
        const on=pick[sub.id]!==undefined,done=taken.has(sub.id);
        return <li key={sub.id} className={on?'on':''}>
          <label className="inline"><input type="checkbox" checked={on} disabled={!facultyId||done} onChange={e=>toggleSubject(sub,e.target.checked)}/>
            <span><strong>{sub.code}</strong> {sub.title} <span className="muted">{sub.year_level?`Year ${sub.year_level}, semester ${sub.semester}`:'not placed'}{done?' · already assigned to this teacher':''}</span></span></label>
          {on&&<div className="bulk-sections"><div className="chips" role="group" aria-label={`Sections for ${sub.code}`}>{sections.filter(sec=>matchesYear(sub,sec)).map(sec=>
            <label className="inline" key={sec.id}><input type="checkbox" checked={pick[sub.id].includes(sec.id)} onChange={e=>setPick({...pick,[sub.id]:e.target.checked?[...pick[sub.id],sec.id]:pick[sub.id].filter(x=>x!==sec.id)})}/> {sec.name} <span className="muted">({sec.member_count}){fits(sub,sec)?'':' · other semester'}</span></label>)}</div>
            {sections.every(sec=>!matchesYear(sub,sec))&&<p className="muted">No sections exist for this subject’s year level.</p>}
            {pick[sub.id].length===0&&<p className="muted">Choose at least one section.</p>}
            {needsReason(sub.id)&&<label>Reason for placing {sub.code} outside its prospectus semester (kept in the audit history)<textarea value={reasons[sub.id]??''} onChange={e=>setReasons({...reasons,[sub.id]:e.target.value})} minLength={3} maxLength={1000} required/></label>}</div>}</li>})}</ul>}
      {!facultyId&&<p className="muted">Choose a teacher first.</p>}
    </fieldset>
    <p className="muted">Subjects with a year-level placement only show sections for that year. An off-semester placement asks for a reason. Nothing is saved unless every selected subject can be assigned.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={!ready||busy}>{busy?'Assigning…':chosen.length===0?'Assign subjects':`Assign ${chosen.length} subject${chosen.length===1?'':'s'}`}</button></div>
  </form></Dialog>;
}
