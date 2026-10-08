// Guided subject setup: an empty subject becomes a complete-looking, hidden-draft structure in a few inputs.
// SELF-PROVISIONING: creates a school year, two subjects and offerings, so run it ONLY against a disposable
// database that has the development accounts (`python -m app.cli seed-demo`). Refuses unless SETUP_E2E_DISPOSABLE=1.
import {launch,newPage,sessionFor,axe,shot} from './lib.mjs';
if(process.env.SETUP_E2E_DISPOSABLE!=='1'){console.log('Refusing: set SETUP_E2E_DISPOSABLE=1 to confirm this database is disposable.');process.exit(2)}
const results=[];
function check(label,ok,detail=''){results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)}
let inputs=0;                                   // every click, check, fill and file choice the teacher makes
const act=async(fn)=>{inputs++;return fn()};
const call=(page,method,path,body)=>page.evaluate(async([method,path,body])=>{
  const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
  const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});
  let data=null;try{data=await r.json()}catch{data=null}return {status:r.status,data}},[method,path,body]);

const browser=await launch();
try{
  const A=await sessionFor(browser,'admin@example.com'),F=await sessionFor(browser,'faculty1@example.com'),S=await sessionFor(browser,'student1@example.com');
  const admin=await newPage(browser,{state:A});await admin.goto('/admin');
  const people=(await call(admin,'GET','/accounts?search=example')).data;const id=e=>people.find(p=>p.email===e).id;
  const year=(await call(admin,'POST','/school-years',{label:'2026-2027',start_date:'2026-06-01',end_date:'2027-04-30',terms:[{name:'First Semester',sequence:1,start_date:'2026-06-01',end_date:'2026-12-31'}]})).data;const term=year.terms[0];
  const section=(await call(admin,'POST',`/terms/${term.id}/sections`,{name:'1A',year_level:1})).data;
  const offeringFor=async(code,title)=>{
    const subject=(await call(admin,'POST','/subjects',{code,title,units:'3',year_level:1,semester:1})).data;
    const o=(await call(admin,'POST',`/terms/${term.id}/offerings`,{subject_id:subject.id,faculty_id:id('faculty1@example.com'),section_ids:[section.id]})).data.id;return o};
  const first=await offeringFor('ENT 101','Introduction to Entrepreneurship'),second=await offeringFor('ENT 102','Business Planning');
  await call(admin,'POST',`/sections/${section.id}/members`,{student_id:id('student1@example.com')});

  // ---- A: the wizard on an empty subject
  const page=await newPage(browser,{state:F});
  await page.goto(`/faculty/offerings/${first}`);await page.waitForLoadState('networkidle');
  check('an unset subject shows the "set up this subject" banner',await page.getByText('This subject is not set up yet.').count()===1);
  await act(()=>page.getByRole('link',{name:'Set up this subject'}).click());
  await page.waitForURL(/\/setup$/);
  check('the subject tabs are hidden during setup',await page.locator('nav.tabs').count()===0);
  await act(()=>page.getByRole('button',{name:'Start',exact:true}).click());
  await page.getByRole('heading',{name:/Step 1 of 5/}).or(page.getByText('Step 1 of 5')).first().waitFor();
  await act(()=>page.getByRole('button',{name:'Use the starter outline'}).click());
  await act(()=>page.getByRole('button',{name:'Next'}).click());
  await act(()=>page.getByRole('button',{name:'Use this suggestion'}).click());
  check('Next is blocked until the weights are confirmed',await page.getByRole('button',{name:'Next'}).isDisabled());
  await act(()=>page.getByRole('checkbox',{name:/confirm them for this subject/}).check());
  await act(()=>page.getByRole('button',{name:'Next'}).click());
  await act(()=>page.getByRole('button',{name:/^Create 8 drafts/}).click());
  await page.getByText('8 drafts created.').waitFor();
  await act(()=>page.getByRole('button',{name:'Next'}).click());
  for(const d of ['Mon','Wed','Fri'])await act(()=>page.getByRole('checkbox',{name:d,exact:true}).check());
  await act(()=>page.getByRole('button',{name:'Next'}).click());
  await page.getByText('Step 5 of 5').waitFor();
  check('the review lists the outline, grading and class days',(await page.locator('main').innerText()).includes('Attendance 10%')&&(await page.locator('main').innerText()).includes('Mon, Wed, Fri'));
  check('axe finds no violations on the review step',(await axe(page)).length===0);
  await shot(page,'setup-review',false);
  await act(()=>page.getByRole('button',{name:'Publish and finish'}).click());
  await page.getByRole('heading',{name:'Your subject is set up'}).waitFor();
  check(`an empty subject is complete-looking after ${inputs} inputs (target 25 or fewer)`,inputs<=25,String(inputs));
  const syllabus=(await call(page,'GET',`/teach/offerings/${first}/syllabus`)).data;
  check('the syllabus is published with the confirmed policy',!!syllabus.published&&syllabus.published.grading_policy.categories.length===4);
  const planned=(await call(page,'GET',`/teach/offerings/${first}/assessments`)).data;
  check('8 hidden drafts were planned with their category and period',planned.length===8&&planned.every(a=>a.published===null&&a.draft.category_key&&a.draft.period),String(planned.length));
  check('the class days were saved (Mon, Wed, Fri)',(await call(page,'GET',`/offerings/${first}`)).data.meeting_days===21);
  const student=await newPage(browser,{state:S});await student.goto('/student');await student.waitForLoadState('networkidle');
  const todo=(await call(student,'GET','/dashboard/student/todo')).data;
  check('students see none of the planned drafts',todo.todo.length+todo.awaiting_feedback.length+todo.another_attempt.length===0);
  await page.goto(`/faculty/offerings/${first}`);await page.waitForLoadState('networkidle');
  check('the banner is gone once the syllabus is published',await page.getByText('This subject is not set up yet.').count()===0);

  // ---- B: copy a previous subject into another empty one
  const copyPage=await newPage(browser,{state:F});
  await copyPage.goto(`/faculty/offerings/${second}/setup`);await copyPage.waitForLoadState('networkidle');
  await copyPage.getByLabel('Subject').selectOption({index:1});
  await copyPage.getByRole('button',{name:'Copy into this subject'}).click();
  await copyPage.getByText('Step 1 of 5').waitFor();
  const copied=(await call(copyPage,'GET',`/teach/offerings/${second}/assessments`)).data;
  check('copying brought the 8 assessments over as drafts',copied.length===8&&copied.every(a=>a.published===null));
  const copiedSyllabus=(await call(copyPage,'GET',`/teach/offerings/${second}/syllabus`)).data;
  check('copying brought the outline and policy over as a draft',!!copiedSyllabus.draft&&copiedSyllabus.draft.outline.chapters.length===6&&copiedSyllabus.published===null);
  // a subject with content cannot be copied into again
  check('copying into a non-empty subject is refused',(await call(copyPage,'POST',`/teach/offerings/${second}/copy-from/${first}`)).status===409);
}catch(e){console.log('SCRIPT ERROR:',e.message);results.push(false)}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean)?0:1);
