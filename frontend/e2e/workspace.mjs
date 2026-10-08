// Classroom-shaped workspace: the old addresses still land in the right place and light the right tab, the type pills
// follow you into lessons and work, People and Grades keep their sub-tabs, teachers can reorder, and the To review page loads.
// SELF-PROVISIONING (it publishes two lessons), so run it ONLY against a disposable database that already has an offering
// taught by faculty1@example.com with enrolled students (for example after `npm run e2e:attendance`).
// Refuses unless WORKSPACE_E2E_DISPOSABLE=1.
import {launch,newPage,sessionFor,axe} from './lib.mjs';
if(process.env.WORKSPACE_E2E_DISPOSABLE!=='1'){console.log('Refusing: set WORKSPACE_E2E_DISPOSABLE=1 to confirm this database is disposable.');process.exit(2)}
const results=[];
function check(label,ok,detail=''){results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)}
const call=(page,method,path,body)=>page.evaluate(async([method,path,body])=>{
  const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
  const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});
  let data=null;try{data=await r.json()}catch{data=null}return {status:r.status,data}},[method,path,body]);
const where=page=>{const u=new URL(page.url());return u.pathname+u.search};
const activeTab=page=>page.locator('nav[aria-label="Subject sections"] a.active').first().innerText();

const browser=await launch();
try{
  const F=await sessionFor(browser,'faculty1@example.com'),S=await sessionFor(browser,'student1@example.com');
  const teach=await newPage(browser,{state:F,width:1280,height:900});await teach.goto('/faculty');
  const O=(await call(teach,'GET','/me/offerings')).data[0].id;
  const T=`/teach/offerings/${O}`;
  async function lesson(title){
    const it=(await call(teach,'POST',`${T}/items`,{kind:'lesson',title,section_ids:[],anchor_node_id:null})).data;
    const d=(await call(teach,'GET',`${T}/items/${it.id}`)).data.draft;
    const sv=(await call(teach,'PUT',`${T}/items/${it.id}/draft`,{expected_counter:d.counter,title,body_html:'<p>x</p>',anchor_node_id:null})).data;
    await call(teach,'POST',`${T}/items/${it.id}/draft/publish`,{expected_counter:sv.counter});return it.id}
  const n=Date.now()%100000,A=`Reorder first ${n}`,B=`Reorder second ${n}`;
  const first=await lesson(A);await lesson(B);
  const fb=`/faculty/offerings/${O}`,sb=`/student/offerings/${O}`;

  // ---- teacher: old addresses
  const fac=[[`${fb}/content`,`${fb}/classwork`,'Classwork'],[`${fb}/assessments`,`${fb}/classwork?type=quiz`,'Classwork'],[`${fb}/announcements`,`${fb}/stream`,'Stream'],
    [`${fb}/grades`,`${fb}/gradebook`,'Grades'],[`${fb}/class-standing`,`${fb}/class-standing`,'Grades'],[`${fb}/attendance`,`${fb}/attendance`,'People'],
    [`${fb}/progress`,`${fb}/progress`,'People'],[fb,fb,'People'],[`${fb}/syllabus`,`${fb}/syllabus`,'Classwork']];
  for(const [from,to,tab] of fac){await teach.goto(from);await teach.waitForLoadState('networkidle');
    const label=await activeTab(teach).catch(()=>'(none)');
    check(`teacher ${from.replace(fb,'.')||'.'} lands on ${to.replace(fb,'.')||'.'} under the ${tab} tab`,where(teach)===to&&label===tab,`${where(teach).replace(fb,'.')} / ${label}`)}
  check('a teacher has four subject tabs',await teach.locator('nav[aria-label="Subject sections"] a').count()===4);

  // ---- teacher: pills, status filter, reorder
  await teach.goto(`${fb}/classwork?type=lesson`);await teach.getByRole('heading',{name:'Not under a topic'}).waitFor();
  check('the teacher sees Lessons, Quizzes, Activities, Exams and Syllabus pills',(await teach.locator('nav[aria-label="Classwork type"] a').allInnerTexts()).map(t=>t.replace(/\d+|\s/g,'')).join(',')==='Lessons,Quizzes,Activities,Exams,Syllabus');
  await teach.getByRole('button',{name:'Reorder'}).first().click();
  await teach.getByRole('button',{name:`Move ${B} up`}).click();
  await teach.getByText(`Moved “${B}” up`,{exact:false}).waitFor();
  const order=(await call(teach,'GET',`${T}/items`)).data.filter(i=>(i.published??i.draft).title.endsWith(String(n))).map(i=>(i.published??i.draft).title);
  check('Reorder moves a lesson up and the server keeps the order',order[0]===B&&order[1]===A,order.join(' > '));
  await teach.getByRole('button',{name:/^Drafts/}).click();
  check('the Drafts filter hides published lessons without a newer draft',await teach.locator('ul.seq li',{hasText:A}).count()===0);
  await teach.goto(`${fb}/content/${first}/edit`);await teach.waitForSelector('nav[aria-label="Classwork type"]');
  check('the lesson editor keeps the pills with Lessons selected',(await teach.locator('nav[aria-label="Classwork type"] a.active').innerText()).startsWith('Lessons'));
  await teach.goto('/faculty/review');await teach.getByRole('heading',{name:'To review'}).waitFor();await teach.waitForLoadState('networkidle');
  check('the To review page loads with a heading and either the queue or the empty message',await teach.getByText(/Nothing is waiting|waiting\./).count()>0);
  check('axe finds no violations on To review',(await axe(teach)).length===0);

  // ---- student: old addresses and pills
  const stu=await newPage(browser,{state:S,width:1280,height:900});
  const learn=[[`${sb}/lessons`,`${sb}/classwork`,'Classwork'],[`${sb}/work`,`${sb}/classwork?type=quiz`,'Classwork'],[`${sb}/announcements`,`${sb}/stream`,'Stream'],
    [`${sb}/grades`,`${sb}/results`,'Grades'],[`${sb}/progress`,`${sb}/progress`,'Grades'],[`${sb}/syllabus`,`${sb}/syllabus`,'Classwork']];
  for(const [from,to,tab] of learn){await stu.goto(from);await stu.waitForLoadState('networkidle');
    const label=await activeTab(stu).catch(()=>'(none)');
    check(`student ${from.replace(sb,'.')} lands on ${to.replace(sb,'.')} under the ${tab} tab`,where(stu)===to&&label===tab,`${where(stu).replace(sb,'.')} / ${label}`)}
  check('a student has three subject tabs',await stu.locator('nav[aria-label="Subject sections"] a').count()===3);
  await stu.goto(`${sb}/classwork?type=lesson`);await stu.getByRole('link',{name:B}).click();await stu.waitForSelector('nav[aria-label="Classwork type"]');
  check('opening a lesson keeps the pills with Lessons selected',(await stu.locator('nav[aria-label="Classwork type"] a.active').innerText()).startsWith('Lessons'));
  await stu.getByRole('link',{name:/Back to Classwork/}).click();await stu.waitForSelector('ul.seq');
  check('Back from the lesson returns to the Lessons pill',where(stu)===`${sb}/classwork?type=lesson`,where(stu));
  await stu.getByRole('button',{name:/^Completed/}).click();
  check('each pill remembers its own status filter',await stu.locator('.segmented button.on').innerText().then(t=>t.startsWith('Completed')));
  await stu.getByRole('link',{name:/^Quizzes/}).click();await stu.waitForLoadState('networkidle');
  check('switching pill shows that pill’s own filter, not the previous one',(await stu.locator('.segmented button.on').innerText()).startsWith('Everything'));
  check('axe finds no violations on student Classwork',(await axe(stu)).length===0);
}catch(e){console.log('SCRIPT ERROR:',e.message);results.push(false)}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean)?0:1);
