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
import {yearLabel,type College,type OfferingSummary,type SchoolYear,type Section,type Subject} from './types';

interface SectionRosterRow{student_id:string;display_name:string;email:string;student_number:string;account_status:'active'|'invited'|'inactive';status:'active'|'withdrawn'}
interface SectionRosterPage{items:SectionRosterRow[];total:number;page:number;page_size:number;invitation_count:number}
interface BulkInvitationResult{sent:number;failed:number;results:{id:string;email:string;status:'sent'|'failed';message:string}[]}
interface StudentDraft{display_name:string;email:string;student_number:string}

export function TermWorkspace({initialTab='sections',standalone=false}:{initialTab?:'sections'|'offerings';standalone?:boolean}={}){
  const {termId:routeTermId}=useParams();
  const here=useHere();
  const ask=useConfirm();
  const toast=useToast();
  const years=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const fallbackTermId=useMemo(()=>{
    const openTerm=years.data?.find(y=>y.terms.some(t=>t.status==='open'))?.terms.find(t=>t.status==='open') ?? years.data?.[0]?.terms[0];
    return openTerm?.id ?? '';
  },[years.data]);
  const termId=routeTermId ?? fallbackTermId;
  const sections=useQuery({queryKey:['sections',termId],enabled:!!termId,queryFn:()=>api<Section[]>(`/terms/${termId}/sections`)});
  const offerings=useQuery({queryKey:['offerings',termId],enabled:!!termId,queryFn:()=>api<OfferingSummary[]>(`/terms/${termId}/offerings`)});
  const subjects=useQuery({queryKey:['subjects',false],queryFn:()=>api<Subject[]>('/subjects')});
  const colleges=useQuery({queryKey:['colleges'],queryFn:()=>api<College[]>('/colleges')});
  const [dialog,setDialog]=useState<'section'|'offering'|null>(null);
  const [editing,setEditing]=useState<OfferingSummary|null>(null);
  const [tab,setTab]=useState<'sections'|'offerings'>(initialTab);
  const activeTab=standalone?initialTab:tab;
  const [teacherFilter,setTeacherFilter]=useState('');
  const [sectionError,setSectionError]=useState('');
  const [deletingSection,setDeletingSection]=useState<string|null>(null);
  const [activeYear,setActiveYear]=useState<number|null>(null);
  const [selectedSectionId,setSelectedSectionId]=useState('');
  const [courseFilter,setCourseFilter]=useState('');
  const [rosterPage,setRosterPage]=useState(1);
  const [rosterPageSize,setRosterPageSize]=useState(25);
  const [editingStudentId,setEditingStudentId]=useState<string|null>(null);
  const [studentDraft,setStudentDraft]=useState<StudentDraft|null>(null);
  const [savingStudentId,setSavingStudentId]=useState<string|null>(null);
  const [sendingStudentId,setSendingStudentId]=useState<string|null>(null);
  const [sendingSectionInvitations,setSendingSectionInvitations]=useState(false);
  const [emailError,setEmailError]=useState('');
  const [leaving,setLeaving]=useState<SectionRosterRow|null>(null);
  const year=years.data?.find(y=>y.terms.some(t=>t.id===termId));
  const term=year?.terms.find(t=>t.id===termId);
  const closed=term?.status==='closed';
  const highestProgramYear=Math.max(0,...(subjects.data??[]).map(subject=>subject.year_level??0));
  const programYears=Array.from({length:highestProgramYear},(_,index)=>index+1);
  const visibleYear=activeYear??programYears[0]??null;
  const yearSections=useMemo(()=>sections.data?.filter(section=>section.year_level===visibleYear)??[],
    [sections.data,visibleYear]);
  const filteredYearSections=courseFilter
    ?yearSections.filter(section=>section.college_id===courseFilter)
    :yearSections;
  const selectedSection=filteredYearSections.find(section=>section.id===selectedSectionId)??filteredYearSections[0];
  const roster=useQuery({
    queryKey:['section-roster',selectedSection?.id,courseFilter,rosterPage,rosterPageSize],
    queryFn:()=>api<SectionRosterPage>(`/sections/${selectedSection!.id}/roster?page=${rosterPage}&page_size=${rosterPageSize}&status=active${courseFilter?`&college_id=${courseFilter}`:''}`),
    enabled:!!selectedSection,
  });
  useEffect(()=>{
    if(!filteredYearSections.some(section=>section.id===selectedSectionId)){
      setSelectedSectionId(filteredYearSections[0]?.id??'');
      setRosterPage(1);
    }
  },[filteredYearSections,selectedSectionId]);
  useEffect(()=>{
    if(courseFilter&&colleges.data&&!colleges.data.some(college=>
      college.id===courseFilter&&college.status==='active')){
      setCourseFilter('');
      setSelectedSectionId('');
      setRosterPage(1);
    }
  },[colleges.data,courseFilter]);
  const refresh=()=>{queryClient.invalidateQueries({queryKey:['sections',termId]});queryClient.invalidateQueries({queryKey:['offerings',termId]});queryClient.invalidateQueries({queryKey:['section-roster']})};
  async function removeSection(section:Section){
    if(!await ask({title:`Delete ${section.name}?`,message:'Only an unused section can be deleted. Sections with students, assignments, or academic records are protected.',yes:'Delete section',danger:true}))return;
    setDeletingSection(section.id);setSectionError('');
    try{await send('DELETE',`/sections/${section.id}`);refresh();toast(`${section.name} deleted.`)}
    catch(err){setSectionError(errorText(err))}
    finally{setDeletingSection(null)}
  }
  async function saveStudent(student:SectionRosterRow){
    if(!selectedSection||!studentDraft)return;
    const emailChanged=student.email.trim().toLowerCase()!==studentDraft.email.trim().toLowerCase();
    setSavingStudentId(student.student_id);setEmailError('');
    try{
      await send('PATCH',`/sections/${selectedSection.id}/students/${student.student_id}`,studentDraft);
      setEditingStudentId(null);setStudentDraft(null);
      queryClient.invalidateQueries({queryKey:['section-roster']});
      queryClient.invalidateQueries({queryKey:['sections',termId]});
      toast(emailChanged?'Student updated; invitation sent to the new email address.':'Student information updated.');
    }catch(err){setEmailError(errorText(err))}
    finally{setSavingStudentId(null)}
  }
  async function sendStudentLink(student:SectionRosterRow){
    setSendingStudentId(student.student_id);setEmailError('');
    try{
      await send('POST',`/accounts/${student.student_id}/send-link`);
      toast(student.account_status==='invited'
        ?`Invitation sent to ${student.email}.`
        :`Password-reset link sent to ${student.email}.`);
    }catch(err){setEmailError(errorText(err))}
    finally{setSendingStudentId(null)}
  }
  async function sendSectionInvitations(){
    if(!selectedSection)return;
    setSendingSectionInvitations(true);setEmailError('');
    try{
      const result=await post<BulkInvitationResult>(`/sections/${selectedSection.id}/send-invitations`,{});
      queryClient.invalidateQueries({queryKey:['section-roster']});
      if(result.failed){
        const failures=result.results.filter(item=>item.status==='failed')
          .map(item=>`${item.email}: ${item.message}`);
        setEmailError(`Could not send ${result.failed} invitation${result.failed===1?'':'s'}. ${failures.join(' ')}`);
      }
      toast(result.sent
        ?`${result.sent} invitation${result.sent===1?'':'s'} sent${result.failed?`; ${result.failed} failed`:''}.`
        :result.failed?'Some invitations could not be sent.':'No students are awaiting invitations.');
    }catch(err){setEmailError(errorText(err))}
    finally{setSendingSectionInvitations(false)}
  }
  async function withdrawStudent(student:SectionRosterRow,reason:string){
    if(!selectedSection)return;
    await send('DELETE',`/sections/${selectedSection.id}/members/${student.student_id}?reason=${encodeURIComponent(reason.trim())}`);
    setLeaving(null);
    queryClient.invalidateQueries({queryKey:['section-roster']});
    queryClient.invalidateQueries({queryKey:['sections',termId]});
    queryClient.invalidateQueries({queryKey:['offerings',termId]});
    toast(`${student.display_name} withdrawn. Their enrollment history is kept.`);
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
  const invitationCount=roster.data?.invitation_count??0;

  if(years.isPending)return <p>Loading…</p>;
  if(!term)return <section className="panel"><h1>Term not found</h1><Link to="/admin/settings">Back to School-year settings</Link></section>;
  const standaloneHeading=initialTab==='sections'?'Student management':'Course offerings';
  const headingLabel=standalone ? standaloneHeading : term.name;
  return <>
    {!standalone&&<p className="back"><Link to="/admin/settings">← School-year settings</Link></p>}
    <div className="page-heading">
      <div><p className="eyebrow">{standalone ? 'Administration' : year?.label}</p><h1>{headingLabel}</h1>
        {!standalone&&<span className={`badge ${term.status}`}>{term.status}</span>}</div>
    </div>
    {!standalone&&closed&&<p className="warn" role="status">This term is closed. Reopen it from School-year settings to make changes.</p>}
    {!standalone&&<div className="stats-grid">
      <div className="stat-card"><span>Sections</span><strong>{totalSections}</strong></div>
      <div className="stat-card"><span>Students</span><strong>{totalStudents}</strong></div>
      <div className="stat-card"><span>Offerings</span><strong>{activeOfferings}</strong></div>
    </div>}
    {!standalone&&<nav className="tabs" aria-label="Term workspace tabs">
      <button type="button" className={tab==='sections'?'active':''} aria-pressed={tab==='sections'} onClick={()=>setTab('sections')}>Students</button>
      <button type="button" className={tab==='offerings'?'active':''} aria-pressed={tab==='offerings'} onClick={()=>setTab('offerings')}>Course offerings</button>
    </nav>}

    {activeTab==='sections'?
      <section className="panel panel-settings">
        <div className="page-heading"><div><h2>Student management</h2>
          {!subjects.isError&&subjects.isSuccess&&programYears.length>0&&<p className="muted">Manage students by year level and section. Program duration: {highestProgramYear} year{highestProgramYear===1?'':'s'}.</p>}
        </div></div>
        {subjects.isError&&<p role="alert">Could not load the prospectus year levels: {subjects.error.message}</p>}
        {offerings.isError&&<p role="alert">Could not load course offerings: {offerings.error.message}</p>}
        {colleges.isError&&<p role="alert">Could not load colleges: {colleges.error.message}</p>}
        {!closed&&colleges.data?.every(college=>college.status!=='active')&&<p className="muted">Add an active college/program before creating sections.</p>}
        {!subjects.isError&&subjects.isSuccess&&programYears.length===0&&<p className="muted">No year levels are assigned in the prospectus yet. <Link to="/admin/subjects">Add or place subjects in the prospectus</Link> before creating sections.</p>}
        {sectionError&&<p role="alert">{sectionError}</p>}
        <div className="student-course-filter">
          <label>Course<select aria-label="Filter by course" value={courseFilter} onChange={event=>{setCourseFilter(event.target.value);setSelectedSectionId('');setRosterPage(1);setEmailError('')}}>
            <option value="">All courses</option>
            {colleges.data?.filter(college=>college.status==='active').map(college=><option key={college.id} value={college.id}>{college.name}</option>)}
          </select></label>
        </div>
        {programYears.length>0&&<>
          <nav className="tabs year-tabs" aria-label="Year levels">
            {programYears.map(yearLevel=><button key={yearLevel} type="button" className={visibleYear===yearLevel?'active':''} aria-pressed={visibleYear===yearLevel}
              onMouseEnter={()=>{setActiveYear(yearLevel);setSelectedSectionId('');setRosterPage(1);setEmailError('')}}
              onFocus={()=>{setActiveYear(yearLevel);setSelectedSectionId('');setRosterPage(1);setEmailError('')}}
              onClick={()=>{setActiveYear(yearLevel);setSelectedSectionId('');setRosterPage(1);setEmailError('')}}>{yearLabel(yearLevel)}</button>)}
          </nav>
          <div className="student-section-panel">
            <div className="student-section-filter">
              <label>Section<select aria-label="Filter by section" value={selectedSection?.id??''} onChange={event=>{setSelectedSectionId(event.target.value);setRosterPage(1);setEmailError('')}}>
                {filteredYearSections.map(section=><option key={section.id} value={section.id}>{section.name} ({section.member_count} students)</option>)}
              </select></label>
              {selectedSection&&<div className="actions">
                {!closed&&invitationCount>0&&<button type="button" className="icon-button" aria-label={`Invite all ${invitationCount} students awaiting invitation`} title={`Invite all ${invitationCount} students awaiting invitation`} disabled={sendingSectionInvitations} onClick={sendSectionInvitations}><StudentManagementIcon name="mail"/></button>}
                {!closed&&<button type="button" className="danger icon-button" aria-label={`Delete ${selectedSection.name}`} title="Delete section" disabled={deletingSection!==null} onClick={()=>removeSection(selectedSection)}>{deletingSection===selectedSection.id?'…':<StudentManagementIcon name="delete"/>}</button>}
              </div>}
            </div>
            <div className="actions student-year-actions">
              <button className={sections.data?.length===0?'primary':''} aria-label="Add section" disabled={closed||subjects.isPending||subjects.isError||colleges.isPending||colleges.isError||programYears.length===0} onClick={()=>setDialog('section')}><span aria-hidden="true">＋</span> Add section</button>
              <Link className="button" to="/admin/students">Import students</Link>
            </div>
          </div>
        </>}
        {sections.isPending?<p>Loading…</p>:sections.error?<p role="alert">{sections.error.message}</p>:
          filteredYearSections.length===0?<p className="muted">{courseFilter?`No sections for the selected college/program are assigned to ${visibleYear?yearLabel(visibleYear):'this year level'}.`:`No sections for ${visibleYear?yearLabel(visibleYear):'this year level'} yet. Add a section to start managing students.`}</p>:
          <>
            {emailError&&<p role="alert">{emailError}</p>}
            {roster.isPending?<p>Loading students…</p>:roster.error?<p role="alert">{roster.error.message}</p>:
              roster.data.items.length===0?<p className="muted">{courseFilter?'This section belongs to the selected college/program but has no students yet.':`No students are enrolled in ${selectedSection.name} yet.`}</p>:
              <div className="table-wrap" tabIndex={0} role="region" aria-label={`Students in ${selectedSection.name}`}>
                <table className="student-management-table"><caption className="sr-only">Students in {selectedSection.name}</caption>
                  <thead><tr><th scope="col">ID number</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
                  <tbody>{roster.data.items.map(student=>{
                    const rowDraft=editingStudentId===student.student_id?studentDraft:null;
                    const isEditing=rowDraft!==null;
                    return <tr key={student.student_id}>
                      <td>{rowDraft?<input aria-label={`ID number for ${student.display_name}`} maxLength={50} value={rowDraft.student_number} onChange={event=>setStudentDraft(current=>current?{...current,student_number:event.target.value}:current)}/>:student.student_number||'—'}</td>
                      <th scope="row">{rowDraft?<input aria-label={`Name for ${student.display_name}`} maxLength={150} value={rowDraft.display_name} onChange={event=>setStudentDraft(current=>current?{...current,display_name:event.target.value}:current)}/>:student.display_name}</th>
                      <td>{rowDraft?<input type="email" aria-label={`Email for ${student.display_name}`} maxLength={254} value={rowDraft.email} onChange={event=>setStudentDraft(current=>current?{...current,email:event.target.value}:current)}/>:student.email}</td>
                      <td><span className={`badge ${student.account_status==='active'?'done':''}`}>{student.account_status==='active'?'Active':student.account_status==='invited'?'Invitation pending':'Inactive'}</span></td>
                      <td><div className="actions student-row-actions">
                        {isEditing?<><button type="button" className="primary icon-button" aria-label={`Save ${student.display_name}`} title="Save" disabled={savingStudentId===student.student_id||!studentDraft?.display_name.trim()||!studentDraft?.email.trim()||!studentDraft?.student_number.trim()} onClick={()=>saveStudent(student)}>{savingStudentId===student.student_id?'…':<StudentManagementIcon name="save"/>}</button>
                          <button type="button" className="icon-button" aria-label={`Cancel editing ${student.display_name}`} title="Cancel" disabled={savingStudentId===student.student_id} onClick={()=>{setEditingStudentId(null);setStudentDraft(null)}}><StudentManagementIcon name="cancel"/></button></>
                          :<><button type="button" className="icon-button" aria-label={`${student.account_status==='invited'?'Send invitation':'Send reset link'} to ${student.display_name}`} title={student.account_status==='invited'?'Send invitation':'Send reset link'} disabled={student.account_status==='inactive'||sendingStudentId!==null} onClick={()=>sendStudentLink(student)}>{sendingStudentId===student.student_id?'…':<StudentManagementIcon name="mail"/>}</button>
                            <button type="button" className="icon-button" aria-label={`Edit ${student.display_name}`} title="Edit" disabled={closed||savingStudentId!==null} onClick={()=>{setEditingStudentId(student.student_id);setStudentDraft({display_name:student.display_name,email:student.email,student_number:student.student_number})}}><StudentManagementIcon name="edit"/></button>
                            {!closed&&student.status==='active'&&<button type="button" className="danger icon-button" aria-label={`Withdraw ${student.display_name}`} title="Withdraw" onClick={()=>setLeaving(student)}><StudentManagementIcon name="withdraw"/></button>}</>}
                      </div></td>
                    </tr>
                  })}</tbody>
                </table>
              </div>}
            {roster.data&&<Pager page={rosterPage} pageSize={rosterPageSize} total={roster.data.total} onPage={setRosterPage} onSize={size=>{setRosterPageSize(size);setRosterPage(1)}}/>}
          </>}
      </section>
      :
      <section className="panel panel-settings">
        <div className="page-heading"><h2>Course offerings</h2><div className="actions">
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

    {dialog==='section'&&<SectionDialog termId={term.id} yearLevels={programYears} initialYear={visibleYear??programYears[0]??1} initialCollegeId={courseFilter} sections={sections.data??[]} colleges={colleges.data??[]} onClose={()=>setDialog(null)} onDone={(yearLevel,collegeId)=>{setDialog(null);setActiveYear(yearLevel);setCourseFilter(collegeId);setSelectedSectionId('');refresh()}}/>}
    {dialog==='offering'&&<BulkAssignDialog termId={term.id} termSequence={term.sequence} sections={sections.data??[]} existing={offerings.data??[]}
      onClose={()=>setDialog(null)} onDone={()=>{setDialog(null);refresh()}}/>}
    {editing&&<OfferingDialog sections={sections.data??[]} offering={editing}
      onClose={()=>setEditing(null)} onDone={()=>{setEditing(null);refresh()}}/>}
    {leaving&&selectedSection&&<WithdrawStudentDialog sectionName={selectedSection.name} student={leaving}
      onClose={()=>setLeaving(null)} onSubmit={reason=>withdrawStudent(leaving,reason)}/>}
  </>;
}

function StudentManagementIcon({name}:{name:'mail'|'edit'|'save'|'cancel'|'withdraw'|'roster'|'delete'}){
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name==='mail'?<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>
      :name==='edit'?<><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.5 6 3.5 3.5"/></>
      :name==='save'?<path d="m5 12 4 4L19 6"/>
      :name==='cancel'?<path d="m6 6 12 12M18 6 6 18"/>
      :name==='withdraw'?<><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></>
      :name==='roster'?<><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r=".7" fill="currentColor"/><circle cx="4" cy="12" r=".7" fill="currentColor"/><circle cx="4" cy="18" r=".7" fill="currentColor"/></>
      :<><path d="M4 7h16M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13M9 7V4h6v3"/></>}
  </svg>;
}

function sectionSuffix(index:number){
  let value=index;let suffix='';
  while(value){value--;suffix=String.fromCharCode(65+value%26)+suffix;value=Math.floor(value/26)}
  return suffix;
}

function nextSectionName(collegeCode:string,yearLevel:number,sections:Section[],pending:string[]){
  const prefix=collegeCode.trim().toUpperCase();
  const used=new Set([...sections.map(section=>section.name),...pending].map(name=>name.trim().toLocaleLowerCase()));
  const usedSuffixes=new Set(sections.filter(section=>
    section.year_level===yearLevel&&section.college_id&&
    section.name.trim().toLocaleUpperCase().startsWith(`${prefix} `)).flatMap(section=>{
    const suffix=section.name.trim().slice(prefix.length).trim()
      .match(new RegExp(`^${yearLevel}\\s*[- ]?\\s*([A-Z]+)$`,'i'));
    return suffix?[suffix[1].toUpperCase()]:[];
  }));
  for(let index=1;;index++){
    const name=`${prefix} ${yearLevel}${sectionSuffix(index)}`;
    if(!used.has(name.toLocaleLowerCase())&&!usedSuffixes.has(sectionSuffix(index)))return name;
  }
}

function SectionDialog({termId,yearLevels,initialYear,initialCollegeId,sections,colleges,onClose,onDone}:{
  termId:string;yearLevels:number[];initialYear:number;initialCollegeId:string;
  sections:Section[];colleges:College[];onClose:()=>void;onDone:(yearLevel:number,collegeId:string)=>void
}){
  const [error,setError]=useState('');
  const [yearLevel,setYearLevel]=useState(initialYear);
  const [collegeId,setCollegeId]=useState(initialCollegeId);
  const [names,setNames]=useState<string[]>([]);
  const selectedCollege=colleges.find(college=>college.id===collegeId);
  const [draftName,setDraftName]=useState(()=>selectedCollege
    ?nextSectionName(selectedCollege.code,initialYear,sections,[]):'');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!colleges.some(college=>college.id===collegeId&&college.status==='active')){
      const college=colleges.find(item=>item.status==='active');
      setCollegeId(college?.id??'');
      setNames([]);
      setDraftName(college?nextSectionName(college.code,yearLevel,sections,[]):'');
    }
  },[collegeId,colleges,sections,yearLevel]);
  function addSection(){
    const name=draftName.trim();
    if(!name){setError('Enter a section name before adding it.');return}
    if([...sections.map(section=>section.name),...names].some(existing=>existing.toLocaleLowerCase()===name.toLocaleLowerCase())){
      setError('This section name already exists. Choose a different name.');return
    }
    if(names.length>=26){setError('Add no more than 26 sections at a time.');return}
    const next=[...names,name];
    setNames(next);
    setDraftName(selectedCollege?nextSectionName(selectedCollege.code,yearLevel,sections,next):'');
    setError('');
  }
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');
    try{
      await post(`/terms/${termId}/sections/bulk`,{
        college_id:collegeId,year_level:yearLevel,count:names.length});
      onDone(yearLevel,collegeId);
    }
    catch(err){setError(errorText(err))}finally{setBusy(false)}
  }
  return <Dialog title="Add sections" onClose={()=>busy?false:onClose()}><form className="section-dialog-form" onSubmit={submit}>
    <label>Course<select required value={collegeId} onChange={e=>{
      const value=e.target.value;const college=colleges.find(item=>item.id===value);
      setCollegeId(value);setNames([]);setDraftName(college?nextSectionName(college.code,yearLevel,sections,[]):'');setError('');
    }}>
      <option value="" disabled>Choose a college/program</option>
      {colleges.filter(college=>college.status==='active').map(college=><option key={college.id} value={college.id}>{college.code} · {college.name}</option>)}
    </select></label>
    <label>Year level<select value={yearLevel} onChange={e=>{const value=Number(e.target.value);setYearLevel(value);setNames([]);setDraftName(selectedCollege?nextSectionName(selectedCollege.code,value,sections,[]):'');setError('')}}>
      {yearLevels.map(n=><option key={n} value={n}>{yearLabel(n)}</option>)}</select></label>
    <div className="section-name-entry">
      <label htmlFor="new-section-name">Section</label>
      <div><input id="new-section-name" value={draftName} readOnly/>
        <button type="button" aria-label="Add section to list" disabled={!collegeId||names.length>=26} onClick={addSection}>＋</button></div>
    </div>
    {names.length>0&&<ol className="section-name-list">{names.map((name,index)=><li key={`${index}:${name}`}>
      <span>{name}</span>
      <button type="button" aria-label={`Remove section ${name}`} onClick={()=>setNames(current=>current.filter((_,i)=>i!==index))}>Remove</button>
    </li>)}</ol>}
    {selectedCollege&&<p className="muted">New section names use {selectedCollege.code} and will belong to {selectedCollege.name}. Assign subjects later from Offerings.</p>}
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy||!collegeId||names.length===0}>{busy?'Creating…':`Create ${names.length} section${names.length===1?'':'s'}`}</button></div>
  </form></Dialog>;
}

function WithdrawStudentDialog({sectionName,student,onClose,onSubmit}:{sectionName:string;student:SectionRosterRow;onClose:()=>void;onSubmit:(reason:string)=>Promise<void>}){
  const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');
    try{await onSubmit(reason)}catch(err){setError(errorText(err))}finally{setBusy(false)}
  }
  return <Dialog title={`Withdraw ${student.display_name}?`} onClose={()=>busy?false:onClose()}><form onSubmit={submit}>
    <p>They leave {sectionName}. Their enrollment history is kept.</p>
    <label>Reason (kept in the audit history)<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={3} maxLength={1000} required autoFocus placeholder="For example: transferred to another program"/></label>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="danger" disabled={busy||reason.trim().length<3}>{busy?'Withdrawing…':'Withdraw student'}</button></div>
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
