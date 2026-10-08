// Attendance grid: class days as columns, one-click and keyboard marking, saves per change, Retry, One day view.
// SELF-PROVISIONING: creates its own term, subject, section and enrolled students, so run it ONLY against a
// disposable database with the development accounts (`python -m app.cli seed-demo`). Refuses unless ATTENDANCE_E2E_DISPOSABLE=1.
import {launch,newPage,sessionFor,axe} from './lib.mjs';
if(process.env.ATTENDANCE_E2E_DISPOSABLE!=='1'){console.log('Refusing: set ATTENDANCE_E2E_DISPOSABLE=1 to confirm this database is disposable.');process.exit(2)}
const results=[];
function check(label,ok,detail=''){results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)}
const call=(page,method,path,body)=>page.evaluate(async([method,path,body])=>{
  const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
  const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});
  let data=null;try{data=await r.json()}catch{data=null}return {status:r.status,data}},[method,path,body]);

const browser=await launch();
try{
  const A=await sessionFor(browser,'admin@example.com'),F=await sessionFor(browser,'faculty1@example.com');
  const admin=await newPage(browser,{state:A});await admin.goto('/admin');
  const people=(await call(admin,'GET','/accounts?search=example')).data;const id=e=>people.find(p=>p.email===e).id;
  const year=(await call(admin,'POST','/school-years',{label:'2026-2027',start_date:'2026-06-01',end_date:'2027-04-30',terms:[{name:'First Semester',sequence:1,start_date:'2026-06-01',end_date:'2027-03-31'}]})).data;const term=year.terms[0];
  const subject=(await call(admin,'POST','/subjects',{code:'ENT 101',title:'Introduction to Entrepreneurship',units:'3',year_level:1,semester:1})).data;
  const section=(await call(admin,'POST',`/terms/${term.id}/sections`,{name:'1A',year_level:1})).data;
  const O=(await call(admin,'POST',`/terms/${term.id}/offerings`,{subject_id:subject.id,faculty_id:id('faculty1@example.com'),section_ids:[section.id]})).data.id;
  const emails=['student1@example.com','student2@example.com','student3@example.com'];
  for(const e of emails)await call(admin,'POST',`/sections/${section.id}/members`,{student_id:id(e)});
  const teach=await newPage(browser,{state:F});await teach.goto('/faculty');
  await call(teach,'PUT',`/teach/offerings/${O}/schedule`,{meeting_days:21});            // Monday, Wednesday, Friday
  const sessions=async()=>(await call(teach,'GET',`/teach/offerings/${O}/attendance?section_id=${section.id}`)).data;
  const roster=(await sessions()).roster;const rid=n=>roster[n].student_id;

  const page=await newPage(browser,{state:F});
  await page.goto(`/faculty/offerings/${O}/attendance`);await page.waitForLoadState('networkidle');
  check('desktop opens in grid mode',await page.getByRole('heading',{name:/^Week of/}).count()===1&&await page.locator('table.att-grid').count()===1);
  const cols=await page.locator('table.att-grid thead th[scope=col]').count();
  check('every day of the week is a column (7 days plus the student column), not just class days',cols===8,String(cols));
  check('class days (Mon, Wed, Fri) are plain and the other four say "no class"',await page.locator('table.att-grid thead .att-head',{hasText:'no class'}).count()===4);
  check('only one grid cell is in the tab order (roving focus)',await page.locator('table.att-grid tbody button[tabindex="0"]').count()===1);
  check('axe finds no violations on the grid',(await axe(page)).length===0);
  // the student column stays in view while the dates scroll sideways (a month is wider than the screen)
  await page.getByRole('button',{name:'Month',exact:true}).click();
  await page.waitForFunction(()=>{const w=document.querySelector('.table-wrap');return w&&w.scrollWidth>w.clientWidth});
  await page.evaluate(()=>{document.querySelector('.table-wrap').scrollLeft=600});
  const pinned=await page.evaluate(()=>{const w=document.querySelector('.table-wrap');const r=document.querySelector('table.att-grid tbody th.sticky').getBoundingClientRect();return {scrolled:w.scrollLeft,offset:Math.round(r.left-w.getBoundingClientRect().left)}});
  check('the student column stays pinned while the dates scroll sideways',pinned.scrolled>=500&&pinned.offset===0,JSON.stringify(pinned));
  await page.getByRole('button',{name:'Week',exact:true}).click();

  // ---- click cycles a status and saves by itself
  const cell=(r,c)=>page.locator(`table.att-grid button[data-r="${r}"][data-c="${c}"]`);
  await cell(0,0).click();
  check('one click marks Present',(await cell(0,0).innerText())==='P');
  await page.getByText('All changes saved.').waitFor();
  let s=await sessions();
  check('the change was saved on its own (no Save button)',s.sessions.length===1&&Object.values(s.sessions[0].marks).join()==='present'&&await page.getByRole('button',{name:/^Save attendance/}).count()===0);

  // ---- keyboard: letters mark and move down, Delete clears
  await cell(1,0).focus();
  await page.keyboard.press('a');await page.keyboard.press('l');
  check('P/L/A/E keys mark and move to the next student',(await cell(1,0).innerText())==='A'&&(await cell(2,0).innerText())==='L'&&await page.evaluate(()=>document.activeElement?.getAttribute('data-r')==='2'));
  await cell(0,0).focus();await page.keyboard.press('Delete');
  check('Delete clears a mark',(await cell(0,0).innerText())==='·');
  await page.getByText('All changes saved.').waitFor();
  await page.keyboard.press('ArrowRight');
  check('Delete moved focus down, and ArrowRight moves one column across',await page.evaluate(()=>document.activeElement?.getAttribute('data-r')==='1'&&document.activeElement?.getAttribute('data-c')==='1'),
    await page.evaluate(()=>`r=${document.activeElement?.getAttribute('data-r')} c=${document.activeElement?.getAttribute('data-c')}`));
  s=await sessions();
  const day0=s.sessions[0].marks;
  check('the server holds exactly the keyboard result (A, L; the cleared one is gone)',day0[rid(1)]==='absent'&&day0[rid(2)]==='late'&&day0[rid(0)]===undefined,JSON.stringify(Object.values(day0)));

  // ---- Mark rest present on the second column
  await page.getByRole('button',{name:'Mark rest present'}).nth(2).click();                       // the Wednesday column
  await page.getByText('All changes saved.').waitFor();
  s=await sessions();
  check('Mark rest present marks everyone not yet marked on that date',s.sessions.length===2&&Object.keys(s.sessions[0].marks).length===3);

  // ---- a period per date, locked once recorded
  const friday=page.locator('table.att-grid thead th[scope=col]').nth(5);                        // th 0 is the student column
  await friday.getByRole('combobox').selectOption('finals');
  await cell(0,4).click();await page.getByText('All changes saved.').waitFor();
  s=await sessions();
  check('a new date takes the period chosen in its header',s.sessions.some(x=>x.period==='finals')&&await friday.getByRole('combobox').count()===0);
  // ---- a day that is not a class day can still be marked (a make-up class)
  await cell(0,6).click();await page.getByText('All changes saved.').waitFor();
  s=await sessions();
  check('a non-class day (Sunday) can be marked and is saved like any other',s.sessions.length===4&&(await cell(0,6).innerText())==='P');

  // ---- a failed save is flagged with Retry and keeps the mark
  await page.route('**/attendance',r=>r.request().method()==='PUT'?r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'boom',message:'The server could not save this.',field_errors:{}}})}):r.continue());
  await cell(2,1).click();
  await page.getByRole('alert').filter({hasText:'could not save'}).waitFor({timeout:8000});
  check('a failed save shows the reason with Retry and outlines the cell',await page.getByRole('button',{name:'Retry'}).count()===1&&await page.locator('.att-cell.err').count()===1);
  await page.unroute('**/attendance');
  await page.getByRole('button',{name:'Retry'}).click();
  await page.getByText('All changes saved.').waitFor({timeout:8000});
  check('Retry saves the kept change',await page.locator('.att-cell.err').count()===0);

  // ---- class days and an extra date
  await page.locator('details.more summary',{hasText:'Class days'}).click();
  await page.getByRole('checkbox',{name:'Tue',exact:true}).check();
  await page.getByRole('button',{name:'Save class days'}).click();
  await page.getByText('Class days saved.').waitFor();
  check('adding a class day keeps every column and takes one off the "no class" list',await page.locator('table.att-grid thead th[scope=col]').count()===8&&await page.locator('table.att-grid thead .att-head',{hasText:'no class'}).count()===2);
  check('the new class days are stored on the subject',(await call(teach,'GET',`/offerings/${O}`)).data.meeting_days===23);

  // ---- One day view keeps the quick roll call
  await page.getByRole('button',{name:'One day',exact:true}).click();
  await page.getByRole('heading',{name:/^Mark attendance for/}).waitFor();
  check('One day is the alternative view with the original register',await page.getByRole('button',{name:'Save attendance'}).count()===1);
  await page.getByRole('button',{name:'Grid',exact:true}).click();
  await page.locator('table.att-grid').waitFor();
  check('and the grid comes back',await page.locator('table.att-grid').count()===1);

  // ---- export: a real file downloads from the page
  await page.locator('details.more summary',{hasText:'Export'}).first().click();
  await page.getByRole('radio',{name:'All recorded dates'}).check();
  const [xlsx]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download Excel'}).click()]);
  const [pdf]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download PDF'}).click()]);
  await page.getByRole('radio',{name:'Custom range'}).check();
  await page.getByRole('textbox',{name:'To'}).fill('2000-01-01');
  check('an end date before the start disables the downloads',await page.getByRole('button',{name:'Download Excel'}).isDisabled()&&await page.getByRole('alert').filter({hasText:'not before'}).count()===1);
  const yr=new Date().getFullYear();await page.getByRole('textbox',{name:'From'}).fill(`${yr-1}-01-01`);await page.getByRole('textbox',{name:'To'}).fill(`${yr+1}-12-31`);
  const [ranged]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download Excel'}).click()]);
  check('a custom range downloads',ranged.suggestedFilename().endsWith('.xlsx'),ranged.suggestedFilename());
  check('Excel and PDF attendance files download',/^attendance-ENT-101-1A.*\.xlsx$/.test(xlsx.suggestedFilename())&&pdf.suggestedFilename().endsWith('.pdf'),`${xlsx.suggestedFilename()}, ${pdf.suggestedFilename()}`);

  // ---- phones start with one day
  const phone=await newPage(browser,{width:375,height:812,state:F});
  await phone.goto(`/faculty/offerings/${O}/attendance`);await phone.waitForLoadState('networkidle');
  check('a phone opens in the One day view',await phone.getByRole('heading',{name:/^Mark attendance for/}).count()===1&&await phone.locator('table.att-grid').count()===0);
}catch(e){console.log('SCRIPT ERROR:',e.message);results.push(false)}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean)?0:1);
