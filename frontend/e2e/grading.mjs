// Scores page: keyboard grading regression (Enter saves and advances, filter, conflict, double save).
// SELF-PROVISIONING: it creates a school year, an offering and an activity with real submissions, so run it ONLY
// against a disposable database that already has the development accounts (`python -m app.cli seed-demo`),
// e.g. the fresh-install ports. It refuses to run unless GRADING_E2E_DISPOSABLE=1.
import {launch,newPage,sessionFor,axe,shot} from './lib.mjs';
if(process.env.GRADING_E2E_DISPOSABLE!=='1'){console.log('Refusing: set GRADING_E2E_DISPOSABLE=1 to confirm this database is disposable.');process.exit(2)}
const results=[];
function check(label,ok,detail=''){results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)}
const call=(page,method,path,body)=>page.evaluate(async([method,path,body])=>{
  const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
  const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});
  let data=null;try{data=await r.json()}catch{data=null}return {status:r.status,data}},[method,path,body]);

const browser=await launch();
try{
  const A=await sessionFor(browser,'admin@example.com'),F=await sessionFor(browser,'faculty1@example.com');
  const S=[];for(const n of [1,2,3])S.push(await sessionFor(browser,`student${n}@example.com`));
  // ---- provisioning (the calls the pages make)
  const admin=await newPage(browser,{state:A});await admin.goto('/admin');
  const people=(await call(admin,'GET','/accounts?search=example')).data;const id=e=>people.find(p=>p.email===e).id;
  const year=(await call(admin,'POST','/school-years',{label:'2026-2027',start_date:'2026-06-01',end_date:'2027-04-30',terms:[{name:'First Semester',sequence:1,start_date:'2026-06-01',end_date:'2026-12-31'}]})).data;const term=year.terms[0];
  const subject=(await call(admin,'POST','/subjects',{code:'ENT 101',title:'Introduction to Entrepreneurship',units:'3',year_level:1,semester:1})).data;
  const section=(await call(admin,'POST',`/terms/${term.id}/sections`,{name:'1A',year_level:1})).data;
  const O=(await call(admin,'POST',`/terms/${term.id}/offerings`,{subject_id:subject.id,faculty_id:id('faculty1@example.com'),section_ids:[section.id]})).data.id;
  for(const n of [1,2,3])await call(admin,'POST',`/sections/${section.id}/members`,{student_id:id(`student${n}@example.com`)});
  const teach=await newPage(browser,{state:F});await teach.goto('/faculty');
  const uid=()=>crypto.randomUUID();
  const outline={course:{name:'Intro',code:'ENT 101',units:'3'},outcomes:[{id:uid(),text:'x'}],chapters:[{id:uid(),title:'Chapter 1',weeks:'W1',topics:[{id:uid(),title:'T'}]}]};
  const policy={categories:[{key:'activity',label:'Activities',weight:100}],periods:[{key:'midterm',label:'Midterm',share:50},{key:'finals',label:'Finals',share:50}],transmutation:'raw',passing:75,late_attendance_fraction:0.5};
  const d=(await call(teach,'POST',`/teach/offerings/${O}/syllabus/draft`)).data;
  const sv=(await call(teach,'PUT',`/teach/offerings/${O}/syllabus/draft`,{expected_counter:d.counter,outline,grading_policy:policy})).data;
  await call(teach,'POST',`/teach/offerings/${O}/syllabus/draft/publish`,{expected_counter:sv.counter});
  await teach.goto(`/faculty/offerings/${O}/assessments`);await teach.getByRole('button',{name:'New assessment'}).click();
  const dl=teach.locator('dialog');await dl.getByLabel('Type').selectOption('activity');await dl.getByLabel('Title').fill('Business idea pitch');
  await dl.getByRole('button',{name:/Create/}).click();await teach.waitForURL(/edit/);await teach.waitForTimeout(1200);
  await teach.getByLabel('Grading category').selectOption({label:'Activities (100%)'});await teach.getByLabel('Grading period').selectOption({label:'Midterm'});
  await teach.getByLabel('Maximum points').fill('20');await teach.getByLabel('Due').fill(new Date(Date.now()+3*864e5).toISOString().slice(0,16));
  await teach.waitForTimeout(2500);await teach.getByRole('button',{name:'Publish'}).click();await teach.waitForTimeout(2000);
  const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  for(const state of S){const p=await newPage(browser,{state});await p.goto(`/student/offerings/${O}/work`);await p.waitForLoadState('networkidle');
    await p.getByRole('link',{name:/Business idea pitch/}).first().click();await p.waitForLoadState('networkidle');
    await p.locator('input[type=file]').setInputFiles({name:'pitch.pdf',mimeType:'application/pdf',buffer:pdf});
    await p.getByRole('button',{name:'Submit',exact:true}).click();await p.waitForTimeout(1200)}
  await teach.goto('/faculty');await teach.waitForLoadState('networkidle');
  await teach.locator('section:has(h2:text("Activity submissions needing grading")) a').first().click();await teach.waitForLoadState('networkidle');
  const base=`/teach/offerings/${O}/assessments/${teach.url().match(/assessments\/([\w-]+)\/scores/)[1]}`;
  const rows=(await call(teach,'GET',`${base}/scores`)).data;const sid=n=>rows.find(r=>r.student===`Demo student ${n}`).student_id;
  const active=()=>teach.evaluate(()=>document.activeElement?.id||'');
  const puts=[];teach.on('request',r=>{if(r.method()==='PUT'&&r.url().includes('/scores/'))puts.push(r.url().split('/scores/')[1])});

  // ---- A: the refetch is slow; focus must still end on the next student's score box
  await teach.getByLabel('Show ungraded only').check();
  await teach.route('**/scores',async r=>{if(r.request().method()==='GET')await new Promise(x=>setTimeout(x,1500));await r.continue()});
  await teach.getByLabel('Score for Demo student 1').fill('18');await teach.keyboard.press('Enter');
  await teach.waitForTimeout(3000);
  check('A: focus lands on the next student after a slow refetch',(await active())===`s-${sid(2)}`,await active());
  await teach.unroute('**/scores');
  // ---- B: a double Enter sends one save
  puts.length=0;
  await teach.keyboard.type('15');await teach.keyboard.press('Enter');await teach.keyboard.press('Enter');await teach.waitForTimeout(2500);
  check('B: a double Enter sends exactly one save',puts.filter(x=>x.startsWith(sid(2))).length===1,JSON.stringify(puts));
  // ---- E: Enter in the feedback box is a newline, not a save
  const fb=teach.getByLabel('Feedback for Demo student 3');puts.length=0;
  await fb.click();await teach.keyboard.type('a');await teach.keyboard.press('Enter');await teach.keyboard.type('b');
  check('E: Enter in feedback is a newline and saves nothing',(await fb.inputValue())==='a\nb'&&puts.length===0);
  await fb.fill('');
  // ---- accessibility of the populated page
  const violations=await axe(teach);
  check('axe finds no violations on the populated scores page',violations.length===0,JSON.stringify(violations.map(v=>v.id)));
  // ---- D: saving the last visible row empties the filter; focus must not fall to the body
  await teach.getByLabel('Score for Demo student 3').fill('14');await teach.keyboard.press('Enter');await teach.waitForTimeout(2500);
  check('D: after the last visible row, focus moves to the filter',(await active())==='ungraded-only',await active());
  // ---- C: a stale revision keeps the typed value, shows the conflict and does not advance
  await teach.getByLabel('Show ungraded only').uncheck();
  const cur=(await call(teach,'GET',`${base}/scores`)).data.find(r=>r.student_id===sid(1));
  await call(teach,'PUT',`${base}/scores/${sid(1)}`,{score:'1',feedback:'',expected_revision:cur.score_revision});   // someone else saves first
  const box=teach.getByLabel('Score for Demo student 1');await box.fill('19');puts.length=0;await box.press('Enter');await teach.waitForTimeout(1500);
  check('C: conflict keeps the typed score',(await box.inputValue())==='19');
  check('C: conflict is shown to the teacher',await teach.locator(`#err-${sid(1)}`).count()===1,await teach.locator(`#err-${sid(1)}`).innerText().catch(()=>''));
  check('C: focus stays on the conflicting box',(await active())===`s-${sid(1)}`,await active());
  await shot(teach,'grading-regression',false);
}catch(e){console.log('SCRIPT ERROR:',e.message);results.push(false)}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean)?0:1);
