// Complete multi-role browser flow on a FRESH installation (see scripts/rehearse-fresh.ps1).
// admin invites -> faculty/student accept (emailed links) -> structure -> faculty publishes a lesson,
// a quiz and a grading policy -> student studies, takes the quiz -> faculty publishes grades and exports
// -> permission boundaries -> issue report lifecycle. Exits non-zero on the first failed check.
import {readFileSync} from 'node:fs';
import {launch,newPage,shot,axe,layout,BASE} from './lib.mjs';

const ADMIN={email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD};
const MAILPIT=process.env.MAILPIT??'http://127.0.0.1:18025';
if(!ADMIN.email||!ADMIN.password)throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
const NEW_PASSWORD=process.env.USER_PASSWORD??'Fresh-Setup-Pass-2026';
const results=[];
function check(label,ok,detail=''){results.push({label,ok});console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`);if(!ok)throw new Error('Check failed: '+label)}
const text=async page=>(await page.locator('main').innerText());

async function signIn(page,email,password){
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);
  await page.getByRole('button',{name:'Sign in'}).click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'));
}
// the same calls the pages make, using the signed-in session and its CSRF token
async function call(page,method,path,body){
  return page.evaluate(async([method,path,body])=>{
    const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
    const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});
    let data=null;try{data=await r.json()}catch{data=null}   // a body is optional (204)
    return {status:r.status,data};
  },[method,path,body]);
}
async function mailLink(to,route){
  for(let n=0;n<20;n++){
    const list=await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
    const m=list.messages.find(x=>x.To.some(t=>t.Address===to));
    if(m){const body=await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const link=body.Text.match(new RegExp(`${BASE.replace(/[.]/g,'\\.')}/${route}#token=[\\w-]+`))?.[0];if(link)return link}
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('No email arrived for '+to);
}

const browser=await launch();
const ctx=async(who,opts={})=>{const p=await newPage(browser,opts);p.on('dialog',d=>d.accept());p.who=who;return p};
try{
  await fetch(`${MAILPIT}/api/v1/messages`,{method:'DELETE'});

  // ---------- 1. administrator signs in and invites a teacher and a student ----------
  const admin=await ctx('admin');
  await signIn(admin,ADMIN.email,ADMIN.password);
  check('administrator signs in with the bootstrap account',admin.url().endsWith('/admin'));
  await admin.goto('/admin/accounts');
  for(const [name,email,role,number] of [['Fresh Teacher','fresh-teacher@example.com','Faculty',''],['Fresh Student','fresh-student@example.com','Student','F-001']]){
    await admin.getByRole('button',{name:'Invite user'}).click();
    const dialog=admin.locator('dialog');
    await dialog.getByLabel('Full name').fill(name);await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Role').selectOption({label:role});
    if(number)await dialog.getByLabel('Student number').fill(number);
    await dialog.getByRole('button',{name:'Send invitation'}).click();
    await admin.locator('dialog').waitFor({state:'detached'});
  }
  await admin.getByText('Fresh Student').waitFor();await admin.getByText('Fresh Teacher').waitFor();
  check('both invitations were sent',(await text(admin)).includes('Fresh Teacher')&&(await text(admin)).includes('Fresh Student'));

  // ---------- 2. they accept the emailed links and choose passwords ----------
  for(const [key,email] of [['teacher','fresh-teacher@example.com'],['student','fresh-student@example.com']]){
    const page=await ctx(key);
    await page.goto(await mailLink(email,'accept-invitation'));
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button').filter({hasText:/set|save|continue|create/i}).first().click();
    await page.getByRole('status').or(page.locator('.panel')).first().waitFor();
    await page.waitForTimeout(500);
    check(`${key} accepted the invitation`,!(await page.locator('[role=alert]').count()));
    await page.context().close();
  }
  const rate=n=>new Promise(r=>setTimeout(r,n));
  await rate(1000);

  // ---------- 3. administrator builds the term (the calls the setup pages make) ----------
  const who=await call(admin,'GET','/accounts?search=fresh');
  const teacher=who.data.find(a=>a.email==='fresh-teacher@example.com'),student=who.data.find(a=>a.email==='fresh-student@example.com');
  check('both accounts are active',teacher?.status==='active'&&student?.status==='active',`${teacher?.status}/${student?.status}`);
  const year=(await call(admin,'POST','/school-years',{label:'2026-2027',start_date:'2026-06-01',end_date:'2027-04-30',terms:[{name:'First Semester',sequence:1,start_date:'2026-06-01',end_date:'2026-12-31'}]})).data;
  const term=year.terms[0];
  const subject=(await call(admin,'POST','/subjects',{code:'ENT 101',title:'Introduction to Entrepreneurship',units:'3',year_level:1,semester:1})).data;
  const section=(await call(admin,'POST',`/terms/${term.id}/sections`,{name:'1A',year_level:1})).data;
  const offering=await call(admin,'POST',`/terms/${term.id}/offerings`,{subject_id:subject.id,faculty_id:teacher.id,section_ids:[section.id]});
  check('the term, subject, section and offering exist',offering.status===201,String(offering.status));
  const O=offering.data.id;
  const member=await call(admin,'POST',`/sections/${section.id}/members`,{student_id:student.id});
  check('the student is placed in the section',member.status<300,String(member.status));

  // ---------- 4. teacher publishes a syllabus, a lesson and a quiz ----------
  const teach=await ctx('teacher');
  await signIn(teach,'fresh-teacher@example.com',NEW_PASSWORD);
  const uid=()=>crypto.randomUUID();
  const outline={course:{name:'Introduction to Entrepreneurship',code:'ENT 101',units:'3'},outcomes:[{id:uid(),text:'Explain entrepreneurship'}],chapters:[{id:uid(),title:'Chapter 1 - Foundations',weeks:'Week 1',topics:[{id:uid(),title:'What is a venture?'}]}]};
  const policy={categories:[{key:'quiz',label:'Quizzes',weight:100}],periods:[{key:'midterm',label:'Midterm',share:50},{key:'finals',label:'Finals',share:50}],transmutation:'raw',passing:75,late_attendance_fraction:0.5};
  const d=(await call(teach,'POST',`/teach/offerings/${O}/syllabus/draft`)).data;
  const sv=(await call(teach,'PUT',`/teach/offerings/${O}/syllabus/draft`,{expected_counter:d.counter,outline,grading_policy:policy})).data;
  const pub=await call(teach,'POST',`/teach/offerings/${O}/syllabus/draft/publish`,{expected_counter:sv.counter});
  check('the syllabus with a grading policy is published',pub.status===200,String(pub.status));

  await teach.goto(`/faculty/offerings/${O}/content`);
  await teach.getByRole('button',{name:'New item'}).click();
  await teach.locator('dialog').getByLabel('Title').fill('Starting a venture');
  await teach.locator('dialog').getByLabel('Attach to a syllabus topic').selectOption({label:'Chapter 1 - Foundations › What is a venture?'});
  await teach.locator('dialog').getByRole('button',{name:'Create and edit'}).click();
  await teach.locator('.rich-content').click();
  await teach.keyboard.type('A venture starts when someone finds a real customer problem and builds a solution for it.');
  await teach.waitForTimeout(2500);
  await shot(teach,'flow-1-lesson-editor');
  await teach.getByRole('button',{name:'Publish'}).click();
  await teach.waitForURL(/\/content$/);
  await teach.getByText('Published v1').first().waitFor();
  check('the lesson is published',(await text(teach)).includes('Starting a venture'));

  await teach.goto(`/faculty/offerings/${O}/assessments`);
  await teach.getByRole('button',{name:'New assessment'}).click();
  await teach.locator('dialog').getByLabel('Title').fill('Venture basics quiz');
  await teach.locator('dialog').getByRole('button',{name:'Create and set up'}).click();
  await teach.getByRole('button',{name:'Add multiple choice'}).click();
  await teach.getByLabel('Question',{exact:true}).fill('What starts a venture?');
  await teach.getByLabel('Choice 1 text').fill('A real customer problem');
  await teach.getByLabel('Choice 2 text').fill('A logo');
  await teach.getByLabel('Choice 3 text').fill('A loan');
  await teach.getByLabel('Choice 4 text').fill('A website');
  await teach.getByLabel('Choice 1 is correct').check();
  await teach.getByLabel('Grading category').selectOption({label:'Quizzes (100%)'});
  await teach.getByLabel('Grading period').selectOption({label:'Midterm'});
  await teach.waitForTimeout(2500);
  await shot(teach,'flow-2-quiz-editor');
  await teach.getByRole('button',{name:'Publish'}).click();
  await teach.waitForURL(/\/assessments$/);
  await teach.getByText('Published v1').first().waitFor();
  check('the quiz is published',(await text(teach)).includes('Venture basics quiz'));

  // ---------- 5. the student studies and takes the quiz ----------
  const stud=await ctx('student');
  await signIn(stud,'fresh-student@example.com',NEW_PASSWORD);
  await stud.goto('/student');
  await stud.getByRole('link',{name:'Continue learning'}).click();
  await stud.getByText('real customer problem').waitFor();
  check('the dashboard next step opens the published lesson, and Back names the Dashboard',await stud.locator('p.back a',{hasText:/Back to Dashboard/}).count()===1);
  await stud.goto(`/student/offerings/${O}/syllabus`);
  await stud.getByRole('link',{name:/Starting a venture/}).click();
  await stud.getByText('real customer problem').waitFor();
  check('a syllabus topic links to its published lesson, and Back returns to the Syllabus',await stud.locator('p.back a',{hasText:/Back to Syllabus/}).count()===1);
  await stud.goto(`/student/offerings/${O}/lessons`);
  await stud.getByRole('link',{name:'Starting a venture',exact:true}).click();
  await stud.getByText('real customer problem').waitFor();
  check('the student reads the published lesson',(await text(stud)).includes('real customer problem'));
  await stud.getByRole('button',{name:'Mark lesson as complete'}).click();
  await stud.getByText('You marked this lesson complete').waitFor();
  await stud.goto(`/student/offerings/${O}/work`);
  await stud.locator('ul.seq a').first().click();
  await stud.getByRole('button',{name:/Start/}).click();
  await stud.getByLabel('A real customer problem').check();
  await stud.waitForTimeout(1500);
  await shot(stud,'flow-3-student-quiz');
  await stud.getByRole('button',{name:'Submit answers'}).click();
  await stud.getByText('Quiz submitted').waitFor();
  check('the quiz was scored without revealing the answers',(await text(stud)).includes('1.00 / 1.00')&&(await text(stud)).includes('correct answers are not shown'));
  await stud.goto(`/student/offerings/${O}/progress`);
  await stud.getByText('2 of 2 steps done').waitFor();
  check('progress counts only the lesson and the quiz she completed',(await text(stud)).includes('100%'));
  await shot(stud,'flow-4-student-progress');

  // ---------- 6. the teacher publishes grades and exports them ----------
  await teach.goto(`/faculty/offerings/${O}/gradebook`);
  await teach.getByRole('button',{name:'Publish Midterm'}).click();
  await teach.locator('dialog').getByText(/1 published/).waitFor();
  check('the publication summary says one grade was published',true);
  await teach.getByRole('button',{name:'Close dialog'}).click();
  const grade=(await call(stud,'GET',`/learn/offerings/${O}/results`)).data;
  check('the student sees the published midterm grade',grade.grades.length===1&&grade.grades[0].period==='midterm'&&Number(grade.grades[0].grade)===100,JSON.stringify(grade.grades));
  await teach.goto(`/faculty/offerings/${O}/class-standing`);
  await teach.getByRole('heading',{name:/Midterm: all sections/}).waitFor();
  const board=await text(teach);
  check('Class standing ranks the published grade and says ties and unpublished are handled',board.includes('1 ranked')&&board.includes('Ties share a rank'),board.slice(0,0));
  check('a student cannot read the class standing',(await call(stud,'GET',`/teach/offerings/${O}/class-standing?period=midterm`)).status===403);
  const downloads={};
  for(const [format,label] of [['xlsx','Download Excel'],['pdf','Download PDF']]){
    const [dl]=await Promise.all([teach.waitForEvent('download',{timeout:15000}),teach.getByRole('button',{name:label}).click()]).catch(async e=>{
      console.log('EXPORT PANEL SAYS:',await teach.locator('section.panel',{hasText:'Export grades'}).innerText());await shot(teach,'flow-export-failed');throw e});
    const path=`../var/screens/flow-export.${format}`;await dl.saveAs(path);downloads[format]=readFileSync(path);
    check(`the published ${format.toUpperCase()} export downloads`,dl.suggestedFilename().endsWith('.'+format)&&downloads[format].length>500,dl.suggestedFilename());
  }
  check('the files are real XLSX (zip) and PDF documents',downloads.xlsx.subarray(0,2).toString()==='PK'&&downloads.pdf.subarray(0,5).toString()==='%PDF-');
  await teach.getByLabel('Working preview').check();
  const [preview]=await Promise.all([teach.waitForEvent('download'),teach.getByRole('button',{name:'Download PDF'}).click()]);
  check('a working preview is named as a preview',preview.suggestedFilename().includes('PREVIEW'),preview.suggestedFilename());
  await shot(teach,'flow-5-gradebook-export');

  // ---------- 7. permission and privacy boundaries ----------
  await stud.goto(`/faculty/offerings/${O}/gradebook`);
  await stud.getByRole('heading',{name:'Access unavailable'}).waitFor();
  check('a student cannot open the teacher gradebook page',(await text(stud)).includes('Access unavailable'));
  check('a student cannot export grades',(await call(stud,'GET',`/teach/offerings/${O}/exports/grades?format=xlsx&period=midterm`)).status===403);
  check('an administrator cannot export a teacher’s grades',(await call(admin,'GET',`/teach/offerings/${O}/exports/grades?format=xlsx&period=midterm`)).status===403);
  check('an administrator cannot read the gradebook',(await call(admin,'GET',`/teach/offerings/${O}/gradebook`)).status===403);
  const chat=await call(stud,'POST',`/learn/offerings/${O}/study/conversations`,{});
  check('a student can start private study help',chat.status===201);
  check('the teacher cannot read the student’s conversations',(await call(teach,'GET',`/learn/offerings/${O}/study/conversations`)).status===403);

  // ---------- 7b. sequence and status of lessons, My work, deleting a study chat ----------
  const topicId=outline.chapters[0].topics[0].id;
  const second=(await call(teach,'POST',`/teach/offerings/${O}/items`,{kind:'lesson',title:'Finding customers',section_ids:[],anchor_node_id:topicId})).data;
  const draft2=(await call(teach,'GET',`/teach/offerings/${O}/items/${second.id}`)).data.draft;
  const saved2=(await call(teach,'PUT',`/teach/offerings/${O}/items/${second.id}/draft`,{expected_counter:draft2.counter,title:'Finding customers',body_html:'<p>Talk to ten possible customers.</p>',anchor_node_id:topicId})).data;
  check('a second lesson in the same topic is published',(await call(teach,'POST',`/teach/offerings/${O}/items/${second.id}/draft/publish`,{expected_counter:saved2.counter})).status===200);
  await stud.goto(`/student/offerings/${O}/lessons`);
  await stud.getByRole('heading',{name:/What is a venture\?/}).waitFor();
  const lessons=await text(stud);
  check('lessons are grouped under their syllabus topic with a completed chip and an unfinished one',lessons.includes('Chapter 1 - Foundations › What is a venture?')&&lessons.includes('✓ Completed')&&lessons.includes('Not marked complete'));
  check('Up next marks the unfinished lesson and Continue points to it',await stud.locator('li.next',{hasText:'Finding customers'}).count()===1&&await stud.getByRole('link',{name:/Continue: Finding customers/}).count()===1);
  await shot(stud,'flow-6-student-lessons');
  await teach.goto(`/faculty/offerings/${O}/content`);
  await teach.getByRole('button',{name:'Move Finding customers up'}).click();
  await teach.getByText(/Moved “Finding customers” up/).waitFor();
  check('faculty reorder with the Up button and the move is announced',true);
  await stud.reload();await stud.getByRole('heading',{name:/What is a venture\?/}).waitFor();
  check('the student sees the new order',(await stud.locator('ul.seq li').first().innerText()).includes('Finding customers'));
  await stud.getByRole('link',{name:'Finding customers',exact:true}).click();
  await stud.getByRole('button',{name:'Mark lesson as complete'}).click();
  await stud.getByRole('link',{name:/Next lesson: Starting a venture/}).waitFor();
  check('after completing, the next lesson in the sequence is offered',true);
  await stud.goto(`/student/offerings/${O}/work`);
  await stud.getByRole('heading',{name:/^Completed/}).waitFor();
  check('My work puts the finished quiz under Completed',(await text(stud)).includes('Venture basics quiz'));
  await stud.goto(`/student/offerings/${O}/study`);
  await stud.locator('.chat-item').first().waitFor();
  await stud.locator('.chat-item').first().click();
  await stud.getByRole('button',{name:'Delete conversation'}).click();
  await stud.locator('dialog').getByRole('button',{name:'Delete conversation'}).click();
  await stud.getByText('No earlier chats yet.').waitFor();
  check('a student deletes a whole study conversation',((await call(stud,'GET',`/learn/offerings/${O}/study/conversations`)).data.items).length===0);

  // ---------- 7c. a realistic subject: 40 more lessons, and the new lists at phone width ----------
  for(let n=1;n<=40;n++){
    const anchor_node_id=n%2?topicId:null,title=`Practice lesson ${n}`;
    const it=(await call(teach,'POST',`/teach/offerings/${O}/items`,{kind:'lesson',title,section_ids:[],anchor_node_id})).data;
    const dr=(await call(teach,'GET',`/teach/offerings/${O}/items/${it.id}`)).data.draft;
    const sv=(await call(teach,'PUT',`/teach/offerings/${O}/items/${it.id}/draft`,{expected_counter:dr.counter,title,body_html:'<p>Practice.</p>',anchor_node_id})).data;
    await call(teach,'POST',`/teach/offerings/${O}/items/${it.id}/draft/publish`,{expected_counter:sv.counter});
  }
  const started=Date.now();const listed=(await call(stud,'GET',`/learn/offerings/${O}/items`)).data;const took=Date.now()-started;
  check('with 42 lessons the student list is complete, grouped, and answers quickly',listed.length===42&&took<3000,`${listed.length} items in ${took} ms`);
  await stud.setViewportSize({width:375,height:812});await teach.setViewportSize({width:375,height:812});
  await stud.goto(`/student/offerings/${O}/lessons`);await stud.getByRole('heading',{name:'Other materials'}).waitFor();await stud.waitForLoadState('networkidle');
  const phoneStudent=await layout(stud);await shot(stud,'flow-7-student-lessons-phone');
  check('the student lesson list fits a phone: no sideways scroll and 44px targets',!phoneStudent.overflow&&phoneStudent.small.length===0,JSON.stringify(phoneStudent.small));
  await teach.goto(`/faculty/offerings/${O}/content`);await teach.getByRole('heading',{name:'Other materials'}).waitFor();await teach.waitForLoadState('networkidle');
  const phoneFaculty=await layout(teach);await shot(teach,'flow-8-faculty-content-phone');
  check('the faculty content list fits a phone with its Up/Down buttons',!phoneFaculty.overflow&&phoneFaculty.small.length===0,JSON.stringify(phoneFaculty.small));
  await teach.getByLabel('Search').fill('lesson 17');
  check('the content search narrows 42 items to the match',await teach.locator('ul.seq li').count()===1);
  await stud.setViewportSize({width:1280,height:900});await teach.setViewportSize({width:1280,height:900});

  // ---------- 7d. the teacher's per-student standing page ----------
  await teach.goto(`/faculty/offerings/${O}`);
  await teach.locator('table a').first().click();
  await teach.getByRole('heading',{name:'Grades',exact:true}).waitFor();
  check('the cards other than Grades start collapsed',await teach.locator('details.fold.panel[open]').count()===0);
  await teach.getByRole('heading',{name:'Quizzes, activities and exams'}).click();
  const standing=await text(teach);
  check('the standing page shows the current calculation apart from what the student sees',standing.includes('Current calculation')&&standing.includes('Visible to student')&&standing.includes('Venture basics quiz'));
  check('and carries no study-help content',!/conversation|question you asked/i.test(standing));
  check('Back from the standing page returns to the roster it was opened from',await teach.locator('p.back a',{hasText:/Back to Students/}).count()===1);
  await teach.getByRole('button',{name:'View answers'}).first().click();
  await teach.locator('dialog .review').first().waitFor();
  check('the teacher opens the student answers from the standing page and sees right and wrong marked',(await teach.locator('dialog').innerText()).includes('1 of 1 correct')&&await teach.locator('dialog .verdict.correct').count()===1);
  await teach.getByRole('button',{name:'Close',exact:true}).click();
  const sid=teach.url().split('/students/')[1];
  check('a student cannot read the standing endpoint and an administrator cannot either',(await call(stud,'GET',`/teach/offerings/${O}/students/${sid}/standing`)).status===403&&(await call(admin,'GET',`/teach/offerings/${O}/students/${sid}/standing`)).status===403);
  const pdfs={};
  for(const [label,key] of [['Download PDF for the student','published'],['Download faculty copy (PDF)','working']]){
    const [dl]=await Promise.all([teach.waitForEvent('download',{timeout:15000}),teach.getByRole('button',{name:label}).click()]);
    const path=`../var/screens/flow-standing-${key}.pdf`;await dl.saveAs(path);pdfs[key]={name:dl.suggestedFilename(),bytes:readFileSync(path)};
  }
  check('both standing PDFs download, and only the faculty copy is named as one',pdfs.published.bytes.subarray(0,5).toString()==='%PDF-'&&pdfs.working.bytes.subarray(0,5).toString()==='%PDF-'&&!pdfs.published.name.includes('FACULTY-COPY')&&pdfs.working.name.includes('FACULTY-COPY'),`${pdfs.published.name} / ${pdfs.working.name}`);
  check('the student cannot fetch either standing PDF',(await call(stud,'GET',`/teach/offerings/${O}/students/${sid}/standing.pdf?basis=published`)).status===403);
  await shot(teach,'flow-9-student-standing');

  // ---------- 8. issue report lifecycle ----------
  await stud.goto('/student/issues');
  await stud.getByRole('button',{name:'Report a problem'}).click();
  await stud.getByLabel('Short title').fill('Quiz timer is confusing');
  await stud.getByLabel('What happened?').fill('I could not tell how much time was left on the quiz page.');
  await stud.getByRole('button',{name:'Send report'}).click();
  await stud.getByText('Your report was sent').waitFor();
  await admin.goto('/admin/issues');
  await admin.getByText('Quiz timer is confusing').waitFor();
  await admin.getByLabel('Note for the reporter').fill('Thanks - we will add a visible timer.');
  await admin.getByRole('button',{name:'Mark as resolved'}).click();
  await admin.getByText('Saved.').waitFor();
  await stud.goto('/student/issues');
  await stud.getByText('Thanks - we will add a visible timer.').waitFor();
  check('the student sees the administrator’s reply on a resolved report',(await text(stud)).includes('Resolved'));
  await shot(admin,'flow-6-admin-reports');

  // ---------- 9. accessibility and layout of the finished state ----------
  let bad=0;
  for(const [page,paths] of [[stud,[`/student/offerings/${O}/progress`,`/student/offerings/${O}/results`]],[teach,[`/faculty/offerings/${O}/gradebook`,`/faculty/offerings/${O}/progress`]],[admin,['/admin/issues','/admin/accounts']]]){
    for(const p of paths){await page.goto(p);await page.waitForLoadState('networkidle');const v=await axe(page);const l=await layout(page);bad+=v.length+(l.overflow?1:0);if(v.length)console.log(p,JSON.stringify(v))}
  }
  check('no accessibility violations or overflow on the finished pages',bad===0);
}catch(e){
  console.log('FLOW FAILED:',e.message);
  process.exitCode=1;
}finally{
  await browser.close();
  console.log(`${results.filter(r=>r.ok).length}/${results.length} checks passed`);
}
