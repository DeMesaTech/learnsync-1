// Admin term workspace: sections as a table, the section students page (pages, search, status filter, selection across
// pages, withdraw with a reason) and bulk assignment of several subjects to one teacher.
// SELF-PROVISIONING: creates its own school year, section and students, so run it ONLY against a disposable database with the
// development accounts (`python -m app.cli seed-demo`). Refuses unless ADMIN_LISTS_E2E_DISPOSABLE=1.
import {launch,newPage,sessionFor,axe} from './lib.mjs';
if(process.env.ADMIN_LISTS_E2E_DISPOSABLE!=='1'){console.log('Refusing: set ADMIN_LISTS_E2E_DISPOSABLE=1 to confirm this database is disposable.');process.exit(2)}
const results=[];
function check(label,ok,detail=''){results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)}
const call=(page,method,path,body)=>page.evaluate(async([method,path,body])=>{
  const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
  const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});
  let data=null;try{data=await r.json()}catch{data=null}return {status:r.status,data}},[method,path,body]);

const browser=await launch();
try{
  const A=await sessionFor(browser,'admin@example.com');
  const p=await newPage(browser,{state:A,width:1280,height:1000});await p.goto('/admin');await p.waitForLoadState('networkidle');
  const year=(await call(p,'POST','/school-years',{label:'2026-2027',start_date:'2026-06-01',end_date:'2027-04-30',terms:[{name:'First Semester',sequence:1,start_date:'2026-06-01',end_date:'2027-03-31'}]})).data;
  const term=year.terms[0];
  await call(p,'POST',`/terms/${term.id}/sections`,{name:'1A',year_level:1});
  for(let i=1;i<=27;i++)await call(p,'POST','/accounts',{email:`list${i}@example.com`,display_name:`List Student ${String(i).padStart(2,'0')}`,role:'student',student_number:`L-${i}`});
  const codes=['LST 101','LST 102','LST 201'];
  for(const [i,code] of codes.entries())await call(p,'POST','/subjects',{code,title:`List ${code}`,units:'3',year_level:i===2?2:1,semester:1});

  // ---- sections as a table, the page for their students
  await p.goto(`/admin/terms/${term.id}`);await p.waitForLoadState('networkidle');
  check('sections are a table, not cards',await p.locator('table:has(caption:text("Sections of this term")) tbody tr').count()===1&&await p.locator('.cards .subpanel').count()===0);
  await p.locator('table:has(caption:text("Sections of this term")) a',{hasText:'Manage students'}).click();
  await p.waitForURL(/\/sections\/.+\/students$/);await p.getByRole('heading',{name:'1A: students'}).waitFor();
  check('Manage students opens its own page with a way back to the term',await p.getByRole('link',{name:/First Semester/}).count()===1);
  await p.getByRole('button',{name:'Add students'}).click();await p.locator('tbody tr').first().waitFor();
  check('Add students lists the people who can be added, 25 to a page',await p.locator('tbody tr').count()===25&&(await p.locator('nav.pager').innerText()).includes('of 30'));
  await p.getByLabel('Rows').selectOption('10');await p.waitForTimeout(500);
  check('the page size can be changed',await p.locator('tbody tr').count()===10);
  await p.getByLabel('Select every student on this page').check();
  await p.getByRole('button',{name:/Next/}).click();await p.waitForTimeout(500);
  await p.getByLabel('Select every student on this page').check();
  check('a selection carries across pages',(await p.locator('.list-tools .primary').innerText())==='Add 20 selected');
  await p.getByLabel('Search',{exact:true}).fill('Student 2');await p.waitForTimeout(700);
  const hits=await p.locator('tbody tr').count();
  check('search narrows the list on the server',hits>0&&hits<10,String(hits));
  check('and the selection is kept while searching',(await p.locator('.list-tools .primary').innerText())==='Add 20 selected');
  await p.getByLabel('Search',{exact:true}).fill('');await p.waitForTimeout(500);
  await p.getByRole('button',{name:'Invited',exact:true}).click();await p.waitForTimeout(500);
  check('the account filter works (27 invited accounts, the 3 demo students are already active)',(await p.locator('nav.pager [role=status]').innerText()).includes('of 27'));
  check('axe finds no violations on the add list',(await axe(p)).length===0);
  await p.locator('.list-tools .primary').click();await p.locator('.toast').waitFor();
  check('Add selected adds them all and says so',(await p.locator('.toast').innerText()).includes('20 students added'));
  await p.getByRole('button',{name:'In this section'}).click();await p.waitForTimeout(600);
  check('they now appear in the section list',(await p.locator('nav.pager [role=status]').innerText()).includes('of 20'));
  await p.getByLabel('Search',{exact:true}).fill('List Student 05');await p.waitForTimeout(600);
  await p.locator('tbody tr').first().getByRole('button',{name:'Withdraw'}).click();
  const wd=p.locator('dialog');
  check('withdrawing needs a reason of at least three characters',await wd.getByRole('button',{name:'Withdraw student'}).isDisabled());
  await wd.getByLabel(/Reason/).fill('ab');
  check('two characters are not enough',await wd.getByRole('button',{name:'Withdraw student'}).isDisabled());
  await wd.getByLabel(/Reason/).fill('Dropped the course');await wd.getByRole('button',{name:'Withdraw student'}).click();await p.locator('.toast').waitFor();
  await p.getByLabel('Search',{exact:true}).fill('');await p.getByRole('button',{name:'Withdrawn',exact:true}).click();await p.waitForTimeout(600);
  check('the Withdrawn filter shows the withdrawn student',await p.locator('tbody tr').count()===1);
  check('the withdrawal reason is in the audit history',JSON.stringify((await call(p,'GET','/audit?page_size=100')).data).includes('Dropped the course'));

  // ---- bulk assignment
  await p.goto(`/admin/terms/${term.id}`);await p.waitForLoadState('networkidle');
  await p.getByRole('button',{name:'Assign subjects'}).click();
  const d=p.locator('dialog');
  check('subjects stay locked until a teacher is chosen',await d.getByRole('checkbox',{name:/LST 101/}).isDisabled());
  await d.getByLabel('Teacher').selectOption({label:'Demo faculty 1'});
  await d.getByLabel('Filter subjects').fill('LST');
  await d.getByRole('checkbox',{name:/LST 101/}).check();await d.getByRole('checkbox',{name:/LST 201/}).check();
  check('sections that match the subject start ticked and others do not',await d.getByRole('group',{name:'Sections for LST 101'}).locator('input:checked').count()===1&&await d.getByRole('group',{name:'Sections for LST 201'}).locator('input:checked').count()===0);
  check('every selected subject needs a section before Assign is enabled',await d.locator('.actions .primary').isDisabled());
  await d.getByRole('group',{name:'Sections for LST 201'}).locator('input').first().check();
  check('choosing a section from another year asks for a reason',await d.getByLabel(/Reason for placing LST 201/).count()===1&&await d.locator('.actions .primary').isDisabled());
  await d.getByLabel(/Reason for placing LST 201/).fill('Irregular cohort');
  check('the button counts the subjects',(await d.locator('.actions .primary').innerText())==='Assign 2 subjects');
  await d.locator('.actions .primary').click();await p.locator('.toast').waitFor();
  const offerings=(await call(p,'GET',`/terms/${term.id}/offerings`)).data.map(o=>`${o.subject.code}:${o.sections.map(s=>s.name)}`).sort();
  check('both subjects were assigned with their sections in one go',offerings.join(' ')==='LST 101:1A LST 201:1A',offerings.join(' '));
  await p.getByRole('button',{name:'Assign subjects'}).click();await d.getByLabel('Teacher').selectOption({label:'Demo faculty 1'});await d.getByLabel('Filter subjects').fill('LST 101');
  check('a subject the teacher already has is shown as assigned and cannot be picked again',await d.getByRole('checkbox',{name:/LST 101/}).isDisabled());
  check('axe finds no violations on the bulk dialog',(await axe(p)).length===0);
}catch(e){console.log('SCRIPT ERROR:',e.message);results.push(false)}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean)?0:1);
