// Gradebook edit mode, all-or-nothing saves, the review-then-publish dialog, locked Course grade and Return.
// SELF-PROVISIONING: creates its own term, subject, exams and enrolled students, so run it ONLY against a disposable
// database with the development accounts (`python -m app.cli seed-demo`). Refuses unless GRADES_E2E_DISPOSABLE=1.
import {launch,newPage,sessionFor,axe,autoConfirm} from './lib.mjs';
if(process.env.GRADES_E2E_DISPOSABLE!=='1'){console.log('Refusing: set GRADES_E2E_DISPOSABLE=1 to confirm this database is disposable.');process.exit(2)}
const results=[];
function check(label,ok,detail=''){results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)}
const call=(page,method,path,body)=>page.evaluate(async([method,path,body])=>{
  const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
  const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});
  let data=null;try{data=await r.json()}catch{data=null}return {status:r.status,data}},[method,path,body]);

const browser=await launch();
try{
  const A=await sessionFor(browser,'admin@example.com'),F=await sessionFor(browser,'faculty1@example.com'),S1=await sessionFor(browser,'student1@example.com');
  const admin=await newPage(browser,{state:A});await admin.goto('/admin');
  const people=(await call(admin,'GET','/accounts?search=example')).data;const id=e=>people.find(p=>p.email===e).id;
  const year=(await call(admin,'POST','/school-years',{label:'2026-2027',start_date:'2026-06-01',end_date:'2027-04-30',terms:[{name:'First Semester',sequence:1,start_date:'2026-06-01',end_date:'2026-12-31'}]})).data;const term=year.terms[0];
  const subject=(await call(admin,'POST','/subjects',{code:'ENT 101',title:'Introduction to Entrepreneurship',units:'3',year_level:1,semester:1})).data;
  const section=(await call(admin,'POST',`/terms/${term.id}/sections`,{name:'1A',year_level:1})).data;
  const O=(await call(admin,'POST',`/terms/${term.id}/offerings`,{subject_id:subject.id,faculty_id:id('faculty1@example.com'),section_ids:[section.id]})).data.id;
  const students=['student1@example.com','student2@example.com','student3@example.com'];
  for(const e of students)await call(admin,'POST',`/sections/${section.id}/members`,{student_id:id(e)});
  const teach=await newPage(browser,{state:F});await teach.goto('/faculty');
  const uid=()=>crypto.randomUUID();
  const outline={course:{name:'Intro',code:'ENT 101',units:'3'},outcomes:[{id:uid(),text:'x'}],chapters:[{id:uid(),title:'Chapter 1',weeks:'W1',topics:[{id:uid(),title:'T'}]}]};
  const policy={categories:[{key:'quiz',label:'Quizzes',weight:40},{key:'exam',label:'Examinations',weight:60}],periods:[{key:'midterm',label:'Midterm',share:50},{key:'finals',label:'Finals',share:50}],transmutation:'raw',passing:75,late_attendance_fraction:0.5};
  const d=(await call(teach,'POST',`/teach/offerings/${O}/syllabus/draft`)).data;
  const sv=(await call(teach,'PUT',`/teach/offerings/${O}/syllabus/draft`,{expected_counter:d.counter,outline,grading_policy:policy})).data;
  await call(teach,'POST',`/teach/offerings/${O}/syllabus/draft/publish`,{expected_counter:sv.counter});
  const publishAssessment=async(kind,title,category,points)=>{
    const made=(await call(teach,'POST',`/teach/offerings/${O}/assessments`,{kind,title,section_ids:[]})).data;
    const draft=(await call(teach,'GET',`/teach/offerings/${O}/assessments/${made.id}`)).data.draft;
    const saved=(await call(teach,'PUT',`/teach/offerings/${O}/assessments/${made.id}/draft`,{expected_counter:draft.counter,title,instructions:'',category_key:category,period:'midterm',max_points:points,include_in_grade:true,max_attempts:1,score_rule:'highest',allow_late:false,questions:[]})).data;
    await call(teach,'POST',`/teach/offerings/${O}/assessments/${made.id}/draft/publish`,{expected_counter:saved.counter});return made.id};
  const exam=await publishAssessment('exam','Midterm exam','exam','50');
  await publishAssessment('offline_quiz','Paper quiz','quiz','20');
  const grades=async()=>(await call(teach,'GET',`/teach/offerings/${O}/gradebook`)).data;

  const page=await newPage(browser,{state:F});autoConfirm(page);
  await page.goto(`/faculty/offerings/${O}/gradebook`);await page.getByRole('heading',{name:'Gradebook'}).waitFor();await page.waitForLoadState('networkidle');

  // ---- A: read-first
  check('the gradebook opens read-first: no score inputs',await page.locator('input.score-input').count()===0);
  const bodyControls=await page.evaluate(()=>[...document.querySelectorAll('main a[href],main button,main input,main select,main textarea,main summary')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('nav.tabs')}).length);
  check(`the page body has ${bodyControls} controls in read mode (target 25 or fewer)`,bodyControls<=25,String(bodyControls));
  check('axe finds no violations in read mode',(await axe(page)).length===0);

  // ---- B: edit six cells, one Save
  await page.getByRole('button',{name:'Edit scores'}).click();
  await page.locator('input.score-input').first().waitFor();
  const inputs=page.locator('input.score-input');const n=await inputs.count();
  check('Edit scores turns every scoreable cell into an input',n===6,String(n));
  check('axe finds no violations in edit mode',(await axe(page)).length===0);
  const exams=['44','38.5','50'],papers=['18','15','20'];let e=0,pq=0;   // the paper quiz is out of 20, the exam out of 50
  for(let i=0;i<n;i++){const label=await inputs.nth(i).getAttribute('aria-label');await inputs.nth(i).fill(label.startsWith('Paper quiz')?papers[pq++]:exams[e++])}
  await page.getByRole('button',{name:'Save 6 changed scores'}).click();
  await page.getByText('Saved 6 scores.').first().waitFor();
  const book=await grades();
  const saved=book.rows.flatMap(r=>Object.values(r.cells)).map(c=>Number(c.score)).sort((a,b)=>a-b);
  check('all six scores were saved by one Save',JSON.stringify(saved)===JSON.stringify([15,18,20,38.5,44,50]),JSON.stringify(saved));
  check('edit mode closed and the cells show text again',await page.locator('input.score-input').count()===0);

  // ---- C: a conflict saves nothing and names the cell
  await page.getByRole('button',{name:'Edit scores'}).click();await page.locator('input.score-input').first().waitFor();
  const first=page.locator('input.score-input').nth(0),second=page.locator('input.score-input').nth(1);
  const firstLabel=await first.getAttribute('aria-label');
  await first.fill('10');await second.fill('11');
  const rowA=book.rows[0];const colFirst=Object.keys(rowA.cells)[0];
  await call(teach,'PUT',`/teach/offerings/${O}/assessments/${colFirst}/scores/${rowA.student_id}`,{score:'49',feedback:'',expected_revision:rowA.cells[colFirst].revision}); // someone else saves first
  await page.getByRole('button',{name:'Save 2 changed scores'}).click();
  await page.getByText(/nothing was saved/).first().waitFor();
  check('the conflicting cell is marked and the typed values are kept',await page.locator('input.score-input[aria-invalid="true"]').count()===1&&(await first.inputValue())==='10'&&(await second.inputValue())==='11');
  const after=await grades();
  check('the other, valid edit was NOT saved either',Number(Object.values(after.rows[0].cells).map(c=>c.score)[1])!==11&&(await call(teach,'GET',`/teach/offerings/${O}/gradebook`)).status===200);
  check(`${firstLabel?.split(',')[0]} still has the other teacher's value`,Number(after.rows[0].cells[colFirst].score)===49);
  await page.getByRole('button',{name:'Cancel'}).click();
  check('Cancel leaves edit mode',await page.locator('input.score-input').count()===0);

  // ---- D: publication strip, review dialog, Course locked until both periods are out
  await page.reload();await page.getByRole('heading',{name:'Gradebook'}).waitFor();
  check('the strip names the next period and what is ready',(await page.locator('#pub-h').locator('..').innerText()).includes('Midterm')&&/ready to publish/.test(await page.locator('#pub-h').locator('..').innerText()));
  await page.locator('details.more summary',{hasText:'All periods'}).click();
  check('Publish Course is disabled until Midterm and Finals are published',await page.getByRole('button',{name:/^Publish Course/}).isDisabled());
  await page.getByRole('button',{name:/^Publish Midterm/}).click();
  await page.locator('dialog').getByText(/will be published or updated/).waitFor();
  check('the review dialog shows the counts before anything is published',(await page.locator('dialog').innerText()).includes('immediately'));
  const noGrade=await call(teach,'GET',`/teach/offerings/${O}/gradebook`);
  check('nothing is published while the dialog is only reviewing',Object.values(noGrade.data.rows[0].published).length===0);
  await page.locator('dialog').getByRole('button',{name:/^Publish \d+ grade/}).click();
  await page.locator('dialog').getByText(/published ·/).waitFor();
  await page.locator('dialog').getByRole('button',{name:'Done'}).click();
  const student=await newPage(browser,{state:S1});await student.goto('/student');
  const mine=(await call(student,'GET',`/learn/offerings/${O}/results`)).data;
  check('the student now sees a published Midterm grade',mine.grades.length===1&&mine.grades[0].period==='midterm');
  check('Course is still locked (Finals not published)',await (async()=>{await page.reload();await page.getByRole('heading',{name:'Gradebook'}).waitFor();await page.locator('details.more summary',{hasText:'All periods'}).click();return page.getByRole('button',{name:/^Publish Course/}).isDisabled()})());

  // ---- E: Return graded results
  await page.goto(`/faculty/offerings/${O}/assessments/${exam}/scores`);await page.getByRole('heading',{name:'Midterm exam'}).waitFor();
  const returnButton=page.getByRole('button',{name:/^Return \d+ graded result/});
  await returnButton.waitFor();
  check('the scores page offers "Return N graded results"',await returnButton.count()===1,await returnButton.innerText().catch(()=>''));
  const before=(await call(student,'GET',`/learn/offerings/${O}/results`)).data.results.length;
  await returnButton.click();
  await page.getByText(/Returned \d+ result/).first().waitFor();
  check('the button then says all graded results are returned',await page.getByRole('button',{name:'All graded results returned'}).isDisabled());
  check('the student now sees the returned result',(await call(student,'GET',`/learn/offerings/${O}/results`)).data.results.length===before+1);
}catch(e){console.log('SCRIPT ERROR:',e.message);results.push(false)}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean)?0:1);
