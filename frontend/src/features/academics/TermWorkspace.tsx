import {useToast} from '../../components/undo';
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {api,post,send,errorText,ApiError,type Account} from '../../app/api';
import {queryClient} from '../../app/providers';
import {Dialog} from '../../components/Dialog';
import {Pager} from '../../components/Pager';
import {useConfirm} from '../../components/confirm';
import {StudentImport} from './StudentImport';
import {TeacherImport} from '../accounts/TeacherImport';
import {yearLabel,type College,type OfferingSummary,type SchoolYear,type Section,type Subject} from './types';
import {OfferingRoster} from './Rosters';

interface SectionRosterRow{student_id:string;display_name:string;email:string;student_number:string;account_status:'active'|'invited'|'inactive';status:'active'|'withdrawn'}
interface SectionRosterPage{items:SectionRosterRow[];total:number;page:number;page_size:number;invitation_count:number}
interface BulkInvitationResult{sent:number;failed:number;results:{id:string;email:string;status:'sent'|'failed';message:string}[]}
interface StudentDraft{display_name:string;email:string;student_number:string}
interface TeacherDraft{display_name:string;email:string;college_id:string}

export function TermWorkspace({initialTab='sections',standalone=false}:{initialTab?:'sections'|'offerings';standalone?:boolean}={}){
  const {termId:routeTermId}=useParams();
  const ask=useConfirm();
  const toast=useToast();
  const years=useQuery({queryKey:['school-years'],queryFn:()=>api<SchoolYear[]>('/school-years')});
  const fallbackTermId=useMemo(()=>{
    const openTerm=years.data?.find(y=>y.terms.some(t=>t.status==='active'))?.terms.find(t=>t.status==='active') ?? years.data?.[0]?.terms[0];
    return openTerm?.id ?? '';
  },[years.data]);
  const termId=routeTermId ?? fallbackTermId;
  const sections=useQuery({queryKey:['sections',termId],enabled:!!termId,queryFn:()=>api<Section[]>(`/terms/${termId}/sections`)});
  const offerings=useQuery({queryKey:['offerings',termId],enabled:!!termId,queryFn:()=>api<OfferingSummary[]>(`/terms/${termId}/offerings`)});
  const subjects=useQuery({queryKey:['subjects',false],queryFn:()=>api<Subject[]>('/subjects')});
  const colleges=useQuery({queryKey:['colleges'],queryFn:()=>api<College[]>('/colleges')});
  const [dialog,setDialog]=useState<'section'|'offering'|null>(null);
  const [studentImportOpen,setStudentImportOpen]=useState(false);
  const [teacherImportOpen,setTeacherImportOpen]=useState(false);
  const [teacherInviteOpen,setTeacherInviteOpen]=useState(false);
  const [teacherSearch,setTeacherSearch]=useState('');
  const [facultyCollegeFilter,setFacultyCollegeFilter]=useState('');
  const [facultyTab,setFacultyTab]=useState<'teachers'|'assignments'>('teachers');
  const [teacherMessage,setTeacherMessage]=useState('');
  const [sendingTeacherId,setSendingTeacherId]=useState('');
  const [updatingTeacherId,setUpdatingTeacherId]=useState('');
  const [editingTeacherId,setEditingTeacherId]=useState<string|null>(null);
  const [teacherDraft,setTeacherDraft]=useState<TeacherDraft|null>(null);
  const [savingTeacherId,setSavingTeacherId]=useState<string|null>(null);
  const [addingSubjectFacultyId,setAddingSubjectFacultyId]=useState('');
  const [editing,setEditing]=useState<OfferingSummary|null>(null);
  const [transferringOffering,setTransferringOffering]=useState<OfferingSummary|null>(null);
  const [viewingRoster,setViewingRoster]=useState<OfferingSummary|null>(null);
  const [addingSection,setAddingSection]=useState<OfferingSummary|null>(null);
  const offeringsTableRef=useRef<HTMLDivElement>(null);
  const [tab,setTab]=useState<'sections'|'offerings'>(initialTab);
  const activeTab=standalone?initialTab:tab;
  const [teacherFilter,setTeacherFilter]=useState('');
  const [sectionError,setSectionError]=useState('');
  const [deletingSection,setDeletingSection]=useState<string|null>(null);
  const [activeYear,setActiveYear]=useState<number|null>(null);
  const [openYearMenu,setOpenYearMenu]=useState<number|null>(null);
  const [selectedSectionId,setSelectedSectionId]=useState('');
  const [courseFilter,setCourseFilter]=useState('');
  const [rosterFind,setRosterFind]=useState('');
  const rosterSearch=useDebouncedValue(rosterFind);
  const [selectedStudents,setSelectedStudents]=useState<SectionRosterRow[]>([]);
  const [withdrawingSelected,setWithdrawingSelected]=useState(false);
  const [bulkActionBusy,setBulkActionBusy]=useState(false);
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
  const closed=!!term&&term.status!=='active';
  const teacherSearchValue=useDebouncedValue(teacherSearch);
  const facultyAccounts=useQuery({
    queryKey:['faculty-management-accounts',teacherSearchValue,facultyCollegeFilter],
    queryFn:()=>api<Account[]>(`/accounts?role=faculty&page_size=100&search=${encodeURIComponent(teacherSearchValue)}${facultyCollegeFilter?`&college_id=${facultyCollegeFilter}`:''}`),
    enabled:activeTab==='offerings',
  });
  const facultyOptions=useQuery({
    queryKey:['faculty-assignment-options',facultyCollegeFilter],
    queryFn:()=>api<Account[]>(`/accounts?role=faculty&page_size=100${facultyCollegeFilter?`&college_id=${facultyCollegeFilter}`:''}`),
    enabled:activeTab==='offerings',
  });
  const facultyTakeoverOptions=useQuery({
    queryKey:['faculty-takeover-options'],
    queryFn:()=>api<Account[]>('/accounts?role=faculty&status=active&page_size=100'),
    enabled:activeTab==='offerings',
  });
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
    queryKey:['section-roster',selectedSection?.id,courseFilter,rosterPage,rosterPageSize,rosterSearch],
    queryFn:()=>api<SectionRosterPage>(`/sections/${selectedSection!.id}/roster?page=${rosterPage}&page_size=${rosterPageSize}&status=active&search=${encodeURIComponent(rosterSearch)}${courseFilter?`&college_id=${courseFilter}`:''}`),
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
  useEffect(()=>{
    const table=offeringsTableRef.current;
    if(!table)return;
    const scrollHorizontally=(event:WheelEvent)=>{
      if(table.scrollWidth<=table.clientWidth||Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;
      event.preventDefault();
      table.scrollLeft+=event.deltaY;
    };
    table.addEventListener('wheel',scrollHorizontally,{passive:false});
    return ()=>table.removeEventListener('wheel',scrollHorizontally);
  },[offerings.data]);
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
  async function sendSelectedStudentLinks(){
    if(!selectedStudents.length)return;
    if(!await ask({
      title:`Send links to ${selectedStudents.length} selected students?`,
      message:'Invited students receive invitation links. Active accounts receive password-reset links.',
      yes:'Send links',
    }))return;
    setBulkActionBusy(true);setEmailError('');
    try{
      const results:BulkInvitationResult['results']=[];
      const requestErrors:string[]=[];
      for(let index=0;index<selectedStudents.length;index+=25){
        const batch=selectedStudents.slice(index,index+25);
        try{
          const result=await post<BulkInvitationResult>('/accounts/send-links',{
            account_ids:batch.map(student=>student.student_id),
          });
          results.push(...result.results);
        }catch(err){
          requestErrors.push(`${batch.length} link${batch.length===1?'':'s'}: ${errorText(err)}`);
          batch.forEach(student=>results.push({
            id:student.student_id,email:student.email,status:'failed',message:errorText(err),
          }));
        }
      }
      const sent=results.filter(item=>item.status==='sent').length;
      const failed=results.length-sent;
      const failedIds=new Set(results.filter(item=>item.status==='failed').map(item=>item.id));
      setSelectedStudents(current=>current.filter(student=>failedIds.has(student.student_id)));
      if(failed){
        const failures=results.filter(item=>item.status==='failed')
          .map(item=>`${item.email}: ${item.message}`);
        setEmailError(`Could not send ${failed} link${failed===1?'':'s'}. ${[...requestErrors,...failures].join(' ')}`);
      }
      toast(sent
        ?`${sent} link${sent===1?'':'s'} sent${failed?`; ${failed} failed`:''}.`
        :failed?'Some links could not be sent.':'No links were sent.');
    }catch(err){setEmailError(errorText(err))}
    finally{setBulkActionBusy(false)}
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
  async function sendTeacherLink(account:Account){
    if(!await ask({title:`Send a link to ${account.display_name}?`,message:account.status==='invited'
      ?`An invitation link will be sent to ${account.email}.`
      :`A password-reset link will be sent to ${account.email}.`,yes:'Send link'}))return;
    setSendingTeacherId(account.id);setTeacherMessage('');
    try{
      await post(`/accounts/${account.id}/send-link`,{});
      toast(`Link sent to ${account.email}.`);
    }catch(err){setTeacherMessage(errorText(err))}
    finally{setSendingTeacherId('')}
  }
  async function changeTeacherCollege(account:Account,collegeId:string|null){
    setUpdatingTeacherId(account.id);
    setTeacherMessage('');
    try{
      await send('PATCH',`/accounts/${account.id}/college`,{college_id:collegeId});
      queryClient.invalidateQueries({queryKey:['faculty-management-accounts']});
      queryClient.invalidateQueries({queryKey:['faculty-assignment-options']});
      toast(`${account.display_name}'s college / program updated.`);
    }catch(err){setTeacherMessage(errorText(err))}
    finally{setUpdatingTeacherId('')}
  }
  async function removeTeacherCollege(account:Account){
    if(!account.college_id||!await ask({
      title:`Remove ${account.display_name}'s college/program assignment?`,
      message:"This removes the teacher's college/program association. Existing subject assignments and academic history are preserved.",
      yes:'Remove assignment',
      danger:true,
    }))return;
    await changeTeacherCollege(account,null);
  }
  async function changeTeacherStatus(account:Account){
    const status=account.status==='active'?'inactive':'active';
    const action=status==='inactive'?'Deactivate':'Activate';
    if(!await ask({
      title:`${action} ${account.display_name}?`,
      message:status==='inactive'
        ?'The teacher will lose account access. Their teaching and audit history will be preserved.'
        :'The teacher will regain account access.',
      yes:action,
      danger:status==='inactive',
    }))return;
    setUpdatingTeacherId(account.id);
    setTeacherMessage('');
    try{
      await send('PATCH',`/accounts/${account.id}/status`,{status});
      queryClient.invalidateQueries({queryKey:['faculty-management-accounts']});
      queryClient.invalidateQueries({queryKey:['faculty-assignment-options']});
      toast(`${account.display_name}'s account ${status==='inactive'?'deactivated':'activated'}.`);
    }catch(err){setTeacherMessage(errorText(err))}
    finally{setUpdatingTeacherId('')}
  }
  async function saveTeacher(account:Account){
    if(!teacherDraft)return;
    const emailChanged=account.email.trim().toLowerCase()!==teacherDraft.email.trim().toLowerCase();
    setSavingTeacherId(account.id);setTeacherMessage('');
    try{
      await send('PATCH',`/accounts/${account.id}/profile`,{
        display_name:teacherDraft.display_name,
        email:teacherDraft.email,
        college_id:teacherDraft.college_id||null,
      });
      setEditingTeacherId(null);setTeacherDraft(null);
      queryClient.invalidateQueries({queryKey:['faculty-management-accounts']});
      queryClient.invalidateQueries({queryKey:['faculty-assignment-options']});
      queryClient.invalidateQueries({queryKey:['faculty-takeover-options']});
      toast(emailChanged
        ?'Teacher updated; invitation sent to the new email address.'
        :'Teacher information updated.');
    }catch(err){setTeacherMessage(errorText(err))}
    finally{setSavingTeacherId(null)}
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
  async function withdrawSelectedStudents(reason:string){
    if(!selectedSection)return;
    setBulkActionBusy(true);setEmailError('');
    const failed:SectionRosterRow[]=[];
    for(const student of selectedStudents){
      try{
        await send('DELETE',`/sections/${selectedSection.id}/members/${student.student_id}?reason=${encodeURIComponent(reason.trim())}`);
      }catch(err){
        failed.push(student);
        setEmailError(current=>`${current}${current?' ':''}${student.display_name}: ${errorText(err)}`);
      }
    }
    setSelectedStudents(failed);
    setWithdrawingSelected(false);
    setBulkActionBusy(false);
    queryClient.invalidateQueries({queryKey:['section-roster']});
    queryClient.invalidateQueries({queryKey:['sections',termId]});
    queryClient.invalidateQueries({queryKey:['offerings',termId]});
    const withdrawn=selectedStudents.length-failed.length;
    if(withdrawn)toast(`${withdrawn} student${withdrawn===1?'':'s'} withdrawn. Enrollment history is kept.`);
  }
  const teacherGroups=offerings.data?.reduce<{id:string;name:string;rows:OfferingSummary[]}[]>((groups,offering)=>{
    let group=groups.find(item=>item.id===offering.faculty.id);
    if(!group){group={id:offering.faculty.id,name:offering.faculty.display_name,rows:[]};groups.push(group)}
    group.rows.push(offering);
    return groups;
  },[]).sort((a,b)=>a.name.localeCompare(b.name));
  const facultyAccountById=new Map((facultyOptions.data??facultyAccounts.data??[]).map(account=>[account.id,account]));
  const visibleTeacherGroups=teacherGroups?.filter(group=>
    (!teacherFilter||group.id===teacherFilter)&&facultyAccountById.has(group.id));
  const visibleFacultyAccounts=facultyAccounts.data??[];
  const collegeById=new Map((colleges.data??[]).map(college=>[college.id,college]));
  const assignmentTeachers=facultyOptions.data??[];
  const totalSections=sections.data?.length ?? 0;
  const totalStudents=sections.data?.reduce((sum, section) => sum + section.member_count, 0) ?? 0;
  const activeOfferings=offerings.data?.filter(offering => offering.status === 'active').length ?? 0;
  const invitationCount=roster.data?.invitation_count??0;
  const rosterRows=roster.data?.items??[];
  const selectableRosterRows=rosterRows.filter(student=>student.account_status!=='inactive');
  const everyVisibleStudentSelected=selectableRosterRows.length>0&&selectableRosterRows.every(student=>
    selectedStudents.some(selected=>selected.student_id===student.student_id));

  if(years.isPending)return <p>Loading…</p>;
  if(!term)return <section className="panel"><h1>Term not found</h1><Link to="/admin/settings">Back to Settings</Link></section>;
  const standaloneHeading=initialTab==='sections'?'Student management':'Faculty management';
  const headingLabel=standalone ? standaloneHeading : term.name;
  return <>
    {!standalone&&<p className="back"><Link to="/admin/settings">← Settings</Link></p>}
    <div className="page-heading">
      <div><p className="eyebrow">{standalone ? 'Administration' : year?.label}</p><h1 className={activeTab==='sections'?'student-management-title':''}>{headingLabel}</h1>
        {!standalone&&<span className={`badge ${term.status}`}>{term.status}</span>}</div>
    </div>
    {!standalone&&closed&&<p className="warn" role="status">This semester is read-only until it is active.</p>}
    {!standalone&&<div className="stats-grid">
      <div className="stat-card"><span>Sections</span><strong>{totalSections}</strong></div>
      <div className="stat-card"><span>Students</span><strong>{totalStudents}</strong></div>
      <div className="stat-card"><span>Offerings</span><strong>{activeOfferings}</strong></div>
    </div>}
    {!standalone&&<nav className="tabs" aria-label="Term workspace tabs">
      <button type="button" className={tab==='sections'?'active':''} aria-pressed={tab==='sections'} onClick={()=>setTab('sections')}>Students</button>
      <button type="button" className={tab==='offerings'?'active':''} aria-pressed={tab==='offerings'} onClick={()=>setTab('offerings')}>Faculty</button>
    </nav>}

    {activeTab==='sections'?
      <section className="panel panel-settings student-management-panel">
        <div className="page-heading"><div><h2>Student management</h2>
          {!subjects.isError&&subjects.isSuccess&&programYears.length>0&&<p className="muted">Manage students by year level and section. Program duration: {highestProgramYear} year{highestProgramYear===1?'':'s'}.</p>}
        </div></div>
        {subjects.isError&&<p role="alert">Could not load the prospectus year levels: {subjects.error.message}</p>}
        {sections.isError&&<p role="alert">Could not load sections: {sections.error.message}</p>}
        {offerings.isError&&<p role="alert">Could not load Faculty Management: {offerings.error.message}</p>}
        {colleges.isError&&<p role="alert">Could not load colleges: {colleges.error.message}</p>}
        {!closed&&colleges.data?.every(college=>college.status!=='active')&&<p className="muted">Add an active college/program before creating sections.</p>}
        {!subjects.isError&&subjects.isSuccess&&programYears.length===0&&<p className="muted">No year levels are assigned in the prospectus yet. <Link to="/admin/subjects">Add or place subjects in the prospectus</Link> before creating sections.</p>}
        {programYears.length===0&&<button type="button" disabled={closed} onClick={()=>setStudentImportOpen(true)}>Import students</button>}
        {sectionError&&<p role="alert">{sectionError}</p>}
        <div className="student-course-filter">
          <label>Course<select aria-label="Filter by course" value={courseFilter} disabled={bulkActionBusy} onChange={event=>{setCourseFilter(event.target.value);setSelectedSectionId('');setSelectedStudents([]);setRosterPage(1);setEmailError('')}}>
            <option value="">All courses</option>
            {colleges.data?.filter(college=>college.status==='active').map(college=><option key={college.id} value={college.id}>{college.name}</option>)}
          </select></label>
        </div>
        {programYears.length>0&&<>
          <nav className="tabs year-tabs" aria-label="Year levels">
            {programYears.map(yearLevel=>{
              const sectionsForYear=(sections.data??[]).filter(section=>
                section.year_level===yearLevel&&(!courseFilter||section.college_id===courseFilter));
              return <div className="year-tab-menu" key={yearLevel}
              onMouseEnter={()=>setOpenYearMenu(yearLevel)}
              onMouseLeave={event=>{if(!event.currentTarget.contains(document.activeElement))setOpenYearMenu(current=>current===yearLevel?null:current)}}
              onFocus={()=>setOpenYearMenu(yearLevel)}
              onBlur={event=>{const next=event.relatedTarget;if(!(next instanceof Node)||!event.currentTarget.contains(next))setOpenYearMenu(current=>current===yearLevel?null:current)}}>
              <button type="button" className={visibleYear===yearLevel?'active':''} aria-pressed={visibleYear===yearLevel}
                disabled={bulkActionBusy}
                aria-expanded={openYearMenu===yearLevel}
                onClick={()=>setOpenYearMenu(yearLevel)}>{yearLabel(yearLevel)}</button>
              {openYearMenu===yearLevel&&<div className="year-section-menu" role="group" aria-label={`${yearLabel(yearLevel)} sections`}>
                {sections.isPending?<span className="muted">Loading sections…</span>
                  :sectionsForYear.length?sectionsForYear.map(section=><button key={section.id} type="button"
                    className={selectedSection?.id===section.id?'selected':''}
                    disabled={bulkActionBusy}
                    aria-pressed={selectedSection?.id===section.id}
                    onClick={()=>{setActiveYear(yearLevel);setSelectedSectionId(section.id);setSelectedStudents([]);setRosterPage(1);setRosterFind('');setEmailError('');setOpenYearMenu(null)}}>
                    <span>{section.name}</span><span className="muted">{section.member_count} students</span>
                  </button>)
                  :<span className="muted">No sections for this year level.</span>}
                <button type="button" className="year-section-add"
                  disabled={closed||bulkActionBusy||subjects.isPending||subjects.isError||colleges.isPending||colleges.isError||programYears.length===0}
                  onClick={()=>{setActiveYear(yearLevel);setOpenYearMenu(null);setDialog('section')}}>
                  <span aria-hidden="true">＋</span> Add section
                </button>
              </div>}
            </div>})}
          </nav>
          <div className="student-section-panel">
            <div className="student-section-filter">
              <div className="student-section-summary">
                <strong>{selectedSection?.name??'No section selected'}</strong>
                {selectedSection&&<span className="muted">{selectedSection.member_count} students</span>}
              </div>
              <div className="actions student-section-actions">
                {!closed&&invitationCount>0&&<button type="button" className="icon-button" aria-label={`Invite all ${invitationCount} students awaiting invitation`} title={`Invite all ${invitationCount} students awaiting invitation`} disabled={sendingSectionInvitations||bulkActionBusy} onClick={sendSectionInvitations}><StudentManagementIcon name="mail"/></button>}
                {selectedSection&&!closed&&<button type="button" className="danger icon-button" aria-label={`Delete ${selectedSection.name}`} title="Delete section" disabled={deletingSection!==null} onClick={()=>removeSection(selectedSection)}>{deletingSection===selectedSection.id?'…':<StudentManagementIcon name="delete"/>}</button>}
                <button className={sections.data?.length===0?'primary':''} aria-label="Add section" disabled={closed||bulkActionBusy||subjects.isPending||subjects.isError||colleges.isPending||colleges.isError||programYears.length===0} onClick={()=>setDialog('section')}><span aria-hidden="true">＋</span> Add section</button>
                <button type="button" disabled={closed} onClick={()=>setStudentImportOpen(true)}>Import students</button>
              </div>
            </div>
            <label className="student-roster-search">Search students
              <input type="search" maxLength={100} value={rosterFind} onChange={event=>{setRosterFind(event.target.value);setRosterPage(1)}}
                placeholder="Name, email, or student number"/>
            </label>
          </div>
        </>}
        {sections.isPending?<p>Loading…</p>:sections.error?<p role="alert">{sections.error.message}</p>:
          filteredYearSections.length===0?<p className="muted">{courseFilter?`No sections for the selected college/program are assigned to ${visibleYear?yearLabel(visibleYear):'this year level'}.`:`No sections for ${visibleYear?yearLabel(visibleYear):'this year level'} yet. Add a section to start managing students.`}</p>:
          <>
            {emailError&&<p role="alert">{emailError}</p>}
            {selectedStudents.length>0&&<div className="actions student-bulk-actions">
              <span role="status">{selectedStudents.length} selected</span>
              <button type="button" disabled={bulkActionBusy} onClick={()=>void sendSelectedStudentLinks()}>
                {bulkActionBusy?'Working…':'Send links to selected'}
              </button>
              {!closed&&<button type="button" className="danger" disabled={bulkActionBusy} onClick={()=>setWithdrawingSelected(true)}>
                Withdraw selected
              </button>}
              <button type="button" className="linklike" disabled={bulkActionBusy} onClick={()=>setSelectedStudents([])}>Clear selection</button>
            </div>}
            {roster.isPending?<p>Loading students…</p>:roster.error?<p role="alert">{roster.error.message}</p>:
              roster.data.items.length===0?<p className="muted">{rosterSearch?'No students match this search.':courseFilter?'This section belongs to the selected college/program but has no students yet.':`No students are enrolled in ${selectedSection.name} yet.`}</p>:
              <div className="table-wrap" tabIndex={0} role="region" aria-label={`Students in ${selectedSection.name}`}>
                <table className="student-management-table"><caption className="sr-only">Students in {selectedSection.name}</caption>
                  <thead><tr><th scope="col"><input type="checkbox" aria-label="Select eligible students on this page"
                    checked={everyVisibleStudentSelected}
                    disabled={!selectableRosterRows.length||bulkActionBusy}
                    onChange={event=>setSelectedStudents(current=>event.target.checked
                      ?[...current,...selectableRosterRows.filter(student=>!current.some(selected=>selected.student_id===student.student_id))]
                      :current.filter(student=>!selectableRosterRows.some(row=>row.student_id===student.student_id)))}/></th>
                    <th scope="col">ID number</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
                  <tbody>{roster.data.items.map(student=>{
                    const rowDraft=editingStudentId===student.student_id?studentDraft:null;
                    const isEditing=rowDraft!==null;
                    return <tr key={student.student_id}>
                      <td><input type="checkbox" aria-label={`Select ${student.display_name}`}
                        checked={selectedStudents.some(selected=>selected.student_id===student.student_id)}
                        disabled={student.account_status==='inactive'||bulkActionBusy}
                        onChange={event=>setSelectedStudents(current=>event.target.checked
                          ?current.some(selected=>selected.student_id===student.student_id)?current:[...current,student]
                          :current.filter(selected=>selected.student_id!==student.student_id))}/></td>
                      <td>{rowDraft?<input aria-label={`ID number for ${student.display_name}`} maxLength={50} value={rowDraft.student_number} onChange={event=>setStudentDraft(current=>current?{...current,student_number:event.target.value}:current)}/>:student.student_number||'—'}</td>
                      <th scope="row">{rowDraft?<input aria-label={`Name for ${student.display_name}`} maxLength={150} value={rowDraft.display_name} onChange={event=>setStudentDraft(current=>current?{...current,display_name:event.target.value}:current)}/>:student.display_name}</th>
                      <td>{rowDraft?<input type="email" aria-label={`Email for ${student.display_name}`} maxLength={254} value={rowDraft.email} onChange={event=>setStudentDraft(current=>current?{...current,email:event.target.value}:current)}/>:student.email}</td>
                      <td><span className={`badge ${student.account_status==='active'?'done':''}`}>{student.account_status==='active'?'Active':student.account_status==='invited'?'Invitation pending':'Inactive'}</span></td>
                      <td><div className="actions student-row-actions">
                        {isEditing?<><button type="button" className="primary icon-button" aria-label={`Save ${student.display_name}`} title="Save" disabled={bulkActionBusy||savingStudentId===student.student_id||!studentDraft?.display_name.trim()||!studentDraft?.email.trim()||!studentDraft?.student_number.trim()} onClick={()=>saveStudent(student)}>{savingStudentId===student.student_id?'…':<StudentManagementIcon name="save"/>}</button>
                          <button type="button" className="icon-button" aria-label={`Cancel editing ${student.display_name}`} title="Cancel" disabled={savingStudentId===student.student_id} onClick={()=>{setEditingStudentId(null);setStudentDraft(null)}}><StudentManagementIcon name="cancel"/></button></>
                          :<><button type="button" className="icon-button" aria-label={`${student.account_status==='invited'?'Send invitation':'Send reset link'} to ${student.display_name}`} title={student.account_status==='invited'?'Send invitation':'Send reset link'} disabled={bulkActionBusy||student.account_status==='inactive'||sendingStudentId!==null} onClick={()=>sendStudentLink(student)}>{sendingStudentId===student.student_id?'…':<StudentManagementIcon name="mail"/>}</button>
                            <button type="button" className="icon-button" aria-label={`Edit ${student.display_name}`} title="Edit" disabled={bulkActionBusy||closed||savingStudentId!==null} onClick={()=>{setEditingStudentId(student.student_id);setStudentDraft({display_name:student.display_name,email:student.email,student_number:student.student_number})}}><StudentManagementIcon name="edit"/></button>
                            {!closed&&student.status==='active'&&<button type="button" className="danger icon-button" aria-label={`Withdraw ${student.display_name}`} title="Withdraw" disabled={bulkActionBusy} onClick={()=>setLeaving(student)}><StudentManagementIcon name="withdraw"/></button>}</>}
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
        <div className="page-heading"><h2>Faculty Management</h2><div className="actions">
          {facultyTab==='teachers'?<>
            <button type="button" onClick={()=>setTeacherImportOpen(true)}>Import teachers</button>
            <button type="button" className="primary" onClick={()=>{setTeacherMessage('');setTeacherInviteOpen(true)}}>Add teacher</button>
          </>:<button className="primary" disabled={closed||!sections.data} onClick={()=>setDialog('offering')}>Assign subjects</button>}
        </div></div>
        <nav className="tabs faculty-management-tabs" aria-label="Faculty management sections">
          <button type="button" className={facultyTab==='teachers'?'active':''} aria-pressed={facultyTab==='teachers'} onClick={()=>setFacultyTab('teachers')}>Teachers</button>
          <button type="button" className={facultyTab==='assignments'?'active':''} aria-pressed={facultyTab==='assignments'} onClick={()=>setFacultyTab('assignments')}>Subject assignments</button>
        </nav>
        {teacherMessage&&<p role="alert">{teacherMessage}</p>}
        {colleges.isError&&<p role="alert">Could not load colleges/programs: {colleges.error.message}</p>}
        {facultyTab==='teachers'?<>
          <div className="filters">
            <label>Search teachers
              <input type="search" maxLength={150} value={teacherSearch} onChange={event=>setTeacherSearch(event.target.value)} placeholder="Name or email"/>
            </label>
            <label>College / program
              <select aria-label="Filter teachers by college or program" value={facultyCollegeFilter} onChange={event=>{setFacultyCollegeFilter(event.target.value);setTeacherFilter('')}}>
                <option value="">All colleges / programs</option>
                {colleges.data?.map(college=><option key={college.id} value={college.id}>{college.name}{college.status==='inactive'?' (inactive)':''}</option>)}
              </select>
            </label>
          </div>
          {facultyAccounts.isPending?<p>Loading teachers…</p>:facultyAccounts.error?<p role="alert">{facultyAccounts.error.message}</p>:
            visibleFacultyAccounts.length===0?<p className="muted">No teachers match these filters.</p>:
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Teacher accounts">
              <table className="teacher-account-table"><thead><tr><th scope="col">Teacher</th><th scope="col">Email</th><th scope="col">College / program</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
                <tbody>{visibleFacultyAccounts.map(account=><tr key={account.id}>
                  {editingTeacherId===account.id&&teacherDraft
                    ?<><th scope="row"><input form={`teacher-edit-${account.id}`} aria-label={`Name for ${account.display_name}`} maxLength={150} required value={teacherDraft.display_name}
                        onChange={event=>setTeacherDraft(current=>current?{...current,display_name:event.target.value}:current)}/></th>
                      <td><input form={`teacher-edit-${account.id}`} type="email" aria-label={`Email for ${account.display_name}`} maxLength={254} required value={teacherDraft.email}
                        onChange={event=>setTeacherDraft(current=>current?{...current,email:event.target.value}:current)}/></td>
                      <td><label className="sr-only" htmlFor={`teacher-college-${account.id}`}>College / program for {account.display_name}</label>
                        <select form={`teacher-edit-${account.id}`} id={`teacher-college-${account.id}`} value={teacherDraft.college_id}
                          onChange={event=>setTeacherDraft(current=>current?{...current,college_id:event.target.value}:current)}>
                          <option value="">Not assigned</option>
                          {colleges.data?.filter(college=>college.status==='active').map(college=><option key={college.id} value={college.id}>{college.name}</option>)}
                          {account.college_id&&collegeById.get(account.college_id)?.status==='inactive'&&
                            <option value={account.college_id} disabled>{collegeById.get(account.college_id)?.name} (inactive)</option>}
                        </select>
                      </td></>
                    :<><th scope="row">{account.display_name}</th><td>{account.email}</td>
                      <td>{account.college_id
                    ?`${collegeById.get(account.college_id)?.name??'Unknown college / program'}${collegeById.get(account.college_id)?.status==='inactive'?' (inactive)':''}`
                    :'Not assigned'}</td></>}
                  <td><span className="badge">{account.status}</span></td>
                  <td><div className="actions">
                    {editingTeacherId===account.id&&teacherDraft
                      ?<><form id={`teacher-edit-${account.id}`} onSubmit={event=>{event.preventDefault();void saveTeacher(account)}}/>
                        <button type="submit" form={`teacher-edit-${account.id}`} className="primary icon-button" title="Save" aria-label={`Save ${account.display_name}`}
                          disabled={savingTeacherId===account.id}>{savingTeacherId===account.id?'…':<StudentManagementIcon name="save"/>}</button>
                        <button type="button" className="icon-button" title="Cancel" aria-label={`Cancel editing ${account.display_name}`}
                          disabled={savingTeacherId===account.id} onClick={()=>{setEditingTeacherId(null);setTeacherDraft(null)}}><StudentManagementIcon name="cancel"/></button></>
                      :<><button type="button" className="icon-button" title="Edit teacher" aria-label={`Edit ${account.display_name}`}
                          disabled={savingTeacherId!==null||updatingTeacherId===account.id||sendingTeacherId===account.id}
                          onClick={()=>{setTeacherMessage('');setEditingTeacherId(account.id);setTeacherDraft({
                            display_name:account.display_name,email:account.email,college_id:account.college_id??'',
                          })}}><StudentManagementIcon name="edit"/></button>
                        <button type="button" className="danger icon-button" title="Remove college / program assignment" aria-label={`Remove college / program assignment for ${account.display_name}`}
                          disabled={updatingTeacherId===account.id||sendingTeacherId===account.id||!account.college_id} onClick={()=>void removeTeacherCollege(account)}>
                          <StudentManagementIcon name="delete"/>
                        </button>
                        {account.status!=='invited'&&<button type="button" className="icon-button" title={account.status==='inactive'?'Activate account':'Deactivate account'}
                          aria-label={`${account.status==='inactive'?'Activate':'Deactivate'} ${account.display_name}'s account`}
                          disabled={updatingTeacherId===account.id||sendingTeacherId===account.id} onClick={()=>void changeTeacherStatus(account)}>
                          <StudentManagementIcon name={account.status==='inactive'?'activate':'deactivate'}/>
                        </button>}
                        <button type="button" className="icon-button" title={account.status==='inactive'?'Inactive accounts cannot receive links':account.status==='invited'?'Send invitation':'Send password-reset link'}
                          aria-label={account.status==='inactive'?`No email link available for inactive teacher ${account.display_name}`:`${account.status==='invited'?'Send invitation':'Send password-reset link'} to ${account.display_name}`}
                          disabled={updatingTeacherId===account.id||sendingTeacherId===account.id||account.status==='inactive'} onClick={()=>void sendTeacherLink(account)}>
                          <StudentManagementIcon name="mail"/>
                        </button></>}
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>}
        </>:<>
          <div className="filters faculty-assignment-filters">
            <label>College / program
              <select aria-label="Filter assignment teachers by college or program" value={facultyCollegeFilter} onChange={event=>{setFacultyCollegeFilter(event.target.value);setTeacherFilter('')}}>
                <option value="">All colleges / programs</option>
                {colleges.data?.map(college=><option key={college.id} value={college.id}>{college.name}{college.status==='inactive'?' (inactive)':''}</option>)}
              </select>
            </label>
            <label>Filter offerings by teacher
              <select aria-label="Filter offerings by teacher" value={teacherFilter} onChange={event=>setTeacherFilter(event.target.value)}>
                <option value="">All teachers</option>
                {assignmentTeachers.map(account=><option key={account.id} value={account.id}>{account.display_name}</option>)}
              </select>
            </label>
          </div>
          {facultyOptions.isError&&<p role="alert">Could not load teachers for the selected college/program: {facultyOptions.error.message}</p>}
          {offerings.isPending?<p>Loading…</p>:offerings.error?<p role="alert">{offerings.error.message}</p>:
            !visibleTeacherGroups?.length?<p className="muted">{teacherFilter?'This teacher has no subject assignments in the selected college/program.':facultyCollegeFilter?'No subject assignments match this teacher college/program.':'No subjects are assigned yet.'}</p>:
            <div ref={offeringsTableRef} className="table-wrap" tabIndex={0} role="region" aria-label="Offerings by teacher, scroll horizontally"><table className="offerings-table">
            <caption className="sr-only">Teachers, assigned subjects and sections, enrollment counts, and actions</caption>
            <thead><tr><th scope="col">Teacher</th><th scope="col">Subject</th><th scope="col">Sections</th><th scope="col">Number of enrolled</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            {visibleTeacherGroups?.map(group=><tbody key={group.id}>{group.rows.map((offering,index)=>{
              return <tr key={offering.id}>
              {index===0&&<th scope="rowgroup" rowSpan={group.rows.length}>{group.name}</th>}
              <th scope="row"><strong>{offering.subject.code}</strong> {offering.subject.title}{offering.status==='archived'&&<> <span className="badge">Archived</span></>}</th>
              <td><div className="offering-sections-cell"><div className="offering-section-list">
                {offering.sections.length?offering.sections.map(section=><span className="offering-section-entry" key={section.id}>{section.name}</span>):<span className="muted">No sections</span>}
                {!closed&&offering.status==='active'&&<button type="button" className="offering-add-section" aria-label={`Add section to ${offering.subject.code}`} title="Add section"
                  onClick={()=>setAddingSection(offering)}>+</button>}
              </div></div></td>
              <td><div className="offering-enrollment-list">{offering.sections.length?offering.sections.map(section=><span key={section.id}>{section.enrolled}</span>):<span>—</span>}</div></td>
              <td><div className="actions offering-row-actions">
                <button type="button" className="icon-button" aria-label={`View roster for ${offering.subject.code}`} title="View roster" onClick={()=>setViewingRoster(offering)}>
                  <StudentManagementIcon name="roster"/>
                </button>
                <button type="button" className="icon-button" aria-label={`Take over ${offering.subject.code} assignment`} title="Take over assignment"
                  disabled={closed||facultyTakeoverOptions.isPending||facultyTakeoverOptions.isError||
                    !facultyTakeoverOptions.data?.some(teacher=>teacher.id!==offering.faculty.id)}
                  onClick={()=>setTransferringOffering(offering)}>
                  <StudentManagementIcon name="transfer"/>
                </button>
                {offering.status==='active'
                  ?<button type="button" className="icon-button" aria-label={`Edit assignment for ${offering.subject.code}`} title="Edit assignment" disabled={closed} onClick={()=>setEditing(offering)}>
                    <StudentManagementIcon name="edit"/>
                  </button>
                  :<button type="button" disabled={closed} onClick={async()=>{try{await send('POST',`/offerings/${offering.id}/restore`);refresh();toast(`${offering.subject.code} assignment restored.`)}catch(err){setTeacherMessage(errorText(err))}}}>Restore</button>}
              </div></td></tr>;
            })}</tbody>)}
            </table></div>}
        </>}
      </section>
    }

    {dialog==='section'&&<SectionDialog termId={term.id} yearLevels={programYears} initialYear={visibleYear??programYears[0]??1} initialCollegeId={courseFilter} sections={sections.data??[]} colleges={colleges.data??[]} onClose={()=>setDialog(null)} onDone={(yearLevel,collegeId)=>{setDialog(null);setActiveYear(yearLevel);setCourseFilter(collegeId);setSelectedSectionId('');refresh()}}/>}
    {dialog==='offering'&&<BulkAssignDialog termId={term.id} termSequence={term.sequence} termLabel={`${year?.label??'Academic year'} · ${term.name}`} sections={sections.data??[]} existing={offerings.data??[]}
      onClose={()=>setDialog(null)} onDone={()=>{setDialog(null);refresh()}}/>}
    {editing&&<OfferingDialog sections={sections.data??[]} colleges={colleges.data??[]} subject={subjects.data?.find(subject=>subject.id===editing.subject.id)} offering={editing}
      onClose={()=>setEditing(null)} onAddAnother={()=>setAddingSubjectFacultyId(editing.faculty.id)} onDone={()=>{setEditing(null);refresh()}}/>}
    {!!addingSubjectFacultyId&&<BulkAssignDialog termId={term.id} termSequence={term.sequence} termLabel={`${year?.label??'Academic year'} · ${term.name}`}
      sections={sections.data??[]} existing={offerings.data??[]} initialFacultyId={addingSubjectFacultyId}
      onClose={()=>setAddingSubjectFacultyId('')} onDone={()=>{setAddingSubjectFacultyId('');refresh()}}/>}
    {addingSection&&<AddOfferingSectionsDialog offering={addingSection} termSequence={term.sequence} sections={sections.data??[]} subject={subjects.data?.find(subject=>subject.id===addingSection.subject.id)}
      onClose={()=>setAddingSection(null)} onDone={()=>{setAddingSection(null);refresh()}}/>}
    {transferringOffering&&<TransferOfferingDialog offering={transferringOffering} teachers={facultyTakeoverOptions.data??[]}
      onClose={()=>setTransferringOffering(null)}
      onDone={teacherName=>{setTransferringOffering(null);refresh();toast(`${transferringOffering.subject.code} assignment taken over by ${teacherName}. Existing academic history was preserved.`)}}/>}
    {viewingRoster&&<Dialog title={`${viewingRoster.subject.code} roster`} onClose={()=>setViewingRoster(null)} className="offering-roster-dialog" confirmOnClose={false}>
      <OfferingRoster embedded offeringId={viewingRoster.id}/>
    </Dialog>}
    {leaving&&selectedSection&&<WithdrawStudentDialog sectionName={selectedSection.name} student={leaving}
      onClose={()=>setLeaving(null)} onSubmit={reason=>withdrawStudent(leaving,reason)}/>}
    {withdrawingSelected&&<BulkWithdrawDialog count={selectedStudents.length}
      onClose={()=>setWithdrawingSelected(false)} onSubmit={withdrawSelectedStudents}/>}
    {studentImportOpen&&<StudentImport termId={term.id} onClose={()=>setStudentImportOpen(false)} onDone={refresh}/>}
    {teacherImportOpen&&<TeacherImport colleges={colleges.data?.filter(college=>college.status==='active')??[]} onClose={()=>setTeacherImportOpen(false)} onDone={()=>{
      queryClient.invalidateQueries({queryKey:['faculty-management-accounts']});
      queryClient.invalidateQueries({queryKey:['faculty-list']});
      queryClient.invalidateQueries({queryKey:['faculty-assignment-options']});
    }}/>}
    {teacherInviteOpen&&<TeacherInviteDialog colleges={colleges.data?.filter(college=>college.status==='active')??[]} onClose={()=>setTeacherInviteOpen(false)} onDone={()=>{
      setTeacherInviteOpen(false);
      queryClient.invalidateQueries({queryKey:['faculty-management-accounts']});
      queryClient.invalidateQueries({queryKey:['faculty-list']});
      queryClient.invalidateQueries({queryKey:['faculty-assignment-options']});
      toast('Teacher invitation sent.');
    }}/>}
  </>;
}

function StudentManagementIcon({name}:{name:'mail'|'edit'|'save'|'cancel'|'withdraw'|'roster'|'delete'|'activate'|'deactivate'|'transfer'}){
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name==='mail'?<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>
      :name==='edit'?<><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.5 6 3.5 3.5"/></>
      :name==='save'?<path d="m5 12 4 4L19 6"/>
      :name==='cancel'?<path d="m6 6 12 12M18 6 6 18"/>
      :name==='withdraw'?<><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></>
      :name==='activate'?<><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>
      :name==='deactivate'?<><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></>
      :name==='transfer'?<path d="M7 7h13l-3-3m3 3-3 3M17 17H4l3 3m-3-3 3-3"/>
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

function useDebouncedValue(value:string,ms=300){
  const [debounced,setDebounced]=useState(value);
  useEffect(()=>{const timer=window.setTimeout(()=>setDebounced(value),ms);return()=>window.clearTimeout(timer)},[value,ms]);
  return debounced;
}

function TeacherInviteDialog({colleges,onClose,onDone}:{colleges:College[];onClose:()=>void;onDone:()=>void}){
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [collegeId,setCollegeId]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setBusy(true);setError('');
    const data=new FormData(event.currentTarget);
    try{
      await post('/accounts',{email:data.get('email'),display_name:data.get('display_name'),role:'faculty',college_id:collegeId});
      onDone();
    }catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }
  return <Dialog title="Add teacher" onClose={()=>busy?false:onClose()}>
    <form onSubmit={submit}>
      <p className="muted">The teacher will receive an invitation at their institutional email address to verify the account and choose a password.</p>
      <label>Full name<input name="display_name" required maxLength={150} autoFocus/></label>
      <label>Email<input name="email" type="email" required maxLength={254}/></label>
      <label>College / program<select required value={collegeId} onChange={event=>setCollegeId(event.target.value)}>
        <option value="">Choose a college / program</option>{colleges.map(college=><option key={college.id} value={college.id}>{college.name}</option>)}
      </select></label>
      {!colleges.length&&<p className="warn">Add an active college / program before inviting a teacher.</p>}
      {error&&<p role="alert">{error}</p>}
      <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy||!collegeId}>{busy?'Sending…':'Send invitation'}</button></div>
    </form>
  </Dialog>;
}

function TransferOfferingDialog({offering,teachers,onClose,onDone}:{
  offering:OfferingSummary;teachers:Account[];onClose:()=>void;onDone:(teacherName:string)=>void
}){
  const ask=useConfirm();
  const [facultyId,setFacultyId]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const choices=teachers.filter(teacher=>teacher.id!==offering.faculty.id);
  const selected=choices.find(teacher=>teacher.id===facultyId);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!selected)return;
    if(!await ask({
      title:`Transfer ${offering.subject.code} to ${selected.display_name}?`,
      message:'The existing assignment and its academic history will stay in place. Only the assigned teacher changes; the handover is recorded in the audit history.',
      yes:'Transfer assignment',
    }))return;
    setBusy(true);setError('');
    try{
      await send('PATCH',`/offerings/${offering.id}`,{faculty_id:selected.id});
      onDone(selected.display_name);
    }catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }
  return <Dialog title={`Take over ${offering.subject.code}`} onClose={()=>busy?false:onClose()}>
    <form onSubmit={submit}>
      <p className="muted">{offering.subject.title} · {offering.term}. Existing enrollments, assessment records, and academic history stay attached to this assignment.</p>
      <label>New teacher
        <select required value={facultyId} onChange={event=>setFacultyId(event.target.value)} disabled={busy}>
          <option value="">Choose an active teacher</option>
          {choices.map(teacher=><option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}
        </select>
      </label>
      {!choices.length&&<p className="muted">No other active teachers are available to take over this assignment.</p>}
      {error&&<p role="alert">{error}</p>}
      <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy||!selected}>{busy?'Transferring…':'Transfer assignment'}</button></div>
    </form>
  </Dialog>;
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

function BulkWithdrawDialog({count,onClose,onSubmit}:{count:number;onClose:()=>void;onSubmit:(reason:string)=>Promise<void>}){
  const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');
    try{await onSubmit(reason)}
    catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }
  return <Dialog title={`Withdraw ${count} selected students?`} onClose={()=>busy?false:onClose()}><form onSubmit={submit}>
    <p>The selected students will leave this section. Their enrollment history will be kept.</p>
    <label>Reason (kept in each student's audit history)<textarea value={reason} onChange={event=>setReason(event.target.value)}
      minLength={3} maxLength={1000} required autoFocus placeholder="For example: transferred to another program"/></label>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="submit" className="danger" disabled={busy||reason.trim().length<3}>{busy?'Withdrawing…':`Withdraw ${count} students`}</button></div>
  </form></Dialog>;
}

function OfferingDialog({sections,colleges,subject,offering,onClose,onAddAnother,onDone}:{sections:Section[];colleges:College[];subject:Subject|undefined;offering:OfferingSummary;onClose:()=>void;onAddAnother:()=>void;onDone:()=>void}){
  const ask=useConfirm();
  const toast=useToast();
  const [chosen,setChosen]=useState<string[]>(offering.sections.map(s=>s.id));
  const [error,setError]=useState('');
  const [needsOverride,setNeedsOverride]=useState(false);
  const [busy,setBusy]=useState(false);
  const programId=subject?.college_id??offering.sections.map(section=>sections.find(item=>item.id===section.id)?.college_id).find(Boolean)??null;
  const program=colleges.find(college=>college.id===programId);
  const alreadyAssigned=new Set(offering.sections.map(section=>section.id));
  const availableSections=sections.filter(section=>
    (alreadyAssigned.has(section.id)||!programId||section.college_id===programId)&&
    (subject?.year_level===null||subject?.year_level===undefined||section.year_level===subject.year_level||alreadyAssigned.has(section.id)));
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');
    const f=new FormData(e.currentTarget);
    const override=needsOverride?String(f.get('override_reason')||'').trim()||undefined:undefined;
    try{await send('PATCH',`/offerings/${offering.id}`,{section_ids:chosen,placement_override_reason:override});onDone()}
    catch(err){setNeedsOverride(err instanceof ApiError&&err.code==='placement_mismatch');setError(errorText(err))}
    finally{setBusy(false)}
  }
  async function archive(){
    if(!await ask({title:`Archive ${offering.subject.code} assignment?`,
      message:'This removes the assignment from active teaching, but preserves enrollment and academic history so it can be restored later.',
      yes:'Archive assignment',danger:true}))return;
    setBusy(true);setError('');
    try{
      await send('DELETE',`/offerings/${offering.id}`);
      toast(`${offering.subject.code} assignment archived. Academic history is preserved.`);
      onDone();
    }catch(err){setError(errorText(err))}
    finally{setBusy(false)}
  }
  return <Dialog title="Edit Subject Assignment" onClose={()=>busy?false:onClose()} className="bulk-assignment-dialog"><form onSubmit={submit}>
    <p className="bulk-assignment-intro">Update the sections for this assignment. Faculty member, subject, and academic term are read-only.</p>
    <div className="bulk-assignment-context">
      <label>Academic term<input value={offering.term} readOnly/></label>
      <label>College / Program<input value={program?.code??'Program not available'} readOnly/></label>
    </div>
    <section className="bulk-assignment-faculty">
      <label>Faculty member<select aria-label="Faculty member (read-only)" value={offering.faculty.id} disabled><option value={offering.faculty.id}>{offering.faculty.display_name}</option></select></label>
    </section>
    <section className="bulk-assignment-subjects" aria-labelledby="edit-assignment-subject-title">
      <div className="bulk-assignment-section-heading"><h3 id="edit-assignment-subject-title">Subject and sections</h3><span className="badge">Subject fixed</span></div>
      <article className="bulk-assignment-card">
        <div className="bulk-assignment-card-heading"><div><h3>{offering.subject.code}</h3><p className="muted">{offering.subject.title}</p></div></div>
        <p className="bulk-assignment-label">Sections</p>
        <div className="bulk-assignment-chips" role="group" aria-label={`Sections for ${offering.subject.code}`}>
          {availableSections.map(section=>{
            const selected=chosen.includes(section.id);
            return <label className={`bulk-assignment-chip${selected?' selected':''}`} key={section.id}>
              <input type="checkbox" checked={selected} onChange={event=>setChosen(event.target.checked?[...chosen,section.id]:chosen.filter(id=>id!==section.id))}/>
              <span>{section.name}</span>
            </label>;
          })}
        </div>
        {availableSections.length===0&&<p className="muted">No matching sections are available in this program.</p>}
        <p className="bulk-assignment-count">{chosen.length} section{chosen.length===1?'':'s'} selected</p>
      </article>
    </section>
    <p className="muted">A subject placed in a year and semester only accepts matching sections. Use an enrollment exception for irregular students.</p>
    {error&&<p role="alert">{error}</p>}
    {needsOverride&&<label>Reason for an off-semester placement (kept in the audit history)<textarea name="override_reason" minLength={3} maxLength={1000} required/></label>}
    <div className="actions">
      <button type="button" disabled={busy} onClick={onAddAnother}>Add another subject</button>
      <button type="button" className="danger" disabled={busy} onClick={()=>void archive()}>Archive assignment</button>
      <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="primary" disabled={busy||chosen.length===0}>{busy?'Saving…':'Save changes'}</button>
    </div>
  </form></Dialog>;
}

function AddOfferingSectionsDialog({offering,termSequence,sections,subject,onClose,onDone}:{offering:OfferingSummary;termSequence:number;sections:Section[];subject:Subject|undefined;onClose:()=>void;onDone:()=>void}){
  const toast=useToast();
  const [selected,setSelected]=useState<string[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [overrideRequested,setOverrideRequested]=useState(false);
  const existingIds=new Set(offering.sections.map(section=>section.id));
  const programId=subject?.college_id??offering.sections.map(section=>sections.find(item=>item.id===section.id)?.college_id).find(Boolean)??null;
  const availableSections=sections.filter(section=>
    !existingIds.has(section.id)&&(!programId||section.college_id===programId)&&
    (subject?.year_level===null||subject?.year_level===undefined||section.year_level===subject.year_level));
  const placementMismatch=subject?.year_level!==null&&subject?.year_level!==undefined&&subject.semester!==null&&
    [...existingIds,...selected].some(id=>{
      const section=sections.find(item=>item.id===id);
      return !!section&&(section.year_level!==subject.year_level||termSequence!==subject.semester);
    });
  const requiresReason=placementMismatch||overrideRequested;
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setBusy(true);
    setError('');
    const form=new FormData(event.currentTarget);
    try{
      await send('PATCH',`/offerings/${offering.id}`,{
        section_ids:[...existingIds,...selected],
        placement_override_reason:requiresReason?String(form.get('override_reason')||'').trim()||undefined:undefined,
      });
      toast(`${selected.length} section${selected.length===1?'':'s'} added to ${offering.subject.code}.`);
      onDone();
    }catch(err){
      setOverrideRequested(err instanceof ApiError&&err.code==='placement_mismatch');
      setError(errorText(err));
    }finally{
      setBusy(false);
    }
  }
  return <Dialog title={`Add sections to ${offering.subject.code}`} onClose={()=>busy?false:onClose()} className="bulk-assignment-dialog">
    <form onSubmit={submit}>
      <p className="bulk-assignment-intro">Choose additional sections for this subject. Existing sections and the assigned faculty member will stay unchanged.</p>
      <div className="bulk-assignment-context">
        <label>Faculty member<input value={offering.faculty.display_name} readOnly/></label>
        <label>Academic term<input value={offering.term} readOnly/></label>
      </div>
      <section className="bulk-assignment-subjects" aria-labelledby="add-sections-title">
        <div className="bulk-assignment-section-heading"><h3 id="add-sections-title">Available sections</h3><span className="badge">{selected.length} selected</span></div>
        {availableSections.length===0?<p className="muted">There are no additional matching sections available.</p>:
          <div className="bulk-assignment-chips" role="group" aria-label={`Additional sections for ${offering.subject.code}`}>
            {availableSections.map(section=><label className={`bulk-assignment-chip${selected.includes(section.id)?' selected':''}`} key={section.id}>
              <input type="checkbox" checked={selected.includes(section.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,section.id]:current.filter(id=>id!==section.id))}/>
              <span>{section.name}</span>
            </label>)}
          </div>}
      </section>
      {requiresReason&&<label>Reason for placing this subject outside its prospectus year or semester (kept in audit history)<textarea name="override_reason" minLength={3} maxLength={1000} required/></label>}
      {error&&<p role="alert">{error}</p>}
      <div className="actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy||selected.length===0}>{busy?'Saving…':'Add selected sections'}</button></div>
    </form>
  </Dialog>;
}

/** One teacher, several subjects, each with its own sections, saved together (all or nothing). */
function BulkAssignDialog({termId,termSequence,termLabel,sections,existing,initialFacultyId,onClose,onDone}:{termId:string;termSequence:number;termLabel:string;sections:Section[];existing:OfferingSummary[];initialFacultyId?:string;onClose:()=>void;onDone:()=>void}){
  const toast=useToast();
  const subjects=useQuery({queryKey:['subjects',false],queryFn:()=>api<Subject[]>('/subjects')});
  const faculty=useQuery({queryKey:['faculty-list'],queryFn:()=>api<Account[]>('/accounts?role=faculty&page_size=100')});
  const colleges=useQuery({queryKey:['colleges'],queryFn:()=>api<College[]>('/colleges')});
  const [facultyId,setFacultyId]=useState(initialFacultyId??'');
  const [collegeId,setCollegeId]=useState('');
  const [find,setFind]=useState('');
  const [semesterFilter,setSemesterFilter]=useState<'current'|'all'>('current');
  const [yearLevelFilter,setYearLevelFilter]=useState('all');
  const [subjectChooserOpen,setSubjectChooserOpen]=useState(false);
  const [pick,setPick]=useState<Record<string,string[]>>({});          // subject id -> chosen section ids; present = subject selected
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!initialFacultyId||!faculty.data)return;
    const initialFaculty=faculty.data.find(member=>member.id===initialFacultyId);
    if(initialFaculty?.college_id)setCollegeId(initialFaculty.college_id);
  },[initialFacultyId,faculty.data]);
  const teacher=faculty.data?.find(f=>f.id===facultyId);
  const taken=new Set(existing.filter(o=>o.faculty.id===facultyId).map(o=>o.subject.id));
  const assignedSections=new Map<string,OfferingSummary>();
  existing.forEach(offering=>offering.sections.forEach(section=>
    assignedSections.set(`${offering.subject.id}:${section.id}`,offering)));
  const matchesYear=(sub:Subject,sec:Section)=>sub.year_level===null||sec.year_level===sub.year_level;
  const fits=(sub:Subject,sec:Section)=>sub.year_level===null||sub.semester===null||(sec.year_level===sub.year_level&&termSequence===sub.semester);
  const needle=find.trim().toLowerCase();
  const programSections=sections.filter(section=>section.college_id===collegeId);
  const subjectYearLevels=[...new Set((subjects.data??[])
    .filter(subject=>subject.status==='active'&&(subject.college_id===null||subject.college_id===collegeId))
    .map(subject=>subject.year_level)
    .filter((yearLevel):yearLevel is number=>yearLevel!==null))].sort((a,b)=>a-b);
  const list=(subjects.data??[]).filter(sub=>sub.status==='active'&&(sub.college_id===null||sub.college_id===collegeId)&&(semesterFilter==='all'||sub.semester===termSequence)&&(!needle||`${sub.code} ${sub.title}`.toLowerCase().includes(needle)))
    .sort((a,b)=>Number(pick[b.id]!==undefined)-Number(pick[a.id]!==undefined)||Number(a.semester===termSequence?0:1)-Number(b.semester===termSequence?0:1)||a.code.localeCompare(b.code));
  const availableSubjects=list.filter(subject=>pick[subject.id]===undefined);
  const matchingSubjects=availableSubjects.filter(subject=>yearLevelFilter==='all'||
    (yearLevelFilter==='unplaced'?subject.year_level===null:subject.year_level===Number(yearLevelFilter)));
  const subjectSections=(subject:Subject)=>programSections.filter(section=>matchesYear(subject,section));
  const allSectionsAssigned=(subject:Subject)=>{
    const eligible=subjectSections(subject);
    return eligible.length>0&&eligible.every(section=>assignedSections.has(`${subject.id}:${section.id}`));
  };
  const chosen=Object.keys(pick);
  const subjectOf=(id:string)=>subjects.data?.find(x=>x.id===id);
  const offeringsCount=chosen.reduce((total,id)=>total+pick[id].length,0);
  const needsReason=(id:string)=>{const sub=subjectOf(id);return !!sub&&pick[id].some(sid=>{const sec=programSections.find(x=>x.id===sid);return !!sec&&!fits(sub,sec)})};
  const ready=!!facultyId&&!!collegeId&&chosen.length>0&&chosen.every(id=>
    pick[id].length>0&&pick[id].every(sectionId=>!assignedSections.has(`${id}:${sectionId}`))&&
    (!needsReason(id)||(reasons[id]??'').trim().length>=3));
  function toggleSubject(sub:Subject,on:boolean){
    if(!on){const rest={...pick};delete rest[sub.id];setPick(rest);return}
    setPick({...pick,[sub.id]:programSections.filter(sec=>
      sub.year_level!==null&&matchesYear(sub,sec)&&fits(sub,sec)&&
      !assignedSections.has(`${sub.id}:${sec.id}`)).map(sec=>sec.id)});
  }
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    const items=chosen.map(id=>({subject_id:id,section_ids:pick[id],placement_override_reason:needsReason(id)?(reasons[id]??'').trim():undefined}));
    try{await post(`/terms/${termId}/offerings/bulk`,{faculty_id:facultyId,items});toast(`${items.length} subject${items.length===1?'':'s'} assigned to ${teacher?.display_name}.`);onDone()}
    catch(err){
      setError(errorText(err));
    }finally{setBusy(false)}
  }
  const subjectCard=(id:string)=>{
    const sub=subjectOf(id);
    if(!sub)return null;
    const availableSections=subjectSections(sub);
    return <article className="bulk-assignment-card" key={sub.id}>
      <div className="bulk-assignment-card-heading">
        <div><h3>{sub.code}</h3><p className="muted">{sub.title}</p></div>
        <button type="button" className="icon-button" aria-label={`Remove ${sub.code}`} title={`Remove ${sub.code}`} onClick={()=>toggleSubject(sub,false)}>×</button>
      </div>
      <p className="bulk-assignment-label">Sections</p>
      <div className="bulk-assignment-chips" role="group" aria-label={`Sections for ${sub.code}`}>
        {availableSections.map(section=>{
          const selected=pick[sub.id].includes(section.id);
          const assigned=assignedSections.get(`${sub.id}:${section.id}`);
          return <label className={`bulk-assignment-chip${selected?' selected':''}${assigned?' unavailable':''}`} key={section.id}>
            <input type="checkbox" checked={selected} disabled={!!assigned}
              aria-label={assigned?`${section.name} already assigned to ${assigned.faculty.display_name}`:section.name}
              onChange={event=>setPick({...pick,[sub.id]:event.target.checked?[...pick[sub.id],section.id]:pick[sub.id].filter(id=>id!==section.id)})}/>
            <span>{section.name}{assigned&&<small>{assigned.status==='archived'?'Archived assignment':'Assigned'} to {assigned.faculty.display_name}</small>}</span>
          </label>;
        })}
      </div>
      {availableSections.length===0&&<p className="muted">No sections exist for this subject’s year level in this program.</p>}
      <p className="bulk-assignment-count">{pick[sub.id].length} section{pick[sub.id].length===1?'':'s'} selected</p>
      {needsReason(sub.id)&&<label>Reason for placing {sub.code} outside its prospectus semester (kept in the audit history)<textarea value={reasons[sub.id]??''} onChange={event=>setReasons({...reasons,[sub.id]:event.target.value})} minLength={3} maxLength={1000} required/></label>}
    </article>;
  };
  return <Dialog title="Assign Subjects to Faculty" onClose={onClose} className="bulk-assignment-dialog"><form onSubmit={submit}>
    <p className="bulk-assignment-intro">{initialFacultyId?'Add subject-section offerings for this faculty member.':'Assign one faculty member to multiple subject-section offerings.'}</p>
    <div className="bulk-assignment-context">
      <label>Academic term<input value={termLabel} readOnly/></label>
      <label>College / Program<select required value={collegeId} onChange={event=>{setCollegeId(event.target.value);if(!initialFacultyId)setFacultyId('')}} disabled={chosen.length>0||!!initialFacultyId}>
        <option value="" disabled>{colleges.isPending?'Loading programs…':'Choose a college / program'}</option>
        {colleges.data?.filter(college=>college.status==='active'&&sections.some(section=>section.college_id===college.id)).map(college=><option key={college.id} value={college.id}>{college.code}</option>)}
      </select></label>
    </div>
    {colleges.isError&&<p role="alert">Could not load colleges: {colleges.error.message}</p>}
    {!colleges.isPending&&!colleges.isError&&colleges.data?.filter(college=>college.status==='active'&&sections.some(section=>section.college_id===college.id)).length===0&&<p className="muted">Add an active college / program and create its sections before assigning subjects.</p>}
    <section className="bulk-assignment-faculty">
      <label>Faculty member<select required value={facultyId} disabled={!!initialFacultyId} onChange={event=>setFacultyId(event.target.value)}><option value="" disabled>{faculty.isPending?'Loading faculty…':collegeId?'Choose a faculty member':'Choose a college first'}</option>
        {faculty.data?.filter(member=>member.status!=='inactive'&&member.college_id===collegeId).map(member=><option key={member.id} value={member.id}>{member.display_name}</option>)}</select></label>
      {teacher&&<div className="bulk-assignment-faculty-card"><span className="bulk-assignment-avatar" aria-hidden="true">{teacher.display_name.slice(0,1).toUpperCase()}</span>
        <span><strong>{teacher.display_name}</strong><small>{teacher.email}</small></span><span className="bulk-assignment-selected">Selected</span></div>}
      {faculty.isError&&<p role="alert">Could not load faculty: {faculty.error.message}</p>}
    </section>
    <section className="bulk-assignment-subjects" aria-labelledby="bulk-assignment-subjects-title">
      <div className="bulk-assignment-section-heading"><h3 id="bulk-assignment-subjects-title">Subject and section assignments</h3><span className="badge">{offeringsCount} workload{offeringsCount===1?'':'s'}</span></div>
      <p className="muted">Choose a subject, then select one or more sections where this faculty member will handle it.</p>
      {chosen.map(subjectCard)}
      {!collegeId&&<p className="muted">Choose a college / program to see its available subjects and sections.</p>}
      {sections.length===0&&<p className="muted">Add sections first.</p>}
      {subjects.isError&&<p role="alert">Could not load subjects: {subjects.error.message}</p>}
      {subjectChooserOpen&&<div className="bulk-assignment-subject-chooser">
        <div className="bulk-assignment-filters">
          <label>Show subjects<select aria-label="Filter subjects by semester" value={semesterFilter} onChange={event=>setSemesterFilter(event.target.value as 'current'|'all')}>
            <option value="current">Current semester ({termSequence})</option><option value="all">All semesters</option>
          </select></label>
          <label>Year level<select aria-label="Filter subjects by year level" value={yearLevelFilter} onChange={event=>setYearLevelFilter(event.target.value)}>
            <option value="all">All year levels</option>
            {subjectYearLevels.map(yearLevel=><option key={yearLevel} value={yearLevel}>Year {yearLevel}</option>)}
            <option value="unplaced">Unplaced</option>
          </select></label>
          <label>Filter subjects<input type="search" value={find} onChange={event=>setFind(event.target.value)} placeholder="Code or title"/></label>
        </div>
        {subjects.isPending?<p>Loading subjects…</p>:subjects.isError?<p role="alert">Could not load subjects: {subjects.error.message}</p>:
          availableSubjects.length===0?<p className="muted">No active subjects match this program, semester, and search.</p>:
          matchingSubjects.length===0?<p className="muted">No available subjects match this year level.</p>:
          <ul className="bulk-assignment-subject-list" aria-label="Available subjects">{matchingSubjects.map(subject=>{
            const done=taken.has(subject.id);
            const full=allSectionsAssigned(subject);
            const disabled=done||full||!facultyId;
            return <li key={subject.id}><span><strong>{subject.code}</strong> {subject.title}<small>{subject.year_level?`Year ${subject.year_level}, semester ${subject.semester}`:'Not placed'}</small></span>
              <button type="button" aria-label={full&&!done?`${subject.code} unavailable: all sections are already assigned`:`${done?'Already assigned':'Add'} ${subject.code}`}
                disabled={disabled} onClick={()=>toggleSubject(subject,true)}>
                {done?'Already assigned':full?'All sections assigned':'Add'}
              </button></li>;
          })}</ul>}
      </div>}
      <button type="button" className="bulk-assignment-add" disabled={!collegeId||!facultyId||subjects.isError} onClick={()=>setSubjectChooserOpen(open=>!open)}>
        {subjectChooserOpen?'− Close subject list':'+ Add another subject'}
      </button>
    </section>
    <div className="bulk-assignment-summary">
      <strong>Total selected</strong><strong>{offeringsCount} subject-section assignment{offeringsCount===1?'':'s'}</strong>
    </div>
    <p className="muted">Before saving, LearnSync checks for duplicate assignments, unavailable offerings, and sections already assigned to another faculty member. Subjects with a year-level placement only show sections for that year; an off-semester placement requires a reason. Nothing is saved unless every selected assignment is valid.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={!ready||busy||subjects.isError||faculty.isError||colleges.isError}>{busy?'Assigning…':'Assign all'}</button></div>
  </form></Dialog>;
}
